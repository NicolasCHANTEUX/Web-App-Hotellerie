import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  AdminApiError,
  AdminExtra,
  AdminExtraInput,
  AdminPricingUnit,
  createAdminExtra,
  deleteAdminExtra,
  getAdminExtras,
  updateAdminExtra,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import { AdminEmptyState, AdminErrorState, AdminTableSkeleton, PageHeading, formatMoney } from "../../admin/ui";

// Same wording as the booking form of the public site.
const unitLabels: Record<AdminPricingUnit, string> = {
  PER_PERSON_PER_NIGHT: "par personne / nuit",
  PER_NIGHT: "par nuit",
  ONE_TIME: "une fois",
};

type EditorState = { mode: "create" } | { mode: "edit"; extra: AdminExtra };

type ExtraFormState = {
  name: string;
  description: string;
  price: string;
  pricingUnit: AdminPricingUnit;
  taxRate: string;
  displayOrder: string;
  isActive: boolean;
};

function initialForm(extra: AdminExtra | null, displayOrder: number): ExtraFormState {
  if (!extra) {
    return { name: "", description: "", price: "10", pricingUnit: "PER_NIGHT", taxRate: "10", displayOrder: String(displayOrder), isActive: true };
  }
  return {
    name: extra.name,
    description: extra.description,
    price: String(extra.price),
    pricingUnit: extra.pricingUnit,
    taxRate: String(extra.taxRate ?? 0),
    displayOrder: String(extra.displayOrder),
    isActive: extra.isActive,
  };
}

function parseForm(form: ExtraFormState): { valid: boolean; input: AdminExtraInput } {
  const price = Number(form.price.replace(",", "."));
  const taxRate = Number(form.taxRate.replace(",", "."));
  const displayOrder = Number(form.displayOrder);
  const input = {
    name: form.name.trim(),
    description: form.description.trim(),
    price,
    pricingUnit: form.pricingUnit,
    taxRate,
    isActive: form.isActive,
    displayOrder,
  };
  const valid = input.name.length >= 2 && input.name.length <= 80
    && input.description.length <= 300
    && form.price.trim() !== "" && Number.isFinite(price) && price >= 0 && price <= 10_000
    && form.taxRate.trim() !== "" && Number.isFinite(taxRate) && taxRate >= 0 && taxRate <= 100
    && Number.isInteger(displayOrder) && displayOrder >= 0 && displayOrder <= 999;
  return { valid, input };
}

function taxLabel(extra: AdminExtra) {
  return extra.taxRate === null ? "—" : `${extra.taxRate} %`;
}

function ExtraStatus({ extra }: { extra: AdminExtra }) {
  return <span className={`admin-status admin-status-${extra.isActive ? "positive" : "neutral"}`}><i />{extra.isActive ? "Proposée" : "Désactivée"}</span>;
}

