import { ArrowLeft, BedDouble } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <section className="not-found-page">
      <div>
        <p className="eyebrow">Erreur 404</p>
        <h1>Page introuvable</h1>
        <p>La page que vous recherchez n’existe plus ou a été déplacée.</p>
        <div className="not-found-actions">
          <Link className="btn-primary" to="/"><ArrowLeft />Retour à l’accueil</Link>
          <Link className="btn-secondary" to="/hebergements"><BedDouble />Voir les hébergements</Link>
        </div>
      </div>
    </section>
  );
}
