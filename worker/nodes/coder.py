"""
Vicarius Agent - Coder Node (Antigravity CLI + Autonomous Agent)
Implements:
1. Primary Execution Engine: Formulates prompt and delegates task completion
   directly to Antigravity CLI (agy -p ... --model gemini-3.8-flash-high --effort high),
   waiting for it to complete in the task workspace.
2. Fallback / Augmenter: Full ReAct agent tool loop with zero hardcoded templates
   if any planned deliverables remain missing or if CLI is unavailable.
"""

import os
import sys
import json
import shutil
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from worker.state import AgentState
from worker.llm import call_llm_structured, LLMResponse, ToolCall
from worker.tools.agent_tools import dispatch_tool, TOOL_SCHEMAS
from worker.tools.file_tools import list_workspace_files

MAX_AGENT_STEPS = int(os.getenv("MAX_AGENT_STEPS", "40"))
MAX_CONTEXT_MESSAGES = int(os.getenv("MAX_CONTEXT_MESSAGES", "30"))


def _build_agy_prompt(
    student_name: str,
    student_enrollment: str,
    student_program: str,
    student_uni: str,
    title: str,
    course: str,
    build_spec: str,
    plan: Dict[str, Any],
    custom_directives: str,
    writing_voice: str,
    academic_level: str,
    citation_style: str,
    retry_instructions: str,
    attempt: int,
    work_dir: Path,
) -> str:
    """Builds the comprehensive execution prompt for the Antigravity CLI."""
    plan_files = plan.get("files", []) if plan else []
    files_bullet_list = (
        "\n".join([f"- `{f.get('filename')}`: {f.get('purpose')}" for f in plan_files])
        if plan_files else ""
    )
    directives_block = f"\n\nStudent Guidelines & Working Directives:\n{custom_directives}" if custom_directives else ""
    voice_block = f"\n\nWriting Voice Reference:\n{writing_voice}" if writing_voice else ""
    academic_block = f"\n\nAcademic Depth Note: {academic_level}" if academic_level else ""
    retry_block = (
        f"\n\n{'='*60}\n"
        f"CRITICAL FIX DIRECTIVE — RETRY ATTEMPT #{attempt}\n"
        f"Previous verification failed. You MUST address and fix this:\n"
        f"{retry_instructions}\n"
        f"{'='*60}"
    ) if retry_instructions and attempt > 1 else ""

    files_section = f"\nRequired Deliverables to Produce:\n{files_bullet_list}\n" if files_bullet_list else ""
    local_pdfs = list(work_dir.glob("*.pdf"))
    pdf_section = f"\nReference Documents in Workspace:\n" + "\n".join([f"- `{p.name}`" for p in local_pdfs]) + "\n" if local_pdfs else ""

    return (
        f"================================================================================\n"
        f"CRITICAL EXECUTION DIRECTIVE:\n"
        f"You are operating in NON-INTERACTIVE BATCH EXECUTION MODE via the agy CLI.\n"
        f"DO NOT respond with conversational acknowledgments, introductions, or questions.\n"
        f"DO NOT wait for user input or ask what to do next.\n"
        f"You MUST IMMEDIATELY use your tools (write_to_file, run_command, etc.) to generate\n"
        f"ALL required deliverables directly in the current working directory (`{work_dir.resolve()}`).\n"
        f"Then execute all code/notebooks so they run and produce real outputs and plots.\n"
        f"================================================================================\n\n"
        f"You are an expert autonomous academic AI agent acting on behalf of {student_name} "
        f"(Enrollment No: {student_enrollment}), a {student_program} student at {student_uni}.\n\n"
        f"Your mission: Complete this academic assignment by generating all required deliverables "
        f"directly in the current working directory (`{work_dir.resolve()}`).\n\n"
        f"Student Profile:\n"
        f"- Full Name: {student_name}\n"
        f"- Enrollment Number: {student_enrollment}\n"
        f"- Program: {student_program}\n"
        f"- Institution: {student_uni}\n\n"
        f"Assignment Title: {title}\n"
        f"Course: {course}\n"
        f"Citation Style: {citation_style}"
        f"{directives_block}{voice_block}{academic_block}{retry_block}\n"
        f"{files_section}"
        f"{pdf_section}\n"
        f"Full Assignment Specification & Requirements:\n{build_spec}\n\n"
        f"MANDATORY EXECUTION DIRECTIVES:\n"
        f"1. STUDENT PERSONALIZATION & ARCHIVE NAMING: If the prompt specifies placeholders like <ENRL NO>, <ENROLLMENT_NO>, <STUDENT_ID>, or <ROLL_NO>, you MUST substitute '{student_enrollment}' (e.g. `DLCV_2025_{student_enrollment}_sub1.zip`). For submission ZIP archives, all deliverables MUST be nested inside an inner folder matching the zip stem (`DLCV_2025_{student_enrollment}_sub1/`).\n"
        f"2. SELF-CONTAINED JUPYTER NOTEBOOKS (.ipynb): Every notebook MUST be 100% executable headlessly. If OpenCV webcam is required, include a synthetic video stream generator fallback (`get_video_source()`) so execution does not crash in headless environments. If datasets are required (e.g. Cat vs Dog), include synthetic dataset generator helpers (`create_cat_dog_dataset()`). Write Python generator scripts (e.g. `create_task2_notebook.py`) using `nbformat` and execute them so that notebooks contain rendered output cells (loss metrics, confusion matrices, matplotlib inline plots).\n"
        f"3. 16:9 WIDESCREEN PRESENTATIONS (.pptx): Presentations MUST use 16:9 widescreen layout (slide_width=13.333 inches, slide_height=7.5 inches), modern card-based layouts with dark/executive palettes (e.g. Slate 900 `#0F172A`, Slate 800 cards, Cyan `#06B6D4`, Emerald `#10B981` or Cognitive Heritage), mathematical formula callouts, and comprehensive speaker notes on every single slide.\n"
        f"4. PYTHON GENERATOR SCRIPTS: When generating notebooks or presentations, write standalone Python generator scripts (e.g. `create_presentation.py`, `create_task2_notebook.py`, `create_task3_notebook.py`, `create_task4_notebook.py`) to build the deliverables cleanly, then execute them with python.\n"
        f"5. COMPLETE CODE: Write complete, production-ready, fully functional code — NO TODOs, placeholders, or stubs.\n"
        f"6. ACADEMIC RIGOR: For reports (.docx/.md), write exhaustive graduate-level academic analysis with formulas, tables, and IEEE citations.\n"
        f"7. AUTHENTIC VOICE: Strictly avoid AI filler phrases (e.g. 'in today's fast-paced world', 'delve into', 'testament to'). Maintain an authentic student voice.\n"
        f"8. When finished, provide a concise summary list of all files generated in `{work_dir.resolve()}`."
    )


