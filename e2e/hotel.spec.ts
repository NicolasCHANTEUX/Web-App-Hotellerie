import { expect, Page, test } from "@playwright/test";

const reactWarnings = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const warnings: string[] = [];
  reactWarnings.set(page, warnings);
  page.on("console", (message) => {
    const text = message.text();
    if (/createRoot\(\).*already been passed to createRoot|unique ["']key["'] prop/i.test(text)) {
      warnings.push(text);
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(reactWarnings.get(page) ?? []).toEqual([]);
});

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
  timezone: "Europe/Paris",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  roomCount: 18,
};

const accommodation = {
  id: "room-type-elegance",
  slug: "chambre-elegance",
  name: "Chambre Élégance",
  category: "Chambre supérieure",
  shortDescription: "Une chambre lumineuse ouverte sur les jardins.",
  description: "Une chambre lumineuse ouverte sur les jardins, pensée pour un séjour paisible.",
  price: 135,
  taxRate: 10,
  currency: "EUR",
  refundable: true,
  capacity: 2,
  maxAdults: 2,
  maxChildren: 1,
  surface: "24 m²",
  surfaceSqm: 24,
  rooms: "1 lit queen size",
  hero: "/images/hotel/cannes-1280.webp",
  gallery: ["/images/hotel/hero-1280.webp"],
  amenities: ["Wi-Fi"],
};

async function mockProperty(page: Page) {
  await page.route("**/api/property", (route) => route.fulfill({ json: { data: property } }));
}

test("renders the public home with canonical Hotel metadata", async ({ page }) => {
  await mockProperty(page);
  await page.route("**/api/room-types", (route) => route.fulfill({ json: { data: [] } }));

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: /Une parenthèse de calme/ })).toBeVisible();
  await expect(page.getByText("18 chambres", { exact: true })).toBeVisible();
  const heroImage = page.locator(".rivage-hero picture img");
  await expect(heroImage).toBeVisible();
  await expect.poll(() => heroImage.evaluate((image) => (image as HTMLImageElement).currentSrc))
    .toMatch(/hero-\d+\.avif$/);
  expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain('"@type":"Hotel"');
  const canonicalUrl = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonicalUrl).not.toBeNull();
  expect(new URL(canonicalUrl!).pathname).toBe("/");
});

test("uses room content in accommodation metadata", async ({ page }) => {
  await mockProperty(page);
  await page.route("**/api/room-types/chambre-elegance", (route) => route.fulfill({ json: { data: accommodation } }));

  await page.goto("/hebergements/chambre-elegance");

  await expect(page).toHaveTitle("Chambre Élégance | Hôtel Rivage Cannes");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", accommodation.shortDescription);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/images\/hotel\/cannes-1280\.webp$/);
  const structuredData = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "{}");
  expect(structuredData["@graph"]).toEqual(expect.arrayContaining([
    expect.objectContaining({ "@type": "Hotel", name: property.name }),
    expect.objectContaining({ "@type": "HotelRoom", name: accommodation.name, description: accommodation.shortDescription }),
  ]));
  expect(structuredData["@graph"].find((item: { "@type": string }) => item["@type"] === "Hotel").description)
    .not.toBe(accommodation.shortDescription);
});

test("returns from the admin login to the public site", async ({ page }) => {
  await mockProperty(page);
  await page.route("**/api/room-types", (route) => route.fulfill({ json: { data: [] } }));

  await page.goto("/admin/connexion");
  await page.getByRole("link", { name: "Retour au site de l’hôtel" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: /Une parenthèse de calme/ })).toBeVisible();
});

