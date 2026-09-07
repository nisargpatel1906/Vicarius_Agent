---
name: presentation-deck
description: Standards and guidelines for executive and academic PowerPoint (.pptx) slide decks. Use for any presentation, pitch deck, or seminar task.
---

# Presentation Deck Skill

## 1. Canvas & Sizing
- **Format**: Strictly 16:9 Widescreen (`13.333` in width x `7.5` in height). Never 4:3 standard.

## 2. Visual Palette & Hierarchy
- **Palette**: Modern Executive Dark Obsidian (`#0a0f1d` background, `#162032` container cards, `#38bdf8` cyan accents, `#f8fafc` text) or Clean Ivory/Heritage (`#fff8f4` surface, `#705728` primary brass).
- Avoid default blank white slides with blue bullet points.
- Header hierarchy: Title in bold sans/serif (28-36pt), category pill tag above title (11pt uppercase, e.g. `● SYSTEM ARCHITECTURE`), subtitle (16pt muted).

## 3. Layout Structure (Split-Card / Bento)
- Structure slide body into 2 or 3 distinct card containers or columns.
- Each card has a distinct header, high-contrast background fill, and structured key points with bold leading phrases.
- Include dedicated callout banners at the bottom of key slides with quantitative metrics or executive takeaways.

## 4. Rich Technical Depth & Diagrams
- Content density: Avoid generic, high-level bullets. Provide exact architectural layers, mathematical formulas, quantitative benchmarks, or code snippets.
- Use shapes, connectors, and tables to form concrete workflow/pipeline diagrams.

## 5. Speaker Notes
- Every single slide must include comprehensive speaker notes (2-4 paragraphs) in `slide.notes_slide.notes_text_frame.text` explaining talking points, technical background, and presentation cues.

## 6. Append Directives
- When updating or extending an existing presentation, **never** create a blank `Presentation()`. Open `Presentation('existing_filename.pptx')` and append or modify slides.
