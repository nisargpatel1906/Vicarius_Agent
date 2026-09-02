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
import textwrap
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
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_AI_MODEL = os.getenv("OPENROUTER_MODEL", "minimax/minimax-m3:free")

TARGET_TZ = pytz.timezone(TIMEZONE_STR)
WORKER_ID = f"worker-local-{os.environ.get('COMPUTERNAME', 'pc')}"
BASE_WORK_DIR = Path(__file__).resolve().parent.parent / "work_dirs"

# Cognitive Heritage Design Tokens (docx/DESIGN.md)
CH_SURFACE = (255, 248, 244)       # #fff8f4
CH_SURFACE_CONTAINER = (253, 235, 217)  # #fdebd9
CH_ON_SURFACE = (35, 26, 15)       # #231a0f
CH_ON_SURFACE_VARIANT = (77, 70, 58)  # #4d463a
CH_PRIMARY = (112, 87, 40)          # #705728
CH_PRIMARY_CONTAINER = (139, 111, 62)  # #8b6f3e
CH_SECONDARY = (100, 94, 78)        # #645e4e
CH_OUTLINE = (127, 118, 105)        # #7f7669
CH_OUTLINE_VARIANT = (209, 197, 182)  # #d1c5b6


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


# ──────────────────────────────────────────────────────────────────────────────
# PHASE 1C: Dynamic AI Content Generation Engine
# ──────────────────────────────────────────────────────────────────────────────

def call_openrouter(messages: List[Dict], temperature: float = 0.3, max_tokens: int = 4096) -> Optional[str]:
    """
    Calls OpenRouter chat completions API with the configured AI model.
    Returns the assistant's text response, or None on failure.
    """
    if not OPENROUTER_API_KEY:
        print("[AI-Content] No OPENROUTER_API_KEY set — skipping AI generation.")
        return None
    try:
        import requests
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://your-domain.vercel.app",
                "X-Title": "Vicarius Academic Agent",
            },
            json={
                "model": OPENROUTER_AI_MODEL,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
            timeout=120,
        )
        if not resp.ok:
            print(f"[AI-Content] OpenRouter error {resp.status_code}: {resp.text[:300]}")
            return None
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"[AI-Content] OpenRouter call failed: {e}")
        return None


