import { CheckCheck, ChevronRight, Mail, MessageSquareText, Phone, RotateCcw, Search, UserRound, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AdminApiError,
  AdminContactRequest,
  AdminContactRequestFilter,
  AdminContactRequestSummary,
  PaginatedAdminResult,
  getAdminContactRequest,
  getAdminContactRequests,
  setAdminContactRequestHandled,
} from "../../api/admin";
import { AdminModal } from "../../admin/AdminModal";
import { useAdminAuth } from "../../admin/auth";
import { AdminEmptyState, AdminErrorState, AdminPagination, AdminTableSkeleton, PageHeading, formatDateTime } from "../../admin/ui";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

const PAGE_SIZE = 20;

const filterLabels: Record<AdminContactRequestFilter, string> = {
  OPEN: "À traiter",
  HANDLED: "Traitées",
  ALL: "Toutes",
};

function excerpt(message: string) {
  const text = message.replace(/\s+/g, " ").trim();
  return text.length > 110 ? `${text.slice(0, 110).trimEnd()}…` : text;
}

function initials(fullName: string) {
  return fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("") || "—";
}

function RequestStatus({ request }: { request: AdminContactRequest }) {
  return request.handledAt
    ? <span className="admin-status admin-status-positive"><i />Traitée</span>
    : <span className="admin-status admin-status-warning"><i />À traiter</span>;
}

function replyLink(request: AdminContactRequest) {
  if (!request.email) return null;
  return `mailto:${request.email}?subject=${encodeURIComponent(`Re: ${request.subject}`)}`;
}

