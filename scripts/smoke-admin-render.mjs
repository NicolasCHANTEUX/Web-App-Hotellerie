import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";

const assetsDirectory = resolve("dist", "assets");
const bundle = (await readdir(assetsDirectory)).find((file) => /^index-.*\.js$/.test(file));
if (!bundle) throw new Error("Frontend bundle not found.");
const bundleUrl = pathToFileURL(resolve(assetsDirectory, bundle)).href;

const adminProfile = {
  user: { id: "user-admin", displayName: "Marie Dupont", email: "marie@rivage.fr" },
  membership: {
    propertyId: "property-rivage",
    role: "ADMIN",
    property: { id: "property-rivage", name: "Hôtel Rivage", slug: "hotel-rivage", timezone: "Europe/Paris", currency: "EUR" },
  },
};

const housekeepingProfile = {
  ...adminProfile,
  user: { id: "user-housekeeping", displayName: "Équipe Étages", email: "etages@rivage.fr" },
  membership: { ...adminProfile.membership, role: "HOUSEKEEPING" },
};

const accountingProfile = {
  ...adminProfile,
  user: { id: "user-accounting", displayName: "Équipe Comptable", email: "compta@rivage.fr" },
  membership: { ...adminProfile.membership, role: "ACCOUNTING" },
};

const bookingPage = {
  items: [{
    id: "booking-1",
    reference: "RVG-2026-001",
    status: "CONFIRMED",
    source: "WEBSITE",
    checkIn: "2026-08-17",
    checkOut: "2026-08-20",
    adults: 2,
    children: 0,
    total: 420,
    currency: "EUR",
    createdAt: "2026-08-10T10:00:00Z",
    guest: { firstName: "Sophie", lastName: "Martin", email: "sophie@example.com" },
    rooms: [{ id: "booking-room-1", roomTypeName: "Chambre Élégance", roomNumber: "201" }],
    paymentStatus: "SUCCEEDED",
    hold: null,
  }],
  page: 1,
  pageSize: 10,
  total: 1,
  totalPages: 1,
  summary: { total: 1, byStatus: { CONFIRMED: 1 }, arrivalsToday: 1, departuresToday: 0 },
};

const roomPage = {
  items: [{
    id: "room-101",
    number: "101",
    floor: 1,
    status: "ACTIVE",
    notes: null,
    updatedAt: "2026-08-22T08:00:00.000Z",
    roomType: { id: "room-type-elegance", name: "Chambre Élégance", slug: "elegance" },
    currentOccupancy: null,
    nextOccupancy: {
      kind: "BOOKING",
      bookingId: "booking-1",
      bookingReference: "RVG-2026-001",
      status: "CONFIRMED",
      checkIn: "2026-09-01",
      checkOut: "2026-09-04",
      guest: { firstName: "Sophie", lastName: "Martin" },
      holdExpiresAt: null,
      blockReason: null,
      note: null,
    },
    periodAvailability: null,
  }, {
    id: "room-102",
    number: "102",
    floor: 1,
    status: "ACTIVE",
    notes: "Prévoir le lit bébé avant l’arrivée.",
    updatedAt: "2026-08-22T08:30:00.000Z",
    roomType: { id: "room-type-elegance", name: "Chambre Élégance", slug: "elegance" },
    currentOccupancy: null,
    nextOccupancy: {
      kind: "BOOKING",
      bookingId: "booking-2",
      bookingReference: "RVG-2026-002",
      status: "CONFIRMED",
      checkIn: "2026-08-25",
      checkOut: "2026-08-28",
      guest: { firstName: "Thomas", lastName: "Bernard" },
      holdExpiresAt: null,
      blockReason: null,
      note: null,
    },
    periodAvailability: null,
  }],
  page: 1,
  pageSize: 20,
  total: 2,
  totalPages: 1,
  summary: {
    total: 2,
    byStatus: { ACTIVE: 2, OUT_OF_SERVICE: 0, ARCHIVED: 0 },
    roomTypes: [{ id: "room-type-elegance", name: "Chambre Élégance", slug: "elegance" }],
    occupiedNow: 0,
    heldNow: 0,
    blockedNow: 0,
    availableNow: 2,
    period: null,
  },
};

function roomPageForRequest(url, { stalePeriod = false } = {}) {
  const requestUrl = new URL(url, "http://localhost:5173");
  const requestedFrom = requestUrl.searchParams.get("from");
  const requestedTo = requestUrl.searchParams.get("to");
  if (!requestedFrom || !requestedTo) return roomPage;

  const responseFrom = stalePeriod ? "2026-08-24" : requestedFrom;
  const responseTo = stalePeriod ? "2026-08-27" : requestedTo;
  const conflict = roomPage.items[1].nextOccupancy;
  return {
    ...roomPage,
    items: roomPage.items.map((room, index) => ({
      ...room,
      periodAvailability: {
        from: responseFrom,
        to: responseTo,
        available: index === 0,
        conflicts: index === 0 ? [] : [conflict],
      },
    })),
    summary: {
      ...roomPage.summary,
      period: { from: responseFrom, to: responseTo, available: 1, unavailable: 1 },
    },
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function renderAdmin(pathname, {
  profile,
  withToken = false,
  period = null,
  staleRoomPeriod = false,
  roomDialogAction = null,
  roomCreateAction = null,
  roomDeleteAction = null,
  patchError = null,
  postError = null,
  deleteError = null,
} = {}) {
  const window = new Window({ url: `http://localhost:5173${pathname}` });
  const requests = [];
  let roomGetRequests = 0;
  let roomPatchPayload = null;
  let roomPostPayload = null;
  let roomDeletePayload = null;
  let roomPostRequests = 0;
  let roomDeleteRequests = 0;
  window.document.body.innerHTML = '<div id="root"></div>';
  if (withToken) {
    window.sessionStorage.setItem("rivage.admin.accessToken", "smoke-test-token");
    window.sessionStorage.setItem("rivage.admin.expiresAt", String(Date.now() + 600_000));
  }

  const browserGlobals = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    history: window.history,
    sessionStorage: window.sessionStorage,
    localStorage: window.localStorage,
    HTMLElement: window.HTMLElement,
    HTMLFormElement: window.HTMLFormElement,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  for (const [name, value] of Object.entries(browserGlobals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/admin/me") && profile) return jsonResponse({ data: profile });
    if (url.includes("/admin/bookings?")) return jsonResponse({ data: bookingPage });
    if (url.includes("/admin/rooms?")) {
      roomGetRequests += 1;
      return jsonResponse({ data: roomPageForRequest(url, { stalePeriod: staleRoomPeriod }) });
    }
    if (url.endsWith("/admin/rooms/room-101") && init.method === "PATCH") {
      roomPatchPayload = JSON.parse(String(init.body));
      if (patchError) {
        return jsonResponse({ error: { code: patchError.code, message: patchError.message } }, 409);
      }
      return jsonResponse({
        data: {
          id: "room-101",
          number: roomPatchPayload.number ?? "101",
          floor: 1,
          status: "ACTIVE",
          notes: null,
          updatedAt: "2026-08-22T09:00:00.000Z",
          roomType: roomPage.items[0].roomType,
        },
      });
    }
    if (url.endsWith("/admin/rooms") && init.method === "POST") {
      roomPostRequests += 1;
      roomPostPayload = JSON.parse(String(init.body));
      if (postError) {
        return jsonResponse({ error: { code: postError.code, message: postError.message } }, postError.status ?? 409);
      }
      return jsonResponse({
        data: {
          id: "room-103",
          number: roomPostPayload.number,
          floor: roomPostPayload.floor,
          status: roomPostPayload.status,
          notes: roomPostPayload.notes,
          updatedAt: "2026-08-22T10:00:00.000Z",
          roomType: roomPage.items[0].roomType,
        },
      }, 201);
    }
    if (url.endsWith("/admin/rooms/room-101") && init.method === "DELETE") {
      roomDeleteRequests += 1;
      roomDeletePayload = JSON.parse(String(init.body));
      if (deleteError) {
        return jsonResponse({ error: { code: deleteError.code, message: deleteError.message } }, deleteError.status ?? 409);
      }
      return jsonResponse({ data: { id: "room-101" } });
    }
    return jsonResponse({ error: { message: "Unmocked admin request." } }, 404);
  };

  await import(`${bundleUrl}?admin-smoke=${Date.now()}-${Math.random()}`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));

  if (period) {
    const [arrivalInput, departureInput] = window.document.querySelectorAll('.admin-room-date-controls input[type="date"]');
    assert.ok(arrivalInput && departureInput, "Room period inputs should render.");
    const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    assert.ok(setInputValue, "The input value setter should be available.");
    setInputValue.call(arrivalInput, period.from);
    arrivalInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    arrivalInput.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
    setInputValue.call(departureInput, period.to);
    departureInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    departureInput.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 220));
  }

  const roomDialogObservation = {
    opened: false,
    closed: false,
    readOnly: false,
    initialFocusCorrect: false,
    restoredFocus: false,
    saveInitiallyDisabled: false,
    saveEnabledAfterChange: false,
    discardPromptOpened: false,
    discardPromptFocused: false,
    patchPayload: null,
    refetchedAfterPatch: false,
    patchErrorText: "",
  };

  if (roomDialogAction) {
    const firstCard = window.document.querySelector(".admin-room-card");
    assert.ok(firstCard, "An interactive room card should render.");
    if (roomDialogAction === "readonly-click") {
      firstCard.click();
    } else {
      firstCard.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));

    roomDialogObservation.opened = Boolean(window.document.querySelector('.admin-room-dialog[role="dialog"]'));
    if (roomDialogAction === "readonly-click") {
      roomDialogObservation.readOnly = window.document.querySelectorAll(".admin-room-edit-form").length === 0
        && window.document.body.textContent.includes("Consultation en lecture seule");
      const closeButton = window.document.querySelector('.admin-room-dialog-head button[aria-label="Fermer"]');
      roomDialogObservation.initialFocusCorrect = window.document.activeElement === closeButton;
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
      roomDialogObservation.closed = !window.document.querySelector(".admin-room-dialog");
      roomDialogObservation.restoredFocus = window.document.activeElement === firstCard;
    } else {
      const numberInput = window.document.querySelector(".admin-room-form-grid input");
      const saveButton = window.document.querySelector('.admin-room-dialog-save[type="submit"]');
      assert.ok(numberInput && saveButton, "Admin room edit controls should render.");
      roomDialogObservation.initialFocusCorrect = window.document.activeElement === numberInput;
      roomDialogObservation.saveInitiallyDisabled = saveButton.disabled;
      const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      assert.ok(setInputValue, "The room number input setter should be available.");
      setInputValue.call(numberInput, "103");
      numberInput.dispatchEvent(new window.Event("input", { bubbles: true }));
      numberInput.dispatchEvent(new window.Event("change", { bubbles: true }));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));

      const changedSaveButton = window.document.querySelector('.admin-room-dialog-save[type="submit"]');
      roomDialogObservation.saveEnabledAfterChange = Boolean(changedSaveButton && !changedSaveButton.disabled);
      const cancelButton = window.document.querySelector(".admin-room-dialog-cancel");
      cancelButton.click();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
      roomDialogObservation.discardPromptOpened = Boolean(window.document.querySelector('.admin-room-discard-dialog[role="alertdialog"]'));
      const continueButton = window.document.querySelector(".admin-room-discard-dialog button");
      roomDialogObservation.discardPromptFocused = window.document.activeElement === continueButton;
      continueButton.click();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));

      const roomGetsBeforeSave = roomGetRequests;
      window.document.querySelector('.admin-room-dialog-save[type="submit"]').click();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      roomDialogObservation.patchPayload = roomPatchPayload;
      roomDialogObservation.closed = !window.document.querySelector(".admin-room-dialog");
      roomDialogObservation.refetchedAfterPatch = roomGetRequests > roomGetsBeforeSave;
      roomDialogObservation.patchErrorText = window.document.querySelector(".admin-room-save-error")?.textContent ?? "";
    }
  }

  const roomCreateObservation = {
    buttonVisible: Boolean(window.document.querySelector(".admin-room-create-button")),
    opened: false,
    initialFocusCorrect: false,
    archivedOptionAbsent: false,
    discardPromptOpened: false,
    discardPromptFocused: false,
    postPayload: null,
    postRequests: 0,
    closed: false,
    refetchedAfterPost: false,
    errorText: "",
  };

  if (roomCreateAction) {
    const createButton = window.document.querySelector(".admin-room-create-button");
    assert.ok(createButton, "The create room button should render for ADMIN.");
    createButton.click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    const createDialog = window.document.querySelector(".admin-room-create-dialog");
    const createNumber = createDialog?.querySelector('.admin-room-form-grid input[autocomplete="off"]');
    const createInputs = createDialog?.querySelectorAll(".admin-room-form-grid input");
    const createNotes = createDialog?.querySelector(".admin-room-form-grid textarea");
    const createStatus = createDialog?.querySelectorAll(".admin-room-form-grid select")[1];
    assert.ok(createDialog && createNumber && createInputs?.[1] && createNotes && createStatus, "The create room form should render.");
    roomCreateObservation.opened = createDialog.getAttribute("role") === "dialog";
    roomCreateObservation.initialFocusCorrect = window.document.activeElement === createNumber;
    roomCreateObservation.archivedOptionAbsent = ![...createStatus.options].some((option) => option.value === "ARCHIVED");

    const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    const setTextAreaValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    assert.ok(setInputValue && setTextAreaValue, "Form value setters should be available.");
    setInputValue.call(createNumber, " 103 ");
    createNumber.dispatchEvent(new window.Event("input", { bubbles: true }));
    createNumber.dispatchEvent(new window.Event("change", { bubbles: true }));
    setInputValue.call(createInputs[1], "2");
    createInputs[1].dispatchEvent(new window.Event("input", { bubbles: true }));
    createInputs[1].dispatchEvent(new window.Event("change", { bubbles: true }));
    setTextAreaValue.call(createNotes, " Près de l’ascenseur. ");
    createNotes.dispatchEvent(new window.Event("input", { bubbles: true }));
    createNotes.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));

    const cancelButton = createDialog.querySelector(".admin-room-dialog-cancel");
    cancelButton.click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
    const discardDialog = window.document.querySelector('.admin-room-create-dialog .admin-room-discard-dialog[role="alertdialog"]');
    const continueButton = discardDialog?.querySelector("button");
    roomCreateObservation.discardPromptOpened = Boolean(discardDialog);
    roomCreateObservation.discardPromptFocused = window.document.activeElement === continueButton;
    continueButton?.click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));

    const roomGetsBeforePost = roomGetRequests;
    const submitButton = window.document.querySelector(".admin-room-create-submit");
    submitButton.click();
    submitButton.click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 280));
    roomCreateObservation.postPayload = roomPostPayload;
    roomCreateObservation.postRequests = roomPostRequests;
    roomCreateObservation.closed = !window.document.querySelector(".admin-room-create-dialog");
    roomCreateObservation.refetchedAfterPost = roomGetRequests > roomGetsBeforePost;
    roomCreateObservation.errorText = window.document.querySelector(".admin-room-create-dialog .admin-room-save-error")?.textContent ?? "";
  }

  const roomDeleteObservation = {
    triggerVisible: false,
    opened: false,
    initialFocusCorrect: false,
    confirmationInitiallyDisabled: false,
    escapeClosed: false,
    focusRestored: false,
    deletePayload: null,
    deleteRequests: 0,
    closed: false,
    refetchedAfterDelete: false,
    errorText: "",
  };

  if (roomDeleteAction) {
    const firstCard = window.document.querySelector(".admin-room-card");
    assert.ok(firstCard, "A room card should render for deletion.");
    firstCard.click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    const deleteTrigger = window.document.querySelector(".admin-room-delete-trigger");
    assert.ok(deleteTrigger, "The delete room trigger should render for ADMIN.");
    roomDeleteObservation.triggerVisible = true;
    deleteTrigger.click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));

    let deleteDialog = window.document.querySelector('.admin-room-delete-dialog[role="alertdialog"]');
    let deleteCancel = deleteDialog?.querySelector(".admin-room-delete-actions button:not(.danger)");
    let deleteSubmit = deleteDialog?.querySelector(".admin-room-delete-actions button.danger");
    roomDeleteObservation.opened = Boolean(deleteDialog);
    roomDeleteObservation.initialFocusCorrect = window.document.activeElement === deleteCancel;
    roomDeleteObservation.confirmationInitiallyDisabled = Boolean(deleteSubmit?.disabled);
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
    roomDeleteObservation.escapeClosed = !window.document.querySelector(".admin-room-delete-dialog");
    roomDeleteObservation.focusRestored = window.document.activeElement === deleteTrigger;

    deleteTrigger.click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
    deleteDialog = window.document.querySelector('.admin-room-delete-dialog[role="alertdialog"]');
    const confirmationInput = deleteDialog?.querySelector("input");
    deleteSubmit = deleteDialog?.querySelector(".admin-room-delete-actions button.danger");
    assert.ok(confirmationInput && deleteSubmit, "The destructive confirmation controls should render.");
    const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    assert.ok(setInputValue, "The confirmation input setter should be available.");
    setInputValue.call(confirmationInput, "101");
    confirmationInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    confirmationInput.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));

    const roomGetsBeforeDelete = roomGetRequests;
    deleteSubmit = window.document.querySelector(".admin-room-delete-actions button.danger");
    deleteSubmit.click();
    deleteSubmit.click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 280));
    roomDeleteObservation.deletePayload = roomDeletePayload;
    roomDeleteObservation.deleteRequests = roomDeleteRequests;
    roomDeleteObservation.closed = !window.document.querySelector(".admin-room-dialog");
    roomDeleteObservation.refetchedAfterDelete = roomGetRequests > roomGetsBeforeDelete;
    roomDeleteObservation.errorText = window.document.querySelector(".admin-room-delete-error")?.textContent ?? "";
  }

  const root = window.document.getElementById("root");
  const roomCards = [...window.document.querySelectorAll(".admin-room-card")];
  const dateInputs = [...window.document.querySelectorAll('.admin-room-date-controls input[type="date"]')];
  const result = {
    text: root?.textContent?.trim() ?? "",
    pathname: window.location.pathname,
    navText: window.document.querySelector(".admin-nav")?.textContent ?? "",
    roomCards: roomCards.length,
    semanticRoomCards: roomCards.filter((card) => {
      const labelledBy = card.getAttribute("aria-labelledby");
      return labelledBy && window.document.getElementById(labelledBy)?.tagName === "H3";
    }).length,
    availableRoomCards: window.document.querySelectorAll(".admin-room-card-period-available").length,
    unavailableRoomCards: window.document.querySelectorAll(".admin-room-card-period-unavailable").length,
    pendingRoomCards: window.document.querySelectorAll(".admin-room-card-verdict-pending").length,
    dateControlsInPanelHead: window.document.querySelectorAll(".admin-panel-head .admin-room-date-controls").length,
    periodExplanatoryBlocks: window.document.querySelectorAll(".admin-room-period").length,
    roomPageDescriptions: window.document.querySelectorAll(".admin-page-heading > div > span").length,
    resetFilterButtons: window.document.querySelectorAll(".admin-room-panel-tools .admin-reset-filters").length,
    interactiveRoomCards: roomCards.filter((card) => card.getAttribute("role") === "button" && card.getAttribute("tabindex") === "0").length,
    roomDialog: roomDialogObservation,
    roomCreate: roomCreateObservation,
    roomDelete: roomDeleteObservation,
    createButtons: window.document.querySelectorAll(".admin-room-create-button").length,
    deleteButtons: window.document.querySelectorAll(".admin-room-delete-trigger").length,
    queriedPeriod: period ? requests.some((url) => {
      const requestUrl = new URL(url, "http://localhost:5173");
      return requestUrl.searchParams.get("from") === period.from
        && requestUrl.searchParams.get("to") === period.to;
    }) : false,
    departureMin: dateInputs[1]?.getAttribute("min") ?? null,
    departureMax: dateInputs[1]?.getAttribute("max") ?? null,
    childElements: root?.children.length ?? 0,
  };
  window.close();
  return result;
}

const login = await renderAdmin("/admin/connexion");
assert.equal(login.childElements, 1);
assert.match(login.text, /Connexion à l’administration/);

const protectedRoute = await renderAdmin("/admin/reservations");
assert.equal(protectedRoute.pathname, "/admin/connexion");
assert.match(protectedRoute.text, /Connexion à l’administration/);

const bookings = await renderAdmin("/admin/reservations", { profile: adminProfile, withToken: true });
assert.equal(bookings.pathname, "/admin/reservations");
assert.match(bookings.text, /RVG-2026-001/);
assert.match(bookings.text, /Marie Dupont/);

const housekeeping = await renderAdmin("/admin", { profile: housekeepingProfile, withToken: true });
assert.equal(housekeeping.pathname, "/admin/chambres");
assert.match(housekeeping.text, /État des chambres/);
assert.match(housekeeping.text, /Chambre101/);
assert.equal(housekeeping.roomCards, 2);
assert.equal(housekeeping.semanticRoomCards, 2);
assert.equal(housekeeping.interactiveRoomCards, 2);
assert.equal(housekeeping.availableRoomCards, 0);
assert.equal(housekeeping.unavailableRoomCards, 0);
assert.equal(housekeeping.dateControlsInPanelHead, 1);
assert.equal(housekeeping.periodExplanatoryBlocks, 0);
assert.equal(housekeeping.roomPageDescriptions, 0);
assert.equal(housekeeping.createButtons, 0);
assert.equal(housekeeping.deleteButtons, 0);
assert.doesNotMatch(housekeeping.navText, /Réservations/);