test("renders a controlled error page for an unknown admin route", async ({ page }) => {
  await page.goto("/admin/route-inconnue");

  await expect(page.getByRole("heading", { level: 1, name: "Page d’administration introuvable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Retour à l’administration" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Hey developer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

const accessToken = `bkg_${"A".repeat(43)}`;

async function mockPublicBooking(page: Page, status: number, booking?: Record<string, unknown>) {
  const tokens: Array<string | undefined> = [];
  await mockProperty(page);
  await page.route("**/api/payments/config", (route) => route.fulfill({ json: { data: { stripeEnabled: false } } }));
  await page.route("**/api/bookings/public", async (route) => {
    tokens.push(route.request().headers()["x-booking-access-token"]);
    await route.fulfill(booking
      ? { json: { data: booking } }
      : { status, json: { error: { code: "BOOKING_NOT_FOUND", message: "Réservation introuvable." } } });
  });
  return tokens;
}

const linkedBooking = {
  reference: "BKG-7K3F9Q",
  status: "CONFIRMED",
  room: "Chambre Élégance",
  arrival: "2027-03-12",
  departure: "2027-03-14",
  adults: 2,
  children: 0,
  options: [],
  total: 270,
  currency: "EUR",
};

test("opens a booking from the personal link of an e-mail", async ({ page }) => {
  const tokens = await mockPublicBooking(page, 200, linkedBooking);

  await page.goto(`/confirmation#acces=${accessToken}`);

  await expect(page.getByRole("heading", { level: 1, name: "Votre séjour est confirmé." })).toBeVisible();
  await expect(page.getByText("BKG-7K3F9Q", { exact: true })).toBeVisible();
  expect(tokens).toEqual([accessToken]);
  await expect(page).toHaveURL(/\/confirmation$/);
});

test("shows a cancelled booking opened from its link as inactive", async ({ page }) => {
  await mockPublicBooking(page, 200, { ...linkedBooking, status: "CANCELLED" });

  await page.goto(`/confirmation#acces=${accessToken}`);

  await expect(page.getByRole("heading", { level: 1, name: "Cette réservation n'est plus active." })).toBeVisible();
  await expect(page.getByText("Réservation annulée", { exact: true })).toBeVisible();
  await expect(page.getByText("Maintien de la chambre")).toHaveCount(0);
});

test("explains an expired booking link instead of redirecting", async ({ page }) => {
  await mockPublicBooking(page, 404);

  await page.goto(`/confirmation#acces=${accessToken}`);

  await expect(page.getByRole("heading", { level: 1, name: "Votre réservation n'a pas pu être affichée." })).toBeVisible();
  await expect(page).toHaveURL(/\/confirmation$/);
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

test("treats a missing accommodation as a noindex 404", async ({ page }) => {
  await mockProperty(page);
  await page.route("**/api/room-types/chambre-inconnue", (route) => route.fulfill({
    status: 404,
    json: { error: { message: "Hébergement introuvable." } },
  }));

  await page.goto("/hebergements/chambre-inconnue");

  await expect(page.getByRole("heading", { level: 1, name: "Page introuvable" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByRole("button", { name: "Réessayer" })).toHaveCount(0);
});

test("keeps a retry state for an accommodation service failure", async ({ page }) => {
  await mockProperty(page);
  await page.route("**/api/room-types/chambre-indisponible", (route) => route.fulfill({
    status: 503,
    json: { error: { message: "Service momentanément indisponible." } },
  }));

  await page.goto("/hebergements/chambre-indisponible");

  await expect(page.getByRole("alert")).toContainText("Service momentanément indisponible");
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Page introuvable" })).toHaveCount(0);
});

test("loads authenticated admin bookings after the asynchronous request", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("hotel.admin.accessToken", "e2e-token");
    sessionStorage.setItem("hotel.admin.expiresAt", String(Date.now() + 600_000));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => sessionStorage.setItem("e2e.copied-reference", value) },
    });
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
  await page.route("**/api/admin/bookings/booking-1/invoices", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/admin/bookings/booking-1/available-rooms", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/admin/bookings/booking-1", (route) => route.fulfill({ json: { data: {
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
    updatedAt: "2026-09-02T10:05:00Z",
    priceTaxMode: "INCLUSIVE",
    accommodationSubtotal: 270,
    extrasSubtotal: 0,
    touristTaxTotal: 0,
    taxTotal: 24.55,
    specialRequests: "Arrivée prévue vers 22h30.",
    confirmedAt: "2026-09-02T10:05:00Z",
    cancelledAt: null,
    guest: { firstName: "Sophie", lastName: "Martin", email: "sophie@example.com", phone: "+33612345678" },
    guests: [{ firstName: "Sophie", lastName: "Martin", email: "sophie@example.com", phone: "+33612345678", isPrimary: true }],
    rooms: [{ id: "booking-room-1", roomTypeId: "room-type-1", roomId: "room-201", roomTypeName: "Chambre Élégance", roomNumber: "201", nightlyPrice: 135, taxRate: 10, lineTotal: 270 }],
    extras: [],
    payments: [],
    paymentStatus: "SUCCEEDED",
    hold: { status: "CONVERTED", expiresAt: "2026-09-03T10:00:00Z", isActive: false },
    rateConditions: { name: "Tarif flexible", refundable: true, termsTitle: "Conditions de réservation" },
  } } }));

  await page.goto("/admin/reservations");

  await expect(page).toHaveURL(/\/admin\/reservations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Réservations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "RVG-2026-001", exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByText("Sophie Martin", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "RVG-2026-001", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Réservation", exact: true })).toBeVisible();
  await expect(page.getByText("Site internet", { exact: true })).toBeVisible();
  await expect(page.getByText("Arrivée prévue vers 22h30.", { exact: true })).toBeVisible();
  await expect(page.getByText("Tarif flexible", { exact: true })).toBeVisible();
  await expect(page.getByText("Option terminée", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Options" })).toHaveCount(0);
  await page.getByRole("button", { name: "Copier la référence RVG-2026-001" }).click();
  await expect(page.getByRole("status")).toHaveText("Référence copiée");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("e2e.copied-reference"))).toBe("RVG-2026-001");
});

test("renews an expired admin session once and revokes it on sign-out", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e.session-seeded")) return;
    sessionStorage.setItem("e2e.session-seeded", "true");
    sessionStorage.setItem("hotel.admin.accessToken", "expired-token");
    sessionStorage.setItem("hotel.admin.refreshToken", "refresh-1");
    sessionStorage.setItem("hotel.admin.expiresAt", String(Date.now() - 60_000));
  });
  const refreshRequests: unknown[] = [];
  const revokedAuthorizations: Array<string | undefined> = [];
  const expired = { status: 401, json: { error: { code: "INVALID_TOKEN", message: "La session administrateur a expiré ou est invalide." } } };
  const isRenewed = (authorization?: string) => authorization === "Bearer renewed-token";
  await page.route("**/api/admin/auth/refresh", async (route) => {
    refreshRequests.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { accessToken: "renewed-token", refreshToken: "refresh-2", expiresIn: 3600 } } });
  });
  await page.route("**/api/admin/auth/logout", async (route) => {
    revokedAuthorizations.push(route.request().headers().authorization);
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/admin/me", (route) => route.fulfill(isRenewed(route.request().headers().authorization)
    ? { json: { data: {
      user: { id: "user-admin", displayName: "Marie Dupont", email: "marie@rivage.fr" },
      membership: {
        propertyId: "property-rivage",
        role: "ADMIN",
        property: { id: "property-rivage", name: "Hôtel Rivage", slug: "hotel-rivage", timezone: "Europe/Paris", currency: "EUR" },
      },
    } } }
    : expired));
  await page.route("**/api/admin/bookings?*", (route) => route.fulfill(isRenewed(route.request().headers().authorization)
    ? { json: { data: {
      items: [],
      page: 1,
      pageSize: 5,
      total: 0,
      totalPages: 1,
      summary: { total: 0, byStatus: {}, arrivalsToday: 0, departuresToday: 0 },
    } } }
    : expired));

  await page.goto("/admin/reservations");

  await expect(page.getByRole("heading", { level: 1, name: "Réservations" })).toBeVisible();
  expect(refreshRequests).toEqual([{ refreshToken: "refresh-1" }]);
  expect(await page.evaluate(() => [
    sessionStorage.getItem("hotel.admin.accessToken"),
    sessionStorage.getItem("hotel.admin.refreshToken"),
  ])).toEqual(["renewed-token", "refresh-2"]);

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/admin\/connexion$/);
  await expect.poll(() => revokedAuthorizations).toEqual(["Bearer renewed-token"]);
  expect(await page.evaluate(() => sessionStorage.getItem("hotel.admin.refreshToken"))).toBeNull();
});

