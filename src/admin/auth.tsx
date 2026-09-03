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
import { RouteMetadata } from "../components/RouteMetadata";
import { legacyStorageKeys, storageKeys } from "../storageKeys";
import "../styles/admin.css";

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
  sessionStorage.removeItem(storageKeys.adminAccessToken);
  sessionStorage.removeItem(storageKeys.adminExpiresAt);
  sessionStorage.removeItem(legacyStorageKeys.adminAccessToken);
  sessionStorage.removeItem(legacyStorageKeys.adminExpiresAt);
}

function readStoredAccessToken() {
  const token = sessionStorage.getItem(storageKeys.adminAccessToken)
    ?? sessionStorage.getItem(legacyStorageKeys.adminAccessToken);
  const storedExpiry = sessionStorage.getItem(storageKeys.adminExpiresAt)
    ?? sessionStorage.getItem(legacyStorageKeys.adminExpiresAt);
  const expiresAt = Number(storedExpiry);
  if (!token) return null;
  if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
    clearStoredSession();
    return null;
  }
  sessionStorage.setItem(storageKeys.adminAccessToken, token);
  if (storedExpiry) sessionStorage.setItem(storageKeys.adminExpiresAt, storedExpiry);
  sessionStorage.removeItem(legacyStorageKeys.adminAccessToken);
  sessionStorage.removeItem(legacyStorageKeys.adminExpiresAt);
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
    sessionStorage.setItem(storageKeys.adminAccessToken, session.accessToken);
    sessionStorage.setItem(storageKeys.adminExpiresAt, String(Date.now() + session.expiresIn * 1000));
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
      <RouteMetadata />
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

export function canUsePlanning(role?: AdminRole) {
  return role === "ADMIN" || role === "RECEPTION" || role === "HOUSEKEEPING";
}

export function RequireReservationAccess({ children }: { children: ReactNode }) {
  const { profile } = useAdminAuth();
  if (!canReadReservations(profile?.membership.role)) {
    return <Navigate to="/admin/chambres" replace />;
  }
  return children;
}

export function RequirePlanningAccess({ children }: { children: ReactNode }) {
  const { profile } = useAdminAuth();
  if (!canUsePlanning(profile?.membership.role)) {
    return <Navigate to="/admin/reservations" replace />;
  }
  return children;
}