const roomReadOnlyDialog = await renderAdmin("/admin/chambres", {
  profile: housekeepingProfile,
  withToken: true,
  roomDialogAction: "readonly-click",
});
assert.equal(roomReadOnlyDialog.roomDialog.opened, true);
assert.equal(roomReadOnlyDialog.roomDialog.readOnly, true);
assert.equal(roomReadOnlyDialog.roomDialog.initialFocusCorrect, true);
assert.equal(roomReadOnlyDialog.roomDialog.closed, true);
assert.equal(roomReadOnlyDialog.roomDialog.restoredFocus, true);
assert.equal(roomReadOnlyDialog.roomDialog.patchPayload, null);
assert.equal(roomReadOnlyDialog.roomCreate.buttonVisible, false);
assert.equal(roomReadOnlyDialog.roomDelete.triggerVisible, false);

const roomEditDialog = await renderAdmin("/admin/chambres", {
  profile: adminProfile,
  withToken: true,
  roomDialogAction: "edit-keyboard-save",
});
assert.equal(roomEditDialog.roomDialog.opened, true);
assert.equal(roomEditDialog.roomDialog.initialFocusCorrect, true);
assert.equal(roomEditDialog.roomDialog.saveInitiallyDisabled, true);
assert.equal(roomEditDialog.roomDialog.saveEnabledAfterChange, true);
assert.equal(roomEditDialog.roomDialog.discardPromptOpened, true);
assert.equal(roomEditDialog.roomDialog.discardPromptFocused, true);
assert.deepEqual(roomEditDialog.roomDialog.patchPayload, {
  updatedAt: "2026-08-22T08:00:00.000Z",
  number: "103",
});
assert.equal(roomEditDialog.roomDialog.closed, true);
assert.equal(roomEditDialog.roomDialog.refetchedAfterPatch, true);

