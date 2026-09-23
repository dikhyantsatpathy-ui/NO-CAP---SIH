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
// Also exposed from the desk:
//   - webcam capture with camera device selection & live in-memory extraction preview,
//   - checkpoint-guided border protocols & traveller briefings (Indo-Nepal/Bhutan/Air),
//   - soft-removal & restore of mistaken document scans preserving the immutable ledger,
//   - nested expandable sub-tables for forensic checks, fields, and custody,
//   - BSA 2023 s.65B court-certificate export for a signed session,
//   - air-gapped shift-handover token for offline continuity,
//   - zero-knowledge privacy gates asserted by the comparison layer.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeSession,
  createSession,
  extractLiveImage,
  getCheckpoints,
  getSession,
  getSessions,
  getShiftHandoverToken,
  getBsaCertificateUrl,
  removeSessionDocument,
  restoreSessionDocument,
  SCREEN_DOC_LABELS,
  SCREEN_DOC_TYPES,
  SCREEN_DOC_NUMBER_PLACEHOLDERS,
  screenDocument,
  type CheckpointCatalog,
  type ComparisonCheck,
  type GuidedFlow,
  type LiveExtractResult,
  type ScreenDocType,
  type ScreeningSession,
  type ScreeningSessionDetail,
  type ScreenReport,
  type ShiftHandoverPacket,
  type ZkpGate,
} from "../api";
import { generateSpecimenFile, SPECIMEN_PRESETS } from "../app/specimens";
import { useToast } from "../app/state";
import { copyText, downloadBlob, shortHash, timeLabelIst } from "../app/util";
import {
  DESK_STEPS,
  MODULE_PLAIN,
  MODULE_ORDER,
  deskStep,
  plainCompare,
  plainStatus,
  plainVerdict,
  riskWord,
} from "../app/english";

