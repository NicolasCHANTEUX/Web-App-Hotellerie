import { Check, Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRoomType } from "../api/hotel";
import { Lightbox } from "../components/Lightbox";
import { NotFound } from "./NotFound";
import { ResponsiveImage } from "../components/ResponsiveImage";
import { useProperty } from "../context/PropertyContext";
import { useRemoteData } from "../hooks/useRemoteData";

export function AccommodationDetail() {
  const { slug } = useParams();
  const property = useProperty();
  const { data: accommodation, loading, error, errorStatus, retry } = useRemoteData((signal) => getRoomType(slug ?? "", signal), [slug]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (errorStatus !== 404) return;
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = robots?.content;
    const previousTitle = document.title;
    if (robots) robots.content = "noindex, nofollow";
    document.title = `Page introuvable | ${property.name}`;
    return () => {
      if (robots && previousRobots) robots.content = previousRobots;
      document.title = previousTitle;
    };
  }, [errorStatus, property.name]);

  if (loading) return <section className="page-api-state"><div className="api-state" role="status"><span className="loading-spinner" />Chargement de l'hébergement...</div></section>;
  if (errorStatus === 404) return <NotFound />;
  if (error || !accommodation) return <section className="page-api-state"><div className="api-state api-state-error" role="alert"><p>{error ?? "Hébergement introuvable."}</p><div><button type="button" className="btn-secondary" onClick={retry}>Réessayer</button><Link className="btn-primary" to="/hebergements">Voir les hébergements</Link></div></div></section>;

  return (
    <>
      <section className="detail-hero">
        <ResponsiveImage priority src={accommodation.hero} sizes="100vw" width={1600} height={900} alt={accommodation.name} />
        <div>
          <p className="eyebrow text-ivory/80">{accommodation.category}</p>
          <h1>{accommodation.name}</h1>
          <p>{accommodation.shortDescription}</p>
        </div>
      </section>

      <section className="section two-col">
        <div>
          <p className="eyebrow">À partir de {accommodation.originalPrice && <><del>{accommodation.originalPrice} EUR</del> </>}{accommodation.price} EUR TTC / nuit{accommodation.promotion ? ` · -${accommodation.promotion.discountPercent}% ${accommodation.promotion.label}` : ""}</p>
          <h2>{accommodation.rooms}</h2>
          <p className="mt-5 leading-8 text-brown-650">{accommodation.description}</p>
          <Link className="btn-primary mt-8" to={`/reservation?room=${accommodation.slug}`}>
            Réserver cet hébergement
          </Link>
        </div>
        <div className="details-grid">
          <p><strong>{accommodation.surface}</strong><span>Surface</span></p>
          <p><strong>{accommodation.capacity}</strong><span>Voyageurs</span></p>
          <p><strong>{accommodation.refundable ? "Flexible" : "Ferme"}</strong><span>Condition tarifaire</span></p>
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
              <ResponsiveImage src={image} sizes="(max-width: 900px) 100vw, 33vw" width={900} height={680} alt={`${accommodation.name} ${index + 1}`} />
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