const roomNumberConflict = await renderAdmin("/admin/chambres", {
  profile: adminProfile,
  withToken: true,
  roomDialogAction: "edit-keyboard-save",
  patchError: { code: "ROOM_NUMBER_CONFLICT", message: "Une chambre porte déjà ce numéro." },
});
assert.equal(roomNumberConflict.roomDialog.closed, false);
assert.equal(roomNumberConflict.roomDialog.refetchedAfterPatch, false);
assert.match(roomNumberConflict.roomDialog.patchErrorText, /Une chambre porte déjà ce numéro/);

const roomCreation = await renderAdmin("/admin/chambres", {
  profile: adminProfile,
  withToken: true,
  roomCreateAction: "create-save",
});
assert.equal(roomCreation.roomCreate.buttonVisible, true);
assert.equal(roomCreation.roomCreate.opened, true);
assert.equal(roomCreation.roomCreate.initialFocusCorrect, true);
assert.equal(roomCreation.roomCreate.archivedOptionAbsent, true);
assert.equal(roomCreation.roomCreate.discardPromptOpened, true);
assert.equal(roomCreation.roomCreate.discardPromptFocused, true);
assert.deepEqual(roomCreation.roomCreate.postPayload, {
  number: "103",
  roomTypeId: "room-type-elegance",
  floor: 2,
  status: "ACTIVE",
  notes: "Près de l’ascenseur.",
});
assert.equal(roomCreation.roomCreate.postRequests, 1);
assert.equal(roomCreation.roomCreate.closed, true);
assert.equal(roomCreation.roomCreate.refetchedAfterPost, true);

