// ============================================================================
// ModuleScorecard.tsx — Four-Module Forensic Intelligence & Verification Panel
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// ============================================================================

import { useState } from "react";
import { Pill } from "../../components/ui";
import {
  MODULE_VERDICT_TONE,
  type ModuleCheckRow,
  type ScreenReport,
} from "./types";
import type { ScreenCheck, ScreenModuleTampering, ScreenTravelValidity } from "../../api";

export function TravelValidityBadge({ tv }: { tv: ScreenTravelValidity }) {
  const tone =
    tv.status === "VALID"
      ? "seal"
      : tv.status === "EXPIRING_SOON"
      ? "amber"
      : tv.status === "EXPIRED"
      ? "danger"
      : "slate";

  return (
    <div
      className="module-panel"
      style={{
        background: "var(--surface-2)",
        borderRadius: "var(--r-md)",
        padding: "10px 14px",
        marginTop: 10,
      }}
    >
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="kicker kicker--plain" style={{ margin: 0 }}>
          Travel Validity (ICAO Annex 9)
        </span>
        <Pill tone={tone}>{tv.status.replace("_", " ")}</Pill>
        {tv.days_to_expiry !== null && (
          <span className="stat-note mono">
            {tv.days_to_expiry >= 0
              ? `${tv.days_to_expiry} days valid`
              : `${Math.abs(tv.days_to_expiry)} days overdue`}
          </span>
        )}
        {tv.six_month_rule !== null && (
          <Pill tone={tv.six_month_rule ? "seal" : "amber"}>
            6-Month Rule: {tv.six_month_rule ? "SATISFIED" : "DEFICIENT"}
          </Pill>
        )}
        {tv.age_at_crossing !== null && (
          <span className="stat-note mono">Holder Age: {tv.age_at_crossing} yrs</span>
        )}
      </div>
      <div className="stat-note mt-2" style={{ fontSize: 12 }}>
        {tv.detail}
      </div>
    </div>
  );
}

export function ModuleScorecard({
  modules,
}: {
  modules: NonNullable<ScreenReport["modules"]>;
}) {
  const pills: { id: string; label: string; verdict: string }[] = [
    {
      id: "m1",
      label: "M1 OCR Extract",
      verdict: modules.extraction.medium === "unknown" ? "UNVERIFIED" : "PASS",
    },
    { id: "m2", label: "M2 Validation", verdict: modules.validation.verdict },
    { id: "m3", label: "M3 Tamper Forensics", verdict: modules.tampering.verdict },
    { id: "m4", label: "M4 Face & Liveness", verdict: modules.face.verdict },
  ];

  return (
    <div className="row mt-3" style={{ gap: 8, flexWrap: "wrap" }}>
      {pills.map((p) => (
        <a
          key={p.id}
          href={`#${p.id}-panel`}
          style={{ textDecoration: "none" }}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(`${p.id}-panel`)?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: "var(--r-md)",
              background: "var(--surface-2)",
              border: "1px solid var(--line-2)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <span className="stat-note mono" style={{ fontSize: 11 }}>
              {p.label}
            </span>
            <Pill tone={MODULE_VERDICT_TONE[p.verdict] || "slate"} style={{ margin: 0 }}>
              {p.verdict}
            </Pill>
          </div>
        </a>
      ))}
    </div>
  );
}

export function ScreenCheckRow({ check }: { check: ScreenCheck | ModuleCheckRow }) {
  const tone = check.ok === true ? "pass" : check.ok === false ? "fail" : "na";
  return (
    <div className={`screen-check screen-check--${tone}`}>
      <span className="screen-check__dot" aria-hidden="true" />
      <span className="screen-check__label mono">{check.label}</span>
      <span className="screen-check__detail">{check.detail || "—"}</span>
    </div>
  );
}