def _run_agy_cli(work_dir: Path, prompt: str, timeout_seconds: int = 1800) -> Tuple[bool, str]:
    """Runs Antigravity CLI locally in print mode within the task work directory with real-time live terminal streaming."""
    agy_bin = shutil.which("agy") or os.path.expandvars(r"%LOCALAPPDATA%\agy\agy.EXE") or "agy"
    model = os.getenv("ANTIGRAVITY_MODEL", "gemini-3.8-flash-high")
    if model in {"gemini-3.8-flash", "gemini-3.8-flash-exp"}:
        model = "gemini-3.8-flash-high"
    effort = os.getenv("ANTIGRAVITY_EFFORT", "high")
    timeout_str = f"{max(5, timeout_seconds // 60)}m0s"

    cmd = [
        str(agy_bin),
        "--model", model,
        "--effort", effort,
        "--dangerously-skip-permissions",
        "--output-format", "text",
        "--print-timeout", timeout_str,
        "--add-dir", str(work_dir.resolve()),
        "-p", prompt,
    ]

    print(f"\n[LangGraph:Coder] Invoking Antigravity CLI (agy -p ... --model {model} --effort {effort}) in {work_dir.name}...")
    print(f"================== LIVE AGY TERMINAL STREAM START ==================")
    sys.stdout.flush()
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(work_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            shell=False,
        )
        combined_lines = []
        if proc.stdout:
            for line in iter(proc.stdout.readline, ""):
                sys.stdout.write(line)
                sys.stdout.flush()
                combined_lines.append(line)
            proc.stdout.close()
        proc.wait(timeout=timeout_seconds)
        print(f"\n=================== LIVE AGY TERMINAL STREAM END ===================")
        sys.stdout.flush()
        combined = "".join(combined_lines)
        return proc.returncode == 0, combined
    except subprocess.TimeoutExpired:
        print(f"\n[LangGraph:Coder] Antigravity CLI timed out after {timeout_seconds}s.")
        proc.kill()
        return False, f"CLI execution timed out after {timeout_seconds}s."
    except Exception as e:
        print(f"\n[LangGraph:Coder] Antigravity CLI error: {e}")
        return False, str(e)


