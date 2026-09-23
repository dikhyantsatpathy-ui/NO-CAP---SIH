---
name: data-labeling-and-annotation-engineering
description: Best practices for data labeling, bounding box visualization, OCR ROI overlays, and non-cluttered annotation rendering on identity documents. Use when designing or tuning visual field tags, bounding box overlays, or inspection chips.
---

# Data Labeling & Annotation Engineering

## Overview

When screening identity documents, computer vision models detect Regions of Interest (ROI) such as photograph boxes, signature lines, MRZ zones, and security holograms. If these annotations are rendered with loud colors, opaque boxes, or overlapping tag labels, the original document is obscured and the officer cannot visually verify the findings.

---

## 1. Non-Obstructive Bounding Box Rules

### Stroke & Fill
- **Stroke Width**: `1.5px` to `2px` maximum. Never use heavy 4px strokes that blot out fine security guilloche patterns or microprinting.
- **Fill**: Never use solid fills. Use semi-transparent tint (`rgba(r, g, b, 0.08)`) or outline-only so the underlying text remains 100% legible.
- **Corner Highlights**: For modern cyber aesthetic, use corner-tick bounding boxes (`border-radius: 4px` or 4 corner brackets `┌ ┐ └ ┘`) instead of full solid rectangles.

### Tag Placement & Anti-Overlap
- **Tag Pills**: Render label tags *outside* the bounding box (preferably above top-left, or below bottom-left if bounding box touches the top edge).
- **Anti-Collision**: When multiple ROIs are adjacent (e.g. Name, DOB, Document Number), stagger tag offsets vertically or collapse them into a grouped inspector sidebar.

---

## 2. Field Label Formatting Standards

| Raw Field Name | Clean Display Label | Bad / Cluttered Label |
|---|---|---|
| `doc_number` | **Document Number** | `DOC_NUM_M1_EXTRACTED` |
| `name` | **Full Name** | `DECL_NAME_VS_OCR_TXT` |
| `dob` | **Date of Birth** | `DOB_YYYYMMDD_COMP` |
| `expiry_date` | **Validity / Expiry** | `EXPIRY_DT_CHECK_RES` |
| `nationality` | **Nationality** | `NAT_ISO3_FIELD` |

- **Rule**: Never leak snake_case database identifiers or internal variable names into operator-facing tables or cards. Always map through a clean human-readable dictionary.
