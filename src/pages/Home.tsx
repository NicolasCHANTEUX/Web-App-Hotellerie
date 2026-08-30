import {
  Accessibility,
  Car,
  Coffee,
  Flower2,
  MapPin,
  Snowflake,
  UtensilsCrossed,
  Waves,
  Wifi,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getRoomTypes } from "../api/hotel";
import { Lightbox } from "../components/Lightbox";
import { SearchWidget } from "../components/SearchWidget";
import { StayCta } from "../components/StayCta";
import { useRemoteData } from "../hooks/useRemoteData";

const heroImage = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1800&q=88";

const hotelImages = [
  "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1200&q=88",
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=88",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=88",
];

const services = [
  { icon: Coffee, title: "Petit-déjeuner", text: "Buffet maison chaque matin" },
  { icon: Car, title: "Parking privé", text: "Accès sécurisé sur réservation" },
  { icon: Wifi, title: "Wi-Fi gratuit", text: "Très haut débit dans tout l'hôtel" },
  { icon: Snowflake, title: "Climatisation", text: "Confort réglable dans chaque chambre" },
  { icon: UtensilsCrossed, title: "Collations sur demande", text: "Une sélection disponible auprès de la réception" },
  { icon: Accessibility, title: "Accessibilité", text: "Chambres et accès adaptés" },
  { icon: Waves, title: "Piscine", text: "Ouverte de juin à septembre" },
  { icon: Flower2, title: "Jardin", text: "Espaces végétalisés et calmes" },
];

const guestHighlights = [
  { text: "Des chambres pensées pour le repos, avec une literie premium et des matières naturelles.", title: "Le confort avant tout", label: "Dans chaque chambre" },
  { text: "Une équipe disponible pour anticiper les arrivées et personnaliser les attentions du séjour.", title: "Un accueil attentionné", label: "Avant et pendant le séjour" },
  { text: "La mer, le centre historique et les adresses de Cannes restent accessibles en quelques minutes.", title: "Cannes à portée de pas", label: "Une situation centrale" },
];

const nearby = [
  ["La Croisette", "4 min à pied"],
  ["Centre historique", "8 min à pied"],
  ["Marché Forville", "10 min à pied"],
  ["Gare de Cannes", "7 min à pied"],
  ["Vieux-Port", "6 min à pied"],
];

const faqs = [
  ["Quels sont les horaires d'arrivée et de départ ?", "L'arrivée est possible à partir de 15h et le départ jusqu'à 11h."],
  ["Le petit-déjeuner est-il inclus ?", "Il est inclus avec certaines offres et peut être ajouté à toute réservation."],
  ["Disposez-vous d'un parking ?", "Oui, notre parking privé est accessible sur réservation et selon disponibilité."],
  ["Les animaux de compagnie sont-ils acceptés ?", "Les petits animaux sont acceptés sur demande avant votre arrivée."],
  ["Puis-je annuler ou modifier ma réservation ?", "Les conditions dépendent du tarif sélectionné et sont précisées pendant la réservation."],
  ["L'établissement est-il accessible aux personnes à mobilité réduite ?", "Oui, des chambres et les espaces communs sont adaptés."],
];

