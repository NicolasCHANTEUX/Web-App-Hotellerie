import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BedDouble,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CreditCard,
  Filter,
  Mail,
  Phone,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import {
  AdminApiError,
  AdminBooking,
  AdminBookingDetail,
  AdminBookingSummary,
  BookingStatus,
  PaginatedAdminResult,
  confirmAdminBooking,
  getAdminBooking,
  getAdminBookings,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
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

export function AdminBookings() {
  const { accessToken, logout, profile } = useAdminAuth();
  const propertyTimeZone = profile?.membership.property.timezone;
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<BookingStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [result, setResult] = useState<PaginatedAdminResult<AdminBooking, AdminBookingSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);

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
  }, [accessToken, deferredSearch, from, logout, page, retryKey, status, to]);

  const summary = result?.summary ?? emptySummary;
  const filtersActive = Boolean(search || status || from || to);

  function resetFilters() {
    setSearch("");
    setStatus("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <>
      <PageHeading
        eyebrow="Pilotage des séjours"
        title="Réservations"
        description="Consultez les arrivées, les départs et le détail de chaque séjour."
      />

      <section className="admin-metrics" aria-label="Synthèse des réservations">
        <MetricCard label="Réservations" value={summary.total} detail="selon la recherche" icon={<CalendarCheck />} />
        <MetricCard label="Arrivées aujourd’hui" value={summary.arrivalsToday} detail="à accueillir" icon={<ArrowDownToLine />} />
        <MetricCard label="Départs aujourd’hui" value={summary.departuresToday} detail="à préparer" icon={<ArrowUpFromLine />} />
        <MetricCard label="Confirmées" value={summary.byStatus.CONFIRMED ?? 0} detail="séjours validés" icon={<CircleCheck />} />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div><h2>Toutes les réservations</h2><p>{result ? `${result.total} résultat${result.total > 1 ? "s" : ""}` : "Chargement des résultats"}</p></div>
          {filtersActive && <button type="button" className="admin-reset-filters" onClick={resetFilters}><X />Effacer les filtres</button>}
        </div>

        <div className="admin-filters">
          <label className="admin-filter-search"><span className="sr-only">Rechercher</span><Search /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Référence, client, e-mail…" /></label>
          <label><span className="sr-only">Statut</span><Filter /><select value={status} onChange={(event) => { setStatus(event.target.value as BookingStatus | ""); setPage(1); }}><option value="">Tous les statuts</option>{bookingStatuses.map((item) => <option key={item} value={item}>{bookingStatusLabel(item)}</option>)}</select></label>
          <label className="admin-date-filter"><span>Du</span><CalendarDays /><input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label className="admin-date-filter"><span>Au</span><CalendarDays /><input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
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

      {selectedBookingId && <BookingDetailDrawer id={selectedBookingId} onClose={() => setSelectedBookingId(null)} onChanged={() => setRetryKey((value) => value + 1)} />}
    </>
  );
}

function BookingDetailDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { accessToken, logout, profile } = useAdminAuth();
  const propertyTimeZone = profile?.membership.property.timezone;
  const [booking, setBooking] = useState<AdminBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const confirmationOpenRef = useRef(false);
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

  return (
    <div className="admin-drawer-layer">
      <button type="button" className="admin-drawer-backdrop" aria-label="Fermer le détail" disabled={confirmationOpen} aria-hidden={confirmationOpen || undefined} onClick={onClose} />
      <aside ref={drawerRef} className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="booking-detail-title">
        <header className="admin-drawer-head" inert={confirmationOpen || undefined} aria-hidden={confirmationOpen || undefined}>
          <div><p>Détail de la réservation</p><h2 id="booking-detail-title">{booking?.reference ?? "Chargement…"}</h2></div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fermer"><X /></button>
        </header>

        <div className="admin-drawer-body" inert={confirmationOpen || undefined} aria-hidden={confirmationOpen || undefined}>
          {loading && <AdminTableSkeleton columns={2} rows={7} />}
          {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
          {!loading && booking && (
            <>
              <div className="admin-detail-statuses"><StatusBadge status={booking.status} kind="booking" />{booking.paymentStatus ? <StatusBadge status={booking.paymentStatus} kind="payment" /> : <span className="admin-status admin-status-neutral"><i />Paiement non initié</span>}</div>
              {booking.hold && <div className={`admin-hold-notice ${booking.hold.isActive ? "is-active" : ""}`}><CalendarCheck /><span><strong>{booking.hold.isActive ? "Chambre optionnée" : "Option terminée"}</strong><small>{booking.hold.isActive ? `À confirmer avant le ${formatDateTime(booking.hold.expiresAt, propertyTimeZone)}` : `Échéance : ${formatDateTime(booking.hold.expiresAt, propertyTimeZone)}`} · heure locale de l’hôtel</small></span></div>}
              {booking.status === "PENDING_PAYMENT" && booking.hold?.isActive && <button ref={confirmationTriggerRef} type="button" className="admin-confirm-booking" disabled={confirming} aria-haspopup="dialog" onClick={openConfirmation}><CircleCheck />Confirmer manuellement la réservation</button>}

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
              </section>

              {booking.extras.length > 0 && <section className="admin-detail-section"><h3><CircleCheck />Options</h3><div className="admin-detail-lines">{booking.extras.map((extra) => <p key={extra.id}><span><strong>{extra.name}</strong><small>Quantité : {extra.quantity}</small></span><strong>{formatMoney(extra.lineTotal, booking.currency)}</strong></p>)}</div></section>}

              <section className="admin-detail-section">
                <h3><CreditCard />Facturation</h3>
                <dl className="admin-pricing-lines">
                  <div><dt>Hébergement</dt><dd>{formatMoney(booking.accommodationSubtotal, booking.currency)}</dd></div>
                  <div><dt>Options</dt><dd>{formatMoney(booking.extrasSubtotal, booking.currency)}</dd></div>
                  <div><dt>TVA</dt><dd>{formatMoney(booking.taxTotal - booking.touristTaxTotal, booking.currency)}</dd></div>
                  {booking.touristTaxTotal > 0 && <div><dt>Taxe de séjour</dt><dd>{formatMoney(booking.touristTaxTotal, booking.currency)}</dd></div>}
                  <div className="total"><dt>Total</dt><dd>{formatMoney(booking.total, booking.currency)}</dd></div>
                </dl>
              </section>

              {booking.specialRequests && <section className="admin-detail-section"><h3><Users />Demande particulière</h3><p className="admin-special-request">{booking.specialRequests}</p></section>}

              <p className="admin-detail-created">Réservation créée le {formatDateTime(booking.createdAt, propertyTimeZone)} · Dernière mise à jour le {formatDateTime(booking.updatedAt, propertyTimeZone)} · heure locale de l’hôtel</p>
            </>
          )}
        </div>

        {confirmationOpen && booking && (
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
    </div>
  );
}
