import { Check, LockKeyhole } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createBooking, getAvailability, getBookingQuote, getExtras } from "../api/hotel";
import { BookingStepper } from "../components/BookingStepper";
import { ResponsiveImage } from "../components/ResponsiveImage";
import { useRemoteData } from "../hooks/useRemoteData";
import { Accommodation, AvailabilityResult, BookingOption, BookingQuote } from "../types/hotel";

type Customer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  specialRequest: string;
};

const emptyCustomer: Customer = { firstName: "", lastName: "", email: "", phone: "", country: "France", specialRequest: "" };

const countryCodes: Record<string, string> = {
  France: "FR",
  Belgique: "BE",
  Suisse: "CH",
  Luxembourg: "LU",
};

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAfter(value: string, days = 1) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateInputValue(days);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function optionPriceLabel(option: BookingOption) {
  if (option.unit === "PER_PERSON_PER_NIGHT") return "par personne / nuit";
  if (option.unit === "PER_NIGHT") return "par nuit";
  return "une fois";
}

function dateLabel(value: string) {
  if (!value) return "À définir";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
}

function numberOfNights(arrival: string, departure: string) {
  const duration = (Date.parse(departure) - Date.parse(arrival)) / 86_400_000;
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 1;
}

function optionAmount(option: BookingOption, nights: number, guests: number) {
  if (option.unit === "PER_PERSON_PER_NIGHT") return option.price * nights * guests;
  if (option.unit === "PER_NIGHT") return option.price * nights;
  return option.price;
}

