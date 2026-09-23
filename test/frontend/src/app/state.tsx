// frontend/src/app/state.tsx
import { createContext, useContext, useState, useEffect, ReactNode, Fragment } from "react";
import { getMe, logout as apiLogout, type Me } from "../api";

interface Toast {
  id: string;
  msg: string;
  kind: "info" | "success" | "error" | "warn";
}

export interface AuthContextValue {
  booting: boolean;
  signedIn: boolean;
  admin: Me["admin"] | null;
  officer: Me["admin"] | null;
  me: Me["admin"] | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setDemoOfficer: (profile?: Partial<Me["admin"]>) => void;
  toast: (msg: any, kind?: "info" | "success" | "error" | "warn") => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [admin, setAdmin] = useState<Me["admin"] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = (rawMsg: any, kind: "info" | "success" | "error" | "warn" = "info") => {
    if (!rawMsg) return;
    let text = "";
    if (typeof rawMsg === "string") {
      text = rawMsg;
    } else if (Array.isArray(rawMsg)) {
      text = rawMsg.map((m) => (typeof m === "object" ? m.msg || JSON.stringify(m) : String(m))).join("; ");
    } else if (typeof rawMsg === "object") {
      text = rawMsg.msg || rawMsg.detail || JSON.stringify(rawMsg);
    } else {
      text = String(rawMsg);
    }

    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, msg: text, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const refresh = async () => {
    try {
      const res = await getMe();
      if (res.data?.admin) {
        setAdmin(res.data.admin);
      } else {
        setAdmin(null);
      }
    } catch {
      setAdmin(null);
    } finally {
      setBooting(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const signOut = async () => {
    try {
      await apiLogout();
    } catch {
      // ignore
    }
    setAdmin(null);
    toast("Signed out successfully", "info");
  };

  const setDemoOfficer = (profile?: Partial<Me["admin"]>) => {
    setAdmin({
      email: profile?.email || "evaluator@ssb.gov.in",
      name: profile?.name || "Asutosh Nayak",
      institution: profile?.institution || "SIH26188",
      designation: profile?.designation || "Student-Supervisor, AN",
      pending_approval: false,
      is_super_admin: true,
    });
  };

  const value: AuthContextValue = {
    booting,
    signedIn: Boolean(admin),
    admin,
    officer: admin,
    me: admin,
    refresh,
    signOut,
    setDemoOfficer,
    toast,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.kind}`}>
              <div className="toast__bar" />
              <div className="toast__msg">{typeof t.msg === "string" ? t.msg : JSON.stringify(t.msg)}</div>
            </div>
          ))}
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return <Fragment>{children}</Fragment>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}