def _build_system_prompt(
    student_name: str,
    student_enrollment: str,
    student_program: str,
    student_uni: str,
    title: str,
    course: str,
    build_spec: str,
    plan: Dict[str, Any],
    custom_directives: str,
    writing_voice: str,
    academic_level: str,
    citation_style: str,
    retry_instructions: str,
    attempt: int,
) -> str:
    """Build the comprehensive system prompt for the autonomous agent."""

    plan_str = json.dumps(plan, indent=2) if plan else "{}"
    directives_block = f"\n\nStudent Guidelines & Working Directives:\n{custom_directives}" if custom_directives else ""
    voice_block = f"\n\nWriting Voice Reference:\n{writing_voice}" if writing_voice else ""
    academic_block = f"\n\nAcademic Depth Note: {academic_level}" if academic_level else ""
    retry_block = (
        f"\n\n{'='*60}\n"
        f"CRITICAL FIX DIRECTIVE — RETRY ATTEMPT #{attempt}\n"
        f"Previous attempt failed verification. You MUST fix this:\n"
        f"{retry_instructions}\n"
        f"{'='*60}"
    ) if retry_instructions and attempt > 1 else ""

    _TOOL_EXAMPLES = (
        '==============================================================\n'
        'HOW TO CALL TOOLS - READ THIS CAREFULLY:\n'
        '==============================================================\n'
        'You MUST use ```tool_call blocks to call every tool. This is the ONLY way to call a tool.\n'
        'Responding with plain text descriptions of what you will do is NOT calling a tool.\n'
        '\n'
        'EXAMPLE - Write a file:\n'
        '```tool_call\n'
        '{"name": "write_file", "arguments": {"path": "main.py", "content": "print(\'hello\')"}}\n'
        '```\n'
        '\n'
        'EXAMPLE - Run a file:\n'
        '```tool_call\n'
        '{"name": "run_python_file", "arguments": {"filename": "main.py"}}\n'
        '```\n'
        '\n'
        'EXAMPLE - Create a notebook:\n'
        '```tool_call\n'
        '{"name": "generate_notebook", "arguments": {"filename": "analysis.ipynb", "cells": [{"type": "markdown", "content": "# Title"}, {"type": "code", "content": "print(\'hi\')"}]}}\n'
        '```\n'
        '\n'
        'EXAMPLE - Execute a notebook with nbclient to populate cell outputs and plots:\n'
        '```tool_call\n'
        '{"name": "execute_notebook", "arguments": {"filename": "analysis.ipynb"}}\n'
        '```\n'
        '\n'
        'EXAMPLE - Package a ZIP with nested inner folder:\n'
        '```tool_call\n'
        '{"name": "package_zip", "arguments": {"archive_name": "submission.zip"}}\n'
        '```\n'
        '\n'
        'YOU MUST USE tool_call BLOCKS. Do NOT write "I will create..." - just DO it.\n'
        '==============================================================\n'
    )

    return (
        f"You are an expert autonomous academic AI agent working on behalf of {student_name} "
        f"(Enrollment No: {student_enrollment}), a {student_program} student at {student_uni}.\n\n"
        f"Your job: Complete the academic assignment below by calling tools iteratively.\n\n"
        f"Assignment: {title}\n"
        f"Course: {course}\n"
        f"Citation Style: {citation_style}"
        f"{directives_block}{voice_block}{academic_block}{retry_block}\n\n"
        f"Execution Plan (what needs to be produced):\n{plan_str}\n\n"
        f"Full Assignment Specification:\n{build_spec[:5000]}\n\n"
        + _TOOL_EXAMPLES +
        "\nWORKFLOW:\n"
        "1. Call list_files to see the workspace state.\n"
        "2. Call write_file or generate_notebook to create deliverables.\n"
        "3. Call run_python_file or execute_notebook to verify code and populate real outputs.\n"
        "4. Fix any errors and re-run.\n"
        "5. Call package_zip to archive all deliverables.\n"
        '6. Say "TASK COMPLETE" when all files are done.\n\n'
        "RULES:\n"
        f"- Replace any <ENRL NO> or placeholder with '{student_enrollment}'.\n"
        "- Write COMPLETE, WORKING code. No TODOs, no stubs, no placeholders.\n"
        "- For Jupyter notebooks, ensure every cell executes cleanly with synthetic fallbacks and execute them.\n"
        "- For presentations, create 16:9 widescreen slides with technical card layouts and speaker notes.\n"
        "- For Word reports, use build_report tool with full academic content.\n"
        "- For ZIP archives, use package_zip with the exact required archive name.\n"
        "- Actually run your Python code with run_python_file to verify it works.\n"
        "- NEVER hardcode data from previous tasks. Generate everything fresh based on the spec.\n"
        "- Do NOT generate placeholder or demo content - everything must be academically complete."
    )


