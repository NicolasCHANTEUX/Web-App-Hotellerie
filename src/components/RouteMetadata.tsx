import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getRoomType } from "../api/hotel";
import { propertyAddress, useOptionalProperty } from "../context/PropertyContext";
import { Accommodation, PublicProperty } from "../types/hotel";

type Metadata = {
  title: string;
  description: string;
  robots?: string;
};

function metadataFor(pathname: string, property: PublicProperty | null, accommodation: Accommodation | null): Metadata {
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
      title: accommodation
        ? `${accommodation.name} | ${propertyName}${citySuffix}`
        : `Détail de l'hébergement | ${propertyName}${citySuffix}`,
      description: accommodation?.shortDescription
        ?? `Photos, équipements, capacité et tarif d'un hébergement de ${propertyName}${cityPhrase}.`,
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
  if (pathname === "/") {
    return {
      title: `${propertyName} | Séjour${cityPhrase}`,
      description: `${propertyName}${cityPhrase} : découvrez les hébergements, services et disponibilités de l'établissement.`,
    };
  }
  return {
    title: `Page introuvable | ${propertyName}`,
    description: "La page demandée n’existe plus ou a été déplacée.",
    robots: "noindex, nofollow",
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

function accommodationSlugFor(pathname: string) {
  const match = pathname.match(/^\/hebergements\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function absoluteUrl(value: string, origin: string) {
  try {
    return new URL(value, `${origin}/`).href;
  } catch {
    return `${origin}/images/hotel/hero-1280.webp`;
  }
}

export function RouteMetadata() {
  const { pathname } = useLocation();
  const property = useOptionalProperty();
  const detailSlug = accommodationSlugFor(pathname);
  const [accommodation, setAccommodation] = useState<Accommodation | null>(null);

  useEffect(() => {
    setAccommodation(null);
    if (!detailSlug) return undefined;
    const controller = new AbortController();
    getRoomType(detailSlug, controller.signal)
      .then(setAccommodation)
      .catch(() => undefined);
    return () => controller.abort();
  }, [detailSlug]);

  useEffect(() => {
    const matchingAccommodation = accommodation?.slug === detailSlug ? accommodation : null;
    const metadata = metadataFor(pathname, property, matchingAccommodation);
    const configuredOrigin = import.meta.env.VITE_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const origin = configuredOrigin || window.location.origin;
    const hotelSocialImage = absoluteUrl(
      import.meta.env.VITE_PUBLIC_SOCIAL_IMAGE?.trim() || "/images/hotel/hero-1280.webp",
      origin,
    );
    const socialImage = matchingAccommodation?.hero
      ? absoluteUrl(matchingAccommodation.hero, origin)
      : hotelSocialImage;
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
    const hotelId = `${origin}/#hotel`;
    const hotel = {
      "@type": "Hotel",
      "@id": hotelId,
      name: property.name,
      url: origin,
      image: hotelSocialImage,
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
      description: metadataFor("/", property, null).description,
      hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${property.name}, ${propertyAddress(property)}`)}`,
    };
    structuredData.textContent = JSON.stringify(matchingAccommodation
      ? {
          "@context": "https://schema.org",
          "@graph": [
            hotel,
            {
              "@type": "HotelRoom",
              "@id": `${origin}${pathname}#room`,
              name: matchingAccommodation.name,
              description: matchingAccommodation.shortDescription,
              image: socialImage,
              url: `${origin}${pathname}`,
              occupancy: {
                "@type": "QuantitativeValue",
                maxValue: matchingAccommodation.capacity,
              },
              containedInPlace: { "@id": hotelId },
            },
          ],
        }
      : { "@context": "https://schema.org", ...hotel });
  }, [accommodation, detailSlug, pathname, property]);

  return null;
}
