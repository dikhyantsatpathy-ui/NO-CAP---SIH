// ============================================================================
// ScreeningDeskView.tsx — Primary Border Screening Workstation (SIH26188)
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// Dual-column intake: Document Forensics (Left) + Biometric Liveness (Right)
// ============================================================================

import { useState } from "react";
import {
  adjudicateScreen,
  getAadhaarFields,
  getDossierUrl,
  getScreenReport,
  SCREEN_DOC_NUMBER_PLACEHOLDERS,
  SCREEN_DOC_TYPES,
  screenDocument,
  type AadhaarFieldBox,
  type LedgerAnchorStatus,
  type ScreenDocType,
  type ScreenReport,
} from "../../api";
import {
  SPECIMEN_PRESETS,
  generateSpecimenFile,
  type SpecimenPreset,
} from "../../app/specimens";
import { recordScreeningMetric, useToast } from "../../app/state";
import { copyText } from "../../app/util";
import {
  Button,
  Card,
  Dropzone,
  Field,
  IconBolt,
  Pill,
} from "../../components/ui";
import { LiveCaptureKiosk } from "./LiveCaptureKiosk";
import {
  ForensicChecksSubTable,
  ModulePanel,
  ModuleScorecard,
  TravelValidityBadge,
} from "./ModuleScorecard";
import {
  formatMaskedFieldValue,
  formatScreenDocType,
  MASKED_FIELD_LABELS,
  MODULE_VERDICT_TONE,
  VERDICT_META,
  type LivenessStatusPayload,
} from "./types";

interface ScreeningDeskViewProps {
  onScreenSuccess: (rep: ScreenReport) => void;
  isSuper: boolean;
  ledgerAnchor: LedgerAnchorStatus | null;
  onTriggerAnchor: () => Promise<void>;
  anchorBusy: boolean;
}

