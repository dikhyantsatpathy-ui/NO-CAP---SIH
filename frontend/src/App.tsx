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
import { ChatModal, FloatingChatTrigger } from "./views/ChatModal";
import { pingMlKeepAlive } from "./api";

export function TriColorRule() {
  return (
    <div className="tricolor-rule" aria-hidden="true">
      <div className="tricolor-rule__saffron" />
      <div className="tricolor-rule__white" />
      <div className="tricolor-rule__green" />
    </div>
  );
}

type ViewKey = "desk" | "review" | "ledger" | "watchlist" | "staff";

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: "desk", label: "Scan & Verify", icon: "📸" },
  { key: "review", label: "Needs Review", icon: "⚠️" },
  { key: "ledger", label: "Log & History", icon: "📜" },
  { key: "watchlist", label: "Alert List", icon: "🛡️" },
  { key: "staff", label: "Officers", icon: "👥" },
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
        <span>INTEGRATED CHECK POST (ICP)</span>
      </div>
    </div>
  );
}

function PortalHeader() {
  const { me } = useAuth();
  const officerName = me?.name || me?.admin || "Inspector R. Sharma";
  const officerRole = me?.designation || (me?.pending_approval ? "Screening Officer" : "Screening Officer");
  const officerUnit = me?.institution || "Border Screening Division";

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
            GOVERNMENT OF INDIA · MINISTRY OF HOME AFFAIRS
          </div>
          <h1 className="gov-portal-header__title">
            VIBE CHECK-POINT
          </h1>
          <p className="gov-portal-header__desc">
            Smart Border Screening &amp; Fake ID Detection · SIH 26188
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

export function useMlKeepAlive() {
  const { toast } = useToast();
  const [hfKeepAlive, setHfKeepAlive] = useState<boolean>(() => {
    return localStorage.getItem("nocap_hf_keepalive") !== "false";
  });
  const [mlLatency, setMlLatency] = useState<number | null>(null);
  const [isWaking, setIsWaking] = useState(false);

  useEffect(() => {
    if (!hfKeepAlive) return;
    let isMounted = true;
    const sendPing = async () => {
      try {
        const res = await pingMlKeepAlive();
        if (isMounted && res.ok) {
          if (res.data.status === "online" && typeof res.data.latency_ms === "number") {
            setMlLatency(res.data.latency_ms);
          }
        }
      } catch {
        // silent
      }
    };
    sendPing();
    const interval = window.setInterval(sendPing, 4 * 60 * 1000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [hfKeepAlive]);

  const toggleKeepAlive = async () => {
    if (!hfKeepAlive) {
      setHfKeepAlive(true);
      localStorage.setItem("nocap_hf_keepalive", "true");
      setIsWaking(true);
      toast("Waking up Hugging Face ML service...", "info");
      try {
        const res = await pingMlKeepAlive();
        if (res.ok) {
          if (res.data.status === "online") {
            setMlLatency(res.data.latency_ms ?? null);
            toast(`Hugging Face Space is awake & warm (${res.data.latency_ms ?? 0}ms)`, "success");
          } else {
            toast(res.data.message || "Hugging Face Space waking up...", "info");
          }
        }
      } catch {
        toast("Could not reach ML service", "error");
      } finally {
        setIsWaking(false);
      }
    } else {
      setHfKeepAlive(false);
      localStorage.setItem("nocap_hf_keepalive", "false");
      setMlLatency(null);
      toast("ML Keep-Alive disabled. Space will idle normally.", "info");
    }
  };

  return { hfKeepAlive, mlLatency, isWaking, toggleKeepAlive };
}

export function FloatingKeepAliveTrigger() {
  const { hfKeepAlive, mlLatency, isWaking, toggleKeepAlive } = useMlKeepAlive();

  return (
    <button
      type="button"
      className={`floating-keepalive-pill ${
        isWaking
          ? "floating-keepalive-pill--waking"
          : hfKeepAlive
          ? "floating-keepalive-pill--on"
          : ""
      }`}
      onClick={() => void toggleKeepAlive()}
      title="Hugging Face Keep-Alive: prevents external AI models from going to sleep or getting rate limited"
    >
      <span
        className={`dot ${
          isWaking
            ? "dot--waking"
            : hfKeepAlive
            ? "dot--pulse"
            : "dot--idle"
        }`}
      />
      <span>
        {isWaking
          ? "Waking ML Space…"
          : hfKeepAlive
          ? mlLatency
            ? `⚡ ML Warm (${mlLatency}ms)`
            : "⚡ HF Keep-Alive: ON"
          : "💤 HF Keep-Alive: OFF"}
      </span>
    </button>
  );
}

function CommandStatusStrip() {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [istTime, setIstTime] = useState("");
  const { hfKeepAlive, mlLatency, isWaking, toggleKeepAlive } = useMlKeepAlive();

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
          <span className="command-strip__dot" /> SYSTEM ONLINE
        </span>
        <span className="command-strip__sep">•</span>
        <span className="command-strip__live">ACTIVE DUTY</span>
        <span className="command-strip__sep">•</span>
        <button
          type="button"
          className={`command-strip__keepalive ${
            isWaking
              ? "command-strip__keepalive--waking"
              : hfKeepAlive
              ? "command-strip__keepalive--on"
              : ""
          }`}
          title="Prevents Hugging Face ML models from going to sleep without triggering rate limits (pings /health every 4 mins)"
          onClick={() => void toggleKeepAlive()}
        >
          <span
            className={`command-strip__dot ${
              isWaking
                ? "command-strip__dot--waking"
                : hfKeepAlive
                ? "command-strip__dot--pulse"
                : "command-strip__dot--idle"
            }`}
          />
          <span>
            {isWaking
              ? "Waking ML Space..."
              : hfKeepAlive
              ? mlLatency
                ? `⚡ ML Warm (${mlLatency}ms)`
                : "⚡ HF Keep-Alive: ON"
              : "💤 HF Keep-Alive: OFF"}
          </span>
        </button>
      </div>

      <div className="command-strip__right">
        <span className="command-strip__clock mono">{istTime}</span>
        <span className="command-strip__sep">|</span>
        <span>ZERO-STORAGE PRIVACY · NO RAW IDS STORED</span>
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
  const [visitedViews, setVisitedViews] = useState<Set<ViewKey>>(new Set(["desk"]));
  const [chatOpen, setChatOpen] = useState(false);
  const prevView = useRef<ViewKey>("desk");

  // Warm background cache for all tabs during idle time
  useEffect(() => {
    if (signedIn && me) {
      import("./app/preloader").then(({ preloadAllBackgroundData }) => {
        void preloadAllBackgroundData();
      });
    }
  }, [signedIn, me]);

  useEffect(() => {
    if (prevView.current !== view) {
      prevView.current = view;
      setVisitedViews((prev) => (prev.has(view) ? prev : new Set(prev).add(view)));
      return;
    }
    if (signedIn && me) {
      setView("desk");
      setVisitedViews(new Set(["desk"]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, me, view]);

  if (booting) {
    return <BootScreen />;
  }

  if (!signedIn) {
    return (
      <div>
        <AshokaChakraWatermark />
        <SuperHeader />
        <TriColorRule />
        <SignInGate />
        <FloatingKeepAliveTrigger />
        <FloatingChatTrigger onClick={() => setChatOpen(true)} />
        <ChatModal isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      </div>
    );
  }

  return (
    <div className="console-layout">
      <AshokaChakraWatermark />
      <SuperHeader />
      <TriColorRule />
      <PortalHeader />
      <CommandStatusStrip />
      <NavTabs active={view} onPick={setView} />
      <main className="console-main">
        {visitedViews.has("desk") && (
          <div style={{ display: view === "desk" ? "block" : "none" }}>
            <DeskView />
          </div>
        )}
        {visitedViews.has("review") && (
          <div style={{ display: view === "review" ? "block" : "none" }}>
            <ReviewQueueView />
          </div>
        )}
        {visitedViews.has("ledger") && (
          <div style={{ display: view === "ledger" ? "block" : "none" }}>
            <LedgerView />
          </div>
        )}
        {visitedViews.has("watchlist") && (
          <div style={{ display: view === "watchlist" ? "block" : "none" }}>
            <WatchlistView />
          </div>
        )}
        {visitedViews.has("staff") && (
          <div style={{ display: view === "staff" ? "block" : "none" }}>
            <StaffView />
          </div>
        )}
      </main>
      <footer className="gov-footer">
        <span>🔒 SHA-256 HASH CHAIN</span>
        <span className="gov-footer__pipe">|</span>
        <span>📜 IMMUTABLE AUDIT LOG</span>
        <span className="gov-footer__pipe">|</span>
        <span>🛡️ ZERO-RAW-STORAGE PRIVACY</span>
      </footer>
      <FloatingKeepAliveTrigger />
      <FloatingChatTrigger onClick={() => setChatOpen(true)} />
      <ChatModal isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}

export default App;