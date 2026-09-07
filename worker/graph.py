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
    print("[NodeGuard:extractor] Proceeding with original build_spec (no enrichment).")
    return {}

def _planner_fallback(state, _err):
    """Planner crash → proceed with an empty plan (coder will use raw build_spec)."""
    print("[NodeGuard:planner] Proceeding with empty plan — coder will use raw build_spec.")
    return {"plan": {}}

def _thinker_fallback(state, _err):
    """Thinker crash → proceed with empty thought (coder still runs, just without pre-reasoning)."""
    print("[NodeGuard:thinker] Proceeding without pre-reasoning.")
    return {"thought_process": "", "agy_execution_plan": "", "thinker_needs_retry": False}

def _thinker_validator_fallback(state, _err):
    """Validator crash → pass through to coder without retry."""
    print("[NodeGuard:thinker_validator] Validator error — passing to coder without retry.")
    return {"thinker_needs_retry": False, "thinker_quality_score": 0.0}

def _coder_fallback(state, _err):
    """Coder crash → return empty files so diagnoser can analyse."""
    print("[NodeGuard:coder] Coder crashed — returning empty produced_files for diagnoser.")
    return {"produced_files": [], "stdout_log": f"Coder node crashed: {_err}"}

def _verifier_fallback(state, _err):
    """Verifier crash → mark as failed so diagnoser is triggered."""
    print("[NodeGuard:verifier] Verifier crashed — marking verification as failed.")
    return {
        "verification_passed": False,
        "verification_score": 0.0,
        "verification_feedback": f"Verifier node crashed: {_err}",
    }

def _diagnoser_fallback(state, _err):
    """Diagnoser crash → increment attempt and mark non-fixable to force escalation."""
    print("[NodeGuard:diagnoser] Diagnoser crashed — forcing escalation.")
    attempt = state.get("attempt", 1)
    return {
        "attempt": attempt + 1,
        "agent_fixable": False,
        "retry_instructions": f"Diagnoser crashed: {_err}",
    }

def _deliverer_fallback(state, _err):
    """Deliverer crash → return partial status so graph ends without hanging."""
    print("[NodeGuard:deliverer] Deliverer crashed — ending with partial status.")
    return {"status": "failed", "error_message": f"Delivery failed: {_err}"}

def _escalator_fallback(state, _err):
    """Escalator crash → end gracefully with flagged status."""
    print("[NodeGuard:escalator] Escalator crashed — ending with flagged status.")
    return {"status": "flagged", "error_message": f"Escalation failed: {_err}"}


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

    Hard retry cap: even if thinker_needs_retry is stuck True (e.g. validator
    node crashed and left stale state), we never exceed MAX_THINKER_RETRIES.
    This prevents the thinker loop from running forever.
    """
    thinker_retries = state.get("thinker_retries", 0)
    if thinker_retries >= MAX_THINKER_RETRIES:
        print(f"[LangGraph:Router] thinker_retries={thinker_retries} >= cap={MAX_THINKER_RETRIES}. Forcing to coder.")
        return "coder"
    if state.get("thinker_needs_retry", False):
        return "thinker"
    return "coder"


def route_after_coder(state: AgentState) -> Literal["verifier", "diagnoser"]:
    """Routes to verifier if output files exist on disk, else routes directly to diagnoser."""
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


def route_after_verify(state: AgentState) -> Literal["deliver", "diagnose"]:
    """Routes to deliverer if passed, else routes to Reflexion diagnoser."""
    if state.get("verification_passed", False):
        return "deliver"
    return "diagnose"


def route_after_diagnose(state: AgentState) -> Literal["coder", "escalate"]:
    """Routes back to coder if retries remain and error is fixable, else escalates to human.
    Includes an infinite-loop guard: if attempt exceeds max_attempts, always escalate.
    """
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
