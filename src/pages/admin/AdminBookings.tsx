import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  BedDouble,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CreditCard,
  FileDown,
  Filter,
  Mail,
  Phone,
  Pencil,
  Plus,
  Search,
  RotateCcw,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AdminApiError,
  AdminBooking,
  AdminBookingDetail,
  AdminBookingSummary,
  AdminAvailableBookingRoom,
  AdminInvoice,
  BookingStatus,
  PaginatedAdminResult,
  assignAdminBookingRoom,
  confirmAdminBooking,
  getAvailableAdminBookingRooms,
  getAdminBooking,
  getAdminBookingInvoices,
  getAdminBookings,
  downloadAdminInvoice,
  recordManualAdminPayment,
  refundAdminPayment,
  updateAdminBookingStatus,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import { AdminBookingCreateDialog } from "./AdminBookingCreateDialog";
import { AdminBookingEditDialog } from "./AdminBookingEditDialog";
import {
  AdminEmptyState,
  AdminErrorState,
  AdminPagination,
  AdminTableSkeleton,
  MetricCard,
  PageHeading,
  StatusBadge,
  bookingStatusLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  stayNights,
} from "../../admin/ui";

const PAGE_SIZE = 5;

const bookingStatuses: BookingStatus[] = [
  "CONFIRMED",
  "CHECKED_IN",
  "PENDING_PAYMENT",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
  "DRAFT",
  "EXPIRED",
];

const emptySummary: AdminBookingSummary = {
  total: 0,
  byStatus: {},
  arrivalsToday: 0,
  departuresToday: 0,
};

function guestName(booking: Pick<AdminBooking, "guest">) {
  return booking.guest ? `${booking.guest.firstName} ${booking.guest.lastName}` : "Client non renseigné";
}

function roomsLabel(booking: Pick<AdminBooking, "rooms">) {
  if (!booking.rooms.length) return "Non attribuée";
  return booking.rooms.map((room) => room.roomNumber ? `${room.roomTypeName} · ${room.roomNumber}` : room.roomTypeName).join(", ");
}

