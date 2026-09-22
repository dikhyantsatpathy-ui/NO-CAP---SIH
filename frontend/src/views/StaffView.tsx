// ============================================================================
// StaffView.tsx — officer roster + role assignment (super-admin only).
// Lists registered signer identities and their pending designation approvals;
// a supervisor assigns designation + institution to activate an officer.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { assignRole, getSigners, type OfficerEntry } from "../api";
import { useAuth, useToast } from "../app/state";
import { timeLabel } from "../app/util";

export function StaffView() {
  const { toast } = useToast();
  const { me } = useAuth();
  const isSuper = !!me?.is_super_admin;
  const [signers, setSigners] = useState<OfficerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [institution, setInstitution] = useState("");

  const load = useCallback(async () => {
    const res = await getSigners();
    if (res.ok) setSigners(res.data.signers);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
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
      await load();
    } else {
      toast(res.error, "error");
    }
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
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@ssb.gov.in" />
          </label>
          <label className="field">
            <span className="field__label">Designation</span>
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Assistant Commandant" />
          </label>
          <label className="field">
            <span className="field__label">Institution</span>
            <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Sashastra Seema Bal" />
          </label>
          <button className="btn btn--primary" disabled={busy} onClick={() => void assign()}>
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
                          <span className="chip chip--warn">PENDING APPROVAL</span>
                        </td>
                        <td className="mono muted">{timeLabel(s.registered_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {active.length > 0 && (
              <>
                <h3 className="board__title">Active officers</h3>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Officer</th>
                      <th>Designation</th>
                      <th>Institution</th>
                      <th>Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((s) => (
                      <tr key={s.email}>
                        <td>
                          <span className="k">{s.name}</span>
                          <span className="cell-sub">{s.email}</span>
                        </td>
                        <td>{s.designation}</td>
                        <td>{s.institution}</td>
                        <td className="mono">{timeLabel(s.registered_at)}</td>
                      </tr>
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