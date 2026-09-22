"""
Module 1 — OCR Extraction (SIH26188 "AI-Based Fake Identity & Document
Screening"). One uploaded document -> machine-readable fields:

  pdf   -> pypdf text layer -> extract_fields (identifier regexes + MRZ)
  image -> tesseract OCR (best-effort) + MRZ parse

Everything else joins here too: the officer's typed `declared` map merged over
the scan (declared never overrides machine-read values; it back-fills gaps so
officer typos cannot silently shadow verified fields).

Output is the same zero-storage shape as the rest of the desk: raw text and
photos are read, used, and discarded — only masked identifiers and checksums
move on to Module 2.
"""

import re

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #

# Declared keys are keyed by purpose, not by free text. Generic keys always
# belong to the selected document type; unrelated typed keys (for example, an
# EPIC key supplied during passport screening) are ignored so one form cannot
# populate another document's identifier field.
_TARGET_FIELD_FOR = {
    "passport": "passport",
    "visa": "passport",
    "pan": "pan",
    "driving_licence": "driving_licence",
    "voter_id": "voter_id",
    "rc": "driving_licence",
}
_GENERIC_DECL_KEYS = {"document_number", "doc_number", "number", "id", "declared"}


def extract_document(data: bytes, filename: str = "", doc_type: str = "",
                     declared: dict = None) -> dict:
    """Run the extraction pass over one document.

    Returns a dict the screening desk merges into its report:
      medium     "pdf" | "image" | "unknown"
      fields     normalized identifier fields {pan, dl, passport, ...}
      mrz        parsed MRZ block (passport / visa) or None
      ocr        {ran, engine, reason} metadata
      pdf_no_text made this pass for image-only PDFs
      ai_detection / document_aware: filled by run_screening when the caller
                 already computed them (they live in app/main.py); not rerun here.
    """
    declared = {k: v for k, v in (declared or {}).items()
                if isinstance(v, str) and v.strip()}
    ext = (filename or "").lower().rsplit(".", 1)[-1] if "." in (filename or "") else ""

    from screening import extract_fields

    result = {
        "medium": "unknown",
        "fields": {},
        "mrz": None,
        "ocr": {"ran": False, "reason": "no image"},
        "pdf_no_text": False,
        "ai_detection": {"ran": False, "explanation": "No image."},
        "document_aware": None,
    }

    if ext == "pdf":
        result["medium"] = "pdf"
        text, img_bytes = _pdf_text_or_image(data)
        if text:
            result["fields"] = extract_fields(text)
        elif img_bytes:
            img_res = _extract_image(img_bytes)
            result["fields"] = img_res.get("fields", {})
            result["mrz"] = img_res.get("mrz")
            result["ocr"] = img_res.get("ocr", {"ran": True, "engine": "pdf-embedded-ocr"})
            result["pdf_no_text"] = False
        else:
            result["pdf_no_text"] = True
            result["ocr"] = {"ran": False,
                             "reason": "PDF has no extractable text layer (scan)."}
    elif ext in ("jpg", "jpeg", "png", "webp", "bmp"):
        result["medium"] = "image"
        if _is_aadhaar(doc_type):
            # Aadhaar gets a purpose-built pass: the 5-class YOLO zone detector
            # isolates Name/DOB/Aadhaar_No/Gender/Photo; each text zone is
            # cropped and OCR'd in isolation, and the Photo crop rides along
            # for Module 4. Model missing? Falls back to the generic image OCR
            # so screening never hard-fails (Vercel-safe degradation).
            result.update(_extract_aadhaar_image(data))
        else:
            result.update(_extract_image(data))

    # Merge declared values only into gaps (machine-read values win).
    # Scope parsing to the selected document type: only generic identifier
    # keys or keys naming this document are considered. Unknown/unspecified
    # types retain the legacy behavior of scanning all declared values.
    doc_key = (doc_type or "").lower().strip()
    target = _TARGET_FIELD_FOR.get(doc_key)
    selected = []
    for k, v in declared.items():
        key = (k or "").lower().strip()
        if not doc_key or target is None:
            selected.append(v)
        elif (key in _GENERIC_DECL_KEYS or doc_key in key or
                (target and target in key)):
            selected.append(v)
    decl_text = " ".join(v for v in selected if isinstance(v, str))
    if not decl_text:
        decl_text = " ".join(v for v in declared.values()
                             if isinstance(v, str))
    decl_fields = extract_fields(decl_text)
    for k, v in decl_fields.items():
        if v and not result["fields"].get(k):
            result["fields"][k] = v

    # Free-text identity values (name / gender) back-fill exactly like
    # identifiers: when there is no OCR engine (Vercel/offline workers) the
    # scanner reads no holder fields, and officers legitimately type them at
    # the desk. Without this the cross-document comparison could never see a
    # name and every session would compare INCOMPLETE. Machine-read values
    # still win (same gap-only rule); a sanitized Latin form keeps digests
    # comparable across documents.
    for decl_key, field_key in (("name", "name"), ("holder_name", "name"),
                                ("gender", "gender")):
        typed = (declared.get(decl_key) or "").strip()
        if not typed or result["fields"].get(field_key):
            continue
        if field_key == "name":
            cleaned = re.sub(r"\s+", " ",
                             re.sub(r"[^A-Za-z .\-]", " ", typed)).strip()[:100]
            if cleaned:
                result["fields"]["name"] = cleaned
        else:
            g = re.search(r"\b(M|F|MALE|FEMALE)\b", typed.upper())
            if g:
                result["fields"]["gender"] = g.group(1)[0].upper()
    return result


