import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import {
  AdminApiError,
  AdminLoginResult,
  AdminMe,
  AdminRole,
  getAdminMe,
  loginAdmin,
  refreshAdminSession,
  revokeAdminSession,
  setAdminSessionRenewal,
} from "../api/admin";
import { RouteMetadata } from "../components/RouteMetadata";
import { legacyStorageKeys, storageKeys } from "../storageKeys";
import "../styles/admin.css";

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

type AdminAuthContextValue = {
  status: AuthStatus;
  /** Token obtained at sign-in; requests transparently use its latest renewal. */
  accessToken: string | null;
  profile: AdminMe | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
};

type StoredSession = {
  accessToken: string;
  refreshToken: string | null;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function clearStoredSession() {
  sessionStorage.removeItem(storageKeys.adminAccessToken);
  sessionStorage.removeItem(storageKeys.adminRefreshToken);
  sessionStorage.removeItem(storageKeys.adminExpiresAt);
  sessionStorage.removeItem(legacyStorageKeys.adminAccessToken);
  sessionStorage.removeItem(legacyStorageKeys.adminExpiresAt);
}

function storeSession(session: AdminLoginResult): StoredSession {
  sessionStorage.setItem(storageKeys.adminAccessToken, session.accessToken);
  sessionStorage.setItem(storageKeys.adminRefreshToken, session.refreshToken);
  sessionStorage.setItem(storageKeys.adminExpiresAt, String(Date.now() + session.expiresIn * 1000));
  return { accessToken: session.accessToken, refreshToken: session.refreshToken };
}

function readStoredSession(): StoredSession | null {
  const token = sessionStorage.getItem(storageKeys.adminAccessToken)
    ?? sessionStorage.getItem(legacyStorageKeys.adminAccessToken);
  const refreshToken = sessionStorage.getItem(storageKeys.adminRefreshToken);
  const storedExpiry = sessionStorage.getItem(storageKeys.adminExpiresAt)
    ?? sessionStorage.getItem(legacyStorageKeys.adminExpiresAt);
  const expiresAt = Number(storedExpiry);
  if (!token) return null;
  // An expired access token is still usable while a refresh token can renew it.
  if (!refreshToken && Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
    clearStoredSession();
    return null;
  }
  sessionStorage.setItem(storageKeys.adminAccessToken, token);
  if (storedExpiry) sessionStorage.setItem(storageKeys.adminExpiresAt, storedExpiry);
  sessionStorage.removeItem(legacyStorageKeys.adminAccessToken);
  sessionStorage.removeItem(legacyStorageKeys.adminExpiresAt);
  return { accessToken: token, refreshToken };
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<AdminMe | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  const renewalRef = useRef<Promise<string | null> | null>(null);

  const endSession = useCallback(() => {
    sessionRef.current = null;
    clearStoredSession();
    setAccessToken(null);
    setProfile(null);
    setStatus("unauthenticated");
  }, []);

  const logout = useCallback(() => {
    const session = sessionRef.current;
    endSession();
    if (session) void revokeAdminSession(session.accessToken, session.refreshToken);
  }, [endSession]);

  // Registered before the session is restored so that its first request can
  // already renew an expired access token.
  useEffect(() => {
    setAdminSessionRenewal({
      currentAccessToken: () => sessionRef.current?.accessToken ?? null,
      renew: (expiredAccessToken) => {
        const session = sessionRef.current;
        if (!session) return Promise.resolve(null);
        // Another request already renewed the token this one was sent with.
        if (session.accessToken !== expiredAccessToken) return Promise.resolve(session.accessToken);
        if (!session.refreshToken) return Promise.resolve(null);
        renewalRef.current ??= refreshAdminSession(session.refreshToken)
          .then((renewed) => {
            sessionRef.current = storeSession(renewed);
            return renewed.accessToken;
          })
          .catch((error: unknown) => {
            if (error instanceof AdminApiError && error.status < 500) endSession();
            return null;
          })
          .finally(() => {
            renewalRef.current = null;
          });
        return renewalRef.current;
      },
    });
    return () => setAdminSessionRenewal(null);
  }, [endSession]);

  useEffect(() => {
    const controller = new AbortController();
    const session = readStoredSession();
    if (!session) {
      setStatus("unauthenticated");
      return () => controller.abort();
    }

    sessionRef.current = session;
    setAccessToken(session.accessToken);
    getAdminMe(session.accessToken, controller.signal)
      .then((nextProfile) => {
        setProfile(nextProfile);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!controller.signal.aborted) endSession();
      });

    return () => controller.abort();
  }, [endSession]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await loginAdmin(email, password);
    sessionRef.current = storeSession(session);
    try {
      const nextProfile = await getAdminMe(session.accessToken);
      setAccessToken(session.accessToken);
      setProfile(nextProfile);
      setStatus("authenticated");
    } catch (error) {
      sessionRef.current = null;
      clearStoredSession();
      throw error;
    }
  }, []);

  // Reloads the property shown in the layout after its settings changed.
  const refreshProfile = useCallback(async () => {
    const session = sessionRef.current;
    if (session) setProfile(await getAdminMe(session.accessToken));
  }, []);

  const value = useMemo<AdminAuthContextValue>(() => ({
    status,
    accessToken,
    profile,
    login,
    logout,
    refreshProfile,
  }), [status, accessToken, profile, login, logout, refreshProfile]);

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

export function canManageCatalog(role?: AdminRole) {
  return role === "ADMIN";
}

export function RequireCatalogAccess({ children }: { children: ReactNode }) {
  const { profile } = useAdminAuth();
  if (!canManageCatalog(profile?.membership.role)) return <AdminIndexRedirect />;
  return children;
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
