import { Pencil, Plus, Save, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import {
  AdminApiError,
  AdminTaxCalculationMode,
  AdminTouristTax,
  AdminTouristTaxInput,
  createAdminTouristTax,
  deleteAdminTouristTax,
  getAdminTouristTaxes,
  updateAdminTouristTax,
} from "../../api/admin";
import { AdminModal } from "../../admin/AdminModal";
import { useAdminAuth } from "../../admin/auth";
import { AdminEmptyState, AdminErrorState, AdminTableSkeleton, PageHeading, formatDate, formatMoney } from "../../admin/ui";

const modeOptions: Array<[AdminTaxCalculationMode, string]> = [
  ["PER_ADULT_PER_NIGHT", "Par adulte et par nuit (mineurs exonérés)"],
  ["PER_PERSON_PER_NIGHT", "Par personne et par nuit"],
  ["PER_NIGHT", "Par nuit"],
  ["PER_STAY", "Par séjour"],
  ["PERCENTAGE", "Pourcentage du prix de l’hébergement"],
];

const unitLabels: Record<AdminTaxCalculationMode, string> = {
  PER_ADULT_PER_NIGHT: "par adulte et par nuit",
  PER_PERSON_PER_NIGHT: "par personne et par nuit",
  PER_NIGHT: "par nuit",
  PER_STAY: "par séjour",
  PERCENTAGE: "du prix de l’hébergement",
};

type TaxStatus = { label: string; tone: "positive" | "warning" | "neutral" };

function todayIn(timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", timeZone ? { timeZone } : {}).format(new Date());
}

function amountLabel(tax: Pick<AdminTouristTax, "calculationMode" | "amount" | "rate" | "currency">) {
  if (tax.calculationMode === "PERCENTAGE") return `${tax.rate ?? 0} %`;
  return formatMoney(tax.amount ?? 0, tax.currency ?? "EUR");
}

function periodLabel(tax: Pick<AdminTouristTax, "validFrom" | "validUntil">) {
  if (tax.validFrom && tax.validUntil) return `Nuits du ${formatDate(tax.validFrom)} au ${formatDate(tax.validUntil)}`;
  if (tax.validFrom) return `À partir de la nuit du ${formatDate(tax.validFrom)}`;
  if (tax.validUntil) return `Jusqu’à la nuit du ${formatDate(tax.validUntil)}`;
  return "Sans limite de date";
}

function taxStatus(tax: AdminTouristTax, today: string): TaxStatus {
  if (!tax.isActive) return { label: "Désactivée", tone: "neutral" };
  if (tax.validFrom && tax.validFrom > today) return { label: "À venir", tone: "warning" };
  if (tax.validUntil && tax.validUntil < today) return { label: "Terminée", tone: "neutral" };
  return { label: "En vigueur", tone: "positive" };
}

/**
 * Active rules sharing nights from today on: their amounts add up, which is
 * usually a forgotten last night on the previous rate.
 */
function currentOverlaps(taxes: AdminTouristTax[], today: string) {
  const active = taxes.filter((tax) => tax.isActive && (!tax.validUntil || tax.validUntil >= today));
  const overlaps = [];
  for (const [index, first] of active.entries()) {
    for (const second of active.slice(index + 1)) {
      const from = [first.validFrom, second.validFrom].filter(Boolean).sort().at(-1) ?? null;
      const until = [first.validUntil, second.validUntil].filter(Boolean).sort()[0] ?? null;
      if (!from || !until || from <= until) overlaps.push({ first, second, period: periodLabel({ validFrom: from, validUntil: until }) });
    }
  }
  return overlaps;
}

function TaxStatusBadge({ status }: { status: TaxStatus }) {
  return <span className={`admin-status admin-status-${status.tone}`}><i />{status.label}</span>;
}

function TaxActions({ tax, compact = false, onEdit, onDelete }: {
  tax: AdminTouristTax;
  compact?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const deleteHint = tax.canDelete ? "Supprimer" : "Déjà facturée : fixez sa dernière nuit ou désactivez-la.";
  return (
    <div className={`admin-extra-actions ${compact ? "compact" : ""}`}>
      <button type="button" aria-label={`Modifier ${tax.label}`} title="Modifier" onClick={onEdit}><Pencil />{!compact && "Modifier"}</button>
      <button type="button" className="danger" aria-label={`Supprimer ${tax.label}`} title={deleteHint} disabled={!tax.canDelete} onClick={onDelete}>
        <Trash2 />{!compact && "Supprimer"}
      </button>
    </div>
  );
}

export function AdminTouristTaxes() {
  const { accessToken, logout, profile } = useAdminAuth();
  const [taxes, setTaxes] = useState<AdminTouristTax[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [editor, setEditor] = useState<{ tax: AdminTouristTax | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminTouristTax | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTitleId = useId();
  const currency = profile?.membership.property.currency ?? "EUR";
  const today = todayIn(profile?.membership.property.timezone);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminTouristTaxes(accessToken, controller.signal)
      .then((data) => {
        setTaxes(data);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) {
          logout();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Les taxes n’ont pas pu être chargées.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, logout, retryKey]);

  function askDelete(tax: AdminTouristTax) {
    setDeleteError(null);
    setDeleteTarget(tax);
  }

  async function confirmDelete() {
    if (!accessToken || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAdminTouristTax(deleteTarget.id, deleteTarget.updatedAt, accessToken);
      setDeleteTarget(null);
      setRetryKey((value) => value + 1);
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setDeleteError(nextError instanceof Error ? nextError.message : "La suppression a échoué.");
    } finally {
      setDeleting(false);
    }
  }

  const overlaps = currentOverlaps(taxes, today);
  const inForce = taxes.filter((tax) => taxStatus(tax, today).tone === "positive").length;

  return (
    <>
      <PageHeading
        eyebrow="Catalogue"
        title="Taxe de séjour"
        description="Montants collectés pour la commune et ajoutés au prix du séjour, nuit par nuit."
        action={<button type="button" className="admin-room-create-button" onClick={() => setEditor({ tax: null })}><Plus />Nouvelle règle</button>}
      />

      {overlaps.map(({ first, second, period }) => (
        <p key={`${first.id}-${second.id}`} className="admin-hold-notice is-active" role="status">
          <TriangleAlert />
          <span>
            <strong>« {first.label} » et « {second.label} » s’additionnent : {period.toLowerCase()}.</strong>
            <small>Si la nouvelle règle remplace l’ancienne, fixez la dernière nuit de l’ancienne.</small>
          </span>
        </p>
      ))}

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Règles de calcul</h2>
            <p>{loading ? "Chargement des règles" : `${taxes.length} règle${taxes.length > 1 ? "s" : ""} · ${inForce} en vigueur aujourd’hui`}</p>
          </div>
        </div>

        {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
        {!error && loading && <AdminTableSkeleton columns={5} rows={3} />}
        {!error && !loading && taxes.length === 0 && (
          <AdminEmptyState title="Aucune taxe de séjour" description="Ajoutez le tarif communiqué par votre commune : il sera ajouté automatiquement au prix des séjours." />
        )}
        {!error && !loading && taxes.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table admin-extras-table">
              <thead><tr><th>Règle</th><th>Montant</th><th>Période</th><th>Réservations</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {taxes.map((tax) => (
                  <tr key={tax.id}>
                    <td><strong>{tax.label}</strong></td>
                    <td><strong>{amountLabel(tax)}</strong><small>{unitLabels[tax.calculationMode]}</small></td>
                    <td>{periodLabel(tax)}</td>
                    <td>{tax.usageCount}</td>
                    <td><TaxStatusBadge status={taxStatus(tax, today)} /></td>
                    <td className="admin-cell-right"><TaxActions tax={tax} compact onEdit={() => setEditor({ tax })} onDelete={() => askDelete(tax)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="admin-mobile-list">
              {taxes.map((tax) => (
                <article key={tax.id} className="admin-mobile-room">
                  <span className="admin-mobile-card-head">
                    <span><strong>{tax.label}</strong><small>{periodLabel(tax)}</small></span>
                    <TaxStatusBadge status={taxStatus(tax, today)} />
                  </span>
                  <span className="admin-mobile-card-foot">
                    <span>{unitLabels[tax.calculationMode]} · {tax.usageCount} réservation{tax.usageCount > 1 ? "s" : ""}</span>
                    <strong>{amountLabel(tax)}</strong>
                  </span>
                  <TaxActions tax={tax} onEdit={() => setEditor({ tax })} onDelete={() => askDelete(tax)} />
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {editor && (
        <TouristTaxEditor
          tax={editor.tax}
          currency={editor.tax?.currency ?? currency}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRetryKey((value) => value + 1);
          }}
        />
      )}

      {deleteTarget && (
        <AdminModal titleId={deleteTitleId} busy={deleting} onClose={() => setDeleteTarget(null)} className="admin-room-delete-layer">
          <div className="admin-room-delete-dialog">
            <span className="admin-room-delete-icon" aria-hidden="true"><Trash2 /></span>
            <div className="admin-room-delete-copy">
              <h3 id={deleteTitleId}>Supprimer « {deleteTarget.label} » ?</h3>
              <p>Cette règle n’a jamais été facturée : elle sera définitivement supprimée.</p>
            </div>
            {deleteError && <p className="admin-room-delete-error" role="alert">{deleteError}</p>}
            <div className="admin-room-delete-actions">
              <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Annuler</button>
              <button type="button" className="danger" disabled={deleting} onClick={confirmDelete}>{deleting ? <span className="admin-spinner light" /> : <Trash2 />}{deleting ? "Suppression…" : "Supprimer définitivement"}</button>
            </div>
          </div>
        </AdminModal>
      )}
    </>
  );
}

type TaxFormState = {
  label: string;
  calculationMode: AdminTaxCalculationMode;
  value: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
};

function initialForm(tax: AdminTouristTax | null): TaxFormState {
  if (!tax) return { label: "Taxe de séjour", calculationMode: "PER_ADULT_PER_NIGHT", value: "", validFrom: "", validUntil: "", isActive: true };
  return {
    label: tax.label,
    calculationMode: tax.calculationMode,
    value: String((tax.calculationMode === "PERCENTAGE" ? tax.rate : tax.amount) ?? ""),
    validFrom: tax.validFrom ?? "",
    validUntil: tax.validUntil ?? "",
    isActive: tax.isActive,
  };
}

function parseForm(form: TaxFormState): { valid: boolean; value: number; input: AdminTouristTaxInput } {
  const value = Number(form.value.replace(",", "."));
  const percentage = form.calculationMode === "PERCENTAGE";
  const input = {
    label: form.label.trim(),
    calculationMode: form.calculationMode,
    amount: percentage ? null : value,
    rate: percentage ? value : null,
    validFrom: form.validFrom || null,
    validUntil: form.validUntil || null,
    isActive: form.isActive,
  };
  const valid = input.label.length >= 2 && input.label.length <= 80
    && form.value.trim() !== "" && Number.isFinite(value) && value >= 0.01 && value <= 100
    && (!form.validFrom || !form.validUntil || form.validUntil >= form.validFrom);
  return { valid, value, input };
}

// A family of 2 adults and 1 child staying 3 nights at 100 € a night.
function exampleLabel(mode: AdminTaxCalculationMode, value: number, currency: string) {
  if (mode === "PERCENTAGE") return `3 nuits à ${formatMoney(100, currency)} : ${formatMoney(300 * value / 100, currency)} de taxe.`;
  const quantity = { PER_ADULT_PER_NIGHT: 6, PER_PERSON_PER_NIGHT: 9, PER_NIGHT: 3, PER_STAY: 1 }[mode];
  return `2 adultes et 1 enfant pendant 3 nuits : ${formatMoney(value * quantity, currency)} de taxe.`;
}

function TouristTaxEditor({ tax, currency, onClose, onSaved }: {
  tax: AdminTouristTax | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const [form, setForm] = useState<TaxFormState>(() => initialForm(tax));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const parsed = parseForm(form);
  const percentage = form.calculationMode === "PERCENTAGE";

  function update<K extends keyof TaxFormState>(field: K, value: TaxFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || saving || !parsed.valid) return;
    setSaving(true);
    setError(null);
    try {
      if (tax) await updateAdminTouristTax(tax.id, { ...parsed.input, updatedAt: tax.updatedAt }, accessToken);
      else await createAdminTouristTax(parsed.input, accessToken);
      onSaved();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setError(nextError instanceof Error ? nextError.message : "L’enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminModal titleId={titleId} busy={saving} onClose={onClose} className="admin-room-dialog admin-extras-dialog">
      <header className="admin-room-dialog-head">
        <div>
          <p>Taxe de séjour</p>
          <h2 id={titleId}>{tax ? "Modifier la règle" : "Nouvelle règle"}</h2>
          <span>{tax?.usageCount ? "Les réservations existantes conservent le montant déjà calculé." : "La règle s’appliquera aux nouvelles demandes, sur le site et à la réception."}</span>
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Fermer"><X /></button>
      </header>
      <div className="admin-room-dialog-body">
        <form className="admin-room-type-form" onSubmit={submit} noValidate>
          <div className="admin-room-type-form-grid">
            <label className="wide"><span>Libellé sur la facture</span><input value={form.label} maxLength={80} onChange={(event) => update("label", event.target.value)} /></label>
            <label className="wide">
              <span>Calcul</span>
              <select value={form.calculationMode} onChange={(event) => update("calculationMode", event.target.value as AdminTaxCalculationMode)}>
                {modeOptions.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
              </select>
            </label>
            <label><span>{percentage ? "Taux (%)" : `Montant (${currency})`}</span><input type="number" min="0.01" max="100" step="0.01" value={form.value} onChange={(event) => update("value", event.target.value)} /></label>
            <label><span>Première nuit</span><input type="date" value={form.validFrom} onChange={(event) => update("validFrom", event.target.value)} /></label>
            <label><span>Dernière nuit</span><input type="date" min={form.validFrom || undefined} value={form.validUntil} onChange={(event) => update("validUntil", event.target.value)} /></label>
            <p className="admin-tax-example">
              {parsed.valid ? `Exemple : ${exampleLabel(form.calculationMode, parsed.value, currency)}` : "Laissez les dates vides pour une règle sans limite. Un séjour à cheval sur deux règles paie chaque nuit au tarif en vigueur."}
            </p>
          </div>
          <label className="admin-room-type-published">
            <input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} />
            <span><strong>Appliquer cette règle</strong><small>Une règle désactivée n’est plus ajoutée aux nouveaux séjours.</small></span>
          </label>
          {error && <p className="admin-room-save-error" role="alert">{error}</p>}
          {!parsed.valid && <p className="admin-room-type-form-hint">Renseignez un libellé, un {percentage ? "taux" : "montant"} entre 0,01 et 100 et une dernière nuit postérieure à la première.</p>}
          <footer className="admin-room-dialog-actions admin-room-type-form-actions">
            <span>{tax ? "Modification de la règle" : "Création d’une règle"}</span>
            <div>
              <button type="button" className="admin-room-dialog-cancel" disabled={saving} onClick={onClose}>Annuler</button>
              <button type="submit" className="admin-room-dialog-save" disabled={!parsed.valid || saving}>{saving ? <span className="admin-spinner light" /> : <Save />}{saving ? "Enregistrement…" : "Enregistrer"}</button>
            </div>
          </footer>
        </form>
      </div>
    </AdminModal>
  );
}