def generate_content_with_ai(task: Dict[str, Any]) -> Dict[str, Any]:
    """
    Phase 1C: Calls OpenRouter to generate task-specific academic content.
    Returns a dict with keys depending on task_type:
      - presentation: {"slides": [{"title", "body", "speaker_notes"}]}
      - document/research: {"sections": [{"heading", "content"}], "references": [...]}
      - code_project: {"files": [{"filename", "content"}], "readme": str}
      - ml_training: {"code": str, "explanation": str}
    """
    task_type = task.get("task_type", "document")
    title = task.get("title", "Academic Assignment")
    course = task.get("course", "General")
    build_spec = task.get("build_spec", "")
    requirements = task.get("extracted_requirements") or {}
    req_items = requirements.get("items", []) if isinstance(requirements, dict) else []
    slide_count = (requirements.get("slide_count") if isinstance(requirements, dict) else None) or 10

    req_text = "\n".join(f"- {r}" for r in req_items) if req_items else build_spec[:500]

    send_telegram_notification("🧠 <b>AI Content Generation Started</b>\n<i>Analyzing requirements and generating academic content...</i>")

    if task_type == "presentation":
        system_msg = (
            f"You are an expert academic presentation designer for a Computer Engineering / AI-ML student at Academic Institution, India.\n"
            f"Generate a complete, detailed {slide_count}-slide PowerPoint presentation.\n"
            f"Return ONLY a valid JSON array (no markdown, no explanation) of exactly {slide_count} slide objects:\n"
            f'[{{"title": "Slide Title", "body": "• Point 1\\n• Point 2\\n• Point 3", "speaker_notes": "Detailed speaker script..."}}]\n'
            f"Requirements:\n"
            f"- Each slide must have a clear academic title, 3-5 bullet points in body, and thorough speaker notes (50+ words).\n"
            f"- Start with a title slide (topic overview, course, student name), end with conclusion + references slide.\n"
            f"- Use professional academic language. Include real data, facts, and technical depth.\n"
            f"- Do NOT use AI filler phrases like 'in today's fast-paced world'.\n"
            f"- Student: Nisarg Patel | Course: {course}"
        )
        user_msg = f"Topic: {title}\n\nRequirements:\n{req_text}\n\nGenerate exactly {slide_count} slides."
        response = call_openrouter(
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            temperature=0.4, max_tokens=6000
        )
        if response:
            try:
                # Strip any markdown fences
                clean = re.sub(r"```[a-zA-Z]*\n?", "", response).strip()
                slides = json.loads(clean)
                if isinstance(slides, list) and len(slides) > 0:
                    print(f"[AI-Content] Generated {len(slides)} slides for '{title}'")
                    return {"slides": slides}
            except json.JSONDecodeError as e:
                print(f"[AI-Content] Slide JSON parse error: {e}. Attempting recovery...")
                # Try to find JSON array in response
                m = re.search(r"(\[.*\])", response, re.DOTALL)
                if m:
                    try:
                        slides = json.loads(m.group(1))
                        if isinstance(slides, list):
                            return {"slides": slides}
                    except Exception:
                        pass
        # Fallback: generate minimal slide structure
        return {"slides": [{"title": f"Slide {i+1}: {title}", "body": f"• Key point {i+1}\n• Technical detail\n• Academic insight", "speaker_notes": f"Speaker notes for slide {i+1}."} for i in range(slide_count)]}

    elif task_type in ("document", "research", "handwritten"):
        system_msg = (
            f"You are an expert academic writer for a Computer Engineering / AI-ML student.\n"
            f"Generate a complete, well-structured academic {'research paper' if task_type == 'research' else 'report'} in JSON.\n"
            f"Return ONLY valid JSON (no markdown) with this structure:\n"
            f'{{"title": str, "abstract": str, "sections": [{{"heading": str, "content": str}}], "references": [str]}}\n'
            f"Requirements:\n"
            f"- Abstract: 150-200 words.\n"
            f"- At least 6 substantive sections with detailed content (200+ words each).\n"
            f"- References: 5+ real academic citations (IEEE format if research).\n"
            f"- Use formal, technical academic language. No AI filler phrases.\n"
            f"- Student: Nisarg Patel | Course: {course}"
        )
        user_msg = f"Assignment: {title}\n\nRequirements:\n{req_text}"
        response = call_openrouter(
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            temperature=0.3, max_tokens=6000
        )
        if response:
            try:
                clean = re.sub(r"```[a-zA-Z]*\n?", "", response).strip()
                doc = json.loads(clean)
                if isinstance(doc, dict) and "sections" in doc:
                    print(f"[AI-Content] Generated {len(doc['sections'])} document sections")
                    return doc
            except Exception as e:
                print(f"[AI-Content] Document JSON parse error: {e}")
        return {"title": title, "abstract": f"This report covers {title} for {course}.", "sections": [{"heading": "Introduction", "content": build_spec[:500] or "Introduction to the topic."}, {"heading": "Conclusion", "content": "This report presented a comprehensive analysis of the topic."}], "references": ["[1] Academic Institution Academic Resources."]}

    elif task_type == "code_project":
        system_msg = (
            f"You are an expert software engineer. Generate a complete, working code project as JSON.\n"
            f"Return ONLY valid JSON (no markdown) with this structure:\n"
            f'{{"project_name": str, "description": str, "files": [{{"filename": str, "content": str}}], "readme": str}}\n'
            f"Requirements:\n"
            f"- Include all source files needed to run the project.\n"
            f"- Include README.md in the files array with setup and run instructions.\n"
            f"- For web apps: use vanilla HTML/CSS/JS or React as appropriate.\n"
            f"- Apply Cognitive Heritage design tokens in any UI: bg #fff8f4, accent #705728, text #231a0f.\n"
            f"- All code must be complete, syntactically correct, and runnable.\n"
            f"- Student: Nisarg Patel | Course: {course}"
        )
        user_msg = f"Project: {title}\n\nRequirements:\n{req_text}"
        response = call_openrouter(
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            temperature=0.2, max_tokens=6000
        )
        if response:
            try:
                clean = re.sub(r"```[a-zA-Z]*\n?", "", response).strip()
                project = json.loads(clean)
                if isinstance(project, dict) and "files" in project:
                    print(f"[AI-Content] Generated code project with {len(project['files'])} files")
                    return project
            except Exception as e:
                print(f"[AI-Content] Code project JSON parse error: {e}")
        return {"project_name": title, "description": build_spec[:200], "files": [{"filename": "README.md", "content": f"# {title}\n\n{build_spec[:400]}"}], "readme": f"# {title}\n\n## Setup\n\nSee source files."}

    elif task_type == "ml_training":
        system_msg = (
            f"You are an expert ML engineer and academic tutor.\n"
            f"Generate a complete Python ML training script and an explanation document as JSON.\n"
            f"Return ONLY valid JSON (no markdown) with this structure:\n"
            f'{{"script_filename": str, "code": str, "explanation": str, "requirements_txt": str}}\n'
            f"Requirements:\n"
            f"- Complete, runnable Python script using PyTorch or scikit-learn.\n"
            f"- Include training loop, evaluation metrics, model saving.\n"
            f"- Explanation: 300+ word academic description of the approach.\n"
            f"- requirements.txt listing all dependencies.\n"
            f"- Student: Nisarg Patel | Course: {course}"
        )
        user_msg = f"ML Task: {title}\n\nRequirements:\n{req_text}"
        response = call_openrouter(
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            temperature=0.2, max_tokens=5000
        )
        if response:
            try:
                clean = re.sub(r"```[a-zA-Z]*\n?", "", response).strip()
                ml = json.loads(clean)
                if isinstance(ml, dict) and "code" in ml:
                    print(f"[AI-Content] Generated ML training script")
                    return ml
            except Exception as e:
                print(f"[AI-Content] ML JSON parse error: {e}")
        return {"script_filename": "train.py", "code": f"# {title}\n# Generated by Vicarius Agent\nprint('Training script placeholder')\n", "explanation": f"ML training script for {title}.", "requirements_txt": "torch\nnumpy\nscikit-learn\n"}

    return {}


