#!/usr/bin/env python3
"""
Vicarius Agent — ask_human Two-Way Loop Server & Tool
Provides a local HTTP server and CLI/Python tool for agents (Antigravity CLI or Python workers)
to pause execution, send an interactive question to the student via Telegram,
poll for an answer, and resume with the student's answer or timeout fallback.
Sourced from PRD Section 6.3, IMPLEMENT.md (A1, C4).
"""

import os
import sys
import time
import json
import threading
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

# Ensure parent directory is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_WORKER_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_ALLOWED_CHAT_ID = os.getenv("TELEGRAM_ALLOWED_CHAT_ID")
DEFAULT_TIMEOUT_MINUTES = int(os.getenv("QUESTION_WAIT_TIMEOUT_MINUTES", "5"))
SERVER_PORT = int(os.getenv("ASK_HUMAN_PORT", "8765"))

_sb_client = None

def get_supabase():
    global _sb_client
    if _sb_client is None:
        from supabase import create_client
        _sb_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _sb_client

def send_telegram_message(text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_ALLOWED_CHAT_ID:
        return False
    try:
        import requests
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        resp = requests.post(url, json={
            "chat_id": TELEGRAM_ALLOWED_CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        print(f"[ask_human] Telegram send error: {e}", file=sys.stderr)
        return False

def ask_human(task_id: str, question_text: str, timeout_minutes: int = DEFAULT_TIMEOUT_MINUTES) -> dict:
    """
    Executes the ask_human flow:
    1. Inserts a pending question row in Supabase
    2. Sends an interactive Telegram alert to the student
    3. Polls Supabase every 5s until answered or timeout
    4. Returns {"status": "answered", "answer": ...} or {"status": "timed_out", "answer": ...}
    """
    sb = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    import uuid
    # Validate UUID format for Postgres UUID column
    try:
        uuid.UUID(str(task_id))
    except (ValueError, AttributeError):
        try:
            existing_task = sb.table("tasks").select("id, title").limit(1).execute()
            if existing_task.data and len(existing_task.data) > 0:
                task_id = existing_task.data[0]["id"]
                task_title = existing_task.data[0].get("title", task_title)
            else:
                task_id = str(uuid.uuid4())
        except Exception:
            task_id = str(uuid.uuid4())

    # Get task title for context
    task_title = "Academic Task"
    try:
        res = sb.table("tasks").select("title, course").eq("id", task_id).maybe_single().execute()
        if res.data:
            task_title = res.data.get("title", task_title)
    except Exception:
        pass

    # 1. Insert row in questions table
    q_data = {
        "task_id": task_id,
        "question_text": question_text,
        "status": "pending",
        "asked_at": now_iso,
    }
    insert_res = sb.table("questions").insert(q_data).execute()
    question_id = insert_res.data[0]["id"] if insert_res.data else None
    print(f"[ask_human] Inserted question {question_id} for task {task_id}")

    # 2. Dispatch Telegram alert
    tg_text = (
        f"❓ <b>Question / Review Required ({timeout_minutes}-Min Window):</b>\n"
        f"<b>{task_title}</b>\n\n"
        f"<i>\"{question_text}\"</i>\n\n"
        f"👉 <b>Reply directly to this message</b> within {timeout_minutes} minutes. "
        f"If no reply is received, the agent will automatically proceed with best-effort completion and deliver."
    )
    send_telegram_message(tg_text)

    # 3. Poll for answer
    deadline = time.time() + (timeout_minutes * 60)
    print(f"[ask_human] Waiting up to {timeout_minutes}m for student answer...")

    while time.time() < deadline:
        time.sleep(5)
        try:
            check_res = sb.table("questions").select("status, answer_text").eq("id", question_id).maybe_single().execute()
            if check_res.data:
                status = check_res.data.get("status")
                answer = check_res.data.get("answer_text")
                if status == "answered" and answer:
                    print(f"[ask_human] Answer received: '{answer}'")
                    send_telegram_message(f"✅ <b>Answer received:</b> \"{answer}\"\nAgent is resuming build now.")
                    return {"status": "answered", "answer": answer}
        except Exception as pe:
            print(f"[ask_human] Poll error: {pe}", file=sys.stderr)

    # 4. Timeout fallback (5-minute auto-release)
    timeout_answer = f"NO_ANSWER: {timeout_minutes}-minute review window elapsed without response. Proceed with best-effort completion and deliver what has been generated."
    print(f"[ask_human] Timed out after {timeout_minutes}m. Auto-releasing build to proceed.")
    try:
        sb.table("questions").update({
            "status": "timed_out",
            "answer_text": timeout_answer,
            "answered_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", question_id).execute()
    except Exception as te:
        print(f"[ask_human] Could not mark question timed_out: {te}", file=sys.stderr)

    send_telegram_message(f"⏳ <b>{timeout_minutes}-Minute Review Window Elapsed</b> for <i>{task_title}</i>.\nAgent is proceeding automatically with best-effort completion and delivery.")
    return {"status": "timed_out", "answer": timeout_answer}


class AskHumanHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/ask_human" or self.path == "/":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                task_id = data.get("task_id", "manual_run")
                question_text = data.get("question_text") or data.get("question")
                timeout_m = int(data.get("timeout_minutes", DEFAULT_TIMEOUT_MINUTES))

                if not question_text:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "question_text is required"}).encode("utf-8"))
                    return

                res = ask_human(task_id, question_text, timeout_m)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(res).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "service": "Vicarius ask_human Local Server",
            "status": "ready",
            "port": SERVER_PORT
        }).encode("utf-8"))

    def log_message(self, format, *args):
        # Silence default request logging to avoid terminal clutter
        pass


def start_ask_human_server(port: int = SERVER_PORT) -> HTTPServer:
    """Starts the HTTP ask_human server in a background daemon thread."""
    server = HTTPServer(("127.0.0.1", port), AskHumanHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[ask_human] Local HTTP server listening on http://127.0.0.1:{port}/ask_human")
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vicarius ask_human Tool & Server")
    parser.add_argument("--server", action="store_true", help="Run HTTP server foreground")
    parser.add_argument("--task-id", type=str, default="manual_test", help="Task ID")
    parser.add_argument("--question", type=str, help="Question text to ask human")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_MINUTES, help="Timeout in minutes")
    args = parser.parse_args()

    if args.server or not args.question:
        srv = HTTPServer(("127.0.0.1", SERVER_PORT), AskHumanHandler)
        print(f"[ask_human] Server running on http://127.0.0.1:{SERVER_PORT}. Press Ctrl+C to stop.")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n[ask_human] Server stopped.")
    else:
        result = ask_human(args.task_id, args.question, args.timeout)
        print(json.dumps(result, indent=2))
