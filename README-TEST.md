# 🚀 Load Testing Guide: Preview System

This guide explains how to perform a stress test on the AI Studio Preview System to verify scalability, resource limits, and monitoring alerts.

## 📋 Prerequisites

Before running the test, ensure the following services are active and port-forwarded:

1.  **Backend** (Port 3000): Provides the code templates.
2.  **Orchestrator** (Port 3001): Manages the preview pods.
3.  **Grafana** (Port 3002): Visualizes the metrics.

### Verification Commands:
```bash
# Check Backend
curl http://localhost:3000/helthcheck

# Check Orchestrator
curl http://localhost:3001/health

# Restart Port Forwards (if needed)
kubectl port-forward svc/orchestrator -n preview 3001:80
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3002:80
```

---

## 🏃‍♂️ Step 1: Run the Load Test

We use a bash script to simulate multiple users requesting previews simultaneously.

---

## 🏃‍♂️ Step 2: High-Concurrency Stress Test

For a "Real World" test, use the stress script. It blasts each pod with 50 requests in parallel through the orchestrator.

```bash
# Make the script executable
chmod +x scratch/stress_test.sh

# Run the test (15 pods x 50 requests = 750 total)
./scratch/stress_test.sh
```

---

## 📊 Step 3: What to Watch (Monitoring)

Open your Grafana dashboard (`http://localhost:3002`) and observe:

### 1. CPU & Memory Surges
- **CPU**: Watch for the `preview` namespace hitting 5.0+ cores during the 750-request blast.
- **Memory**: Ensure memory doesn't cross the `Limit` (4GB or 2GB) and trigger OOMKills.

### 2. Success Rate (Orchestrator Logs)
- Run `kubectl logs -l app=orchestrator -n preview --tail=100`
- If you see `200` status codes during the blast, the proxy is stable.
- If you see `502` or `503`, the orchestrator or workers are overwhelmed.

### 3. Cleanup Logic (The "Graceful Janitor" Test)
1. Open the frontend and generate a preview.
2. Verify the pod is `Running`.
3. Close the browser tab.
4. Verify the Orchestrator logs show `Graceful termination requested`.
5. Wait 30 seconds (the `TERMINATION_GRACE_PERIOD_SECONDS`).
6. Verify the pod is finally deleted by the Janitor.
7. **Test Cancellation**: Close the tab, wait 10s, then reopen the page for the same project. The logs should show `Termination CANCELLED`.

---

## 🧹 Step 4: Cleanup

```bash
# Delete all preview pods
kubectl delete pods -l app=preview-worker -n preview
```

---

## 🧪 Advanced: Testing Different Scenarios

### A. Testing OOM Crashes
1. Edit `orchestrator/src/k8sClient.js`.
2. Set `limits: { memory: '256Mi' }`.
3. Rebuild orchestrator and restart.
4. Run load test.
5. Watch the pods crash in `kubectl get pods -n preview`.
6. Verify the **PodOOMKilled** alert fires in Alertmanager (`http://localhost:9093`).

### B. Testing Cluster Fullness
Increase the `MAX_PREVIEW_PODS` to 10 and run the load test for 15 pods. The orchestrator should return `503 Service Unavailable` with a "Cluster Full" message.

---

## ❓ Troubleshooting

- **❌ Failed (Empty Error)**: The orchestrator port-forward is likely dead. Restart it.
- **❌ Failed: Pod did not become ready**: Next.js is taking too long to boot. The system has a synchronized **90s timeout**. If your machine is under heavy load, increase `BOOT_TIMEOUT_MS` in the orchestrator.
- **❌ Error: Could not fetch files**: The backend server is not running on port 3000.
