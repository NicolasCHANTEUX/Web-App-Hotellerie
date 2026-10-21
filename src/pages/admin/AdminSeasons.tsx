import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import {
  AdminApiError,
  AdminSeason,
  AdminSeasonGrid,
  AdminSeasonInput,
  createAdminSeason,
  deleteAdminSeason,
  getAdminSeasons,
  updateAdminSeason,
} from "../../api/admin";
import { AdminModal } from "../../admin/AdminModal";
import { useAdminAuth } from "../../admin/auth";
import { AdminEmptyState, AdminErrorState, AdminTableSkeleton, PageHeading, formatDate, formatMoney } from "../../admin/ui";

type RoomTypeRow = AdminSeasonGrid["roomTypes"][number];
type SeasonStatus = { label: string; tone: "positive" | "warning" | "neutral" };

function todayIn(timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", timeZone ? { timeZone } : {}).format(new Date());
}

function nightCount(validFrom: string, validUntil: string) {
  return Math.round((Date.parse(`${validUntil}T00:00:00Z`) - Date.parse(`${validFrom}T00:00:00Z`)) / 86_400_000) + 1;
}

function periodLabel(season: Pick<AdminSeason, "validFrom" | "validUntil">) {
  return `Nuits du ${formatDate(season.validFrom)} au ${formatDate(season.validUntil)}`;
}

function nightsLabel(count: number) {
  return `${count} nuit${count > 1 ? "s" : ""}`;
}

function seasonStatus(season: AdminSeason, today: string): SeasonStatus {
  if (season.validFrom > today) return { label: "À venir", tone: "warning" };
  if (season.validUntil < today) return { label: "Terminée", tone: "neutral" };
  return { label: "En cours", tone: "positive" };
}

function SeasonStatusBadge({ status }: { status: SeasonStatus }) {
  return <span className={`admin-status admin-status-${status.tone}`}><i />{status.label}</span>;
}

function SeasonActions({ season, compact = false, onEdit, onDelete }: {
  season: AdminSeason;
  compact?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`admin-extra-actions ${compact ? "compact" : ""}`}>
      <button type="button" aria-label={`Modifier ${season.label}`} title="Modifier" onClick={onEdit}><Pencil />{!compact && "Modifier"}</button>
      <button type="button" className="danger" aria-label={`Supprimer ${season.label}`} title="Supprimer" onClick={onDelete}><Trash2 />{!compact && "Supprimer"}</button>
    </div>
  );
}

/** Price of a room type during a season, or null when it keeps its base price. */
function seasonRate(season: AdminSeason, roomTypeId: string) {
  return season.rates.find((rate) => rate.roomTypeId === roomTypeId) ?? null;
}

function RateCell({ season, roomType }: { season: AdminSeason; roomType: RoomTypeRow }) {
  const rate = seasonRate(season, roomType.id);
  if (!rate) return <span className="admin-muted">Prix de base</span>;
  return (
    <>
      <strong>{formatMoney(rate.nightlyPrice, roomType.currency)}</strong>
      {rate.weekendNightlyPrice !== null && <small>ven. et sam. : {formatMoney(rate.weekendNightlyPrice, roomType.currency)}</small>}
    </>
  );
}