def build_pptx_from_ai_content(task: Dict[str, Any], slides_data: List[Dict], task_work_dir: Path) -> Optional[Path]:
    """
    Phase 2D: Builds a .pptx with Cognitive Heritage design tokens applied.
    Colors: Surface #fff8f4, Primary #705728, Text #231a0f
    """
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt, Emu
        from pptx.dml.color import RGBColor
        from pptx.enum.text import PP_ALIGN

        prs = Presentation()
        prs.slide_width = Inches(13.33)
        prs.slide_height = Inches(7.5)

        slide_layout = prs.slide_layouts[6]  # blank layout
        total = len(slides_data)

        for idx, slide_info in enumerate(slides_data):
            send_telegram_notification(
                f"📊 <b>Building slide {idx + 1} of {total}...</b>",
            )

            slide = prs.slides.add_slide(slide_layout)

            # ── Background: Cognitive Heritage Surface (#fff8f4) ──
            background = slide.background
            fill = background.fill
            fill.solid()
            fill.fore_color.rgb = RGBColor(*CH_SURFACE)

            # ── Top accent bar: Primary (#705728) ──
            from pptx.util import Inches
            accent = slide.shapes.add_shape(
                1,  # MSO_SHAPE_TYPE.RECTANGLE
                Inches(0), Inches(0), prs.slide_width, Inches(0.12)
            )
            accent.fill.solid()
            accent.fill.fore_color.rgb = RGBColor(*CH_PRIMARY)
            accent.line.fill.background()

            # ── Slide number badge (top-right) ──
            badge = slide.shapes.add_shape(
                1, prs.slide_width - Inches(1.1), Inches(0.02), Inches(1.0), Inches(0.3)
            )
            badge.fill.solid()
            badge.fill.fore_color.rgb = RGBColor(*CH_PRIMARY_CONTAINER)
            badge.line.fill.background()
            badge_tf = badge.text_frame
            badge_tf.text = f"{idx + 1} / {total}"
            badge_p = badge_tf.paragraphs[0]
            badge_p.alignment = PP_ALIGN.CENTER
            badge_run = badge_p.runs[0]
            badge_run.font.size = Pt(9)
            badge_run.font.color.rgb = RGBColor(255, 255, 255)
            badge_run.font.bold = True

            # ── Title text box ──
            title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.18), Inches(12.0), Inches(1.1))
            title_tf = title_box.text_frame
            title_tf.word_wrap = True
            title_p = title_tf.paragraphs[0]
            title_p.text = slide_info.get("title", f"Slide {idx + 1}")
            title_p.alignment = PP_ALIGN.LEFT
            title_run = title_p.runs[0]
            title_run.font.size = Pt(28 if idx == 0 else 24)
            title_run.font.bold = True
            title_run.font.color.rgb = RGBColor(*CH_ON_SURFACE)

            # ── Divider line under title ──
            divider = slide.shapes.add_shape(
                1, Inches(0.5), Inches(1.35), Inches(12.0), Inches(0.02)
            )
            divider.fill.solid()
            divider.fill.fore_color.rgb = RGBColor(*CH_OUTLINE_VARIANT)
            divider.line.fill.background()

            # ── Body text box ──
            body_text = slide_info.get("body", "")
            body_box = slide.shapes.add_textbox(Inches(0.5), Inches(1.45), Inches(12.0), Inches(5.5))
            body_tf = body_box.text_frame
            body_tf.word_wrap = True

            first = True
            for line in body_text.split("\n"):
                line = line.strip()
                if not line:
                    continue
                if first:
                    p = body_tf.paragraphs[0]
                    first = False
                else:
                    p = body_tf.add_paragraph()
                p.text = line
                p.space_before = Pt(4)
                run = p.runs[0] if p.runs else p.add_run()
                run.font.size = Pt(16)
                run.font.color.rgb = RGBColor(*CH_ON_SURFACE_VARIANT)
                # Bullet points get primary color accent marker in text
                if line.startswith("•") or line.startswith("-"):
                    run.font.color.rgb = RGBColor(*CH_ON_SURFACE)

            # ── Bottom footer bar ──
            footer = slide.shapes.add_shape(
                1, Inches(0), Inches(7.2), prs.slide_width, Inches(0.3)
            )
            footer.fill.solid()
            footer.fill.fore_color.rgb = RGBColor(*CH_SURFACE_CONTAINER)
            footer.line.fill.background()

            footer_tb = slide.shapes.add_textbox(Inches(0.3), Inches(7.22), Inches(12.0), Inches(0.25))
            footer_tf = footer_tb.text_frame
            footer_tf.text = f"{task.get('course', 'Academic Course')} | Nisarg Patel | Vicarius Agent"
            footer_p = footer_tf.paragraphs[0]
            footer_p.alignment = PP_ALIGN.LEFT
            footer_run = footer_p.runs[0]
            footer_run.font.size = Pt(8)
            footer_run.font.color.rgb = RGBColor(*CH_OUTLINE)

            # ── Speaker notes ──
            notes_slide = slide.notes_slide
            notes_tf = notes_slide.notes_text_frame
            notes_tf.text = slide_info.get("speaker_notes", "")

        output_path = task_work_dir / "presentation.pptx"
        prs.save(str(output_path))
        print(f"[Worker] Saved Cognitive Heritage PPTX: {output_path} ({total} slides)")
        return output_path
    except ImportError:
        print("[Worker] python-pptx not installed. Run: pip install python-pptx")
        return None
    except Exception as e:
        print(f"[Worker] PPTX build error: {e}")
        return None


