import { MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { formatHotelTime, propertyAddress, propertyMapUrl, propertyPhoneHref, useProperty } from "../context/PropertyContext";

export function Footer() {
  const property = useProperty();
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div><p className="brand footer-brand"><span />{property.name}</p><p>Un havre de sérénité entre mer et collines, au cœur de la Côte d'Azur.</p><div className="socials"><a href={propertyMapUrl(property)} target="_blank" rel="noreferrer" aria-label="Localisation"><MapPin /></a>{property.phone && <a href={propertyPhoneHref(property.phone)} aria-label="Téléphone"><Phone /></a>}</div></div>
        <div><p className="footer-title">Contact</p><p>{propertyAddress(property)}</p>{property.phone && <p>{property.phone}</p>}<p>{property.email}</p><p>Arrivée : {formatHotelTime(property.checkInTime)} · Départ : {formatHotelTime(property.checkOutTime)}</p></div>
        <div><p className="footer-title">Navigation</p><Link to="/">Accueil</Link><Link to="/hebergements">Hébergements</Link><Link to="/contact">Contact</Link><Link to="/reservation">Réserver</Link></div>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} {property.name}. Tous droits réservés.</span><div><Link to="/mentions-legales#mentions">Mentions légales</Link><Link to="/mentions-legales#confidentialite">Confidentialité</Link><Link to="/mentions-legales#cgv">CGV</Link></div></div>
    </footer>
  );
}
