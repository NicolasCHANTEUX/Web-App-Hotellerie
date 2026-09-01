import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { propertyAddress, useOptionalProperty } from "../context/PropertyContext";
import { PublicProperty } from "../types/hotel";

type Metadata = {
  title: string;
  description: string;
  robots?: string;
};

function metadataFor(pathname: string, property: PublicProperty | null): Metadata {
  const propertyName = property?.name ?? "Établissement";
  const citySuffix = property?.city ? ` ${property.city}` : "";
  const cityPhrase = property?.city ? ` à ${property.city}` : "";
  if (pathname.startsWith("/admin")) {
    return {
      title: `Administration | ${propertyName}`,
      description: `Espace de gestion privé de ${propertyName}.`,
      robots: "noindex, nofollow",
    };
  }
  if (pathname === "/hebergements") {
    return {
      title: `Nos hébergements | ${propertyName}${citySuffix}`,
      description: `Découvrez les chambres et suites de ${propertyName}${cityPhrase}, leurs équipements et leurs tarifs.`,
    };
  }
  if (pathname.startsWith("/hebergements/")) {
    return {
      title: `Détail de l'hébergement | ${propertyName}${citySuffix}`,
      description: `Photos, équipements, capacité et tarif d'un hébergement de ${propertyName}${cityPhrase}.`,
    };
  }
  if (pathname === "/reservation") {
    return {
      title: `Réserver votre séjour | ${propertyName}${citySuffix}`,
      description: `Choisissez vos dates, votre hébergement et vos options pour préparer votre séjour${cityPhrase}.`,
      robots: "noindex, nofollow",
    };
  }
  if (pathname === "/confirmation") {
    return {
      title: `Suivi de réservation | ${propertyName}`,
      description: "Consultez l'état et le récapitulatif de votre demande de réservation.",
      robots: "noindex, nofollow",
    };
  }
  if (pathname === "/contact") {
    return {
      title: `Nous contacter | ${propertyName}${citySuffix}`,
      description: `Contactez l'équipe de ${propertyName} pour préparer votre arrivée ou poser une question sur votre séjour.`,
    };
  }
  if (pathname === "/mentions-legales") {
    return {
      title: `Mentions légales et confidentialité | ${propertyName}`,
      description: `Consultez les mentions légales et les informations relatives à la confidentialité du site ${propertyName}.`,
    };
  }
  return {
    title: `${propertyName} | Séjour${cityPhrase}`,
    description: `${propertyName}${cityPhrase} : découvrez les hébergements, services et disponibilités de l'établissement.`,
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
  const property = useOptionalProperty();

  useEffect(() => {
    const metadata = metadataFor(pathname, property);
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
    if (!property) {
      structuredData?.remove();
      return;
    }
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
