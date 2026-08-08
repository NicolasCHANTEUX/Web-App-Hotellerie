import { Check, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BookingStepper } from "../components/BookingStepper";
import { Accommodation, accommodations } from "../data/hotel";

type Customer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  specialRequest: string;
};

type PricingUnit = "PER_PERSON_PER_NIGHT" | "PER_NIGHT" | "ONE_TIME";

type BookingOption = {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: PricingUnit;
  priceLabel: string;
};

const bookingOptions: BookingOption[] = [
  { id: "breakfast", name: "Petit-déjeuner", description: "Buffet maison chaque matin", price: 18, unit: "PER_PERSON_PER_NIGHT", priceLabel: "par personne / nuit" },
  { id: "parking", name: "Parking privé", description: "Place sécurisée pour votre véhicule", price: 15, unit: "PER_NIGHT", priceLabel: "par nuit" },
  { id: "early", name: "Arrivée anticipée", description: "Accès à la chambre dès 12h00", price: 30, unit: "ONE_TIME", priceLabel: "une fois" },
  { id: "late", name: "Départ tardif", description: "Conservation de la chambre jusqu'à 14h00", price: 30, unit: "ONE_TIME", priceLabel: "une fois" },
  { id: "baby", name: "Lit bébé", description: "Lit parapluie avec linge de lit", price: 10, unit: "PER_NIGHT", priceLabel: "par nuit" },
];

const emptyCustomer: Customer = { firstName: "", lastName: "", email: "", phone: "", country: "France", specialRequest: "" };

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
  const [arrival, setArrival] = useState(params.get("arrival") ?? "2026-08-08");
  const [departure, setDeparture] = useState(params.get("departure") ?? "2026-08-09");
  const [adults, setAdults] = useState(Number(params.get("adults") ?? 2));
  const [children, setChildren] = useState(Number(params.get("children") ?? 0));
  const [roomSlug, setRoomSlug] = useState(params.get("room") ?? "");
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customer, setCustomer] = useState<Customer>(emptyCustomer);

  const room = accommodations.find((item) => item.slug === roomSlug);
  const nights = numberOfNights(arrival, departure);
  const guests = adults + children;
  const availableRooms = accommodations.filter((item) => item.capacity >= guests);
  const chosenOptions = bookingOptions.filter((item) => selectedOptions.includes(item.id));
  const roomSubtotal = room ? room.price * nights : 0;
  const optionsSubtotal = chosenOptions.reduce((sum, item) => sum + optionAmount(item, nights, guests), 0);
  const taxes = Math.round((roomSubtotal + optionsSubtotal) * 0.1);
  const total = roomSubtotal + optionsSubtotal + taxes;

  function validateDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Date.parse(departure) <= Date.parse(arrival)) return;
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

  function completePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate("/confirmation", {
      state: {
        reference: `RVG-${String(Date.now()).slice(-6)}`,
        room: room?.name,
        arrival,
        departure,
        adults,
        children,
        options: chosenOptions.map((item) => item.name),
        total,
        email: customer.email,
      },
    });
  }

  return (
    <section className="booking-page">
      <header className="booking-heading">
        <h1>Réserver votre séjour</h1>
        <p>Réservation directe · Meilleur tarif garanti</p>
      </header>

      <div className="booking-container">
        <div className="booking-main">
          <BookingStepper step={step} />

          {step === 1 && (
            <form className="booking-panel booking-dates" onSubmit={validateDates}>
              <div className="booking-panel-heading"><h2>Dates et voyageurs</h2><p>Commençons par préparer votre séjour.</p></div>
              <div className="booking-form-grid">
                <label>Arrivée<input className="field" type="date" value={arrival} onChange={(event) => setArrival(event.target.value)} required /></label>
                <label>Départ<input className="field" type="date" value={departure} min={arrival} onChange={(event) => setDeparture(event.target.value)} required /></label>
                <label>Adultes<input className="field" type="number" min="1" max="4" value={adults} onChange={(event) => setAdults(Number(event.target.value))} required /></label>
                <label>Enfants<input className="field" type="number" min="0" max="3" value={children} onChange={(event) => setChildren(Number(event.target.value))} /></label>
              </div>
              <div className="booking-nav booking-nav-end"><button className="btn-primary" type="submit">Rechercher les hébergements →</button></div>
            </form>
          )}

          {step === 2 && (
            <div>
              <div className="criteria-bar"><strong>{dateLabel(arrival)} → {dateLabel(departure)} · {adults} adulte{adults > 1 ? "s" : ""}{children ? ` · ${children} enfant${children > 1 ? "s" : ""}` : ""}</strong><button type="button" onClick={() => setStep(1)}>Modifier</button></div>
              <div className="booking-section-heading"><h2>Hébergements disponibles</h2><p>{nights} nuit{nights > 1 ? "s" : ""} · {guests} voyageur{guests > 1 ? "s" : ""}</p></div>
              <div className="booking-room-list">
                {availableRooms.map((item) => <RoomChoice key={item.id} room={item} nights={nights} selected={item.slug === roomSlug} onSelect={() => setRoomSlug(item.slug)} />)}
              </div>
              <div className="booking-nav"><button className="btn-secondary" type="button" onClick={() => setStep(1)}>← Modifier les dates</button><button className="btn-primary" type="button" disabled={!room} onClick={() => setStep(3)}>Continuer →</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="booking-panel">
              <div className="booking-panel-heading"><h2>Options supplémentaires</h2><p>Toutes les options sont facultatives.</p></div>
              <div className="booking-options">
                {bookingOptions.map((option) => {
                  const checked = selectedOptions.includes(option.id);
                  return <label className={`booking-option ${checked ? "selected" : ""}`} key={option.id}><input type="checkbox" checked={checked} onChange={() => toggleOption(option.id)} /><span className="fake-check">{checked && <Check />}</span><span className="option-copy"><strong>{option.name}</strong><small>{option.description}</small></span><span className="option-price"><strong>+{option.price} €</strong><small>{option.priceLabel}</small></span></label>;
                })}
              </div>
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
                <label className="booking-field-wide">Demande particulière <span>Facultatif</span><textarea className="field" rows={5} placeholder="Chambre haute, anniversaire, allergie alimentaire..." value={customer.specialRequest} onChange={(event) => updateCustomer("specialRequest", event.target.value)} /></label>
              </div>
              <div className="booking-nav"><button className="btn-secondary" type="button" onClick={() => setStep(3)}>← Retour</button><button className="btn-primary" type="submit">Continuer →</button></div>
            </form>
          )}

          {step === 5 && (
            <form className="booking-panel" onSubmit={completePayment}>
              <div className="booking-panel-heading secure-heading"><h2>Paiement sécurisé</h2><LockKeyhole /><p>Simulation front-end : aucune donnée bancaire n'est transmise ou enregistrée.</p></div>
              <div className="booking-form-grid payment-grid">
                <label className="booking-field-wide">Nom du titulaire *<input className="field" placeholder="Prénom Nom" autoComplete="cc-name" required /></label>
                <label className="booking-field-wide">Numéro de carte *<input className="field" inputMode="numeric" placeholder="1234 5678 9012 3456" pattern="[0-9 ]{16,19}" autoComplete="cc-number" required /></label>
                <label>Date d'expiration *<input className="field" placeholder="MM/AA" pattern="(0[1-9]|1[0-2])/[0-9]{2}" autoComplete="cc-exp" required /></label>
                <label>CVC *<input className="field" inputMode="numeric" placeholder="123" pattern="[0-9]{3,4}" autoComplete="cc-csc" required /></label>
              </div>
              <div className="payment-total"><p><span>Montant à payer</span><small>TTC · Annulation gratuite jusqu'à 48h avant</small></p><strong>{total} €</strong></div>
              <div className="booking-nav"><button className="btn-secondary" type="button" onClick={() => setStep(4)}>← Retour</button><button className="btn-primary" type="submit">Payer {total} €</button></div>
            </form>
          )}
        </div>

        <BookingSummary room={room} arrival={arrival} departure={departure} adults={adults} children={children} nights={nights} options={chosenOptions} roomSubtotal={roomSubtotal} optionsSubtotal={optionsSubtotal} taxes={taxes} total={total} />
      </div>
    </section>
  );
}

