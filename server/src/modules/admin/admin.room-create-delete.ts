import { RoomStatus } from "../../generated/prisma/client.js";
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

const allowedRoomCreateFields = new Set(editableRoomFields);
const allowedRoomDeleteFields = new Set(["updatedAt"]);

export type AdminRoomCreateInput = {
  number: string;
  roomTypeId: string;
  floor: number | null;
  status: Exclude<RoomStatus, typeof RoomStatus.ARCHIVED>;
  notes: string | null;
};

export type AdminRoomDeleteInput = {
  updatedAt: Date;
};

export type AdminRoomHistoryCounts = {
  bookingRooms: number;
  reservationHolds: number;
  availabilityBlocks: number;
  allocations: number;
};

function invalidRoomCreate(message: string): never {
  throw new AdminApiError(400, "INVALID_ROOM_CREATE", message);
}

function invalidRoomDelete(message: string): never {
  throw new AdminApiError(400, "INVALID_ROOM_DELETE", message);
}

export function parseAdminRoomCreateBody(body: unknown): AdminRoomCreateInput {
  const candidate = parseStrictRoomObject(body, allowedRoomCreateFields, invalidRoomCreate);
  if (!hasOwn(candidate, "number")) {
    return invalidRoomCreate("Le numéro de chambre est obligatoire.");
  }
  if (!hasOwn(candidate, "roomTypeId")) {
    return invalidRoomCreate("Le type de chambre est obligatoire.");
  }

  const status = hasOwn(candidate, "status")
    ? parseRoomStatus(candidate.status, invalidRoomCreate)
    : RoomStatus.ACTIVE;
  if (status === RoomStatus.ARCHIVED) {
    return invalidRoomCreate("Une nouvelle chambre ne peut pas être créée avec le statut archivé.");
  }

  return {
    number: parseRoomNumber(candidate.number, invalidRoomCreate),
    roomTypeId: parseRoomTypeId(candidate.roomTypeId, invalidRoomCreate),
    floor: hasOwn(candidate, "floor")
      ? parseRoomFloor(candidate.floor, invalidRoomCreate)
      : null,
    status,
    notes: hasOwn(candidate, "notes")
      ? parseRoomNotes(candidate.notes, invalidRoomCreate)
      : null,
  };
}

export function parseAdminRoomDeleteBody(body: unknown): AdminRoomDeleteInput {
  const candidate = parseStrictRoomObject(body, allowedRoomDeleteFields, invalidRoomDelete);
  if (!hasOwn(candidate, "updatedAt")) {
    return invalidRoomDelete("La version updatedAt est obligatoire.");
  }
  return {
    updatedAt: parseCanonicalUpdatedAt(candidate.updatedAt, invalidRoomDelete),
  };
}

export function roomHasHistory(counts: AdminRoomHistoryCounts) {
  return counts.bookingRooms > 0 ||
    counts.reservationHolds > 0 ||
    counts.availabilityBlocks > 0 ||
    counts.allocations > 0;
}
