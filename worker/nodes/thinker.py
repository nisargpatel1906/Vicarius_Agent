"""
Vicarius Agent - Thinker Node
Sits between Planner and Coder. Uses the existing free-model LLM chain
(Gemini → OpenRouter free → Groq) to reason about the task and produce a
concrete, ordered execution plan that is injected into the Antigravity CLI prompt.

Improves AGY output quality by front-loading all strategic reasoning --
risks, fallbacks, exact file ordering, library needs -- before AGY runs.
"""

import re
import json as _json
from typing import Dict, Any

from worker.state import AgentState
from worker.llm import call_llm


def _extract_tagged_block(text: str, tag: str) -> str:
    """
    Extract content between <tag> ... </tag>.
    Two-pass strategy:
      1. Full paired-tag match (preferred — clean boundaries).
      2. Greedy fallback: grab everything after <tag> when the model
         truncates and the closing tag is missing.
    """
    if not text:
        return ""
    # Pass 1: paired tags
    paired = re.compile(rf"<{tag}>(.*?)</{tag}>", re.DOTALL | re.IGNORECASE)
    m = paired.search(text)
    if m:
        return m.group(1).strip()
    # Pass 2: opening tag only — grab to end of string (or next opening tag)
    open_tag = re.compile(rf"<{tag}>(.*)", re.DOTALL | re.IGNORECASE)
    m2 = open_tag.search(text)
    if m2:
        content = m2.group(1).strip()
        # Trim off any sibling opening tags that follow (e.g. <execution_plan>...)
        sibling = re.search(r"<[a-z_]+>", content, re.IGNORECASE)
        if sibling:
            content = content[: sibling.start()].strip()
        return content
    return ""


