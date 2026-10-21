import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  AdminApiError,
  AdminPropertyEditableSettings,
  AdminPropertySettings,
  getAdminPropertySettings,
  updateAdminPropertySettings,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import { AdminErrorState, PageHeading } from "../../admin/ui";

type FormState = Record<keyof AdminPropertyEditableSettings, string>;

const requiredFields = ["name", "email", "addressLine1", "postalCode", "city", "countryCode", "checkInTime", "checkOutTime"] as const;

function toForm(settings: AdminPropertySettings): FormState {
  return {
    name: settings.name,
    legalName: settings.legalName ?? "",
    email: settings.email,
    phone: settings.phone ?? "",
    addressLine1: settings.addressLine1,
    addressLine2: settings.addressLine2 ?? "",
    postalCode: settings.postalCode,
    city: settings.city,
    countryCode: settings.countryCode,
    checkInTime: settings.checkInTime,
    checkOutTime: settings.checkOutTime,
    legalForm: settings.legalForm ?? "",
    shareCapital: settings.shareCapital ?? "",
    siret: settings.siret ?? "",
    registrationCity: settings.registrationCity ?? "",
    vatNumber: settings.vatNumber ?? "",
    publicationDirector: settings.publicationDirector ?? "",
    hostingProvider: settings.hostingProvider ?? "",
    mediator: settings.mediator ?? "",
  };
}

function toInput(form: FormState): AdminPropertyEditableSettings {
  const optional = (value: string) => value.trim() || null;
  return {
    name: form.name.trim(),
    legalName: optional(form.legalName),
    email: form.email.trim(),
    phone: optional(form.phone),
    addressLine1: form.addressLine1.trim(),
    addressLine2: optional(form.addressLine2),
    postalCode: form.postalCode.trim(),
    city: form.city.trim(),
    countryCode: form.countryCode.trim().toUpperCase(),
    checkInTime: form.checkInTime,
    checkOutTime: form.checkOutTime,
    legalForm: optional(form.legalForm),
    shareCapital: optional(form.shareCapital),
    siret: optional(form.siret),
    registrationCity: optional(form.registrationCity),
    vatNumber: optional(form.vatNumber),
    publicationDirector: optional(form.publicationDirector),
    hostingProvider: optional(form.hostingProvider),
    mediator: optional(form.mediator),
  };
}

function validationMessage(form: FormState) {
  if (requiredFields.some((field) => !form[field].trim())) return "Renseignez le nom, l’e-mail, l’adresse complète et les horaires.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "L’adresse e-mail est invalide.";
  if (!/^[A-Za-z]{2}$/.test(form.countryCode.trim())) return "Le pays doit être un code à deux lettres, par exemple FR.";
  if (form.siret.trim() && !/^\d{14}$/.test(form.siret.replace(/\s/g, ""))) return "Le SIRET doit contenir 14 chiffres.";
  if (form.vatNumber.trim() && !/^[A-Za-z]{2}[0-9A-Za-z]{2,13}$/.test(form.vatNumber.replace(/\s/g, ""))) return "Le numéro de TVA intracommunautaire est invalide.";
  return null;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="admin-settings-section">
      <header><h2>{title}</h2><p>{description}</p></header>
      <div className="admin-room-type-form-grid">{children}</div>
    </section>
  );
}

