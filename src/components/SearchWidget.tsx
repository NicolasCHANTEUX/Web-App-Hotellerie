import { CalendarDays, Minus, Plus, Search } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

export function SearchWidget({ compact = false, demoDates = false }: { compact?: boolean; demoDates?: boolean }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams({
      arrival: String(data.get("arrival")),
      departure: String(data.get("departure")),
      adults: String(adults),
      children: String(children),
      step: "2",
    });
    setStatus("Disponibilités trouvées pour votre séjour.");
    setTimeout(() => navigate(`/reservation?${query.toString()}`), 450);
  }

  return (
    <form className={`search-panel ${compact ? "search-panel-compact" : ""}`} onSubmit={submit}>
      <label><span>Arrivée</span><div><input name="arrival" type="date" aria-label="Date d'arrivée" defaultValue={demoDates ? "2026-08-08" : undefined} required /><CalendarDays /></div></label>
      <label><span>Départ</span><div><input name="departure" type="date" aria-label="Date de départ" defaultValue={demoDates ? "2026-08-09" : undefined} required /><CalendarDays /></div></label>
      <div className="guest-field" role="group" aria-label="Voyageurs"><span>Voyageurs</span><div className="guest-row"><span>Ad.</span><button type="button" aria-label="Retirer un adulte" onClick={() => setAdults(Math.max(1, adults - 1))}><Minus /></button><strong>{adults}</strong><button type="button" aria-label="Ajouter un adulte" onClick={() => setAdults(Math.min(6, adults + 1))}><Plus /></button><span>Enf.</span><button type="button" aria-label="Retirer un enfant" onClick={() => setChildren(Math.max(0, children - 1))}><Minus /></button><strong>{children}</strong><button type="button" aria-label="Ajouter un enfant" onClick={() => setChildren(Math.min(4, children + 1))}><Plus /></button></div></div>
      <div className="search-submit"><button className="btn-primary" type="submit"><Search />Rechercher</button></div>
      {status && <p className="sr-only" role="status">{status}</p>}
    </form>
  );
}
