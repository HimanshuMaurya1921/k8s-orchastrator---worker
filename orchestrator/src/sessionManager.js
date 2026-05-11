const Redis = require('ioredis');

class SessionManager {
  constructor() {
    // K8s feature: it injects REDIS_PORT as a TCP URL if a service named 'redis' exists.
    // We must parse it or ignore it if it's not a number.
    const rawPort = process.env.REDIS_PORT;
    const port = (rawPort && !rawPort.includes('://')) ? parseInt(rawPort, 10) : 6379;

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: isNaN(port) ? 6379 : port,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // Never give up on Redis
      connectTimeout: 10000,      // 10s timeout
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        return delay;
      }
    });

    this.redis.on('error', (err) => {
      console.error('[Redis Error]', err.message);
    });

    this.redis.on('connect', () => {
      console.log('[Redis] Connected');
    });

    this.ttl = parseInt(process.env.SESSION_TTL_SECONDS || '3600', 10); // 1 hour default
  }

  /**
   * Set session data for both project and worker lookup
   */
  async setSession(projectId, sessionData) {
    const { workerId } = sessionData;

    await this.redis.multi()
      .set(`session:project:${projectId}`, workerId, 'EX', this.ttl)
      .hset(`session:worker:${workerId}`, { ...sessionData, status: 'active' })
      .expire(`session:worker:${workerId}`, this.ttl)
      .exec();
    
    console.log(`[Session] Saved session for project ${projectId} (worker: ${workerId})`);
  }

  /**
   * Get session data by project ID
   */
  async getSessionByProject(projectId) {
    const workerId = await this.redis.get(`session:project:${projectId}`);
    if (!workerId) return null;
    return this.getSessionByWorker(workerId);
  }

  /**
   * Request a graceful termination (starts a timer)
   */
  async requestTermination(workerId, graceSeconds = 15) {
    const session = await this.getSessionByWorker(workerId);
    if (!session) return;

    console.log(`[Session] ⏳ Graceful termination requested for ${workerId}. Waiting ${graceSeconds}s...`);
    
    await this.redis.multi()
      .hset(`session:worker:${workerId}`, 'status', 'terminating')
      .set(`grace:${workerId}`, 'pending', 'EX', graceSeconds)
      .exec();
  }

  /**
   * Confirm session is still active (cancels termination)
   */
  async confirmSession(workerId) {
    const session = await this.getSessionByWorker(workerId);
    if (!session || session.status !== 'terminating') return false;

    console.log(`[Session] ✨ Termination CANCELLED for ${workerId}. User returned!`);
    
    await this.redis.multi()
      .hset(`session:worker:${workerId}`, 'status', 'active')
      .del(`grace:${workerId}`)
      .exec();
    
    return true;
  }

  /**
   * Get all sessions that are currently in 'terminating' state
   */
  async getTerminatingSessions() {
    try {
      const terminating = [];
      const stream = this.redis.scanStream({ match: 'session:worker:*', count: 100 });

      for await (const keys of stream) {
        if (keys.length === 0) continue;
        
        const pipe = this.redis.pipeline();
        keys.forEach(key => pipe.hgetall(key));
        const results = await pipe.exec();

        results.forEach(([err, session], index) => {
          if (err || !session || Object.keys(session).length === 0) return;
          
          const workerId = session.workerId || keys[index].split(':').pop();
          if (session.status === 'terminating') {
            if (session.workerPort) session.workerPort = parseInt(session.workerPort, 10);
            terminating.push({ ...session, workerId });
          }
        });
      }
      return terminating;
    } catch (err) {
      console.error(`[Session] Error fetching terminating sessions: ${err.message}`);
      return [];
    }
  }

  /**
   * Check if the grace period for a worker has expired
   */
  async isGraceExpired(workerId) {
    const exists = await this.redis.exists(`grace:${workerId}`);
    return exists === 0;
  }

  /**
   * Get session data by worker ID
   */
  async getSessionByWorker(workerId) {
    try {
      const data = await this.redis.hgetall(`session:worker:${workerId}`);
      if (!data || Object.keys(data).length === 0) return null;
      
      // Redis hash values are strings, convert numbers back
      if (data.workerPort) data.workerPort = parseInt(data.workerPort, 10);
      return data;
    } catch (err) {
      if (err.message.includes('WRONGTYPE')) {
        console.warn(`[Session] Legacy string key detected for worker ${workerId}. Marking as invalid.`);
        return null;
      }
      throw err;
    }
  }

  /**
   * Delete session in redis only
   */
  async deleteSession(workerId) {
    const session = await this.getSessionByWorker(workerId);
    if (!session) return;

    await this.redis.multi()
      .del(`session:project:${session.projectId}`)
      .del(`session:worker:${workerId}`)
      .exec();
    
    console.log(`[Session] Deleted session for project ${session.projectId} (worker: ${workerId})`);
  }

  /**
   * List all active sessions (expensive, use with care)
   */
  async listSessions() {
    const sessions = [];
    const stream = this.redis.scanStream({ match: 'session:worker:*', count: 100 });

    for await (const keys of stream) {
      if (keys.length === 0) continue;

      const pipe = this.redis.pipeline();
      keys.forEach(key => pipe.hgetall(key));
      const results = await pipe.exec();

      results.forEach(([err, val]) => {
        if (err || !val || Object.keys(val).length === 0) return;
        if (val.workerPort) val.workerPort = parseInt(val.workerPort, 10);
        sessions.push(val);
      });
    }
    return sessions;
  }

  /**
   * Reconcile Redis with what's actually running (GKE or Local)
   * This clears stale Redis keys that don't have corresponding pods/containers
   */
  async reconcile(activeWorkerIds) {
    const activeSet = new Set(activeWorkerIds);
    const stream = this.redis.scanStream({ match: 'session:worker:*', count: 100 });

    for await (const keys of stream) {
      for (const key of keys) {
        const workerId = key.replace('session:worker:', '');
        if (!activeSet.has(workerId)) {
          console.log(`[Session] Cleaning up stale or legacy Redis session: ${workerId}`);
          try {
            await this.deleteSession(workerId);
            await this.redis.del(key);
          } catch (err) {
            console.error(`[Session] Failed to clean up key ${key}:`, err.message);
          }
        }
      }
    }
  }
}

module.exports = new SessionManager();
