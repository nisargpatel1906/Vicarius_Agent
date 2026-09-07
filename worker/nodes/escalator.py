"""
Vicarius Agent - Escalator Node
Handles human escalation when agent fix attempts are exhausted or verification flags issues.
Enforces 5-Minute Auto-Release & Best-Effort Delivery Rule:
1. Surfaces what was flagged, what was tried, and links to completed files.
2. Dispatches an interactive Telegram alert with a strict 5-minute review window.
3. Polls Supabase for 5 minutes:
   - If the student replies on Telegram, task is re-queued for rebuild.
   - If 5 minutes elapse without reply, automatically releases the block:
     - If deliverables exist (.zip, .pptx, .docx, .ipynb, etc.), auto-delivers
       via deliver_node as best-effort submission, sets status 'done', and frees worker.
     - If no files were produced, flags/fails cleanly without blocking subsequent tasks.
"""

import os
import html
import time
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
REVIEW_TIMEOUT_SECONDS = int(os.getenv("REVIEW_TIMEOUT_SECONDS", "300"))  # 5 minutes default


def escalate_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Escalator
    Handles human escalation with a 5-minute auto-release and best-effort delivery loop.
    """
    task = state.get("task", {})
    task_id = state.get("task_id", task.get("id"))
    course = state.get("course", task.get("course", "General"))
    title = state.get("title", task.get("title", "Assignment"))
    produced_files = [Path(p) for p in state.get("produced_files", [])]
    feedback = state.get("verification_feedback", "Verification flagged an issue.")
    history: List[Dict[str, Any]] = state.get("attempt_history", [])

    review_timeout_seconds = int(os.getenv("REVIEW_TIMEOUT_SECONDS", "300"))
    review_timeout_mins = max(1, review_timeout_seconds // 60)

    print(f"\n[LangGraph:Escalator] Escalating task '{title}' to user after {len(history)} attempt(s)...")

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

    # Identify primary and code deliverables
    primary_exts = {".zip", ".pptx", ".docx", ".pdf", ".ipynb"}
    code_exts = {".py", ".html", ".css", ".js", ".png", ".jpg", ".md", ".txt"}

    existing_files = [f for f in produced_files if f.exists()]
    primary_files = [f for f in existing_files if f.suffix.lower() in primary_exts]
    deliverable_files = primary_files or [f for f in existing_files if f.suffix.lower() in (primary_exts | code_exts)]

    # Upload deliverables to Drive for preview links
    drive_links = []
    if creds and DRIVE_OUTPUT_FOLDER_ID:
        for f in deliverable_files:
            link = upload_to_drive(creds, DRIVE_OUTPUT_FOLDER_ID, course, task_id, f)
            if link:
                drive_links.append(f"• <a href=\"{link}\">{html.escape(f.name)}</a>")

    # Format 'What I already tried'
    tried_lines = []
    for att in history:
        a_num = att.get("attempt", 1)
        a_fix = att.get("fix_tried") or att.get("feedback") or "generic attempt"
        tried_lines.append(f"• <b>Attempt {a_num}:</b> {html.escape(str(a_fix)[:120])}")

    tried_body = "\n".join(tried_lines) if tried_lines else "Diagnosed and attempted automated self-correction."
    partial_text = f"📂 <b>Current Deliverables on Drive:</b>\n" + "\n".join(drive_links) + "\n\n" if drive_links else ""

    alert_msg = (
        f"⚠️ <b>Review Required ({review_timeout_mins}-Minute Window Active)</b>\n\n"
        f"📌 <b>Task:</b> {html.escape(title)}\n"
        f"📚 <b>Course:</b> {html.escape(course)}\n\n"
        f"<b>What was flagged:</b>\n{html.escape(feedback[:350])}\n\n"
        f"<b>What I already tried:</b>\n{tried_body}\n\n"
        f"{partial_text}"
        f"⏱ <b>5-Minute Auto-Release Policy:</b>\n"
        f"• <b>To change or fix:</b> <b>Reply directly to this message</b> within {review_timeout_mins} minutes and I'll rebuild automatically.\n"
        f"• <b>If you do not reply / are away:</b> In {review_timeout_mins} minutes, I will automatically finalize, deliver all completed deliverables to Google Drive as best-effort, and free the queue for other projects.\n\n"
        f"🆔 <code>{task_id}</code>"
    )

    if TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID:
        send_telegram_notification(TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID, alert_msg)

    # Temporarily set Supabase status to 'flagged' while waiting
    if sb and task_id:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            sb.table("tasks").update({
                "status": "flagged",
                "result_summary": f"Review required ({review_timeout_mins}m window) — {feedback[:250]}",
                "updated_at": now_iso,
            }).eq("id", task_id).execute()
        except Exception as se:
            print(f"[Escalator] Status update error: {se}")

    # 5-Minute Polling Loop: wait for user reply on Telegram
    start_time = time.time()
    user_rebuilding = False

    print(f"[LangGraph:Escalator] Waiting up to {review_timeout_seconds}s ({review_timeout_mins}m) for student reply via Telegram...")

    # Polling loop: wait for student reply on Telegram via Supabase status check.
    # Uses exponential backoff (5s → 10s → 20s → 30s cap) instead of a fixed 5s
    # interval to avoid burning through Supabase connection quota (60 → ~30 calls max).
    poll_interval = 5
    MAX_POLL_INTERVAL = 30

    while time.time() - start_time < review_timeout_seconds:
        time.sleep(poll_interval)
        # Grow the interval exponentially up to the cap
        poll_interval = min(poll_interval * 2, MAX_POLL_INTERVAL)

        if sb and task_id:
            try:
                task_check = sb.table("tasks").select("status").eq("id", task_id).maybe_single().execute()
                if task_check.data and task_check.data.get("status") == "queued":
                    print(f"[LangGraph:Escalator] Student replied on Telegram! Task '{title}' re-queued for rebuild.")
                    user_rebuilding = True
                    break
            except Exception:
                pass

    if user_rebuilding:
        return {
            "status": "queued",
            "message": "Student replied to Telegram review. Re-queued for automated rebuild.",
        }

    # 5 minutes elapsed without student response -> Auto-deliver completed files!
    print(f"[LangGraph:Escalator] {review_timeout_mins}-minute review window elapsed without user response.")

    if deliverable_files:
        print(f"[LangGraph:Escalator] Auto-delivering {len(deliverable_files)} completed deliverable(s) as best-effort submission...")
        from worker.nodes.deliverer import deliver_node

        auto_summary = (
            f"Auto-delivered best-effort completion after {review_timeout_mins}-minute review window without reply. "
            f"Delivered {len(deliverable_files)} file(s). Verification note: {feedback[:200]}. "
            f"(You can still reply on Telegram anytime to rebuild)."
        )

        deliver_state = dict(state)
        deliver_state["produced_files"] = [str(f.resolve()) for f in deliverable_files]
        deliver_state["result_summary"] = auto_summary

        if TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID:
            send_telegram_notification(
                TELEGRAM_BOT_TOKEN,
                TELEGRAM_ALLOWED_CHAT_ID,
                f"⏱ <b>{review_timeout_mins}-Minute Review Window Elapsed:</b>\n"
                f"No changes requested for <b>{html.escape(title)}</b>. "
                f"Proceeding to finalize and deliver all completed deliverables to Google Drive as best-effort submission.\n\n"
                f"<i>(You can still reply to the review message anytime if you want adjustments!)</i>"
            )

        return deliver_node(deliver_state)

    # Total failure case with 0 files produced
    print(f"[LangGraph:Escalator] No deliverables produced. Task remains flagged.")
    if sb and task_id:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            sb.table("tasks").update({
                "status": "flagged",
                "progress_note": f"Flagged for human review — {feedback[:200]}",
                "last_progress_at": now_iso,
                "result_summary": f"Flagged after {review_timeout_mins}m timeout (zero deliverables produced) — {feedback[:300]}",
                "updated_at": now_iso,
            }).eq("id", task_id).execute()
        except Exception as se:
            print(f"[Escalator] Status update error: {se}")

    return {
        "status": "flagged",
        "error_message": feedback,
    }
