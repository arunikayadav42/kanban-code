# 🗂️ Agentic Kanban
**Built for builders who need their agents to work as hard as they do.**

**The Multi-Platform, Self-Hosted Orchestration Layer for Autonomous AI Agents.**

> **"You shouldn't stay at your desk 24/7. Your AI agents should."**

Coding agents are most powerful when they can run for hours or days on complex tasks. But life happens—you close your laptop, you leave your office, you lose your SSH connection. **Agentic Kanban** ensures your agents never stop. 

By decoupling agent execution from your local machine and moving it to your persistent, self-hosted server, you gain total mobility:
*   **Start a task on your server** from your laptop or phone before you step away.
*   **Monitor real-time progress on both devices**—whether you're at your desk or on the move.
*   **Intervene or provide feedback from any browser** if the agent needs guidance.

Your agents live on your private server, but they are always at your fingertips—across your laptop, your phone, and your remote infrastructure.

---

## 🛠️ The Problems We Solve

### 1. Account Suspensions & ToS Violations
Using official AI tools (like Claude Code or Gemini CLI) through shared routing proxies, "dirty" datacenter IPs, or unofficial third-party SaaS wrappers is a high-risk activity that often leads to API or user account **bans**. Agentic Kanban runs the *official* CLIs natively on **your private hardware**, maintaining your legitimate residential or verified corporate IP footprint. Combined with Cloudflare Tunnels, you get secure remote access without the "proxy" signature that triggers automated security flags.

### 2. The "Feature Lag" & Tool Lock-in Problem
Most AI dashboards are proprietary wrappers that lag weeks or months behind the official tools. Because our **Bring Your Own Assistant (BYOA)** architecture wraps the *official* CLI tools directly, you get **Day 0 access** to every new feature, model, or capability launched by providers. If it works in the CLI, it works in Agentic Kanban instantly.

### 3. Context Fragmentation (The "10 Tab" Problem)
Developers often struggle to keep track of which agent is running on which branch, which PR it's working on, and what the latest terminal output was. Agentic Kanban creates a **Single Source of Truth (SSOT)**:
*   **One Card = One Task.**
*   Automatically links the **CLI Session**, the **Git Worktree**, the **GitHub PR**, and the **Issue**.
*   No more jumping between 10 tabs to understand the state of a single task.

### 4. Linear Tooling & Dead-End Rabbit Holes
Standard CLI tools are linear—if an agent makes a critical mistake 2 hours into a session, you often have to start over. Agentic Kanban introduces **Non-Linear Workflows**:
*   **Fork:** Spin off a new session from any point in the history to try a different approach.
*   **Resume:** Pause a session on your desktop and resume it on your server (or vice versa) without losing a single line of context.

### 5. Lack of Visibility & "Silent" Failures
Agents often get "stuck" in loops or wait for user input silently. Our **Background Reconciler** and **SSE State Push** system provide a real-time "pulse" of every agent. You see exactly when an agent needs attention, is actively working, or has crashed—even when you're on your phone.

---

## ✨ Key Features

### 🚀 "Fire-and-Forget" Persistence (Tmux-Powered)
Every session is spawned in a managed **tmux** instance. This ensures that even if the web server restarts or your browser closes, the agent continues its work uninterrupted.

### 🔀 Advanced Session Control: Fork & Resume
Stop fighting your tools. Use **Fork** to experiment with multiple architectural paths in parallel, and **Resume** to pick up long-running tasks across different devices.

### 🔌 Universal Plugin System (BYOA)
Turn any CLI tool (Google Gemini CLI, Claude Code, Aider, etc.) into a managed, stateful agent.
*   **CLI-to-Agent Transformation:** We wrap raw commands in a controlled environment with PTY plumbing.
*   **Stateful Memory:** Capture every line of output and lifecycle event into a searchable, persistent history.

**Interested in adding your own tool?** Check out our [BYOA Integration Specification](web/docs/BYOA_INTEGRATION_SPEC.md).

### 🔍 BM25 Full-Text Search
Fast, indexed search across your entire history of agent conversations and terminal logs. Find that one specific command or explanation from a session three weeks ago in milliseconds.

### 📱 Native Mobile App & Cloudflare Tunnels
A first-class Android experience. Connect your Backend, Web, and Mobile components via **Cloudflare Tunnels** for secure, zero-config remote access from anywhere in the world.

### ⚡ Roadmap: Frontend MCP Access
We are bringing **Model Context Protocol (MCP)** to the frontend. A lightweight "Edge Agent" will securely orchestrate and spawn heavy models on high-compute hardware, acting as a secure gateway for your local filesystem.

---

## 🏗️ Technical Stack

