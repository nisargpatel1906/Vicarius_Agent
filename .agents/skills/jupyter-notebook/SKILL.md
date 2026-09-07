---
name: jupyter-notebook
description: Guidelines for creating and executing production-grade Jupyter Notebooks (.ipynb) with machine learning, data science pipelines, and inline visualizations.
---

# Jupyter Notebook Skill

## 1. Structure & Narrative Flow
- Alternate clean Markdown explanations with focused, runnable code cells.
- Markdown cells must explain *why* an operation is performed, mathematical formulation, and interpret outputs of subsequent cells.
- Divide the notebook into standard numbered sections:
  1. Setup & Environment Verification
  2. Dataset Acquisition & Exploratory Data Analysis (EDA)
  3. Feature Engineering & Preprocessing
  4. Model Architecture & Training Pipeline
  5. Performance Evaluation & Validation Metrics
  6. Discussion & Error Analysis

## 2. Mandatory Output Execution
- **Zero Blank Output Cells**: All code cells must be executed so `outputs` contain real terminal output, pandas dataframes, and inline `matplotlib`/`seaborn` figures.
- Run headless execution via `nbclient` / `jupyter nbconvert --to notebook --execute` or the worker's execution tool.

## 3. Visualizations & Plots
- All charts must use modern aesthetics (e.g. `sns.set_theme(style="whitegrid")`, crisp DPI=300).
- Must include informative titles, axis labels with units, legends, and clear annotations.
- Generate at least 3 distinct visualizations (distribution plots, correlation heatmaps, loss/accuracy training curves, confusion matrices).

## 4. Reproducibility & Determinism
- Always set deterministic random seeds at the top: `np.random.seed(42)`, `torch.manual_seed(42)`.
- Self-contained datasets: use standard benchmarks (scikit-learn datasets, PyTorch vision datasets) or synthetic data generators if external datasets are not provided.
