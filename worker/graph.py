"""
Vicarius Agent - LangGraph Graph Definition
Assembles the StateGraph connecting all nodes:

  START → extractor → planner → thinker → thinker_validator ─┐
                                                ↑              │ needs_retry
                                                └──────────────┘
                                                               │ pass
                                                               ↓
                                                            coder → verifier → deliverer → END
                                                                   ↓ fail
                                                                diagnoser → coder (retry loop)
                                                                          → escalator → END

Robustness guarantees (deep hardening):
  • Every node is wrapped with @node_error_boundary so a single node crash
    never kills the entire graph — it degrades gracefully to a safe state.
  • route_after_thinker_validator has a hard retry cap so the thinker loop
    can never run forever even if thinker_needs_retry is stuck True.
  • State is checkpointed to disk after every successful node return so a
    mid-run process kill does not lose all completed work.
"""

from typing import Literal
from pathlib import Path
from langgraph.graph import StateGraph, START, END

from worker.state import AgentState
from worker.nodes._node_guard import node_error_boundary

# ── Fallback factories (safe degraded states per node) ────────────────────────

def _extractor_fallback(state, _err):
    """Extractor crash → proceed with original build_spec unchanged."""
    print(f"[NodeGuard:extractor] Extractor encountered error ({_err}) — proceeding with original build_spec.")
    return {
        "extracted_requirements": {
            "summary": state.get("title", ""),
            "raw_text": state.get("build_spec", ""),
            "items": [state.get("title", "")],
        }
    }

def _planner_fallback(state, _err):
    """Planner crash → construct a safe emergency deliverable plan matching task_type."""
    print(f"[NodeGuard:planner] Planner encountered error ({_err}) — constructing safe fallback deliverable plan.")
    title = state.get("title", "Assignment")
    task_type = state.get("task_type", "code_project")
    ext = "py" if task_type == "code_project" else ("pptx" if task_type == "presentation" else "md")
    fallback_file = {
        "filename": f"{title.replace(' ', '_')[:40]}.{ext}",
        "purpose": "Primary task deliverable",
        "tool": "write_file",
    }
    return {
        "plan": {
            "architecture": f"Standard {task_type} architecture",
            "execution_strategy": "Produce required deliverable using build spec",
            "files": [fallback_file],
            "rubric_items": [title],
            "tool_hints": ["write_file"],
        }
    }

def _thinker_fallback(state, _err):
    """Thinker crash → proceed with direct execution without pre-reasoning."""
    print(f"[NodeGuard:thinker] Thinker encountered error ({_err}) — proceeding with direct execution.")
    return {
        "thought_process": "Direct execution fallback: implement requirements directly from build spec.",
        "agy_execution_plan": "Phase 1: Implement deliverables\nPhase 2: Verify",
        "thinker_needs_retry": False,
        "thinker_quality_score": 0.5,
    }

def _thinker_validator_fallback(state, _err):
    """Validator crash → pass through to coder without retry."""
    print(f"[NodeGuard:thinker_validator] Validator error ({_err}) — passing to coder without retry.")
    return {"thinker_needs_retry": False, "thinker_quality_score": 0.5}

def _coder_fallback(state, _err):
    """Coder crash → salvage any files already written to work_dir so work is not lost."""
    print(f"[NodeGuard:coder] Coder encountered error ({_err}) — salvaging workspace files.")
    existing_files = []
    work_dir_str = state.get("work_dir")
    if work_dir_str and Path(work_dir_str).exists():
        try:
            from worker.tools.file_tools import list_workspace_files
            existing_files = [str(f.resolve()) for f in list_workspace_files(Path(work_dir_str))]
        except Exception:
            pass
    return {
        "produced_files": existing_files,
        "stdout_log": (state.get("stdout_log") or "") + f"\nCoder node error: {_err}",
        "retry_instructions": f"Coder error ({_err}). Check workspace and finish deliverables.",
    }

def _verifier_fallback(state, _err):
    """Verifier crash → mark as failed with error details so diagnoser can analyze."""
    print(f"[NodeGuard:verifier] Verifier encountered error ({_err}) — routing to diagnoser.")
    return {
        "verification_passed": False,
        "verification_score": 0.0,
        "verification_feedback": f"Verifier node error: {_err}",
    }

