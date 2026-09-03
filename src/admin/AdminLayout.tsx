import {
  BedDouble,
  CalendarClock,
  CalendarRange,
  ChevronRight,
  Hotel,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { AdminRole } from "../api/admin";
import { canReadReservations, canUsePlanning, useAdminAuth } from "./auth";

const navigation = [
  { to: "/admin/reservations", label: "Réservations", icon: CalendarRange },
  { to: "/admin/planning", label: "Planning", icon: CalendarClock },
  { to: "/admin/chambres", label: "Chambres", icon: BedDouble },
];

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
  const visibleNavigation = navigation.filter((item) => {
    if (item.to === "/admin/reservations") return canReadReservations(profile?.membership.role);
    if (item.to === "/admin/planning") return canUsePlanning(profile?.membership.role);
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
              <span>{label}</span>
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
          <button ref={menuButtonRef} type="button" className="admin-menu-toggle" aria-label="Ouvrir le menu" aria-controls="admin-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu /></button>
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
