// ============================================================================
// App shell — top bar, status band, footer.
// The console is a single officer view: the SSB border screening desk
// (Google sign-in gate; signed-out visitors see the login screen).
// ============================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth, useToast } from "./app/state";
import { useExplain } from "./app/explain";
import { useTheme } from "./app/theme";
import { useGlobalReveals } from "./app/motion";
import { prefetchAnalyticsSummary } from "./app/analyticsCache";
import { initials } from "./app/util";
import { IconBar, IconMoon, IconQuestion, IconShield, IconSun } from "./components/ui";
import ProjectChatbot from "./components/ProjectChatbot";
import { AuthorityView } from "./views/AuthorityView";
import { PublicView } from "./views/PublicView";
import { AnalyticsView } from "./views/AnalyticsView";

type ViewKey = "desk" | "public" | "analytics";

const NAV_TABS: { key: ViewKey; label: string; icon: ReactNode }[] = [
  { key: "desk", label: "Screening Desk", icon: <IconShield size={13} /> },
  { key: "public", label: "Verify & Notices", icon: <IconShield size={13} /> },
  { key: "analytics", label: "Analytics", icon: <IconBar size={13} /> },
];

function BrandMark() {
  // A checkpost seal: a passport-style clipped shield in the seal colour,
  // inner tick asserting the screened identity.
  return (
    <svg className="brand__mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--seal)" />
      <g
        fill="none"
        stroke="var(--paper)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 8 l18 9 c0 12 -4 22 -18 30 c-14 -8 -18 -18 -18 -30 Z" />
        <circle cx="32" cy="27" r="5.5" />
        <path d="M26 36 l4 4 7-8" />
      </g>
      <path d="M20 52 c12 5 12 5 24 0" stroke="var(--paper)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Fixed top progress bar + page-wide `--scroll` (0..1) custom property used
 *  by parallax / reactive elements. Both update on the same rAF. */
function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      doc.style.setProperty("--scroll", p.toFixed(4));
      if (ref.current) ref.current.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <div className="scroll-progress" ref={ref} aria-hidden="true" />;
}

function TopBar() {
  const { me, signedIn, signOut } = useAuth();
  const { toast } = useToast();
  const { on, toggle } = useExplain();
  const [theme, toggleTheme] = useTheme();

  const doLogout = async () => {
    await signOut();
    toast("Officer session ended.", "info");
  };

  return (
    <header className="topbar">
      <div className="shell topbar__inner">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <BrandMark />
          <span>
            <span className="brand__name">SSB Border Screening</span>
            <span className="brand__sub">Fake Identity &amp; Document Screening · SIH26188</span>
          </span>
        </a>

        {me && signedIn && (
          <span className="session-chip">
            <span className="dot" aria-hidden="true" />
            {initials(me.name)} {me.name}
            {me.is_super_admin ? " · S-ADMIN" : ""}
          </span>
        )}
        {me && signedIn && (
          <button className="link-btn" onClick={() => void doLogout()}>
            Sign out
          </button>
        )}

        <button
          className={`ex-toggle ${on ? "ex-toggle--on" : "ex-toggle--off"}`}
          data-explain-toggle
          onClick={toggle}
          aria-pressed={on}
          title={on ? "Explain mode is active — click to turn off" : "Explain mode is disabled — click to turn on"}
        >
          <IconQuestion size={15} />
          <span className="ex-toggle__label">Explain</span>
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-thumb" />
          </span>
          <span className="ex-toggle__status">{on ? "ON" : "OFF"}</span>
        </button>

        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>
      </div>
    </header>
  );
}

function StatusBand() {
  return (
    <div className="status-band">
      <div className="shell status-band__inner">
        <span>
          <span className="dot" style={{ background: "var(--status-dot)" }} aria-hidden="true" />
          SCREENING DESK — OPERATIONAL
        </span>
        <span className="sep">|</span>
        <span>
          AI DETECTOR <b style={{ color: "var(--status-strong)" }}>heuristic + cloud + on-device</b>
        </span>
        <span className="sep">|</span>
        <span>FOUR-MODULE FORENSICS</span>
        <span className="sep">|</span>
        <span>ZERO-STORAGE AUDIT TRAIL</span>
      </div>
    </div>
  );
}

function NavTabs({ view, onView }: { view: ViewKey; onView: (v: ViewKey) => void }) {
  return (
    <nav className="shell nav-tabs" aria-label="Console sections">
      {NAV_TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`nav-tab${view === t.key ? " nav-tab--active" : ""}`}
          onClick={() => onView(t.key)}
          aria-pressed={view === t.key}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      SSB Border Screening Console — AI-assisted fake identity &amp; document screening for the Ministry of Home Affairs.
      <div className="team">
        Dikhyant Satapathy · Supriya Mandal · Asutosh Nayak · Sushumna Meghavaram · Ayush Kumar Lenka · Sidharth Priyadarshi
      </div>
    </footer>
  );
}

export function App() {
  const [view, setView] = useState<ViewKey>("desk");

  // Scroll-reveals re-bind for the active section.
  useGlobalReveals(view);

  // Prefetch the analytics payload once at load so the tab opens instantly.
  useEffect(() => {
    void prefetchAnalyticsSummary();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [view]);

  const openView = (v: ViewKey) => {
    setView(v);
  };

  return (
    <div className="app">
      <ScrollProgress />
      <TopBar />
      <NavTabs view={view} onView={openView} />

      <main className="shell app__main">
        {view === "desk" && <AuthorityView />}
        {view === "public" && <PublicView />}
        {view === "analytics" && <AnalyticsView />}
      </main>

      <StatusBand />
      <SiteFooter />
      <ProjectChatbot />
    </div>
  );
}