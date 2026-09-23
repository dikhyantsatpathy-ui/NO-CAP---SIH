// ============================================================================
// WatchlistView.tsx — screened watchlist (supervisory access).
// Entries store ONLY a SHA-256 digest of the identifier plus a masked display
// form. Matching during screening is always by digest; the raw identifier is
// never persisted.
//
// Features:
//   - Hash-only watchlist addition & removal,
//   - Nested expandable sub-tables for cryptographic audit receipts.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import {
  SCREEN_WATCHLIST_CATEGORIES,
  SCREEN_WATCHLIST_LABELS,
  SCREEN_WATCHLIST_PLACEHOLDERS,
  addWatchlistEntry,
  getWatchlist,
  removeWatchlistEntry,
  type ScreenWatchlistCategory,
  type WatchlistEntry,
} from "../api";
import { useAuth, useToast } from "../app/state";
import { copyText, shortHash, timeLabelIst } from "../app/util";

export function WatchlistView() {
  const { toast } = useToast();
  const { me } = useAuth();
  const isSuper = !!me?.is_super_admin;
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<ScreenWatchlistCategory>("passport");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await getWatchlist();
    if (res.ok) setEntries(res.data.entries);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!value.trim()) {
      toast("Enter an identifier value.", "warn");
      return;
    }
    setBusy(true);
    const res = await addWatchlistEntry(category, value.trim(), reason.trim() || undefined);
    setBusy(false);
    if (res.ok) {
      toast(
        res.data.already ? "Identifier is already on the watchlist." : "Added — only its digest is stored.",
        res.data.already ? "warn" : "success",
      );
      setValue("");
      setReason("");
      await load();
    } else {
      toast(res.error, "error");
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    const res = await removeWatchlistEntry(id);
    setBusy(false);
    if (res.ok) {
      toast("Watchlist entry removed.", "success");
      await load();
    } else {
      toast(res.error, "error");
    }
  };

  if (!isSuper) {
    return (
      <div className="view">
        <section className="panel panel--muted">
          <h2 className="panel__title">Watchlist — supervisory access only</h2>
          <p className="panel__body">
            The watchlist is maintained and viewed only by authorised supervisors. Your account is
            not registered as a supervisor.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="view">
      <section className="panel">
        <div className="panel__row">
          <div>
            <h2 className="panel__title">Known-fraud list (watchlist)</h2>
            <p className="panel__body">
              Names and numbers are kept only as fingerprints (SHA-256) with a masked view for the
              officer. Screening matches by fingerprint — the real value is never stored.
            </p>
          </div>
          <button type="button" className="btn" onClick={() => void load()}>
            Reload
          </button>
        </div>

        <div className="watch-add">
          <label className="field">
            <span className="field__label">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as ScreenWatchlistCategory)}>
              {SCREEN_WATCHLIST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SCREEN_WATCHLIST_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Identifier</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={SCREEN_WATCHLIST_PLACEHOLDERS[category]}
            />
          </label>
          <label className="field">
            <span className="field__label">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Interpol red notice / forged visa cluster"
            />
          </label>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void add()}>
            {busy ? "Adding…" : "Add to watchlist"}
          </button>
        </div>

        {loading ? (
          <p className="hint">Loading watchlist…</p>
        ) : entries.length === 0 ? (
          <p className="hint">Watchlist empty.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Category</th>
                <th>Masked view</th>
                <th>Reason</th>
                <th>Added by</th>
                <th>Added (IST)</th>
                <th>Details</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <>
                  <tr key={e.id}>
                    <td>
                      <span className="chip chip--mute">
                        {SCREEN_WATCHLIST_LABELS[(e.category || "passport") as ScreenWatchlistCategory] || e.category}
                      </span>
                    </td>
                    <td className="mono">{e.mask}</td>
                    <td className="cell-detail">{e.reason || "—"}</td>
                    <td>{e.added_by}</td>
                    <td className="mono">{timeLabelIst(e.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="subtable-toggle"
                        style={{ padding: "2px 6px", fontSize: 11 }}
                        onClick={() => setExpandedId((cur) => (cur === e.id ? null : e.id))}
                      >
                        {expandedId === e.id ? "▼" : "▶"} Details
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--small btn--flag"
                        disabled={busy}
                        onClick={() => void remove(e.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>

                  {/* Expandable nested sub-table for watchlist audit verification */}
                  {expandedId === e.id && (
                    <tr key={`${e.id}-detail`}>
                      <td colSpan={7} style={{ padding: 0, background: "var(--panel-2)" }}>
                        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
                          <span className="k" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>
                            HOW THIS ENTRY IS STORED (AUDIT)
                          </span>
                          <table className="tbl tbl--compact" style={{ background: "var(--panel)" }}>
                            <tbody>
                              <tr>
                                <td className="k">ENTRY ID</td>
                                <td className="mono">#WL-{e.id}</td>
                              </tr>
                              <tr>
                                <td className="k">DIGEST MASK</td>
                                <td className="mono">
                                  {shortHash(e.mask, 28)}{" "}
                                  <button
                                    type="button"
                                    className="btn btn--small"
                                    style={{ padding: "1px 6px", marginLeft: 6 }}
                                    onClick={() => void copyText(e.mask || "")}
                                  >
                                    Copy
                                  </button>
                                </td>
                              </tr>
                              <tr>
                                <td className="k">STORAGE POLICY</td>
                                <td>
                                  <span className="chip chip--ok">NOT STORED</span>
                                  <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                                    Only a fingerprint (SHA-256) of this identifier is kept and
                                    matched. The number itself is never saved.
                                  </span>
                                </td>
                              </tr>
                              <tr>
                                <td className="k">SUPERVISOR</td>
                                <td>{e.added_by}</td>
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
        )}
      </section>
    </div>
  );
}