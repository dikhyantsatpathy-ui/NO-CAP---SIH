// ============================================================================
// SyndicateThreatSubTable.tsx — Cross-Border Threat Intelligence & Sub-Tables
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// ============================================================================

import { useState } from "react";
import { Pill } from "../../components/ui";
import { useToast } from "../../app/state";
import { copyText } from "../../app/util";

interface SyndicateThreatSubTableProps {
  data: {
    alerts: Array<{
      level: string;
      type: string;
      title: string;
      detail: string;
      checkpoint: string;
    }>;
    total_screened_sample: number;
    active_alerts_count: number;
    checkpoint_filter: string;
  } | null;
  busy: boolean;
  filter: string;
  onFilterChange: (cp: string) => void;
  onRefresh: () => void;
}

// Simulated linked border incidents for deep drill-down sub-table
const MOCK_INCIDENTS: Record<
  string,
  Array<{
    id: string;
    location: string;
    timestamp: string;
    hashPrefix: string;
    signature: string;
    officerAction: string;
    statutoryCase: string;
  }>
> = {
  RECIDIVISM: [
    {
      id: "INC-9102-PT",
      location: "Panitanki Post (Indo-Nepal)",
      timestamp: "Today, 01:14 IST",
      hashPrefix: "sha256:7f8a92b…",
      signature: "Identical forged Aadhaar UID with swapped portrait",
      officerAction: "Traveler detained for secondary questioning",
      statutoryCase: "MHA/SSB/2026/891",
    },
    {
      id: "INC-8834-RX",
      location: "Raxaul Checkpoint (Indo-Nepal)",
      timestamp: "Yesterday, 18:42 IST",
      hashPrefix: "sha256:7f8a92b…",
      signature: "Same Aadhaar hash submitted under alias 'Ramesh K.'",
      officerAction: "Border entry denied · Biometric flagged",
      statutoryCase: "MHA/SSB/2026/842",
    },
  ],
  CHECKPOINT_CLASH: [
    {
      id: "INC-9210-JG",
      location: "Jogbani Post (Indo-Nepal)",
      timestamp: "Today, 00:28 IST",
      hashPrefix: "sha256:4c3d11a…",
      signature: "Passport presented simultaneously at Jogbani & Birgunj",
      officerAction: "Interpol alert triggered · Both subjects held",
      statutoryCase: "MHA/SSB/2026/902",
    },
    {
      id: "INC-9205-BG",
      location: "Birgunj ICP (Indo-Nepal)",
      timestamp: "Today, 00:25 IST",
      hashPrefix: "sha256:4c3d11a…",
      signature: "Cloned ICAO 9303 MRZ strip",
      officerAction: "Physical passport seized by SSB Unit 12",
      statutoryCase: "MHA/SSB/2026/901",
    },
  ],
  BURST_PROBING: [
    {
      id: "INC-9301-SN",
      location: "Sonauli ICP (Indo-Nepal)",
      timestamp: "Today, 01:22 IST",
      hashPrefix: "sha256:1a2b3c4…",
      signature: "Rapid sequential submission of 6 synthetic DL cards",
      officerAction: "Automated rate-limit and supervisor lockdown engaged",
      statutoryCase: "MHA/SSB/2026/915",
    },
  ],
};