const DEFAULT_CHECKPOINTS = [
  "Raxaul",
  "Sunauli",
  "Jogbani",
  "Panitanki",
  "Jaigaon",
  "Banbasa",
  "Rupaidiha",
  "IGI Delhi Airport",
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
// Silent step-guide — a thin rail showing where the officer is in the flow.
// No instructions needed: the current step is simply lit up.
// ----------------------------------------------------------------------------

function GuideStepper({
  active,
  docCount,
  closed,
}: {
  active: boolean;
  docCount: number;
  closed: boolean;
}) {
  const current = deskStep(active, docCount, closed);
  return (
    <ol className="stepper" aria-label="Screening steps">
      {DESK_STEPS.map((step, i) => {
        const state =
          i < current.index
            ? "done"
            : i === current.index
              ? "now"
              : "next";
        return (
          <li key={step.id} className={`stepper__item stepper__item--${state}`}>
            <span className="stepper__dot" aria-hidden="true">
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className="stepper__label">{step.label}</span>
            <span className="stepper__note">{step.note}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ----------------------------------------------------------------------------
// Guided Protocol & Traveller Briefing Bar
// ----------------------------------------------------------------------------

function GuidedProtocolBar({
  guide,
  checkpoint,
  nationality,
}: {
  guide?: GuidedFlow | null;
  checkpoint: string;
  nationality?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!guide && !checkpoint) return null;

  return (
    <div className="protocol-hud">
      <div className="protocol-hud__header">
        <div className="protocol-hud__title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>What to do at {guide?.cluster_label || checkpoint}</span>
        </div>
        <button
          type="button"
          className="subtable-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "▼ Hide the steps" : "▶ Show the steps"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <span className="chip chip--seal">
          {guide?.mode ? `${guide.mode.toUpperCase()} BORDER` : "LAND BORDER"}
        </span>
        <span className="chip chip--mute">Post: {checkpoint}</span>
        {nationality && (
          <span className="chip chip--info">
            Nationality: {guide?.nationality_label || nationality}
          </span>
        )}
        {guide?.expected_documents && guide.expected_documents.length > 0 && (
          <span className="muted" style={{ fontSize: "11.5px" }}>
            Expected documents: {guide.expected_documents.map((d) => SCREEN_DOC_LABELS[d as ScreenDocType] || d).join(" / ")}
          </span>
        )}
      </div>

      {open && guide && (
        <div className="protocol-hud__grid">
          <div className="protocol-col">
            <span className="protocol-col__heading">Officer — what to check</span>
            {guide.officer_steps?.map((st) => (
              <div key={st.order} className="protocol-step-item">
                <span className="protocol-step-num">{st.order}</span>
                <div>
                  <strong style={{ textTransform: "capitalize" }}>{st.phase}:</strong> {st.text}
                  {st.detail && <div className="muted" style={{ fontSize: "11px" }}>{st.detail}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="protocol-col">
            <span className="protocol-col__heading">Traveller — what to say</span>
            <div className="protocol-brief-box">
              {guide.traveller_steps?.map((ts) => (
                <div key={ts.order} style={{ marginBottom: "6px" }}>
                  <span>{ts.order}. {ts.text}</span>
                </div>
              ))}
            </div>
            {guide.capture_hint && (
              <div className="muted" style={{ fontSize: "11px", marginTop: "4px" }}>
                <strong>Capture tip:</strong> {guide.capture_hint}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// A single screened document's card with nested expandable sub-tables
// ----------------------------------------------------------------------------

function DocCard({
  doc,
  index,
  isOpen,
  onRemove,
}: {
  doc: ScreenReport;
  index: number;
  isOpen: boolean;
  onRemove?: (reportId: string) => void;
}) {
  const [activeSubTab, setActiveSubTab] = useState<"forensics" | "fields" | "custody" | null>(null);
  const fields = doc.masked_fields || {};
  const entries = Object.entries(fields).filter(([, v]) => v != null && v !== "");
  const modules = doc.modules;

  return (
    <article className="doc-card">
      <header className="doc-card__head">
        <div className="doc-card__head-left">
          <span className="doc-card__no">Document {index + 1}</span>
          <span className="doc-card__type-title">
            {SCREEN_DOC_LABELS[doc.doc_type as ScreenDocType] || doc.doc_type}
          </span>
          <span className={`chip chip--${verdictTone(doc.verdict)}`}>
            {plainVerdict(doc.verdict)}
          </span>
          <span className={`chip chip--${doc.risk_score != null && doc.risk_score > 55 ? "warn" : "mute"}`}>
            {riskWord(doc.risk_score)}
          </span>
        </div>

        <div className="doc-card__head-right">
          <button
            type="button"
            className={`subtable-toggle ${activeSubTab ? "subtable-toggle--active" : ""}`}
            onClick={() => setActiveSubTab((prev) => (prev ? null : "forensics"))}
          >
            {activeSubTab ? "▼ Hide details" : "▶ See the check details"}
          </button>
          {isOpen && onRemove && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              style={{ color: "var(--bad)", borderColor: "var(--bad-line)" }}
              onClick={() => onRemove(doc.id)}
              title="Remove this document from the session (the audit record is kept)"
            >
              Remove
            </button>
          )}
        </div>
      </header>

      {/* Main summary attribute matrix */}
      <div className="doc-card__matrix">
        {entries.length === 0 ? (
          <span className="muted" style={{ padding: "8px 0" }}>No readable details found.</span>
        ) : (
          entries.slice(0, 6).map(([k, v]) => (
            <div key={k} className="doc-card__matrix-item">
              <span className="doc-card__matrix-label">{k.replace(/_/g, " ")}</span>
              <span className="doc-card__matrix-val mono">{String(v)}</span>
            </div>
          ))
        )}
      </div>

      {/* Interactive Sub-Tables */}
      {activeSubTab && (
        <div className="subtable-container">
          <div className="subtable-nav">
            <button
              type="button"
              className={`subtable-nav__btn ${activeSubTab === "forensics" ? "subtable-nav__btn--active" : ""}`}
              onClick={() => setActiveSubTab("forensics")}
            >
              🔬 1. Checks done on this document
            </button>
            <button
              type="button"
              className={`subtable-nav__btn ${activeSubTab === "fields" ? "subtable-nav__btn--active" : ""}`}
              onClick={() => setActiveSubTab("fields")}
            >
              📋 2. What was read
            </button>
            <button
              type="button"
              className={`subtable-nav__btn ${activeSubTab === "custody" ? "subtable-nav__btn--active" : ""}`}
              onClick={() => setActiveSubTab("custody")}
            >
              🔗 3. Record &amp; seal (audit)
            </button>
          </div>

          {activeSubTab === "forensics" && (
            <div className="subtable-pane">
              <div className="forensics-cards-grid">
                {MODULE_ORDER.map((mk) => {
                  const leaf = (modules?.[mk] ?? {}) as {
                    verdict?: string;
                    medium?: string;
                    mrz?: { valid?: boolean };
                    ocr?: { ran?: boolean };
                    ela?: { status?: string };
                    score?: number;
                    method?: string;
                  };
                  const meta = MODULE_PLAIN[mk];
                  const v = leaf?.verdict;
                  const tone =
                    v === "PASS" ? "ok"
                      : v === "WARN" ? "warn"
                        : mk === "face" ? "mute"
                          : v === "REVIEW" ? "warn" : "mute";
                  const extra =
                    mk === "extraction"
                      ? `${leaf?.medium ? `Read as a ${leaf.medium}` : "Read by text scan"}${leaf?.mrz?.valid ? " · machine line OK" : leaf?.ocr?.ran === false ? " · could not auto-read" : ""}`
                      : mk === "validation"
                        ? doc.watchlist_hits && doc.watchlist_hits.length > 0
                          ? "⚠️ Name/number found on the known-fraud list"
                          : "Format checks passed · not on the known-fraud list"
                        : mk === "tampering"
                          ? `Edit scan: ${leaf?.ela?.status || "low"} risk detected`
                          : leaf?.score != null
                            ? `Face match: ${Math.round(leaf.score * 100)}% (${leaf.method || "ArcFace"})`
                            : "No live photo was provided to compare";
                  return (
                    <div key={mk} className="forensic-card">
                      <div className="forensic-card__head">
                        <span className="forensic-card__title">
                          {meta.short}
                          <span className="forensic-card__code mono">· {mk.toUpperCase()}</span>
                        </span>
                        <span className={`chip chip--${tone}`}>{plainVerdict(v) || "—"}</span>
                      </div>
                      <div className="forensic-card__val">
                        {extra}
                        <span className="forensic-card__what muted">{meta.what}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {doc.reasons && doc.reasons.length > 0 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--panel)", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <span className="subtable-grid__label">WHAT THE CHECKS FOUND</span>
                  <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: "12px", lineHeight: "1.5" }}>
                    {doc.reasons.map((r, ri) => (
                      <li key={ri} className="muted">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeSubTab === "fields" && (
            <div className="subtable-pane">
              <table className="tbl tbl--compact">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Read value (masked to protect privacy)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([k, v]) => (
                    <tr key={k}>
                      <td className="k" style={{ textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</td>
                      <td className="mono">{String(v)}</td>
                      <td>
                        <span className="chip chip--ok">Read</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeSubTab === "custody" && (
            <div className="subtable-pane">
              <table className="tbl tbl--compact">
                <tbody>
                  <tr>
                    <td className="k" style={{ width: 180 }}>File fingerprint (SHA-256)</td>
                    <td className="mono" style={{ wordBreak: "break-all" }}>
                      {doc.file_hash || "—"}{" "}
                      {doc.file_hash && (
                        <button
                          type="button"
                          className="btn btn--small"
                          style={{ padding: "1px 6px", marginLeft: 6 }}
                          onClick={() => void copyText(doc.file_hash || "")}
                        >
                          Copy
                        </button>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="k">Record seal (block)</td>
                    <td className="mono">{doc.block_hash || "Sealed when the session is signed"}</td>
                  </tr>
                  <tr>
                    <td className="k">Scanned at</td>
                    <td className="mono">
                      {doc.created_at_ist || timeLabelIst(doc.created_at)} ({doc.created_at})
                    </td>
                  </tr>
                  <tr>
                    <td className="k">Screened by</td>
                    <td className="mono">{doc.screener || "system-evaluator"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <footer className="doc-card__foot mono">
        <span>Recorded: {doc.created_at_ist || timeLabelIst(doc.created_at)}</span>
        <span title={doc.file_hash || ""}>fingerprint: {shortHash(doc.file_hash, 16)}</span>
        <span title={doc.block_hash || ""}>seal: {doc.block_hash ? shortHash(doc.block_hash, 16) : "pending"}</span>
      </footer>
    </article>
  );
}

// ----------------------------------------------------------------------------
// Cross-document comparison board
// ----------------------------------------------------------------------------

function ComparisonBoard({ checks, zkp }: { checks: ComparisonCheck[]; zkp?: Record<string, ZkpGate> | null }) {
  return (
    <section className="board">
      <h3 className="board__title">Do the documents agree?</h3>
      <table className="tbl tbl--compact">
        <thead>
          <tr>
            <th>Detail</th>
            <th>Result</th>
            <th>What it means</th>
            <th>Compared on</th>
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
                <span className={`chip chip--${statusTone(c.status)}`}>{plainCompare(c.status)}</span>
              </td>
              <td className="cell-detail">{c.detail}</td>
              <td className="mono">{c.docs.join(" + ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="board__note">
        Nothing readable is kept — only masked fingerprints and the results of the checks. Full
        details live in memory for this pass and are discarded afterwards.
      </p>

      {zkp && Object.keys(zkp).length > 0 && (
        <div className="zkp">
          <div className="zkp__head">
            <span className="k">Privacy checks (automatic)</span>
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
// Webcam capture with Camera Device Selector & Live In-Memory Extraction Preview
// ----------------------------------------------------------------------------

function WebcamCapture({
  onCapture,
  onCancel,
  docType,
}: {
  onCapture: (f: File) => void;
  onCancel: () => void;
  docType?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [previewBlob, setPreviewBlob] = useState<{ file: File; url: string } | null>(null);
  const [liveExtract, setLiveExtract] = useState<LiveExtractResult | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const { toast } = useToast();

  // Enumerate cameras
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((devs) => {
      const videoDevs = devs.filter((d) => d.kind === "videoinput");
      setDevices(videoDevs);
      if (videoDevs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(videoDevs[0].deviceId);
      }
    }).catch(() => {});
  }, [selectedDeviceId]);

  // Video stream
  useEffect(() => {
    let stream: MediaStream | null = null;
    const constraints: MediaStreamConstraints = {
      video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: "environment" },
    };
    navigator.mediaDevices?.getUserMedia(constraints).then((s) => {
      stream = s;
      setStreamError(null);
      if (videoRef.current) videoRef.current.srcObject = s;
    }).catch((err) => {
      setStreamError(err instanceof Error ? err.message : "Camera access denied or unavailable");
    });
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [selectedDeviceId]);

  const snapFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        const f = new File([blob], `webcam_${Date.now()}.jpg`, { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        setPreviewBlob({ file: f, url });
      }
    }, "image/jpeg", 0.92);
  };

  const runPreviewExtraction = async () => {
    if (!previewBlob) return;
    setExtracting(true);
    const res = await extractLiveImage(previewBlob.file, docType || "other");
    setExtracting(false);
    if (res.ok) {
      setLiveExtract(res.data);
      toast("Live machine-reading preview ready (in-memory).", "success");
    } else {
      toast(`Live extraction failed: ${res.error}`, "warn");
    }
  };

  const acceptCapture = () => {
    if (previewBlob) {
      onCapture(previewBlob.file);
      URL.revokeObjectURL(previewBlob.url);
    }
  };

  const retake = () => {
    if (previewBlob) URL.revokeObjectURL(previewBlob.url);
    setPreviewBlob(null);
    setLiveExtract(null);
  };

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Capture document from webcam">
      <div className="modal" style={{ maxWidth: 640 }}>
        <header className="modal__head">
          <span className="modal__title">Webcam capture</span>
          <button type="button" className="btn btn--small" onClick={onCancel}>
            Close
          </button>
        </header>

        <div className="modal__body">
          {/* Camera switcher */}
          {devices.length > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="k" style={{ whiteSpace: "nowrap" }}>CAMERA:</span>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {streamError && (
            <div className="banner banner--bad">{streamError}</div>
          )}

          {!previewBlob ? (
            <div>
              <video ref={videoRef} autoPlay playsInline muted className="webcam" />
              <canvas ref={canvasRef} style={{ display: "none" }} />
              <p className="hint" style={{ marginTop: 6 }}>
                Hold the document flat and steady, with the text and photo facing the camera.
              </p>
            </div>
          ) : (
            <div>
              <img
                src={previewBlob.url}
                alt="Captured document preview"
                style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8, border: "1px solid var(--line)" }}
              />
              {/* Live Extraction Preview Panel */}
              {liveExtract && (
                <div className="extract-preview" style={{ marginTop: 10 }}>
                  <div className="extract-preview__head">
                    <span className="k">What the machine reads</span>
                    <span className="extract-preview__badge">Nothing stored</span>
                  </div>
                  <div className="subtable-grid">
                    <div className="subtable-grid__cell">
                      <span className="subtable-grid__label">Document type</span>
                      <span className="subtable-grid__val">{liveExtract.doc_type}</span>
                    </div>
                    {Object.entries(liveExtract.masked_fields || {}).map(([k, v]) => (
                      <div key={k} className="subtable-grid__cell">
                        <span className="subtable-grid__label">{k.replace(/_/g, " ")}</span>
                        <span className="subtable-grid__val mono">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                  {liveExtract.mrz && (
                    <div style={{ marginTop: 4, fontSize: 11 }} className="mono muted">
                      Machine line: {liveExtract.mrz.valid ? "✓ checks out" : "no machine line found"}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="modal__foot">
          {!previewBlob ? (
            <>
              <button type="button" className="btn btn--primary" onClick={snapFrame}>
                Capture
              </button>
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {!liveExtract && (
                <button
                  type="button"
                  className="btn"
                  disabled={extracting}
                  onClick={() => void runPreviewExtraction()}
                >
                  {extracting ? "Reading…" : "Preview what it reads"}
                </button>
              )}
              <button type="button" className="btn btn--primary" onClick={acceptCapture}>
                Use this photo
              </button>
              <button type="button" className="btn" onClick={retake}>
                Retake
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Air-gapped shift handover token modal
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
          <button type="button" className="btn btn--small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal__body">
          <p className="modal__desc">
            Sealed copy of the session for offline shift handover — USB export or 2D QR transfer.
            No readable details, only fingerprints, masks and flags.
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
          <button type="button" className="btn" onClick={() => void copy()}>
            Copy
          </button>
          <button type="button" className="btn" onClick={download}>
            Download JSON
          </button>
        </footer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// The Main Screening Desk
// ----------------------------------------------------------------------------

export function DeskView() {
  const { toast } = useToast();
  const [active, setActive] = useState<ScreeningSessionDetail | null>(null);
  const [openList, setOpenList] = useState<ScreeningSession[]>([]);
  const [catalog, setCatalog] = useState<CheckpointCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // New session creation fields
  const [newCheckpoint, setNewCheckpoint] = useState("Raxaul");
  const [newNationality, setNewNationality] = useState("NP");
  const [newPurpose, setNewPurpose] = useState("Trade");
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

  // Load checkpoint catalog
  useEffect(() => {
    getCheckpoints().then((res) => {
      if (res.ok) setCatalog(res.data);
    }).catch(() => {});
  }, []);

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

  // On mount: reopen the newest OPEN session if there is one
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
    const res = await createSession({
      checkpoint: newCheckpoint.trim() || "Raxaul",
      nationality: newNationality.trim(),
      purpose: newPurpose.trim(),
    });
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

  const handleSoftRemove = async (reportId: string) => {
    if (!active) return;
    if (!window.confirm("Soft-remove this document from current session comparison? (Audit ledger row is preserved)")) return;
    setBusy(true);
    const res = await removeSessionDocument(active.id, reportId);
    setBusy(false);
    if (res.ok) {
      toast("Document soft-removed from session comparison (audit row preserved).", "info");
      await loadDetail(active.id);
    } else {
      toast(res.error, "error");
    }
  };

  const handleRestore = async (reportId: string) => {
    if (!active) return;
    setBusy(true);
    const res = await restoreSessionDocument(active.id, reportId);
    setBusy(false);
    if (res.ok) {
      toast("Document restored into session comparison.", "success");
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
  const canClose = open && active.documents.length > 0;

  const checkpointOptions = catalog?.checkpoints.all || DEFAULT_CHECKPOINTS;
  const nationalities = catalog?.nationalities || [
    { code: "NP", label: "Nepal" },
    { code: "IN", label: "India" },
    { code: "BT", label: "Bhutan" },
    { code: "BD", label: "Bangladesh" },
    { code: "MM", label: "Myanmar" },
    { code: "US", label: "United States" },
    { code: "GB", label: "United Kingdom" },
    { code: "UNKNOWN", label: "Other / Unlisted" },
  ];

  return (
    <div className="view">
      {/* --- No active session: start panel -------------------------------- */}
      {!active && (
        <section className="panel panel--muted">
          <div className="panel__row">
            <div>
              <h2 className="panel__title">Ready for the next traveller</h2>
              <p className="panel__body">
                One traveller at a time. Open a session, scan their documents one by one, compare,
                then decide — approve or send for a closer look.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setShowNewForm((v) => !v)}
            >
              {showNewForm ? "Cancel" : "Open new session"}
            </button>
          </div>

          {showNewForm && (
            <div className="new-session" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <label className="field">
                <span className="field__label">BORDER POST / ICP</span>
                <input
                  list="checkpoint-options"
                  value={newCheckpoint}
                  onChange={(e) => setNewCheckpoint(e.target.value)}
                  placeholder="e.g. Raxaul, Panitanki..."
                />
                <datalist id="checkpoint-options">
                  {checkpointOptions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>

              <label className="field">
                <span className="field__label">TRAVELLER NATIONALITY</span>
                <select value={newNationality} onChange={(e) => setNewNationality(e.target.value)}>
                  {nationalities.map((n) => (
                    <option key={n.code} value={n.code}>
                      {n.label} ({n.code})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">PURPOSE OF TRAVEL</span>
                <select value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)}>
                  <option value="Trade">Trade / Commerce</option>
                  <option value="Tourism">Tourism / Pilgrimage</option>
                  <option value="Transit">Transit</option>
                  <option value="Family">Family Visit</option>
                  <option value="Employment">Employment</option>
                  <option value="Medical">Medical</option>
                  <option value="Official">Official Duty</option>
                </select>
              </label>

              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  disabled={busy}
                  onClick={() => void openNewSession()}
                >
                  {busy ? "Opening…" : "Open session"}
                </button>
              </div>
              <p className="muted" style={{ gridColumn: "1 / -1", fontSize: "11.5px", marginTop: 2 }}>
                <strong>Traveller goes into Session 1, 2, 3…</strong> — numbering restarts at 1 every
                day, so today's sessions are easy to call out.
              </p>
            </div>
          )}

          {openList.length > 0 && (
            <div className="resume">
              <span className="k">Resume today's open session</span>
              <table className="tbl tbl--compact">
                <tbody>
                  {openList.map((s) => (
                    <tr key={s.id}>
                      <td>{s.label || `Session · ${s.id.slice(0, 6)}`}</td>
                      <td>{s.checkpoint}</td>
                      <td className="mono muted">{s.document_count} doc(s)</td>
                      <td>
                        <button
                          type="button"
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
              <div className="k">CURRENT TRAVELLER</div>
              <div className="session-label">
                {active.label || `Session · ${active.id.slice(0, 6)}`}
              </div>
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
                  {plainStatus(active.status)}
                </span>
                {active.nationality && (
                  <span className="chip chip--info">
                    Nationality: {nationalities.find((n) => n.code === active.nationality)?.label || active.nationality}
                  </span>
                )}
                {active.purpose && (
                  <span className="chip chip--mute">{active.purpose}</span>
                )}
                <span className="muted">
                  opened {timeLabelIst(active.created_at_ist || active.created_at)}
                  {active.screener ? ` by ${active.screener}` : ""}
                  {" · "}{active.document_count} document(s)
                </span>
              </div>
            </div>
            {open && (
              <button type="button" className="btn" onClick={() => void refreshOpen()} disabled={busy}>
                Refresh
              </button>
            )}
          </div>

          {/* Silent step-guide: which of the 4 steps is the officer on? */}
          <GuideStepper
            active={!!active}
            docCount={active.documents.filter((d) => !d.removed_at).length}
            closed={!!closed}
          />

          {/* Border Post Guided Protocol Banner */}
          <GuidedProtocolBar
            guide={active.guide}
            checkpoint={active.checkpoint}
            nationality={active.nationality}
          />

          {open && (
            <>
              {/* --- Document intake -------------------------------------- */}
              {/* --- Document intake card -------------------------------- */}
              <div className="intake-card">
                <div className="intake-card__header">
                  <div>
                    <h3 className="intake-card__title">Scan a document</h3>
                    <p className="intake-card__subtitle">
                      Add the traveller's document — upload a photo or use the webcam. The system
                      reads it, checks it, scans for edits and compares the face, all at once.
                    </p>
                  </div>
                  {file && (
                    <div className="intake-file-badge">
                      <span className="dot dot--ok" />
                      <span className="mono">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        style={{ padding: "1px 6px", marginLeft: 6 }}
                        onClick={() => { setFile(null); setFileKey((k) => k + 1); }}
                        title="Remove attached file"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                <div className="intake-layout">
                  {/* Left Column: Metadata & Declared Values */}
                  <div className="intake-section">
                    <div className="intake-section__title">
                      <span>1. What the document says</span>
                    </div>
                    <p className="intake-section__hint">
                      Fill these only if you can read them — they help the system read the document.
                      This is matched, never stored.
                    </p>

                    <label className="field">
                      <span className="field__label">DOCUMENT TYPE</span>
                      <select
                        value={docType}
                        onChange={(e) => setDocType(e.target.value as ScreenDocType)}
                      >
                        {SCREEN_DOC_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {SCREEN_DOC_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="intake-fields-grid">
                      <label className="field">
                        <span className="field__label">DOCUMENT NUMBER</span>
                        <input
                          value={docNumber}
                          onChange={(e) => setDocNumber(e.target.value)}
                          placeholder={SCREEN_DOC_NUMBER_PLACEHOLDERS[docType] || "e.g. K1234567"}
                        />
                      </label>

                      <label className="field">
                        <span className="field__label">DATE OF BIRTH (optional)</span>
                        <input
                          value={declaredDob}
                          onChange={(e) => setDeclaredDob(e.target.value)}
                          placeholder="YYYY-MM-DD"
                        />
                      </label>
                    </div>

                    <label className="field">
                      <span className="field__label">FULL NAME (optional)</span>
                      <input
                        value={declaredName}
                        onChange={(e) => setDeclaredName(e.target.value)}
                        placeholder="e.g. RAJESH SHARMA"
                      />
                    </label>
                  </div>

                  {/* Right Column: Capture Source */}
                  <div className="intake-section">
                    <div className="intake-section__title">
                      <span>2. Add the document</span>
                    </div>
                    <p className="intake-section__hint">
                      A clear photo or scan works best. We never keep the photo — only a masked
                      fingerprint and the check results.
                    </p>

                    <div className="intake-capture-zone">
                      <label className={`dropzone ${file ? "dropzone--has-file" : ""}`}>
                        <input
                          key={fileKey}
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => setFile(e.target.files?.[0] || null)}
                        />
                        <div className="dropzone__icon">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                        </div>
                        <span className="dropzone__label">
                          {file ? file.name : "Click to select a photo or scan"}
                        </span>
                        <span className="dropzone__hint">JPEG, PNG, WEBP or PDF up to 10 MB</span>
                      </label>

                      <button
                        type="button"
                        className="btn"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px" }}
                        onClick={() => setShowWebcam(true)}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                        Use the webcam instead
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bottom Actions Bar */}
                <div className="intake-actions-bar">
                  <div className="specimen-row">
                    <span className="k" style={{ fontSize: "11px" }}>TRY WITH A SAMPLE:</span>
                    {SPECIMEN_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="btn btn--small"
                        disabled={specimenBusy}
                        onClick={() => void loadSpecimen(p.id)}
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="btn btn--primary btn--hero"
                    disabled={busy || !file}
                    onClick={() => void screenIntoSession()}
                  >
                    {busy ? "Checking…" : "Check this document"}
                  </button>
                </div>

                {modelHint && <p className="hint" style={{ marginTop: 12 }}>{modelHint}</p>}
              </div>

              {/* --- Documents in session --------------------------------- */}
              {active.documents.filter((d) => !d.removed_at).length > 0 ? (
                <div className="docs">
                  <h3 className="board__title">
                    Documents in session ({active.documents.filter((d) => !d.removed_at).length})
                  </h3>
                  <div className="docs__grid">
                    {active.documents
                      .filter((d) => !d.removed_at)
                      .map((d, i) => (
                        <DocCard
                          key={d.id}
                          doc={d}
                          index={i}
                          isOpen={open}
                          onRemove={handleSoftRemove}
                        />
                      ))}
                  </div>
                </div>
              ) : (
                <p className="hint">No active documents yet. Screen the traveller's first document.</p>
              )}

              {/* --- Mistaken-scan drawer (removed docs stay in the audit) - */}
              {active.documents.filter((d) => Boolean(d.removed_at)).length > 0 && (
                <div className="removed-drawer">
                  <div className="removed-drawer__title">
                    Taken out of the session ({active.documents.filter((d) => Boolean(d.removed_at)).length}) — still kept in the audit trail
                  </div>
                  <table className="tbl tbl--compact" style={{ background: "var(--panel)" }}>
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Type</th>
                        <th>Result</th>
                        <th>Risk</th>
                        <th>Removed (IST)</th>
                        <th>Removed by</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.documents
                        .filter((d) => Boolean(d.removed_at))
                        .map((rd) => (
                          <tr key={rd.id}>
                            <td className="mono">DOC-{rd.id.slice(0, 6)}</td>
                            <td>{SCREEN_DOC_LABELS[rd.doc_type as ScreenDocType] || rd.doc_type}</td>
                            <td>
                              <span className={`chip chip--${verdictTone(rd.verdict)}`}>{plainVerdict(rd.verdict)}</span>
                            </td>
                            <td className="muted">{riskWord(rd.risk_score)}</td>
                            <td className="mono">{rd.removed_at_ist || timeLabelIst(rd.removed_at)}</td>
                            <td>{rd.removed_by || "screener"}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn--small btn--primary"
                                disabled={busy}
                                onClick={() => void handleRestore(rd.id)}
                              >
                                Restore
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* --- Comparison + approval bar ----------------------------- */}
              {active.documents.length > 1 && active.comparison && (
                <ComparisonBoard
                  checks={active.comparison.checks}
                  zkp={active.comparison.zkp_gates}
                />
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
                      <span className="chip chip--bad">Details clash — send to a supervisor for review</span>
                    )}
                    {canClose && !hasDiscrepancy && (
                      <button
                        type="button"
                        className="btn btn--approve"
                        disabled={busy}
                        onClick={() => void closeSessionNow("approve")}
                      >
                        {busy ? "Signing…" : "Approve — looks genuine"}
                      </button>
                    )}
                    {canClose && (
                      <button
                        type="button"
                        className="btn btn--flag"
                        disabled={busy}
                        onClick={() => void closeSessionNow("flag")}
                      >
                        Send for review
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
                  <path
                    d="M25 32l5 5 10-11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="signed__headtext">
                  <span className="signed__title">
                    {active.status === "approved"
                      ? "Approved — recorded in the log"
                      : active.status === "rejected"
                        ? "Rejected — kept as evidence"
                        : "Sent for review — waiting for a supervisor"}
                  </span>
                  <span className="signed__sub mono">Tamper-proof log · nothing readable stored</span>
                </div>
                <span className="chip chip--seal">SHA-256</span>
              </header>

              <div className="signed__hashgrid">
                <div className="signed__hashcell">
                  <span className="k">Signature · this record</span>
                  <code className="hash hash--big mono">{active.block_hash}</code>
                </div>
                <div className="signed__hashcell">
                  <span className="k">Linked from · previous record</span>
                  <code className="hash mono">{active.prev_hash || "GENESIS"}</code>
                </div>
              </div>

              <div className="signed__meta mono">
                <span>result {plainVerdict(active.verdict)}</span>
                <span>{riskWord(active.risk_score)}</span>
                <span>closed {timeLabelIst(active.closed_at || "")}</span>
                {active.adjudicator && <span>settled by {active.adjudicator}</span>}
                <span>{active.document_count} doc(s)</span>
              </div>
              {active.note && <p className="signed__note">officer note: {active.note}</p>}

              <footer className="signed__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => window.open(getBsaCertificateUrl(active.id), "_blank")}
                >
                  BSA 2023 · s.65B court certificate
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={handoverBusy}
                  onClick={() => void openHandover()}
                >
                  {handoverBusy ? "Sealing…" : "Air-gapped handover token"}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void resetDesk()}
                >
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
          docType={docType}
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