const roomCreationConflict = await renderAdmin("/admin/chambres", {
  profile: adminProfile,
  withToken: true,
  roomCreateAction: "create-save",
  postError: { code: "ROOM_NUMBER_CONFLICT", message: "Une chambre porte déjà ce numéro." },
});
assert.equal(roomCreationConflict.roomCreate.closed, false);
assert.equal(roomCreationConflict.roomCreate.refetchedAfterPost, false);
assert.match(roomCreationConflict.roomCreate.errorText, /Une chambre porte déjà ce numéro/);

const roomDeletion = await renderAdmin("/admin/chambres", {
  profile: adminProfile,
  withToken: true,
  roomDeleteAction: "delete-confirm",
});
assert.equal(roomDeletion.roomDelete.triggerVisible, true);
assert.equal(roomDeletion.roomDelete.opened, true);
assert.equal(roomDeletion.roomDelete.initialFocusCorrect, true);
assert.equal(roomDeletion.roomDelete.confirmationInitiallyDisabled, true);
assert.equal(roomDeletion.roomDelete.escapeClosed, true);
assert.equal(roomDeletion.roomDelete.focusRestored, true);
assert.deepEqual(roomDeletion.roomDelete.deletePayload, { updatedAt: "2026-08-22T08:00:00.000Z" });
assert.equal(roomDeletion.roomDelete.deleteRequests, 1);
assert.equal(roomDeletion.roomDelete.closed, true);
assert.equal(roomDeletion.roomDelete.refetchedAfterDelete, true);

