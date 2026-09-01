import { ReactNode, createContext, useContext, useMemo } from "react";
import { getProperty } from "../api/hotel";
import { useRemoteData } from "../hooks/useRemoteData";
import { PublicProperty } from "../types/hotel";

const fallbackProperty: PublicProperty = {
  slug: "hotel-rivage",
  name: "Hôtel Rivage",
  email: "contact@hotel-rivage.fr",
  phone: "+33 4 93 00 12 34",
  addressLine1: "26 avenue des Pins",
  addressLine2: null,
  postalCode: "06400",
  city: "Cannes",
  countryCode: "FR",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  roomCount: 18,
};

const PropertyContext = createContext<PublicProperty>(fallbackProperty);

export function PropertyProvider({ children }: { children: ReactNode }) {
  const { data } = useRemoteData((signal) => getProperty(signal), []);
  const property = useMemo(() => data ?? fallbackProperty, [data]);
  return <PropertyContext.Provider value={property}>{children}</PropertyContext.Provider>;
}

export function useProperty() {
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

export function propertyPhoneHref(phone: string) {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

export function formatHotelTime(value: string) {
  const [hours, minutes] = value.split(":");
  return `${Number(hours)}h${minutes}`;
}
