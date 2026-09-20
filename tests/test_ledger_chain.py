"""
Unit and integration tests for:
1. Aadhaar 5-Class YOLO Field Extraction (/api/screen/aadhaar-fields)
2. Challenge-Response Webcam Liveness Verification (/api/screen/liveness)
3. Forensic Court Dossier rendering
"""

import io
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "app"))

import main
from main import Base, ScreeningReport, app, make_session_token, now_utc


def _synth_image(w: int = 120, h: int = 120, color: str = "white") -> bytes:
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h), color)
    d = ImageDraw.Draw(im)
    d.rectangle([10, 10, w - 10, h - 10], outline="black", fill="lightblue")
    buf = io.BytesIO()
    im.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def client(monkeypatch):
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=test_engine)
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    monkeypatch.setattr(main, "SessionLocal", TestSession)

    # Set up user session cookie
    sess_token = make_session_token("officer@ssb.gov.in")
    return TestClient(app, cookies={"nischay_session": sess_token})


def test_aadhaar_fields_endpoint(client):
    """POST /api/screen/aadhaar-fields returns detected zones and model metadata."""
    img_data = _synth_image(200, 200)
    files = {"file": ("aadhaar_sample.jpg", img_data, "image/jpeg")}
    resp = client.post("/api/screen/aadhaar-fields", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "fields" in data
    assert "model" in data
    assert isinstance(data["fields"], list)


def test_liveness_endpoint(client):
    """POST /api/screen/liveness analyzes multiple frames and returns challenge-response verdict."""
    frame1 = _synth_image(96, 96, "blue")
    frame2 = _synth_image(96, 96, "white")
    files = [
        ("frames", ("f1.jpg", frame1, "image/jpeg")),
        ("frames", ("f2.jpg", frame2, "image/jpeg")),
    ]
    data = {"challenge": "blink", "client_meta": "{}"}
    resp = client.post("/api/screen/liveness", files=files, data=data)
    assert resp.status_code == 200
    res = resp.json()
    assert "verdict" in res
    assert "liveness_passed" in res
    assert "checks" in res
    assert res["challenge"] == "blink"


def test_dossier_renders(client):
    """Forensic Court Dossier renders screening record, adjudication and latency."""
    SessionLocal = main.SessionLocal
    db = SessionLocal()
    try:
        rep = ScreeningReport(
            id="test_dossier_rep",
            file_hash="deadbeef12345678",
            filename="passport_custody.jpg",
            doc_type="passport",
            checkpoint="Panitanki ICP",
            verdict="CLEAR",
            risk_score=15,
            confidence=0.94,
            extracted_fields='{"passport":"K1234567"}',
            signals='["ICAO TD3 checksums valid"]',
            modules='{"extraction":{"ran":true},"validation":{"verdict":"PASS"},"tampering":{"verdict":"PASS"},"face":{"verdict":"PASS"}}',
            screener="officer@ssb.gov.in",
            created_at=now_utc(),
        )
        db.add(rep)
        db.commit()
    finally:
        db.close()

    resp = client.get("/api/screen/dossier/test_dossier_rep")
    assert resp.status_code == 200
    assert "Evidentiary Forensic Dossier" in resp.text
    assert "CRYPTOGRAPHIC CUSTODY SEAL" in resp.text
    assert "Screened By" in resp.text
    assert "officer@ssb.gov.in" in resp.text