export function ModulePanel({
  label,
  verdict,
  tone,
  extra,
  rows,
  checks,
  heatmapB64,
  tamperingData,
}: {
  label: string;
  verdict: string;
  tone: "seal" | "amber" | "danger" | "slate";
  extra?: string;
  rows?: [string, string][];
  checks?: (ScreenCheck | ModuleCheckRow)[];
  heatmapB64?: string | null;
  tamperingData?: ScreenModuleTampering;
}) {
  const [heatOn, setHeatOn] = useState(false);
  const spectral = tamperingData?.spectral;
  const noise = tamperingData?.noise_consistency;
  const qa = tamperingData?.qa;
  const roi = tamperingData?.roi;

  return (
    <div className="module-panel">
      <div className="module-panel__head">
        <span className="kicker kicker--plain" style={{ margin: 0 }}>
          {label}
        </span>
        <Pill tone={tone}>{verdict}</Pill>
      </div>

      {extra && <div className="stat-note mb-2">{extra}</div>}

      {rows && (
        <div className="screen-fields" style={{ marginBottom: checks?.length ? 10 : 0 }}>
          {rows.map(([k, v]) => (
            <span className="screen-chip mono" key={k}>
              {k}: {v}
            </span>
          ))}
        </div>
      )}

      {/* Forensic Deep-Dive Metrics for M3 Tamper */}
      {tamperingData && (
        <div className="stack-sm mb-3">
          {spectral && spectral.papr !== undefined && (
            <div
              style={{
                padding: "8px 12px",
                background: "var(--surface-2)",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--line-2)",
                fontSize: 11.5,
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong>2D-FFT Spectral Resampling:</strong> PAPR {spectral.papr.toFixed(1)}x
                </span>
                <Pill tone={spectral.spectral_anomaly ? "danger" : "seal"} style={{ margin: 0 }}>
                  {spectral.status || "NORMAL"}
                </Pill>
              </div>
              {spectral.detail && (
                <div className="stat-note mt-1" style={{ fontSize: 11 }}>
                  {spectral.detail}
                </div>
              )}
            </div>
          )}

          {noise && noise.noise_ratio !== undefined && (
            <div
              style={{
                padding: "8px 12px",
                background: "var(--surface-2)",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--line-2)",
                fontSize: 11.5,
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong>Sensor PRNU Noise Inconsistency:</strong> Ratio {noise.noise_ratio.toFixed(2)}x
                </span>
                <Pill tone={noise.consistent ? "seal" : "danger"} style={{ margin: 0 }}>
                  {noise.status || "CONSISTENT"}
                </Pill>
              </div>
              {noise.detail && (
                <div className="stat-note mt-1" style={{ fontSize: 11 }}>
                  {noise.detail}
                </div>
              )}
            </div>
          )}

          {qa && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", fontSize: 11 }}>
              {qa.megapixels !== undefined && (
                <span className="screen-chip mono">
                  QA: {qa.megapixels} MP ({qa.width}x{qa.height})
                </span>
              )}
              {qa.blur_est !== undefined && (
                <span className="screen-chip mono">
                  Blur: {qa.blur_est} ({qa.blurry ? "BLURRY" : "SHARP"})
                </span>
              )}
              {qa.overexposed && (
                <span className="screen-chip mono" style={{ color: "var(--danger)" }}>
                  OVEREXPOSED
                </span>
              )}
              {qa.underexposed && (
                <span className="screen-chip mono" style={{ color: "var(--danger)" }}>
                  UNDEREXPOSED
                </span>
              )}
            </div>
          )}

          {roi && roi.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", fontSize: 11, marginTop: 4 }}>
              <span className="stat-note mono">YOLO ROI Zones:</span>
              {roi.map((r, i) => (
                <span className="screen-chip mono" key={i}>
                  {r.label} ({Math.round((r.confidence || 0) * 100)}%)
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {checks && checks.length > 0 && (
        <div className="stack-sm">
          {checks.map((c, i) =>
            typeof c === "string" ? null : <ScreenCheckRow key={i} check={c} />,
          )}
        </div>
      )}

      {heatmapB64 && (
        <>
          <button
            type="button"
            className="mini-btn mt-3"
            onClick={() => setHeatOn((v) => !v)}
          >
            {heatOn ? "Hide ELA Heatmap" : "View ELA Re-Compression Heatmap"}
          </button>
          {heatOn && (
            <div style={{ marginTop: 8 }}>
              <img
                className="heatmap-img"
                src={`data:image/png;base64,${heatmapB64}`}
                alt="Error Level Analysis Heatmap"
                style={{
                  width: "100%",
                  maxHeight: 320,
                  objectFit: "contain",
                  borderRadius: "var(--r-sm)",
                  border: "1px solid var(--line)",
                }}
              />
              <p className="stat-note mt-1" style={{ fontSize: 10 }}>
                High-gradient white/cyan pixel regions highlight distinct quantization compression grids, signifying spliced edits.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * High-density Forensic Checks Sub-Table
 * Summarizes all checks performed across Modules 1 to 4 into an orderly, sortable table.
 */
export function ForensicChecksSubTable({
  checks,
}: {
  checks: Array<{ module: string; test: string; verdict: string; detail: string; riskWeight?: string }>;
}) {
  return (
    <div className="nested-subtable-wrapper">
      <div className="nested-subtable-nav">
        <span className="stat-note mono" style={{ fontWeight: 700 }}>
          FORENSIC EVIDENCE &amp; STATUTORY AUDIT SUB-TABLE ({checks.length} CHECKS)
        </span>
      </div>
      <div className="nested-subtable-inner">
        <table className="nested-subtable">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Module</th>
              <th>Forensic Check</th>
              <th style={{ width: 110 }}>Verdict</th>
              <th>Observed Evidence</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontWeight: 600 }}>{c.module}</td>
                <td><strong>{c.test}</strong></td>
                <td>
                  <Pill tone={MODULE_VERDICT_TONE[c.verdict] || "slate"} style={{ margin: 0 }}>
                    {c.verdict}
                  </Pill>
                </td>
                <td className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)" }}>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
