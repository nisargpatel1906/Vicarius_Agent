"""
Vicarius Agent - Diagnoser Node
Executes Reflexion root-cause analysis on verification failures, maintaining
attempt history and generating targeted fix directives for subsequent attempts.
"""

import datetime
from typing import Dict, Any, List
import pytz
from worker.state import AgentState
from worker.llm import call_llm, safe_parse_json

TARGET_TZ = pytz.timezone("Asia/Kolkata")


def next_attempt_fits_before_deadline(due_str: str, weight: str = "medium") -> bool:
    """Evaluates in Asia/Kolkata whether another attempt can complete before deadline."""
    if not due_str:
        return True
    try:
        from dateutil import parser as dt_parser
        due_dt = dt_parser.isoparse(due_str)
        if due_dt.tzinfo is None:
            due_dt = pytz.utc.localize(due_dt)
        due_ist = due_dt.astimezone(TARGET_TZ)
        now_ist = datetime.datetime.now(datetime.timezone.utc).astimezone(TARGET_TZ)

        timeout_mins = 240 if weight == "heavy" else (45 if weight == "medium" else 15)
        needed_mins = timeout_mins + 20  # 20m safety buffer
        return (now_ist + datetime.timedelta(minutes=needed_mins)) <= due_ist
    except Exception as e:
        print(f"[Diagnoser-Deadline] Error checking deadline: {e}")
        return True


def diagnoser_node(state: AgentState) -> Dict[str, Any]:
    """
    LangGraph Node: Diagnoser / Reflexion
    Performs root-cause analysis, updates attempt history, and formulates retry instructions.
    """
    task = state.get("task", {})
    title = state.get("title", task.get("title", "Assignment"))
    attempt = state.get("attempt", 1)
    max_attempts = state.get("max_attempts", 4)
    feedback = state.get("verification_feedback", "Verification check failed.")
    history: List[Dict[str, Any]] = list(state.get("attempt_history", []))

    print(f"\n[LangGraph:Diagnoser] Performing Reflexion root-cause analysis for attempt {attempt}/{max_attempts}...")

    # Record current attempt
    history.append({
        "attempt": attempt,
        "feedback": feedback,
        "score": state.get("verification_score", 0.0),
        "outcome": "failed",
    })

    # Check deadline constraint
    due_date = state.get("due_date") or task.get("due_date")
    weight = state.get("weight") or task.get("weight", "medium")
    if not next_attempt_fits_before_deadline(due_date, weight):
        print("[LangGraph:Diagnoser] Deadline budget exceeded in Asia/Kolkata. Stopping retry loop early.")
        history[-1]["outcome"] = "stopped_early_deadline"
        return {
            "attempt": attempt + 1,
            "attempt_history": history,
            "agent_fixable": False,
            "retry_instructions": "Deadline is too close to attempt another rebuild.",
        }

    # Check if diagnose_failure was patched on worker.worker (e.g. during test runs)
    import sys
    from pathlib import Path
    w_mod = sys.modules.get("worker.worker")
    if w_mod and getattr(w_mod, "diagnose_failure", None) is not getattr(w_mod, "_default_diagnose_failure", None):
        phase = "build" if not state.get("produced_files") else "verification"
        fail_text = feedback or "Build produced no usable output."
        prior_history = history[:-1]
        diag_res = w_mod.diagnose_failure(
            task,
            phase,
            fail_text,
            stdout_output=state.get("stdout_log", ""),
            produced_files=[Path(p) for p in state.get("produced_files", [])],
            verify_details=state.get("verification_details", {}),
            post_retry=(attempt > 1),
            attempt_history=prior_history,
        )
        agent_fixable = bool(diag_res.get("agent_fixable", True))
        history[-1]["phase"] = phase
        history[-1]["category"] = diag_res.get("category")
        history[-1]["root_cause"] = diag_res.get("root_cause")
        history[-1]["plain"] = diag_res.get("plain_explanation")
        history[-1]["fix_tried"] = diag_res.get("retry_instructions")
        history[-1]["outcome"] = "unfixable" if not agent_fixable else "failed"

        return {
            "attempt": attempt + 1,
            "attempt_history": history,
            "agent_fixable": agent_fixable,
            "retry_instructions": diag_res.get("retry_instructions", ""),
        }

    # Format history text to prevent repeating failed attempts
    history_lines = [
        f"Attempt {h.get('attempt')}: score={h.get('score')} | feedback={h.get('feedback')}"
        for h in history
    ]
    history_str = "\n".join(history_lines)

    sys_prompt = (
        "You are an expert autonomous software engineer practicing Reflexion (self-diagnosis).\n"
        "A task build failed verification. Analyze the error and prior attempt history, identify the root cause, "
        "and produce a concrete, actionable fix instruction for the next attempt.\n"
        "Do NOT propose fixes that already failed in prior attempts.\n"
        "Return strict JSON:\n"
        "{\n"
        '  "root_cause": str,\n'
        '  "retry_instructions": "Detailed, specific code/file changes to fix the error",\n'
        '  "agent_fixable": boolean\n'
        "}\n"
        "Return ONLY valid JSON."
    )

    user_prompt = (
        f"Task: {title}\n"
        f"Verification Feedback: {feedback}\n\n"
        f"Prior Attempts History:\n{history_str}\n\n"
        "Diagnose root cause and provide fix instructions for next attempt."
    )

    resp = call_llm([{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}], temperature=0.1, max_tokens=1500)
    parsed = safe_parse_json(resp)

    root_cause = parsed.get("root_cause", feedback) if isinstance(parsed, dict) else feedback
    retry_instructions = parsed.get("retry_instructions", feedback) if isinstance(parsed, dict) else feedback
    agent_fixable = bool(parsed.get("agent_fixable", True)) if isinstance(parsed, dict) else True

    history[-1]["root_cause"] = root_cause
    history[-1]["fix_tried"] = retry_instructions

    print(f"[LangGraph:Diagnoser] Root cause: {root_cause[:100]}")
    print(f"[LangGraph:Diagnoser] Fix instructions: {retry_instructions[:120]}")

    return {
        "attempt": attempt + 1,
        "attempt_history": history,
        "agent_fixable": agent_fixable,
        "retry_instructions": retry_instructions,
    }
