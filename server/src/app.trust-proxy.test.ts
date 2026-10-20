import assert from "node:assert/strict";
import test from "node:test";

// Set before loading the configuration: one proxy sits in front of the API,
// as on most hosting platforms.
process.env.BACKGROUND_WORKER_MODE = "disabled";
process.env.TRUST_PROXY = "1";
const { buildApp } = await import("./app.js");
const { BOOKING_CREATION_RATE_LIMIT } = await import("./modules/booking/booking.routes.js");

test("applique la limite de réservation à chaque client derrière le proxy", async (t) => {
  const app = await buildApp();
  app.log.level = "silent";
  t.after(() => app.close());
  const attempt = (clientAddress: string) => app.inject({
    method: "POST",
    url: "/bookings",
    payload: {},
    headers: { "x-forwarded-for": clientAddress },
  });

  for (let index = 0; index < BOOKING_CREATION_RATE_LIMIT.max; index += 1) {
    assert.equal((await attempt("203.0.113.10")).statusCode, 400);
  }
  assert.equal((await attempt("203.0.113.10")).statusCode, 429);
  assert.equal((await attempt("203.0.113.11")).statusCode, 400);
});
