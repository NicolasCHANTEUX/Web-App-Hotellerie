import { Clock3, Mail, MapPin, Navigation, Phone } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";

const contactDetails = [
  { icon: MapPin, label: "Adresse", lines: ["26 avenue des Pins", "06400 Cannes, France"] },
  { icon: Phone, label: "Téléphone", lines: ["+33 4 93 00 00 00"] },
  { icon: Mail, label: "Email", lines: ["contact@hotel-rivage.fr"] },
  { icon: Clock3, label: "Réception", lines: ["Tous les jours, 7h00 – 23h00"] },
];

export function Contact() {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSending(true);
    setSent(false);
    window.setTimeout(() => {
      setSending(false);
      setSent(true);
      form.reset();
    }, 700);
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
              <a className="btn-primary" href="tel:+33493000000"><Phone />Appeler</a>
              <a className="btn-outline" href="mailto:contact@hotel-rivage.fr"><Mail />Envoyer un email</a>
              <a className="btn-outline" href="https://maps.google.com/?q=26+avenue+des+Pins+06400+Cannes" target="_blank" rel="noreferrer"><Navigation />Itinéraire</a>
            </div>

            <div className="contact-map">
              <div className="map-lines" aria-hidden="true"><span /><span /><span /><span /></div>
              <div className="map-address"><MapPin /><p><strong>Hôtel Rivage</strong><span>26 avenue des Pins, 06400 Cannes</span></p></div>
              <a href="https://maps.google.com/?q=26+avenue+des+Pins+06400+Cannes" target="_blank" rel="noreferrer">Ouvrir dans Google Maps →</a>
            </div>
          </div>

          <div className="contact-form-column">
            <p className="eyebrow">Parlons de votre séjour</p>
            <h2>Envoyez-nous un message</h2>
            <form className="contact-form" onSubmit={submit}>
              <fieldset disabled={sending}>
                <div className="contact-form-pair">
                  <label>Nom complet<input className="field" name="name" autoComplete="name" required /></label>
                  <label>Adresse email<input className="field" name="email" type="email" autoComplete="email" required /></label>
                </div>
                <label><span className="field-label">Téléphone <span className="optional">· Facultatif</span></span><input className="field" name="phone" type="tel" autoComplete="tel" /></label>
                <label>Sujet<select className="field" name="subject" defaultValue="" required><option value="" disabled>Sélectionnez un sujet</option><option>Question sur une réservation</option><option>Préparer mon arrivée</option><option>Demande particulière</option><option>Autre demande</option></select></label>
                <label>Message<textarea className="field" name="message" rows={7} required /></label>
                <label className="privacy-check"><input type="checkbox" required /><span>J'accepte la <Link to="/mentions-legales">politique de confidentialité</Link> et consens au traitement de mes données personnelles.</span></label>
                <button className="btn-primary contact-submit" type="submit">{sending ? "Envoi en cours…" : "Envoyer le message"}</button>
              </fieldset>
              {sent && <p className="contact-success" role="status">Votre message a bien été envoyé. Nous vous répondrons rapidement.</p>}
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