def _diagnoser_fallback(state, _err):
    """Diagnoser crash → safely evaluate retry budget and attempt recovery or escalate."""
    print(f"[NodeGuard:diagnoser] Diagnoser encountered error ({_err}) — checking retry budget.")
    try:
        attempt = int(state.get("attempt") or 1)
        max_attempts = int(state.get("max_attempts") or 4)
    except Exception:
        attempt, max_attempts = 1, 4
    agent_fixable = attempt < max_attempts
    return {
        "attempt": attempt + 1,
        "agent_fixable": agent_fixable,
        "retry_instructions": f"Automated recovery from diagnoser error ({_err}).",
    }

def _deliverer_fallback(state, _err):
    """Deliverer crash → update Supabase safely and return flagged status so graph ends cleanly."""
    print(f"[NodeGuard:deliverer] Deliverer encountered error ({_err}) — safe fallback to flagged.")
    task_id = state.get("task_id") or state.get("task", {}).get("id")
    if task_id:
        try:
            from worker.worker import get_supabase
            sb = get_supabase()
            if sb:
                import datetime
                sb.table("tasks").update({
                    "status": "flagged",
                    "result_summary": f"Delivery error: {_err}. Partial deliverables may exist in workspace.",
                    "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                }).eq("id", task_id).execute()
        except Exception as sb_e:
            print(f"[NodeGuard:deliverer] Supabase update warning: {sb_e}")
    return {"status": "flagged", "error_message": f"Delivery error: {_err}"}

def _escalator_fallback(state, _err):
    """Escalator crash → end gracefully with flagged status and update Supabase."""
    print(f"[NodeGuard:escalator] Escalator encountered error ({_err}) — safe fallback.")
    task_id = state.get("task_id") or state.get("task", {}).get("id")
    if task_id:
        try:
            from worker.worker import get_supabase
            sb = get_supabase()
            if sb:
                import datetime
                sb.table("tasks").update({
                    "status": "flagged",
                    "result_summary": f"Escalator error: {_err}",
                    "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                }).eq("id", task_id).execute()
        except Exception as sb_e:
            print(f"[NodeGuard:escalator] Supabase update warning: {sb_e}")
    return {"status": "flagged", "error_message": f"Escalation error: {_err}"}


# ── Node imports + error boundary wiring ──────────────────────────────────────

from worker.nodes.extractor import extractor_node as _extractor_node
from worker.nodes.planner import planner_node as _planner_node
from worker.nodes.thinker import thinker_node as _thinker_node, thinker_validator_node as _thinker_validator_node
from worker.nodes.coder import coder_node as _coder_node
from worker.nodes.verifier import verifier_node as _verifier_node
from worker.nodes.diagnoser import diagnoser_node as _diagnoser_node
from worker.nodes.deliverer import deliver_node as _deliver_node
from worker.nodes.escalator import escalate_node as _escalate_node
from worker.nodes.thinker import MAX_THINKER_RETRIES

extractor_node         = node_error_boundary(fallback=_extractor_fallback)(_extractor_node)
planner_node           = node_error_boundary(fallback=_planner_fallback)(_planner_node)
thinker_node           = node_error_boundary(fallback=_thinker_fallback)(_thinker_node)
thinker_validator_node = node_error_boundary(fallback=_thinker_validator_fallback)(_thinker_validator_node)
coder_node             = node_error_boundary(fallback=_coder_fallback)(_coder_node)
verifier_node          = node_error_boundary(fallback=_verifier_fallback)(_verifier_node)
diagnoser_node         = node_error_boundary(fallback=_diagnoser_fallback)(_diagnoser_node)
deliver_node           = node_error_boundary(fallback=_deliverer_fallback)(_deliver_node)
escalate_node          = node_error_boundary(fallback=_escalator_fallback)(_escalate_node)


# ── Routing Functions ──────────────────────────────────────────────────────────

def route_after_thinker_validator(
    state: AgentState,
) -> Literal["thinker", "coder"]:
    """
    If validator flagged needs_retry (quality score too low and retries remain),
    loop back to thinker. Otherwise proceed to coder.
    Protected with zero-throw guard.
    """
    try:
        thinker_retries = int(state.get("thinker_retries") or 0)
        if thinker_retries >= MAX_THINKER_RETRIES:
            print(f"[LangGraph:Router] thinker_retries={thinker_retries} >= cap={MAX_THINKER_RETRIES}. Forcing to coder.")
            return "coder"
        if state.get("thinker_needs_retry", False):
            return "thinker"
        return "coder"
    except Exception as e:
        print(f"[LangGraph:Router] route_after_thinker_validator error: {e}. Defaulting to 'coder'.")
        return "coder"


def route_after_coder(state: AgentState) -> Literal["verifier", "diagnoser"]:
    """Routes to verifier if output files exist on disk, else routes directly to diagnoser.
    Protected with zero-throw guard.
    """
    try:
        produced = state.get("produced_files", [])
        if produced and len(produced) > 0:
            return "verifier"
        # Secondary check: inspect disk directly in case state list was omitted
        work_dir_str = state.get("work_dir")
        if work_dir_str and Path(work_dir_str).exists():
            from worker.tools.file_tools import list_workspace_files
            if list_workspace_files(Path(work_dir_str)):
                return "verifier"
        return "diagnoser"
    except Exception as e:
        print(f"[LangGraph:Router] route_after_coder error: {e}. Defaulting to 'diagnoser'.")
        return "diagnoser"


def route_after_verify(state: AgentState) -> Literal["deliver", "diagnose"]:
    """Routes to deliverer if passed, else routes to Reflexion diagnoser.
    Protected with zero-throw guard.
    """
    try:
        if state and state.get("verification_passed", False):
            return "deliver"
        return "diagnose"
    except Exception as e:
        print(f"[LangGraph:Router] route_after_verify error: {e}. Defaulting to 'diagnose'.")
        return "diagnose"


def route_after_diagnose(state: AgentState) -> Literal["coder", "escalate"]:
    """Routes back to coder if retries remain and error is fixable, else escalates to human.
    Includes an infinite-loop guard: if attempt exceeds max_attempts, always escalate.
    Protected with zero-throw guard.
    """
    try:
        try:
            attempt = int(state.get("attempt") or 1)
        except (ValueError, TypeError):
            attempt = 1
        try:
            max_attempts = int(state.get("max_attempts") or 4)
        except (ValueError, TypeError):
            max_attempts = 4
        agent_fixable = bool(state.get("agent_fixable", True))

        # Hard cap: never exceed max_attempts regardless of agent_fixable flag.
        if attempt > max_attempts:
            print(f"[LangGraph:Router] attempt={attempt} > max_attempts={max_attempts}. Force escalating.")
            return "escalate"

        if attempt <= max_attempts and agent_fixable:
            return "coder"
        return "escalate"
    except Exception as e:
        print(f"[LangGraph:Router] route_after_diagnose error: {e}. Defaulting to 'escalate'.")
        return "escalate"


# ── Graph Builder ──────────────────────────────────────────────────────────────

def build_vicarius_graph() -> StateGraph:
    """Builds and compiles the production-grade Vicarius Agent StateGraph.

    All nodes are wrapped with @node_error_boundary so any single-node crash
    triggers graceful degradation rather than killing the pipeline.
    """
    workflow = StateGraph(AgentState)

    # 1. Register Nodes (all wrapped with error boundaries)
    workflow.add_node("extractor",         extractor_node)
    workflow.add_node("planner",           planner_node)
    workflow.add_node("thinker",           thinker_node)
    workflow.add_node("thinker_validator", thinker_validator_node)
    workflow.add_node("coder",             coder_node)
    workflow.add_node("verifier",          verifier_node)
    workflow.add_node("diagnoser",         diagnoser_node)
    workflow.add_node("deliverer",         deliver_node)
    workflow.add_node("escalator",         escalate_node)

    # 2. Linear Pipeline: START → extractor → planner → thinker → validator
    workflow.add_edge(START,       "extractor")
    workflow.add_edge("extractor", "planner")
    workflow.add_edge("planner",   "thinker")
    workflow.add_edge("thinker",   "thinker_validator")

    # 3. Thinker Quality-Retry Loop (hard-capped by MAX_THINKER_RETRIES in router)
    #    validator → thinker  (if score < threshold and retries < cap)
    #    validator → coder    (if score passes OR retries exhausted)
    workflow.add_conditional_edges(
        "thinker_validator",
        route_after_thinker_validator,
        {
            "thinker": "thinker",
            "coder":   "coder",
        }
    )

    # 4. Coder Routing (proceed to verifier only if build produced files)
    workflow.add_conditional_edges(
        "coder",
        route_after_coder,
        {
            "verifier":  "verifier",
            "diagnoser": "diagnoser",
        }
    )

    # 5. Verification Routing
    workflow.add_conditional_edges(
        "verifier",
        route_after_verify,
        {
            "deliver":  "deliverer",
            "diagnose": "diagnoser",
        }
    )

    # 6. Reflexion Self-Correction Routing (hard-capped by max_attempts in router)
    workflow.add_conditional_edges(
        "diagnoser",
        route_after_diagnose,
        {
            "coder":    "coder",
            "escalate": "escalator",
        }
    )

    # 7. Terminal Edges
    workflow.add_edge("deliverer", END)
    workflow.add_edge("escalator", END)

    return workflow.compile()
