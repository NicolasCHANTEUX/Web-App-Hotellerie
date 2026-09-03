import { useState } from "react";
import { getRoomTypes } from "../api/hotel";
import { AccommodationCard } from "../components/AccommodationCard";
import { Lightbox } from "../components/Lightbox";
import { ResponsiveImage } from "../components/ResponsiveImage";
import { SearchWidget } from "../components/SearchWidget";
import { useProperty } from "../context/PropertyContext";
import { useRemoteData } from "../hooks/useRemoteData";

const hotelGallery = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1400&q=86",
  "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1200&q=86",
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=86",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=86",
  "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=86",
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=86",
];

export function Accommodations() {
  const property = useProperty();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { data: accommodations, loading, error, retry } = useRemoteData((signal) => getRoomTypes(signal), []);
  const count = accommodations?.length ?? 0;
  const countLabel = `${count} hébergement${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""}`;
  const catalogGallery = accommodations
    ? [...new Set(accommodations.flatMap((accommodation) => accommodation.gallery).filter(Boolean))].slice(0, 6)
    : [];
  const displayedGallery = catalogGallery.length ? catalogGallery : hotelGallery;

  return (
    <>
      <section className="accommodations-hero">
        <div className="page-container">
          <p className="eyebrow light">Votre séjour à {property.name}</p>
          <h1>Nos hébergements</h1>
          <p>Des chambres élégantes et lumineuses, pensées comme des refuges au cœur de {property.city}.</p>
        </div>
      </section>

      <section className="accommodations-search">
        <div className="page-container search-stage">
          <p>Vérifiez les disponibilités pour vos dates</p>
          <SearchWidget demoDates />
        </div>
      </section>

      <section className="catalog-band">
        <div className="page-container">
          <div className="catalog-intro">
            <p className="eyebrow">La collection</p>
            <h2>Choisissez votre chambre</h2>
            <p>Chacun de nos hébergements a été conçu avec soin pour allier confort, élégance et caractère. Découvrez celui qui accompagnera le mieux votre séjour à {property.city}.</p>
          </div>
          {!loading && !error && <p className="results-count">{countLabel}</p>}
          {loading && <div className="api-state" role="status"><span className="loading-spinner" />Chargement des hébergements...</div>}
          {error && <div className="api-state api-state-error" role="alert"><p>{error}</p><button type="button" className="btn-secondary" onClick={retry}>Réessayer</button></div>}
          {!loading && !error && accommodations && accommodations.length === 0 && <div className="api-state"><p>Aucun hébergement n'est publié pour le moment.</p></div>}
          {accommodations && accommodations.length > 0 && <div className="room-catalog-grid">
            {accommodations.map((item) => <AccommodationCard key={item.id} accommodation={item} />)}
          </div>}
        </div>
      </section>

      <section className="accommodations-gallery-band">
        <div className="page-container">
          <div className="center-heading"><p className="eyebrow">Photos</p><h2>Galerie de l'hôtel</h2></div>
          <div className="accommodations-gallery">
            {displayedGallery.map((image, index) => <button type="button" key={image} onClick={() => setLightboxIndex(index)} aria-label={`Agrandir la photo ${index + 1}`}><ResponsiveImage src={image} sizes="(max-width: 640px) 50vw, 33vw" width={720} height={520} alt={`Hébergement de ${property.name} ${index + 1}`} /></button>)}
          </div>
        </div>
      </section>

      <Lightbox images={displayedGallery} index={lightboxIndex} alt={property.name} onClose={() => setLightboxIndex(null)} onChange={setLightboxIndex} />
    </>
  );
}
