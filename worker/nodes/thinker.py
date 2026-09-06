"""
Vicarius Agent - Thinker Node  (v3 — LangGraph quality-retry loop)
====================================================================
Two LangGraph nodes work together:

  1. thinker_node
       Calls the free-model LLM chain (OpenRouter×2 → Gemini) to reason
       about the task and produce a structured execution plan in two
       XML-tagged blocks: <thought_process> and <execution_plan>.

  2. thinker_validator_node
       Scores the plan on 5 quality dimensions (0-1 each):
         A. XML tags present & separated (thought_process / execution_plan)
         B. PHASE structure (≥2 distinct PHASEs labelled)
         C. VERIFY phase at the end
         D. No triple-backtick code blocks or raw def/class/import lines
         E. Thought process captured (≥200 chars)
       Aggregates to a 0-1 score. If score < QUALITY_THRESHOLD and
       thinker_retries < MAX_THINKER_RETRIES, writes a targeted
       'thinker_retry_note' into state and returns needs_retry=True so
       graph.py can loop back. Otherwise passes through to coder.

graph.py wires:  planner → thinker → thinker_validator → [coder | thinker]
"""

import re
import json as _json
from typing import Dict, Any, Literal

from worker.state import AgentState
from worker.llm import call_llm


# ── Constants ──────────────────────────────────────────────────────────────────
MAX_THINKER_RETRIES: int = 2      # after 2 retries, accept whatever we have
QUALITY_THRESHOLD:   float = 0.75  # minimum passing score (out of 1.0)


# ── Helpers ────────────────────────────────────────────────────────────────────

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
        # Trim off any sibling opening tags that follow
        sibling = re.search(r"<[a-z_]+>", content, re.IGNORECASE)
        if sibling:
            content = content[: sibling.start()].strip()
        return content
    return ""


def _score_plan(thought: str, plan: str) -> tuple[float, list[str]]:
    """
    Score the thinker output 0.0-1.0 on 5 dimensions.
    Returns (score, list_of_failures).
    """
    failures = []

    # A. XML tags: both blocks must have content
    score_A = 1.0 if (thought and plan and len(thought) > 50 and len(plan) > 100) else 0.0
    if score_A == 0.0:
        failures.append(
            "XML tags missing or both blocks empty. "
            "You MUST output exactly <thought_process>...</thought_process> "
            "then <execution_plan>...</execution_plan>."
        )

    # B. PHASE structure (at least 2 phases mentioned)
    phase_count = len(re.findall(r"PHASE\s+\d", plan, re.IGNORECASE))
    score_B = 1.0 if phase_count >= 2 else (0.5 if phase_count == 1 else 0.0)
    if score_B < 1.0:
        failures.append(
            f"PHASE grouping weak (found {phase_count} PHASE labels). "
            "Group steps into at least 3 phases: PHASE 0: Setup, PHASE 1: Build, "
            "PHASE 2: Execute, PHASE 3: Package, PHASE 4: Verify."
        )

    # C. VERIFY phase at the end
    has_verify = bool(re.search(r"VERIFY|verification", plan, re.IGNORECASE))
    score_C = 1.0 if has_verify else 0.0
    if not has_verify:
        failures.append(
            "Missing VERIFY phase at the end. "
            "Add a final phase bullet-listing every expected output file with its name."
        )

    # D. No triple-backtick code blocks
    triple_backtick_count = plan.count("```")
    # also check for raw def/class on their own line
    raw_code_lines = re.findall(r"^\s*(def |class |import )", plan, re.MULTILINE)
    score_D = 1.0 if (triple_backtick_count == 0 and not raw_code_lines) else 0.0
    if score_D == 0.0:
        failures.append(
            f"Code leaked into plan ({triple_backtick_count} triple-backtick blocks, "
            f"{len(raw_code_lines)} raw code lines). "
            "FORBIDDEN: triple backticks, def/class/import as actual code. "
            "Write INTENT only — describe what to build, not how."
        )

    # E. Thought process captured (≥200 chars)
    score_E = 1.0 if len(thought) >= 200 else (0.5 if len(thought) >= 50 else 0.0)
    if score_E < 1.0:
        failures.append(
            f"Thought process too short ({len(thought)} chars). "
            "The <thought_process> block should contain your full reasoning scratchpad "
            "(risks, dependencies, fallback decisions) — aim for 500+ chars."
        )

    # Weighted average (A is most critical)
    weights = [0.30, 0.25, 0.15, 0.20, 0.10]
    scores  = [score_A, score_B, score_C, score_D, score_E]
    final   = sum(w * s for w, s in zip(weights, scores))
    return round(final, 3), failures