export function Booking() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const hasSearch = Boolean(params.get("arrival") && params.get("departure") && params.get("step") === "2");
  const [step, setStep] = useState(hasSearch ? 2 : 1);
  const [arrival, setArrival] = useState(params.get("arrival") ?? dateInputValue(1));
  const [departure, setDeparture] = useState(params.get("departure") ?? dateInputValue(2));
  const [adults, setAdults] = useState(Number(params.get("adults") ?? 2));
  const [children, setChildren] = useState(Number(params.get("children") ?? 0));
  const [roomSlug, setRoomSlug] = useState(params.get("room") ?? "");
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customer, setCustomer] = useState<Customer>(emptyCustomer);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [dateError, setDateError] = useState<string | null>(null);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [quoteKey, setQuoteKey] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const optionsQuery = useRemoteData((signal) => getExtras(signal), []);
  const bookingOptions = optionsQuery.data ?? [];

  const availableRooms = availability?.roomTypes ?? [];
  const room = availableRooms.find((item) => item.slug === roomSlug);
  const nights = numberOfNights(arrival, departure);
  const guests = adults + children;
  const chosenOptions = bookingOptions.filter((item) => selectedOptions.includes(item.id));
  const currentQuoteKey = room
    ? JSON.stringify([room.id, arrival, departure, adults, children, [...selectedOptions].sort()])
    : "";
  const activeQuote = quoteKey === currentQuoteKey ? quote : null;
  const roomSubtotal = activeQuote?.accommodationTotal ?? (room ? room.price * nights : 0);
  const optionsSubtotal = activeQuote?.extrasTotal ?? chosenOptions.reduce((sum, item) => sum + optionAmount(item, nights, guests), 0);
  const vatTaxes = activeQuote?.vatTotalIncluded ?? 0;
  const touristTax = activeQuote?.touristTaxTotal ?? room?.touristTaxTotal ?? 0;
  const total = activeQuote?.total ?? roomSubtotal + optionsSubtotal + touristTax;

  useEffect(() => {
    if (step !== 2) return;
    const controller = new AbortController();
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    getAvailability({ arrival, departure, adults, children }, controller.signal)
      .then((result) => {
        setAvailability(result);
        setRoomSlug((current) => result.roomTypes.some((item) => item.slug === current) ? current : "");
        setAvailabilityLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAvailability(null);
        setAvailabilityError(error instanceof Error ? error.message : "La recherche est momentanément indisponible.");
        setAvailabilityLoading(false);
      });
    return () => controller.abort();
  }, [step, arrival, departure, adults, children, availabilityRetry]);

  useEffect(() => {
    if (!room) {
      setQuote(null);
      setQuoteKey("");
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }

    const controller = new AbortController();
    const requestedKey = currentQuoteKey;
    setQuote(null);
    setQuoteKey("");
    setQuoteLoading(true);
    setQuoteError(null);
    getBookingQuote({
      roomTypeId: room.id,
      arrival,
      departure,
      adults,
      children,
      extraIds: selectedOptions,
    }, controller.signal)
      .then((result) => {
        setQuote(result);
        setQuoteKey(requestedKey);
        setQuoteLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setQuoteError(error instanceof Error ? error.message : "Le prix du séjour n'a pas pu être calculé.");
        setQuoteLoading(false);
      });
    return () => controller.abort();
  }, [currentQuoteKey, room, arrival, departure, adults, children, selectedOptions, quoteRetry]);

  function validateDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (arrival < dateInputValue(0)) {
      setDateError("La date d'arrivée ne peut pas être dans le passé.");
      return;
    }
    if (Date.parse(departure) <= Date.parse(arrival)) {
      setDateError("Le départ doit avoir lieu au moins un jour après l'arrivée.");
      return;
    }
    setDateError(null);
    setStep(2);
  }

  function toggleOption(id: string) {
    setSelectedOptions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function updateCustomer(field: keyof Customer, value: string) {
    setCustomer((current) => ({ ...current, [field]: value }));
  }

  function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStep(5);
  }

  async function completeBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!room || !activeQuote || quoteLoading || bookingSubmitting || !termsAccepted) return;

    setBookingSubmitting(true);
    setBookingError(null);
    try {
      const booking = await createBooking({
        roomTypeId: room.id,
        arrival,
        departure,
        adults,
        children,
        extraIds: selectedOptions,
        expectedTotal: Math.round(activeQuote.total * 100),
        termsAccepted: true,
        guest: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          countryCode: countryCodes[customer.country],
        },
        specialRequests: customer.specialRequest.trim() || undefined,
      }, idempotencyKey);

      if (booking.status !== "PENDING_PAYMENT" && booking.status !== "CONFIRMED") {
        setBookingError("Cette demande n'est plus active. Relancez la recherche pour réserver à nouveau.");
        setIdempotencyKey(crypto.randomUUID());
        setBookingSubmitting(false);
        return;
      }

      const confirmationState = {
        reference: booking.reference,
        status: booking.status,
        room: booking.room.name,
        arrival: booking.arrival,
        departure: booking.departure,
        adults: booking.adults,
        children: booking.children,
        options: booking.options,
        total: booking.total,
        currency: booking.currency,
        accessToken: booking.accessToken,
        holdExpiresAt: booking.holdExpiresAt,
      };
      sessionStorage.setItem("rivage:latest-confirmation", JSON.stringify(confirmationState));
      navigate("/confirmation", {
        state: confirmationState,
      });
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "La réservation n'a pas pu être enregistrée.");
      setBookingSubmitting(false);
    }
  }

  return (
    <section className="booking-page">
      <header className="booking-heading">
        <h1>Réserver votre séjour</h1>
        <p>Réservation directe · Tarif affiché en toute transparence</p>
      </header>

      <div className="booking-container">
        <div className="booking-main">
          <BookingStepper step={step} />

          {step === 1 && (
            <form className="booking-panel booking-dates" onSubmit={validateDates}>
              <div className="booking-panel-heading"><h2>Dates et voyageurs</h2><p>Commençons par préparer votre séjour.</p></div>
              <div className="booking-form-grid">
                <label>Arrivée<input className="field" type="date" min={dateInputValue(0)} value={arrival} onChange={(event) => { const nextArrival = event.target.value; setArrival(nextArrival); setDateError(null); if (departure <= nextArrival) setDeparture(dateAfter(nextArrival)); }} required /></label>
                <label>Départ<input className="field" type="date" value={departure} min={dateAfter(arrival)} onChange={(event) => { setDeparture(event.target.value); setDateError(null); }} required /></label>
                <label>Adultes<input className="field" type="number" min="1" max="4" value={adults} onChange={(event) => setAdults(Number(event.target.value))} required /></label>
                <label>Enfants<input className="field" type="number" min="0" max="3" value={children} onChange={(event) => setChildren(Number(event.target.value))} /></label>
              </div>
              {dateError && <p className="booking-submit-error" role="alert">{dateError}</p>}
              <div className="booking-nav booking-nav-end"><button className="btn-primary" type="submit">Rechercher les hébergements →</button></div>
            </form>
          )}

          {step === 2 && (
            <div>
              <div className="criteria-bar"><strong>{dateLabel(arrival)} → {dateLabel(departure)} · {adults} adulte{adults > 1 ? "s" : ""}{children ? ` · ${children} enfant${children > 1 ? "s" : ""}` : ""}</strong><button type="button" onClick={() => setStep(1)}>Modifier</button></div>
              <div className="booking-section-heading"><h2>Hébergements disponibles</h2><p>{nights} nuit{nights > 1 ? "s" : ""} · {guests} voyageur{guests > 1 ? "s" : ""}</p></div>
              {availabilityLoading && <div className="booking-room-list booking-room-skeletons" role="status" aria-label="Vérification des disponibilités"><span className="sr-only">Vérification des disponibilités...</span>{Array.from({ length: 4 }, (_, index) => <RoomChoiceSkeleton key={index} />)}</div>}
              {availabilityError && <div className="api-state api-state-error booking-api-state" role="alert"><p>{availabilityError}</p><button type="button" className="btn-secondary" onClick={() => setAvailabilityRetry((value) => value + 1)}>Réessayer</button></div>}
              {!availabilityLoading && !availabilityError && availableRooms.length === 0 && <div className="booking-empty"><h3>Aucun hébergement disponible pour ces dates</h3><p>Modifiez votre séjour ou contactez-nous pour trouver la meilleure solution.</p><div><button type="button" className="btn-secondary" onClick={() => setStep(1)}>Modifier mes dates</button><Link className="btn-primary" to="/contact">Nous contacter</Link></div></div>}
              {!availabilityLoading && !availabilityError && availableRooms.length > 0 && <div className="booking-room-list">
                {availableRooms.map((item) => <RoomChoice key={item.id} room={item} nights={nights} selected={item.slug === roomSlug} onSelect={() => setRoomSlug(item.slug)} />)}
              </div>}
              <div className="booking-nav"><button className="btn-secondary" type="button" onClick={() => setStep(1)}>← Modifier les dates</button><button className="btn-primary" type="button" disabled={!room || availabilityLoading} onClick={() => setStep(3)}>Continuer →</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="booking-panel">
              <div className="booking-panel-heading"><h2>Options supplémentaires</h2><p>Toutes les options sont facultatives.</p></div>
              {optionsQuery.loading && <div className="api-state booking-api-state" role="status"><span className="loading-spinner" />Chargement des options...</div>}
              {optionsQuery.error && <div className="api-state api-state-error booking-api-state" role="alert"><p>{optionsQuery.error}</p><button type="button" className="btn-secondary" onClick={optionsQuery.retry}>Réessayer</button></div>}
              {!optionsQuery.loading && !optionsQuery.error && <div className="booking-options">
                {bookingOptions.map((option) => {
                  const checked = selectedOptions.includes(option.id);
                  return <label className={`booking-option ${checked ? "selected" : ""}`} key={option.id}><input type="checkbox" checked={checked} onChange={() => toggleOption(option.id)} /><span className="fake-check">{checked && <Check />}</span><span className="option-copy"><strong>{option.name}</strong><small>{option.description}</small></span><span className="option-price"><strong>+{option.price} €</strong><small>{optionPriceLabel(option)}</small></span></label>;
                })}
              </div>}
              <div className="booking-nav"><button className="btn-secondary" type="button" onClick={() => setStep(2)}>← Retour</button><button className="btn-primary" type="button" onClick={() => setStep(4)}>Continuer →</button></div>
            </div>
          )}

          {step === 4 && (
            <form className="booking-panel" onSubmit={submitCustomer}>
              <div className="booking-panel-heading"><h2>Vos coordonnées</h2><p>Les informations nécessaires à votre réservation.</p></div>
              <div className="booking-form-grid">
                <label>Prénom *<input className="field" value={customer.firstName} onChange={(event) => updateCustomer("firstName", event.target.value)} required /></label>
                <label>Nom *<input className="field" value={customer.lastName} onChange={(event) => updateCustomer("lastName", event.target.value)} required /></label>
                <label>Email *<input className="field" type="email" value={customer.email} onChange={(event) => updateCustomer("email", event.target.value)} required /></label>
                <label>Téléphone *<input className="field" type="tel" pattern="[+0-9 ()-]{8,}" value={customer.phone} onChange={(event) => updateCustomer("phone", event.target.value)} required /></label>
                <label className="booking-field-wide">Pays<select className="field" value={customer.country} onChange={(event) => updateCustomer("country", event.target.value)}><option>France</option><option>Belgique</option><option>Suisse</option><option>Luxembourg</option><option>Autre</option></select></label>
                <label className="booking-field-wide">Demande particulière <span>Facultatif</span><textarea className="field" rows={5} placeholder="Chambre haute, anniversaire, arrivée tardive..." value={customer.specialRequest} onChange={(event) => updateCustomer("specialRequest", event.target.value)} /></label>
              </div>
              <p className="booking-privacy-note">Ces informations servent à traiter votre demande. N'indiquez aucune donnée sensible. <Link to="/mentions-legales">Consulter la notice de confidentialité</Link>.</p>
              <div className="booking-nav"><button className="btn-secondary" type="button" onClick={() => setStep(3)}>← Retour</button><button className="btn-primary" type="submit">Continuer →</button></div>
            </form>
          )}

          {step === 5 && (
            <form className="booking-panel" onSubmit={completeBooking}>
              <div className="booking-panel-heading secure-heading"><h2>Confirmer votre demande</h2><LockKeyhole /><p>Votre demande sera enregistrée en attente de confirmation manuelle par l'hôtel. Aucun paiement en ligne n'est demandé.</p></div>
              <div className="booking-submit-note">
                <strong>Vos dates et votre chambre sont prêtes à être enregistrées.</strong>
                <p>Cette option sur la chambre sera maintenue pendant 24 h, dans l'attente de la confirmation de l'hôtel.</p>
              </div>
              <div className="payment-total"><p><span>Montant du séjour</span><small>TTC · confirmation manuelle par l'hôtel</small></p><strong>{total} €</strong></div>
              <label className="privacy-check booking-terms-check">
                <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} required />
                <span>J'accepte les <Link to="/mentions-legales#cgv" target="_blank" rel="noreferrer">conditions générales de vente</Link> et reconnais avoir consulté la <Link to="/mentions-legales#confidentialite" target="_blank" rel="noreferrer">notice de confidentialité</Link>.</span>
              </label>
              {quoteLoading && <p className="booking-submit-error" role="status">Mise à jour du prix...</p>}
              {quoteError && <div className="booking-submit-error" role="alert"><span>{quoteError}</span> <button type="button" onClick={() => setQuoteRetry((value) => value + 1)}>Réessayer</button></div>}
              {bookingError && <p className="booking-submit-error" role="alert">{bookingError}</p>}
              <div className="booking-nav"><button className="btn-secondary" type="button" disabled={bookingSubmitting} onClick={() => setStep(4)}>← Retour</button><button className="btn-primary" type="submit" disabled={bookingSubmitting || quoteLoading || !activeQuote || !termsAccepted}>{bookingSubmitting ? "Enregistrement..." : quoteLoading ? "Calcul du prix..." : "Enregistrer ma réservation"}</button></div>
            </form>
          )}
        </div>

        <BookingSummary room={room} arrival={arrival} departure={departure} adults={adults} children={children} nights={nights} options={chosenOptions} quote={activeQuote} quoteLoading={quoteLoading} roomSubtotal={roomSubtotal} optionsSubtotal={optionsSubtotal} vatTaxes={vatTaxes} touristTax={touristTax} total={total} />
      </div>
    </section>
  );
}

