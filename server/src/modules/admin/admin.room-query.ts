import { AdminApiError } from "./admin.errors.js";
import {
  BookingStatus,
  type Prisma,
} from "../../generated/prisma/client.js";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const millisecondsPerDay = 24 * 60 * 60 * 1_000;
const maxRoomPeriodNights = 366;

export type RoomSortOrder = "asc" | "desc";

const blockingBookingStatuses = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
];

const roomNumberCollator = new Intl.Collator("fr-FR", {
  numeric: true,
  sensitivity: "base",
});

type RoomPeriodQuery = {
  from?: string;
  to?: string;
  sortOrder?: string;
};

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseRoomDate(value: string | undefined, field: "from" | "to") {
  if (value === undefined) return undefined;
  if (!isoDatePattern.test(value)) {
    throw new AdminApiError(
      400,
      "INVALID_QUERY",
      `Le paramètre ${field} doit être une date AAAA-MM-JJ.`,
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new AdminApiError(
      400,
      "INVALID_QUERY",
      `Le paramètre ${field} doit être une date valide.`,
    );
  }
  return date;
}

export function parseRoomPeriodQuery(query: RoomPeriodQuery): {
  from?: Date;
  to?: Date;
  sortOrder: RoomSortOrder;
} {
  const from = parseRoomDate(query.from, "from");
  const to = parseRoomDate(query.to, "to");

  if ((from && !to) || (!from && to)) {
    throw new AdminApiError(
      400,
      "INVALID_QUERY",
      "Les paramètres from et to doivent être fournis ensemble.",
    );
  }

  if (from && to) {
    if (from >= to) {
      throw new AdminApiError(
        400,
        "INVALID_QUERY",
        "La date de début doit précéder strictement la date de fin.",
      );
    }

    const nights = (to.getTime() - from.getTime()) / millisecondsPerDay;
    if (nights > maxRoomPeriodNights) {
      throw new AdminApiError(
        400,
        "INVALID_QUERY",
        `La période est limitée à ${maxRoomPeriodNights} nuits.`,
      );
    }
  }

  const sortOrder = query.sortOrder ?? "asc";
  if (sortOrder !== "asc" && sortOrder !== "desc") {
    throw new AdminApiError(
      400,
      "INVALID_QUERY",
      "Le paramètre sortOrder doit valoir asc ou desc.",
    );
  }

  return { from, to, sortOrder };
}

/**
 * Les séjours utilisent des intervalles semi-ouverts : l'arrivée est incluse,
 * tandis que le jour du départ est immédiatement réutilisable.
 */
export function roomIntervalsOverlap(
  firstFrom: Date,
  firstTo: Date,
  secondFrom: Date,
  secondTo: Date,
) {
  return firstFrom < secondTo && firstTo > secondFrom;
}

/**
 * Unifie le prédicat métier utilisé pour l'occupation courante et pour une
 * période sélectionnée. Un hold autonome est valide ; un hold rattaché à une
 * réservation annulée, expirée ou terminée ne bloque plus la chambre.
 */
export function blockingRoomAllocationWhere(now: Date): Prisma.RoomAllocationWhereInput {
  return {
    status: "ACTIVE",
    OR: [
      {
        source: "BOOKING",
        bookingRoom: {
          is: {
            booking: {
              is: { status: { in: blockingBookingStatuses } },
            },
          },
        },
      },
      {
        source: "HOLD",
        reservationHold: {
          is: {
            status: "ACTIVE",
            expiresAt: { gt: now },
            OR: [
              { bookingId: null },
              {
                booking: {
                  is: { status: { in: blockingBookingStatuses } },
                },
              },
            ],
          },
        },
      },
      { source: "BLOCK" },
    ],
  };
}

export function compareRoomNumbers(
  first: { number: string; floor: number | null },
  second: { number: string; floor: number | null },
  sortOrder: RoomSortOrder,
) {
  const direction = sortOrder === "asc" ? 1 : -1;
  const byNumber = roomNumberCollator.compare(first.number, second.number);
  if (byNumber !== 0) return byNumber * direction;

  const firstFloor = first.floor ?? Number.MAX_SAFE_INTEGER;
  const secondFloor = second.floor ?? Number.MAX_SAFE_INTEGER;
  return (firstFloor - secondFloor) * direction;
}
