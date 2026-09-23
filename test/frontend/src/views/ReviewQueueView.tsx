import { useState, useEffect } from "react";
import {
  getSessions,
  getSession,
  adjudicateSession,
  SCREEN_DOC_LABELS,
  type ScreeningSession,
  type ScreeningSessionDetail,
  type DocType,
} from "../api";
import { useAuth } from "../app/state";

export function ReviewQueueView() {
  const { toast } = useAuth();
  const [sessions, setSessions] = useState<ScreeningSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScreeningSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionNotes, setActionNotes] = useState("");
  const [adjudicating, setAdjudicating] = useState(false);

  const fetchQueue = async () => {
    setLoading(true);
    const res = await getSessions();
    setLoading(false);
    if (res.data) {
      setSessions(res.data);
      if (res.data.length > 0 && !selectedId) {
        loadDetail(res.data[0].session_id || res.data[0].id);
      }
    } else {
      toast(res.error || "Failed to load review queue", "error");
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    const res = await getSession(id);
    if (res.data) {
      setDetail(res.data);
    } else {
      toast(res.error || "Failed to load session detail", "error");
    }
  };

  const handleAdjudicate = async (verdict: "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE") => {
    if (!selectedId) return;
    setAdjudicating(true);
    const res = await adjudicateSession(selectedId, verdict, actionNotes);
    setAdjudicating(false);
    if (res.data || res.status === 200) {
      toast(`Session adjudicated as ${verdict}`, "success");
      setActionNotes("");
      await fetchQueue();
      if (selectedId) await loadDetail(selectedId);
    } else {
      toast(res.error || "Adjudication failed", "error");
    }
  };

  return (
    <div className="view">
      <div className="panel">
        <h2 className="panel__title">Supervisory Review Queue</h2>
        <p className="panel__body">
          Review escalated border crossings, examine cross-document discrepancies, and record final statutory decisions.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "18px", alignItems: "start" }}>
        {/* Queue List */}
        <div className="panel" style={{ padding: "12px" }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "10px", textTransform: "uppercase" }}>
            Pending Adjudication ({sessions.length})
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "650px", overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: "20px", textAlign: "center" }}>Loading queue...</div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#64748b" }}>Queue is empty.</div>
            ) : (
              sessions.map((s: any) => {
                const sId = s.session_id || s.id;
                const isSelected = sId === selectedId;
                return (
                  <div
                    key={sId}
                    onClick={() => loadDetail(sId)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "6px",
                      border: `1px solid ${isSelected ? "#0b2240" : "#cbd5e1"}`,
                      background: isSelected ? "#f1f5f9" : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.82rem" }}>{sId.substring(0, 12)}...</span>
                      <span className={`chip ${s.status === "FLAGGED" ? "chip--bad" : "chip--warn"}`}>
                        {s.status || "PENDING"}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                      {s.checkpoint || "Raxaul ICP"} · {s.opened_at?.substring(5, 16) || "Recent"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Session Detail */}
        <div className="panel">
          {detail ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <span className="k">Active Review Session</span>
                  <h3 style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: "4px" }}>{detail.session_id}</h3>
                  <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
                    Checkpoint: {detail.checkpoint} | Inspector: {detail.opened_by}
                  </div>
                </div>
                <span className={`chip ${detail.status === "FLAGGED" ? "chip--bad" : "chip--ok"}`}>
                  {detail.status}
                </span>
              </div>

              {/* Documents in Session */}
              <div style={{ fontWeight: 700, fontSize: "0.85rem", textTransform: "uppercase", marginBottom: "8px" }}>
                Screened Documents ({detail.documents?.length || 0})
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
                {(detail.documents || []).map((d: any, idx: number) => {
                  const label = SCREEN_DOC_LABELS[d.doc_type as DocType] || d.doc_type;
                  return (
                    <div key={d.id || idx} className="doc-line">
                      <span style={{ fontWeight: 700 }}>DOC {idx + 1}:</span>
                      <span className="chip chip--mute">{label}</span>
                      <span className={`chip ${d.verdict === "FLAGGED" ? "chip--bad" : "chip--ok"}`}>{d.verdict}</span>
                      <span style={{ marginLeft: "auto", fontSize: "0.78rem" }}>
                        Risk Score: <strong>{d.risk_score}</strong>
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Cross Document Agreement */}
              {detail.comparison && (
                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", marginBottom: "20px" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.82rem", marginBottom: "6px" }}>
                    Cross-Document Resolution
                  </div>
                  {detail.comparison.discrepancies?.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: "18px", color: "#dc2626", fontSize: "0.78rem" }}>
                      {detail.comparison.discrepancies.map((disc: string, di: number) => (
                        <li key={di}>{disc}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ color: "#16a34a", fontSize: "0.78rem" }}>
                      ✓ All identity attributes match across presented documents.
                    </div>
                  )}
                </div>
              )}

              {/* Adjudication Box */}
              <div className="adjudicate">
                <div className="adjudicate__note">
                  <label className="field__label">SUPERVISOR ADJUDICATION REMARKS</label>
                  <textarea
                    rows={3}
                    placeholder="Enter official statutory adjudication remarks..."
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                  />
                </div>
                <div className="adjudicate__actions">
                  <button
                    type="button"
                    className="btn btn--ok"
                    onClick={() => handleAdjudicate("CLEARED")}
                    disabled={adjudicating}
                  >
                    GRANT CLEARANCE
                  </button>
                  <button
                    type="button"
                    className="btn btn--warn"
                    onClick={() => handleAdjudicate("INCONCLUSIVE")}
                    disabled={adjudicating}
                  >
                    REFER TO EMBASSY
                  </button>
                  <button
                    type="button"
                    className="btn btn--bad"
                    onClick={() => handleAdjudicate("CONFIRMED_FRAUD")}
                    disabled={adjudicating}
                  >
                    CONFIRM FRAUD
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
              Select a session from the review queue to inspect details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReviewQueueView;