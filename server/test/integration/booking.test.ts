import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { BookingError } from "../../src/modules/booking/booking.errors.js";
import { createBooking } from "../../src/modules/booking/booking.service.js";
import {
  NIGHTLY_PRICE,
  TOURIST_TAX_PER_ADULT_PER_NIGHT,
  bookingRequest,
  createTestHotel,
  dateFromToday,
  expireHold,
} from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

function bookingError(code: string) {
  return (error: unknown) => error instanceof BookingError && error.code === code;
}

test("enregistre une demande optionnée au prix du devis, taxe de séjour comprise", async () => {
  const hotel = await createTestHotel();
  const input = await bookingRequest(hotel, { nights: 2, adults: 2 });

  const booking = await createBooking(input, randomUUID());

  assert.match(booking.reference, /^BKG-[2-9A-HJKMNP-TW-Z]{6}$/);
  assert.equal(booking.status, "PENDING_PAYMENT");
  assert.equal(booking.total, 2 * NIGHTLY_PRICE + 2 * 2 * TOURIST_TAX_PER_ADULT_PER_NIGHT);
  assert.ok(booking.accessToken);

  const stored = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    include: {
      hold: { include: { allocation: true } },
      taxLines: true,
      notifications: { orderBy: { createdAt: "asc" } },
    },
  });
  assert.equal(stored.hold?.status, "ACTIVE");
  assert.equal(stored.hold?.allocation?.source, "HOLD");
  assert.equal(stored.hold?.allocation?.status, "ACTIVE");
  assert.ok(hotel.rooms.some((room) => room.id === stored.hold?.roomId));
  const holdDuration = stored.hold!.expiresAt.getTime() - stored.createdAt.getTime();
  assert.ok(Math.abs(holdDuration - 24 * 60 * 60 * 1_000) < 60_000);
  assert.deepEqual(
    stored.taxLines.filter((line) => line.kind === "TOURIST_TAX").map((line) => Number(line.amount)),
    [6],
  );
  assert.deepEqual(stored.notifications.map((item) => [item.template, item.recipient]), [
    ["BOOKING_OPTIONED", input.guest.email],
    ["BOOKING_REQUEST_RECEIVED", hotel.property.email],
  ]);
});

test("attribue la dernière chambre à une seule de deux demandes simultanées", async () => {
  const hotel = await createTestHotel({ rooms: 1 });
  const [first, second] = await Promise.all([bookingRequest(hotel), bookingRequest(hotel)]);

  const results = await Promise.allSettled([
    createBooking(first, randomUUID()),
    createBooking(second, randomUUID()),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(bookingError("ROOM_NOT_AVAILABLE")(rejected[0]!.reason), String(rejected[0]!.reason));
  const activeAllocations = await prisma.roomAllocation.count({ where: { roomId: hotel.rooms[0]!.id, status: "ACTIVE" } });
  assert.equal(activeAllocations, 1);
});

test("rejoue une demande identique sans la dupliquer et refuse une clé réutilisée autrement", async () => {
  const hotel = await createTestHotel();
  const input = await bookingRequest(hotel);
  const key = randomUUID();

  const created = await createBooking(input, key);
  const replayed = await createBooking(input, key);

  assert.equal(replayed.id, created.id);
  assert.equal(replayed.reference, created.reference);
  assert.equal(await prisma.booking.count({ where: { propertyId: hotel.property.id } }), 1);
  await assert.rejects(() => createBooking({ ...input, adults: 1 }, key), bookingError("IDEMPOTENCY_KEY_REUSED"));
});

test("limite à deux les demandes actives pour un même contact", async () => {
  const hotel = await createTestHotel({ rooms: 3 });
  const first = await bookingRequest(hotel, { arrivalInDays: 30 });
  const sameContact = { ...first.guest };

  await createBooking(first, randomUUID());
  await createBooking({ ...(await bookingRequest(hotel, { arrivalInDays: 40 })), guest: sameContact }, randomUUID());
  await assert.rejects(
    async () => createBooking({ ...(await bookingRequest(hotel, { arrivalInDays: 50 })), guest: sameContact }, randomUUID()),
    bookingError("BOOKING_CONTACT_LIMITED"),
  );
});

test("libère la chambre d'une option expirée au profit d'une nouvelle demande", async () => {
  const hotel = await createTestHotel({ rooms: 1 });
  const expired = await createBooking(await bookingRequest(hotel), randomUUID());
  await expireHold(expired.id);

  const next = await createBooking(await bookingRequest(hotel), randomUUID());

  assert.equal(next.status, "PENDING_PAYMENT");
  const previous = await prisma.booking.findUniqueOrThrow({ where: { id: expired.id }, include: { hold: { include: { allocation: true } } } });
  assert.equal(previous.status, "EXPIRED");
  assert.equal(previous.hold?.status, "EXPIRED");
  assert.equal(previous.hold?.allocation?.status, "EXPIRED");
});

test("accepte une arrivée le jour du départ précédent sur la même chambre", async () => {
  const hotel = await createTestHotel({ rooms: 1 });
  await createBooking(await bookingRequest(hotel, { arrivalInDays: 30, nights: 2 }), randomUUID());

  const sameDay = await createBooking(await bookingRequest(hotel, { arrivalInDays: 32, nights: 2 }), randomUUID());
  assert.equal(sameDay.status, "PENDING_PAYMENT");

  await assert.rejects(
    async () => createBooking(await bookingRequest(hotel, { arrivalInDays: 31, nights: 2 }), randomUUID()),
    bookingError("ROOM_NOT_AVAILABLE"),
  );
});

test("refuse une demande dont le prix attendu ne correspond plus au tarif", async () => {
  const hotel = await createTestHotel();
  const input = await bookingRequest(hotel);

  await assert.rejects(
    () => createBooking({ ...input, expectedTotal: input.expectedTotal - 100 }, randomUUID()),
    bookingError("PRICE_CHANGED"),
  );
  assert.equal(await prisma.booking.count({ where: { propertyId: hotel.property.id, checkIn: dateFromToday(30) } }), 0);
});
