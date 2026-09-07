"""
Vicarius Agent - Delivery Tools
Google Drive uploads, Google Calendar deadline events, and Telegram notifications/documents.
"""

import os
import html
import datetime
from pathlib import Path
from typing import Optional
import pytz

TARGET_TZ = pytz.timezone("Asia/Kolkata")


def get_google_credentials():
    """Get authenticated Google OAuth2 credentials from environment variables."""
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
    refresh_token = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN")
    if client_id and client_secret and refresh_token:
        try:
            from google.oauth2.credentials import Credentials
            return Credentials(
                None,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret,
            )
        except Exception as e:
            print(f"[DeliveryTools-Error] Credentials load failed: {e}")
    return None


def get_or_create_task_drive_folder(drive_service, root_folder_id: str, course: str, task_id: str, title: str = "") -> str:
    """
    Creates or retrieves the dedicated, organized task folder inside Google Drive:
    Agent Outputs / <course> / <Task Title> [<task_id[:8]>] /
    
    GUARANTEE: Checks if a folder for task_id[:8] already exists in that course.
    If it exists (from an initial run or retry), it always reuses that EXACT folder.
    Never creates duplicate folders when the user replies or requests a fix.
    """
    import re
    safe_course = (course or "General").strip()
    safe_id = str(task_id).strip()
    short_id = safe_id[:8]

    # 1. Get or create course subfolder inside root Agent Outputs folder
    course_q = f"mimeType='application/vnd.google-apps.folder' and name='{safe_course}' and '{root_folder_id}' in parents and trashed=false"
    c_res = drive_service.files().list(q=course_q, fields="files(id, name)").execute()
    c_files = c_res.get('files', [])
    if c_files:
        course_folder_id = c_files[0]['id']
    else:
        meta = {'name': safe_course, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [root_folder_id]}
        c_folder = drive_service.files().create(body=meta, fields='id').execute()
        course_folder_id = c_folder.get('id')

    # 2. Check if a task folder for this task_id already exists in course_folder_id
    task_q = f"mimeType='application/vnd.google-apps.folder' and '{course_folder_id}' in parents and name contains '{short_id}' and trashed=false"
    t_res = drive_service.files().list(q=task_q, fields="files(id, name)").execute()
    t_files = t_res.get('files', [])
    if t_files:
        return t_files[0]['id']

    # Check if task_id exists in properties
    try:
        prop_q = f"mimeType='application/vnd.google-apps.folder' and '{course_folder_id}' in parents and properties has {{ key='task_id' and value='{safe_id}' }} and trashed=false"
        p_res = drive_service.files().list(q=prop_q, fields="files(id, name)").execute()
        p_files = p_res.get('files', [])
        if p_files:
            return p_files[0]['id']
    except Exception:
        pass

    # 3. Create dedicated task folder: <clean_title> [<short_id>]
    clean_title = re.sub(r'[^\w\s-]', '', title or "Assignment").strip()
    folder_name = f"{clean_title[:45]} [{short_id}]" if clean_title else f"Task [{short_id}]"
    meta = {
        'name': folder_name,
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [course_folder_id],
        'description': f"task_id:{safe_id}",
        'properties': {'task_id': safe_id},
    }
    t_folder = drive_service.files().create(body=meta, fields='id').execute()
    t_id = t_folder.get('id')

    # Set public reader permissions on task folder
    try:
        drive_service.permissions().create(
            fileId=t_id,
            body={'type': 'anyone', 'role': 'reader'},
            fields='id'
        ).execute()
    except Exception:
        pass

    return t_id


def upload_to_drive(creds, folder_id: str, course: str, task_id: str, file_path: Path, title: str = "") -> Optional[str]:
    """
    Uploads deliverable to Google Drive into the dedicated task folder:
    Agent Outputs / <course> / <Task Title> [<task_id[:8]>] / <file_name>
    and sets public reader permission.
    If the file already exists in the task folder, updates it in-place.
    """
    if not creds or not folder_id or not file_path.exists():
        return None
    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload

        drive_service = build('drive', 'v3', credentials=creds)

        # Get or create dedicated task folder (reused across retries/fixes)
        task_folder_id = get_or_create_task_drive_folder(drive_service, folder_id, course, task_id, title)

        # Check if file already uploaded in task folder; if so, update content in-place
        file_q = f"name='{file_path.name}' and '{task_folder_id}' in parents and trashed=false"
        existing = drive_service.files().list(q=file_q, fields="files(id, name)").execute().get('files', [])
        media = MediaFileUpload(str(file_path), resumable=True)
        if existing:
            file_id = existing[0]['id']
            drive_service.files().update(fileId=file_id, media_body=media).execute()
        else:
            file_meta = {'name': file_path.name, 'parents': [task_folder_id]}
            uploaded = drive_service.files().create(body=file_meta, media_body=media, fields='id').execute()
            file_id = uploaded.get('id')

        # Set reader permission
        try:
            drive_service.permissions().create(
                fileId=file_id,
                body={'type': 'anyone', 'role': 'reader'},
                fields='id'
            ).execute()
        except Exception:
            pass

        return f"https://drive.google.com/file/d/{file_id}/view?usp=sharing"
    except Exception as e:
        print(f"[DeliveryTools-DriveError] Failed to upload {file_path.name}: {e}")
        return None


def create_calendar_deadline_event(creds, task: dict) -> None:
    """Creates a Google Calendar deadline event with a 24-hour reminder popup."""
    due_str = task.get("due_date")
    if not creds or not due_str:
        return
    try:
        from googleapiclient.discovery import build
        from dateutil import parser as dt_parser

        service = build("calendar", "v3", credentials=creds)
        due_dt = dt_parser.isoparse(due_str)
        if due_dt.tzinfo is None:
            due_dt = pytz.utc.localize(due_dt)
        due_ist = due_dt.astimezone(TARGET_TZ)

        start_time = due_ist - datetime.timedelta(hours=1)
        end_time = due_ist

        event = {
            "summary": f"DEADLINE: {task.get('title')}",
            "description": f"Assignment deadline for {task.get('course')}.\nAutomated delivery by Vicarius Agent.",
            "start": {"dateTime": start_time.isoformat(), "timeZone": "Asia/Kolkata"},
            "end": {"dateTime": end_time.isoformat(), "timeZone": "Asia/Kolkata"},
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "email", "minutes": 24 * 60},
                    {"method": "popup", "minutes": 60},
                ],
            },
        }
        service.events().insert(calendarId="primary", body=event).execute()
        print(f"[DeliveryTools-Calendar] Created deadline event for '{task.get('title')}'")
    except Exception as e:
        print(f"[DeliveryTools-CalendarError] Could not create calendar event: {e}")


def send_telegram_notification(bot_token: str, chat_id: str, message_html: str) -> bool:
    """Sends HTML notification to Telegram chat."""
    if not bot_token or not chat_id:
        return False
    import requests
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    text = message_html[:4000] if len(message_html) > 4000 else message_html
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    try:
        r = requests.post(url, json=payload, timeout=15)
        return r.ok
    except Exception as e:
        print(f"[DeliveryTools-TelegramError] Alert failed: {e}")
        return False


def send_telegram_document(bot_token: str, chat_id: str, file_path: Path, caption: str = "") -> bool:
    """Uploads a document directly to Telegram chat."""
    if not bot_token or not chat_id or not file_path.exists():
        return False
    import requests
    url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
    try:
        with open(file_path, "rb") as doc_file:
            files = {"document": doc_file}
            data = {"chat_id": chat_id, "caption": caption[:1024]}
            r = requests.post(url, data=data, files=files, timeout=60)
            return r.ok
    except Exception as e:
        print(f"[DeliveryTools-TelegramError] Doc send failed for {file_path.name}: {e}")
        return False


def send_telegram_photo(bot_token: str, chat_id: str, file_path: Path, caption: str = "") -> bool:
    """Uploads a photo/screenshot directly to Telegram chat."""
    if not bot_token or not chat_id or not file_path.exists():
        return False
    import requests
    url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
    try:
        with open(file_path, "rb") as img_file:
            files = {"photo": img_file}
            data = {"chat_id": chat_id, "caption": caption[:1024], "parse_mode": "HTML"}
            r = requests.post(url, data=data, files=files, timeout=60)
            return r.ok
    except Exception as e:
        print(f"[DeliveryTools-TelegramError] Photo send failed: {e}")
        return False
