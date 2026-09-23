import { useEffect, useRef, useState } from "react";
import { googleLogin, demoLogin } from "../api";
import { useAuth } from "../app/state";

export function GoogleSignIn() {
  const { refresh, setDemoOfficer, toast } = useAuth();
  const [loading, setLoading] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initGsi = () => {
      const g = (window as any).google;
      if (g?.accounts?.id && btnRef.current) {
        btnRef.current.innerHTML = "";
        g.accounts.id.initialize({
          client_id:
            (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
            "698365851650-qd2nsi8ahrbv4d67aov3lff4anbco2g1.apps.googleusercontent.com",
          callback: async (res: any) => {
            const token = res?.credential;
            if (token) {
              setLoading(true);
              const loginRes = await googleLogin(token);
              setLoading(false);
              if (loginRes.data) {
                toast("Authenticated successfully", "success");
                await refresh();
              } else {
                toast(loginRes.error || "Google authentication failed", "error");
              }
            }
          },
        });
        g.accounts.id.renderButton(btnRef.current, {
          theme: "outline",
          size: "large",
          type: "standard",
          shape: "rectangular",
          text: "signin_with",
          logo_alignment: "left",
          width: 250,
        });
      }
    };

    const timer = setTimeout(initGsi, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleDemoLogin = async () => {
    setLoading(true);
    try {
      const res = await demoLogin();
      if (res.data) {
        toast("Access granted via SIH evaluator pass", "success");
        await refresh();
        setLoading(false);
        return;
      }
    } catch {
      // ignore
    }

    // Direct offline fallback
    setDemoOfficer({
      email: "evaluator@ssb.gov.in",
      name: "Asutosh Nayak",
      institution: "SIH26188",
      designation: "Student-Supervisor, AN",
      pending_approval: false,
      is_super_admin: true,
    });
    setLoading(false);
    toast("Logged in as Evaluator / Desk Officer", "success");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f1f5f9",
        padding: "20px",
        boxSizing: "border-box",
        fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)",
          border: "1px solid #e2e8f0",
          padding: "44px 36px 36px",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        {/* Top rule & Kicker */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <span style={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
          <span
            style={{
              fontSize: "0.74rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "#1d4ed8",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            MINISTRY OF HOME AFFAIRS · GOVT. OF INDIA
          </span>
          <span style={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
        </div>

        {/* Headings */}
        <h1
          style={{
            fontSize: "1.65rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "#0f172a",
            margin: "0 0 10px 0",
            lineHeight: 1.25,
          }}
        >
          SSB Border Screening Console
        </h1>
        <p
          style={{
            fontSize: "0.86rem",
            color: "#64748b",
            lineHeight: 1.55,
            margin: "0 0 26px 0",
          }}
        >
          AI-based fake identity &amp; document screening · SIH 26188
          <br />
          Sashastra Seema Bal (Police II Division) · Secure operations desk
        </p>

        <div style={{ height: "1px", background: "#f1f5f9", marginBottom: "24px" }} />

        {/* Primary Evaluator Button */}
        <button
          type="button"
          onClick={handleDemoLogin}
          disabled={loading}
          style={{
            width: "100%",
            background: "#1d4ed8",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            padding: "13px 20px",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 4px 12px rgba(29, 78, 216, 0.25)",
            marginBottom: "24px",
            opacity: loading ? 0.7 : 1,
            transition: "background 0.15s ease",
          }}
        >
          {loading ? "Verifying Access..." : "One-click access (SIH evaluator pass)"}
        </button>

        {/* Secondary SSO Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          <span style={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
          <span
            style={{
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "#94a3b8",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            OR SIGN IN WITH AN AUTHORISED GOOGLE ACCOUNT
          </span>
          <span style={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
        </div>

        {/* Google Identity Services target */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "44px",
            marginBottom: "26px",
          }}
        >
          <div ref={btnRef} />
        </div>

        {/* Footer info note */}
        <div
          style={{
            borderTop: "1px solid #f1f5f9",
            paddingTop: "18px",
            fontSize: "0.74rem",
            color: "#94a3b8",
            lineHeight: 1.5,
          }}
        >
          Protected gov system · One traveller per session · No readable details stored
        </div>
      </div>
    </div>
  );
}

export default GoogleSignIn;