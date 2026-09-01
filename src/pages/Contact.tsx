import { Clock3, Mail, MapPin, Navigation, Phone } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiPost } from "../api/client";
import { propertyMapUrl, propertyPhoneHref, useProperty } from "../context/PropertyContext";

export function Contact() {
  const property = useProperty();
  const mapUrl = propertyMapUrl(property);
  const contactDetails = [
    { icon: MapPin, label: "Adresse", lines: [property.addressLine1, property.addressLine2, `${property.postalCode} ${property.city}, France`].filter((line): line is string => Boolean(line)) },
    ...(property.phone ? [{ icon: Phone, label: "Téléphone", lines: [property.phone] }] : []),
    { icon: Mail, label: "Email", lines: [property.email] },
    { icon: Clock3, label: "Réception", lines: ["Tous les jours, 7h00 – 23h00"] },
  ];
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ payload: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const body = {
      fullName: String(fields.get("name") ?? ""),
      email: String(fields.get("email") ?? ""),
      phone: String(fields.get("phone") ?? ""),
      subject: String(fields.get("subject") ?? ""),
      message: String(fields.get("message") ?? ""),
      privacyAccepted: fields.get("privacyAccepted") === "on",
    };
    const serialized = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== serialized) {
      attempt.current = { payload: serialized, key: crypto.randomUUID() };
    }

    setSending(true);
    setSent(false);
    setError(null);
    try {
      await apiPost<{ id: string; status: "RECEIVED"; receivedAt: string }>(
        "/contact-requests",
        body,
        undefined,
        { "Idempotency-Key": attempt.current.key },
      );
      attempt.current = null;
      setSent(true);
      form.reset();
    } catch (submissionError) {
      setError(submissionError instanceof ApiError
        ? submissionError.message
        : "Votre demande n'a pas pu être enregistrée. Vérifiez votre connexion et réessayez.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <section className="contact-hero">
        <div className="page-container">
          <p className="eyebrow">Contactez-nous</p>
          <h1>Nous contacter</h1>
          <p>Une question, une arrivée tardive ou une attention particulière ? Notre équipe est à votre disposition pour préparer votre séjour.</p>
        </div>
      </section>

      <section className="contact-main">
        <div className="page-container contact-grid">
          <div className="contact-details">
            <p className="eyebrow">Hôtel Rivage</p>
            <h2>Nos coordonnées</h2>
            <div className="contact-list">
              {contactDetails.map(({ icon: Icon, label, lines }) => (
                <div className="contact-row" key={label}>
                  <span className="contact-icon"><Icon /></span>
                  <p><strong>{label}</strong>{lines.map((line) => <span key={line}>{line}</span>)}</p>
                </div>
              ))}
            </div>
            <div className="contact-actions">
              {property.phone && <a className="btn-primary" href={propertyPhoneHref(property.phone)}><Phone />Appeler</a>}
              <a className="btn-outline" href={`mailto:${property.email}`}><Mail />Envoyer un email</a>
              <a className="btn-outline" href={mapUrl} target="_blank" rel="noreferrer"><Navigation />Itinéraire</a>
            </div>

            <div className="contact-map">
              <div className="map-lines" aria-hidden="true"><span /><span /><span /><span /></div>
              <div className="map-address"><MapPin /><p><strong>{property.name}</strong><span>{property.addressLine1}, {property.postalCode} {property.city}</span></p></div>
              <a href={mapUrl} target="_blank" rel="noreferrer">Ouvrir dans Google Maps →</a>
            </div>
          </div>

          <div className="contact-form-column">
            <p className="eyebrow">Parlons de votre séjour</p>
            <h2>Envoyez-nous un message</h2>
            <form className="contact-form" onSubmit={submit}>
              <fieldset disabled={sending}>
                <div className="contact-form-pair">
                  <label>Nom complet<input className="field" name="name" autoComplete="name" minLength={2} maxLength={120} required /></label>
                  <label>Adresse email<input className="field" name="email" type="email" autoComplete="email" maxLength={254} required /></label>
                </div>
                <label><span className="field-label">Téléphone <span className="optional">· Facultatif</span></span><input className="field" name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={30} /></label>
                <label>Sujet<select className="field" name="subject" defaultValue="" required><option value="" disabled>Sélectionnez un sujet</option><option value="BOOKING_QUESTION">Question sur une réservation</option><option value="ARRIVAL">Préparer mon arrivée</option><option value="SPECIAL_REQUEST">Demande particulière</option><option value="OTHER">Autre demande</option></select></label>
                <label>Message<textarea className="field" name="message" rows={7} minLength={20} maxLength={4000} required /></label>
                <label className="privacy-check"><input type="checkbox" name="privacyAccepted" required /><span>J'accepte la <Link to="/mentions-legales#confidentialite">politique de confidentialité</Link> et consens au traitement de mes données personnelles.</span></label>
                <button className="btn-primary contact-submit" type="submit">{sending ? "Envoi en cours…" : "Envoyer le message"}</button>
              </fieldset>
              {sent && <p className="contact-success" role="status">Votre demande a bien été enregistrée. Notre équipe vous répondra rapidement.</p>}
              {error && <p className="contact-error" role="alert">{error}</p>}
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
