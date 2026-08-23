import {
  AllocationSource,
  RoomStatus,
} from "../../generated/prisma/client.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import {
  editableRoomFields,
  hasOwn,
  parseCanonicalUpdatedAt,
  parseRoomFloor,
  parseRoomNotes,
  parseRoomNumber,
  parseRoomStatus,
  parseRoomTypeId,
  parseStrictRoomObject,
} from "./admin.room-validation.js";

const allowedRoomUpdateFields = new Set(["updatedAt", ...editableRoomFields]);

export type AdminRoomChanges = {
  number?: string;
  roomTypeId?: string;
  floor?: number | null;
  status?: RoomStatus;
  notes?: string | null;
};

export type AdminRoomUpdateInput = {
  updatedAt: Date;
  changes: AdminRoomChanges;
};

function invalidRoomUpdate(message: string): never {
  throw new AdminApiError(400, "INVALID_ROOM_UPDATE", message);
}

export function parseAdminRoomUpdateBody(body: unknown): AdminRoomUpdateInput {
  const candidate = parseStrictRoomObject(body, allowedRoomUpdateFields, invalidRoomUpdate);
  if (!hasOwn(candidate, "updatedAt")) {
    return invalidRoomUpdate("La version updatedAt est obligatoire.");
  }
  const updatedAt = parseCanonicalUpdatedAt(candidate.updatedAt, invalidRoomUpdate);

  if (!editableRoomFields.some((field) => hasOwn(candidate, field))) {
    return invalidRoomUpdate("Au moins un champ de la chambre doit être modifié.");
  }

  const changes: AdminRoomChanges = {};

  if (hasOwn(candidate, "number")) {
    changes.number = parseRoomNumber(candidate.number, invalidRoomUpdate);
  }

  if (hasOwn(candidate, "roomTypeId")) {
    changes.roomTypeId = parseRoomTypeId(candidate.roomTypeId, invalidRoomUpdate);
  }

  if (hasOwn(candidate, "floor")) {
    changes.floor = parseRoomFloor(candidate.floor, invalidRoomUpdate);
  }

  if (hasOwn(candidate, "status")) {
    changes.status = parseRoomStatus(candidate.status, invalidRoomUpdate);
  }

  if (hasOwn(candidate, "notes")) {
    changes.notes = parseRoomNotes(candidate.notes, invalidRoomUpdate);
  }

  return { updatedAt, changes };
}

export function requireRoomManagementPermission(membership: AdminMembershipContext) {
  if (membership.role !== "ADMIN") {
    throw new AdminApiError(
      403,
      "ROLE_ACCESS_DENIED",
      "Votre rôle ne permet pas de gérer les chambres.",
    );
  }
  return membership;
}

export function requireRoomUpdatePermission(membership: AdminMembershipContext) {
  return requireRoomManagementPermission(membership);
}

/**
 * Un blocage operationnel (maintenance, menage, usage proprietaire) est
 * compatible avec un changement de type ou une mise hors service. En revanche,
 * une chambre archivee doit etre totalement libre de toute allocation.
 */
export function blockingAllocationSourcesForRoomUpdate(
  changesRoomType: boolean,
  nextStatus?: RoomStatus,
) {
  if (nextStatus === RoomStatus.ARCHIVED) {
    return [
      AllocationSource.BOOKING,
      AllocationSource.HOLD,
      AllocationSource.BLOCK,
    ];
  }
  if (changesRoomType || nextStatus === RoomStatus.OUT_OF_SERVICE) {
    return [AllocationSource.BOOKING, AllocationSource.HOLD];
  }
  return [];
}
