"""
Vicarius Agent - File Tools
Safe workspace file I/O operations with path traversal sanitization.
"""

import os
from pathlib import Path
from typing import List, Optional

JUNK_DIR_PATTERNS = {
    "node_modules", ".venv", "venv", "__pycache__", ".git", ".next",
    "dist", "build", ".turbo", ".cache", ".idea", ".vscode"
}


def sanitize_rel_path(filename: str) -> List[str]:
    """Splits path and eliminates path traversal characters (.., .)."""
    norm_parts = [
        p for p in filename.replace("\\", "/").split("/")
        if p and p not in ("..", ".")
    ]
    return norm_parts or ["output.txt"]


def write_file(work_dir: Path, rel_path: str, content: str) -> Path:
    """Safely writes UTF-8 content to a file inside the task work directory."""
    parts = sanitize_rel_path(rel_path)
    target_path = work_dir.joinpath(*parts)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    return target_path


def read_file(work_dir: Path, rel_path: str) -> Optional[str]:
    """Reads content of a file within the task work directory."""
    parts = sanitize_rel_path(rel_path)
    target_path = work_dir.joinpath(*parts)
    if target_path.exists() and target_path.is_file():
        try:
            return target_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return None
    return None


ALLOWED_DOTFILES = {
    ".gitignore", ".env.example", ".dockerignore", ".editorconfig",
    ".flake8", ".prettierrc", ".eslintrc", ".babelrc", ".npmrc",
}


def list_workspace_files(work_dir: Path) -> List[Path]:
    """Scans and returns all non-junk files produced in the workspace."""
    if not work_dir.exists():
        return []
    files_found = []
    for root, dirs, files in os.walk(work_dir):
        dirs[:] = [d for d in dirs if d not in JUNK_DIR_PATTERNS and not d.startswith(".")]
        for f in files:
            if (f.startswith(".") and f.lower() not in ALLOWED_DOTFILES) or f.endswith(".pyc") or f.endswith(".log"):
                continue
            p = Path(root) / f
            files_found.append(p)
    return sorted(files_found, key=lambda p: p.name)
