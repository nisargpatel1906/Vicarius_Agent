"""
Vicarius Agent - LangGraph Extractor Node
Inspects the incoming task for attachments or document references.
- Auto-downloads attachments from Telegram via Bot API getFile if file_id is present.
- Discovers referenced documents (.pdf, .docx, .txt) across workspace and common user directories.
- Extracts 100% of the text across all pages using pypdf / python-docx.
- Enriches build_spec with the verbatim document requirements.
- Re-evaluates task weight (upgrading ML, CV, deep learning, and multi-deliverable tasks to 'heavy').
- Re-evaluates task_type (upgrading to 'code_project' for code/notebook requirements).
"""

import os
import re
import json
import shutil
import urllib.request
from pathlib import Path
from typing import Dict, Any, List, Optional
import pypdf

from worker.state import AgentState


def download_telegram_attachment(bot_token: str, file_id: str, dest_path: Path) -> bool:
    """Downloads a file attachment from Telegram Bot API given its file_id."""
    if not bot_token or not file_id:
        return False
    try:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        # 1. Get file path from Telegram
        info_url = f"https://api.telegram.org/bot{bot_token}/getFile?file_id={file_id}"
        req = urllib.request.Request(info_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            info_data = json.loads(resp.read().decode("utf-8"))
            if not info_data.get("ok"):
                print(f"[LangGraph:Extractor] Telegram getFile returned not OK: {info_data}")
                return False
            telegram_path = info_data["result"]["file_path"]

        # 2. Download file content
        dl_url = f"https://api.telegram.org/file/bot{bot_token}/{telegram_path}"
        dl_req = urllib.request.Request(dl_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(dl_req, timeout=60) as dl_resp:
            file_bytes = dl_resp.read()
            dest_path.write_bytes(file_bytes)
        print(f"[LangGraph:Extractor] Successfully downloaded Telegram attachment ({len(file_bytes):,} bytes) to: {dest_path.name}")
        return True
    except Exception as e:
        print(f"[LangGraph:Extractor] Error downloading Telegram file_id '{file_id}': {e}")
        return False


def _extract_pdf_with_ai(pdf_path: Path) -> str:
    """Fallback 1: Gemini Multimodal, Fallback 2/3: OpenRouter Vision for scanned PDFs."""
    import base64
    import requests
    try:
        pdf_bytes = pdf_path.read_bytes()
        b64_data = base64.b64encode(pdf_bytes).decode("utf-8")
    except Exception as e:
        print(f"[LangGraph:Extractor] Failed reading PDF bytes for AI extraction: {e}")
        return ""

    # Fallback 1: Gemini Multimodal (gemini-2.0-flash -> gemini-1.5-flash -> gemini-1.5-pro)
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key and not gemini_key.startswith("AQ."):
        for model_name in ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                payload = {
                    "contents": [{
                        "parts": [
                            {"inline_data": {"mime_type": "application/pdf", "data": b64_data}},
                            {"text": "Extract all assignment requirements, course title, due date, submission links, constraints, and all specific tasks from this PDF document verbatim. Return the complete, unabridged assignment text with all questions, instructions, and constraints."}
                        ]
                    }]
                }
                resp = requests.post(url, json=payload, timeout=60)
                if resp.ok:
                    data = resp.json()
                    cands = data.get("candidates", [])
                    if cands:
                        text = cands[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        if text and len(text.strip()) > 30:
                            print(f"[LangGraph:Extractor] Successfully extracted text via Gemini Multimodal ({model_name}).")
                            return text.strip()
            except Exception as ge:
                print(f"[LangGraph:Extractor] Gemini {model_name} extraction error: {ge}")

    # Fallback 2/3: OpenRouter Vision (gemma-3-27b-it -> qwen-2.5-vl-72b)
    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_key:
        vision_models = ["google/gemma-3-27b-it", "qwen/qwen-2.5-vl-72b-instruct:free"]
        for v_model in vision_models:
            try:
                url = "https://openrouter.ai/api/v1/chat/completions"
                payload = {
                    "model": v_model,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:application/pdf;base64,{b64_data}"}},
                            {"type": "text", "text": "Extract all assignment requirements and questions from this document verbatim."}
                        ]
                    }],
                    "temperature": 0.1
                }
                resp = requests.post(url, headers={"Authorization": f"Bearer {openrouter_key}"}, json=payload, timeout=60)
                if resp.ok:
                    data = resp.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    if content and len(content.strip()) > 30:
                        print(f"[LangGraph:Extractor] Successfully extracted text via OpenRouter Vision ({v_model}).")
                        return content.strip()
            except Exception as ve:
                print(f"[LangGraph:Extractor] OpenRouter Vision {v_model} error: {ve}")

    return ""


