"""
Unit and integration tests for:
1. Cryptographic Append-Only Hash-Chain Ledger verification (/api/screen/ledger/verify)
2. Aadhaar 5-Class YOLO Field Extraction (/api/screen/aadhaar-fields)
3. Challenge-Response Webcam Liveness Verification (/api/screen/liveness)
4. Forensic Court Dossier cryptographic block hash rendering
"""

import hashlib
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


def test_ledger_verify_empty(client):
    """Empty database returns valid genesis state."""
    resp = client.get("/api/screen/ledger/verify")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["total_blocks"] == 0
    assert data["status"] == "EMPTY_CHAIN"


def test_ledger_verify_unbroken_chain(client, monkeypatch):
    """Sequential valid blocks pass cryptographic hash chain verification."""
    SessionLocal = main.SessionLocal
    db = SessionLocal()
    try:
        genesis = "GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000"
        hash1 = hashlib.sha256(f"{genesis}:hash1:CLEAR:12".encode("utf-8")).hexdigest()
        rep1 = ScreeningReport(
            id="blk_001",
            file_hash="hash1",
            filename="passport1.jpg",
            doc_type="passport",
            checkpoint="Raxaul ICP",
            verdict="CLEAR",
            risk_score=12,
            confidence=0.95,
            extracted_fields="{}",
            signals="[]",
            previous_hash=genesis,
            ledger_hash=hash1,
            ledger_status="AUTHENTIC",
            screener="officer@ssb.gov.in",
            created_at=now_utc(),
        )
        db.add(rep1)
        db.flush()

        hash2 = hashlib.sha256(f"{hash1}:hash2:REVIEW:50".encode("utf-8")).hexdigest()
        rep2 = ScreeningReport(
            id="blk_002",
            file_hash="hash2",
            filename="visa2.jpg",
            doc_type="visa",
            checkpoint="Raxaul ICP",
            verdict="REVIEW",
            risk_score=50,
            confidence=0.88,
            extracted_fields="{}",
            signals="[]",
            previous_hash=hash1,
            ledger_hash=hash2,
            ledger_status="AUTHENTIC",
            screener="officer@ssb.gov.in",
            created_at=now_utc(),
        )
        db.add(rep2)
        db.commit()
    finally:
        db.close()

    resp = client.get("/api/screen/ledger/verify")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["total_blocks"] == 2
    assert data["head_hash"] == hash2


def test_ledger_tamper_detection(client):
    """Altering any historical record breaks the hash chain and pinpoints the block."""
    SessionLocal = main.SessionLocal
    db = SessionLocal()
    try:
        genesis = "GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000"
        hash1 = hashlib.sha256(f"{genesis}:hash1:CLEAR:12".encode("utf-8")).hexdigest()
        rep1 = ScreeningReport(
            id="blk_001",
            file_hash="hash1",
            filename="passport1.jpg",
            doc_type="passport",
            checkpoint="Raxaul ICP",
            verdict="CLEAR",
            risk_score=12,
            confidence=0.95,
            extracted_fields="{}",
            signals="[]",
            previous_hash=genesis,
            ledger_hash=hash1,
            ledger_status="AUTHENTIC",
            screener="officer@ssb.gov.in",
            created_at=now_utc(),
        )
        db.add(rep1)
        db.flush()

        hash2 = hashlib.sha256(f"{hash1}:hash2:CLEAR:10".encode("utf-8")).hexdigest()
        rep2 = ScreeningReport(
            id="blk_002",
            file_hash="hash2",
            filename="visa2.jpg",
            doc_type="visa",
            checkpoint="Raxaul ICP",
            verdict="CLEAR",
            risk_score=10,
            confidence=0.90,
            extracted_fields="{}",
            signals="[]",
            previous_hash=hash1,
            ledger_hash=hash2,
            ledger_status="AUTHENTIC",
            screener="officer@ssb.gov.in",
            created_at=now_utc(),
        )
        db.add(rep2)
        db.commit()

        # Malicious actor tampers with rep1's risk score directly in DB
        rep1.risk_score = 99
        db.commit()
    finally:
        db.close()

    resp = client.get("/api/screen/ledger/verify")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is False
    assert data["status"] == "CORRUPTED_CHAIN"
    assert data["broken_at"] == "blk_001"


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


def test_dossier_contains_block_hash(client):
    """Forensic Court Dossier renders cryptographic ledger block hash and previous hash."""
    SessionLocal = main.SessionLocal
    db = SessionLocal()
    try:
        rep = ScreeningReport(
            id="test_dossier_hash_block",
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
            ledger_status="AUTHENTIC",
            previous_hash="PREV_HASH_ABCDEF123456",
            ledger_hash="CURR_HASH_FEDCBA654321",
            screener="officer@ssb.gov.in",
            created_at=now_utc(),
        )
        db.add(rep)
        db.commit()
    finally:
        db.close()

    resp = client.get("/api/screen/dossier/test_dossier_hash_block")
    assert resp.status_code == 200
    assert "CURR_HASH_FEDCBA654321" in resp.text
    assert "PREV_HASH_ABCDEF123456" in resp.text
    assert "Ledger Block Hash" in resp.text
