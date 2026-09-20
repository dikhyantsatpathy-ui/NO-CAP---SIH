// ============================================================================
// AuthorityView.tsx — SSB Border Screening Command Console (SIH26188)
// Ministry of Home Affairs — Sashastra Seema Bal (Police II Division)
// High-grade cyber command architecture: Clean tabbed orchestration with
// dedicated, modular sub-tables for Queue, Threats, Watchlist, Ledger, & Roster.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import {
  adjudicateScreen,
  addWatchlistEntry,
  assignRole,
  getLedgerAnchor,
  getScreenQueue,
  getSigners,
  getSyndicateAlerts,
  getWatchlist,
  googleLogin,
  removeWatchlistEntry,
  triggerLedgerAnchor,
  SCREEN_WATCHLIST_LABELS,
  type LedgerAnchorStatus,
  type OfficerEntry,
  type ScreenQueue,
  type ScreenWatchlistCategory,
  type WatchlistEntry,
} from "../api";
import { useAuth, useToast } from "../app/state";
import { NoticeBoard } from "../components/NoticeBoard";
import { Card, EmptyNote, IconKey, IconLock, Kicker, useGsiReady } from "../components/ui";
import { FALLBACK_CLIENT_ID } from "./gsi";

// Modular Sub-Components
import {
  type AuthorityTab,
} from "./authority/types";
import { ScreeningDeskView } from "./authority/ScreeningDeskView";
import { AdjudicationQueueSubTable } from "./authority/AdjudicationQueueSubTable";
import { SyndicateThreatSubTable } from "./authority/SyndicateThreatSubTable";
import { WatchlistSubTable } from "./authority/WatchlistSubTable";
import { BlockchainLedgerSubTable } from "./authority/BlockchainLedgerSubTable";
import { OfficerDirectorySubTable } from "./authority/OfficerDirectorySubTable";

// ----------------------------------------------------------------------------
// Auth Gate + Google Sign-In Button
// ----------------------------------------------------------------------------

function GoogleSignInButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ready = useGsiReady();
  const rendered = useRef(false);
  const { refresh } = useAuth();
  const { toast } = useToast();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!ready || !containerRef.current || rendered.current) return;
    rendered.current = true;
    const clientId =
      (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || FALLBACK_CLIENT_ID;
    window.google!.accounts!.id!.initialize({
      client_id: clientId,
      ux_mode: "popup",
      auto_prompt: false,
      callback: async (response) => {
        const res = await googleLogin(response.credential);
        if (res.ok) {
          toast("Officer session established.", "success");
          await refreshRef.current();
        } else {
          toast(res.error, "error");
        }
      },
    });
    window.google!.accounts!.id!.renderButton(containerRef.current, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
    });
  }, [ready, toast]);

  return <div ref={containerRef} style={{ minHeight: 44, display: "inline-block" }} />;
}

// ----------------------------------------------------------------------------
// Master Orchestrator Component
// ----------------------------------------------------------------------------

