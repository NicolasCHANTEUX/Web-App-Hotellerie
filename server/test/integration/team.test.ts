import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/lib/prisma.js";
import { AdminApiError } from "../../src/modules/admin/admin.errors.js";
import {
  inviteAdminTeamMember,
  listAdminTeam,
  removeAdminTeamMember,
  updateAdminTeamMemberRole,
} from "../../src/modules/admin/admin.team.service.js";
import { createReceptionist, createTestHotel } from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

function adminError(code: string) {
  return (error: unknown) => error instanceof AdminApiError && error.code === code;
}

/** Supabase Auth with the given existing accounts; invitations create new ones. */
function fakeSupabase(t: TestContext, accounts: Array<{ id: string; email: string }> = []) {
  const previous = env.supabaseSecretKey;
  env.supabaseSecretKey = "sb_secret_test";
  t.after(() => { env.supabaseSecretKey = previous; });
  const invited: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/admin/users")) return Response.json({ users: accounts });
    if (url.includes("/auth/v1/invite")) {
      const { email } = JSON.parse(String(init?.body)) as { email: string };
      invited.push(email);
      return Response.json({ id: randomUUID(), email });
    }
    return new Response(null, { status: 500 });
  });
  return invited;
}

test("invite, change le rôle puis retire l'accès d'un membre de l'équipe", async (t) => {
  const hotel = await createTestHotel();
  const admin = await createReceptionist(hotel);
  const existingAccount = { id: randomUUID(), email: `paul-${randomUUID().slice(0, 8)}@example.com` };
  const invited = fakeSupabase(t, [existingAccount]);
  const newEmail = `lea-${randomUUID().slice(0, 8)}@example.com`;

  const invitation = await inviteAdminTeamMember(admin.membership, admin.adminUserId, { email: newEmail, displayName: "Léa Martin", role: "RECEPTION" });
  assert.equal(invitation.invitationSent, true);
  assert.deepEqual(invited, [newEmail]);
  assert.equal(invitation.member.role, "RECEPTION");
  assert.equal(invitation.member.pending, true);
  await assert.rejects(
    () => inviteAdminTeamMember(admin.membership, admin.adminUserId, { email: newEmail, displayName: "Léa Martin", role: "ADMIN" }),
    adminError("TEAM_MEMBER_EXISTS"),
  );
  const linked = await inviteAdminTeamMember(admin.membership, admin.adminUserId, { email: existingAccount.email, displayName: "Paul Durand", role: "HOUSEKEEPING" });
  assert.equal(linked.invitationSent, false);
  assert.deepEqual(invited, [newEmail]);

  const team = await listAdminTeam(admin.membership, admin.adminUserId);
  assert.deepEqual(team.map((member) => [member.displayName, member.role, member.isCurrentUser]), [
    ["Léa Martin", "RECEPTION", false],
    ["Paul Durand", "HOUSEKEEPING", false],
    ["Réception test", "ADMIN", true],
  ]);

  const promoted = await updateAdminTeamMemberRole(admin.membership, admin.adminUserId, invitation.member.id, "ADMIN");
  assert.equal(promoted.role, "ADMIN");
  assert.deepEqual(await prisma.adminMembership.findMany({ where: { adminUserId: invitation.member.id }, select: { role: true } }), [{ role: "ADMIN" }]);
  await assert.rejects(() => updateAdminTeamMemberRole(admin.membership, admin.adminUserId, admin.adminUserId, "RECEPTION"), adminError("TEAM_SELF_CHANGE"));
  await assert.rejects(() => removeAdminTeamMember(admin.membership, admin.adminUserId, admin.adminUserId), adminError("TEAM_SELF_CHANGE"));

  await removeAdminTeamMember(admin.membership, admin.adminUserId, linked.member.id);
  assert.deepEqual((await listAdminTeam(admin.membership, admin.adminUserId)).map((member) => member.displayName), ["Léa Martin", "Réception test"]);
  assert.ok(await prisma.adminUser.findUnique({ where: { id: linked.member.id } }), "the account and its history remain");

  const audit = await prisma.auditLog.findMany({
    where: { propertyId: hotel.property.id, entityType: "AdminUser" },
    orderBy: { createdAt: "asc" },
    select: { action: true, entityId: true },
  });
  assert.deepEqual(audit, [
    { action: "TEAM_MEMBER_INVITED", entityId: invitation.member.id },
    { action: "TEAM_MEMBER_INVITED", entityId: linked.member.id },
    { action: "TEAM_MEMBER_ROLE_CHANGED", entityId: invitation.member.id },
    { action: "TEAM_MEMBER_REMOVED", entityId: linked.member.id },
  ]);
});

test("garde un administrateur et n'agit que sur l'équipe de l'établissement", async (t) => {
  fakeSupabase(t);
  const hotel = await createTestHotel();
  const admin = await createReceptionist(hotel);
  const colleague = await createReceptionist(hotel);
  // The colleague's role changed meanwhile: the admin is now the only one.
  await prisma.adminMembership.updateMany({ where: { adminUserId: colleague.adminUserId }, data: { role: "RECEPTION" } });
  await assert.rejects(() => removeAdminTeamMember(colleague.membership, colleague.adminUserId, admin.adminUserId), adminError("TEAM_LAST_ADMIN"));
  await assert.rejects(() => updateAdminTeamMemberRole(colleague.membership, colleague.adminUserId, admin.adminUserId, "ACCOUNTING"), adminError("TEAM_LAST_ADMIN"));

  const other = await createTestHotel({ publicSite: false });
  const otherAdmin = await createReceptionist(other);
  await assert.rejects(() => removeAdminTeamMember(otherAdmin.membership, otherAdmin.adminUserId, colleague.adminUserId), adminError("TEAM_MEMBER_NOT_FOUND"));
  await assert.rejects(() => updateAdminTeamMemberRole(otherAdmin.membership, otherAdmin.adminUserId, colleague.adminUserId, "ADMIN"), adminError("TEAM_MEMBER_NOT_FOUND"));
});
