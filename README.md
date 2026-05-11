# AI Studio Preview System (Hardened)

A high-performance, Kubernetes-native preview infrastructure for Next.js and Vite applications. This system provides ephemeral sandbox environments with support for atomic file injection and sub-second HMR.

## 🏗 Architecture (Senior Refactored)

The system consists of three main components, now hardened for production-grade reliability:

1.  **Frontend**: A React dashboard that implements readiness polling and reliable `sendBeacon` session termination.
2.  **Orchestrator**: A high-concurrency Node.js router that manages the pod lifecycle via the K8s API. Standardized on **Redis Hashes** for state management and features a non-blocking "Graceful Janitor".
3.  **Sandbox Worker**: A specialized container image running the Next.js dev server, optimized with `tmpfs` workspace storage and `node_modules` symlinking.

## 🚀 Key Features

- **Kubernetes-Native**: Scheduled on dedicated `preview-pool` nodes with strict resource isolation.
- **Warm Update Logic**: Reuses existing pods for the same project/user to achieve sub-second code updates.
- **Graceful Termination**: Implements a configurable **30s grace period** (via Janitor) to prevent unnecessary pod restarts during browser refreshes.
- **Synchronized Timeouts**: Frontend and Backend are aligned on a **90s boot window** for high reliability.
- **Observability**: Integrated with Prometheus/Grafana for OOMKill detection and cost tracking.

## ⚙️ Configuration (Orchestrator)

The system is now fully configurable via environment variables (see `.env.example`):

| Variable | Description | Default |
| :--- | :--- | :--- |
| `TERMINATION_GRACE_PERIOD_SECONDS` | Seconds to wait before killing a pod after tab close | `30` |
| `JANITOR_PULSE_INTERVAL_MS` | How often the janitor checks for expired sessions | `10000` |
| `BOOT_TIMEOUT_MS` | Max wait for a pod/Next.js to become ready | `90000` |
| `MAX_PREVIEW_PODS` | Maximum concurrent previews allowed | `40` |
| `SESSION_TTL_SECONDS` | Absolute expiration for Redis session data | `1800` |

## 📁 Project Structure

- `/orchestrator`: Session management with non-blocking Redis iteration.
- `/preview-worker`: Hardened sandbox runner (v1.0.2).
- `/frontend`: React client with synchronized 90s timeouts.
- `/monitoring-stack`: Prometheus rules and Grafana dashboards.
- `/k8s`: Kubernetes manifests for GKE/Kind.

## 🛠 Setup Guides

- [Local Development with Kind](./README-KIND-LOCAL-SETUP.md)
- [GKE Production Setup](./README-GKE-SETUP.md)
- [Frontend Integration Guide](./README-FRONTEND.md)

---
*Senior Developer Note: The system has been hardened against Redis WRONGTYPE errors and blocking operations. Always ensure your environment variables are set correctly before deployment.*
