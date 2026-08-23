import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";

type ConfirmationState = {
  reference?: string;
  status?: "PENDING_PAYMENT" | "CONFIRMED";
  room?: string;
  arrival?: string;
  departure?: string;
  adults?: number;
  children?: number;
  options?: string[];
  total?: number;
  currency?: string;
  email?: string;
  holdExpiresAt?: string;
};

function readStoredConfirmation(): ConfirmationState {
  try {
    const value = JSON.parse(sessionStorage.getItem("rivage:latest-confirmation") ?? "null") as unknown;
    if (typeof value !== "object" || value === null || !("reference" in value) || typeof value.reference !== "string") return {};
    return value as ConfirmationState;
  } catch {
    return {};
  }
}

function dateLabel(value?: string) {
  if (!value) return "À définir";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function dateTimeLabel(value?: string) {
  if (!value) return "Non précisée";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function Confirmation() {
  const location = useLocation();
  const navigationState = (location.state as ConfirmationState | null) ?? {};
  const booking = navigationState.reference ? navigationState : readStoredConfirmation();

  if (!booking.reference) return <Navigate to="/reservation" replace />;
  const isConfirmed = booking.status === "CONFIRMED";

  function downloadCalendarEvent() {
    if (!booking.arrival || !booking.departure || !booking.reference) return;
    const compactDate = (value: string) => value.replaceAll("-", "");
    const content = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Hotel Rivage//Reservation//FR",
      "BEGIN:VEVENT",
      `UID:${booking.reference}@hotel-rivage.fr`,
      `DTSTART;VALUE=DATE:${compactDate(booking.arrival)}`,
      `DTEND;VALUE=DATE:${compactDate(booking.departure)}`,
      `SUMMARY:Séjour à l'Hôtel Rivage`,
      `DESCRIPTION:Demande de réservation ${booking.reference}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hotel-rivage-${booking.reference}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="confirmation-page">
      <div className="confirmation-card">
        <CheckCircle2 className="confirmation-icon" />
        <p className="eyebrow">{isConfirmed ? "Réservation confirmée" : "Demande enregistrée"}</p>
        <h1>{isConfirmed ? "Votre séjour est confirmé." : "Votre réservation nous est bien parvenue."}</h1>
        <p className="confirmation-lead">{isConfirmed
          ? <>La réservation associée à <strong>{booking.email || "votre adresse email"}</strong> est confirmée par l'hôtel.</>
          : <>La demande associée à <strong>{booking.email || "votre adresse email"}</strong> est enregistrée en attente de confirmation manuelle par l'hôtel. L'option sur la chambre est maintenue pendant 24 h.</>}</p>
        <div className="confirmation-reference"><span>Numéro de réservation</span><strong>{booking.reference ?? "À retrouver dans votre confirmation"}</strong></div>
        <dl className="confirmation-details">
          <div><dt>Hébergement</dt><dd>{booking.room ?? "Hôtel Rivage"}</dd></div>
          <div><dt>Dates</dt><dd>{dateLabel(booking.arrival)} → {dateLabel(booking.departure)}</dd></div>
          <div><dt>Voyageurs</dt><dd>{booking.adults ?? 2} adulte(s){booking.children ? ` · ${booking.children} enfant(s)` : ""}</dd></div>
          <div><dt>Options</dt><dd>{booking.options?.length ? booking.options.join(", ") : "Aucune option"}</dd></div>
          <div><dt>Montant du séjour</dt><dd>{booking.total ?? 0} {booking.currency === "EUR" || !booking.currency ? "€" : booking.currency}</dd></div>
          {!isConfirmed && <div><dt>Maintien de la chambre</dt><dd>Jusqu'au {dateTimeLabel(booking.holdExpiresAt)}</dd></div>}
        </dl>
        <div className="confirmation-actions"><button className="btn-secondary" type="button" disabled={!booking.arrival || !booking.departure} onClick={downloadCalendarEvent}><CalendarPlus />Ajouter au calendrier</button><Link className="btn-primary" to="/">Retour à l'accueil</Link></div>
      </div>
    </section>
  );
}
