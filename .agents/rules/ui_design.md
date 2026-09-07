# UI Design System Standard — Cognitive Heritage

Whenever building or generating any user interface (UI), frontend web application, dashboard, or presentation in this codebase:

## 1. Core Visual Identity & Design Tokens (from `docx/DESIGN.md`)
You MUST adhere strictly to the **Cognitive Heritage** aesthetic system. Avoid generic, unstyled components or default browser styling.

### Color Palette Tokens:
- **Surface**: `#fff8f4` (Light clean base)
- **Surface Container**: `#fdebd9`
- **Surface Container High**: `#f7e5d4`
- **On-Surface (Primary Text)**: `#231a0f`
- **On-Surface Variant (Secondary Text)**: `#4d463a`
- **Primary Accent**: `#705728`
- **Primary Container**: `#8b6f3e` (On-Primary Container: `#fff9f6`)
- **Secondary**: `#645e4e`
- **Tertiary**: `#625a46`
- **Error / Alert**: `#ba1a1a`
- **Outline / Border**: `#7f7669` (Variant: `#d1c5b6`)

### Typography Standards:
- **Headings & Titles (`display-lg`, `h1`, `h2`)**: Google Font `Noto Serif` (`font-weight: 600` / `700`, line-height: `1.1`–`1.3`).
- **Body Text & UI Labels (`body-lg`, `body-md`, `body-sm`, `button`)**: Google Font `Manrope` (`font-weight: 400` / `600`, letter-spacing: `0.02em`).

### Component Styling & Elevation:
- **Border Radius**: Use `8px` (`md`) for buttons/inputs, `12px` (`lg`) for cards/tables, and `9999px` for status badges/pills.
- **Micro-Interactions**: Smooth hover transitions (`transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`).
- **Glassmorphism / Cards**: Semi-translucent containers with subtle borders (`1px solid var(--outline-variant)`).

---

## 2. Requirement for Build Specs & Agents
Whenever generating full-stack or frontend projects, embed these design tokens directly in the project's CSS variables and HTML/React layouts.
