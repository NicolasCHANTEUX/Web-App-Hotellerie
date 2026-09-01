import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { propertyAddress, useProperty } from "../context/PropertyContext";

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
  const property = useProperty();

  useEffect(() => {
    const metadata = metadataFor(pathname);
    const configuredOrigin = import.meta.env.VITE_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const origin = configuredOrigin || window.location.origin;
    const socialImage = `${origin}/images/hotel/hero-1280.webp`;
    document.title = metadata.title;
    setMeta('meta[name="description"]', "name", "description", metadata.description);
    setMeta('meta[name="robots"]', "name", "robots", metadata.robots ?? "index, follow");
    setMeta('meta[property="og:title"]', "property", "og:title", metadata.title);
    setMeta('meta[property="og:description"]', "property", "og:description", metadata.description);
    setMeta('meta[property="og:image"]', "property", "og:image", socialImage);
    setMeta('meta[property="og:url"]', "property", "og:url", `${origin}${pathname}`);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", socialImage);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = `${origin}${pathname}`;

    let structuredData = document.head.querySelector<HTMLScriptElement>("#hotel-structured-data");
    if (!structuredData) {
      structuredData = document.createElement("script");
      structuredData.id = "hotel-structured-data";
      structuredData.type = "application/ld+json";
      document.head.append(structuredData);
    }
    structuredData.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Hotel",
      name: property.name,
      url: origin,
      image: socialImage,
      email: property.email,
      telephone: property.phone ?? undefined,
      address: {
        "@type": "PostalAddress",
        streetAddress: [property.addressLine1, property.addressLine2].filter(Boolean).join(", "),
        postalCode: property.postalCode,
        addressLocality: property.city,
        addressCountry: property.countryCode,
      },
      checkinTime: property.checkInTime,
      checkoutTime: property.checkOutTime,
      description: metadata.description,
      hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${property.name}, ${propertyAddress(property)}`)}`,
    });
  }, [pathname, property]);

  return null;
}
