---
name: zero-storage-privacy-and-compliance
description: Enforces Zero-Raw-Storage privacy architecture and DPDP Act 2023 compliance. Use when handling file uploads, masking PII, writing database migrations, logging, generating forensic reports, or designing API endpoints that touch identity documents.
---

# Zero-Storage Privacy & Legal Compliance

## Core Architectural Invariant

> **NO RAW DOCUMENT BYTES, WEBCAM STILLS, CROPPED PORTRAITS, OR PLAINTEXT IDENTITY NUMBERS MAY EVER PERSIST ON DISK, IN DATABASES, OR IN LOGS.**

This architecture satisfies:
1. **Digital Personal Data Protection Act, 2023 (DPDP Act, India)**: Mandatory purpose limitation, data minimization, and storage limitation.
2. **Aadhaar Act 2016 (Section 29)**: Strict prohibition on public sharing or raw storage of Aadhaar numbers without masking.
3. **Cross-Border Legal Defensibility**: Checkpoint screening records are immutable cryptographic assertions, not honeypots for identity theft.

---

## 1. Cryptographic File Identification

Identity documents are uniquely referenced by the **SHA-256 digest** of their original input bytes:

```python
import hashlib

def compute_doc_hash(raw_bytes: bytes) -> str:
    """
    Computes deterministic SHA-256 digest of incoming document image.
    This hash serves as the primary key across the entire system.
    """
    return hashlib.sha256(raw_bytes).hexdigest()
```

- Store: `file_hash` (64 hex characters)
- NEVER Store: the `raw_bytes` themselves.

---

## 2. In-Memory Streaming & Ephemeral Lifecycles

All screening pipelines operate strictly within transient memory buffers (`io.BytesIO`). Once extraction, forensics, and biometrics complete:
1. The extracted fields are masked.
2. The risk assessment and evidence summaries are calculated.
3. The raw buffer is garbage collected.

```python
# ✅ GOOD: In-memory transient processing
def process_upload(file_bytes: bytes):
    file_hash = compute_doc_hash(file_bytes)
    fields = extract_fields_in_memory(file_bytes)
    forensics = compute_forensics_in_memory(file_bytes)
    
    # Immediately discard file_bytes; persist ONLY masked metadata
    save_screening_report(
        file_hash=file_hash,
        masked_name=mask_name(fields.get("name")),
        masked_id=mask_id(fields.get("id_number")),
        risk_score=forensics["risk_score"]
    )

# ❌ FORBIDDEN: Writing uploads to temporary directories
with open(f"/tmp/{filename}", "wb") as f: # VIOLATES ZERO-STORAGE MANDATE
    f.write(file_bytes)
```

---

## 3. Mandatory PII Masking Standards

Every string rendered to the UI or stored in the database must pass through standard masking filters:

| Field | Raw Example | Masked Output | Masking Rule |
|---|---|---|---|
| **Aadhaar** | `1234 5678 9012` | `XXXX-XXXX-9012` | Retain only last 4 digits |
| **Passport** | `Z1234567` | `Z*****67` | First character + asterisks + last 2 characters |
| **Full Name** | `RAJESH SHARMA` | `R**** S****` | First letter of each token + 4 asterisks |
| **Date of Birth** | `1985-06-14` | `1985-**-**` | Year retained for age-aware biometrics; month/day masked |
| **PAN Card** | `ABCDE1234F` | `A****1234F` | First letter + asterisks + last 5 characters |

---

## 4. Salted Blind Indexing (Zero-Knowledge Watchlist)

To match incoming travellers against security watchlists without storing cleartext blacklist names:

$$\text{BlindIndex} = \text{HMAC-SHA256}(\text{NormalizedPlaintext}, \text{SecretSalt})$$

- When a person is screened, their normalized name and document ID are hashed with the server's secret salt.
- The lookup queries `SELECT * FROM watchlist WHERE blind_index = :computed_hash`.
- The database administrator or an attacker gaining DB access cannot reverse the watchlist entries to discover who is under surveillance.

---

## 5. Security & Verification Checklist

- [ ] Verify that no `logger.info()` or `print()` outputs raw names or document IDs.
- [ ] Confirm no SQLite or Postgres migration contains columns like `raw_image`, `full_portrait`, or `plaintext_aadhaar`.
- [ ] Check that `/api/extract` operates entirely in memory and returns an ephemeral preview without database insertion.
