// ============================================================================
// StaffView.tsx — officer roster + role assignment (super-admin only).
// Lists registered signer identities and their pending designation approvals;
// a supervisor assigns designation + institution to activate an officer.
//
// Features:
//   - Quick-fill role assignment for pending signers,
//   - Nested expandable sub-tables for cryptographic officer security profiles.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { assignRole, getSigners, revokeOfficer, unrevokeOfficer, removeOfficer, type OfficerEntry } from "../api";
import { useAuth, useToast } from "../app/state";
import { timeLabelIst } from "../app/util";

import { portalCache } from "../app/preloader";

export function StaffView() {
  const { toast } = useToast();
  const { me } = useAuth();
  const isSuper = !!me?.is_super_admin;
  const [signers, setSigners] = useState<OfficerEntry[]>(() => portalCache.signers || []);
  const [loading, setLoading] = useState(() => !portalCache.signers);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [institution, setInstitution] = useState("");
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getSigners();
    if (res.ok) {
      portalCache.signers = res.data.signers;
      setSigners(res.data.signers);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const handleFocus = () => void load();
    window.addEventListener("focus", handleFocus);
    const timer = setInterval(() => void load(), 4000);
    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(timer);
    };
  }, [load]);

  const assign = async () => {
    if (!email.trim() || !designation.trim()) {
      toast("Email and designation are required.", "warn");
      return;
    }
    setBusy(true);
    const res = await assignRole(email.trim(), designation.trim(), institution.trim() || "Sashastra Seema Bal");
    setBusy(false);
    if (res.ok) {
      toast(`Role assigned to ${email.trim()}.`, "success");
      setEmail("");
      setDesignation("");
      setInstitution("");
      portalCache.signers = null;
      await load();
    } else {
      toast(res.error, "error");
    }
  };

  const handleRevoke = async (targetEmail: string) => {
    if (!window.confirm(`Revoke officer clearance for ${targetEmail}? They will no longer be permitted to screen or sign documents.`)) return;
    // Optimistic instant UI update
    setSigners((prev) =>
      prev.map((s) => (s.email === targetEmail ? { ...s, is_revoked: true, revoked_at: "Just now" } : s))
    );
    portalCache.signers = null;
    setBusy(true);
    const res = await revokeOfficer(targetEmail);
    setBusy(false);
    if (res.ok) {
      toast(`Officer ${targetEmail} clearance revoked.`, "warn");
      await load();
    } else {
      toast(res.error, "error");
      await load();
    }
  };

  const handleUnrevoke = async (targetEmail: string) => {
    // Optimistic instant UI update
    setSigners((prev) =>
      prev.map((s) => (s.email === targetEmail ? { ...s, is_revoked: false, revoked_at: null } : s))
    );
    portalCache.signers = null;
    setBusy(true);
    const res = await unrevokeOfficer(targetEmail);
    setBusy(false);
    if (res.ok) {
      toast(`Officer ${targetEmail} clearance restored.`, "success");
      await load();
    } else {
      toast(res.error, "error");
      await load();
    }
  };

  const handleRemove = async (targetEmail: string) => {
    if (!window.confirm(`Completely remove officer ${targetEmail} from the system? Their identity and revocation history will be purged, allowing them to be re-added fresh if needed.`)) return;
    // Optimistic instant UI update
    setSigners((prev) => prev.filter((s) => s.email !== targetEmail));
    portalCache.signers = null;
    setBusy(true);
    const res = await removeOfficer(targetEmail);
    setBusy(false);
    if (res.ok) {
      toast(`Officer ${targetEmail} removed from system.`, "info");
      await load();
    } else {
      toast(res.error, "error");
      await load();
    }
  };

  const prefill = (officer: OfficerEntry) => {
    setEmail(officer.email);
    setDesignation(officer.designation || "Assistant Commandant");
    setInstitution(officer.institution || "Sashastra Seema Bal");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pending = signers.filter((s) => !s.designation);
  const active = signers.filter((s) => s.designation);

  if (!isSuper) {
    return (
      <div className="view">
        <section className="panel panel--muted">
          <h2 className="panel__title">Staff &amp; roles — supervisory access only</h2>
          <p className="panel__body">
            Role assignment is performed only by an authorised supervisor. Your account is not
            registered as a supervisor.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="view">
      <section className="panel">
        <h2 className="panel__title">Assign officer role</h2>
        <p className="panel__body">
          Authorises a registered signer to operate the desk (designation gates the screening and
          review endpoints).
        </p>
        <div className="watch-add">
          <label className="field field--grow">
            <span className="field__label">Officer email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="officer@ssb.gov.in"
            />
          </label>
          <label className="field">
            <span className="field__label">Designation</span>
            <input
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="Assistant Commandant"
            />
          </label>
          <label className="field">
            <span className="field__label">Institution</span>
            <input
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="Sashastra Seema Bal"
            />
          </label>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void assign()}>
            {busy ? "Assigning…" : "Assign role"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Officer roster ({signers.length} · {pending.length} pending)</h2>

        {loading ? (
          <p className="hint">Loading roster…</p>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <h3 className="board__title">Pending approval</h3>
                <table className="tbl">
                  <tbody>
                    {pending.map((s) => (
                      <tr key={s.email}>
                        <td>
                          <span className="k">{s.name}</span>
                          <span className="cell-sub">{s.email}</span>
                        </td>
                        <td>
                          <span className="chip chip--warn">WAITING FOR APPROVAL</span>
                        </td>
                        <td className="mono muted">{timeLabelIst(s.registered_at)}</td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn--small btn--primary"
                              disabled={busy}
                              onClick={() => prefill(s)}
                            >
                              Approve role
                            </button>
                            <button
                              type="button"
                              className="btn btn--small btn--ghost"
                              style={{ color: "var(--bad)" }}
                              disabled={busy}
                              onClick={() => void handleRemove(s.email)}
                              title="Delete this pending registration from the system"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {active.length > 0 && (
              <>
                <h3 className="board__title">Active &amp; registered officers</h3>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Officer</th>
                      <th>Designation</th>
                      <th>Institution</th>
                      <th>Status</th>
                      <th>Registered (IST)</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((s) => (
                      <>
                        <tr key={s.email}>
                          <td>
                            <span className="k">{s.name}</span>
                            <span className="cell-sub">{s.email}</span>
                          </td>
                          <td>{s.designation}</td>
                          <td>{s.institution}</td>
                          <td>
                            {s.is_revoked ? (
                              <span className="chip chip--bad" title={`Revoked at ${s.revoked_at || "previously"}`}>
                                🛑 REVOKED
                              </span>
                            ) : (
                              <span className="chip chip--ok">ACTIVE</span>
                            )}
                          </td>
                          <td className="mono">{timeLabelIst(s.registered_at)}</td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              {s.is_revoked ? (
                                <button
                                  type="button"
                                  className="btn btn--small btn--primary"
                                  disabled={busy}
                                  onClick={() => void handleUnrevoke(s.email)}
                                  title="Restore clearance for this officer"
                                >
                                  Unrevoke
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn--small btn--ghost"
                                  style={{ color: "var(--warn)" }}
                                  disabled={busy}
                                  onClick={() => void handleRevoke(s.email)}
                                  title="Revoke officer clearance (blocks screening/signing)"
                                >
                                  Revoke
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn--small btn--ghost"
                                style={{ color: "var(--bad)" }}
                                disabled={busy}
                                onClick={() => void handleRemove(s.email)}
                                title="Completely remove officer from system"
                              >
                                Remove
                              </button>
                              <button
                                type="button"
                                className="subtable-toggle"
                                style={{ padding: "3px 8px", fontSize: 11 }}
                                onClick={() => setExpandedEmail((cur) => (cur === s.email ? null : s.email))}
                              >
                                {expandedEmail === s.email ? "▼" : "▶"} Profile
                              </button>
                            </div>
                          </td>
                        </tr>

                        {expandedEmail === s.email && (
                          <tr key={`${s.email}-profile`}>
                            <td colSpan={6} style={{ padding: 0, background: "var(--panel-2)" }}>
                              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
                                <span className="k" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>
                                  OFFICER SIGNING PROFILE (AUDIT)
                                </span>
                                <table className="tbl tbl--compact" style={{ background: "var(--panel)" }}>
                                  <tbody>
                                    <tr>
                                      <td className="k">SIGNER IDENTITY</td>
                                      <td className="mono">{s.email}</td>
                                    </tr>
                                    <tr>
                                      <td className="k">CLEARANCE STATUS</td>
                                      <td>
                                        {s.is_revoked ? (
                                          <span className="chip chip--bad">REVOKED (ACCESS BLOCKED)</span>
                                        ) : (
                                          <span className="chip chip--ok">ACTIVE SIGNER</span>
                                        )}
                                        <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                                          {s.is_revoked
                                            ? `Privileges revoked on ${s.revoked_at || "record"}. Cannot screen or sign documents.`
                                            : "Authorised to conduct border screening, sign blocks into the ledger, and export shift tokens."}
                                        </span>
                                      </td>
                                    </tr>
                                    <tr>
                                      <td className="k">STATION / INSTITUTION</td>
                                      <td>{s.institution || "Sashastra Seema Bal (SSB)"}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {signers.length === 0 && <p className="hint">No registered identities yet.</p>}
          </>
        )}
      </section>
    </div>
  );
}