import { useEffect } from "react";
import { useLocation } from "react-router-dom";

type Metadata = {
  title: string;
  description: string;
  robots?: string;
};

function metadataFor(pathname: string): Metadata {
  if (pathname.startsWith("/admin")) {
    return {
      title: "Administration | Hôtel Rivage",
      description: "Espace de gestion privé de l'Hôtel Rivage.",
      robots: "noindex, nofollow",
    };
  }
  if (pathname === "/hebergements") {
    return {
      title: "Nos hébergements | Hôtel Rivage Cannes",
      description: "Découvrez les chambres et suites de l'Hôtel Rivage à Cannes, leurs équipements et leurs tarifs.",
    };
  }
  if (pathname.startsWith("/hebergements/")) {
    return {
      title: "Détail de l'hébergement | Hôtel Rivage Cannes",
      description: "Photos, équipements, capacité et tarif d'un hébergement de l'Hôtel Rivage à Cannes.",
    };
  }
  if (pathname === "/reservation") {
    return {
      title: "Réserver votre séjour | Hôtel Rivage Cannes",
      description: "Choisissez vos dates, votre hébergement et vos options pour préparer votre séjour à Cannes.",
      robots: "noindex, nofollow",
    };
  }
  if (pathname === "/confirmation") {
    return {
      title: "Suivi de réservation | Hôtel Rivage",
      description: "Consultez l'état et le récapitulatif de votre demande de réservation.",
      robots: "noindex, nofollow",
    };
  }
  if (pathname === "/contact") {
    return {
      title: "Nous contacter | Hôtel Rivage Cannes",
      description: "Contactez l'équipe de l'Hôtel Rivage pour préparer votre arrivée ou poser une question sur votre séjour.",
    };
  }
  if (pathname === "/mentions-legales") {
    return {
      title: "Mentions légales et confidentialité | Hôtel Rivage",
      description: "Consultez les mentions légales et les informations relatives à la confidentialité du site Hôtel Rivage.",
    };
  }
  return {
    title: "Hôtel Rivage | Séjour à Cannes",
    description: "Hôtel Rivage à Cannes : chambres lumineuses, piscine et séjour au calme à quelques pas de la mer et du centre historique.",
  };
}

function setMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

export function RouteMetadata() {
  const { pathname } = useLocation();

  useEffect(() => {
    const metadata = metadataFor(pathname);
    document.title = metadata.title;
    setMeta('meta[name="description"]', "name", "description", metadata.description);
    setMeta('meta[name="robots"]', "name", "robots", metadata.robots ?? "index, follow");
    setMeta('meta[property="og:title"]', "property", "og:title", metadata.title);
    setMeta('meta[property="og:description"]', "property", "og:description", metadata.description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = `${window.location.origin}${pathname}`;
  }, [pathname]);

  return null;
}
