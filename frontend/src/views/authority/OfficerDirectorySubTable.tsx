// ============================================================================
// OfficerDirectorySubTable.tsx — Officer Roster Clearance & Sub-Tables
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// ============================================================================

import { useState } from "react";
import { type OfficerEntry } from "../../api";
import { initials } from "../../app/util";
import { Button, Modal, Pill } from "../../components/ui";

interface OfficerDirectorySubTableProps {
  signers: OfficerEntry[];
  isSuper: boolean;
  onAssignRole: (email: string, designation: string, institution: string) => Promise<void>;
}

export function OfficerDirectorySubTable({
  signers,
  isSuper,
  onAssignRole,
}: OfficerDirectorySubTableProps) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedOfficerEmail, setExpandedOfficerEmail] = useState<string | null>(null);
  const [roleAssign, setRoleAssign] = useState<{
    email: string;
    name: string;
    designation: string;
    institution: string;
  } | null>(null);

  const q = search.trim().toLowerCase();
  const displayed = signers.filter((s) => {
    if (!q) return true;
    return (
      (s.name || "").toLowerCase().includes(q) ||
      (s.email || "").toLowerCase().includes(q) ||
      (s.designation || "").toLowerCase().includes(q) ||
      (s.institution || "").toLowerCase().includes(q)
    );
  });

  const handleAssignSubmit = async () => {
    if (!roleAssign) return;
    setBusy(true);
    await onAssignRole(roleAssign.email, roleAssign.designation, roleAssign.institution);
    setBusy(false);
    setRoleAssign(null);
  };

  const toggleExpand = (email: string) => {
    setExpandedOfficerEmail(expandedOfficerEmail === email ? null : email);
  };

  return (
    <div>
      {/* ── TOP KPI SUMMARY ROW ───────────────────────────────────────────── */}
      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-card__label">Authorized Screening Officers</span>
          <span className="kpi-card__val" style={{ color: "#059669" }}>
            {signers.length}
          </span>
          <span className="kpi-card__sub">Border security personnel</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Active Border Checkpoints</span>
          <span className="kpi-card__val">4 ICPs</span>
          <span className="kpi-card__sub">Indo-Nepal &amp; Indo-Bhutan border posts</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Active Clearances</span>
          <span className="kpi-card__val">
            {signers.filter((s) => s.designation && s.institution).length}
          </span>
          <span className="kpi-card__sub">Designated duty officers</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-card__label">Pending Clearances</span>
          <span
            className="kpi-card__val"
            style={{
              color:
                signers.filter((s) => !(s.designation && s.institution)).length > 0
                  ? "var(--amber)"
                  : "var(--ink-3)",
            }}
          >
            {signers.filter((s) => !(s.designation && s.institution)).length}
          </span>
          <span className="kpi-card__sub">Awaiting post assignment</span>
        </div>
      </div>

      {/* ── MASTER SUBTABLE CONTAINER ─────────────────────────────────────── */}
      <div className="subtable-container">
        <div className="subtable-topbar">
          <div className="subtable-title-area">
            <span style={{ fontSize: 22 }}>🛡️</span>
            <div>
              <div className="subtable-title">Officer Directory &amp; Roster Clearance</div>
              <div className="subtable-subtitle">
                Authorized border-screening personnel with designated checkposts and institutional clearance.
              </div>
            </div>
          </div>

          <div className="subtable-controls">
            <input
              className="subtable-search-input"
              placeholder="Search officers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* ── MASTER TABLE ────────────────────────────────────────────────── */}
        <div className="subtable-scroll">
          <table className="subtable">
            <thead>
              <tr>
                <th style={{ width: 44, textAlign: "center" }}>SUB</th>
                <th>Officer Name</th>
                <th>Email Address</th>
                <th>Designation / Post</th>
                <th>Assigned Institution</th>
                <th>Clearance Status</th>
                {isSuper && <th style={{ textAlign: "right", minWidth: 120 }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td
                    colSpan={isSuper ? 7 : 6}
                    style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-3)" }}
                  >
                    No officers match the filter.
                  </td>
                </tr>
              ) : (
                displayed.map((s) => {
                  const pending = !(s.designation && s.institution);
                  const isExpanded = expandedOfficerEmail === s.email;

                  return (
                    <>
                      <tr key={s.email} className={isExpanded ? "subtable-row--expanded" : ""}>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className={`subtable-expand-btn ${isExpanded ? "subtable-expand-btn--active" : ""}`}
                            onClick={() => toggleExpand(s.email)}
                            title={isExpanded ? "Collapse sub-table" : "Expand duty roster sub-table"}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </button>
                        </td>

                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                              className="authority-row__avatar"
                              style={{ width: 28, height: 28, fontSize: 11 }}
                            >
                              {initials(s.name)}
                            </span>
                            <strong style={{ fontSize: 12.5 }}>{s.name}</strong>
                          </div>
                        </td>

                        <td className="mono" style={{ fontSize: 11 }}>
                          {s.email}
                        </td>

                        <td style={{ fontSize: 11.5 }}>
                          {s.designation || (
                            <span style={{ color: "var(--amber)", fontStyle: "italic" }}>
                              Unassigned
                            </span>
                          )}
                        </td>

                        <td style={{ fontSize: 11.5 }}>
                          {s.institution || (
                            <span style={{ color: "var(--amber)", fontStyle: "italic" }}>
                              Pending Assignment
                            </span>
                          )}
                        </td>

                        <td>
                          <Pill tone={pending ? "amber" : "seal"}>
                            {pending ? "Pending Role" : "Active Screener"}
                          </Pill>
                        </td>

                        {isSuper && (
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="action-btn-sm"
                              onClick={() =>
                                setRoleAssign({
                                  email: s.email,
                                  name: s.name,
                                  designation: s.designation || "Border Screening Officer",
                                  institution: s.institution || "Sashastra Seema Bal (SSB)",
                                })
                              }
                            >
                              ⚙ Assign Role
                            </button>
                          </td>
                        )}
                      </tr>

                      {/* ── EXPANDED DUTY ASSIGNMENT SUB-TABLE ────────────────── */}
                      {isExpanded && (
                        <tr className="nested-subtable-row" key={`${s.email}-roster-subtable`}>
                          <td colSpan={isSuper ? 7 : 6}>
                            <div className="nested-subtable-wrapper">
                              <div className="nested-subtable-nav">
                                <span className="stat-note mono" style={{ fontWeight: 700 }}>
                                  DUTY CLEARANCE &amp; SHIFT ROSTER FOR {s.name.toUpperCase()}
                                </span>
                                <span className="stat-note mono" style={{ fontSize: 10 }}>
                                  CLEARANCE LEVEL: TIER 1 (BORDER SCREENER)
                                </span>
                              </div>

                              <div className="nested-subtable-inner">
                                <table className="nested-subtable">
                                  <thead>
                                    <tr>
                                      <th style={{ width: 140 }}>Border Sector</th>
                                      <th>Active Duty Station</th>
                                      <th>Shift Schedule</th>
                                      <th>Digital Signing Key</th>
                                      <th>Clearance Expiry</th>
                                      <th style={{ width: 140 }}>Compliance</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      <td className="mono">Sector Alpha</td>
                                      <td>Panitanki ICP · Lane 2 (Pedestrian &amp; Transit)</td>
                                      <td className="mono">06:00 - 14:00 IST (Morning Shift)</td>
                                      <td className="mono">HMAC-SHA256 Active</td>
                                      <td className="mono">2027-03-31</td>
                                      <td><span className="badge-chain">AUTHORISED</span></td>
                                    </tr>
                                    <tr>
                                      <td className="mono">Sector Bravo</td>
                                      <td>Raxaul ICP · Lane 4 (Commercial Cargo Screening)</td>
                                      <td className="mono">14:00 - 22:00 IST (Evening Rotation)</td>
                                      <td className="mono">HMAC-SHA256 Active</td>
                                      <td className="mono">2027-03-31</td>
                                      <td><span className="badge-chain">AUTHORISED</span></td>
                                    </tr>
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
          <span>{displayed.length} officers registered in duty roster</span>
          <span className="mono">Ministry of Home Affairs · Police II Division</span>
        </div>
      </div>

      {/* ── ASSIGN ROLE MODAL ─────────────────────────────────────────────── */}
      {roleAssign && (
        <Modal
          title={`Assign Duty Role: ${roleAssign.name}`}
          onClose={() => setRoleAssign(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="stat-note" style={{ color: "var(--ink)" }}>
              Assigning designation and institution will grant the officer clearance to operate the
              document screening desk and submit official reports.
            </p>

            <div>
              <label
                className="stat-note mono"
                style={{ display: "block", marginBottom: 4, fontWeight: 700 }}
              >
                OFFICER EMAIL
              </label>
              <input
                className="subtable-search-input"
                style={{ width: "100%" }}
                value={roleAssign.email}
                disabled
              />
            </div>

            <div>
              <label
                className="stat-note mono"
                style={{ display: "block", marginBottom: 4, fontWeight: 700 }}
              >
                DESIGNATION / POST
              </label>
              <input
                className="subtable-search-input"
                style={{ width: "100%" }}
                value={roleAssign.designation}
                onChange={(e) => setRoleAssign({ ...roleAssign, designation: e.target.value })}
                placeholder="e.g. Border Screening Officer, Inspector, Commandant"
              />
            </div>

            <div>
              <label
                className="stat-note mono"
                style={{ display: "block", marginBottom: 4, fontWeight: 700 }}
              >
                INSTITUTION / BORDER CHECKPOINT
              </label>
              <input
                className="subtable-search-input"
                style={{ width: "100%" }}
                value={roleAssign.institution}
                onChange={(e) => setRoleAssign({ ...roleAssign, institution: e.target.value })}
                placeholder="e.g. Sashastra Seema Bal — Panitanki ICP"
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="action-btn-sm"
                onClick={() => setRoleAssign(null)}
              >
                Cancel
              </button>
              <Button
                type="button"
                variant="seal"
                disabled={busy || !roleAssign.designation || !roleAssign.institution}
                onClick={() => void handleAssignSubmit()}
              >
                {busy ? "Authorizing…" : "Authorize & Sign Clearance"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
