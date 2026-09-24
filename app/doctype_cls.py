"""
Document-type classifier (SIH26188) — local ONNX inference.

Distinguishes the identity/travel documents SSB screens at every Indian
checkpoint: passport, aadhaar, pan, driving_licence, voter_id,
nepali_citizenship, and a catch-all `other`. Powering:
  * live-image extraction (`POST /api/extract`) auto-detect doc type
  * guidance when the officer doesn't declare a document type

Trained offline (data/doctype + runs/classify) and exported to ONNX
(app/models/doctype.onnx, ~5.5 MB). Zero deps beyond onnxruntime + Pillow;
degrades to `None` (caller falls back to declared type) when the model is
absent or inference fails — an offline desk must still screen.
"""

import io
import logging
import os

import numpy as np
from PIL import Image

logger = logging.getLogger("doctype_cls")

# ultralytics classify export uses alphabetical class order — matches model metadata
CLASSES = [
    "aadhaar", "driving_licence", "nepali_citizenship", "other",
    "pan", "passport", "voter_id",
]

_MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
_IMG_SIZE = 224


def _default_model_path() -> str:
    env = os.getenv("DOCTYPE_ONNX_PATH")
    if env:
        return env
    candidate = os.path.join(_MODEL_DIR, "doctype.onnx")
    return candidate if os.path.exists(candidate) else ""


_MODEL_PATH = _default_model_path()
_session = None
_session_attempted = False


def _resize_keep_aspect(img: Image.Image, size: int) -> Image.Image:
    """torchvision Resize(size) equivalent: scale so the SHORTER edge == size,
    preserving aspect ratio (ultralytics classify_transforms convention)."""
    w, h = img.size
    if w <= h:
        nw, nh = size, int(round(h * size / w))
    else:
        nh, nw = size, int(round(w * size / h))
    return img.resize((nw, nh), Image.BILINEAR)


def _center_crop(img: Image.Image, tw: int, th: int) -> Image.Image:
    """torchvision CenterCrop((th, tw)) equivalent: centre square crop."""
    w, h = img.size
    x0 = max(0, (w - tw) // 2)
    y0 = max(0, (h - th) // 2)
    return img.crop((x0, y0, x0 + tw, y0 + th))


def model_available() -> bool:
    return bool(_MODEL_PATH)


def _get_session():
    global _session, _session_attempted
    if _session_attempted:
        return _session
    _session_attempted = True
    if not _MODEL_PATH:
        return None
    try:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        _session = ort.InferenceSession(
            _MODEL_PATH, sess_options=opts,
            providers=["CPUExecutionProvider"])
        return _session
    except Exception as exc:
        logger.warning("doctype ONNX load failed: %s", exc)
        return None


def classify_document(data: bytes) -> dict | None:
    """Classify raw image bytes -> {doc_type, confidence, scores}.

    Matches the exported ONNX (doctype.onnx) letterbox convention model training
    used: Resize(224 keep-aspect) -> CenterCrop(224x224) -> ToTensor (/255).
    Returns None on decode/inference failure (caller falls back to declared).
    """
    sess = _get_session()
    if sess is None:
        # Fallback to remote ML microservice if configured (e.g. on Vercel deployment)
        ml_url = os.getenv("ML_SERVICE_URL")
        if ml_url:
            try:
                timeout_sec = float(os.getenv("ML_SERVICE_TIMEOUT", "6.0"))
                base = ml_url.rstrip("/")
                candidate_urls = (
                    [f"{base}/api/ml/doctype", f"{base}/gradio_api/api/ml/doctype"]
                    if "/gradio_api" not in base else [f"{base}/api/ml/doctype"]
                )
                for target_url in candidate_urls:
                    files = {"file": ("image.png", data, "image/png")}
                    try:
                        import httpx
                        with httpx.Client(timeout=timeout_sec) as client:
                            res = client.post(target_url, files=files)
                    except ImportError:
                        import requests
                        res = requests.post(target_url, files=files, timeout=timeout_sec)
                    if res is not None and res.status_code == 200:
                        return res.json()
            except Exception as exc:
                logger.warning("remote doctype classify failed: %s", exc)
        return None
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        # Match ultralytics classify_transforms: Resize to 224 keeping aspect,
        # then CenterCrop to 224x224, then ToTensor (which divides by 255).
        img = _resize_keep_aspect(img, _IMG_SIZE)
        img = _center_crop(img, _IMG_SIZE, _IMG_SIZE)
        arr = np.asarray(img, dtype=np.float32) / 255.0
        tensor = arr.transpose(2, 0, 1)[None, ...]
        (logits,) = sess.run(None, {sess.get_inputs()[0].name: tensor})
        raw = logits[0]

        # If model already outputs normalized probabilities (summing to ~1),
        # use directly; otherwise apply softmax.
        if np.isclose(float(raw.sum()), 1.0, atol=0.05) and np.all(raw >= 0):
            probs = raw
        else:
            probs = raw - raw.max()
            exps = np.exp(probs)
            probs = exps / exps.sum()

        idx = int(probs.argmax())
        scores = {CLASSES[i]: round(float(probs[i]), 4) for i in range(len(CLASSES))}
        return {
            "doc_type": CLASSES[idx] if idx < len(CLASSES) else "other",
            "confidence": round(float(probs[idx]), 4),
            "scores": scores,
            "engine": "doctype.onnx",
        }
    except Exception as exc:
        logger.warning("doctype classify failed: %s", exc)
        return None