def _build_tool_result_message(tc: ToolCall, result: str) -> Dict[str, Any]:
    """Format a tool result as an assistant-compatible message."""
    return {
        "role": "tool",
        "tool_call_id": tc.id,
        "name": tc.name,
        "content": result,
    }


def _trim_messages(messages: List[Dict], max_count: int) -> List[Dict]:
    """
    Trim the message history to prevent context window overflow.
    Always keeps the system prompt (index 0) and the last max_count messages.
    """
    if len(messages) <= max_count + 1:
        return messages
    system = messages[0]
    recent = messages[-(max_count):]
    return [system] + recent


def _auto_execute_notebooks(work_dir: Path) -> List[str]:
    """
    Checks all .ipynb files in work_dir. If any have code cells with 0 outputs,
    executes them headlessly using nbclient so cells contain real outputs and inline plots.
    """
    executed = []
    from worker.tools.agent_tools import tool_execute_notebook
    for nb_path in sorted(work_dir.glob("*.ipynb")):
        try:
            import nbformat
            nb_obj = nbformat.read(str(nb_path), as_version=4)
            n_code = sum(1 for c in nb_obj.cells if c.get("cell_type") == "code")
            n_out = sum(1 for c in nb_obj.cells if c.get("cell_type") == "code" and len(c.get("outputs", [])) > 0)
            if n_code > 0 and n_out == 0:
                if nb_path.with_name(nb_path.stem + "_executed.ipynb").exists():
                    print(f"[LangGraph:Coder] Notebook '{nb_path.name}' has executed sibling '{nb_path.stem}_executed.ipynb'. Skipping.")
                    continue
                print(f"[LangGraph:Coder] Notebook '{nb_path.name}' has {n_code} unexecuted code cells. Executing with nbclient...")
                res = tool_execute_notebook(work_dir, nb_path.name)
                print(f"  └─ {res}")
                executed.append(f"{nb_path.name}: {res}")
            else:
                print(f"[LangGraph:Coder] Notebook '{nb_path.name}' verified: {n_code} code cells, {n_out} with outputs.")
        except Exception as e:
            print(f"[LangGraph:Coder] Warning checking notebook '{nb_path.name}': {e}")
    return executed


