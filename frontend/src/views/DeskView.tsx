// ============================================================================
// DeskView.tsx — the border screening desk (SIH26188 session flow).
//
// One traveller = one session. Each document is screened into the session one
// at a time (each pass writes its OWN masked audit row); the desk then reviews
// the cross-document comparison before signing the session into the ledger.
// Approving closes the session and appends a chained SHA-256 block; flagging
// routes it to the supervisory review queue. The desk resets for the next
// traveller. Zero raw identifiers are persisted anywhere.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeSession,
  createSession,
  getSession,
  getSessions,
  SCREEN_DOC_LABELS,
  SCREEN_DOC_TYPES,
  screenDocument,
  type ComparisonCheck,
  type ScreenDocType,
  type ScreeningSession,
  type ScreeningSessionDetail,
  type ScreenReport,
} from "../api";
import { generateSpecimenFile, SPECIMEN_PRESETS } from "../app/specimens";
import { useAuth, useToast } from "../app/state";
import { shortHash, timeLabel } from "../app/util";

const CHECKPOINTS = [
  "Raxaul ICP",
  "Panitanki ICP",
  "Jogbani ICP",
  "Jaigaon ICP",
  "Delhi IGI Airport",
  "Kolkata Airport",
];

function verdictTone(v: string): string {
  return v === "CLEAR" ? "ok" : v === "FLAGGED" ? "bad" : "warn";
}

function statusTone(s: string): string {
  if (s === "agree") return "ok";
  if (s === "disagree") return "bad";
  if (s === "cross-script") return "info";
  return "mute";
}

// ----------------------------------------------------------------------------
// A single screened document's audit card (masked fields only).
// ----------------------------------------------------------------------------

function DocCard({ doc, index }: { doc: ScreenReport; index: number }) {
  const fields = doc.masked_fields || {};
  const entries = Object.entries(fields).filter(([, v]) => v != null && v !== "");
  return (
    <article className="doc-card">
      <header className="doc-card__head">
        <span className="doc-card__no">DOC {String(index + 1).padStart(2, "0")}</span>
        <span className="chip chip--mute">{SCREEN_DOC_LABELS[doc.doc_type as ScreenDocType] || doc.doc_type}</span>
        <span className={`chip chip--${verdictTone(doc.verdict)}`}>{doc.verdict}</span>
        <span className="doc-card__risk">RISK {doc.risk_score}</span>
      </header>
      <div className="doc-card__grid">
        {entries.length === 0 && <span className="muted">No fields extracted.</span>}
        {entries.map(([k, v]) => (
          <div key={k} className="doc-card__field">
            <span className="doc-card__k">{k}</span>
            <span className="doc-card__v mono">{String(v)}</span>
          </div>
        ))}
      </div>
      <footer className="doc-card__foot">
        <span className="mono">{timeLabel(doc.created_at)}</span>
        <span className="mono" title={doc.file_hash || ""}>
          file {shortHash(doc.file_hash, 18)}
        </span>
        <span className="mono" title={doc.block_hash || ""}>
          block {doc.block_hash ? shortHash(doc.block_hash, 18) : "—"}
        </span>
      </footer>
    </article>
  );
}

// ----------------------------------------------------------------------------
// Cross-document comparison board (flags + masks only; no raw values).
// ----------------------------------------------------------------------------

