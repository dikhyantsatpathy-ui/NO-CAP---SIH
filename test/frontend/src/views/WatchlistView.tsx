import { useState, useEffect } from "react";
import {
  getWatchlist,
  addWatchlistEntry,
  removeWatchlistEntry,
  SCREEN_WATCHLIST_CATEGORIES,
  SCREEN_WATCHLIST_LABELS,
  SCREEN_WATCHLIST_PLACEHOLDERS,
  type ScreenWatchlistCategory,
  type WatchlistEntry,
} from "../api";
import { useAuth } from "../app/state";

export function WatchlistView() {
  const { toast } = useAuth();
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [category, setCategory] = useState<ScreenWatchlistCategory>("passport");
  const [identifier, setIdentifier] = useState("");
  const [reason, setReason] = useState("");

  const loadWatchlist = async () => {
    setLoading(true);
    const res = await getWatchlist();
    setLoading(false);
    if (res.data) {
      setEntries(res.data);
    } else {
      toast(res.error || "Failed to load watchlist", "error");
    }
  };

  useEffect(() => {
    loadWatchlist();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setSubmitting(true);
    const res = await addWatchlistEntry(category, identifier.trim(), reason.trim() || "Suspected Forgery Alert");
    setSubmitting(false);
    if (res.data || res.status === 200) {
      toast("Identifier hashed and added to watchlist", "success");
      setIdentifier("");
      setReason("");
      await loadWatchlist();
    } else {
      toast(res.error || "Failed to add to watchlist", "error");
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm("Are you sure you want to remove this hash from the watchlist?")) return;
    const res = await removeWatchlistEntry(id);
    if (res.data || res.status === 200) {
      toast("Entry removed from watchlist", "info");
      await loadWatchlist();
    } else {
      toast(res.error || "Failed to remove entry", "error");
    }
  };

  return (
    <div className="view">
      <div className="panel">
        <h2 className="panel__title">Zero-Storage Watchlist Repository</h2>
        <p className="panel__body">
          Identifiers are normalized and converted into one-way SHA-256 digests. Raw numbers are never stored at rest.
        </p>

        <form onSubmit={handleAdd} className="watch-add" style={{ marginTop: "20px" }}>
          <div className="field">
            <label className="field__label">CATEGORY</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ScreenWatchlistCategory)}
            >
              {SCREEN_WATCHLIST_CATEGORIES.map((c: ScreenWatchlistCategory) => (
                <option key={c} value={c}>
                  {SCREEN_WATCHLIST_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label">IDENTIFIER NUMBER</label>
            <input
              type="text"
              placeholder={SCREEN_WATCHLIST_PLACEHOLDERS[category]}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="field__label">FLAGGING REASON</label>
            <input
              type="text"
              placeholder="e.g. MHA Look-Out Circular (LOC)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn--bad" disabled={submitting}>
            {submitting ? "HASHING..." : "ADD TO WATCHLIST"}
          </button>
        </form>
      </div>

      <div className="panel">
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "14px", textTransform: "uppercase" }}>
          Active Watchlist Digests ({entries.length})
        </h3>

        {loading ? (
          <div style={{ padding: "20px", textAlign: "center" }}>Loading watchlist digests...</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Category</th>
                <th>Masked Reference</th>
                <th>Reason</th>
                <th>Created At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "#64748b" }}>
                    No flagged records found.
                  </td>
                </tr>
              ) : (
                entries.map((w: WatchlistEntry) => (
                  <tr key={w.id}>
                    <td>
                      <span className="chip chip--mute">{w.category.toUpperCase()}</span>
                    </td>
                    <td>
                      <span className="hash">{w.mask || "********"}</span>
                    </td>
                    <td>{w.reason}</td>
                    <td>{w.created_at || "Recent"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        style={{ color: "#dc2626" }}
                        onClick={() => handleRemove(w.id)}
                      >
                        Remove
                      </button>
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

export default WatchlistView;