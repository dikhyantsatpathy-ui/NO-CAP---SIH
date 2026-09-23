// ============================================================================
// ReviewQueueView.tsx — supervisory review queue. FLAGGED sessions arrive here
// from the desk; a supervisor (super admin) adjudicates them:
//   CLEARED → session is signed into the ledger as an approved block.
//   CONFIRMED_FRAUD → session is signed as a REJECTED evidence block.
//   INCONCLUSIVE → signed as rejected, review note recorded.
// Settled sessions stay listed for audit with interactive expandable sub-tables.
// No raw identifiers rendered.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adjudicateSession,
  getBsaCertificateUrl,
  getSession,
  getSessions,
  SCREEN_DOC_LABELS,
  type ScreenDocType,
  type ScreeningSession,
  type ScreeningSessionDetail,
} from "../api";
import { useAuth, useToast } from "../app/state";
import { copyText, shortHash, timeLabelIst } from "../app/util";
import { plainCompare, plainStatus, plainVerdict, riskWord } from "../app/english";

type Decision = "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE";

const DECISION_META: Record<Decision, { label: string; tone: string; desc: string }> = {
  CLEARED: {
    label: "Approve — looks genuine",
    tone: "ok",
    desc: "No genuine discrepancy — session approved and signed into the ledger.",
  },
  CONFIRMED_FRAUD: {
    label: "Fraud confirmed",
    tone: "bad",
    desc: "Fraud confirmed — session signed into the ledger as rejected evidence.",
  },
  INCONCLUSIVE: {
    label: "Can't be settled",
    tone: "warn",
    desc: "Cannot settle — session signed as rejected with the review note.",
  },
};

