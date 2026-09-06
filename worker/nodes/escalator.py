"""
Vicarius Agent - Escalator Node
Terminal failure node that flags tasks when attempts are exhausted or declared unfixable,
surfacing partial deliverables and detailed 'what I already tried' logs to Telegram.
"""

import os
import html
import datetime
from pathlib import Path
from typing import Dict, Any, List
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

from worker.state import AgentState
from worker.tools.delivery_tools import (
    get_google_credentials,
    upload_to_drive,
    send_telegram_notification,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_WORKER_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
DRIVE_OUTPUT_FOLDER_ID = os.getenv("DRIVE_OUTPUT_FOLDER_ID")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_ALLOWED_CHAT_ID = os.getenv("TELEGRAM_ALLOWED_CHAT_ID")
TELEGRAM_MAX_DOC_MB = int(os.getenv("TELEGRAM_MAX_DOC_MB", "50"))


def escalate_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Escalator
    Handles human escalation when agent fix attempts are exhausted or deadline elapsed.
    """
    task = state.get("task", {})
    task_id = state.get("task_id", task.get("id"))
    course = state.get("course", task.get("course", "General"))
    title = state.get("title", task.get("title", "Assignment"))
    produced_files = [Path(p) for p in state.get("produced_files", [])]
    feedback = state.get("verification_feedback", "Verification failed.")
    history: List[Dict[str, Any]] = state.get("attempt_history", [])

    print(f"\n[LangGraph:Escalator] Escalating task '{title}' to user after {len(history)} attempts...")

    # Check if handle_task_failure was patched on worker.worker (e.g. during test runs)
    import sys
    w_mod = sys.modules.get("worker.worker")
    if w_mod and getattr(w_mod, "handle_task_failure", None) is not getattr(w_mod, "_default_handle_task_failure", None):
        last_diag = None
        if history:
            last_entry = history[-1]
            last_diag = {
                "plain_explanation": last_entry.get("plain") or feedback,
                "root_cause": last_entry.get("root_cause") or feedback,
                "category": last_entry.get("category", "unknown"),
                "agent_fixable": state.get("agent_fixable", False),
            }
        w_mod.handle_task_failure(
            task,
            feedback,
            last_diag,
            produced_files=produced_files,
            attempt_log=history,
        )
        return {"status": "flagged"}

    creds = get_google_credentials()
    sb_url = os.getenv("SUPABASE_URL") or SUPABASE_URL
    sb_key = os.getenv("SUPABASE_WORKER_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or SUPABASE_KEY
    sb = create_client(sb_url, sb_key) if sb_url and sb_key else None

    # Upload partial files to Drive
    drive_links = []
    if creds and DRIVE_OUTPUT_FOLDER_ID:
        for f in produced_files:
            if f.exists():
                link = upload_to_drive(creds, DRIVE_OUTPUT_FOLDER_ID, course, task_id, f)
                if link:
                    drive_links.append(f"<a href=\"{link}\">{html.escape(f.name)}</a>")

    # Format 'What I already tried'
    tried_lines = []
    for att in history:
        a_num = att.get("attempt", 1)
        a_fix = att.get("fix_tried") or att.get("feedback") or "generic attempt"
        tried_lines.append(f"• <b>Attempt {a_num}:</b> {html.escape(str(a_fix)[:150])}")

    tried_body = "\n".join(tried_lines) if tried_lines else "Diagnosed and attempted automated self-correction."
    partial_text = f"📂 <b>Partial Outputs:</b> {', '.join(drive_links)}\n\n" if drive_links else ""

    alert_msg = (
        f"⚠️ <b>I couldn't finish this task — I need your help</b>\n\n"
        f"📌 <b>Task:</b> {html.escape(title)}\n"
        f"📚 <b>Course:</b> {html.escape(course)}\n\n"
        f"<b>What went wrong:</b>\n{html.escape(feedback[:400])}\n\n"
        f"<b>What I already tried:</b>\n{tried_body}\n\n"
        f"{partial_text}"
        f"💬 <b>Easiest fix:</b> just <b>reply to this message</b> telling me what to change, and I'll rebuild automatically.\n\n"
        f"🆔 <code>{task_id}</code>"
    )

    if TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID:
        send_telegram_notification(TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID, alert_msg)


    # Update Supabase status to 'flagged'
    if sb and task_id:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            sb.table("tasks").update({
                "status": "flagged",
                "result_summary": f"Flagged after {len(history)} attempts — {feedback[:300]}",
                "updated_at": now_iso,
            }).eq("id", task_id).execute()
        except Exception as se:
            print(f"[Escalator] Status update error: {se}")

    return {
        "status": "flagged",
        "error_message": feedback,
    }
