// ============================================================================
// App-wide state: toasts + the authenticated authority session.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getMe, logout as apiLogout, type Me } from "../api";

// ----------------------------------------------------------------------------
// Toasts
// ----------------------------------------------------------------------------

export type ToastKind = "success" | "error" | "warn" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++toastSeq;
    setItems((prev) => [...prev.slice(-4), { id, kind, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <span className="toast__bar" aria-hidden="true" />
            <span className="toast__msg">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ----------------------------------------------------------------------------
// Auth session
// ----------------------------------------------------------------------------

interface AuthContextValue {
  /** true while the initial /api/admin/me probe is in flight */
  booting: boolean;
  me: Me | null;
  /** actively logged-in authority (me exists, not just probing) */
  signedIn: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  booting: true,
  me: null,
  signedIn: false,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const res = await getMe();
    if (mounted.current) setMe(res.ok ? res.data : null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh().finally(() => {
      if (mounted.current) setBooting(false);
    });
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    await apiLogout();
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ booting, me, signedIn: !!me, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}