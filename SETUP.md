# Self-Hosting Guide: Vicarius Agent

Deploy your own private, autonomous academic intelligence agent in about **10 minutes**.

---

## Architecture Overview

```
Google Classroom / Gmail  ──>  Next.js 15 App (Vercel)  <──>  Supabase PostgreSQL (RLS)
                                       │                              │
                                       ▼                              ▼
                              Telegram Mobile Alerts       Python LangGraph Worker (Local)
```

- **Frontend & Cloud APIs**: Hosted on Vercel (free tier).
- **Database & Auth**: Hosted on Supabase (free tier) with fail-closed Row-Level Security.
- **Worker Daemon**: Runs locally on your workstation for hardware acceleration and file creation.

---

## Step 1: Fork the Repository

1. Click **Fork** on GitHub to create your own copy of `Vicarius_Agent`.
2. Keep the repository private if you plan to commit custom institutional scripts, or public if you use environment variables for all secrets.

---

## Step 2: Initialize Supabase Database

1. Create a free project at [supabase.com](https://supabase.com/).
2. Open the **SQL Editor** in your Supabase project dashboard.
3. Open [`setup/supabase.sql`](setup/supabase.sql) from this repository, copy the entire contents, paste it into the SQL Editor, and click **Run**.
4. This creates all necessary tables (`profile`, `tasks`, `deliverables`, `google_credentials`), sets up Row-Level Security (RLS) policies, and creates automatic auth triggers.

---

## Step 3: Google Cloud OAuth 2.0 Credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `Vicarius Agent`).
3. Under **APIs & Services → Library**, enable:
   - **Google Classroom API**
   - **Gmail API**
   - **Google Drive API**
   - **Google Calendar API**
   - **Google Tasks API**
4. Under **OAuth consent screen**:
   - Choose **External** (or Internal if using Google Workspace for Education).
   - Enter your App name and contact email.
   - Under **Scopes**, add:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/classroom.courses.readonly`
     - `https://www.googleapis.com/auth/classroom.coursework.me`
     - `https://www.googleapis.com/auth/classroom.announcements.readonly`
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/tasks`
     - `https://www.googleapis.com/auth/calendar.events`
   - Under **Test users**, add your own Google email address.
5. Under **Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `Vicarius Web Client`.
   - **Authorized redirect URIs**: Add your Supabase Auth callback URI:
     ```
     https://<YOUR-SUPABASE-PROJECT-REF>.supabase.co/auth/v1/callback
     ```
   - Click **Create** and save your **Client ID** and **Client Secret**.

---

## Step 4: Configure Google Provider in Supabase

1. In your Supabase Dashboard, navigate to **Authentication → Providers → Google**.
2. Toggle **Enable Google provider** to ON.
3. Paste the **Client ID** and **Client Secret** obtained from Google Cloud.
4. Click **Save**.

---

## Step 5: Deploy to Vercel

1. Import your forked repository in [Vercel](https://vercel.com/new).
2. Configure the following Environment Variables in the Vercel project settings:

| Variable | Description | Where to find |
|---|---|---|
| `ALLOWED_EMAILS` | Comma-separated list of allowed Google emails | Your email address |
| `OWNER_EMAIL` | Primary owner email address | Your email address |
| `NEXT_PUBLIC_SITE_URL` | Your Vercel production deployment URL | `https://your-project.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key | Supabase → Settings → API |
| `SUPABASE_URL` | Supabase Project URL | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase `service_role` Key | Supabase → Settings → API (Keep Secret!) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth Client ID | Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth Client Secret | Google Cloud Console |
| `GROQ_API_KEY` | Groq API Key (Fast Llama 3.3) | [console.groq.com](https://console.groq.com) |
| `GEMINI_API_KEY` | Google AI Studio Key | [aistudio.google.com](https://aistudio.google.com) |
| `OPENROUTER_API_KEY` | OpenRouter Fallback Key | [openrouter.ai](https://openrouter.ai) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token (Optional) | Create bot via [@BotFather](https://t.me/BotFather) |
| `CRON_SECRET` | Random 32-char secret for cron security | Generate random hex string |

3. Click **Deploy**.

---

## Step 6: Log In & Complete Setup Wizard

1. Open your deployed URL (`https://your-project.vercel.app`).
2. Click **Continue with Google** and sign in with your allow-listed account.
3. Grant the requested Google Workspace permissions on the consent screen.
4. The system automatically captures and encrypts your offline refresh token in Supabase.
5. You will be redirected to the **Setup Wizard** (`/setup`):
   - **Step 1**: Enter your academic details (institution, degree, semester, preferred citation format).
   - **Step 2**: Check connection statuses across database, Google, and LLM providers.
   - **Step 3**: Send `/start link_<code>` to your Telegram bot to link mobile alerts.
6. Click **Complete Setup** to launch your operations dashboard!

---

## Step 7 (Optional): Run the Local Build Worker

For heavy tasks requiring local execution, hardware-accelerated model training, and file synthesis:

1. Clone your repository locally.
2. Create `.env` from `.env.example` and paste your credentials.
3. Install Python dependencies:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate      # Windows
   pip install -r worker/requirements.txt
   ```
4. Start the worker daemon:
   ```bash
   python -m worker.worker
   ```
   The worker will continuously poll for tasks claimed in Supabase, execute builds with the LangGraph agent, and deliver completed files to Google Drive and Telegram.

---

## Security Best Practices

- **Never share your `SUPABASE_SERVICE_KEY`**: It bypasses Row-Level Security and must only live on Vercel and your local worker.
- **Run the PII Scanner**:
  ```bash
  npm run check:pii
  ```
  Ensures no credentials or personal identity leak before git commits.
