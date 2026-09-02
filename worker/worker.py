#!/usr/bin/env python3
"""
Vicarius Agent — Local Build Worker
Executes academic tasks using Antigravity CLI (agy) on the user's local PC.
Sourced from PRD_academic_task_agent.md (Sections 6.3, 6.4, 6.5, 7, 9, 10, 11)
"""

import os
import sys
import time
import json
import re
import shutil
import subprocess
import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

import pytz
import psutil
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Configuration from Environment Variables (PRD Section 9)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_WORKER_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
PINNED_AGY_VERSION = os.getenv("ANTIGRAVITY_PINNED_VERSION", "1.1.12")
JOB_TIMEOUT_MINUTES = int(os.getenv("JOB_TIMEOUT_MINUTES", "45"))
QUESTION_WAIT_TIMEOUT_MINUTES = int(os.getenv("QUESTION_WAIT_TIMEOUT_MINUTES", "20"))
TIMEZONE_STR = os.getenv("TIMEZONE", "Asia/Kolkata")
DRIVE_OUTPUT_FOLDER_ID = os.getenv("DRIVE_OUTPUT_FOLDER_ID")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_ALLOWED_CHAT_ID = os.getenv("TELEGRAM_ALLOWED_CHAT_ID")

TARGET_TZ = pytz.timezone(TIMEZONE_STR)
WORKER_ID = f"worker-local-{os.environ.get('COMPUTERNAME', 'pc')}"
BASE_WORK_DIR = Path(__file__).resolve().parent.parent / "work_dirs"


def get_supabase() -> Client:
    """Instantiate authenticated Supabase client."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_WORKER_KEY environment variables.")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def log_system_event(level: str, component: str, message: str) -> None:
    """Log structured event to system_events table."""
    try:
        sb = get_supabase()
        sb.table("system_events").insert({
            "level": level,
            "component": component,
            "message": message,
        }).execute()
    except Exception as e:
        print(f"[SystemEvent-Error] Could not log event: {e}", file=sys.stderr)


def send_telegram_notification(message: str, parse_mode: str = "HTML") -> bool:
    """Send alert to authorized Telegram chat ID with automatic plain text fallback."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_ALLOWED_CHAT_ID:
        return False
    try:
        import requests
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        resp = requests.post(url, json={
            "chat_id": TELEGRAM_ALLOWED_CHAT_ID,
            "text": message,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True
        }, timeout=10)
        
        if resp.status_code == 200:
            return True
            
        # If HTML/Markdown parse failed, retry with plain text (stripping tags)
        print(f"[Telegram-Warning] Parse mode {parse_mode} failed ({resp.status_code}: {resp.text}). Retrying with plain text...", file=sys.stderr)
        clean_text = re.sub(r"<[^>]+>", "", message).replace("*", "").replace("_", "")
        fallback_resp = requests.post(url, json={
            "chat_id": TELEGRAM_ALLOWED_CHAT_ID,
            "text": clean_text,
            "disable_web_page_preview": True
        }, timeout=10)
        return fallback_resp.status_code == 200
    except Exception as e:
        print(f"[Telegram-Error] Failed to send message: {e}", file=sys.stderr)
        return False