const roomDeletionWithHistory = await renderAdmin("/admin/chambres", {
  profile: adminProfile,
  withToken: true,
  roomDeleteAction: "delete-confirm",
  deleteError: { code: "ROOM_HAS_HISTORY", message: "Cette chambre possède déjà un historique." },
});
assert.equal(roomDeletionWithHistory.roomDelete.closed, false);
assert.equal(roomDeletionWithHistory.roomDelete.refetchedAfterDelete, false);
assert.equal(roomDeletionWithHistory.roomDelete.deleteRequests, 1);
assert.match(roomDeletionWithHistory.roomDelete.errorText, /historique/);
assert.match(roomDeletionWithHistory.roomDelete.errorText, /Archivée/);

const periodAvailability = await renderAdmin("/admin/chambres", {
  profile: adminProfile,
  withToken: true,
  period: { from: "2026-08-24", to: "2026-08-27" },
});
assert.equal(periodAvailability.queriedPeriod, true);
assert.equal(periodAvailability.availableRoomCards, 1);
assert.equal(periodAvailability.unavailableRoomCards, 1);
assert.equal(periodAvailability.pendingRoomCards, 0);
assert.equal(periodAvailability.resetFilterButtons, 1);
assert.equal(periodAvailability.departureMin, "2026-08-25");
assert.equal(periodAvailability.departureMax, "2027-08-25");
assert.match(periodAvailability.text, /Disponible toute la période/);
assert.match(periodAvailability.text, /Indisponible sur la période/);
assert.match(periodAvailability.text, /25 août 2026 → 28 août 2026/);
assert.match(periodAvailability.text, /RVG-2026-002/);

const stalePeriodAvailability = await renderAdmin("/admin/chambres", {
  profile: adminProfile,
  withToken: true,
  period: { from: "2026-08-28", to: "2026-08-30" },
  staleRoomPeriod: true,
});
assert.equal(stalePeriodAvailability.queriedPeriod, true);
assert.equal(stalePeriodAvailability.availableRoomCards, 0);
assert.equal(stalePeriodAvailability.unavailableRoomCards, 0);
assert.equal(stalePeriodAvailability.pendingRoomCards, 2);
assert.match(stalePeriodAvailability.text, /Calcul de disponibilité en cours/);

const housekeepingProtectedRoute = await renderAdmin("/admin/reservations", { profile: housekeepingProfile, withToken: true });
assert.equal(housekeepingProtectedRoute.pathname, "/admin/chambres");

const accountingProtectedRoute = await renderAdmin("/admin/reservations", { profile: accountingProfile, withToken: true });
assert.equal(accountingProtectedRoute.pathname, "/admin/chambres");

console.log(JSON.stringify({
  rendered: true,
  checks: ["login", "auth-guard", "bookings", "room-card-semantics", "room-readonly-dialog", "room-edit-patch", "room-dirty-confirmation", "room-conflict-message", "room-create", "room-create-conflict", "room-delete", "room-delete-history", "room-period-availability", "stale-period-guard", "housekeeping-navigation", "housekeeping-guard", "accounting-guard"],
}));
