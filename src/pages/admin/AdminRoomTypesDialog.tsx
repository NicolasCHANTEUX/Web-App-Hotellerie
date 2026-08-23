import {
  ArrowLeft,
  BedDouble,
  Eye,
  EyeOff,
  ImagePlus,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  AdminApiError,
  AdminRoomType,
  AdminRoomTypeInput,
  createAdminRoomType,
  deleteAdminRoomType,
  getAdminRoomTypes,
  updateAdminRoomType,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import { formatMoney } from "../../admin/ui";

const MAX_SOURCE_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_ENCODED_IMAGE_LENGTH = 560_000;

type EditorState = { mode: "create" } | { mode: "edit"; roomType: AdminRoomType };

type RoomTypeFormState = {
  name: string;
  shortName: string;
  description: string;
  surfaceSqm: string;
  maxAdults: string;
  maxChildren: string;
  maxGuests: string;
  bedLabel: string;
  coverImageUrl: string;
  displayOrder: string;
  isPublished: boolean;
  price: string;
  taxRate: string;
  amenities: string;
};

function initialForm(roomType: AdminRoomType | null, displayOrder: number): RoomTypeFormState {
  if (!roomType) {
    return {
      name: "",
      shortName: "",
      description: "",
      surfaceSqm: "20",
      maxAdults: "2",
      maxChildren: "0",
      maxGuests: "2",
      bedLabel: "1 lit double",
      coverImageUrl: "",
      displayOrder: String(displayOrder),
      isPublished: true,
      price: "100",
      taxRate: "10",
      amenities: "",
    };
  }
  return {
    name: roomType.name,
    shortName: roomType.shortName ?? "",
    description: roomType.description,
    surfaceSqm: String(roomType.surfaceSqm),
    maxAdults: String(roomType.maxAdults),
    maxChildren: String(roomType.maxChildren),
    maxGuests: String(roomType.maxGuests),
    bedLabel: roomType.bedLabel,
    coverImageUrl: roomType.coverImageUrl,
    displayOrder: String(roomType.displayOrder),
    isPublished: roomType.isPublished,
    price: String(roomType.price),
    taxRate: String(roomType.taxRate),
    amenities: roomType.amenities.join(", "),
  };
}

function parseForm(form: RoomTypeFormState) {
  const surfaceSqm = Number(form.surfaceSqm);
  const maxAdults = Number(form.maxAdults);
  const maxChildren = Number(form.maxChildren);
  const maxGuests = Number(form.maxGuests);
  const displayOrder = Number(form.displayOrder);
  const price = Number(form.price.replace(",", "."));
  const taxRate = Number(form.taxRate.replace(",", "."));
  const amenities = form.amenities
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const valid = form.name.trim().length >= 3
    && form.description.trim().length >= 20
    && form.bedLabel.trim().length >= 2
    && Boolean(form.coverImageUrl)
    && Number.isInteger(surfaceSqm) && surfaceSqm >= 8 && surfaceSqm <= 250
    && Number.isInteger(maxAdults) && maxAdults >= 1 && maxAdults <= 10
    && Number.isInteger(maxChildren) && maxChildren >= 0 && maxChildren <= 10
    && Number.isInteger(maxGuests) && maxGuests >= maxAdults && maxGuests <= maxAdults + maxChildren
    && Number.isInteger(displayOrder) && displayOrder >= 0 && displayOrder <= 999
    && Number.isFinite(price) && price >= 1 && price <= 10_000
    && Number.isFinite(taxRate) && taxRate >= 0 && taxRate <= 100
    && amenities.length <= 20;

  const input: AdminRoomTypeInput = {
    name: form.name.trim(),
    shortName: form.shortName.trim() || null,
    description: form.description.trim(),
    surfaceSqm,
    maxAdults,
    maxChildren,
    maxGuests,
    bedLabel: form.bedLabel.trim(),
    coverImageUrl: form.coverImageUrl,
    displayOrder,
    isPublished: form.isPublished,
    price,
    taxRate,
    amenities,
  };
  return { valid, input };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Le fichier image ne peut pas être lu."));
    image.src = url;
  });
}

