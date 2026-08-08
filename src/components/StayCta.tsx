import { Link } from "react-router-dom";

export function StayCta() {
  return (
    <section className="footer-cta">
      <p className="eyebrow">Votre séjour vous attend</p>
      <h2>Prêt à préparer votre séjour ?</h2>
      <p>Réservez directement sur notre site et bénéficiez du meilleur tarif garanti.</p>
      <div><Link className="btn-primary" to="/reservation">Réserver mon séjour</Link><Link className="btn-dark-ghost" to="/contact">Nous contacter</Link></div>
    </section>
  );
}
