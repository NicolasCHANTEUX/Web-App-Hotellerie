import { ArrowLeft, ArrowRight, Eye, EyeOff, Hotel, LockKeyhole, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AdminApiError } from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";

type LoginLocationState = { from?: string };

export function AdminLogin() {
  const { status, login } = useAdminAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") return <Navigate to="/admin" replace />;

  const requestedPath = (location.state as LoginLocationState | null)?.from;
  const destination = requestedPath?.startsWith("/admin/") && requestedPath !== "/admin/connexion"
    ? requestedPath
    : "/admin";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(destination, { replace: true });
    } catch (nextError) {
      setError(nextError instanceof AdminApiError
        ? nextError.message
        : "Impossible d’ouvrir la session. Réessayez dans un instant.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "checking") {
    return (
      <div className="admin-auth-loading" role="status">
        <span className="admin-spinner" />
        <p>Vérification de votre session…</p>
      </div>
    );
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-story" aria-label="Hôtel Rivage">
        <div className="admin-login-story-inner">
          <p className="admin-login-brand"><span><Hotel /></span>Hôtel Rivage</p>
          <div>
            <p className="admin-login-kicker">Espace professionnel</p>
            <h1>Votre hôtel,<br />en un regard.</h1>
            <p>Suivez les séjours, anticipez les arrivées et gardez la disponibilité de chaque chambre à portée de main.</p>
          </div>
          <small>Administration sécurisée · Cannes</small>
        </div>
      </section>

      <section className="admin-login-panel">
        <div className="admin-login-card">
          <div className="admin-login-mobile-brand"><span><Hotel /></span>Hôtel Rivage</div>
          <p className="admin-login-kicker">Bienvenue</p>
          <h2>Connexion à l’administration</h2>
          <p className="admin-login-intro">Identifiez-vous pour accéder aux réservations et à l’occupation des chambres.</p>

          <form onSubmit={submit} className="admin-login-form">
            <label>
              <span>Adresse e-mail</span>
              <span className="admin-input-wrap"><Mail /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="nom@hotel-rivage.fr" required autoFocus /></span>
            </label>
            <label>
              <span>Mot de passe</span>
              <span className="admin-input-wrap"><LockKeyhole /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Votre mot de passe" required /><button type="button" aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></span>
            </label>

            {error && <div className="admin-login-error" role="alert">{error}</div>}

            <button className="admin-login-submit" type="submit" disabled={submitting}>
              {submitting ? <><span className="admin-spinner light" />Connexion…</> : <>Se connecter<ArrowRight /></>}
            </button>
          </form>

          <Link to="/" className="admin-back-link"><ArrowLeft />Retour au site de l’hôtel</Link>
        </div>
      </section>
    </main>
  );
}
