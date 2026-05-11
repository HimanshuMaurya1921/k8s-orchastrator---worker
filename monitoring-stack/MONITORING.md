# Implementation Plan: Prometheus & Grafana Monitoring

This plan outlines the steps to install and configure a robust monitoring stack for the AI Studio Preview System. We will focus on tracking CPU/Memory usage, alerting on OOMKills, and providing data for cost estimation.

## Goals
- Install **kube-prometheus-stack** via Helm.
- Configure **OOMKill Alerts** to detect Next.js pod crashes.
- Set up a **Grafana Dashboard** for resource visibility.
- Provide a framework for **Cost Estimation** based on resource requests.

---

## 🛠 Step 1: Install Monitoring Stack

### 1.1 Install Helm (if not already installed)
```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### 1.2 Add Prometheus Repository
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

### 1.3 Create `monitoring-values.yaml`
This file will contain our custom alert rules and configuration.

```yaml
prometheus:
  prometheusSpec:
    additionalPrometheusRules:
      - name: preview-system-alerts
        groups:
          - name: oomkill-alerts
            rules:
              - alert: PodOOMKilled
                expr: kube_pod_container_status_last_terminated_reason{reason="OOMKilled", namespace="preview"} == 1
                for: 1m
                labels:
                  severity: critical
                annotations:
                  summary: "Preview Pod {{ $labels.pod }} OOMKilled"
                  description: "Pod {{ $labels.pod }} in namespace 'preview' was terminated due to OutOfMemory. Current limit might be too low."

grafana:
  adminPassword: "admin" # Change this for production!
```

### 1.4 Install the Stack
```bash
kubectl create namespace monitoring
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f monitoring-values.yaml
```

---

## 📊 Step 2: Access & Verify

### 2.1 Access Grafana
```bash
kubectl port-forward svc/kube-prometheus-stack-grafana 3002:80 -n monitoring
```
- **URL**: `http://localhost:3002`
- **User**: `admin` / **Pass**: `admin`

### 2.2 Verify Metrics
In Grafana "Explore", run this query to see memory usage for your preview pods:
```promql
container_memory_working_set_bytes{namespace="preview", container="worker"}
```

---

## 💸 Step 3: Cost Estimation Logic

To estimate costs, we track how many resources are "requested" from the cluster.

### 3.1 Memory Cost Query (Monthly)
Run this in Grafana to see the "Dollar Value" of your requested memory (assuming $10 per GB/Month):
```promql
(sum(kube_pod_container_resource_requests{resource="memory", namespace="preview"}) / 1024^3) * 10
```

### 3.2 Tuning Strategy
1.  **Observe**: Look at the `container_memory_working_set_bytes` over 24 hours.
2.  **Peak**: Identify the peak memory usage during a heavy Next.js build.
3.  **Buffer**: Set your K8s `limit` to **Peak + 20%**.
4.  **Efficiency**: If `working_set` is consistently much lower than `request`, lower the request to save costs on GKE.

---

## 🚨 Step 4: Test the OOM Alert

### 4.1 Trigger a Dummy OOM
Create a pod that intentionally consumes too much memory to test the alert:
```bash
kubectl run oom-test --image=busybox -n preview --limits="memory=16Mi" --restart=Never -- /bin/sh -c "exec 1>&2; x='a'; while true; do x=\"\$x\$x\"; done"
```

### 4.2 Check Alertmanager
```bash
kubectl port-forward svc/kube-prometheus-stack-alertmanager 9093:9093 -n monitoring
```
- Visit `http://localhost:9093` to see the **PodOOMKilled** alert fire.

---

## ✅ Results to Verify
1.  **Prometheus**: Successfully scraping metrics from the `preview` namespace.
2.  **Grafana**: Showing real-time CPU/Memory charts for workers.
3.  **Alertmanager**: Sending notifications (or showing UI alerts) when a pod hits its limit.
