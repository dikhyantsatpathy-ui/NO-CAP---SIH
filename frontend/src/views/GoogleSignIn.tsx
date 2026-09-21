// ============================================================================
// GoogleSignIn.tsx — authority sign-in gate. Google Identity Services renders
// its button here; the credential is exchanged for the HttpOnly session cookie
// by the backend (/api/admin/login). No identity data touches the frontend.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { googleLogin } from "../api";
import { useAuth, useToast } from "../app/state";

export const FALLBACK_CLIENT_ID =
  "698365851650-qd2nsi8ahrbv4d67aov3lff4anbco2g1.apps.googleusercontent.com";

/** True once the GSI client script (loaded in index.html) is ready. */
export function useGsiReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.google?.accounts?.id) {
      setReady(true);
      return;
    }
    const timer = window.setInterval(() => {
      if (window.google?.accounts?.id) {
        setReady(true);
        window.clearInterval(timer);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, []);
  return ready;
}

export function GoogleSignInButton() {
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

export function SignInGate() {
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [evaluating, setEvaluating] = useState(false);

  const handleDemoLogin = async () => {
    setEvaluating(true);
    try {
      const res = await (await import("../api")).demoLogin();
      if (res.ok) {
        toast("Authenticated as Inspector R. Sharma (SSB Panitanki ICP)", "success");
        await refresh();
      } else {
        toast(res.error, "error");
      }
    } catch (e) {
      toast("Authentication error", "error");
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate__panel">
        <div className="gate__badge-top">MINISTRY OF HOME AFFAIRS · GOVT OF INDIA</div>
        <h1 className="gate__title">SSB Border Screening Console</h1>
        <p className="gate__sub">
          AI-Based Fake Identity &amp; Document Screening · SIH26188
          <br />
          Sashastra Seema Bal (Police II Division) · Secure Operations Desk
        </p>
        <div className="gate__hr" />

        <div className="gate__options">
          <button
            className="btn btn--primary btn--block gate__demo-btn"
            disabled={evaluating}
            onClick={() => void handleDemoLogin()}
          >
            {evaluating ? "AUTHENTICATING OFFICER CONSOLE…" : "⚡ 1-CLICK ACCESS (SIH EVALUATOR PASS)"}
          </button>
          <div className="gate__or"><span>OR SIGN IN WITH AUTHORISED GOOGLE ACCOUNT</span></div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <GoogleSignInButton />
          </div>
        </div>

        <p className="gate__foot">
          Protected Gov System · Single-session custody · Zero raw PII persisted
        </p>
      </div>
    </div>
  );
}