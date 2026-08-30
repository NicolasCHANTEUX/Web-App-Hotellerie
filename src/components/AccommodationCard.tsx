import { Link } from "react-router-dom";
import { Accommodation } from "../types/hotel";
import { ResponsiveImage } from "./ResponsiveImage";

export function AccommodationCard({ accommodation }: { accommodation: Accommodation }) {
  return (
    <article className="room-card">
      <Link to={`/hebergements/${accommodation.slug}`} className="room-image">
        <ResponsiveImage src={accommodation.hero} sizes="(max-width: 760px) 100vw, 50vw" width={800} height={500} alt={accommodation.name} />
        <span>{accommodation.surface}</span>
        {accommodation.promotion && <em className="room-promotion-badge">-{accommodation.promotion.discountPercent}% · {accommodation.promotion.label}</em>}
      </Link>
      <div className="room-content">
        <div>
          <p className="room-category">{accommodation.category}</p>
          <h3>{accommodation.name}</h3>
          <p className="room-meta">{accommodation.capacity} voyageurs <span>•</span> {accommodation.rooms}</p>
        </div>
        <p className="room-description">{accommodation.shortDescription}</p>
        <div className="room-tags">{accommodation.amenities.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div>
        <div className="room-bottom">
          <p><span>À partir de · TTC</span>{accommodation.originalPrice && <del>{accommodation.originalPrice} €</del>}<strong>{accommodation.price} €</strong><small>/ nuit</small></p>
          <Link className="room-cta" to={`/hebergements/${accommodation.slug}`}>Découvrir</Link>
        </div>
      </div>
    </article>
  );
}