def _auto_package_submission_zip(
    work_dir: Path,
    plan: Dict[str, Any],
    title: str,
    build_spec: str,
    student_enrollment: str,
) -> Optional[str]:
    """
    Checks if a submission zip archive was requested in the plan or specification.
    If not yet created, automatically packages all deliverables into the named ZIP.
    """
    from worker.tools.agent_tools import tool_package_zip
    zip_name = None
    for f in (plan.get("files") or []):
        fn = f.get("filename", "")
        if fn.lower().endswith(".zip"):
            zip_name = fn
            break
    
    if not zip_name:
        m = re.search(r"([a-zA-Z0-9_\-]+\.zip)", f"{title}\n{build_spec}", re.IGNORECASE)
        if m:
            raw_name = m.group(1)
            for placeholder in ["<ENRL NO>", "<ENRL_NO>", "<ENROLLMENT_NO>", "<STUDENT_ID>", "<ROLL_NO>", "[ENRL NO]", "[ENROLLMENT_NO]"]:
                raw_name = raw_name.replace(placeholder, student_enrollment)
            zip_name = raw_name

    if zip_name:
        for placeholder in ["<ENRL NO>", "<ENRL_NO>", "<ENROLLMENT_NO>", "<STUDENT_ID>", "<ROLL_NO>", "[ENRL NO]", "[ENROLLMENT_NO]"]:
            zip_name = zip_name.replace(placeholder, student_enrollment)
        target = work_dir / zip_name
        if not target.exists():
            print(f"[LangGraph:Coder] Packaging submission archive '{zip_name}'...")
            res = tool_package_zip(work_dir, zip_name)
            print(f"  └─ {res}")
            return res
    return None


def _compute_missing_files(work_dir: Path, planned_files: List[str]) -> Tuple[List[Path], List[str]]:
    """Accurately computes missing files by matching both relative paths and file basenames."""
    workspace_paths = list_workspace_files(work_dir)
    current_basenames = {p.name.lower() for p in workspace_paths}
    current_relpaths = {str(p.relative_to(work_dir)).replace("\\", "/").lower() for p in workspace_paths}

    missing = []
    for pf in planned_files:
        if not pf:
            continue
        pf_clean = pf.replace("\\", "/").strip().lower()
        pf_name = Path(pf_clean).name.lower()
        if pf_clean not in current_relpaths and pf_name not in current_basenames:
            missing.append(pf)
    return workspace_paths, missing