export function AdminSeasons() {
  const { accessToken, logout, profile } = useAdminAuth();
  const [grid, setGrid] = useState<AdminSeasonGrid>({ roomTypes: [], seasons: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [editor, setEditor] = useState<{ season: AdminSeason | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminSeason | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTitleId = useId();
  const today = todayIn(profile?.membership.property.timezone);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminSeasons(accessToken, controller.signal)
      .then((data) => {
        setGrid(data);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) {
          logout();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Les tarifs n’ont pas pu être chargés.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, logout, retryKey]);

  function askDelete(season: AdminSeason) {
    setDeleteError(null);
    setDeleteTarget(season);
  }

  async function confirmDelete() {
    if (!accessToken || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAdminSeason(deleteTarget.id, deleteTarget.updatedAt, accessToken);
      setDeleteTarget(null);
      setRetryKey((value) => value + 1);
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setDeleteError(nextError instanceof Error ? nextError.message : "La suppression a échoué.");
    } finally {
      setDeleting(false);
    }
  }

  const { roomTypes, seasons } = grid;
  // Past seasons stay listed for reference but no longer price anything.
  const gridSeasons = seasons.filter((season) => season.validUntil >= today);
  const current = seasons.find((season) => seasonStatus(season, today).tone === "positive");

  return (
    <>
      <PageHeading
        eyebrow="Catalogue"
        title="Tarifs"
        description="Prix par nuit selon la période. En dehors des saisons, chaque hébergement garde son prix de base."
        action={<button type="button" className="admin-room-create-button" disabled={loading || Boolean(error)} onClick={() => setEditor({ season: null })}><Plus />Nouvelle saison</button>}
      />

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Saisons</h2>
            <p>{loading ? "Chargement des saisons" : `${seasons.length} saison${seasons.length > 1 ? "s" : ""} · ${current ? `« ${current.label} » en cours` : "prix de base aujourd’hui"}`}</p>
          </div>
        </div>

        {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
        {!error && loading && <AdminTableSkeleton columns={5} rows={3} />}
        {!error && !loading && seasons.length === 0 && (
          <AdminEmptyState title="Aucune saison" description="Créez une haute saison ou un week-end prolongé pour adapter le prix des nuits et la durée minimale de séjour." />
        )}
        {!error && !loading && seasons.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table admin-extras-table">
              <thead><tr><th>Saison</th><th>Période</th><th>Durée minimale</th><th>Hébergements</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {seasons.map((season) => (
                  <tr key={season.id}>
                    <td><strong>{season.label}</strong></td>
                    <td>{periodLabel(season)}<small>{nightsLabel(nightCount(season.validFrom, season.validUntil))}</small></td>
                    <td>{season.minNights ? nightsLabel(season.minNights) : <span className="admin-muted">Aucune</span>}</td>
                    <td>{season.rates.length} sur {roomTypes.length} à prix spécial</td>
                    <td><SeasonStatusBadge status={seasonStatus(season, today)} /></td>
                    <td className="admin-cell-right"><SeasonActions season={season} compact onEdit={() => setEditor({ season })} onDelete={() => askDelete(season)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="admin-mobile-list">
              {seasons.map((season) => (
                <article key={season.id} className="admin-mobile-room">
                  <span className="admin-mobile-card-head">
                    <span><strong>{season.label}</strong><small>{periodLabel(season)}</small></span>
                    <SeasonStatusBadge status={seasonStatus(season, today)} />
                  </span>
                  <span className="admin-mobile-card-foot">
                    <span>{season.minNights ? `${nightsLabel(season.minNights)} minimum` : "Pas de durée minimale"} · {season.rates.length} prix spécia{season.rates.length > 1 ? "ux" : "l"}</span>
                    <strong>{nightsLabel(nightCount(season.validFrom, season.validUntil))}</strong>
                  </span>
                  <SeasonActions season={season} onEdit={() => setEditor({ season })} onDelete={() => askDelete(season)} />
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {!error && !loading && roomTypes.length > 0 && (
        <section className="admin-panel admin-season-grid-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Grille des prix</h2>
              <p>Prix TTC par nuit · les saisons terminées n’apparaissent plus</p>
            </div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table admin-season-grid">
              <thead>
                <tr>
                  <th>Hébergement</th>
                  <th>Prix de base</th>
                  {gridSeasons.map((season) => <th key={season.id}><strong>{season.label}</strong><small>{formatDate(season.validFrom)} → {formatDate(season.validUntil)}</small></th>)}
                </tr>
              </thead>
              <tbody>
                {roomTypes.map((roomType) => (
                  <tr key={roomType.id}>
                    <td><strong>{roomType.name}</strong></td>
                    <td>{roomType.basePrice === null ? <span className="admin-muted">Aucun tarif actif</span> : <strong>{formatMoney(roomType.basePrice, roomType.currency)}</strong>}</td>
                    {gridSeasons.map((season) => <td key={season.id}><RateCell season={season} roomType={roomType} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="admin-mobile-list">
              {roomTypes.map((roomType) => (
                <article key={roomType.id} className="admin-mobile-room">
                  <span className="admin-mobile-card-head">
                    <span><strong>{roomType.name}</strong><small>Prix de base</small></span>
                    <strong>{roomType.basePrice === null ? "Aucun tarif" : formatMoney(roomType.basePrice, roomType.currency)}</strong>
                  </span>
                  {gridSeasons.length > 0 && (
                    <dl className="admin-season-lines">
                      {gridSeasons.map((season) => (
                        <div key={season.id}>
                          <dt>{season.label}<small>{formatDate(season.validFrom)} → {formatDate(season.validUntil)}</small></dt>
                          <dd><RateCell season={season} roomType={roomType} /></dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {editor && (
        <SeasonEditor
          season={editor.season}
          roomTypes={roomTypes}
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
              <p>Les réservations déjà enregistrées gardent leur prix. Les nouvelles demandes sur ces dates repasseront au prix de base, sans durée minimale.</p>
            </div>
            {deleteError && <p className="admin-room-delete-error" role="alert">{deleteError}</p>}
            <div className="admin-room-delete-actions">
              <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Annuler</button>
              <button type="button" className="danger" disabled={deleting} onClick={confirmDelete}>{deleting ? <span className="admin-spinner light" /> : <Trash2 />}{deleting ? "Suppression…" : "Supprimer la saison"}</button>
            </div>
          </div>
        </AdminModal>
      )}
    </>
  );
}

type RateFields = { nightly: string; weekend: string };

type SeasonFormState = {
  label: string;
  validFrom: string;
  validUntil: string;
  minNights: string;
  rates: Record<string, RateFields>;
};

function initialForm(season: AdminSeason | null, roomTypes: RoomTypeRow[]): SeasonFormState {
  const rates: Record<string, RateFields> = {};
  for (const roomType of roomTypes) {
    const rate = season ? seasonRate(season, roomType.id) : null;
    rates[roomType.id] = {
      nightly: rate ? String(rate.nightlyPrice) : "",
      weekend: rate?.weekendNightlyPrice !== null && rate?.weekendNightlyPrice !== undefined ? String(rate.weekendNightlyPrice) : "",
    };
  }
  return {
    label: season?.label ?? "",
    validFrom: season?.validFrom ?? "",
    validUntil: season?.validUntil ?? "",
    minNights: season?.minNights ? String(season.minNights) : "",
    rates,
  };
}

function priceValue(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 10_000 ? parsed : Number.NaN;
}

function parseForm(form: SeasonFormState, roomTypes: RoomTypeRow[]): { valid: boolean; problem: string | null; input: AdminSeasonInput } {
  const minNights = form.minNights.trim() === "" ? null : Number(form.minNights);
  const rates: AdminSeasonInput["rates"] = [];
  let problem: string | null = null;
  for (const roomType of roomTypes) {
    const fields = form.rates[roomType.id] ?? { nightly: "", weekend: "" };
    const nightly = priceValue(fields.nightly);
    const weekend = priceValue(fields.weekend);
    if (Number.isNaN(nightly) || Number.isNaN(weekend)) problem ??= "Les prix doivent être compris entre 1 et 10 000.";
    else if (nightly === null && weekend !== null) problem ??= `Indiquez aussi le prix par nuit de « ${roomType.name} » pour lui donner un prix du week-end.`;
    else if (nightly !== null) rates.push({ roomTypeId: roomType.id, nightlyPrice: nightly, weekendNightlyPrice: weekend });
  }
  const label = form.label.trim();
  if (label.length < 2 || label.length > 60) problem = "Donnez un nom de 2 à 60 caractères à la saison.";
  else if (!form.validFrom || !form.validUntil) problem = "Indiquez la première et la dernière nuit de la saison.";
  else if (form.validUntil < form.validFrom) problem = "La dernière nuit doit être postérieure ou égale à la première.";
  else if (minNights !== null && (!Number.isInteger(minNights) || minNights < 1 || minNights > 30)) problem = "La durée minimale doit être comprise entre 1 et 30 nuits.";
  else if (!problem && rates.length === 0 && minNights === null) problem = "Fixez au moins un prix ou une durée minimale : sinon la saison ne change rien.";
  return { valid: problem === null, problem, input: { label, validFrom: form.validFrom, validUntil: form.validUntil, minNights, rates } };
}

function SeasonEditor({ season, roomTypes, onClose, onSaved }: {
  season: AdminSeason | null;
  roomTypes: RoomTypeRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const [form, setForm] = useState<SeasonFormState>(() => initialForm(season, roomTypes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const parsed = parseForm(form, roomTypes);
  const nights = form.validFrom && form.validUntil && form.validUntil >= form.validFrom ? nightCount(form.validFrom, form.validUntil) : null;

  function update<K extends Exclude<keyof SeasonFormState, "rates">>(field: K, value: SeasonFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateRate(roomTypeId: string, field: keyof RateFields, value: string) {
    setForm((current) => ({ ...current, rates: { ...current.rates, [roomTypeId]: { ...current.rates[roomTypeId]!, [field]: value } } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || saving || !parsed.valid) return;
    setSaving(true);
    setError(null);
    try {
      if (season) await updateAdminSeason(season.id, { ...parsed.input, updatedAt: season.updatedAt }, accessToken);
      else await createAdminSeason(parsed.input, accessToken);
      onSaved();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setError(nextError instanceof Error ? nextError.message : "L’enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminModal titleId={titleId} busy={saving} onClose={onClose} className="admin-room-dialog admin-season-dialog">
      <header className="admin-room-dialog-head">
        <div>
          <p>Tarifs</p>
          <h2 id={titleId}>{season ? "Modifier la saison" : "Nouvelle saison"}</h2>
          <span>Les réservations déjà enregistrées gardent leur prix ; seules les nouvelles demandes sont concernées.</span>
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Fermer"><X /></button>
      </header>
      <div className="admin-room-dialog-body">
        <form className="admin-room-type-form" onSubmit={submit} noValidate>
          <div className="admin-room-type-form-grid">
            <label className="wide"><span>Nom de la saison</span><input value={form.label} maxLength={60} placeholder="Haute saison" onChange={(event) => update("label", event.target.value)} /></label>
            <label><span>Première nuit</span><input type="date" value={form.validFrom} onChange={(event) => update("validFrom", event.target.value)} /></label>
            <label><span>Dernière nuit</span><input type="date" min={form.validFrom || undefined} value={form.validUntil} onChange={(event) => update("validUntil", event.target.value)} /></label>
            <label><span>Durée minimale (nuits)</span><input type="number" min="1" max="30" step="1" inputMode="numeric" placeholder="Aucune" value={form.minNights} onChange={(event) => update("minNights", event.target.value)} /></label>
            <p className="admin-tax-example">
              {nights
                ? `${nightsLabel(nights)}, celle du ${formatDate(form.validUntil)} comprise : un client qui part le lendemain matin paie encore le prix de la saison.`
                : "La dernière nuit est incluse : pour une saison qui se termine avec les départs du 1er septembre, indiquez le 31 août."}
            </p>
          </div>

          <div className="admin-season-rates">
            <div className="admin-season-rates-head" aria-hidden="true">
              <span>Hébergement</span><span>Prix par nuit TTC</span><span>Vendredi et samedi</span>
            </div>
            {roomTypes.map((roomType) => (
              <fieldset key={roomType.id} className="admin-season-rate-row">
                <legend><strong>{roomType.name}</strong><small>{roomType.basePrice === null ? "Aucun tarif actif" : `Base : ${formatMoney(roomType.basePrice, roomType.currency)}`}</small></legend>
                <label>
                  <span className="admin-season-rate-label">Prix par nuit TTC</span>
                  <input type="number" min="1" max="10000" step="0.01" inputMode="decimal" placeholder="Prix de base" aria-label={`Prix par nuit de ${roomType.name}`} value={form.rates[roomType.id]?.nightly ?? ""} onChange={(event) => updateRate(roomType.id, "nightly", event.target.value)} />
                </label>
                <label>
                  <span className="admin-season-rate-label">Vendredi et samedi</span>
                  <input type="number" min="1" max="10000" step="0.01" inputMode="decimal" placeholder="Même prix" aria-label={`Prix du week-end de ${roomType.name}`} value={form.rates[roomType.id]?.weekend ?? ""} onChange={(event) => updateRate(roomType.id, "weekend", event.target.value)} />
                </label>
              </fieldset>
            ))}
            <p className="admin-room-type-form-hint">Laissez un prix vide pour garder le prix de base de l’hébergement. Le prix du week-end s’applique aux nuits du vendredi et du samedi.</p>
          </div>

          {error && <p className="admin-room-save-error" role="alert">{error}</p>}
          {parsed.problem && <p className="admin-room-type-form-hint">{parsed.problem}</p>}
          <footer className="admin-room-dialog-actions admin-room-type-form-actions">
            <span>{season ? "Modification de la saison" : "Création d’une saison"}</span>
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
