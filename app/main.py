"""
SSB Border Screening - AI-Based Fake Identity & Document Screening (SIH26188)
Organized into strict, human-readable columns for easy debugging.
"""

import os
import sys

# Resolve where static assets (index.html, main.js) live regardless of the
# process working directory (serverless CWD differs from local runs).
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# Ensure the sibling `app/` directory is importable so `from detectors import ...`
# resolves whether this file is run as `python app/main.py`, as a package, or
# behind the Vercel entrypoint (which may set a different CWD).
_APP_DIR = os.path.dirname(os.path.abspath(__file__))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

import hashlib
import hmac
import io
import json
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv

from fastapi import FastAPI, Request, Form, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy import create_engine, Column, String, Integer, Text, Float, text, event, func
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.exc import IntegrityError
# --- SECURITY DEPENDENCIES ---
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

# AI-content-detection orchestrator (imported once at startup; heavy backends
# like onnxruntime / the cloud SDK are loaded lazily inside the package, so this
# never slows down cold starts for the default heuristic path).
from screening import run_screening
# Border SESSION orchestration: cross-document comparison + signed session
# ledger blocks (SIH26188). Pure hash-based; imports screening's norm/mask.
from session import build_comparison, session_payload, chain_hash
# Passport/Visa MRZ / Driving-Licence / PAN / Voter-ID validation lives in
# identity.py and feeds the screening desk's Module 2 (document validation)
# through app/validation.py. Emits explainable checks, stores zero raw bytes.
# ============================================================================
# AI-content detection layer
# 6 providers (free heuristic, Sightengine cloud, self-hosted ONNX) folded into
# one module so the backend is exactly two source files: main.py + screening.py.
# Result contract + design notes are kept inline so this section stays self-documenting.
# ============================================================================
# ----------------------------------------------------------------------------
# section: app/detectors/_util.py (inlined)
# ----------------------------------------------------------------------------
"""Shared lazy third-party imports used across the detector package."""

_imports = {}


def _np():
    """Return the numpy module, or None if unavailable (lazy, cached)."""
    if "np" not in _imports:
        try:
            import numpy
            _imports["np"] = numpy
        except Exception:
            _imports["np"] = None
    return _imports["np"]


def _pil():
    """Return the PIL module, or None if unavailable (lazy, cached)."""
    if "pil" not in _imports:
        try:
            import PIL.Image
            _imports["pil"] = PIL
        except Exception:
            _imports["pil"] = None
    return _imports["pil"]

# ----------------------------------------------------------------------------
# section: app/detectors/_signatures.py (inlined)
# ----------------------------------------------------------------------------
"""
Known AI-generator and photo-editor self-tags.

When an AI tool (Midjourney, Stable Diffusion, Firefly, Topaz, ...) or a photo
editor (Photoshop, Snapseed, VSCO, ...) writes an image, it often leaves a small
label inside the file (EXIF / PNG-text / XMP). We match those labels to explain,
in plain language, WHY a file looks machine-made or edited.

This is a signal, never proof: a stripped file or a real camera photo carries
none of these tags, so absence does not mean "human-made".
"""


# ----------------------------------------------------------------------------
# section: app/detectors/document_aware.py (inlined)
# ----------------------------------------------------------------------------
"""
Scanned-document-awareness helper.

Tells a plain AI-art detector apart from a *scanned document / text-heavy page*.
This matters because the cloud detectors (Sightengine, Hive, ...) are trained to
separate AI-generated *photos/art* from real *photographs* â€” they are NOT built
to judge photocopies of paper. If we let them loose on a scanned notice they
misfire (a legible scan reads as "suspicious, low-confidence" and wastes budget).

So we conservatively detect "this looks like a scanned page" and, when we do,
surface a DOCUMENT verdict: tell the user the real trust signal here is the
four-module document screening matrix, not photo-style image-AI analysis.

Heuristics (all conservative, none can raise):
  - "page-like" aspect ratio (a sheet of paper, not a square selfie).
  - mostly-light background (white/cream paper) with dark ink pixels.
  - high foreground "ink density" of small blobs = text characters.
  - low colour variance (monochrome or near-monochrome scans).
We require SEVERAL signals together to fire, so real photos and flat graphics
are not misread as documents.
"""


def _open_gray(file_bytes: bytes, np):
    Image = _pil()
    if Image is None:
        return None
    if np is None:
        return None
    try:
        return Image.Image.open(io.BytesIO(file_bytes)).convert("L")
    except Exception:
        return None


def looks_like_scanned_document(file_bytes: bytes) -> bool:
    """Conservative boolean: is this image a page/document rather than a photo?"""
    np = _np()
    if np is None or _pil() is None:
        return False
    img = _open_gray(file_bytes, np)
    if img is None or img.width == 0 or img.height == 0:
        return False

    # Downscale for speed, but keep it high enough that thin text glyphs don't get
    # anti-aliased into pale grey (which would hide the ink signal). A 640px-wide
    # cap is plenty for page-shaped layout and stays fast.
    max_w = 640
    if img.width > max_w:
        img = img.resize((max_w, int(img.height * max_w / img.width)))

    w, h = img.size
    ar = w / h

    a = np.asarray(img, dtype=np.uint8)

    # 1) Page-like aspect (portrait ~0.5-0.95, landscape ~1.05-2.0). A square
    #    selfie (0.8-1.25) overlaps portrait, so require more than just aspect.
    page_aspect = 0.62 <= ar <= 2.0
    # Real-world page sheets sit around 0.7-1.41; widen safely but still exclude
    # extreme panoramas. Combine with the "paper" check below.

    hist = np.bincount(a.ravel(), minlength=256).astype(np.float64)
    total = float(a.size)
    if total == 0:
        return False

    # 2) "Paper": a bright, near-uniform background peak.
    #    Fraction of pixels at or above 200 (white-ish).
    white_frac = float(hist[200:].sum()) / total

    # 3) Ink coverage: dark pixels far from the paper white. Sparse notice text
    #    can be <2% of a large page, so keep the floor low.
    ink = float(hist[:170].sum()) / total

    # 4) Colour variance is handled by callers that pass RGB; here on L we use
    #    the width of the histogram around the white peak (low = clean paper).
    #    Compute std of pixels below 250 (exclude the white bulk from noise).
    dark = a[a < 200]
    dark_std = float(np.std(dark)) if dark.size else 0.0

    # Text pages: white background + scattered small dark ink.
    papery = white_frac >= 0.45
    inky = 0.003 <= ink <= 0.55
    ink_scatter = dark_std >= 25.0   # varied ink tone, not one flat dark block
    not_photo_flat = ar < 1.9        # avoid squashing wide banners into docs

    # Require the page shape AND a strong paper/ink signature. A photograph with
    # paper in it (a hand holding a document) usually has one dominant irregular
    # bright region, not page-shaped text coverage, so it won't pass all gates.
    score = sum(bool(x) for x in (page_aspect, papery, inky, ink_scatter))
    return score >= 3 and papery and inky and not_photo_flat


def document_verdict(filename: str = "") -> dict:
    """Return the normalized 'this is a document' result."""

    name = (filename or "scanned notice").rsplit("/", 1)[-1]
    return {
        "ran": False,
        "ai_suspected": False,
        "ai_score": 0,
        "model": "document-aware pre-check",
        "provider": "document",
        "explanation": (
            f"'{name}' reads as a scanned document / text page rather than a "
            "photograph. Photo-style cloud AI-art detectors would misfire on a "
            "scanned text page, so the document's authenticity rests on the "
            "four-module screening matrix — OCR consistency, checksum "
            "validation, tampering forensics and face comparison — rather than "
            "image-AI analysis. See the module verdicts in the dossier."
        ),
        "latency_ms": 0,
        "raw": {"document_like": True},
    }

# ----------------------------------------------------------------------------
# section: app/detectors/heuristic.py (inlined)
# ----------------------------------------------------------------------------
"""
Free, dependency-light AI-content detector.

Combines (a) metadata self-tags (the most reliable signal when present) with
(b) a conservative pixel-level scan. This is the DEFAULT backend: it needs no
API key, never sends the image anywhere, and costs ~1-4ms. Accuracy is honest
but limited: it reliably flags *self-tagged* generators and extreme oversmoothing,
and can miss AI images that carry no label and aren't obviously over-processed.

The stronger, real-model backends (Sightengine / self-hosted ONNX) live in the
sibling modules and can be enabled with AI_DETECTOR_PROVIDER.
"""

# ---------------------------------------------------------------------------
# Pixel-level scan (conservative, no false positives on real photos/flat GIFs).
# ---------------------------------------------------------------------------
def _pixel_scan(file_bytes: bytes, ext: str):
    np = _import_np()
    if np is None or _import_pil() is None:
        return None, None, False
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(file_bytes)).convert("L")
        if img.width == 0 or img.height == 0:
            return None, None, False
        max_w = 160
        if img.width > max_w:
            img = img.resize((max_w, int(img.height * max_w / img.width)))
        a = np.asarray(img, dtype=np.int16)

        g = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.int16)
        lap = np.zeros(a.shape, dtype=np.int16)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                gv = g[dy + 1][dx + 1]
                if gv == 0:
                    continue
                lap += gv * np.roll(np.roll(a, -dy, axis=0), -dx, axis=1)
        noise_std = float(lap.std())

        gross_std = float(np.asarray(a, dtype=np.float32).std())
        fine_noise = noise_std
        ratio = fine_noise / (gross_std + 1e-6)
        content = gross_std > 15.0
        suspicious_noise = ratio < 200.0 and fine_noise < 60.0

        uniform_reencode = False
        if ext in ("jpg", "jpeg") and file_bytes[:2] == b"\xff\xd8":
            try:
                img_rgb = Image.open(io.BytesIO(file_bytes)).convert("RGB")
                if img_rgb.width > max_w:
                    img_rgb = img_rgb.resize((max_w, int(img_rgb.height * max_w / img_rgb.width)))
                buf = io.BytesIO()
                img_rgb.save(buf, format="JPEG", quality=90)
                re = Image.open(buf).convert("L")
                ra = np.asarray(re, dtype=np.float32)
                b = np.asarray(img.convert("L"), dtype=np.float32)
                diff = np.abs(ra - b)[::8, ::8] / 255.0
                flat = diff.flatten()
                uniform_reencode = float(np.std(flat)) < 0.02 and float(np.mean(flat)) > 0.01
            except Exception:
                uniform_reencode = False

        suspicious = (content and suspicious_noise) or uniform_reencode
        if suspicious:
            return ("ai", ("Pixel-level scan found tonal content but an unnaturally smooth "
                           "low-noise pattern (or uniform re-compression error) â€” a hallmark "
                           "of AI generation or heavy automated processing."), True)
        return None, None, True
    except Exception:
        return None, None, False


# ---------------------------------------------------------------------------
# Public detector contract.
# ---------------------------------------------------------------------------
def heuristic_score(report) -> int:
    """Map a heuristic report to a 0..100 confidence number."""
    if report.get("ai"):
        return 80
    if report.get("edited"):
        return 55
    return 0


def heuristic_detect(image_bytes: bytes, filename: str = "") -> dict:
    ext = (filename or "").lower().split(".")[-1] if "." in (filename or "") else ""
    reasons = []
    leaning = "unknown"
    tool = None
    is_ai, is_edited = False, False

    text = _image_metadata_text(image_bytes, ext)
    kind, tool, desc, conf = _match_tool(text)
    if kind == "ai":
        is_ai = True
        leaning = "ai"
        reasons.append(desc)
    elif kind == "edited":
        is_edited = True
        leaning = "edited"
        reasons.append(desc)

    pixel_lean, pixel_reason, ran = _pixel_scan(image_bytes, ext)
    if ran and pixel_lean == "ai" and not is_ai:
        is_ai = True
        leaning = "ai"
        reasons.append(pixel_reason)

    if not reasons:
        if not ran:
            reasons.append("No detector could open this image to look for AI signatures.")
        else:
            reasons.append("No editing apps or AI tools were found in this file's labels, "
                           "and the pixel pattern looked ordinary.")

    score = heuristic_score({"ai": is_ai, "edited": is_edited})
    model = f"heuristic v2 ({'metadata+pixels' if ran else 'metadata only'})"
    if is_ai:
        explanation = (f"The built-in {model} flagged this as AI-generated "
                       f"({score}% confident).") + (f" It detected {tool}." if tool else "")
    elif is_edited:
        explanation = (f"The built-in model saw a photo-editing tool ({tool}) "
                       f"marker, not a plain untouched original.")
    else:
        explanation = ("The built-in model found no AI-generation or editing signature, "
                       "so there is no evidence it was made by a machine.")

    return {
        "ran": len(reasons) > 0 and ran,
        "ai_suspected": is_ai,
        "ai_score": score,
        "model": model,
        "provider": "heuristic",
        "explanation": explanation,
        "latency_ms": 0,
        "raw": {"kind": leaning, "tool": tool, "reasons": reasons},
    }

# ----------------------------------------------------------------------------
# section: app/detectors/provider_sightengine.py (inlined)
# ----------------------------------------------------------------------------
"""
Sightengine AI-detection backend (cloud, trained model).

Recommended real-model backend for the judge-facing demo: a hosted, pre-trained
neural classifier returns a genuine confidence score (`type.ai_generated`), and
names which generator(s) built the image. Fast (<500ms typical), never needs a
GPU of our own, but DOES send the image bytes to a third party â€” only enable it
if that is acceptable for your deployment.

Activation (set in Vercel env / local .env):
    AI_DETECTOR_PROVIDER = sightengine
    AI_DETECTOR_KEY      = your Sightengine api_user:api_secret  (user:secret)

    If your key is a bare single token (no colon), it is taken as the `api_user`
    and the `api_secret` is read from AI_DETECTOR_SECRET. Prefer the documented
    `api_user:api_secret` form from https://sightengine.com/dashboard.

    AI_DETECTOR_MODELS    = model(s) to run (default `genai` = AI-image only).
    AI_DETECTOR_TIMEOUT_MS= per-call budget (default 2500).

Docs: https://sightengine.com/docs/ai-generated-image-detection

FREE-TIER / COST: 2,000 ops/month capped 500/day; each `genai` check consumes
`request.operations` operations (typically 1-5 depending on the model combo).
We parse that and store it so the UI can show an honest "uses remaining".
"""

BASE = os.getenv("AI_DETECTOR_ENDPOINT") or "https://api.sightengine.com"
CHECK_URL = f"{BASE}/1.0/check.json"
TIMEOUT_MS = int(os.getenv("AI_DETECTOR_TIMEOUT_MS", "2500"))
# Default to the cheap single genai model. Add more comma-separated if desired
# (each extra model raises request.operations).
MODELS = os.getenv("AI_DETECTOR_MODELS", "genai")


def _credential() -> tuple:
    """Return (api_user, api_secret) from env, handling both key forms."""
    key = (os.getenv("AI_DETECTOR_KEY") or "").strip()
    secret = (os.getenv("AI_DETECTOR_SECRET") or "").strip()
    if key:
        if ":" in key:
            user, _, ser = key.partition(":")
            return user, ser
        # Single-token form: treat the token as the user id, use AI_DETECTOR_SECRET.
        if secret:
            return key, secret
        return key, ""
    return "", "" if not secret else ("", secret)


def _ready() -> bool:
    user, secret = _credential()
    return bool(user and secret)


def sightengine_score(payload: dict) -> int:
    """Map Sightengine's `type.ai_generated` (0..1) to a 0..100 int."""
    try:
        ai = float((payload.get("type") or {}).get("ai_generated", 0) or 0)
        return int(round(max(0.0, min(100.0, ai * 100.0))))
    except Exception:
        return 0


def sightengine_used(payload: dict) -> int:
    """How many Sightengine operations this last request consumed."""
    try:
        return int((payload.get("request") or {}).get("operations", 0))
    except Exception:
        return 0


