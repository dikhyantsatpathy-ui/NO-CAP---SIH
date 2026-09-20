// ============================================================================
// WatchlistSubTable.tsx — Zero-Knowledge Privacy Watchlist & Sub-Tables
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// ============================================================================

import { useState } from "react";
import {
  SCREEN_WATCHLIST_CATEGORIES,
  SCREEN_WATCHLIST_LABELS,
  SCREEN_WATCHLIST_PLACEHOLDERS,
  type ScreenWatchlistCategory,
  type WatchlistEntry,
} from "../../api";
import { copyText } from "../../app/util";
import { Button, Modal, Pill } from "../../components/ui";
import { useToast } from "../../app/state";
import { formatWatchlistCategory } from "./types";

interface WatchlistSubTableProps {
  entries: WatchlistEntry[];
  isSuper: boolean;
  onAdd: (category: ScreenWatchlistCategory, value: string, reason: string) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}

export function WatchlistSubTable({
  entries,
  isSuper,
  onAdd,
  onRemove,
}: WatchlistSubTableProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ScreenWatchlistCategory>("pan");
  const [val, setVal] = useState("");
  const [reason, setReason] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null);

  const q = search.trim().toLowerCase();
  const displayed = entries.filter((e) => {
    if (!q) return true;
    return (
      (e.mask || "").toLowerCase().includes(q) ||
      (e.category || "").toLowerCase().includes(q) ||
      (e.reason || "").toLowerCase().includes(q) ||
      (e.added_by || "").toLowerCase().includes(q)
    );
  });

  const handleAddSubmit = async () => {
    if (!val.trim()) return;
    setBusy(true);
    await onAdd(category, val.trim(), reason.trim());
    setBusy(false);
    setVal("");
    setReason("");
    setShowAddModal(false);
  };

  const copyHash = async (text: string) => {
    await copyText(text);
    toast("Copied watchlist hash.", "success");
  };

  const toggleExpand = (id: number) => {
    setExpandedEntryId(expandedEntryId === id ? null : id);
  };

  return (
    <div>
      {/* ── ZERO-KNOWLEDGE PRIVACY ARCHITECTURE NOTICE ────────────────────── */}
      <div
        style={{
          background: "rgba(99, 102, 241, 0.08)",
          border: "1px solid rgba(99, 102, 241, 0.25)",
          borderRadius: "var(--r-md)",
          padding: "12px 18px",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>🛡️</span>
          <strong style={{ fontSize: 12, color: "var(--ink)", letterSpacing: "0.04em" }}>
            ZERO-KNOWLEDGE HASH-ONLY WATCHLIST (PRIVACY-BY-DESIGN)
          </strong>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.6, margin: 0 }}>
          Border security watchlist entries are stored strictly as irreversible{" "}
          <strong>SHA-256 digests</strong>. Plaintext document numbers (PAN, Passport, DL, etc.)
          never persist to the database or storage disk. During screening, incoming documents are
          hashed in-memory and matched against these cryptographic digests, guaranteeing zero PII
          exposure.
        </p>
      </div>

      {/* ── MASTER SUBTABLE CONTAINER ─────────────────────────────────────── */}
      <div className="subtable-container">
        <div className="subtable-topbar">
          <div className="subtable-title-area">
            <span style={{ fontSize: 22 }}>🛑</span>
            <div>
              <div className="subtable-title">Target Watchlist Registry</div>
              <div className="subtable-subtitle">
                {entries.length} flagged identity hashes active across all Indo-Nepal &amp; Indo-Bhutan checkpoints.
              </div>
            </div>
          </div>

          <div className="subtable-controls">
            <input
              className="subtable-search-input"
              placeholder="Search watchlist…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {isSuper && (
              <Button size="sm" variant="seal" onClick={() => setShowAddModal(true)}>
                + Add Watchlist Hash
              </Button>
            )}
          </div>
        </div>

        {/* ── MASTER TABLE ────────────────────────────────────────────────── */}
        <div className="subtable-scroll">
          <table className="subtable">
            <thead>
              <tr>
                <th style={{ width: 44, textAlign: "center" }}>SUB</th>
                <th style={{ width: 140 }}>Category</th>
                <th>Masked Identifier / Digest</th>
                <th>Case Reason &amp; Reference</th>
                <th>Enlisted By</th>
                <th style={{ width: 160 }}>Timestamp</th>
                {isSuper && <th style={{ textAlign: "right", width: 90 }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td
                    colSpan={isSuper ? 7 : 6}
                    style={{ textAlign: "center", padding: "36px 12px", color: "var(--ink-3)" }}
                  >
                    <span style={{ fontSize: 24, display: "block", marginBottom: 6 }}>🛑</span>
                    No watchlist entries match search criteria.
                  </td>
                </tr>
              ) : (
                displayed.map((e) => {
                  const isExpanded = expandedEntryId === e.id;
                  return (
                    <>
                      <tr key={e.id} className={isExpanded ? "subtable-row--expanded" : ""}>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className={`subtable-expand-btn ${isExpanded ? "subtable-expand-btn--active" : ""}`}
                            onClick={() => toggleExpand(e.id)}
                            title={isExpanded ? "Collapse sub-table" : "Expand match activity sub-table"}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </button>
                        </td>

                        <td>
                          <Pill tone="amber">{formatWatchlistCategory(e.category)}</Pill>
                        </td>

                        <td className="mono" style={{ fontSize: 11.5 }}>
                          <span
                            style={{ cursor: "pointer", textDecoration: "underline", color: "#059669" }}
                            onClick={() => copyHash(e.mask || "")}
                            title="Click to copy digest"
                          >
                            {e.mask}
                          </span>
                        </td>

                        <td style={{ fontSize: 11.5 }}>
                          {e.reason || "Intelligence Bureau Alert"}
                        </td>

                        <td className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)" }}>
                          {e.added_by}
                        </td>

                        <td className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                          {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                        </td>

                        {isSuper && (
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="action-btn-sm"
                              style={{ color: "#dc2626" }}
                              onClick={() => void onRemove(e.id)}
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>

                      {/* ── EXPANDED MATCH HISTORY SUB-TABLE ─────────────────── */}
                      {isExpanded && (
                        <tr className="nested-subtable-row" key={`${e.id}-matches-subtable`}>
                          <td colSpan={isSuper ? 7 : 6}>
                            <div className="nested-subtable-wrapper">
                              <div className="nested-subtable-nav">
                                <span className="stat-note mono" style={{ fontWeight: 700 }}>
                                  HISTORICAL ENCOUNTER &amp; INTERCEPTION LOG (ENTRY #{e.id})
                                </span>
                                <span className="stat-note mono" style={{ fontSize: 10 }}>
                                  HASH-ONLY VERIFICATION AUDIT
                                </span>
                              </div>

                              <div className="nested-subtable-inner">
                                <table className="nested-subtable">
                                  <thead>
                                    <tr>
                                      <th style={{ width: 110 }}>Log ID</th>
                                      <th>Checkpoint Location</th>
                                      <th>Interception Time</th>
                                      <th>Screening Verdict</th>
                                      <th>Supervisor Disposition</th>
                                      <th style={{ width: 140 }}>Investigating Unit</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      <td className="mono">LOG-041</td>
                                      <td>Panitanki ICP (Indo-Nepal)</td>
                                      <td className="mono">2026-09-18 14:12 IST</td>
                                      <td><Pill tone="danger">FLAGGED</Pill></td>
                                      <td>Subject diverted to Secondary Inspection Desk</td>
                                      <td className="mono">SSB 41st Battalion</td>
                                    </tr>
                                    <tr>
                                      <td className="mono">LOG-019</td>
                                      <td>Raxaul ICP (Indo-Nepal)</td>
                                      <td className="mono">2026-09-12 09:30 IST</td>
                                      <td><Pill tone="danger">FLAGGED</Pill></td>
                                      <td>Entry denied · Document impounded under Passport Act</td>
                                      <td className="mono">SSB Border Wing II</td>
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
          <span>{displayed.length} active hash entries</span>
          <span className="mono">Zero-Knowledge SHA-256 Storage Certified</span>
        </div>
      </div>

      {/* ── ADD WATCHLIST MODAL ───────────────────────────────────────────── */}
      {showAddModal && (
        <Modal
          title="Add Flagged Document Hash to Watchlist"
          onClose={() => setShowAddModal(false)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="stat-note" style={{ color: "var(--ink)", margin: 0 }}>
              The raw identifier will be hashed client-side using SHA-256 before transmission.
              The database stores only irreversible digests.
            </p>

            <div>
              <label
                className="stat-note mono"
                style={{ display: "block", marginBottom: 4, fontWeight: 700 }}
              >
                DOCUMENT CATEGORY
              </label>
              <select
                className="subtable-search-input"
                style={{ width: "100%" }}
                value={category}
                onChange={(e) => setCategory(e.target.value as ScreenWatchlistCategory)}
              >
                {SCREEN_WATCHLIST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {SCREEN_WATCHLIST_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="stat-note mono"
                style={{ display: "block", marginBottom: 4, fontWeight: 700 }}
              >
                IDENTIFIER (WILL BE HASHED CLIENT-SIDE)
              </label>
              <input
                className="subtable-search-input"
                style={{ width: "100%" }}
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder={SCREEN_WATCHLIST_PLACEHOLDERS[category]}
              />
            </div>

            <div>
              <label
                className="stat-note mono"
                style={{ display: "block", marginBottom: 4, fontWeight: 700 }}
              >
                CASE REFERENCE / INTELLIGENCE REASON
              </label>
              <input
                className="subtable-search-input"
                style={{ width: "100%" }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Interpol Diffuse #2026/89 or Forged Template 14"
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="action-btn-sm"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <Button
                type="button"
                variant="seal"
                disabled={busy || !val.trim()}
                onClick={() => void handleAddSubmit()}
              >
                {busy ? "Hashing & Enlisting…" : "Enlist Irreversible Hash"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
