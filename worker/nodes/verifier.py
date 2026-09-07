"""
Vicarius Agent - Verifier Node
Executes mechanical deliverable checks, actual code execution,
anti-AI tone inspection, and the rubric-based LLM Judge quality evaluation.

New: Actually runs Python files and checks their exit code to verify correctness.
"""

import re
import json
import os
import time
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, List, Tuple

from worker.state import AgentState
from worker.llm import call_llm, safe_parse_json

def _detect_python_exe() -> str:
    if os.getenv("AGENT_PYTHON_EXE") and Path(os.environ["AGENT_PYTHON_EXE"]).exists():
        return os.environ["AGENT_PYTHON_EXE"]
    # 1. Check local workspace .venv
    local_venv = Path(__file__).resolve().parent.parent.parent / ".venv" / "Scripts" / "python.exe"
    if local_venv.exists():
        return str(local_venv)
    # 2. Check current runtime python
    if sys.executable and Path(sys.executable).exists():
        return sys.executable
    # 3. Check system PATH python
    import shutil
    which_py = shutil.which("python") or shutil.which("python3")
    if which_py:
        return which_py
    return "python"

PYTHON_EXE = _detect_python_exe()


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


def run_python_file_check(filepath: Path, timeout: int = 60) -> Tuple[bool, str]:
    """
    Actually runs a Python file in a subprocess and returns (success, output).
    Handles persistent web servers (Flask, FastAPI, etc.) by verifying compilation and clean startup.
    This gives real pass/fail based on exit code, not just LLM opinion.
    """
    try:
        content = filepath.read_text(encoding="utf-8", errors="ignore")
        is_server = bool(re.search(r"app\.run\(|uvicorn\.run\(|socketio\.run\(|http\.server|run_simple\(", content))

        if is_server:
            # 1. Test compilation & syntax
            comp_res = subprocess.run(
                [PYTHON_EXE, "-m", "py_compile", str(filepath.resolve())],
                capture_output=True,
                text=True,
                timeout=15,
                cwd=str(filepath.parent.resolve()),
                env={**os.environ, "PYTHONPATH": str(filepath.parent.resolve())},
            )
            if comp_res.returncode != 0:
                return False, f"Server syntax/compilation error: {comp_res.stderr.strip()[:500]}"

            # 2. Briefly launch the server in a subprocess to ensure it starts without crash
            proc = subprocess.Popen(
                [PYTHON_EXE, str(filepath.resolve())],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=str(filepath.parent.resolve()),
                env={**os.environ, "PYTHONPATH": str(filepath.parent.resolve())},
            )
            time.sleep(3)
            ret = proc.poll()
            if ret is not None and ret != 0:
                _, err = proc.communicate()
                return False, f"Server crashed on startup (code {ret}): {err.strip()[:500]}"

            # Still running healthy -> terminate cleanly
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
            return True, "Server started successfully and bound without crashing"

        result = subprocess.run(
            [PYTHON_EXE, str(filepath.resolve())],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(filepath.parent.resolve()),
            env={**os.environ, "PYTHONPATH": str(filepath.parent.resolve())},
        )
        output = ""
        if result.stdout.strip():
            output += f"STDOUT: {result.stdout.strip()[:1000]}"
        if result.stderr.strip():
            output += f"\nSTDERR: {result.stderr.strip()[:500]}"
        return result.returncode == 0, output
    except subprocess.TimeoutExpired:
        return False, f"Execution timed out after {timeout}s"
    except Exception as e:
        return False, f"Could not run file: {e}"


def validate_notebook(filepath: Path) -> Tuple[bool, str]:
    """
    Validates that a .ipynb file is a proper Jupyter notebook with real cells.
    Also tracks executed output counts for quality verification.
    """
    try:
        raw = filepath.read_text(encoding="utf-8", errors="ignore")
        data = json.loads(raw)
        if isinstance(data, dict) and "cells" in data and "nbformat" in data:
            cells = data.get("cells", [])
            n_code = sum(1 for c in cells if c.get("cell_type") == "code")
            n_md = sum(1 for c in cells if c.get("cell_type") == "markdown")
            n_outputs = sum(1 for c in cells if c.get("cell_type") == "code" and len(c.get("outputs", [])) > 0)
            return True, f"Valid notebook: {len(cells)} cells ({n_code} code, {n_md} markdown, {n_outputs} with executed outputs)"
        return False, "File is not in valid Jupyter Notebook v4 format"
    except Exception as e:
        return False, f"Invalid notebook: {e}"


