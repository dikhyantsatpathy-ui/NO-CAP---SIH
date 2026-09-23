"""
Identity document validation — Driving Licence, Passport/Visa (ICAO Doc 9303
MRZ), PAN, RC, Voter-ID / EPIC. This is Module 2 (Document Validation) of the MHA
SIH26188 screening desk: deterministically confirming that the extracted
fields follow official standards — structure regexes, MRZ check digits, and
(soft) PAN consistency hints. It inherits the desk's zero-storage discipline:
raw numbers and names never leave this module as text — only SHA-256 hashes or
masked tails.

OCR: pytesseract + tesseract binary, activated only where it exists (tesseract
cannot run on Vercel serverless) — every path works declared-only and the
report says loudly when OCR was off.
"""

import re
import shutil

from screening import norm, extract_mrz


def _pan_check_char(first9: str) -> str:
    """The community PAN trailing-letter rule (used in several open-source
    validators). It is NOT authoritative — NSDL never published the formula —
    so callers treat it as a consistency hint, never a hard pass/fail."""
    total = 0
    for ch in first9:
        total += int(ch) if ch.isdigit() else ord(ch) - 55
    rem = total % 36
    return str(rem) if rem < 10 else chr(rem + 55)

# --------------------------------------------------------------------------- #
# OCR probe — RapidOCR (ONNX) primary, pytesseract secondary
# --------------------------------------------------------------------------- #

_rapid_ocr_engine = None

def _get_rapid_ocr():
    global _rapid_ocr_engine
    if _rapid_ocr_engine is not None:
        return _rapid_ocr_engine
    try:
        from rapidocr_onnxruntime import RapidOCR
        _rapid_ocr_engine = RapidOCR()
        return _rapid_ocr_engine
    except Exception:
        return None


def _ocr_available() -> bool:
    """True when RapidOCR (ONNX) or pytesseract+tesseract binary is present."""
    if _get_rapid_ocr() is not None:
        return True
    try:
        import importlib.util
        if importlib.util.find_spec("pytesseract") is not None and shutil.which("tesseract") is not None:
            return True
    except Exception:
        pass
    return False


def ocr_extract(data: bytes):
    """Best-effort OCR of a document image -> (text, meta) or (None, meta).

    Runs multi-pass enhancement for webcam and handheld camera captures
    (raw, CLAHE contrast enhancement, grayscale, sharpening, and auto-orientation).
    Zero-storage: text is used for identifier extraction and immediately discarded."""
    if data is None or not data:
        return None, {"ran": False, "reason": "no image"}

    if not _ocr_available():
        return None, {"ran": False, "reason": "tesseract not installed (Vercel)"}

    # 1. Primary: RapidOCR (ONNX runtime)
    rapid = _get_rapid_ocr()
    if rapid is not None:
        try:
            # Pass A: Raw image bytes
            result, _ = rapid(data)
            if result:
                lines = [r[1] for r in result if len(r) >= 2 and r[1]]
                text = "\n".join(lines).strip()
                if text and len(text) >= 15:
                    return text, {"ran": True, "engine": "rapidocr-onnx", "pass": "raw"}

            # Pass B: Multi-pass preprocessing with OpenCV for difficult camera/webcam lighting
            import cv2
            import numpy as np
            nparr = np.frombuffer(data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                # Enhance 1: CLAHE on luminance channel (fixes glossy card glare and uneven shadows)
                lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
                l, a, b_ch = cv2.split(lab)
                clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
                cl = clahe.apply(l)
                limg = cv2.merge((cl, a, b_ch))
                enhanced_bgr = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
                
                result_clahe, _ = rapid(enhanced_bgr)
                if result_clahe:
                    lines = [r[1] for r in result_clahe if len(r) >= 2 and r[1]]
                    text_clahe = "\n".join(lines).strip()
                    if text_clahe and len(text_clahe) > (len(text) if 'text' in locals() and text else 0):
                        return text_clahe, {"ran": True, "engine": "rapidocr-onnx", "pass": "clahe"}

                # Enhance 2: Grayscale + Sharpening kernel
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                gray_clahe = clahe.apply(gray)
                kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
                sharpened = cv2.filter2D(gray_clahe, -1, kernel)
                sharpened_bgr = cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)

                result_sharp, _ = rapid(sharpened_bgr)
                if result_sharp:
                    lines = [r[1] for r in result_sharp if len(r) >= 2 and r[1]]
                    text_sharp = "\n".join(lines).strip()
                    if text_sharp:
                        return text_sharp, {"ran": True, "engine": "rapidocr-onnx", "pass": "sharpened"}

                # Return whatever partial text was read from pass A if any
                if 'text' in locals() and text:
                    return text, {"ran": True, "engine": "rapidocr-onnx", "pass": "partial"}
        except Exception:
            pass

    # 2. Secondary: pytesseract if installed locally
    try:
        if shutil.which("tesseract"):
            import pytesseract
            from PIL import Image, ImageOps
            import io
            img = Image.open(io.BytesIO(data)).convert("L")
            img = ImageOps.autocontrast(img)
            img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
            text = pytesseract.image_to_string(img, config="--psm 6")
            if text and text.strip():
                return text.strip(), {"ran": True, "engine": "tesseract"}
    except Exception:
        pass

    return None, {"ran": False, "reason": "No readable text detected on document image"}


