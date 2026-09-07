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
"""

from typing import Literal
from langgraph.graph import StateGraph, START, END

from worker.state import AgentState
from worker.nodes.extractor import extractor_node
from worker.nodes.planner import planner_node
from worker.nodes.thinker import thinker_node, thinker_validator_node
from worker.nodes.coder import coder_node
from worker.nodes.verifier import verifier_node
from worker.nodes.diagnoser import diagnoser_node
from worker.nodes.deliverer import deliver_node
from worker.nodes.escalator import escalate_node


# ── Routing Functions ──────────────────────────────────────────────────────────

def route_after_thinker_validator(
    state: AgentState,
) -> Literal["thinker", "coder"]:
    """
    If validator flagged needs_retry (quality score too low and retries remain),
    loop back to thinker. Otherwise proceed to coder.
    """
    if state.get("thinker_needs_retry", False):
        return "thinker"
    return "coder"


def route_after_coder(state: AgentState) -> Literal["verifier", "diagnoser"]:
    """Routes to verifier if output files exist, else routes directly to diagnoser."""
    produced = state.get("produced_files", [])
    if produced and len(produced) > 0:
        return "verifier"
    return "diagnoser"


def route_after_verify(state: AgentState) -> Literal["deliver", "diagnose"]:
    """Routes to deliverer if passed, else routes to Reflexion diagnoser."""
    if state.get("verification_passed", False):
        return "deliver"
    return "diagnose"


def route_after_diagnose(state: AgentState) -> Literal["coder", "escalate"]:
    """Routes back to coder if retries remain and error is fixable, else escalates to human.
    Includes an infinite-loop guard: if attempt equals or exceeds max_attempts, always escalate.
    """
    attempt      = state.get("attempt", 1)
    max_attempts = state.get("max_attempts", 4)
    agent_fixable = state.get("agent_fixable", True)

    # Hard cap: never exceed max_attempts regardless of agent_fixable flag.
    # Also guards against a future diagnoser_node bug where attempt is not incremented.
    if attempt > max_attempts:
        print(f"[LangGraph:Router] attempt={attempt} > max_attempts={max_attempts}. Force escalating.")
        return "escalate"

    if attempt <= max_attempts and agent_fixable:
        return "coder"
    return "escalate"


# ── Graph Builder ──────────────────────────────────────────────────────────────

def build_vicarius_graph() -> StateGraph:
    """Builds and compiles the production-grade Vicarius Agent StateGraph."""
    workflow = StateGraph(AgentState)

    # 1. Register Nodes
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

    # 3. Thinker Quality-Retry Loop
    #    validator → thinker  (if score < threshold and retries remain)
    #    validator → coder    (if score passes or retries exhausted)
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

    # 6. Reflexion Self-Correction Routing
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
