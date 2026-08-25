import {
  ArrowUpDown,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleOff,
  Eye,
  Filter,
  Layers3,
  Pencil,
  Plus,
  Search,
  Save,
  Trash2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import {
  AdminApiError,
  AdminAvailabilityBlockInput,
  AdminRoom,
  AdminRoomOccupancy,
  AdminRoomSummary,
  CreateAdminRoomInput,
  PaginatedAdminResult,
  RoomStatus,
  UpdateAdminRoomInput,
  createAdminRoom,
  createAdminAvailabilityBlock,
  deleteAdminRoom,
  getAdminRooms,
  releaseAdminAvailabilityBlock,
  updateAdminRoom,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import {
  AdminEmptyState,
  AdminErrorState,
  AdminPagination,
  PageHeading,
  StatusBadge,
  formatDate,
  formatDateTime,
  roomStatusLabel,
} from "../../admin/ui";
import { AdminRoomTypesDialog } from "./AdminRoomTypesDialog";

const PAGE_SIZE = 20;
const roomStatuses: RoomStatus[] = ["ACTIVE", "OUT_OF_SERVICE", "ARCHIVED"];
const emptySummary: AdminRoomSummary = {
  total: 0,
  byStatus: {},
  roomTypes: [],
  occupiedNow: 0,
  heldNow: 0,
  blockedNow: 0,
  availableNow: 0,
  period: null,
};

const blockReasonLabels: Record<string, string> = {
  MAINTENANCE: "Maintenance",
  OWNER_USE: "Usage propriétaire",
  HOUSEKEEPING: "Entretien",
  OTHER: "Indisponibilité",
};

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function addDays(value: string, amount: number) {
  if (!isIsoDate(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function todayInputValue() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function floorLabel(floor: number | null) {
  if (floor === null) return "Étage non renseigné";
  if (floor === 0) return "Rez-de-chaussée";
  return `${floor}${floor === 1 ? "er" : "e"} étage`;
}

function occupancyGuest(occupancy: AdminRoomOccupancy) {
  if (occupancy.guest) return `${occupancy.guest.firstName} ${occupancy.guest.lastName}`;
  if (occupancy.kind === "HOLD") return "Option en attente";
  return "Séjour confirmé";
}

function occupancyTitle(occupancy: AdminRoomOccupancy) {
  if (occupancy.kind === "BLOCK") {
    return blockReasonLabels[occupancy.blockReason ?? "OTHER"] ?? "Indisponibilité";
  }
  return occupancyGuest(occupancy);
}

export function AdminRooms() {
  const { accessToken, logout, profile } = useAdminAuth();
  const propertyTimeZone = profile?.membership.property.timezone;
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<RoomStatus | "">("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [result, setResult] = useState<PaginatedAdminResult<AdminRoom, AdminRoomSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<AdminRoom | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [managingRoomTypes, setManagingRoomTypes] = useState(false);
  const [roomAnnouncement, setRoomAnnouncement] = useState("");
  const roomPanelHeadingRef = useRef<HTMLHeadingElement>(null);

  const hasValidPeriod = isIsoDate(from) && isIsoDate(to) && from < to;
  const queryFrom = hasValidPeriod ? from : undefined;
  const queryTo = hasValidPeriod ? to : undefined;
  const requestedPeriod = hasValidPeriod ? { from, to } : null;

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminRooms({
      page,
      pageSize: PAGE_SIZE,
      search: deferredSearch.trim(),
      status,
      roomTypeId,
      from: queryFrom,
      to: queryTo,
      sortOrder,
    }, accessToken, controller.signal)
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) {
          logout();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Une erreur est survenue.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, deferredSearch, logout, page, queryFrom, queryTo, retryKey, roomTypeId, sortOrder, status]);

  const summary = result?.summary ?? emptySummary;
  const filtersActive = Boolean(search || status || roomTypeId || from || to || sortOrder === "desc");
  const roomTypes = summary.roomTypes;
  const canManageRooms = profile?.membership.role === "ADMIN";

  function handleFromChange(value: string) {
    setFrom(value);
    if (value && (!isIsoDate(to) || to <= value)) {
      setTo(addDays(value, 1));
    } else if (value && to > addDays(value, 366)) {
      setTo(addDays(value, 366));
    }
    setPage(1);
  }

  function handleToChange(value: string) {
    const minDeparture = addDays(from, 1);
    const maxDeparture = addDays(from, 366);
    if (value && isIsoDate(from) && value <= from) {
      setTo(minDeparture);
    } else if (value && isIsoDate(from) && value > maxDeparture) {
      setTo(maxDeparture);
    } else {
      setTo(value);
    }
    setPage(1);
  }

  function resetFilters() {
    setSearch("");
    setStatus("");
    setRoomTypeId("");
    setFrom("");
    setTo("");
    setSortOrder("asc");
    setPage(1);
  }

  return (
    <>
      <PageHeading
        eyebrow="Inventaire physique"
        title="Chambres"
        action={canManageRooms ? (
          <div className="admin-room-page-actions">
            <button type="button" className="admin-room-types-button" onClick={() => setManagingRoomTypes(true)}><Layers3 />Gérer les types</button>
            <button
              type="button"
              className="admin-room-create-button"
              disabled={loading || roomTypes.length === 0}
              title={roomTypes.length === 0 ? "Créez d’abord un type de chambre." : undefined}
              onClick={() => setCreatingRoom(true)}
            >
              <Plus />Nouvelle chambre
            </button>
          </div>
        ) : undefined}
      />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{roomAnnouncement}</p>

      <section className="admin-panel admin-rooms-panel">
        <div className="admin-panel-head admin-room-panel-head">
          <div>
            <h2 ref={roomPanelHeadingRef} tabIndex={-1}>État des chambres</h2>
            <p>{result ? `${result.total} chambre${result.total > 1 ? "s" : ""}` : "Chargement des chambres"}</p>
          </div>
          <div className="admin-room-panel-tools">
            <div className="admin-room-date-controls" role="group" aria-label="Période de disponibilité">
              <label>
                <span>Arrivée</span>
                <input type="date" value={from} onChange={(event) => handleFromChange(event.target.value)} />
              </label>
              <label>
                <span>Départ</span>
                <input
                  type="date"
                  value={to}
                  min={isIsoDate(from) ? addDays(from, 1) : undefined}
                  max={isIsoDate(from) ? addDays(from, 366) : undefined}
                  onChange={(event) => handleToChange(event.target.value)}
                />
              </label>
            </div>
            {filtersActive && <button type="button" className="admin-reset-filters" onClick={resetFilters}><X />Tout effacer</button>}
          </div>
        </div>

        <div className="admin-filters admin-room-filters">
          <label className="admin-filter-search">
            <span className="sr-only">Rechercher</span>
            <Search />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Numéro ou type de chambre…" />
          </label>
          <label>
            <span className="sr-only">État de service</span>
            <Filter />
            <select value={status} onChange={(event) => { setStatus(event.target.value as RoomStatus | ""); setPage(1); }}>
              <option value="">Tous les états</option>
              {roomStatuses.map((item) => <option key={item} value={item}>{roomStatusLabel(item)}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Type de chambre</span>
            <Building2 />
            <select value={roomTypeId} onChange={(event) => { setRoomTypeId(event.target.value); setPage(1); }}>
              <option value="">Tous les types</option>
              {roomTypes.map((roomType) => <option key={roomType.id} value={roomType.id}>{roomType.name}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Ordre des numéros de chambre</span>
            <ArrowUpDown />
            <select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value as "asc" | "desc"); setPage(1); }}>
              <option value="asc">Numéro croissant</option>
              <option value="desc">Numéro décroissant</option>
            </select>
          </label>
        </div>

        {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
        {!error && loading && !result && <RoomCardsSkeleton />}
        {!error && result && result.items.length === 0 && (
          <AdminEmptyState
            title="Aucune chambre trouvée"
            description={filtersActive ? "Essayez de modifier ou d’effacer les filtres appliqués." : "L’inventaire des chambres apparaîtra ici."}
          />
        )}
        {!error && result && result.items.length > 0 && (
          <>
            <div className={`admin-room-cards-wrap ${loading ? "is-refreshing" : ""}`} aria-busy={loading}>
              <div className="admin-room-cards">
                {result.items.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    requestedPeriod={requestedPeriod}
                    timeZone={propertyTimeZone}
                    canEdit={canManageRooms}
                    onOpen={() => setSelectedRoom(room)}
                  />
                ))}
              </div>
            </div>
            <AdminPagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} onPageChange={setPage} />
          </>
        )}
      </section>

      {selectedRoom && (
        <RoomDialog
          room={selectedRoom}
          roomTypes={roomTypes}
          timeZone={propertyTimeZone}
          canEdit={canManageRooms}
          onClose={() => setSelectedRoom(null)}
          onSaved={() => {
            setSelectedRoom(null);
            setRetryKey((value) => value + 1);
          }}
          onDeleted={() => {
            const deletedRoomNumber = selectedRoom.number;
            setSelectedRoom(null);
            if (result?.items.length === 1 && page > 1) setPage((value) => value - 1);
            setRetryKey((value) => value + 1);
            setRoomAnnouncement(`La chambre ${deletedRoomNumber} a été supprimée.`);
            window.requestAnimationFrame(() => roomPanelHeadingRef.current?.focus());
          }}
        />
      )}

      {creatingRoom && canManageRooms && (
        <CreateRoomDialog
          roomTypes={roomTypes}
          onClose={() => setCreatingRoom(false)}
          onCreated={() => {
            setCreatingRoom(false);
            setPage(1);
            setRetryKey((value) => value + 1);
            setRoomAnnouncement("La nouvelle chambre a été créée.");
            window.requestAnimationFrame(() => roomPanelHeadingRef.current?.focus());
          }}
        />
      )}

      {managingRoomTypes && canManageRooms && (
        <AdminRoomTypesDialog
          onClose={() => setManagingRoomTypes(false)}
          onChanged={() => {
            setPage(1);
            setRetryKey((value) => value + 1);
          }}
        />
      )}
    </>
  );
}

function RoomCard({ room, requestedPeriod, timeZone, canEdit, onOpen }: {
  room: AdminRoom;
  requestedPeriod: { from: string; to: string } | null;
  timeZone?: string;
  canEdit: boolean;
  onOpen: () => void;
}) {
  const headingId = useId();
  const roomUnavailable = room.status !== "ACTIVE";
  const periodMatchesRequest = requestedPeriod
    && room.periodAvailability?.from === requestedPeriod.from
    && room.periodAvailability.to === requestedPeriod.to;
  const period = periodMatchesRequest ? room.periodAvailability : null;
  const periodTone = roomUnavailable
    ? "service-unavailable"
    : period?.available === true
      ? "period-available"
      : period?.available === false
        ? "period-unavailable"
        : "neutral";

  return (
    <article
      className={`admin-room-card admin-room-card-${periodTone} admin-room-card-interactive`}
      role="button"
      aria-haspopup="dialog"
      aria-labelledby={headingId}
      tabIndex={0}
      onClick={(event) => {
        event.currentTarget.focus();
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
    >
      <header className="admin-room-card-head">
        <h3 id={headingId} className="admin-room-card-identity">
          <span>Chambre</span>
          <strong>{room.number}</strong>
        </h3>
        <StatusBadge status={room.status} kind="room" />
      </header>

      <div className="admin-room-card-meta">
        <strong>{room.roomType.name}</strong>
        <span><Building2 />{floorLabel(room.floor)}</span>
      </div>

      {roomUnavailable ? (
        <div className="admin-room-card-verdict admin-room-card-verdict-service">
          <CircleOff />
          <div>
            <strong>{roomStatusLabel(room.status)}</strong>
            <span>Cette chambre n’est pas réservable actuellement.</span>
          </div>
        </div>
      ) : period ? (
        <PeriodAvailability availability={period} timeZone={timeZone} />
      ) : requestedPeriod ? (
        <div className="admin-room-card-verdict admin-room-card-verdict-pending" role="status">
          <CalendarClock />
          <div><strong>Calcul de disponibilité en cours</strong><span>Les couleurs apparaîtront dès que cette période aura été vérifiée.</span></div>
        </div>
      ) : (
        <CurrentAvailability room={room} timeZone={timeZone} />
      )}

      {room.notes && <p className="admin-room-card-note"><Wrench />{room.notes}</p>}
      <span className="admin-room-card-open-hint">{canEdit ? <Pencil /> : <Eye />}{canEdit ? "Modifier la chambre" : "Voir le détail"}</span>
    </article>
  );
}

function PeriodAvailability({ availability, timeZone }: {
  availability: NonNullable<AdminRoom["periodAvailability"]>;
  timeZone?: string;
}) {
  if (availability.available) {
    return (
      <div className="admin-room-card-verdict admin-room-card-verdict-available">
        <CheckCircle2 />
        <div>
          <strong>Disponible toute la période</strong>
          <span>Aucun séjour, aucune option ni aucun blocage sur ces dates.</span>
        </div>
      </div>
    );
  }

  const [firstConflict, ...otherConflicts] = availability.conflicts;
  return (
    <div className="admin-room-card-verdict admin-room-card-verdict-unavailable">
      <XCircle />
      <div>
        <strong>Indisponible sur la période</strong>
        {firstConflict ? (
          <>
            <span className="admin-room-conflict-title">{occupancyTitle(firstConflict)}</span>
            <span>{formatDate(firstConflict.checkIn)} → {formatDate(firstConflict.checkOut)}</span>
            <OccupancyDetail occupancy={firstConflict} timeZone={timeZone} />
            {otherConflicts.length > 0 && <em>+ {otherConflicts.length} autre{otherConflicts.length > 1 ? "s" : ""} indisponibilité{otherConflicts.length > 1 ? "s" : ""}</em>}
          </>
        ) : (
          <span>Un conflit empêche la réservation de cette chambre.</span>
        )}
      </div>
    </div>
  );
}

function CurrentAvailability({ room, timeZone }: { room: AdminRoom; timeZone?: string }) {
  return (
    <div className="admin-room-card-schedule">
      <section>
        <p>Actuellement</p>
        {room.currentOccupancy ? (
          <OccupancySummary occupancy={room.currentOccupancy} current timeZone={timeZone} />
        ) : (
          <span className="admin-room-card-free"><CheckCircle2 />Disponible maintenant</span>
        )}
      </section>
      <section>
        <p>Prochaine occupation</p>
        {room.nextOccupancy ? (
          <OccupancySummary occupancy={room.nextOccupancy} timeZone={timeZone} />
        ) : (
          <span className="admin-room-card-empty"><CalendarClock />Aucun séjour planifié</span>
        )}
      </section>
    </div>
  );
}

function OccupancySummary({ occupancy, current = false, timeZone }: {
  occupancy: AdminRoomOccupancy;
  current?: boolean;
  timeZone?: string;
}) {
  return (
    <div className={`admin-room-card-occupancy admin-room-card-occupancy-${occupancy.kind.toLowerCase()}`}>
      <strong>{occupancyTitle(occupancy)}</strong>
      <span>{current ? `Jusqu’au ${formatDate(occupancy.checkOut)}` : `${formatDate(occupancy.checkIn)} → ${formatDate(occupancy.checkOut)}`}</span>
      <OccupancyDetail occupancy={occupancy} timeZone={timeZone} />
    </div>
  );
}

function OccupancyDetail({ occupancy, timeZone }: { occupancy: AdminRoomOccupancy; timeZone?: string }) {
  if (occupancy.kind === "HOLD" && occupancy.holdExpiresAt) {
    return <small>Option jusqu’au {formatDateTime(occupancy.holdExpiresAt, timeZone)} · heure locale</small>;
  }
  if (occupancy.kind === "BLOCK" && occupancy.note) return <small>{occupancy.note}</small>;
  if (occupancy.bookingReference) return <small>{occupancy.bookingReference}</small>;
  return null;
}

type RoomFormState = {
  number: string;
  roomTypeId: string;
  floor: string;
  status: RoomStatus;
  notes: string;
};

function roomFormState(room: AdminRoom): RoomFormState {
  return {
    number: room.number,
    roomTypeId: room.roomType.id,
    floor: room.floor === null ? "" : String(room.floor),
    status: room.status,
    notes: room.notes ?? "",
  };
}

function newRoomFormState(roomTypes: AdminRoomSummary["roomTypes"]): RoomFormState {
  return {
    number: "",
    roomTypeId: roomTypes[0]?.id ?? "",
    floor: "",
    status: "ACTIVE",
    notes: "",
  };
}

function parseRoomForm(form: RoomFormState) {
  const number = form.number.trim();
  const notes = form.notes.trim() || null;
  const floorIsEmpty = form.floor.trim() === "";
  const floor = floorIsEmpty ? null : Number(form.floor);
  const floorIsValid = floor === null
    || (/^-?\d+$/.test(form.floor.trim()) && Number.isSafeInteger(floor) && floor >= -20 && floor <= 300);
  const valid = number.length > 0
    && number.length <= 32
    && Boolean(form.roomTypeId)
    && floorIsValid
    && form.notes.length <= 2_000;
  return { number, notes, floor, floorIsValid, valid };
}

function RoomFormFields({ form, roomTypes, numberInputRef, statusOptions = roomStatuses, onChange }: {
  form: RoomFormState;
  roomTypes: AdminRoomSummary["roomTypes"];
  numberInputRef: RefObject<HTMLInputElement | null>;
  statusOptions?: RoomStatus[];
  onChange: (form: RoomFormState) => void;
}) {
  const parsed = parseRoomForm(form);
  return (
    <div className="admin-room-form-grid">
      <label>
        <span>Numéro</span>
        <input
          ref={numberInputRef}
          value={form.number}
          maxLength={32}
          required
          autoComplete="off"
          aria-invalid={parsed.number.length === 0 || parsed.number.length > 32}
          onChange={(event) => onChange({ ...form, number: event.target.value })}
        />
        {parsed.number.length === 0 && <small>Le numéro est obligatoire.</small>}
      </label>
      <label>
        <span>Type</span>
        <select value={form.roomTypeId} required onChange={(event) => onChange({ ...form, roomTypeId: event.target.value })}>
          {roomTypes.map((roomType) => <option value={roomType.id} key={roomType.id}>{roomType.name}</option>)}
        </select>
      </label>
      <label>
        <span>Étage <em>optionnel</em></span>
        <input
          value={form.floor}
          inputMode="numeric"
          placeholder="Non renseigné"
          aria-invalid={!parsed.floorIsValid}
          onChange={(event) => onChange({ ...form, floor: event.target.value })}
        />
        {!parsed.floorIsValid && <small>Saisissez un étage entier entre -20 et 300.</small>}
      </label>
      <label>
        <span>État</span>
        <select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as RoomStatus })}>
          {statusOptions.map((status) => <option value={status} key={status}>{roomStatusLabel(status)}</option>)}
        </select>
      </label>
      <label className="admin-room-form-notes">
        <span>Notes <em>optionnel</em></span>
        <textarea
          value={form.notes}
          maxLength={2_000}
          rows={4}
          placeholder="Informations utiles pour l’équipe…"
          onChange={(event) => onChange({ ...form, notes: event.target.value })}
        />
        <small>{form.notes.length}/2 000 caractères</small>
      </label>
    </div>
  );
}

function CreateRoomDialog({ roomTypes, onClose, onCreated }: {
  roomTypes: AdminRoomSummary["roomTypes"];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const initialForm = useRef(newRoomFormState(roomTypes));
  const [form, setForm] = useState<RoomFormState>(initialForm.current);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const discardOpenRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const discardDialogRef = useRef<HTMLDivElement>(null);
  const continueEditingRef = useRef<HTMLButtonElement>(null);
  const numberInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const parsed = parseRoomForm(form);
  const dirty = form.number !== initialForm.current.number
    || form.roomTypeId !== initialForm.current.roomTypeId
    || form.floor !== initialForm.current.floor
    || form.status !== initialForm.current.status
    || form.notes !== initialForm.current.notes;
  dirtyRef.current = dirty;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => numberInputRef.current?.focus());

    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (discardOpenRef.current) dismissDiscardPrompt();
        else requestClose();
        return;
      }
      const focusRoot = discardOpenRef.current ? discardDialogRef.current : dialogRef.current;
      if (event.key !== "Tab" || !focusRoot) return;
      const focusable = [...focusRoot.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyboard);
      previousFocus?.focus();
    };
  }, [onClose]);

  function requestClose() {
    if (savingRef.current) return;
    if (dirtyRef.current) {
      discardOpenRef.current = true;
      setConfirmDiscard(true);
      window.requestAnimationFrame(() => continueEditingRef.current?.focus());
      return;
    }
    onClose();
  }

  function dismissDiscardPrompt() {
    discardOpenRef.current = false;
    setConfirmDiscard(false);
    window.requestAnimationFrame(() => numberInputRef.current?.focus());
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || savingRef.current || !parsed.valid) return;
    const input: CreateAdminRoomInput = {
      number: parsed.number,
      roomTypeId: form.roomTypeId,
      floor: parsed.floor,
      status: form.status === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : "ACTIVE",
      notes: parsed.notes,
    };

    setSaving(true);
    savingRef.current = true;
    setSaveError(null);
    try {
      await createAdminRoom(input, accessToken);
      onCreated();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      setSaveError(nextError instanceof Error ? nextError.message : "La création de la chambre a échoué.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="admin-room-dialog-layer admin-room-create-layer">
      <button type="button" className="admin-room-dialog-backdrop" aria-label="Fermer la création de chambre" disabled={saving || confirmDiscard} aria-hidden={confirmDiscard || undefined} onClick={requestClose} />
      <section
        ref={dialogRef}
        className="admin-room-dialog admin-room-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="admin-room-dialog-head" inert={confirmDiscard || undefined} aria-hidden={confirmDiscard || undefined}>
          <div>
            <p>Nouvelle chambre</p>
            <h2 id={titleId}>Ajouter à l’inventaire</h2>
            <span id={descriptionId}>Renseignez les informations de la chambre physique.</span>
          </div>
          <button type="button" disabled={saving} onClick={requestClose} aria-label="Fermer"><X /></button>
        </header>
        <form className="admin-room-dialog-body admin-room-create-form" onSubmit={submitRoom} noValidate aria-busy={saving} inert={confirmDiscard || undefined} aria-hidden={confirmDiscard || undefined}>
          <section className="admin-room-dialog-section">
            <h3><Building2 />Informations de la chambre</h3>
            <RoomFormFields
              form={form}
              roomTypes={roomTypes}
              numberInputRef={numberInputRef}
              statusOptions={["ACTIVE", "OUT_OF_SERVICE"]}
              onChange={setForm}
            />
          </section>
          {saveError && <p className="admin-room-save-error" role="alert">{saveError}</p>}
          <footer className="admin-room-dialog-actions">
            <span>{dirty ? "Création non enregistrée" : "Les champs obligatoires sont signalés"}</span>
            <div>
              <button type="button" className="admin-room-dialog-cancel" disabled={saving} onClick={requestClose}>Annuler</button>
              <button type="submit" className="admin-room-dialog-save admin-room-create-submit" disabled={!parsed.valid || saving}>
                {saving ? <span className="admin-spinner light" /> : <Plus />}
                {saving ? "Création…" : "Créer la chambre"}
              </button>
            </div>
          </footer>
        </form>

        {confirmDiscard && (
          <div className="admin-room-discard-layer">
            <div
              ref={discardDialogRef}
              className="admin-room-discard-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`${titleId}-discard-title`}
              aria-describedby={`${titleId}-discard-description`}
            >
              <h3 id={`${titleId}-discard-title`}>Abandonner cette création ?</h3>
              <p id={`${titleId}-discard-description`}>Les informations saisies ne seront pas enregistrées.</p>
              <div>
                <button ref={continueEditingRef} type="button" onClick={dismissDiscardPrompt}>Poursuivre la saisie</button>
                <button type="button" className="danger" onClick={onClose}>Abandonner</button>
              </div>
            </div>
          </div>
        )}

      </section>
    </div>
  );
}

