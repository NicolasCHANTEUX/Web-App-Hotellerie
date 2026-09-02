import { expect, Page, test } from "@playwright/test";

const property = {
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
  roomCount: 17,
};

async function mockProperty(page: Page) {
  await page.route("**/api/property", (route) => route.fulfill({ json: { data: property } }));
}

test("renders the public home with canonical Hotel metadata", async ({ page }) => {
  await mockProperty(page);
  await page.route("**/api/room-types", (route) => route.fulfill({ json: { data: [] } }));

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: /Une parenthèse de calme/ })).toBeVisible();
  await expect(page.getByText("17 chambres", { exact: true })).toBeVisible();
  const heroImage = page.locator(".rivage-hero picture img");
  await expect(heroImage).toBeVisible();
  await expect.poll(() => heroImage.evaluate((image) => (image as HTMLImageElement).currentSrc))
    .toMatch(/hero-\d+\.avif$/);
  expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain('"@type":"Hotel"');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://127.0.0.1:4173/");
});

test("submits a contact request and confirms the success response", async ({ page }) => {
  await mockProperty(page);
  let submittedBody: unknown = null;
  await page.route("**/api/contact-requests", async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { data: { id: "contact-1", status: "RECEIVED", receivedAt: new Date().toISOString() } } });
  });

  await page.goto("/contact");
  await page.getByLabel("Nom complet").fill("Nicolas Chanteux");
  await page.getByLabel("Adresse email").fill("nicolas@example.com");
  await page.getByLabel("Sujet").selectOption("BOOKING_QUESTION");
  await page.getByLabel("Message").fill("Je souhaite obtenir une précision concernant mon prochain séjour.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Envoyer le message" }).click();

  await expect(page.getByRole("status")).toContainText("Votre demande a bien été enregistrée");
  expect(submittedBody).toMatchObject({
    fullName: "Nicolas Chanteux",
    email: "nicolas@example.com",
    subject: "BOOKING_QUESTION",
    privacyAccepted: true,
  });
});

test("shows a neutral error instead of the demo property when loading fails", async ({ page }) => {
  await page.route("**/api/property", (route) => route.fulfill({
    status: 503,
    json: { error: { message: "Service unavailable" } },
  }));

  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText("Établissement momentanément indisponible");
  await expect(page.locator("body")).not.toContainText("Hôtel Rivage");
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
});

test("renders an accessible noindex page for an unknown route", async ({ page }) => {
  await mockProperty(page);

  await page.goto("/ancienne-page");

  await expect(page.getByRole("heading", { level: 1, name: "Page introuvable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Retour à l’accueil" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir les hébergements" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("loads authenticated admin bookings after the asynchronous request", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("rivage.admin.accessToken", "e2e-token");
    sessionStorage.setItem("rivage.admin.expiresAt", String(Date.now() + 600_000));
  });
  await page.route("**/api/admin/me", (route) => route.fulfill({ json: { data: {
    user: { id: "user-admin", displayName: "Marie Dupont", email: "marie@rivage.fr" },
    membership: {
      propertyId: "property-rivage",
      role: "ADMIN",
      property: { id: "property-rivage", name: "Hôtel Rivage", slug: "hotel-rivage", timezone: "Europe/Paris", currency: "EUR" },
    },
  } } }));
  await page.route("**/api/admin/bookings?*", (route) => route.fulfill({ json: { data: {
    items: [{
      id: "booking-1",
      reference: "RVG-2026-001",
      status: "CONFIRMED",
      source: "WEBSITE",
      checkIn: "2026-09-12",
      checkOut: "2026-09-14",
      adults: 2,
      children: 0,
      total: 270,
      currency: "EUR",
      createdAt: "2026-09-02T10:00:00Z",
      guest: { firstName: "Sophie", lastName: "Martin", email: "sophie@example.com" },
      rooms: [{ id: "booking-room-1", roomTypeName: "Chambre Élégance", roomNumber: "201" }],
      paymentStatus: "SUCCEEDED",
      hold: null,
    }],
    page: 1,
    pageSize: 5,
    total: 1,
    totalPages: 1,
    summary: { total: 1, byStatus: { CONFIRMED: 1 }, arrivalsToday: 0, departuresToday: 0 },
  } } }));

  await page.goto("/admin/reservations");

  await expect(page).toHaveURL(/\/admin\/reservations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Réservations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "RVG-2026-001", exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByText("Sophie Martin", { exact: true })).toBeVisible();
});

test("renders planning rooms and occupancy in a real browser", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("rivage.admin.accessToken", "e2e-token");
    sessionStorage.setItem("rivage.admin.expiresAt", String(Date.now() + 600_000));
  });
  await page.route("**/api/admin/me", (route) => route.fulfill({ json: { data: {
    user: { id: "user-admin", displayName: "Marie Dupont", email: "marie@rivage.fr" },
    membership: {
      propertyId: "property-rivage",
      role: "ADMIN",
      property: { id: "property-rivage", name: "Hôtel Rivage", slug: "hotel-rivage", timezone: "Europe/Paris", currency: "EUR" },
    },
  } } }));
  await page.route("**/api/admin/rooms?*", (route) => {
    const requestUrl = new URL(route.request().url());
    const from = requestUrl.searchParams.get("from") ?? "2026-09-01";
    const to = requestUrl.searchParams.get("to") ?? "2026-09-15";
    const departure = new Date(`${from}T12:00:00Z`);
    departure.setUTCDate(departure.getUTCDate() + 2);
    const conflict = {
      kind: "BOOKING",
      bookingId: "booking-1",
      bookingReference: "RVG-2026-001",
      status: "CONFIRMED",
      checkIn: from,
      checkOut: departure.toISOString().slice(0, 10),
      guest: { firstName: "Sophie", lastName: "Martin" },
      holdExpiresAt: null,
      blockReason: null,
      note: null,
    };
    const roomType = { id: "room-type-elegance", name: "Chambre Élégance", slug: "elegance" };
    const room = (id: string, number: string, conflicts: unknown[]) => ({
      id,
      number,
      floor: 1,
      status: "ACTIVE",
      notes: null,
      updatedAt: "2026-09-02T08:00:00Z",
      roomType,
      currentOccupancy: null,
      nextOccupancy: null,
      periodAvailability: { from, to, available: conflicts.length === 0, conflicts },
    });
    return route.fulfill({ json: { data: {
      items: [room("room-101", "101", [conflict]), room("room-102", "102", [])],
      page: 1,
      pageSize: 100,
      total: 2,
      totalPages: 1,
      summary: {
        total: 2,
        byStatus: { ACTIVE: 2 },
        roomTypes: [roomType],
        occupiedNow: 1,
        heldNow: 0,
        blockedNow: 0,
        availableNow: 1,
        period: { from, to, available: 1, unavailable: 1 },
      },
    } } });
  });
  await page.route("**/api/admin/bookings?*", (route) => route.fulfill({ json: { data: {
    items: [],
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1,
    summary: { total: 0, byStatus: {}, arrivalsToday: 0, departuresToday: 0 },
  } } }));

  await page.goto("/admin/planning");

  const planning = page.getByRole("region", { name: "Occupation des chambres sur quatorze jours" });
  await expect(planning.getByRole("row")).toHaveCount(3);
  await expect(planning.getByRole("rowheader", { name: /101/ })).toBeVisible();
  await expect(planning.locator(".admin-planning-slot.booking").first()).toBeVisible();
});
