---
name: ui-decluttering-and-visual-hierarchy
description: Design and engineering guide for eliminating UI visual clutter, establishing strong visual hierarchy, generous breathing room, progressive disclosure, and clean labeling across dashboard and kiosk interfaces. Use when layouts feel cramped, cluttered, overcrowded, or visually noisy.
---

# UI Decluttering & Visual Hierarchy Guide

## Overview

High-security and operational software (such as border screening terminals) often degenerates into "cockpit clutter": dozens of metrics, badges, buttons, and sub-tables dumped on screen simultaneously. This overwhelms the operator, increases cognitive friction, and leads to operational fatigue.

This skill outlines deterministic patterns to turn cramped, chaotic layouts into spacious, elegant, and high-efficiency interfaces.

---

## 1. The Anti-Clutter Design Principles

### Principle 1: Progressive Disclosure (Detail on Demand)
- **Primary Glance (0-1s)**: Show ONLY the critical verdict and key identifiers (e.g. Document Type, Masked ID, Risk Score pill: `ALLOW · RISK 12`).
- **Secondary Inspection (1-5s)**: Expandable sub-tables (`[▶ Details]`) provide deeper forensics (M1-M4 checks, field discrepancies, cryptographic hash chain).
- **Rule**: Never render 40 forensic signals simultaneously in the top-level card view. Keep default state minimal and clean.

### Principle 2: Eliminate "Badge Soup" / Chip Overload
- **Bad**: 8 colorful chips packed side-by-side (`[DOC 01] [PASSPORT] [CLEAR] [RISK 12] [NAT: NP] [TRADE] [IST] [VERIFIED]`).
- **Good**: Clear semantic role separation:
  - Document title + type in clean bold typography.
  - Exactly ONE focal status badge (e.g. green `CLEAR` or red `FLAGGED`).
  - Auxiliary metadata (nationality, timestamp, officer) in quiet, muted secondary text with proper spacing.

### Principle 3: Generous Grid Geometry (Kill 290px Minmax)
- Tabular data, cryptographic hashes, and forensic scorecards CANNOT fit in 290px cards.
- **Rule**: Set card grid minimum width to at least `520px` (`grid-template-columns: repeat(auto-fit, minmax(520px, 1fr))`) or use a structured single-column stack. This guarantees tabular data has room to breathe without awkward line wrapping.

### Principle 4: Purposeful Visual Chunking
Group related controls into distinct visual surfaces:
- **Intake Area**: Do not mix document metadata inputs with file dropzones and submit buttons in a flat auto-fit soup.
  - Left zone: Document Type & Declared Fields.
  - Right zone: Document Source (File Upload vs Webcam).
  - Bottom zone: Full-width dedicated action bar with clear primary focus.

---

## 2. Spacing & Typography Scale

| Token | Dimension | Application |
|---|---|---|
| Section Spacing | `24px - 32px` | Distance between major operational panels |
| Card Padding | `18px - 22px` | Internal card breathing room |
| Field Gap | `12px - 16px` | Gap between form inputs in a row |
| Micro-Label | `11px, font-weight: 600` | Uppercase field headers (`letter-spacing: 0.05em`) |
| Body Value | `13.5px - 14px` | Readout values with high contrast |
| Monospace | `12.5px` | Hashes, dates, serials (`letter-spacing: -0.01em`) |

---

## 3. CSS Patterns for Clean Layouts

```css
/* ✅ Clean, spacious card grid without cramped squishing */
.docs__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(520px, 1fr));
  gap: 20px;
}

/* ✅ Segmented tab controls instead of stacked messy buttons */
.segmented-control {
  display: inline-flex;
  background: var(--bg-2);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--line);
}

.segmented-control__btn {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.segmented-control__btn--active {
  background: var(--panel);
  color: var(--ink);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
```
