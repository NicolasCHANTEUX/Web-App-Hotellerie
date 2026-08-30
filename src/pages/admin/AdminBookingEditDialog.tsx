import {
  BedDouble,
  CalendarDays,
  Check,
  CircleDollarSign,
  LockKeyhole,
  Mail,
  Phone,
  Plus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { BookingQuote } from "../../types/hotel";
import {
  AdminApiError,
  AdminBookingDetail,
  AdminBookingOptions,
  UpdateAdminBookingInput,
  getAdminBookingOptions,
  getAdminBookingUpdateQuote,
  updateAdminBooking,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import { formatMoney } from "../../admin/ui";

function nextDate(value: string, days = 1) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPhone(value: string) {
  return value.replace(/\D/g, "").length >= 7;
}

export function AdminBookingEditDialog({ booking, onClose, onSaved }: {
  booking: AdminBookingDetail;
  onClose: () => void;
  onSaved: (booking: AdminBookingDetail) => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const initialRoomTypeId = booking.rooms[0]?.roomTypeId ?? "";
  const initialExtraIds = useMemo(() => booking.extras.map((extra) => extra.extraId).sort(), [booking.extras]);
  const [arrival, setArrival] = useState(booking.checkIn);
  const [departure, setDeparture] = useState(booking.checkOut);
  const [adults, setAdults] = useState(booking.adults);
  const [children, setChildren] = useState(booking.children);
  const [roomTypeId, setRoomTypeId] = useState(initialRoomTypeId);
  const [extraIds, setExtraIds] = useState(initialExtraIds);
  const [firstName, setFirstName] = useState(booking.guest?.firstName ?? "");
  const [lastName, setLastName] = useState(booking.guest?.lastName ?? "");
  const [email, setEmail] = useState(booking.guest?.email ?? "");
  const [phone, setPhone] = useState(booking.guest?.phone ?? "");
  const [countryCode, setCountryCode] = useState(booking.guest?.countryCode ?? "FR");
  const [specialRequests, setSpecialRequests] = useState(booking.specialRequests ?? "");
  const [reason, setReason] = useState("");
  const [options, setOptions] = useState<AdminBookingOptions | null>(null);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const today = useMemo(todayValue, []);
  const financialLocked = booking.payments.length > 0;
  const datesValid = Boolean(arrival && departure && departure > arrival && arrival >= today);
  const sortedExtraIds = [...extraIds].sort();
  const selectionChanged = arrival !== booking.checkIn
    || departure !== booking.checkOut
    || adults !== booking.adults
    || children !== booking.children
    || roomTypeId !== initialRoomTypeId
    || sortedExtraIds.length !== initialExtraIds.length
    || sortedExtraIds.some((id, index) => id !== initialExtraIds[index]);

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
    if (!accessToken || !datesValid || financialLocked) return;
    const controller = new AbortController();
    setOptionsLoading(true);
    setError(null);
    getAdminBookingOptions({ arrival, departure, adults, children }, accessToken, controller.signal)
      .then(setOptions)
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
        setOptions(null);
        setError(nextError instanceof Error ? nextError.message : "Les disponibilités n’ont pas pu être chargées.");
      })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [accessToken, adults, arrival, children, datesValid, departure, financialLocked, logout]);

  useEffect(() => {
    if (!accessToken || !datesValid || !roomTypeId || !selectionChanged || financialLocked) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setQuoteLoading(true);
      setError(null);
      getAdminBookingUpdateQuote(
        booking.id,
        { roomTypeId, arrival, departure, adults, children, extraIds },
        accessToken,
        controller.signal,
      )
        .then(setQuote)
        .catch((nextError: unknown) => {
          if (controller.signal.aborted) return;
          if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
          setQuote(null);
          setError(nextError instanceof Error ? nextError.message : "Le nouveau devis n’a pas pu être calculé.");
        })
        .finally(() => { if (!controller.signal.aborted) setQuoteLoading(false); });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accessToken, adults, arrival, booking.id, children, datesValid, departure, extraIds, financialLocked, logout, quoteRetry, roomTypeId, selectionChanged]);

  const emailIsValid = !email.trim() || validEmail(email);
  const phoneIsValid = !phone.trim() || validPhone(phone);
  const contactIsValid = emailIsValid
    && phoneIsValid
    && (booking.source !== "EMAIL" || validEmail(email))
    && (booking.source !== "PHONE" || validPhone(phone));
  const formValid = Boolean(
    firstName.trim()
    && lastName.trim()
    && /^[A-Za-z]{2}$/.test(countryCode.trim())
    && contactIsValid
    && (!selectionChanged || quote),
  );

  function toggleExtra(id: string) {
    setExtraIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !formValid || savingRef.current) return;
    const input: UpdateAdminBookingInput = {
      updatedAt: booking.updatedAt,
      roomTypeId,
      arrival,
      departure,
      adults,
      children,
      extraIds,
      expectedTotal: Math.round((selectionChanged ? quote!.total : booking.total) * 100),
      guest: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        countryCode: countryCode.trim().toUpperCase(),
      },
      specialRequests: specialRequests.trim(),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAdminBooking(booking.id, input, accessToken);
      onSaved(updated);
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      if (nextError instanceof AdminApiError && nextError.code === "PRICE_CHANGED") {
        setQuoteRetry((value) => value + 1);
      }
      setError(nextError instanceof Error ? nextError.message : "La réservation n’a pas pu être modifiée.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const currentRoomMissing = !options?.roomTypes.some((room) => room.id === initialRoomTypeId);
  const missingExtras = booking.extras.filter((extra) =>
    extraIds.includes(extra.extraId) && !options?.extras.some((option) => option.id === extra.extraId));

  return (
    <div className="admin-room-dialog-layer admin-booking-create-layer">
      <button type="button" className="admin-room-dialog-backdrop" aria-label="Fermer la modification" disabled={saving} onClick={onClose} />
      <section ref={dialogRef} className="admin-room-dialog admin-booking-create-dialog admin-booking-edit-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <header className="admin-room-dialog-head">
          <div><p>Réservation {booking.reference}</p><h2 id={titleId}>Modifier le séjour</h2><span id={descriptionId}>La disponibilité et le tarif sont revérifiés avant l’enregistrement.</span></div>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Fermer"><X /></button>
        </header>

        <form className="admin-room-dialog-body admin-booking-create-form" onSubmit={submit} noValidate aria-busy={saving}>
          <div className="admin-booking-create-columns">
            <div>
              <section className="admin-room-dialog-section">
                <h3><CalendarDays />Séjour et voyageurs</h3>
                {financialLocked && <p className="admin-booking-edit-lock"><LockKeyhole />Le séjour et son tarif sont verrouillés car un paiement existe. Les coordonnées restent modifiables.</p>}
                <div className="admin-room-form-grid">
                  <label>Arrivée<input ref={firstInputRef} disabled={financialLocked} type="date" min={today} value={arrival} onChange={(event) => { const value = event.target.value; setArrival(value); if (departure <= value) setDeparture(nextDate(value)); }} /></label>
                  <label>Départ<input disabled={financialLocked} type="date" min={nextDate(arrival)} value={departure} onChange={(event) => setDeparture(event.target.value)} /></label>
                  <label>Adultes<input disabled={financialLocked} type="number" min={1} max={10} value={adults} onChange={(event) => setAdults(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label>
                  <label>Enfants<input disabled={financialLocked} type="number" min={0} max={10} value={children} onChange={(event) => setChildren(Math.max(0, Math.min(10, Number(event.target.value) || 0)))} /></label>
                </div>
              </section>

              <section className="admin-room-dialog-section">
                <h3><BedDouble />Hébergement</h3>
                {optionsLoading && <p className="admin-booking-create-muted">Recherche des disponibilités…</p>}
                <div className="admin-booking-room-options">
                  {currentRoomMissing && <label className={roomTypeId === initialRoomTypeId ? "selected" : ""}>
                    <input disabled={financialLocked} type="radio" name="edit-room-type" checked={roomTypeId === initialRoomTypeId} onChange={() => setRoomTypeId(initialRoomTypeId)} />
                    <span><strong>{booking.rooms[0]?.roomTypeName}</strong><small>Hébergement actuel · disponibilité revérifiée au devis</small></span>
                    <strong>{formatMoney(booking.rooms[0]?.nightlyPrice ?? 0, booking.currency)}<small>/ nuit</small></strong>
                  </label>}
                  {options?.roomTypes.map((room) => <label key={room.id} className={roomTypeId === room.id ? "selected" : ""}>
                    <input disabled={financialLocked} type="radio" name="edit-room-type" value={room.id} checked={roomTypeId === room.id} onChange={() => setRoomTypeId(room.id)} />
                    <span><strong>{room.name}</strong><small>{room.availableUnits ?? 0} disponible(s) · jusqu’à {room.capacity} pers.</small></span>
                    <strong>{formatMoney(room.price, room.currency)}<small>/ nuit</small></strong>
                  </label>)}
                </div>
              </section>

              {(options?.extras.length || missingExtras.length) ? <section className="admin-room-dialog-section">
                <h3><Plus />Options</h3>
                <div className="admin-booking-extra-options">
                  {options?.extras.map((extra) => <label key={extra.id}><input disabled={financialLocked} type="checkbox" checked={extraIds.includes(extra.id)} onChange={() => toggleExtra(extra.id)} /><span><strong>{extra.name}</strong><small>{extra.description}</small></span><strong>{formatMoney(extra.price, extra.currency)}</strong></label>)}
                  {missingExtras.map((extra) => <label key={extra.extraId}><input disabled={financialLocked} type="checkbox" checked onChange={() => toggleExtra(extra.extraId)} /><span><strong>{extra.name}</strong><small>Option actuelle non proposée aux nouvelles réservations</small></span><strong>{formatMoney(extra.lineTotal, booking.currency)}</strong></label>)}
                </div>
              </section> : null}
            </div>

            <div>
              <section className="admin-room-dialog-section">
                <h3><UserRound />Client principal</h3>
                <div className="admin-room-form-grid">
                  <label>Prénom<input required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
                  <label>Nom<input required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
                  <label className="admin-room-form-notes"><span><Mail />E-mail {booking.source !== "EMAIL" && <em>(facultatif)</em>}</span><input required={booking.source === "EMAIL"} type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  <label><span><Phone />Téléphone {booking.source !== "PHONE" && <em>(facultatif)</em>}</span><input required={booking.source === "PHONE"} type="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                  <label>Code pays<input required maxLength={2} value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} /></label>
                  <label className="admin-room-form-notes"><span><Users />Demande particulière</span><textarea rows={3} maxLength={2000} value={specialRequests} onChange={(event) => setSpecialRequests(event.target.value)} /></label>
                  <label className="admin-room-form-notes">Motif interne <em>(facultatif)</em><textarea rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                </div>
              </section>

              <section className="admin-room-dialog-section admin-booking-quote-card">
                <h3><CircleDollarSign />Tarif TTC</h3>
                {!selectionChanged && <dl><div><dt>Tarif actuel conservé</dt><dd>{formatMoney(booking.total, booking.currency)}</dd></div></dl>}
                {quoteLoading && <p className="admin-booking-create-muted">Actualisation du tarif…</p>}
                {selectionChanged && quote && <dl>
                  <div><dt>{quote.room.name} · {quote.nights} nuit(s)</dt><dd>{formatMoney(quote.accommodationTotal, quote.currency)}</dd></div>
                  {quote.extras.map((extra) => <div key={extra.id}><dt>{extra.name} × {extra.quantity}</dt><dd>{formatMoney(extra.total, quote.currency)}</dd></div>)}
                  <div><dt>dont TVA incluse</dt><dd>{formatMoney(quote.vatTotalIncluded, quote.currency)}</dd></div>
                  {quote.touristTaxTotal > 0 && <div><dt>Taxe de séjour</dt><dd>{formatMoney(quote.touristTaxTotal, quote.currency)}</dd></div>}
                  <div className="total"><dt>Nouveau total</dt><dd>{formatMoney(quote.total, quote.currency)}</dd></div>
                </dl>}
              </section>
            </div>
          </div>

          {error && <p className="admin-room-save-error" role="alert">{error}</p>}
          <footer className="admin-room-dialog-actions admin-booking-create-actions">
            <span>Chaque modification est enregistrée dans le journal d’audit.</span>
            <div><button type="button" className="admin-room-dialog-cancel" disabled={saving} onClick={onClose}>Annuler</button><button type="submit" className="admin-room-dialog-save admin-booking-create-submit" disabled={!formValid || saving || quoteLoading}>{saving ? <span className="admin-spinner light" /> : <Check />}{saving ? "Enregistrement…" : "Enregistrer les modifications"}</button></div>
          </footer>
        </form>
      </section>
    </div>
  );
}
