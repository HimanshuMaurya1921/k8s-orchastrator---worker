# 🧠 The AI Studio Preview System: How It Works

This document explains the architecture of the AI Studio Preview System. It is written in simple English so that non-technical stakeholders (like Product Managers) can understand the "why" and "what", while containing enough technical depth for onboarding engineers to grasp the data flow.

---

## 1. The Big Picture (The Value Proposition)

Imagine trying to build a brand new house every time a customer asks for a design tweak. Normally, building a house from scratch takes minutes: you have to buy materials (download internet dependencies), pour the foundation, and wait for it to dry. In the cloud world, making a user wait 2 minutes to preview a website is a terrible user experience.

Our system acts like a magical factory that keeps fully-built, empty houses on standby. When a user asks our AI for a website, we instantly "teleport" their custom furniture (the code) into one of these empty houses and turn on the lights. If they want to change the design, we instantly swap the furniture without having to rebuild the house.

**The Business Value:** This gives the user an instant, live preview of their AI-generated website in seconds instead of minutes. It saves massive amounts of cloud costs (because we recycle the environments) and provides a snappy, magical user experience.

---

## 2. The Core Components (The Factory Floor)

The system is separated into four distinct parts:

1. **The Frontend (The Client):** The React website the user interacts with. It shows the AI chat/code and has a live preview window (an iframe) to see the result.
2. **The Backend (The Brains):** The AI engine that generates the raw code files based on user prompts.
3. **The Orchestrator (The Traffic Cop):** A cluster of lightweight, stateless servers that manage the traffic. They talk to our cloud provider (Kubernetes) to assign an isolated "Sandbox" for the user, and securely route the user's browser to that exact sandbox using a centralized memory database (Redis).
4. **The Preview Worker (The Sandbox):** An isolated, temporary mini-computer (Kubernetes Pod). It runs the actual Next.js server, receives the injected code, and serves the website.

---

## 3. The Step-by-Step Flow

Here is exactly what happens when a user clicks "Generate".

### Phase A: The Request
1. **User Action:** The user clicks "Generate" on the Frontend.
2. **Code Generation:** The Frontend asks the Backend for the code. The Backend returns a JSON object containing all the files (e.g., `page.js`, `layout.js`).
3. **Session Request:** The Frontend sends this JSON payload to the **Orchestrator** (via `POST /api/preview/start`), essentially asking: *"Please find a place to run this code."*

### Phase B: Provisioning the Sandbox
4. **Checking for "Warm" Pods:** The Orchestrator checks the central Redis database to see: *"Does this user already have a running sandbox?"*
    - **If YES (Warm Start):** We reuse the existing pod. This skips the boot process entirely and is blazingly fast.
    - **If NO (Cold Start):** The Orchestrator commands the Kubernetes API to create a brand new Pod.
5. **The Secret Handshake:** The Orchestrator shares a secure password (`AUTH_TOKEN`) with the new Pod. This ensures that nobody on the internet can inject malicious code into the pod directly—they MUST go through the Orchestrator.

### Phase C: Making the Sandbox Blazingly Fast
If we just booted a standard Next.js app, it would take a long time. Here is how we cheat physics to make it instant:

6. **The Symlink Trick:** A standard Next.js app needs to run `npm install` to download dependencies, taking 1-2 minutes. Instead, our Docker image already has `node_modules` pre-installed inside a hidden template folder. The worker creates a "Symlink" (a shortcut) from the active workspace directly to this template. **Time taken: 1 millisecond.**

7. **RAM-Disk (Memory Storage):** The worker writes the user's code files directly into a Kubernetes `emptyDir` backed by RAM (`Medium: Memory`). Because it's writing to physical memory instead of a hard drive, reading and writing files happens at the speed of light.

### Phase D: Injecting and Running the Code
8. **Lazy Initialization:** The new Sandbox pod doesn't start Next.js immediately. It waits for the Orchestrator to inject the code files to prevent CPU spikes.
9. **Next.js Boot:** Once the code is injected, the Worker starts the `next dev` background process. 
10. **Smart Polling (The 90-Second Window):** The Frontend doesn't blindly load the iframe and show an ugly error while Next.js is booting. Instead, it constantly pings the worker's `/__health` endpoint. It shows a beautiful "Syncing..." spinner to the user until Next.js signals it is ready.
11. **Live Preview:** The Frontend's iframe loads the final URL, and the user sees their website!

---

## 4. Hot Module Replacement (HMR) & Live Updates

When a user asks the AI to change a button from Blue to Red, we do not want to restart the whole server.

- The Frontend sends *just* the updated files to the Orchestrator.
- The Worker overwrites the files in the memory disk.
- Next.js detects the file change and uses **WebSockets (HMR)** to instantly update the user's iframe without a page refresh! 
- *Optimization Note:* The Orchestrator uses a robust proxy that maintains these WebSocket connections seamlessly.

---

## 5. Cleanup & Security (The Distributed Janitor)

Cloud computing costs money. We cannot keep Sandbox Pods running forever if the user closes their laptop. We also cannot let AI-generated code hack our network.

1. **No Outbound Traffic (Security):** The Pods are locked in a Kubernetes `NetworkPolicy`. They cannot access the open internet, ensuring malicious code cannot "break out."
2. **The 30-Second Grace Period:** When a user closes their tab, we don't kill their sandbox immediately. Instead, we start a **30-second countdown**. If they accidentally closed the tab or their browser crashed, they can simply reopen it within 30 seconds and find their session exactly where they left it. 
3. **The Distributed Lock:** Because we run multiple Orchestrators, we use a Redis distributed lock (`NX`) to ensure that only one Orchestrator acts as the "Janitor" at a time, preventing them from fighting over which pods to delete.
4. **The 30-Minute Safety TTL:** Even if the Orchestrator fails, Kubernetes itself will aggressively delete any preview pod older than 30 minutes via a background CronJob, keeping the cluster perpetually clean.