def _build_system_prompt() -> str:
    return (
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
        "You MUST output exactly two XML-tagged blocks and NOTHING ELSE before or after them:\n\n"
        "<thought_process>\n"
        "[Your deep reasoning scratchpad — risks, dependencies, fallback strategies. Aim for 500+ chars.]\n"
        "</thought_process>\n\n"
        "<execution_plan>\n"
        "[MANDATORY FORMAT & CONTENT RULES:]\n\n"
        "STRUCTURE: Group steps into 3-5 labelled PHASES:\n"
        "  PHASE 0: Setup & Environment\n"
        "  PHASE 1: Build Source Files\n"
        "  PHASE 2: Execute & Verify Each File\n"
        "  PHASE 3: Package & Archive\n"
        "  PHASE 4: Final VERIFY\n"
        "Each phase MUST have a bold header line.\n\n"
        "STEP LENGTH: Every step fits in 1-2 lines. "
        "If more detail is needed, use sub-steps (0a, 0b, 0c). "
        "No wall-of-text paragraphs.\n\n"
        "LANGUAGE: High-level INTENT only — describe WHAT to build and its critical constraint. "
        "Do NOT write Python code, shell commands, function signatures, class bodies, or JSON.\n\n"
        "FAIL-FAST: After each phase include: "
        "'Gate: If any step in this phase failed, STOP and fix it before Phase N+1.'\n\n"
        "ALLOWED: library names, file names, behaviour patterns. "
        "Single backticks for inline filenames/flags (e.g. `--quiet`, `gym`) are fine.\n"
        "FORBIDDEN: triple-backtick code blocks (```), raw def/class/import as code, JSON payloads.\n\n"
        "FINAL PHASE: Always end with 'PHASE 4: VERIFY' — bullet-list every expected output file "
        "with its name (including enrollment number where required).\n"
        "</execution_plan>"
    )


# ── Node 1: thinker_node ───────────────────────────────────────────────────────

