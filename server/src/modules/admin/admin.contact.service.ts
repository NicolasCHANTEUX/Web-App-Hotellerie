import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import type { AdminContactRequestHandlingInput, AdminContactRequestListInput } from "./admin.contact.js";
import { AdminApiError } from "./admin.errors.js";

const contactRequestInclude = {
  handledBy: { select: { displayName: true } },
} satisfies Prisma.ContactRequestInclude;

type ContactRequestRecord = Prisma.ContactRequestGetPayload<{ include: typeof contactRequestInclude }>;

function serializeContactRequest(request: ContactRequestRecord) {
  const anonymized = request.anonymizedAt !== null;
  return {
    id: request.id,
    fullName: request.fullName,
    // Anonymization leaves a placeholder address that must not be offered as a reply.
    email: anonymized ? null : request.email,
    phone: request.phone,
    subject: request.subject,
    message: request.message,
    anonymized,
    createdAt: request.createdAt.toISOString(),
    handledAt: request.handledAt?.toISOString() ?? null,
    handledBy: request.handledAt ? request.handledBy?.displayName ?? null : null,
    updatedAt: request.updatedAt.toISOString(),
  };
}

function listWhere(propertyId: string, input: AdminContactRequestListInput): Prisma.ContactRequestWhereInput {
  const search = input.search;
  return {
    propertyId,
    ...(input.status === "OPEN" ? { handledAt: null } : input.status === "HANDLED" ? { handledAt: { not: null } } : {}),
    ...(search ? {
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { subject: { contains: search, mode: "insensitive" } },
        { message: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
}

/** Messages received from the site, newest first, with the count still to answer. */
export async function listAdminContactRequests(membership: AdminMembershipContext, input: AdminContactRequestListInput) {
  const where = listWhere(membership.propertyId, input);
  const [requests, total, open, handled] = await Promise.all([
    prisma.contactRequest.findMany({
      where,
      include: contactRequestInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.contactRequest.count({ where }),
    prisma.contactRequest.count({ where: { propertyId: membership.propertyId, handledAt: null } }),
    prisma.contactRequest.count({ where: { propertyId: membership.propertyId, handledAt: { not: null } } }),
  ]);
  return {
    items: requests.map(serializeContactRequest),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.ceil(total / input.pageSize),
    summary: { open, handled },
  };
}

export async function getAdminContactRequest(membership: AdminMembershipContext, requestId: string) {
  const request = await prisma.contactRequest.findFirst({
    where: { id: requestId, propertyId: membership.propertyId },
    include: contactRequestInclude,
  });
  if (!request) throw new AdminApiError(404, "CONTACT_REQUEST_NOT_FOUND", "Demande de contact introuvable.");
  return serializeContactRequest(request);
}

/** Marks a request as answered, or reopens it, recording who did so. */
export async function setAdminContactRequestHandled(
  membership: AdminMembershipContext,
  adminUserId: string,
  requestId: string,
  input: AdminContactRequestHandlingInput,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const request = await transaction.contactRequest.findFirst({
      where: { id: requestId, propertyId: membership.propertyId },
      include: contactRequestInclude,
    });
    if (!request) throw new AdminApiError(404, "CONTACT_REQUEST_NOT_FOUND", "Demande de contact introuvable.");
    if (request.updatedAt.getTime() !== input.updatedAt.getTime()) {
      throw new AdminApiError(409, "CONTACT_REQUEST_VERSION_CONFLICT", "Cette demande a été mise à jour entre-temps. Rechargez-la avant de réessayer.");
    }
    if ((request.handledAt !== null) === input.handled) return serializeContactRequest(request);

    const handledAt = input.handled ? new Date() : null;
    const updated = await transaction.contactRequest.update({
      where: { id: request.id },
      data: { handledAt, handledByAdminUserId: input.handled ? adminUserId : null },
      include: contactRequestInclude,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: input.handled ? "CONTACT_REQUEST_HANDLED" : "CONTACT_REQUEST_REOPENED",
        entityType: "ContactRequest",
        entityId: request.id,
        before: { handledAt: request.handledAt?.toISOString() ?? null },
        after: { handledAt: handledAt?.toISOString() ?? null },
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeContactRequest(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