function ExtraActions({ extra, compact = false, onEdit, onDelete }: {
  extra: AdminExtra;
  compact?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const deleteHint = extra.canDelete ? "Supprimer" : "Cette option figure dans des réservations : désactivez-la plutôt.";
  return (
    <div className={`admin-extra-actions ${compact ? "compact" : ""}`}>
      <button type="button" aria-label={`Modifier ${extra.name}`} title="Modifier" onClick={onEdit}><Pencil />{!compact && "Modifier"}</button>
      <button type="button" className="danger" aria-label={`Supprimer ${extra.name}`} title={deleteHint} disabled={!extra.canDelete} onClick={onDelete}>
        <Trash2 />{!compact && "Supprimer"}
      </button>
    </div>
  );
}

/** Modal layer shared by the editor and the deletion confirmation. */
function ExtraDialog({ titleId, busy, onClose, children, className = "" }: {
  titleId: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef({ busy, onClose });

  useEffect(() => {
    closeRef.current = { busy, onClose };
  });

  // Runs once per opening: re-running it would move the focus while typing.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      (dialog?.querySelector<HTMLElement>("input, select, textarea") ?? dialog?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || closeRef.current.busy) return;
      event.preventDefault();
      closeRef.current.onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="admin-room-dialog-layer">
      <button type="button" className="admin-room-dialog-backdrop" aria-label="Fermer" disabled={busy} onClick={onClose} />
      <section ref={dialogRef} className={className} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
        {children}
      </section>
    </div>
  );
}

export function AdminExtras() {
  const { accessToken, logout } = useAdminAuth();
  const [extras, setExtras] = useState<AdminExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminExtra | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTitleId = useId();

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminExtras(accessToken, controller.signal)
      .then((data) => {
        setExtras(data);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) {
          logout();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Les options n’ont pas pu être chargées.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, logout, retryKey]);

  function askDelete(extra: AdminExtra) {
    setDeleteError(null);
    setDeleteTarget(extra);
  }

  async function confirmDelete() {
    if (!accessToken || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAdminExtra(deleteTarget.id, deleteTarget.updatedAt, accessToken);
      setDeleteTarget(null);
      setRetryKey((value) => value + 1);
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setDeleteError(nextError instanceof Error ? nextError.message : "La suppression a échoué.");
    } finally {
      setDeleting(false);
    }
  }

  const activeCount = extras.filter((extra) => extra.isActive).length;
  const nextDisplayOrder = extras.length ? Math.max(...extras.map((extra) => extra.displayOrder)) + 1 : 0;

  return (
    <>
      <PageHeading
        eyebrow="Catalogue"
        title="Options"
        description="Prestations que les clients peuvent ajouter à leur séjour."
        action={<button type="button" className="admin-room-create-button" onClick={() => setEditor({ mode: "create" })}><Plus />Nouvelle option</button>}
      />

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Options du séjour</h2>
            <p>{loading ? "Chargement des options" : `${extras.length} option${extras.length > 1 ? "s" : ""} · ${activeCount} proposée${activeCount > 1 ? "s" : ""} aux clients`}</p>
          </div>
        </div>

        {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
        {!error && loading && <AdminTableSkeleton columns={6} rows={4} />}
        {!error && !loading && extras.length === 0 && (
          <AdminEmptyState title="Aucune option" description="Créez une première option : petit-déjeuner, parking, lit bébé…" />
        )}
        {!error && !loading && extras.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table admin-extras-table">
              <thead><tr><th>Option</th><th>Tarif TTC</th><th>TVA incluse</th><th>Réservations</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {extras.map((extra) => (
                  <tr key={extra.id}>
                    <td><strong>{extra.name}</strong>{extra.description && <small>{extra.description}</small>}</td>
                    <td><strong>{formatMoney(extra.price, extra.currency)}</strong><small>{unitLabels[extra.pricingUnit]}</small></td>
                    <td>{taxLabel(extra)}</td>
                    <td>{extra.bookingCount}</td>
                    <td><ExtraStatus extra={extra} /></td>
                    <td className="admin-cell-right"><ExtraActions extra={extra} compact onEdit={() => setEditor({ mode: "edit", extra })} onDelete={() => askDelete(extra)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="admin-mobile-list">
              {extras.map((extra) => (
                <article key={extra.id} className="admin-mobile-room">
                  <span className="admin-mobile-card-head">
                    <span><strong>{extra.name}</strong>{extra.description && <small>{extra.description}</small>}</span>
                    <ExtraStatus extra={extra} />
                  </span>
                  <span className="admin-mobile-card-foot">
                    <span>{unitLabels[extra.pricingUnit]} · TVA {taxLabel(extra)} · {extra.bookingCount} réservation{extra.bookingCount > 1 ? "s" : ""}</span>
                    <strong>{formatMoney(extra.price, extra.currency)}</strong>
                  </span>
                  <ExtraActions extra={extra} onEdit={() => setEditor({ mode: "edit", extra })} onDelete={() => askDelete(extra)} />
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {editor && (
        <ExtraEditor
          extra={editor.mode === "edit" ? editor.extra : null}
          displayOrder={nextDisplayOrder}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRetryKey((value) => value + 1);
          }}
        />
      )}

      {deleteTarget && (
        <ExtraDialog titleId={deleteTitleId} busy={deleting} onClose={() => setDeleteTarget(null)} className="admin-room-delete-layer">
          <div className="admin-room-delete-dialog">
            <span className="admin-room-delete-icon" aria-hidden="true"><Trash2 /></span>
            <div className="admin-room-delete-copy">
              <h3 id={deleteTitleId}>Supprimer « {deleteTarget.name} » ?</h3>
              <p>Cette option n’a jamais été réservée : elle disparaîtra définitivement du catalogue.</p>
            </div>
            {deleteError && <p className="admin-room-delete-error" role="alert">{deleteError}</p>}
            <div className="admin-room-delete-actions">
              <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Annuler</button>
              <button type="button" className="danger" disabled={deleting} onClick={confirmDelete}>{deleting ? <span className="admin-spinner light" /> : <Trash2 />}{deleting ? "Suppression…" : "Supprimer définitivement"}</button>
            </div>
          </div>
        </ExtraDialog>
      )}
    </>
  );
}

function ExtraEditor({ extra, displayOrder, onClose, onSaved }: {
  extra: AdminExtra | null;
  displayOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const [form, setForm] = useState<ExtraFormState>(() => initialForm(extra, displayOrder));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const parsed = parseForm(form);

  function update<K extends keyof ExtraFormState>(field: K, value: ExtraFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || saving || !parsed.valid) return;
    setSaving(true);
    setError(null);
    try {
      if (extra) await updateAdminExtra(extra.id, { ...parsed.input, updatedAt: extra.updatedAt }, accessToken);
      else await createAdminExtra(parsed.input, accessToken);
      onSaved();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setError(nextError instanceof Error ? nextError.message : "L’enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ExtraDialog titleId={titleId} busy={saving} onClose={onClose} className="admin-room-dialog admin-extras-dialog">
      <header className="admin-room-dialog-head">
        <div>
          <p>Catalogue</p>
          <h2 id={titleId}>{extra ? "Modifier l’option" : "Nouvelle option"}</h2>
          <span>{extra?.bookingCount ? "Les réservations existantes conservent le prix accepté par le client." : "L’option sera proposée lors de la réservation sur le site et à la réception."}</span>
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Fermer"><X /></button>
      </header>
      <div className="admin-room-dialog-body">
        <form className="admin-room-type-form" onSubmit={submit} noValidate>
          <div className="admin-room-type-form-grid">
            <label className="wide"><span>Nom</span><input value={form.name} maxLength={80} onChange={(event) => update("name", event.target.value)} placeholder="Petit-déjeuner" /></label>
            <label className="wide"><span>Description</span><textarea value={form.description} maxLength={300} rows={2} onChange={(event) => update("description", event.target.value)} placeholder="Buffet maison servi chaque matin" /></label>
            <label><span>Prix TTC ({extra?.currency ?? "EUR"})</span><input type="number" min="0" max="10000" step="0.01" value={form.price} onChange={(event) => update("price", event.target.value)} /></label>
            <label>
              <span>Facturation</span>
              <select value={form.pricingUnit} onChange={(event) => update("pricingUnit", event.target.value as AdminPricingUnit)}>
                <option value="PER_PERSON_PER_NIGHT">Par personne et par nuit</option>
                <option value="PER_NIGHT">Par nuit</option>
                <option value="ONE_TIME">Une fois par séjour</option>
              </select>
            </label>
            <label><span>TVA incluse (%)</span><input type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={(event) => update("taxRate", event.target.value)} /></label>
            <label><span>Ordre d’affichage</span><input type="number" min="0" max="999" value={form.displayOrder} onChange={(event) => update("displayOrder", event.target.value)} /></label>
          </div>
          <label className="admin-room-type-published">
            <input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} />
            <span><strong>Proposer aux clients</strong><small>Une option désactivée n’est plus proposée, mais reste visible dans les réservations qui l’incluent.</small></span>
          </label>
          {error && <p className="admin-room-save-error" role="alert">{error}</p>}
          {!parsed.valid && <p className="admin-room-type-form-hint">Renseignez un nom, un prix et un taux de TVA valides.</p>}
          <footer className="admin-room-dialog-actions admin-room-type-form-actions">
            <span>{extra ? "Modification de l’option" : "Création d’une option"}</span>
            <div>
              <button type="button" className="admin-room-dialog-cancel" disabled={saving} onClick={onClose}>Annuler</button>
              <button type="submit" className="admin-room-dialog-save" disabled={!parsed.valid || saving}>{saving ? <span className="admin-spinner light" /> : <Save />}{saving ? "Enregistrement…" : "Enregistrer"}</button>
            </div>
          </footer>
        </form>
      </div>
    </ExtraDialog>
  );
}