export function ScreeningDeskView({
  onScreenSuccess,
  isSuper,
  ledgerAnchor,
  onTriggerAnchor,
  anchorBusy,
}: ScreeningDeskViewProps) {
  const { toast } = useToast();

  const [file, setFile] = useState<File[]>([]);
  const [docType, setDocType] = useState<ScreenDocType>("passport");
  const [checkpoint, setCheckpoint] = useState("Raxaul ICP");
  const [docNumber, setDocNumber] = useState("");
  const [liveFrame, setLiveFrame] = useState<Blob | null>(null);
  const [liveLivenessStatus, setLiveLivenessStatus] = useState<LivenessStatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [specimenBusy, setSpecimenBusy] = useState(false);
  const [report, setReport] = useState<ScreenReport | null>(null);
  const [adjudicateNote, setAdjudicateNote] = useState("");
  const [aadhaarBoxes, setAadhaarBoxes] = useState<AadhaarFieldBox[] | null>(null);
  const [aadhaarBusy, setAadhaarBusy] = useState(false);

  const handleLoadPreset = async (preset: SpecimenPreset) => {
    try {
      setSpecimenBusy(true);
      setDocType(preset.docType);
      setCheckpoint(preset.checkpoint);
      setDocNumber(preset.docNumber);
      const stagedFile = await generateSpecimenFile(preset);
      setFile([stagedFile]);
      toast(`Loaded specimen: ${preset.title}. Click "Run Screening" to verify.`, "info");
    } catch (err: any) {
      toast("Failed to generate test specimen: " + (err?.message || err), "error");
    } finally {
      setSpecimenBusy(false);
    }
  };

  const handleInspectAadhaar = async () => {
    const f = file[0];
    if (!f) {
      toast("Choose an identity document first.", "warn");
      return;
    }
    setAadhaarBusy(true);
    const res = await getAadhaarFields(f);
    setAadhaarBusy(false);
    if (res.ok) {
      setAadhaarBoxes(res.data.fields);
      toast(`Detected ${res.data.count} field zones using 5-class YOLO model.`, "info");
    } else {
      toast(res.error, "error");
    }
  };

  const run = async () => {
    const f = file[0];
    if (!f) {
      toast("Choose an identity document first.", "warn");
      return;
    }
    setBusy(true);
    const declaredMap: Record<string, string> = {};
    if (docNumber.trim()) declaredMap.declared_number = docNumber.trim();

    const res = await screenDocument(
      f,
      docType,
      checkpoint,
      Object.keys(declaredMap).length ? declaredMap : undefined,
      liveFrame || undefined
    );
    setBusy(false);

    if (res.ok) {
      setReport(res.data);
      recordScreeningMetric(res.data.verdict);
      onScreenSuccess(res.data);
      if (res.data.verdict === "CLEAR") {
        toast("Screening CLEAR — document and biometric checks passed.", "success");
      } else if (res.data.verdict === "REVIEW") {
        toast("Screening REVIEW — human adjudication advised.", "warn");
      } else {
        toast("Screening FLAGGED — digital anomalies or watchlist hit.", "error");
      }
    } else {
      toast(res.error, "error");
    }
  };

  const adjudicate = async (decision: "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE") => {
    if (!report) return;
    const res = await adjudicateScreen(report.id, decision, adjudicateNote);
    if (res.ok) {
      toast(`Adjudication saved: ${decision}.`, "success");
      const refreshReport = await getScreenReport(report.id);
      if (refreshReport.ok) setReport(refreshReport.data);
    } else {
      toast(res.error, "error");
    }
  };

  const vm = report ? VERDICT_META[report.verdict] : null;

  // Flatten checks for the Forensic Checks Sub-Table
  const flattenedChecks: Array<{
    module: string;
    test: string;
    verdict: string;
    detail: string;
  }> = [];

  if (report?.modules) {
    // M1
    flattenedChecks.push({
      module: "M1 OCR Extract",
      test: "Document Ingestion & OCR Pre-processing",
      verdict: report.modules.extraction.medium === "unknown" ? "UNVERIFIED" : "PASS",
      detail: `Parsed format: ${report.modules.extraction.medium}. MRZ strip present: ${
        report.modules.extraction.mrz ? "YES" : "NO"
      }.`,
    });

    // M2
    if (report.modules.validation?.checks) {
      for (const c of report.modules.validation.checks) {
        flattenedChecks.push({
          module: "M2 Validation",
          test: c.label,
          verdict: c.ok === true ? "PASS" : c.ok === false ? "FAIL" : "REVIEW",
          detail: c.detail || "Validation check completed against national schemas.",
        });
      }
    }

    // M3
    if (report.modules.tampering?.checks) {
      for (const c of report.modules.tampering.checks) {
        flattenedChecks.push({
          module: "M3 Tamper Forensics",
          test: c.label,
          verdict: c.ok === true ? "PASS" : c.ok === false ? "FAIL" : "REVIEW",
          detail: c.detail || "Error Level Analysis & spectral noise assessment.",
        });
      }
    }

    // M4
    if (report.modules.face) {
      flattenedChecks.push({
        module: "M4 Face Biometrics",
        test: "ArcFace Cosine Embedding Match",
        verdict: report.modules.face.verdict,
        detail: `Method: ${report.modules.face.method}. Score: ${
          report.modules.face.score ? `${Math.round(report.modules.face.score * 100)}%` : "N/A"
        }. ${report.modules.face.detail || ""}`,
      });
    }
  }

  const copyDigest = async (text: string) => {
    await copyText(text);
    toast("Copied hash digest to clipboard.", "success");
  };

  return (
    <div>
      {/* ── COMMAND STATUS & BLOCKCHAIN NOTARIZATION STRIP ───────────────── */}
      <div
        style={{
          background: "rgba(16, 185, 129, 0.08)",
          border: "1px solid rgba(16, 185, 129, 0.28)",
          borderRadius: "var(--r-md)",
          padding: "10px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ fontSize: 18 }}>⛓️</span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <strong style={{ color: "var(--ink)" }}>IMMUTABLE BLOCKCHAIN NOTARY:</strong>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: "999px",
                  background: ledgerAnchor?.in_sync
                    ? "rgba(16, 185, 129, 0.2)"
                    : "rgba(245, 158, 11, 0.2)",
                  color: ledgerAnchor?.in_sync ? "#10b981" : "#f59e0b",
                  border: `1px solid ${
                    ledgerAnchor?.in_sync ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)"
                  }`,
                }}
              >
                {ledgerAnchor?.in_sync
                  ? "IN SYNC & NOTARIZED"
                  : ledgerAnchor?.anchored
                  ? "DRIFT DETECTED"
                  : "STANDBY"}
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                fontFamily: "var(--font-mono)",
                marginTop: 2,
              }}
            >
              Blocks: {ledgerAnchor?.total_blocks ?? 0} · Head:{" "}
              {ledgerAnchor?.anchor_head_hash
                ? `${ledgerAnchor.anchor_head_hash.slice(0, 16)}…`
                : "GENESIS"}{" "}
              · {ledgerAnchor?.anchor_type || "CRYPTOGRAPHIC_NOTARY"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {ledgerAnchor?.public_url && (
            <a
              href={ledgerAnchor.public_url}
              target="_blank"
              rel="noopener noreferrer"
              className="action-btn-sm"
              style={{ textDecoration: "none" }}
            >
              Public Proof ↗
            </a>
          )}
          {isSuper && (
            <button
              type="button"
              className="action-btn-sm"
              disabled={anchorBusy}
              onClick={() => void onTriggerAnchor()}
            >
              {anchorBusy ? "Anchoring…" : "⚓ Notarize Head"}
            </button>
          )}
        </div>
      </div>

      {/* ── DUAL COLUMN WORKSPACE GRID ───────────────────────────────────── */}
      <div className="workspace-grid">
        {/* LEFT COLUMN: DOCUMENT INTAKE */}
        <div>
          <Card title="Document Intake Desk" icon={<IconBolt size={14} />}>
            {/* 1-Click Test Specimen Bar */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span
                  className="stat-note mono"
                  style={{ fontSize: 10, letterSpacing: "0.08em", fontWeight: 700 }}
                >
                  BENCHMARK SPECIMENS (1-CLICK LOAD)
                </span>
                {specimenBusy && (
                  <span className="stat-note" style={{ color: "#f59e0b", fontSize: 10.5 }}>
                    Staging bytes…
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SPECIMEN_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="action-btn-sm"
                    style={{ fontSize: 10.5, padding: "4px 8px" }}
                    onClick={() => void handleLoadPreset(p)}
                    disabled={specimenBusy}
                  >
                    <span>{p.badge}</span>
                    <span>{p.title}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Document Selector Controls */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <label
                  className="stat-note mono"
                  style={{ display: "block", marginBottom: 4, fontWeight: 700 }}
                >
                  DOCUMENT CLASSIFICATION
                </label>
                <select
                  className="subtable-search-input"
                  style={{ width: "100%" }}
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as ScreenDocType)}
                >
                  {SCREEN_DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {formatScreenDocType(t)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className="stat-note mono"
                  style={{ display: "block", marginBottom: 4, fontWeight: 700 }}
                >
                  BORDER CHECKPOINT
                </label>
                <select
                  className="subtable-search-input"
                  style={{ width: "100%" }}
                  value={checkpoint}
                  onChange={(e) => setCheckpoint(e.target.value)}
                >
                  <option value="Panitanki (Indo-Nepal)">Panitanki ICP (Indo-Nepal)</option>
                  <option value="Raxaul ICP">Raxaul ICP (Indo-Nepal)</option>
                  <option value="Sonauli (Indo-Nepal)">Sonauli ICP (Indo-Nepal)</option>
                  <option value="Jogbani (Indo-Nepal)">Jogbani ICP (Indo-Nepal)</option>
                  <option value="Jaigaon (Indo-Bhutan)">Jaigaon ICP (Indo-Bhutan)</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Field label={`DECLARED ${formatScreenDocType(docType).toUpperCase()} IDENTIFIER (OPTIONAL)`}>
                <input
                  className="subtable-search-input"
                  style={{ width: "100%" }}
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder={SCREEN_DOC_NUMBER_PLACEHOLDERS[docType]}
                />
              </Field>
              <div className="stat-note mt-1" style={{ fontSize: 10 }}>
                Used to check consistency against OCR &amp; MRZ extract
              </div>
            </div>

            {/* Drag & Drop File Ingest */}
            <div style={{ marginBottom: 14 }}>
              <Dropzone
                label="Identity Document"
                sub="Accepts PDF, JPEG, PNG, WebP up to 8 MB"
                files={file}
                onFiles={setFile}
                accept="image/*,application/pdf"
              />
            </div>

            {/* YOLO 5-Class ID Zone Detector Action */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--surface-2)",
                padding: "8px 12px",
                borderRadius: "var(--r-sm)",
                marginBottom: 14,
              }}
            >
              <div>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
                  YOLOv8 5-CLASS FIELD EXTRACTION
                </span>
                <div className="stat-note" style={{ fontSize: 10 }}>
                  Detects Name, DOB, Gender, ID No, and Photo bounding boxes
                </div>
              </div>
              <button
                type="button"
                className="action-btn-sm"
                disabled={aadhaarBusy || file.length === 0}
                onClick={handleInspectAadhaar}
              >
                {aadhaarBusy ? "Scanning…" : "Scan 5 Zones"}
              </button>
            </div>

            {aadhaarBoxes && aadhaarBoxes.length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
                {aadhaarBoxes.map((b, i) => (
                  <span className="screen-chip mono" key={i}>
                    {b.label}: {Math.round(b.confidence * 100)}% conf
                  </span>
                ))}
              </div>
            )}

            <Button
              variant="seal"
              type="button"
              disabled={busy || file.length === 0}
              onClick={run}
              style={{ width: "100%", padding: "10px 16px", fontSize: 13 }}
            >
              {busy ? "Running Four-Module Forensics…" : "Execute AI Screening Protocol"}
            </Button>
          </Card>
        </div>

        {/* RIGHT COLUMN: MODULE 4 BIOMETRIC LIVENESS */}
        <div>
          <Card
            title="Module 4: Biometric Liveness Kiosk"
            icon={<IconBolt size={14} />}
          >
            <p className="stat-note" style={{ marginBottom: 12 }}>
              Captures real-time holder biometrics, executes challenge-response liveness tests
              (blink/nod/turn), and matches facial embedding against document portrait.
            </p>

            <LiveCaptureKiosk
              onFrame={setLiveFrame}
              onLivenessStatus={setLiveLivenessStatus}
            />

            {liveLivenessStatus && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: "var(--r-sm)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11.5,
                }}
              >
                <span>
                  Liveness Verdict:{" "}
                  <strong>{liveLivenessStatus.verdict || "NOT RUN"}</strong>
                </span>
                {liveLivenessStatus.confidence !== null && (
                  <span className="mono">
                    Score: {Math.round(liveLivenessStatus.confidence * 100)}%
                  </span>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── SCREENING REPORT & FORENSIC SCORECARD ──────────────────────────── */}
      {report && (
        <div style={{ marginTop: 22 }}>
          <Card title="Screening Result & Forensic Dossier">
            {/* Top Score & Verdict Strip */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                padding: "12px 18px",
                background: "var(--surface-2)",
                borderRadius: "var(--r-md)",
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Pill
                  tone={vm?.pill || "slate"}
                  style={{ fontSize: 14, padding: "6px 14px", fontWeight: 700 }}
                >
                  {report.verdict}
                </Pill>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span className="stat-note mono" style={{ fontSize: 11 }}>
                      COMPOSITE RISK SCORE:
                    </span>
                    <strong
                      style={{
                        fontSize: 20,
                        fontFamily: "var(--mono)",
                        color:
                          report.risk_score >= 60
                            ? "var(--danger)"
                            : report.risk_score >= 35
                            ? "var(--amber)"
                            : "#059669",
                      }}
                    >
                      {report.risk_score}/100
                    </strong>
                  </div>
                  <span className="stat-note mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                    Report ID: {report.id}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a
                  href={getDossierUrl(report.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="action-btn-sm"
                  style={{ textDecoration: "none", fontSize: 11, padding: "6px 12px" }}
                >
                  ⚖️ Printable Court Dossier ↗
                </a>

                {report.block_hash && (
                  <button
                    type="button"
                    className="action-btn-sm"
                    style={{ fontSize: 11, padding: "6px 12px" }}
                    onClick={() => copyDigest(report.block_hash || "")}
                  >
                    ⛓️ Copy Block #{report.block_hash.slice(0, 8)}…
                  </button>
                )}
              </div>
            </div>

            {/* Travel Validity (ICAO Annex 9) */}
            {report.travel_validity && (
              <TravelValidityBadge tv={report.travel_validity} />
            )}

            {/* Module Scorecard summary pills */}
            {report.modules && <ModuleScorecard modules={report.modules} />}

            {/* Extracted Fields Sub-Table */}
            {report.masked_fields && (
              <div className="nested-subtable-wrapper" style={{ margin: "18px 0 14px 0" }}>
                <div className="nested-subtable-nav">
                  <span className="stat-note mono" style={{ fontWeight: 700 }}>
                    EXTRACTED IDENTIFIER ATTRIBUTES &amp; PRIVACY MASK SUB-TABLE
                  </span>
                  <span className="stat-note mono" style={{ fontSize: 10 }}>
                    Zero-Storage Architecture: Plaintext never persisted
                  </span>
                </div>
                <div className="nested-subtable-inner">
                  <table className="nested-subtable">
                    <thead>
                      <tr>
                        <th style={{ width: 220 }}>Attribute Name</th>
                        <th>Extracted Masked Value</th>
                        <th style={{ width: 140 }}>Compliance Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(report.masked_fields).map(([k, v]) => (
                        <tr key={k}>
                          <td className="mono" style={{ fontWeight: 600 }}>
                            {MASKED_FIELD_LABELS[k] || k.toUpperCase()}
                          </td>
                          <td className="mono" style={{ color: "#059669" }}>
                            {formatMaskedFieldValue(v)}
                          </td>
                          <td>
                            <span className="badge-chain">VERIFIED</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Comprehensive Forensic Checks Sub-Table */}
            {flattenedChecks.length > 0 && (
              <div style={{ margin: "14px 0" }}>
                <ForensicChecksSubTable checks={flattenedChecks} />
              </div>
            )}

            {/* Deep Module Panels for M1-M4 */}
            {report.modules && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                <div id="m1-panel">
                  <ModulePanel
                    label="Module 1: OCR Extraction & Ingestion"
                    verdict={report.modules.extraction.medium === "unknown" ? "UNVERIFIED" : "PASS"}
                    tone={report.modules.extraction.medium === "unknown" ? "slate" : "seal"}
                    extra={`Document media: ${report.modules.extraction.medium.toUpperCase()}. Document-aware parser: ${
                      report.modules.extraction.document_aware ? "ACTIVE" : "GENERIC"
                    }.`}
                  />
                </div>

                <div id="m2-panel">
                  <ModulePanel
                    label="Module 2: Document Validation & Checksums"
                    verdict={report.modules.validation.verdict}
                    tone={MODULE_VERDICT_TONE[report.modules.validation.verdict] || "slate"}
                    checks={report.modules.validation.checks}
                  />
                </div>

                <div id="m3-panel">
                  <ModulePanel
                    label="Module 3: Tampering & Digital Manipulation Forensics"
                    verdict={report.modules.tampering.verdict}
                    tone={MODULE_VERDICT_TONE[report.modules.tampering.verdict] || "slate"}
                    checks={report.modules.tampering.checks}
                    heatmapB64={report.modules.tampering.heatmap_b64}
                    tamperingData={report.modules.tampering}
                  />
                </div>

                <div id="m4-panel">
                  <ModulePanel
                    label="Module 4: Face Detection & Biometric Liveness Verification"
                    verdict={report.modules.face.verdict}
                    tone={MODULE_VERDICT_TONE[report.modules.face.verdict] || "slate"}
                    extra={report.modules.face.detail}
                    checks={report.modules.face.checks}
                  />
                </div>
              </div>
            )}

            {/* Supervisor Adjudication Actions */}
            {isSuper && (
              <div
                style={{
                  marginTop: 20,
                  padding: "14px 18px",
                  background: "var(--surface-2)",
                  borderRadius: "var(--r-md)",
                  border: "1px solid var(--line-2)",
                }}
              >
                <span
                  className="kicker kicker--plain"
                  style={{ display: "block", marginBottom: 8 }}
                >
                  Supervisor Adjudication
                </span>
                <p className="stat-note" style={{ marginBottom: 12 }}>
                  Override or confirm AI findings. Your decision is cryptographically anchored to
                  the audit ledger.
                </p>

                <div style={{ marginBottom: 10 }}>
                  <input
                    className="subtable-search-input"
                    style={{ width: "100%" }}
                    value={adjudicateNote}
                    onChange={(e) => setAdjudicateNote(e.target.value)}
                    placeholder="Adjudication directive or rationale (e.g. Physical seal inspected, legitimate passport holder)…"
                  />
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="seal"
                    type="button"
                    onClick={() => void adjudicate("CLEARED")}
                    style={{ fontSize: 11 }}
                  >
                    ✓ Confirm Cleared
                  </Button>
                  <Button
                    variant="danger-ghost"
                    type="button"
                    onClick={() => void adjudicate("CONFIRMED_FRAUD")}
                    style={{ fontSize: 11 }}
                  >
                    ✗ Confirm Fraud
                  </Button>
                  <button
                    type="button"
                    className="action-btn-sm"
                    onClick={() => void adjudicate("INCONCLUSIVE")}
                  >
                    ? Inconclusive
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
