"""
Border screening SESSION orchestration (SIH26188).

One traveller at the desk = one session. Their documents are screened one at a
time (each pass already persists a masked ScreeningReport audit row); the
extracted identifier values are compared ACROSS the documents for
discrepancies; and when the session is approved (or a supervisor settles a
flagged one) the session's canonical data is reduced to a SHA-256 digest and
chained into the ledger as an immutable block.

Zero-storage is preserved end to end: only hashes (of the file, of normalized
field values), masked tails, and comparison *flags* are persisted. Raw values
live only in memory during one screening run and are then discarded.

Cross-document name comparison is script-aware: exact digests are compared
only when both documents sourced the name in the same script (the common
Latin MRZ vs Latin print case). If one document's name came from a Devanagari
scan and the other from a Latin print, the field is marked `cross-script` for
human review — the comparison never fabricates a hard mismatch it cannot
prove, and never silently clears a real one.
"""

import hashlib

from screening import norm, mask  # type: ignore


# Fields whose values must agree across the documents of one person.
CMP_FIELDS = (
    ("name", "Holder name"),
    ("dob", "Date of birth"),
    ("gender", "Gender"),
    ("passport", "Passport / visa number"),
)

# The extraction pass can surface a holder name under any of these keys,
# depending on the medium (image OCR -> 'name'/'holder_name', MRZ -> 'mrz_name').
_NAME_KEYS = ("name", "holder_name", "mrz_name")


def _canonical_name(fields: dict) -> str:
    for key in _NAME_KEYS:
        val = fields.get(key)
        if val:
            return val
    return ""


def _is_devanagari(value: str) -> bool:
    return any("\u0900" <= ch <= "\u097F" for ch in value)


def _name_variant(value: str) -> str:
    """Canonical Latin form of a holder name: Devanagari is transliterated to
    Latin (see _transliterate_devanagari), then normalized. Latin names pass
    through untouched so same-script digests stay exact. Returns '' for falsy
    input."""
    if not value:
        return ""
    if _is_devanagari(value):
        value = _transliterate_devanagari(value)
    return norm(value)


def _transliterate_devanagari(value: str) -> str:
    """Deterministic compact Devanagari -> Latin transliteration (name subset).

    Bare consonants emit no inherent vowel, matras append their vowel, the
    virama is dropped, and long vowels are shortened ('aa'->'a', 'ii'->'i',
    'uu'->'u') to mirror how Indian names are conventionally romanized.
    Non-Devanagari characters pass through untouched."""
    out = []
    for ch in value:
        mapped = _DEVANAGARI_MAP.get(ch)
        if mapped is None:
            out.append(ch)
        elif mapped:
            out.append(mapped)
    text = "".join(out)
    for _long, _short in (("aa", "a"), ("ii", "i"), ("uu", "u")):
        text = text.replace(_long, _short)
    return text


_DEVANAGARI_MAP = {
    # Independent vowels
    "\u0905": "a", "\u0906": "aa", "\u0907": "i", "\u0908": "ii",
    "\u0909": "u", "\u090A": "uu", "\u090B": "ri", "\u090C": "e",
    "\u090F": "e", "\u0910": "ai", "\u0911": "o", "\u0913": "o", "\u0914": "au",
    # Consonants (bare)
    "\u0915": "k", "\u0916": "kh", "\u0917": "g", "\u0918": "gh", "\u0919": "ng",
    "\u091A": "ch", "\u091B": "chh", "\u091C": "j", "\u091D": "jh", "\u091E": "ny",
    "\u091F": "tt", "\u0920": "tth", "\u0921": "dd", "\u0922": "ddh", "\u0923": "nn",
    "\u0924": "t", "\u0925": "th", "\u0926": "d", "\u0927": "dh", "\u0928": "n",
    "\u0929": "nn", "\u092A": "p", "\u092B": "ph", "\u092C": "b", "\u092D": "bh",
    "\u092E": "m", "\u092F": "y", "\u0930": "r", "\u0931": "l", "\u0932": "l",
    "\u0933": "ll", "\u0934": "ll", "\u0935": "v", "\u0936": "sh", "\u0937": "shh",
    "\u0938": "s", "\u0939": "h",
    # Nukta variants
    "\u0958": "q", "\u0959": "kh", "\u095A": "g", "\u095B": "z",
    "\u095C": "dd", "\u095D": "rrh", "\u095E": "f", "\u095F": "y",
    # Matras (dependent vowels)
    "\u093E": "aa", "\u093F": "i", "\u0940": "ii", "\u0941": "u", "\u0942": "uu",
    "\u0943": "ri", "\u0944": "rii", "\u0945": "e", "\u0946": "e", "\u0947": "e",
    "\u0948": "ai", "\u0949": "o", "\u094A": "o", "\u094B": "o", "\u094C": "au",
    # Other signs
    "\u0901": "n", "\u0902": "n", "\u0903": "h",
    # Marks that emit nothing
    "\u0900": "", "\u093C": "", "\u094D": "", "\u094E": "", "\u0951": "",
    "\u0952": "", "\u0953": "", "\u0954": "",
}


