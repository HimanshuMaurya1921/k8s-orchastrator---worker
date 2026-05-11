# KIND Local Development Setup

This guide covers setting up a local Kubernetes-in-Docker (KIND) cluster to test the AI Studio Preview system with full production parity.

## 1. Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

## 2. Cluster Creation
Create a multi-node cluster with dedicated worker pools:
```bash
kind create cluster --name ai-studio --config kind-config.yaml
```

## 3. Image Preparation
Build and load the local images into the KIND nodes:
```bash
# Build Worker
docker build --no-cache -t preview-worker:local ./preview-worker

# Build Orchestrator
docker build --no-cache -t orchestrator:local ./orchestrator

# Load into KIND (IMPORTANT: This makes images available to the cluster)
kind load docker-image preview-worker:local --name ai-studio
kind load docker-image orchestrator:local --name ai-studio
```

## 4. Deployment
Apply the Kubernetes manifests. **Note: We use the `preview` namespace for all resources.**

```bash
# 1. Create namespaces, RBAC, and Redis
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/cronjob.yaml

# 2. Create Secrets
kubectl create secret generic preview-worker-secret \
  --from-literal=auth-token=local-dev-token \
  -n preview

# 3. Deploy Orchestrator and policies
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/orchestrator-deployment.yaml

# 4. Install Monitoring Stack (Optional but Recommended)
# This installs Prometheus, Grafana, and OOMKill Alerts
kubectl create namespace monitoring
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f monitoring-stack/monitoring-values.yaml
```

## 5. Accessing the Services

Since services run inside KIND, you must port-forward them to your host machine:

```bash
# 1. Orchestrator (Preview API)
kubectl port-forward svc/orchestrator -n preview 3001:80

# 2. Grafana (Dashboards)
# User: admin / Pass: admin
kubectl port-forward svc/kube-prometheus-stack-grafana -n monitoring 3002:80

# 3. Alertmanager (OOMKill Alerts)
kubectl port-forward svc/kube-prometheus-stack-alertmanager -n monitoring 9093:9093
```

> [!TIP]
> If you see `ImagePullBackOff`, ensure you have run `kind load docker-image` and that `imagePullPolicy` is set to `IfNotPresent` in your deployment manifest.

## 6. Updating Logic (Hot Reload)
If you modify the `worker.js` or `server.js` code, follow this sequence to apply changes:
```bash
# 1. Rebuild the image
docker build -t preview-worker:local ./preview-worker

# 2. Reload into KIND
kind load docker-image preview-worker:local --name ai-studio

# 3. Kill the existing pod (K8s will recreate it with the new image)
kubectl delete pods -l app=preview-worker -n preview

# 4. restart the orchastrator-deployment
k rollout restart deploy/orchestrator -n preview
```

## 7. Verification
1. Open the frontend: `cd frontend && npm run dev`
2. Ensure `VITE_WORKER_URL` is set to `http://localhost:3001`.
3. Check pod status: `kubectl get pods -n preview`
4. **Log Check**: `kubectl logs -l app=preview-worker -n preview` (Look for `[Worker v1.0.2]`)

## 7. Cleanup
```bash
kind delete cluster --name ai-studio
```
