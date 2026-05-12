# 🚀 Load Testing Guide: AI Studio Preview System

This guide explains how to perform a high-concurrency stress test on the Preview System to verify horizontal scalability, Redis locking behavior, and Prometheus monitoring alerts.

## 📋 Prerequisites

Before running the load test, ensure the core cluster services are active and port-forwarded:

1.  **Backend** (Port 3000): Provides the simulated code payloads.
2.  **Orchestrator** (Port 3001): The stateless proxy managing the load.
3.  **Grafana** (Port 3002): Visualizes the metrics and cluster health.
4.  **Redis**: Ensure the Redis service is healthy, as it handles the distributed session locks.

### Verification Commands:
```bash
# Check Backend Health
curl http://localhost:3000/healthcheck

# Check Orchestrator Health
curl http://localhost:3001/health

# Restart Port Forwards (if needed)
kubectl port-forward svc/orchestrator -n preview 3001:80
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3002:80
```

---

## 🏃‍♂️ Execution: High-Concurrency Stress Test

For a "Real World" simulation, use the provided stress script. It blasts each worker pod with 50 rapid-fire requests in parallel through the Orchestrator, testing the proxy's connection pooling and HMR stability.

```bash
# Make the script executable
chmod +x scratch/stress_test.sh

# Run the test (15 pods x 50 requests = 750 total concurrent requests)
./scratch/stress_test.sh
```

---

## 📊 Observability: What to Monitor

Open your Grafana dashboard (`http://localhost:3002`) and observe the following metrics:

### 1. CPU & Memory Surges
- **CPU**: Watch for the `preview` namespace hitting 5.0+ cores during the 750-request blast.
- **Memory**: Ensure memory doesn't cross the limits (e.g., 2GB per worker) and trigger OOMKills.

### 2. Success Rate (Orchestrator Logs)
- Run `kubectl logs -l app=orchestrator -n preview --tail=100`
- If you see `200` status codes during the blast, the proxy is stable and handling the load correctly.
- If you see `502` or `503`, the Orchestrator or Workers are overwhelmed, indicating a need to scale limits.

### 3. Distributed Cleanup Logic (The "Graceful Janitor" Test)
1. Open the frontend and generate a single preview.
2. Verify the pod is `Running`.
3. Close the browser tab.
4. Verify the Orchestrator logs show `Graceful termination requested`.
5. Wait 30 seconds (the `TERMINATION_GRACE_PERIOD_SECONDS`).
6. Verify the pod is finally deleted by the Redis-locked Janitor.
7. **Test Cancellation**: Close the tab, wait 10s, then reopen the page for the same project. The logs should show `Termination CANCELLED`.

---

## 🧹 Teardown & Cleanup

```bash
# Force delete all active preview pods
kubectl delete pods -l app=preview-worker -n preview
```

---

## 🧪 Advanced Scenarios

### A. Testing OOM Crashes
1. Edit `orchestrator/src/k8sClient.js`.
2. Set `limits: { memory: '256Mi' }` (artificially low).
3. Rebuild the Orchestrator image and restart the deployment.
4. Run the load test.
5. Watch the pods crash in `kubectl get pods -n preview`.
6. Verify the **PodOOMKilled** alert correctly fires in Alertmanager (`http://localhost:9093`).

### B. Testing Cluster Exhaustion
Decrease the `MAX_PREVIEW_PODS` environment variable to `10` and run the load test for 15 pods. The Orchestrator should cleanly reject the overflow with `503 Service Unavailable` and a "Cluster Full" message, protecting the cluster from crashing.

---

## ❓ Troubleshooting

- **❌ Failed (Empty Error)**: The orchestrator port-forward is likely dead. Restart the `kubectl port-forward` command.
- **❌ Failed: Pod did not become ready**: Next.js is taking too long to boot under extreme load. The system has a synchronized **90s timeout**. If your node is thrashing, increase `BOOT_TIMEOUT_MS` in the Orchestrator config.
- **❌ Error: Could not fetch files**: The backend simulation server is not running on port 3000.
