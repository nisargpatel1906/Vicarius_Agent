# Vicarius Agent 🏛️

> **Autonomous Academic Intelligence Pipeline & Quiet Luxury Operations Command**  
> *Engineered for Nisarg Patel — Academic Institution*

[![Vercel Deployment](https://img.shields.io/badge/Deployment-Live%20on%20Vercel-success?style=for-the-badge&logo=vercel)](https://your-domain.vercel.app/)
[![Framework](https://img.shields.io/badge/Framework-Next.js%2015%20%7C%20LangGraph-blue?style=for-the-badge&logo=nextdotjs)](https://nextjs.org/)
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Design System](https://img.shields.io/badge/Design-Cognitive%20Heritage-705728?style=for-the-badge)](./docx/DESIGN.md)

---

## 🌟 Executive Overview

**Vicarius Agent** is an end-to-end autonomous academic intelligence system. It continuously ingests coursework, assignments, and announcements from Google Classroom and Gmail, structures deliverables through a multi-model LangGraph agent pipeline, generates complete codebases and publication-grade reports (`Report.docx`, `Report.pdf`, `Deck.pptx`), and delivers deliverables directly to Google Drive and Telegram with zero manual friction.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph INTAKE["1. Autonomous Ingestion Layer"]
        GC[Google Classroom API] -->|Webhooks / Cron| ING[/api/ingest & Pub/Sub]
        GM[Gmail API] -->|Coursework Scanner| ING
        ING -->|Extract Requirements & Attachments| SUPA[(Supabase PostgreSQL)]
    end

    subgraph WORKER["2. Autonomous Worker Pipeline (LangGraph)"]
        SUPA -->|Claim Task| PLAN[Planner Node]
        PLAN -->|Inspect Profile & Directives| DB_PROF[(Student Profile Vault)]
        PLAN -->|Structured Build Spec| CODE[Coder Node]
        CODE -->|Multi-Model Synthesis| BUILD[Code, Docs & PPTX Generation]
        BUILD -->|AST & Smoke Tests| VERIF[Verifier Node]
        VERIF -->|Pass| DELIV[Deliverer Node]
        VERIF -->|Fail (Attempts < 4)| DIAG[Diagnoser & Self-Healing Node]
        DIAG -->|Targeted Patch| CODE
    end

    subgraph CHANNELS["3. Delivery & Operations Command"]
        DELIV -->|Upload Deliverables| GDRIVE[Google Drive Folder]
        DELIV -->|Notification & Links| TG[Telegram Bot & Instant Actions]
        SUPA -->|Real-Time State| DASH[Cognitive Heritage Dashboard]
        DASH -->|Live Profile Editor| DB_PROF
    end
```

---

## ✨ Core Capabilities

### 1. 🏛️ Cognitive Heritage Design System
- Custom high-elegance academic aesthetic built on parchment tones (`#FFF8F4`, `#FDEBD9`), deep warm brass accents (`#705728`), Noto Serif headings, and Manrope controls.
- Integrated stationary modals, live IST clocks, and executive briefing synthesis strips.

### 2. 🗄️ In-Dashboard Profile & Intelligence Vault
- Persistent Supabase profile registry (`public.profile` and `public.user_info`).
- In-dashboard live editor for academic standing, citation standards, technical skills, writing voice samples, and arbitrary key-value custom attributes.
- Autonomous agent planners and coders dynamically calibrate tone, depth, and metadata based on this database.

### 3. 🤖 Triple-Core LangGraph Agent Pipeline
- **Planner Node**: Breaks assignments into structured file manifests and execution steps.
- **Coder Node**: Synthesizes production codebases, IEEE/APA-compliant reports, and slide decks.
- **Verifier & Diagnoser Node**: Runs headless smoke tests, AST lint checks, and 4-attempt bounded self-correction loops.
- **Deliverer Node**: Packages deliverables, generates Google Drive folders, and notifies via Telegram.

### 4. 📱 Telegram Operations Center
- Direct interactive task notifications with one-tap Google Drive links.
- Natural language query tools for Google Classroom and Gmail coursework.
- Remote question clarification and manual retry controls.

---

## 📂 Repository Structure

```
Vicarius_Agent/
├── src/                          # Next.js 15 Full-Stack Web Application
│   ├── app/                      # App router (API routes & Dashboard UI)
│   │   ├── api/profile/          # Dynamic Student Profile Vault API
│   │   ├── api/tasks/            # Academic task ledger API
│   │   ├── api/telegram/         # Webhook handler with async execution
│   │   └── page.tsx              # Operations Command & View Switcher
│   ├── components/               # Cognitive Heritage UI components
│   │   ├── ProfileEditor.tsx     # Student Profile & Vault Editor
│   │   └── Icons.tsx             # Curated SVG iconography
│   └── lib/                      # Supabase, Google Auth, and Telegram utilities
├── worker/                       # Python LangGraph Autonomous Agent Worker
│   ├── graph.py                  # LangGraph state machine definition
│   ├── worker.py                 # Continuous polling daemon
│   ├── nodes/                    # Planner, Coder, Verifier, Deliverer nodes
│   └── tools/                    # Document generators (DOCX, PPTX, Drive, Telegram)
├── docx/                         # Project Specifications, PRDs & Design System
│   ├── DESIGN.md                 # Mandatory UI Design System specification
│   ├── PRD_academic_task_agent.md# System requirements & operational specs
│   └── ...                       # Technical documentation and test plans
└── tests/                        # Comprehensive test suites & golden evaluations
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v20+
- **Python**: v3.10+
- **Supabase Account**: With PostgreSQL tables initialized
- **Google Cloud Console**: OAuth 2.0 Client credentials with Classroom, Gmail, and Drive APIs enabled

### 1. Environment Setup
Clone the repository and copy the example environment file:
```bash
cp .env.example .env.local
```
Fill in your Supabase credentials, LLM API keys (Gemini, OpenRouter, Groq), and Telegram bot tokens.

### 2. Frontend Development Server
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the Operations Command Dashboard.

### 3. Background Worker Daemon
```bash
python -m pip install -r worker/requirements.txt
python -m worker.worker --daemon
```

---

## 🌐 Live Production

- **Dashboard**: [https://your-domain.vercel.app](https://your-domain.vercel.app)
- **Deployment Platform**: Vercel (Edge & Serverless Node.js runtime)
- **Database**: Supabase PostgreSQL (Stockholm / eu-north-1)