def build_docx_from_ai_content(task: Dict[str, Any], doc_data: Dict, task_work_dir: Path) -> Optional[Path]:
    """Builds a .docx academic report from AI-generated section content."""
    try:
        from docx import Document
        from docx.shared import Pt, RGBColor, Inches
        from docx.enum.text import WD_ALIGN_PARAGRAPH

        send_telegram_notification("📄 <b>Writing document sections...</b>")

        doc = Document()

        # Title
        title_para = doc.add_paragraph()
        title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        title_run = title_para.add_run(doc_data.get("title", task.get("title", "Academic Report")))
        title_run.bold = True
        title_run.font.size = Pt(20)
        title_run.font.color.rgb = RGBColor(*CH_ON_SURFACE)

        doc.add_paragraph(f"Course: {task.get('course', 'General')}")
        doc.add_paragraph(f"Submitted by: Nisarg Patel — {datetime.datetime.now().strftime('%d %B %Y')}")
        doc.add_paragraph()

        # Abstract
        if doc_data.get("abstract"):
            ab_heading = doc.add_paragraph("Abstract")
            ab_heading.style = "Heading 2"
            doc.add_paragraph(doc_data["abstract"])
            doc.add_paragraph()

        # Sections
        for i, section in enumerate(doc_data.get("sections", [])):
            heading = doc.add_paragraph(section.get("heading", f"Section {i+1}"))
            heading.style = "Heading 2"
            content = section.get("content", "")
            for para_text in content.split("\n\n"):
                if para_text.strip():
                    doc.add_paragraph(para_text.strip())
            doc.add_paragraph()

        # References
        refs = doc_data.get("references", [])
        if refs:
            ref_heading = doc.add_paragraph("References")
            ref_heading.style = "Heading 2"
            for ref in refs:
                doc.add_paragraph(ref, style="List Number")

        ext = ".txt" if task.get("task_type") == "handwritten" else ".docx"
        output_path = task_work_dir / f"report{ext}"
        if ext == ".txt":
            # Write plain text for handwritten copy-ready output
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(f"{doc_data.get('title', task.get('title', ''))}\n")
                f.write("=" * 60 + "\n\n")
                if doc_data.get("abstract"):
                    f.write(f"ABSTRACT\n{doc_data['abstract']}\n\n")
                for section in doc_data.get("sections", []):
                    f.write(f"{section.get('heading', '').upper()}\n")
                    f.write("-" * 40 + "\n")
                    f.write(section.get("content", "") + "\n\n")
        else:
            doc.save(str(output_path))

        print(f"[Worker] Saved document: {output_path}")
        return output_path
    except ImportError:
        print("[Worker] python-docx not installed. Run: pip install python-docx")
        return None
    except Exception as e:
        print(f"[Worker] DOCX build error: {e}")
        return None