function FlaggedCard({
  flag,
  isSuper,
  onAdjudicate,
  busyId,
  forceExpand,
}: {
  flag: ScreeningSession;
  isSuper: boolean;
  onAdjudicate: (id: string, decision: Decision, note: string) => void;
  busyId: string | null;
  forceExpand?: boolean | null;
}) {
  const [detail, setDetail] = useState<ScreeningSessionDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (forceExpand === true) {
      if (!detail) {
        getSession(flag.id).then((res) => {
          if (res.ok) setDetail(res.data);
        }).catch(() => {});
      }
      setExpanded(true);
    } else if (forceExpand === false) {
      setExpanded(false);
    }
  }, [forceExpand, flag.id, detail]);

  const toggle = async () => {
    if (!expanded && !detail) {
      const res = await getSession(flag.id);
      if (res.ok) setDetail(res.data);
      else toast(res.error, "error");
    }
    setExpanded((v) => !v);
  };

  const docs = detail?.documents || [];
  const checks = detail?.comparison?.checks || [];

  return (
    <article className={`queue-card queue-card--${flag.status === "rejected" ? "bad" : "warn"}`}>
      <header
        className="queue-card__head"
        role="button"
        tabIndex={0}
        onClick={() => void toggle()}
        onKeyDown={(e) => e.key === "Enter" && void toggle()}
      >
        <span className="chip chip--warn">Possible fraud</span>
        <span className="queue-card__id">
          {flag.label || `Session · ${flag.id.slice(0, 6)}`}
          <span className="mono muted" style={{ fontSize: 10.5, marginLeft: 8 }}>{flag.id}</span>
        </span>
        <span className="chip chip--mute">{flag.checkpoint}</span>
        {flag.nationality && <span className="chip chip--info">Nationality: {flag.nationality}</span>}
        <span className="queue-card__meta">
          {flag.document_count} document(s) · {riskWord(flag.risk_score)} ·{" "}
          {timeLabelIst(flag.created_at_ist || flag.closed_at || flag.updated_at)}
        </span>
        <span className="queue-card__toggle">{expanded ? "▼" : "▶"}</span>
      </header>

      {flag.note && <p className="queue-card__note">desk note: {flag.note}</p>}
      {flag.adjudicator && (
        <p className="queue-card__settle">
          settled by {flag.adjudicator} · {flag.verdict} · {timeLabelIst(flag.adjudicated_at || "")}
        </p>
      )}

      {expanded && (
        <div className="queue-card__body">
          {/* Sub-table: Comparison discrepancies */}
          {checks.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <span className="k" style={{ fontSize: 11 }}>DO THE DOCUMENTS AGREE?</span>
              <table className="tbl tbl--compact" style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Detail</th>
                    <th>Result</th>
                    <th>What it means / reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.field}>
                      <td>
                        <span className="k">{c.label}</span>
                        <span className="cell-sub mono">{c.field}</span>
                      </td>
                      <td>
                        <span
                          className={`chip chip--${
                            c.status === "agree"
                              ? "ok"
                              : c.status === "disagree"
                                ? "bad"
                                : c.status === "cross-script"
                                  ? "info"
                                  : "mute"
                          }`}
                        >
                          {plainCompare(c.status)}
                        </span>
                      </td>
                      <td className="cell-detail">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sub-table: Screened documents list */}
          <div style={{ marginBottom: 12 }}>
            <span className="k" style={{ fontSize: 11 }}>DOCUMENTS SCREENED ({docs.length})</span>
            <table className="tbl tbl--compact" style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th>Doc</th>
                  <th>Type</th>
                  <th>Result</th>
                  <th>Risk</th>
                  <th>Masked identifier</th>
                  <th>File fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d, i) => {
                  const mFields = Object.entries(d.masked_fields || {}).filter(([, v]) => v != null);
                  const displayId = mFields.length > 0 ? `${mFields[0][0]}: ${String(mFields[0][1])}` : "—";
                  return (
                    <tr key={d.id}>
                      <td className="mono">DOC {String(i + 1).padStart(2, "0")}</td>
                      <td>
                        <span className="chip chip--mute">
                          {SCREEN_DOC_LABELS[d.doc_type as ScreenDocType] || d.doc_type}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`chip chip--${
                            d.verdict === "CLEAR"
                              ? "ok"
                              : d.verdict === "FLAGGED"
                                ? "bad"
                                : "warn"
                          }`}
                        >
                          {plainVerdict(d.verdict)}
                        </span>
                      </td>
                      <td className="muted">{riskWord(d.risk_score)}</td>
                      <td className="mono muted">{displayId}</td>
                      <td className="mono" title={d.file_hash || ""}>
                        {shortHash(d.file_hash, 16)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Supervisor decision panel */}
          {isSuper && flag.status === "flagged" && (
            <div className="adjudicate">
              <div className="adjudicate__note">
                <span className="k">Supervisor's finding</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="what did you find? — this is kept in the record"
                />
              </div>
              <div className="adjudicate__actions">
                {(Object.keys(DECISION_META) as Decision[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`btn btn--${DECISION_META[d].tone}`}
                    disabled={busyId === flag.id}
                    onClick={() => onAdjudicate(flag.id, d, note)}
                  >
                    {busyId === flag.id ? "Signing…" : DECISION_META[d].label}
                  </button>
                ))}
              </div>
              <p className="hint">
                This decision is permanent — the session is sealed into the log the moment you sign.
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ----------------------------------------------------------------------------
// Settled session row with expandable sub-table
// ----------------------------------------------------------------------------

function SettledSessionRow({ session }: { session: ScreeningSession }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ScreeningSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const toggle = async () => {
    if (!expanded && !detail) {
      setLoading(true);
      const res = await getSession(session.id);
      setLoading(false);
      if (res.ok) setDetail(res.data);
      else toast(`Failed to load session details: ${res.error}`, "error");
    }
    setExpanded((v) => !v);
  };

  const docs = detail?.documents || [];

  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="subtable-toggle"
            style={{ padding: "2px 6px", fontSize: 11 }}
            onClick={() => void toggle()}
          >
            {expanded ? "▼" : "▶"} {session.label || `Session · ${session.id.slice(0, 6)}`}
          </button>
        </td>
        <td>
          <span
            className={`chip chip--${
              session.status === "approved"
                ? "ok"
                : session.status === "rejected"
                  ? "bad"
                  : "warn"
            }`}
          >
            {plainStatus(session.status)}
          </span>
        </td>
        <td>{plainVerdict(session.verdict)}</td>
        <td className="muted">{riskWord(session.risk_score)}</td>
        <td>{session.checkpoint}</td>
        <td className="mono">{session.document_count}</td>
        <td>{session.screener || "—"}</td>
        <td className="mono">{timeLabelIst(session.created_at_ist || session.closed_at || "")}</td>
        <td className="mono" title={session.block_hash || ""}>
          {shortHash(session.block_hash, 16)}
        </td>
      </tr>

      {/* Expandable nested sub-table for settled session */}
      {expanded && (
        <tr>
          <td colSpan={9} style={{ padding: 0, background: "var(--panel-2)" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span className="k" style={{ fontSize: 11 }}>
                  {session.label || `Session ${session.id.slice(0, 6)}`} — what was screened ({docs.length} documents)
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => window.open(getBsaCertificateUrl(session.id), "_blank")}
                  >
                    BSA 2023 · court copy
                  </button>
                  {session.block_hash && (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => void copyText(session.block_hash || "")}
                    >
                      Copy record seal
                    </button>
                  )}
                </div>
              </div>

              {loading ? (
                <p className="hint">Loading document manifest…</p>
              ) : docs.length === 0 ? (
                <p className="hint">No documents attached.</p>
              ) : (
                <table className="tbl tbl--compact" style={{ background: "var(--panel)" }}>
                  <thead>
                    <tr>
                      <th>Doc</th>
                      <th>Type</th>
                      <th>Result</th>
                      <th>Risk</th>
                      <th>Extracted mask</th>
                      <th>File fingerprint</th>
                      <th>Scanned (IST)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d, idx) => {
                      const mFields = Object.entries(d.masked_fields || {}).filter(([, v]) => v != null);
                      const maskStr = mFields.length > 0 ? `${mFields[0][0]}: ${String(mFields[0][1])}` : "—";
                      return (
                        <tr key={d.id}>
                          <td className="mono">DOC {String(idx + 1).padStart(2, "0")}</td>
                          <td>
                            <span className="chip chip--mute">
                              {SCREEN_DOC_LABELS[d.doc_type as ScreenDocType] || d.doc_type}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`chip chip--${
                                d.verdict === "CLEAR"
                                  ? "ok"
                                  : d.verdict === "FLAGGED"
                                    ? "bad"
                                    : "warn"
                              }`}
                            >
                              {plainVerdict(d.verdict)}
                            </span>
                          </td>
                          <td className="muted">{riskWord(d.risk_score)}</td>
                          <td className="mono muted">{maskStr}</td>
                          <td className="mono" title={d.file_hash || ""}>
                            {shortHash(d.file_hash, 16)}
                          </td>
                          <td className="mono muted">{d.created_at_ist || timeLabelIst(d.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Supervisory Review Queue View
// ----------------------------------------------------------------------------

export function ReviewQueueView() {
  const { toast } = useToast();
  const { me } = useAuth();
  const isSuper = !!me?.is_super_admin;
  const [flagged, setFlagged] = useState<ScreeningSession[]>([]);
  const [settled, setSettled] = useState<ScreeningSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // QoL Controls: View mode (All / Review / Passed), Search, filters, sort, expand-all
  const [viewSection, setViewSection] = useState<"ALL" | "REVIEW" | "PASSED">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCheckpoint, setFilterCheckpoint] = useState("ALL");
  const [filterRisk, setFilterRisk] = useState("ALL");
  const [sortMode, setSortMode] = useState("time_desc");
  const [forceExpandFlagged, setForceExpandFlagged] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const [f, s] = await Promise.all([getSessions("flagged"), getSessions("approved")]);
    setFlagged(f.ok ? f.data.sessions : []);
    setSettled(s.ok ? s.data.sessions : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const adjudicate = async (id: string, decision: Decision, note: string) => {
    setBusyId(id);
    const res = await adjudicateSession(id, decision, note);
    setBusyId(null);
    if (res.ok) {
      toast(`Session ${id.slice(0, 8)}… settled as ${decision}.`, "success");
      await load();
    } else {
      toast(res.error, "error");
    }
  };

  const checkpoints = useMemo(
    () => Array.from(new Set([...flagged, ...settled].map((s) => s.checkpoint).filter(Boolean))).sort(),
    [flagged, settled],
  );

  const { filteredFlagged, filteredSettled } = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    const filterFn = (s: ScreeningSession) => {
      if (filterCheckpoint !== "ALL" && s.checkpoint !== filterCheckpoint) return false;
      if (filterRisk === "HIGH" && (s.risk_score || 0) < 60) return false;
      if (filterRisk === "MED" && ((s.risk_score || 0) < 30 || (s.risk_score || 0) >= 60)) return false;
      if (filterRisk === "LOW" && (s.risk_score || 0) >= 30) return false;
      if (q) {
        const match =
          (s.label && s.label.toLowerCase().includes(q)) ||
          s.id.toLowerCase().includes(q) ||
          (s.screener && s.screener.toLowerCase().includes(q)) ||
          (s.checkpoint && s.checkpoint.toLowerCase().includes(q)) ||
          (s.note && s.note.toLowerCase().includes(q)) ||
          (s.block_hash && s.block_hash.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    };

    const sortFn = (a: ScreeningSession, b: ScreeningSession) => {
      if (sortMode === "time_asc") {
        return (
          new Date(a.created_at || a.created_at_ist || "").getTime() -
          new Date(b.created_at || b.created_at_ist || "").getTime()
        );
      }
      if (sortMode === "risk_desc") {
        return (b.risk_score || 0) - (a.risk_score || 0);
      }
      // Default time_desc
      return (
        new Date(b.created_at || b.created_at_ist || "").getTime() -
        new Date(a.created_at || a.created_at_ist || "").getTime()
      );
    };

    return {
      filteredFlagged: flagged.filter(filterFn).sort(sortFn),
      filteredSettled: settled.filter(filterFn).sort(sortFn),
    };
  }, [flagged, settled, filterCheckpoint, filterRisk, searchQuery, sortMode]);

  if (!isSuper) {
    return (
      <div className="view">
        <section className="panel panel--muted">
          <h2 className="panel__title">Review queue — supervisory access only</h2>
          <p className="panel__body">
            Flagged sessions are routed here and adjudicated only by an authorised supervisor.
            Your account is not registered as a supervisor.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="view">
      {/* Section Mode Selector: All / Review Queue / Passed Records */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <button
          type="button"
          className={`btn ${viewSection === "ALL" ? "btn--primary" : ""}`}
          onClick={() => setViewSection("ALL")}
          style={{ fontWeight: viewSection === "ALL" ? 700 : 500 }}
        >
          All Records ({flagged.length + settled.length})
        </button>
        <button
          type="button"
          className={`btn ${viewSection === "REVIEW" ? "btn--primary" : ""}`}
          onClick={() => setViewSection("REVIEW")}
          style={{ fontWeight: viewSection === "REVIEW" ? 700 : 500 }}
        >
          ⚠️ Awaiting Review ({flagged.length})
        </button>
        <button
          type="button"
          className={`btn ${viewSection === "PASSED" ? "btn--primary" : ""}`}
          onClick={() => setViewSection("PASSED")}
          style={{ fontWeight: viewSection === "PASSED" ? 700 : 500 }}
        >
          ✅ Passed & Signed ({settled.length})
        </button>
      </div>

      {(viewSection === "ALL" || viewSection === "REVIEW") && (
        <section className="panel">
          <div className="panel__row">
            <div>
              <h2 className="panel__title">Sessions sent for review</h2>
              <p className="panel__body">
                Sessions the desk could not clear are waiting for a supervisor. Expand one to see what
                didn't match and the documents behind it.
              </p>
            </div>
          <button type="button" className="btn" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {/* QoL Filter & Search Bar */}
        <div className="filter-bar">
          <div className="filter-bar__search">
            <span className="filter-bar__search-icon" aria-hidden="true">
              🔍
            </span>
            <input
              type="text"
              placeholder="Search by session name, ID, screener, post, hash…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-bar__group">
            <select
              className="filter-bar__select"
              value={filterCheckpoint}
              onChange={(e) => setFilterCheckpoint(e.target.value)}
              title="Filter by border checkpoint"
            >
              <option value="ALL">All border posts ({checkpoints.length || "0"})</option>
              {checkpoints.map((cp) => (
                <option key={cp} value={cp}>
                  {cp}
                </option>
              ))}
            </select>

            <select
              className="filter-bar__select"
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value)}
              title="Filter by risk score"
            >
              <option value="ALL">All risk levels</option>
              <option value="HIGH">High risk (≥ 60)</option>
              <option value="MED">Moderate risk (30 - 59)</option>
              <option value="LOW">Low risk (&lt; 30)</option>
            </select>

            <select
              className="filter-bar__select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              title="Sort sessions"
            >
              <option value="time_desc">Newest first</option>
              <option value="time_asc">Oldest first</option>
              <option value="risk_desc">Highest risk first</option>
            </select>
          </div>

          <div className="filter-bar__actions">
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => setForceExpandFlagged((prev) => (prev ? false : true))}
              title="Toggle expanded details on all flagged cards"
            >
              {forceExpandFlagged ? "▲ Collapse cards" : "▼ Expand cards"}
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => void load()}
              title="Refresh session queue"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        <div className="filter-summary">
          <span>
            Showing {filteredFlagged.length} of {flagged.length} flagged sessions awaiting review
            {searchQuery.trim() && ` matching "${searchQuery}"`}
            {filterCheckpoint !== "ALL" && ` at ${filterCheckpoint}`}
          </span>
          {(searchQuery || filterCheckpoint !== "ALL" || filterRisk !== "ALL") && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => {
                setSearchQuery("");
                setFilterCheckpoint("ALL");
                setFilterRisk("ALL");
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <p className="hint">Loading queue…</p>
        ) : filteredFlagged.length === 0 ? (
          <p className="hint">
            {flagged.length === 0
              ? "No sessions awaiting adjudication."
              : "No flagged sessions match your search or filter."}
          </p>
        ) : (
          <div className="queue">
            {filteredFlagged.map((f) => (
              <FlaggedCard
                key={f.id}
                flag={f}
                isSuper={isSuper}
                onAdjudicate={adjudicate}
                busyId={busyId}
                forceExpand={forceExpandFlagged}
              />
            ))}
          </div>
        )}
      </section>
      )}

      {(viewSection === "ALL" || viewSection === "PASSED") && (
      <section className="panel">
        <h2 className="panel__title">Signed sessions — the record</h2>
        <p className="panel__body" style={{ marginBottom: 12 }}>
          Expand a session with <span className="mono">[▶]</span> to see the documents behind it, or
          download a court-admissible copy (BSA 2023). Showing {filteredSettled.length} of {settled.length} records.
        </p>

        {filteredSettled.length === 0 ? (
          <p className="hint">
            {settled.length === 0 ? "No sessions signed yet." : "No signed sessions match your filter criteria."}
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Session</th>
                <th>Status</th>
                <th>Result</th>
                <th>Risk</th>
                <th>Checkpoint</th>
                <th>Documents</th>
                <th>Screened by</th>
                <th>Closed (IST)</th>
                <th>Record seal</th>
              </tr>
            </thead>
            <tbody>
              {filteredSettled.map((s) => (
                <SettledSessionRow key={s.id} session={s} />
              ))}
            </tbody>
          </table>
        )}
      </section>
      )}
    </div>
  );
}