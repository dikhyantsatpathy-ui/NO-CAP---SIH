// ============================================================================
// App shell — SSB Border Screening Console (SIH26188).
// Clean tabbed console: Desk / Review / Record Log / Watchlist / Staff.
// One traveller per session on the Desk; sessions sent for review settle under
// a supervisor; approved-and-settled sessions chain into the Record Log as
// tamper-proof SHA-256 entries. Zero raw identifiers are persisted anywhere.
// ============================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth, useToast } from "./app/state";
import { initials } from "./app/util";
import { SignInGate } from "./views/GoogleSignIn";
import { DeskView } from "./views/DeskView";
import { ReviewQueueView } from "./views/ReviewQueueView";
import { LedgerView } from "./views/LedgerView";
import { WatchlistView } from "./views/WatchlistView";
import { StaffView } from "./views/StaffView";

type ViewKey = "desk" | "review" | "ledger" | "watchlist" | "staff";

const ICONS: Record<ViewKey, ReactNode> = {
  desk: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  review: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.4" />
      <circle cx="4.5" cy="12" r="1.4" />
      <circle cx="4.5" cy="18" r="1.4" />
    </svg>
  ),
  ledger: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 8h6M9 12h6M9 16h6" />
    </svg>
  ),
  watchlist: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  staff: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1-4 3.6-6 6.5-6s5.5 2 6.5 6" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M15.5 14.5c2.3.2 4 1.9 4.8 4.5" />
    </svg>
  ),
};

const NAV: { key: ViewKey; label: string }[] = [
  { key: "desk", label: "Desk" },
  { key: "review", label: "Review" },
  { key: "ledger", label: "Record Log" },
  { key: "watchlist", label: "Watchlist" },
  { key: "staff", label: "Staff" },
];

function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="8" fill="var(--seal)" />
      <g fill="none" stroke="var(--ink-on-seal)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 8l18 9c0 12-4 22-18 30-14-8-18-18-18-30z" />
        <path d="M25 32l5 5 10-11" />
      </g>
    </svg>
  );
}

function TopBar() {
  const { me, signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const doSignOut = async () => {
    setSigningOut(true);
    await signOut();
    toast("Officer session closed.", "info");
  };

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <BrandMark />
        <div>
          <div className="topbar__title">SSB Border Screening Console</div>
          <div className="topbar__sub">
            Ministry of Home Affairs · Sashastra Seema Bal (Police II Division) · SIH 26188
          </div>
        </div>
      </div>
      <div className="topbar__right">
        {me && (
          <div className="officer">
            <span className="officer__chip">
              <span className="officer__badge">{initials(me.name)}</span>
              <span className="officer__meta">
                <span className="officer__name">{me.name}</span>
                <span className="officer__role">
                  {me.designation || (me.pending_approval ? "PENDING APPROVAL" : "SIGNER")}
                  {me.is_super_admin ? " · SUPERVISOR" : ""}
                </span>
              </span>
            </span>
            <button className="btn btn--small" disabled={signingOut} onClick={() => void doSignOut()}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function NavTabs({ active, onPick }: { active: ViewKey; onPick: (k: ViewKey) => void }) {
  return (
    <nav className="nav" aria-label="Console sections">
      {NAV.map((n) => (
        <button
          key={n.key}
          className={`nav__tab${active === n.key ? " nav__tab--active" : ""}`}
          onClick={() => onPick(n.key)}
        >
          <span className="nav__icon">{ICONS[n.key]}</span>
          {n.label}
        </button>
      ))}
    </nav>
  );
}

function StatusBand() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const istOffset = 5.5 * 3600 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  const ist = istDate.toISOString().slice(11, 19);
  return (
    <div className="statusband">
      <span className="statusband__item">
        <span className="dot dot--ok" /> Operational
      </span>
      <span className="statusband__item">One traveller per session</span>
      <span className="statusband__item">Nothing readable is stored — only fingerprints and results</span>
      <span className="statusband__item">Every decision is recorded in a sealed log</span>
      <span className="statusband__item statusband__item--right">
        <span className="clock mono">IST {ist}</span>
        <span className="divider" />
        <span className="mono">SIH 26188 · Official use</span>
      </span>
    </div>
  );
}

export function AshokaChakraWatermark() {
  return (
    <div className="ashoka-watermark" aria-hidden="true">
      <svg viewBox="0 0 200 200" className="ashoka-watermark__svg">
        <g fill="currentColor">
          <circle cx="100" cy="100" r="95" fill="none" stroke="currentColor" strokeWidth="2.8" />
          <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="100" cy="100" r="18" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="100" cy="100" r="7" fill="currentColor" />
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = i * 15;
            return (
              <g key={i} transform={`rotate(${angle} 100 100)`}>
                {/* Spoke needle */}
                <path d="M 98.4 100 L 99.4 15 L 100.6 15 L 101.6 100 Z" opacity="0.9" />
                {/* Spoke diamond tip */}
                <polygon points="100,12 102.5,15 100,17 97.5,15" />
                {/* Outer rim bead */}
                <circle cx="100" cy="9" r="1.6" />
                {/* Mid spoke accent bead */}
                <circle cx="100" cy="78" r="1.1" opacity="0.7" />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export function App() {
  const { booting, signedIn, me } = useAuth();
  const [view, setView] = useState<ViewKey>("desk");
  const prevView = useRef<ViewKey>("desk");

  // Re-assert Desk when the officer session changes so a fresh officer is not
  // dropped into another signer's open session pane.
  useEffect(() => {
    if (prevView.current !== view) {
      prevView.current = view;
      return;
    }
    if (signedIn && me) setView("desk");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, me]);

  if (booting) {
    return (
      <div className="boot">
        <BrandMark />
        <span className="mono">Establishing secure console…</span>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <>
        <AshokaChakraWatermark />
        <SignInGate />
      </>
    );
  }

  return (
    <div className="console">
      <AshokaChakraWatermark />
      <TopBar />
      <NavTabs active={view} onPick={setView} />
      <StatusBand />
      <main className="console__main">
        {view === "desk" && <DeskView />}
        {view === "review" && <ReviewQueueView />}
        {view === "ledger" && <LedgerView />}
        {view === "watchlist" && <WatchlistView />}
        {view === "staff" && <StaffView />}
      </main>
      <footer className="foot">
        <span className="mono">
          SIH 26188 · AI-based fake identity &amp; document screening · Zero-storage data policy active
        </span>
      </footer>
    </div>
  );
}