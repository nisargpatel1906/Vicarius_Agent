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
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

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
    sb_url = os.getenv("SUPABASE_URL") or SUPABASE_URL
    sb_key = os.getenv("SUPABASE_WORKER_KEY") or os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or SUPABASE_KEY
    sb = create_client(sb_url, sb_key) if sb_url and sb_key else None

    html_links = []
    screenshot_path = None

    # 1. Google Drive Uploads & Deliverables Logging
    task_drive_folder_id = None
    if creds and DRIVE_OUTPUT_FOLDER_ID:
        try:
            from googleapiclient.discovery import build
            from worker.tools.delivery_tools import get_or_create_task_drive_folder
            drive_service = build('drive', 'v3', credentials=creds)
            task_drive_folder_id = get_or_create_task_drive_folder(drive_service, DRIVE_OUTPUT_FOLDER_ID, course, task_id, title)
        except Exception as tfe:
            print(f"[Deliverer] Task folder resolution error: {tfe}")

    for f in produced_files:
        ext = f.suffix.lstrip(".").lower()
        if ext in {"png", "jpg", "jpeg", "webp"} and not screenshot_path:
            screenshot_path = f

        drive_link = None
        if creds and DRIVE_OUTPUT_FOLDER_ID:
            drive_link = upload_to_drive(creds, DRIVE_OUTPUT_FOLDER_ID, course, task_id, f, title)

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
        target_folder_id = task_drive_folder_id or DRIVE_OUTPUT_FOLDER_ID
        if target_folder_id:
            folder_link_html = f"📁 <a href=\"https://drive.google.com/drive/folders/{target_folder_id}\"><b>Open Task Folder in Google Drive</b></a>\n\n"

        msg = (
            f"🎉 <b>Task Completed:</b> {html.escape(title)}\n"
            f"<b>Course:</b> {html.escape(course)}\n"
            f"🆔 <code>{task_id}</code>\n\n"
            f"{folder_link_html}"
            f"<b>Google Drive Deliverables:</b>\n{links_text}\n\n"
            f"<b>Summary:</b> {html.escape(result_summary[:600])}\n\n"
            f"✅ <i>All deliverables organized in task folder and ready for submission.</i>\n"
            f"<i>(To request fixes or additions, reply to this message!)</i>"
        )
        send_telegram_notification(TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID, msg)

    # 4. Mark done in Supabase
    if sb and task_id:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            sb.table("tasks").update({
                "status": "done",
                "progress_note": "Task completed and delivered to Google Drive.",
                "last_progress_at": now_iso,
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
