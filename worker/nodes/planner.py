"""
Vicarius Agent - Planner Node
Analyzes task requirements, attachments, and success criteria to dynamically
formulate a structured execution blueprint including tool hints and execution strategy.
"""

from typing import Dict, Any
from worker.state import AgentState
from worker.llm import call_llm, safe_parse_json


def planner_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Planner
    Decomposes the assignment into an architectural plan with:
    - files to generate
    - rubric items
    - tool hints for the Coder agent
    - execution strategy
    """
    task = state.get("task", {})
    title = state.get("title", task.get("title", "Academic Task"))
    course = state.get("course", task.get("course", "General"))
    task_type = state.get("task_type", task.get("task_type", "document"))
    build_spec = state.get("build_spec", task.get("build_spec", ""))

    print(f"\n[LangGraph:Planner] Formulating dynamic execution blueprint for '{title}' ({task_type})...")

    from worker.tools.progress import report_progress
    task_id = state.get("task_id", task.get("id"))
    report_progress(task_id, "claimed", f"Planner: Formulating execution blueprint and deliverable specifications for '{title}'...", state)

    # If execute_build is mocked by a test suite, avoid extraneous network calls
    import sys
    w_mod = sys.modules.get("worker.worker")
    if w_mod and getattr(w_mod, "execute_build", None) is not getattr(w_mod, "_default_execute_build", None):
        return {"plan": {"architecture": "test", "files": [], "rubric_items": [title]}}

    # Pull user profile from database
    user_prof = {}
    try:
        from worker.worker import get_user_profile
        user_prof = get_user_profile()
        if not user_prof:
            print("[LangGraph:Planner] Warning: Could not fetch user profile from Supabase — proceeding with empty profile.")
            user_prof = {}
    except Exception as e:
        print(f"[LangGraph:Planner] Warning: Profile fetch error: {e}")
        user_prof = {}

    student_name = user_prof.get("full_name") or user_prof.get("name") or "Nisarg Patel"
    student_enrollment = user_prof.get("enrollment_no") or "STUDENT_ID"
    student_program = user_prof.get("program") or "B.Tech, Computer Engineering (AIML)"
    student_uni = user_prof.get("university") or "Academic Institution"
    custom_directives = user_prof.get("custom_instructions", "")
    skills_list = user_prof.get("skills", [])
    skills_str = ", ".join(skills_list) if isinstance(skills_list, list) else str(skills_list)

    directives_prompt = f"\nStudent Guidelines & Working Directives: {custom_directives}" if custom_directives else ""
    skills_prompt = f"\nStudent Technical Skillset: {skills_str}" if skills_str else ""

    sys_prompt = (
        f"You are an expert academic AI agent for {student_name} "
        f"(Enrollment No: {student_enrollment}), a {student_program} student at {student_uni}.{directives_prompt}{skills_prompt}\n"
        "Analyze the assignment specification and produce a structured execution blueprint in JSON.\n\n"
        "Available tools the Coder agent can use:\n"
        "- write_file: write any file (Python, Markdown, HTML, etc.)\n"
        "- generate_notebook: create .ipynb notebooks with proper cell structure\n"
        "- execute_notebook: run a .ipynb notebook headlessly using nbclient so that all cells contain executed outputs and plots\n"
        "- build_presentation: create .pptx presentations with slides (16:9 widescreen layout)\n"
        "- build_report: create .docx Word reports from Markdown\n"
        "- run_python: execute Python code and verify output\n"
        "- run_python_file: run a Python file\n"
        "- package_zip: package files into a named ZIP archive (auto-wraps in inner folder matching archive stem)\n"
        "- search_web: search for documentation or algorithms\n"
        "- generate_screenshot: create a UI preview screenshot\n\n"
        "Return ONLY a valid JSON object:\n"
        "{\n"
        '  "architecture": "High-level design pattern or academic paper structure",\n'
        '  "execution_strategy": "Brief description of order and approach",\n'
        '  "files": [\n'
        '    {"filename": "relative/path/to/file.ext", "purpose": "description", "tool": "which tool to use"}\n'
        "  ],\n"
        '  "rubric_items": ["R1: specific requirement from spec", "R2: ..."],\n'
        '  "tool_hints": ["generate_notebook", "build_presentation"],\n'
        '  "deliverable_types": ["ipynb", "pptx", "docx", "zip"]\n'
        "}\n\n"
        "STRICT DELIVERY RULES:\n"
        "1. ONLY plan files that the user's build_spec explicitly requests.\n"
        "   - If the user says 'make a ppt on mobile gaming', plan ONLY the .pptx file.\n"
        "   - Do NOT add: README.md, smoke_test.py, generator scripts (create_*.py), extra ZIPs,\n"
        "     or any file not directly mentioned or required by the specification.\n"
        "2. STUDENT PERSONALIZATION: If the spec uses placeholders like <ENRL NO>, <ENROLLMENT_NO>,\n"
        f"   <STUDENT_ID>, or <ROLL_NO>, replace them with '{student_enrollment}'.\n"
        "3. For submission ZIP archives: the archive MUST contain an inner directory matching the zip stem.\n"
        "4. NEVER plan placeholder files. Plan every real required file.\n"
        "5. Do not add files just to be thorough — if the spec doesn't mention it, don't plan it."
    )

    user_prompt = (
        f"Task Title: {title}\n"
        f"Course: {course}\n"
        f"Task Type: {task_type}\n"
        f"Student Enrollment No: {student_enrollment}\n"
        f"Student Name: {student_name}\n\n"
        f"Assignment Instructions & Build Specification:\n"
        f"{build_spec[:15000]}"
    )

    resp = call_llm([
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": user_prompt},
    ], temperature=0.1, max_tokens=3000)

    parsed_plan = safe_parse_json(resp)
    if isinstance(parsed_plan, dict) and "files" in parsed_plan:
        # Guarantee student enrollment substitution in all planned filenames
        for f in parsed_plan.get("files", []):
            fname = f.get("filename", "")
            for placeholder in ["<ENRL NO>", "<ENRL_NO>", "<ENROLLMENT_NO>", "<STUDENT_ID>", "<ROLL_NO>", "[ENRL NO]", "[ENROLLMENT_NO]"]:
                if placeholder in fname:
                    fname = fname.replace(placeholder, student_enrollment)
                    f["filename"] = fname

        n_files = len(parsed_plan.get("files", []))
        tool_hints = parsed_plan.get("tool_hints", [])
        strategy = parsed_plan.get("execution_strategy", "")
        print(f"[LangGraph:Planner] Generated plan with {n_files} planned files.")
        if tool_hints:
            print(f"[LangGraph:Planner] Tool hints: {', '.join(tool_hints)}")
        if strategy:
            print(f"[LangGraph:Planner] Strategy: {strategy[:100]}")
        return {"plan": parsed_plan}

    # Minimal dynamic fallback plan if LLM parsing failed
    print("[LangGraph:Planner] Warning: LLM plan parse failed — using minimal fallback plan.")
    # Determine a sensible single deliverable based on task_type; do NOT add extra files.
    if task_type in ("presentation",):
        fallback_file = {"filename": f"{title.replace(' ', '_')}.pptx", "purpose": "Main presentation deliverable", "tool": "build_presentation"}
        fallback_types = ["pptx"]
        fallback_hints = ["build_presentation"]
    elif task_type in ("notebook",):
        fallback_file = {"filename": f"{title.replace(' ', '_')}.ipynb", "purpose": "Jupyter notebook deliverable", "tool": "generate_notebook"}
        fallback_types = ["ipynb"]
        fallback_hints = ["generate_notebook", "execute_notebook"]
    elif task_type in ("code_project",):
        fallback_file = {"filename": "main.py", "purpose": "Main code file", "tool": "write_file"}
        fallback_types = ["py"]
        fallback_hints = ["write_file", "run_python_file"]
    else:
        fallback_file = {"filename": "Report.md", "purpose": "Technical report addressing requirements", "tool": "write_file"}
        fallback_types = ["docx"]
        fallback_hints = ["write_file", "build_report"]

    fallback_plan = {
        "architecture": f"Standard deliverable for {task_type}",
        "execution_strategy": "Produce the required deliverable based on the build spec",
        "files": [fallback_file],
        "rubric_items": [f"Complete: {title}"],
        "tool_hints": fallback_hints,
        "deliverable_types": fallback_types,
    }
    return {"plan": fallback_plan}