def extract_text_from_pdf(pdf_path: Path) -> str:
    """Extracts all text from a PDF file page by page using pypdf, falling back to multimodal AI on scanned files."""
    if not pdf_path.exists():
        return ""
    try:
        reader = pypdf.PdfReader(str(pdf_path))
        extracted_pages = []
        for idx, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                extracted_pages.append(f"--- Page {idx + 1} ---\n{text.strip()}")
        extracted_text = "\n\n".join(extracted_pages).strip()
        if len(extracted_text) >= 50:
            return extracted_text

        # Trigger condition: Scanned document / missing text stream in PDF
        print(f"[LangGraph:Extractor] pypdf found low/empty text ({len(extracted_text)} chars). Triggering Gemini Multimodal / OpenRouter Vision fallback...")
        ai_extracted = _extract_pdf_with_ai(pdf_path)
        return ai_extracted or extracted_text
    except Exception as e:
        print(f"[LangGraph:Extractor] Error extracting text from {pdf_path}: {e}. Trying AI fallback...")
        return _extract_pdf_with_ai(pdf_path)


def extract_text_from_docx(docx_path: Path) -> str:
    """Extracts text from a Word (.docx) document."""
    if not docx_path.exists():
        return ""
    try:
        from docx import Document
        doc = Document(str(docx_path))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs)
    except Exception as e:
        print(f"[LangGraph:Extractor] Error extracting text from {docx_path}: {e}")
        return ""


def extract_document_text(doc_path: Path) -> str:
    """Extracts text from any supported document format."""
    ext = doc_path.suffix.lower()
    if ext == ".pdf":
        return extract_text_from_pdf(doc_path)
    elif ext in {".docx", ".doc"}:
        return extract_text_from_docx(doc_path)
    elif ext in {".txt", ".md", ".json", ".csv"}:
        try:
            return doc_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return ""
    return ""


def find_document_file(filename: str, search_dirs: List[Path]) -> Optional[Path]:
    """Finds a document file across common user and workspace directories."""
    clean_name = filename.strip().strip("'\"")
    for base_dir in search_dirs:
        if not base_dir.exists():
            continue
        # Direct match
        direct = base_dir / clean_name
        if direct.exists() and direct.is_file():
            return direct
        # Stem or case-insensitive search
        stem = Path(clean_name).stem
        if len(stem) >= 3:
            for ext in [".pdf", ".docx", ".doc", ".txt"]:
                matches = list(base_dir.glob(f"*{stem}*{ext}"))
                if matches:
                    return matches[0]
    return None


def evaluate_task_weight(text_content: str, title: str) -> str:
    """
    Evaluates whether an assignment requires heavy-lift execution.
    Heavy criteria:
    - Deep Learning / ML training (PyTorch, TensorFlow, CNN, MLP, FNN, neural networks, epochs, weights)
    - Computer Vision / OpenCV pipelines (video streams, image processing)
    - Multi-deliverable projects (e.g. PPT presentation + multiple Jupyter notebooks + model + ZIP)
    - Full-stack, distributed, or large dataset coursework
    """
    combined = (title + "\n" + text_content).lower()

    heavy_patterns = [
        r"deep\s+learning",
        r"computer\s+vision",
        r"dlcv",
        r"neural\s+network",
        r"\b(mlp|cnn|rnn|fnn|lstm|transformer|resnet|vgg)\b",
        r"feed-?forward\s+network",
        r"opencv",
        r"cat\s*(?:and|vs)\s*dog",
        r"model\s+weights",
        r"train(?:ing)?\s+loop",
        r"hidden\s+layers?",
        r"epochs?",
        r"loss\s+curves?",
        r"backpropagation",
        r"full-?stack",
        r"microservice",
        r"distributed",
        r"large\s+dataset",
        r"pipeline",
    ]

    for pattern in heavy_patterns:
        if re.search(pattern, combined):
            return "heavy"

    medium_patterns = [
        r"jupyter\s+notebook",
        r"\.ipynb",
        r"research\s+report",
        r"ieee\s+citation",
        r"data\s+analysis",
        r"algorithm\s+comparison",
    ]

    for pattern in medium_patterns:
        if re.search(pattern, combined):
            return "medium"

    return "light"


