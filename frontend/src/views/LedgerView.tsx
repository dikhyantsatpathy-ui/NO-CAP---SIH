// ============================================================================
// LedgerView.tsx — the verified session ledger & border statistics (SIH26188).
// Each closed session contributes exactly ONE chained SHA-256 block built from
// canonical hashed session data. Every document continues to carry its own
// masked audit row on the screen pipeline.
//
// Features:
//   - Cryptographic hash-chain inspection (oldest to newest) with verification,
//   - Nested expandable sub-tables for block payloads and custody,
//   - Border-wide screening statistics & operational health (IST) overview.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import {
  getSessionLedger,
  getStatsOverview,
  verifySessionLedger,
  type SessionLedgerPayload,
  type SessionLedgerVerify,
  type StatsOverview,
} from "../api";
import { useToast } from "../app/state";
import { copyText, shortHash, timeLabelIst } from "../app/util";
import { plainCompare, plainStatus, plainVerdict, riskWord } from "../app/english";

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
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, v, s] = await Promise.all([
      getSessionLedger(),
      verifySessionLedger(),
      getStatsOverview(),
    ]);
    if (p.ok) setPayload(p.data);
    if (v.ok) setVerify(v.data);
    if (s.ok) setStats(s.data);
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
        res.data.valid
          ? `Records verified — nothing has been changed.`
          : `A record was changed — chain broken at ${res.data.broken_at || "?"}`,
        res.data.valid ? "success" : "error",
      );
    } else {
      toast(res.error, "error");
    }
  };

  const blocks = payload?.blocks || [];

  // Calculate hourly max for normalized histogram
  const hourlyData = stats?.reports.hourly_ist || {};
  const maxHourly = Math.max(...Object.values(hourlyData), 1);

  return (
    <div className="view">
      {/* --- Border Screening Statistics Ribbon -------------------------- */}
      <section className="stats-ribbon">
        <div className="stats-ribbon__head">
          <div>
            <h2 className="panel__title" style={{ margin: 0 }}>Border operations at a glance</h2>
            <p className="panel__body" style={{ margin: 0 }}>
              Live numbers for the last 24 hours, shown in Indian time (IST). Nothing readable is
              ever stored — only counts and grouped results.
            </p>
          </div>
          <button
            type="button"
            className="subtable-toggle"
            onClick={() => setShowStats((v) => !v)}
          >
            {showStats ? "▼ Hide activity" : "▶ See today's activity"}
          </button>
        </div>

        {stats && (
          <div className="stats-ribbon__kpis">
            <div className="stats-kpi-card">
              <span className="stats-kpi-card__lbl">DOCUMENTS SCREENED</span>
              <span className="stats-kpi-card__val">{stats.reports.total_screens}</span>
            </div>
            <div className="stats-kpi-card">
              <span className="stats-kpi-card__lbl">SESSIONS CLOSED</span>
              <span className="stats-kpi-card__val">{stats.sessions.total_sessions}</span>
            </div>
            <div className="stats-kpi-card">
              <span className="stats-kpi-card__lbl">SENT FOR REVIEW</span>
              <span className="stats-kpi-card__val" style={{ color: "var(--bad)" }}>
                {stats.reports.flagged_count}
              </span>
            </div>
            <div className="stats-kpi-card">
              <span className="stats-kpi-card__lbl">MEDIAN CHECK TIME</span>
              <span className="stats-kpi-card__val">
                {stats.reports.latency_ms.p50 != null ? `${stats.reports.latency_ms.p50}ms` : "—"}
              </span>
            </div>
            <div className="stats-kpi-card">
              <span className="stats-kpi-card__lbl">THROUGHPUT</span>
              <span className="stats-kpi-card__val">
                {stats.throughput.per_minute.toFixed(1)}/min
              </span>
            </div>
          </div>
        )}

        {showStats && stats && (
          <div className="subtable-container">
            <div className="subtable-pane">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span className="k" style={{ fontSize: 11 }}>ACTIVITY BY HOUR (IST)</span>
                <span className="muted mono" style={{ fontSize: 11 }}>
                  Peak: {maxHourly} scans/hr · Indian time (IST)
                </span>
              </div>
              <div className="stats-bars">
                {Array.from({ length: 24 }).map((_, h) => {
                  const cnt = hourlyData[h] || 0;
                  const pct = Math.round((cnt / maxHourly) * 100);
                  return (
                    <div key={h} className="stats-bar-col" title={`Hour ${h}:00 IST — ${cnt} screenings`}>
                      <div className="stats-bar-fill" style={{ height: `${Math.max(pct, 6)}%` }} />
                      <span className="stats-bar-hr">{h % 3 === 0 ? h : ""}</span>
                    </div>
                  );
                })}
              </div>

              <div className="subtable-grid" style={{ marginTop: 14 }}>
                <div className="subtable-grid__cell">
                  <span className="subtable-grid__label">Check results</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    {Object.entries(stats.reports.verdicts).map(([v, count]) => (
                      <span key={v} className="chip chip--mute">
                        {plainVerdict(v)}: {count}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="subtable-grid__cell">
                  <span className="subtable-grid__label">Risk level</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    {Object.entries(stats.reports.risk_buckets).map(([b, count]) => (
                      <span key={b} className="chip chip--mute">
                        {b}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* --- Protected Session Ledger ------------------------------------ */}
      <section className="panel">
        <div className="panel__row">
          <div>
            <h2 className="panel__title">The signed record</h2>
            <p className="panel__body">
              One tamper-proof entry per closed session, chained to the entry before it. Only masked
              fingerprints and results are stored — no readable details.
            </p>
          </div>
          <button type="button" className="btn" onClick={() => void load()}>
            Reload
          </button>
        </div>

        <div className="ledger-head">
          <div className="stat">
            <span className="stat__label">SIGNED RECORDS</span>
            <span className="stat__value mono">{payload?.total_blocks ?? "—"}</span>
          </div>
          <div className="stat">
            <span className="stat__label">NEWEST ENTRY</span>
            <span className="stat__value mono stat__value--sm">{shortHash(payload?.head_hash, 26)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">RECORDS CHECKED</span>
            <span className={`stat__value ${verify ? (verify.valid ? "t-ok" : "t-bad") : "t-mute"}`}>
              {verifying ? "CHECKING…" : verify ? (verify.valid ? "PASSED" : "BROKEN") : "NOT YET"}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={verifying}
            onClick={() => void runVerify()}
          >
            {verifying ? "Checking…" : "Check the records"}
          </button>
        </div>

        {verify && !verify.valid && (
          <p className="banner banner--bad">
            A record was changed — the chain is broken at {verify.broken_at || "an unknown entry"}. {verify.reason || ""}
          </p>
        )}
        {verify && verify.valid && verify.total_blocks > 0 && (
          <p className="hint">
            Re-checked every entry from oldest to newest — each one still points to the entry before
            it, so nothing has been changed.
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
                    <span className="block__no">
                      {b.label || `Record ${String(i + 1).padStart(3, "0")}`}
                    </span>
                    {i === 0 && <span className="chip chip--seal">FIRST ENTRY</span>}
                    <span className={`chip ${verdictChip(b.verdict)}`}>{plainVerdict(b.verdict) || plainStatus(b.status)}</span>
                    <span className="block__meta">
                      {b.checkpoint} · {b.document_count} document(s) · {riskWord(b.risk_score)}
                    </span>
                    <button
                      type="button"
                      className="subtable-toggle"
                      onClick={() => setExpanded((cur) => (cur === b.id ? null : b.id))}
                    >
                      {expanded === b.id ? "▼ Hide" : "▶ See details"}
                    </button>
                  </header>
                  <div className="block__grid">
                    <div className="block__cell">
                      <span className="k">ENTRY BEFORE</span>
                      <code className="hash mono">{b.prev_hash || "NONE — FIRST"}</code>
                    </div>
                    <div className="block__cell">
                      <span className="k">THIS ENTRY'S FINGERPRINT</span>
                      <code className="hash mono">{b.block_hash}</code>
                    </div>
                  </div>
                  <div className="block__meta mono">
                    signed {timeLabelIst(b.created_at_ist || b.closed_at || b.updated_at)} · {b.screener || "officer"}
                    {b.adjudicator ? ` · settled by ${b.adjudicator}` : ""}
                  </div>

                  {/* Nested Sub-Table for Block Payload */}
                  {expanded === b.id && (
                    <div className="subtable-container" style={{ margin: "10px 0 0" }}>
                      <div className="subtable-pane">
                        <span className="k" style={{ fontSize: 11, marginBottom: 8, display: "block" }}>
                          RECORD DETAILS (FOR AUDIT)
                        </span>
                        <table className="tbl tbl--compact">
                          <tbody>
                            <tr>
                              <td className="k">SESSION</td>
                              <td className="mono">{b.id}</td>
                            </tr>
                            <tr>
                              <td className="k">FULL FINGERPRINT</td>
                              <td className="mono" style={{ wordBreak: "break-all" }}>
                                {b.block_hash}{" "}
                                <button
                                  type="button"
                                  className="btn btn--small"
                                  style={{ padding: "1px 6px", marginLeft: 6 }}
                                  onClick={() => void copyText(b.block_hash || "")}
                                >
                                  Copy
                                </button>
                              </td>
                            </tr>
                            <tr>
                              <td className="k">OFFICER NOTE</td>
                              <td>{b.note || "No remarks"}</td>
                            </tr>
                            {b.comparison && (
                              <tr>
                                <td className="k">DO THE DOCUMENTS AGREE?</td>
                                <td>
                                  <span className={`chip chip--${b.comparison.verdict === "CONSISTENT" ? "ok" : "bad"}`}>
                                    {plainCompare(b.comparison.verdict)}
                                  </span>{" "}
                                  · risk +{b.comparison.risk_bump} ·{" "}
                                  {b.comparison.checks.filter((c) => c.status === "disagree").length} clashing detail(s)
                                </td>
                              </tr>
                            )}
                            {b.comparison?.zkp_gates && (
                              <tr>
                                <td className="k">PRIVACY CHECKS</td>
                                <td>
                                  {Object.values(b.comparison.zkp_gates).map((g, gi) => (
                                    <span key={gi} className="chip chip--seal" style={{ marginRight: 6 }}>
                                      {g.assertion}: {g.status}
                                    </span>
                                  ))}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
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