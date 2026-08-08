import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

type ConfirmationState = {
  reference?: string;
  room?: string;
  arrival?: string;
  departure?: string;
  adults?: number;
  children?: number;
  options?: string[];
  total?: number;
  email?: string;
};

function dateLabel(value?: string) {
  if (!value) return "À définir";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

export function Confirmation() {
  const location = useLocation();
  const booking = (location.state as ConfirmationState | null) ?? {};

  return (
    <section className="confirmation-page">
      <div className="confirmation-card">
        <CheckCircle2 className="confirmation-icon" />
        <p className="eyebrow">Réservation confirmée</p>
        <h1>Votre séjour est réservé.</h1>
        <p className="confirmation-lead">Une confirmation a été préparée pour <strong>{booking.email || "votre adresse email"}</strong>. Aucun paiement réel n'a été effectué dans cette démonstration.</p>
        <div className="confirmation-reference"><span>Numéro de réservation</span><strong>{booking.reference ?? "RVG-DEMO01"}</strong></div>
        <dl className="confirmation-details">
          <div><dt>Hébergement</dt><dd>{booking.room ?? "Hôtel Rivage"}</dd></div>
          <div><dt>Dates</dt><dd>{dateLabel(booking.arrival)} → {dateLabel(booking.departure)}</dd></div>
          <div><dt>Voyageurs</dt><dd>{booking.adults ?? 2} adulte(s){booking.children ? ` · ${booking.children} enfant(s)` : ""}</dd></div>
          <div><dt>Options</dt><dd>{booking.options?.length ? booking.options.join(", ") : "Aucune option"}</dd></div>
          <div><dt>Montant payé</dt><dd>{booking.total ?? 0} €</dd></div>
        </dl>
        <div className="confirmation-actions"><button className="btn-secondary" type="button"><CalendarPlus />Ajouter au calendrier</button><Link className="btn-primary" to="/">Retour à l'accueil</Link></div>
      </div>
    </section>
  );
}
