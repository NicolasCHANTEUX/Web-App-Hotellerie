import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import { findAuthAccountByEmail, inviteAuthAccount } from "./admin.supabase-admin.js";
import type { AdminTeamInvitationInput, TeamRole } from "./admin.team.js";

// The highest role wins when an account holds several for the property, as at sign-in.
const rolePriority: Record<TeamRole, number> = { ADMIN: 0, RECEPTION: 1, ACCOUNTING: 2, HOUSEKEEPING: 3 };

type MemberRecord = Prisma.AdminUserGetPayload<{ include: { memberships: true } }>;

function serializeMember(user: MemberRecord, propertyId: string, currentAdminUserId: string) {
  const memberships = user.memberships.filter((membership) => membership.propertyId === propertyId);
  const role = memberships.map((membership) => membership.role).sort((left, right) => rolePriority[left] - rolePriority[right])[0]!;
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role,
    isActive: user.isActive,
    // Invited accounts that never signed in yet.
    pending: user.lastLoginAt === null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    memberSince: memberships.map((membership) => membership.createdAt).sort((left, right) => left.getTime() - right.getTime())[0]!.toISOString(),
    isCurrentUser: user.id === currentAdminUserId,
  };
}

async function findMember(transaction: Prisma.TransactionClient, propertyId: string, memberId: string) {
  const member = await transaction.adminUser.findFirst({
    where: { id: memberId, memberships: { some: { propertyId } } },
    include: { memberships: { where: { propertyId } } },
  });
  if (!member) throw new AdminApiError(404, "TEAM_MEMBER_NOT_FOUND", "Ce membre de l'équipe est introuvable.");
  return member;
}

function assertNotSelf(memberId: string, adminUserId: string) {
  if (memberId === adminUserId) {
    throw new AdminApiError(409, "TEAM_SELF_CHANGE", "Vous ne pouvez pas modifier votre propre accès : demandez-le à un autre administrateur.");
  }
}

/** Keeps at least one active administrator, so that nobody is locked out of the settings. */
async function assertAnotherAdmin(transaction: Prisma.TransactionClient, propertyId: string, memberId: string) {
  const others = await transaction.adminMembership.count({
    where: { propertyId, role: "ADMIN", adminUserId: { not: memberId }, adminUser: { isActive: true } },
  });
  if (others === 0) {
    throw new AdminApiError(409, "TEAM_LAST_ADMIN", "L'établissement doit garder au moins un administrateur actif.");
  }
}

export async function listAdminTeam(membership: AdminMembershipContext, currentAdminUserId: string) {
  const users = await prisma.adminUser.findMany({
    where: { memberships: { some: { propertyId: membership.propertyId } } },
    include: { memberships: { where: { propertyId: membership.propertyId } } },
    orderBy: [{ displayName: "asc" }, { email: "asc" }],
  });
  return users.map((user) => serializeMember(user, membership.propertyId, currentAdminUserId));
}

/**
 * Gives access to the property. A new address receives the Supabase invitation
 * to choose a password; an existing account keeps its own and is only linked.
 */
export async function inviteAdminTeamMember(
  membership: AdminMembershipContext,
  adminUserId: string,
  input: AdminTeamInvitationInput,
  ipAddress?: string,
) {
  const alreadyMember = await prisma.adminUser.findFirst({
    where: { email: input.email, memberships: { some: { propertyId: membership.propertyId } } },
    select: { id: true },
  });
  if (alreadyMember) throw new AdminApiError(409, "TEAM_MEMBER_EXISTS", "Cette adresse a déjà accès à l'établissement.");

  const existingAccount = await findAuthAccountByEmail(input.email);
  const account = existingAccount ?? await inviteAuthAccount(input.email, input.displayName);

  const member = await prisma.$transaction(async (transaction) => {
    const [bySubject, byEmail] = await Promise.all([
      transaction.adminUser.findUnique({ where: { authSubject: account.id } }),
      transaction.adminUser.findUnique({ where: { email: account.email } }),
    ]);
    if (byEmail && byEmail.authSubject !== account.id) {
      throw new AdminApiError(409, "TEAM_ACCOUNT_CONFLICT", "Cette adresse est liée à un autre compte d'authentification. Contactez le support technique.");
    }
    const user = bySubject ?? await transaction.adminUser.create({
      data: { authSubject: account.id, email: account.email, displayName: input.displayName },
    });
    await transaction.adminMembership.create({
      data: { adminUserId: user.id, propertyId: membership.propertyId, role: input.role },
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "TEAM_MEMBER_INVITED",
        entityType: "AdminUser",
        entityId: user.id,
        before: Prisma.DbNull,
        after: { email: account.email, role: input.role },
        metadata: { role: membership.role, invitationSent: !existingAccount },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return transaction.adminUser.findUniqueOrThrow({ where: { id: user.id }, include: { memberships: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { member: serializeMember(member, membership.propertyId, adminUserId), invitationSent: !existingAccount };
}

export async function updateAdminTeamMemberRole(
  membership: AdminMembershipContext,
  adminUserId: string,
  memberId: string,
  role: TeamRole,
  ipAddress?: string,
) {
  assertNotSelf(memberId, adminUserId);
  return prisma.$transaction(async (transaction) => {
    const member = await findMember(transaction, membership.propertyId, memberId);
    const before = serializeMember(member, membership.propertyId, adminUserId).role;
    if (before === "ADMIN" && role !== "ADMIN") await assertAnotherAdmin(transaction, membership.propertyId, memberId);

    await transaction.adminMembership.deleteMany({ where: { adminUserId: memberId, propertyId: membership.propertyId, role: { not: role } } });
    await transaction.adminMembership.upsert({
      where: { adminUserId_propertyId_role: { adminUserId: memberId, propertyId: membership.propertyId, role } },
      update: {},
      create: { adminUserId: memberId, propertyId: membership.propertyId, role },
    });
    if (before !== role) {
      await transaction.auditLog.create({
        data: {
          propertyId: membership.propertyId,
          adminUserId,
          action: "TEAM_MEMBER_ROLE_CHANGED",
          entityType: "AdminUser",
          entityId: memberId,
          before: { role: before },
          after: { role },
          metadata: { role: membership.role },
          ...(ipAddress ? { ipAddress } : {}),
        },
      });
    }
    const updated = await transaction.adminUser.findUniqueOrThrow({ where: { id: memberId }, include: { memberships: true } });
    return serializeMember(updated, membership.propertyId, adminUserId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Withdraws the access to this property; the account and its history remain. */
export async function removeAdminTeamMember(
  membership: AdminMembershipContext,
  adminUserId: string,
  memberId: string,
  ipAddress?: string,
) {
  assertNotSelf(memberId, adminUserId);
  return prisma.$transaction(async (transaction) => {
    const member = await findMember(transaction, membership.propertyId, memberId);
    const before = serializeMember(member, membership.propertyId, adminUserId).role;
    if (before === "ADMIN") await assertAnotherAdmin(transaction, membership.propertyId, memberId);

    await transaction.adminMembership.deleteMany({ where: { adminUserId: memberId, propertyId: membership.propertyId } });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "TEAM_MEMBER_REMOVED",
        entityType: "AdminUser",
        entityId: memberId,
        before: { email: member.email, role: before },
        after: Prisma.DbNull,
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return { id: memberId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