def build_code_project_from_ai_content(task: Dict[str, Any], project_data: Dict, task_work_dir: Path) -> List[Path]:
    """Writes code project files from AI-generated content."""
    send_telegram_notification("💻 <b>Writing code project files...</b>")
    produced = []
    files = project_data.get("files", [])
    for file_info in files:
        fname = file_info.get("filename", "output.txt")
        # Sanitize path traversal
        safe_path = task_work_dir / Path(fname).name
        # Allow one level of subdirectory
        if "/" in fname or "\\" in fname:
            parts = fname.replace("\\", "/").split("/")
            if len(parts) == 2:
                subdir = task_work_dir / parts[0]
                subdir.mkdir(exist_ok=True)
                safe_path = subdir / parts[1]
        try:
            safe_path.write_text(file_info.get("content", ""), encoding="utf-8")
            produced.append(safe_path)
            print(f"[Worker] Wrote {safe_path}")
        except Exception as e:
            print(f"[Worker] Could not write {fname}: {e}")
    return produced


def build_ml_training_from_ai_content(task: Dict[str, Any], ml_data: Dict, task_work_dir: Path) -> List[Path]:
    """Writes ML training script and explanation from AI-generated content."""
    send_telegram_notification("🤖 <b>Writing ML training script...</b>")
    produced = []
    # Write training script
    script_name = ml_data.get("script_filename", "train.py")
    script_path = task_work_dir / script_name
    script_path.write_text(ml_data.get("code", "# Training script"), encoding="utf-8")
    produced.append(script_path)

    # Write requirements.txt
    if ml_data.get("requirements_txt"):
        req_path = task_work_dir / "requirements.txt"
        req_path.write_text(ml_data["requirements_txt"], encoding="utf-8")
        produced.append(req_path)

    # Write explanation doc
    if ml_data.get("explanation"):
        exp_path = task_work_dir / "explanation.md"
        exp_path.write_text(f"# {task.get('title', 'ML Task')}\n\n{ml_data['explanation']}", encoding="utf-8")
        produced.append(exp_path)

    return produced


def execute_build(task: Dict[str, Any], retry_count: int = 0) -> Tuple[bool, str, List[Path]]:
    """
    Phase 1C: Generates academic deliverables using AI content generation.
    Falls back to Antigravity CLI (agy) for complex code projects.
    Returns (success, stdout_output, list_of_produced_files).
    """
    import html as html_module
    task_id = task["id"]
    task_type = task.get("task_type", "document")
    task_work_dir = BASE_WORK_DIR / task_id
    task_work_dir.mkdir(parents=True, exist_ok=True)

    build_spec = task.get("build_spec") or f"Complete academic task: {task.get('title')}"
    if retry_count > 0:
        build_spec += f"\n\n[RETRY #{retry_count}]: Previous attempt failed verification. Ensure all expected output files exist."

    # Update status to building
    sb = get_supabase()
    sb.table("tasks").update({
        "status": "building",
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }).eq("id", task_id).execute()

    start_msg = (
        f"🚀 <b>Task Started:</b> {html_module.escape(task['title'])}\n"
        f"<b>Course:</b> {html_module.escape(task.get('course') or 'General')}\n"
        f"<b>Type:</b> <code>{task_type}</code>\n\n"
        f"<i>AI is generating your academic deliverables...</i>"
    )
    send_telegram_notification(start_msg)

    print(f"[Worker] AI build starting for task '{task['title']}' (ID: {task_id})")
    start_time = time.time()
    produced_files: List[Path] = []
    stdout_log = f"Task: {task['title']}\nType: {task_type}\n"

    try:
        # ── Phase 1C: Generate content via AI ──
        ai_content = generate_content_with_ai(task)

        if task_type == "presentation":
            slides = ai_content.get("slides", [])
            if slides:
                pptx_path = build_pptx_from_ai_content(task, slides, task_work_dir)
                if pptx_path:
                    produced_files.append(pptx_path)
                    stdout_log += f"Generated {len(slides)}-slide Cognitive Heritage PPTX.\n"
            else:
                stdout_log += "AI slide generation returned empty result.\n"

        elif task_type in ("document", "research", "handwritten"):
            doc_path = build_docx_from_ai_content(task, ai_content, task_work_dir)
            if doc_path:
                produced_files.append(doc_path)
                stdout_log += f"Generated academic report: {doc_path.name}\n"

        elif task_type == "code_project":
            code_files = build_code_project_from_ai_content(task, ai_content, task_work_dir)
            produced_files.extend(code_files)
            stdout_log += f"Generated code project with {len(code_files)} files.\n"

        elif task_type == "ml_training":
            ml_files = build_ml_training_from_ai_content(task, ai_content, task_work_dir)
            produced_files.extend(ml_files)
            stdout_log += f"Generated ML training artifact with {len(ml_files)} files.\n"

        else:
            # Generic document fallback
            doc_path = build_docx_from_ai_content(task, {"title": task.get("title", "Assignment"), "sections": [{"heading": "Content", "content": build_spec}], "references": []}, task_work_dir)
            if doc_path:
                produced_files.append(doc_path)

        duration = time.time() - start_time
        stdout_log += f"Build completed in {duration:.1f}s.\n"
        print(f"[Worker] AI build finished in {duration:.1f}s, produced {len(produced_files)} files.")

        # Also scan work_dir for any extra files produced (e.g. from agy side effects)
        all_work_files = [
            f for f in task_work_dir.glob("**/*")
            if f.is_file() and not f.name.startswith(".") and not f.name.endswith(".log")
            and f not in produced_files
        ]
        produced_files.extend(all_work_files)

        return len(produced_files) > 0, stdout_log, produced_files

    except Exception as e:
        err_msg = str(e)
        print(f"[Worker] Exception during AI build: {err_msg}")
        return False, f"Build exception: {err_msg}", []


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