export function AuthorityView() {
  const { signedIn, booting, me } = useAuth();
  const { toast } = useToast();
  const isSuper = !!me?.is_super_admin;

  // Active Sub-Nav Tab
  const [tab, setTab] = useState<AuthorityTab>("desk");

  // Shared Data across tabs
  const [queue, setQueue] = useState<ScreenQueue | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [signers, setSigners] = useState<OfficerEntry[]>([]);
  const [ledgerAnchor, setLedgerAnchor] = useState<LedgerAnchorStatus | null>(null);
  const [anchorBusy, setAnchorBusy] = useState(false);

  const [syndicateData, setSyndicateData] = useState<{
    alerts: Array<{ level: string; type: string; title: string; detail: string; checkpoint: string }>;
    total_screened_sample: number;
    active_alerts_count: number;
    checkpoint_filter: string;
  } | null>(null);
  const [syndicateBusy, setSyndicateBusy] = useState(false);
  const [syndicateFilter, setSyndicateFilter] = useState("");

  const loadQueue = async () => {
    const res = await getScreenQueue();
    if (res.ok) setQueue(res.data);
  };

  const loadWatchlist = async () => {
    if (!isSuper) return;
    const res = await getWatchlist();
    if (res.ok) setWatchlist(res.data.entries);
  };

  const loadSigners = async () => {
    if (!isSuper) return;
    const res = await getSigners();
    if (res.ok) setSigners(res.data.signers);
  };

  const loadSyndicate = async (cp?: string) => {
    setSyndicateBusy(true);
    const res = await getSyndicateAlerts(cp);
    setSyndicateBusy(false);
    if (res.ok) setSyndicateData(res.data);
  };

  const loadLedgerAnchor = async () => {
    const res = await getLedgerAnchor();
    if (res.ok) setLedgerAnchor(res.data);
  };

  useEffect(() => {
    if (signedIn && me) {
      void loadQueue();
      void loadSyndicate();
      void loadLedgerAnchor();
      if (isSuper) {
        void loadWatchlist();
        void loadSigners();
      }
    }
  }, [signedIn, me, isSuper]);

  const handleTriggerAnchor = async () => {
    setAnchorBusy(true);
    const res = await triggerLedgerAnchor();
    setAnchorBusy(false);
    if (res.ok) {
      toast(
        `Anchored Block #${res.data.total_blocks} (${res.data.anchor_type}). Public non-repudiation verified!`,
        "success"
      );
      void loadLedgerAnchor();
    } else {
      toast(res.error, "error");
    }
  };

  const handleAdjudicateFromQueue = async (
    id: string,
    decision: "CLEARED" | "CONFIRMED_FRAUD" | "INCONCLUSIVE",
    note?: string
  ) => {
    const res = await adjudicateScreen(id, decision, note || "");
    if (res.ok) {
      toast(`Adjudication saved: ${decision}.`, "success");
      await loadQueue();
    } else {
      toast(res.error, "error");
    }
  };

  const handleAddWatchlist = async (
    category: ScreenWatchlistCategory,
    val: string,
    reason: string
  ) => {
    const res = await addWatchlistEntry(category, val, reason);
    if (res.ok) {
      toast(`Added hash to ${SCREEN_WATCHLIST_LABELS[category]} watchlist.`, "success");
      await loadWatchlist();
    } else {
      toast(res.error, "error");
    }
  };

  const handleRemoveWatchlist = async (id: number) => {
    const res = await removeWatchlistEntry(id);
    if (res.ok) {
      toast("Watchlist hash removed.", "success");
      await loadWatchlist();
    } else {
      toast(res.error, "error");
    }
  };

  const handleAssignRole = async (email: string, designation: string, institution: string) => {
    const res = await assignRole(email, designation, institution);
    if (res.ok) {
      toast(`Role assigned to ${email}.`, "success");
      await loadSigners();
    } else {
      toast(res.error, "error");
    }
  };

  if (booting) {
    return (
      <div className="section">
        <EmptyNote>Checking your officer clearance…</EmptyNote>
      </div>
    );
  }

  if (!signedIn || !me) {
    return (
      <section className="section" style={{ maxWidth: 560, margin: "0 auto" }}>
        <Card title="Restricted access" icon={<IconLock size={14} />}>
          <div style={{ textAlign: "center", padding: "22px 10px" }}>
            <p style={{ color: "var(--ink-2)", marginBottom: 22 }}>
              Authenticate with an authorized Google account to reach the border screening console,
              duty watchlist, and role approvals.
            </p>
            <div className="hero__kicker" style={{ display: "inline-flex" }}>
              <span className="dot" aria-hidden="true" /> Google single sign-in
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
              <GoogleSignInButton />
            </div>
            <p className="stat-note mt-4">
              Screening duty is assigned only by an administrator — desk access is never
              self-claimed.
            </p>
          </div>
        </Card>
      </section>
    );
  }

  const pendingQueueCount = queue?.pending.length || 0;
  const alertCount = syndicateData?.active_alerts_count || 0;
  const watchlistCount = watchlist.length;
  const totalBlocks = ledgerAnchor?.total_blocks ?? (queue?.recent.length || 0);

  return (
    <section className="section">
      {/* ── COMMAND CONSOLE HEADER ────────────────────────────────────────── */}
      <div className="section__head rv">
        <div>
          <Kicker>SSB Border Screening Command Console</Kicker>
          <h2>AI-Based Fake Identity &amp; Document Screening Desk</h2>
        </div>
        <p>
          {me.name} — session active.{" "}
          {me.is_super_admin
            ? "Supervisor clearance."
            : me.pending_approval
            ? "Your screening role is pending approval."
            : "Duty post authorized."}
        </p>
      </div>

      {me.pending_approval && (
        <div className="rv rv--d2 mb-3">
          <Card title="Role pending approval" icon={<IconKey size={14} />}>
            <EmptyNote>
              <span className="big">Screening is temporarily blocked</span>
              <br />
              An administrator must assign your post &amp; institution before you can screen
              documents or adjudicate results.
            </EmptyNote>
          </Card>
        </div>
      )}

      {/* ── SUB-NAV TAB BAR WITH LIVE METRIC BADGES ───────────────────────── */}
      <nav className="sub-nav-bar rv rv--d1" aria-label="Console sub-navigation">
        <button
          type="button"
          className={`sub-tab-btn ${tab === "desk" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("desk")}
        >
          <span>🎯</span>
          <span>Screening Desk</span>
        </button>

        <button
          type="button"
          className={`sub-tab-btn ${tab === "queue" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("queue")}
        >
          <span>📋</span>
          <span>Adjudication Queue</span>
          {pendingQueueCount > 0 ? (
            <span className="sub-tab-badge sub-tab-badge--amber">{pendingQueueCount}</span>
          ) : (
            <span className="sub-tab-badge sub-tab-badge--slate">{queue?.recent.length || 0}</span>
          )}
        </button>

        <button
          type="button"
          className={`sub-tab-btn ${tab === "syndicate" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("syndicate")}
        >
          <span>🚨</span>
          <span>Syndicate Monitor</span>
          {alertCount > 0 && (
            <span className="sub-tab-badge sub-tab-badge--danger">{alertCount}</span>
          )}
        </button>

        {isSuper && (
          <button
            type="button"
            className={`sub-tab-btn ${tab === "watchlist" ? "sub-tab-btn--active" : ""}`}
            onClick={() => setTab("watchlist")}
          >
            <span>🛑</span>
            <span>Watchlist</span>
            <span className="sub-tab-badge sub-tab-badge--slate">{watchlistCount}</span>
          </button>
        )}

        <button
          type="button"
          className={`sub-tab-btn ${tab === "ledger" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("ledger")}
        >
          <span>⛓️</span>
          <span>Blockchain Ledger</span>
          <span className="sub-tab-badge sub-tab-badge--seal">#{totalBlocks}</span>
        </button>

        {isSuper && (
          <button
            type="button"
            className={`sub-tab-btn ${tab === "admin" ? "sub-tab-btn--active" : ""}`}
            onClick={() => setTab("admin")}
          >
            <span>🛡️</span>
            <span>Officer Roster</span>
            <span className="sub-tab-badge sub-tab-badge--slate">{signers.length}</span>
          </button>
        )}

        <button
          type="button"
          className={`sub-tab-btn ${tab === "notices" ? "sub-tab-btn--active" : ""}`}
          onClick={() => setTab("notices")}
        >
          <span>📢</span>
          <span>Bulletins</span>
        </button>
      </nav>

      {/* ── TAB CONTENT ROUTING ───────────────────────────────────────────── */}
      <div className="rv rv--d2">
        {tab === "desk" && (
          <ScreeningDeskView
            onScreenSuccess={async () => {
              await loadQueue();
              await loadSyndicate();
              await loadLedgerAnchor();
            }}
            isSuper={isSuper}
            ledgerAnchor={ledgerAnchor}
            onTriggerAnchor={handleTriggerAnchor}
            anchorBusy={anchorBusy}
          />
        )}

        {tab === "queue" && (
          <AdjudicationQueueSubTable
            queue={queue}
            isSuper={isSuper}
            onAdjudicate={handleAdjudicateFromQueue}
            onRefresh={loadQueue}
          />
        )}

        {tab === "syndicate" && (
          <SyndicateThreatSubTable
            data={syndicateData}
            busy={syndicateBusy}
            filter={syndicateFilter}
            onFilterChange={(cp) => {
              setSyndicateFilter(cp);
              void loadSyndicate(cp);
            }}
            onRefresh={() => void loadSyndicate(syndicateFilter)}
          />
        )}

        {tab === "watchlist" && isSuper && (
          <WatchlistSubTable
            entries={watchlist}
            isSuper={isSuper}
            onAdd={handleAddWatchlist}
            onRemove={handleRemoveWatchlist}
          />
        )}

        {tab === "ledger" && (
          <BlockchainLedgerSubTable
            ledgerAnchor={ledgerAnchor}
            queue={queue}
            anchorBusy={anchorBusy}
            onTriggerAnchor={handleTriggerAnchor}
            onRefresh={async () => {
              await loadLedgerAnchor();
              await loadQueue();
            }}
          />
        )}

        {tab === "admin" && isSuper && (
          <OfficerDirectorySubTable
            signers={signers}
            isSuper={isSuper}
            onAssignRole={handleAssignRole}
          />
        )}

        {tab === "notices" && <NoticeBoard />}
      </div>

      <div style={{ height: 24 }} />
    </section>
  );
}