import assert from "node:assert/strict";
import test from "node:test";
import { renderNotification } from "./notification.service.js";

test("échappe le contenu client dans le courriel HTML", () => {
  const rendered = renderNotification("BOOKING_CONFIRMED", {
    firstName: "<Nicolas>",
    reference: "RVG-TEST-001",
    roomName: "Suite & Spa",
  });
  assert.match(rendered.subject, /RVG-TEST-001/);
  assert.match(rendered.html, /&lt;Nicolas&gt;/);
  assert.doesNotMatch(rendered.html, /<Nicolas>/);
  assert.match(rendered.text, /Suite & Spa/);
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