export function Home() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { data: roomTypes } = useRemoteData((signal) => getRoomTypes(signal), []);
  const catalogImages = roomTypes
    ? [...new Set(roomTypes.map((roomType) => roomType.hero).filter(Boolean))].slice(0, 3)
    : [];
  const stayImages = catalogImages.length ? catalogImages : hotelImages;
  const roomTypeCount = roomTypes?.length;

  return (
    <>
      <section className="rivage-hero">
        <img src={heroImage} alt="Hôtel Rivage et sa piscine au crépuscule" />
        <div className="rivage-hero-content">
          <p className="eyebrow light">Cannes, Côte d'Azur</p>
          <h1>Une parenthèse de<br />calme au cœur de la<br />Côte d'Azur</h1>
          <p className="hero-description">Des chambres récentes et une atmosphère intimiste, à quelques pas de la mer et des adresses incontournables.</p>
          <div className="hero-actions">
            <Link className="btn-primary" to="/reservation">Réserver mon séjour</Link>
            <Link className="btn-glass" to="/contact">Nous contacter</Link>
          </div>
        </div>
      </section>

      <div className="home-search-wrap"><SearchWidget /></div>

      <section className="home-band intro-band">
        <div className="home-container intro-grid">
          <div className="intro-copy">
            <p className="eyebrow">L'établissement</p>
            <h2>Un hôtel pensé pour votre bien-être</h2>
            <p>Niché entre mer et collines, l'Hôtel Rivage vous offre un havre de sérénité à deux pas du centre historique. Chaque chambre a été pensée pour votre confort, avec un soin particulier apporté aux matières et à la lumière.</p>
            <div className="intro-features">
              <span><Waves /> 18 chambres</span><span><Car /> Parking privé</span>
              <span><Snowflake /> Climatisation</span><span><Wifi /> Wi-Fi gratuit</span>
              <span><Coffee /> Petit-déjeuner maison</span><span><MapPin /> Centre-ville proche</span>
            </div>
          </div>
          <div className="intro-visual"><img src={heroImage} alt="Piscine de l'Hôtel Rivage bordée de palmiers" /></div>
        </div>
      </section>

      <section className="home-band stays-band">
        <div className="home-container stays-grid">
          <div className="stays-copy">
            <p className="eyebrow">Hébergements</p>
            <h2>Des chambres tournées vers la lumière</h2>
            <p>{roomTypeCount ? `${roomTypeCount} atmosphère${roomTypeCount > 1 ? "s" : ""}, une même attention portée au calme, aux matières naturelles et à la douceur méditerranéenne.` : "Des atmosphères singulières, une même attention portée au calme, aux matières naturelles et à la douceur méditerranéenne."}</p>
            <Link className="text-link" to="/hebergements">Découvrir nos hébergements <span>→</span></Link>
          </div>
          <div className="stays-gallery">
            {stayImages.map((image, index) => <button type="button" key={image} onClick={() => setLightboxIndex(index)} aria-label={`Agrandir la photo ${index + 1}`}><img src={image} alt={`Aperçu des hébergements de l'Hôtel Rivage ${index + 1}`} /></button>)}
          </div>
        </div>
      </section>

      <section className="home-band services-band">
        <div className="home-container">
          <div className="center-heading"><p className="eyebrow">Services</p><h2>Ce que nous proposons</h2></div>
          <div className="services-grid">{services.map(({ icon: Icon, title, text }) => <div className="service-item" key={title}><Icon /><strong>{title}</strong><span>{text}</span></div>)}</div>
        </div>
      </section>

      <section className="home-band testimonials-band">
        <div className="home-container">
          <div className="center-heading"><p className="eyebrow">L'expérience Rivage</p><h2>Les attentions qui font la différence</h2></div>
          <div className="testimonials-grid">{guestHighlights.map((item) => <article className="testimonial" key={item.title}><p>{item.text}</p><footer><strong>{item.title}</strong><span>{item.label}</span></footer></article>)}</div>
        </div>
      </section>

      <section className="home-band location-band">
        <div className="home-container location-grid">
          <div><p className="eyebrow">Localisation</p><h2>Tout à portée de pas</h2><div className="nearby-list">{nearby.map(([name, time]) => <div key={name}><MapPin /><p><strong>{name}</strong><span>{time}</span></p></div>)}</div></div>
          <div className="location-visual"><img src="https://pierretravel.rs/media/sys/place/image/letovanje_francuska_azurna-obala_kan.jpg" alt="Plage et hôtels de la Croisette à Cannes" /><div><MapPin /><p><strong>Hôtel Rivage</strong><span>26 avenue des Pins, 06400 Cannes</span></p><a href="https://maps.google.com" target="_blank" rel="noreferrer">Voir l'itinéraire →</a></div></div>
        </div>
      </section>

      <section className="home-band faq-band">
        <div className="home-container faq-container">
          <div className="center-heading"><p className="eyebrow">Foire aux questions</p><h2>Questions fréquentes</h2></div>
          <div className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div>
        </div>
      </section>

      <StayCta />

      <Lightbox images={stayImages} index={lightboxIndex} alt="Hôtel Rivage" onClose={() => setLightboxIndex(null)} onChange={setLightboxIndex} />
    </>
  );
}
