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

```bash
# Make the script executable
chmod +x scratch/load_test.sh

# Run the test (creates 15 pods)
./scratch/load_test.sh
```

---

## 📊 Step 2: What to Watch (Monitoring)

Open your Grafana dashboard (`http://localhost:3002`) and observe the following:

### 1. Pod Count & Memory Usage
- **Metric**: `count(kube_pod_status_phase{phase="Running", namespace="preview"})`
- **What to look for**: A sharp "staircase" climb in the number of running pods and total memory consumption.

### 2. OOMKill Alerts
- **Metric**: `kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}`
- **Test**: If you have set a low memory limit (e.g., 512Mi), watch for alerts in **Alertmanager** (`http://localhost:9093`) or the Red "Critical" status in Grafana.

### 3. Orchestrator Latency
- Watch the orchestrator logs: `kubectl logs -l app=orchestrator -n preview --tail=50`
- Look for `[Orchestrator] Code patch for ... took Xms`. If X increases significantly, the cluster might be under high I/O pressure.

---

## 🧹 Step 3: Cleanup

After testing, you should delete the temporary pods to free up cluster resources.

```bash
# Delete all preview pods
kubectl delete pods -l app=preview-worker -n preview

# Clear the Redis sessions (Optional)
# This happens automatically when pods are deleted if reconcile is active
```

---

## 🧪 Advanced: Testing Different Scenarios

### A. Testing Warm Updates
Run the load test twice without cleaning up. The second run should be much faster because the orchestrator will reuse the existing pods ("Warm Update").

### B. Testing OOM Crashes
1. Edit `orchestrator/src/k8sClient.js`.
2. Set `limits: { memory: '256Mi' }`.
3. Rebuild orchestrator and restart.
4. Run load test.
5. Watch the pods crash in `kubectl get pods -n preview`.

### C. Testing Cluster Fullness
Increase the `COUNT` in `load_test.sh` to 50. The orchestrator should eventually return `503 Service Unavailable` once it hits the `MAX_PREVIEW_PODS` limit.

---

## ❓ Troubleshooting

- **❌ Failed (Empty Error)**: The orchestrator port-forward is likely dead. Restart it.
- **❌ Failed: Pod did not become ready**: Next.js is taking too long to boot. Increase `BOOT_TIMEOUT_MS` in the orchestrator environment or check if your machine has enough CPU.
- **❌ Error: Could not fetch files**: The backend server is not running on port 3000.