function dateInTimeZone(timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function AdminBookings() {
  const { accessToken, logout, profile } = useAdminAuth();
  const propertyTimeZone = profile?.membership.property.timezone;
  const isAccounting = profile?.membership.role === "ACCOUNTING";
  const canCreateBooking = profile?.membership.role === "ADMIN" || profile?.membership.role === "RECEPTION";
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<BookingStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [result, setResult] = useState<PaginatedAdminResult<AdminBooking, AdminBookingSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [urlSearchParams, setUrlSearchParams] = useSearchParams();

  useEffect(() => {
    const bookingId = urlSearchParams.get("booking");
    if (bookingId) setSelectedBookingId(bookingId);
  }, [urlSearchParams]);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminBookings({
      page,
      pageSize: PAGE_SIZE,
      search: deferredSearch.trim(),
      status,
      from,
      to,
      todayOnly: todayOnly || undefined,
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
  }, [accessToken, deferredSearch, from, logout, page, retryKey, status, to, todayOnly]);

  const summary = result?.summary ?? emptySummary;
  const filtersActive = Boolean(search || status || from || to || todayOnly);

  function resetFilters() {
    setSearch("");
    setStatus("");
    setFrom("");
    setTo("");
    setTodayOnly(false);
    setPage(1);
  }

  function closeBookingDetail() {
    setSelectedBookingId(null);
    if (!urlSearchParams.has("booking")) return;
    const nextParams = new URLSearchParams(urlSearchParams);
    nextParams.delete("booking");
    setUrlSearchParams(nextParams, { replace: true });
  }

  return (
    <>
      <PageHeading
        eyebrow={isAccounting ? "Suivi financier" : "Pilotage des séjours"}
        title="Réservations"
        description={isAccounting
          ? "Consultez les règlements, remboursements et documents de chaque réservation."
          : "Consultez les arrivées, les départs et le détail de chaque séjour."}
        action={canCreateBooking ? <button type="button" className="admin-room-create-button admin-booking-create-button" onClick={() => setCreateDialogOpen(true)}><Plus />Nouvelle réservation</button> : undefined}
      />

      <section className="admin-metrics" aria-label="Synthèse des réservations">
        <MetricCard label="Réservations" value={summary.total} detail="selon la recherche" icon={<CalendarCheck />} />
        <MetricCard label="Arrivées aujourd’hui" value={summary.arrivalsToday} detail="à accueillir" icon={<ArrowDownToLine />} />
        <MetricCard label="Départs aujourd’hui" value={summary.departuresToday} detail="à préparer" icon={<ArrowUpFromLine />} />
        <MetricCard label="Séjours actifs" value={(summary.byStatus.CONFIRMED ?? 0) + (summary.byStatus.CHECKED_IN ?? 0)} detail="confirmés ou arrivés" icon={<CircleCheck />} />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div><h2>Toutes les réservations</h2><p>{result ? `${result.total} résultat${result.total > 1 ? "s" : ""}` : "Chargement des résultats"}</p></div>
          <div className="admin-panel-head-actions">
            <label className="admin-today-only"><input type="checkbox" checked={todayOnly} onChange={(event) => { setTodayOnly(event.target.checked); if (event.target.checked) { setFrom(""); setTo(""); } setPage(1); }} /><CalendarDays />Aujourd’hui</label>
            {filtersActive && <button type="button" className="admin-reset-filters" onClick={resetFilters}><X />Effacer les filtres</button>}
          </div>
        </div>

        <div className="admin-filters">
          <label className="admin-filter-search"><span className="sr-only">Rechercher</span><Search /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={isAccounting ? "Référence, client, chambre…" : "Référence, client, e-mail…"} /></label>
          <label><span className="sr-only">Statut</span><Filter /><select value={status} onChange={(event) => { setStatus(event.target.value as BookingStatus | ""); setPage(1); }}><option value="">Tous les statuts</option>{bookingStatuses.map((item) => <option key={item} value={item}>{bookingStatusLabel(item)}</option>)}</select></label>
          <label className="admin-date-filter"><span>Du</span><CalendarDays /><input type="date" value={from} max={to || undefined} disabled={todayOnly} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label className="admin-date-filter"><span>Au</span><CalendarDays /><input type="date" value={to} min={from || undefined} disabled={todayOnly} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        </div>

        {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
        {!error && loading && !result && <AdminTableSkeleton columns={7} />}
        {!error && result && result.items.length === 0 && <AdminEmptyState title="Aucune réservation trouvée" description={filtersActive ? "Essayez de modifier ou d’effacer les filtres appliqués." : "Les prochaines réservations apparaîtront ici."} />}
        {!error && result && result.items.length > 0 && (
          <>
            <div className={`admin-table-wrap ${loading ? "is-refreshing" : ""}`}>
              <table className="admin-table admin-bookings-table">
                <thead><tr><th>Référence</th><th>Client</th><th>Séjour</th><th>Chambre</th><th>Statut</th><th>Paiement</th><th className="admin-cell-right">Total</th><th><span className="sr-only">Détail</span></th></tr></thead>
                <tbody>
                  {result.items.map((booking) => (
                    <tr key={booking.id}>
                      <td className="admin-reference-cell"><button type="button" className="admin-reference" title={booking.reference} onClick={() => setSelectedBookingId(booking.id)}>{booking.reference}</button><small>{formatDate(booking.createdAt)}</small></td>
                      <td><strong>{guestName(booking)}</strong><small>{booking.guest?.email ?? "—"}</small></td>
                      <td><strong>{formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}</strong><small>{stayNights(booking.checkIn, booking.checkOut)} nuit(s) · {booking.adults + booking.children} voyageur(s)</small></td>
                      <td><span className="admin-room-label"><BedDouble />{roomsLabel(booking)}</span></td>
                      <td><span className="admin-status-stack"><StatusBadge status={booking.status} kind="booking" />{booking.hold?.isActive && <small>Option jusqu’au {formatDateTime(booking.hold.expiresAt, propertyTimeZone)}</small>}</span></td>
                      <td>{booking.paymentStatus ? <StatusBadge status={booking.paymentStatus} kind="payment" /> : <span className="admin-status admin-status-neutral"><i />Non initié</span>}</td>
                      <td className="admin-cell-right"><strong>{formatMoney(booking.total, booking.currency)}</strong></td>
                      <td><button className="admin-row-action" type="button" onClick={() => setSelectedBookingId(booking.id)} aria-label={`Voir la réservation ${booking.reference}`}><ChevronRight /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="admin-mobile-list">
                {result.items.map((booking) => (
                  <button key={booking.id} type="button" className="admin-mobile-booking" onClick={() => setSelectedBookingId(booking.id)}>
                    <span className="admin-mobile-card-head"><strong>{booking.reference}</strong><StatusBadge status={booking.status} kind="booking" /></span>
                    <span className="admin-mobile-guest"><UserRound />{guestName(booking)}</span>
                    <span className="admin-mobile-dates"><CalendarDays />{formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}</span>
                    <span className="admin-mobile-card-foot"><span>{roomsLabel(booking)}</span><strong>{formatMoney(booking.total, booking.currency)}</strong></span>
                  </button>
                ))}
              </div>
            </div>
            <AdminPagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} onPageChange={setPage} />
          </>
        )}
      </section>

      {selectedBookingId && <BookingDetailDrawer id={selectedBookingId} onClose={closeBookingDetail} onChanged={() => setRetryKey((value) => value + 1)} />}
      {createDialogOpen && <AdminBookingCreateDialog
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(booking) => {
          setCreateDialogOpen(false);
          setSelectedBookingId(booking.id);
          setPage(1);
          setRetryKey((value) => value + 1);
        }}
      />}
    </>
  );
}

function BookingDetailDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { accessToken, logout, profile } = useAdminAuth();
  const propertyTimeZone = profile?.membership.property.timezone;
  const canOperateBooking = profile?.membership.role === "ADMIN" || profile?.membership.role === "RECEPTION";
  const [booking, setBooking] = useState<AdminBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusAction, setStatusAction] = useState<"CHECKED_IN" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<AdminAvailableBookingRoom[]>([]);
  const [assignedRoomId, setAssignedRoomId] = useState("");
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomAssigning, setRoomAssigning] = useState(false);
  const [invoices, setInvoices] = useState<AdminInvoice[]>([]);
  const [billingMode, setBillingMode] = useState<"payment" | "refund" | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("Carte sur place");
  const [paymentNote, setPaymentNote] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const refundAttemptRef = useRef<{ signature: string; key: string } | null>(null);
  const confirmationOpenRef = useRef(false);
  const editOpenRef = useRef(false);
  const confirmingRef = useRef(false);
  const drawerRef = useRef<HTMLElement>(null);
  const confirmationDialogRef = useRef<HTMLDivElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmationCancelRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationTitleId = useId();
  const confirmationDescriptionId = useId();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyboard = (event: KeyboardEvent) => {
      if (editOpenRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmationOpenRef.current) {
          dismissConfirmation();
        } else {
          onClose();
        }
        return;
      }
      const focusRoot = confirmationOpenRef.current ? confirmationDialogRef.current : drawerRef.current;
      if (event.key !== "Tab" || !focusRoot) return;
      const focusable = [...focusRoot.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
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

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminBooking(id, accessToken, controller.signal)
      .then((data) => { setBooking(data); setLoading(false); })
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
  }, [accessToken, id, logout, retryKey]);

  useEffect(() => {
    if (!accessToken || !booking) return;
    const controller = new AbortController();
    getAdminBookingInvoices(id, accessToken, controller.signal)
      .then(setInvoices)
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) logout();
      });
    return () => controller.abort();
  }, [accessToken, booking, id, logout]);

  useEffect(() => {
    if (!accessToken || !canOperateBooking || (booking?.status !== "CONFIRMED" && booking?.status !== "CHECKED_IN")) {
      setAvailableRooms([]);
      setAssignedRoomId("");
      return;
    }
    const controller = new AbortController();
    setRoomsLoading(true);
    getAvailableAdminBookingRooms(id, accessToken, controller.signal)
      .then((rooms) => {
        setAvailableRooms(rooms);
        setAssignedRoomId(rooms.find((room) => room.selected)?.id ?? rooms[0]?.id ?? "");
        setRoomsLoading(false);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) {
          logout();
          return;
        }
        setActionError(nextError instanceof Error ? nextError.message : "Les chambres disponibles n’ont pas pu être chargées.");
        setRoomsLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, booking?.status, booking?.rooms, canOperateBooking, id, logout]);

  async function applyRoomAssignment() {
    if (!accessToken || !booking || !assignedRoomId || roomAssigning) return;
    const currentRoomId = booking.rooms[0]?.roomId;
    if (assignedRoomId === currentRoomId) return;
    setRoomAssigning(true);
    setActionError(null);
    try {
      const updated = await assignAdminBookingRoom(id, assignedRoomId, accessToken);
      setBooking(updated);
      onChanged();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      setActionError(nextError instanceof Error ? nextError.message : "L’affectation de chambre a échoué.");
    } finally {
      setRoomAssigning(false);
    }
  }

  function openEditDialog() {
    editOpenRef.current = true;
    setEditOpen(true);
    setActionError(null);
  }

  function closeEditDialog() {
    editOpenRef.current = false;
    setEditOpen(false);
  }

  async function saveManualPayment() {
    if (!accessToken || !booking || billingBusy) return;
    setBillingBusy(true);
    setActionError(null);
    try {
      await recordManualAdminPayment(id, paymentMethod, paymentNote.trim() || null, accessToken);
      const [updated, documents] = await Promise.all([getAdminBooking(id, accessToken), getAdminBookingInvoices(id, accessToken)]);
      setBooking(updated);
      setInvoices(documents);
      setBillingMode(null);
      setPaymentNote("");
      onChanged();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setActionError(nextError instanceof Error ? nextError.message : "Le règlement n'a pas pu être enregistré.");
    } finally {
      setBillingBusy(false);
    }
  }

  async function saveRefund() {
    if (!accessToken || !booking || !refundPaymentId || !refundReason.trim() || billingBusy) return;
    setBillingBusy(true);
    setActionError(null);
    try {
      const parsedAmount = refundAmount.trim() ? Number(refundAmount.replace(",", ".")) : undefined;
      const reason = refundReason.trim();
      const signature = JSON.stringify({ bookingId: id, paymentId: refundPaymentId, amount: parsedAmount ?? null, reason });
      if (!refundAttemptRef.current || refundAttemptRef.current.signature !== signature) {
        refundAttemptRef.current = { signature, key: `refund:${crypto.randomUUID()}` };
      }
      await refundAdminPayment(id, refundPaymentId, parsedAmount, reason, refundAttemptRef.current.key, accessToken);
      const [updated, documents] = await Promise.all([getAdminBooking(id, accessToken), getAdminBookingInvoices(id, accessToken)]);
      setBooking(updated);
      setInvoices(documents);
      setBillingMode(null);
      setRefundAmount("");
      setRefundReason("");
      refundAttemptRef.current = null;
      onChanged();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setActionError(nextError instanceof Error ? nextError.message : "Le remboursement n'a pas pu être enregistré.");
    } finally {
      setBillingBusy(false);
    }
  }

  async function downloadInvoice(invoice: AdminInvoice) {
    if (!accessToken || billingBusy) return;
    setBillingBusy(true);
    setActionError(null);
    try {
      await downloadAdminInvoice(invoice.id, accessToken);
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setActionError(nextError instanceof Error ? nextError.message : "Le document n'a pas pu être téléchargé.");
    } finally {
      setBillingBusy(false);
    }
  }

  async function applyStatusAction() {
    if (!accessToken || !statusAction || statusUpdating) return;
    setStatusUpdating(true);
    setActionError(null);
    try {
      const updated = await updateAdminBookingStatus(id, statusAction, statusReason.trim() || null, accessToken);
      setBooking(updated);
      setStatusAction(null);
      setStatusReason("");
      onChanged();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      setActionError(nextError instanceof Error ? nextError.message : "Le changement de statut a échoué.");
    } finally {
      setStatusUpdating(false);
    }
  }

  function openConfirmation() {
    if (!booking || confirmingRef.current) return;
    setActionError(null);
    confirmationOpenRef.current = true;
    setConfirmationOpen(true);
    window.requestAnimationFrame(() => confirmationCancelRef.current?.focus());
  }

  function dismissConfirmation() {
    if (confirmingRef.current) return;
    confirmationOpenRef.current = false;
    setConfirmationOpen(false);
    setActionError(null);
    window.requestAnimationFrame(() => confirmationTriggerRef.current?.focus());
  }

  async function confirmBooking() {
    if (!accessToken || confirmingRef.current || !booking) return;
    confirmingRef.current = true;
    setConfirming(true);
    setActionError(null);
    try {
      const confirmed = await confirmAdminBooking(id, accessToken);
      confirmationOpenRef.current = false;
      setConfirmationOpen(false);
      setBooking(confirmed);
      onChanged();
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      setActionError(nextError instanceof Error ? nextError.message : "La confirmation a échoué.");
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }

  const refundablePayments = booking?.payments.filter((payment) =>
    payment.kind === "CHARGE" && (payment.status === "SUCCEEDED" || payment.status === "PARTIALLY_REFUNDED"),
  ) ?? [];
  const hasSettledCharge = booking?.payments.some((payment) =>
    payment.kind === "CHARGE" && (payment.status === "SUCCEEDED" || payment.status === "PARTIALLY_REFUNDED"),
  ) ?? false;
  const canManagePayment = profile?.membership.role === "ADMIN"
    || profile?.membership.role === "RECEPTION"
    || profile?.membership.role === "ACCOUNTING";
  const canRefund = profile?.membership.role === "ADMIN" || profile?.membership.role === "ACCOUNTING";
  const propertyToday = dateInTimeZone(propertyTimeZone);
  const canCheckInNow = Boolean(booking && booking.checkIn <= propertyToday && booking.checkOut > propertyToday);
  const canDeclareNoShow = Boolean(booking && booking.checkIn <= propertyToday);
  const canCompleteNow = Boolean(booking && booking.checkOut <= propertyToday);

  return (
    <div className="admin-drawer-layer">
      <button type="button" className="admin-drawer-backdrop" aria-label="Fermer le détail" disabled={confirmationOpen || editOpen} aria-hidden={confirmationOpen || editOpen || undefined} onClick={onClose} />
      <aside ref={drawerRef} className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="booking-detail-title">
        <header className="admin-drawer-head" inert={confirmationOpen || editOpen || undefined} aria-hidden={confirmationOpen || editOpen || undefined}>
          <div><p>Détail de la réservation</p><h2 id="booking-detail-title">{booking?.reference ?? "Chargement…"}</h2></div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fermer"><X /></button>
        </header>

        <div className="admin-drawer-body" inert={confirmationOpen || editOpen || undefined} aria-hidden={confirmationOpen || editOpen || undefined}>
          {loading && <AdminTableSkeleton columns={2} rows={7} />}
          {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
          {!loading && booking && (
            <>
              <div className="admin-detail-statuses"><StatusBadge status={booking.status} kind="booking" />{booking.paymentStatus ? <StatusBadge status={booking.paymentStatus} kind="payment" /> : <span className="admin-status admin-status-neutral"><i />Paiement non initié</span>}</div>
              {booking.hold && <div className={`admin-hold-notice ${booking.hold.isActive ? "is-active" : ""}`}><CalendarCheck /><span><strong>{booking.hold.isActive ? "Chambre optionnée" : "Option terminée"}</strong><small>{booking.hold.isActive ? `À confirmer avant le ${formatDateTime(booking.hold.expiresAt, propertyTimeZone)}` : `Échéance : ${formatDateTime(booking.hold.expiresAt, propertyTimeZone)}`} · heure locale de l’hôtel</small></span></div>}
              {canOperateBooking && booking.status === "PENDING_PAYMENT" && booking.hold?.isActive && <button ref={confirmationTriggerRef} type="button" className="admin-confirm-booking" disabled={confirming} aria-haspopup="dialog" onClick={openConfirmation}><CircleCheck />Confirmer manuellement la réservation</button>}
              {canOperateBooking && (booking.status === "PENDING_PAYMENT" || booking.status === "CONFIRMED") && <button type="button" className="admin-booking-edit-button" aria-haspopup="dialog" onClick={openEditDialog}><Pencil />Modifier le séjour</button>}

              <section className="admin-detail-section">
                <h3><UserRound />Client principal</h3>
                <div className="admin-detail-client">
                  <span className="admin-detail-avatar">{booking.guest ? `${booking.guest.firstName[0] ?? ""}${booking.guest.lastName[0] ?? ""}` : "—"}</span>
                  <div><strong>{guestName(booking)}</strong>{booking.guest?.email && <a href={`mailto:${booking.guest.email}`}><Mail />{booking.guest.email}</a>}{booking.guest?.phone && <a href={`tel:${booking.guest.phone}`}><Phone />{booking.guest.phone}</a>}</div>
                </div>
              </section>

              <section className="admin-detail-section">
                <h3><CalendarDays />Séjour</h3>
                <dl className="admin-detail-grid">
                  <div><dt>Arrivée</dt><dd>{formatDate(booking.checkIn, { weekday: "short" })}</dd></div>
                  <div><dt>Départ</dt><dd>{formatDate(booking.checkOut, { weekday: "short" })}</dd></div>
                  <div><dt>Durée</dt><dd>{stayNights(booking.checkIn, booking.checkOut)} nuit(s)</dd></div>
                  <div><dt>Voyageurs</dt><dd>{booking.adults} adulte(s){booking.children ? ` · ${booking.children} enfant(s)` : ""}</dd></div>
                </dl>
              </section>

              <section className="admin-detail-section">
                <h3><BedDouble />Hébergement</h3>
                <div className="admin-detail-lines">
                  {booking.rooms.map((room) => <p key={room.id}><span><strong>{room.roomTypeName}</strong><small>{room.roomNumber ? `Chambre ${room.roomNumber}` : "Chambre à attribuer"}</small></span>{room.lineTotal !== undefined && <strong>{formatMoney(room.lineTotal, booking.currency)}</strong>}</p>)}
                </div>
                {canOperateBooking && (booking.status === "CONFIRMED" || booking.status === "CHECKED_IN") && <div className="admin-booking-room-assignment">
                  <label><span>Chambre physique</span><select value={assignedRoomId} disabled={roomsLoading || roomAssigning} onChange={(event) => setAssignedRoomId(event.target.value)}>{availableRooms.map((room) => <option value={room.id} key={room.id}>Chambre {room.number}{room.floor !== null ? ` · étage ${room.floor}` : ""}{room.selected ? " · actuelle" : ""}</option>)}</select></label>
                  <button type="button" disabled={roomsLoading || roomAssigning || !assignedRoomId || assignedRoomId === booking.rooms[0]?.roomId} onClick={applyRoomAssignment}>{roomAssigning ? "Affectation…" : roomsLoading ? "Chargement…" : "Affecter"}</button>
                </div>}
              </section>

              {booking.extras.length > 0 && <section className="admin-detail-section"><h3><CircleCheck />Options</h3><div className="admin-detail-lines">{booking.extras.map((extra) => <p key={extra.id}><span><strong>{extra.name}</strong><small>Quantité : {extra.quantity}</small></span><strong>{formatMoney(extra.lineTotal, booking.currency)}</strong></p>)}</div></section>}

              <section className="admin-detail-section">
                <h3><CreditCard />Facturation</h3>
                <dl className="admin-pricing-lines">
                  <div><dt>Hébergement{booking.priceTaxMode === "INCLUSIVE" ? " TTC" : ""}</dt><dd>{formatMoney(booking.accommodationSubtotal, booking.currency)}</dd></div>
                  <div><dt>Options{booking.priceTaxMode === "INCLUSIVE" ? " TTC" : ""}</dt><dd>{formatMoney(booking.extrasSubtotal, booking.currency)}</dd></div>
                  <div><dt>{booking.priceTaxMode === "INCLUSIVE" ? "dont TVA incluse" : "TVA"}</dt><dd>{formatMoney(booking.taxTotal - booking.touristTaxTotal, booking.currency)}</dd></div>
                  {booking.touristTaxTotal > 0 && <div><dt>Taxe de séjour</dt><dd>{formatMoney(booking.touristTaxTotal, booking.currency)}</dd></div>}
                  <div className="total"><dt>Total</dt><dd>{formatMoney(booking.total, booking.currency)}</dd></div>
                </dl>
                <div className="admin-billing-history">
                  {booking.payments.length === 0 ? <p className="admin-billing-empty">Aucun règlement enregistré.</p> : booking.payments.map((payment) => (
                    <div key={payment.id} className="admin-billing-row">
                      <span><strong>{payment.kind === "REFUND" ? "Remboursement" : payment.provider === "STRIPE" ? "Paiement Stripe" : payment.paymentMethodType ?? "Paiement manuel"}</strong><small>{formatDateTime(payment.processedAt ?? payment.createdAt, propertyTimeZone)}</small></span>
                      <span><StatusBadge status={payment.status} kind="payment" /><strong>{payment.kind === "REFUND" ? "−" : ""}{formatMoney(payment.amount, payment.currency)}</strong></span>
                    </div>
                  ))}
                </div>

                {invoices.length > 0 && <div className="admin-invoice-list">{invoices.map((invoice) => (
                  <button type="button" key={invoice.id} disabled={billingBusy} onClick={() => downloadInvoice(invoice)}>
                    <span><FileDown /><span><strong>{invoice.documentType === "INVOICE" ? "Facture" : "Avoir"} {invoice.number}</strong><small>{invoice.issuedAt ? formatDateTime(invoice.issuedAt, propertyTimeZone) : "Brouillon"}</small></span></span>
                    <strong>{formatMoney(invoice.total, invoice.currency)}</strong>
                  </button>
                ))}</div>}

                {canManagePayment && (booking.status === "CONFIRMED" || booking.status === "CHECKED_IN" || booking.status === "COMPLETED") && !hasSettledCharge && billingMode !== "payment" && (
                  <button className="admin-billing-action" type="button" onClick={() => { setBillingMode("payment"); setActionError(null); }}><CreditCard />Enregistrer le règlement</button>
                )}
                {canRefund && refundablePayments.length > 0 && billingMode !== "refund" && (
                  <button className="admin-billing-action secondary" type="button" onClick={() => { setRefundPaymentId(refundablePayments[0]?.id ?? ""); setBillingMode("refund"); setActionError(null); refundAttemptRef.current = null; }}><RotateCcw />Effectuer un remboursement</button>
                )}

                {billingMode === "payment" && <div className="admin-billing-form">
                  <strong>Règlement manuel du solde</strong>
                  <label>Moyen de paiement<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Carte sur place</option><option>Espèces</option><option>Virement</option><option>Chèque</option></select></label>
                  <label>Note <span>(facultatif)</span><textarea rows={2} maxLength={500} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} /></label>
                  <div><button type="button" disabled={billingBusy} onClick={() => setBillingMode(null)}>Annuler</button><button type="button" className="primary" disabled={billingBusy} onClick={saveManualPayment}>{billingBusy ? "Enregistrement…" : `Enregistrer ${formatMoney(booking.total, booking.currency)}`}</button></div>
                </div>}

                {billingMode === "refund" && <div className="admin-billing-form">
                  <strong>Rembourser un paiement</strong>
                  <label>Paiement<select value={refundPaymentId} onChange={(event) => setRefundPaymentId(event.target.value)}>{refundablePayments.map((payment) => <option key={payment.id} value={payment.id}>{payment.provider === "STRIPE" ? "Stripe" : payment.paymentMethodType ?? "Manuel"} · {formatMoney(payment.amount, payment.currency)}</option>)}</select></label>
                  <label>Montant <span>(laisser vide pour le solde complet)</span><input inputMode="decimal" value={refundAmount} placeholder="Ex. 50,00" onChange={(event) => setRefundAmount(event.target.value)} /></label>
                  <label>Motif<textarea required rows={2} maxLength={500} value={refundReason} onChange={(event) => setRefundReason(event.target.value)} /></label>
                  <div><button type="button" disabled={billingBusy} onClick={() => { setBillingMode(null); refundAttemptRef.current = null; }}>Annuler</button><button type="button" className="danger" disabled={billingBusy || !refundReason.trim()} onClick={saveRefund}>{billingBusy ? "Remboursement…" : "Confirmer le remboursement"}</button></div>
                </div>}
                {actionError && <p className="admin-booking-confirm-error" role="alert">{actionError}</p>}
              </section>

              {canOperateBooking && booking.specialRequests && <section className="admin-detail-section"><h3><Users />Demande particulière</h3><p className="admin-special-request">{booking.specialRequests}</p></section>}

              {canOperateBooking && (booking.status === "PENDING_PAYMENT" || booking.status === "CONFIRMED" || booking.status === "CHECKED_IN") && <section className="admin-detail-section admin-booking-lifecycle">
                <h3><Ban />Actions sur le séjour</h3>
                <div className="admin-booking-lifecycle-actions">
                  {booking.status !== "CHECKED_IN" && <button type="button" className="danger" onClick={() => { setStatusAction("CANCELLED"); setStatusReason(""); setActionError(null); }}>Annuler la réservation</button>}
                  {booking.status === "CONFIRMED" && <><button type="button" className="primary" disabled={!canCheckInNow} title={!canCheckInNow ? `Disponible pendant le séjour, du ${formatDate(booking.checkIn)} au ${formatDate(booking.checkOut)}.` : undefined} onClick={() => { setStatusAction("CHECKED_IN"); setStatusReason(""); setActionError(null); }}>Enregistrer l’arrivée</button><button type="button" disabled={!canDeclareNoShow} title={!canDeclareNoShow ? `Disponible à partir du ${formatDate(booking.checkIn)}.` : undefined} onClick={() => { setStatusAction("NO_SHOW"); setStatusReason(""); setActionError(null); }}>Signaler une absence</button></>}
                  {booking.status === "CHECKED_IN" && <button type="button" className="primary" disabled={!canCompleteNow} title={!canCompleteNow ? `Disponible à partir du ${formatDate(booking.checkOut)}.` : undefined} onClick={() => { setStatusAction("COMPLETED"); setStatusReason(""); setActionError(null); }}>Terminer le séjour</button>}
                </div>
                {booking.status === "CONFIRMED" && !canCheckInNow && <p className="admin-booking-lifecycle-hint">L’arrivée s’enregistre uniquement entre le jour d’arrivée et le départ.</p>}
                {booking.status === "CHECKED_IN" && !canCompleteNow && <p className="admin-booking-lifecycle-hint">La fin du séjour sera disponible le {formatDate(booking.checkOut)}.</p>}
                {statusAction && <div className="admin-booking-status-confirm" role="group" aria-label="Confirmer le changement de statut">
                  <strong>{statusAction === "CANCELLED" ? "Confirmer l’annulation" : statusAction === "CHECKED_IN" ? "Confirmer l’arrivée du client" : statusAction === "COMPLETED" ? "Confirmer la fin du séjour" : "Confirmer l’absence"}</strong>
                  <label>Motif ou note <span>(facultatif)</span><textarea maxLength={500} rows={3} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} /></label>
                  <div><button type="button" disabled={statusUpdating} onClick={() => { setStatusAction(null); setStatusReason(""); setActionError(null); }}>Retour</button><button type="button" className={statusAction === "CANCELLED" ? "danger" : "primary"} disabled={statusUpdating} onClick={applyStatusAction}>{statusUpdating ? "Enregistrement…" : "Confirmer"}</button></div>
                </div>}
                {actionError && <p className="admin-booking-confirm-error" role="alert">{actionError}</p>}
              </section>}

              <p className="admin-detail-created">Réservation créée le {formatDateTime(booking.createdAt, propertyTimeZone)} · Dernière mise à jour le {formatDateTime(booking.updatedAt, propertyTimeZone)} · heure locale de l’hôtel</p>
            </>
          )}
        </div>

        {canOperateBooking && confirmationOpen && booking && (
          <div className="admin-booking-confirm-layer">
            <div
              ref={confirmationDialogRef}
              className="admin-booking-confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={confirmationTitleId}
              aria-describedby={confirmationDescriptionId}
              aria-busy={confirming}
            >
              <span className="admin-booking-confirm-icon" aria-hidden="true"><CircleCheck /></span>
              <div className="admin-booking-confirm-copy">
                <p>Validation du séjour</p>
                <h3 id={confirmationTitleId}>Confirmer cette réservation ?</h3>
                <span className="admin-booking-confirm-reference" title={booking.reference}>{booking.reference}</span>
              </div>

              <dl className="admin-booking-confirm-summary">
                <div><dt>Séjour</dt><dd>{formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}</dd></div>
                <div><dt>Chambre</dt><dd>{roomsLabel(booking)}</dd></div>
              </dl>

              <p id={confirmationDescriptionId} className="admin-booking-confirm-description">
                La chambre optionnée sera attribuée à ce séjour et la réservation passera au statut « Confirmée ».
              </p>

              {actionError && <p className="admin-booking-confirm-error" role="alert">{actionError}</p>}

              <div className="admin-booking-confirm-actions">
                <button ref={confirmationCancelRef} type="button" disabled={confirming} onClick={dismissConfirmation}>Annuler</button>
                <button type="button" className="primary" disabled={confirming} onClick={confirmBooking}>
                  {confirming ? <span className="admin-spinner light" /> : <CircleCheck />}
                  {confirming ? "Confirmation…" : "Confirmer la réservation"}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
      {canOperateBooking && editOpen && booking && <AdminBookingEditDialog
        booking={booking}
        onClose={closeEditDialog}
        onSaved={(updated) => {
          editOpenRef.current = false;
          setEditOpen(false);
          setBooking(updated);
          onChanged();
        }}
      />}
    </div>
  );
}