*   **Backend:** Node.js / Express (Clean Architecture / Ports & Adapters)
*   **Frontend:** React + Vite + Tailwind CSS (Zustand State Management)
*   **Mobile:** React Native + Expo (Android Optimized)
*   **Terminal:** xterm.js (Real-time tmux plumbing via WebSockets)
*   **Database:** better-sqlite3 (Local persistence & lightning-fast search)
*   **Connectivity:** Cloudflare Tunnels (Secure ingress)

---

## 📂 Repository Structure

```text
├── web/
│   ├── server/      # Node.js backend (The Brain)
│   ├── client/      # React web interface (The Dashboard)
│   └── shared/      # Common TypeScript types & logic
├── mobile/          # React Native app (Remote Monitoring)
├── deploy-ubuntu.sh # One-click deployment script
└── setup.sh         # Local environment bootstrapper
```

---

## 🛠️ Getting Started

### 📋 Prerequisites
Ensure you have the following installed on your host machine:
*   **Node.js (v20+):** The backend and frontend both run on modern Node environments.
*   **tmux:** Required for persistent session management.
*   **GitHub CLI (`gh`):** Used for PR and Issue integration.
*   **Cloudflare `cloudflared`:** (Optional) If you plan on setting up secure remote access via tunnels.

### 💻 Local Development
If you want to run Agentic Kanban on your local machine:
1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/mayankwadhwani/agentic-kanban.git
    cd agentic-kanban
    ```
2.  **Bootstrap the Environment:**
    ```bash
    ./setup.sh
    ```
    This script will install all dependencies for the shared, server, and client packages.
3.  **Start Concurrently:**
    ```bash
    npm run dev
    ```
    This will launch the **Backend (Port 3000)** and the **Frontend (Port 5173)** in parallel. Open your browser to `http://localhost:5173`.

### ☁️ Self-Hosting (Ubuntu / Remote Cloud)
For production-grade hosting, we recommend an Ubuntu-based VPS. We provide an automated deployment script that handles the entire lifecycle via **PM2**.

**Using the Deployment Script:**
The `deploy-ubuntu.sh` script is designed to be run from your local machine. It syncs your code, builds it remotely, and restarts the services.

*   **Option 1: Direct Command (Fastest)**
    ```bash
    ./deploy-ubuntu.sh "ssh ubuntu@your-server-ip -i path/to/your-key.key"
    ```
*   **Option 2: Interactive Mode**
    Simply run the script and paste your SSH command when prompted:
    ```bash
    ./deploy-ubuntu.sh
    ```

**What the script does for you:**
*   **Syncs Source:** Uses `rsync` to push only necessary files (ignores `node_modules`).
*   **Port Cleanup:** Kills any existing processes on ports 5172, 5173, and 3000 to ensure a clean start.
*   **Remote Build:** Runs `npm install` and `npm run build` on the server for shared, server, and client.
*   **PM2 Management:** Deletes existing processes and starts `kanban-backend` and `kanban-frontend` fresh.

---

## 📱 Mobile Installation (Android)

The Agentic Kanban mobile app is optimized for Android and can be installed via a direct APK or built using Expo Application Services (EAS).

### 🛠️ Local APK Build (No Expo Account Needed)
If you want to build and install the app manually on your device:
1.  **Navigate** to the mobile directory: `cd mobile`
2.  **Install dependencies**: `npm install`
3.  **Prebuild** the Android project: `npx expo prebuild --platform android`
4.  **Generate Release APK**:
    ```bash
    cd android && ./gradlew assembleRelease
    ```
5.  **Locate APK**: The file will be at `mobile/android/app/build/outputs/apk/release/app-release.apk`.
6.  **Install**: Transfer this file to your Android device and tap to install.

### 🚀 EAS Build (Cloud Distribution)
For signed builds or over-the-air (OTA) updates:
1.  **Install EAS CLI**: `npm install -g eas-cli`
2.  **Login**: `eas login`
3.  **Build Preview APK**:
    ```bash
    eas build --platform android --profile preview
    ```
4.  **Install**: Download the resulting APK from the Expo dashboard link provided in your terminal.

### 🔗 Connecting to Backend
Once installed, open the app and enter your backend URL (e.g., `http://172.30.25.100:5172` or your Cloudflare Tunnel address).

### 🔄 Update Flow
*   **Updating the Backend:**
    ```bash
    git pull
    ./deploy-ubuntu.sh
    ```
*   **Updating the Mobile App:**
    - For release APK updates: Rebuild the APK using the steps above and install it over the old one.
    - With EAS Update (Over-the-Air):
      ```bash
      eas update --branch production --message "Fix terminal scroll"
      ```
      Users will get the update automatically the next time they open the app.

---

## 📄 License
This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
