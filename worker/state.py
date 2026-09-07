"""
Vicarius Agent - LangGraph State Definition
Defines the typed state passed between nodes in the Vicarius Agent.
"""

import re
from typing import TypedDict, List, Dict, Any, Optional


def _title_slug(title: str, max_len: int = 40) -> str:
    """Convert a task title to a safe directory name slug."""
    slug = re.sub(r'[^\w\s-]', '', title.lower())   # keep word chars, spaces, hyphens
    slug = re.sub(r'[\s_]+', '_', slug).strip('_-')  # spaces → underscore
    return slug[:max_len].strip('_-') or "task"


def get_task_work_dir(base_work_dir: str, task_id: str, title: str = "") -> str:
    """
    Returns a consistent, human-readable work directory for a task.
    Format: <base_work_dir>/<task_id>_<title-slug>/

    Always returns the SAME path for the same task_id, even across retries —
    so fix/retry operations reuse the existing folder instead of creating a new one.
    """
    slug = _title_slug(title) if title else "task"
    return f"{base_work_dir}/{task_id}_{slug}"


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

    # Thinker / Pre-Prompt Reasoning
    thought_process: str        # Raw inner reasoning from thinker_node
    agy_execution_plan: str     # Structured plan injected into AGY CLI prompt
    thinker_retries: int        # Number of thinker quality-retry loops used
    thinker_quality_score: float  # 0.0–1.0 quality grade from thinker_validator
    thinker_needs_retry: bool   # Set True by validator when quality below threshold
    thinker_retry_note: str     # Targeted feedback from validator for the next attempt

    # Artifacts & Outputs
    produced_files: List[str]
    stdout_log: str

    # Agent Tool Call Audit Log
    tool_call_history: List[Dict[str, Any]]  # [{step, tool, args_summary, result_preview}]

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
    title = task.get("title", "")
    if base_work_dir:
        work_dir = get_task_work_dir(base_work_dir, task_id, title)
    else:
        work_dir = get_task_work_dir("work_dirs", task_id, title)
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
        "thought_process": "",
        "agy_execution_plan": "",
        "thinker_retries": 0,
        "thinker_quality_score": 0.0,
        "thinker_needs_retry": False,
        "thinker_retry_note": "",
        "produced_files": [],
        "stdout_log": "",
        "tool_call_history": [],
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
