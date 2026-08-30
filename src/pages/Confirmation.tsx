import { CalendarPlus, CheckCircle2, CreditCard, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { createStripeCheckout, getPaymentConfig, getPublicBooking, getStripeCheckoutStatus } from "../api/hotel";

type ConfirmationState = {
  reference?: string;
  status?: "DRAFT" | "PENDING_PAYMENT" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED" | "EXPIRED" | "COMPLETED" | "NO_SHOW";
  room?: string;
  arrival?: string;
  departure?: string;
  adults?: number;
  children?: number;
  options?: string[];
  total?: number;
  currency?: string;
  accessToken?: string;
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

function amountLabel(total?: number, currency?: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency || "EUR",
  }).format(total ?? 0);
}

export function Confirmation() {
  const location = useLocation();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [paymentStarting, setPaymentStarting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const navigationState = (location.state as ConfirmationState | null) ?? {};
  const [booking, setBooking] = useState<ConfirmationState>(() => navigationState.reference ? navigationState : readStoredConfirmation());
  const paymentReturn = new URLSearchParams(location.search).get("payment");
  const checkoutSessionId = new URLSearchParams(location.search).get("session_id");
  const [paymentSynchronizing, setPaymentSynchronizing] = useState(
    paymentReturn === "success" && Boolean(checkoutSessionId) && Boolean(booking.accessToken),
  );
  const [paymentNotice, setPaymentNotice] = useState<string | null>(
    paymentReturn === "cancelled" ? "Le paiement a été interrompu. Votre demande reste en attente tant que l'option est active." : null,
  );

  const isConfirmed = booking.status === "CONFIRMED" || booking.status === "CHECKED_IN" || booking.status === "COMPLETED";
  const isInactive = booking.status === "CANCELLED" || booking.status === "EXPIRED" || booking.status === "NO_SHOW";

  useEffect(() => {
    const controller = new AbortController();
    getPaymentConfig(controller.signal)
      .then((config) => setStripeAvailable(config.stripeEnabled))
      .catch(() => setStripeAvailable(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!booking.accessToken || paymentReturn === "success") return;
    const accessToken = booking.accessToken;
    const controller = new AbortController();
    getPublicBooking(accessToken, controller.signal)
      .then((freshBooking) => {
        const updated = { ...freshBooking, accessToken } satisfies ConfirmationState;
        setBooking(updated);
        sessionStorage.setItem("rivage:latest-confirmation", JSON.stringify(updated));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [booking.accessToken, paymentReturn]);

  useEffect(() => {
    if (!paymentReturn) return;
    window.history.replaceState(window.history.state, "", location.pathname);
  }, [location.pathname, paymentReturn]);

  useEffect(() => {
    if (paymentReturn !== "success" || !checkoutSessionId || !booking.accessToken) return;
    const sessionId = checkoutSessionId;
    const accessToken = booking.accessToken;
    const controller = new AbortController();
    let timer: number | undefined;
    let attempts = 0;

    async function synchronize() {
      attempts += 1;
      try {
        const result = await getStripeCheckoutStatus(sessionId, accessToken, controller.signal);
        setBooking((current) => {
          const updated = { ...current, ...result.booking } satisfies ConfirmationState;
          sessionStorage.setItem("rivage:latest-confirmation", JSON.stringify(updated));
          return updated;
        });

        if (["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(result.booking.status) && result.paymentStatus === "SUCCEEDED") {
          sessionStorage.removeItem(`rivage:payment-key:${result.booking.reference}`);
          setPaymentNotice("Votre paiement a été confirmé par l'hôtel.");
          setPaymentSynchronizing(false);
          return;
        }
        if (result.paymentStatus === "FAILED" || result.paymentStatus === "CANCELLED") {
          setPaymentError("Le paiement n'a pas été validé. Vous pouvez réessayer tant que l'option est active.");
          setPaymentSynchronizing(false);
          return;
        }
        if (attempts < 10) {
          timer = window.setTimeout(synchronize, 1_000);
          return;
        }
        setPaymentNotice("Le paiement est encore en cours de validation. Vous recevrez un e-mail dès sa confirmation.");
        setPaymentSynchronizing(false);
      } catch (synchronizationError) {
        if (controller.signal.aborted) return;
        if (attempts < 3) {
          timer = window.setTimeout(synchronize, 1_000);
          return;
        }
        setPaymentError(synchronizationError instanceof Error
          ? synchronizationError.message
          : "L'état du paiement ne peut pas être vérifié pour le moment.");
        setPaymentSynchronizing(false);
      }
    }

    void synchronize();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [booking.accessToken, checkoutSessionId, paymentReturn]);

  if (!booking.reference && !paymentSynchronizing) return <Navigate to="/reservation" replace />;

  async function startOnlinePayment() {
    if (!booking.reference || !booking.accessToken || paymentStarting) return;
    setPaymentStarting(true);
    setPaymentError(null);
    const storageKey = `rivage:payment-key:${booking.reference}`;
    const key = sessionStorage.getItem(storageKey) ?? `checkout:${crypto.randomUUID()}`;
    sessionStorage.setItem(storageKey, key);
    try {
      const session = await createStripeCheckout(booking.accessToken, key);
      window.location.assign(session.checkoutUrl);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Le paiement en ligne n'a pas pu être préparé.");
      setPaymentStarting(false);
    }
  }

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

  async function downloadConfirmationPdf() {
    if (!booking.reference || downloadingPdf) return;
    setDownloadingPdf(true);
    setPdfError(null);
    try {
      const { jsPDF } = await import("jspdf");
      const documentPdf = new jsPDF({ unit: "mm", format: "a4" });
      const pageWidth = documentPdf.internal.pageSize.getWidth();
      const margin = 22;
      const contentWidth = pageWidth - margin * 2;
      const statusLabel = isConfirmed ? "Réservation confirmée" : "Demande en attente de confirmation";
      const optionsLabel = booking.options?.length ? booking.options.join(", ") : "Aucune option";
      const rows = [
        ["Hébergement", booking.room ?? "Hôtel Rivage"],
        ["Dates", `${dateLabel(booking.arrival)} - ${dateLabel(booking.departure)}`],
        ["Voyageurs", `${booking.adults ?? 2} adulte(s)${booking.children ? ` - ${booking.children} enfant(s)` : ""}`],
        ["Options", optionsLabel],
        ["Montant du séjour", amountLabel(booking.total, booking.currency)],
        ...(!isConfirmed ? [["Maintien de la chambre", `Jusqu'au ${dateTimeLabel(booking.holdExpiresAt)}`]] : []),
      ];

      documentPdf.setFillColor(43, 39, 34);
      documentPdf.rect(0, 0, pageWidth, 48, "F");
      documentPdf.setTextColor(255, 255, 255);
      documentPdf.setFont("helvetica", "bold");
      documentPdf.setFontSize(21);
      documentPdf.text("Hôtel Rivage", margin, 23);
      documentPdf.setFont("helvetica", "normal");
      documentPdf.setFontSize(10);
      documentPdf.text("Confirmation de séjour", margin, 32);

      documentPdf.setTextColor(146, 112, 71);
      documentPdf.setFont("helvetica", "bold");
      documentPdf.setFontSize(10);
      documentPdf.text(statusLabel.toUpperCase(), margin, 67);
      documentPdf.setTextColor(43, 39, 34);
      documentPdf.setFontSize(20);
      documentPdf.text(booking.reference, margin, 78, { maxWidth: contentWidth });

      let cursorY = 96;
      for (const [label, rawValue] of rows) {
        const value = String(rawValue);
        const wrappedValue = documentPdf.splitTextToSize(value, contentWidth - 48) as string[];
        const rowHeight = Math.max(13, wrappedValue.length * 5 + 7);
        documentPdf.setDrawColor(226, 220, 212);
        documentPdf.line(margin, cursorY - 5, pageWidth - margin, cursorY - 5);
        documentPdf.setFont("helvetica", "normal");
        documentPdf.setFontSize(9);
        documentPdf.setTextColor(113, 104, 94);
        documentPdf.text(label, margin, cursorY + 2);
        documentPdf.setFont("helvetica", "bold");
        documentPdf.setTextColor(43, 39, 34);
        documentPdf.text(wrappedValue, margin + 48, cursorY + 2);
        cursorY += rowHeight;
      }

      documentPdf.setDrawColor(226, 220, 212);
      documentPdf.line(margin, cursorY - 5, pageWidth - margin, cursorY - 5);
      documentPdf.setFillColor(242, 236, 227);
      documentPdf.roundedRect(margin, cursorY + 7, contentWidth, 30, 2, 2, "F");
      documentPdf.setFont("helvetica", "bold");
      documentPdf.setTextColor(43, 39, 34);
      documentPdf.setFontSize(11);
      documentPdf.text(isConfirmed ? "Votre séjour est confirmé." : "Votre demande a bien été enregistrée.", margin + 8, cursorY + 19);
      documentPdf.setFont("helvetica", "normal");
      documentPdf.setFontSize(9);
      documentPdf.setTextColor(113, 104, 94);
      documentPdf.text("26 avenue des Pins, 06400 Cannes - contact@hotel-rivage.fr", margin + 8, cursorY + 28);
      documentPdf.setFontSize(8);
      documentPdf.text("Récapitulatif informatif : ce document ne constitue ni une facture ni une preuve de paiement.", margin, 282);

      documentPdf.save(`hotel-rivage-${booking.reference.replace(/[^a-z0-9-]/gi, "-")}.pdf`);
    } catch {
      setPdfError("Le PDF n’a pas pu être généré. Réessayez dans quelques instants.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <section className="confirmation-page">
      <div className="confirmation-card">
        <CheckCircle2 className="confirmation-icon" />
        <p className="eyebrow">{isConfirmed ? "Réservation confirmée" : "Demande enregistrée"}</p>
        <h1>{isConfirmed ? "Votre séjour est confirmé." : "Votre réservation nous est bien parvenue."}</h1>
        <p className="confirmation-lead">{isConfirmed
          ? <>La réservation a été confirmée par l'hôtel. Un récapitulatif a été envoyé à l'adresse renseignée lors de la réservation.</>
          : <>La demande est enregistrée en attente de confirmation manuelle par l'hôtel. L'option sur la chambre est maintenue pendant 24 h.</>}</p>
        <div className="confirmation-reference"><span>Numéro de réservation</span><strong>{booking.reference ?? "À retrouver dans votre confirmation"}</strong></div>
        <dl className="confirmation-details">
          <div><dt>Hébergement</dt><dd>{booking.room ?? "Hôtel Rivage"}</dd></div>
          <div><dt>Dates</dt><dd>{dateLabel(booking.arrival)} → {dateLabel(booking.departure)}</dd></div>
          <div><dt>Voyageurs</dt><dd>{booking.adults ?? 2} adulte(s){booking.children ? ` · ${booking.children} enfant(s)` : ""}</dd></div>
          <div><dt>Options</dt><dd>{booking.options?.length ? booking.options.join(", ") : "Aucune option"}</dd></div>
          <div><dt>Montant du séjour</dt><dd>{amountLabel(booking.total, booking.currency)}</dd></div>
          {!isConfirmed && <div><dt>Maintien de la chambre</dt><dd>Jusqu'au {dateTimeLabel(booking.holdExpiresAt)}</dd></div>}
        </dl>
        {paymentSynchronizing && <p className="confirmation-payment-notice" role="status">Vérification du paiement auprès de l'hôtel…</p>}
        {paymentNotice && !paymentSynchronizing && <p className="confirmation-payment-notice" role="status">{paymentNotice}</p>}
        {(pdfError || paymentError) && <p className="confirmation-download-error" role="alert">{pdfError ?? paymentError}</p>}
        <div className="confirmation-actions">
          {!isConfirmed && !isInactive && paymentReturn !== "success" && stripeAvailable && booking.accessToken && <button className="btn-primary" type="button" disabled={paymentStarting} onClick={startOnlinePayment}><CreditCard />{paymentStarting ? "Redirection…" : "Payer en ligne"}</button>}
          <button className="btn-secondary" type="button" disabled={downloadingPdf} onClick={downloadConfirmationPdf}><Download />{downloadingPdf ? "Préparation…" : "Télécharger le récapitulatif"}</button>
          <button className="btn-secondary" type="button" disabled={!booking.arrival || !booking.departure} onClick={downloadCalendarEvent}><CalendarPlus />Ajouter au calendrier</button>
          <Link className="btn-primary" to="/">Retour à l'accueil</Link>
        </div>
      </div>
    </section>
  );
}
