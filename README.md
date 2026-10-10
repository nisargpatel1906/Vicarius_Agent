<div align="center">

# 🏛️ Vicarius Agent

**Autonomous Academic Operations Engine, Self-Healing LangGraph Multi-Agent Pipeline & Cognitive Heritage Dashboard**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15.2.1-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.2.0+-FF6F00)](https://langchain-ai.github.io/langgraph/)
[![Supabase RLS](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20RLS-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Security: PII--Audited](https://img.shields.io/badge/Security-PII--Audited-success.svg)](setup/check-pii.mjs)

<p align="center">
  <a href="#key-features">Key Features</a> •
  <a href="#system-architecture">Architecture</a> •
  <a href="#quick-start--self-hosting">5-Minute Quickstart</a> •
  <a href="#deliverables-supported">Deliverables</a> •
  <a href="#local-development">Local Setup</a> •
  <a href="#security--privacy-architecture">Security & RLS</a> •
  <a href="#license">License</a>
</p>

---

</div>

## 📌 Executive Summary

**Vicarius Agent** is a production-grade, open-source autonomous academic operations system built for students, researchers, and engineers. It automatically detects and ingests course deliverables, assignments, and announcements from **Google Classroom** and **Gmail**, manages task execution through an autonomous **Python LangGraph StateGraph pipeline** paired with the **Google Antigravity CLI**, and delivers verified, rubric-validated outputs directly to **Google Drive**, **Google Calendar**, and **Telegram**.

Designed from the ground up for privacy, Vicarius Agent enforces **fail-closed PostgreSQL Row-Level Security (RLS)** in Supabase, uses universal single-consent **Google OAuth 2.0**, and keeps personal identity isolated in a database profile vault so that any user can safely fork, self-host, and deploy their own instance in under 10 minutes.

---

## 🚀 Key Features

### 🔐 1. Single-Consent Universal Google OAuth & Setup Wizard
* **Zero Manual Token Renewals**: Signing in with Google once grants secure offline access to Gmail, Google Classroom, Google Drive, Calendar, and Tasks without copy-pasting tokens or running local renewal scripts.
* **First-Run Onboarding Wizard (`/setup`)**: Seamless 3-step setup to enter your academic institution, degree, and semester, run live diagnostics across all connected services, and pair your personal Telegram bot with a single `/start link_<code>` command.
* **Encrypted Token Vault**: Google OAuth refresh tokens are stored in an isolated `google_credentials` table with Row-Level Security accessible strictly by the backend service role.

### 🧠 2. Self-Healing LangGraph Multi-Agent Worker
* **Extractor Node**: Consolidates assignment briefs, lecture slide attachments, and user citation preferences into structured task states.
* **Planner Node**: Constructs deterministic step manifests and output schemas.
* **Thinker & Validator Nodes**: Executes multi-dimensional reasoning loops scored across 5 rubric vectors with dynamic quality retries.
* **Coder Node**: Synthesizes deliverables utilizing the Google Antigravity CLI (`agy`) with an autonomous fallback ReAct tool loop.
* **Verifier & LLM Judge**: Performs automated compiler verification, test suite execution, rubric judging, and anti-AI tone scrubbing.
* **Bounded Reflexion Self-Healing**: Diagnoses compilation and logic failures with up to 4 self-correcting fix attempts governed by deadline-aware budget management.
* **Deliverer Node**: Automatically uploads completed artifacts to Google Drive, schedules Calendar reminder events, and dispatches attachments to Telegram.

### 🛡️ 3. Enterprise-Grade Security & Row-Level Security (RLS)
* **100% Fail-Closed Tenant Isolation**: Every table (`profile`, `tasks`, `questions`, `deliverables`, `system_events`, `chat_messages`, `knowledge_base`) enforces `user_id = auth.uid()`.
* **Zero Cross-User Data Leaks**: Even if someone knows another user's task ID, PostgreSQL returns `[]` (empty set). Anonymous API keys have zero read or write permissions.
* **Automated PII Scanner (`npm run check:pii`)**: Built-in pre-commit scanner verifies zero personal enrollment numbers, emails, or credentials exist in the codebase.

### 🎨 4. Cognitive Heritage Operations Dashboard
* **Editorial Aesthetic**: Implements the **Cognitive Heritage** design system (warm parchment tones `#fff8f4`, deep walnut `#231a0f`, brass accents `#705728`, and **Noto Serif** typography).
* **Live Pipeline Visualizer**: Real-time task progress tracker, interactive question response dialogs for agent clarifications, and student profile editor.
* **Edge & Serverless Ready**: Next.js 15 App Router running on Vercel with cookie-based SSR sessions powered by `@supabase/ssr`.

### 📱 5. Telegram Mobile Assistant & Daily Briefing
* **Voice & Photo Ingestion**: Send voice notes (transcribed via Whisper) or photos of handwritten whiteboard problem sets (analyzed via Gemini Vision) directly to your agent.
* **Daily 08:00 AM Morning Briefing**: Automated push summary detailing urgent tasks (<12h), upcoming deadlines, and pending questions.
* **Interactive Approvals**: Reply directly to Telegram questions to guide the agent when human decisions are required.

---

## 🏗️ System Architecture

### 1. End-to-End Autonomous Workflow
From assignment release to verified delivery across Google Drive, Calendar, and Telegram:

```
┌─────────────────────────────────┐       ┌───────────────────────────────────┐
│       Ingestion Sources         │       │        Next.js 15 Web & API       │
│  • Google Classroom Coursework  │ ────> │  • Webhook & Cron Ingest Engine   │
│  • Gmail Filtered Queries       │       │  • Supabase SSR Google Auth       │
│  • Telegram Voice / Photo / Text│       │  • Operations Dashboard (Command) │
└─────────────────────────────────┘       └─────────────────┬─────────────────┘
                                                            │
                                                            ▼
┌─────────────────────────────────┐       ┌───────────────────────────────────┐
│     Delivery & Notifications    │       │     PostgreSQL + pgvector (RLS)   │
│  • Google Drive Dedicated Folder│ <───┐ │  • Row-Level Security Isolation   │
│  • Google Calendar Reminders    │     │ │  • Tasks & Deliverables Tables    │
│  • Telegram Push Alerts & Files │     │ │  • HNSW Semantic Vector Store     │
└─────────────────────────────────┘     │ └─────────────────┬─────────────────┘
                                        │                   │
                                        │                   ▼
                     ┌──────────────────┴───────────────────────────────────────┐
                     │            Python LangGraph Worker Daemon                │
                     │  Extractor ──> Planner ──> Thinker ──> Coder (AGY CLI)   │
                     │  Verifier ──> Diagnoser (Reflexion) ──> Deliverer        │
                     └──────────────────────────────────────────────────────────┘
```

Detailed architectural diagrams available in:
- [Workflow Diagram](public/workflow-diagram.svg)
- [LangGraph Agent Pipeline](public/langgraph-agent-pipeline.svg)
- [System Architecture](public/system-architecture.svg)

---

## 📦 Deliverables Supported

| Category | Output Format | Validation & Gates |
|---|---|---|
| **Software Projects** | Zip / GitHub Repo / Docker | Automated test suite execution, linter check, exit code 0 |
| **Academic Papers** | `.docx` / `.pdf` | IEEE / APA citation check, formal academic tone verification |
| **Executive Presentations**| `.pptx` | Slide typography, structural deck validation, clean rendering |
| **Jupyter Notebooks** | `.ipynb` | Zero-error kernel execution, inline visualization generation |
| **Proof & Problem Sets** | Markdown / PDF | Step-by-step mathematical reasoning, sanity validation |

---

## ⚡ Quick Start & Self-Hosting

Deploy your private academic operations agent in **~10 minutes**.

> 💡 **For full step-by-step instructions with screenshots, read [SETUP.md](SETUP.md).**

### 1. Fork & Clone
```bash
git clone https://github.com/nisargpatel1906/Vicarius_Agent.git
cd Vicarius_Agent
npm install
```

### 2. Initialize Database (1 Click)
1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your Supabase project.
3. Paste the contents of [`setup/supabase.sql`](setup/supabase.sql) and click **Run**.  
   *(This creates all tables, triggers, and Row-Level Security policies instantly).*

### 3. Google Cloud OAuth Web Client
1. Open [Google Cloud Console](https://console.cloud.google.com/) → Enable **Gmail, Classroom, Drive, Calendar, and Tasks APIs**.
2. Under **Credentials** → **Create Credentials** → **OAuth client ID** (Type: **Web application**).
3. Set **Authorized redirect URIs** to:
   ```text
   https://<YOUR-SUPABASE-PROJECT-REF>.supabase.co/auth/v1/callback
   http://localhost:3000/auth/callback
   ```
4. Copy your **Client ID** and **Client Secret**.

### 4. Enable Google in Supabase
1. In Supabase Dashboard → **Authentication** → **Providers** → **Google**.
2. Toggle to **ON**, paste your **Client ID** and **Client Secret**, and click **Save**.

### 5. Configure Local `.env` & Start
```bash
cp .env.example .env.local
```
Fill in your Supabase URL, anon key, and service role key in `.env.local`.

Run the Next.js development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click **Continue with Google**, and complete the 3-step setup wizard!

---

## 🛠️ Local Development & Python Worker

### 1. Run Next.js Dashboard
```bash
npm run dev
```

### 2. Run Local Python Build Worker
```bash
# Setup virtual environment
python -m venv .venv

# Activate environment
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

# Install worker dependencies
pip install -r worker/requirements.txt

# Start autonomous worker daemon
python -m worker.worker
```

### 3. Verify Zero PII Leaks
```bash
npm run check:pii
```

### 4. Build for Production
```bash
npm run build
```

---

## 📂 Repository Layout

```text
Vicarius_Agent/
├── public/                     # Architecture SVGs, icons, and diagrams
├── setup/                      # Self-hosting setup scripts and schemas
│   ├── check-pii.mjs           # Automated PII & credential scanner
│   └── supabase.sql            # 1-Click Supabase database schema & RLS
├── src/                        # Next.js 15 App Router Frontend & API Routes
│   ├── app/
│   │   ├── api/                # Tasks, briefing, ingest, profile, health routes
│   │   ├── auth/callback/      # OAuth callback & encrypted token vault
│   │   ├── login/              # Cognitive Heritage Google sign-in
│   │   ├── setup/              # 3-Step first-run onboarding wizard
│   │   ├── layout.tsx          # Root layout & typography
│   │   └── page.tsx            # Operations command dashboard
│   ├── components/             # Cognitive Heritage UI components
│   └── lib/                    # Supabase SSR clients, auth, and state graph
├── worker/                     # Autonomous Python LangGraph Worker
│   ├── nodes/                  # Extractor, Planner, Thinker, Coder, Verifier
│   ├── tools/                  # Antigravity CLI, ReAct tools, Drive, Telegram
│   └── worker.py               # Task polling daemon and execution supervisor
├── .env.example                # Clean template for environment variables
├── LICENSE                     # MIT Open-Source License
├── README.md                   # Repository overview and documentation
├── SETUP.md                    # Detailed 10-minute self-hosting guide
└── vercel.json                 # Vercel deployment & cron configuration
```

---

## 🔒 Security & Privacy Architecture

* **Database Isolation**: Fail-closed PostgreSQL Row-Level Security on all tables.
* **Credential Vault**: Refresh tokens stored in `google_credentials` with zero public client access.
* **Edge Guard**: Middleware verified against Supabase Auth sessions on every dashboard navigation.
* **Attribution & Privacy**: All personal student identifiers, enrollment numbers, and institutional affiliations are decoupled from code and stored strictly within the user's private database profile.

---

## 👤 Author & Attribution

Architected and built with pride by **Nisarg Patel**  
GitHub: [@nisargpatel1906](https://github.com/nisargpatel1906)

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