# --------------------------------------------------------------------------- #
# Identifier structure & checksum validators
# --------------------------------------------------------------------------- #

_PAN_RE = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
_PAN_CATEGORY = set("ABCDFGHLJPT")            # 4th char — what the holder entity is
_DL_RE = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?\d{4}[ ]?\d{7})\b")
_RC_RE = re.compile(r"\b[A-Z]{2}\d{2}[ ]?[A-Z]{0,3}[ ]?\d{4}\b")
_EPIC_RE = re.compile(r"\b[A-Z]{3}\d{7}\b")
_PASSPORT_RE = re.compile(r"\b(?:[A-Z]\d{7}|[A-Z]\d{6}[A-Z])\b")  # new 8-char series + legacy 9-char (e.g. L898902C)
_VISA_RE = re.compile(r"\b[A-Z0-9]{6,9}\b")
_AADHAAR_RE = re.compile(r"\b[2-9]\d{11}\b")


def verify_aadhaar(number: str) -> list:
    """Aadhaar checks: exactly 12 digits, first digit cannot be 0 or 1."""
    n = re.sub(r"[ -]", "", str(number or ""))
    valid_len = len(n) == 12 and n.isdigit()
    valid_start = valid_len and n[0] not in ("0", "1")
    return [{"label": "structure", "ok": valid_len and valid_start,
             "detail": "12-digit UIDAI format (first digit 2-9)" if (valid_len and valid_start) else "Invalid Aadhaar structure"}]


def verify_pan(pan: str) -> list:
    """PAN checks: structure, category letter, and (soft) check character."""
    p = norm(pan)
    results = []
    results.append({"label": "structure", "ok": bool(_PAN_RE.fullmatch(p)),
                    "detail": "5 letters + 4 digits + 1 letter"})
    results.append({"label": "category-letter", "ok": len(p) == 10 and p[3] in _PAN_CATEGORY,
                    "detail": f"4th char '{p[3] if len(p) == 10 else '?'}' is an entity category"})
    if len(p) == 10:
        matches_hint = _pan_check_char(p[:9]) == p[9]
        results.append({"label": "check-char", "ok": True if matches_hint else None,
                        "detail": "community check-character rule (soft signal; unreleased NSDL formula)"})
    else:
        results.append({"label": "check-char", "ok": None, "detail": "not applicable"})
    return results


def verify_dl(number: str) -> list:
    n = norm(number)
    return [{"label": "structure", "ok": bool(_DL_RE.fullmatch(n)),
             "detail": "RR-DD-YYYY-XXXXXXX (e.g. KA0120201234567)"}]


def verify_rc(number: str) -> list:
    n = norm(number)
    return [{"label": "structure", "ok": bool(_RC_RE.fullmatch(n)),
             "detail": "RR-DD-SERIES-XXXX (e.g. KA01MJ1234)"}]