def thinker_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Thinker (Pre-Prompt Reasoning)
    Calls the LLM to reason about the task and produce structured plan.
    """
    task = state.get("task", {})
    title       = state.get("title", task.get("title", "Academic Task"))
    course      = state.get("course", task.get("course", "General"))
    task_type   = state.get("task_type", task.get("task_type", "document"))
    build_spec  = state.get("build_spec", task.get("build_spec", ""))
    plan        = state.get("plan", {})
    attempt     = state.get("attempt", 1)
    retry_instructions  = state.get("retry_instructions", "")
    thinker_retries     = state.get("thinker_retries", 0)
    thinker_retry_note  = state.get("thinker_retry_note", "")  # set by validator on retry

    retry_label = f" [Quality Retry #{thinker_retries}]" if thinker_retries > 0 else ""
    print(f"\n[LangGraph:Thinker] Reasoning about '{title}' before prompt generation...{retry_label}")

    # Pull student profile
    user_prof: Dict[str, Any] = {}
    try:
        from worker.worker import get_user_profile
        user_prof = get_user_profile() or {}
    except Exception as e:
        print(f"[LangGraph:Thinker] Warning: profile fetch error: {e}")

    student_name       = user_prof.get("full_name") or user_prof.get("name") or "Nisarg Patel"
    student_enrollment = user_prof.get("enrollment_no") or "STUDENT_ID"
    student_program    = user_prof.get("program") or "B.Tech, Computer Engineering (AIML)"
    student_uni        = user_prof.get("university") or "Academic Institution"

    plan_summary = _json.dumps(plan, indent=2)[:3000] if plan else "{}"
    retry_block  = (
        f"\n\nIMPORTANT -- TASK RETRY CONTEXT (Attempt #{attempt}):\n"
        f"Previous attempt failed. You MUST reason about WHY it failed and how to fix it:\n"
        f"{retry_instructions}\n"
    ) if retry_instructions and attempt > 1 else ""

    # Quality-retry note injected by thinker_validator_node
    quality_note = (
        f"\n\n⚠️  QUALITY RETRY (attempt {thinker_retries + 1}/{MAX_THINKER_RETRIES + 1}) — "
        f"Your previous response had these issues:\n{thinker_retry_note}\n"
        f"Fix ALL of the above issues. Output ONLY the two XML blocks, nothing else.\n"
    ) if thinker_retry_note else ""

    system_prompt = _build_system_prompt()

    user_prompt = (
        f"== TASK METADATA ==\n"
        f"Title: {title}\n"
        f"Course: {course}\n"
        f"Type: {task_type}\n"
        f"Student: {student_name} (Enrollment: {student_enrollment})\n"
        f"Program: {student_program} @ {student_uni}\n"
        f"{retry_block}"
        f"{quality_note}\n"
        f"== PLANNER OUTPUT (what needs to be built) ==\n"
        f"{plan_summary}\n\n"
        f"== FULL ASSIGNMENT SPECIFICATION ==\n"
        f"{build_spec[:12000]}\n\n"
        f"Now think deeply and produce the <thought_process> and <execution_plan> blocks."
    )

    # Call LLM: OpenRouter×2 → Gemini (no Groq)
    raw_response = None
    try:
        raw_response = call_llm(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.15,
            max_tokens=4096,
            preferred_provider="openrouter",
        )
    except Exception as e:
        print(f"[LangGraph:Thinker] LLM call failed: {e}")
        return {"thought_process": "", "agy_execution_plan": "", "thinker_retry_note": ""}

    if not raw_response:
        print("[LangGraph:Thinker] Warning: empty response from LLM — thinker will be a no-op.")
        return {"thought_process": "", "agy_execution_plan": "", "thinker_retry_note": ""}

    # Parse output
    thought  = _extract_tagged_block(raw_response, "thought_process")
    exe_plan = _extract_tagged_block(raw_response, "execution_plan")

    if not exe_plan:
        # Fallback: full response used as plan (validator will catch and retry)
        exe_plan = raw_response.strip()
        thought  = ""
        print("[LangGraph:Thinker] Warning: XML tags missing — validator will assess and may retry.")

    thought_preview  = (thought[:150] + "...") if len(thought) > 150 else thought
    plan_preview     = (exe_plan[:200] + "...") if len(exe_plan) > 200 else exe_plan

    print(f"[LangGraph:Thinker] Thought process captured ({len(thought)} chars).")
    print(f"[LangGraph:Thinker] Execution plan generated ({len(exe_plan)} chars).")
    if thought_preview:
        print(f"[LangGraph:Thinker] Thought snippet: {thought_preview}")
    print(f"[LangGraph:Thinker] Plan snippet: {plan_preview}")

    return {
        "thought_process":    thought,
        "agy_execution_plan": exe_plan,
        "thinker_retry_note": "",  # clear previous retry note
    }


# ── Node 2: thinker_validator_node ────────────────────────────────────────────

def thinker_validator_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Thinker Quality Validator

    Scores the plan 0-1 on 5 dimensions. If quality < QUALITY_THRESHOLD
    and retries remain, sets thinker_retry_note so thinker_node can fix it.
    The routing function route_after_thinker_validator() in graph.py
    reads 'thinker_needs_retry' to decide whether to loop back.
    """
    thought  = state.get("thought_process", "")
    exe_plan = state.get("agy_execution_plan", "")
    retries  = state.get("thinker_retries", 0)
    title    = state.get("title", state.get("task", {}).get("title", "task"))

    score, failures = _score_plan(thought, exe_plan)

    print(f"\n[LangGraph:ThinkerValidator] Quality score for '{title}': {score:.2f}/1.00")
    if failures:
        for f in failures:
            print(f"  ✗ {f[:120]}")
    else:
        print("  ✓ All quality checks passed.")

    needs_retry = (score < QUALITY_THRESHOLD) and (retries < MAX_THINKER_RETRIES)

    if needs_retry:
        retry_note = (
            "The following quality issues MUST be fixed:\n"
            + "\n".join(f"  - {f}" for f in failures)
        )
        print(f"[LangGraph:ThinkerValidator] Score {score:.2f} < {QUALITY_THRESHOLD} → "
              f"Retry {retries + 1}/{MAX_THINKER_RETRIES}")
        return {
            "thinker_needs_retry":    True,
            "thinker_retries":        retries + 1,
            "thinker_retry_note":     retry_note,
            "thinker_quality_score":  score,
        }
    else:
        if score < QUALITY_THRESHOLD:
            print(f"[LangGraph:ThinkerValidator] Score {score:.2f} still below threshold "
                  f"but max retries ({MAX_THINKER_RETRIES}) exhausted — proceeding.")
        else:
            print(f"[LangGraph:ThinkerValidator] ✅ Plan accepted (score={score:.2f}).")
        return {
            "thinker_needs_retry":    False,
            "thinker_retry_note":     "",
            "thinker_quality_score":  score,
        }
