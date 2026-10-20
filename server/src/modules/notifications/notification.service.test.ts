import assert from "node:assert/strict";
import test from "node:test";
import { renderNotification } from "./notification.service.js";

test("échappe le contenu client dans le courriel HTML", () => {
  const rendered = renderNotification("BOOKING_CONFIRMED", {
    propertyName: "Hôtel des Dunes",
    firstName: "<Nicolas>",
    reference: "RVG-TEST-001",
    roomName: "Suite & Spa",
  });
  assert.match(rendered.subject, /RVG-TEST-001/);
  assert.match(rendered.html, /&lt;Nicolas&gt;/);
  assert.doesNotMatch(rendered.html, /<Nicolas>/);
  assert.match(rendered.text, /Suite & Spa/);
  assert.match(rendered.text, /Hôtel des Dunes/);
  assert.match(rendered.html, /Hôtel des Dunes/);
  assert.doesNotMatch(rendered.html, /Hôtel Rivage/);
});

test("prépare un message de contact destiné à l'hôtel sans interpréter son HTML", () => {
  const rendered = renderNotification("CONTACT_REQUEST_RECEIVED", {
    reference: "contact-id",
    contactName: "Camille <Martin>",
    contactEmail: "camille@example.com",
    contactSubject: "Préparer mon arrivée",
    contactMessage: "Arrivée tardive <script>alert(1)</script>",
  });
  assert.match(rendered.subject, /Préparer mon arrivée/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.text, /camille@example.com/);
});

test("prepare le recapitulatif d'une reservation modifiee", () => {
  const rendered = renderNotification("BOOKING_UPDATED", {
    firstName: "Nicolas",
    reference: "RVG-TEST-002",
    roomName: "Chambre Deluxe",
    arrival: "2026-09-12",
    departure: "2026-09-15",
    total: 555,
    currency: "EUR",
  });
  assert.match(rendered.subject, /RVG-TEST-002/);
  assert.match(rendered.text, /modifi/);
  assert.match(rendered.text, /Chambre Deluxe/);
  assert.match(rendered.text, /15 septembre 2026/);
  assert.match(rendered.text, /555/);
});

test("alerte l'hôtel d'une nouvelle demande avec un lien vers la réservation", () => {
  const rendered = renderNotification("BOOKING_REQUEST_RECEIVED", {
    propertyName: "Hôtel des Dunes",
    timezone: "Europe/Paris",
    reference: "RVG-TEST-003",
    guestName: "Camille <Martin>",
    guestEmail: "camille@example.com",
    guestPhone: "+33 6 12 34 56 78",
    roomName: "Suite Rivage",
    arrival: "2026-09-12",
    departure: "2026-09-15",
    adults: 2,
    children: 1,
    total: 780,
    currency: "EUR",
    specialRequests: "Lit bébé",
    holdExpiresAt: "2026-09-01T08:30:00.000Z",
    adminUrl: "https://hotel.example/admin/reservations?booking=abc&x=\"",
  });
  assert.match(rendered.subject, /Nouvelle demande de réservation RVG-TEST-003/);
  assert.match(rendered.text, /Camille <Martin>/);
  assert.match(rendered.html, /Camille &lt;Martin&gt;/);
  assert.match(rendered.text, /2 adultes, 1 enfant/);
  assert.match(rendered.text, /Lit bébé/);
  assert.match(rendered.text, /1 septembre 2026 à 10:30/);
  assert.match(rendered.text, /https:\/\/hotel\.example\/admin\/reservations\?booking=abc/);
  assert.match(rendered.html, /href="https:\/\/hotel\.example\/admin\/reservations\?booking=abc&amp;x=&quot;"/);
});

test("alerte l'hôtel d'un paiement reçu qui n'a pas pu confirmer la réservation", () => {
  const rendered = renderNotification("PAYMENT_REQUIRES_ATTENTION", {
    reference: "RVG-TEST-004",
    reason: "l'option avait expiré et aucune chambre de cette catégorie n'est plus disponible pour ces dates.",
    guestName: "Camille Martin",
    total: 780,
    currency: "EUR",
    adminUrl: "https://hotel.example/admin/reservations?booking=def",
  });
  assert.match(rendered.subject, /Action requise : paiement reçu pour RVG-TEST-004/);
  assert.match(rendered.text, /780,00\s€/);
  assert.match(rendered.text, /Motif : l'option avait expiré/);
  assert.match(rendered.text, /remboursez le paiement/);
  assert.match(rendered.text, /booking=def/);
});

test("ajoute au courriel client un lien personnel vers sa réservation", () => {
  const withLink = renderNotification("BOOKING_OPTIONED", {
    firstName: "Camille",
    reference: "BKG-7K3F9Q",
    bookingUrl: "https://hotel.example/confirmation#acces=bkg_token",
  });
  assert.match(withLink.html, /href="https:\/\/hotel\.example\/confirmation#acces=bkg_token"/);
  assert.match(withLink.html, /Consulter ma réservation/);
  assert.match(withLink.text, /Consulter ma réservation : https:\/\/hotel\.example\/confirmation#acces=bkg_token/);
  assert.match(withLink.text, /ne transférez pas ce message/);

  const withoutLink = renderNotification("BOOKING_OPTIONED", { firstName: "Camille", reference: "BKG-7K3F9Q" });
  assert.doesNotMatch(withoutLink.html, /Consulter ma réservation/);
  assert.doesNotMatch(withoutLink.text, /acces=/);
});
