import { Instagram, MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div><p className="brand footer-brand"><span />Hôtel Rivage</p><p>Un havre de sérénité entre mer et collines, au cœur de la Côte d'Azur.</p><div className="socials"><a href="#" aria-label="Instagram"><Instagram /></a><a href="#" aria-label="Localisation"><MapPin /></a><a href="tel:+33493000000" aria-label="Téléphone"><Phone /></a></div></div>
        <div><p className="footer-title">Contact</p><p>26 avenue des Pins, 06400 Cannes</p><p>+33 4 93 00 00 00</p><p>contact@hotel-rivage.fr</p><p>Arrivée : 15h00 · Départ : 11h00</p></div>
        <div><p className="footer-title">Navigation</p><Link to="/">Accueil</Link><Link to="/hebergements">Hébergements</Link><Link to="/contact">Contact</Link><Link to="/reservation">Réserver</Link></div>
      </div>
      <div className="footer-bottom"><span>© 2026 Hôtel Rivage. Tous droits réservés.</span><div><Link to="/mentions-legales#mentions">Mentions légales</Link><Link to="/mentions-legales#confidentialite">Confidentialité</Link><Link to="/mentions-legales#cgv">CGV</Link></div></div>
    </footer>
  );
}
