import { Check, Maximize2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRoomType } from "../api/hotel";
import { Lightbox } from "../components/Lightbox";
import { useRemoteData } from "../hooks/useRemoteData";

export function AccommodationDetail() {
  const { slug } = useParams();
  const { data: accommodation, loading, error, retry } = useRemoteData((signal) => getRoomType(slug ?? "", signal), [slug]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (loading) return <section className="page-api-state"><div className="api-state" role="status"><span className="loading-spinner" />Chargement de l'hébergement...</div></section>;
  if (error || !accommodation) return <section className="page-api-state"><div className="api-state api-state-error" role="alert"><p>{error ?? "Hébergement introuvable."}</p><div><button type="button" className="btn-secondary" onClick={retry}>Réessayer</button><Link className="btn-primary" to="/hebergements">Voir les hébergements</Link></div></div></section>;

  return (
    <>
      <section className="detail-hero">
        <img src={accommodation.hero} alt={accommodation.name} />
        <div>
          <p className="eyebrow text-ivory/80">{accommodation.category}</p>
          <h1>{accommodation.name}</h1>
          <p>{accommodation.shortDescription}</p>
        </div>
      </section>

      <section className="section two-col">
        <div>
          <p className="eyebrow">A partir de {accommodation.price} EUR / nuit</p>
          <h2>{accommodation.rooms}</h2>
          <p className="mt-5 leading-8 text-brown-650">{accommodation.description}</p>
          <Link className="btn-primary mt-8" to={`/reservation?room=${accommodation.slug}`}>
            Reserver cet hebergement
          </Link>
        </div>
        <div className="details-grid">
          <p><strong>{accommodation.surface}</strong><span>Surface</span></p>
          <p><strong>{accommodation.capacity}</strong><span>Voyageurs</span></p>
          <p><strong>Inclus</strong><span>Petit-dejeuner</span></p>
        </div>
      </section>

      <section className="section bg-sand">
        <div className="section-heading">
          <p className="eyebrow">Galerie</p>
          <h2>Voir les volumes.</h2>
        </div>
        <div className="gallery-grid">
          {accommodation.gallery.map((image, index) => (
            <button key={image} type="button" onClick={() => setLightboxIndex(index)}>
              <img src={image} alt={`${accommodation.name} ${index + 1}`} />
              <span><Maximize2 size={18} /> Agrandir</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="amenities">
          {accommodation.amenities.map((amenity) => (
            <p key={amenity}><Check size={18} /> {amenity}</p>
          ))}
        </div>
      </section>

      <Lightbox
        images={accommodation.gallery}
        index={lightboxIndex}
        alt={accommodation.name}
        onClose={() => setLightboxIndex(null)}
        onChange={setLightboxIndex}
      />
    </>
  );
}