# --------------------------------------------------------------------------- #
# Medium-specific passes
# --------------------------------------------------------------------------- #

def _pdf_text_or_image(data: bytes) -> tuple[str, bytes | None]:
    try:
        import io
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((pg.extract_text() or "") for pg in reader.pages)
        if text.strip():
            return text, None
        if reader.pages:
            p0 = reader.pages[0]
            if getattr(p0, "images", None) and len(p0.images) > 0:
                first_img = p0.images[0]
                return "", getattr(first_img, "data", None)
    except Exception:
        pass
    return "", None


def _extract_image(data: bytes) -> dict:
    """OCR + MRZ over one image. Each subsystem is isolated: a failure in
    one never loses the rest, and unreadable input degrades to honest 'ran:
    False' rather than a hard error."""
    from screening import extract_fields
    from identity import ocr_extract
    from mrz import parse_mrz
    from llm import extract_document_data

    out = {"fields": {}, "mrz": None,
           "ocr": {"ran": False, "reason": "not run"}, "pdf_no_text": False,
           "llm_extraction": {"ran": False, "reason": "not run"}}

    text, ocr_meta = ocr_extract(data)
    out["ocr"] = ocr_meta
    if text:
        out["fields"] = extract_fields(text)
        try:
            mrz_res = parse_mrz(text)
            if mrz_res.get("valid"):
                out["mrz"] = _mrz_public(mrz_res)
                # Enrich fields with verified MRZ data
                if mrz_res.get("passport_number") and not out["fields"].get("passport"):
                    out["fields"]["passport"] = mrz_res["passport_number"]
                if mrz_res.get("dob") and not out["fields"].get("dob"):
                    out["fields"]["dob"] = mrz_res["dob"]
                if mrz_res.get("expiry") and not out["fields"].get("expiry"):
                    out["fields"]["expiry"] = mrz_res["expiry"]
                mrz_full_name = f"{mrz_res.get('surname', '')} {mrz_res.get('given_names', '')}".strip()
                if mrz_full_name and not out["fields"].get("mrz_name"):
                    out["fields"]["mrz_name"] = mrz_full_name
                out["fields"]["mrz_valid"] = True
        except Exception:
            out["mrz"] = None

    # LLM Structured Extraction pass
    llm_res = extract_document_data(data)
    out["llm_extraction"] = {"ran": llm_res.get("ran", False), "reason": llm_res.get("reason", "unknown")}
    if llm_res.get("ran") and llm_res.get("fields"):
        # Merge LLM extracted fields into out["fields"] where gaps exist
        for k, v in llm_res["fields"].items():
            if v and not out["fields"].get(k):
                out["fields"][k] = v

    return out


def _mrz_public(res: dict) -> dict:
    """Slim MRZ result for the report: format + check-digit outcome + masked
    identifiers. Never the raw MRZ lines (zero-storage rule)."""
    from screening import mask
    checks = res.get("checks") or {}
    pub = {
        "format": res.get("format"),
        "valid": bool(res.get("valid")),
        "document_ck": _check_ok(checks.get("document_number")),
        "dob_ck": _check_ok(checks.get("dob")),
        "expiry_ck": _check_ok(checks.get("expiry")),
        "composite_ck": _check_ok(checks.get("composite")),
    }
    pno = res.get("passport_number")
    if pno:
        pub["passport"] = mask(pno)
    return pub