function RoomChoice({ room, nights, selected, onSelect }: { room: Accommodation; nights: number; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`booking-room ${selected ? "selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <img src={room.hero} alt="" />
      <span className="booking-room-copy"><strong>{room.name}</strong><small>{room.rooms} · {room.surface} · max {room.capacity} pers.</small><span>{room.amenities.slice(0, 3).map((item) => <em key={item}>{item}</em>)}</span></span>
      <span className="booking-room-price"><strong>{room.price * nights} €</strong><small>{room.price} € × {nights} nuit{nights > 1 ? "s" : ""}</small></span>
    </button>
  );
}

function BookingSummary({ room, arrival, departure, adults, children, nights, options, roomSubtotal, optionsSubtotal, taxes, total }: { room?: Accommodation; arrival: string; departure: string; adults: number; children: number; nights: number; options: BookingOption[]; roomSubtotal: number; optionsSubtotal: number; taxes: number; total: number }) {
  return (
    <aside className="booking-recap">
      <h2>Récapitulatif</h2>
      {!room ? <div className="recap-placeholder">Aucun hébergement sélectionné</div> : <><img src={room.hero} alt={room.name} /><h3>{room.name}</h3><p className="recap-room-meta">{room.rooms} · {room.surface}</p></>}
      <dl className="recap-details"><div><dt>Arrivée</dt><dd>{dateLabel(arrival)}</dd></div><div><dt>Départ</dt><dd>{dateLabel(departure)}</dd></div><div><dt>Durée</dt><dd>{nights} nuit{nights > 1 ? "s" : ""}</dd></div><div><dt>Voyageurs</dt><dd>{adults} ad.{children ? ` · ${children} enf.` : ""}</dd></div></dl>
      {room && <div className="recap-pricing"><p><span>{room.name}</span><strong>{roomSubtotal} €</strong></p>{options.map((item) => <p key={item.id}><span>{item.name}</span><strong>{optionAmount(item, nights, adults + children)} €</strong></p>)}{optionsSubtotal > 0 && <p className="sr-only">Options : {optionsSubtotal} €</p>}<p><span>Taxes (10 %)</span><strong>{taxes} €</strong></p><p className="recap-total"><span>Total</span><strong>{total} €</strong></p></div>}
      <p className="recap-security"><LockKeyhole />Paiement sécurisé · Annulation gratuite</p>
    </aside>
  );
}
