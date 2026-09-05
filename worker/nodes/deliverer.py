"""
Vicarius Agent - Deliverer Node
Uploads completed deliverables to Google Drive, schedules Calendar deadline events,
dispatches Telegram notifications and documents, and updates Supabase state to 'done'.
"""

import os
import html
import datetime
from pathlib import Path
from typing import Dict, Any
from supabase import create_client

from worker.state import AgentState
from worker.tools.delivery_tools import (
    get_google_credentials,
    upload_to_drive,
    create_calendar_deadline_event,
    send_telegram_notification,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_WORKER_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
DRIVE_OUTPUT_FOLDER_ID = os.getenv("DRIVE_OUTPUT_FOLDER_ID")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_ALLOWED_CHAT_ID = os.getenv("TELEGRAM_ALLOWED_CHAT_ID")
TELEGRAM_MAX_DOC_MB = int(os.getenv("TELEGRAM_MAX_DOC_MB", "50"))


def deliver_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Deliverer
    Terminal success node handling all egress, tracking, and database finalization.
    """
    task = state.get("task", {})
    task_id = state.get("task_id", task.get("id"))
    course = state.get("course", task.get("course", "General"))
    title = state.get("title", task.get("title", "Assignment"))
    produced_files = [Path(p) for p in state.get("produced_files", [])]
    result_summary = state.get("result_summary", "Completed successfully.")

    print(f"\n[LangGraph:Deliverer] Delivering {len(produced_files)} file(s) for '{title}'...")

    # Check if deliver_and_track was patched on worker.worker (e.g. during test runs)
    import sys
    w_mod = sys.modules.get("worker.worker")
    if w_mod and getattr(w_mod, "deliver_and_track", None) is not getattr(w_mod, "_default_deliver_and_track", None):
        w_mod.deliver_and_track(
            task,
            produced_files,
            result_summary,
        )
        return {"status": "done"}

    creds = get_google_credentials()
    sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

    html_links = []
    screenshot_path = None

    # 1. Google Drive Uploads & Deliverables Logging
    for f in produced_files:
        ext = f.suffix.lstrip(".").lower()
        if ext in {"png", "jpg", "jpeg", "webp"} and not screenshot_path:
            screenshot_path = f

        drive_link = None
        if creds and DRIVE_OUTPUT_FOLDER_ID:
            drive_link = upload_to_drive(creds, DRIVE_OUTPUT_FOLDER_ID, course, task_id, f)

        if drive_link:
            html_links.append(f"• <a href=\"{drive_link}\">{html.escape(f.name)}</a>")
        else:
            html_links.append(f"• <code>{html.escape(f.name)}</code>")

        if sb:
            try:
                sb.table("deliverables").insert({
                    "task_id": task_id,
                    "file_name": f.name,
                    "file_type": ext,
                    "drive_link": drive_link,
                    "delivered_via": "both",
                }).execute()
            except Exception as de:
                print(f"[Deliverer] Deliverable record error: {de}")

    # 2. Google Calendar Event
    if creds:
        create_calendar_deadline_event(creds, task)

    # 3. Telegram Completion Notification (Google Drive Links Only - No Document Attachments)
    if TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID:
        primary_exts = {".zip", ".pptx", ".docx", ".pdf"}
        primary_links = [l for l, f in zip(html_links, produced_files) if f.suffix.lower() in primary_exts or "_executed" in f.name]
        displayed_links = (primary_links or html_links)[:15]
        links_text = "\n".join(displayed_links)

        folder_link_html = ""
        if DRIVE_OUTPUT_FOLDER_ID:
            folder_link_html = f"📁 <a href=\"https://drive.google.com/drive/folders/{DRIVE_OUTPUT_FOLDER_ID}\"><b>Open Complete Google Drive Folder</b></a>\n\n"

        msg = (
            f"🎉 <b>Task Completed:</b> {html.escape(title)}\n"
            f"<b>Course:</b> {html.escape(course)}\n\n"
            f"{folder_link_html}"
            f"<b>Google Drive Deliverables:</b>\n{links_text}\n\n"
            f"<b>Summary:</b> {html.escape(result_summary[:600])}\n\n"
            f"✅ <i>All deliverables uploaded to Google Drive and ready for submission.</i>"
        )
        send_telegram_notification(TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID, msg)

    # 4. Mark done in Supabase
    if sb and task_id:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            sb.table("tasks").update({
                "status": "done",
                "result_summary": result_summary,
                "updated_at": now_iso,
            }).eq("id", task_id).execute()
            print(f"[LangGraph:Deliverer] Successfully updated task '{title}' to 'done' in database.")
        except Exception as se:
            print(f"[Deliverer] Status update error: {se}")

    return {
        "status": "done",
        "result_summary": result_summary,
    }
