// ============================================================================
// DeskView.tsx — the border screening desk (SIH26188 session flow).
//
// One traveller = one session. Each document is screened into the session one
// at a time (each pass writes its OWN masked audit row); the desk then reviews
// the cross-document comparison before signing the session into the ledger.
// Approving closes the session and appends a chained SHA-256 block; flagging
// routes it to the supervisory review queue. The desk resets for the next
// traveller. Zero raw identifiers are persisted anywhere.
//
// Also exposed from the desk (real pipelines, quiet UI):
//   - webcam capture as a document scan source,
//   - BSA 2023 s.65B court-certificate export for a signed session,
//   - air-gapped shift-handover token for offline continuity,
//   - zero-knowledge privacy gates asserted by the comparison layer.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeSession,
  createSession,
  getSession,
  getSessions,
  getShiftHandoverToken,
  getBsaCertificateUrl,
  SCREEN_DOC_LABELS,
  SCREEN_DOC_TYPES,
  SCREEN_DOC_NUMBER_PLACEHOLDERS,
  screenDocument,
  type ComparisonCheck,
  type ScreenDocType,
  type ScreeningSession,
  type ScreeningSessionDetail,
  type ScreenReport,
  type ShiftHandoverPacket,
  type ZkpGate,
} from "../api";
import { generateSpecimenFile, SPECIMEN_PRESETS } from "../app/specimens";
import { useAuth, useToast } from "../app/state";
import { copyText, downloadBlob, shortHash, timeLabel } from "../app/util";

const CHECKPOINTS = [
  "Raxaul ICP",
  "Panitanki ICP",
  "Jogbani ICP",
  "Jaigaon ICP",
  "Sonauli ICP",
  "Delhi IGI Airport",
  "Kolkata Airport",
];

function verdictTone(v: string): string {
  return v === "CLEAR" ? "ok" : v === "FLAGGED" ? "bad" : "warn";
}

function statusTone(s: string): string {
  if (s === "agree" || s === "bs-ad-harmonized") return "ok";
  if (s === "phonetic-match" || s === "cross-script") return "info";
  if (s === "disagree") return "bad";
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
        <span className="doc-card__risk mono">RISK {doc.risk_score}</span>
      </header>
      <div className="doc-card__grid">
        {entries.length === 0 ? (
          <span className="muted">No fields extracted.</span>
        ) : (
          entries.map(([k, v]) => (
            <div key={k} className="doc-card__field">
              <span className="doc-card__k">{k}</span>
              <span className="doc-card__v mono">{String(v)}</span>
            </div>
          ))
        )}
      </div>
      <footer className="doc-card__foot mono">
        <span>{timeLabel(doc.created_at)}</span>
        <span title={doc.file_hash || ""}>file {shortHash(doc.file_hash, 18)}</span>
        <span title={doc.block_hash || ""}>block {doc.block_hash ? shortHash(doc.block_hash, 18) : "—"}</span>
      </footer>
    </article>
  );
}

// ----------------------------------------------------------------------------
// Cross-document comparison board (flags + masks only; no raw values).
// ----------------------------------------------------------------------------