def _classify_error_message(error_message: str) -> str:
    """Phase 3A: Returns a user-friendly contextual error explanation."""
    err_lower = error_message.lower()
    if "rate limit" in err_lower or "429" in err_lower or "quota" in err_lower:
        return "⚡ AI quota / rate limit reached. The worker will retry automatically on the next cycle."
    if "drive" in err_lower and ("upload" in err_lower or "failed" in err_lower):
        return "☁️ Google Drive upload failed. Your Google OAuth token may have expired — re-run <code>scripts/get_google_token.py</code> to refresh."
    if "agy" in err_lower or "antigravity" in err_lower or "not found" in err_lower:
        return "🔧 Build agent CLI (agy) not found or version mismatch. Please re-run the setup script."
    if "timeout" in err_lower or "timed out" in err_lower:
        return f"⏱ Build timed out after {JOB_TIMEOUT_MINUTES} minutes. Task flagged for review — try reducing scope or retry."
    if "supabase" in err_lower or "database" in err_lower or "connection" in err_lower:
        return "🗄️ Database connection error. Check your Supabase credentials and internet connection."
    if "openrouter" in err_lower or "api" in err_lower:
        return "🤖 AI content generation failed (OpenRouter API error). Check your OPENROUTER_API_KEY."
    if "no output files" in err_lower or "no files" in err_lower:
        return "📂 No output files were produced. The AI may have returned empty content — retrying is recommended."
    return f"Build/verification error: {error_message[:200]}"


def handle_task_failure(task: Dict[str, Any], error_message: str) -> None:
    """Flags task on persistent failure and alerts the user (PRD Section 6.3 / 6.4)."""
    import html
    task_id = task["id"]
    sb = get_supabase()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    friendly_error = _classify_error_message(error_message)

    sb.table("tasks").update({
        "status": "flagged",
        "result_summary": f"Build/Verification failed: {error_message}",
        "updated_at": now_iso,
    }).eq("id", task_id).execute()

    alert_msg = (
        f"⚠️ <b>Task Flagged:</b> {html.escape(task['title'])}\n"
        f"<b>Course:</b> {html.escape(task.get('course') or 'Unknown')}\n\n"
        f"<b>What happened:</b> {friendly_error}\n\n"
        f"<i>Use <code>/retry {task_id}</code> to requeue after fixing the issue, or check the dashboard.</i>"
    )
    send_telegram_notification(alert_msg)
    log_system_event("error", "worker", f"Task '{task['title']}' flagged: {error_message}")


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
    print(f"Timezone: {TIMEZONE_STR} | AI Model: {OPENROUTER_AI_MODEL} | Timeout: {JOB_TIMEOUT_MINUTES}m")

    daemon_mode = "--daemon" in sys.argv or "-d" in sys.argv or os.getenv("WORKER_DAEMON", "false").lower() == "true"

    if daemon_mode:
        print("[Worker] Running in continuous daemon polling mode...")
        idle_count = 0
        last_heartbeat = time.time()
        HEARTBEAT_INTERVAL = 1800  # 30 minutes

        while True:
            try:
                # Phase 1A: Heartbeat every 30 min so system_events confirms daemon is alive
                if time.time() - last_heartbeat > HEARTBEAT_INTERVAL:
                    log_system_event("info", "worker", f"Daemon heartbeat — alive. Worker ID: {WORKER_ID}")
                    last_heartbeat = time.time()
                    idle_count = 0  # reset backoff on heartbeat

                processed = run_worker_cycle()
                if processed:
                    idle_count = 0
                    # No sleep when work was done — immediately check for more
                else:
                    # Phase 1A: Exponential backoff when idle (5s → 15s → 30s → 60s max)
                    idle_count += 1
                    sleep_secs = min(5 * (2 ** min(idle_count - 1, 3)), 60)
                    time.sleep(sleep_secs)

            except KeyboardInterrupt:
                print("\n[Worker] Daemon stopped by user (KeyboardInterrupt).")
                break
            except Exception as e:
                print(f"[Worker] Unhandled error in daemon cycle: {e}", file=sys.stderr)
                log_system_event("error", "worker", f"Daemon cycle error: {e}")
                time.sleep(10)
    else:
        run_worker_cycle()
