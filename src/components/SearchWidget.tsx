import { CalendarDays, Minus, Plus, Search } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextDay(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function SearchWidget({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [arrival, setArrival] = useState(() => dateInputValue(1));
  const [departure, setDeparture] = useState(() => dateInputValue(2));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (arrival < dateInputValue(0)) {
      setError("La date d'arrivée ne peut pas être dans le passé.");
      return;
    }
    const nights = (Date.parse(departure) - Date.parse(arrival)) / 86_400_000;
    if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
      setError("Le séjour doit durer entre 1 et 365 nuits.");
      return;
    }
    setError("");
    const query = new URLSearchParams({
      arrival,
      departure,
      adults: String(adults),
      children: String(children),
      step: "2",
    });
    navigate(`/reservation?${query.toString()}`);
  }

  return (
    <form className={`search-panel ${compact ? "search-panel-compact" : ""}`} onSubmit={submit}>
      <label><span>Arrivée</span><div><input name="arrival" type="date" aria-label="Date d'arrivée" min={dateInputValue(0)} value={arrival} onChange={(event) => { const nextArrival = event.target.value; setArrival(nextArrival); setError(""); if (departure <= nextArrival) setDeparture(nextDay(nextArrival)); }} required /><CalendarDays /></div></label>
      <label><span>Départ</span><div><input name="departure" type="date" aria-label="Date de départ" min={arrival ? nextDay(arrival) : dateInputValue(1)} value={departure} onChange={(event) => { setDeparture(event.target.value); setError(""); }} required /><CalendarDays /></div></label>
      <div className="guest-field" role="group" aria-label="Voyageurs"><span>Voyageurs</span><div className="guest-row"><span>Ad.</span><button type="button" aria-label="Retirer un adulte" onClick={() => setAdults(Math.max(1, adults - 1))}><Minus /></button><strong>{adults}</strong><button type="button" aria-label="Ajouter un adulte" onClick={() => setAdults(Math.min(6, adults + 1))}><Plus /></button><span>Enf.</span><button type="button" aria-label="Retirer un enfant" onClick={() => setChildren(Math.max(0, children - 1))}><Minus /></button><strong>{children}</strong><button type="button" aria-label="Ajouter un enfant" onClick={() => setChildren(Math.min(4, children + 1))}><Plus /></button></div></div>
      <div className="search-submit"><button className="btn-primary" type="submit"><Search />Rechercher</button></div>
      {error && <p className="search-error" role="alert">{error}</p>}
    </form>
  );
}
