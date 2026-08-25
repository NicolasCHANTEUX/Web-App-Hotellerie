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
