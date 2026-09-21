// ============================================================================
// LedgerView.tsx — the verified session ledger (SIH26188).
// Each closed session contributes exactly ONE chained SHA-256 block built from
// canonical hashed session data. Every document continues to carry its own
// masked audit row on the screen pipeline. This view renders the chain
// oldest-to-newest and can re-verify the entire chain end to end.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import {
  getSessionLedger,
  verifySessionLedger,
  type SessionLedgerPayload,
  type SessionLedgerVerify,
} from "../api";
import { useToast } from "../app/state";
import { shortHash, timeLabel } from "../app/util";

function verdictChip(verdict: string | null): string {
  if (verdict === "CLEAR") return "chip--ok";
  if (verdict === "FLAGGED" || verdict === "CONFIRMED_FRAUD") return "chip--bad";
  if (verdict === "REVIEW") return "chip--warn";
  return "chip--mute";
}

export function LedgerView() {
  const { toast } = useToast();
  const [payload, setPayload] = useState<SessionLedgerPayload | null>(null);
  const [verify, setVerify] = useState<SessionLedgerVerify | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, v] = await Promise.all([getSessionLedger(), verifySessionLedger()]);
    if (p.ok) setPayload(p.data);
    if (v.ok) setVerify(v.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runVerify = async () => {
    setVerifying(true);
    const res = await verifySessionLedger();
    setVerifying(false);
    if (res.ok) {
      setVerify(res.data);
      toast(
        res.data.valid ? `Chain intact — ${res.data.verified_blocks} blocks verified.` : `CHAIN BROKEN at ${res.data.broken_at || "?"}`,
        res.data.valid ? "success" : "error",
      );
    } else {
      toast(res.error, "error");
    }
  };

  const blocks = payload?.blocks || [];

  return (
    <div className="view">
      <section className="panel">
        <div className="panel__row">
          <div>
            <h2 className="panel__title">PROTECTED SESSION LEDGER</h2>
            <p className="panel__body">
              One chained SHA-256 block per closed session. The ledger stores only canonical
              digests and masked identifiers — no raw traveller data.
            </p>
          </div>
          <button className="btn" onClick={() => void load()}>
            RELOAD
          </button>
        </div>

        <div className="ledger-head">
          <div className="stat">
            <span className="stat__label">SIGNED BLOCKS</span>
            <span className="stat__value mono">{payload?.total_blocks ?? "—"}</span>
          </div>
          <div className="stat">
            <span className="stat__label">CHAIN HEAD</span>
            <span className="stat__value mono stat__value--sm">{shortHash(payload?.head_hash, 26)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">INTEGRITY</span>
            <span className={`stat__value ${verify ? (verify.valid ? "t-ok" : "t-bad") : "t-mute"}`}>
              {verifying ? "CHECKING…" : verify ? (verify.valid ? "VERIFIED" : "BROKEN") : "UNKNOWN"}
            </span>
          </div>
          <button className="btn btn--primary" disabled={verifying} onClick={() => void runVerify()}>
            {verifying ? "VERIFYING…" : "VERIFY CHAIN"}
          </button>
        </div>
        {verify && !verify.valid && (
          <p className="banner banner--bad">
            TAMPER DETECTED — chain broken at {verify.broken_at || "unknown block"}. {verify.reason || ""}
          </p>
        )}
        {verify && verify.valid && verify.total_blocks > 0 && (
          <p className="hint">
            Re-hashed {verify.verified_blocks} blocks oldest → newest; every previous_hash matches the
            preceding block's hash.
          </p>
        )}

        {loading ? (
          <p className="hint">Loading ledger…</p>
        ) : blocks.length === 0 ? (
          <p className="hint">No signed sessions yet. Approve a session on the desk to create the first block.</p>
        ) : (
          <div className="chain">
            {blocks.map((b, i) => (
              <div key={b.id} className="chain__item">
                {i > 0 && (
                  <div className="chain__link">
                    <span className="chain__link-line" />
                    <span className="chain__link-label mono">LINK · SHA-256</span>
                  </div>
                )}
                <article className="block">
                  <header className="block__head">
                    <span className={`block__node node--${b.status === "approved" ? "ok" : b.status === "rejected" ? "bad" : "warn"}`} />
                    <span className="block__no">BLOCK {String(i + 1).padStart(3, "0")}</span>
                    {i === 0 && <span className="chip chip--seal">GENESIS</span>}
                    <span className={`chip ${verdictChip(b.verdict)}`}>{b.verdict || b.status.toUpperCase()}</span>
                    <span className="block__meta mono">
                      {b.checkpoint} · {b.document_count} doc(s) · risk {b.risk_score ?? "—"}
                    </span>
                    <button
                      className="btn btn--small"
                      onClick={() => setExpanded((cur) => (cur === b.id ? null : b.id))}
                    >
                      {expanded === b.id ? "COLLAPSE" : "HASHES"}
                    </button>
                  </header>
                  <div className="block__grid">
                    <div className="block__cell">
                      <span className="k">PREVIOUS</span>
                      <code className="hash mono">{b.prev_hash || "GENESIS"}</code>
                    </div>
                    <div className="block__cell">
                      <span className="k">THIS BLOCK</span>
                      <code className="hash mono">{b.block_hash}</code>
                    </div>
                  </div>
                  <div className="block__meta mono">
                    signed {timeLabel(b.closed_at || b.updated_at)} · {b.screener || "officer"}
                    {b.adjudicator ? ` · adjudicated ${b.adjudicator}` : ""}
                  </div>
                  {expanded === b.id && (
                    <div className="block__detail">
                      <div className="block__cell">
                        <span className="k">SESSION</span>
                        <span className="mono">{b.id}</span>
                      </div>
                      <div className="block__cell">
                        <span className="k">NOTE</span>
                        <span>{b.note || "—"}</span>
                      </div>
                      {b.comparison && (
                        <div className="block__cell">
                          <span className="k">COMPARISON</span>
                          <span>
                            {b.comparison.verdict} · risk bump +{b.comparison.risk_bump} ·{" "}
                            {b.comparison.checks.filter((c) => c.status === "disagree").length} disagreement(s)
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}