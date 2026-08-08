import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

const links = [
  { to: "/", label: "Accueil" },
  { to: "/hebergements", label: "Hébergements" },
  { to: "/contact", label: "Contact" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const overlay = pathname === "/" && !scrolled;

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 36);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className={`site-header ${overlay ? "site-header-overlay" : "site-header-solid"} ${pathname !== "/" ? "site-header-page" : ""}`}>
      <div className="header-inner">
        <NavLink to="/" className="brand"><span />Hôtel Rivage</NavLink>
        <nav className="desktop-nav">{links.map((link) => <NavLink key={link.to} to={link.to} className={({ isActive }) => isActive ? "active" : ""}>{link.label}</NavLink>)}</nav>
        <NavLink className="header-book" to="/reservation">Réserver</NavLink>
        <button className="menu-toggle" type="button" aria-label={open ? "Fermer le menu" : "Ouvrir le menu"} onClick={() => setOpen((value) => !value)}>{open ? <X /> : <Menu />}</button>
      </div>
      {open && <nav className="mobile-nav">{links.map((link) => <NavLink key={link.to} to={link.to}>{link.label}</NavLink>)}<NavLink to="/reservation">Réserver</NavLink></nav>}
    </header>
  );
}
