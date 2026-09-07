---
name: academic-document
description: Guidelines for IEEE/APA academic papers, lab reports, formal reports, essays, and executive summaries (.docx, .pdf).
---

# Academic Document Skill

## 1. Document Architecture
- **Standard Research Paper**: Title, Student Metadata, Abstract (with Keywords), 1. Introduction, 2. Related Work / Theoretical Background, 3. Methodology & Architecture, 4. Implementation / Experiments, 5. Results & Discussion, 6. Conclusion & Future Work, References.
- **Lab Report**: Title, Objective, Apparatus/Environment, Theoretical Background, Step-by-Step Procedure, Observations/Data Tables, Error Analysis, Conclusion.

## 2. Academic Tone & Style (Anti-AI Heuristics)
- Write with empirical, objective precision.
- **Prohibited AI Clichés**: Avoid phrases like *"in an era where"*, *"delve deeper"*, *"a testament to"*, *"rich tapestry"*, *"in conclusion it is crucial to recognize"*.
- State findings directly with data, metrics, equations, and explicit operational specifics.

## 3. Formatting & Typography
- **Headings**: Clear hierarchical heading levels (Heading 1, Heading 2, Heading 3).
- **Tables & Figures**: Every table must have a labeled caption above (`Table 1: Hyperparameter Specifications`) and every figure must have a caption below (`Figure 1: End-to-End Pipeline Workflow`).
- **Callout Boxes**: Use light-tinted single-cell callout boxes with thick left borders for key formulas, theorems, or executive takeaways.

## 4. Citations & References
- Format strictly per requested style:
  - **IEEE**: Numeric brackets `[1]`, `[2]` sorted by appearance.
  - **APA**: Author-year `(Author, 2024)` sorted alphabetically.
- Include real, verifiable paper titles, conferences/journals, and publication years.

## 5. Append Directives
- When updating or extending an existing document, open `Document('existing_filename.docx')` and append sections instead of overwriting.
