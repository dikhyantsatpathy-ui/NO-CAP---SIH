// ============================================================================
// WatchlistView.tsx — screened watchlist (supervisory access).
// Entries store ONLY a SHA-256 digest of the identifier plus a masked display
// form. Matching during screening is always by digest; the raw identifier is
// never persisted.
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
import { shortHash, timeLabel } from "../app/util";

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
          <h2 className="panel__title">WATCHLIST — SUPERVISORY ACCESS ONLY</h2>
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
            <h2 className="panel__title">SCREENED WATCHLIST</h2>
            <p className="panel__body">
              Identifiers are stored as SHA-256 digests with a masked display form. Screening never
              compares raw values — only digests.
            </p>
          </div>
          <button className="btn" onClick={() => void load()}>
            RELOAD
          </button>
        </div>

        <div className="watch-add">
          <label className="field">
            <span className="field__label">CATEGORY</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as ScreenWatchlistCategory)}>
              {SCREEN_WATCHLIST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SCREEN_WATCHLIST_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">IDENTIFIER</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={SCREEN_WATCHLIST_PLACEHOLDERS[category]} />
          </label>
          <label className="field">
            <span className="field__label">REASON</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional" />
          </label>
          <button className="btn btn--primary" disabled={busy} onClick={() => void add()}>
            {busy ? "ADDING…" : "ADD TO WATCHLIST"}
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
                <th>Digest</th>
                <th>Masked</th>
                <th>Reason</th>
                <th>Added by</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="chip chip--mute">{SCREEN_WATCHLIST_LABELS[(e.category || "passport") as ScreenWatchlistCategory] || e.category}</span>
                  </td>
                  <td className="mono" title={e.mask || ""}>
                    {shortHash(e.mask, 26)}
                  </td>
                  <td className="mono muted">{e.mask}</td>
                  <td className="cell-detail">{e.reason || "—"}</td>
                  <td>{e.added_by}</td>
                  <td className="mono">{timeLabel(e.created_at)}</td>
                  <td>
                    <button className="btn btn--small btn--flag" disabled={busy} onClick={() => void remove(e.id)}>
                      REMOVE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}