async function compressCoverImage(file: File) {
  if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type)) {
    throw new Error("Choisissez une image JPEG, PNG ou WebP.");
  }
  if (file.size > MAX_SOURCE_IMAGE_SIZE) {
    throw new Error("L’image d’origine ne doit pas dépasser 10 Mo.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const maxWidth = 1_400;
    const maxHeight = 950;
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("La compression de l’image n’est pas disponible.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let encoded = canvas.toDataURL("image/jpeg", 0.78);
    if (encoded.length > MAX_ENCODED_IMAGE_LENGTH) encoded = canvas.toDataURL("image/jpeg", 0.58);
    if (encoded.length > MAX_ENCODED_IMAGE_LENGTH) {
      throw new Error("L’image reste trop volumineuse. Choisissez une image plus légère.");
    }
    return encoded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function AdminRoomTypesDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { accessToken, logout } = useAdminAuth();
  const [roomTypes, setRoomTypes] = useState<AdminRoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRoomType | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminRoomTypes(accessToken, controller.signal)
      .then((data) => {
        setRoomTypes(data);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) {
          logout();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Les types de chambres n’ont pas pu être chargés.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, logout, retryKey]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (deleting) return;
      if (deleteTarget) {
        setDeleteTarget(null);
        setDeleteError(null);
      } else if (editor) {
        setEditor(null);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyboard);
      previousFocus?.focus();
    };
  }, [deleteTarget, deleting, editor, onClose]);

  function refreshed() {
    setRetryKey((value) => value + 1);
    onChanged();
  }

  function askDelete(roomType: AdminRoomType) {
    setDeleteError(null);
    setDeleteTarget(roomType);
    window.requestAnimationFrame(() => deleteCancelRef.current?.focus());
  }

  async function confirmDelete() {
    if (!accessToken || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAdminRoomType(deleteTarget.id, deleteTarget.updatedAt, accessToken);
      setDeleteTarget(null);
      refreshed();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      setDeleteError(nextError instanceof Error ? nextError.message : "La suppression a échoué.");
    } finally {
      setDeleting(false);
    }
  }

  const nextDisplayOrder = roomTypes.length
    ? Math.max(...roomTypes.map((roomType) => roomType.displayOrder)) + 1
    : 0;

  return (
    <div className="admin-room-dialog-layer admin-room-types-layer">
      <button type="button" className="admin-room-dialog-backdrop" aria-label="Fermer la gestion des types de chambres" disabled={Boolean(deleteTarget)} onClick={onClose} />
      <section ref={dialogRef} className="admin-room-dialog admin-room-types-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="admin-room-dialog-head" inert={Boolean(deleteTarget) || undefined} aria-hidden={Boolean(deleteTarget) || undefined}>
          <div>
            <p>Catalogue</p>
            <h2 id={titleId}>{editor ? (editor.mode === "create" ? "Nouveau type" : "Modifier le type") : "Types de chambres"}</h2>
            <span>{editor ? "Les changements seront visibles automatiquement sur le site." : "Gérez les hébergements proposés aux clients."}</span>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fermer"><X /></button>
        </header>

        <div className="admin-room-dialog-body admin-room-types-body" inert={Boolean(deleteTarget) || undefined} aria-hidden={Boolean(deleteTarget) || undefined}>
          {editor ? (
            <RoomTypeEditor
              roomType={editor.mode === "edit" ? editor.roomType : null}
              displayOrder={nextDisplayOrder}
              onCancel={() => setEditor(null)}
              onSaved={() => {
                setEditor(null);
                refreshed();
              }}
            />
          ) : (
            <>
              <div className="admin-room-types-toolbar">
                <div><strong>{roomTypes.length} type{roomTypes.length > 1 ? "s" : ""}</strong><span>Les types dépubliés restent disponibles pour l’historique.</span></div>
                <button type="button" onClick={() => setEditor({ mode: "create" })}><Plus />Nouveau type</button>
              </div>

              {loading && <div className="admin-room-types-state"><span className="admin-spinner" />Chargement des types…</div>}
              {error && <div className="admin-room-types-state error"><p>{error}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)}>Réessayer</button></div>}
              {!loading && !error && roomTypes.length === 0 && <div className="admin-room-types-state"><p>Aucun type de chambre n’a encore été créé.</p></div>}
              {!loading && !error && roomTypes.length > 0 && (
                <div className="admin-room-type-list">
                  {roomTypes.map((roomType) => (
                    <article className="admin-room-type-card" key={roomType.id}>
                      <img src={roomType.coverImageUrl} alt="" />
                      <div className="admin-room-type-card-copy">
                        <span className={roomType.isPublished ? "published" : "unpublished"}>{roomType.isPublished ? <Eye /> : <EyeOff />}{roomType.isPublished ? "Publié" : "Dépublié"}</span>
                        <h3>{roomType.name}</h3>
                        <p>{roomType.surfaceSqm} m² · {roomType.maxGuests} voyageur(s) · {roomType.bedLabel}</p>
                        <strong>{formatMoney(roomType.price, roomType.currency)} <small>/ nuit</small></strong>
                        <em><BedDouble />{roomType.roomCount} chambre{roomType.roomCount > 1 ? "s" : ""}</em>
                      </div>
                      <div className="admin-room-type-card-actions">
                        <button type="button" onClick={() => setEditor({ mode: "edit", roomType })}><Pencil />Modifier</button>
                        <button type="button" className="danger" disabled={!roomType.canDelete} title={!roomType.canDelete ? "Déplacez les chambres associées ou dépubliez ce type." : undefined} onClick={() => askDelete(roomType)}><Trash2 />Supprimer</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {deleteTarget && (
          <div className="admin-room-delete-layer">
            <div className="admin-room-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${titleId}-delete`} aria-busy={deleting}>
              <span className="admin-room-delete-icon" aria-hidden="true"><Trash2 /></span>
              <div className="admin-room-delete-copy">
                <h3 id={`${titleId}-delete`}>Supprimer « {deleteTarget.name} » ?</h3>
                <p>Ce type disparaîtra définitivement du catalogue. Cette action n’est possible que lorsqu’aucune chambre ni réservation ne lui est associée.</p>
              </div>
              {deleteError && <p className="admin-room-delete-error" role="alert">{deleteError}</p>}
              <div className="admin-room-delete-actions">
                <button ref={deleteCancelRef} type="button" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>Annuler</button>
                <button type="button" className="danger" disabled={deleting} onClick={confirmDelete}>{deleting ? <span className="admin-spinner light" /> : <Trash2 />}{deleting ? "Suppression…" : "Supprimer définitivement"}</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RoomTypeEditor({ roomType, displayOrder, onCancel, onSaved }: {
  roomType: AdminRoomType | null;
  displayOrder: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const [form, setForm] = useState<RoomTypeFormState>(() => initialForm(roomType, displayOrder));
  const [saving, setSaving] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parsed = parseForm(form);

  function update<K extends keyof RoomTypeFormState>(field: K, value: RoomTypeFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProcessingImage(true);
    setError(null);
    try {
      update("coverImageUrl", await compressCoverImage(file));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "L’image n’a pas pu être préparée.");
    } finally {
      setProcessingImage(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || saving || processingImage || !parsed.valid) return;
    setSaving(true);
    setError(null);
    try {
      if (roomType) {
        await updateAdminRoomType(roomType.id, { ...parsed.input, updatedAt: roomType.updatedAt }, accessToken);
      } else {
        await createAdminRoomType(parsed.input, accessToken);
      }
      onSaved();
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) {
        logout();
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "L’enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="admin-room-type-form" onSubmit={submit} noValidate aria-busy={saving || processingImage}>
      <button type="button" className="admin-room-type-back" disabled={saving} onClick={onCancel}><ArrowLeft />Retour aux types</button>

      <section className="admin-room-type-cover-field">
        <div className="admin-room-type-cover-preview">
          {form.coverImageUrl ? <img src={form.coverImageUrl} alt="Aperçu de la couverture" /> : <span><ImagePlus />Aucune image</span>}
        </div>
        <div>
          <strong>Image de couverture</strong>
          <p>JPEG, PNG ou WebP. L’image est automatiquement redimensionnée et optimisée.</p>
          <input ref={fileInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} />
          <button type="button" disabled={saving || processingImage} onClick={() => fileInputRef.current?.click()}>{processingImage ? <span className="admin-spinner" /> : <Upload />}{processingImage ? "Optimisation…" : form.coverImageUrl ? "Remplacer l’image" : "Choisir une image"}</button>
        </div>
      </section>

      <div className="admin-room-type-form-grid">
        <label><span>Nom</span><input value={form.name} maxLength={100} onChange={(event) => update("name", event.target.value)} placeholder="Chambre Prestige" /></label>
        <label><span>Catégorie affichée</span><input value={form.shortName} maxLength={80} onChange={(event) => update("shortName", event.target.value)} placeholder="Chambre supérieure" /></label>
        {roomType && <label className="wide"><span>Adresse publique</span><input value={`/hebergements/${roomType.slug}`} readOnly /></label>}
        <label className="wide"><span>Description</span><textarea value={form.description} maxLength={2000} rows={4} onChange={(event) => update("description", event.target.value)} placeholder="Décrivez l’atmosphère, les volumes et les prestations…" /></label>
        <label><span>Surface (m²)</span><input type="number" min="8" max="250" value={form.surfaceSqm} onChange={(event) => update("surfaceSqm", event.target.value)} /></label>
        <label><span>Literie</span><input value={form.bedLabel} maxLength={120} onChange={(event) => update("bedLabel", event.target.value)} /></label>
        <label><span>Adultes maximum</span><input type="number" min="1" max="10" value={form.maxAdults} onChange={(event) => update("maxAdults", event.target.value)} /></label>
        <label><span>Enfants maximum</span><input type="number" min="0" max="10" value={form.maxChildren} onChange={(event) => update("maxChildren", event.target.value)} /></label>
        <label><span>Capacité totale</span><input type="number" min="1" max="12" value={form.maxGuests} onChange={(event) => update("maxGuests", event.target.value)} /></label>
        <label><span>Prix par nuit (€)</span><input type="number" min="1" max="10000" step="0.01" value={form.price} onChange={(event) => update("price", event.target.value)} /></label>
        <label><span>Taxe (%)</span><input type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={(event) => update("taxRate", event.target.value)} /></label>
        <label><span>Ordre d’affichage</span><input type="number" min="0" max="999" value={form.displayOrder} onChange={(event) => update("displayOrder", event.target.value)} /></label>
        <label className="wide"><span>Équipements</span><input value={form.amenities} onChange={(event) => update("amenities", event.target.value)} placeholder="Wi-Fi fibre, Vue mer, Machine à café" /><small>Séparez chaque équipement par une virgule.</small></label>
      </div>

      <label className="admin-room-type-published"><input type="checkbox" checked={form.isPublished} onChange={(event) => update("isPublished", event.target.checked)} /><span><strong>Publier sur le site</strong><small>Le type apparaîtra sur l’accueil, les hébergements et la recherche.</small></span></label>
      {error && <p className="admin-room-save-error" role="alert">{error}</p>}
      {!parsed.valid && <p className="admin-room-type-form-hint">Renseignez tous les champs obligatoires et vérifiez que la capacité totale est cohérente.</p>}

      <footer className="admin-room-dialog-actions admin-room-type-form-actions">
        <span>{roomType ? "Modification du catalogue" : "Création d’un nouveau type"}</span>
        <div>
          <button type="button" className="admin-room-dialog-cancel" disabled={saving} onClick={onCancel}>Annuler</button>
          <button type="submit" className="admin-room-dialog-save" disabled={!parsed.valid || saving || processingImage}>{saving ? <span className="admin-spinner light" /> : <Save />}{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </footer>
    </form>
  );
}
