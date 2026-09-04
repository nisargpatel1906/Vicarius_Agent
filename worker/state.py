"""
Vicarius Agent - LangGraph State Definition
Defines the typed state passed between nodes in the Vicarius LangGraph agent.
"""

from typing import TypedDict, List, Dict, Any, Optional


class AgentState(TypedDict, total=False):
    # Core Task Metadata
    task: Dict[str, Any]
    task_id: str
    course: str
    title: str
    task_type: str
    weight: str
    due_date: Optional[str]
    build_spec: str
    work_dir: str

    # Execution Planning
    plan: Dict[str, Any]

    # Artifacts & Outputs
    produced_files: List[str]
    stdout_log: str

    # Self-Correction & Loop Engineering
    attempt: int
    max_attempts: int
    attempt_history: List[Dict[str, Any]]

    # Verification & Reflexion Judge
    verification_passed: bool
    verification_feedback: str
    verification_score: float
    verification_details: Dict[str, Any]
    agent_fixable: bool
    retry_instructions: str

    # Delivery & Tracking
    result_summary: str
    error_message: Optional[str]
    status: str


def create_initial_state(task: Dict[str, Any], max_attempts: int = 4, base_work_dir: Optional[str] = None) -> AgentState:
    """Factory creating a clean initial AgentState for a task."""
    task_id = str(task.get("id", "temp_task"))
    work_dir = f"{base_work_dir}/{task_id}" if base_work_dir else f"work_dirs/{task_id}"
    return {
        "task": task,
        "task_id": task_id,
        "course": task.get("course", "General"),
        "title": task.get("title", "Academic Task"),
        "task_type": task.get("task_type", "document"),
        "weight": task.get("weight", "light"),
        "due_date": task.get("due_date"),
        "build_spec": task.get("build_spec", ""),
        "work_dir": work_dir,
        "plan": {},
        "produced_files": [],
        "stdout_log": "",
        "attempt": 1,
        "max_attempts": max_attempts,
        "attempt_history": [],
        "verification_passed": False,
        "verification_feedback": "",
        "verification_score": 0.0,
        "verification_details": {},
        "agent_fixable": True,
        "retry_instructions": "",
        "result_summary": "",
        "error_message": None,
        "status": "queued",
    }