export function SyndicateThreatSubTable({
  data,
  busy,
  filter,
  onFilterChange,
  onRefresh,
}: SyndicateThreatSubTableProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [expandedAlertIdx, setExpandedAlertIdx] = useState<number | null>(null);

  const alerts = data?.alerts || [];
  const q = search.trim().toLowerCase();
  const displayed = alerts.filter((a) => {
    if (!q) return true;
    return (
      a.title.toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q) ||
      a.detail.toLowerCase().includes(q) ||
      a.checkpoint.toLowerCase().includes(q)
    );
  });

  const toggleExpand = (idx: number) => {
    setExpandedAlertIdx(expandedAlertIdx === idx ? null : idx);
  };

  const copyHash = async (text: string) => {
    await copyText(text);
    toast("Hash digest copied.", "success");
  };

  return (
    <div>
      {/* ── TOP KPI SUMMARY ROW ───────────────────────────────────────────── */}
      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-card__label">Active Syndicate Alerts</span>
          <span
            className="kpi-card__val"
            style={{
              color: (data?.active_alerts_count || 0) > 0 ? "var(--danger)" : "var(--seal)",
            }}
          >
            {data?.active_alerts_count || 0}
          </span>
          <span className="kpi-card__sub">Recidivism &amp; collision triggers</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Global Screenings Monitored</span>
          <span className="kpi-card__val">{data?.total_screened_sample || 0}</span>
          <span className="kpi-card__sub">Sample across all border posts</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Monitored Sectors</span>
          <span className="kpi-card__val">4 ICPs</span>
          <span className="kpi-card__sub">Raxaul · Panitanki · Jogbani · Jaigaon</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Zero-Knowledge Hash Index</span>
          <span className="kpi-card__val" style={{ color: "#059669" }}>
            ONLINE
          </span>
          <span className="kpi-card__sub">Zero-knowledge multi-checkpoint scan</span>
        </div>
      </div>

      {/* ── MASTER SUBTABLE CONTAINER ─────────────────────────────────────── */}
      <div className="subtable-container">
        <div className="subtable-topbar">
          <div className="subtable-title-area">
            <span style={{ fontSize: 22 }}>🚨</span>
            <div>
              <div className="subtable-title">Cross-Border Syndicate Threat Intel</div>
              <div className="subtable-subtitle">
                Correlated intelligence across Indo-Nepal &amp; Indo-Bhutan border posts detecting organized multi-point identity reuse.
              </div>
            </div>
          </div>

          <div className="subtable-controls">
            <input
              className="subtable-search-input"
              placeholder="Search threat alerts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="subtable-search-input"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              style={{ width: 170 }}
            >
              <option value="">All Checkpoints</option>
              <option value="Raxaul ICP">Raxaul ICP (Bihar/Nepal)</option>
              <option value="Panitanki ICP">Panitanki ICP (WB/Nepal)</option>
              <option value="Jogbani ICP">Jogbani ICP (Bihar/Nepal)</option>
              <option value="Jaigaon ICP">Jaigaon ICP (WB/Bhutan)</option>
            </select>

            <button
              type="button"
              className="action-btn-sm"
              disabled={busy}
              onClick={onRefresh}
            >
              {busy ? "Updating…" : "🔄 Refresh Intel"}
            </button>
          </div>
        </div>

        {/* ── MASTER ALERTS TABLE ─────────────────────────────────────────── */}
        <div className="subtable-scroll">
          <table className="subtable">
            <thead>
              <tr>
                <th style={{ width: 44, textAlign: "center" }}>SUB</th>
                <th style={{ width: 100 }}>Severity</th>
                <th>Threat Classification</th>
                <th>Primary Sector</th>
                <th>Operational Threat Assessment</th>
                <th style={{ textAlign: "right", minWidth: 120 }}>Directive</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "36px 12px", color: "var(--ink-3)" }}>
                    <span style={{ fontSize: 24, display: "block", marginBottom: 6 }}>🛡️</span>
                    No active cross-border syndicate alerts reported in this sector.
                  </td>
                </tr>
              ) : (
                displayed.map((alert, idx) => {
                  const isExpanded = expandedAlertIdx === idx;
                  const incidentKey = alert.type.toUpperCase().includes("RECIDIV")
                    ? "RECIDIVISM"
                    : alert.type.toUpperCase().includes("CLASH")
                    ? "CHECKPOINT_CLASH"
                    : "BURST_PROBING";
                  const linkedIncidents = MOCK_INCIDENTS[incidentKey] || MOCK_INCIDENTS.RECIDIVISM;

                  return (
                    <>
                      <tr key={idx} className={isExpanded ? "subtable-row--expanded" : ""}>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className={`subtable-expand-btn ${isExpanded ? "subtable-expand-btn--active" : ""}`}
                            onClick={() => toggleExpand(idx)}
                            title={isExpanded ? "Collapse incident sub-table" : "Expand linked incidents sub-table"}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </button>
                        </td>

                        <td>
                          <Pill
                            tone={
                              alert.level === "CRITICAL"
                                ? "danger"
                                : alert.level === "HIGH"
                                ? "danger"
                                : alert.level === "ELEVATED"
                                ? "amber"
                                : "slate"
                            }
                          >
                            {alert.level}
                          </Pill>
                        </td>

                        <td>
                          <strong style={{ fontSize: 12 }}>{alert.title}</strong>
                          <div className="stat-note mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>
                            TYPE: {alert.type}
                          </div>
                        </td>

                        <td className="mono" style={{ fontSize: 11 }}>
                          {alert.checkpoint || "Multi-Checkpoint (Regional)"}
                        </td>

                        <td style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                          {alert.detail}
                        </td>

                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="action-btn-sm"
                            onClick={() => toggleExpand(idx)}
                            style={{ color: "#059669" }}
                          >
                            {isExpanded ? "Hide Sub-Table" : "Inspect Incidents →"}
                          </button>
                        </td>
                      </tr>

                      {/* ── EXPANDED LINKED INCIDENTS SUB-TABLE ───────────────── */}
                      {isExpanded && (
                        <tr className="nested-subtable-row" key={`${idx}-incidents-subtable`}>
                          <td colSpan={6}>
                            <div className="nested-subtable-wrapper">
                              <div className="nested-subtable-nav">
                                <span className="stat-note mono" style={{ fontWeight: 700 }}>
                                  LINKED BORDER INCIDENTS &amp; REPEAT ENCOUNTERS ({linkedIncidents.length} EVENTS)
                                </span>
                                <span className="stat-note mono" style={{ fontSize: 10 }}>
                                  Zero-Knowledge Hash Match Protocol Active
                                </span>
                              </div>

                              <div className="nested-subtable-inner">
                                <table className="nested-subtable">
                                  <thead>
                                    <tr>
                                      <th style={{ width: 110 }}>Incident ID</th>
                                      <th>Checkpoint Sector</th>
                                      <th>Observation Time</th>
                                      <th>Suspect Document Hash</th>
                                      <th>Observed Tampering Signature</th>
                                      <th>Field Action Taken</th>
                                      <th style={{ width: 130 }}>Statutory Dossier</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {linkedIncidents.map((inc) => (
                                      <tr key={inc.id}>
                                        <td className="mono" style={{ fontWeight: 600 }}>{inc.id}</td>
                                        <td>{inc.location}</td>
                                        <td className="mono" style={{ fontSize: 10.5 }}>{inc.timestamp}</td>
                                        <td className="mono" style={{ fontSize: 10.5 }}>
                                          <span
                                            style={{ cursor: "pointer", textDecoration: "underline" }}
                                            onClick={() => copyHash(inc.hashPrefix)}
                                            title="Click to copy digest"
                                          >
                                            {inc.hashPrefix}
                                          </span>
                                        </td>
                                        <td style={{ fontSize: 10.5 }}>{inc.signature}</td>
                                        <td>
                                          <span className="badge-chain" style={{ fontSize: 9.5 }}>
                                            {inc.officerAction}
                                          </span>
                                        </td>
                                        <td className="mono" style={{ fontSize: 10 }}>
                                          {inc.statutoryCase}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="subtable-footer">
          <span>{displayed.length} active syndicate alerts recorded</span>
          <span className="mono">Ministry of Home Affairs · Intelligence Correlation Engine</span>
        </div>
      </div>
    </div>
  );
}
