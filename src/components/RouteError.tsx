import { Home, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

function isNotFound(error: unknown) {
  return isRouteErrorResponse(error) && error.status === 404;
}

function useErrorMetadata(notFound: boolean) {
  useEffect(() => {
    document.title = notFound ? "Page introuvable" : "Erreur inattendue";
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = "noindex, nofollow";
  }, [notFound]);
}

export function PublicRouteError() {
  const error = useRouteError();
  const notFound = isNotFound(error);
  useErrorMetadata(notFound);

  return (
    <main className="not-found-page" role="alert">
      <div>
        <p className="eyebrow">{notFound ? "Erreur 404" : "Un imprévu est survenu"}</p>
        <h1>{notFound ? "Page introuvable" : "La page n’a pas pu être affichée."}</h1>
        <p>{notFound
          ? "La page que vous recherchez n’existe plus ou a été déplacée."
          : "Veuillez réessayer. Si le problème persiste, revenez à l’accueil."}</p>
        <div className="not-found-actions">
          {!notFound && <button className="btn-primary" type="button" onClick={() => window.location.reload()}><RefreshCw />Réessayer</button>}
          <a className="btn-secondary" href="/"><Home />Retour à l’accueil</a>
        </div>
      </div>
    </main>
  );
}

export function AdminRouteError() {
  const error = useRouteError();
  const notFound = isNotFound(error);
  useErrorMetadata(notFound);

  return (
    <main className="admin-route-error" role="alert">
      <div>
        <span className="admin-route-error-icon"><ShieldAlert /></span>
        <p className="admin-login-kicker">{notFound ? "Erreur 404" : "Administration indisponible"}</p>
        <h1>{notFound ? "Page d’administration introuvable" : "Une erreur inattendue est survenue."}</h1>
        <p>{notFound
          ? "Cette adresse ne correspond à aucun écran de l’administration."
          : "Rechargez la page. Si le problème persiste, revenez à l’accueil de l’administration."}</p>
        <div>
          {!notFound && <button type="button" onClick={() => window.location.reload()}><RefreshCw />Réessayer</button>}
          <a href="/admin">Retour à l’administration</a>
          <a href="/">Site public</a>
        </div>
      </div>
    </main>
  );
}
