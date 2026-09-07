---
name: codebase-project
description: Guidelines for generating complete, working software projects, APIs, web applications, and algorithm suites.
---

# Codebase Project Skill

## 1. Zero Stub Policy
- Every file must be complete and functional.
- Strictly no `TODO`, `# placeholder`, `# implement here`, or dummy `pass` functions.
- Every function, class, and module must have working implementations with real logic and edge-case handling.

## 2. Directory Architecture & Modular Design
- Adhere to clean modular separation:
  - `src/` or `app/` for core logic
  - Entrypoint at root (e.g. `main.py`, `app.py`, or `index.ts`)
  - Dependency manifests (`requirements.txt`, `package.json`) specifying exact package versions
  - `README.md` containing an architectural summary, setup commands, and execution instructions.

## 3. Automated Smoke Testing & Verification
- Include an automated verification script (e.g. `tests/test_core.py` or a headless run command) and execute it during build to verify exit code 0.
- Handle exceptions and edge cases gracefully without crashing unhandled.

## 4. Packaging & Artifact Cleanliness
- If packaging into a `.zip` file:
  - Create an inner folder matching the zip basename (e.g. `project_submission/` inside `project_submission.zip`).
  - Strictly exclude bloat: `__pycache__`, `.venv`, `node_modules`, `.git`, temporary log files.
