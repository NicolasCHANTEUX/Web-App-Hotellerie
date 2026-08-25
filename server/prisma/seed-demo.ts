import { AllocationStatus, BookingSource, BookingStatus } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";

type DemoBooking = {
  reference: string;
  status: BookingStatus;
  source: BookingSource;
  roomNumber: string;
  checkInOffset: number;
  checkOutOffset: number;
  firstName: string;
  lastName: string;
  email: string;
  adults: number;
  children: number;
};

const fixtures: DemoBooking[] = [
  {
    reference: "RVG-DEMO-001",
    status: BookingStatus.CONFIRMED,
    source: BookingSource.WEBSITE,
    roomNumber: "101",
    checkInOffset: 1,
    checkOutOffset: 4,
    firstName: "Camille",
    lastName: "Martin",
    email: "camille.martin@example.com",
    adults: 2,
    children: 0,
  },
  {
    reference: "RVG-DEMO-002",
    status: BookingStatus.PENDING_PAYMENT,
    source: BookingSource.WEBSITE,
    roomNumber: "201",
    checkInOffset: 6,
    checkOutOffset: 8,
    firstName: "Nora",
    lastName: "Bernard",
    email: "nora.bernard@example.com",
    adults: 2,
    children: 0,
  },
  {
    reference: "RVG-DEMO-003",
    status: BookingStatus.COMPLETED,
    source: BookingSource.PHONE,
    roomNumber: "301",
    checkInOffset: -10,
    checkOutOffset: -7,
    firstName: "Julien",
    lastName: "Moreau",
    email: "julien.moreau@example.com",
    adults: 1,
    children: 0,
  },
  {
    reference: "RVG-DEMO-004",
    status: BookingStatus.CANCELLED,
    source: BookingSource.EMAIL,
    roomNumber: "401",
    checkInOffset: 12,
    checkOutOffset: 14,
    firstName: "Sofia",
    lastName: "Rossi",
    email: "sofia.rossi@example.com",
    adults: 2,
    children: 1,
  },
];

function dateAtOffset(offset: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

async function seedBooking(propertyId: string, fixture: DemoBooking) {
  if (await prisma.booking.findUnique({ where: { reference: fixture.reference }, select: { id: true } })) {
    return "existing";
  }

  const room = await prisma.room.findFirst({
    where: { propertyId, number: fixture.roomNumber },
    include: {
      roomType: {
        include: {
          ratePlans: { where: { isActive: true }, orderBy: { basePricePerNight: "asc" }, take: 1 },
        },
      },
    },
  });
  const ratePlan = room?.roomType.ratePlans[0];
  if (!room || !ratePlan) throw new Error(`Room ${fixture.roomNumber} or its rate plan is missing.`);

  const checkIn = dateAtOffset(fixture.checkInOffset);
  const checkOut = dateAtOffset(fixture.checkOutOffset);
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
  const accommodationTotal = Number(ratePlan.basePricePerNight) * nights;
  const taxRate = Number(ratePlan.taxRate);
  const taxTotal = Math.round(accommodationTotal * taxRate / (100 + taxRate) * 100) / 100;
  const accommodationSubtotalExcludingTax = Math.round((accommodationTotal - taxTotal) * 100) / 100;
  const total = accommodationTotal;
  const isPending = fixture.status === BookingStatus.PENDING_PAYMENT;
  const isAllocated = fixture.status !== BookingStatus.CANCELLED && !isPending;
  const allocationStatus = fixture.status === BookingStatus.COMPLETED
    ? AllocationStatus.RELEASED
    : AllocationStatus.ACTIVE;

  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        propertyId,
        reference: fixture.reference,
        status: fixture.status,
        source: fixture.source,
        checkIn,
        checkOut,
        adults: fixture.adults,
        children: fixture.children,
        currency: ratePlan.currency,
        priceTaxMode: "INCLUSIVE",
        accommodationSubtotal: accommodationTotal,
        extrasSubtotal: 0,
        touristTaxTotal: 0,
        taxTotal,
        total,
        pricingSnapshot: {
          version: 3,
          priceTaxMode: "INCLUSIVE",
          demo: true,
          nights,
          roomType: room.roomType.name,
          nightlyPriceTtc: Number(ratePlan.basePricePerNight),
          taxRate: Number(ratePlan.taxRate),
          accommodationSubtotalExcludingTax,
          accommodationTotalIncludingTax: accommodationTotal,
          vatTotalIncluded: taxTotal,
          touristTaxTotal: 0,
          taxTotal,
          total,
        },
        termsSnapshot: {
          source: "DEMO_FIXTURE",
          refundable: ratePlan.refundable,
        },
        taxLines: {
          create: {
            kind: "VAT",
            labelSnapshot: "TVA hébergement",
            calculationModeSnapshot: "PERCENTAGE",
            rateSnapshot: ratePlan.taxRate,
            quantitySnapshot: 1,
            taxableBase: accommodationSubtotalExcludingTax,
            amount: taxTotal,
          },
        },
        confirmedAt: fixture.status === BookingStatus.CONFIRMED || fixture.status === BookingStatus.COMPLETED
          ? new Date()
          : null,
        cancelledAt: fixture.status === BookingStatus.CANCELLED ? new Date() : null,
      },
    });

    const bookingRoom = await tx.bookingRoom.create({
      data: {
        bookingId: booking.id,
        roomTypeId: room.roomTypeId,
        roomId: isPending ? null : room.id,
        ratePlanId: ratePlan.id,
        roomTypeNameSnapshot: room.roomType.name,
        roomNumberSnapshot: isPending ? null : room.number,
        nightlyPriceSnapshot: ratePlan.basePricePerNight,
        priceTaxModeSnapshot: "INCLUSIVE",
        taxRateSnapshot: ratePlan.taxRate,
        taxAmountSnapshot: taxTotal,
        lineTotal: accommodationTotal,
      },
    });

    await tx.guest.create({
      data: {
        bookingId: booking.id,
        isPrimary: true,
        firstName: fixture.firstName,
        lastName: fixture.lastName,
        email: fixture.email,
        phone: "+33 6 00 00 00 00",
        countryCode: "FR",
      },
    });

    if (isAllocated) {
      await tx.roomAllocation.create({
        data: {
          roomId: room.id,
          bookingRoomId: bookingRoom.id,
          source: "BOOKING",
          status: allocationStatus,
          checkIn,
          checkOut,
        },
      });
    }

    if (isPending) {
      const hold = await tx.reservationHold.create({
        data: {
          propertyId,
          roomTypeId: room.roomTypeId,
          roomId: room.id,
          bookingId: booking.id,
          checkIn,
          checkOut,
          adults: fixture.adults,
          children: fixture.children,
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        },
      });

      await tx.roomAllocation.create({
        data: {
          roomId: room.id,
          reservationHoldId: hold.id,
          source: "HOLD",
          status: AllocationStatus.ACTIVE,
          checkIn,
          checkOut,
        },
      });
    }
  });

  return "created";
}

async function main() {
  const property = await prisma.property.findUnique({ where: { slug: "hotel-rivage" }, select: { id: true } });
  if (!property) throw new Error("Run the main database seed before the demo seed.");

  const results = await Promise.all(fixtures.map((fixture) => seedBooking(property.id, fixture)));
  const created = results.filter((result) => result === "created").length;
  console.log(JSON.stringify({ demoBookings: fixtures.length, created, existing: fixtures.length - created }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
