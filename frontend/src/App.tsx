// ============================================================================
// App shell — SSB Border Screening Console (SIH26188).
// Government of India, Ministry of Home Affairs.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useAuth, useToast } from "./app/state";
import { initials } from "./app/util";
import { SignInGate } from "./views/GoogleSignIn";
import { DeskView } from "./views/DeskView";
import { ReviewQueueView } from "./views/ReviewQueueView";
import { LedgerView } from "./views/LedgerView";
import { WatchlistView } from "./views/WatchlistView";
import { StaffView } from "./views/StaffView";

type ViewKey = "desk" | "review" | "ledger" | "watchlist" | "staff";

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: "desk", label: "Desk", icon: "🖥️" },
  { key: "review", label: "Review Queue", icon: "📋" },
  { key: "ledger", label: "Record Log", icon: "⛓️" },
  { key: "watchlist", label: "Watchlist", icon: "🛡️" },
  { key: "staff", label: "Staff", icon: "👤" },
];

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
                <path d="M 98.4 100 L 99.4 15 L 100.6 15 L 101.6 100 Z" opacity="0.9" />
                <polygon points="100,12 102.5,15 100,17 97.5,15" />
                <circle cx="100" cy="9" r="1.6" />
                <circle cx="100" cy="78" r="1.1" opacity="0.7" />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function BootScreen() {
  return (
    <div className="boot" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ textAlign: "center", color: "#0b2240", fontWeight: 700, fontFamily: "var(--font-ui)" }}>
        <div style={{ width: 64, height: 64, margin: "0 auto 18px", color: "#1d4ed8" }}>
          <svg viewBox="0 0 200 200" style={{ width: "100%", height: "100%", animation: "ashokaSpin 6s linear infinite" }}>
            <g fill="currentColor">
              <circle cx="100" cy="100" r="95" fill="none" stroke="currentColor" strokeWidth="4" />
              <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="100" cy="100" r="20" fill="none" stroke="currentColor" strokeWidth="3" />
              <circle cx="100" cy="100" r="8" fill="currentColor" />
              {Array.from({ length: 24 }).map((_, i) => (
                <g key={i} transform={`rotate(${i * 15} 100 100)`}>
                  <path d="M 98.2 100 L 99.4 15 L 100.6 15 L 101.8 100 Z" />
                  <polygon points="100,12 103,15 100,18 97,15" />
                  <circle cx="100" cy="8" r="2" />
                </g>
              ))}
            </g>
          </svg>
        </div>
        <div style={{ fontSize: "0.95rem", letterSpacing: "0.06em", color: "#0b2240" }}>
          CONNECTING TO SECURE BORDER GATEWAY...
        </div>
      </div>
    </div>
  );
}

function SuperHeader() {
  return (
    <div className="gov-super-header">
      <div className="gov-super-header__left">
        <span>GOVERNMENT OF INDIA</span>
        <span className="gov-super-header__pipe">|</span>
        <span>MINISTRY OF HOME AFFAIRS</span>
      </div>
      <div className="gov-super-header__right">
        <a href="#home" className="gov-super-header__link">Home</a>
        <a href="#services" className="gov-super-header__link">Citizen Services</a>
        <span className="gov-super-header__badge">Staff Console</span>
      </div>
    </div>
  );
}

function PortalHeader() {
  const { me } = useAuth();
  const officerName = me?.name || me?.admin || "Inspector R. Sharma";
  const officerRole = me?.designation || (me?.pending_approval ? "Screening Officer" : "Screening Officer");
  const officerUnit = me?.institution || "SSB Panitanki ICP";

  return (
    <header className="gov-portal-header">
      <div className="gov-portal-header__brand">
        <img
          src="https://upload.wikimedia.org/wikipedia/commons/5/55/Emblem_of_India.svg"
          alt="Emblem of India"
          className="gov-portal-header__emblem"
          onError={(e) => {
            // Fallback gracefully if external SVG cannot load offline
            (e.target as HTMLElement).style.display = "none";
          }}
        />
        <div>
          <div className="gov-portal-header__sub">
            GOVERNMENT OF INDIA, MINISTRY OF HOME AFFAIRS
          </div>
          <h1 className="gov-portal-header__title">
            VIBE CHECK-POINT
          </h1>
          <p className="gov-portal-header__desc">
            AI Identity Verification &amp; Border Screening · Indo-Nepal / Indo-Bhutan Sector · SIH 26188
          </p>
        </div>
      </div>

      {me && (
        <div className="officer-card">
          <div className="officer-card__avatar">{initials(officerName)}</div>
          <div className="officer-card__info">
            <div className="officer-card__name">{officerName}</div>
            <div className="officer-card__role">
              {officerRole} · {officerUnit}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function CommandStatusStrip() {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [istTime, setIstTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const istOffset = 5.5 * 3600 * 1000;
      const istDate = new Date(now.getTime() + istOffset);
      setIstTime(istDate.toISOString().slice(11, 19) + " IST");
    };
    updateTime();
    const id = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(id);
  }, []);

  const doSignOut = async () => {
    setSigningOut(true);
    await signOut();
    toast("Officer session closed.", "info");
  };

  return (
    <div className="command-strip">
      <div className="command-strip__left">
        <span className="command-strip__status">
          <span className="command-strip__dot" /> OPERATIONAL
        </span>
        <span className="command-strip__sep">•</span>
        <span>Raxaul / Panitanki ICP</span>
        <span className="command-strip__sep">•</span>
        <span className="command-strip__live">LIVE SSB SESSION</span>
      </div>

      <div className="command-strip__right">
        <span className="command-strip__clock mono">{istTime}</span>
        <span className="command-strip__sep">|</span>
        <span>ZERO-STORAGE AUDIT - SHA-256 DIGESTS ONLY</span>
        <button
          type="button"
          className="command-strip__signout"
          disabled={signingOut}
          onClick={() => void doSignOut()}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function NavTabs({ active, onPick }: { active: ViewKey; onPick: (k: ViewKey) => void }) {
  return (
    <nav className="gov-nav" aria-label="Console sections">
      {NAV.map((n) => (
        <button
          key={n.key}
          type="button"
          className={`gov-nav__tab${active === n.key ? " gov-nav__tab--active" : ""}`}
          onClick={() => onPick(n.key)}
        >
          <span className="gov-nav__icon">{n.icon}</span>
          <span className="gov-nav__label">{n.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const { booting, signedIn, me } = useAuth();
  const [view, setView] = useState<ViewKey>("desk");
  const prevView = useRef<ViewKey>("desk");

  useEffect(() => {
    if (prevView.current !== view) {
      prevView.current = view;
      return;
    }
    if (signedIn && me) setView("desk");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, me]);

  if (booting) {
    return <BootScreen />;
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
    <div className="console-layout">
      <AshokaChakraWatermark />
      <SuperHeader />
      <PortalHeader />
      <CommandStatusStrip />
      <NavTabs active={view} onPick={setView} />
      <main className="console-main">
        {view === "desk" && <DeskView />}
        {view === "review" && <ReviewQueueView />}
        {view === "ledger" && <LedgerView />}
        {view === "watchlist" && <WatchlistView />}
        {view === "staff" && <StaffView />}
      </main>
      <footer className="gov-footer">
        <span>🔒 CRYPTOGRAPHIC HASHING [SHA-256]</span>
        <span className="gov-footer__pipe">|</span>
        <span>🌐 DECENTRALIZED IMMUTABLE LEDGER TECHNOLOGY</span>
        <span className="gov-footer__pipe">|</span>
        <span>🛡️ SECURE AUDIT TRAIL</span>
      </footer>
    </div>
  );
}

export default App;