# 🚀 Frontend Integration Guide: AI Studio Preview System

Welcome to the frontend integration documentation for the AI Studio Preview System. This guide provides the mandatory technical requirements and architectural concepts needed to interface with our Kubernetes-backed ephemeral compute plane.

Our infrastructure spins up isolated, high-performance Next.js environments ("Workers") on the fly. To ensure a seamless user experience, the frontend must handle session persistence, intelligent polling, and graceful cleanup.

---

## 🏗️ 1. Core Architecture: The "Warm Update" Strategy

The system uses an **Orchestrator** to proxy requests and manage the lifecycle of ephemeral Next.js pods. 

To achieve near-instantaneous code updates, we utilize a **Warm Update** strategy:
1. **Cold Start**: The first time a user previews code, a new pod is provisioned.
2. **Warm Update**: Subsequent code changes are injected into the *existing* pod, avoiding the overhead of starting a new Node process.

---

## ⚙️ 2. Mandatory Integration Requirements

### 2.1 Persistent User Identity (Critical)
To route a user back to their "Warm" pod across page reloads, the frontend **MUST** generate and persist a stable `userId`.

**Implementation:**
```javascript
// Retrieve or generate a stable UUID for the session
const getStableUserId = () => {
  let userId = localStorage.getItem('preview_user_id');
  if (!userId) {
    // Generate a unique ID (consider using a UUID library in production)
    userId = `user-${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem('preview_user_id', userId);
  }
  return userId;
};
```

### 2.2 The Initialization & Update API
The frontend interacts exclusively with the Orchestrator's `/start` endpoint. The Orchestrator handles the complex logic of deciding whether to provision a new pod or inject into an existing one.

*   **Endpoint**: `POST ${WORKER_URL}/api/preview/start`
*   **Payload**:
    ```typescript
    interface PreviewStartPayload {
      projectId: string; // Unique identifier for the project
      userId: string;    // The stable user identity (from 2.1)
      files: {           // Key-value map of file paths to content
        [filePath: string]: string; 
      };
    }
    ```

### 2.3 Synchronized Timeouts & Polling
Kubernetes pod provisioning takes time. The frontend **MUST** align its internal timeouts with the backend's strict 90-second boot window.

1. **The Polling Loop**: Once the `/start` API returns a `workerId`, poll the health endpoint (`GET ${WORKER_URL}/api/preview/proxy/${workerId}/__health`) every 1000ms.
2. **The 90-Second Fail-Safe**: If the pod hasn't returned `{ "status": "ready" }` within 90 attempts (90 seconds), assume a critical failure and render a "Retry" state.

### 2.4 Reliable Resource Cleanup (`sendBeacon`)
Kubernetes resources are expensive. When a user closes the preview tab, the frontend **MUST** explicitly notify the Orchestrator to begin the termination process. 

Because standard `fetch()` calls are often cancelled during page unload, you must use `navigator.sendBeacon`.

**React Hooks Example:**
```javascript
useEffect(() => {
  const cleanup = () => {
    if (workerId) {
      // sendBeacon is non-blocking and guaranteed to fire on tab close
      const url = `${apiBase}/api/preview/${workerId}/delete`;
      navigator.sendBeacon(url);
    }
  };

  window.addEventListener('beforeunload', cleanup);
  return () => {
    window.removeEventListener('beforeunload', cleanup);
    cleanup(); // Also fire on React unmount
  };
}, [workerId]);
```

---

## 🔄 3. Understanding Lifecycle States

Your UI should gracefully reflect the following system states:

1. 🟡 **Booting / Syncing**: Render a "Syncing changes..." overlay or spinner. Do not render the `<iframe>` yet.
2. 🟢 **Ready**: The `/__health` endpoint returns `status: "ready"`. You may now reveal the `<iframe>` pointing to the worker proxy URL.
3. 🔵 **Grace Period**: If a user accidentally closes the tab, the backend initiates a **30-second Grace Timer**. If the user returns and triggers `/start` before the timer expires, the termination is cancelled, and they are instantly reconnected to their warm pod.

---

## ⚠️ 4. Standardized Error Handling

The Orchestrator provides specific HTTP status codes. The frontend must handle them gracefully:

| HTTP Status | Condition | Required Frontend Action |
| :--- | :--- | :--- |
| **`503 Service Unavailable`** | **Cluster Capacity Reached**. The system has hit `MAX_PREVIEW_PODS`. | Display a "System at Capacity" warning. Suggest the user retry in 15-30 seconds. |
| **`502 Bad Gateway`** | **Worker Unreachable**. The pod may have crashed or was reaped by the Janitor. | **Silent Recovery**: Automatically clear the local `workerId` and re-trigger a cold start by calling `/start` again. |
| **`200 OK` (Expired)** | The Orchestrator returns `{"status": "expired"}`. | Same as 502. The session was purged from Redis. Clear state and retry. |

---

*Note: For a reference implementation of these patterns in React, consult the `usePreview.js` hook provided in the boilerplate.*