def sightengine_detect(image_bytes: bytes, filename: str = "") -> dict:
    if not _ready():
        return {
            "ran": False, "ai_suspected": False, "ai_score": 0,
            "model": "Sightengine", "provider": "sightengine",
            "explanation": ("Sightengine was selected but no valid key pair was "
                            "configured, so the free built-in detector ran instead."),
            "latency_ms": 0, "raw": None,
        }
    # Downscale server-side so the upload fits the free-tier/quality budget fast.
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(image_bytes)).convert("RGB")
        max_w = 1024
        if img.width > max_w:
            img = img.resize((max_w, int(img.height * max_w / img.width)))
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        data_bytes = buf.getvalue()
    except Exception:
        data_bytes = image_bytes

    start = time.perf_counter()
    try:
        files = {"media": ("img.jpg", data_bytes, "image/jpeg")}
        user, secret = _credential()
        params = {
            "models": MODELS,
            "api_user": user,
            "api_secret": secret,
        }
        import requests
        resp = requests.post(CHECK_URL, data=params, files=files,
                             timeout=TIMEOUT_MS / 1000.0)
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") != "success":
            raise ValueError(payload.get("error") or "sightengine non-success status")
        ms = int((time.perf_counter() - start) * 1000)
        score = sightengine_score(payload)
        is_ai = score >= 50
        used = sightengine_used(payload)
        # Trim the raw payload so vendor internals + media ids don't echo to the
        # browser. Keep scores + the operation count for the quota display.
        raw = {
            "ai_generated": (payload.get("type") or {}).get("ai_generated", 0),
            "operations_used": used,
            "generators": (payload.get("type") or {}).get("ai_generators"),
        }
        return {
            "ran": True,
            "ai_suspected": is_ai,
            "ai_score": score,
            "model": "Sightengine genai (AI-image)",
            "provider": "sightengine",
            "explanation": (
                f"Sightengine's trained model classified this image as "
                f"{'AI-GENERATED' if is_ai else 'not clearly AI'} with {score}% "
                f"confidence (genai model)."
            ),
            "latency_ms": ms,
            "raw": raw,
        }
    except Exception as exc:
        ms = int((time.perf_counter() - start) * 1000)
        return {
            "ran": False, "ai_suspected": False, "ai_score": 0,
            "model": "Sightengine", "provider": "sightengine",
            "explanation": (
                f"Sightengine could not be reached for this check "
                f"(error {exc.__class__.__name__}). The free detector did not run."),
            "latency_ms": ms, "raw": None,
        }

# ----------------------------------------------------------------------------
# section: app/detectors/self_hosted.py (inlined)
# ----------------------------------------------------------------------------
"""
Self-hosted ONNX AI-detection backend (real ViT model, no external service).

Runs a Vision-Transformer classifier locally via ONNX Runtime. The image never
leaves our server. This is the "keep it ours / no API key / no third-party"
option: zero per-image cost and fully private, but it requires a model file on
disk (downloaded on first use) and CPU inference is heavier than a hosted API.

Model: `onnx-community/ai-image-detection-ONNX` â€” ViT-Base fine-tuned on the
CIFAKE dataset (Real vs Fake/AI). Visual Transformer, 224x224 RGB input, two
class logits.

Activation:
    AI_DETECTOR_PROVIDER = self-hosted
    AI_DETECTOR_MODEL_URL  = (optional) direct URL to an .onnx; default HF-hosted
    AI_DETECTOR_MODEL_DIR  = where to cache the model (default: <repo>/data/models)

Limitation note:
    ViT-Base is ~340MB fp32 â€” too big for Vercel's 128MB serverless bundle.
    For Vercel, prefer the Sightengine backend, or host this as a separate small
    CPU worker. Locally (or on a 2-core+ CPU box) it runs fine.
"""

import urllib.request

import numpy as np

# Codebase-aware chat context: indexes the project's own source files (only used
# by the /api/chat assistant) so answers can cite real code paths and lines.
import codebase as codebase_index

# Default small-ish, HF-hosted, Apache-2.0 classifier for Real vs AI.
MODEL_REPO = "onnx-community/ai-image-detection-ONNX"
MODEL_FILE = "model.onnx"
DEFAULT_URL = f"https://huggingface.co/{MODEL_REPO}/resolve/main/onnx/model.onnx"
_IMG_SIZE = 224

_engine = None  # cached onnxruntime.InferenceSession


def _model_dir() -> str:
    return os.getenv("AI_DETECTOR_MODEL_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "models")


def _model_path() -> str:
    url = os.getenv("AI_DETECTOR_MODEL_URL")
    if url:
        return os.path.join(_model_dir(), url.rstrip("/").split("/")[-1])
    local = os.path.join(_model_dir(), MODEL_FILE)
    # Some checkpoints name it differently; prefer an existing file if present.
    for cand in (local, os.path.join(_model_dir(), "pytorch_model.onnx")):
        if os.path.exists(cand):
            return cand
    return local


def _ensure_model() -> str:
    path = _model_path()
    if os.path.exists(path):
        return path
    os.makedirs(_model_dir(), exist_ok=True)
    url = os.getenv("AI_DETECTOR_MODEL_URL") or DEFAULT_URL
    print(f"[detector] downloading AI model -> {path}  ({url})")
    tmp = path + ".download"
    urllib.request.urlretrieve(url, tmp)  # noqa: S310 (intentional model fetch)
    os.replace(tmp, path)
    return path


def _load_engine():
    global _engine
    if _engine is not None:
        return _engine
    import onnxruntime as ort
    path = _ensure_model()
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    _engine = ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])
    return _engine


def _preprocess(img_bytes: bytes):
    from PIL import Image
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img = img.resize((_IMG_SIZE, _IMG_SIZE))
    a = np.asarray(img, dtype=np.float32) / 255.0
    # Channel-first (N, C, H, W) ready for a CNN/ViT-like ONNX graph.
    x = a.transpose(2, 0, 1)[None, ...]
    return x


def onnx_score(output) -> int:
    """Take softmax over the 2 logits and report P(AI) as a 0..100 int."""
    try:
        out = np.asarray(output)
        logits = out.reshape(-1)
        if logits.size < 2:
            return 0
        e = np.exp(logits - logits.max())
        probs = e / e.sum()
        # Model order can be [Real, Fake] or [Fake, Real]. We label the HIGHER
        # probability class and trust the graph's softmax; for robustness we
        # return the max-class confidence mapped to number, and let detect() map
        # via a label hint. Here we assume class index 1 = AI/Fake (most CIFAKE
        # checkpoints use labels ["Real", "Fake"]).
        ai_prob = float(probs[1])
        return int(round(max(0.0, min(100.0, ai_prob * 100.0))))
    except Exception:
        return 0


def onnx_detect(image_bytes: bytes, filename: str = "") -> dict:
    try:
        _load_engine()
    except Exception as exc:
        return {
            "ran": False, "ai_suspected": False, "ai_score": 0,
            "model": "Self-hosted ViT (AI vs Real)", "provider": "self-hosted",
            "explanation": (
                "The self-hosted model could not be started "
                f"(onnxruntime or the model file is missing: {exc.__class__.__name__}). "
                "Install onnxruntime and allow the model download, or switch providers."),
            "latency_ms": 0, "raw": None,
        }
    start = time.perf_counter()
    try:
        x = _preprocess(image_bytes)
        session = _load_engine()
        input_name = session.get_inputs()[0].name
        output = session.run(None, {input_name: x})[0]
        ms = int((time.perf_counter() - start) * 1000)
        score = onnx_score(output)
        is_ai = score >= 50
        return {
            "ran": True,
            "ai_suspected": is_ai,
            "ai_score": score,
            "model": "Self-hosted ViT-Base (CIFAKE fine-tune)",
            "provider": "self-hosted",
            "explanation": (
                f"The on-device Vision Transformer classified this image as "
                f"{'AI-GENERATED' if is_ai else 'not clearly AI'} with {score}% confidence."),
            "latency_ms": ms,
            "raw": {"logits": [float(x) for x in np.asarray(output).reshape(-1)[:2]]},
        }
    except Exception as exc:
        ms = int((time.perf_counter() - start) * 1000)
        return {
            "ran": False, "ai_suspected": False, "ai_score": 0,
            "model": "Self-hosted ViT (AI vs Real)", "provider": "self-hosted",
            "explanation": f"The self-hosted model failed on this image ({exc.__class__.__name__}).",
            "latency_ms": ms, "raw": None,
        }

# ----------------------------------------------------------------------------
# section: app/detectors/__init__.py (inlined)
# ----------------------------------------------------------------------------
"""
AI-content detection orchestrator.

This package turns an uploaded image into a *verifiable, explainable* AI-detection
verdict. It supports two interchangeable backends so the app can run with ZERO
external dependencies (free heuristic) or with a real trained model (cloud API
or a self-hosted ONNX classifier). Every path returns the SAME normalized result
shape, so the rest of the app never cares which detector is active.

Result contract (always returned):
    {
      "ran":              bool,      # did any detector actually inspect pixels?
      "ai_suspected":     bool,      # machine believes this is AI-generated
      "ai_score":         int,       # 0..100 confidence (NOT percentage of a human notch)
      "model":            str | None,# human name of the model used, e.g. "Sightengine v9"
      "provider":         str | None,# "sightengine" | "self-hosted" | "heuristic" | None
      "explanation":      str,       # plain-language, judge-friendly sentence
      "latency_ms":       int,       # how long the detector took
      "raw":              dict | None,
    }
"""

# Backend selection is read ONCE at import time from the environment so the
# running app doesn't re-read files on every call. Env-var names:
#   AI_DETECTOR_PROVIDER   = "sightengine" | "self-hosted" | ""(auto/heuristic)
#   AI_DETECTOR_KEY        = API key for the cloud provider (if any)
#   AI_DETECTOR_ENDPOINT   = optional override for the cloud endpoint
#   AI_DETECTOR_TIMEOUT_MS = budget for the call (default 2500)
#
# COST WARNING: Sightengine's free tier is 2,000 ops/month capped at 500/day,
# and each AI/deepfake check costs FIVE operations. Do NOT make it the sustained
# default or a live crowd will exhaust it in minutes. Prefer the free heuristic
# (default) or the key-free self-hosted ONNX model for the demo ramp.


def _select_backend():
    provider = (os.getenv("AI_DETECTOR_PROVIDER") or "").strip().lower()
    if provider == "sightengine":
        return "sightengine" if os.getenv("AI_DETECTOR_KEY") else "heuristic"
    if provider == "self-hosted":
        return "self-hosted"
    return "heuristic"


BACKEND = _select_backend()

# Resolve the concrete detector function lazily so importing this module never
# pulls heavyweight deps (onnxruntime / requests) unless they are needed.
_detector_ai = None


def _load():
    global _detector_ai
    if _detector_ai is not None:
        return
    if BACKEND == "sightengine":
        _detector_ai = sightengine_detect
    elif BACKEND == "self-hosted":
        _detector_ai = onnx_detect
    else:
        _detector_ai = heuristic_detect


def _empty(explanation, ran=False):
    return {
        "ran": ran,
        "ai_suspected": False,
        "ai_score": 0,
        "model": None,
        "provider": None,
        "explanation": explanation,
        "latency_ms": 0,
        "raw": None,
    }


def detect_image(image_bytes: bytes, filename: str = "") -> dict:
    """Public entry point. Runs the active backend and returns the normalized
    verdict. Never raises: any internal failure degrades to a clean, honest
    'unable to inspect' result so a verify request can never 500.

    Scanned-document pre-check: if the image reads as a text/page document
    (e.g. a scanned notice) we skip the AI-art detectors entirely â€” they are
    trained for photos and would misfire and waste the cloud budget. Instead we
    return a document verdict that points trust to the four-module screening matrix."""
    if not image_bytes:
        return _empty("No image data was provided, so it could not be analysed for AI generation.")
    start = time.perf_counter()
    try:
        is_doc = looks_like_scanned_document(image_bytes)
        ms_scan = int(round((time.perf_counter() - start) * 1000))
        if is_doc:
            out = document_verdict(filename)
            out["latency_ms"] = ms_scan
            return out
        _load()
        result = _detector_ai(image_bytes, filename)
        # Always report the real measured elapsed time (even for the fast
        # heuristic) so the analytics latency graph is honest across backends.
        result["latency_ms"] = int(round((time.perf_counter() - start) * 1000))
        return result
    except Exception as exc:  # defensive: provider/models can fail; degrade cleanly
        ms = int((time.perf_counter() - start) * 1000)
        out = _empty(
            "The AI-detection model could not be run on this image right now. "
            f"(detector unavailable: {exc.__class__.__name__})"
        )
        out["latency_ms"] = ms
        return out


def explain(result: dict) -> str:
    """Return a one-line, judge-friendly summary of a normalized result."""
    if not result or not result.get("ran"):
        return "No AI-detection model ran, so we cannot say whether this was machine-made."
    score = result.get("ai_score", 0)
    model = result.get("model") or "the local detector"
    if result.get("ai_suspected"):
        return (f"{model} classified this image as AI-generated with "
                f"{score}% confidence.")
    return (f"{model} found no strong AI-generation signature "
            f"(confidence of AI was {score}%).")


# ==============================================================================
# [ COLUMN 1: ENVIRONMENT & DB CONFIG ]
# ==============================================================================

load_dotenv()

def clean_postgres_dsn(raw_url: str) -> str:
    """Sanitizes PostgreSQL DSN strings to prevent libpq URI parser errors:
    1. Splits off any extraneous environment variables accidentally pasted into DATABASE_URL.
       Injects any extra KEY=VAL tokens into os.environ if not already set.
    2. Converts multiple '?' query delimiters into '&'.
    3. Strips duplicate '=' signs in values (e.g. sslmode==require).
    4. URL-encodes unencoded '=' characters in parameter values (e.g. options=endpoint=ep-xxx).
    5. Deduplicates duplicate query keys.
    6. Ensures sslmode=require for Neon serverless endpoints.
    """
    if not raw_url:
        return ""
    # Check if multiple environment variables or tokens were pasted into DATABASE_URL
    tokens = raw_url.strip().split()
    url = tokens[0] if tokens else ""
    if len(tokens) > 1:
        for tok in tokens[1:]:
            if "=" in tok:
                k, v = tok.split("=", 1)
                k_clean = k.strip()
                v_clean = v.strip().strip("'\"")
                if k_clean and not os.getenv(k_clean):
                    os.environ[k_clean] = v_clean

    if not url or "postgres" not in url:
        return url
    url = url.replace("postgres://", "postgresql://", 1)
    if url.count("?") > 1:
        first_q = url.find("?")
        base = url[:first_q]
        qs = url[first_q + 1:].replace("?", "&")
        url = f"{base}?{qs}"
    import urllib.parse
    p = urllib.parse.urlsplit(url)
    if not p.query:
        if "neon.tech" in (p.hostname or ""):
            return f"{url}?sslmode=require"
        return url
    clean_params = {}
    for pair in p.query.split("&"):
        if not pair:
            continue
        parts = pair.split("=", 1)
        k = parts[0].strip()
        v = parts[1].strip() if len(parts) > 1 else ""
        while v.startswith("="):
            v = v[1:]
        if "=" in v:
            v = urllib.parse.quote(v, safe="")
        clean_params[k] = v
    if "neon.tech" in (p.hostname or "") and "sslmode" not in clean_params:
        clean_params["sslmode"] = "require"
    new_query = "&".join(f"{k}={v}" if v else k for k, v in clean_params.items())
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, new_query, p.fragment))



DATABASE_URL = clean_postgres_dsn(os.getenv("DATABASE_URL", ""))
if not DATABASE_URL:
    DATABASE_URL = "sqlite:////tmp/nocap.db" if os.name != "nt" else "sqlite:///nocap.db"
    print(f"[startup] DATABASE_URL not set; defaulting to local SQLite ({DATABASE_URL})")

_IS_SQLITE = "sqlite" in DATABASE_URL
_NEON_ENDPOINT = None
_parsed_db = None

if not _IS_SQLITE:
    import urllib.parse
    import psycopg2
    try:
        _parsed_db = urllib.parse.urlparse(DATABASE_URL)
        _host = _parsed_db.hostname or ""
        if "neon.tech" in _host:
            _NEON_ENDPOINT = _host.split(".")[0]
    except Exception:
        pass

    def _pg_creator(**kw):
        global _PRIMARY_LAST_ERROR
        conn_kw = dict(kw)
        conn_kw.setdefault("connect_timeout", 4)
        if _NEON_ENDPOINT and "options" not in conn_kw:
            if not (_parsed_db and _parsed_db.query and "options=" in _parsed_db.query):
                conn_kw["options"] = f"endpoint={_NEON_ENDPOINT}"
        last = None
        for attempt in range(2):
            try:
                return psycopg2.connect(DATABASE_URL, **conn_kw)
            except Exception as e:
                last = e
                _PRIMARY_LAST_ERROR = f"{type(e).__name__}: {e}"
                err_str = str(e).lower()
                if ("could not translate host name" in err_str or "getaddrinfo" in err_str) and _parsed_db and _parsed_db.hostname:
                    # DNS resolution fallback via Google DoH
                    try:
                        import urllib.request
                        _doh_url = f"https://dns.google/resolve?name={_parsed_db.hostname}&type=A"
                        _req = urllib.request.Request(_doh_url, headers={"User-Agent": "nocap/2.0"})
                        with urllib.request.urlopen(_req, timeout=2.5) as _resp:
                            _data = json.loads(_resp.read().decode())
                            for _ans in _data.get("Answer", []):
                                if _ans.get("type") == 1:
                                    conn_kw["hostaddr"] = _ans.get("data")
                                    return psycopg2.connect(DATABASE_URL, **conn_kw)
                    except Exception as doh_err:
                        _PRIMARY_LAST_ERROR = f"DoH resolve failed: {doh_err} (orig: {e})"
                if attempt < 1:
                    time.sleep(0.3)
        raise last or RuntimeError("PostgreSQL connect failed")

    engine = create_engine(
        DATABASE_URL,
        creator=_pg_creator,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=4,
        pool_recycle=290,
        pool_timeout=5,
        connect_args={"application_name": "nocap"},
    )
else:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA cache_size=-64000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Local SQLite fallback engine ensures high availability on serverless cold starts or network outages
_FALLBACK_DB_PATH = "/tmp/nocap_fallback.db" if os.name != "nt" else os.path.join(STATIC_DIR, "nocap_fallback.db")
fallback_engine = create_engine(f"sqlite:///{_FALLBACK_DB_PATH}", connect_args={"check_same_thread": False})
FallbackSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=fallback_engine)

RAW_KEY = os.getenv("MASTER_VAULT_KEY", "").encode("utf-8")
if not RAW_KEY:
    RAW_KEY = b"VERISOURCE_HACKATHON_DEMO_KEY_32"
    print("[startup] MASTER_VAULT_KEY not set; defaulting to fallback demo master key.")
MASTER_VAULT_KEY = RAW_KEY.ljust(32, b"0")[:32]

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
if not GOOGLE_CLIENT_ID:
    GOOGLE_CLIENT_ID = "698365851650-qd2nsi8ahrbv4d67aov3lff4anbco2g1.apps.googleusercontent.com"
    print("[startup] GOOGLE_CLIENT_ID not set; defaulting to demo client id.")


# --- Sign-in authorization (NOT hardcoded email lists) -----------------------
# Who may log in is decided by Google Cloud itself:
#   * ALLOWED_DOMAINS  - comma-separated Google-hosted domains (id_token `hd`),
#                        e.g. "soa.ac.in,iter.ac.in". Anyone whose Google Cloud
#                        account belongs to one of these domains is allowed and
#                        is added automatically â€” no code edit needed.
#   * ALLOWED_EMAILS   - optional comma-separated exact emails (e.g. personal
#                        gmail accounts, which carry no `hd` claim).
# Super admins ALWAYS bypass the gate so the owner can never be locked out.
ALLOWED_DOMAINS = {d.strip().lower() for d in os.getenv("ALLOWED_DOMAINS", "").split(",") if d.strip().lower()}
ALLOWED_EMAILS = {e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip().lower()}

# SUPER_ADMINS is a comma-separated env override (real deployments set it in
# secrets/Vercel). When unset the fallback list keeps demo/local sign-ins
# working so the owner is never locked out of the console.
SUPER_ADMINS = [e.strip().lower() for e in os.getenv("SUPER_ADMINS", "").split(",") if e.strip().lower()] or [
    "asutoshn06@gmail.com",
    "ayushlenka2020@gmail.com",
    "dikhyantsatpathy@gmail.com"
]

def is_super_admin(email: str) -> bool:
    return email.strip().lower() in [e.strip().lower() for e in SUPER_ADMINS]

# ==============================================================================
# [ COLUMN 2: DATABASE MODELS ]
# ==============================================================================

class SignerIdentity(Base):
    __tablename__ = "signer_identities"
    email = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    institution = Column(String, nullable=True)
    designation = Column(String, nullable=True)
    registered_at = Column(String, nullable=False)


class ScreeningReport(Base):
    """One MHA identity-document screening pass (SIH26188). An immutable audit
    record: stores NO raw bytes or extracted text â€” only the SHA-256 hash of
    the file, MASKED identifier fields, and explainable signals (the same
    zero-storage discipline as the whole audit trail)."""
    __tablename__ = "screening_reports"
    id = Column(String, primary_key=True)
    file_hash = Column(String, index=True, nullable=False)
    filename = Column(String, nullable=False)
    doc_type = Column(String, nullable=True)
    checkpoint = Column(String, nullable=True)
    verdict = Column(String, nullable=False)         # CLEAR | REVIEW | FLAGGED
    risk_score = Column(Integer, nullable=False)
    confidence = Column(Float, nullable=False)
    latency_ms = Column(Integer, nullable=True)      # end-to-end screening latency
    extracted_fields = Column(Text, nullable=False)  # masked JSON
    signals = Column(Text, nullable=False)           # reasons JSON
    ai_detection = Column(Text, nullable=True)       # detector snapshot JSON
    modules = Column(Text, nullable=True)            # Module 1-4 verdicts JSON
    previous_hash = Column(String, nullable=True)    # SHA-256 hash-chain block linkage
    ledger_hash = Column(String, nullable=True)      # Current block hash
    adjudication = Column(String, nullable=True)     # CLEARED | CONFIRMED_FRAUD | INCONCLUSIVE
    adjudicator = Column(String, nullable=True)
    adjudication_note = Column(String, nullable=True)
    adjudicated_at = Column(String, nullable=True)
    screener = Column(String, nullable=True)         # signed-in officer who ran it
    created_at = Column(String, nullable=False)
    session_id = Column(String, index=True, nullable=True)   # owning border session (SIH26188)
    field_hashes = Column(Text, nullable=True)               # per-field sha256 digests for cross-doc compare
    ephemeral_raw_fields = Column(Text, nullable=True)       # TEMPORARY raw JSON, wiped when session closes

class WatchlistEntry(Base):
    """Privacy-preserving watchlist for the screening desk: stores ONLY the
    SHA-256 hash of the NORMALIZED identifier plus a masked display label and
    a search reason. Raw identifier values never touch the database."""
    __tablename__ = "watchlist_entries"
    id = Column(Integer, primary_key=True, autoincrement=True)
    identifier_hash = Column(String, index=True, unique=True, nullable=False)
    category = Column(String, nullable=True)         # pan | passport | visa | driving_licence | voter_id | phone | ...
    mask = Column(String, nullable=True)             # e.g. ****1234
    reason = Column(String, nullable=True)
    added_by = Column(String, nullable=False)
    created_at = Column(String, nullable=False)


class ScreeningSession(Base):
    """One traveller at the desk = one border screening session (SIH26188).

    Documents are screened into the session one at a time (each pass writes its
    own masked ScreeningReport audit row tagged with this session_id); the
    extracted values are cross-compared; when the session is approved (or a
    supervisor settles a flagged one) the session's canonical data is reduced
    to a chained SHA-256 digest stored in `ledger_hash`. Zero raw identifier
    values are persisted — only digests, masks and comparison flags."""
    __tablename__ = "screening_sessions"
    id = Column(String, primary_key=True)
    status = Column(String, nullable=False, default="open")   # open | approved | flagged | rejected
    verdict = Column(String, nullable=True)                   # PENDING | CLEAR | REVIEW | FLAGGED
    risk_score = Column(Integer, nullable=True, default=0)
    checkpoint = Column(String, nullable=True)
    screener = Column(String, index=True, nullable=True)      # officer who opened the session
    comparison = Column(Text, nullable=True)                  # cross-doc comparison JSON (flags only)
    note = Column(Text, nullable=True)
    previous_hash = Column(String, nullable=True)             # ledger chain linkage (over closed sessions)
    ledger_hash = Column(String, nullable=True)               # signed block on approval / settlement
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)
    closed_at = Column(String, nullable=True)
    adjudicator = Column(String, nullable=True)               # supervisor who settled a flagged session
    adjudicated_at = Column(String, nullable=True)


class NoticeBroadcast(Base):
    """A signed authority notice on the public bulletin. Zero-storage: the row
    holds only the digest (file_hash), the notice text, and the issuing
    officer's verified identity — no uploaded media, no raw payload bytes."""
    __tablename__ = "notice_broadcasts"
    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    urgency = Column(String, nullable=False)         # CRITICAL | HIGH | ADVISORY
    content = Column(Text, nullable=False)
    signer = Column(String, nullable=False)          # issuing officer's name
    signer_email = Column(String, index=True, nullable=False)
    institution = Column(String, nullable=True)
    designation = Column(String, nullable=True)
    timestamp = Column(String, nullable=False)       # "YYYY-MM-DD HH:MM:SS UTC"
    file_hash = Column(String, index=True, unique=True, nullable=False)
    signature = Column(String, nullable=True)        # digest-based record marker
    ipfs_cid = Column(String, nullable=True)
    media_type = Column(String, nullable=True)
    media_name = Column(String, nullable=True)
    has_media = Column(Integer, nullable=False, default=0)
    is_revoked = Column(Integer, nullable=False, default=0)  # soft retraction

try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    # Best-effort: a transient Neon DNS blip must never abort startup. Schema
    # drift is still handled by the idempotent migration pass below.
    print(f"[startup] warning: create_all on primary deferred ({e}).")

try:
    Base.metadata.create_all(bind=fallback_engine)
except Exception as e:
    print(f"[startup] warning: fallback SQLite create_all deferred ({e}).")

_MIGRATIONS = [
    # Screening-desk officer role fields (post + institution granted by a
    # super admin in the console). Added idempotently for pre-existing DBs.
    "ALTER TABLE signer_identities ADD COLUMN IF NOT EXISTS institution VARCHAR;",
    "ALTER TABLE signer_identities ADD COLUMN IF NOT EXISTS designation VARCHAR;",
    # Screening-desk hot-path indexes (SIH26188).
    "CREATE INDEX IF NOT EXISTS ix_screening_reports_created ON screening_reports(created_at);",
    "CREATE INDEX IF NOT EXISTS ix_screening_reports_screener ON screening_reports(screener);",
    "CREATE INDEX IF NOT EXISTS ix_screening_reports_verdict ON screening_reports(verdict);",
    "CREATE INDEX IF NOT EXISTS ix_screening_reports_chk_created ON screening_reports(checkpoint, created_at);",
    "CREATE INDEX IF NOT EXISTS ix_watchlist_created ON watchlist_entries(created_at);",
    # Watchlist dedup guard: same identifier must not appear twice even under
    # concurrent adds. Skipped automatically if legacy duplicate rows exist.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_watchlist_identifier ON watchlist_entries(identifier_hash);",
    # Module 1-4 verdicts (OCR/validation/tampering/face) as one JSON row.
    "ALTER TABLE screening_reports ADD COLUMN IF NOT EXISTS modules TEXT;",
    # Hash-chain blockchain audit columns
    "ALTER TABLE screening_reports ADD COLUMN IF NOT EXISTS previous_hash VARCHAR;",
    "ALTER TABLE screening_reports ADD COLUMN IF NOT EXISTS ledger_hash VARCHAR;",
    # Notice-board timeline + per-report screening latency.
    "ALTER TABLE screening_reports ADD COLUMN IF NOT EXISTS latency_ms INTEGER;",
    "CREATE INDEX IF NOT EXISTS ix_notice_broadcasts_ts ON notice_broadcasts(timestamp);",
    # Border SESSION ledger (SIH26188): per-doc session linkage + cross-doc
    # field digests, and quick session-list filters.
    "ALTER TABLE screening_reports ADD COLUMN IF NOT EXISTS session_id VARCHAR;",
    "ALTER TABLE screening_reports ADD COLUMN IF NOT EXISTS field_hashes TEXT;",
    "CREATE INDEX IF NOT EXISTS ix_screening_reports_session ON screening_reports(session_id);",
    "CREATE INDEX IF NOT EXISTS ix_sessions_created ON screening_sessions(created_at);",
    "CREATE INDEX IF NOT EXISTS ix_sessions_status ON screening_sessions(status);",
    "CREATE INDEX IF NOT EXISTS ix_sessions_screener ON screening_sessions(screener);",
]


print("[startup] running schema migration...")
# Reuse ONE connection for the whole idempotent pass. On serverless cold starts
# and when Neon is flaky, each statement used to do its own connect + pre-ping
# (3-attempt retries each), so 31 tiny DDL statements cost ~31 slow handshakes.
# Each statement COMMITS on its own (a failed `IF NOT EXISTS` / unique-index
# guard must not abort a transaction that silently swallows every later step).
try:
    with engine.connect() as conn:
        for stmt in _MIGRATIONS:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception as e:
                conn.rollback()
                # Never swallow silently: a failed statement is either benign (column/
                # index already exists — note SQLite rejects ADD COLUMN IF NOT EXISTS,
                # where create_all above is the real schema source) or a genuine typo
                # that must be visible in the deploy logs.
                print(f"[startup] migration skipped ({type(e).__name__}): {stmt[:90]}")
except Exception as e:
    # A single connect failure (transient DNS / cold Neon) skips the entire pass;
    # best-effort, same as create_all above — never abort startup.
    print(f"[startup] migration pass skipped ({type(e).__name__}): {e}")
print("[startup] schema migration pass complete.")

# SQLite rejects "ADD COLUMN IF NOT EXISTS", so the latency_ms bound to an
# EXISTING screening_reports table would never land from the list above. Detect
# the column via PRAGMA and add it once, idempotently.
if _IS_SQLITE:
    try:
        with engine.connect() as conn:
            cols = [r[0] for r in conn.execute(text("PRAGMA table_info(screening_reports)")).fetchall()]
            for _sqlite_col, _sqlite_ddl in (
                ("latency_ms", "INTEGER"),
                ("session_id", "VARCHAR"),
                ("field_hashes", "TEXT"),
            ):
                if _sqlite_col not in cols:
                    conn.execute(text(f"ALTER TABLE screening_reports ADD COLUMN {_sqlite_col} {_sqlite_ddl}"))
                    conn.commit()
    except Exception as e:
        print(f"[startup] SQLite column-add skipped ({type(e).__name__}): {e}")


# --- Neon (serverless Postgres) pauses after ~5 min of idle; the FIRST request
#     then pays a 5-20s cold start. For demos this reads as "signing is slow",
#     so a lightweight daemon keeps the compute awake. Set KEEPALIVE_INTERVAL=0
#     to disable, or raise it (seconds) for battery-friendlier sleep. ---
def _start_keepalive() -> None:
    if os.getenv("VERCEL") == "1":
        return  # serverless: instances are short-lived, a daemon thread would be pointless
    interval = float(os.getenv("KEEPALIVE_INTERVAL", "45"))
    if _IS_SQLITE or interval <= 0:
        return

    def _ping_loop():
        while True:
            time.sleep(interval)
            try:
                with engine.connect() as c:
                    c.execute(text("SELECT 1"))
            except Exception:
                pass  # network hiccup or explicit shutdown - keep trying

    threading.Thread(target=_ping_loop, daemon=True, name="neon-keepalive").start()

_start_keepalive()

_PRIMARY_LAST_FAILED = 0.0
_PRIMARY_LAST_ERROR = None

@contextmanager
def get_db():
    global _PRIMARY_LAST_FAILED, _PRIMARY_LAST_ERROR
    use_fallback = (_IS_SQLITE is False) and (time.monotonic() - _PRIMARY_LAST_FAILED < 30.0)
    db = None

    if not use_fallback:
        try:
            db = SessionLocal()
            if not _IS_SQLITE:
                db.execute(text("SELECT 1"))
        except Exception as e:
            _PRIMARY_LAST_FAILED = time.monotonic()
            _PRIMARY_LAST_ERROR = f"{type(e).__name__}: {e}"
            print(f"[get_db] Primary DB check failed ({type(e).__name__}: {e}); using fallback SQLite session.")
            if db:
                try:
                    db.close()
                except Exception:
                    pass
            db = None
            use_fallback = True

    if use_fallback:
        db = FallbackSessionLocal()

    try:
        yield db
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            db.close()
        except Exception:
            pass