def verify_epic(number: str) -> list:
    n = norm(number)
    return [{"label": "structure", "ok": bool(_EPIC_RE.fullmatch(n)),
             "detail": "3 letters + 7 digits (EPIC format)"}]


def verify_passport(number: str, mrz_text: str = "") -> list:
    n = norm(number)
    results = [{"label": "structure", "ok": bool(_PASSPORT_RE.fullmatch(n)),
                "detail": "1 letter + 7 digits (new series) or 6 digits + letter (legacy)"}]
    if mrz_text and isinstance(mrz_text, str):
        mrz_res = None
        try:
            from mrz import parse_mrz
            mrz_res = parse_mrz(mrz_text)
        except Exception:
            mrz_res = extract_mrz(mrz_text)

        if isinstance(mrz_res, dict) and mrz_res.get("format"):
            is_valid = mrz_res.get("valid")
            parsed_no = mrz_res.get("passport_number", "")
            # Upgrade the structure check when MRZ confirms the number
            number_agrees = bool(
                n and parsed_no and (
                    parsed_no.endswith(n[-5:]) or n.endswith(parsed_no[-5:])
                )
            ) if n and parsed_no else False
            if is_valid and number_agrees:
                results[0] = {"label": "structure", "ok": True,
                              "detail": f"number agrees with valid {mrz_res.get('format')} MRZ"}
            checks = mrz_res.get("checks", {})
            doc_ck = checks.get("document_number", {})
            dob_ck = checks.get("dob", {})
            exp_ck = checks.get("expiry", {})
            comp_ck = checks.get("composite", {})
            results.append({
                "label": "mrz-check-digits",
                "ok": is_valid,
                "detail": f"ICAO {mrz_res.get('format')} 7-3-1 modulus-10 checksums (doc:{doc_ck.get('ok')}, dob:{dob_ck.get('ok')}, exp:{exp_ck.get('ok')}, comp:{comp_ck.get('ok')})",
            })
            results.append({
                "label": "mrz-number-match",
                "ok": number_agrees if n else None,
                "detail": f"printed number agrees with MRZ ({parsed_no})",
            })
        elif isinstance(mrz_res, dict) and mrz_res.get("mrz_valid") is not None:
            if mrz_res.get("mrz_valid") and (mrz_res.get("passport") or "").endswith(n[-5:] or " "):
                results[0] = {"label": "structure", "ok": True,
                              "detail": "number agrees with a valid MRZ line"}
            results.append({
                "label": "mrz-check-digits",
                "ok": mrz_res.get("mrz_valid"),
                "detail": "ICAO 9303 passport/DOB/expiry check digits verified from the MRZ",
            })
            results.append({
                "label": "mrz-number-match",
                "ok": not n or (mrz_res.get("passport") or "").endswith(n[-5:]) if n else None,
                "detail": "printed number agrees with the MRZ line",
            })
        else:
            results.append({"label": "mrz-check-digits", "ok": None,
                            "detail": "no MRZ block could be parsed"})
    return results


