import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

// Set before loading the configuration: the embedded worker would otherwise
// reach the configured database and storage.
process.env.BACKGROUND_WORKER_MODE = "disabled";
const { buildApp } = await import("../../app.js");
const { env } = await import("../../config/env.js");
const { AdminApiError } = await import("./admin.errors.js");
const { parseNewPassword, updateOwnPassword } = await import("./admin.password.js");
const { inviteAuthAccount } = await import("./admin.supabase-admin.js");
const { parseAdminTeamInvitationBody, parseAdminTeamRoleBody, requireTeamPermission } = await import("./admin.team.js");

function adminError(code: string) {
  return (error: unknown) => error instanceof AdminApiError && error.code === code;
}

function mockSupabase(t: TestContext, status: number, body: unknown = {}) {
  return t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
}

function withSecretKey(t: TestContext, value: string | null) {
  const previous = env.supabaseSecretKey;
  env.supabaseSecretKey = value;
  t.after(() => { env.supabaseSecretKey = previous; });
}

test("réserve la gestion de l'équipe aux administrateurs", () => {
  const membership = { propertyId: "p", createdAt: new Date(), property: { id: "p", name: "H", slug: "h", timezone: "Europe/Paris", currency: "EUR" } };
  assert.equal(requireTeamPermission({ ...membership, role: "ADMIN" }).role, "ADMIN");
  for (const role of ["RECEPTION", "ACCOUNTING", "HOUSEKEEPING"] as const) {
    assert.throws(() => requireTeamPermission({ ...membership, role }), adminError("ROLE_ACCESS_DENIED"));
  }
});

test("normalise une invitation et refuse les champs inattendus", () => {
  assert.deepEqual(parseAdminTeamInvitationBody({ email: " Lea.Martin@Example.COM ", displayName: "  Léa   Martin ", role: "RECEPTION" }), {
    email: "lea.martin@example.com",
    displayName: "Léa Martin",
    role: "RECEPTION",
  });
  assert.throws(() => parseAdminTeamInvitationBody({ email: "lea", displayName: "Léa", role: "RECEPTION" }), adminError("INVALID_TEAM_MEMBER"));
  assert.throws(() => parseAdminTeamInvitationBody({ email: "lea@example.com", displayName: "L", role: "RECEPTION" }), adminError("INVALID_TEAM_MEMBER"));
  assert.throws(() => parseAdminTeamInvitationBody({ email: "lea@example.com", displayName: "Léa", role: "OWNER" }), adminError("INVALID_TEAM_MEMBER"));
  assert.throws(() => parseAdminTeamInvitationBody({ email: "lea@example.com", displayName: "Léa", role: "ADMIN", password: "x" }), adminError("INVALID_TEAM_MEMBER"));
  assert.deepEqual(parseAdminTeamRoleBody({ role: "ACCOUNTING" }), { role: "ACCOUNTING" });
  assert.throws(() => parseAdminTeamRoleBody({ role: "ACCOUNTING", isActive: false }), adminError("INVALID_TEAM_MEMBER"));
});

test("exige un mot de passe d'au moins dix caractères, dans la limite de bcrypt", () => {
  assert.equal(parseNewPassword("correct horse"), "correct horse");
  assert.throws(() => parseNewPassword("court"), adminError("INVALID_PASSWORD"));
  assert.throws(() => parseNewPassword("é".repeat(37)), adminError("INVALID_PASSWORD"));
  assert.throws(() => parseNewPassword(" espace au début"), adminError("INVALID_PASSWORD"));
  assert.throws(() => parseNewPassword(1234567890), adminError("INVALID_PASSWORD"));
});

test("invite par Supabase avec la clé secrète et le lien d'activation", async (t) => {
  withSecretKey(t, "sb_secret_test");
  const fetchMock = mockSupabase(t, 200, { id: "11111111-1111-4111-8111-111111111111", email: "Lea@Example.com" });

  assert.deepEqual(await inviteAuthAccount("lea@example.com", "Léa Martin"), {
    id: "11111111-1111-4111-8111-111111111111",
    email: "lea@example.com",
    displayName: null,
  });
  const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
  assert.equal(url, `${env.supabaseUrl}/auth/v1/invite?redirect_to=${encodeURIComponent(`${env.frontendUrl.replace(/\/+$/, "")}/admin/activation`)}`);
  const headers = new Headers(init.headers);
  assert.equal(headers.get("apikey"), "sb_secret_test");
  assert.equal(headers.get("authorization"), null);
  assert.deepEqual(JSON.parse(String(init.body)), { email: "lea@example.com", data: { full_name: "Léa Martin" } });
});

test("explique pourquoi une invitation n'a pas pu partir", async (t) => {
  withSecretKey(t, null);
  await assert.rejects(() => inviteAuthAccount("lea@example.com", "Léa"), adminError("TEAM_MANAGEMENT_UNAVAILABLE"));

  withSecretKey(t, "sb_secret_test");
  mockSupabase(t, 429);
  await assert.rejects(() => inviteAuthAccount("lea@example.com", "Léa"), adminError("INVITATION_RATE_LIMITED"));
});

test("traduit les refus de Supabase lors du choix du mot de passe", async (t) => {
  mockSupabase(t, 422, { error_code: "same_password" });
  await assert.rejects(() => updateOwnPassword("token", "correct horse"), (error) => error instanceof AdminApiError && /différent/.test(error.message));
  t.mock.restoreAll();
  mockSupabase(t, 401);
  await assert.rejects(() => updateOwnPassword("token", "correct horse"), adminError("INVALID_TOKEN"));
});

test("envoie le lien de réinitialisation sans révéler si le compte existe", async (t) => {
  const app = await buildApp();
  app.log.level = "silent";
  t.after(() => app.close());
  const fetchMock = mockSupabase(t, 200);

  const invalid = await app.inject({ method: "POST", url: "/admin/auth/recover", payload: { email: "pas-une-adresse" } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(fetchMock.mock.callCount(), 0);

  const response = await app.inject({ method: "POST", url: "/admin/auth/recover", payload: { email: " Lea@Example.com " } });
  assert.equal(response.statusCode, 202);
  const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
  assert.match(url, /\/auth\/v1\/recover\?redirect_to=.*%2Fadmin%2Factivation$/);
  assert.deepEqual(JSON.parse(String(init.body)), { email: "lea@example.com" });
});
