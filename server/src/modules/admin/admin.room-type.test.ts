import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError } from "./admin.errors.js";
import {
  parseAdminRoomTypeCreateBody,
  parseAdminRoomTypeDeleteBody,
  parseAdminRoomTypeUpdateBody,
  roomTypeRetirementMode,
  slugifyRoomType,
} from "./admin.room-type.js";

const updatedAt = "2026-08-23T10:15:30.123Z";
const coverImageUrl = "data:image/jpeg;base64,/9j/4A==";
const validRoomType = {
  name: "  Chambre Prestige  ",
  shortName: "  Chambre supérieure  ",
  description: "  Une chambre lumineuse avec une belle vue sur le jardin.  ",
  surfaceSqm: 28,
  maxAdults: 2,
  maxChildren: 1,
  maxGuests: 3,
  bedLabel: "  1 lit king-size  ",
  coverImageUrl,
  displayOrder: 4,
  isPublished: true,
  price: 189.995,
  taxRate: 10,
  amenities: [" Wi-Fi fibre ", "Vue jardin", "wi-fi fibre"],
};

function assertInvalid(action: () => unknown) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "INVALID_ROOM_TYPE");
    return true;
  });
}

test("room type creation parser normalizes catalogue fields", () => {
  assert.deepEqual(parseAdminRoomTypeCreateBody(validRoomType), {
    name: "Chambre Prestige",
    shortName: "Chambre supérieure",
    description: "Une chambre lumineuse avec une belle vue sur le jardin.",
    surfaceSqm: 28,
    maxAdults: 2,
    maxChildren: 1,
    maxGuests: 3,
    bedLabel: "1 lit king-size",
    coverImageUrl,
    coverImageFileId: null,
    displayOrder: 4,
    isPublished: true,
    price: 190,
    taxRate: 10,
    promotion: null,
    amenities: ["Wi-Fi fibre", "Vue jardin"],
  });
});

test("room type parser validates capacity, image and unexpected fields", () => {
  assertInvalid(() => parseAdminRoomTypeCreateBody({ ...validRoomType, maxGuests: 4 }));
  assertInvalid(() => parseAdminRoomTypeCreateBody({ ...validRoomType, coverImageUrl: "data:image/svg+xml;base64,PHN2Zz4=" }));
  assertInvalid(() => parseAdminRoomTypeCreateBody({ ...validRoomType, coverImageUrl: "data:image/jpeg;base64,YWJj" }));
  assertInvalid(() => parseAdminRoomTypeCreateBody({ ...validRoomType, force: true }));
});

test("room type update and deletion require a canonical version", () => {
  assert.equal(parseAdminRoomTypeUpdateBody({ ...validRoomType, updatedAt }).updatedAt.toISOString(), updatedAt);
  assert.equal(parseAdminRoomTypeDeleteBody({ updatedAt }).updatedAt.toISOString(), updatedAt);
  assertInvalid(() => parseAdminRoomTypeUpdateBody({ ...validRoomType, updatedAt: "2026-08-23" }));
  assertInvalid(() => parseAdminRoomTypeDeleteBody({ updatedAt, force: true }));
});

test("room type slugs are stable and URL-safe", () => {
  assert.equal(slugifyRoomType(" Suite Côte d’Azur "), "suite-cote-d-azur");
});

test("room type parser accepts and normalizes a bounded percentage promotion", () => {
  const parsed = parseAdminRoomTypeCreateBody({
    ...validRoomType,
    promotion: {
      label: " Offre d'été ",
      discountPercent: 12.345,
      validFrom: "2026-08-24",
      validUntil: "2026-09-15",
    },
  });
  assert.deepEqual(parsed.promotion, {
    label: "Offre d'été",
    discountPercent: 12.35,
    validFrom: new Date("2026-08-24T00:00:00.000Z"),
    validUntil: new Date("2026-09-15T00:00:00.000Z"),
  });
});

test("room type parser rejects invalid discounts and promotion periods", () => {
  assertInvalid(() => parseAdminRoomTypeCreateBody({
    ...validRoomType,
    promotion: { label: "Promo", discountPercent: 100, validFrom: "2026-08-24", validUntil: null },
  }));
  assertInvalid(() => parseAdminRoomTypeCreateBody({
    ...validRoomType,
    promotion: { label: "Promo", discountPercent: 10, validFrom: "2026-09-01", validUntil: "2026-09-01" },
  }));
});

test("room type retirement deletes unused types, archives history and blocks future stays", () => {
  assert.equal(roomTypeRetirementMode({ blockingBookings: 0, blockingHolds: 0, dependencies: 0 }), "DELETE");
  assert.equal(roomTypeRetirementMode({ blockingBookings: 0, blockingHolds: 0, dependencies: 12 }), "ARCHIVE");
  assert.equal(roomTypeRetirementMode({ blockingBookings: 1, blockingHolds: 0, dependencies: 12 }), "BLOCKED");
  assert.equal(roomTypeRetirementMode({ blockingBookings: 0, blockingHolds: 1, dependencies: 2 }), "BLOCKED");
});
