"""
Vicarius Agent - Real-Time Pipeline Progress Reporter
Synchronizes task progress, active node, attempt count, and status notes with Supabase
and logs structured system events so the dashboard can display live updates in real time.
"""

import os
import sys
import datetime
from typing import Optional, Dict, Any

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = (
    os.getenv("SUPABASE_WORKER_KEY")
    or os.getenv("SUPABASE_SERVICE_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
)

_client = None

def _get_sb_client():
    global _client
    if _client is not None:
        return _client
    try:
        from worker.worker import get_supabase
        _client = get_supabase()
        return _client
    except Exception:
        pass

    if SUPABASE_URL and SUPABASE_KEY:
        from supabase import create_client
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
        return _client
    return None


VALID_STATUSES = {
    "new",
    "extracting",
    "queued",
    "claimed",
    "building",
    "verifying",
    "flagged",
    "done",
    "failed",
}


def report_progress(
    task_id: str,
    status: str,
    progress_note: str,
    state: Optional[Dict[str, Any]] = None,
    level: str = "info",
) -> None:
    """
    Reports the live progress of a task to Supabase and logs a system event.
    Fail-safe: network errors or missing credentials will not interrupt task execution.
    """
    if not task_id:
        return

    # Ensure status conforms to Postgres CHECK constraint
    safe_status = status if status in VALID_STATUSES else "building"
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # Log to local stdout
    print(f"\n[Progress:{safe_status.upper()}] Task {task_id[:8]}... — {progress_note}")

    try:
        sb = _get_sb_client()
        if not sb:
            return

        update_payload: Dict[str, Any] = {
            "status": safe_status,
            "progress_note": progress_note,
            "last_progress_at": now_iso,
            "updated_at": now_iso,
        }

        # Enrich extracted_requirements with live runtime stats if state is provided
        if state:
            task = state.get("task", {})
            current_reqs = dict(task.get("extracted_requirements") or {})

            if "attempt" in state:
                current_reqs["attempt"] = state["attempt"]
            if "max_attempts" in state:
                current_reqs["max_attempts"] = state["max_attempts"]
            if "thinker_quality_score" in state:
                current_reqs["thinker_quality_score"] = state["thinker_quality_score"]
            if "thinker_retries" in state:
                current_reqs["thinker_retries"] = state["thinker_retries"]
            if "verification_score" in state:
                current_reqs["verification_score"] = state["verification_score"]
            if "verification_passed" in state:
                current_reqs["verification_passed"] = state["verification_passed"]

            update_payload["extracted_requirements"] = current_reqs

        # Update tasks table
        sb.table("tasks").update(update_payload).eq("id", task_id).execute()

        # Log system event with task_id embedded so task-trace route surfaces it
        title = ""
        if state:
            title = state.get("title", state.get("task", {}).get("title", ""))
        event_msg = f"Task '{title}' ({task_id}): {progress_note}" if title else f"Task ({task_id}): {progress_note}"

        sb.table("system_events").insert({
            "level": level if level in {"info", "warning", "error"} else "info",
            "component": "worker",
            "message": event_msg[:500],
        }).execute()

    except Exception as err:
        # Non-fatal: Don't crash worker on telemetry failures
        print(f"[Progress-Warn] Could not report progress: {err}", file=sys.stderr)
