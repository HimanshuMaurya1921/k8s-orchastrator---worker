# 🚀 AI Studio Preview System (Production Hardened)

A high-performance, Kubernetes-native preview infrastructure designed for Next.js and Vite applications. This system provides ephemeral sandbox environments with support for atomic file injection, sub-second Hot Module Replacement (HMR), and stateless horizontal scaling.

---

## 🏗 System Architecture

The infrastructure consists of three cleanly separated components, hardened for production-grade reliability:

1. **Frontend (The Client)**: A React dashboard that implements intelligent readiness polling and highly reliable `sendBeacon` session termination to prevent orphaned resources.
2. **Orchestrator (The Control Plane)**: A high-concurrency Node.js router that manages pod lifecycles via the Kubernetes API. It is **100% stateless**, relying entirely on Redis for session state and distributed locking.
3. **Sandbox Worker (The Compute Plane)**: A specialized, isolated container running the Next.js dev server. It is optimized with `tmpfs` memory storage and advanced `node_modules` symlinking strategies to achieve near-instant cold starts.

---

## ✨ Enterprise-Grade Features

### 1. True Horizontal Scalability
The Orchestrator is completely stateless. By offloading session management to **Redis**, you can scale the control plane to 50+ pods without issue. Incoming traffic can hit any orchestrator, and Redis will seamlessly route the proxy request to the correct worker pod.

### 2. Advanced Kubernetes Utilization
*   **Memory-backed `emptyDir` Volumes:** Using `medium: Memory` (tmpfs) for the `/workspace` mounts ensures lightning-fast disk I/O for Next.js builds.
*   **Affinity & Tolerations:** Preview workers are strictly scheduled on dedicated `preview-pool` nodes, isolating heavy compute workloads from the core API servers.
*   **TTL CronJob Failsafe:** A custom `preview-pod-ttl-cleanup` CronJob acts as a "belt-and-suspenders" mechanism. If the control plane or Redis fails, K8s guarantees no "zombie" pods will drain cluster resources indefinitely.

### 3. Performance Optimizations
*   **Dependency Pre-Caching:** Worker images run `npm ci` on a template directory during the Docker build phase, then *symlink* it at runtime. This completely eliminates `npm install` latency on cold starts.
*   **"Lazy" Initialization:** A worker pod boots an Express API but waits for the first `/__inject` payload before spawning the heavy Next.js process, preventing CPU "Thundering Herds".
*   **Manual V8 Garbage Collection:** Wiping a sandbox invokes `global.gc()` to prevent memory leaks in long-running Node processes.

### 4. Resilient User Experience
*   **Context-Aware Proxy Errors:** The Orchestrator intelligently checks the `Accept` header. If a worker is busy booting, API requests receive clean JSON (`{"status": "booting"}`), while UI requests get a graceful "Syncing changes..." HTML loader instead of a raw 502 Bad Gateway.
*   **Graceful Reconnection:** Closing a tab triggers a **30-second Grace Period** rather than an immediate kill. If a user refreshes the page or quickly returns, the termination is cancelled.

---

## ⚙️ Configuration

The Orchestrator is strictly configured via Kubernetes ConfigMaps and Secrets. See `k8s/configmap.yaml` for the full list. Key tuning parameters include:

| Variable | Description | Recommended (Prod) |
| :--- | :--- | :--- |
| `MAX_PREVIEW_PODS` | Maximum concurrent previews allowed in the cluster | `40` |
| `TERMINATION_GRACE_PERIOD_SECONDS` | Time to wait before killing a pod after tab close | `30` |
| `JANITOR_PULSE_INTERVAL_MS` | How often the background cleanup runs | `10000` |
| `BOOT_TIMEOUT_MS` | Max wait time for a pod/Next.js to become ready | `90000` |
| `SESSION_TTL_SECONDS` | Absolute expiration for inactive Redis metadata | `1800` |

---

## 📚 Documentation & Runbooks

Comprehensive guides are available depending on your role:

- [Frontend Integration Guide](./README-FRONTEND.md) - API endpoints, state management, and implementation requirements.
- [High-Level Architecture (Simple)](./README-SIMPLE.md) - For PMs, stakeholders, and onboarding.
- [Local Development Setup (Kind)](./README-KIND-LOCAL-SETUP.md) - Testing locally with Docker.
- [Production Deployment (GKE)](./README-GKE-SETUP.md) - Cluster sizing, artifact registry, and tuning.
- [Load Testing & Stress Validation](./README-TEST.md) - Instructions for testing capacity limits.
- [Prometheus/Grafana Monitoring](./monitoring-stack/MONITORING.md) - OOMKill alerts and resource tracking.

---

*System maintained by the AI Studio Platform Engineering Team.*
