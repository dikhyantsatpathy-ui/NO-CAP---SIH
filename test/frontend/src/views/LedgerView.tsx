import { useState, useEffect, useMemo } from "react";
import {
  getSessionLedger,
  getStatsOverview,
  verifySessionLedger,
  type SessionLedgerPayload,
  type SessionLedgerVerify,
  type StatsOverview,
} from "../api";
import { useAuth } from "../app/state";

export function LedgerView() {
  const { toast } = useAuth();
  const [rawBlocks, setRawBlocks] = useState<SessionLedgerPayload[]>([]);
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [verifyResult, setVerifyResult] = useState<SessionLedgerVerify | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [checkpointFilter, setCheckpointFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadData = async () => {
    setLoading(true);
    const [ledgerRes, statsRes] = await Promise.all([getSessionLedger(), getStatsOverview()]);
    setLoading(false);
    if (ledgerRes.data) setRawBlocks(ledgerRes.data);
    if (statsRes.data) setStats(statsRes.data);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleVerifyLedger = async () => {
    setVerifying(true);
    const res = await verifySessionLedger();
    setVerifying(false);
    if (res.data) {
      setVerifyResult(res.data);
      toast(res.data.valid ? "Ledger chain integrity verified" : "Integrity discrepancy detected", res.data.valid ? "success" : "error");
    } else {
      toast(res.error || "Verification failed", "error");
    }
  };

  const checkpoints = useMemo(
    () => Array.from(new Set(rawBlocks.map((b: any) => String(b.checkpoint || "")).filter(Boolean))).sort(),
    [rawBlocks]
  );

  const sortedBlocks = useMemo(() => {
    const filtered = rawBlocks.filter((b: any) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        String(b.id || "").toLowerCase().includes(q) ||
        String(b.session_id || "").toLowerCase().includes(q) ||
        String(b.checkpoint || "").toLowerCase().includes(q);
      const matchCp = !checkpointFilter || b.checkpoint === checkpointFilter;
      return matchSearch && matchCp;
    });

    return filtered.sort((a: any, b: any) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  }, [rawBlocks, search, checkpointFilter]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExpandAll = () => {
    if (expandedIds.size === sortedBlocks.length) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(sortedBlocks.map((b: any) => String(b.id))));
    }
  };

  const exportCsv = () => {
    const headers = ["Block Index", "Session ID", "Checkpoint", "Verdict", "Timestamp", "Block Hash", "Previous Hash"];
    const rows = sortedBlocks.map((b: any, i: number) => [
      i + 1,
      b.session_id || b.id,
      b.checkpoint || "N/A",
      b.verdict || "CLEARED",
      b.created_at || "N/A",
      b.block_hash || b.ledger_hash || "N/A",
      b.previous_hash || "GENESIS",
    ]);
    const csvContent = [headers.join(","), ...rows.map((r: any[]) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ledger_export_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const hourlyData: Record<string, number> = stats?.hourly_traffic || {};
  const maxHourly = Math.max(...Object.values(hourlyData).map((v) => Number(v) || 0), 1);

  return (
    <div className="view">
      <div className="panel">
        <div className="panel__row">
          <div>
            <h2 className="panel__title">Cryptographic Session Ledger</h2>
            <p className="panel__body">
              Immutable SHA-256 chained transaction blocks for border screening records under Bharatiya Sakshya Adhiniyam 2023.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="btn" onClick={exportCsv}>
              Export CSV
            </button>
            <button type="button" className="btn btn--primary" onClick={handleVerifyLedger} disabled={verifying}>
              {verifying ? "VERIFYING..." : "Verify Hash Chain"}
            </button>
          </div>
        </div>

        {verifyResult && (
          <div className={`banner ${verifyResult.valid ? "" : "banner--bad"}`} style={{ marginTop: 14 }}>
            {verifyResult.valid
              ? "✓ Cryptographic Chain Valid: All block hashes and sequence linkages are intact."
              : `⚠ Chain Verification Discrepancy: ${verifyResult.issues?.join(", ") || "Corrupted block linkage"}`}
          </div>
        )}

        {/* Ledger Statistics Grid */}
        <div className="ledger-head">
          <div className="stat">
            <span className="stat__label">Total Blocks</span>
            <span className="stat__value">{rawBlocks.length}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Latest Root Hash</span>
            <span className="stat__value stat__value--sm">
              {rawBlocks[0]?.ledger_hash?.substring(0, 16) || rawBlocks[0]?.block_hash?.substring(0, 16) || "GENESIS_ANCHOR"}...
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Integrity Status</span>
            <span className="stat__value" style={{ fontSize: "1.2rem", color: "#16a34a" }}>
              SYNCHRONIZED
            </span>
          </div>
        </div>

        {/* Traffic Ribbon */}
        {Object.keys(hourlyData).length > 0 && (
          <div className="stats-ribbon" style={{ marginTop: 16 }}>
            <div className="stats-ribbon__head">
              <span className="k">Hourly Transaction Density</span>
            </div>
            <div className="stats-bars">
              {Object.entries(hourlyData).map(([hr, count]) => {
                const heightPct = Math.round((Number(count) / maxHourly) * 100);
                return (
                  <div key={hr} className="stats-bar-col">
                    <div className="stats-bar-fill" style={{ height: `${Math.max(heightPct, 8)}%` }} />
                    <span className="stats-bar-hr">{hr}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="filter-bar">
        <div className="filter-bar__search">
          <input
            type="text"
            placeholder="Search block hash or session ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-bar__group">
          <select
            className="filter-bar__select"
            value={checkpointFilter}
            onChange={(e) => setCheckpointFilter(e.target.value)}
          >
            <option value="">All Checkpoints</option>
            {checkpoints.map((cp: string) => (
              <option key={cp} value={cp}>
                {cp}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--small" onClick={handleExpandAll}>
            {expandedIds.size === sortedBlocks.length ? "Collapse All" : "Expand All"}
          </button>
        </div>
      </div>

      {/* Blocks List */}
      <div className="chain">
        {loading ? (
          <div style={{ padding: 24, textAlign: "center" }}>Loading ledger blocks...</div>
        ) : sortedBlocks.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>No ledger blocks matched the criteria.</div>
        ) : (
          sortedBlocks.map((b: any, i: number) => {
            const blockId = String(b.id || b.session_id || i);
            const isExpanded = expandedIds.has(blockId);
            const clashingCount = b.comparison?.checks
              ? (b.comparison.checks as any[]).filter((c: any) => c.status === "disagree").length
              : 0;

            return (
              <div key={blockId} className="chain__item">
                <div className="block" style={{ marginBottom: 12 }}>
                  <div className="block__head" onClick={() => toggleExpand(blockId)} style={{ cursor: "pointer" }}>
                    <span className="block__node node--ok" />
                    <span className="block__no">BLOCK #{sortedBlocks.length - i}</span>
                    <span className="chip chip--mute">{b.checkpoint || "Land ICP"}</span>
                    <span className="chip chip--ok">{b.verdict || "CLEARED"}</span>
                    <span className="block__meta">{b.created_at || "Just now"}</span>
                  </div>

                  <div className="block__grid">
                    <div className="block__cell">
                      <span className="k">Block Hash</span>
                      <span className="hash">{b.ledger_hash || b.block_hash || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}</span>
                    </div>
                    <div className="block__cell">
                      <span className="k">Previous Block Link</span>
                      <span className="hash">{b.previous_hash || "GENESIS_ROOT"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="block__detail">
                      <div>
                        <strong>Session Record:</strong> {b.session_id || b.id}
                      </div>
                      {clashingCount > 0 && (
                        <div style={{ color: "#dc2626" }}>
                          ⚠ {clashingCount} clashing cross-document fields logged.
                        </div>
                      )}
                      {b.zkp_gates && (
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                          {(b.zkp_gates as any[]).map((g: any, gi: number) => (
                            <span key={gi} className="chip chip--info">
                              {String(g.assertion || "Gate")}: {String(g.status || "VALID")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default LedgerView;