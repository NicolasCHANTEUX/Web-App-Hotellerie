import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { errorResponse, HttpError } from "./lib/http-errors.js";

// Set before loading the configuration: the embedded worker would otherwise
// reach the configured database and storage.
process.env.BACKGROUND_WORKER_MODE = "disabled";
process.env.CORS_ORIGIN = "https://hotel.example";
const { buildApp } = await import("./app.js");
const { BOOKING_CREATION_RATE_LIMIT } = await import("./modules/booking/booking.routes.js");

const INTERNAL_ERROR = {
  statusCode: 500,
  payload: { error: { code: "INTERNAL_ERROR", message: "Le service est momentanément indisponible." } },
};

async function testApp(t: TestContext) {
  const app = await buildApp();
  app.log.level = "silent";
  t.after(() => app.close());
  return app;
}

test("ne transmet jamais le détail d'une erreur interne au client", () => {
  const databaseError = Object.assign(new Error("Can't reach database server at db.internal:5432"), { code: "P1001" });
  const providerError = Object.assign(new Error("Invalid API Key provided"), { statusCode: 401, code: "api_key_invalid" });

  for (const error of [databaseError, providerError, "raw failure", null]) {
    assert.deepEqual(errorResponse(error), INTERNAL_ERROR);
  }
});

test("conserve le statut des erreurs client du framework avec un message neutre", () => {
  const tooLarge = Object.assign(new Error("Request body is too large"), { code: "FST_ERR_CTP_BODY_TOO_LARGE", statusCode: 413 });
  const notAcceptable = Object.assign(new Error("the request is not multipart"), { code: "FST_INVALID_MULTIPART_CONTENT_TYPE", statusCode: 406 });

  assert.deepEqual(errorResponse(tooLarge), {
    statusCode: 413,
    payload: { error: { code: "PAYLOAD_TOO_LARGE", message: "La requête est trop volumineuse." } },
  });
  assert.deepEqual(errorResponse(notAcceptable), {
    statusCode: 406,
    payload: { error: { code: "INVALID_REQUEST", message: "La requête ne peut pas être traitée." } },
  });
  assert.deepEqual(errorResponse(new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origine refusée.")), {
    statusCode: 403,
    payload: { error: { code: "ORIGIN_NOT_ALLOWED", message: "Origine refusée." } },
  });
});

test("applique le format d'erreur aux routes déclarées par l'application", async (t) => {
  const app = await testApp(t);

  const malformed = await app.inject({
    method: "POST",
    url: "/contact-requests",
    headers: { "content-type": "application/json" },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.json(), { error: { code: "INVALID_REQUEST", message: "La requête est invalide." } });

  const missing = await app.inject({ method: "GET", url: "/route-inexistante" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "NOT_FOUND");
});

test("répond 429 lorsque la limite de demandes de réservation est atteinte", async (t) => {
  const app = await testApp(t);
  const responses = [];
  for (let attempt = 0; attempt <= BOOKING_CREATION_RATE_LIMIT.max; attempt += 1) {
    responses.push(await app.inject({ method: "POST", url: "/bookings", payload: {} }));
  }

  assert.deepEqual(
    responses.map((response) => response.statusCode),
    [...Array<number>(BOOKING_CREATION_RATE_LIMIT.max).fill(400), 429],
  );
  const limited = responses.at(-1)!;
  assert.equal(limited.json().error.code, "RATE_LIMITED");
  assert.ok(limited.headers["retry-after"]);
});

test("refuse une origine non autorisée sans erreur serveur", async (t) => {
  const app = await testApp(t);

  const refused = await app.inject({ method: "GET", url: "/health/live", headers: { origin: "https://inconnu.example" } });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().error.code, "ORIGIN_NOT_ALLOWED");

  const allowed = await app.inject({ method: "GET", url: "/health/live", headers: { origin: "https://hotel.example" } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["access-control-allow-origin"], "https://hotel.example");
});

test("serves public API routes under Vercel's /api prefix", async (t) => {
  const app = await testApp(t);

  const health = await app.inject({ method: "GET", url: "/api/health/live" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().service, "hotel-app-api");

  const paymentConfig = await app.inject({ method: "GET", url: "/api/payments/config" });
  assert.equal(paymentConfig.statusCode, 200);
  assert.equal(typeof paymentConfig.json().data.stripeEnabled, "boolean");
});
