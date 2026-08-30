import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  Ban,
  BedDouble,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  Clock3,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AdminApiError,
  AdminBooking,
  AdminRoom,
  AdminRoomOccupancy,
  AdminRoomSummary,
  PaginatedAdminResult,
  getAdminBookings,
  getAdminRooms,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import { AdminErrorState, PageHeading, StatusBadge, formatDate } from "../../admin/ui";

const RANGE_DAYS = 14;

function inputDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return inputDate(date);
}

function datesFrom(start: string) {
  return Array.from({ length: RANGE_DAYS }, (_, index) => addDays(start, index));
}

function occupancyOnDate(conflicts: AdminRoomOccupancy[], date: string) {
  return conflicts.find((conflict) => conflict.checkIn <= date && conflict.checkOut > date) ?? null;
}

const blockLabels: Record<NonNullable<AdminRoomOccupancy["blockReason"]>, string> = {
  MAINTENANCE: "Maintenance",
  OWNER_USE: "Usage privé",
  HOUSEKEEPING: "Ménage",
  OTHER: "Bloquée",
};

function occupancyLabel(occupancy: AdminRoomOccupancy) {
  if (occupancy.kind === "BLOCK") return occupancy.blockReason ? blockLabels[occupancy.blockReason] : "Bloquée";
  if (occupancy.kind === "HOLD") return occupancy.bookingReference ? `Option ${occupancy.bookingReference}` : "Option en cours";
  if (occupancy.guest) return `${occupancy.guest.firstName} ${occupancy.guest.lastName}`;
  return occupancy.bookingReference ?? "Séjour confirmé";
}

function occupancyTone(occupancy: AdminRoomOccupancy) {
  if (occupancy.kind === "BLOCK") return "block";
  if (occupancy.kind === "HOLD") return "hold";
  return occupancy.status === "CONFIRMED" || occupancy.status === "CHECKED_IN" ? "booking" : "neutral";
}

function guestName(booking: AdminBooking) {
  return booking.guest ? `${booking.guest.firstName} ${booking.guest.lastName}` : "Client non renseigné";
}

