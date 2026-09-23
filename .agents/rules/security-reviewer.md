---
name: security-reviewer
description: Security review and audit checklist for border identity document screening (SIH26188). Use when auditing endpoints, data models, cryptographic primitives, or privacy compliance before releasing changes.
---

# Security Review & Audit Guidelines

## 1. Zero-Raw-Storage Verification
Every code change must be strictly audited against the Zero-Raw-Storage invariant:
- [ ] No route persists raw upload bytes (`file.read()`) to disk, `/tmp`, SQLite, or Postgres.
- [ ] Document identification is strictly handled via deterministic `SHA-256` hex digest.
- [ ] Database columns store ONLY masked names, masked document IDs, and scalar risk scores.
- [ ] Ephemeral memory buffers (`io.BytesIO`) are discarded upon request completion.

## 2. Cryptographic Integrity & Ledger Immutability
- [ ] Ledger blocks must link to their parent block via `prev_hash`.
- [ ] Soft-removal (`POST /api/sessions/{session_id}/documents/{report_id}/remove`) must NEVER delete or mutate the underlying `ScreeningReport` row or the blockchain ledger. It only unlinks the document from active comparison.
- [ ] Digital signatures and statutory certificates must reference the immutable block hash and Section 65B of the Bharatiya Sakshya Adhiniyam, 2023.

## 3. Input Sanitization & DoS Defense
- [ ] File uploads must enforce `MAX_UPLOAD_BYTES` (default 10 MB). Rejections must return `413 Request Entity Too Large`.
- [ ] Image decoding must be wrapped in `try/except` to prevent decompression bombs (e.g. `Image.MAX_IMAGE_PIXELS` limits).
- [ ] Session cookies must have `HttpOnly`, `SameSite=Lax`, and `Secure` (in production).
- [ ] API routes must be protected against unauthenticated enumeration.

## 4. Privacy & Compliance
- [ ] DPDP Act 2023: Purpose limitation, data minimization, and immediate ephemeral disposal.
- [ ] Aadhaar Act Section 29: Aadhaar numbers must be masked to display only the last 4 digits (`XXXX-XXXX-1234`).
- [ ] Watchlist searches must use salted blind indexing (`HMAC-SHA256`) to prevent database leak of monitored individuals.