test("renders planning rooms and occupancy in a real browser", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("hotel.admin.accessToken", "e2e-token");
    sessionStorage.setItem("hotel.admin.expiresAt", String(Date.now() + 600_000));
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

async function signInAs(page: Page, role: "ADMIN" | "RECEPTION") {
  await page.addInitScript(() => {
    sessionStorage.setItem("hotel.admin.accessToken", "e2e-token");
    sessionStorage.setItem("hotel.admin.refreshToken", "e2e-refresh");
    sessionStorage.setItem("hotel.admin.expiresAt", String(Date.now() + 600_000));
  });
  await page.route("**/api/admin/me", (route) => route.fulfill({ json: { data: {
    user: { id: "user-admin", displayName: "Marie Dupont", email: "marie@rivage.fr" },
    membership: {
      propertyId: "property-rivage",
      role,
      property: { id: "property-rivage", name: "Hôtel Rivage", slug: "hotel-rivage", timezone: "Europe/Paris", currency: "EUR" },
    },
  } } }));
}

test("manages the stay options from the administration", async ({ page }) => {
  await signInAs(page, "ADMIN");
  const extra = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
    id,
    code: name.toUpperCase(),
    name,
    description: "",
    price: 15,
    currency: "EUR",
    pricingUnit: "PER_NIGHT",
    taxRate: 10,
    isActive: true,
    displayOrder: 0,
    bookingCount: 0,
    canDelete: true,
    updatedAt: "2026-10-20T08:00:00.000Z",
    ...overrides,
  });
  let extras = [
    extra("extra-breakfast", "Petit-déjeuner", { price: 18, pricingUnit: "PER_PERSON_PER_NIGHT", bookingCount: 3, canDelete: false }),
    extra("extra-parking", "Parking", { displayOrder: 1 }),
  ];
  const writes: Array<{ method: string; url: string; body: unknown }> = [];
  await page.route("**/api/admin/extras**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { data: extras } });
    writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
    if (request.method() === "POST") {
      const created = extra("extra-baby-bed", "Lit bébé", { price: 8, pricingUnit: "ONE_TIME", displayOrder: 2 });
      extras = [...extras, created];
      return route.fulfill({ status: 201, json: { data: created } });
    }
    extras = extras.filter((item) => !request.url().endsWith(item.id));
    return route.fulfill({ json: { data: { id: "extra-parking" } } });
  });

  await page.goto("/admin/options");

  await expect(page.getByRole("heading", { level: 1, name: "Options" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Petit-déjeuner", exact: true })).toBeVisible();
  await expect(page.getByText("par personne / nuit", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Supprimer Petit-déjeuner" })).toBeDisabled();

  await page.getByRole("button", { name: "Nouvelle option" }).click();
  const editor = page.getByRole("dialog", { name: "Nouvelle option" });
  await expect(editor.getByLabel("Nom")).toBeFocused();
  await editor.getByLabel("Nom").fill("Lit bébé");
  await editor.getByLabel(/Prix TTC/).fill("8");
  await editor.getByLabel("Facturation").selectOption("ONE_TIME");
  await editor.getByRole("button", { name: "Enregistrer" }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Lit bébé", exact: true })).toBeVisible();
  expect(writes[0]).toMatchObject({
    method: "POST",
    body: { name: "Lit bébé", description: "", price: 8, pricingUnit: "ONE_TIME", taxRate: 10, isActive: true, displayOrder: 2 },
  });

  await page.getByRole("button", { name: "Supprimer Parking" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(page.getByRole("cell", { name: "Parking", exact: true })).toHaveCount(0);
  expect(writes[1]).toMatchObject({ method: "DELETE", body: { updatedAt: "2026-10-20T08:00:00.000Z" } });
  expect(writes[1]?.url).toMatch(/\/api\/admin\/extras\/extra-parking$/);
});

test("hides the catalogue options from the reception", async ({ page }) => {
  await signInAs(page, "RECEPTION");
  await page.route("**/api/admin/bookings?*", (route) => route.fulfill({ json: { data: {
    items: [], page: 1, pageSize: 5, total: 0, totalPages: 1,
    summary: { total: 0, byStatus: {}, arrivalsToday: 0, departuresToday: 0 },
  } } }));

  await page.goto("/admin/options");

  await expect(page).toHaveURL(/\/admin\/reservations$/);
  await expect(page.getByRole("link", { name: "Options" })).toHaveCount(0);
});

test("manages the tourist tax rules and flags overlapping periods", async ({ page }) => {
  await signInAs(page, "ADMIN");
  const rule = (id: string, overrides: Record<string, unknown>) => ({
    id,
    code: id.toUpperCase(),
    label: "Taxe de séjour",
    calculationMode: "PER_ADULT_PER_NIGHT",
    amount: 1.5,
    rate: null,
    currency: "EUR",
    validFrom: null,
    validUntil: null,
    isActive: true,
    usageCount: 0,
    canDelete: true,
    updatedAt: "2026-10-21T08:00:00.000Z",
    ...overrides,
  });
  let rules = [rule("ts-current", { label: "Taxe de séjour 2026", usageCount: 12, canDelete: false })];
  const writes: Array<{ method: string; body: unknown }> = [];
  await page.route("**/api/admin/tourist-taxes**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { data: rules } });
    writes.push({ method: request.method(), body: request.postDataJSON() });
    const created = rule("ts-next", { label: "Taxe de séjour 2030", amount: 2.1, validFrom: "2030-01-01" });
    rules = [...rules, created];
    return route.fulfill({ status: 201, json: { data: created } });
  });

  await page.goto("/admin/taxe-de-sejour");

  await expect(page.getByRole("heading", { level: 1, name: "Taxe de séjour" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sans limite de date", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Supprimer Taxe de séjour 2026" })).toBeDisabled();
  await expect(page.getByText(/s’additionnent/)).toHaveCount(0);

  await page.getByRole("button", { name: "Nouvelle règle" }).click();
  const editor = page.getByRole("dialog", { name: "Nouvelle règle" });
  await editor.getByLabel("Libellé sur la facture").fill("Taxe de séjour 2030");
  await editor.getByLabel("Montant (EUR)").fill("2.1");
  await expect(editor.getByText("Exemple : 2 adultes et 1 enfant pendant 3 nuits : 12,60 € de taxe.")).toBeVisible();
  await editor.getByLabel("Calcul").selectOption("PERCENTAGE");
  await expect(editor.getByLabel("Taux (%)")).toHaveValue("2.1");
  await editor.getByLabel("Calcul").selectOption("PER_ADULT_PER_NIGHT");
  await editor.getByLabel("Première nuit").fill("2030-01-01");
  await editor.getByRole("button", { name: "Enregistrer" }).click();
  await expect(editor).toHaveCount(0);

  expect(writes).toEqual([{
    method: "POST",
    body: { label: "Taxe de séjour 2030", calculationMode: "PER_ADULT_PER_NIGHT", amount: 2.1, rate: null, validFrom: "2030-01-01", validUntil: null, isActive: true },
  }]);
  await expect(page.getByRole("cell", { name: "Taxe de séjour 2030", exact: true })).toBeVisible();
  await expect(page.getByText("« Taxe de séjour 2026 » et « Taxe de séjour 2030 » s’additionnent : à partir de la nuit du 01 janv. 2030.")).toBeVisible();
});

test("edits the property settings and refreshes the administration header", async ({ page }) => {
  let propertyName = "Hôtel Rivage";
  await page.addInitScript(() => {
    sessionStorage.setItem("hotel.admin.accessToken", "e2e-token");
    sessionStorage.setItem("hotel.admin.expiresAt", String(Date.now() + 600_000));
  });
  await page.route("**/api/admin/me", (route) => route.fulfill({ json: { data: {
    user: { id: "user-admin", displayName: "Marie Dupont", email: "marie@rivage.fr" },
    membership: {
      propertyId: "property-rivage",
      role: "ADMIN",
      property: { id: "property-rivage", name: propertyName, slug: "hotel-rivage", timezone: "Europe/Paris", currency: "EUR" },
    },
  } } }));
  const settings = {
    id: "property-rivage", slug: "hotel-rivage", timezone: "Europe/Paris", currency: "EUR", updatedAt: "2026-10-21T08:00:00.000Z",
    name: "Hôtel Rivage", legalName: null, email: "contact@hotel-rivage.fr", phone: "+33 4 93 00 12 34",
    addressLine1: "26 avenue des Pins", addressLine2: null, postalCode: "06400", city: "Cannes", countryCode: "FR",
    checkInTime: "15:00", checkOutTime: "11:00",
    legalForm: null, shareCapital: null, siret: null, registrationCity: null, vatNumber: null,
    publicationDirector: null, hostingProvider: null, mediator: null,
  };
  const patches: unknown[] = [];
  await page.route("**/api/admin/property", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: settings } });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    patches.push(body);
    propertyName = String(body.name);
    return route.fulfill({ json: { data: { ...settings, ...body, updatedAt: "2026-10-21T09:00:00.000Z" } } });
  });

  await page.goto("/admin/etablissement");

  await expect(page.getByRole("heading", { level: 1, name: "Établissement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  await page.getByLabel("Nom de l’établissement").fill("Hôtel Rivage & Spa");
  await page.getByLabel("SIRET").fill("812 345 678 0001");
  await expect(page.getByText("Le SIRET doit contenir 14 chiffres.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  await page.getByLabel("SIRET").fill("812 345 678 00012");
  await page.getByLabel("Forme juridique").fill("SAS");
  await page.getByLabel("Directeur de la publication").fill("Claire Martin");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  expect(patches).toEqual([expect.objectContaining({
    name: "Hôtel Rivage & Spa",
    siret: "812 345 678 00012",
    legalForm: "SAS",
    publicationDirector: "Claire Martin",
    legalName: null,
    updatedAt: "2026-10-21T08:00:00.000Z",
  })]);
  await expect(page.locator(".admin-brand strong")).toHaveText("Hôtel Rivage & Spa");
});

test("publishes the legal notice entered by the property", async ({ page }) => {
  await page.route("**/api/property", (route) => route.fulfill({ json: { data: { ...property, legal: {
    legalName: "Rivage Hôtellerie",
    legalForm: "SAS",
    shareCapital: "10 000 €",
    siret: "81234567800012",
    registrationCity: "Cannes",
    vatNumber: "FR12812345678",
    publicationDirector: "Claire Martin",
    hostingProvider: "Hébergeur SAS, 1 rue du Serveur, 75000 Paris",
    mediator: "Médiateur du tourisme, BP 80303, 75823 Paris Cedex 17",
  } } } }));

  await page.goto("/mentions-legales");

  await expect(page.getByText(/édité par Rivage Hôtellerie \(Hôtel Rivage\)/)).toBeVisible();
  await expect(page.getByText("SAS au capital de 10 000 € · SIRET 812 345 678 00012 · RCS Cannes · TVA intracommunautaire FR12812345678.")).toBeVisible();
  await expect(page.getByText("Directeur de la publication : Claire Martin.")).toBeVisible();
  await expect(page.getByText(/Médiateur du tourisme/)).toBeVisible();
  await expect(page.getByText(/doivent encore être complétées/)).toHaveCount(0);
});

test("lists the missing legal details until they are entered", async ({ page }) => {
  await mockProperty(page);

  await page.goto("/mentions-legales");

  await expect(page.getByText(/doivent encore être complétées par l'exploitant avant l'ouverture commerciale : le numéro SIRET, le directeur de la publication, l'hébergeur du site\./)).toBeVisible();
});
