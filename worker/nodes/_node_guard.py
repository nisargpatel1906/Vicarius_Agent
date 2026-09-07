"""
Vicarius Agent - Node Error Boundary

Provides a `node_error_boundary` decorator that wraps LangGraph nodes with:
  1. Per-node try-except so a single node crash does NOT kill the whole graph.
  2. Graceful degradation via a caller-supplied `fallback_factory(state, error)`.
  3. Automatic dashboard progress update so the user sees what happened.
  4. Lightweight file-based state checkpointing: after every successful node
     return, the current state is serialized to {work_dir}/.vicarius_state.json
     so a mid-run process kill does not lose all completed work.

Usage
-----
    from worker.nodes._node_guard import node_error_boundary

    @node_error_boundary(fallback=lambda state, e: {"error_message": str(e)})
    def my_node(state: AgentState) -> Dict[str, Any]:
        ...

Fallback contract
-----------------
`fallback(state, error) -> Dict[str, Any]`
The dict is merged into state by LangGraph exactly as a normal node return.
A minimal fallback just returns `{}` (no state mutations) so the graph
continues with whatever was already in state.
"""

import json
import traceback
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Optional


# ── State Checkpointing ───────────────────────────────────────────────────────

_CHECKPOINT_FILE = ".vicarius_state.json"


def _safe_json_default(obj: Any) -> Any:
    """JSON serializer fallback for Path objects and other non-serializable types."""
    if isinstance(obj, Path):
        return str(obj)
    return str(obj)


def checkpoint_state(state: Dict[str, Any]) -> None:
    """
    Serializes the current graph state to {work_dir}/.vicarius_state.json.
    Called after every successful node return so mid-run crashes can be diagnosed
    and partial work is visible on disk.

    Silently no-ops if work_dir is missing or serialization fails — checkpointing
    is best-effort and must never be a source of failure itself.
    """
    try:
        work_dir_str = state.get("work_dir")
        if not work_dir_str:
            return
        work_dir = Path(work_dir_str)
        if not work_dir.exists():
            return
        checkpoint_path = work_dir / _CHECKPOINT_FILE
        # Serialize only JSON-safe keys (skip large stdout blobs to keep file small)
        slim_state = {
            k: v for k, v in state.items()
            if k not in {"stdout_log", "agy_execution_plan", "thought_process"}
        }
        checkpoint_path.write_text(
            json.dumps(slim_state, indent=2, default=_safe_json_default),
            encoding="utf-8",
        )
    except Exception:
        pass  # checkpointing is best-effort — never fail the pipeline


def load_checkpoint(work_dir: str) -> Optional[Dict[str, Any]]:
    """
    Loads a previously saved state checkpoint from {work_dir}/.vicarius_state.json.
    Returns None if no checkpoint exists or if loading fails.
    """
    try:
        path = Path(work_dir) / _CHECKPOINT_FILE
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


# ── Node Error Boundary Decorator ─────────────────────────────────────────────

def node_error_boundary(
    fallback: Callable[[Dict[str, Any], Exception], Dict[str, Any]],
    node_name: Optional[str] = None,
):
    """
    Decorator factory that wraps a LangGraph node function with:
      - try-except crash protection
      - fallback state on exception
      - progress update to dashboard
      - state checkpointing after successful execution

    Parameters
    ----------
    fallback : callable(state, error) -> dict
        Called when the node raises. Must return a safe partial state dict.
        Return {} to pass through with no mutations.
    node_name : str, optional
        Override the display name in log messages. Defaults to function name.

    Example
    -------
        @node_error_boundary(fallback=lambda s, e: {})
        def extractor_node(state): ...
    """
    def decorator(fn: Callable) -> Callable:
        display_name = node_name or fn.__name__

        @wraps(fn)
        def wrapper(state: Dict[str, Any]) -> Dict[str, Any]:
            try:
                result = fn(state)
                # Checkpoint after every successful node return
                merged = {**state, **result}
                checkpoint_state(merged)
                return result

            except Exception as exc:
                tb = traceback.format_exc()
                print(
                    f"\n[NodeGuard:{display_name}] ⚠️  Unhandled exception — "
                    f"activating fallback:\n  {exc}\n{tb}"
                )

                # Emit progress update so the dashboard shows something
                try:
                    from worker.tools.progress import report_progress
                    task_id = state.get("task_id") or state.get("task", {}).get("id")
                    if task_id:
                        report_progress(
                            task_id,
                            state.get("status", "building"),
                            f"⚠️ Node '{display_name}' encountered an error "
                            f"({type(exc).__name__}: {str(exc)[:120]}). "
                            f"Continuing with degraded state...",
                            state,
                        )
                except Exception:
                    pass  # progress update failure must never cascade

                # Return the caller-supplied fallback state
                try:
                    return fallback(state, exc)
                except Exception as fb_exc:
                    print(
                        f"[NodeGuard:{display_name}] Fallback itself raised: {fb_exc}. "
                        f"Returning empty dict."
                    )
                    return {}

        return wrapper
    return decorator