def _check_ok(ck):
    return ck.get("ok") if isinstance(ck, dict) else None


# --------------------------------------------------------------------------- #
# Aadhaar domestic-ID pass (Module 1 national-ID route)
# --------------------------------------------------------------------------- #

# 12-digit UIDAI number — spaces or none between the 4/4/4 groups.
_AADHAAR_NO_RE = re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}\b")


def _is_aadhaar(doc_type: str) -> bool:
    return (doc_type or "").strip().lower() in ("aadhaar", "aadhaar_card", "aadhar")


def _extract_aadhaar_image(data: bytes) -> dict:
    """Aadhaar-optimised extraction for image scans.

    The 5-class ONNX detector locates the field zones on the card; each text
    zone (Name / DOB / Aadhaar_No / Gender) is cropped and OCR'd in isolation
    — far more robust than whole-card OCR on dense UV-stamped text — and the
    Photo zone crop is handed to Module 4 for face verification. Fields and
    photos are USED and DISCARDED: nothing persists (zero-storage rule).
    """
    import base64
    from yolo_roi import crop_region_to_bytes, extract_aadhaar_fields

    out = {"fields": {}, "mrz": None,
           "ocr": {"ran": False, "reason": "aadhaar zone OCR not run"},
           "pdf_no_text": False,
           "aadhaar_photo": None,      # b64 PNG crop -> Module 4 (memory only)
           "aadhaar_zones": []}        # zone metadata (label + confidence; no PII)
    boxes = extract_aadhaar_fields(data)
    if not boxes:
        # Model absent (e.g. Vercel) or no zones found: degrade to the generic
        # image pass so Aadhaar still screens with whole-card OCR + LLM heuristics.
        out.update(_extract_image(data))
        return out

    photo_b64 = None
    for b in boxes:
        label = str(b.get("label") or "").strip()
        out["aadhaar_zones"].append(
            {"label": label, "confidence": round(float(b.get("confidence") or 0), 3)})
        crop = crop_region_to_bytes(data, b, padding=0.08)
        if not crop:
            continue
        key = label.lower().replace(" ", "_")
        if key == "photo":
            photo_b64 = base64.b64encode(crop).decode("ascii")
            continue
        text = _zone_ocr(crop)
        if text:
            out["ocr"] = {"ran": True, "engine": "tesseract-aadhaar-zone",
                          "reason": f"zone OCR on {label}"}
            _consume_aadhaar_zone(out["fields"], key, text)
    out["aadhaar_photo"] = photo_b64
    return out


def _zone_ocr(crop_bytes: bytes) -> str:
    """Tesseract over ONE cropped field zone. Same local-only discipline as
    identity.ocr_extract: no cloud OCR, and a hard no-result when tesseract is
    absent (Vercel)."""
    from identity import _ocr_available
    if not _ocr_available():
        return ""
    try:
        import io
        import pytesseract
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(crop_bytes)).convert("L")
        img = ImageOps.autocontrast(img)
        img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
        # Single-line layout (psm 7) fits an isolated field zone best.
        return (pytesseract.image_to_string(img, config="--psm 7") or "").strip()
    except Exception:
        return ""


def _consume_aadhaar_zone(fields: dict, key: str, text: str) -> None:
    """Fold one OCR'd zone into the normalized field map. Garbage yields a gap,
    never a wrong value — downstream validators skip absent fields."""
    from screening import _first_date
    if not text:
        return
    if key == "aadhaar_no":
        m = _AADHAAR_NO_RE.search(text)
        if m and m.group(0).replace(" ", "").replace("-", "")[0] != "0":
            # UIDAI numbers start 2-9; a leading 0 is a misread, not a UID.
            fields["aadhaar"] = re.sub(r"[ -]", "", m.group(0))
    elif key == "dob":
        d = _first_date(text)
        if d:
            fields["dob"] = d
    elif key == "name":
        name = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z .\-]", " ", text)).strip()
        if name:
            fields["name"] = name[:100]
    elif key == "gender":
        g = re.search(r"\b(M|F|MALE|FEMALE)\b", text, re.IGNORECASE)
        if g:
            fields["gender"] = g.group(0).upper()[0]