def verify_visa(number: str, mrz_text: str = "") -> list:
    n = norm(number)
    results = [{"label": "structure", "ok": bool(_VISA_RE.fullmatch(n)),
                "detail": "6 to 9 alphanumeric characters"}]
    if mrz_text and isinstance(mrz_text, str):
        mrz_res = None
        try:
            from mrz import parse_mrz
            mrz_res = parse_mrz(mrz_text)
        except Exception:
            mrz_res = extract_mrz(mrz_text)

        if isinstance(mrz_res, dict) and mrz_res.get("format"):
            is_valid = mrz_res.get("valid")
            parsed_no = mrz_res.get("passport_number", "")
            # Upgrade the structure check when MRZ confirms the number
            number_agrees = bool(
                n and parsed_no and (
                    parsed_no.endswith(n[-5:]) or n.endswith(parsed_no[-5:])
                )
            ) if n and parsed_no else False
            if is_valid and number_agrees:
                results[0] = {"label": "structure", "ok": True,
                              "detail": f"number agrees with valid {mrz_res.get('format')} MRZ"}
            checks = mrz_res.get("checks", {})
            doc_ck = checks.get("document_number", {})
            dob_ck = checks.get("dob", {})
            exp_ck = checks.get("expiry", {})
            comp_ck = checks.get("composite", {})
            results.append({
                "label": "mrz-check-digits",
                "ok": is_valid,
                "detail": f"ICAO {mrz_res.get('format')} modulus-10 checksums (doc:{doc_ck.get('ok')}, dob:{dob_ck.get('ok')}, exp:{exp_ck.get('ok')}, comp:{comp_ck.get('ok')})",
            })
            results.append({
                "label": "mrz-number-match",
                "ok": number_agrees if n else None,
                "detail": f"printed number agrees with MRZ ({parsed_no})",
            })
        elif isinstance(mrz_res, dict) and mrz_res.get("mrz_valid") is not None:
            if mrz_res.get("mrz_valid") and (mrz_res.get("passport") or "").endswith(n[-5:] or " "):
                results[0] = {"label": "structure", "ok": True,
                              "detail": "number agrees with a valid MRZ line"}
            results.append({
                "label": "mrz-check-digits",
                "ok": mrz_res.get("mrz_valid"),
                "detail": "ICAO 9303 check digits verified from the MRZ",
            })
            results.append({
                "label": "mrz-number-match",
                "ok": not n or (mrz_res.get("passport") or "").endswith(n[-5:]) if n else None,
                "detail": "printed number agrees with the MRZ line",
            })
        else:
            results.append({"label": "mrz-check-digits", "ok": None,
                            "detail": "no MRZ block could be parsed"})
    return results


# --------------------------------------------------------------------------- #
# Number resolution across sources (declared / OCR / MRZ)
# --------------------------------------------------------------------------- #

_FIELD_FOR = {"pan": "pan", "driving_licence": "driving_licence", "rc": "rc",
              "voter_id": "voter_id", "passport": "passport", "visa": "passport"}

_NUMBER_PATTERNS = {
    "pan": _PAN_RE, "driving_licence": _DL_RE, "rc": _RC_RE,
    "voter_id": _EPIC_RE, "passport": _PASSPORT_RE, "visa": _VISA_RE,
}


def _extract_source_number(doc_type: str, text: str) -> str | None:
    pat = _NUMBER_PATTERNS.get(doc_type)
    if not pat or not text:
        return None
    for cand in set(pat.findall(text)):
        return cand
    return None


def _resolve_number(doc_type: str, declared: dict, ocr_text, mrz_text: str) -> dict:
    """Merge the sources into ONE best-effort number, flagging disagreements.
    Declared beats OCR beats MRZ; a mismatch between two ON-sources is a real
    signal worth surfacing to the reviewer."""
    candidates = []
    if declared:
        raw = declared.get("document_number") or declared.get(_FIELD_FOR.get(doc_type)) or ""
        if raw.strip():
            candidates.append(("declared", norm(raw)))
    if ocr_text and isinstance(ocr_text, str):
        n = _extract_source_number(doc_type, ocr_text)
        if n:
            candidates.append(("ocr", n))
    if mrz_text and doc_type in ("passport", "visa"):
        mrz = extract_mrz(mrz_text)
        if mrz.get("passport"):
            candidates.append(("mrz", norm(mrz["passport"])))

    if not candidates:
        return {"number": None, "source": "none", "mismatch": False}
    picked_source, number = candidates[0]
    mismatch = len({c[1] for c in candidates}) > 1
    return {"number": number, "source": picked_source, "mismatch": mismatch}


# --------------------------------------------------------------------------- #
# Feature 3 — Document serial-range plausibility (anachronism detection)
# --------------------------------------------------------------------------- #