export function AdminContactRequests() {
  const { accessToken, logout, profile } = useAdminAuth();
  const timeZone = profile?.membership.property.timezone;
  const [status, setStatus] = useState<AdminContactRequestFilter>("OPEN");
  const [search, setSearch] = useState("");
  const deferredSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [result, setResult] = useState<PaginatedAdminResult<AdminContactRequest, AdminContactRequestSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminContactRequest | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [urlSearchParams, setUrlSearchParams] = useSearchParams();
  const linkedId = urlSearchParams.get("demande");

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminContactRequests({ page, pageSize: PAGE_SIZE, status, search: deferredSearch.trim() || undefined }, accessToken, controller.signal)
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
        setError(nextError instanceof Error ? nextError.message : "Les demandes n’ont pas pu être chargées.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, deferredSearch, logout, page, retryKey, status]);

  // The e-mail sent for each request links straight to it.
  useEffect(() => {
    if (!accessToken || !linkedId) return;
    const controller = new AbortController();
    setLinkError(null);
    getAdminContactRequest(linkedId, accessToken, controller.signal)
      .then(setSelected)
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
        setLinkError(nextError instanceof Error ? nextError.message : "Cette demande n’a pas pu être ouverte.");
      });
    return () => controller.abort();
  }, [accessToken, linkedId, logout]);

  function closeRequest() {
    setSelected(null);
    if (!urlSearchParams.has("demande")) return;
    const nextParams = new URLSearchParams(urlSearchParams);
    nextParams.delete("demande");
    setUrlSearchParams(nextParams, { replace: true });
  }

  function chooseFilter(next: AdminContactRequestFilter) {
    setStatus(next);
    setPage(1);
  }

  const summary = result?.summary ?? { open: 0, handled: 0 };
  const counts: Record<AdminContactRequestFilter, number> = { OPEN: summary.open, HANDLED: summary.handled, ALL: summary.open + summary.handled };

  return (
    <>
      <PageHeading
        eyebrow="Relation client"
        title="Demandes"
        description="Messages envoyés depuis le formulaire de contact du site. Répondez par e-mail, puis classez la demande."
      />

      {linkError && (
        <p className="admin-hold-notice" role="alert">
          <X />
          <span><strong>{linkError}</strong><small>Elle a peut-être été supprimée, ou appartient à un autre établissement.</small></span>
        </p>
      )}

      <section className="admin-panel">
        <div className="admin-panel-head admin-contact-panel-head">
          <div>
            <h2>{filterLabels[status] === "Toutes" ? "Toutes les demandes" : `Demandes ${filterLabels[status].toLowerCase()}`}</h2>
            <p>{result ? `${result.total} résultat${result.total > 1 ? "s" : ""}` : "Chargement des demandes"}</p>
          </div>
          <div className="admin-contact-filters" role="group" aria-label="Filtrer les demandes">
            {(Object.keys(filterLabels) as AdminContactRequestFilter[]).map((filter) => (
              <button key={filter} type="button" aria-pressed={status === filter} onClick={() => chooseFilter(filter)}>
                {filterLabels[filter]}{result && <span>{counts[filter]}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-filters admin-contact-search">
          <label className="admin-filter-search"><span className="sr-only">Rechercher</span><Search /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Nom, e-mail, téléphone, message…" /></label>
        </div>

        {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
        {!error && loading && !result && <AdminTableSkeleton columns={5} />}
        {!error && result && result.items.length === 0 && (
          <AdminEmptyState
            title={search ? "Aucune demande trouvée" : status === "OPEN" ? "Aucune demande à traiter" : "Aucune demande"}
            description={search ? "Essayez une autre recherche." : status === "OPEN" ? "Les nouveaux messages du site apparaîtront ici." : "Les messages envoyés depuis le site apparaîtront ici."}
          />
        )}
        {!error && result && result.items.length > 0 && (
          <>
            <div className={`admin-table-wrap ${loading ? "is-refreshing" : ""}`}>
              <table className="admin-table admin-contact-table">
                <thead><tr><th>Contact</th><th>Sujet et message</th><th>Reçue le</th><th>Statut</th><th><span className="sr-only">Détail</span></th></tr></thead>
                <tbody>
                  {result.items.map((request) => (
                    <tr key={request.id} className={request.handledAt ? "" : "is-unread"}>
                      <td className="admin-reference-cell"><button type="button" className="admin-reference" onClick={() => setSelected(request)}>{request.fullName}</button><small>{request.email ?? "Données anonymisées"}</small></td>
                      <td><strong>{request.subject}</strong><small>{excerpt(request.message)}</small></td>
                      <td>{formatDateTime(request.createdAt, timeZone)}</td>
                      <td><RequestStatus request={request} /></td>
                      <td><button className="admin-row-action" type="button" onClick={() => setSelected(request)} aria-label={`Lire la demande de ${request.fullName}`}><ChevronRight /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="admin-mobile-list">
                {result.items.map((request) => (
                  <button key={request.id} type="button" className="admin-mobile-booking" onClick={() => setSelected(request)}>
                    <span className="admin-mobile-card-head"><span><strong>{request.fullName}</strong><small>{request.subject}</small></span><RequestStatus request={request} /></span>
                    <span className="admin-contact-excerpt">{excerpt(request.message)}</span>
                    <span className="admin-mobile-card-foot"><span>{formatDateTime(request.createdAt, timeZone)}</span></span>
                  </button>
                ))}
              </div>
            </div>
            <AdminPagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} onPageChange={setPage} />
          </>
        )}
      </section>

      {selected && (
        <ContactRequestDialog
          request={selected}
          onClose={closeRequest}
          onChanged={(updated) => {
            setSelected(updated);
            setRetryKey((value) => value + 1);
          }}
        />
      )}
    </>
  );
}

function ContactRequestDialog({ request, onClose, onChanged }: {
  request: AdminContactRequest;
  onClose: () => void;
  onChanged: (request: AdminContactRequest) => void;
}) {
  const { accessToken, logout, profile } = useAdminAuth();
  const timeZone = profile?.membership.property.timezone;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const reply = replyLink(request);

  async function toggleHandled() {
    if (!accessToken || saving) return;
    setSaving(true);
    setError(null);
    try {
      onChanged(await setAdminContactRequestHandled(request.id, !request.handledAt, request.updatedAt, accessToken));
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setError(nextError instanceof Error ? nextError.message : "La demande n’a pas pu être mise à jour.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminModal titleId={titleId} busy={saving} onClose={onClose} className="admin-room-dialog admin-contact-dialog">
      <header className="admin-room-dialog-head">
        <div>
          <p>Demande de contact</p>
          <h2 id={titleId}>{request.subject}</h2>
          <span>Reçue le {formatDateTime(request.createdAt, timeZone)}</span>
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Fermer"><X /></button>
      </header>
      <div className="admin-room-dialog-body admin-contact-body">
        <section className="admin-detail-section">
          <h3><UserRound />Contact</h3>
          <div className="admin-detail-client">
            <span className="admin-detail-avatar">{request.anonymized ? "—" : initials(request.fullName)}</span>
            <div>
              <strong>{request.fullName}</strong>
              {request.email && <a href={`mailto:${request.email}`}><Mail />{request.email}</a>}
              {request.phone && <a href={`tel:${request.phone}`}><Phone />{request.phone}</a>}
            </div>
          </div>
        </section>
        <section className="admin-detail-section">
          <h3><MessageSquareText />Message</h3>
          <p className="admin-contact-message">{request.message}</p>
        </section>
        {request.anonymized && <p className="admin-room-type-form-hint">Les coordonnées et le message ont été effacés à l’échéance de conservation.</p>}
        {error && <p className="admin-room-save-error" role="alert">{error}</p>}
        <footer className="admin-room-dialog-actions admin-room-type-form-actions admin-contact-actions">
          <span className="admin-contact-state" role="status">
            {request.handledAt
              ? <><CheckCheck />Traitée le {formatDateTime(request.handledAt, timeZone)}{request.handledBy ? ` par ${request.handledBy}` : ""}</>
              : "Pas encore traitée"}
          </span>
          <div>
            {reply && <a className="admin-room-dialog-cancel admin-contact-reply" href={reply}><Mail />Répondre par e-mail</a>}
            <button type="button" className="admin-room-dialog-save" disabled={saving} onClick={toggleHandled}>
              {saving ? <span className="admin-spinner light" /> : request.handledAt ? <RotateCcw /> : <CheckCheck />}
              {request.handledAt ? "Rouvrir la demande" : "Marquer comme traitée"}
            </button>
          </div>
        </footer>
      </div>
    </AdminModal>
  );
}
