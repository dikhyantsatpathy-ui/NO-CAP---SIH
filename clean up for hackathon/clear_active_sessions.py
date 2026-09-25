#!/usr/bin/env python3
"""
===============================================================================
MHA HACKATHON (SIH26188) — SANDBOX CLEAN-UP UTILITY
===============================================================================
Script Name: clear_active_sessions.py
Location:    clean up for hackathon/clear_active_sessions.py
Purpose:     Clears all active/open screening sessions and ephemeral document
             workspace records from the database so evaluators, judges, and
             screening officers get a completely clean, pristine desk experience
             during live demo runs.

Usage:
    # Run from the project root directory:
    python "clean up for hackathon/clear_active_sessions.py"

    # Optional: Clear ALL sessions (both open and settled) for a total fresh start:
    python "clean up for hackathon/clear_active_sessions.py" --all
===============================================================================
"""

import os
import sys
import argparse
from datetime import datetime

# Ensure utf-8 output on Windows terminals
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Ensure project root is on sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Ensure app directory is importable
APP_DIR = os.path.join(PROJECT_ROOT, "app")
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

try:
    from app.main import (
        get_db,
        engine,
        _IS_SQLITE,
        ScreeningSession,
        ScreeningReport,
        SignerIdentity,
    )
    from sqlalchemy import text
except Exception as exc:
    print(f"[-] Error importing database configuration from app.main: {exc}")
    sys.exit(1)


def clear_active_sessions(purge_all: bool = False) -> int:
    """
    Cleans up active (status == 'open') sessions or all sessions from the database.
    """
    db_type = "SQLite (Local Fallback)" if _IS_SQLITE else "PostgreSQL (Neon Serverless)"
    print("\n" + "=" * 70)
    print(" [SHIELD] SIH26188 -- HACKATHON SANDBOX CLEANUP UTILITY")
    print("=" * 70)
    print(f" [*] Connected Database Target: {db_type}")
    print(f" [*] Execution Timestamp:       {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f" [*] Mode:                      {'PURGE ALL SESSIONS' if purge_all else 'CLEAR ACTIVE (OPEN) SESSIONS'}")
    print("-" * 70)

    with get_db() as db:
        query = db.query(ScreeningSession)
        if not purge_all:
            query = query.filter(ScreeningSession.status == "open")
        
        target_sessions = query.all()
        session_count = len(target_sessions)

        if session_count == 0:
            print("[+] No matching sessions found. The desk workspace is already 100% clean!")
            print("=" * 70 + "\n")
            return 0

        print(f"[!] Found {session_count} session(s) to remove:")
        session_ids = []
        for s in target_sessions:
            session_ids.append(s.id)
            print(f"    - ID: {s.id[:10]}... | Label: {s.label or 'Unlabeled'} | Status: {s.status.upper()} | Post: {s.checkpoint or 'Desk'} | Screener: {s.screener or 'None'} | Opened: {s.created_at}")

        print("\n[*] Deleting associated ephemeral document records...")
        deleted_reports = 0
        for sid in session_ids:
            reps = db.query(ScreeningReport).filter(ScreeningReport.session_id == sid).all()
            for r in reps:
                db.delete(r)
                deleted_reports += 1

        print(f"[*] Deleted {deleted_reports} document report rows.")

        print(f"[*] Removing {session_count} session records...")
        for s in target_sessions:
            db.delete(s)

        db.commit()
        print(f"[+] SUCCESS: All {session_count} session(s) successfully cleared from the database!")

        # Verify zero remaining active sessions
        remaining = db.query(ScreeningSession).filter(ScreeningSession.status == "open").count()
        print(f"[+] Verification: Remaining active sessions in database = {remaining}")
        print("=" * 70)
        print(" [OK] Desk is clean and ready for Hackathon Evaluation & Demonstrations!")
        print("=" * 70 + "\n")
        return session_count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="SIH26188 Hackathon Sandbox Clean-up Script"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Purge ALL screening sessions and records, not just open ones.",
    )
    args = parser.parse_args()
    clear_active_sessions(purge_all=args.all)
