"""
Circuit-breaker and optimized payload dispatcher for remote ML microservice (SIH26188).
Ensures zero-hang fallback to local inference when the remote endpoint experiences latency.
"""
import os
import time
import io
import logging

logger = logging.getLogger("app.remote_ml")

_CIRCUIT_BROKEN_UNTIL = 0.0


def is_remote_available() -> bool:
    """Returns False if ML_SERVICE_URL is not set or if circuit-breaker is active."""
    url = os.getenv("ML_SERVICE_URL")
    if not url:
        return False
    global _CIRCUIT_BROKEN_UNTIL
    if time.monotonic() < _CIRCUIT_BROKEN_UNTIL:
        return False
    return True


def mark_remote_failed():
    """Trigger back-off for 300 seconds so desk screenings complete in 2 seconds."""
    global _CIRCUIT_BROKEN_UNTIL
    _CIRCUIT_BROKEN_UNTIL = time.monotonic() + 300.0
    logger.warning("[remote_ml] Remote ML call failed or timed out. Circuit breaker active for 300s (using local models).")


def mark_remote_success():
    global _CIRCUIT_BROKEN_UNTIL
    _CIRCUIT_BROKEN_UNTIL = 0.0


def get_timeout() -> float:
    """Max network budget per call (default 2.0s)."""
    try:
        return float(os.getenv("ML_SERVICE_TIMEOUT", "2.0"))
    except Exception:
        return 2.0


def prepare_payload(image_bytes: bytes, max_dim: int = 800) -> bytes:
    """Downscale multi-megabyte phone photos before network transport to prevent write timeouts."""
    if not image_bytes or len(image_bytes) < 100000:
        return image_bytes
    try:
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        if max(img.size) > max_dim:
            scale = max_dim / max(img.size)
            img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except Exception:
        return image_bytes
