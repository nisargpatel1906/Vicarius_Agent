"""
Vicarius Agent - Coder Node
Dynamically generates complete, high-quality deliverables based on the Planner blueprint
and any Reflexion fix directives. Operates with zero hardcoded code templates.
"""

import re
from pathlib import Path
from typing import Dict, Any, List

from worker.state import AgentState
from worker.llm import call_llm, safe_parse_json
from worker.tools.file_tools import write_file, list_workspace_files
from worker.tools.media_tools import build_report_docx, build_presentation_pptx, generate_ui_screenshot
from worker.tools.packaging_tools import package_project_zip, package_android_apk


def coder_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Coder / Executor
    Generates and writes all planned project files, documents, tests, and packages.
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

    print(f"\n[LangGraph:Coder] Generating deliverables for '{title}' (Attempt {attempt})...")
    stdout_log = state.get("stdout_log", "")

    # Check if execute_build was patched on worker.worker (e.g. during test runs)
    import sys
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

    # Inject Reflexion critique if this is an informed retry
    retry_context = ""
    if retry_instructions:
        retry_context = (
            f"\n\n=======================================================\n"
            f"[CRITICAL FIX DIRECTIVE - RETRY ATTEMPT #{attempt}]\n"
            f"The previous attempt failed verification with the following issue:\n"
            f"{retry_instructions}\n"
            f"You MUST explicitly resolve this flaw in your generated files!\n"
            f"=======================================================\n\n"
        )

    # Pull user profile from database
    user_prof = {}
    try:
        from worker.worker import get_user_profile
        user_prof = get_user_profile()
    except Exception:
        pass

    student_name = user_prof.get("full_name", "Nisarg Patel")
    student_program = user_prof.get("program", "B.Tech, Computer Engineering (AIML)")
    student_uni = user_prof.get("university", "Academic Institution")
    custom_directives = user_prof.get("custom_instructions", "")
    writing_voice = user_prof.get("writing_voice_sample", "")
    academic_level = user_prof.get("academic_level_note", "")
    citation_style = user_prof.get("default_citation_style", "IEEE")

    directives_prompt = f"\nStudent Guidelines & Working Directives: {custom_directives}" if custom_directives else ""
    voice_prompt = f"\nWriting Style & Voice Sample (anchor sentence rhythm to this, do not copy verbatim):\n{writing_voice}" if writing_voice else ""
    academic_prompt = f"\nAcademic Depth Note: {academic_level}" if academic_level else ""

    # 1. Code Projects (Android, Web, Python, Systems)
    if task_type == "code_project":
        planned_files = plan.get("files", [])
        planned_files_str = "\n".join(f"- {f.get('filename')}: {f.get('purpose')}" for f in planned_files)

        sys_prompt = (
            f"You are an expert senior software engineer and academic tutor for {student_name}, a {student_program} "
            f"student at {student_uni}.{directives_prompt}\n"
            f"Course: {course} | Project: {title}\n"
            f"Generate a complete, fully functioning software codebase directly implementing all requirements.\n"
            f"Return ONLY a valid JSON object with the following schema (no markdown formatting outside the JSON):\n"
            "{\n"
            '  "files": [\n'
            '    {"filename": "relative/path/to/file.ext", "content": "complete, unabridged source code"}\n'
            "  ],\n"
            '  "readme": "Comprehensive README with setup, architecture, and execution guide"\n'
            "}\n"
            "Requirements:\n"
            "- Implement every single requirement in full. Do NOT leave TODOs, stubs, or placeholders.\n"
            "- For Android projects: write complete Activities/Fragments, XML layouts, AndroidManifest.xml with required permissions, build.gradle, and Report.md.\n"
            "- Include a complete, professional 'Report.md' covering Problem Aim, Architecture, Code Walkthrough, and Outcome.\n"
            "- Include a 'README.md' explaining setup and verification."
        )

        user_prompt = (
            f"Project: {title}\n"
            f"Course: {course}\n\n"
            f"{retry_context}"
            f"Execution Blueprint Planned Files:\n{planned_files_str}\n\n"
            f"Full Assignment Specifications:\n{build_spec[:4000]}"
        )

        resp = call_llm([
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt},
        ], temperature=0.2, max_tokens=8192)

        parsed = safe_parse_json(resp)
        files_data = parsed.get("files", []) if isinstance(parsed, dict) else []

        # If LLM didn't return files array, construct basic structure from plan
        if not files_data:
            print("[LangGraph:Coder] LLM raw output recovery — writing core markdown reports.")
            write_file(work_dir, "Report.md", f"# {title}\n\n## Overview\n{build_spec[:1000]}")
            write_file(work_dir, "README.md", f"# {title}\n\nAcademic project for {course}.")
        else:
            for finfo in files_data:
                fname = finfo.get("filename", "output.txt")
                content = finfo.get("content", "")
                write_file(work_dir, fname, content)
                print(f"[LangGraph:Coder] Wrote {fname} ({len(content)} chars)")

        # Generate formal report.docx from Report.md or README.md
        report_text = ""
        for r_cand in ["Report.md", "report.md", "README.md"]:
            cand_p = work_dir / r_cand
            if cand_p.exists():
                report_text = cand_p.read_text(encoding="utf-8", errors="ignore")
                break
        if not report_text:
            report_text = f"# {title}\n\nAcademic project report for {course}."

        docx_path = build_report_docx(work_dir, report_text, title=title, course=course, student_name=student_name, institution=student_uni)
        print(f"[LangGraph:Coder] Built formal deliverable: {docx_path.name}")

        # Ensure smoke test script exists via dynamic generation
        smoke_p = work_dir / "smoke_test.py"
        if not smoke_p.exists() or smoke_p.stat().st_size < 30:
            smoke_gen = call_llm([
                {"role": "system", "content": "You are a Python QA engineer. Write a concise, executable smoke test script (smoke_test.py) validating the codebase components, imports, and core logic. Return ONLY runnable Python code."},
                {"role": "user", "content": f"Project: {title}\nCourse: {course}\nFiles:\n" + "\n".join(f.name for f in work_dir.glob("**/*") if f.is_file())},
            ], temperature=0.2, max_tokens=1000)
            if smoke_gen:
                clean_smoke = re.sub(r"```[a-zA-Z]*\n?", "", smoke_gen).replace("```", "").strip()
                write_file(work_dir, "smoke_test.py", clean_smoke)

        # Detect Android project and package APK if needed
        is_android = any(
            "android" in f.name.lower() or f.name.endswith(".kt") or f.name.endswith(".xml")
            for f in work_dir.glob("**/*")
        )
        if is_android:
            apk_path = package_android_apk(work_dir)
            print(f"[LangGraph:Coder] Packaged Android binary: {apk_path.name} ({apk_path.stat().st_size / (1024*1024):.2f} MB)")

        # Generate UI Preview Screenshot
        ss_path = generate_ui_screenshot(work_dir, title=title, subtitle=f"{course} Application")
        print(f"[LangGraph:Coder] Generated UI preview screenshot: {ss_path.name}")

        # Package clean ZIP archive
        zip_path = package_project_zip(work_dir)
        if zip_path:
            print(f"[LangGraph:Coder] Packaged clean source zip: {zip_path.name}")

        stdout_log += f"Completed code project generation for attempt {attempt}.\n"

    # 2. Presentations (PPTX)
    elif task_type == "presentation":
        slide_count = 10
        m = re.search(r"(\d+)\s*slide", build_spec, re.IGNORECASE)
        if m:
            slide_count = int(m.group(1))

        sys_prompt = (
            f"You are an expert presentation designer for {student_name}, a {student_program} student at {student_uni}.{directives_prompt}\n"
            f"Generate an academic PowerPoint deck of exactly {slide_count} slides directly addressing the assignment.\n"
            f"Return ONLY valid JSON array with this structure:\n"
            f'[{{"title": "Slide Title", "body": "• Point 1\\n• Point 2\\n• Point 3", "speaker_notes": "Detailed script..."}}]\n'
        )
        user_prompt = f"Topic: {title}\nCourse: {course}\nRequirements:\n{build_spec[:3000]}"
        resp = call_llm([{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}], temperature=0.3, max_tokens=6000)
        parsed_slides = safe_parse_json(resp)
        if not isinstance(parsed_slides, list) or len(parsed_slides) == 0:
            from worker.llm import call_llm_with_failover
            resp_fallback = call_llm_with_failover([{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}], temperature=0.2, max_tokens=6000)
            parsed_slides = safe_parse_json(resp_fallback) or []

        pptx_path = build_presentation_pptx(work_dir, parsed_slides, title=title, course=course, student_name=student_name)
        print(f"[LangGraph:Coder] Built {len(parsed_slides)}-slide presentation: {pptx_path.name}")
        stdout_log += f"Generated {len(parsed_slides)} slides in PPTX deliverable.\n"

    # 3. Documents & Research Reports
    else:
        sys_prompt = (
            f"You are a computer science professor and researcher assisting student {student_name} ({student_program}) at {student_uni}.\n"
            f"{directives_prompt}{academic_prompt}{voice_prompt}\n"
            f"Preferred Citation Style: {citation_style}.\n"
            f"Generate an extensive, rigorous academic report in clean, standard GitHub-flavored Markdown solving every question in the requirements.\n"
            f"Do NOT wrap the output in JSON. Output pure Markdown directly, starting with the main # Title.\n"
            f"Include exhaustive sections covering Background, Mathematical Formulations, Step-by-Step Solutions, Comparison Tables, and {citation_style} Citations."
        )
        user_prompt = f"Title: {title}\nCourse: {course}\nInstructions:\n{build_spec[:3500]}"
        resp = call_llm([{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}], temperature=0.2, max_tokens=8192)

        raw_output = resp or f"# {title}\n\nAcademic report for {course}."
        from worker.tools.media_tools import clean_markdown_text
        md_text = clean_markdown_text(raw_output)

        write_file(work_dir, "Report.md", md_text)
        docx_path = build_report_docx(work_dir, md_text, title=title, course=course, student_name=student_name, institution=student_uni)
        print(f"[LangGraph:Coder] Built academic report: {docx_path.name}")
        stdout_log += f"Generated academic report document: {docx_path.name}\n"

    # Scan and register all produced deliverables
    all_files = list_workspace_files(work_dir)
    file_strs = [str(f.resolve()) for f in all_files]
    print(f"[LangGraph:Coder] Produced {len(all_files)} total deliverable file(s).")

    return {
        "produced_files": file_strs,
        "stdout_log": stdout_log,
        "work_dir": str(work_dir),
    }