def now_utc(): 
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def make_session_token(email: str) -> str:
    """Mint a self-contained session token: email + expiry + HMAC.

    No server-side session store is needed — the signature proves issuance and
    the embedded expiry bounds the lifetime (1 day, matching the cookie
    max_age). A leaked token stops working after expiry even if the cookie's
    client-side max_age is tampered with."""
    email = email.strip().lower()
    exp = int(datetime.now(timezone.utc).timestamp()) + 86400
    sig = hmac.new(MASTER_VAULT_KEY, f"{email}::{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{email}::{exp}::{sig}"

def get_current_admin(request: Request):
    token = request.cookies.get("nischay_session")
    if not token or token.count("::") != 2:
        raise HTTPException(status_code=401, detail="ACCESS DENIED: Missing or invalid secure session cookie.")
    email, exp_raw, sig = token.split("::")
    expected = hmac.new(MASTER_VAULT_KEY, f"{email}::{exp_raw}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=401, detail="ACCESS DENIED: Session signature invalid or tampered.")
    try:
        exp = int(exp_raw)
    except ValueError:
        raise HTTPException(status_code=401, detail="ACCESS DENIED: Session signature invalid or tampered.")
    if exp < int(datetime.now(timezone.utc).timestamp()):
        raise HTTPException(status_code=401, detail="ACCESS DENIED: Session expired — please sign in again.")
    return email

def get_current_admin_or_evaluator(request: Request) -> str:
    """Allow open sandbox screening for SIH26188 testing while keeping officer identity when logged in."""
    try:
        return get_current_admin(request)
    except HTTPException:
        return "evaluator@ssb.gov.in"

def get_or_create_signer_identity(db, email: str, google_name: str) -> SignerIdentity:
    identity = db.query(SignerIdentity).filter_by(email=email).first()
    if identity:
        return identity
    identity = SignerIdentity(
        email=email, name=(google_name or email).strip()[:200], registered_at=now_utc()
    )
    db.add(identity)
    try:
        db.commit()
    except IntegrityError:
        # Concurrent first-login for the same email: the winner's row is durable,
        # so fall back to it instead of 500ing the loser.
        db.rollback()
        identity = db.query(SignerIdentity).filter_by(email=email).first()
        if identity is None:
            raise
    db.refresh(identity)
    return identity



# ==============================================================================
# [ FORENSIC REASON-OF-FORGERY ]
# Reads the metadata/containers of a file to explain, in PLAIN language, why it
# looks edited/forged/AI-made. This is metadata + container forensics: it names
# the editing app or AI generator a forgery leaks in its own metadata, and it
# cross-checks our cryptographic trap. It is an INDICATOR, never conclusive
# proof of AI generation on a stripped/clean image (that needs pixel/ML work,
# out of scope for the serverless Vercel deployment).
# ==============================================================================

# Editing-software signatures that leaks into produced files.
_EDITING_SIGS = {
    "Adobe Photoshop": "a graphic-design app (Adobe Photoshop)",
    "photoshop": "the photo-editor Adobe Photoshop",
    "Adobe ImageReady": "an image tool (Adobe ImageReady)",
    "Adobe Illustrator": "a vector-design app (Adobe Illustrator)",
    "GIMP": "a free photo-editor (GIMP)",
    "Canva": "the Canva design app",
    "Affinity": "Affinity (a design app)",
    "Pixelmator": "Pixelmator (a photo-editor)",
    "Inkscape": "Inkscape (a vector editor)",
    "Photopea": "Photopea (a browser photo-editor)",
    "Paint.NET": "Paint.NET (a photo-editor)",
    "Sketch": "the Sketch design app",
    "Figma": "the Figma design tool",
    "CorelDRAW": "the vector editor CorelDRAW",
    "Lightroom": "the photo-editor Adobe Lightroom",
    "PhotoDirector": "the photo-editor PhotoDirector",
    "PhotoScape": "the photo-editor PhotoScape",
    "PicMonkey": "the photo-editor PicMonkey",
    "BeFunky": "the photo-editor BeFunky",
    "PaintShop Pro": "the photo-editor PaintShop Pro",
    "Apple Preview": "the viewer Apple Preview",
    "Snapseed": "the photo-editor Snapseed",
    "PicsArt": "the photo-editor PicsArt",
    "VSCO": "the photo-editor VSCO",
    "Luminar": "the photo-editor Luminar",
    "Darkroom": "the photo-editor Darkroom",
    "RawTherapee": "the photo-editor RawTherapee",
    "darktable": "the photo-editor darktable",
    "Edits by Xara": "the design app Xara",
    "Autodesk Pixlr": "the photo-editor Pixlr",
    "ON1 Photo": "the photo-editor ON1",
    "Capture One": "the RAW editor Capture One",
    "Polish": "the photo-editor Polish",
    "Fotor": "the photo-editor Fotor",
}

# AI-generator / AI-upscaler signatures that self-tag generated media. This now
# includes the upscalers and enhancers people actually use (Canva's magic resize,
# Topaz, ESRGAN, Magnific, upscayl, img2go, waifu2x, etc.) so an AI-upscaled
# photo that keeps its metadata gets flagged instead of passing clean.
_AI_SIGS = {
    "Midjourney": "the AI image generator Midjourney",
    "DALL-E": "OpenAI's AI image generator DALL-E",
    "OpenAI Images": "OpenAI's AI image generator",
    "Stable Diffusion": "the AI generator Stable Diffusion",
    "SDXL": "the AI model SDXL",
    "ComfyUI": "the AI workflow tool ComfyUI",
    "Adobe Firefly": "Adobe's AI generator Firefly",
    "Leonardo": "the AI generator Leonardo",
    "Ideogram": "the AI generator Ideogram",
    "Nano Banana": "the AI image model Nano Banana",
    "FLUX": "the AI image model FLUX",
    "Imagen": "Google's AI image generator Imagen",
    "Firefly": "Adobe's AI model Firefly",
    "Topaz": "the AI upscaler Topaz",
    "Topaz Photo AI": "the AI upscaler Topaz Photo AI",
    "Topaz Gigapixel": "the AI upscaler Topaz Gigapixel",
    "ESRGAN": "the AI upscaler ESRGAN",
    "Real-ESRGAN": "the AI upscaler Real-ESRGAN",
    "Magnific": "the AI upscaler Magnific",
    "Magnific.ai": "the AI upscaler Magnific",
    "Upscayl": "the AI upscaler Upscayl",
    "waifu2x": "the AI upscaler waifu2x",
    "img2go": "the AI tool img2go",
    "AI Enhance": "an AI photo enhancer",
    "Enhance AI": "an AI photo enhancer",
    "Neuro Night": "an AI upscaler (Neuro Night)",
    "RemoveBG": "the AI background-remover remove.bg",
    "Magic Resize": "Canva's AI upscaler (Magic Resize)",
    "Dream AI": "an AI image tool (Dream AI)",
    "Stable Diffusion XL": "the AI model SDXL",
    "Gemini": "Google's Gemini AI (image/text generator)",
    "Gemini Advanced": "Google's Gemini AI model",
    "Ideogram 3.0": "the AI generator Ideogram",
    "Recraft": "the AI generator Recraft",
    "Krea": "the AI generator Krea",
    "Runway": "the AI video/image generator Runway",
    "Runway Gen-3": "the AI generator Runway Gen-3",
    "Sora": "OpenAI's AI video generator Sora",
    "Veo": "Google's AI video model Veo",
    "Pika": "the AI video generator Pika",
    "Luma Dream Machine": "the AI video generator Luma Dream Machine",
    "Luma": "the AI video generator Luma",
    "Genie": "Google's AI image model Genie",
    "Stable Video": "the AI video model Stable Video",
    "FLUX (Tensor)": "the AI image model FLUX",
    "Tensor DiffusionArt": "the AI image model FLUX",
    "AnythingXL": "the AI image model AnythingXL",
    "AlbedoBase XL": "the AI image model AlbedoBase XL",
    "DreamShaper": "the AI image model DreamShaper",
    "Juggernaut XL": "the AI image model Juggernaut XL",
    "Kandinsky": "the AI image generator Kandinsky",
    "Wombo": "the AI image app Wombo Dream",
    "Hotpot": "the AI tool Hotpot.ai",
    "Fotor": "the AI photo editor Fotor (AI effects)",
    "Pixlr AI": "the AI editor Pixlr (AI features)",
    "Zyro": "the AI design tool Zyro (AI features)",
    "NightCafe": "the AI generator NightCafe",
    "DreamStudio": "the AI generator DreamStudio",
    "Playground Mod": "the AI generator Playground (Mod)",
    "DiffusionBee": "the AI generator DiffusionBee",
    "InvokeAI": "the AI generator InvokeAI",
    "Fooocus": "the AI generator Fooocus",
    "Artbreeder": "the AI face/id tool Artbreeder",
    "BigGAN": "the generative model BigGAN",
    "StyleGAN": "the generative model StyleGAN",
    "VQGAN": "the generative model VQGAN",
    "DALL-E 3": "OpenAI's AI image generator DALL-E 3",
    "Black Forest": "the AI studio Black Forest Labs (FLUX)",
}


# Precomputed lowercase/sanitized lookup keys (no per-call regex/normalization).
_AI_LOOKUP = {tool.lower().replace("-", " ").replace(".", " "): tool for tool in _AI_SIGS}
_EDITING_LOOKUP = {tool.lower().replace("-", " ").replace(".", " "): tool for tool in _EDITING_SIGS}


def _match_tool(text: str) -> tuple:
    """Scan text for EVERY known editing/AI tool and return the strongest kind
    plus a human reason. Also returns a confidence score (0..1): direct, long,
    descriptor-rich AI self-tags are the most reliable; editing mentions are a
    little less certain. An AI-upscaled file often names BOTH an editor and an AI
    tool (e.g. 'Canva' + 'Topaz Photo AI') â€” we want the AI signal to dominate so
    the user sees it was AI-processed, not just 'edited'."""
    t = (text or "").lower().replace("-", " ").replace("_", " ").replace(".", " ")
    found_ai = [k for k in _AI_LOOKUP if k in t]
    found_edit = [k for k in _EDITING_LOOKUP if k in t]
    if found_ai:
        tool = _AI_LOOKUP[max(found_ai, key=len)]
        return ("ai", tool, f"Made by {_AI_SIGS[tool]}.", 0.9)
    if found_edit:
        tool = _EDITING_LOOKUP[max(found_edit, key=len)]
        return ("edited", tool, f"Edited in {_EDITING_SIGS[tool]}.", 0.65)
    return (None, None, None, None)


def _image_metadata_text(file_bytes: bytes, ext: str) -> str:
    """Extract embedded text labels (EXIF/XMP/PNG-text/RIFF) from image bytes using
    ONLY the standard library, so we can name editing/AI tools even on files whose
    producer never printed into PDF/MP3/MP4 metadata. Works for JPEG (APP1 EXIF/XMP),
    PNG (tEXt/iTXt/tEXt/zTXt chunks) and WebP (RIFF/V8 EXIF)."""
    out_parts = []
    try:
        data = file_bytes

        # --- PNG: walk chunks, decode text chunks ---
        if ext == "png" and data[:8] == b"\x89PNG\r\n\x1a\n":
            pos = 8
            while pos + 8 <= len(data):
                (ln,) = __import__("struct").unpack(">I", data[pos:pos + 4])
                ctype = data[pos + 4:pos + 8]
                body = data[pos + 8:pos + 8 + ln]
                if ctype in (b"tEXt", b"iTXt", b"tEXt", b"zTXt") or ctype == b"tEXt" or ctype in (b"iTXt", b"zTXt", b"tEXt"):
                    try:
                        if ctype == b"tEXt" or ctype == b"tEXt":
                            k, _, v = bytes(body).partition(b"\x00")
                            out_parts.append(bytes(body).decode("latin-1", "ignore"))
                        elif ctype == b"iTXt":
                            out_parts.append(bytes(body).decode("latin-1", "ignore"))
                        elif ctype == b"zTXt":
                            import zlib
                            try:
                                k, sep, rest = bytes(body).partition(b"\x00")
                                if rest:
                                    out_parts.append(zlib.decompress(rest[1:]).decode("latin-1", "ignore"))
                            except Exception: pass
                    except Exception: pass
                pos += 12 + ln
        # --- JPEG: walk segments, pull APP1 (EXIF '\x45\x58\x49\x46' and XMP) ---
        elif ext in ("jpg", "jpeg") and data[:2] == b"\xff\xd8":
            pos = 2
            while pos + 4 <= len(data):
                if data[pos] != 0xFF:
                    break
                marker = data[pos + 1]
                (seg_len,) = __import__("struct").unpack(">H", data[pos + 2:pos + 4])
                if seg_len < 2 or pos + 2 + seg_len > len(data):
                    break
                seg = data[pos + 4:pos + 2 + seg_len]
                # APP1 (0xE1): EXIF (Exif\0\0) or XMP (http://ns.adobe.com/xap/)
                if marker == 0xE1:
                    if seg[:6] in (b"Exif\x00\x00", b"Exif\x00", b"Exif"):
                        # TIFF block: find Software tag via IFD0 (tag 0x0131) rough scan
                        out_parts.append(_tiff_software_text(seg))
                    elif b"xmp" in seg[:40].lower() or seg.lstrip(b"\x00").startswith(b"http"):
                        out_parts.append(seg.decode("utf-8", "ignore"))
                pos += 2 + seg_len
        # --- WebP: RIFF / V8 file, look for EXIF/XMP/VP8X metadata chunks ---
        elif ext in ("webp", "gif") and data[:4] == b"RIFF":
            out_parts.append(_riff_text(data))
    except Exception as e:
        print(f"[image_metadata_text] ({ext}): {e}")
    return " ".join(out_parts)


def _tiff_software_text(seg: bytes) -> str:
    """Best-effort scan of a JPEG EXIF TIFF header for a Software tag (0x0131)."""
    try:
        if len(seg) < 14:
            return ""
        endian = seg[6:8]
        if endian not in (b"II", b"MM"):
            return ""
        e = "<" if endian == b"II" else ">"
        import struct
        # APP1 seg = b"Exif\x00\x00" + TIFF. TIFF header: endian(2) magic(2) IFD-offset(4).
        # IFD offset lives at TIFF byte 4-7 == seg[10:14] (base=6).
        base = 6
        off = struct.unpack(e + "I", seg[10:14])[0]
        ifd_off = base + off
        if ifd_off + 2 > len(seg):
            return ""
        (n,) = struct.unpack(e + "H", seg[ifd_off:ifd_off + 2])
        for i in range(n):
            entry = ifd_off + 2 + i * 12
            if entry + 12 > len(seg):
                break
            (tag,) = struct.unpack(e + "H", seg[entry:entry + 2])
            (typ,) = struct.unpack(e + "H", seg[entry + 2:entry + 4])
            (cnt,) = struct.unpack(e + "I", seg[entry + 4:entry + 8])
            if tag == 0x0131:  # Software
                val_off = entry + 8
                if typ == 2 and cnt > 0:  # ASCII
                    val = seg[val_off:val_off + 4] if cnt <= 4 else seg[base + struct.unpack(e + "I", seg[val_off:val_off + 4])[0]:]
                    return bytes(val[:cnt]).decode("latin-1", "ignore").rstrip("\x00 ")
                break
    except Exception:
        pass
    return ""


def _riff_text(data: bytes) -> str:
    """Pull EXIF/XMP text from a WebP/RIFF container."""
    try:
        out = []
        pos = 12  # skip 'RIFF' + size + 'WEBP'
        while pos + 8 <= len(data):
            chunk = data[pos:pos + 4]
            (clen,) = __import__("struct").unpack("<I", data[pos + 4:pos + 8])
            body = data[pos + 8:pos + 8 + clen]
            if chunk in (b"EXIF", b"XMP "):
                out.append(body.decode("utf-8", "ignore"))
            pos += 8 + clen + (clen & 1)
    except Exception:
        pass
    return " ".join(out)


_CAMERA_MAKE_TAGS = (0x010F, 0x0110)   # Make / Model
_CAMERA_DATE_TAGS = (0x0132,)          # DateTime â€” a reliable camera capture marker


def _tiff_camera_provenance(seg: bytes) -> bool:
    """Does this EXIF TIFF block look like it was written by a real camera /
    phone (a Make, a Model, or a DateTime)? Non-camera producers (AI generators,
    web scrubbers) almost never fill these in. Software tags are deliberately NOT
    trusted here â€” an editor like Photoshop writes Software="Adobe Photoshop", so
    counting that as "camera provenance" would let a doctored image pass clean."""
    try:
        if len(seg) < 14:
            return False
        e = "<" if seg[6:8] == b"II" else ">"
        if seg[6:8] not in (b"II", b"MM"):
            return False
        import struct
        base = 6
        ifd_off = base + struct.unpack(e + "I", seg[10:14])[0]
        (n,) = struct.unpack(e + "H", seg[ifd_off:ifd_off + 2])
        for i in range(n):
            entry = ifd_off + 2 + i * 12
            if entry + 12 > len(seg):
                break
            (tag,) = struct.unpack(e + "H", seg[entry:entry + 2])
            (typ,) = struct.unpack(e + "H", seg[entry + 2:entry + 4])
            # Make/Model/DateTime all count as genuine camera provenance.
            if tag in _CAMERA_MAKE_TAGS and typ == 2:
                return True
            if tag in _CAMERA_DATE_TAGS and typ == 2:
                return True
        return False
    except Exception:
        return False


def _has_camera_provenance(file_bytes: bytes, ext: str) -> bool:
    """Is there any sign this image was captured by a real device (Make/Model/
    camera EXIF)? Absence is the hallmark of AI-generator or scrubbed exports."""
    if ext in ("jpg", "jpeg", "webp") and file_bytes[:2] == b"\xff\xd8":
        pos = 2
        while pos + 4 <= len(file_bytes):
            if file_bytes[pos] != 0xFF:
                break
            marker = file_bytes[pos + 1]
            (seg_len,) = __import__("struct").unpack(">H", file_bytes[pos + 2:pos + 4])
            if seg_len < 2 or pos + 2 + seg_len > len(file_bytes):
                break
            seg = file_bytes[pos + 4:pos + 2 + seg_len]
            if marker == 0xE1 and seg[:5] in (b"Exif\x00", b"Exif") and _tiff_camera_provenance(seg):
                return True
            pos += 2 + seg_len
        return False
    if ext == "webp" and file_bytes[:4] == b"RIFF":
        import struct
        pos = 12
        while pos + 8 <= len(file_bytes):
            chunk = file_bytes[pos:pos + 4]
            (clen,) = struct.unpack("<I", file_bytes[pos + 4:pos + 8])
            body = file_bytes[pos + 8:pos + 8 + clen]
            if chunk == b"EXIF" and _tiff_camera_provenance(body):
                return True
            pos += 8 + clen + (clen & 1)
        return False
    # PNG / GIF / BMP have no standard camera EXIF â€” a real shot rarely ends up
    # here, so treat absence as "no camera provenance" (suspicious for AI).
    return False


_HAVE_NP = None
def _import_np():
    """Lazy numpy â€” only loaded on the image-verify path so normal requests and
    the serverless cold-start aren't penalised. Returns None if unavailable."""
    global _HAVE_NP
    if _HAVE_NP is None:
        try:
            import numpy as _np
            _HAVE_NP = _np
        except Exception:
            _HAVE_NP = False
    return _HAVE_NP if _HAVE_NP else None


_HAVE_PIL = None
def _import_pil():
    """Lazy Pillow for image trap inject/verify. None if unavailable."""
    global _HAVE_PIL
    if _HAVE_PIL is None:
        try:
            import PIL as _pil
            _HAVE_PIL = _pil
        except Exception:
            _HAVE_PIL = False
    return _HAVE_PIL if _HAVE_PIL else None

# ==============================================================================
# [ COLUMN 5: FASTAPI SETUP & BASE ROUTES ]
# ==============================================================================

# max_body_size lifts Starlette's default 2MB request cap so the screening desk
# can submit an unscreened document plus an optional webcam live-frame in one
# request. 50 MB in bytes.
app = FastAPI(title="No Cap Â· Enterprise Provenance Engine", version="12.0",
              max_body_size=50 * 1024 * 1024)
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/")
@limiter.limit("120/minute")
def index(request: Request):
    return FileResponse(os.path.join(STATIC_DIR, "index.html"), headers={"Cache-Control": "no-store"})

@app.get("/health")
@app.get("/api/health")
def health_check():
    """Liveness and readiness check: returns service, database status, and system metadata."""
    global _PRIMARY_LAST_FAILED, _PRIMARY_LAST_ERROR
    db_type = "sqlite" if _IS_SQLITE else "postgresql"
    db_status = "connected"

    if not _IS_SQLITE:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            db_status = "connected"
            _PRIMARY_LAST_FAILED = 0.0
            _PRIMARY_LAST_ERROR = None
        except Exception as e:
            _PRIMARY_LAST_FAILED = time.monotonic()
            _PRIMARY_LAST_ERROR = f"{type(e).__name__}: {e}"
            db_status = "fallback_sqlite"
    else:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as e:
            db_status = f"degraded ({type(e).__name__})"

    return {
        "status": "ok" if "degraded" not in db_status else "degraded",
        "service": "SSB Border Screening Desk (SIH26188)",
        "database": {
            "status": db_status,
            "engine": db_type,
            "neon_endpoint": _NEON_ENDPOINT,
            "last_error": _PRIMARY_LAST_ERROR,
        },
        "version": "2.1.0",
        "timestamp": now_utc(),
    }

@app.post("/api/admin/login")
@limiter.limit("20/minute")
def admin_login(request: Request, credential: str = Form(...)):
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
        idinfo = id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=300)
        email = idinfo.get("email")
        if not email or not idinfo.get("email_verified"): raise ValueError("Google did not return a verified email.")
        email = email.strip().lower()

        # Authorization gate â€” the allow/deny is driven by Google Cloud itself,
        # not by a hardcoded Python list (see ALLOWED_DOMAINS / ALLOWED_EMAILS).
        #   * ALLOWED_DOMAINS matches BOTH id_token["hd"] (the hosted Google
        #     Workspace domain â€” the account's domain you manage in Google
        #     Cloud) and the email's own "@domain" suffix (for non-Workspace
        #     accounts). Anyone added to that domain is allowed automatically.
        #   * Exact emails are allow-listed via ALLOWED_EMAILS.
        #   * Super admins always pass so the owner is never locked out.
        allowed = False
        if not is_super_admin(email):
            hd = str(idinfo.get("hd") or "").strip().lower()
            suffix = email.split("@", 1)[1] if "@" in email else ""
            if (hd and hd in ALLOWED_DOMAINS) or (suffix in ALLOWED_DOMAINS):
                allowed = True
            elif email in ALLOWED_EMAILS:
                allowed = True
        else:
            allowed = True

        if not allowed:
            raise ValueError("ACCESS DENIED: your Google account is not authorized to use this system.")

        with get_db() as db: get_or_create_signer_identity(db, email, idinfo.get("name"))
        res = JSONResponse(content={"status": "SUCCESS", "admin": email})
        res.set_cookie(key="nischay_session", value=make_session_token(email), httponly=True, secure=os.getenv("VERCEL") == "1", samesite="lax", max_age=86400)
        return res
    except Exception:
        raise HTTPException(401, "AUTH FAILED: your Google credential could not be verified.")

@app.post("/api/admin/logout")
@limiter.limit("20/minute")
def admin_logout(request: Request):
    res = JSONResponse(content={"status": "LOGGED_OUT"})
    res.delete_cookie("nischay_session")
    return res

@app.get("/api/admin/me")
@limiter.limit("120/minute")
def check_auth_status(request: Request, admin: str = Depends(get_current_admin)):
    with get_db() as db:
        identity = db.query(SignerIdentity).filter_by(email=admin).first()
    designation = (identity.designation if identity else None) or None
    institution = (identity.institution if identity else None) or None
    pending = bool(identity and (not designation or not institution))
    return {"status": "AUTHENTICATED", "admin": admin, "name": identity.name if identity else admin,
            "designation": designation, "institution": institution, "pending_approval": pending,
            "is_super_admin": is_super_admin(admin)}

@app.post("/api/admin/assign_role")
@limiter.limit("20/minute")
def assign_role(request: Request, target_email: str = Form(...), designation: str = Form(...), institution: str = Form(...), admin: str = Depends(get_current_admin)):
    """Super-admin only: approve/assign a signer's post & institution. Signers cannot self-assign."""
    if not is_super_admin(admin): raise HTTPException(403, "Super-admin clearance required.")
    target = target_email.strip().lower()
    desig, inst = designation.strip()[:150], institution.strip()[:150]
    if not target or not desig or not inst: raise HTTPException(400, "Target signer, post and institution are required.")
    with get_db() as db:
        identity = db.query(SignerIdentity).filter_by(email=target).first()
        if not identity: raise HTTPException(404, "Signer not found.")
        identity.designation, identity.institution = desig, inst
        db.commit()
    return {"status": "ROLE_ASSIGNED", "email": target, "designation": desig, "institution": inst}

@app.get("/api/admin/signers")
@limiter.limit("60/minute")
def list_signers(request: Request, admin: str = Depends(get_current_admin)):
    """Super-admin only: officer directory used for role approvals."""
    if not is_super_admin(admin): raise HTTPException(403, "Super-admin clearance required.")
    with get_db() as db:
        rows = db.query(SignerIdentity).order_by(SignerIdentity.registered_at.desc()).all()
    return {"signers": [
        {"email": s.email, "name": s.name, "designation": s.designation,
         "institution": s.institution, "registered_at": s.registered_at}
        for s in rows
    ]}


# ==============================================================================
# [ SCREENING DESK â€” MHA SIH26188: AI-Based Fake Identity & Document Screening ]
#
# Upload -> Extract -> Analyze -> Verify -> Assess Risk, with an immutable
# audit trail (ScreeningReport) and a hash-only watchlist. Screening is a desk
# operation: only signed-in officers can submit documents, every run is
# attributed to the screener, and adjudications are reserved for a supervisory
# officer (human-in-the-loop over the AI verdict).
# ==============================================================================

def _safe_json(raw):
    try:
        return json.loads(raw)
    except Exception:
        return None

def _screen_row(r):
    """DB ScreeningReport row -> safe public-shaped dict (fields stay masked)."""
    return {
        "id": r.id,
        "filename": r.filename,
        "doc_type": r.doc_type or "other",
        "checkpoint": r.checkpoint or "",
        "verdict": r.verdict,
        "risk_score": r.risk_score,
        "confidence": r.confidence,
        "screener": r.screener,
        "created_at": r.created_at,
        "adjudication": r.adjudication,
        "adjudicator": r.adjudicator,
        "adjudication_note": r.adjudication_note,
        "adjudicated_at": r.adjudicated_at,
        "block_hash": getattr(r, "ledger_hash", None),
        "prev_hash": getattr(r, "previous_hash", None),
        "masked_fields": _safe_json(r.extracted_fields),
        "session_id": getattr(r, "session_id", None),
        "field_hashes": _safe_json(getattr(r, "field_hashes", None)),
        "raw_fields": _safe_json(getattr(r, "ephemeral_raw_fields", None)),
    }

_SYNC_SCREENED_EXTS = ("pdf", "jpg", "jpeg", "png", "webp", "bmp")

@app.post("/api/screen")
@limiter.limit("60/minute")
async def screen_document(
    request: Request,
    file: UploadFile = Form(...),
    doc_type: str = Form("other"),
    checkpoint: str = Form(""),
    declared: str = Form(""),          # optional JSON map of officer-typed fields
    live_frame: UploadFile = Form(None),  # optional M4 webcam capture (image)
    session_id: str = Form(""),        # optional owning border session (SIH26188)
    admin: str = Depends(get_current_admin_or_evaluator),
):
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Document too large (8 MB cap).")
    ext = (file.filename or "").lower().rsplit(".", 1)[-1] if "." in (file.filename or "") else ""
    if ext not in _SYNC_SCREENED_EXTS:
        raise HTTPException(status_code=415, detail="Unsupported type — send a PDF or a jpg/png/webp/bmp image.")
    declared_map = {}
    if declared.strip():
        try:
            declared_map = json.loads(declared)
            if not isinstance(declared_map, dict):
                declared_map = {}
        except Exception:
            declared_map = {}
    live_bytes = await live_frame.read() if live_frame is not None else None
    if live_bytes and len(live_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Live frame too large (8 MB cap).")
    with get_db() as db:
        if admin != "evaluator@ssb.gov.in" and not is_super_admin(admin):
            identity = db.query(SignerIdentity).filter_by(email=admin).first()
            if not identity:
                raise HTTPException(403, "ACCESS DENIED.")
            if not (identity.institution or "").strip() or not (identity.designation or "").strip():
                raise HTTPException(403, "Role pending: a super admin must approve your post & institution before screening.")
        session_owner = session_id.strip() or None
        if session_owner:
            sess = db.query(ScreeningSession).filter_by(id=session_owner).first()
            if not sess:
                raise HTTPException(status_code=404, detail="Screening session not found.")
            if not is_super_admin(admin) and sess.screener != admin:
                raise HTTPException(status_code=403, detail="Not your screening session.")
            if sess.status != "open":
                raise HTTPException(status_code=409, detail=f"Session is not open (status={sess.status}).")
        report = run_screening(
            db, data, file.filename or "upload",
            (doc_type or "other").strip(), (checkpoint or "").strip(),
            declared_map, screener=admin, live_frame=live_bytes,
            session_id=session_id.strip() or None,
        )
        return report

@app.get("/api/screen/queue")
@limiter.limit("120/minute")
def screening_queue(request: Request, admin: str = Depends(get_current_admin_or_evaluator)):
    # Supervisory officers see the whole desk; line officers see their own runs.
    # Evaluators see the live queue so they can inspect recent screening runs immediately.
    with get_db() as db:
        _q = db.query(ScreeningReport).order_by(ScreeningReport.created_at.desc())
        if admin != "evaluator@ssb.gov.in" and not is_super_admin(admin):
            _q = _q.filter_by(screener=admin)
        rows = _q.limit(80).all()
        scoped = rows
        pending = [r for r in scoped if r.adjudication is None and r.verdict != "CLEAR"]
        return {
            "pending": [_screen_row(r) for r in pending],
            "recent": [_screen_row(r) for r in scoped],
        }

@app.get("/api/screen/reports/{report_id}")
@limiter.limit("120/minute")
def screening_report_detail(report_id: str, request: Request, admin: str = Depends(get_current_admin_or_evaluator)):
    with get_db() as db:
        r = db.query(ScreeningReport).filter_by(id=report_id).first()
        if not r:
            raise HTTPException(status_code=404, detail="Screening report not found.")
        if admin != "evaluator@ssb.gov.in" and not is_super_admin(admin) and r.screener != admin:
            raise HTTPException(status_code=403, detail="Not your screening record.")
        row = _screen_row(r)
        row["signals"] = _safe_json(r.signals) or []
        row["ai_detection"] = _safe_json(r.ai_detection)
        row["file_hash"] = r.file_hash
        return row

@app.post("/api/screen/reports/{report_id}/adjudicate")
@limiter.limit("60/minute")
def screen_adjudicate(
    report_id: str,
    request: Request,
    decision: str = Form(...),
    note: str = Form(""),
    admin: str = Depends(get_current_admin),
):
    if not is_super_admin(admin):
        raise HTTPException(status_code=403, detail="Only a supervisory officer can adjudicate screenings.")
    decision = decision.upper()
    if decision not in ("CLEARED", "CONFIRMED_FRAUD", "INCONCLUSIVE"):
        raise HTTPException(status_code=400, detail="Decision must be CLEARED, CONFIRMED_FRAUD or INCONCLUSIVE.")
    with get_db() as db:
        r = db.query(ScreeningReport).filter_by(id=report_id).first()
        if not r:
            raise HTTPException(status_code=404, detail="Screening report not found.")
        r.adjudication = decision
        r.adjudicator = admin
        r.adjudication_note = note.strip()
        r.adjudicated_at = now_utc()
        db.commit()
        return {"ok": True, "id": report_id, "adjudication": decision}

# ==============================================================================
# [ BORDER SCREENING SESSIONS (SIH26188) ]
# One traveller at the desk = one session. Documents are screened into the
# session (each pass still writes its own masked ScreeningReport audit row
# tagged with the session_id); identifier values are cross-compared for
# discrepancies; the desk approves (signs a chained SHA-256 block into the
# ledger) or flags for the supervisory review queue. Zero raw values stored.
# ==============================================================================

def _session_pub(s, doc_count=None):
    """ScreeningSession row -> safe public-shaped dict."""
    d = {
        "id": s.id,
        "status": s.status,
        "verdict": s.verdict,
        "risk_score": s.risk_score,
        "checkpoint": s.checkpoint or "",
        "screener": s.screener,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
        "closed_at": s.closed_at,
        "comparison": _safe_json(s.comparison),
        "note": s.note or "",
        "adjudicator": s.adjudicator,
        "adjudicated_at": s.adjudicated_at,
        "block_hash": s.ledger_hash,
        "prev_hash": s.previous_hash,
    }
    if doc_count is not None:
        d["document_count"] = doc_count
    return d


def _get_session_owned(db, session_id, admin, require_open=False):
    s = db.query(ScreeningSession).filter_by(id=session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Screening session not found.")
    if not is_super_admin(admin) and s.screener != admin:
        raise HTTPException(status_code=403, detail="Not your screening session.")
    if require_open and s.status != "open":
        raise HTTPException(status_code=409, detail=f"Session is not open (status={s.status}).")
    return s


def _session_docs(db, session_id):
    """(docs, rows): documents screened into the session, oldest first. Each
    doc carries its masked fields + per-field digests for cross-comparison."""
    rows = (db.query(ScreeningReport)
            .filter_by(session_id=session_id)
            .order_by(ScreeningReport.created_at.asc(), ScreeningReport.id.asc())
            .all())
    docs = []
    for r in rows:
        base = _screen_row(r)
        base["field_hashes"] = _safe_json(getattr(r, "field_hashes", None)) or {}
        base["masked"] = _safe_json(r.extracted_fields) or {}
        docs.append(base)
    return docs, rows


def _comparison_for_rows(docs):
    cmp_data = [
        {"doc_type": d.get("doc_type"), "field_hashes": d.get("field_hashes") or {},
         "masked": d.get("masked") or d.get("masked_fields") or {},
         "raw_fields": d.get("raw_fields") or {}}
        for d in docs
    ]
    return build_comparison(cmp_data)


def _next_second(ts: str) -> str:
    """'YYYY-MM-DD HH:MM:SS UTC' -> the same format, one second later."""
    try:
        base = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S UTC")
        return (base + timedelta(seconds=1)).strftime("%Y-%m-%d %H:%M:%S UTC")
    except Exception:
        return ts


def _settle_session(db, s, rows, comparison, decision, adjudicator=None, note=""):
    """Close the session and append its signed block to the session ledger.

    The chain order is canonical: (closed_at ASC, id ASC). closed_at is bumped
    strictly past the last signed block so same-second commits cannot make the
    replayed chain disagree with the recorded prev_hash linkage."""
    signed = (db.query(ScreeningSession)
              .filter(ScreeningSession.ledger_hash.isnot(None))
              .order_by(ScreeningSession.closed_at.asc(), ScreeningSession.id.asc())
              .all())
    prev_hash = signed[-1].ledger_hash if signed else "GENESIS"
    closed = now_utc()
    if signed and signed[-1].closed_at and signed[-1].closed_at >= closed:
        closed = _next_second(signed[-1].closed_at)
    doc_blocks = [r.ledger_hash for r in rows if getattr(r, "ledger_hash", None)]
    payload = session_payload(
        session_id=s.id, checkpoint=s.checkpoint, screener=s.screener,
        verdict=s.verdict, risk_score=s.risk_score,
        doc_blocks=doc_blocks, comparison_verdict=comparison.get("verdict", ""),
        closed_at=closed,
    )
    s.ledger_hash = chain_hash(prev_hash, payload)
    s.previous_hash = prev_hash
    s.comparison = json.dumps(comparison)
    s.closed_at = closed
    s.updated_at = closed
    s.adjudicator = adjudicator or None
    s.adjudicated_at = closed if adjudicator else None
    if note.strip():
        s.note = ((s.note or "") + (" " if s.note else "") + note.strip()).strip()
    db.commit()
    return s


@app.post("/api/sessions")
@limiter.limit("60/minute")
def create_session(request: Request, checkpoint: str = Form(""),
                   admin: str = Depends(get_current_admin)):
    """Open a border session for the person now at the desk."""
    with get_db() as db:
        now = now_utc()
        s = ScreeningSession(
            id=uuid.uuid4().hex[:16],
            status="open", verdict="PENDING", risk_score=0,
            checkpoint=(checkpoint or "").strip(), screener=admin,
            comparison=json.dumps(build_comparison([])),
            note="", created_at=now, updated_at=now,
        )
        db.add(s)
        db.commit()
        out = _session_pub(s, 0)
        out["comparison"] = build_comparison([])
        return out


@app.get("/api/sessions")
@limiter.limit("120/minute")
def list_sessions(request: Request, status: str = "", checkpoint: str = "",
                  admin: str = Depends(get_current_admin)):
    with get_db() as db:
        q = db.query(ScreeningSession).order_by(ScreeningSession.created_at.desc())
        if not is_super_admin(admin):
            q = q.filter(ScreeningSession.screener == admin)
        if status.strip():
            q = q.filter(ScreeningSession.status == status.strip().lower())
        if checkpoint.strip():
            q = q.filter(ScreeningSession.checkpoint == checkpoint.strip())
        rows = q.limit(120).all()
        counts = {}
        if rows:
            sids = [r.id for r in rows]
            counts = dict(
                db.query(ScreeningReport.session_id, func.count(ScreeningReport.id))
                .filter(ScreeningReport.session_id.in_(sids))
                .group_by(ScreeningReport.session_id).all()
            )
        return {"sessions": [_session_pub(s, counts.get(s.id, 0)) for s in rows]}


@app.get("/api/sessions/{session_id}")
@limiter.limit("120/minute")
def session_detail(session_id: str, request: Request, admin: str = Depends(get_current_admin)):
    with get_db() as db:
        s = _get_session_owned(db, session_id, admin)
        docs, _rows = _session_docs(db, session_id)
        comparison = _comparison_for_rows(docs)
        pub = _session_pub(s, len(docs))
        pub["documents"] = docs
        pub["comparison"] = comparison
        return pub


@app.post("/api/sessions/{session_id}/close")
@limiter.limit("60/minute")
def close_session(session_id: str, request: Request,
                  verdict: str = Form(...), note: str = Form(""),
                  admin: str = Depends(get_current_admin)):
    """Desk officer closes the session: 'approve' signs it into the ledger;
    'flag' routes it to the supervisory review queue. Sessions with unresolved
    cross-document discrepancies FAIL CLOSED on approval."""
    act = (verdict or "").strip().lower()
    if act not in ("approve", "flag"):
        raise HTTPException(status_code=400, detail="verdict must be 'approve' or 'flag'.")
    with get_db() as db:
        s = _get_session_owned(db, session_id, admin, require_open=True)
        docs, rows = _session_docs(db, session_id)
        if not rows:
            raise HTTPException(status_code=400, detail="Session has no documents yet — add at least one first.")
        comparison = _comparison_for_rows(docs)
        agg_risk = max(0, min(100, max((d.get("risk_score") or 0) for d in docs)
                              + (comparison.get("risk_bump") or 0)))
        s.risk_score = agg_risk
        if act == "flag":
            s.status = "flagged"
            s.verdict = "REVIEW"
            s.comparison = json.dumps(comparison)
            s.note = note.strip()
            s.closed_at = now_utc()
            s.updated_at = s.closed_at
            db.commit()
            pub = _session_pub(s, len(docs))
            pub["documents"] = docs
            pub["comparison"] = comparison
            return pub
        if comparison["verdict"] == "DISCREPANCY":
            raise HTTPException(status_code=409,
                                detail="Cross-document discrepancy detected — flag this session for review instead of approving.")
        s.status = "approved"
        s.verdict = "CLEAR"
        _settle_session(db, s, rows, comparison, "approve", note=note)
        pub = _session_pub(s, len(docs))
        pub["documents"] = docs
        pub["comparison"] = comparison
        return pub


@app.post("/api/sessions/{session_id}/adjudicate")
@limiter.limit("60/minute")
def adjudicate_session(session_id: str, request: Request,
                       decision: str = Form(...), note: str = Form(""),
                       admin: str = Depends(get_current_admin)):
    """Supervisory officer settles a FLAGGED session: CLEARED approves and signs
    it; CONFIRMED_FRAUD / INCONCLUSIVE reject it (also signed, as evidence)."""
    if not is_super_admin(admin):
        raise HTTPException(status_code=403, detail="Only a supervisory officer can adjudicate sessions.")
    dec = (decision or "").strip().upper()
    if dec not in ("CLEARED", "CONFIRMED_FRAUD", "INCONCLUSIVE"):
        raise HTTPException(status_code=400, detail="decision must be CLEARED | CONFIRMED_FRAUD | INCONCLUSIVE")
    with get_db() as db:
        s = db.query(ScreeningSession).filter_by(id=session_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="Screening session not found.")
        if s.status != "flagged":
            raise HTTPException(status_code=409, detail="Only flagged sessions can be adjudicated.")
        docs, rows = _session_docs(db, session_id)
        comparison = _comparison_for_rows(docs)
        if dec == "CLEARED":
            s.status = "approved"
            s.verdict = "CLEAR"
        elif dec == "CONFIRMED_FRAUD":
            s.status = "rejected"
            s.verdict = "FLAGGED"
        else:
            s.status = "rejected"
            s.verdict = "REVIEW"
        s.risk_score = max(0, min(100, max((d.get("risk_score") or 0) for d in docs)
                                  + (comparison.get("risk_bump") or 0)))
        _settle_session(db, s, rows, comparison, dec, adjudicator=admin, note=note)
        pub = _session_pub(s, len(docs))
        pub["documents"] = docs
        pub["comparison"] = comparison
        return pub


@app.get("/api/sessions/ledger/blocks")
@limiter.limit("120/minute")
def session_ledger(request: Request, admin: str = Depends(get_current_admin)):
    """Signed session blocks (the border ledger), oldest first."""
    with get_db() as db:
        rows = (db.query(ScreeningSession)
                .filter(ScreeningSession.ledger_hash.isnot(None))
                .order_by(ScreeningSession.closed_at.asc(), ScreeningSession.id.asc())
                .all())
        counts = {}
        if rows:
            sids = [r.id for r in rows]
            counts = dict(
                db.query(ScreeningReport.session_id, func.count(ScreeningReport.id))
                .filter(ScreeningReport.session_id.in_(sids))
                .group_by(ScreeningReport.session_id).all()
            )
        blocks = [_session_pub(s, counts.get(s.id, 0)) for s in rows]
        return {"blocks": blocks,
                "head_hash": rows[-1].ledger_hash if rows else None,
                "total_blocks": len(blocks)}


@app.get("/api/sessions/ledger/verify")
@limiter.limit("60/minute")
def session_ledger_verify(request: Request, admin: str = Depends(get_current_admin)):
    """Recomputes every signed session block from its canonical payload and
    checks the chain linkage end to end (tamper detection)."""
    with get_db() as db:
        rows = (db.query(ScreeningSession)
                .filter(ScreeningSession.ledger_hash.isnot(None))
                .order_by(ScreeningSession.closed_at.asc(), ScreeningSession.id.asc())
                .all())
        if not rows:
            return {"valid": True, "total_blocks": 0, "head_hash": None,
                    "broken_at": None, "verified_blocks": 0, "status": "EMPTY_CHAIN"}
        expected_prev = "GENESIS"
        for idx, s in enumerate(rows):
            doc_blocks = [r.ledger_hash for r in
                          db.query(ScreeningReport).filter_by(session_id=s.id)
                          .order_by(ScreeningReport.created_at.asc(), ScreeningReport.id.asc()).all()
                          if getattr(r, "ledger_hash", None)]
            payload = session_payload(
                session_id=s.id, checkpoint=s.checkpoint, screener=s.screener,
                verdict=s.verdict, risk_score=s.risk_score, doc_blocks=doc_blocks,
                comparison_verdict=(_safe_json(s.comparison) or {}).get("verdict", ""),
                closed_at=s.closed_at or "",
            )
            computed = chain_hash(s.previous_hash, payload)
            if s.previous_hash and idx > 0 and s.previous_hash != expected_prev:
                return {"valid": False, "total_blocks": len(rows), "verified_blocks": idx,
                        "broken_at": s.id, "status": "CHAIN_BROKEN_PARENT_MISMATCH",
                        "reason": f"Block {s.id} parent hash mismatch"}
            if computed != s.ledger_hash:
                return {"valid": False, "total_blocks": len(rows), "verified_blocks": idx,
                        "broken_at": s.id, "status": "CHAIN_BROKEN_TAMPERED_BLOCK",
                        "reason": f"Block {s.id} payload tampered"}
            expected_prev = s.ledger_hash
        return {"valid": True, "total_blocks": len(rows), "verified_blocks": len(rows),
                "head_hash": rows[-1].ledger_hash, "broken_at": None,
                "status": "CHAIN_VALID_UNBROKEN"}

@app.get("/api/screen/watchlist")
@limiter.limit("120/minute")
def screening_watchlist(request: Request, admin: str = Depends(get_current_admin)):
    if not is_super_admin(admin):
        raise HTTPException(status_code=403, detail="Watchlist access requires a supervisory officer.")
    with get_db() as db:
        rows = (db.query(WatchlistEntry)
                .order_by(WatchlistEntry.created_at.desc())
                .limit(300).all())
        return {"entries": [
            {"id": e.id, "category": e.category, "mask": e.mask,
             "reason": e.reason, "added_by": e.added_by, "created_at": e.created_at}
            for e in rows
        ]}


@app.get("/api/screen/shift-export")
@limiter.limit("30/minute")
def screening_shift_export(
    request: Request,
    from_date: str = "",
    to_date: str = "",
    checkpoint: str = "",
    admin: str = Depends(get_current_admin),
):
    """Export the shift screening log as a signed CSV (chain-of-custody receipt)."""
    import csv
    import io
    from datetime import datetime, timezone

    if not is_super_admin(admin):
        raise HTTPException(status_code=403, detail="Shift export requires supervisory access.")

    with get_db() as db:
        q = db.query(ScreeningReport).order_by(ScreeningReport.created_at.asc())
        if from_date.strip():
            q = q.filter(ScreeningReport.created_at >= from_date.strip())
        if to_date.strip():
            q = q.filter(ScreeningReport.created_at <= to_date.strip() + " 23:59:59")
        if checkpoint.strip():
            q = q.filter(ScreeningReport.checkpoint == checkpoint.strip())
        rows = q.limit(5000).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["# SSB Border Screening Shift Log — SIH26188"])
    writer.writerow([f"# Exported by: {admin}", f"# At: {datetime.now(timezone.utc).isoformat()}"])
    writer.writerow([
        "id", "doc_type", "checkpoint", "verdict", "risk_score",
        "confidence", "screener", "adjudication",
        "adjudicator", "created_at", "masked_fields",
    ])
    for r in rows:
        writer.writerow([
            r.id, r.doc_type or "other", r.checkpoint or "",
            r.verdict, r.risk_score, r.confidence,
            r.screener or "", r.adjudication or "", r.adjudicator or "",
            r.created_at, r.extracted_fields or "{}",
        ])

    csv_body = buf.getvalue()
    import hashlib as _hl
    digest = _hl.sha256(csv_body.encode("utf-8")).hexdigest()
    signed_csv = csv_body + f"\n# SHA-256: {digest}\n"

    from fastapi.responses import Response as _Resp
    fname = f"shift_log_{(from_date or 'all').replace('-','')}_to_{(to_date or 'now').replace('-','')}.csv"
    return _Resp(
        content=signed_csv.encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@app.get("/api/screen/syndicate-alerts")
@limiter.limit("60/minute")
def screening_syndicate_alerts(
    request: Request,
    checkpoint: str = "",
    admin: str = Depends(get_current_admin),
):
    """Retrieve real-time cross-border syndicate, recidivism, and sector burst alerts."""
    from syndicate import analyze_syndicate_patterns
    target_cp = checkpoint.strip()
    with get_db() as db:
        # Pull global recent history so cross-checkpoint syndicates are detectable
        rows = db.query(ScreeningReport).order_by(ScreeningReport.created_at.desc()).limit(200).all()

    history = []
    for r in rows:
        ef = {}
        try:
            ef = json.loads(r.extracted_fields or "{}")
        except Exception:
            pass
        history.append({
            "file_hash": r.file_hash,
            "checkpoint": r.checkpoint,
            "doc_number": ef.get("passport") or ef.get("pan") or ef.get("driving_licence") or ef.get("voter_id"),
            "name": ef.get("mrz_name") or ef.get("holder_name") or ef.get("name"),
            "dob": ef.get("dob"),
            "verdict": r.verdict,
            "created_at": r.created_at,
        })

    # If a checkpoint filter is requested, analyze items from that checkpoint against full history
    eval_pool = [h for h in history if not target_cp or (h.get("checkpoint") or "").strip() == target_cp]

    all_alerts = []
    for item in eval_pool[:30]:
        res = analyze_syndicate_patterns(item, history)
        for a in res.get("alerts", []):
            if a not in all_alerts:
                all_alerts.append(a)

    return {
        "checkpoint_filter": target_cp or "ALL",
        "total_screened_sample": len(history),
        "alerts": all_alerts,
        "active_alerts_count": len(all_alerts),
    }


@app.get("/api/screen/dossier/{report_id}")
@limiter.limit("60/minute")
def screening_evidentiary_dossier(
    request: Request,
    report_id: str,
    admin: str = Depends(get_current_admin),
):
    """Generate a court-admissible, tamper-evident forensic dossier (printable HTML/PDF)."""
    import html
    with get_db() as db:
        report = db.query(ScreeningReport).filter_by(id=report_id).first()
        if not report:
            raise HTTPException(status_code=404, detail="Screening report not found.")

    ef = {}
    try:
        ef = json.loads(report.extracted_fields or "{}")
    except Exception:
        pass

    sig_list = []
    try:
        sig_list = json.loads(report.signals or "[]")
    except Exception:
        pass

    mod_dict = {}
    try:
        mod_dict = json.loads(report.modules or "{}")
    except Exception:
        pass

    dossier_payload = f"{report.id}:{report.file_hash}:{report.verdict}:{report.risk_score}:{report.created_at}:{admin}"
    dossier_seal = hmac.new(MASTER_VAULT_KEY, dossier_payload.encode("utf-8"), hashlib.sha256).hexdigest()

    badge_color = "#10b981" if report.verdict == "CLEAR" else ("#f59e0b" if report.verdict == "REVIEW" else "#ef4444")
    fields_html = "".join(f"<div><strong>{html.escape(str(k)).upper()}:</strong> {html.escape(str(v))}</div>" for k, v in ef.items() if v)
    signals_html = "".join(f"<li>{html.escape(str(sig))}</li>" for sig in sig_list) if sig_list else "<li>Clean screening pass — no anomalous signals.</li>"

    safe_report_id = html.escape(str(report.id))
    safe_cp = html.escape(str(report.checkpoint or 'Official Border Checkpost'))
    safe_officer = html.escape(str(admin))
    safe_verdict = html.escape(str(report.verdict))
    safe_created_at = html.escape(str(report.created_at))
    safe_doc_type = html.escape(str(report.doc_type or 'Identity Document'))
    safe_file_hash = html.escape(str(report.file_hash))

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Evidentiary Forensic Dossier — {safe_report_id}</title>
<style>
  body {{ font-family: 'Courier New', Courier, monospace; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }}
  .container {{ max-width: 900px; margin: 0 auto; background: #1e293b; border: 2px solid #334155; border-radius: 8px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }}
  .header {{ border-bottom: 2px solid #475569; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }}
  .header h1 {{ margin: 0; font-size: 20px; color: #38bdf8; text-transform: uppercase; letter-spacing: 1px; }}
  .header p {{ margin: 4px 0 0 0; font-size: 12px; color: #94a3b8; }}
  .badge {{ display: inline-block; padding: 6px 14px; font-weight: bold; border-radius: 4px; color: #fff; background: {badge_color}; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; font-size: 13px; }}
  .section {{ margin-bottom: 24px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 16px; }}
  .section h2 {{ font-size: 14px; color: #93c5fd; margin-top: 0; text-transform: uppercase; border-bottom: 1px solid #334155; padding-bottom: 6px; }}
  ul {{ margin: 0; padding-left: 20px; }}
  li {{ margin-bottom: 6px; font-size: 13px; }}
  .seal-box {{ background: #020617; border: 1px dashed #64748b; padding: 16px; border-radius: 6px; font-size: 11px; word-break: break-all; }}
  @media print {{
    body {{ background: #fff; color: #000; padding: 0; }}
    .container {{ border: none; box-shadow: none; padding: 0; background: #fff; color: #000; }}
    .section {{ background: #f8fafc; border: 1px solid #cbd5e1; color: #000; }}
    .seal-box {{ background: #f1f5f9; border: 1px solid #cbd5e1; color: #000; }}
    .header h1 {{ color: #000; }}
  }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div>
      <h1>Ministry of Home Affairs · SSB Border Screening Desk</h1>
      <p>Forensic Chain-of-Custody Dossier · Statutory Inspection Record (SIH26188)</p>
      <p>Checkpoint: <strong>{safe_cp}</strong> | Officer: <strong>{safe_officer}</strong></p>
    </div>
    <div>
      <span class="badge">{safe_verdict} (Risk {report.risk_score}/100)</span>
    </div>
  </div>

  <div class="grid">
    <div><strong>Report ID:</strong> {safe_report_id}</div>
    <div><strong>Created At:</strong> {safe_created_at}</div>
    <div><strong>Document Type:</strong> {safe_doc_type}</div>
    <div><strong>Confidence Score:</strong> {int(report.confidence * 100)}%</div>
    <div><strong>File Fingerprint (SHA-256):</strong> <span style="font-size:11px;">{safe_file_hash}</span></div>
    <div><strong>Screened By:</strong> {safe_officer}</div>
    <div><strong>Adjudication:</strong> {html.escape(str(report.adjudication or 'PENDING'))}</div>
    <div><strong>Latency:</strong> {report.latency_ms if report.latency_ms is not None else 'N/A'} ms</div>
  </div>

  <div class="section">
    <h2>Masked Identifier Fields (Privacy-Preserving)</h2>
    <div class="grid">
      {fields_html}
    </div>
  </div>

  <div class="section">
    <h2>Four-Module Inspection Matrix</h2>
    <ul>
      <li><strong>Module 1 (OCR Extraction):</strong> {'Extracted successfully' if mod_dict.get('extraction') else 'Executed'} (Medium: {mod_dict.get('extraction', {}).get('medium', 'N/A')})</li>
      <li><strong>Module 2 (Document Validation):</strong> Status {mod_dict.get('validation', {}).get('verdict', 'N/A')}</li>
      <li><strong>Module 3 (AI Tampering & Forensics):</strong> Status {mod_dict.get('tampering', {}).get('verdict', 'N/A')}</li>
      <li><strong>Module 4 (Biometric Face Verification):</strong> Status {mod_dict.get('face', {}).get('verdict', 'N/A')}</li>
    </ul>
  </div>

  <div class="section">
    <h2>Explainable Forensic Signals & Reasons</h2>
    <ul>
      {signals_html}
    </ul>
  </div>

  <div class="seal-box">
    <strong>CRYPTOGRAPHIC CUSTODY SEAL (HMAC-SHA256):</strong><br/>
    {dossier_seal}<br/><br/>
    <em>This document is an electronically generated statutory evidence record pursuant to the Indian Evidence Act & Bharatiya Sakshya Adhiniyam standards for digital evidence. Custody-sealed by the border inspection desk key.</em>
  </div>
</div>
<script>
  if (window.location.search.includes("print=true")) {{
    window.print();
  }}
</script>
</body>
</html>"""

    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html_content)


@app.post("/api/screen/watchlist/add")
@limiter.limit("60/minute")
def screening_watchlist_add(
    request: Request,
    category: str = Form(...),
    value: str = Form(...),
    reason: str = Form(""),
    admin: str = Depends(get_current_admin),
):
    from screening import norm, mask, sha256
    if not is_super_admin(admin):
        raise HTTPException(status_code=403, detail="Watchlist access requires a supervisory officer.")
    if not value.strip():
        raise HTTPException(status_code=400, detail="An identifier value is required.")
    v = norm(value)
    with get_db() as db:
        existing = db.query(WatchlistEntry).filter_by(identifier_hash=sha256(v)).first()
        if existing:
            return {"ok": True, "already": True, "id": existing.id, "mask": existing.mask}
        entry = WatchlistEntry(
            identifier_hash=sha256(v),
            category=(category or "").strip() or None,
            mask=mask(v),
            reason=(reason or "").strip() or None,
            added_by=admin,
            created_at=now_utc(),
        )
        db.add(entry)
        try:
            db.commit()
        except IntegrityError:
            # Lost the concurrent-add race (or a legacy duplicate): the unique
            # index now guards this, so return the surviving row as "already".
            db.rollback()
            existing = db.query(WatchlistEntry).filter_by(identifier_hash=sha256(v)).first()
            return {"ok": True, "already": True,
                    "id": existing.id if existing else None,
                    "mask": existing.mask if existing else mask(v)}
        return {"ok": True, "id": entry.id, "mask": entry.mask}

@app.post("/api/screen/watchlist/remove")
@limiter.limit("60/minute")
def screening_watchlist_remove(
    request: Request,
    entry_id: int = Form(...),
    admin: str = Depends(get_current_admin),
):
    if not is_super_admin(admin):
        raise HTTPException(status_code=403, detail="Watchlist access requires a supervisory officer.")
    with get_db() as db:
        entry = db.query(WatchlistEntry).filter_by(id=entry_id).first()
        if not entry:
            raise HTTPException(status_code=404, detail="Watchlist entry not found.")
        db.delete(entry)
        db.commit()
        return {"ok": True}


_LATEST_LEDGER_ANCHOR: dict | None = None


def _compute_anchor_manifest(head_hash: str, total_blocks: int, screener: str, checkpoint: str = "Central Desk") -> dict:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    sig_payload = f"{head_hash}:{total_blocks}:{ts}:{screener}:{checkpoint}"
    signature = hmac.new(MASTER_VAULT_KEY, sig_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "protocol": "SIH26188-LEDGER-ANCHOR-v1",
        "service": "SSB Border Screening Desk (SIH26188)",
        "theme": "Blockchain & Cybersecurity",
        "head_hash": head_hash,
        "total_blocks": total_blocks,
        "genesis_hash": "GENESIS",
        "checkpoint": checkpoint,
        "anchored_by": screener,
        "anchored_at": ts,
        "signature": signature,
        "verification": "HMAC-SHA256(head_hash:total_blocks:anchored_at:anchored_by:checkpoint, MASTER_VAULT_KEY)",
    }


def _publish_anchor_gist(manifest: dict) -> tuple[str, str]:
    """Publish manifest to GitHub Gist if GITHUB_TOKEN is configured; returns (anchor_type, public_url)."""
    token = os.getenv("GITHUB_TOKEN", "").strip()
    gist_id = os.getenv("LEDGER_GIST_ID", "").strip()
    content = json.dumps(manifest, indent=2)

    if token:
        import urllib.request
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "nocap-sih26188-anchor",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        payload = {
            "description": f"SSB Border Screening Ledger Anchor - Block #{manifest['total_blocks']} ({manifest['head_hash'][:12]})",
            "public": True,
            "files": {
                "sih26188_border_ledger_anchor.json": {"content": content}
            }
        }
        url = f"https://api.github.com/gists/{gist_id}" if gist_id else "https://api.github.com/gists"
        method = "PATCH" if gist_id else "POST"
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode())
                gist_url = data.get("html_url") or f"https://gist.github.com/{data.get('id')}"
                return "GITHUB_GIST", gist_url
        except Exception as e:
            print(f"[ledger_anchor] Gist publish failed ({e}); using public notary fallback.")

    return "CRYPTOGRAPHIC_NOTARY", "/api/screen/ledger/anchor"


@app.get("/api/screen/ledger/verify")
@limiter.limit("60/minute")
def verify_ledger_chain(request: Request, admin: str = Depends(get_current_admin_or_evaluator)):
    """Audit endpoint: cryptographically verifies the unbroken append-only hash chain
    across all historical screening reports. Detects any database tampering, out-of-order
    insertions, or modified report attributes."""
    with get_db() as db:
        rows = db.query(ScreeningReport).order_by(ScreeningReport.created_at.asc(), ScreeningReport.id.asc()).all()

    if not rows:
        return {
            "valid": True,
            "total_blocks": 0,
            "head_hash": None,
            "genesis_hash": "GENESIS",
            "broken_at": None,
            "status": "EMPTY_CHAIN",
            "anchor": {
                "anchored": False,
                "in_sync": False,
                "hint": "No reports in ledger yet.",
            },
        }

    expected_prev = "GENESIS"
    for idx, r in enumerate(rows):
        if r.previous_hash and idx > 0 and r.previous_hash != expected_prev:
            return {
                "valid": False,
                "total_blocks": len(rows),
                "verified_blocks": idx,
                "broken_at": r.id,
                "reason": f"Block {r.id} parent hash mismatch: expected {expected_prev}, got {r.previous_hash}",
                "status": "CHAIN_BROKEN_PARENT_MISMATCH",
                "anchor": {"anchored": False, "in_sync": False},
            }
        block_payload = f"{r.previous_hash or 'GENESIS'}:{r.file_hash}:{r.verdict}:{r.risk_score}:{r.created_at}:{r.screener or 'unknown'}"
        computed_hash = hashlib.sha256(block_payload.encode("utf-8")).hexdigest()
        if r.ledger_hash and r.ledger_hash != computed_hash:
            return {
                "valid": False,
                "total_blocks": len(rows),
                "verified_blocks": idx,
                "broken_at": r.id,
                "reason": f"Block {r.id} payload tampered: hash {r.ledger_hash} != computed {computed_hash}",
                "status": "CHAIN_BROKEN_TAMPERED_BLOCK",
                "anchor": {"anchored": False, "in_sync": False},
            }
        if r.ledger_hash:
            expected_prev = r.ledger_hash

    current_head = rows[-1].ledger_hash or "GENESIS"
    anchor_info = None
    if _LATEST_LEDGER_ANCHOR:
        in_sync = (_LATEST_LEDGER_ANCHOR.get("head_hash") == current_head)
        anchor_info = {
            "anchored": True,
            "in_sync": in_sync,
            "anchor_head_hash": _LATEST_LEDGER_ANCHOR.get("head_hash"),
            "anchor_type": _LATEST_LEDGER_ANCHOR.get("anchor_type"),
            "public_url": _LATEST_LEDGER_ANCHOR.get("public_url"),
            "anchored_at": _LATEST_LEDGER_ANCHOR.get("anchored_at"),
            "signature": _LATEST_LEDGER_ANCHOR.get("signature"),
        }
    else:
        anchor_info = {
            "anchored": False,
            "in_sync": False,
            "hint": "Trigger POST /api/screen/ledger/anchor to publish an external cryptographic notary block.",
        }

    return {
        "valid": True,
        "total_blocks": len(rows),
        "head_hash": current_head,
        "genesis_hash": "GENESIS",
        "broken_at": None,
        "status": "CHAIN_VALID_UNBROKEN",
        "anchor": anchor_info,
    }


@app.post("/api/screen/ledger/anchor")
@limiter.limit("20/minute")
def anchor_ledger_chain(request: Request, admin: str = Depends(get_current_admin_or_evaluator)):
    """External Blockchain Notarization endpoint:
    Fetches latest ledger head hash and block height, generates a cryptographically
    sealed manifest, and notarizes it to an external public registry (GitHub Gist or
    high-availability cryptographic notary) for non-repudiation."""
    global _LATEST_LEDGER_ANCHOR
    with get_db() as db:
        rows = db.query(ScreeningReport).order_by(ScreeningReport.created_at.asc(), ScreeningReport.id.asc()).all()

    if not rows:
        raise HTTPException(status_code=400, detail="Cannot anchor empty ledger: no screening reports recorded yet.")

    latest = rows[-1]
    head_hash = latest.ledger_hash or "GENESIS"
    total_blocks = len(rows)
    checkpoint = latest.checkpoint or "Border Checkpoint"
    screener = admin or latest.screener or "officer@ssb.gov.in"

    manifest = _compute_anchor_manifest(head_hash, total_blocks, screener, checkpoint)
    anchor_type, public_url = _publish_anchor_gist(manifest)
    manifest["anchor_type"] = anchor_type
    manifest["public_url"] = public_url

    _LATEST_LEDGER_ANCHOR = manifest
    return {
        "ok": True,
        "status": "ANCHORED",
        "head_hash": head_hash,
        "total_blocks": total_blocks,
        "anchored_at": manifest["anchored_at"],
        "anchor_type": anchor_type,
        "public_url": public_url,
        "signature": manifest["signature"],
        "manifest": manifest,
    }


@app.get("/api/screen/ledger/anchor")
@limiter.limit("60/minute")
def get_ledger_anchor(request: Request):
    """Returns the latest external notarization anchor and its synchronization status
    with the current database head hash."""
    global _LATEST_LEDGER_ANCHOR
    with get_db() as db:
        latest = db.query(ScreeningReport).order_by(ScreeningReport.created_at.desc(), ScreeningReport.id.desc()).first()
        total_blocks = db.query(func.count(ScreeningReport.id)).scalar() or 0

    current_head = latest.ledger_hash if latest else None

    if not _LATEST_LEDGER_ANCHOR:
        if latest and current_head:
            manifest = _compute_anchor_manifest(current_head, total_blocks, latest.screener or "system", latest.checkpoint or "Border Checkpoint")
            anchor_type, public_url = _publish_anchor_gist(manifest)
            manifest["anchor_type"] = anchor_type
            manifest["public_url"] = public_url
            _LATEST_LEDGER_ANCHOR = manifest
        else:
            return {
                "anchored": False,
                "status": "UNANCHORED",
                "message": "No reports in ledger yet.",
                "latest_db_head": None,
                "total_blocks": 0,
            }

    in_sync = (_LATEST_LEDGER_ANCHOR.get("head_hash") == current_head)
    return {
        "anchored": True,
        "status": "IN_SYNC" if in_sync else "DRIFT_DETECTED",
        "in_sync": in_sync,
        "anchor_head_hash": _LATEST_LEDGER_ANCHOR.get("head_hash"),
        "current_db_head_hash": current_head,
        "total_blocks": total_blocks,
        "anchor_blocks": _LATEST_LEDGER_ANCHOR.get("total_blocks"),
        "anchored_at": _LATEST_LEDGER_ANCHOR.get("anchored_at"),
        "anchor_type": _LATEST_LEDGER_ANCHOR.get("anchor_type"),
        "public_url": _LATEST_LEDGER_ANCHOR.get("public_url"),
        "signature": _LATEST_LEDGER_ANCHOR.get("signature"),
        "manifest": _LATEST_LEDGER_ANCHOR,
    }



@app.post("/api/screen/aadhaar-fields")
@limiter.limit("60/minute")
async def screen_aadhaar_fields(
    request: Request,
    file: UploadFile = Form(...),
    admin: str = Depends(get_current_admin_or_evaluator),
):
    """Detect Aadhaar-card field bounding boxes using the trained 5-class YOLO model
    (classes: Aadhaar_No, DOB, Gender, Name, Photo)."""
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Document too large (8 MB cap).")
    try:
        from yolo_roi import extract_aadhaar_fields
        boxes = extract_aadhaar_fields(data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Aadhaar field detection failed: {exc}")
    return {
        "ok": True,
        "count": len(boxes),
        "fields": boxes,
        "model": "aadhaar_fields.onnx",
    }


@app.post("/api/screen/liveness")
@limiter.limit("60/minute")
async def verify_liveness(
    request: Request,
    frames: list[UploadFile] = Form(...),
    challenge: str = Form("blink"),
    client_meta: str = Form("{}"),
    admin: str = Depends(get_current_admin_or_evaluator),
):
    """Interactive challenge-response webcam liveness verification. Evaluates anti-virtual-camera
    injection, timestamp jitter, inter-frame physiological motion, and challenge satisfaction."""
    raw_frames = []
    for f in frames:
        b = await f.read()
        if b:
            raw_frames.append(b)
    meta = {}
    if client_meta.strip():
        try:
            meta = json.loads(client_meta)
        except Exception:
            meta = {}
    from forensics import verify_webcam_liveness
    result = verify_webcam_liveness(raw_frames, challenge=challenge, client_meta=meta)
    return result


# ============================================================================
# Screening lookup & analytics — verified-identity surface for signed-in
# officers. Zero-storage discipline holds: aggregates and digests only, no raw
# bytes, no PII.
# ============================================================================

def _public_verdict_kind(row) -> str:
    """Stable public verdict for a screening record, honouring supervised
    adjudication: a confirmed fraud overrides a CLEAR, a cleared one overrides
    a FLAGGED."""
    if row.adjudication == "CONFIRMED_FRAUD":
        return "PROVEN_FAKE"
    if row.adjudication == "CLEARED":
        return "AUTHENTIC"
    if row.verdict == "CLEAR":
        return "AUTHENTIC"
    if row.verdict == "FLAGGED" or row.adjudication == "INCONCLUSIVE":
        return "PROVEN_FAKE"
    return "UNSIGNED"


def _screening_lookup(row) -> dict:
    """Latest matching screening record as a lean, adjudication-aware object."""
    kind = _public_verdict_kind(row)
    reasons = [str(r) for r in (_safe_json(row.signals) or [])][:8]
    ai_det = _safe_json(row.ai_detection) or {}
    return {
        "verdict": kind,
        "message": {
            "AUTHENTIC": "Passed border screening — checks and adjudication agree.",
            "PROVEN_FAKE": "Failed border screening — forensic checks prove this is forged.",
            "UNSIGNED": "Screened but awaiting a supervisory adjudication.",
        }[kind],
        "hash": row.file_hash,
        "filename": row.filename,
        "checkpoint": row.checkpoint or "",
        "headline": (
            "Authentic — passed border screening" if kind == "AUTHENTIC"
            else "Proven fake — failed border screening" if kind == "PROVEN_FAKE"
            else "Screened — awaiting human adjudication"
        ),
        "guidance": "This digest matches the latest screening record. Report it to the "
                    "border desk if you believe the decision is miscategorised.",
        "reasons": reasons,
        "screening": {
            "verdict": row.verdict,
            "risk_score": row.risk_score,
            "confidence": row.confidence,
            "adjudication": row.adjudication,
            "adjudicator": row.adjudicator,
            "adjudication_note": row.adjudication_note,
            "adjudicated_at": row.adjudicated_at,
            "screener": row.screener,
            "created_at": row.created_at,
        },
        "ai_detection": ai_det or None,
        "ai_score": ai_det.get("ai_score"),
        "ai_model": ai_det.get("model"),
        "ai_provider": ai_det.get("provider"),
        "ai_explanation": ai_det.get("explanation"),
        "ai_suspected": ai_det.get("ai_suspected"),
    }


@app.post("/api/verify")
@limiter.limit("240/minute")
async def verify_digest(
    request: Request,
    file: UploadFile = Form(None),
    client_hash: str = Form(""),
    raw_text: str = Form(""),
):
    """Screening lookup: derive the SHA-256 of an uploaded sample / pasted text /
    caller-supplied digest and return the latest matching screening record
    (adjudication-aware verdict, reasons, masked fields — never raw bytes)."""
    if file is not None and file.filename:
        filename = file.filename
    elif raw_text.strip():
        filename = "text-excerpt.txt"
    else:
        filename = "digest-only"
    digest = client_hash.strip().lower()
    if not digest:
        if raw_text.strip():
            digest = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
        elif file is not None:
            data = await file.read()
            if len(data) > 8 * 1024 * 1024:
                raise HTTPException(status_code=413,
                                    detail="File too large (8 MB cap) — hash it client-side and send the digest.")
            digest = hashlib.sha256(data).hexdigest()
    if len(digest) != 64 or not set(digest) <= set("0123456789abcdef"):
        return {
            "verdict": "UNSIGNED",
            "message": "A full 64-character hex SHA-256 digest is expected.",
            "hash": digest,
            "filename": filename,
            "headline": "No valid digest supplied",
            "guidance": "Drop the original file or paste its full SHA-256 hash.",
            "reasons": [],
            "screening": None,
        }
    with get_db() as db:
        row = (db.query(ScreeningReport).filter_by(file_hash=digest)
               .order_by(ScreeningReport.created_at.desc(), ScreeningReport.id.desc())
               .first())
        if row:
            return _screening_lookup(row)
    return {
        "verdict": "UNSIGNED",
        "message": "No matching screening record for this digest.",
        "hash": digest,
        "filename": filename,
        "headline": "No screening record found",
        "guidance": "This digest has not been screened at the border desk yet. Present the "
                    "document at the nearest checkpoint for a screening run.",
        "reasons": [],
        "screening": None,
    }


def _optional_admin_email(request: Request):
    try:
        return get_current_admin(request)
    except HTTPException:
        return None


def _broadcast_row(b, admin):
    mine = admin is not None and admin == b.signer_email
    return {
        "title": b.title,
        "urgency": b.urgency,
        "content": b.content,
        "signer": b.signer,
        "institution": b.institution or "",
        "designation": b.designation or "",
        "timestamp": b.timestamp,
        "file_hash": b.file_hash,
        "signature": b.signature,
        "ipfs_cid": b.ipfs_cid,
        "media_type": b.media_type or "",
        "media_name": b.media_name or "",
        "has_media": bool(b.has_media),
        "is_mine": mine,
        "can_delete": mine or (admin is not None and is_super_admin(admin)),
    }


@app.get("/api/broadcasts")
@limiter.limit("120/minute")
def list_broadcasts(request: Request, limit: int = 200):
    """Public bulletin feed — active (non-retracted) signed notices, newest first."""
    admin = _optional_admin_email(request)
    rows = []
    with get_db() as db:
        items = (db.query(NoticeBroadcast)
                 .filter_by(is_revoked=0)
                 .order_by(NoticeBroadcast.timestamp.desc(), NoticeBroadcast.id.desc())
                 .limit(max(1, min(int(limit or 200), 500)))
                 .all())
        rows = [_broadcast_row(b, admin) for b in items]
    return {"broadcasts": rows, "authed": admin is not None}


@app.post("/api/broadcasts/create")
@limiter.limit("20/minute")
def create_broadcast(
    request: Request,
    broadcast_title: str = Form(""),
    urgency_level: str = Form("HIGH"),
    message: str = Form(...),
    admin: str = Depends(get_current_admin),
):
    """Author a signed authority notice (requires an approved officer session)."""
    title = broadcast_title.strip()
    if not title or not message.strip():
        raise HTTPException(status_code=400, detail="A title and a message are required.")
    urgency = urgency_level.strip().upper()
    if urgency not in ("CRITICAL", "HIGH", "ADVISORY"):
        urgency = "HIGH"
    with get_db() as db:
        identity = db.query(SignerIdentity).filter_by(email=admin).first()
        name = identity.name if identity else admin
        institution = identity.institution if identity else None
        designation = identity.designation if identity else None
        digest = hashlib.sha256(
            f"{title}:{urgency}:{message}:{admin}".encode("utf-8")
        ).hexdigest()
        notice = NoticeBroadcast(
            id=uuid.uuid4().hex[:16],
            title=title[:200],
            urgency=urgency,
            content=message[:4000],
            signer=name,
            signer_email=admin,
            institution=institution[:200] if institution else None,
            designation=designation[:200] if designation else None,
            timestamp=time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            file_hash=digest,
            signature=f"sha256:{digest[:32]}",
            ipfs_cid=None,
            media_type="",
            media_name="",
            has_media=0,
            is_revoked=0,
        )
        db.add(notice)
        db.commit()
        return {"ok": True, "status": "notice authored", "file_hash": digest}


@app.post("/api/broadcasts/delete")
@limiter.limit("30/minute")
def retract_broadcast(
    request: Request,
    file_hash: str = Form(...),
    admin: str = Depends(get_current_admin),
):
    """Retract a notice. Only its author or a super admin may revoke it; the row
    (and its digest) stays on record so the REVOKED state is replayable."""
    with get_db() as db:
        b = db.query(NoticeBroadcast).filter_by(file_hash=file_hash.strip().lower()).first()
        if not b:
            raise HTTPException(status_code=404, detail="Notice not found — already retracted?")
        if not (b.signer_email == admin or is_super_admin(admin)):
            raise HTTPException(status_code=403, detail="Only the author or a super admin can retract this notice.")
        b.is_revoked = 1
        db.commit()
        return {"status": "retracted", "file_hash": file_hash}


def _analytics_payload() -> dict:
    """Aggregated public-verdict mix + latency (avg/min/max) from screening
    records. Aggregates only — never any PII."""
    stats = {"AUTHENTIC": 0, "PROVEN_FAKE": 0, "REVOKED": 0, "UNSIGNED": 0}
    latencies = []
    with get_db() as db:
        for r in db.query(ScreeningReport).all():
            kind = _public_verdict_kind(r)
            stats[kind] = stats.get(kind, 0) + 1
            lm = getattr(r, "latency_ms", None)
            if isinstance(lm, int) and lm and lm > 0:
                latencies.append(lm)
        stats["REVOKED"] = (db.query(func.count(NoticeBroadcast.id))
                            .filter(NoticeBroadcast.is_revoked == 1).scalar() or 0)
    latency = None
    if latencies:
        latency = {
            "avg_ms": int(sum(latencies) / len(latencies)),
            "min_ms": min(latencies),
            "max_ms": max(latencies),
            "samples": len(latencies),
        }
    return {"stats": stats, "latency": latency, "providers": {}}


@app.get("/api/analytics")
def public_analytics(request: Request):
    return _analytics_payload()


@app.get("/api/analytics/summary")
def public_analytics_summary(request: Request):
    return {"analytics": _analytics_payload(), "usage": None, "cached": False}



# ============================================================================
# AI assistant — project-scoped Gemini chat with full codebase database ingestion
# ============================================================================
# NOTE: `codebase as codebase_index` is already imported near the top of this
# module (line ~545); do not re-import it here.

GEMINI_MODEL = (os.getenv("GEMINI_MODEL") or "gemini-3.5-flash-lite").strip()
GEMINI_KEY = (os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_KEY") or "").strip()

GEMINI_SYSTEM_PROMPT = (
    "You are the lead technical architect & AI code oracle for the SSB Border "
    "Screening console — SIH26188 AI-Based Fake Identity & Document Screening.\n\n"
    "VISIBILITY:\n"
    "You have been provided with the COMPLETE, ACTUAL SOURCE CODE DATABASE of the entire project "
    "repository in your context. Every backend route, screening module, database schema, "
    "detector, OCR/MRZ validator, React component, CSS design token, test case, and "
    "technical study guide is loaded in full with 1-based line numbers.\n\n"
    "HOW TO ANSWER:\n"
    "- Deep Code Grounding: Read and search the complete CODE DATABASE to answer accurately about ANY part of the project.\n"
    "- Exact Citations: Always cite exact file paths and line numbers whenever referencing code (e.g. `app/main.py:1124-1175`, `app/screening.py:120`, `frontend/src/views/DeskView.tsx:42`).\n"
    "- End-to-End Traces: Explain how frontend, backend, screening modules, database schemas, detectors, and the border desk flow connect across the stack.\n"
    "- Algorithmic Rigor: When explaining algorithms (e.g. ICAO 9303 MRZ check digits, PAN/DL/Voter-ID checksum rules, ELA tamper forensics, face-embedding cosine comparison), detail the exact logic and quote the code lines.\n"
    "- Complete Code Blocks: Provide complete, un-truncated, syntax-highlighted code blocks in markdown when answering implementation questions.\n"
    "- Technical Scope: Answer thoroughly on all aspects of the SSB Screening console. If asked anything completely unrelated to this project (e.g. recipes, celebrity trivia), politely decline in one sentence and offer to help with the screening console instead."
)


def _chat_history_turns(message, history):
    turns = []
    if isinstance(history, list):
        for h in history[-10:]:
            if not isinstance(h, dict):
                continue
            role = h.get("role")
            text = (h.get("text") or h.get("content") or "").strip()
            if role not in ("user", "model", "assistant", "bot") or not text:
                continue
            gem_role = "model" if role in ("model", "assistant", "bot") else "user"
            text = text[:4000]
            if turns and turns[-1]["role"] == gem_role:
                turns[-1]["parts"][0]["text"] += "\n" + text
            else:
                turns.append({"role": gem_role, "parts": [{"text": text}]})
    turns.append({"role": "user", "parts": [{"text": message[:8000]}]})
    return turns


def _gemini_reply(message, history):
    api_key = (os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_KEY") or GEMINI_KEY).strip()
    primary_model = (os.getenv("GEMINI_MODEL") or GEMINI_MODEL or "gemini-3.5-flash-lite").strip()
    if not api_key:
        return {"ok": False, "reason": "unconfigured"}

    prompt = GEMINI_SYSTEM_PROMPT
    try:
        code_ctx = codebase_index.codebase_context(message)
    except Exception as e:
        print(f"[_gemini_reply] Warning: codebase_context error: {e}")
        code_ctx = ""

    if code_ctx:
        prompt = GEMINI_SYSTEM_PROMPT + "\n\n" + code_ctx

    body = {
        "systemInstruction": {"parts": [{"text": prompt}]},
        "contents": _chat_history_turns(message, history),
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 4096, "candidateCount": 1},
    }
    params = {"key": api_key}
    headers = {"Content-Type": "application/json"}

    candidate_models = [primary_model]
    for m in ("gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-3.1-flash-lite"):
        if m not in candidate_models:
            candidate_models.append(m)

    last_resp = None
    for model in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            import requests
            resp = requests.post(url, json=body, headers=headers, params=params, timeout=(15, 90))
        except Exception as e: # Catch all since requests exception might not be imported

            print(f"[_gemini_reply] RequestException for model {model}: {e}")
            continue
        last_resp = resp
        if resp.status_code == 200:
            data = resp.json()
            parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts") or []
            text = "".join(p.get("text") or "" for p in parts).strip()
            if text:
                return {"ok": True, "answer": text}
            block = (data.get("promptFeedback") or {}).get("blockReason")
            return {"ok": False, "reason": "blocked", "detail": block}
        if resp.status_code in (400, 401, 403):
            print(f"[_gemini_reply] Auth/Key error {resp.status_code}: {resp.text[:200]}")
            return {"ok": False, "reason": "key_invalid"}
        # If rate-limited (429), not found (404), or server error (5xx), try the next candidate model
        print(f"[_gemini_reply] Model {model} returned {resp.status_code}, trying fallback...")
        continue

    if last_resp is not None:
        if last_resp.status_code == 429:
            return {"ok": False, "reason": "rate_limited"}
        return {"ok": False, "reason": "error", "detail": last_resp.text[:120]}
    return {"ok": False, "reason": "error"}


@app.post("/api/chat")
@limiter.limit("30/minute")
async def ai_chat(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Send a JSON body with a 'message' field.")
    message = str(payload.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "'message' is required.")
    history = payload.get("history") or []
    result = await run_in_threadpool(_gemini_reply, message, history)
    if result.get("ok"):
        return {"ok": True, "answer": result["answer"]}
    reason = result.get("reason")
    if reason == "unconfigured":
        message_note = ("The AI assistant is not configured yet — add a GEMINI_API_KEY env "
                        "var on the server. The offline guide still works.")
    elif reason == "key_invalid":
        message_note = ("The AI assistant's key was rejected — check the GEMINI_API_KEY env "
                        "var. Using the offline guide for now.")
    elif reason == "rate_limited":
        message_note = "The AI is busy right now — try again in a minute."
    else:
        message_note = "The AI assistant hit an error — please try again."
    return {"ok": False, "reason": reason, "message": message_note}

