import { ArrowLeft, ArrowRight, Eye, EyeOff, Hotel, LockKeyhole } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AdminApiError, setAdminPassword } from "../../api/admin";
import { getProperty } from "../../api/hotel";
import { useAdminAuth } from "../../admin/auth";
import { useRemoteData } from "../../hooks/useRemoteData";

const MIN_PASSWORD_LENGTH = 10;

type ActivationLink =
  | { kind: "session"; invitation: boolean; accessToken: string; refreshToken: string; expiresIn: number }
  | { kind: "invalid"; reason: string };

/** Reads the session Supabase appends to the e-mail link, after `#`. */
function readActivationLink(hash: string): ActivationLink {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.get("error")) {
    return {
      kind: "invalid",
      reason: params.get("error_code") === "otp_expired"
        ? "Ce lien a expiré ou a déjà servi."
        : "Ce lien n’est pas valable.",
    };
  }
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = Number(params.get("expires_in"));
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return { kind: "invalid", reason: "Ce lien est incomplet. Ouvrez-le directement depuis l’e-mail reçu." };
  }
  return { kind: "session", invitation: params.get("type") === "invite", accessToken, refreshToken, expiresIn };
}

export function AdminActivation() {
  const { startSession } = useAdminAuth();
  const navigate = useNavigate();
  const { data: property } = useRemoteData((signal) => getProperty(signal), []);
  const [link] = useState(() => readActivationLink(window.location.hash));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const propertyName = property?.name ?? "Espace hôtelier";

  // The tokens must not linger in the address bar or the history.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmation.length > 0 && confirmation !== password;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (link.kind !== "session" || submitting) return;
    if (password.length < MIN_PASSWORD_LENGTH || password !== confirmation) return;
    setSubmitting(true);
    setError(null);
    try {
      await setAdminPassword(password, link.accessToken);
      await startSession({ accessToken: link.accessToken, refreshToken: link.refreshToken, expiresIn: link.expiresIn });
      navigate("/admin", { replace: true });
    } catch (nextError) {
      setError(nextError instanceof AdminApiError ? nextError.message : "Le mot de passe n’a pas pu être enregistré. Réessayez dans un instant.");
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-login-page admin-activation-page">
      <section className="admin-login-panel">
        <div className="admin-login-card">
          <div className="admin-login-mobile-brand"><span><Hotel /></span>{propertyName}</div>
          {link.kind === "invalid" ? (
            <>
              <p className="admin-login-kicker">Lien expiré</p>
              <h2>{link.reason}</h2>
              <p className="admin-login-intro">Les liens d’invitation et de réinitialisation ne servent qu’une fois et pendant peu de temps. Demandez-en un nouveau depuis la page de connexion, avec « Mot de passe oublié ? ».</p>
              <Link to="/admin/connexion" replace className="admin-login-submit admin-activation-cta">Aller à la connexion<ArrowRight /></Link>
            </>
          ) : (
            <>
              <p className="admin-login-kicker">{link.invitation ? "Bienvenue dans l’équipe" : "Nouveau mot de passe"}</p>
              <h2>{link.invitation ? "Choisissez votre mot de passe" : "Choisissez un nouveau mot de passe"}</h2>
              <p className="admin-login-intro">Il protège l’accès aux réservations et aux données des clients : au moins {MIN_PASSWORD_LENGTH} caractères, idéalement une phrase facile à retenir.</p>
              <form onSubmit={submit} className="admin-login-form" noValidate>
                <div className="admin-login-field">
                  <label htmlFor="activation-password">Mot de passe</label>
                  <span className="admin-input-wrap"><LockKeyhole /><input id="activation-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required autoFocus aria-describedby="activation-password-hint" /><button type="button" aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></span>
                  <small id="activation-password-hint" className={tooShort ? "is-invalid" : ""}>{tooShort ? `Encore ${MIN_PASSWORD_LENGTH - password.length} caractère${MIN_PASSWORD_LENGTH - password.length > 1 ? "s" : ""}.` : `${MIN_PASSWORD_LENGTH} caractères minimum.`}</small>
                </div>
                <div className="admin-login-field">
                  <label htmlFor="activation-confirmation">Confirmation</label>
                  <span className="admin-input-wrap"><LockKeyhole /><input id="activation-confirmation" type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required aria-invalid={mismatch || undefined} aria-describedby={mismatch ? "activation-confirmation-error" : undefined} /></span>
                  {mismatch && <small id="activation-confirmation-error" className="is-invalid">Les deux mots de passe sont différents.</small>}
                </div>
                {error && <div className="admin-login-error" role="alert">{error}</div>}
                <button className="admin-login-submit" type="submit" disabled={submitting || password.length < MIN_PASSWORD_LENGTH || password !== confirmation}>
                  {submitting ? <><span className="admin-spinner light" />Enregistrement…</> : <>Enregistrer et ouvrir l’administration<ArrowRight /></>}
                </button>
              </form>
            </>
          )}
          <Link to="/" reloadDocument className="admin-back-link"><ArrowLeft />Retour au site de l’hôtel</Link>
        </div>
      </section>
    </main>
  );
}
