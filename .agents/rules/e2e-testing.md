---
name: e2e-testing
description: End-to-end and integration testing guidelines for the SIH26188 screening system. Use when writing, modifying, or executing backend API tests, synthetic document fixtures, or frontend verification flows.
---

# End-to-End & Integration Testing Guidelines

## Testing Principles

1. **Deterministic Test Execution**:
   - Tests must run offline without requiring external internet or third-party cloud services.
   - Use in-memory synthetic images generated via `PIL.Image` (e.g. RGB noise, gradient, or card-like canvases) rather than downloading external sample images.
2. **FastAPI TestClient**:
   - Use `fastapi.testclient.TestClient(app)` with an in-memory SQLite database (`DATABASE_URL=sqlite:///:memory:`).
   - Clean up DB state between test sessions or isolate test sessions with unique IDs.
3. **Frontend Verification**:
   - Validate that the frontend compiles cleanly with `tsc --noEmit && vite build`.
   - Ensure the singlefile HTML output in `app/static/index.html` is generated properly without missing module chunks.

---

## Standard Test Patterns

### 1. Generating In-Memory Synthetic Document Fixture

```python
import io
from PIL import Image, ImageDraw

def create_synthetic_doc_bytes(width: int = 400, height: int = 250, text: str = "SYNTHETIC ID") -> bytes:
    img = Image.new("RGB", (width, height), color=(240, 240, 245))
    draw = ImageDraw.Draw(img)
    draw.rectangle([10, 10, width - 10, height - 10], outline=(40, 60, 120), width=3)
    draw.text((20, 30), text, fill=(20, 20, 20))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()
```

### 2. Testing Zero-Storage Screening Flow

```python
def test_screening_flow(client):
    file_bytes = create_synthetic_doc_bytes()
    resp = client.post(
        "/api/screen",
        files={"file": ("test_passport.jpg", file_bytes, "image/jpeg")},
        data={"doc_type": "passport", "checkpoint": "IN-NPL-PANITANKI"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "file_hash" in data
    assert "risk_score" in data
    assert "verdict" in data
    # Ensure no raw bytes returned
    assert "raw_bytes" not in data
```

---

## Verification Commands

- Run full Python test suite: `pytest`
- Run specific test file: `pytest tests/test_revamp.py`
- Validate TypeScript & Vite bundle: `cd frontend && npm run build`