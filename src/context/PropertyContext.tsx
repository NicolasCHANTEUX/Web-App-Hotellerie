import { ReactNode, createContext, useContext, useMemo } from "react";
import { getProperty } from "../api/hotel";
import { useRemoteData } from "../hooks/useRemoteData";
import { PublicProperty } from "../types/hotel";

const demoProperty: PublicProperty = {
  slug: "hotel-rivage",
  name: "Hôtel Rivage",
  email: "contact@hotel-rivage.fr",
  phone: "+33 4 93 00 12 34",
  addressLine1: "26 avenue des Pins",
  addressLine2: null,
  postalCode: "06400",
  city: "Cannes",
  countryCode: "FR",
  timezone: "Europe/Paris",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  roomCount: 18,
};

const PropertyContext = createContext<PublicProperty | null>(null);

export function PropertyProvider({ children }: { children: ReactNode }) {
  const { data, error, loading, retry } = useRemoteData((signal) => getProperty(signal), []);
  const allowDemoFallback = import.meta.env.DEV || import.meta.env.MODE === "test";
  const property = useMemo(() => data ?? (allowDemoFallback ? demoProperty : null), [allowDemoFallback, data]);

  if (!property) {
    return (
      <div className="property-bootstrap" role={loading ? "status" : "alert"}>
        <div className="property-bootstrap-mark" aria-hidden="true">H</div>
        <h1>{loading ? "Chargement de l’établissement" : "Établissement momentanément indisponible"}</h1>
        <p>{loading
          ? "Nous préparons les informations de votre séjour."
          : "Les informations de l’établissement n’ont pas pu être chargées. Veuillez réessayer dans un instant."}</p>
        {!loading && error && <button type="button" onClick={retry}>Réessayer</button>}
      </div>
    );
  }

  return <PropertyContext.Provider value={property}>{children}</PropertyContext.Provider>;
}

export function useProperty() {
  const property = useContext(PropertyContext);
  if (!property) throw new Error("useProperty must be used inside PropertyProvider.");
  return property;
}

export function useOptionalProperty() {
  return useContext(PropertyContext);
}

export function propertyAddress(property: PublicProperty) {
  return [property.addressLine1, property.addressLine2, `${property.postalCode} ${property.city}`]
    .filter(Boolean)
    .join(", ");
}

export function propertyMapUrl(property: PublicProperty) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${property.name}, ${propertyAddress(property)}`)}`;
}

export function propertyCountryName(property: PublicProperty) {
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" }).of(property.countryCode) ?? property.countryCode;
  } catch {
    return property.countryCode;
  }
}

export function propertyPhoneHref(phone: string) {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

export function formatHotelTime(value: string) {
  const [hours, minutes] = value.split(":");
  return `${Number(hours)}h${minutes}`;
}