function RoomDialog({ room, roomTypes, timeZone, canEdit, onClose, onSaved, onDeleted }: {
  room: AdminRoom;
  roomTypes: AdminRoomSummary["roomTypes"];
  timeZone?: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const [form, setForm] = useState<RoomFormState>(() => roomFormState(room));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [blockEditorOpen, setBlockEditorOpen] = useState(false);
  const [blockForm, setBlockForm] = useState<AdminAvailabilityBlockInput>(() => {
    const checkIn = todayInputValue();
    return { checkIn, checkOut: addDays(checkIn, 1), reason: "MAINTENANCE", note: "" };
  });
  const [blockCreating, setBlockCreating] = useState(false);
  const [blockReleasingId, setBlockReleasingId] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const discardOpenRef = useRef(false);
  const deleteOpenRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const discardDialogRef = useRef<HTMLDivElement>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const continueEditingRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreDeleteFocusRef = useRef(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const numberInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const nestedDialogOpen = confirmDiscard || confirmDelete;
  const visibleBlocks = [...new Map(
    [room.currentOccupancy, room.nextOccupancy, ...(room.periodAvailability?.conflicts ?? [])]
      .filter((occupancy): occupancy is AdminRoomOccupancy => occupancy?.kind === "BLOCK" && Boolean(occupancy.blockId))
      .map((occupancy) => [occupancy.blockId!, occupancy]),
  ).values()];

  const parsed = parseRoomForm(form);
  const initialNotes = room.notes?.trim() || null;
  const dirty = parsed.number !== room.number
    || form.roomTypeId !== room.roomType.id
    || parsed.floor !== room.floor
    || form.status !== room.status
    || parsed.notes !== initialNotes;
  dirtyRef.current = dirty;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      (canEdit ? numberInputRef.current : closeButtonRef.current)?.focus();
    });

    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (deleteOpenRef.current) {
          dismissDeletePrompt();
        } else if (discardOpenRef.current) {
          dismissDiscardPrompt();
        } else {
          requestClose();
        }
        return;
      }
      const focusRoot = deleteOpenRef.current
        ? deleteDialogRef.current
        : discardOpenRef.current
          ? discardDialogRef.current
          : dialogRef.current;
      if (event.key !== "Tab" || !focusRoot) return;
      const focusable = [...focusRoot.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyboard);
      previousFocus?.focus();
    };
  }, [canEdit, onClose]);

  useEffect(() => {
    if (confirmDelete || !restoreDeleteFocusRef.current) return;
    restoreDeleteFocusRef.current = false;
    deleteTriggerRef.current?.focus();
  }, [confirmDelete]);

  function requestClose() {
    if (pendingRef.current) return;
    if (canEdit && dirtyRef.current) {
      discardOpenRef.current = true;
      setConfirmDiscard(true);
      window.requestAnimationFrame(() => continueEditingRef.current?.focus());
      return;
    }
    onClose();
  }

  function dismissDiscardPrompt() {
    discardOpenRef.current = false;
    setConfirmDiscard(false);
    window.requestAnimationFrame(() => (canEdit ? numberInputRef.current : closeButtonRef.current)?.focus());
  }

  function openDeletePrompt() {
    if (pendingRef.current) return;
    setDeleteConfirmation("");
    setDeleteError(null);
    deleteOpenRef.current = true;
    setConfirmDelete(true);
    window.requestAnimationFrame(() => deleteCancelRef.current?.focus());
  }

  function dismissDeletePrompt() {
    if (pendingRef.current) return;
    restoreDeleteFocusRef.current = true;
    deleteOpenRef.current = false;
    setConfirmDelete(false);
    setDeleteConfirmation("");
    setDeleteError(null);
  }

  async function createBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !accessToken || pendingRef.current || !isIsoDate(blockForm.checkIn) || !isIsoDate(blockForm.checkOut) || blockForm.checkOut <= blockForm.checkIn) return;
    setBlockCreating(true);
    pendingRef.current = true;
    setBlockError(null);
    try {
      await createAdminAvailabilityBlock(room.id, { ...blockForm, note: blockForm.note?.trim() || null }, accessToken);
      onSaved();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      setBlockError(nextError instanceof Error ? nextError.message : "Le blocage n’a pas pu être créé.");
    } finally {
      pendingRef.current = false;
      setBlockCreating(false);
    }
  }

  async function releaseBlock(blockId: string) {
    if (!canEdit || !accessToken || pendingRef.current) return;
    setBlockReleasingId(blockId);
    pendingRef.current = true;
    setBlockError(null);
    try {
      await releaseAdminAvailabilityBlock(blockId, accessToken);
      onSaved();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      setBlockError(nextError instanceof Error ? nextError.message : "Le blocage n’a pas pu être levé.");
    } finally {
      pendingRef.current = false;
      setBlockReleasingId(null);
    }
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !accessToken || pendingRef.current || !dirty || !parsed.valid) return;

    const input: UpdateAdminRoomInput = { updatedAt: room.updatedAt };
    if (parsed.number !== room.number) input.number = parsed.number;
    if (form.roomTypeId !== room.roomType.id) input.roomTypeId = form.roomTypeId;
    if (parsed.floor !== room.floor) input.floor = parsed.floor;
    if (form.status !== room.status) input.status = form.status;
    if (parsed.notes !== initialNotes) input.notes = parsed.notes;

    setSaving(true);
    pendingRef.current = true;
    setSaveError(null);
    try {
      await updateAdminRoom(room.id, input, accessToken);
      onSaved();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      if (nextError instanceof AdminApiError
        && nextError.status === 409
        && (nextError.code === "ROOM_VERSION_CONFLICT" || nextError.code === "ROOM_UPDATE_CONFLICT")) {
        setSaveError("Cette chambre a été modifiée par un autre utilisateur. Fermez puis rouvrez la fiche pour charger sa version la plus récente.");
      } else {
        setSaveError(nextError instanceof Error ? nextError.message : "La modification de la chambre a échoué.");
      }
    } finally {
      pendingRef.current = false;
      setSaving(false);
    }
  }

  async function confirmRoomDeletion() {
    if (!canEdit || !accessToken || pendingRef.current || deleteConfirmation !== room.number) return;
    setDeleting(true);
    pendingRef.current = true;
    setDeleteError(null);
    try {
      await deleteAdminRoom(room.id, { updatedAt: room.updatedAt }, accessToken);
      onDeleted();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      if (nextError instanceof AdminApiError && nextError.code === "ROOM_HAS_HISTORY") {
        setDeleteError(`${nextError.message} Annulez cette suppression puis passez plutôt la chambre à l’état « Archivée » (ou « Hors service » si l’indisponibilité est temporaire).`);
      } else if (nextError instanceof AdminApiError
        && nextError.status === 409
        && (nextError.code === "ROOM_VERSION_CONFLICT" || nextError.code === "ROOM_DELETE_CONFLICT")) {
        setDeleteError("Cette chambre a été modifiée par un autre utilisateur. Fermez puis rouvrez la fiche avant de réessayer.");
      } else {
        setDeleteError(nextError instanceof Error ? nextError.message : "La suppression de la chambre a échoué.");
      }
    } finally {
      pendingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <div className="admin-room-dialog-layer">
      <button type="button" className="admin-room-dialog-backdrop" aria-label="Fermer la fiche de la chambre" disabled={saving || deleting || blockCreating || Boolean(blockReleasingId) || nestedDialogOpen} aria-hidden={nestedDialogOpen || undefined} onClick={requestClose} />
      <section
        ref={dialogRef}
        className="admin-room-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="admin-room-dialog-head" inert={nestedDialogOpen || undefined} aria-hidden={nestedDialogOpen || undefined}>
          <div>
            <p>{canEdit ? "Modifier la chambre" : "Détail de la chambre"}</p>
            <h2 id={titleId}>Chambre {room.number}</h2>
            <span id={descriptionId}>{canEdit ? "Mettez à jour les informations d’inventaire." : "Consultation en lecture seule."}</span>
          </div>
          <button ref={closeButtonRef} type="button" disabled={saving || deleting || blockCreating || Boolean(blockReleasingId)} onClick={requestClose} aria-label="Fermer"><X /></button>
        </header>

        <div className="admin-room-dialog-body" inert={nestedDialogOpen || undefined} aria-hidden={nestedDialogOpen || undefined}>
          <section className="admin-room-dialog-section" aria-labelledby={`${titleId}-planning`}>
            <h3 id={`${titleId}-planning`}><CalendarClock />Planning</h3>
            <div className="admin-room-dialog-occupancies">
              <div>
                <p>Actuellement</p>
                {room.currentOccupancy
                  ? <OccupancySummary occupancy={room.currentOccupancy} current timeZone={timeZone} />
                  : <span className="admin-room-card-free"><CheckCircle2 />Disponible maintenant</span>}
              </div>
              <div>
                <p>Prochaine occupation</p>
                {room.nextOccupancy
                  ? <OccupancySummary occupancy={room.nextOccupancy} timeZone={timeZone} />
                  : <span className="admin-room-card-empty"><CalendarClock />Aucun séjour planifié</span>}
              </div>
            </div>
          </section>

          {canEdit && <section className="admin-room-dialog-section admin-room-block-management">
            <div className="admin-room-block-head"><h3><Wrench />Blocages opérationnels</h3><button type="button" disabled={blockCreating || Boolean(blockReleasingId)} onClick={() => { setBlockEditorOpen((value) => !value); setBlockError(null); }}><Plus />Nouveau blocage</button></div>
            {visibleBlocks.length > 0 && <div className="admin-room-block-list">{visibleBlocks.map((block) => <div key={block.blockId}><span><strong>{blockReasonLabels[block.blockReason ?? "OTHER"] ?? "Indisponibilité"}</strong><small>{formatDate(block.checkIn)} → {formatDate(block.checkOut)}{block.note ? ` · ${block.note}` : ""}</small></span><button type="button" disabled={Boolean(blockReleasingId)} onClick={() => releaseBlock(block.blockId!)}>{blockReleasingId === block.blockId ? "Suppression…" : "Lever"}</button></div>)}</div>}
            {blockEditorOpen && <form className="admin-room-block-form" onSubmit={createBlock}>
              <label><span>Début</span><input type="date" value={blockForm.checkIn} onChange={(event) => { const checkIn = event.target.value; setBlockForm((current) => ({ ...current, checkIn, checkOut: current.checkOut <= checkIn ? addDays(checkIn, 1) : current.checkOut })); }} required /></label>
              <label><span>Fin</span><input type="date" min={addDays(blockForm.checkIn, 1)} value={blockForm.checkOut} onChange={(event) => setBlockForm((current) => ({ ...current, checkOut: event.target.value }))} required /></label>
              <label><span>Motif</span><select value={blockForm.reason} onChange={(event) => setBlockForm((current) => ({ ...current, reason: event.target.value as AdminAvailabilityBlockInput["reason"] }))}><option value="MAINTENANCE">Maintenance</option><option value="HOUSEKEEPING">Entretien</option><option value="OWNER_USE">Usage propriétaire</option><option value="OTHER">Autre</option></select></label>
              <label className="wide"><span>Note <em>facultative</em></span><textarea rows={3} maxLength={1000} value={blockForm.note ?? ""} onChange={(event) => setBlockForm((current) => ({ ...current, note: event.target.value }))} /></label>
              <div className="wide"><button type="button" disabled={blockCreating} onClick={() => { setBlockEditorOpen(false); setBlockError(null); }}>Annuler</button><button type="submit" className="primary" disabled={blockCreating || blockForm.checkOut <= blockForm.checkIn}>{blockCreating ? "Création…" : "Bloquer la chambre"}</button></div>
            </form>}
            {blockError && <p className="admin-room-save-error" role="alert">{blockError}</p>}
          </section>}

          {canEdit ? (
            <form className="admin-room-edit-form" onSubmit={submitRoom} noValidate aria-busy={saving || deleting}>
              <section className="admin-room-dialog-section">
                <h3><Pencil />Informations de la chambre</h3>
                <RoomFormFields form={form} roomTypes={roomTypes} numberInputRef={numberInputRef} onChange={setForm} />
              </section>

              {saveError && <p className="admin-room-save-error" role="alert">{saveError}</p>}
              <footer className="admin-room-dialog-actions admin-room-dialog-actions-edit">
                <button
                  ref={deleteTriggerRef}
                  type="button"
                  className="admin-room-delete-trigger"
                  disabled={saving || deleting}
                  onClick={openDeletePrompt}
                >
                  <Trash2 />Supprimer la chambre
                </button>
                <span>{dirty ? "Modifications non enregistrées" : "Aucune modification"}</span>
                <div>
                  <button type="button" className="admin-room-dialog-cancel" disabled={saving || deleting} onClick={requestClose}>Annuler</button>
                  <button type="submit" className="admin-room-dialog-save" disabled={!dirty || !parsed.valid || saving || deleting}>
                    {saving ? <span className="admin-spinner light" /> : <Save />}
                    {saving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>
              </footer>
            </form>
          ) : (
            <>
              <section className="admin-room-dialog-section">
                <h3><Eye />Informations</h3>
                <dl className="admin-room-readonly-grid">
                  <div><dt>Numéro</dt><dd>{room.number}</dd></div>
                  <div><dt>Type</dt><dd>{room.roomType.name}</dd></div>
                  <div><dt>Étage</dt><dd>{floorLabel(room.floor)}</dd></div>
                  <div><dt>État</dt><dd>{roomStatusLabel(room.status)}</dd></div>
                  <div className="wide"><dt>Notes</dt><dd>{room.notes || "Aucune note"}</dd></div>
                </dl>
              </section>
              <footer className="admin-room-dialog-actions admin-room-dialog-actions-readonly">
                <span>Dernière mise à jour : {formatDateTime(room.updatedAt, timeZone)}</span>
                <button type="button" className="admin-room-dialog-save" onClick={onClose}>Fermer</button>
              </footer>
            </>
          )}
        </div>

        {confirmDiscard && (
          <div className="admin-room-discard-layer">
            <div
              ref={discardDialogRef}
              className="admin-room-discard-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`${titleId}-discard-title`}
              aria-describedby={`${titleId}-discard-description`}
            >
              <h3 id={`${titleId}-discard-title`}>Abandonner les modifications ?</h3>
              <p id={`${titleId}-discard-description`}>Les informations saisies dans cette fiche ne seront pas enregistrées.</p>
              <div>
                <button ref={continueEditingRef} type="button" onClick={dismissDiscardPrompt}>Poursuivre l’édition</button>
                <button type="button" className="danger" onClick={onClose}>Abandonner</button>
              </div>
            </div>
          </div>
        )}

        {confirmDelete && (
          <div className="admin-room-delete-layer">
            <div
              ref={deleteDialogRef}
              className="admin-room-delete-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`${titleId}-delete-title`}
              aria-describedby={`${titleId}-delete-description`}
              aria-busy={deleting}
            >
              <span className="admin-room-delete-icon" aria-hidden="true"><Trash2 /></span>
              <div className="admin-room-delete-copy">
                <h3 id={`${titleId}-delete-title`}>Supprimer la chambre {room.number} ?</h3>
                <p id={`${titleId}-delete-description`}>
                  Cette action est définitive et n’est possible que si cette chambre n’a jamais été utilisée. Si vous souhaitez simplement la retirer de la vente, annulez puis choisissez l’état « Archivée » ou « Hors service ».
                </p>
              </div>
              <label>
                <span>Saisissez <strong>{room.number}</strong> pour confirmer</span>
                <input
                  value={deleteConfirmation}
                  autoComplete="off"
                  disabled={deleting}
                  aria-label={`Saisissez ${room.number} pour confirmer la suppression`}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                />
              </label>
              {deleteError && <p className="admin-room-delete-error" role="alert">{deleteError}</p>}
              <div className="admin-room-delete-actions">
                <button ref={deleteCancelRef} type="button" disabled={deleting} onClick={dismissDeletePrompt}>Annuler</button>
                <button
                  type="button"
                  className="danger"
                  disabled={deleteConfirmation !== room.number || deleting}
                  onClick={confirmRoomDeletion}
                >
                  {deleting ? <span className="admin-spinner light" /> : <Trash2 />}
                  {deleting ? "Suppression…" : "Supprimer définitivement"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RoomCardsSkeleton() {
  return (
    <div className="admin-room-cards admin-room-cards-skeleton" role="status" aria-label="Chargement des chambres">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="admin-room-card-skeleton" key={index}>
          <span /><span /><span /><span />
        </div>
      ))}
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
