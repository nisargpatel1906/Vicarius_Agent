# Vicarius Agent

> Autonomous Academic Task Ingestion, LangGraph Multi-Agent Execution Pipeline, and Cognitive Heritage Operations Command.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15.2.1-black)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.2.0+-orange)](https://langchain-ai.github.io/langgraph/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20RLS-emerald)](https://supabase.com/)

---

## Overview

**Vicarius Agent** is an open-source autonomous academic operations engine designed for engineering and computing students. It automatically monitors and ingests assignments, coursework materials, and announcements from Google Classroom and Gmail, stores and tracks them with strict Row-Level Security in Supabase PostgreSQL, and executes deliverables using a multi-node Python LangGraph agent pipeline paired with Google Antigravity CLI.

Completed deliverables—including functional software projects, Jupyter notebooks, IEEE/APA-formatted research papers, mathematical proofs, and presentation decks—are verified through automated compilation, test execution, and rubric judging before being uploaded to Google Drive, synced to Google Calendar, and dispatched via Telegram.

---

## Features

- **Single-Consent Universal Setup**:
  - One-click "Continue with Google" sign-in grants access to Gmail, Google Classroom, Google Drive, Calendar, and Tasks without manual token copy-pasting.
  - Automatic token capture and encrypted storage in Supabase `google_credentials` vault.
- **Strict Row-Level Security (RLS)**:
  - Fail-closed database isolation ensuring only the authenticated workspace owner can read or write their tasks, deliverables, questions, and academic records.
  - Anonymous public key has zero read/write access.
- **Automated Multi-Source Ingestion**:
  - Continuous ingestion from Google Classroom (coursework, announcements, attachments) and Gmail (filtered academic queries) via scheduled crons.
  - Ingestion deduplication using composite unique constraints `(source, external_id)`.
- **Multimodal Requirement Extraction**:
  - Parses PDFs, Word documents (`.docx`), and scanned assignment images using Gemini 2.0 Flash vision and text extraction.
  - Semantic chunking and vector embedding storage in Supabase `knowledge_base` with HNSW cosine similarity search.
- **Self-Reflective LangGraph Worker Pipeline**:
  - **Extractor Node**: Consolidates assignment files, attachments, and student profile preferences.
  - **Planner Node**: Constructs structured execution plans and output file manifests.
  - **Thinker & Validator Nodes**: Formulates reasoning traces scored across 5 quality dimensions with a quality-retry loop.
  - **Coder Node**: Primary execution via Antigravity CLI (`agy`) with a secondary autonomous ReAct tool loop.
  - **Verifier Node**: Subprocess execution checking exit codes, deliverable schema validation, anti-AI tone filtering, and LLM Judge scoring.
  - **Diagnoser Node**: Bounded Reflexion self-healing (up to 4 attempts) with deadline-budget awareness.
  - **Deliverer Node**: Uploads to Google Drive, schedules Calendar reminder events, and dispatches files to Telegram.
- **Interactive Operations Command Dashboard**:
  - Built with Next.js 15 App Router following the **Cognitive Heritage** design system (parchment surfaces `#fff8f4`, warm brass `#705728`, Noto Serif typography).
  - Live task status tracker, pipeline execution node visualizer, interactive profile vault, and landmark map canvas.
- **Telegram Mobile Command Center**:
  - Connect your personal Telegram bot with a single `/start link_<code>` command during setup.
  - Voice message transcription via Whisper and assignment photo OCR via Gemini Vision.
  - Daily Morning Briefing at 08:00 IST detailing stuck tasks, imminent deadlines (<12h), and upcoming submissions.

---

## System Architecture

### 1. End-to-End Autonomous Workflow
The master workflow diagram maps the end-to-end journey of an academic task: ingestion from Classroom, Gmail, or Telegram, through the self-healing LangGraph worker, to verified egress in Google Drive, Calendar, and Telegram.

![Vicarius Agent End-to-End Autonomous Workflow](public/workflow-diagram.svg)

### 2. LangGraph Worker StateGraph Topology
A deep-dive into the deterministic StateGraph execution pipeline, showcasing the thinker validation scoring loop, dual-mode Coder (Antigravity CLI + ReAct fallback), 3-tier Verifier gate, and bounded Reflexion self-healing loop.

![LangGraph Multi-Agent StateGraph Pipeline](public/langgraph-agent-pipeline.svg)

### 3. Hybrid Cloud & Workstation Infrastructure
The complete physical and serverless infrastructure topology: Next.js 15 App Router on Vercel Edge, Supabase PostgreSQL with `pgvector` HNSW index, Google Workspace APIs, and the dedicated hardware-accelerated local workstation daemon.

![Hybrid Cloud & Dedicated Local Workstation Architecture](public/system-architecture.svg)

---

## Quick Start & Self-Hosting

Ready to deploy your own instance of Vicarius Agent?

👉 **Follow the complete 10-minute setup guide in [SETUP.md](SETUP.md).**

1. **Fork the repository** on GitHub.
2. **Deploy to Vercel** using the Deploy button or Vercel CLI.
3. **Initialize Supabase**: Run [`setup/supabase.sql`](setup/supabase.sql) in your Supabase SQL Editor.
4. **Configure Google OAuth**: Enable Google provider in Supabase Auth and add the callback URL to Google Cloud Console.
5. **Set Environment Variables**: Set `ALLOWED_EMAILS`, `OWNER_EMAIL`, `SUPABASE_SERVICE_KEY`, and LLM keys in Vercel.
6. **Launch & Setup**: Open your deployed site, sign in with Google, and complete the 3-step setup wizard!

---

## Local Development

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/nisargpatel1906/Vicarius_Agent.git
cd Vicarius_Agent
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env.local
cp .env.example .env
```
Fill in your Supabase URL, anon key, service key, and LLM keys.

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Run Python Build Worker (Optional)
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r worker/requirements.txt
python -m worker.worker
```

### 5. Audit Security & PII
```bash
npm run check:pii
```

---

## Project Structure

```
Vicarius_Agent/
├── public/                     # Architecture SVGs, icons, and static assets
├── setup/                      # Self-hosting setup scripts and schemas
│   ├── check-pii.mjs           # Automated PII & credential scanner
│   └── supabase.sql            # Single-step Supabase database schema
├── src/                        # Next.js 15 App Router Frontend & API Routes
│   ├── app/
│   │   ├── api/                # Edge and serverless route handlers
│   │   ├── auth/callback/      # OAuth callback & credential vault
│   │   ├── login/              # Cognitive Heritage Google sign-in
│   │   ├── setup/              # First-run onboarding wizard
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Operations command dashboard
│   ├── components/             # Cognitive Heritage UI components
│   └── lib/                    # Supabase SSR clients, auth, and logic
├── worker/                     # Autonomous Python LangGraph Worker
│   ├── nodes/                  # Extractor, Planner, Thinker, Coder, Verifier
│   ├── tools/                  # Antigravity CLI, ReAct tools, Drive, Telegram
│   └── worker.py               # Polling daemon and task execution supervisor
├── .env.example                # Clean template for environment variables
├── SETUP.md                    # Step-by-step self-hosting documentation
└── vercel.json                 # Vercel deployment & cron configuration
```

---

## Author & Attribution

Built with pride by **Nisarg Patel**  
GitHub: [@nisargpatel1906](https://github.com/nisargpatel1906)

---

## License

This project is licensed under the [MIT License](LICENSE).
