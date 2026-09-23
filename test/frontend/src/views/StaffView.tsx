import { useState, useEffect } from "react";
import { getSigners, assignRole, type OfficerEntry } from "../api";
import { useAuth } from "../app/state";

export function StaffView() {
  const { toast } = useAuth();
  const [officers, setOfficers] = useState<OfficerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("Screening Officer");
  const [institution, setInstitution] = useState("Sashastra Seema Bal");

  const loadOfficers = async () => {
    setLoading(true);
    const res = await getSigners();
    setLoading(false);
    if (res.data) {
      setOfficers(res.data);
    } else {
      toast(res.error || "Failed to load officer directory", "error");
    }
  };

  useEffect(() => {
    loadOfficers();
  }, []);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    const res = await assignRole(email.trim(), { designation, institution });
    setSubmitting(false);
    if (res.data || res.status === 200) {
      toast(`Role approved for ${email}`, "success");
      setEmail("");
      await loadOfficers();
    } else {
      toast(res.error || "Role assignment failed", "error");
    }
  };

  return (
    <div className="view">
      <div className="panel">
        <h2 className="panel__title">Officer Roster & Access Approvals</h2>
        <p className="panel__body">
          Authorize screening duty posts, inspect registered staff identities, and review border station access controls.
        </p>

        <form onSubmit={handleAssign} className="watch-add" style={{ marginTop: "20px" }}>
          <div className="field">
            <label className="field__label">OFFICER EMAIL</label>
            <input
              type="email"
              placeholder="officer@ssb.gov.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="field__label">DESIGNATION</label>
            <input
              type="text"
              placeholder="e.g. Desk Officer"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="field__label">INSTITUTION</label>
            <input
              type="text"
              placeholder="e.g. Raxaul Checkpoint"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? "APPROVING..." : "GRANT APPROVAL"}
          </button>
        </form>
      </div>

      <div className="panel">
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "14px", textTransform: "uppercase" }}>
          Registered Personnel Directory
        </h3>

        {loading ? (
          <div style={{ padding: "20px", textAlign: "center" }}>Loading officers...</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Officer</th>
                <th>Designation</th>
                <th>Institution</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {officers.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "#64748b" }}>
                    No officer profiles registered yet.
                  </td>
                </tr>
              ) : (
                officers.map((off: OfficerEntry) => (
                  <tr key={off.email}>
                    <td>
                      <strong>{off.name || off.email.split("@")[0]}</strong>
                      <span className="cell-sub">{off.email}</span>
                    </td>
                    <td>{off.designation || "Officer"}</td>
                    <td>{off.institution || "SSB"}</td>
                    <td>
                      {off.pending_approval ? (
                        <span className="chip chip--warn">Pending Approval</span>
                      ) : (
                        <span className="chip chip--ok">Active</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default StaffView;