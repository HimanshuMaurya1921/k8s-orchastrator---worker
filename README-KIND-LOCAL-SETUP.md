# Local Development Guide: KIND Setup

This guide helps you set up the AI Studio Preview System locally using **Kind** (Kubernetes in Docker).

## 1. Prerequisites
- Docker
- Kind (`brew install kind` or equivalent)
- kubectl

## 2. Cluster Creation
```bash
# Create the cluster with the provided config (includes ingress ports)
kind create cluster --config kind-config.yaml --name ai-studio
```

## 3. Image Preparation
```bash
# Build the worker image
docker build -t preview-worker:local ./preview-worker

# Build the orchestrator image
docker build -t orchestrator:local ./orchestrator

# Load images into Kind
kind load docker-image preview-worker:local --name ai-studio
kind load docker-image orchestrator:local --name ai-studio
```

## 4. Deployment
```bash
# Deploy Redis, Orchestrator, and Frontend
kubectl apply -k k8s/overlays/local
```

## 5. Tuning the Lifecycle (Senior Tips)
You can modify the session behavior by editing the orchestrator deployment or using a local `.env` file for the orchestrator:

- **`TERMINATION_GRACE_PERIOD_SECONDS=30`**: Increase this if you find yourself losing pods too quickly during development refreshes.
- **`JANITOR_PULSE_INTERVAL_MS=10000`**: Frequency of the background cleanup check.

### Monitoring Lifecycle Events
Watch the orchestrator logs to see the "Graceful Janitor" in action:
```bash
kubectl rollout restart deployment/orchestrator -n preview

kubectl logs -l app=orchestrator -n preview -f
```
Look for:
- `[Janitor] Pulse: Checking X terminating sessions...`
- `[Session] ✨ Termination CANCELLED` (When you return to the tab)
- `[Janitor] 💀 Grace period expired` (When the pod is finally deleted)

## 6. Cleanup
```bash
kind delete cluster --name ai-studio
```
