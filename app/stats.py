"""
Border screening statistics & reporting (SIH26188).

Pure aggregation helpers over the masked ScreeningReport / ScreeningSession
rows. Everything here consumes only what the desk already persists (verdicts,
risk scores, checkpoints, doc types, module verdicts, timestamps, latency) —
no raw bytes, no plaintext identifiers — so the stats dashboard is a free
privacy-preserving view of the border's screening health.

Timestamps are aggregated in IST (the desk's operational timezone) and also
exposed as UTC so exports can be correlated with other systems.
"""

import json
import time

from config import utc_to_epoch, ist_hour_of_day, to_ist


def _rows(db, model, limit: int = 5000):
    try:
        return db.query(model).order_by(model.created_at.desc()).limit(limit).all()
    except Exception:
        return []


def _module_verdict(modules_raw):
    """'{"validation": "PASS", "tampering": "WARN", "face": "UNVERIFIED"}' -> dict"""
    if not modules_raw:
        return {}
    try:
        v = json.loads(modules_raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _bucket(score: int | None) -> str:
    if score is None:
        return "Unknown"
    if score <= 25:
        return "0-25 (low)"
    if score <= 55:
        return "26-55 (watch)"
    return "56-100 (critical)"


def report_stats(db, limit: int = 5000) -> dict:
    """Aggregate all screening passes into a stats payload.

    Sections: totals, verdict funnel, risk buckets, per-doc-type, per-checkpoint,
    per-officer, module pass/fail rates, AI-detector performance, latency
    percentiles, and IST hourly + daily histograms.
    """
    rows = _rows(db, __import__("main").ScreeningReport, limit)
    out = {
        "generated_at_utc": __import__("main").now_utc(),
        "generated_at_ist": to_ist(__import__("main").now_utc()),
        "total_screens": len(rows),
        "verdicts": {},
        "risk_buckets": {},
        "by_doc_type": {},
        "by_checkpoint": {},
        "by_officer": {},
        "modules": {"validation": {}, "tampering": {}, "face": {}, "extraction": {}},
        "ai_detector": {"ran": 0, "suspected": 0, "score_sum": 0.0},
        "latency_ms": {"min": None, "max": 0, "sum": 0, "p50": None, "p95": None},
        "hourly_ist": {h: 0 for h in range(24)},
        "daily": {},
        "flagged_count": 0,
    }
    if not rows:
        return out

    latencies = []
    total = len(rows)
    for r in rows:
        v = (r.verdict or "UNKNOWN").upper()
        out["verdicts"][v] = out["verdicts"].get(v, 0) + 1
        if v == "FLAGGED":
            out["flagged_count"] += 1
        buck = _bucket(r.risk_score)
        out["risk_buckets"][buck] = out["risk_buckets"].get(buck, 0) + 1

        dt = (r.doc_type or "other").strip() or "other"
        bd = out["by_doc_type"].setdefault(dt, {"count": 0, "flagged": 0, "avg_risk": 0.0})
        bd["count"] += 1
        bd["flagged"] += 1 if v == "FLAGGED" else 0
        bd["avg_risk"] += float(r.risk_score or 0)

        cp = (r.checkpoint or "").strip() or "unspecified"
        bc = out["by_checkpoint"].setdefault(cp, {"count": 0, "flagged": 0})
        bc["count"] += 1
        bc["flagged"] += 1 if v == "FLAGGED" else 0

        ofr = (r.screener or "unknown").strip() or "unknown"
        bo = out["by_officer"].setdefault(ofr, {"count": 0, "flagged": 0})
        bo["count"] += 1
        bo["flagged"] += 1 if v == "FLAGGED" else 0

        mods = _module_verdict(getattr(r, "modules", None))
        for mkey in ("validation", "tampering", "face"):
            mv = mods.get(mkey) or "N/A"
            out["modules"][mkey][mv] = out["modules"][mkey].get(mv, 0) + 1

        ai = {}
        try:
            ai = json.loads(r.ai_detection or "{}") or {}
        except Exception:
            pass
        if ai.get("ran"):
            out["ai_detector"]["ran"] += 1
            if ai.get("ai_suspected"):
                out["ai_detector"]["suspected"] += 1
            try:
                out["ai_detector"]["score_sum"] += float(ai.get("ai_score") or 0)
            except Exception:
                pass

        lat = getattr(r, "latency_ms", None)
        if isinstance(lat, (int, float)) and lat > 0:
            latencies.append(float(lat))

        hh = ist_hour_of_day(r.created_at)
        if hh is not None:
            out["hourly_ist"][hh] = out["hourly_ist"].get(hh, 0) + 1
        dkey = (r.created_at or "")[:10]
        if dkey:
            out["daily"][dkey] = out["daily"].get(dkey, 0) + 1

    for dt in out["by_doc_type"]:
        b = out["by_doc_type"][dt]
        b["avg_risk"] = round(b["avg_risk"] / max(1, b["count"]), 1)

    if latencies:
        latencies.sort()
        n = len(latencies)
        out["latency_ms"]["min"] = int(latencies[0])
        out["latency_ms"]["max"] = int(latencies[-1])
        out["latency_ms"]["sum"] = int(sum(latencies))
        out["latency_ms"]["avg"] = int(sum(latencies) / n)
        out["latency_ms"]["p50"] = int(latencies[n // 2])
        out["latency_ms"]["p95"] = int(latencies[int(n * 0.95) - 1])
    ai = out["ai_detector"]
    ai["suspicion_rate"] = round(ai["suspected"] / max(1, ai["ran"]), 3)
    return out


def session_stats(db, limit: int = 2000) -> dict:
    """Aggregate closed screening sessions (the border ledger)."""
    rows = _rows(db, __import__("main").ScreeningSession, limit)
    out = {
        "total_sessions": len(rows),
        "by_status": {},
        "by_verdict": {},
        "by_checkpoint": {},
        "cleared": 0,
        "flagged": 0,
        "avg_session_risk": 0.0,
    }
    if not rows:
        return out
    risk_sum = 0.0
    for s in rows:
        st = (s.status or "unknown").lower()
        out["by_status"][st] = out["by_status"].get(st, 0) + 1
        v = (s.verdict or "PENDING").upper()
        out["by_verdict"][v] = out["by_verdict"].get(v, 0) + 1
        if v == "CLEAR":
            out["cleared"] += 1
        if v in ("FLAGGED", "REVIEW"):
            out["flagged"] += 1
        cp = (s.checkpoint or "").strip() or "unspecified"
        out["by_checkpoint"][cp] = out["by_checkpoint"].get(cp, 0) + 1
        risk_sum += float(s.risk_score or 0)
    out["avg_session_risk"] = round(risk_sum / len(rows), 1)
    return out


def throughput(db, minutes: int = 60) -> dict:
    """Screens + sessions completed in the last N minutes (for the live band)."""
    cutoff = int(time.time()) - minutes * 60
    screens = 0
    sessions = 0
    rows = _rows(db, __import__("main").ScreeningReport, 5000)
    for r in rows:
        ts = utc_to_epoch(r.created_at)
        if ts is not None and ts >= cutoff:
            screens += 1
    srows = _rows(db, __import__("main").ScreeningSession, 2000)
    for s in srows:
        ts = utc_to_epoch(s.closed_at or s.updated_at)
        if ts is not None and ts >= cutoff:
            sessions += 1
    return {"window_minutes": minutes, "screens": screens, "sessions_closed": sessions}