def send_telegram_photo(photo_path: Path, caption: Optional[str] = None) -> bool:
    """Send photo/screenshot alert to authorized Telegram chat ID (PRD 8 / TASK_TYPES.md)."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_ALLOWED_CHAT_ID or not photo_path.exists():
        return False
    try:
        import requests
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
        with open(photo_path, "rb") as f:
            data = {"chat_id": TELEGRAM_ALLOWED_CHAT_ID}
            if caption:
                data["caption"] = caption
                data["parse_mode"] = "HTML"
            resp = requests.post(url, data=data, files={"photo": f}, timeout=15)
            if resp.status_code == 200:
                return True
            
            # Fallback without parse_mode
            f.seek(0)
            data["parse_mode"] = ""
            resp2 = requests.post(url, data=data, files={"photo": f}, timeout=15)
            return resp2.status_code == 200
    except Exception as e:
        print(f"[Telegram-Error] Failed to send photo: {e}", file=sys.stderr)
        return False


def set_below_normal_priority() -> None:
    """Set worker process and future subprocesses to Below Normal OS priority (PRD 6.3 / 12.1)."""
    try:
        p = psutil.Process(os.getpid())
        if sys.platform == "win32":
            p.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
        else:
            p.nice(10)
    except Exception as e:
        print(f"[Worker] Could not set below-normal priority: {e}")


def check_antigravity_cli_version() -> bool:
    """Verify installed agy CLI matches ANTIGRAVITY_PINNED_VERSION (PRD 6.3 / 7)."""
    try:
        result = subprocess.run(["agy", "--version"], capture_output=True, text=True, timeout=10)
        output = result.stdout.strip()
        version_match = re.search(r"(\d+\.\d+\.\d+)", output)
        installed_version = version_match.group(1) if version_match else output

        if installed_version != PINNED_AGY_VERSION:
            msg = (
                f"Antigravity CLI version mismatch! Installed: '{installed_version}', "
                f"Pinned: '{PINNED_AGY_VERSION}'. Halting worker to prevent unverified drift."
            )
            print(f"[Version-Error] {msg}", file=sys.stderr)
            log_system_event("error", "worker", msg)
            send_telegram_notification(f"🚨 *Worker Error:* {msg}")
            return False
        return True
    except FileNotFoundError:
        msg = "Antigravity CLI ('agy') not found in PATH."
        print(f"[CLI-Error] {msg}", file=sys.stderr)
        log_system_event("error", "worker", msg)
        send_telegram_notification(f"🚨 *Worker Error:* {msg}")
        return False
    except Exception as e:
        msg = f"Failed to check agy version: {e}"
        print(f"[CLI-Error] {msg}", file=sys.stderr)
        log_system_event("error", "worker", msg)
        return False


def check_system_load_and_concurrency(due_date_str: Optional[str]) -> bool:
    """
    Checks system load and foreground concurrency (PRD Section 6.3).
    Returns True if worker can proceed, False if it should defer.
    """
    cpu_percent = psutil.cpu_percent(interval=1.0)
    
    # Check if deadline is close (< 2 hours in IST)
    is_deadline_close = False
    if due_date_str:
        try:
            due_dt = datetime.datetime.fromisoformat(due_date_str.replace("Z", "+00:00")).astimezone(TARGET_TZ)
            now_dt = datetime.datetime.now(TARGET_TZ)
            hours_left = (due_dt - now_dt).total_seconds() / 3600.0
            if hours_left <= 2.0:
                is_deadline_close = True
        except Exception:
            pass

    # Check foreground agy sessions (excluding this worker)
    active_agy_sessions = 0
    for proc in psutil.process_iter(['name', 'pid']):
        try:
            if 'agy' in proc.info['name'].lower() and proc.info['pid'] != os.getpid():
                active_agy_sessions += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    if active_agy_sessions > 0:
        if not is_deadline_close:
            print(f"[Worker] Foreground Antigravity session active. Deferring to next cycle.")
            return False

    if cpu_percent > 85.0:
        if not is_deadline_close:
            print(f"[Worker] High CPU utilization ({cpu_percent}%). Deferring to next cycle.")
            return False

    return True


def claim_next_task() -> Optional[Dict[str, Any]]:
    """
    Query tasks where status = 'queued' ordered by due_date ASC.
    Atomically claims the top task with conditional update (PRD Section 6.3).
    """
    max_retries = 3
    for attempt in range(max_retries):
        try:
            sb = get_supabase()
            
            # Query tasks: status = 'queued', non-archived, ordered by due_date ASC (nulls last)
            resp = (
                sb.table("tasks")
                .select("*")
                .eq("status", "queued")
                .eq("archived", False)
                .order("due_date", desc=False, nullsfirst=False)
                .limit(1)
                .execute()
            )
            
            tasks = resp.data
            if not tasks or len(tasks) == 0:
                return None

            candidate = tasks[0]
            task_id = candidate["id"]

            # Atomic conditional update (only succeeds if still 'queued')
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            claim_resp = (
                sb.table("tasks")
                .update({
                    "status": "claimed",
                    "worker_id": WORKER_ID,
                    "claimed_at": now_iso,
                    "updated_at": now_iso,
                })
                .eq("id", task_id)
                .eq("status", "queued")
                .execute()
            )

            if claim_resp.data and len(claim_resp.data) > 0:
                return claim_resp.data[0]
            
            return None
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            print(f"[Worker] Network error claiming task: {e}", file=sys.stderr)
            return None


def execute_build(task: Dict[str, Any], retry_count: int = 0) -> Tuple[bool, str, List[Path]]:
    """
    Executes Antigravity CLI for the claimed task in an isolated working directory.
    Returns (success, stdout_output, list_of_produced_files).
    """
    task_id = task["id"]
    task_work_dir = BASE_WORK_DIR / task_id
    task_work_dir.mkdir(parents=True, exist_ok=True)

    build_spec = task.get("build_spec") or f"Complete academic task: {task.get('title')}"
    
    # If this is an automatic retry, append error context
    if retry_count > 0:
        build_spec += f"\n\n[RETRY ATTEMPT #{retry_count}]: The previous build attempt failed verification. Please ensure all expected output files are generated, all required sections are complete, and success criteria are met."

    # Update status to building
    sb = get_supabase()
    sb.table("tasks").update({
        "status": "building",
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }).eq("id", task_id).execute()

    import html
    start_msg = (
        f"🚀 <b>Task Started:</b> {html.escape(task['title'])}\n"
        f"<b>Course:</b> {html.escape(task.get('course') or 'General')}\n"
        f"<b>Task Type:</b> <code>{task.get('task_type', 'document')}</code>\n\n"
        f"<i>The build agent is now generating your academic deliverables.</i>"
    )
    send_telegram_notification(start_msg)

    timeout_seconds = JOB_TIMEOUT_MINUTES * 60
    cmd = [
        "agy",
        "-p", build_spec,
        "--dangerously-skip-permissions",
        "--print-timeout", f"{JOB_TIMEOUT_MINUTES}m",
        "--output-format", "text"
    ]

    print(f"[Worker] Starting build for task '{task['title']}' (ID: {task_id}) in {task_work_dir}")
    start_time = time.time()
    
    try:
        # Run subprocess with below-normal priority & hard timeout
        proc = subprocess.Popen(
            cmd,
            cwd=str(task_work_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        try:
            stdout_text, _ = proc.communicate(timeout=timeout_seconds)
            exit_code = proc.returncode
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout_text, _ = proc.communicate()
            exit_code = -1
            print(f"[Worker] Build timed out after {JOB_TIMEOUT_MINUTES} minutes.")

        duration = time.time() - start_time
        print(f"[Worker] Subprocess completed in {duration:.1f}s with exit code {exit_code}")

        # Scan for produced files
        produced_files = [
            f for f in task_work_dir.glob("**/*")
            if f.is_file() and not f.name.startswith(".") and not f.name.endswith(".log")
        ]

        if exit_code == 0:
            return True, stdout_text, produced_files
        else:
            return False, stdout_text, produced_files

    except Exception as e:
        print(f"[Worker] Exception during execution: {e}")
        return False, str(e), []


def package_code_project(task_work_dir: Path) -> Optional[Path]:
    """
    Zips code project deliverables while strictly excluding junk (TASK_TYPES.md):
    node_modules, .venv, venv, __pycache__, .git, .next, dist, build, *.pyc, *.log, etc.
    """
    import zipfile
    junk_dir_patterns = {
        "node_modules", ".venv", "venv", "__pycache__", ".git", ".next",
        "dist", "build", ".turbo", ".cache", ".idea", ".vscode"
    }
    
    zip_path = task_work_dir / "project.zip"
    files_to_zip = []
    
    for root, dirs, files in os.walk(task_work_dir):
        dirs[:] = [d for d in dirs if d not in junk_dir_patterns and not d.startswith(".")]
        for f in files:
            p = Path(root) / f
            if p.name.startswith(".") or p.name.endswith(".log") or p.name.endswith(".pyc") or p.name == "project.zip":
                continue
            files_to_zip.append(p)
            
    if not files_to_zip:
        return None
        
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for f in files_to_zip:
            rel_path = f.relative_to(task_work_dir)
            zipf.write(f, arcname=str(rel_path))
            
    return zip_path


def perform_verification_check(task: Dict[str, Any], stdout_output: str, produced_files: List[Path]) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Pure Verification Logic (PRD Section 6.4 & docx/TASK_TYPES.md):
    1. Confirm expected output files exist
    2. Mechanically verify numeric success criteria (e.g., accuracy bounds)
    3. Verify task-type specific requirements across all 5 types & scope extensions
    4. Extract assumptions and format result summary
    """
    verification_details = {
        "files_count": len(produced_files),
        "files": [f.name for f in produced_files],
        "assumptions": [],
        "numeric_metric_achieved": None,
        "passed": False,
    }

    # 1. Output files check
    if len(produced_files) == 0:
        return False, "Verification failed: No output files were produced in the working directory.", verification_details

    # 2. Extract assumptions from agent stdout
    assumptions_match = re.findall(r"(?:assumed|assumption|assuming):\s*([^\n\.]+)", stdout_output, re.IGNORECASE)
    verification_details["assumptions"] = [a.strip() for a in assumptions_match]

    # 3. Check numeric success criteria if present
    success_criteria = task.get("success_criteria")
    if success_criteria:
        range_match = re.search(r"between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s*(?:%|percent)?", success_criteria, re.IGNORECASE)
        greater_match = re.search(r"(?:>=|at least|minimum)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)?", success_criteria, re.IGNORECASE)

        metric_match = re.search(r"(?:accuracy|score|metric|val_acc)[^0-9\n\r]*?(\d+(?:\.\d+)?)\s*%", stdout_output, re.IGNORECASE)
        
        if metric_match:
            achieved = float(metric_match.group(1))
            verification_details["numeric_metric_achieved"] = achieved

            if range_match:
                low, high = float(range_match.group(1)), float(range_match.group(2))
                if not (low <= achieved <= high):
                    return False, f"Verification failed: Achieved accuracy {achieved}% is outside target range [{low}%, {high}%].", verification_details
            elif greater_match:
                min_target = float(greater_match.group(1))
                if achieved < min_target:
                    return False, f"Verification failed: Achieved accuracy {achieved}% is below target {min_target}%.", verification_details

    # 4. Granular Task-Type Specific Verification (TASK_TYPES.md)
    task_type = task.get("task_type", "document")
    file_extensions = [f.suffix.lower() for f in produced_files]
    file_names = [f.name.lower() for f in produced_files]

    # Presentation: Verify .pptx file produced & exact slide count check
    if task_type == "presentation":
        pptx_files = [f for f in produced_files if f.suffix.lower() == ".pptx"]
        if not pptx_files and ".pdf" not in file_extensions:
            return False, "Verification failed: Presentation task did not produce a valid .pptx slide deck.", verification_details
        
        # Check explicit slide count target if specified
        slide_count_req = None
        reqs = task.get("extracted_requirements")
        if isinstance(reqs, dict):
            slide_count_req = reqs.get("slide_count")
        if not slide_count_req and success_criteria:
            m = re.search(r"(\d+)[\s-]*(?:slide|slides)", success_criteria, re.IGNORECASE)
            if m:
                slide_count_req = int(m.group(1))
        if not slide_count_req and task.get("title"):
            m = re.search(r"(\d+)[\s-]*(?:slide|slides)", task["title"], re.IGNORECASE)
            if m:
                slide_count_req = int(m.group(1))
                
        if slide_count_req and pptx_files:
            actual_slide_count = None
            try:
                from pptx import Presentation
                prs = Presentation(str(pptx_files[0]))
                actual_slide_count = len(prs.slides)
            except Exception:
                m_out = re.search(r"(\d+)\s+slides", stdout_output, re.IGNORECASE)
                if m_out:
                    actual_slide_count = int(m_out.group(1))
            
            if actual_slide_count is not None and actual_slide_count != slide_count_req:
                return False, f"Verification failed: Generated slide count ({actual_slide_count}) does not match required slide count ({slide_count_req}).", verification_details

    # Handwritten vs Typed Document verification
    is_handwritten = (
        task_type == "handwritten" or 
        (isinstance(task.get("extracted_requirements"), dict) and task["extracted_requirements"].get("output_style") == "handwritten") or
        bool(re.search(r"handwritten|by hand|copy-ready", task.get("title", ""), re.IGNORECASE))
    )
    if is_handwritten:
        has_docx_or_pdf = any(ext in {".docx", ".pdf"} for ext in file_extensions)
        has_text_file = any(ext in {".txt", ".md"} for ext in file_extensions)
        if has_docx_or_pdf and not has_text_file:
            return False, "Verification failed: Handwritten-style request must produce clean copy-ready text (.txt/.md), not formatted binary files (.docx/.pdf).", verification_details

    # ML Training: Verify model weights artifact (.h5, .pt, .pth, .pkl, .joblib, .onnx, .keras)
    if task_type == "ml_training":
        weights_exts = {".h5", ".pt", ".pth", ".pkl", ".joblib", ".onnx", ".keras"}
        has_weights = any(ext in weights_exts for ext in file_extensions)
        if not has_weights:
            if not any("model" in fn or "weight" in fn for fn in file_names):
                return False, "Verification failed: ML Training task missing model weights/artifact file (.h5, .pt, .pkl, etc.).", verification_details

    # Code Project: Verify README.md exists and UI screenshot if GUI/web app
    if task_type == "code_project":
        has_readme = any("readme" in fn for fn in file_names)
        if not has_readme and len(produced_files) > 1:
            verification_details["assumptions"].append("Auto-documented project entry points in absence of separate README.")
        
        reqs = task.get("extracted_requirements")
        requires_ss = False
        if isinstance(reqs, dict):
            requires_ss = reqs.get("requires_screenshot", False)
        if not requires_ss:
            title_and_crit = f"{task.get('title', '')} {success_criteria or ''} {stdout_output}"
            requires_ss = bool(re.search(r"web app|gui|dashboard|frontend|preview|screenshot", title_and_crit, re.IGNORECASE))
        
        if requires_ss and success_criteria and re.search(r"screenshot|preview", success_criteria, re.IGNORECASE):
            has_screenshot = any(ext in {".png", ".jpg", ".jpeg", ".webp"} for ext in file_extensions)
            if not has_screenshot:
                return False, "Verification failed: Code project is missing required UI preview screenshot (.png/.webp).", verification_details

    # Research: Verify citations or sources
    if task_type == "research":
        has_citations = bool(re.search(r"citation|cited|references|ieee|apa|mla|http|xplore|nist|arxiv|doi", stdout_output, re.IGNORECASE))
        if not has_citations and not any(ext in {".docx", ".pdf", ".md"} for ext in file_extensions):
            return False, "Verification failed: Research task did not include citations or verified reference sources.", verification_details

    # Spreadsheet / Data Analysis: Verify .xlsx workbook
    is_spreadsheet = (
        (isinstance(task.get("extracted_requirements"), dict) and task["extracted_requirements"].get("is_spreadsheet", False)) or
        bool(re.search(r"spreadsheet|excel|\.xlsx|workbook", task.get("title", ""), re.IGNORECASE))
    )
    if is_spreadsheet and task_type in {"document", "code_project"}:
        if ".xlsx" not in file_extensions and not any("excel" in fn or "sheet" in fn or "data" in fn for fn in file_names):
            return False, "Verification failed: Spreadsheet task did not produce a formatted .xlsx workbook.", verification_details

    # 5. Tone & Quality Check (PROMPT_AND_OUTPUT_STANDARDS.md Section 2 & 4)
    # Flag generic AI-sounding filler phrasing
    ai_filler_patterns = [
        r"in today's fast-paced world",
        r"in today's digital era",
        r"delve into the intricacies",
        r"it is important to note that",
        r"as an ai language model",
    ]
    for pattern in ai_filler_patterns:
        if re.search(pattern, stdout_output, re.IGNORECASE):
            return False, f"Verification failed: Output violates academic tone standards (detected generic AI filler phrase matching '{pattern}').", verification_details

    # 6. Format result summary
    summary_parts = [
        f"Produced {len(produced_files)} deliverable file(s): {', '.join([f.name for f in produced_files])}."
    ]
    if verification_details["numeric_metric_achieved"] is not None:
        summary_parts.append(f"Metric achieved: {verification_details['numeric_metric_achieved']}%.")
    if verification_details["assumptions"]:
        summary_parts.append(f"Assumptions noted: {'; '.join(verification_details['assumptions'])}.")

    verification_details["passed"] = True
    return True, " ".join(summary_parts), verification_details


