import { useState, useEffect } from "react";
import { useAuth } from "./app/state";
import { DeskView } from "./views/DeskView";
import { ReviewQueueView } from "./views/ReviewQueueView";
import { LedgerView } from "./views/LedgerView";
import { WatchlistView } from "./views/WatchlistView";
import { StaffView } from "./views/StaffView";
import { GoogleSignIn } from "./views/GoogleSignIn";

export function App() {
  const auth = useAuth() as any;
  const admin = auth?.admin || auth?.officer || auth?.me || null;
  const signedIn = Boolean(auth?.signedIn);
  const booting = Boolean(auth?.booting);
  const signOut = auth?.signOut || (() => window.location.reload());

  const [activeTab, setActiveTab] = useState<"desk" | "queue" | "ledger" | "watchlist" | "staff">("desk");
  const [currentUtcTime, setCurrentUtcTime] = useState("");

  useEffect(() => {
    // Force light theme to prevent dark/blank CSS bugs
    document.documentElement.removeAttribute("data-theme");
    document.body.removeAttribute("data-theme");

    const updateTime = () => {
      const now = new Date();
      setCurrentUtcTime(now.toISOString().substring(11, 19) + " UTC");
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Safe Booting Screen
  if (booting) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", color: "#0b2240", fontWeight: 700, fontFamily: "sans-serif" }}>
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/5/55/Emblem_of_India.svg"
            alt="Emblem"
            style={{ height: 56, margin: "0 auto 16px", display: "block" }}
          />
          CONNECTING TO SECURE BORDER GATEWAY...
        </div>
      </div>
    );
  }

  // Route to Login Gate
  if (!signedIn) {
    return <GoogleSignIn />;
  }

  const officerName = admin?.name || admin?.email?.split("@")[0] || "Asutosh Nayak";
  const officerInitials =
    officerName
      .split(" ")
      .filter(Boolean)
      .map((n: string) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "AN";

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc" }}>
      {/* Super Header */}
      <div className="gov-super-header" style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "6px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem", color: "#334155" }}>
        <div style={{ display: "flex", gap: "16px" }}>
          <span>GOVERNMENT OF INDIA</span>
          <span style={{ color: "#cbd5e1" }}>|</span>
          <span>MINISTRY OF HOME AFFAIRS</span>
        </div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <a href="#home" style={{ color: "#1e3a8a", textDecoration: "none", fontWeight: 600 }}>Home</a>
          <a href="#services" style={{ color: "#1e3a8a", textDecoration: "none", fontWeight: 600 }}>Citizen Services</a>
          <span style={{ background: "#0b2240", color: "#ffffff", padding: "2px 8px", borderRadius: "4px", fontWeight: 700, fontSize: "0.72rem" }}>
            Staff Console
          </span>
        </div>
      </div>

      {/* Portal Header */}
      <header className="portal-header" style={{ background: "#ffffff", padding: "14px 32px", borderBottom: "3px solid #d97706", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/5/55/Emblem_of_India.svg"
            alt="Emblem"
            style={{ height: "56px", width: "auto", objectFit: "contain" }}
          />
          <div>
            <h2 style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.08em", color: "#334155", textTransform: "uppercase", margin: "0 0 2px 0" }}>
              GOVERNMENT OF INDIA, MINISTRY OF HOME AFFAIRS
            </h2>
            <h1 style={{ fontSize: "1.45rem", fontWeight: 900, letterSpacing: "-0.01em", color: "#0b2240", margin: 0 }}>
              SSB BORDER SCREENING CONSOLE
            </h1>
            <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "#475569", margin: 0 }}>
              SSB Border Screening Service · Indo-Nepal / Indo-Bhutan Sector
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#f8fafc", border: "1px solid #cbd5e1", padding: "6px 14px", borderRadius: "6px" }}>
          <div style={{ background: "#0b2240", color: "#fff", fontWeight: 700, width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}>
            {officerInitials}
          </div>
          <div style={{ textAlign: "left", lineHeight: 1.25 }}>
            <div style={{ fontWeight: 700, color: "#0b2240", fontSize: "0.88rem" }}>{officerName}</div>
            <div style={{ fontSize: "0.74rem", color: "#64748b" }}>
              {admin?.designation || "Screening Officer"} · {admin?.institution || "SSB"}
            </div>
          </div>
        </div>
      </header>

      {/* Status Telemetry Strip */}
      <div style={{ background: "#0b2240", color: "#ffffff", padding: "8px 32px", fontSize: "0.76rem", fontFamily: "monospace", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e3a5f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <span>
            <span style={{ display: "inline-block", width: "8px", height: "8px", background: "#22c55e", borderRadius: "50%", marginRight: "6px" }} />
            OPERATIONAL
          </span>
          <span style={{ color: "#475569" }}>•</span>
          <span>Raxaul ICP</span>
          <span style={{ color: "#475569" }}>•</span>
          <span style={{ color: "#4ade80" }}>LIVE SSB SESSION</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <span>UTC {currentUtcTime}</span>
          <span style={{ color: "#475569" }}>|</span>
          <span>ZERO-STORAGE AUDIT - SHA-256 DIGESTS ONLY</span>
          <button
            type="button"
            style={{ background: "#ffffff", color: "#0b2240", border: "none", fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: "3px", cursor: "pointer", textTransform: "uppercase" }}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Tab Navigation Strip */}
      <nav style={{ background: "#ffffff", borderBottom: "1px solid #cbd5e1", padding: "0 32px", display: "flex", gap: "4px" }}>
        <button type="button" className={`nav-tab-btn ${activeTab === "desk" ? "active" : ""}`} onClick={() => setActiveTab("desk")}>🖥️ Desk</button>
        <button type="button" className={`nav-tab-btn ${activeTab === "queue" ? "active" : ""}`} onClick={() => setActiveTab("queue")}>📋 Review Queue</button>
        <button type="button" className={`nav-tab-btn ${activeTab === "ledger" ? "active" : ""}`} onClick={() => setActiveTab("ledger")}>⛓️ Crypto Ledger</button>
        <button type="button" className={`nav-tab-btn ${activeTab === "watchlist" ? "active" : ""}`} onClick={() => setActiveTab("watchlist")}>🛡️ Watchlist</button>
        <button type="button" className={`nav-tab-btn ${activeTab === "staff" ? "active" : ""}`} onClick={() => setActiveTab("staff")}>👤 Staff</button>
      </nav>

      {/* Main Content Area */}
      <main style={{ flex: 1, width: "100%", maxWidth: "1200px", margin: "0 auto", padding: "24px 20px" }}>
        {activeTab === "desk" && <DeskView />}
        {activeTab === "queue" && <ReviewQueueView />}
        {activeTab === "ledger" && <LedgerView />}
        {activeTab === "watchlist" && <WatchlistView />}
        {activeTab === "staff" && <StaffView />}
      </main>

      {/* Footer */}
      <footer className="gov-footer" style={{ marginTop: "auto", background: "#ffffff", borderTop: "1px solid #cbd5e1", padding: "12px 32px", display: "flex", justifyContent: "center", alignItems: "center", gap: "24px", fontSize: "0.78rem", fontWeight: 700, color: "#334155", textTransform: "uppercase" }}>
        <span>🔒 CRYPTOGRAPHIC HASHING [SHA-256]</span>
        <span>|</span>
        <span>🌐 DECENTRALIZED IMMUTABLE LEDGER TECHNOLOGY</span>
        <span>|</span>
        <span>🛡️ SECURE AUDIT TRAIL</span>
      </footer>
    </div>
  );
}

export default App;