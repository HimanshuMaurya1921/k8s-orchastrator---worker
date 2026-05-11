# Frontend Integration Guide: AI Studio Preview System (Refactored)

This document outlines the mandatory requirements for the frontend to correctly interface with the K8s-based Preview Worker system.

## 1. Core Concepts
The system uses an **Orchestrator** to manage ephemeral Next.js pods. To achieve high performance, we use a **"Warm Update"** strategy where a single pod is reused for a specific user.

## 2. Mandatory Implementation Requirements

### 2.1 Persistent User Identity
Every user **MUST** have a stable `userId` persisted in `localStorage`. This allows the Orchestrator to route them back to their existing "Warm" pod, drastically reducing cold start times.

```javascript
// Recommended stable ID generation
let userId = localStorage.getItem('preview_user_id');
if (!userId) {
  userId = `user-${Math.random().toString(36).substring(2, 11)}`;
  localStorage.setItem('preview_user_id', userId);
}
```

### 2.2 The `/start` Endpoint
Always use the `/start` endpoint for both the initial preview and subsequent updates. The Orchestrator handles the reuse logic internally.
- **URL**: `${WORKER_URL}/api/preview/start`
- **Method**: `POST`
- **Body**: `{ projectId, userId, files }`

### 2.3 Synchronized Timeouts (Critical)
The Frontend **MUST** align its internal timeouts with the Backend's 90-second boot window. 
- **Fail-safe Timeout**: If the pod hasn't responded within **90 seconds**, show a "Retry" state.
- **Polling Interval**: Poll the `/__health` endpoint every 1s for a maximum of **90 attempts**.

### 2.4 Reliable Cleanup with `sendBeacon`
To ensure Kubernetes resources are not leaked when a user closes a tab, the frontend **MUST** implement a cleanup signal using `navigator.sendBeacon`. This is more reliable than standard `fetch` during page unmount.

```javascript
useEffect(() => {
  const cleanup = () => {
    if (workerId) {
      const url = `${apiBase}/api/preview/${workerId}/delete`;
      navigator.sendBeacon(url);
    }
  };
  window.addEventListener('beforeunload', cleanup);
  return () => {
    window.removeEventListener('beforeunload', cleanup);
    cleanup();
  };
}, [workerId]);
```

## 3. The Lifecycle States

1.  **Booting**: Frontend shows a "Syncing changes..." overlay.
2.  **Ready**: The worker's `/__health` returns `status: "ready"`. Only then should the iframe be shown.
3.  **Warm Update**: If the user modifies code, the frontend sends the new files to `/start`. The Orchestrator injects the diff into the *existing* pod, resulting in near-instant updates.
4.  **Grace Period**: When the tab is closed, the Orchestrator starts a **30s grace timer**. If the user returns within this window, the termination is cancelled.

## 4. Error Handling
- **503 Cluster Full**: The cluster has reached `MAX_PREVIEW_PODS`. Show a "Capacity Reached" message with a 15s retry suggestion.
- **502 Worker Error**: Communication with the sandbox failed. Trigger a silent retry (Cold Start) by clearing the local `workerId`.
