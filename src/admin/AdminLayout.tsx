import {
  BadgeEuro,
  BedDouble,
  Building2,
  CalendarClock,
  CalendarRange,
  ChevronRight,
  ConciergeBell,
  FileText,
  Hotel,
  Inbox,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { AdminRole } from "../api/admin";
import { canAnswerContactRequests, canManageCatalog, canReadReservations, canUsePlanning, canViewAccounting, useAdminAuth } from "./auth";
import { useOpenContactRequests } from "./openContactRequests";

const navigation = [
  { to: "/admin/tableau-de-bord", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/admin/reservations", label: "Réservations", icon: CalendarRange },
  { to: "/admin/comptabilite", label: "Comptabilité", icon: FileText },
  { to: "/admin/planning", label: "Planning", icon: CalendarClock },
  { to: "/admin/demandes", label: "Demandes", icon: Inbox },
  { to: "/admin/chambres", label: "Chambres", icon: BedDouble },
  { to: "/admin/tarifs", label: "Tarifs", icon: BadgeEuro },
  { to: "/admin/options", label: "Options", icon: ConciergeBell },
  { to: "/admin/taxe-de-sejour", label: "Taxe de séjour", icon: Landmark },
  { to: "/admin/etablissement", label: "Établissement", icon: Building2 },
  { to: "/admin/equipe", label: "Équipe", icon: Users },
];

const catalogPaths = new Set(["/admin/tarifs", "/admin/options", "/admin/taxe-de-sejour", "/admin/etablissement", "/admin/equipe"]);

const roleLabels: Record<AdminRole, string> = {
  ADMIN: "Administrateur",
  RECEPTION: "Réception",
  ACCOUNTING: "Comptabilité",
  HOUSEKEEPING: "Gouvernance",
};

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "HR";
}

export function AdminLayout() {
  const { profile, logout } = useAdminAuth();
  const propertyName = profile?.membership.property.name ?? "Établissement";
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openRequests = useOpenContactRequests(canAnswerContactRequests(profile?.membership.role));
  const openRequestsLabel = openRequests ? `${openRequests} demande${openRequests > 1 ? "s" : ""} à traiter` : null;
  const visibleNavigation = navigation.filter((item) => {
    if (item.to === "/admin/reservations" || item.to === "/admin/tableau-de-bord") return canReadReservations(profile?.membership.role);
    if (item.to === "/admin/comptabilite") return canViewAccounting(profile?.membership.role);
    if (item.to === "/admin/planning") return canUsePlanning(profile?.membership.role);
    if (item.to === "/admin/demandes") return canAnswerContactRequests(profile?.membership.role);
    if (catalogPaths.has(item.to)) return canManageCatalog(profile?.membership.role);
    return true;
  });

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  return (
    <div className="admin-shell">
      <button
        type="button"
        className={`admin-sidebar-backdrop ${mobileOpen ? "is-visible" : ""}`}
        aria-label="Fermer la navigation"
        onClick={() => setMobileOpen(false)}
      />

      <aside id="admin-navigation" className={`admin-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="admin-brand">
          <span className="admin-brand-mark"><Hotel /></span>
          <span><strong>{propertyName}</strong><small>Administration</small></span>
          <button ref={closeButtonRef} type="button" className="admin-sidebar-close" aria-label="Fermer le menu" onClick={() => { setMobileOpen(false); menuButtonRef.current?.focus(); }}><X /></button>
        </div>

        <nav className="admin-nav" aria-label="Navigation d’administration">
          <p>Gestion</p>
          {visibleNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => isActive ? "active" : ""}>
              <Icon />
              <span>
                {label}
                {to === "/admin/demandes" && openRequests ? <>
                  <span className="admin-nav-badge" aria-hidden="true">{openRequests > 99 ? "99+" : openRequests}</span>
                  <span className="sr-only">, {openRequestsLabel}</span>
                </> : null}
              </span>
              <ChevronRight className="admin-nav-chevron" />
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-account">
          <span className="admin-avatar">{initials(profile?.user.displayName ?? propertyName)}</span>
          <span><strong>{profile?.user.displayName}</strong><small>{profile ? roleLabels[profile.membership.role] : ""}</small></span>
          <button type="button" onClick={logout} title="Se déconnecter" aria-label="Se déconnecter"><LogOut /></button>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <button ref={menuButtonRef} type="button" className="admin-menu-toggle" aria-label={openRequestsLabel ? `Ouvrir le menu, ${openRequestsLabel}` : "Ouvrir le menu"} aria-controls="admin-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu />{openRequestsLabel && <span className="admin-menu-dot" aria-hidden="true" />}</button>
          <div>
            <span className="admin-topbar-property">{propertyName}</span>
            <span className="admin-topbar-separator" />
            <span className="admin-topbar-role">{profile ? roleLabels[profile.membership.role] : ""}</span>
          </div>
        </header>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
