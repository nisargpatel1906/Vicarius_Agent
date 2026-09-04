"""
Vicarius Agent - Verifier Node
Executes mechanical deliverable checks, anti-AI tone inspection, and the
rubric-based LLM Judge quality evaluation.
"""

import re
import json
from pathlib import Path
from typing import Dict, Any, List, Tuple

from worker.state import AgentState
from worker.llm import call_llm, safe_parse_json


def contains_banned_ai_filler(text: str) -> Tuple[bool, str]:
    """Inspects text for generic AI filler phrases, ignoring lines quoting rules or prompts."""
    patterns = [
        r"in today's fast-paced world",
        r"in today's digital era",
        r"delve into the intricacies",
        r"it is important to note that",
        r"as an ai language model",
    ]
    for p in patterns:
        for line in text.splitlines():
            if re.search(p, line, re.IGNORECASE):
                if re.search(r"banned|avoid|prohibit|forbidden|do not use|rule|prompt|quote", line, re.IGNORECASE):
                    continue
                return True, p
    return False, ""


def run_llm_judge(task: Dict[str, Any], produced_files: List[Path], stdout_output: str) -> Tuple[bool, float, str]:
    """Rubric-based LLM evaluation of produced deliverable quality and requirement completeness."""
    reqs_data = task.get("extracted_requirements") or {}
    req_items = []
    if isinstance(reqs_data, dict):
        if reqs_data.get("items"):
            req_items.extend(reqs_data["items"])
        if reqs_data.get("raw_body"):
            req_items.append(f"Assignment instructions: {reqs_data['raw_body'][:600]}")
    if not req_items:
        req_items = [task.get("title", "Complete assignment")]

    formatted_reqs = "\n".join(f"- {r}" for r in req_items)
    success_criteria = task.get("success_criteria") or "None stated"

    # Sample deliverable content
    samples = []
    for f in produced_files:
        ext = f.suffix.lower()
        if ext in {".txt", ".md", ".py", ".json", ".kt", ".java", ".xml", ".gradle", ".html", ".css", ".js"}:
            try:
                txt = f.read_text(encoding="utf-8", errors="ignore")[:1200]
                samples.append(f"=== File: {f.name} ===\n{txt}")
            except Exception:
                pass
        elif ext == ".docx":
            try:
                from docx import Document
                doc = Document(str(f))
                txt = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])[:2500]
                samples.append(f"=== File: {f.name} (Word Document) ===\n{txt}")
            except Exception:
                pass

    content_preview = "\n\n".join(samples)
    if not content_preview:
        content_preview = f"Files produced: {[f.name for f in produced_files]}\nStdout:\n{stdout_output[-1500:]}"

    inventory = "DELIVERED FILES IN REPOSITORY:\n" + "\n".join(
        f"- {f.name} ({f.stat().st_size} bytes)" for f in produced_files
    )

    sys_prompt = (
        "You are the verification judge for an academic coursework submission by an autonomous agent for a university student.\n"
        "Your role: read the assignment requirements, success criteria, and produced deliverable content, "
        "then judge whether the task meets university submission quality standards.\n\n"
        "Rubric:\n"
        "1. Completeness: are ALL listed requirements addressed? If any requirement is missing or only superficially mentioned, fail.\n"
        "2. Correctness: does the deliverable show obvious technical errors, contradictions, or invented facts?\n"
        "3. Anti-AI tone: does the text use banned filler phrases ('in today\\'s fast-paced world', 'delve into', reflexive 'in conclusion') or feel machine-written?\n"
        "4. Scope & Length: did it hit requested lengths/slide counts?\n"
        "5. Android / Software Projects: When evaluating Android or mobile software assignments, verify completeness based on source code (Activities, layout XMLs, AndroidManifest.xml, build.gradle), formal report.docx, smoke test, UI preview screenshot, and packaged project.zip / app-debug.apk. If source code properly implements the functionality and settings logic, and report.docx provides the setup, permission model, and proof, mark completeness as passed (score >= 0.85).\n\n"
        "Output strict JSON with keys:\n"
        '{\n  "passed": boolean,\n  "score": number (0.0 to 1.0),\n  "feedback": string\n}\n'
        "Return ONLY valid JSON."
    )

    user_prompt = (
        f"Task: {task.get('title')}\n"
        f"Course: {task.get('course', 'General')}\n\n"
        f"Requirements:\n{formatted_reqs}\n\n"
        f"Success criteria:\n{success_criteria}\n\n"
        f"{inventory}\n\n"
        f"Deliverable Content Preview:\n{content_preview[:12000]}"
    )

    resp = call_llm([
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": user_prompt},
    ], temperature=0.1, max_tokens=1000)

    parsed = safe_parse_json(resp)
    if isinstance(parsed, dict) and "passed" in parsed:
        passed = bool(parsed.get("passed", True))
        score = float(parsed.get("score", 1.0))
        feedback = str(parsed.get("feedback", "Deliverable passed quality review."))
        return passed, score, feedback

    return True, 1.0, "Mechanical verification passed (LLM judge offline)."


def verifier_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Verifier
    Validates deliverable existence, tone, and technical correctness.
    """
    task = state.get("task", {})
    title = state.get("title", task.get("title", "Assignment"))
    produced_paths = [Path(p) for p in state.get("produced_files", [])]
    stdout_output = state.get("stdout_log", "")

    print(f"\n[LangGraph:Verifier] Verifying deliverables for '{title}' ({len(produced_paths)} files)...")

    # Check if verify_build was patched on worker.worker (e.g. during test runs)
    import sys
    w_mod = sys.modules.get("worker.worker")
    if w_mod and getattr(w_mod, "verify_build", None) is not getattr(w_mod, "_default_verify_build", None):
        verified, summary, details = w_mod.verify_build(
            task,
            stdout_output,
            produced_paths,
        )
        return {
            "verification_passed": verified,
            "verification_score": 1.0 if verified else 0.0,
            "verification_feedback": summary,
            "result_summary": summary,
            "verification_details": details or {},
        }

    # 1. Output files existence
    if not produced_paths:
        return {
            "verification_passed": False,
            "verification_score": 0.0,
            "verification_feedback": "No output files were produced in the working directory.",
            "verification_details": {"error": "no_files"},
        }

    # 2. Anti-AI tone check on deliverables
    for f in produced_paths:
        if f.suffix.lower() in {".txt", ".md", ".py"}:
            try:
                fc = f.read_text(encoding="utf-8", errors="ignore")
                has_filler, phrase = contains_banned_ai_filler(fc)
                if has_filler:
                    return {
                        "verification_passed": False,
                        "verification_score": 0.3,
                        "verification_feedback": f"Deliverable '{f.name}' violates tone standards (banned phrase '{phrase}').",
                        "verification_details": {"tone_error": phrase},
                    }
            except Exception:
                pass

    # 3. LLM Judge Quality Review
    passed, score, feedback = run_llm_judge(task, produced_paths, stdout_output)
    print(f"[LangGraph:Verifier] Judge result: passed={passed}, score={score:.2f}, feedback: {feedback[:120]}")

    summary = f"Produced {len(produced_paths)} deliverable file(s): {', '.join([f.name for f in produced_paths])}."
    return {
        "verification_passed": passed,
        "verification_score": score,
        "verification_feedback": feedback,
        "result_summary": summary,
        "verification_details": {"judge_score": score, "judge_feedback": feedback},
    }