def verify_build(task: Dict[str, Any], stdout_output: str, produced_files: List[Path]) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Verification Phase with Supabase state update (PRD Section 6.4).
    """
    task_id = task["id"]
    try:
        sb = get_supabase()
        sb.table("tasks").update({
            "status": "verifying",
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }).eq("id", task_id).execute()
    except Exception as e:
        print(f"[Worker] Could not update status to verifying: {e}")

    return perform_verification_check(task, stdout_output, produced_files)


def get_google_credentials():
    """Get authenticated Google OAuth2 credentials from .env."""
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
    refresh_token = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN")
    if client_id and client_secret and refresh_token:
        try:
            from google.oauth2.credentials import Credentials
            return Credentials(
                token=None,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret,
            )
        except Exception as e:
            print(f"[GoogleAuth] Could not create credentials: {e}")
    return None


def upload_to_drive(creds, course: str, task_id: str, file_path: Path) -> Optional[str]:
    """Upload deliverable to Google Drive folder structure: Agent Outputs/<course>/ and set public reader permission."""
    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload

        drive_service = build('drive', 'v3', credentials=creds)
        parent_folder_id = DRIVE_OUTPUT_FOLDER_ID

        # 1. Create or get course folder
        course_q = f"mimeType='application/vnd.google-apps.folder' and name='{course}' and '{parent_folder_id}' in parents and trashed=false"
        res = drive_service.files().list(q=course_q, fields="files(id, name)").execute()
        files = res.get('files', [])
        if files:
            course_folder_id = files[0]['id']
        else:
            meta = {'name': course, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [parent_folder_id]}
            folder = drive_service.files().create(body=meta, fields='id').execute()
            course_folder_id = folder.get('id')

        # 2. Upload file
        media = MediaFileUpload(str(file_path), resumable=True)
        file_meta = {'name': file_path.name, 'parents': [course_folder_id]}
        uploaded = drive_service.files().create(body=file_meta, media_body=media, fields='id, webViewLink').execute()
        file_id = uploaded.get('id')

        # 3. Grant 'anyone with link can view' permission so links open without access denied errors
        try:
            drive_service.permissions().create(
                fileId=file_id,
                body={'type': 'anyone', 'role': 'reader'},
                fields='id'
            ).execute()
        except Exception as perm_err:
            print(f"[DriveUpload-PermWarning] Could not set public permission: {perm_err}")

        return f"https://drive.google.com/file/d/{file_id}/view?usp=sharing"
    except Exception as e:
        print(f"[DriveUpload-Warning] Could not upload to Drive: {e}")
        return None


def create_calendar_deadline_event(creds, task: Dict[str, Any]) -> None:
    """Create Google Calendar deadline event with 24h email reminder override in IST (PRD 6.5)."""
    due_date_str = task.get("due_date")
    if not due_date_str:
        return
    try:
        from googleapiclient.discovery import build
        calendar_service = build('calendar', 'v3', credentials=creds)
        
        due_dt = datetime.datetime.fromisoformat(due_date_str.replace("Z", "+00:00")).astimezone(TARGET_TZ)
        start_time = (due_dt - datetime.timedelta(hours=1)).isoformat()
        end_time = due_dt.isoformat()

        event_body = {
            'summary': f"📚 Due: {task['title']}",
            'description': f"Course: {task.get('course', 'General')}\nDeliverable prepared by Vicarius Agent.",
            'start': {'dateTime': start_time, 'timeZone': TIMEZONE_STR},
            'end': {'dateTime': end_time, 'timeZone': TIMEZONE_STR},
            'reminders': {
                'useDefault': False,
                'overrides': [
                    {'method': 'email', 'minutes': 24 * 60}, # 24h before
                    {'method': 'popup', 'minutes': 60}
                ]
            }
        }
        calendar_service.events().insert(calendarId='primary', body=event_body).execute()
        print(f"[Calendar] Created deadline event for '{task['title']}' with 24h reminder.")
    except Exception as e:
        print(f"[Calendar-Warning] Could not create calendar event: {e}")


def deliver_and_track(task: Dict[str, Any], produced_files: List[Path], result_summary: str) -> None:
    """
    Deliver & Track Phase (PRD Section 6.5 & TASK_TYPES.md):
    1. Upload to Google Drive (with clean zipped project for code tasks)
    2. Write deliverables row
    3. Send via Telegram (including inline screenshots for UI code projects) & Gmail
    4. Create Google Task & Google Calendar event with 24h reminder
    5. Set status = 'done'
    """
    import html
    task_id = task["id"]
    course = task.get("course") or "General"
    task_type = task.get("task_type", "document")
    sb = get_supabase()
    creds = get_google_credentials()
    task_work_dir = BASE_WORK_DIR / task_id

    # If code project, ensure clean project.zip exists
    final_files = list(produced_files)
    if task_type == "code_project":
        has_zip = any(f.suffix.lower() == ".zip" for f in final_files)
        if not has_zip and task_work_dir.exists():
            clean_zip = package_code_project(task_work_dir)
            if clean_zip and clean_zip.exists():
                final_files.append(clean_zip)

    html_links = []
    screenshot_file: Optional[Path] = None

    # 1. Upload to Google Drive and record deliverables
    for f in final_files:
        file_ext = f.suffix.lstrip(".").lower()
        if file_ext in {"png", "jpg", "jpeg", "webp"} and not screenshot_file:
            screenshot_file = f

        drive_link = None
        if creds and DRIVE_OUTPUT_FOLDER_ID:
            drive_link = upload_to_drive(creds, course, task_id, f)
            if drive_link:
                html_links.append(f"• <a href=\"{drive_link}\">{html.escape(f.name)}</a>")
            else:
                html_links.append(f"• <code>{html.escape(f.name)}</code>")
        else:
            html_links.append(f"• <code>{html.escape(f.name)}</code>")

        sb.table("deliverables").insert({
            "task_id": task_id,
            "file_name": f.name,
            "file_type": file_ext,
            "drive_link": drive_link,
            "delivered_via": "both",
        }).execute()

    # 2. Schedule Calendar deadline event with 24h reminder override
    if creds:
        create_calendar_deadline_event(creds, task)

    # 3. Send completion alert via Telegram
    links_text = "\n".join(html_links) if html_links else "Saved locally in working directory."
    summary_msg = (
        f"🎉 <b>Task Completed:</b> {html.escape(task['title'])}\n"
        f"<b>Course:</b> {html.escape(course)}\n"
        f"<b>Output Files:</b> {html.escape(', '.join([f.name for f in final_files]))}\n\n"
        f"<b>Drive Links:</b>\n{links_text}\n\n"
        f"<b>Summary:</b> {html.escape(result_summary)}\n\n"
        f"✅ <i>Deliverables are ready for your manual submission.</i>"
    )
    send_telegram_notification(summary_msg)

    # If a screenshot was generated (e.g. for web/UI apps), dispatch photo to Telegram
    if screenshot_file and screenshot_file.exists():
        send_telegram_photo(screenshot_file, caption=f"📸 <b>UI Preview:</b> {html.escape(task['title'])}")

    # 4. Mark task done in Supabase
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    sb.table("tasks").update({
        "status": "done",
        "result_summary": result_summary,
        "updated_at": now_iso,
    }).eq("id", task_id).execute()

    log_system_event("info", "worker", f"Task '{task['title']}' (ID: {task_id}) successfully built, verified, and delivered.")


def handle_task_failure(task: Dict[str, Any], error_message: str) -> None:
    """Flags task on persistent failure and alerts the user (PRD Section 6.3 / 6.4)."""
    import html
    task_id = task["id"]
    sb = get_supabase()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    sb.table("tasks").update({
        "status": "flagged",
        "result_summary": f"Build/Verification failed: {error_message}",
        "updated_at": now_iso,
    }).eq("id", task_id).execute()

    alert_msg = (
        f"⚠️ <b>Task Flagged / Stopped:</b> {html.escape(task['title'])}\n"
        f"<b>Course:</b> {html.escape(task.get('course') or 'Unknown')}\n"
        f"<b>Error:</b> {html.escape(error_message)}\n\n"
        f"<i>Please check the dashboard to retry or inspect logs.</i>"
    )
    send_telegram_notification(alert_msg)
    log_system_event("error", "worker", f"Task '{task['title']}' flagged after retry failure: {error_message}")
    log_system_event("error", "worker", f"Task '{task['title']}' flagged after retry failure: {error_message}")


def run_worker_cycle() -> bool:
    """Runs a single worker polling cycle."""
    set_below_normal_priority()

    # Step 1: Verify Antigravity CLI version
    if not check_antigravity_cli_version():
        return False

    # Step 2: Claim next queued task
    task = claim_next_task()
    if not task:
        return False

    print(f"\n[Worker] Claimed task: {task['title']} (Due: {task.get('due_date')})")

    # Step 3: Check system load & concurrency
    if not check_system_load_and_concurrency(task.get("due_date")):
        # Return task back to queued
        sb = get_supabase()
        sb.table("tasks").update({
            "status": "queued",
            "worker_id": None,
            "claimed_at": None,
        }).eq("id", task["id"]).execute()
        return False

    # Step 4: Execute build (with 1 automatic retry on failure)
    success, stdout_output, produced_files = execute_build(task, retry_count=0)
    
    if not success or len(produced_files) == 0:
        print(f"[Worker] Initial build failed. Attempting 1 automatic retry (PRD Section 6.3)...")
        time.sleep(2)
        success, stdout_output, produced_files = execute_build(task, retry_count=1)

    if not success or len(produced_files) == 0:
        handle_task_failure(task, f"Subprocess exited with failure or no files generated. Output snippet: {stdout_output[:300]}")
        return True

    # Step 5: Verify build
    verified, summary, details = verify_build(task, stdout_output, produced_files)
    if not verified:
        print(f"[Worker] Verification failed. Attempting 1 retry with verification feedback...")
        success, stdout_output, produced_files = execute_build(task, retry_count=1)
        if success:
            verified, summary, details = verify_build(task, stdout_output, produced_files)

    if not verified:
        handle_task_failure(task, summary)
        return True

    # Step 6: Deliver & Track
    deliver_and_track(task, produced_files, summary)
    return True


if __name__ == "__main__":
    print(f"=== Vicarius Agent Local Worker Started ===")
    print(f"Timezone: {TIMEZONE_STR} | Pinned CLI: {PINNED_AGY_VERSION} | Timeout: {JOB_TIMEOUT_MINUTES}m")
    
    # Run a cycle
    run_worker_cycle()
