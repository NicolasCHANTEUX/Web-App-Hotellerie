import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

// Set before loading the configuration: the embedded worker would otherwise
// reach the configured database and storage.
process.env.BACKGROUND_WORKER_MODE = "disabled";
const { buildApp } = await import("../../app.js");

async function testApp(t: TestContext) {
  const app = await buildApp();
  app.log.level = "silent";
  t.after(() => app.close());
  return app;
}

function mockSupabase(t: TestContext, status: number) {
  return t.mock.method(globalThis, "fetch", async () => new Response(status === 204 ? null : "{}", { status }));
}

test("refuse un jeton de renouvellement mal formé sans appeler Supabase", async (t) => {
  const app = await testApp(t);
  const fetchMock = mockSupabase(t, 200);

  for (const payload of [{}, { refreshToken: "" }, { refreshToken: "a b" }, { refreshToken: 42 }]) {
    const response = await app.inject({ method: "POST", url: "/admin/auth/refresh", payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_SESSION");
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("signale une session expirée lorsque Supabase refuse le renouvellement", async (t) => {
  const app = await testApp(t);
  const fetchMock = mockSupabase(t, 400);

  const response = await app.inject({ method: "POST", url: "/admin/auth/refresh", payload: { refreshToken: "refresh-token" } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "SESSION_EXPIRED");
  const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
  assert.match(url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
  assert.deepEqual(JSON.parse(String(init.body)), { refresh_token: "refresh-token" });
});

test("révoque la session Supabase à la déconnexion", async (t) => {
  const app = await testApp(t);
  const fetchMock = mockSupabase(t, 204);

  const missing = await app.inject({ method: "POST", url: "/admin/auth/logout" });
  assert.equal(missing.statusCode, 401);
  assert.equal(fetchMock.mock.callCount(), 0);

  const response = await app.inject({ method: "POST", url: "/admin/auth/logout", headers: { authorization: "Bearer access-token" } });
  assert.equal(response.statusCode, 204);
  const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
  assert.match(url, /\/auth\/v1\/logout\?scope=local$/);
  assert.equal(new Headers(init.headers).get("authorization"), "Bearer access-token");
});

test("demande un renouvellement lorsque le jeton de déconnexion a expiré", async (t) => {
  const app = await testApp(t);
  mockSupabase(t, 401);

  const response = await app.inject({ method: "POST", url: "/admin/auth/logout", headers: { authorization: "Bearer expired-token" } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "INVALID_TOKEN");
});