function RoomChoice({ room, nights, selected, onSelect }: { room: Accommodation; nights: number; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`booking-room ${selected ? "selected" : ""}`} onClick={onSelect} aria-pressed={selected} aria-label={`${selected ? "Hébergement sélectionné" : "Sélectionner"} : ${room.name}, ${room.price * nights} euros pour le séjour`}>
      <ResponsiveImage src={room.hero} sizes="110px" width={220} height={160} alt="" />
      <span className="booking-room-copy"><strong>{room.name}</strong><small>{room.rooms} · {room.surface} · max {room.capacity} pers.</small><span>{room.amenities.slice(0, 3).map((item) => <em key={item}>{item}</em>)}</span>{selected && <span className="room-selection-status"><Check />Sélectionnée</span>}</span>
      <span className="booking-room-price">{room.promotion && <em>-{room.promotion.discountPercent}% · {room.promotion.label}</em>}{room.originalPrice && <del>{room.originalPrice * nights} €</del>}<strong>{room.price * nights} € TTC</strong><small>{room.price} € TTC × {nights} nuit{nights > 1 ? "s" : ""}</small></span>
    </button>
  );
}

function RoomChoiceSkeleton() {
  return <div className="booking-room booking-room-skeleton" aria-hidden="true"><span className="skeleton-block skeleton-image" /><span className="skeleton-copy"><span /><span /><span /></span><span className="skeleton-price"><span /><span /></span></div>;
}

