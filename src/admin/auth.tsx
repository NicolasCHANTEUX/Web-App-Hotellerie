import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AdminMe, AdminRole, getAdminMe, loginAdmin } from "../api/admin";

const ACCESS_TOKEN_KEY = "rivage.admin.accessToken";
const EXPIRES_AT_KEY = "rivage.admin.expiresAt";

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

type AdminAuthContextValue = {
  status: AuthStatus;
  accessToken: string | null;
  profile: AdminMe | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function clearStoredSession() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_AT_KEY);
}

function readStoredAccessToken() {
  const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  const expiresAt = Number(sessionStorage.getItem(EXPIRES_AT_KEY));
  if (!token) return null;
  if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
    clearStoredSession();
    return null;
  }
  return token;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<AdminMe | null>(null);

  const logout = useCallback(() => {
    clearStoredSession();
    setAccessToken(null);
    setProfile(null);
    setStatus("unauthenticated");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const token = readStoredAccessToken();
    if (!token) {
      setStatus("unauthenticated");
      return () => controller.abort();
    }

    setAccessToken(token);
    getAdminMe(token, controller.signal)
      .then((nextProfile) => {
        setProfile(nextProfile);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!controller.signal.aborted) logout();
      });

    return () => controller.abort();
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await loginAdmin(email, password);
    sessionStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
    sessionStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + session.expiresIn * 1000));
    try {
      const nextProfile = await getAdminMe(session.accessToken);
      setAccessToken(session.accessToken);
      setProfile(nextProfile);
      setStatus("authenticated");
    } catch (error) {
      clearStoredSession();
      throw error;
    }
  }, []);

  const value = useMemo<AdminAuthContextValue>(() => ({
    status,
    accessToken,
    profile,
    login,
    logout,
  }), [status, accessToken, profile, login, logout]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error("useAdminAuth doit être utilisé dans AdminAuthProvider.");
  return context;
}

export function AdminRoot() {
  return (
    <AdminAuthProvider>
      <Outlet />
    </AdminAuthProvider>
  );
}

export function RequireAdminAuth() {
  const { status } = useAdminAuth();
  const location = useLocation();

  if (status === "checking") {
    return (
      <div className="admin-auth-loading" role="status">
        <span className="admin-spinner" />
        <p>Vérification de votre session…</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/admin/connexion" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export function AdminIndexRedirect() {
  const { profile } = useAdminAuth();
  return <Navigate to={canReadReservations(profile?.membership.role) ? "/admin/reservations" : "/admin/chambres"} replace />;
}

export function canReadReservations(role?: AdminRole) {
  return role === "ADMIN" || role === "RECEPTION" || role === "ACCOUNTING";
}

export function RequireReservationAccess({ children }: { children: ReactNode }) {
  const { profile } = useAdminAuth();
  if (!canReadReservations(profile?.membership.role)) {
    return <Navigate to="/admin/chambres" replace />;
  }
  return children;
}