def thinker_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Thinker (Pre-Prompt Reasoning)

    Produces:
      - thought_process: raw inner reasoning (stored for audit/debugging)
      - agy_execution_plan: structured, ordered, risk-aware plan injected
                            into the AGY CLI prompt header
    """
    task = state.get("task", {})
    title = state.get("title", task.get("title", "Academic Task"))
    course = state.get("course", task.get("course", "General"))
    task_type = state.get("task_type", task.get("task_type", "document"))
    build_spec = state.get("build_spec", task.get("build_spec", ""))
    plan = state.get("plan", {})
    attempt = state.get("attempt", 1)
    retry_instructions = state.get("retry_instructions", "")

    print(f"\n[LangGraph:Thinker] Reasoning about '{title}' before prompt generation...")

    # Pull student profile for personalisation context
    user_prof: Dict[str, Any] = {}
    try:
        from worker.worker import get_user_profile
        user_prof = get_user_profile() or {}
    except Exception as e:
        print(f"[LangGraph:Thinker] Warning: profile fetch error: {e}")

    student_name = user_prof.get("full_name") or user_prof.get("name") or "Nisarg Patel"
    student_enrollment = user_prof.get("enrollment_no") or "STUDENT_ID"
    student_program = user_prof.get("program") or "B.Tech, Computer Engineering (AIML)"
    student_uni = user_prof.get("university") or "Academic Institution"

    plan_summary = _json.dumps(plan, indent=2)[:3000] if plan else "{}"
    retry_block = (
        f"\n\nIMPORTANT -- RETRY CONTEXT (Attempt #{attempt}):\n"
        f"Previous attempt failed. You MUST reason about WHY it failed and how to fix it:\n"
        f"{retry_instructions}\n"
    ) if retry_instructions and attempt > 1 else ""

    # -- System Prompt ---------------------------------------------------------
    system_prompt = (
        "You are an expert AI assignment architect and prompt engineer.\n"
        "Your sole job is to THINK DEEPLY about an academic task and produce a CONCISE, ORDERED, "
        "RISK-AWARE execution plan that will be injected into an autonomous coding agent's prompt.\n\n"
        "The coding agent (Antigravity CLI / AGY) is highly capable — it will write all code itself. "
        "Your job is NOT to write code for it. Your job is to give it CRYSTAL-CLEAR INTENT: "
        "WHAT to build, in what ORDER, with what CONSTRAINTS and FALLBACK BEHAVIOURS.\n\n"
        "== WHAT TO THINK ABOUT ==\n"
        "1. **File Creation Order**: Which files must exist before others? (generator scripts before notebooks)\n"
        "2. **Library & Import Risks**: What third-party libraries are needed? Any that need special install?\n"
        "3. **Headless Execution Risks**: Will notebooks run headlessly (no display)? Mandate matplotlib Agg backend.\n"
        "4. **Synthetic Fallbacks**: Is webcam/camera needed? Mandate a get_video_source() synthetic fallback.\n"
        "5. **Dataset Access**: Are external datasets needed? Mandate synthetic generators as fallback.\n"
        "6. **Naming Constraints**: Enrollment placeholders? ZIP inner-folder structure? Archive naming?\n"
        "7. **Presentation Layout**: Is 16:9 widescreen needed? Speaker notes on every slide?\n"
        "8. **Academic Depth**: Reports need equations, tables, IEEE citations -- specify section structure.\n"
        "9. **Verification Steps**: After each file, what command confirms it works?\n"
        "10. **Common Failure Modes**: What went wrong in previous attempts if this is a retry?\n\n"
        "== STRICT OUTPUT RULES ==\n"
        "You MUST output exactly two XML-tagged blocks:\n\n"
        "<thought_process>\n"
        "[Your deep reasoning scratchpad — risks, dependencies, fallback strategies. Be exhaustive.]\n"
        "</thought_process>\n\n"
        "<execution_plan>\n"
        "[MANDATORY RULES FOR THIS BLOCK:]\n"
        "- Write HIGH-LEVEL DIRECTIVES ONLY. Do NOT write Python code, shell commands, or code snippets.\n"
        "- Use natural language to describe INTENT: 'Create X that does Y using Z pattern.'\n"
        "- Do NOT paste function signatures, class bodies, import lists, or JSON structures.\n"
        "- Each step = one clear sentence stating the file to create + its purpose + critical requirement.\n"
        "- Use bullet points or numbered steps. Keep each step under 3 lines.\n"
        "- Allowed: mentioning library names, file names, patterns (e.g. 'use synthetic fallback', 'set Agg backend').\n"
        "- Forbidden: actual code blocks, triple backticks, def/class/import statements.\n"
        "- End every plan with a VERIFY step listing what outputs must exist when done.\n"
        "</execution_plan>"
    )

    # -- User Prompt -----------------------------------------------------------
    user_prompt = (
        f"== TASK METADATA ==\n"
        f"Title: {title}\n"
        f"Course: {course}\n"
        f"Type: {task_type}\n"
        f"Student: {student_name} (Enrollment: {student_enrollment})\n"
        f"Program: {student_program} @ {student_uni}\n"
        f"{retry_block}\n"
        f"== PLANNER OUTPUT (what needs to be built) ==\n"
        f"{plan_summary}\n\n"
        f"== FULL ASSIGNMENT SPECIFICATION ==\n"
        f"{build_spec[:12000]}\n\n"
        f"Now think deeply and produce the <thought_process> and <execution_plan> blocks."
    )

    # -- Call LLM --------------------------------------------------------------
    # Chain: OpenRouter free (attempt 1) → OpenRouter free (attempt 2) → Gemini free.
    # Groq is excluded by passing preferred_provider="openrouter":
    # llm.py's Groq block only fires when preferred_provider is None or "groq".
    raw_response = None
    try:
        raw_response = call_llm(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.15,
            max_tokens=4096,
            preferred_provider="openrouter",  # OpenRouter×2 → Gemini, no Groq
        )
    except Exception as e:
        print(f"[LangGraph:Thinker] LLM call failed: {e}")
        return {"thought_process": "", "agy_execution_plan": ""}

    if not raw_response:
        print("[LangGraph:Thinker] Warning: empty response from LLM -- thinker will be a no-op.")
        return {"thought_process": "", "agy_execution_plan": ""}

    # -- Parse output ----------------------------------------------------------
    thought = _extract_tagged_block(raw_response, "thought_process")
    exe_plan = _extract_tagged_block(raw_response, "execution_plan")

    if not exe_plan:
        # Fallback: if XML tags are missing, use full response as the plan
        exe_plan = raw_response.strip()
        thought = ""
        print("[LangGraph:Thinker] Warning: response did not contain XML tags -- using full response as plan.")

    thought_preview = (thought[:150] + "...") if len(thought) > 150 else thought
    plan_preview = (exe_plan[:200] + "...") if len(exe_plan) > 200 else exe_plan

    print(f"[LangGraph:Thinker] Thought process captured ({len(thought)} chars).")
    print(f"[LangGraph:Thinker] Execution plan generated ({len(exe_plan)} chars).")
    if thought_preview:
        print(f"[LangGraph:Thinker] Thought snippet: {thought_preview}")
    print(f"[LangGraph:Thinker] Plan snippet: {plan_preview}")

    return {
        "thought_process": thought,
        "agy_execution_plan": exe_plan,
    }
