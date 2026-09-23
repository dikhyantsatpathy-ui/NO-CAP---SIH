---
name: sih26188-architecture
description: Mandatory architectural invariants for SIH26188 (AI-Based Fake Identity & Document Screening System, MHA/SSB). Apply to all code changes, refactors, and feature additions across backend and frontend.
---

# SIH26188 Architectural Invariants

## Core Principles

1. **Zero-Raw-Storage Privacy Invariant**:
   Never persist raw image bytes, facial crop portraits, or cleartext identity numbers in databases, filesystems, or server logs. All documents are identified strictly by their irreversible SHA-256 byte digest.
2. **Immutable Cryptographic Ledger**:
   Every screening decision creates an immutable block in the hash-chain ledger. A document can be soft-removed from active session comparison, but its screening report and block hash are never deleted or modified.
3. **Four-Module Forensic Architecture**:
   - **Module 1**: In-memory OCR & MRZ parsing.
   - **Module 2**: Deterministic arithmetic and format validation (ICAO 9303, Aadhaar Verhoeff, PAN syntax).
   - **Module 3**: Physics-based image tampering detection (JPEG ELA, 2D-FFT spectral PAPR, PRNU noise consistency, blur Laplacian).
   - **Module 4**: Facial portrait biometrics with dynamic age-aware verification thresholding and challenge-response liveness.
4. **Offline-First & Graceful Degradation**:
   Remote SSB border posts operate under low or zero network connectivity. All heuristic paths (Pillow, NumPy, SciPy) must execute locally without internet or external GPU servers. Heavy neural models (ONNX Runtime, YOLO, ArcFace) are optional accelerators, never single points of failure.
5. **Explainable Risk Scoring**:
   The system must never output an unexplainable binary verdict. The 0–100 risk score must be accompanied by itemized evidence signals for legal defensibility under Section 65B of the Bharatiya Sakshya Adhiniyam, 2023.
6. **Vite Singlefile Inlining**:
   The FastAPI backend serves the React frontend as an inlined singlefile bundle at `app/static/index.html`. Every frontend change must be compiled using `cd frontend && npm run build`.