def extractor_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Extractor
    Inspects attachments and prompt specifications.
    If an attached PDF or document exists, extracts all text and pastes it verbatim
    into the assignment specification, ensuring the Planner and Coder have the full rubric.
    Also re-evaluates and upgrades task weight so heavy-lift tasks receive appropriate resources.
    """
    task = state.get("task", {})
    title = state.get("title", task.get("title", "Academic Task"))
    course = state.get("course", task.get("course", "General"))
    build_spec = state.get("build_spec", task.get("build_spec", ""))
    work_dir = Path(state.get("work_dir", "."))
    work_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n[LangGraph:Extractor] Inspecting task attachments & specification for '{title}'...")

    from worker.tools.progress import report_progress
    task_id = state.get("task_id", task.get("id"))
    report_progress(task_id, "extracting", f"Extractor: Inspecting coursework requirements and attachments for '{title}'...", state)

    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    reqs_meta = task.get("extracted_requirements") or {}
    
    # Check for direct attachment metadata from Telegram ingestion
    attachment_candidates: List[Dict[str, Any]] = []
    
    # 1. Inspect task.extracted_requirements.attachment
    if isinstance(reqs_meta, dict):
        att = reqs_meta.get("attachment")
        if isinstance(att, dict) and att:
            attachment_candidates.append(att)
        atts = reqs_meta.get("attachments")
        if isinstance(atts, list):
            for item in atts:
                if isinstance(item, dict) and item:
                    attachment_candidates.append(item)

    # 2. Extract referenced filenames from raw text fields
    all_text_sources = [
        title,
        build_spec,
        str(task.get("prompt") or ""),
        str(task.get("description") or ""),
        str(task.get("notes") or ""),
        str(reqs_meta.get("raw_text") or "") if isinstance(reqs_meta, dict) else "",
        str(reqs_meta.get("raw_body") or "") if isinstance(reqs_meta, dict) else "",
    ]
    combined_raw_text = "\n".join(all_text_sources)

    referenced_filenames: List[str] = []
    matches = re.findall(r"([^\r\n:\"']+\.(?:pdf|docx|doc|txt))", combined_raw_text, re.IGNORECASE)
    for m in matches:
        m_clean = m.strip().replace("Attached PDF:", "").replace("Attached File:", "").strip()
        if m_clean and m_clean not in referenced_filenames:
            referenced_filenames.append(m_clean)

    # Search directories where user files or project assets land
    user_home = Path.home()
    search_locations = [
        work_dir,
        user_home / "Downloads" / "Telegram Desktop",
        user_home / "Downloads",
        user_home / "Documents" / "Projects" / "college_projects" / "DLCV2026",
        user_home / "Documents",
        Path("scratch"),
    ]

    extracted_content = ""
    resolved_doc_name = ""

    # Phase A: Download Telegram attachment directly if file_id is available
    for att in attachment_candidates:
        file_name = att.get("file_name") or "attached_document.pdf"
        file_id = att.get("file_id")
        target_path = work_dir / file_name

        if not target_path.exists() and file_id and bot_token:
            print(f"[LangGraph:Extractor] Downloading Telegram attachment '{file_name}' via Bot API...")
            success = download_telegram_attachment(bot_token, file_id, target_path)
            if not success:
                # Try finding in search locations as backup
                found = find_document_file(file_name, search_locations)
                if found and found.exists():
                    shutil.copy2(found, target_path)
                    print(f"[LangGraph:Extractor] Found local copy of '{file_name}' at: {found}")

        if target_path.exists():
            text = extract_document_text(target_path)
            if text.strip():
                extracted_content = text.strip()
                resolved_doc_name = target_path.name
                print(f"[LangGraph:Extractor] Successfully extracted {len(extracted_content)} chars from Telegram attachment: {resolved_doc_name}")
                break

    # Phase B: If not extracted from Telegram attachment, search local filesystem
    if not extracted_content:
        for fname in referenced_filenames:
            found_path = find_document_file(fname, search_locations)
            if found_path and found_path.exists():
                print(f"[LangGraph:Extractor] Found referenced document at: {found_path}")
                dest_file = work_dir / found_path.name
                if not dest_file.exists():
                    shutil.copy2(found_path, dest_file)
                    print(f"[LangGraph:Extractor] Copied document to workspace: {dest_file.name}")
                
                text = extract_document_text(found_path)
                if text.strip():
                    extracted_content = text.strip()
                    resolved_doc_name = found_path.name
                    print(f"[LangGraph:Extractor] Successfully extracted {len(extracted_content)} chars from {resolved_doc_name}.")
                    break

    # Phase C: Check work_dir directly for any remaining unextracted PDFs
    if not extracted_content:
        for p in work_dir.glob("*.pdf"):
            text = extract_text_from_pdf(p)
            if text.strip():
                extracted_content = text.strip()
                resolved_doc_name = p.name
                print(f"[LangGraph:Extractor] Extracted {len(extracted_content)} chars from workspace PDF: {resolved_doc_name}")
                break

    updates: Dict[str, Any] = {}

    # If extracted text is available, synthesize the comprehensive build_spec
    if extracted_content:
        # Check if the existing build_spec is just a brief stub or lacks verbatim content
        is_brief_stub = len(build_spec.strip()) < 400 or "VERBATIM SPECIFICATIONS" not in build_spec or "Attached PDF:" in build_spec

        if is_brief_stub:
            enriched_spec = (
                f"Course: {course}\n"
                f"Assignment: {title}\n\n"
                f"=== VERBATIM SPECIFICATIONS EXTRACTED FROM ATTACHED DOCUMENT ({resolved_doc_name}) ===\n"
                f"{extracted_content}\n"
                f"========================================================================================\n\n"
                f"Original User Directives:\n{build_spec}"
            )
            updates["build_spec"] = enriched_spec
            print(f"[LangGraph:Extractor] Enriched build_spec with full verbatim requirements from '{resolved_doc_name}'.")

    effective_spec = updates.get("build_spec", build_spec)
    effective_text = f"{effective_spec}\n{extracted_content}"

    # Re-evaluate task weight
    new_weight = evaluate_task_weight(effective_text, title)
    current_weight = state.get("weight", task.get("weight", "light"))
    if new_weight != current_weight and new_weight == "heavy":
        print(f"[LangGraph:Extractor] Upgrading task weight from '{current_weight}' to '{new_weight}' based on assignment depth.")
        updates["weight"] = new_weight

    # Re-evaluate task_type if currently generic 'document'
    current_type = state.get("task_type", task.get("task_type", "document"))
    if current_type == "document" and ("fnn" in effective_text.lower() or "opencv" in effective_text.lower() or "jupyter" in effective_text.lower() or "neural" in effective_text.lower() or "mlp" in effective_text.lower()):
        updates["task_type"] = "code_project"
        print(f"[LangGraph:Extractor] Upgraded task_type from '{current_type}' to 'code_project'.")

    # Update database record in Supabase so UI and background systems reflect full requirements and heavy weight
    task_id = state.get("task_id", task.get("id"))
    if task_id and (updates.get("weight") or updates.get("build_spec") or updates.get("task_type")):
        db_patch: Dict[str, Any] = {}
        if "weight" in updates:
            db_patch["weight"] = updates["weight"]
        if "build_spec" in updates:
            db_patch["build_spec"] = updates["build_spec"]
        if "task_type" in updates:
            db_patch["task_type"] = updates["task_type"]
        if db_patch:
            # 3-attempt retry with backoff so a momentary Supabase blip does not
            # silently discard enriched build_spec / weight / task_type updates.
            import time as _time
            for _sb_attempt in range(3):
                try:
                    from worker.worker import get_supabase
                    sb = get_supabase()
                    sb.table("tasks").update(db_patch).eq("id", task_id).execute()
                    print(f"[LangGraph:Extractor] Synced updated metadata to Supabase task {task_id}: {list(db_patch.keys())}")
                    break
                except Exception as db_err:
                    if _sb_attempt < 2:
                        _time.sleep(2 * (_sb_attempt + 1))
                    else:
                        print(f"[LangGraph:Extractor] Warning: Could not sync to Supabase after 3 attempts: {db_err}")

    # Merge updates into task dictionary inside state
    if "task" in state:
        updated_task = dict(state["task"])
        updated_task.update(updates)
        updates["task"] = updated_task

    return updates
