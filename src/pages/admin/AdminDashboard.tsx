import { ArrowDownToLine, ArrowUpFromLine, BedDouble, ChevronRight, Clock3, Inbox, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AdminApiError, AdminBooking, AdminDashboard as Dashboard, getAdminDashboard } from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import { publishOpenContactRequests } from "../../admin/openContactRequests";
import { AdminErrorState, AdminTableSkeleton, MetricCard, PageHeading, StatusBadge, formatDate, formatDateTime, formatMoney, stayNights } from "../../admin/ui";

function guestName(booking: AdminBooking) {
  return booking.guest ? `${booking.guest.firstName} ${booking.guest.lastName}` : "Client non renseigné";
}

function roomLabel(booking: AdminBooking) {
  const room = booking.rooms[0];
  if (!room) return "Chambre à attribuer";
  return room.roomNumber ? `${room.roomTypeName} · ${room.roomNumber}` : room.roomTypeName;
}

function guestsLabel(booking: AdminBooking) {
  const guests = booking.adults + booking.children;
  return `${guests} voyageur${guests > 1 ? "s" : ""}`;
}

function bookingLink(booking: AdminBooking) {
  return `/admin/reservations?booking=${encodeURIComponent(booking.id)}`;
}

function longDate(value: string) {
  const label = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function percent(occupied: number, available: number) {
  return available > 0 ? Math.round((occupied / available) * 100) : 0;
}

function DashboardPanel({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="admin-panel admin-dashboard-panel">
      <div className="admin-panel-head">
        <div><h2>{title}{count !== undefined && <span className="admin-dashboard-count">{count}</span>}</h2></div>
        {action}
      </div>
      {children}
    </section>
  );
}

function BookingRows({ bookings, empty, detail, showStatus = true }: {
  bookings: AdminBooking[];
  empty: string;
  detail: (booking: AdminBooking) => string;
  showStatus?: boolean;
}) {
  if (bookings.length === 0) return <p className="admin-dashboard-empty">{empty}</p>;
  return (
    <ul className={`admin-dashboard-list ${showStatus ? "" : "without-status"}`}>
      {bookings.map((booking) => (
        <li key={booking.id}>
          <Link to={bookingLink(booking)} aria-label={`Ouvrir la réservation ${booking.reference} de ${guestName(booking)}`}>
            <span><strong>{guestName(booking)}</strong><small>{roomLabel(booking)} · {detail(booking)}</small></span>
            {showStatus && <StatusBadge status={booking.status} kind="booking" />}
            <ChevronRight className="admin-dashboard-chevron" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AdminDashboard() {
  const { accessToken, logout, profile } = useAdminAuth();
  const timeZone = profile?.membership.property.timezone;
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setError(null);
    getAdminDashboard(accessToken, controller.signal)
      .then((data) => {
        setDashboard(data);
        if (data.openContactRequests !== null) publishOpenContactRequests(data.openContactRequests);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
        setError(nextError instanceof Error ? nextError.message : "Le tableau de bord n’a pas pu être chargé.");
      });
    return () => controller.abort();
  }, [accessToken, logout, retryKey]);

  if (error) return <><PageHeading eyebrow="Aujourd’hui" title="Tableau de bord" /><AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} /></>;
  if (!dashboard) return <><PageHeading eyebrow="Aujourd’hui" title="Tableau de bord" /><AdminTableSkeleton columns={4} rows={5} /></>;

  const tonight = dashboard.occupancy[0];
  const checkedIn = dashboard.arrivals.filter((booking) => booking.status === "CHECKED_IN").length;
  const checkedOut = dashboard.departures.filter((booking) => booking.status === "COMPLETED").length;
  const finance = dashboard.finance;

  return (
    <>
      <PageHeading eyebrow={longDate(dashboard.date)} title="Tableau de bord" description="Les mouvements du jour et ce qui attend une action." />

      <section className="admin-metrics" aria-label="Synthèse du jour">
        <MetricCard label="Arrivées" value={dashboard.arrivals.length} detail={checkedIn ? `${checkedIn} déjà arrivé${checkedIn > 1 ? "s" : ""}` : "à accueillir"} icon={<ArrowDownToLine />} />
        <MetricCard label="Départs" value={dashboard.departures.length} detail={checkedOut ? `${checkedOut} déjà parti${checkedOut > 1 ? "s" : ""}` : "à préparer"} icon={<ArrowUpFromLine />} />
        <MetricCard label="Occupation ce soir" value={tonight ? `${percent(tonight.occupied, tonight.available)} %` : "—"} detail={tonight ? `${tonight.occupied} / ${tonight.available} chambres` : undefined} icon={<BedDouble />} />
        <MetricCard label="Options à confirmer" value={dashboard.pendingOptionsTotal} detail="en attente" icon={<Clock3 />} />
      </section>

      <div className="admin-dashboard-grid">
        <div className="admin-dashboard-column">
          <DashboardPanel title="Arrivées du jour" count={dashboard.arrivals.length}>
            <BookingRows bookings={dashboard.arrivals} empty="Aucune arrivée prévue aujourd’hui." detail={(booking) => `${stayNights(booking.checkIn, booking.checkOut)} nuit(s) · ${guestsLabel(booking)}`} />
          </DashboardPanel>
          <DashboardPanel title="Départs du jour" count={dashboard.departures.length}>
            <BookingRows bookings={dashboard.departures} empty="Aucun départ prévu aujourd’hui." detail={(booking) => `arrivé le ${formatDate(booking.checkIn)}`} />
          </DashboardPanel>
        </div>

        <div className="admin-dashboard-column">
          <DashboardPanel
            title="Options à confirmer"
            count={dashboard.pendingOptionsTotal}
            action={dashboard.pendingOptionsTotal > dashboard.pendingOptions.length ? <Link className="admin-dashboard-more" to="/admin/reservations">Tout voir</Link> : undefined}
          >
            <BookingRows bookings={dashboard.pendingOptions} showStatus={false} empty="Aucune option en attente." detail={(booking) => `expire le ${formatDateTime(booking.hold?.expiresAt ?? booking.checkIn, timeZone)}`} />
          </DashboardPanel>

          {dashboard.openContactRequests !== null && (
            <Link to="/admin/demandes" className={`admin-dashboard-callout ${dashboard.openContactRequests ? "is-pending" : ""}`}>
              <Inbox />
              <span>
                <strong>{dashboard.openContactRequests ? `${dashboard.openContactRequests} demande${dashboard.openContactRequests > 1 ? "s" : ""} de contact à traiter` : "Aucune demande de contact en attente"}</strong>
                <small>Messages envoyés depuis le site</small>
              </span>
              <ChevronRight />
            </Link>
          )}

          {finance && (
            <DashboardPanel title="Encaissements du mois">
              <dl className="admin-dashboard-finance">
                <div className="total"><dt>Encaissé depuis le {formatDate(finance.monthStart)}</dt><dd>{formatMoney(finance.net, finance.currency)}</dd></div>
                {finance.refunded > 0 && <div><dt>dont remboursements déduits</dt><dd>− {formatMoney(finance.refunded, finance.currency)}</dd></div>}
                <div><dt>Réservations enregistrées ce mois-ci</dt><dd>{finance.bookingsCount} · {formatMoney(finance.bookingsTotal, finance.currency)}</dd></div>
              </dl>
              <p className="admin-dashboard-note"><Wallet />Paiements en ligne et règlements saisis à la réception.</p>
            </DashboardPanel>
          )}
        </div>
      </div>

      <DashboardPanel title="Les 7 prochaines nuits">
        <ol className="admin-dashboard-week" aria-label="Occupation des 7 prochaines nuits">
          {dashboard.occupancy.map((night) => {
            const rate = percent(night.occupied, night.available);
            return (
              <li key={night.date}>
                <span className="admin-dashboard-bar" aria-hidden="true"><i style={{ height: `${Math.max(rate, 3)}%` }} /></span>
                <strong>{rate} %</strong>
                <small>{new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" }).format(new Date(`${night.date}T12:00:00`))}</small>
                <span className="sr-only">{night.occupied} chambres occupées sur {night.available}{night.blocked ? `, ${night.blocked} bloquée(s)` : ""}</span>
              </li>
            );
          })}
        </ol>
      </DashboardPanel>
    </>
  );
}
