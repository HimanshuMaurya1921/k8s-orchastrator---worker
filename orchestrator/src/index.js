const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const crypto = require('crypto');
const sessionManager = require('./sessionManager');

const IS_GKE = process.env.RUNTIME === 'gke';

// Load the right backend
const backend = IS_GKE
  ? require('./k8sClient')
  : require('./localWorker');

module.exports = function () {
  const router = express.Router();
  const AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN;

  // Senior Fix: Use environment variables for grace periods and intervals
  const GRACE_PERIOD = parseInt(process.env.TERMINATION_GRACE_PERIOD_SECONDS || '30', 10);
  const PULSE_INTERVAL = parseInt(process.env.JANITOR_PULSE_INTERVAL_MS || '10000', 10);

  // Reconcile sessions on startup
  (async () => {
    try {
      let activeWorkerIds = [];
      if (backend.listActiveWorkerIds) {
        activeWorkerIds = await backend.listActiveWorkerIds();
      }
      await sessionManager.reconcile(activeWorkerIds);
    } catch (err) {
      console.error(`[Orchestrator][${process.env.POD_NAME || 'local'}] Reconciliation failed:`, err.message);
    }
  })();

  router.post('/start', async (req, res) => {
    const { projectId, userId, files } = req.body;
    const sessionKey = userId || projectId;

    if (!sessionKey) return res.status(400).json({ error: 'Missing userId or projectId' });
    if (!files) return res.status(400).json({ error: 'files required' });

    // ─── Warm Update Logic ───
    const existing = await sessionManager.getSessionByProject(sessionKey);
    if (existing) {
      // Senior Fix: If session was pending termination, cancel it!
      await sessionManager.confirmSession(existing.workerId);

      console.log(`[Orchestrator][${process.env.POD_NAME || 'local'}] Existing session found for ${sessionKey}. Verifying health...`);
      try {
        const isRunning = await backend.isWorkerRunning(existing.workerId);
        if (!isRunning) throw new Error('Worker not running');

        const injectStart = Date.now();
        const injectRes = await fetch(`http://${existing.workerHost}:${existing.workerPort}/__inject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-worker-auth': AUTH_TOKEN },
          body: JSON.stringify({ files, wipe: true })
        });

        if (injectRes.ok) {
          console.log(`[Orchestrator][${process.env.POD_NAME || 'local'}] Warm update for ${existing.workerId} took ${Date.now() - injectStart}ms`);
          return res.json({
            workerId: existing.workerId,
            previewUrl: `http://localhost:${process.env.WORKER_PORT || 3001}/api/preview/proxy/${existing.workerId}/`,
            warm: true
          });
        }
      } catch (err) {
        console.warn(`[Orchestrator][${process.env.POD_NAME || 'local'}] Session health check failed for ${existing.workerId}: ${err.message}`);
        // Senior Fix: Don't just delete from Redis, kill the pod too!
        try {
          if (IS_GKE) await backend.deletePreviewPod(existing.workerId);
          else await backend.deleteLocalWorker(existing.workerId);
        } catch (deleteErr) { }
        await sessionManager.deleteSession(existing.workerId);
        // Fall through to cold start
      }
    }

    // ─── Cold Start Path ───
    if (IS_GKE) {
      const { active, max } = await backend.getClusterCapacity();
      if (active >= max) {
        return res.status(503).json({
          error: `Preview cluster is full (${active}/${max}). Try again shortly.`,
          retryAfterMs: 15000
        });
      }
    }

    try {
      const sessionId = crypto.randomBytes(8).toString('hex');
      let workerHost, workerPort, workerId;

      if (IS_GKE) {
        workerId = await backend.createPreviewPod(sessionId, projectId);
        workerHost = await backend.waitForPodReady(workerId);
        workerPort = 3000;
      } else {
        const result = await backend.createLocalWorker(sessionId);
        workerId = result.containerName;
        workerPort = result.port;
        workerHost = 'localhost';
        await backend.waitForWorkerReady(workerPort);
      }

      // Inject files
      const injectRes = await fetch(`http://${workerHost}:${workerPort}/__inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-worker-auth': AUTH_TOKEN },
        body: JSON.stringify({ files })
      });

      if (!injectRes.ok) throw new Error(`Inject failed: ${await injectRes.text()}`);

      await sessionManager.setSession(sessionKey, {
        workerId,
        workerHost,
        workerPort,
        projectId: sessionKey,
        userId
      });

      res.json({
        workerId,
        previewUrl: `http://localhost:${process.env.WORKER_PORT || 3001}/api/preview/proxy/${workerId}/`,
        warm: false
      });

    } catch (err) {
      console.error(`[Orchestrator][${process.env.POD_NAME || 'local'}] Start Error:`, err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  router.patch('/:workerId', async (req, res) => {
    const { workerId } = req.params;
    const { files, projectId } = req.body;

    const session = await sessionManager.getSessionByWorker(workerId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (projectId && session.projectId !== projectId) {
      return res.status(403).json({ error: 'Session mismatch' });
    }

    try {
      const injectStart = Date.now();
      const injectRes = await fetch(`http://${session.workerHost}:${session.workerPort}/__inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-worker-auth': AUTH_TOKEN },
        body: JSON.stringify({ files })
      });

      if (!injectRes.ok) throw new Error('Inject failed');
      console.log(`[Orchestrator][${process.env.POD_NAME || 'local'}] Code patch for ${workerId} took ${Date.now() - injectStart}ms`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const cleanupHandler = async (req, res) => {
    const { workerId } = req.params;
    try {
      // Senior Update: Don't kill instantly, request graceful termination
      await sessionManager.requestTermination(workerId, GRACE_PERIOD);
      res.json({ ok: true, note: `Grace period started (${GRACE_PERIOD}s)` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  // ─── The Graceful Janitor (Distributed) ─────────────────────────────────────────
  // Periodically checks for sessions whose grace period has expired.
  // Uses a Redis lock to ensure only one orchestrator instance is the "Janitor".
  setInterval(async () => {
    const lockKey = 'janitor:lock';
    const lockToken = crypto.randomBytes(16).toString('hex');
    const podName = process.env.POD_NAME || 'local';
    
    try {
      // Try to acquire the Janitor lock for 30 seconds (longer than PULSE_INTERVAL)
      const acquired = await sessionManager.redis.set(lockKey, lockToken, 'NX', 'EX', 30);
      
      if (!acquired) {
        // Another instance is currently the Janitor. Skip this pulse.
        return;
      }

      const terminating = await sessionManager.getTerminatingSessions();

      if (terminating.length > 0) {
        console.log(`[Janitor][${podName}] Pulse (Leader): Checking ${terminating.length} terminating sessions...`);
      }

      for (const session of terminating) {
        const expired = await sessionManager.isGraceExpired(session.workerId);
        if (expired) {
          console.log(`[Janitor][${podName}] 💀 Grace period expired for ${session.workerId}. Terminating pod...`);
          try {
            if (IS_GKE) await backend.deletePreviewPod(session.workerId);
            else await backend.deleteLocalWorker(session.workerId);
            console.log(`[Janitor][${podName}] ✅ Pod ${session.workerId} deleted successfully.`);
          } catch (deleteErr) {
            console.error(`[Janitor][${podName}] ❌ Failed to delete pod ${session.workerId}:`, deleteErr.message);
          }
          await sessionManager.deleteSession(session.workerId);
        }
      }
    } catch (err) {
      console.error(`[Janitor][${podName}] Critical error in background task:`, err.message);
    }
  }, PULSE_INTERVAL);

  router.delete('/:workerId', cleanupHandler);
  router.post('/:workerId/delete', cleanupHandler);

  router.get('/stats', async (req, res) => {
    const sessions = await sessionManager.listSessions();
    res.json({
      runtime: IS_GKE ? 'gke' : 'local',
      activeSessions: sessions.length,
      sessions: sessions.map(s => ({
        projectId: s.projectId,
        workerId: s.workerId
      }))
    });
  });

  // ─── Singleton Proxy for iframe Previews ───
  const previewProxy = createProxyMiddleware({
    target: 'http://placeholder',
    router: async (req) => {
      const { workerId } = req.params;
      const session = await sessionManager.getSessionByWorker(workerId);
      return session ? `http://${session.workerHost}:${session.workerPort}` : undefined;
    },
    changeOrigin: true,
    ws: false, // Handled globally in server.js
    logLevel: 'silent',
    onError: (err, req, res) => {
      // Catch transient connection issues during project swaps
      const isRetryable = err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';
      
      if (isRetryable && !res.headersSent) {
        // 1. Handle API/Health requests (Expect JSON)
        // If the frontend is polling health, we MUST return JSON, even if the worker is busy.
        if (req.url.includes('/__health') || req.headers.accept?.includes('application/json')) {
          return res.status(200).json({ 
            status: 'booting', 
            ready: false,
            note: 'Orchestrator proxying is waiting for worker port to open.'
          });
        }

        // 2. Handle UI/HTML requests (Expect HTML)
        if (req.headers.accept?.includes('text/html')) {
          console.log(`[PreviewProxy][${process.env.POD_NAME || 'local'}] Worker busy or booting (${err.code}), sending sync helper...`);
          return res.status(200).send(`
            <div style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: #64748b; background: #f8fafc;">
              <div style="width: 24px; height: 24px; border: 2px solid #e2e8f0; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.6s linear infinite; margin-bottom: 12px;"></div>
              <p style="font-size: 14px; margin: 0;">Syncing changes...</p>
              <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
              <script>setTimeout(() => location.reload(), 1000)</script>
            </div>
          `);
        }
      }

      if (err.code !== 'ECONNRESET') {
        console.error(`[PreviewProxy Error][${process.env.POD_NAME || 'local'}]`, err.message);
      }
      if (res && !res.headersSent && res.status) {
        res.status(502).send(`Worker communication failed: ${err.message}`);
      }
    },
    onProxyRes: (proxyRes) => {
      proxyRes.headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
      proxyRes.headers['pragma'] = 'no-cache';
      proxyRes.headers['expires'] = '0';
      proxyRes.headers['surrogate-control'] = 'no-store';
    },
  });

  router.use('/proxy/:workerId', async (req, res, next) => {
    const { workerId } = req.params;
    const session = await sessionManager.getSessionByWorker(workerId);

    if (!session) {
      console.warn(`[Proxy][${process.env.POD_NAME || 'local'}] Session NOT FOUND for workerId: ${workerId}`);
      return res.status(404).send('Preview not found or expired');
    }

    res.cookie('preview-worker-id', workerId, { path: '/', httpOnly: true, sameSite: 'lax' });
    previewProxy(req, res, next);
  });

  return {
    router,
    getSessionByWorkerId: async (workerId) => {
      return await sessionManager.getSessionByWorker(workerId);
    }
  };
};
