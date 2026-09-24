// ============================================================================
// LedgerView.tsx — the verified session ledger & border statistics (SIH26188).
// Each closed session contributes exactly ONE chained SHA-256 block built from
// canonical hashed session data.
//
// QoL Features:
//   - Flexible sorting (Date/Time Newest/Oldest, Risk, Session Number, Doc Count),
//   - Real-time search across session labels, IDs, post names, officers, and hashes,
//   - Filter by decision status and border post,
//   - One-click CSV and JSON ledger export for court compliance & offline audits,
//   - Expand all / Collapse all audit payloads toggle,
//   - Direct Section 65B BSA court certificate links on every block.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getBsaCertificateUrl,
  getSessionLedger,
  getStatsOverview,
  verifySessionLedger,
  type SessionLedgerPayload,
  type SessionLedgerVerify,
  type StatsOverview,
} from "../api";
import { useToast } from "../app/state";
import { copyText, downloadBlob, parseUtc, shortHash, timeLabelIst } from "../app/util";
import { plainCompare, plainStatus, plainVerdict, riskWord } from "../app/english";

function verdictChip(verdict: string | null): string {
  if (verdict === "CLEAR") return "chip--ok";
  if (verdict === "FLAGGED" || verdict === "CONFIRMED_FRAUD") return "chip--bad";
  if (verdict === "REVIEW") return "chip--warn";
  return "chip--mute";
}

type SortOption = "time_desc" | "time_asc" | "risk_desc" | "risk_asc" | "label_asc" | "docs_desc";

import { portalCache } from "../app/preloader";