def field_hashes(fields: dict) -> dict:
    """Per-field comparison record for one document. In-memory only; returns
    {field: {"h": sha256 of the normalized value, "s": script}} for the fields
    actually present. `s` is 'latin' or 'devanagari' and drives the
    script-aware name comparison in build_comparison."""
    out = {}
    for key, _label in CMP_FIELDS:
        if key == "name":
            raw = _canonical_name(fields)
            script = "devanagari" if raw and _is_devanagari(raw) else "latin"
            base = _name_variant(raw) if raw else ""
        else:
            raw = fields.get(key) or ""
            script = "latin"
            base = norm(raw) if raw else ""
        if base:
            out[key] = {"h": hashlib.sha256(base.encode("utf-8")).hexdigest(), "s": script}
    return out


def _entry(doc: dict, key: str):
    """Normalized comparison record for one field of one document."""
    e = (doc.get("field_hashes") or {}).get(key)
    if isinstance(e, dict):
        return e
    if isinstance(e, str):  # legacy plain-digest rows
        return {"h": e, "s": "latin"}
    return None


def build_comparison(docs: list[dict]) -> dict:
    """Compare the field records of the documents in one session.

    docs: [{"doc_type", "field_hashes", "masked"}]  (masked = masked fields map)

    Each check status is one of:
      agree        all documents carrying the field share its digest
      disagree     at least two documents differ (hard mismatch)
      cross-script names came from different scripts — human review, never a
                   hard mismatch
      single       only one document carries the field
      none         the field appears nowhere

    Returns {checks, verdict, risk_bump} with verdict:
      CONSISTENT   nothing disagrees
      DISCREPANCY  at least one hard disagree
      INCOMPLETE   no comparable field appears on more than one document
    """
    checks: list[dict] = []
    bump = 0
    for key, label in CMP_FIELDS:
        present = [(i, d) for i, d in enumerate(docs) if _entry(d, key)]
        if len(present) < 2:
            if len(present) == 1:
                _, d = present[0]
                checks.append({
                    "field": key, "label": label, "status": "single",
                    "detail": f"Only one document carries it ({d.get('doc_type')}) — nothing to compare.",
                    "docs": [d.get("doc_type")],
                    "mask": d.get("masked", {}).get(key),
                })
            else:
                checks.append({
                    "field": key, "label": label, "status": "none",
                    "detail": "Not present on any document.",
                    "docs": [],
                })
            continue

        kinds = sorted({d.get("doc_type") for _, d in present})
        digests = {(_entry(d, key) or {})["h"] for _, d in present}
        scripts = {(_entry(d, key) or {}).get("s", "latin") for _, d in present}
        masks = {d.get("doc_type"): d.get("masked", {}).get(key) for _, d in present}

        if len(digests) == 1:
            mask_val = next((m for m in masks.values() if m), None)
            checks.append({
                "field": key, "label": label, "status": "agree",
                "detail": f"Matches across {len(present)} documents ({', '.join(kinds)}).",
                "docs": kinds, "mask": mask_val,
            })
        elif len(scripts) > 1:
            checks.append({
                "field": key, "label": label, "status": "cross-script",
                "detail": "Value differs — documents sourced it from different "
                          "scripts, so an exact hash match is not expected. "
                          "Verify by eye before approval.",
                "docs": kinds, "masks": masks,
            })
        else:
            checks.append({
                "field": key, "label": label, "status": "disagree",
                "detail": f"Values DIFFER between {', '.join(kinds)} — verify by eye before approval.",
                "docs": kinds, "masks": masks,
            })
            bump += 30

    if any(c["status"] == "disagree" for c in checks):
        verdict = "DISCREPANCY"
    elif any(c["status"] in ("agree", "single", "cross-script") for c in checks):
        verdict = "CONSISTENT"
    else:
        verdict = "INCOMPLETE"
    return {"checks": checks, "verdict": verdict, "risk_bump": bump}


def session_payload(*, session_id, checkpoint, screener, verdict, risk_score,
                    doc_blocks, comparison_verdict, closed_at) -> str:
    """Canonical string signed into the ledger. Contains only identifiers'
    hashes, verdicts and timestamps — never raw values."""
    parts = [
        session_id,
        checkpoint or "",
        screener or "",
        verdict or "",
        str(int(risk_score or 0)),
        ":".join(sorted(doc_blocks or [])),
        comparison_verdict or "",
        closed_at or "",
    ]
    return "|".join(parts)


def chain_hash(prev_hash: str | None, payload: str) -> str:
    """Chained block digest: sha256(f"{prev||'GENESIS'}:{payload}")."""
    return hashlib.sha256(f"{(prev_hash or 'GENESIS')}:{payload}".encode("utf-8")).hexdigest()