import assert from "node:assert/strict";
import test from "node:test";
import { serializePublicProperty } from "./catalog.service.js";

test("serializes only public property fields and the active room count", () => {
  const property = serializePublicProperty({
    slug: "hotel-rivage",
    name: "Hôtel Rivage",
    email: "contact@hotel-rivage.fr",
    phone: "+33 4 93 00 12 34",
    addressLine1: "26 avenue des Pins",
    addressLine2: null,
    postalCode: "06400",
    city: "Cannes",
    countryCode: "FR",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    _count: { rooms: 18 },
  });

  assert.deepEqual(property, {
    slug: "hotel-rivage",
    name: "Hôtel Rivage",
    email: "contact@hotel-rivage.fr",
    phone: "+33 4 93 00 12 34",
    addressLine1: "26 avenue des Pins",
    addressLine2: null,
    postalCode: "06400",
    city: "Cannes",
    countryCode: "FR",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    roomCount: 18,
  });
});