export function LedgerView() {
  const { toast } = useToast();
  const [payload, setPayload] = useState<SessionLedgerPayload | null>(() => portalCache.ledgerPayload);
  const [verify, setVerify] = useState<SessionLedgerVerify | null>(() => portalCache.ledgerVerify);
  const [stats, setStats] = useState<StatsOverview | null>(() => portalCache.statsOverview);
  const [showStats, setShowStats] = useState(false);
  const [loading, setLoading] = useState(() => !portalCache.ledgerPayload);
  const [verifying, setVerifying] = useState(false);

  // QoL Controls State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("time_desc");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "rejected">("all");
  const [checkpointFilter, setCheckpointFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    // 1. Fetch ledger blocks first for instant display
    const pPromise = getSessionLedger().then((p) => {
      if (p.ok) {
        portalCache.ledgerPayload = p.data;
        setPayload(p.data);
      }
      setLoading(false);
    });

    // 2. Fetch verify and stats concurrently
    const vPromise = verifySessionLedger().then((v) => {
      if (v.ok) {
        portalCache.ledgerVerify = v.data;
        setVerify(v.data);
      }
    });

    const sPromise = getStatsOverview().then((s) => {
      if (s.ok) {
        portalCache.statsOverview = s.data;
        setStats(s.data);
      }
    });

    await Promise.all([pPromise, vPromise, sPromise]);
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
          ? "Records verified — all cryptographic hashes match."
          : `A record was changed — chain broken at ${res.data.broken_at || "?"}`,
        res.data.valid ? "success" : "error",
      );
    } else {
      toast(res.error, "error");
    }
  };

  const rawBlocks = payload?.blocks || [];

  // Extract unique checkpoints for filtering (memoized)
  const checkpointsList = useMemo(
    () => Array.from(new Set(rawBlocks.map((b) => b.checkpoint).filter(Boolean))).sort(),
    [rawBlocks],
  );

  // Filter and sort pipeline (memoized to prevent re-filtering on card expand/collapse)
  const sortedBlocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = rawBlocks.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (checkpointFilter !== "all" && b.checkpoint !== checkpointFilter) return false;
      if (q) {
        const matchLabel = b.label && b.label.toLowerCase().includes(q);
        const matchId = b.id && b.id.toLowerCase().includes(q);
        const matchHash = b.block_hash && b.block_hash.toLowerCase().includes(q);
        const matchPost = b.checkpoint && b.checkpoint.toLowerCase().includes(q);
        const matchOfficer = b.screener && b.screener.toLowerCase().includes(q);
        const matchNote = b.note && b.note.toLowerCase().includes(q);
        if (!matchLabel && !matchId && !matchHash && !matchPost && !matchOfficer && !matchNote) {
          return false;
        }
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === "time_desc") {
        return parseUtc(b.closed_at || b.created_at) - parseUtc(a.closed_at || a.created_at);
      }
      if (sortBy === "time_asc") {
        return parseUtc(a.closed_at || a.created_at) - parseUtc(b.closed_at || b.created_at);
      }
      if (sortBy === "risk_desc") {
        return (b.risk_score || 0) - (a.risk_score || 0);
      }
      if (sortBy === "risk_asc") {
        return (a.risk_score || 0) - (b.risk_score || 0);
      }
      if (sortBy === "label_asc") {
        return (a.label || a.id).localeCompare(b.label || b.id, undefined, { numeric: true });
      }
      if (sortBy === "docs_desc") {
        return (b.document_count || 0) - (a.document_count || 0);
      }
      return 0;
    });
  }, [rawBlocks, statusFilter, checkpointFilter, searchQuery, sortBy]);

  // Expand / collapse all
  const toggleExpandAll = () => {
    if (expandedIds.size > 0) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(sortedBlocks.map((b) => b.id)));
    }
  };

  const toggleBlock = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Export CSV
  const exportCsv = () => {
    if (!sortedBlocks.length) {
      toast("No records to export.", "warn");
      return;
    }
    const headers = [
      "Index",
      "Session Label",
      "Session ID",
      "Status",
      "Verdict",
      "Risk Score",
      "Checkpoint",
      "Screener",
      "Adjudicator",
      "Closed At (IST)",
      "Block Hash (SHA-256)",
      "Previous Hash",
      "Document Count",
      "Officer Note",
    ];
    const rows = sortedBlocks.map((b, i) => [
      i + 1,
      `"${(b.label || "").replace(/"/g, '""')}"`,
      `"${b.id}"`,
      `"${b.status}"`,
      `"${b.verdict}"`,
      b.risk_score ?? 0,
      `"${(b.checkpoint || "").replace(/"/g, '""')}"`,
      `"${(b.screener || "").replace(/"/g, '""')}"`,
      `"${(b.adjudicator || "").replace(/"/g, '""')}"`,
      `"${(b.created_at_ist || b.closed_at || "").replace(/"/g, '""')}"`,
      `"${b.block_hash || ""}"`,
      `"${b.prev_hash || ""}"`,
      b.document_count ?? 0,
      `"${(b.note || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `SSB_BORDER_LEDGER_${dateStr}.csv`);
    toast("Ledger exported as CSV successfully.", "success");
  };

  // Export JSON
  const exportJson = () => {
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `SSB_BORDER_LEDGER_${dateStr}.json`);
    toast("Ledger exported as JSON successfully.", "success");
  };

  const hasActiveFilters = searchQuery.trim() !== "" || statusFilter !== "all" || checkpointFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setCheckpointFilter("all");
  };

  // Hourly statistics
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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" className="btn btn--ghost" onClick={exportCsv} title="Download spreadsheet of ledger">
              📊 Export CSV
            </button>
            <button type="button" className="btn btn--ghost" onClick={exportJson} title="Download cryptographic JSON ledger">
              📄 Export JSON
            </button>
            <button type="button" className="btn" onClick={() => void load()}>
              Reload
            </button>
          </div>
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
            <span className="stat__label">INTEGRITY AUDIT</span>
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
            {verifying ? "Checking…" : "Verify hash chain"}
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

        {/* --- QoL Filter & Sorting Toolbar --------------------------------- */}
        <div className="filter-bar">
          <div className="filter-bar__search">
            <span className="filter-bar__search-icon">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search session, post, officer, or hash…"
            />
          </div>

          <div className="filter-bar__group">
            <select
              className="filter-bar__select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              title="Sort order"
            >
              <option value="time_desc">Sort: Date &amp; Time (Newest First)</option>
              <option value="time_asc">Sort: Date &amp; Time (Oldest First · Chain Order)</option>
              <option value="risk_desc">Sort: Highest Risk First</option>
              <option value="risk_asc">Sort: Lowest Risk First</option>
              <option value="label_asc">Sort: Session Number (Session 1, 2...)</option>
              <option value="docs_desc">Sort: Document Count (Most first)</option>
            </select>

            <select
              className="filter-bar__select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "approved" | "rejected")}
              title="Filter by status"
            >
              <option value="all">All Decisions</option>
              <option value="approved">Approved &amp; Signed</option>
              <option value="rejected">Rejected / Evidence</option>
            </select>

            {checkpointsList.length > 1 && (
              <select
                className="filter-bar__select"
                value={checkpointFilter}
                onChange={(e) => setCheckpointFilter(e.target.value)}
                title="Filter by checkpoint"
              >
                <option value="all">All Border Posts ({checkpointsList.length})</option>
                {checkpointsList.map((cp) => (
                  <option key={cp} value={cp}>
                    {cp}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="filter-bar__actions">
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={toggleExpandAll}
            >
              {expandedIds.size > 0 ? "Collapse all" : "Expand all details"}
            </button>
          </div>
        </div>

        {/* Filter Summary */}
        <div className="filter-summary">
          <span>
            Showing <strong>{sortedBlocks.length}</strong> of <strong>{rawBlocks.length}</strong> signed records
            {sortBy === "time_asc" && (
              <span className="chip chip--seal" style={{ marginLeft: 8, fontSize: 10.5 }}>
                Linear Chain Sequence
              </span>
            )}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={clearFilters}
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              ✕ Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <p className="hint">Loading ledger…</p>
        ) : rawBlocks.length === 0 ? (
          <p className="hint">No signed sessions yet. Approve a session on the desk to create the first block.</p>
        ) : sortedBlocks.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", background: "var(--panel-2)", borderRadius: 8 }}>
            <p className="muted" style={{ margin: "0 0 10px 0" }}>No records match your filter criteria.</p>
            <button type="button" className="btn btn--small btn--primary" onClick={clearFilters}>
              Reset all filters
            </button>
          </div>
        ) : (
          <div className="chain">
            {sortedBlocks.map((b, i) => {
              const isExpanded = expandedIds.has(b.id);
              return (
                <div key={b.id} className="chain__item">
                  {i > 0 && sortBy === "time_asc" && (
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
                      {i === 0 && sortBy === "time_asc" && <span className="chip chip--seal">FIRST ENTRY</span>}
                      <span className={`chip ${verdictChip(b.verdict)}`}>{plainVerdict(b.verdict) || plainStatus(b.status)}</span>
                      <span className="block__meta">
                        {b.checkpoint} · {b.document_count} document(s) · {riskWord(b.risk_score)}
                      </span>
                      <button
                        type="button"
                        className="subtable-toggle"
                        onClick={() => toggleBlock(b.id)}
                      >
                        {isExpanded ? "▼ Hide" : "▶ See details"}
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
                    <div className="block__meta mono" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <span>
                        signed {timeLabelIst(b.created_at_ist || b.closed_at || b.updated_at)} · {b.screener || "officer"}
                        {b.adjudicator ? ` · settled by ${b.adjudicator}` : ""}
                      </span>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button
                          type="button"
                          className="btn btn--small btn--ghost"
                          style={{ padding: "1px 6px", fontSize: 11 }}
                          onClick={() => window.open(getBsaCertificateUrl(b.id), "_blank")}
                        >
                          📄 Court certificate
                        </button>
                        <button
                          type="button"
                          className="btn btn--small"
                          style={{ padding: "1px 6px", fontSize: 11 }}
                          onClick={() => {
                            void copyText(b.block_hash || "");
                            toast("Block hash copied.", "success");
                          }}
                        >
                          Copy hash
                        </button>
                      </div>
                    </div>

                    {/* Nested Sub-Table for Block Payload */}
                    {isExpanded && (
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
                                    onClick={() => {
                                      void copyText(b.block_hash || "");
                                      toast("Block hash copied.", "success");
                                    }}
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
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}