function ComparisonBoard({ checks, zkp }: { checks: ComparisonCheck[]; zkp?: Record<string, ZkpGate> | null }) {
  return (
    <section className="board">
      <h3 className="board__title">Cross-document comparison</h3>
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
              <td className="mono">{c.docs.join(" + ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="board__note">
        Comparison persists only digests and flags. Raw values exist in memory during one
        screening pass and are discarded.
      </p>

      {zkp && Object.keys(zkp).length > 0 && (
        <div className="zkp">
          <div className="zkp__head">
            <span className="k">Privacy gates — zero-knowledge assertions</span>
            <span className="chip chip--seal">DIGEST-ONLY</span>
          </div>
          <div className="zkp__grid">
            {Object.entries(zkp).map(([key, gate]) => (
              <div key={key} className="zkp__gate">
                <div className="zkp__gate-top">
                  <span className={`chip chip--${gate.proven ? "ok" : "warn"}`}>{gate.status}</span>
                  {gate.zk_proof_hash && <span className="mono zkp__proof">{gate.zk_proof_hash}</span>}
                </div>
                <div className="zkp__assertion">{gate.assertion}</div>
                <div className="zkp__method mono">{gate.method}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Webcam capture modal — one frame becomes the scan source.
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
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {
        /* handled by the caller surface */
      });
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], `webcam_${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  };

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Capture document from webcam">
      <div className="modal">
        <header className="modal__head">
          <span className="modal__title">Webcam capture</span>
          <button className="btn btn--small" onClick={onCancel}>
            Close
          </button>
        </header>
        <div className="modal__body">
          <video ref={videoRef} autoPlay playsInline muted className="webcam" />
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
        <footer className="modal__foot">
          <button className="btn btn--primary" onClick={capture}>
            Capture frame
          </button>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Air-gapped shift handover token modal.
// ----------------------------------------------------------------------------

function HandoverModal({
  packet,
  onClose,
}: {
  packet: ShiftHandoverPacket;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const copy = async () => {
    const ok = await copyText(packet.qr_packet_string);
    toast(ok ? "Handover packet copied to clipboard." : "Clipboard unavailable.", ok ? "success" : "warn");
  };

  const download = () => {
    downloadBlob(
      new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }),
      `HANDOVER_${packet.session_id.slice(0, 8)}.json`,
    );
  };

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Shift handover token">
      <div className="modal">
        <header className="modal__head">
          <span className="modal__title">Air-gapped shift handover token</span>
          <button className="btn btn--small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal__body">
          <p className="modal__desc">
            HMAC-SHA256 sealed session packet for offline shift continuity — USB export or 2D QR
            transfer. No raw identifiers; only digests, masks and flags.
          </p>
          <table className="tbl tbl--compact">
            <tbody>
              <tr>
                <td className="k">HANDOVER</td>
                <td className="mono">{packet.handover_id}</td>
              </tr>
              <tr>
                <td className="k">SESSION</td>
                <td className="mono">{packet.session_id}</td>
              </tr>
              <tr>
                <td className="k">ISSUED</td>
                <td className="mono">{packet.timestamp}</td>
              </tr>
              <tr>
                <td className="k">SCREENER</td>
                <td className="mono">{packet.screener}</td>
              </tr>
              <tr>
                <td className="k">VERDICT / RISK</td>
                <td className="mono">
                  {packet.verdict} · {packet.risk_score}
                </td>
              </tr>
              <tr>
                <td className="k">SEAL</td>
                <td className="mono">{packet.seal}</td>
              </tr>
            </tbody>
          </table>
          <label className="field">
            <span className="field__label">Packet string</span>
            <textarea className="mono pkt-box" readOnly value={packet.qr_packet_string} rows={5} />
          </label>
        </div>
        <footer className="modal__foot">
          <button className="btn" onClick={() => void copy()}>
            Copy
          </button>
          <button className="btn" onClick={download}>
            Download JSON
          </button>
        </footer>
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
  const [resumingId, setResumingId] = useState<string | null>(null);

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

  const [showWebcam, setShowWebcam] = useState(false);
  const [handover, setHandover] = useState<ShiftHandoverPacket | null>(null);
  const [handoverBusy, setHandoverBusy] = useState(false);

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
      return true;
    }
    toast(`Failed to load session ${id}: ${res.error}`, "error");
    return false;
  }, [toast]);

  // On mount: reopen the newest OPEN session if there is one, else show the start panel.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const open = await refreshOpen();
      if (!mounted) return;
      if (open.length > 0) await loadDetail(open[0].id);
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
    setResumingId(id);
    try {
      const ok = await loadDetail(id);
      if (ok) {
        setShowNewForm(false);
        toast(`Resumed active session ${id}.`, "success");
      }
    } finally {
      setResumingId(null);
    }
  };

  const loadSpecimen = async (presetId: string) => {
    const preset = SPECIMEN_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSpecimenBusy(true);
    try {
      setDocType(preset.docType);
      setDocNumber(preset.docNumber);
      setDeclaredName(preset.declaredName);
      setDeclaredDob(preset.declaredDob);
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

  const openHandover = async () => {
    if (!active) return;
    setHandoverBusy(true);
    const res = await getShiftHandoverToken(active.id);
    setHandoverBusy(false);
    if (res.ok) setHandover(res.data);
    else toast(`Handover token failed: ${res.error}`, "error");
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
  // Any screened document enables close: on machines without a local OCR
  // engine (Vercel/offline) the scanner reads no machine fields, so gating
  // the desk on extracted fields would dead-end every session. The desk still
  // fails closed on a confirmed cross-document DISCREPANCY.
  const canClose = open && active.documents.length > 0;

  return (
    <div className="view">
      {/* --- No active session: start panel -------------------------------- */}
      {!active && (
        <section className="panel panel--muted">
          <div className="panel__row">
            <div>
              <h2 className="panel__title">Desk — no active session</h2>
              <p className="panel__body">
                One traveller at a time. Open a session for the person at the counter, screen
                their documents one by one, cross-compare, then approve or flag.
              </p>
            </div>
            <button className="btn btn--primary" onClick={() => setShowNewForm((v) => !v)}>
              {showNewForm ? "Cancel" : "Open new session"}
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
                {busy ? "Opening…" : "Open session"}
              </button>
            </div>
          )}
          {openList.length > 0 && (
            <div className="resume">
              <span className="k">Resume open session</span>
              <table className="tbl tbl--compact">
                <tbody>
                  {openList.map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{s.id}</td>
                      <td>{s.checkpoint}</td>
                      <td className="mono muted">{s.document_count} doc(s)</td>
                      <td>
                        <button
                          className="btn btn--small btn--primary"
                          disabled={resumingId === s.id}
                          onClick={() => void resumeSession(s.id)}
                        >
                          {resumingId === s.id ? "Resuming…" : "Resume"}
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

      {/* --- Active session rail ------------------------------------------- */}
      {active && (
        <section className="panel">
          <div className="panel__row">
            <div>
              <div className="k">SESSION</div>
              <div className="session-id mono">{active.id}</div>
              <div className="session-meta">
                <span className="chip chip--mute">{active.checkpoint}</span>
                <span
                  className={`chip chip--${
                    active.status === "approved"
                      ? "ok"
                      : active.status === "flagged"
                        ? "warn"
                        : active.status === "rejected"
                          ? "bad"
                          : "mute"
                  }`}
                >
                  {active.status.toUpperCase()}
                </span>
                <span className="muted">opened {timeLabel(active.created_at)}</span>
                <span className="muted">by {active.screener || me?.name || "officer"}</span>
                <span className="muted">{active.document_count} doc(s)</span>
              </div>
            </div>
            {open && (
              <button className="btn" onClick={() => void refreshOpen()} disabled={busy}>
                Refresh
              </button>
            )}
          </div>

          {open && (
            <>
              {/* --- Document intake -------------------------------------- */}
              <div className="intake">
                <h3 className="board__title">Screen document into session</h3>
                <div className="intake__form">
                  <label className="field">
                    <span className="field__label">Document type</span>
                    <select value={docType} onChange={(e) => setDocType(e.target.value as ScreenDocType)}>
                      {SCREEN_DOC_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {SCREEN_DOC_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Declared number</span>
                    <input
                      value={docNumber}
                      onChange={(e) => setDocNumber(e.target.value)}
                      placeholder={SCREEN_DOC_NUMBER_PLACEHOLDERS[docType] || "e.g. K1234567"}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Declared name</span>
                    <input value={declaredName} onChange={(e) => setDeclaredName(e.target.value)} placeholder="optional" />
                  </label>
                  <label className="field">
                    <span className="field__label">Declared DOB</span>
                    <input value={declaredDob} onChange={(e) => setDeclaredDob(e.target.value)} placeholder="YYYY-MM-DD" />
                  </label>
                  <label className="dropzone">
                    <input
                      key={fileKey}
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    <span className="dropzone__label">{file ? file.name : "Attach document"}</span>
                    <span className="dropzone__hint">JPEG / PNG / WEBP / PDF</span>
                  </label>
                  <button className="btn" onClick={() => setShowWebcam(true)}>
                    Scan from webcam
                  </button>
                  <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void screenIntoSession()}>
                    {busy ? "Screening…" : "Screen into session"}
                  </button>
                </div>
                <div className="specimen-row">
                  <span className="k">Demo specimens</span>
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

              {/* --- Documents in session --------------------------------- */}
              {active.documents.length > 0 ? (
                <div className="docs">
                  <h3 className="board__title">Documents in session ({active.documents.length})</h3>
                  <div className="docs__grid">
                    {active.documents.map((d, i) => (
                      <DocCard key={d.id} doc={d} index={i} />
                    ))}
                  </div>
                </div>
              ) : (
                <p className="hint">No documents yet. Screen the traveller's first document.</p>
              )}

              {/* --- Comparison + approval bar ----------------------------- */}
              {active.documents.length > 1 && active.comparison && (
                <ComparisonBoard checks={active.comparison.checks} zkp={active.comparison.zkp_gates} />
              )}

              {active.documents.length > 0 && (
                <section className="approval">
                  <div className="approval__note">
                    <span className="k">Officer note</span>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="reason / observation (optional)"
                    />
                  </div>
                  <div className="approval__actions">
                    {canClose && hasDiscrepancy && (
                      <span className="chip chip--bad">Discrepancy — approval locked; flag for review</span>
                    )}
                    {canClose && !hasDiscrepancy && (
                      <button className="btn btn--approve" disabled={busy} onClick={() => void closeSessionNow("approve")}>
                        {busy ? "Signing…" : "Approve · sign into ledger"}
                      </button>
                    )}
                    {canClose && (
                      <button className="btn btn--flag" disabled={busy} onClick={() => void closeSessionNow("flag")}>
                        Flag for review
                      </button>
                    )}
                  </div>
                </section>
              )}
            </>
          )}

          {/* --- Closed session: signature seal ---------------------------- */}
          {closed && active.block_hash && (
            <div className={`signed signed--${active.status === "approved" ? "ok" : active.status === "rejected" ? "bad" : "warn"}`}>
              <header className="signed__head">
                <svg className="signed__mark" viewBox="0 0 64 64" aria-hidden="true">
                  <rect width="64" height="64" rx="8" fill="currentColor" opacity="0.12" />
                  <path
                    d="M32 10l16 8c0 11-4 20-16 28-12-8-16-17-16-28z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinejoin="round"
                  />
                  <path d="M25 32l5 5 10-11" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="signed__headtext">
                  <span className="signed__title">
                    {active.status === "approved"
                      ? "Session approved — signed into ledger"
                      : active.status === "rejected"
                        ? "Session rejected — signed as evidence"
                        : "Session flagged — awaiting supervisory review"}
                  </span>
                  <span className="signed__sub mono">Immutable chained record · zero raw identifiers stored</span>
                </div>
                <span className="chip chip--seal">SHA-256</span>
              </header>

              <div className="signed__hashgrid">
                <div className="signed__hashcell">
                  <span className="k">Signature · this block</span>
                  <code className="hash hash--big mono">{active.block_hash}</code>
                </div>
                <div className="signed__hashcell">
                  <span className="k">Linked from · previous block</span>
                  <code className="hash mono">{active.prev_hash || "GENESIS"}</code>
                </div>
              </div>

              <div className="signed__meta mono">
                <span>verdict {active.verdict || "—"}</span>
                <span>risk {active.risk_score}</span>
                <span>closed {timeLabel(active.closed_at || "")}</span>
                {active.adjudicator && <span>settled by {active.adjudicator}</span>}
                <span>docs {active.document_count}</span>
              </div>
              {active.note && <p className="signed__note">officer note: {active.note}</p>}

              <footer className="signed__actions">
                <button
                  className="btn btn--ghost"
                  onClick={() => window.open(getBsaCertificateUrl(active.id), "_blank")}
                >
                  BSA 2023 · s.65B court certificate
                </button>
                <button className="btn btn--ghost" disabled={handoverBusy} onClick={() => void openHandover()}>
                  {handoverBusy ? "Sealing…" : "Air-gapped handover token"}
                </button>
                <button className="btn btn--primary" onClick={() => void resetDesk()}>
                  Start next traveller
                </button>
              </footer>
            </div>
          )}
        </section>
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

      {handover && <HandoverModal packet={handover} onClose={() => setHandover(null)} />}
    </div>
  );
}