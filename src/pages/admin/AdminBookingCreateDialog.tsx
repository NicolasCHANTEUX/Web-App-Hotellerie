import {
  BedDouble,
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardCheck,
  Mail,
  Phone,
  Plus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AdminApiError,
  AdminBookingDetail,
  CreateAdminBookingInput,
  createAdminBooking,
  getAdminBookingOptions,
  getAdminBookingQuote,
} from "../../api/admin";
import type { BookingQuote } from "../../types/hotel";
import { useAdminAuth } from "../../admin/auth";
import { formatMoney } from "../../admin/ui";

type BookingSource = CreateAdminBookingInput["source"];

const sourceLabels: Record<BookingSource, string> = {
  PHONE: "Téléphone",
  EMAIL: "E-mail",
  WALK_IN: "Client sur place",
  ADMIN: "Saisie interne",
};

function dateInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function nextDate(value: string, days = 1) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateInputValue(date);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPhone(value: string) {
  return value.replace(/\D/g, "").length >= 7;
}

export function AdminBookingCreateDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (booking: AdminBookingDetail) => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const today = useMemo(() => dateInputValue(), []);
  const [arrival, setArrival] = useState(today);
  const [departure, setDeparture] = useState(() => nextDate(today));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [source, setSource] = useState<BookingSource>("PHONE");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("FR");
  const [specialRequests, setSpecialRequests] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getAdminBookingOptions>> | null>(null);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const requestAttemptRef = useRef<{ signature: string; key: string } | null>(null);
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const datesValid = Boolean(arrival && departure && departure > arrival && arrival >= today);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => firstInputRef.current?.focus());
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
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
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyboard);
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (!accessToken || !datesValid) {
      setOptions(null);
      setRoomTypeId("");
      return;
    }
    const controller = new AbortController();
    setOptionsLoading(true);
    setError(null);
    getAdminBookingOptions({ arrival, departure, adults, children }, accessToken, controller.signal)
      .then((data) => {
        setOptions(data);
        setRoomTypeId((current) => data.roomTypes.some((room) => room.id === current) ? current : data.roomTypes[0]?.id ?? "");
        setExtraIds((current) => current.filter((id) => data.extras.some((extra) => extra.id === id)));
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
        setOptions(null);
        setRoomTypeId("");
        setError(nextError instanceof Error ? nextError.message : "Les disponibilités n’ont pas pu être chargées.");
      })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [accessToken, adults, arrival, children, datesValid, departure, logout]);

  useEffect(() => {
    if (!accessToken || !datesValid || !roomTypeId) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setQuoteLoading(true);
      setError(null);
      getAdminBookingQuote({ roomTypeId, arrival, departure, adults, children, extraIds }, accessToken, controller.signal)
        .then(setQuote)
        .catch((nextError: unknown) => {
          if (controller.signal.aborted) return;
          if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
          setQuote(null);
          setError(nextError instanceof Error ? nextError.message : "Le devis n’a pas pu être calculé.");
        })
        .finally(() => { if (!controller.signal.aborted) setQuoteLoading(false); });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accessToken, adults, arrival, children, datesValid, departure, extraIds, logout, quoteRetry, roomTypeId]);

  const emailIsValid = !email.trim() || validEmail(email);
  const phoneIsValid = !phone.trim() || validPhone(phone);
  const contactIsValid = emailIsValid
    && phoneIsValid
    && (source !== "EMAIL" || validEmail(email))
    && (source !== "PHONE" || validPhone(phone));
  const formValid = Boolean(
    quote
    && firstName.trim()
    && lastName.trim()
    && contactIsValid
    && /^[A-Za-z]{2}$/.test(countryCode.trim())
    && termsAccepted,
  );

  function toggleExtra(id: string) {
    setExtraIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !quote || !formValid || savingRef.current) return;
    const input: CreateAdminBookingInput = {
      source,
      roomTypeId,
      arrival,
      departure,
      adults,
      children,
      extraIds,
      expectedTotal: Math.round(quote.total * 100),
      termsAccepted: true,
      guest: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        countryCode: countryCode.trim().toUpperCase(),
      },
      ...(specialRequests.trim() ? { specialRequests: specialRequests.trim() } : {}),
    };
    const signature = JSON.stringify(input);
    if (!requestAttemptRef.current || requestAttemptRef.current.signature !== signature) {
      requestAttemptRef.current = { signature, key: crypto.randomUUID() };
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const booking = await createAdminBooking(input, requestAttemptRef.current.key, accessToken);
      requestAttemptRef.current = null;
      onCreated(booking);
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      if (nextError instanceof AdminApiError && nextError.code === "PRICE_CHANGED") {
        setQuoteRetry((value) => value + 1);
      }
      setError(nextError instanceof Error ? nextError.message : "La réservation n’a pas pu être créée.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="admin-room-dialog-layer admin-booking-create-layer">
      <button type="button" className="admin-room-dialog-backdrop" aria-label="Fermer la création de réservation" disabled={saving} onClick={onClose} />
      <section ref={dialogRef} className="admin-room-dialog admin-booking-create-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <header className="admin-room-dialog-head">
          <div>
            <p>Nouvelle réservation</p>
            <h2 id={titleId}>Créer un séjour</h2>
            <span id={descriptionId}>La disponibilité et le prix sont vérifiés par le serveur avant confirmation.</span>
          </div>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Fermer"><X /></button>
        </header>

        <form className="admin-room-dialog-body admin-booking-create-form" onSubmit={submitBooking} noValidate aria-busy={saving}>
          <div className="admin-booking-create-columns">
            <div>
              <section className="admin-room-dialog-section">
                <h3><CalendarDays />Séjour et voyageurs</h3>
                <div className="admin-room-form-grid">
                  <label>Arrivée<input ref={firstInputRef} type="date" min={today} value={arrival} onChange={(event) => { const value = event.target.value; setArrival(value); if (departure <= value) setDeparture(nextDate(value)); }} /></label>
                  <label>Départ<input type="date" min={arrival ? nextDate(arrival) : today} value={departure} onChange={(event) => setDeparture(event.target.value)} /></label>
                  <label>Adultes<input type="number" min={1} max={10} value={adults} onChange={(event) => setAdults(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label>
                  <label>Enfants<input type="number" min={0} max={10} value={children} onChange={(event) => setChildren(Math.max(0, Math.min(10, Number(event.target.value) || 0)))} /></label>
                  <label className="admin-room-form-notes">Origine<select value={source} onChange={(event) => setSource(event.target.value as BookingSource)}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                </div>
              </section>

              <section className="admin-room-dialog-section">
                <h3><BedDouble />Hébergement disponible</h3>
                {optionsLoading && <p className="admin-booking-create-muted">Recherche des chambres disponibles…</p>}
                {!optionsLoading && options && options.roomTypes.length === 0 && <p className="admin-booking-create-empty">Aucun type de chambre ne peut accueillir ce séjour.</p>}
                {!optionsLoading && options && options.roomTypes.length > 0 && <div className="admin-booking-room-options">{options.roomTypes.map((room) => (
                  <label key={room.id} className={roomTypeId === room.id ? "selected" : ""}>
                    <input type="radio" name="room-type" value={room.id} checked={roomTypeId === room.id} onChange={() => setRoomTypeId(room.id)} />
                    <span><strong>{room.name}</strong><small>{room.availableUnits} chambre{room.availableUnits === 1 ? "" : "s"} disponible{room.availableUnits === 1 ? "" : "s"} · jusqu’à {room.capacity} pers.</small></span>
                    <strong>{formatMoney(room.price, room.currency)}<small>/ nuit</small></strong>
                  </label>
                ))}</div>}
              </section>

              {options && options.extras.length > 0 && <section className="admin-room-dialog-section">
                <h3><Plus />Options</h3>
                <div className="admin-booking-extra-options">{options.extras.map((extra) => (
                  <label key={extra.id}>
                    <input type="checkbox" checked={extraIds.includes(extra.id)} onChange={() => toggleExtra(extra.id)} />
                    <span><strong>{extra.name}</strong><small>{extra.description}</small></span>
                    <strong>{formatMoney(extra.price, extra.currency)}</strong>
                  </label>
                ))}</div>
              </section>}
            </div>

            <div>
              <section className="admin-room-dialog-section">
                <h3><UserRound />Client principal</h3>
                <div className="admin-room-form-grid">
                  <label>Prénom<input required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
                  <label>Nom<input required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
                  <label className="admin-room-form-notes"><span><Mail />E-mail {source !== "EMAIL" && <em>(facultatif)</em>}</span><input required={source === "EMAIL"} type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  <label><span><Phone />Téléphone {source !== "PHONE" && <em>(facultatif)</em>}</span><input required={source === "PHONE"} type="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                  <label>Code pays<input required maxLength={2} value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} /></label>
                  <label className="admin-room-form-notes"><span><Users />Demande particulière</span><textarea rows={3} maxLength={2000} value={specialRequests} onChange={(event) => setSpecialRequests(event.target.value)} /></label>
                </div>
              </section>

              <section className="admin-room-dialog-section admin-booking-quote-card">
                <h3><CircleDollarSign />Devis TTC</h3>
                {quoteLoading && <p className="admin-booking-create-muted">Actualisation du tarif…</p>}
                {!quoteLoading && !quote && <p className="admin-booking-create-muted">Sélectionnez un hébergement pour calculer le séjour.</p>}
                {quote && <dl>
                  <div><dt>{quote.room.name} · {quote.nights} nuit(s)</dt><dd>{formatMoney(quote.accommodationTotal, quote.currency)}</dd></div>
                  {quote.extras.map((extra) => <div key={extra.id}><dt>{extra.name} × {extra.quantity}</dt><dd>{formatMoney(extra.total, quote.currency)}</dd></div>)}
                  <div><dt>dont TVA incluse</dt><dd>{formatMoney(quote.vatTotalIncluded, quote.currency)}</dd></div>
                  {quote.touristTaxTotal > 0 && <div><dt>Taxe de séjour</dt><dd>{formatMoney(quote.touristTaxTotal, quote.currency)}</dd></div>}
                  <div className="total"><dt>Total à régler</dt><dd>{formatMoney(quote.total, quote.currency)}</dd></div>
                </dl>}
              </section>

              <label className="admin-booking-terms">
                <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
                <span><ClipboardCheck /><span><strong>CGV communiquées et acceptées</strong><small>Confirmez que le client a accepté les conditions du tarif par le canal indiqué.</small></span></span>
              </label>
            </div>
          </div>

          {error && <p className="admin-room-save-error" role="alert">{error}</p>}
          <footer className="admin-room-dialog-actions admin-booking-create-actions">
            <span>La chambre physique disponible sera attribuée automatiquement.</span>
            <div>
              <button type="button" className="admin-room-dialog-cancel" disabled={saving} onClick={onClose}>Annuler</button>
              <button type="submit" className="admin-room-dialog-save admin-booking-create-submit" disabled={!formValid || saving || quoteLoading}>
                {saving ? <span className="admin-spinner light" /> : <Check />}
                {saving ? "Confirmation…" : "Créer et confirmer"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