export function AdminPlanning() {
  const { accessToken, logout, profile } = useAdminAuth();
  const navigate = useNavigate();
  const today = useMemo(() => inputDate(), []);
  const canOpenBookings = profile?.membership.role === "ADMIN" || profile?.membership.role === "RECEPTION";
  const [rangeStart, setRangeStart] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [rooms, setRooms] = useState<PaginatedAdminResult<AdminRoom, AdminRoomSummary> | null>(null);
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const dates = useMemo(() => datesFrom(rangeStart), [rangeStart]);
  const rangeEnd = addDays(rangeStart, RANGE_DAYS);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const roomRequest = getAdminRooms({
      page: 1,
      pageSize: 100,
      from: rangeStart,
      to: rangeEnd,
      sortOrder: "asc",
    }, accessToken, controller.signal).then(async (firstPage) => {
      if (firstPage.totalPages <= 1) return firstPage;
      const remainingPages = await Promise.all(Array.from(
        { length: firstPage.totalPages - 1 },
        (_, index) => getAdminRooms({
          page: index + 2,
          pageSize: 100,
          from: rangeStart,
          to: rangeEnd,
          sortOrder: "asc",
        }, accessToken, controller.signal),
      ));
      return { ...firstPage, items: [firstPage, ...remainingPages].flatMap((page) => page.items) };
    });
    const bookingRequest = canOpenBookings
      ? getAdminBookings({
          page: 1,
          pageSize: 100,
          from: rangeStart,
          to: addDays(rangeEnd, -1),
        }, accessToken, controller.signal).then(async (firstPage) => {
          if (firstPage.totalPages <= 1) return firstPage.items;
          const remainingPages = await Promise.all(Array.from(
            { length: firstPage.totalPages - 1 },
            (_, index) => getAdminBookings({
              page: index + 2,
              pageSize: 100,
              from: rangeStart,
              to: addDays(rangeEnd, -1),
            }, accessToken, controller.signal),
          ));
          return [firstPage, ...remainingPages].flatMap((page) => page.items);
        })
      : Promise.resolve(null);

    Promise.all([roomRequest, bookingRequest])
      .then(([roomData, bookingData]) => {
        setRooms(roomData);
        setBookings(bookingData);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
        setError(nextError instanceof Error ? nextError.message : "Le planning n’a pas pu être chargé.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accessToken, canOpenBookings, logout, rangeEnd, rangeStart, retryKey]);

  const allConflicts = rooms?.items.flatMap((room) => room.periodAvailability?.conflicts ?? []) ?? [];
  const arrivalMovements = allConflicts.filter((conflict) => conflict.kind === "BOOKING" && conflict.checkIn === selectedDate).length;
  const departureMovements = allConflicts.filter((conflict) => conflict.kind === "BOOKING" && conflict.checkOut === selectedDate).length;
  const blockedRooms = rooms?.items.filter((room) => {
    if (room.status !== "ACTIVE") return true;
    return Boolean(occupancyOnDate(room.periodAvailability?.conflicts ?? [], selectedDate)?.kind === "BLOCK");
  }).length ?? 0;
  const occupiedRooms = rooms?.items.filter((room) => {
    const occupancy = occupancyOnDate(room.periodAvailability?.conflicts ?? [], selectedDate);
    return occupancy?.kind === "BOOKING" || occupancy?.kind === "HOLD";
  }).length ?? 0;
  const dailyBookings = bookings?.filter((booking) => booking.status === "CONFIRMED" || booking.status === "CHECKED_IN") ?? [];
  const arrivals = dailyBookings.filter((booking) => booking.checkIn === selectedDate);
  const departures = dailyBookings.filter((booking) => booking.checkOut === selectedDate);
  const inHouse = dailyBookings.filter((booking) => booking.checkIn < selectedDate && booking.checkOut > selectedDate);
  const pendingOptions = bookings?.filter((booking) => booking.status === "PENDING_PAYMENT" && booking.checkIn === selectedDate) ?? [];

  function moveRange(days: number) {
    const next = addDays(rangeStart, days);
    setRangeStart(next);
    setSelectedDate(next);
  }

  function resetToday() {
    setRangeStart(today);
    setSelectedDate(today);
  }

  function openBooking(id: string) {
    navigate(`/admin/reservations?booking=${encodeURIComponent(id)}`);
  }

  return (
    <>
      <PageHeading
        eyebrow="Organisation opérationnelle"
        title="Planning"
        description="Visualisez les occupations, options et blocages, puis ouvrez directement les séjours à traiter."
      />

      <section className="admin-planning-toolbar" aria-label="Période du planning">
        <div>
          <button type="button" onClick={() => moveRange(-RANGE_DAYS)} aria-label="Période précédente"><ArrowLeft /></button>
          <button type="button" className="today" onClick={resetToday}><RotateCcw />Aujourd’hui</button>
          <button type="button" onClick={() => moveRange(RANGE_DAYS)} aria-label="Période suivante"><ArrowRight /></button>
        </div>
        <label><CalendarClock /><span>Début</span><input type="date" value={rangeStart} onChange={(event) => { setRangeStart(event.target.value); setSelectedDate(event.target.value); }} /></label>
        <p>{formatDate(rangeStart)} — {formatDate(addDays(rangeEnd, -1))}</p>
      </section>

      <section className="admin-planning-metrics" aria-label={`Opérations du ${formatDate(selectedDate)}`}>
        <div><ArrowDownToLine /><span><strong>{arrivalMovements}</strong><small>arrivée{arrivalMovements > 1 ? "s" : ""}</small></span></div>
        <div><ArrowUpFromLine /><span><strong>{departureMovements}</strong><small>départ{departureMovements > 1 ? "s" : ""}</small></span></div>
        <div><BedDouble /><span><strong>{occupiedRooms}</strong><small>occupée{occupiedRooms > 1 ? "s" : ""}</small></span></div>
        <div><Ban /><span><strong>{blockedRooms}</strong><small>indisponible{blockedRooms > 1 ? "s" : ""}</small></span></div>
      </section>

      {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
      {!error && (
        <div className="admin-planning-layout">
          <section className={`admin-planning-board ${loading ? "is-loading" : ""}`} aria-label="Occupation des chambres sur quatorze jours">
            <div className="admin-planning-legend">
              <span><i className="booking" />Réservation</span>
              <span><i className="hold" />Option</span>
              <span><i className="block" />Blocage</span>
              <span><i className="free" />Disponible</span>
            </div>
            <div className="admin-planning-scroll">
              <table style={{ minWidth: `${190 + dates.length * 112}px` }}>
                <thead>
                  <tr>
                    <th>Chambre</th>
                    {dates.map((date) => <th key={date} className={`${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""}`}><button type="button" onClick={() => setSelectedDate(date)}><span>{formatDate(date, { weekday: "short" })}</span><strong>{new Date(`${date}T12:00:00`).getDate()}</strong></button></th>)}
                  </tr>
                </thead>
                <tbody>
                  {rooms?.items.map((room) => (
                    <tr key={room.id}>
                      <th scope="row"><strong>{room.number}</strong><span>{room.roomType.name}</span></th>
                      {dates.map((date) => {
                        const occupancy = occupancyOnDate(room.periodAvailability?.conflicts ?? [], date);
                        const unavailable = room.status !== "ACTIVE";
                        const clickable = Boolean(occupancy?.bookingId && canOpenBookings);
                        return <td key={date} className={`${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""}`}>
                          {unavailable ? <span className="admin-planning-slot out"><Ban />Hors service</span> : occupancy ? (
                            <button
                              type="button"
                              className={`admin-planning-slot ${occupancyTone(occupancy)} ${clickable ? "clickable" : ""}`}
                              disabled={!clickable}
                              title={`${occupancyLabel(occupancy)} · ${formatDate(occupancy.checkIn)} → ${formatDate(occupancy.checkOut)}`}
                              onClick={() => occupancy.bookingId && openBooking(occupancy.bookingId)}
                            >
                              <span>{occupancyLabel(occupancy)}</span>
                              <small>{occupancy.checkIn === date ? "Arrivée" : occupancy.checkOut === addDays(date, 1) ? "Départ demain" : "En séjour"}</small>
                            </button>
                          ) : <span className="admin-planning-slot free"><CircleCheck />Libre</span>}
                        </td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && rooms?.items.length === 0 && <p className="admin-planning-empty">Aucune chambre à afficher.</p>}
            </div>
          </section>

          <aside className="admin-daily-operations">
            <header><p>Journée sélectionnée</p><h2>{formatDate(selectedDate, { weekday: "long" })}</h2></header>
            {!canOpenBookings && <p className="admin-daily-readonly">Les mouvements sont visibles sans exposer l’identité des clients.</p>}
            {canOpenBookings && <>
              <DailyBookingGroup icon={<ArrowDownToLine />} title="Arrivées" bookings={arrivals} empty="Aucune arrivée" onOpen={openBooking} />
              <DailyBookingGroup icon={<ArrowUpFromLine />} title="Départs" bookings={departures} empty="Aucun départ" onOpen={openBooking} />
              <DailyBookingGroup icon={<Clock3 />} title="En séjour" bookings={inHouse} empty="Aucun séjour en cours" onOpen={openBooking} />
              <DailyBookingGroup icon={<Clock3 />} title="Options à confirmer" bookings={pendingOptions} empty="Aucune option à traiter" onOpen={openBooking} />
            </>}
            <footer><small>Les changements de statut et d’affectation se font depuis le dossier de réservation afin de conserver une trace d’audit.</small></footer>
          </aside>
        </div>
      )}
    </>
  );
}

function DailyBookingGroup({ icon, title, bookings, empty, onOpen }: {
  icon: React.ReactNode;
  title: string;
  bookings: AdminBooking[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  return <section className="admin-daily-group">
    <h3>{icon}{title}<span>{bookings.length}</span></h3>
    {bookings.length === 0 ? <p>{empty}</p> : <div>{bookings.map((booking) => (
      <button type="button" key={booking.id} onClick={() => onOpen(booking.id)}>
        <span><strong>{guestName(booking)}</strong><small>{booking.rooms[0]?.roomNumber ? `Chambre ${booking.rooms[0].roomNumber}` : booking.rooms[0]?.roomTypeName ?? "À attribuer"}</small></span>
        <span><StatusBadge status={booking.status} kind="booking" /><ChevronRight /></span>
      </button>
    ))}</div>}
  </section>;
}