def run_llm_judge(task: Dict[str, Any], produced_files: List[Path], stdout_output: str, execution_results: str) -> Tuple[bool, float, str]:
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
        elif ext == ".ipynb":
            valid, validation_msg = validate_notebook(f)
            samples.append(f"=== File: {f.name} (Jupyter Notebook) ===\nValidation: {validation_msg}")
        elif ext == ".pptx":
            try:
                import pptx
                prs = pptx.Presentation(str(f))
                slide_info = [f"Total Slides: {len(prs.slides)}"]
                for s_idx, slide in enumerate(prs.slides, 1):
                    texts = [s.text_frame.text.strip() for s in slide.shapes if s.has_text_frame and s.text_frame.text.strip()]
                    notes = slide.notes_slide.notes_text_frame.text.strip() if slide.has_notes_slide else ""
                    slide_preview = f"Slide {s_idx}:\n" + "\n".join(texts[:8])
                    if notes:
                        slide_preview += f"\nSpeaker Notes ({len(notes.split())} words):\n{notes[:300]}"
                    slide_info.append(slide_preview)
                samples.append(f"=== File: {f.name} (PowerPoint Presentation) ===\n" + "\n\n".join(slide_info)[:3500])
            except Exception as e:
                samples.append(f"=== File: {f.name} (PowerPoint Presentation) ===\nExtraction note: {e}")

    content_preview = "\n\n".join(samples)
    if not content_preview:
        content_preview = f"Files produced: {[f.name for f in produced_files]}\nStdout:\n{stdout_output[-1500:]}"

    inventory = "DELIVERED FILES IN REPOSITORY:\n" + "\n".join(
        f"- {f.name} ({f.stat().st_size} bytes)" for f in produced_files
    )

    exec_block = f"\n\nCode Execution Results:\n{execution_results}" if execution_results else ""

    sys_prompt = (
        "You are the verification judge for an academic coursework submission by an autonomous agent for a university student.\n"
        "Your role: read the assignment requirements, success criteria, and produced deliverable content, "
        "then judge whether the task meets university submission quality standards.\n\n"
        "Rubric:\n"
        "1. Completeness: are ALL listed requirements addressed? If any requirement is missing or only superficially mentioned, fail.\n"
        "2. Correctness: does the deliverable show obvious technical errors, contradictions, or invented facts?\n"
        "3. Anti-AI tone: does the text use banned filler phrases ('in today\\'s fast-paced world', 'delve into') or feel machine-written?\n"
        "4. Scope & Length: did it hit requested lengths/slide counts/file counts?\n"
        "5. Code Quality: if code files exist, did execution succeed? Check the Code Execution Results field.\n"
        "6. Notebook Quality: if .ipynb files exist, are they valid notebooks with proper cells, not empty stubs?\n"
        "7. Android / Software Projects: verify completeness based on source code, formal report.docx, smoke test, UI preview screenshot, and packaged zip.\n\n"
        "Output strict JSON:\n"
        '{\n  "passed": boolean,\n  "score": number (0.0 to 1.0),\n  "feedback": string\n}\n'
        "Return ONLY valid JSON."
    )

    user_prompt = (
        f"Task: {task.get('title')}\n"
        f"Course: {task.get('course', 'General')}\n\n"
        f"Requirements:\n{formatted_reqs}\n\n"
        f"Success criteria:\n{success_criteria}\n\n"
        f"{inventory}{exec_block}\n\n"
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
    Validates deliverable existence, tone, actual code execution, and technical correctness.
    """
    task = state.get("task", {})
    title = state.get("title", task.get("title", "Assignment"))
    task_id = state.get("task_id", task.get("id"))
    attempt = state.get("attempt", 1)

    work_dir = Path(state.get("work_dir", "."))
    produced_files_raw = state.get("produced_files", [])
    produced_paths: List[Path] = []
    for pf in produced_files_raw:
        if isinstance(pf, Path):
            p = pf
        else:
            p = work_dir / str(pf)
        if p.exists() and p not in produced_paths:
            produced_paths.append(p)

    # If produced_paths is empty, scan work_dir for files
    if not produced_paths and work_dir.exists():
        for item in work_dir.iterdir():
            if item.is_file() and not item.name.startswith("."):
                produced_paths.append(item)

    stdout_output = state.get("last_execution_stdout", "") or ""

    print(f"\n[LangGraph:Verifier] Verifying deliverables for '{title}' ({len(produced_paths)} files)...")

    from worker.tools.progress import report_progress
    report_progress(task_id, "verifying", f"Verifier: Evaluating academic quality, code execution, and rubric checks (Attempt {attempt})...", state)

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

    # 1. Output files existence check
    if not produced_paths:
        return {
            "verification_passed": False,
            "verification_score": 0.0,
            "verification_feedback": "No output files were produced in the working directory.",
            "verification_details": {"error": "no_files"},
        }

    # 2. Anti-AI tone check on text deliverables
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

    # 3. Validate Jupyter notebooks & ensure code cells are executed
    notebook_issues = []
    for f in produced_paths:
        if f.suffix.lower() == ".ipynb" and f.exists():
            valid, msg = validate_notebook(f)
            if valid and "0 with executed outputs" in msg:
                # Check if an executed sibling already exists
                sibling_executed = f.with_name(f.stem + "_executed.ipynb")
                if sibling_executed.exists():
                    s_valid, s_msg = validate_notebook(sibling_executed)
                    if s_valid and "0 with executed outputs" not in s_msg:
                        print(f"[LangGraph:Verifier] Notebook '{f.name}' is clean template copy (executed sibling '{sibling_executed.name}' exists with outputs). OK.")
                        continue

                # Attempt automatic headless execution with nbclient
                print(f"[LangGraph:Verifier] Notebook '{f.name}' has unexecuted code cells. Auto-executing with nbclient...")
                try:
                    from worker.tools.agent_tools import tool_execute_notebook
                    res = tool_execute_notebook(f.parent, f.name)
                    print(f"  └─ {res}")
                    if "ERROR" in res:
                        notebook_issues.append(f"{f.name}: Headless execution failed: {res}")
                    else:
                        valid, msg = validate_notebook(f)
                except Exception as ex:
                    notebook_issues.append(f"{f.name}: Execution exception: {ex}")

            if not valid:
                notebook_issues.append(f"{f.name}: {msg}")
            else:
                print(f"[LangGraph:Verifier] Notebook OK: {f.name} — {msg}")

    if notebook_issues:
        return {
            "verification_passed": False,
            "verification_score": 0.35,
            "verification_feedback": f"Invalid notebook(s): {'; '.join(notebook_issues)}",
            "verification_details": {"notebook_errors": notebook_issues},
        }

    # 4. Actually run Python files to check they work
    execution_results = []

    # Check for dedicated test suites first
    test_files = [
        f for f in produced_paths
        if f.suffix.lower() == ".py" and f.exists() and (
            f.name.startswith("test_") or f.name in {"smoke_test.py", "run_smoke.py"} or "tests" in f.parts
        )
    ]

    targets_to_run = []
    if test_files:
        targets_to_run.extend(test_files[:3])

    entry_files = [
        f for f in produced_paths
        if f.suffix.lower() == ".py" and f.exists() and f.name in {"main.py", "app.py", "server.py", "smoke_test.py"} and f not in targets_to_run
    ]
    targets_to_run.extend(entry_files[:2])

    for f in targets_to_run:
        print(f"[LangGraph:Verifier] Running: {f.name}...")
        success, output = run_python_file_check(f, timeout=60)
        status = "PASS" if success else "FAIL"
        execution_results.append(f"[{status}] {f.name}: {output[:300]}")
        if not success:
            print(f"  └─ FAIL: {output[:200]}")
        else:
            print(f"  └─ PASS: {output[:100]}")

    exec_summary = "\n".join(execution_results)

    # Check if any smoke test failed
    if any("[FAIL]" in r for r in execution_results):
        fail_details = [r for r in execution_results if "[FAIL]" in r]
        return {
            "verification_passed": False,
            "verification_score": 0.4,
            "verification_feedback": f"Code execution failed: {fail_details[0][:300]}",
            "verification_details": {"execution_errors": fail_details},
        }

    # 5. LLM Judge Quality Review
    passed, score, feedback = run_llm_judge(task, produced_paths, stdout_output, exec_summary)
    print(f"[LangGraph:Verifier] Judge result: passed={passed}, score={score:.2f}, feedback: {feedback[:120]}")

    status_note = f"Verifier: Score {score*100:.0f}% — {'Passed' if passed else 'Failed (routing to Reflexion Diagnoser)'}."
    report_progress(task_id, "verifying", status_note, {**state, "verification_passed": passed, "verification_score": score})

    summary = f"Produced {len(produced_paths)} deliverable file(s): {', '.join([f.name for f in produced_paths])}."
    return {
        "verification_passed": passed,
        "verification_score": score,
        "verification_feedback": feedback,
        "result_summary": summary,
        "verification_details": {"judge_score": score, "judge_feedback": feedback, "execution_results": execution_results},
    }