function ComparisonBoard({ checks }: { checks: ComparisonCheck[] }) {
  return (
    <section className="board">
      <h3 className="board__title">CROSS-DOCUMENT COMPARISON</h3>
      <table className="tbl tbl--compact">
        <thead>
          <tr>
            <th>Field</th>
            <th>Status</th>
            <th>Assessment</th>
            <th>On documents</th>
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
                <span className={`chip chip--${statusTone(c.status)}`}>{c.status.toUpperCase()}</span>
              </td>
              <td className="cell-detail">{c.detail}</td>
              <td>
                <span className="mono">{c.docs.join(" + ") || "—"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="board__note">
        Comparison persists only digests and flags. Raw values exist in memory during one
        screening pass and are discarded.
      </p>
    </section>
  );
}

// ----------------------------------------------------------------------------
// Webcam Capture Modal
// ----------------------------------------------------------------------------

function WebcamCapture({ onCapture, onCancel }: { onCapture: (f: File) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      })
      .catch((err) => {
        console.error("Webcam error:", err);
      });
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const file = new File([blob], `webcam_${Date.now()}.jpg`, { type: "image/jpeg" });
              onCapture(file);
            }
          },
          "image/jpeg",
          0.9
        );
      }
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div style={{ background: "#000", padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", maxWidth: "600px", background: "#111" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
          <button className="btn btn--primary" onClick={capture}>
            CAPTURE
          </button>
          <button className="btn" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// The desk
// ----------------------------------------------------------------------------

export function DeskView() {
  const { toast } = useToast();
  const { me } = useAuth();
  const [active, setActive] = useState<ScreeningSessionDetail | null>(null);
  const [openList, setOpenList] = useState<ScreeningSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newCheckpoint, setNewCheckpoint] = useState("Raxaul ICP");
  const [showNewForm, setShowNewForm] = useState(false);
  const [showWebcam, setShowWebcam] = useState(false);

  // Document intake form
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [docType, setDocType] = useState<ScreenDocType>("passport");
  const [docNumber, setDocNumber] = useState("");
  const [declaredName, setDeclaredName] = useState("");
  const [declaredDob, setDeclaredDob] = useState("");
  const [specimenBusy, setSpecimenBusy] = useState(false);
  const [note, setNote] = useState("");
  const [modelHint, setModelHint] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  const refreshOpen = useCallback(async () => {
    const res = await getSessions("open");
    if (res.ok) setOpenList(res.data.sessions);
    return res.ok ? res.data.sessions : [];
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await getSession(id);
    if (res.ok) {
      setActive(res.data);
      setModelHint(null);
    }
  }, []);

  // On mount: reopen the newest OPEN session if there is one, else show start panel.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const open = await refreshOpen();
      if (!mounted) return;
      if (open.length > 0) {
        await loadDetail(open[0].id);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [refreshOpen, loadDetail]);

  const openNewSession = async () => {
    setBusy(true);
    const res = await createSession(newCheckpoint.trim() || "Central Desk");
    setBusy(false);
    if (res.ok) {
      toast(`Session opened — screening ${res.data.id}.`, "success");
      const detail = await getSession(res.data.id);
      if (detail.ok) setActive(detail.data);
      setShowNewForm(false);
      await refreshOpen();
    } else {
      toast(res.error, "error");
    }
  };

  const resumeSession = async (id: string) => {
    await loadDetail(id);
    setShowNewForm(false);
  };

  const loadSpecimen = async (presetId: string) => {
    const preset = SPECIMEN_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSpecimenBusy(true);
    try {
      setDocType(preset.docType);
      setDocNumber(preset.docNumber);
      const f = await generateSpecimenFile(preset);
      setFile(f);
      setFileKey((k) => k + 1);
      setModelHint(`${preset.title} loaded. Review, then SCREEN INTO SESSION.`);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to load specimen", "error");
    } finally {
      setSpecimenBusy(false);
    }
  };

  const declaredMap = (): Record<string, string> => {
    const declKey =
      docType === "passport" || docType === "visa"
        ? "passport"
        : docType === "other"
          ? "declared_number"
          : docType;
    const out: Record<string, string> = {};
    if (docNumber.trim()) out[declKey] = docNumber.trim();
    if (declaredName.trim()) out.name = declaredName.trim();
    if (declaredDob.trim()) out.dob = declaredDob.trim();
    return out;
  };

  const screenIntoSession = async () => {
    if (!active) {
      toast("Open a session first.", "warn");
      return;
    }
    if (!file) {
      toast("Attach an identity document.", "warn");
      return;
    }
    setBusy(true);
    const decl = declaredMap();
    const res = await screenDocument(
      file,
      docType,
      active.checkpoint,
      Object.keys(decl).length ? decl : undefined,
      null,
      active.id,
    );
    setBusy(false);
    if (res.ok) {
      toast(
        res.data.verdict === "CLEAR"
          ? `Document screened CLEAR (${res.data.risk_score}).`
          : `Document screened ${res.data.verdict} (${res.data.risk_score}).`,
        res.data.verdict === "CLEAR" ? "success" : res.data.verdict === "FLAGGED" ? "error" : "warn",
      );
      setFile(null);
      setFileKey((k) => k + 1);
      setDocNumber("");
      setDeclaredName("");
      setDeclaredDob("");
      setModelHint(null);
      await loadDetail(active.id);
    } else {
      toast(res.error, "error");
    }
  };

  const closeSessionNow = async (action: "approve" | "flag") => {
    if (!active) return;
    setBusy(true);
    const res = await closeSession(active.id, action, note);
    setBusy(false);
    if (res.ok) {
      setActive(res.data);
      setNote("");
      toast(
        action === "approve"
          ? "Session approved and signed into the ledger."
          : "Session flagged for supervisory review.",
        action === "approve" ? "success" : "warn",
      );
      await refreshOpen();
    } else {
      toast(res.error, "error");
    }
  };

  const resetDesk = async () => {
    setActive(null);
    setFile(null);
    setFileKey((k) => k + 1);
    setNote("");
    setModelHint(null);
    const open = await refreshOpen();
    if (open.length > 0) await loadDetail(open[0].id);
  };

  const open = active && active.status === "open";
  const closed = active && active.status !== "open";
  const hasDiscrepancy = open && active.comparison?.verdict === "DISCREPANCY";
  const canClose = active && active.comparison?.checks.some((c) => c.status !== "none");

  return (
    <div className="view">
      {/* --- Session status rail ------------------------------------------ */}
      {!active && (
        <section className="panel panel--muted">
          <div className="panel__row">
            <div>
              <h2 className="panel__title">DESK — NO ACTIVE SESSION</h2>
              <p className="panel__body">
                One traveller at a time. Open a session for the person at the counter, screen
                their documents one by one, cross-compare, then approve or flag.
              </p>
            </div>
            <button className="btn btn--primary" onClick={() => setShowNewForm((v) => !v)}>
              {showNewForm ? "Cancel" : "OPEN NEW SESSION"}
            </button>
          </div>
          {showNewForm && (
            <div className="new-session">
              <label className="field">
                <span className="field__label">CHECKPOINT</span>
                <input
                  list="checkpoint-options"
                  value={newCheckpoint}
                  onChange={(e) => setNewCheckpoint(e.target.value)}
                />
                <datalist id="checkpoint-options">
                  {CHECKPOINTS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <button className="btn btn--primary" disabled={busy} onClick={() => void openNewSession()}>
                {busy ? "OPENING…" : "OPEN SESSION"}
              </button>
            </div>
          )}
          {openList.length > 0 && (
            <div className="resume">
              <span className="k">RESUME OPEN SESSION</span>
              <table className="tbl tbl--compact">
                <tbody>
                  {openList.map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{s.id}</td>
                      <td>{s.checkpoint}</td>
                      <td className="cell-sub">{s.document_count} doc(s)</td>
                      <td>
                        <button className="btn btn--small" onClick={() => void resumeSession(s.id)}>
                          RESUME
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* -Active session rail --------------------------------------------- */}
      {active && (
        <div className="session-rail">
          <section className="panel">
            <div className="panel__row">
              <div>
                <div className="k">SESSION</div>
                <div className="session-id mono">{active.id}</div>
                <div className="session-meta">
                  <span className="chip chip--mute">{active.checkpoint}</span>
                  <span className={`chip chip--${active.status === "approved" ? "ok" : active.status === "flagged" ? "warn" : active.status === "rejected" ? "bad" : "mute"}`}>
                    {active.status.toUpperCase()}
                  </span>
                  <span className="muted">opened {timeLabel(active.created_at)}</span>
                  <span className="muted">by {active.screener || me?.name || "officer"}</span>
                  <span className="muted">{active.document_count} doc(s)</span>
                </div>
              </div>
              {open && (
                <button className="btn" onClick={() => void refreshOpen()} disabled={busy}>
                  REFRESH
                </button>
              )}
            </div>

            {open && (
              <>
                {/* --- Document intake ------------------------------------ */}
                <div className="intake">
                  <h3 className="board__title">SCREEN DOCUMENT INTO SESSION</h3>
                  <div className="intake__form">
                    <label className="field">
                      <span className="field__label">DOCUMENT TYPE</span>
                      <select value={docType} onChange={(e) => setDocType(e.target.value as ScreenDocType)}>
                        {SCREEN_DOC_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {SCREEN_DOC_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field__label">DECLARED NUMBER</span>
                      <input
                        value={docNumber}
                        onChange={(e) => setDocNumber(e.target.value)}
                        placeholder="e.g. K1234567"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">DECLARED NAME</span>
                      <input value={declaredName} onChange={(e) => setDeclaredName(e.target.value)} placeholder="optional" />
                    </label>
                    <label className="field">
                      <span className="field__label">DECLARED DOB</span>
                      <input value={declaredDob} onChange={(e) => setDeclaredDob(e.target.value)} placeholder="YYYY-MM-DD" />
                    </label>
                    <label className="dropzone">
                      <input
                        ref={fileInput}
                        key={fileKey}
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                      <span className="dropzone__label">{file ? file.name : "ATTACH DOCUMENT"}</span>
                      <span className="dropzone__hint">JPEG / PNG / WEBP / PDF</span>
                    </label>
                    <button className="btn" style={{ marginBottom: "16px" }} onClick={() => setShowWebcam(true)}>
                      USE WEBCAM
                    </button>
                    <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void screenIntoSession()}>
                      {busy ? "SCREENING…" : "SCREEN INTO SESSION"}
                    </button>
                  </div>
                  <div className="specimen-row">
                    <span className="k">DEMO SPECIMENS</span>
                    {SPECIMEN_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        className="btn btn--small"
                        disabled={specimenBusy}
                        onClick={() => void loadSpecimen(p.id)}
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                  {modelHint && <p className="hint">{modelHint}</p>}
                  <p className="hint">
                    Declared values back-fill only fields the scanner cannot read. Cross-document
                    comparison uses what the pipeline actually extracted from each scan.
                  </p>
                </div>

                {/* --- Documents in session ------------------------------- */}
                {active.documents.length > 0 ? (
                  <div className="docs">
                    <h3 className="board__title">
                      DOCUMENTS IN SESSION ({active.documents.length})
                    </h3>
                    <div className="docs__grid">
                      {active.documents.map((d, i) => (
                        <DocCard key={d.id} doc={d} index={i} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="hint">No documents yet. Screen the traveller's first document.</p>
                )}

                {/* --- Comparison + approval bar --------------------------- */}
                {active.documents.length > 1 && active.comparison && (
                  <ComparisonBoard checks={active.comparison.checks} />
                )}
                {active.documents.length > 0 && (
                  <section className="approval">
                    <div className="approval__note">
                      <span className="k">OFFICER NOTE</span>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="reason / observation (optional)"
                      />
                    </div>
                    <div className="approval__actions">
                      {canClose && hasDiscrepancy && (
                        <span className="chip chip--bad">
                          DISCREPANCY — APPROVE LOCKED, FLAG FOR REVIEW
                        </span>
                      )}
                      {canClose && !hasDiscrepancy && (
                        <button
                          className="btn btn--approve"
                          disabled={busy}
                          onClick={() => void closeSessionNow("approve")}
                        >
                          {busy ? "SIGNING…" : "APPROVE · SIGN INTO LEDGER"}
                        </button>
                      )}
                      {canClose && (
                        <button className="btn btn--flag" disabled={busy} onClick={() => void closeSessionNow("flag")}>
                          FLAG FOR REVIEW
                        </button>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}

            {/* --- Closed session ------------------------------------------ */}
            {closed && active.block_hash && (
              <div className="signed">
                <div className={`signed__banner banner--${active.status === "approved" ? "ok" : active.status === "rejected" ? "bad" : "warn"}`}>
                  <span className="signed__verdict">
                    {active.status === "approved"
                      ? "SESSION APPROVED — SIGNED INTO LEDGER"
                      : active.status === "rejected"
                        ? "SESSION REJECTED — SIGNED AS EVIDENCE"
                        : "SESSION FLAGGED — AWAITING SUPERVISORY REVIEW"}
                  </span>
                </div>
                <div className="signed__hash">
                  <span className="k">SESSION BLOCK HASH</span>
                  <code className="hash mono">{active.block_hash}</code>
                  <span className="k">PREVIOUS BLOCK</span>
                  <code className="hash mono">{active.prev_hash || "GENESIS"}</code>
                  <div className="signed__meta">
                    <span>verdict {active.verdict || "—"}</span>
                    <span>risk {active.risk_score}</span>
                    <span>closed {timeLabel(active.closed_at || "")}</span>
                    {active.adjudicator && <span>settled by {active.adjudicator}</span>}
                    <span>docs {active.document_count}</span>
                  </div>
                  {active.note && <p className="signed__note">note: {active.note}</p>}
                </div>
                <button className="btn btn--primary" onClick={() => void resetDesk()}>
                  START NEXT TRAVELLER
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {loading && <p className="hint">Loading desk…</p>}

      {showWebcam && (
        <WebcamCapture
          onCapture={(f) => {
            setFile(f);
            setFileKey((k) => k + 1);
            setShowWebcam(false);
          }}
          onCancel={() => setShowWebcam(false)}
        />
      )}
    </div>
  );
}