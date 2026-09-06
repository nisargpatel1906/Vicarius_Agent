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


def upload_to_drive(creds, folder_id: str, course: str, task_id: str, file_path: Path) -> Optional[str]:
    """Uploads deliverable to Google Drive (Agent Outputs/<course>/) and sets public reader permission."""
    if not creds or not folder_id or not file_path.exists():
        return None
    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload

        drive_service = build('drive', 'v3', credentials=creds)

        # 1. Create or get course subfolder
        course_q = f"mimeType='application/vnd.google-apps.folder' and name='{course}' and '{folder_id}' in parents and trashed=false"
        res = drive_service.files().list(q=course_q, fields="files(id, name)").execute()
        files = res.get('files', [])
        if files:
            course_folder_id = files[0]['id']
        else:
            meta = {'name': course, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [folder_id]}
            folder = drive_service.files().create(body=meta, fields='id').execute()
            course_folder_id = folder.get('id')

        # 2. Check if file already uploaded; if so, update content in-place
        file_q = f"name='{file_path.name}' and '{course_folder_id}' in parents and trashed=false"
        existing = drive_service.files().list(q=file_q, fields="files(id, name)").execute().get('files', [])
        media = MediaFileUpload(str(file_path), resumable=True)
        if existing:
            file_id = existing[0]['id']
            drive_service.files().update(fileId=file_id, media_body=media).execute()
        else:
            # 3. Upload new file
            file_meta = {'name': file_path.name, 'parents': [course_folder_id]}
            uploaded = drive_service.files().create(body=file_meta, media_body=media, fields='id').execute()
            file_id = uploaded.get('id')

        # 3. Set reader permission
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