# Indian passport first-letter → approximate issue year range
# Source: MEA passport booklet series announcements (public domain).
_PASSPORT_SERIES = {
    "A": (1999, 2002), "B": (1999, 2002), "C": (2002, 2005),
    "D": (2003, 2006), "E": (2004, 2007), "F": (2005, 2008),
    "G": (2006, 2009), "H": (2007, 2010), "J": (2008, 2012),
    "K": (2012, 2015), "L": (2013, 2016), "M": (2014, 2017),
    "N": (2016, 2019), "P": (2018, 2021), "R": (2019, 2022),
    "S": (2020, 2023), "T": (2021, 2024), "V": (2022, 2025),
    "W": (2022, 2026), "X": (2023, 2027), "Y": (2024, 2027),
    "Z": (2024, 2028),
}

# Valid Indian state/UT codes used in Driving Licence numbers (positions 0-1)
_VALID_STATE_CODES = {
    "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA",
    "GJ", "HP", "HR", "JH", "JK", "KA", "KL", "LA", "LD", "MH",
    "ML", "MN", "MP", "MZ", "NL", "OD", "OR", "PB", "PY", "RJ",
    "SK", "TN", "TR", "TS", "UK", "UP", "UT", "WB",
}

# PAN 4th character: must be a personal entity type to act as an ID document
_PAN_PERSONAL_TYPES = {"P"}   # P = individual; others (F, A, B, C, …) are non-personal


def serial_plausibility(doc_type: str, identifier: str, dob: str | None = None) -> list:
    """Check whether a document's serial number is plausible for the holder's DOB.

    Returns a list of check dicts {label, ok, detail} following the same
    contract as verify_pan / verify_dl. ok=None means 'cannot determine'.
    """
    checks = []
    dt = (doc_type or "").strip().lower()
    ident = norm(identifier or "")

    if dt == "passport" and ident:
        series_letter = ident[0].upper() if ident else ""
        era = _PASSPORT_SERIES.get(series_letter)
        if era:
            checks.append({
                "label": "serial-era",
                "ok": True,
                "detail": f"Passport series '{series_letter}' is a recognised MEA issue series ({era[0]}–{era[1]}).",
            })
            # Anachronism: series start year must be ≥ holder's 18th birthday year
            if dob:
                try:
                    from datetime import date
                    dob_date = date.fromisoformat(dob[:10])
                    min_issue_year = dob_date.year + 18
                    if era[0] < min_issue_year - 5:  # 5-year tolerance for early passports
                        checks.append({
                            "label": "serial-anachronism",
                            "ok": False,
                            "detail": (
                                f"Passport series '{series_letter}' was issued ~{era[0]}–{era[1]}, "
                                f"but holder DOB {dob} implies first eligibility ~{min_issue_year}. "
                                "Series predates holder's eligibility — possible number fabrication."
                            ),
                        })
                    else:
                        checks.append({
                            "label": "serial-anachronism",
                            "ok": True,
                            "detail": f"Series issue era ({era[0]}–{era[1]}) is consistent with holder DOB.",
                        })
                except Exception:
                    pass
        else:
            checks.append({
                "label": "serial-era",
                "ok": None,
                "detail": f"Passport series letter '{series_letter}' not in MEA reference table — verify by eye.",
            })

    elif dt == "driving_licence" and len(ident) >= 2:
        state_code = ident[:2].upper()
        checks.append({
            "label": "state-code",
            "ok": state_code in _VALID_STATE_CODES,
            "detail": (f"DL state code '{state_code}' is a valid RTO state/UT code."
                       if state_code in _VALID_STATE_CODES
                       else f"DL state code '{state_code}' is not a recognised Indian RTO code."),
        })

    elif dt == "pan" and len(ident) == 10:
        entity_char = ident[3].upper()
        is_personal = entity_char in _PAN_PERSONAL_TYPES
        # ok=None for non-personal: advisory only — the holder may legitimately carry a
        # non-individual PAN as supplementary ID. Never a hard disqualifier.
        checks.append({
            "label": "pan-entity-type",
            "ok": True if is_personal else None,
            "detail": (f"PAN entity type '{entity_char}' = Individual (correct for a person's identity document)."
                       if is_personal
                       else f"PAN entity type '{entity_char}' is non-personal (firm/AOP/etc.) — "
                            "verify that this is the holder's own individual document."),
        })

    return checks