def coder_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Coder / Executor
    Orchestration:
      1. Passes comprehensive prompt to Antigravity CLI (`agy -p ...`) in the task workspace.
      2. Waits until `agy` completes all deliverables.
      3. Inspects produced deliverables.
      4. Seamlessly activates ReAct agent loop if any planned deliverables remain missing.
      5. Returns produced files for LangGraph Verifier validation.
    """
    task = state.get("task", {})
    title = state.get("title", task.get("title", "Academic Assignment"))
    course = state.get("course", task.get("course", "Computer Engineering"))
    task_type = state.get("task_type", task.get("task_type", "document"))
    build_spec = state.get("build_spec", task.get("build_spec", ""))
    work_dir = Path(state.get("work_dir", f"work_dirs/{state.get('task_id', 'temp')}"))
    work_dir.mkdir(parents=True, exist_ok=True)

    plan = state.get("plan", {})
    attempt = state.get("attempt", 1)
    retry_instructions = state.get("retry_instructions", "")

    print(f"\n[LangGraph:Coder] Starting execution for '{title}' (Attempt {attempt})...")
    stdout_log = state.get("stdout_log", "")

    # Check if execute_build was patched on worker.worker (e.g. during test runs)
    w_mod = sys.modules.get("worker.worker")
    if w_mod and getattr(w_mod, "execute_build", None) is not getattr(w_mod, "_default_execute_build", None):
        success, stdout_output, produced_files = w_mod.execute_build(
            task,
            retry_count=attempt - 1,
            retry_note=retry_instructions,
        )
        return {
            "produced_files": [str(p) for p in produced_files] if produced_files else [],
            "stdout_log": stdout_output or "",
            "work_dir": str(work_dir),
        }

    # Pull student user profile
    user_prof = {}
    try:
        from worker.worker import get_user_profile
        user_prof = get_user_profile()
    except Exception:
        pass

    student_name = user_prof.get("full_name") or user_prof.get("name") or "Nisarg Patel"
    student_enrollment = user_prof.get("enrollment_no") or "STUDENT_ID"
    student_program = user_prof.get("program") or "B.Tech, Computer Engineering (AIML)"
    student_uni = user_prof.get("university") or "Academic Institution"
    custom_directives = user_prof.get("custom_instructions", "")
    writing_voice = user_prof.get("writing_voice_sample", "")
    academic_level = user_prof.get("academic_level_note", "")
    citation_style = user_prof.get("default_citation_style", "IEEE")

    # Step A: Antigravity CLI Execution (Primary Engine)
    use_agy = os.getenv("USE_AGY_CLI", "true").lower() == "true"
    planned_files = [f.get("filename", "") for f in (plan.get("files") or []) if f.get("filename")]

    if use_agy:
        # Pre-check: if workspace already contains all planned deliverables and no retry instructions
        workspace_paths, missing_files = _compute_missing_files(work_dir, planned_files)
        if workspace_paths and not missing_files and not retry_instructions:
            print(f"[LangGraph:Coder] Workspace already contains all {len(workspace_paths)} planned deliverable(s). Proceeding to verification.")
            _auto_execute_notebooks(work_dir)
            _auto_package_submission_zip(work_dir, plan, title, build_spec, student_enrollment)
            all_files = list_workspace_files(work_dir)
            return {
                "produced_files": [str(f.resolve()) for f in all_files],
                "stdout_log": stdout_log,
                "work_dir": str(work_dir),
                "tool_call_history": [{"engine": "workspace_cache", "status": "complete", "files": [f.name for f in all_files]}],
            }

        agy_timeout = int(os.getenv("ANTIGRAVITY_TIMEOUT", "1800"))
        agy_max_attempts = 3  # Primary, Fallback 1, Fallback 2/3 (Antigravity CLI gemini-3.8-flash-high with effort: high)
        current_retry_notes = retry_instructions

        for agy_tier in range(1, agy_max_attempts + 1):
            tier_label = "Primary" if agy_tier == 1 else f"Fallback {agy_tier - 1}"
            print(f"[LangGraph:Coder] Executing Antigravity CLI ({tier_label} - gemini-3.8-flash-high)...")

            agy_prompt = _build_agy_prompt(
                student_name=student_name,
                student_enrollment=student_enrollment,
                student_program=student_program,
                student_uni=student_uni,
                title=title,
                course=course,
                build_spec=build_spec,
                plan=plan,
                custom_directives=custom_directives,
                writing_voice=writing_voice,
                academic_level=academic_level,
                citation_style=citation_style,
                retry_instructions=current_retry_notes,
                attempt=attempt,
                work_dir=work_dir,
            )

            success, agy_out = _run_agy_cli(work_dir, agy_prompt, timeout_seconds=agy_timeout)
            stdout_log += f"\n--- Antigravity CLI Output ({tier_label}) ---\n{agy_out}\n"

            # Check deliverables produced in workspace
            workspace_paths, missing_files = _compute_missing_files(work_dir, planned_files)

            if workspace_paths and not missing_files:
                print(f"[LangGraph:Coder] Antigravity CLI ({tier_label}) produced all {len(workspace_paths)} planned deliverable(s).")
                _auto_execute_notebooks(work_dir)
                _auto_package_submission_zip(work_dir, plan, title, build_spec, student_enrollment)
                all_files = list_workspace_files(work_dir)
                return {
                    "produced_files": [str(f.resolve()) for f in all_files],
                    "stdout_log": stdout_log,
                    "work_dir": str(work_dir),
                    "tool_call_history": [{"engine": "agy_cli", "status": "complete", "tier": tier_label, "files": [f.name for f in all_files]}],
                }

            # Trigger condition: CLI failure, non-zero exit code, or missing planned files
            trigger_reason = f"Missing planned files: {missing_files}" if missing_files else "CLI completed without generating files."
            print(f"[LangGraph:Coder] Antigravity CLI ({tier_label}) trigger: {trigger_reason}")
            if agy_tier < agy_max_attempts:
                current_retry_notes = (
                    f"CRITICAL FIX REQUIRED: In previous {tier_label} execution, the following planned deliverables are STILL MISSING:\n"
                    f"{missing_files}\n"
                    f"You MUST generate and execute all missing files immediately in this session.\n"
                    f"{retry_instructions}"
                )

        if workspace_paths:
            print(f"[LangGraph:Coder] Antigravity CLI attempts exhausted. Packaging produced files: {[p.name for p in workspace_paths]}")
            _auto_execute_notebooks(work_dir)
            _auto_package_submission_zip(work_dir, plan, title, build_spec, student_enrollment)
            all_files = list_workspace_files(work_dir)
            return {
                "produced_files": [str(f.resolve()) for f in all_files],
                "stdout_log": stdout_log,
                "work_dir": str(work_dir),
                "tool_call_history": [{"engine": "agy_cli", "status": "partial", "files": [f.name for f in all_files]}],
            }

    # Step B: ReAct Agent Loop (Completes Missing or Alternate Files)
    tool_context = {
        "title": title,
        "course": course,
        "student_name": student_name,
        "student_enrollment": student_enrollment,
        "institution": student_uni,
        "task_type": task_type,
    }

    system_prompt = _build_system_prompt(
        student_name=student_name,
        student_enrollment=student_enrollment,
        student_program=student_program,
        student_uni=student_uni,
        title=title,
        course=course,
        build_spec=build_spec,
        plan=plan,
        custom_directives=custom_directives,
        writing_voice=writing_voice,
        academic_level=academic_level,
        citation_style=citation_style,
        retry_instructions=retry_instructions,
        attempt=attempt,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": (
            f"Begin working on: {title}\n"
            f"Course: {course}\n\n"
            f"Start now by calling list_files to see what's in the workspace, "
            f"then immediately create all required deliverables using tool_call blocks."
        )},
    ]

    tool_call_history = []
    step = 0
    consecutive_text_steps = 0

    while step < MAX_AGENT_STEPS:
        step += 1
        trimmed_messages = _trim_messages(messages, MAX_CONTEXT_MESSAGES)

        llm_resp: LLMResponse = call_llm_structured(
            trimmed_messages,
            temperature=0.2,
            max_tokens=8192,
            tools=TOOL_SCHEMAS,
        )

        if llm_resp is None:
            print(f"[LangGraph:Coder] Step {step}: All LLM providers failed. Stopping loop.")
            stdout_log += "Agent loop interrupted: all LLM providers unavailable.\n"
            break

        if llm_resp.has_tool_calls:
            assistant_msg = {
                "role": "assistant",
                "content": llm_resp.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                    }
                    for tc in llm_resp.tool_calls
                ],
            }
            messages.append(assistant_msg)

            for tc in llm_resp.tool_calls:
                print(f"[LangGraph:Coder] Step {step}: tool_call → {tc.name}({_summarize_args(tc.arguments)})")
                result = dispatch_tool(tc.name, tc.arguments, work_dir, context=tool_context)

                tool_call_history.append({
                    "step": step,
                    "tool": tc.name,
                    "args_summary": _summarize_args(tc.arguments),
                    "result_preview": result[:200] if result else "",
                })

                result_preview = result[:120].replace("\n", " ") if result else "(empty)"
                print(f"  └─ result: {result_preview}")
                stdout_log += f"[step={step}] {tc.name}: {result_preview}\n"

                messages.append(_build_tool_result_message(tc, result))
                consecutive_text_steps = 0

        else:
            final_text = llm_resp.content or ""
            messages.append({"role": "assistant", "content": final_text})
            consecutive_text_steps += 1

            workspace_paths, missing_files = _compute_missing_files(work_dir, planned_files)
            current_files = [f.name for f in workspace_paths]

            is_done = any(marker in final_text.upper() for marker in ["TASK COMPLETE", "ALL DONE", "COMPLETED ALL DELIVERABLES"])
            if is_done:
                if workspace_paths and (not missing_files or len(workspace_paths) >= len(planned_files)):
                    print(f"[LangGraph:Coder] Step {step}: Agent declared TASK COMPLETE with {len(workspace_paths)} file(s).")
                    if final_text:
                        stdout_log += f"Agent final message: {final_text[:300]}\n"
                    break
                else:
                    print(f"[LangGraph:Coder] Step {step}: Agent claimed done but deliverables missing: {missing_files}.")
                    messages.append({
                        "role": "user",
                        "content": (
                            f"You stated task complete, but the workspace is missing required deliverable(s): {', '.join(missing_files)}.\n"
                            f"You must create all planned deliverables before finishing. "
                            f"Create the next file now using a ```tool_call block."
                        ),
                    })
                    continue

            if step >= MAX_AGENT_STEPS - 1:
                print(f"[LangGraph:Coder] Step {step}: Max steps approaching ({MAX_AGENT_STEPS}), concluding agent loop.")
                break

            print(f"[LangGraph:Coder] Step {step}: Agent returned text reasoning (step #{consecutive_text_steps}). Steer to action.")
            steer_prompt = _build_agent_steering_prompt(
                final_text=final_text,
                plan=plan,
                current_files=current_files,
                missing_files=missing_files,
                stagnation_count=consecutive_text_steps,
            )
            messages.append({"role": "user", "content": steer_prompt})
            continue

    _auto_execute_notebooks(work_dir)
    _auto_package_submission_zip(work_dir, plan, title, build_spec, student_enrollment)
    all_files = list_workspace_files(work_dir)
    file_strs = [str(f.resolve()) for f in all_files]
    print(f"[LangGraph:Coder] Execution completed with {len(all_files)} deliverable file(s).")

    return {
        "produced_files": file_strs,
        "stdout_log": stdout_log,
        "work_dir": str(work_dir),
        "tool_call_history": tool_call_history,
    }


def _summarize_args(args: Dict[str, Any]) -> str:
    """Create a concise summary of tool call arguments for logging."""
    summary_parts = []
    for k, v in args.items():
        if isinstance(v, str) and len(v) > 60:
            summary_parts.append(f"{k}='...{len(v)} chars...'")
        elif isinstance(v, list):
            summary_parts.append(f"{k}=[{len(v)} items]")
        else:
            summary_parts.append(f"{k}={repr(v)[:40]}")
    return ", ".join(summary_parts)


def _build_agent_steering_prompt(
    final_text: str,
    plan: Dict[str, Any],
    current_files: List[str],
    missing_files: List[str],
    stagnation_count: int,
) -> str:
    """
    Dynamically steer the LLM agent from reasoning to tool execution.
    Analyzes what the LLM was discussing and directs it to invoke the appropriate tool
    with full, complete code. Zero hardcoded stubs.
    """
    target_file = None
    for f in missing_files:
        if f.lower() in final_text.lower():
            target_file = f
            break
    if not target_file and missing_files:
        target_file = missing_files[0]

    if target_file:
        ext = target_file.rsplit(".", 1)[-1].lower() if "." in target_file else ""
        if ext == "ipynb":
            tool_hint = f'generate_notebook for "{target_file}" with complete markdown and runnable code cells'
        elif ext == "pptx":
            tool_hint = f'build_presentation for "{target_file}" with full slides'
        elif ext == "docx":
            tool_hint = f'build_report for "{target_file}" with full academic markdown'
        elif ext == "zip":
            tool_hint = f'package_zip for "{target_file}" to archive deliverables'
        elif ext == "py":
            tool_hint = f'write_file for "{target_file}" with complete, working Python code'
        else:
            tool_hint = f'write_file for "{target_file}"'

        return (
            f"You explained your plan. Now EXECUTE it immediately using a ```tool_call block.\n"
            f"Target deliverable: {tool_hint}.\n"
            f"Write the COMPLETE, high-quality content now — no stubs, placeholders, or TODOs.\n"
            f"Format:\n```tool_call\n"
            f'{{\"name\": \"...\", \"arguments\": {{...}}}}\n```'
        )

    if current_files and not any(f.endswith(".zip") for f in current_files):
        return (
            "You have created source files. Test your implementation using run_python_file, "
            "and when verified, package all deliverables into the submission ZIP archive using package_zip."
        )

    return (
        "Execute your next required action right now using a ```tool_call block. "
        "Do not output plain conversation — invoke the tool to make progress."
    )