export function AdminProperty() {
  const { accessToken, logout, refreshProfile } = useAdminAuth();
  const [settings, setSettings] = useState<AdminPropertySettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setError(null);
    getAdminPropertySettings(accessToken, controller.signal)
      .then((data) => {
        setSettings(data);
        setForm(toForm(data));
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) {
          logout();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Les informations n’ont pas pu être chargées.");
      });
    return () => controller.abort();
  }, [accessToken, logout, retryKey]);

  if (error) {
    return (
      <>
        <PageHeading eyebrow="Paramètres" title="Établissement" />
        <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />
      </>
    );
  }
  if (!settings || !form) {
    return (
      <>
        <PageHeading eyebrow="Paramètres" title="Établissement" />
        <div className="admin-room-types-state"><span className="admin-spinner" />Chargement des informations…</div>
      </>
    );
  }

  const currentSettings = settings;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(currentSettings));
  const invalidMessage = validationMessage(form);

  function update(field: keyof FormState, value: string) {
    setSaved(false);
    setForm((current) => current && { ...current, [field]: value });
  }

  function field(name: keyof FormState, label: string, props: { wide?: boolean; type?: string; maxLength?: number; placeholder?: string; hint?: string } = {}) {
    return (
      <label className={props.wide ? "wide" : undefined}>
        <span>{label}</span>
        <input type={props.type ?? "text"} value={form![name]} maxLength={props.maxLength} placeholder={props.placeholder} onChange={(event) => update(name, event.target.value)} />
        {props.hint && <small>{props.hint}</small>}
      </label>
    );
  }

  function area(name: keyof FormState, label: string, placeholder: string) {
    return (
      <label className="wide">
        <span>{label}</span>
        <textarea rows={2} maxLength={400} value={form![name]} placeholder={placeholder} onChange={(event) => update(name, event.target.value)} />
      </label>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !form || saving || !dirty || invalidMessage) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateAdminPropertySettings({ ...toInput(form), updatedAt: currentSettings.updatedAt }, accessToken);
      setSettings(updated);
      setForm(toForm(updated));
      setSaved(true);
      await refreshProfile().catch(() => undefined);
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setSaveError(nextError instanceof Error ? nextError.message : "L’enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="Paramètres" title="Établissement" description="Informations affichées sur le site, dans les e-mails et sur les nouvelles factures." />

      <form className="admin-settings-form" onSubmit={submit} noValidate aria-busy={saving}>
        <Section title="Identité et contact" description="L’adresse e-mail reçoit les demandes de réservation, les messages du site et les alertes de paiement.">
          {field("name", "Nom de l’établissement", { maxLength: 120 })}
          {field("legalName", "Raison sociale", { maxLength: 160, hint: "Si elle diffère du nom commercial." })}
          {field("email", "E-mail", { type: "email", maxLength: 320 })}
          {field("phone", "Téléphone", { type: "tel", maxLength: 30 })}
        </Section>

        <Section title="Adresse" description="Affichée sur le site, dans les e-mails et sur les factures.">
          {field("addressLine1", "Adresse", { wide: true, maxLength: 160 })}
          {field("addressLine2", "Complément d’adresse", { wide: true, maxLength: 160 })}
          {field("postalCode", "Code postal", { maxLength: 12 })}
          {field("city", "Ville", { maxLength: 80 })}
          {field("countryCode", "Pays", { maxLength: 2, hint: "Code à deux lettres, par exemple FR." })}
        </Section>

        <Section title="Séjours" description="Le fuseau horaire et la devise s’appliquent à toutes les réservations : ils ne se modifient pas depuis cet écran.">
          {field("checkInTime", "Arrivée à partir de", { type: "time" })}
          {field("checkOutTime", "Départ avant", { type: "time" })}
          <label><span>Adresse technique</span><input value={currentSettings.slug} readOnly /></label>
          <label><span>Fuseau horaire</span><input value={currentSettings.timezone} readOnly /></label>
          <label><span>Devise</span><input value={currentSettings.currency} readOnly /></label>
        </Section>

        <Section title="Mentions légales" description="Publiées sur la page Mentions légales du site et en pied des nouvelles factures.">
          {field("legalForm", "Forme juridique", { maxLength: 60, placeholder: "SAS, SARL, EI…" })}
          {field("shareCapital", "Capital social", { maxLength: 40, placeholder: "10 000 €" })}
          {field("siret", "SIRET", { maxLength: 20, placeholder: "812 345 678 00012" })}
          {field("registrationCity", "Ville du RCS", { maxLength: 80, placeholder: "Cannes" })}
          {field("vatNumber", "TVA intracommunautaire", { maxLength: 20, placeholder: "FR12812345678" })}
          {field("publicationDirector", "Directeur de la publication", { maxLength: 120 })}
          {area("hostingProvider", "Hébergeur du site", "Nom, adresse et téléphone de l’hébergeur")}
          {area("mediator", "Médiateur de la consommation", "Nom, adresse et site du médiateur")}
        </Section>

        <footer className="admin-room-dialog-actions admin-room-type-form-actions admin-settings-actions">
          <span role="status">
            {saveError ?? (saved && !dirty ? "Modifications enregistrées." : dirty ? invalidMessage ?? "Modifications non enregistrées." : "Aucune modification.")}
          </span>
          <div>
            <button type="button" className="admin-room-dialog-cancel" disabled={!dirty || saving} onClick={() => { setForm(toForm(currentSettings)); setSaveError(null); }}>Annuler</button>
            <button type="submit" className="admin-room-dialog-save" disabled={!dirty || Boolean(invalidMessage) || saving}>{saving ? <span className="admin-spinner light" /> : <Save />}{saving ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
        </footer>
      </form>
    </>
  );
}
