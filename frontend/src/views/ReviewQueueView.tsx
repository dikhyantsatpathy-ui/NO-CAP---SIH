// ============================================================================
// ReviewQueueView.tsx — supervisory review queue. FLAGGED sessions arrive here
// from the desk; a supervisor (super admin) adjudicates them:
//   CLEARED → session is signed into the ledger as an approved block.
//   CONFIRMED_FRAUD → session is signed as a REJECTED evidence block.
//   INCONCLUSIVE → signed as rejected, review note recorded.
// Settled sessions stay listed for audit. No raw identifiers rendered.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import {
  adjudicateSession,
  getSession,
  getSessions,
  type ScreeningSession,
  type ScreeningSessionDetail,
} from "../api";
import { useAuth, useToast } from "../app/state";
import { shortHash, timeLabel } from "../app/util";

type Decision = "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE";

const DECISION_META: Record<Decision, { label: string; tone: string; desc: string }> = {
  CLEARED: {
    label: "CLEARED",
    tone: "ok",
    desc: "No genuine discrepancy — session approved and signed into the ledger.",
  },
  CONFIRMED_FRAUD: {
    label: "CONFIRMED_FRAUD",
    tone: "bad",
    desc: "Fraud confirmed — session signed into the ledger as rejected evidence.",
  },
  INCONCLUSIVE: {
    label: "INCONCLUSIVE",
    tone: "warn",
    desc: "Cannot settle — session signed as rejected with the review note.",
  },
};

function FlaggedCard({
  flag,
  isSuper,
  onAdjudicate,
  busyId,
}: {
  flag: ScreeningSession;
  isSuper: boolean;
  onAdjudicate: (id: string, decision: Decision, note: string) => void;
  busyId: string | null;
}) {
  const [detail, setDetail] = useState<ScreeningSessionDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const { toast } = useToast();

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
      <header className="queue-card__head" role="button" tabIndex={0} onClick={() => void toggle()} onKeyDown={(e) => e.key === "Enter" && void toggle()}>
        <span className="chip chip--warn">FLAGGED</span>
        <span className="mono queue-card__id">{flag.id}</span>
        <span className="chip chip--mute">{flag.checkpoint}</span>
        <span className="queue-card__meta">
          {flag.document_count} doc(s) · risk {flag.risk_score ?? "—"} ·{" "}
          {timeLabel(flag.closed_at || flag.updated_at)}
        </span>
        <span className="queue-card__toggle">{expanded ? "▾" : "▸"}</span>
      </header>

      {flag.note && <p className="queue-card__note">desk note: {flag.note}</p>}
      {flag.adjudicator && (
        <p className="queue-card__settle">
          settled by {flag.adjudicator} · {flag.verdict} · {timeLabel(flag.adjudicated_at || "")}
        </p>
      )}

      {expanded && (
        <div className="queue-card__body">
          {checks.length > 0 && (
            <table className="tbl tbl--compact">
              <tbody>
                {checks.map((c) => (
                  <tr key={c.field}>
                    <td>
                      <span className="k">{c.label}</span>
                    </td>
                    <td>
                      <span className={`chip chip--${c.status === "agree" ? "ok" : c.status === "disagree" ? "bad" : c.status === "cross-script" ? "info" : "mute"}`}>
                        {c.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="cell-detail">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="docs docs--stack">
            {docs.map((d, i) => (
              <div key={d.id} className="doc-line">
                <span>DOC {String(i + 1).padStart(2, "0")}</span>
                <span className={`chip chip--${d.verdict === "CLEAR" ? "ok" : d.verdict === "FLAGGED" ? "bad" : "warn"}`}>{d.verdict}</span>
                <span className="muted">{d.doc_type}</span>
                <span className="mono muted">file {shortHash(d.file_hash, 14)}</span>
                <span className="mono muted">risk {d.risk_score}</span>
              </div>
            ))}
          </div>

          {isSuper && flag.status === "flagged" && (
            <div className="adjudicate">
              <div className="adjudicate__note">
                <span className="k">REVIEW NOTE</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="supervisory finding (optional)" />
              </div>
              <div className="adjudicate__actions">
                {(Object.keys(DECISION_META) as Decision[]).map((d) => (
                  <button
                    key={d}
                    className={`btn btn--${DECISION_META[d].tone}`}
                    disabled={busyId === flag.id}
                    onClick={() => onAdjudicate(flag.id, d, note)}
                  >
                    {busyId === flag.id ? "SIGNING…" : DECISION_META[d].label}
                  </button>
                ))}
              </div>
              <p className="hint">Any decision signs the session into the ledger with its verdict embedded.</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function ReviewQueueView() {
  const { toast } = useToast();
  const { me } = useAuth();
  const isSuper = !!me?.is_super_admin;
  const [flagged, setFlagged] = useState<ScreeningSession[]>([]);
  const [settled, setSettled] = useState<ScreeningSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      toast(`Session ${id.slice(0, 8)}… signed as ${decision}.`, "success");
      await load();
    } else {
      toast(res.error, "error");
    }
  };

  if (!isSuper) {
    return (
      <div className="view">
        <section className="panel panel--muted">
          <h2 className="panel__title">REVIEW QUEUE — SUPERVISORY ACCESS ONLY</h2>
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
      <section className="panel">
        <div className="panel__row">
          <div>
            <h2 className="panel__title">REVIEW QUEUE — FLAGGED SESSIONS</h2>
            <p className="panel__body">
              Adjudicate each flagged session. The decision is verified here and signed into the
              session ledger with the verdict embedded.
            </p>
          </div>
          <button className="btn" onClick={() => void load()}>
            REFRESH
          </button>
        </div>

        {loading ? (
          <p className="hint">Loading queue…</p>
        ) : flagged.length === 0 ? (
          <p className="hint">No sessions awaiting adjudication.</p>
        ) : (
          <div className="queue">
            {flagged.map((f) => (
              <FlaggedCard key={f.id} flag={f} isSuper={isSuper} onAdjudicate={adjudicate} busyId={busyId} />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">RECENTLY SIGNED SESSIONS</h2>
        {settled.length === 0 ? (
          <p className="hint">No sessions signed yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Session</th>
                <th>Status</th>
                <th>Verdict</th>
                <th>Risk</th>
                <th>Checkpoint</th>
                <th>Docs</th>
                <th>Screened by</th>
                <th>Closed</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {settled.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.id}</td>
                  <td>
                    <span className={`chip chip--${s.status === "approved" ? "ok" : s.status === "rejected" ? "bad" : "warn"}`}>{s.status.toUpperCase()}</span>
                  </td>
                  <td>{s.verdict || "—"}</td>
                  <td>{s.risk_score}</td>
                  <td>{s.checkpoint}</td>
                  <td>{s.document_count}</td>
                  <td>{s.screener || "—"}</td>
                  <td className="mono">{timeLabel(s.closed_at || "")}</td>
                  <td className="mono" title={s.block_hash || ""}>{shortHash(s.block_hash, 18)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}