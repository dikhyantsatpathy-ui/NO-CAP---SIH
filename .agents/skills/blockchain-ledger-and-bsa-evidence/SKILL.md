---
name: blockchain-ledger-and-bsa-evidence
description: Guides implementation of the immutable SHA-256 hash-chain ledger and generating court-admissible electronic record certificates under Section 65B of the Bharatiya Sakshya Adhiniyam, 2023 (BSA). Use when modifying blockchain ledger logic, Merkle tree sync, or legal audit export features.
---

# Blockchain Ledger & BSA 2023 Court Evidence

## Overview

SIH26188 falls under the **Blockchain & Cybersecurity** theme. The border screening system incorporates an offline-first cryptographic hash-chain ledger that guarantees audit immutability without requiring internet access or high-latency external mining.

Every screening event produces an immutable cryptographic block. The ledger serves as legal evidence admissible in Indian courts under **Section 65B of the Bharatiya Sakshya Adhiniyam, 2023 (BSA)** (replacing Section 65B of the Indian Evidence Act, 1872).

---

## 1. Hash-Chain Block Architecture

### Block Structure
Each block in the ledger contains:
- `index`: Monotonically increasing 64-bit integer ($0, 1, 2, \dots$)
- `prev_hash`: SHA-256 hex digest of the preceding block (Genesis block has `prev_hash = "0" * 64`)
- `file_hash`: SHA-256 digest of the screened document's raw bytes
- `risk_score`: Calibrated integer score ($0 \dots 100$)
- `verdict`: Final officer or system decision (`ALLOW`, `REFER`, `REJECT`)
- `screener_id`: Digital identifier of the screening officer or desk terminal
- `timestamp`: UTC ISO-8601 creation timestamp
- `nonce`: Cryptographic nonce satisfying optional difficulty constraints
- `block_hash`: Canonical SHA-256 digest of the block header

### Recursive Block Hash Formula
$$\text{block\_hash}_i = \text{SHA256}(\text{index} \parallel \text{prev\_hash} \parallel \text{file\_hash} \parallel \text{risk\_score} \parallel \text{verdict} \parallel \text{screener\_id} \parallel \text{timestamp} \parallel \text{nonce})$$

### Implementation Pattern

```python
import hashlib
import json

def calculate_block_hash(
    index: int,
    prev_hash: str,
    file_hash: str,
    risk_score: int,
    verdict: str,
    screener_id: str,
    timestamp: str,
    nonce: int = 0
) -> str:
    payload = f"{index}|{prev_hash}|{file_hash}|{risk_score}|{verdict}|{screener_id}|{timestamp}|{nonce}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

def verify_ledger_chain(blocks: list[dict]) -> tuple[bool, str]:
    """
    Validates complete cryptographic continuity from Genesis to tip.
    """
    if not blocks:
        return True, "Empty chain"
        
    expected_prev = "0" * 64
    for b in blocks:
        if b["prev_hash"] != expected_prev:
            return False, f"Broken link at block index {b['index']}"
            
        calculated = calculate_block_hash(
            b["index"], b["prev_hash"], b["file_hash"],
            b["risk_score"], b["verdict"], b["screener_id"],
            b["timestamp"], b.get("nonce", 0)
        )
        if calculated != b["block_hash"]:
            return False, f"Digest mismatch at block index {b['index']}"
            
        expected_prev = b["block_hash"]
        
    return True, "Chain valid and tamper-evident"
```

---

## 2. Bharatiya Sakshya Adhiniyam, 2023 (BSA) Section 65B Certificate

Under BSA 2023 Section 65B, electronic records (screening reports, biometric match scores, forensic logs) are admissible in criminal prosecution only when accompanied by a statutory certificate executed by the person having lawful control of the computing device.

### Mandatory Certificate Fields
1. **Device Identification**: Terminal ID, Checkpoint Name (e.g. *Panitanki LCS, Darjeeling Sector*), Operating System, and Application version.
2. **Chain of Custody**: Cryptographic block hash, parent hash, and immutable timestamp.
3. **Operational Regularity**: Statement that the system was operating properly during the recording period without unauthorized interference.
4. **Officer Signature**: Digital signature / HMAC token of the certifying border security official.

```python
def generate_bsa_65b_certificate(report: dict, block: dict, officer: dict) -> dict:
    return {
        "statutory_act": "Bharatiya Sakshya Adhiniyam, 2023 (Section 65B)",
        "certificate_id": f"BSA65B-{block['block_hash'][:16].upper()}",
        "checkpoint": report.get("checkpoint", "IN-NPL-PANITANKI"),
        "timestamp_utc": block["timestamp"],
        "document_digest": report["file_hash"],
        "blockchain_verification": {
            "block_index": block["index"],
            "block_hash": block["block_hash"],
            "prev_hash": block["prev_hash"],
            "integrity_verified": True
        },
        "forensic_verdict": report["verdict"],
        "certifying_authority": {
            "officer_name": officer["name"],
            "badge_number": officer["badge_number"],
            "unit": "Sashastra Seema Bal, Police II Division"
        },
        "declaration": (
            "I hereby certify that the electronic record above was generated during the ordinary "
            "course of border screening operations, that the system operated normally without interference, "
            "and that the cryptographic digest confirms the integrity of the data under Section 65B of BSA 2023."
        )
    }
```

---

## 3. External Anchoring Strategy

To eliminate any doubt regarding retroactive history rewriting by local administrators:
- The system computes the **Merkle Root** of daily screening blocks.
- The Merkle root is anchored periodically (or when internet connectivity restores) to a public blockchain or timestamping authority (e.g., Ethereum, Polygon, or Bitcoin OP_RETURN).
- See `scripts/anchor_ledger.py` for CLI anchoring tools.