function BookingSummary({ room, arrival, departure, adults, children, nights, options, quote, quoteLoading, roomSubtotal, optionsSubtotal, vatTaxes, touristTax, total }: { room?: Accommodation; arrival: string; departure: string; adults: number; children: number; nights: number; options: BookingOption[]; quote: BookingQuote | null; quoteLoading: boolean; roomSubtotal: number; optionsSubtotal: number; vatTaxes: number; touristTax: number; total: number }) {
  return (
    <aside className="booking-recap">
      <h2>Récapitulatif</h2>
      {!room ? <div className="recap-placeholder">Aucun hébergement sélectionné</div> : <><ResponsiveImage src={room.hero} sizes="290px" width={580} height={320} alt={room.name} /><h3>{room.name}</h3><p className="recap-room-meta">{room.rooms} · {room.surface}</p></>}
      <dl className="recap-details"><div><dt>Arrivée</dt><dd>{dateLabel(arrival)}</dd></div><div><dt>Départ</dt><dd>{dateLabel(departure)}</dd></div><div><dt>Durée</dt><dd>{nights} nuit{nights > 1 ? "s" : ""}</dd></div><div><dt>Voyageurs</dt><dd>{adults} adulte{adults > 1 ? "s" : ""}{children ? ` · ${children} enfant${children > 1 ? "s" : ""}` : ""}</dd></div></dl>
      {room && <div className="recap-pricing"><p><span>{room.name} (TTC)</span><strong>{roomSubtotal} €</strong></p>{options.map((item) => <p key={item.id}><span>{item.name} (TTC)</span><strong>{quote?.extras.find((extra) => extra.id === item.id)?.total ?? optionAmount(item, nights, adults + children)} €</strong></p>)}{optionsSubtotal > 0 && <p className="sr-only">Options TTC : {optionsSubtotal} €</p>}<p><span>dont TVA incluse</span><strong>{vatTaxes} €</strong></p>{touristTax > 0 && <p><span>Taxe de séjour</span><strong>{touristTax} €</strong></p>}<p className="recap-total"><span>Total</span><strong>{total} €</strong></p>{quoteLoading && <p role="status"><small>Mise à jour du prix...</small></p>}</div>}
      <p className="recap-security"><LockKeyhole />Demande sécurisée · confirmation par l'hôtel</p>
    </aside>
  );
}
