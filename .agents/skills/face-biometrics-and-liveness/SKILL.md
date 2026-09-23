---
name: face-biometrics-and-liveness
description: Guides face detection, portrait matching, age-aware verification thresholding, and multi-frame challenge-response liveness (SIH26188 Module 4). Use when developing, tuning, or testing facial biometrics, blink/nod detection, or anti-spoofing algorithms.
---

# Face Biometrics & Liveness Verification (Module 4)

## Overview

Module 4 matches the portrait extracted from an identity document against a live webcam still of the traveller presenting it. The challenge is balancing high security against false rejections caused by natural human aging, lighting differences at remote checkpoints, and presentation attacks (screens, printed photos, cut-out masks).

---

## 1. Age-Aware Verification Thresholding

### Problem
A passport issued 9 years ago depicts a face that has naturally aged. A static cosine similarity threshold (e.g., $0.65$) causes unacceptable false rejections for genuine travellers with older valid documents.

### Algorithm
Compute the age delta:
$$\Delta\text{Age} = |\text{Screening Year} - \text{Issue Year}|$$

Adjust the match threshold dynamically:
$$\text{Threshold}(\Delta\text{Age}) = \max\left(0.50, \text{BaseThreshold} - \min(\Delta\text{Age} \times 0.015, 0.15)\right)$$

```python
def get_age_aware_threshold(issue_year: int | None, screening_year: int = 2026) -> float:
    BASE_THRESHOLD = 0.65
    MIN_THRESHOLD = 0.50
    
    if not issue_year or issue_year > screening_year:
        return BASE_THRESHOLD
        
    delta_years = screening_year - issue_year
    discount = min(delta_years * 0.015, 0.15)
    
    return round(max(MIN_THRESHOLD, BASE_THRESHOLD - discount), 3)
```

---

## 2. Multi-Frame Interactive Challenge-Response Liveness

Passive liveness (single-still texture analysis) is susceptible to high-resolution iPad replays or synthetic prints. Interactive challenge-response forces the traveller to perform a random, ephemeral physical action within a strict time window (3–5 seconds):

### Supported Challenges
1. `BLINK_TWICE`: Detect 2 distinct Eye Aspect Ratio (EAR) dips below $0.20$.
2. `NOD_HEAD`: Detect vertical pitch oscillation via bounding box or facial landmark movement.
3. `TURN_HEAD_LEFT` / `TURN_HEAD_RIGHT`: Detect yaw displacement via nose-to-ear distance ratio.

### Eye Aspect Ratio (EAR) Heuristic

$$\text{EAR} = \frac{\|p_2 - p_6\| + \|p_3 - p_5\|}{2 \|p_1 - p_4\|}$$

```python
def evaluate_liveness_frames(frames: list[dict], challenge: str) -> dict:
    """
    Evaluates multi-frame biometric stream for challenge fulfillment.
    
    Args:
        frames: Sequence of timestamped facial landmark / bounding box observations.
        challenge: Expected action ('BLINK', 'NOD', 'TURN_HEAD').
    """
    if len(frames) < 3:
        return {"passed": False, "reason": "INSUFFICIENT_FRAMES"}
        
    if challenge == "BLINK":
        # Look for dip in eye opening ratio followed by recovery
        ears = [f.get("ear", 0.30) for f in frames]
        min_ear = min(ears)
        dips = sum(1 for e in ears if e < 0.20)
        passed = min_ear < 0.22 and dips >= 1
        return {"passed": passed, "min_ear": min_ear, "challenge": challenge}
        
    if challenge == "NOD":
        y_centers = [f.get("face_center_y", 0) for f in frames]
        y_range = max(y_centers) - min(y_centers)
        passed = y_range > 25  # Meaningful vertical displacement
        return {"passed": passed, "vertical_travel": y_range, "challenge": challenge}
        
    return {"passed": False, "reason": "UNSUPPORTED_CHALLENGE"}
```

---

## 3. Biometric Zero-Storage Mandate

- **Raw Facial Stills**: Never save the webcam image or the cropped portrait to disk or database.
- **Biometric Vectors**: In-memory embeddings (e.g. 512-dim ArcFace vectors) are compared immediately and discarded. Only the scalar similarity score ($0.0 \dots 1.0$) and age-aware threshold are persisted in the `ScreeningReport`.
