import { MailCheck, Pencil, Save, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import {
  AdminApiError,
  AdminRole,
  AdminTeamMember,
  getAdminTeam,
  inviteAdminTeamMember,
  removeAdminTeamMember,
  updateAdminTeamMemberRole,
} from "../../api/admin";
import { AdminModal } from "../../admin/AdminModal";
import { useAdminAuth } from "../../admin/auth";
import { AdminEmptyState, AdminErrorState, AdminTableSkeleton, PageHeading, formatDate, formatDateTime } from "../../admin/ui";

const roles: Array<{ role: AdminRole; label: string; description: string }> = [
  { role: "ADMIN", label: "Administrateur", description: "Tout l’établissement : réservations, catalogue, tarifs, paramètres et équipe." },
  { role: "RECEPTION", label: "Réception", description: "Réservations, planning, paiements et demandes de contact." },
  { role: "ACCOUNTING", label: "Comptabilité", description: "Réservations en lecture, paiements, remboursements et factures." },
  { role: "HOUSEKEEPING", label: "Gouvernance", description: "Planning et état des chambres, sans les coordonnées des clients." },
];

function roleLabel(role: AdminRole) {
  return roles.find((item) => item.role === role)?.label ?? role;
}

function MemberStatus({ member, timeZone }: { member: AdminTeamMember; timeZone?: string }) {
  if (!member.isActive) return <span className="admin-status admin-status-neutral"><i />Compte désactivé</span>;
  if (member.pending) return <span className="admin-status admin-status-warning"><i />Jamais connecté</span>;
  return <span className="admin-team-last-login">{member.lastLoginAt ? `Connexion le ${formatDateTime(member.lastLoginAt, timeZone)}` : "—"}</span>;
}

function MemberActions({ member, compact = false, onEdit, onRemove }: {
  member: AdminTeamMember;
  compact?: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const selfHint = "Demandez à un autre administrateur de modifier votre accès.";
  return (
    <div className={`admin-extra-actions ${compact ? "compact" : ""}`}>
      <button type="button" aria-label={`Modifier le rôle de ${member.displayName}`} title={member.isCurrentUser ? selfHint : "Modifier le rôle"} disabled={member.isCurrentUser} onClick={onEdit}><Pencil />{!compact && "Rôle"}</button>
      <button type="button" className="danger" aria-label={`Retirer l’accès de ${member.displayName}`} title={member.isCurrentUser ? selfHint : "Retirer l’accès"} disabled={member.isCurrentUser} onClick={onRemove}><UserMinus />{!compact && "Retirer"}</button>
    </div>
  );
}

export function AdminTeam() {
  const { accessToken, logout, profile } = useAdminAuth();
  const timeZone = profile?.membership.property.timezone;
  const propertyName = profile?.membership.property.name ?? "l’établissement";
  const [members, setMembers] = useState<AdminTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [editor, setEditor] = useState<{ member: AdminTeamMember | null } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AdminTeamMember | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const removeTitleId = useId();

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getAdminTeam(accessToken, controller.signal)
      .then((data) => {
        setMembers(data);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return;
        if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
        setError(nextError instanceof Error ? nextError.message : "L’équipe n’a pas pu être chargée.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, logout, retryKey]);

  async function confirmRemove() {
    if (!accessToken || !removeTarget || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeAdminTeamMember(removeTarget.id, accessToken);
      setNotice(`${removeTarget.displayName} n’a plus accès à l’administration.`);
      setRemoveTarget(null);
      setRetryKey((value) => value + 1);
    } catch (nextError) {
      if (nextError instanceof AdminApiError && nextError.status === 401) return logout();
      setRemoveError(nextError instanceof Error ? nextError.message : "Le retrait a échoué.");
    } finally {
      setRemoving(false);
    }
  }

  const admins = members.filter((member) => member.role === "ADMIN").length;

  return (
    <>
      <PageHeading
        eyebrow="Paramètres"
        title="Équipe"
        description="Les personnes qui accèdent à l’administration et ce que chacune peut y faire."
        action={<button type="button" className="admin-room-create-button" onClick={() => { setNotice(null); setEditor({ member: null }); }}><UserPlus />Inviter un membre</button>}
      />

      {notice && (
        <p className="admin-hold-notice is-active" role="status">
          <MailCheck />
          <span><strong>{notice}</strong></span>
        </p>
      )}

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Membres</h2>
            <p>{loading ? "Chargement de l’équipe" : `${members.length} membre${members.length > 1 ? "s" : ""} · ${admins} administrateur${admins > 1 ? "s" : ""}`}</p>
          </div>
        </div>

        {error && <AdminErrorState message={error} retry={() => setRetryKey((value) => value + 1)} />}
        {!error && loading && <AdminTableSkeleton columns={5} rows={3} />}
        {!error && !loading && members.length === 0 && <AdminEmptyState title="Aucun membre" description="Invitez les personnes qui gèrent l’établissement avec vous." />}
        {!error && !loading && members.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table admin-extras-table">
              <thead><tr><th>Membre</th><th>Rôle</th><th>Activité</th><th>Membre depuis</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td><strong>{member.displayName}{member.isCurrentUser && <span className="admin-team-you">Vous</span>}</strong><small>{member.email}</small></td>
                    <td><strong>{roleLabel(member.role)}</strong></td>
                    <td><MemberStatus member={member} timeZone={timeZone} /></td>
                    <td>{formatDate(member.memberSince)}</td>
                    <td className="admin-cell-right"><MemberActions member={member} compact onEdit={() => { setNotice(null); setEditor({ member }); }} onRemove={() => { setRemoveError(null); setRemoveTarget(member); }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="admin-mobile-list">
              {members.map((member) => (
                <article key={member.id} className="admin-mobile-room">
                  <span className="admin-mobile-card-head">
                    <span><strong>{member.displayName}{member.isCurrentUser && <span className="admin-team-you">Vous</span>}</strong><small>{member.email}</small></span>
                  </span>
                  <span className="admin-mobile-card-foot">
                    <span><MemberStatus member={member} timeZone={timeZone} /></span>
                    <strong>{roleLabel(member.role)}</strong>
                  </span>
                  {!member.isCurrentUser && <MemberActions member={member} onEdit={() => { setNotice(null); setEditor({ member }); }} onRemove={() => { setRemoveError(null); setRemoveTarget(member); }} />}
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {editor && (
        <TeamMemberEditor
          member={editor.member}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            setNotice(message);
            setRetryKey((value) => value + 1);
          }}
        />
      )}

      {removeTarget && (
        <AdminModal titleId={removeTitleId} busy={removing} onClose={() => setRemoveTarget(null)} className="admin-room-delete-layer">
          <div className="admin-room-delete-dialog">
            <span className="admin-room-delete-icon" aria-hidden="true"><UserMinus /></span>
            <div className="admin-room-delete-copy">
              <h3 id={removeTitleId}>Retirer l’accès de {removeTarget.displayName} ?</h3>
              <p>{removeTarget.email} ne pourra plus ouvrir l’administration de {propertyName}. Son compte et l’historique de ses actions sont conservés : vous pourrez l’inviter de nouveau.</p>
            </div>
            {removeError && <p className="admin-room-delete-error" role="alert">{removeError}</p>}
            <div className="admin-room-delete-actions">
              <button type="button" disabled={removing} onClick={() => setRemoveTarget(null)}>Annuler</button>
              <button type="button" className="danger" disabled={removing} onClick={confirmRemove}>{removing ? <span className="admin-spinner light" /> : <UserMinus />}{removing ? "Retrait…" : "Retirer l’accès"}</button>
            </div>
          </div>
        </AdminModal>
      )}
    </>
  );
}

function TeamMemberEditor({ member, onClose, onSaved }: {
  member: AdminTeamMember | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { accessToken, logout } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AdminRole>(member?.role ?? "RECEPTION");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const valid = member ? role !== member.role : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && displayName.trim().length >= 2;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      if (member) {
        await updateAdminTeamMemberRole(member.id, role, accessToken);
        onSaved(`${member.displayName} est désormais « ${roleLabel(role)} ».`);
      } else {
        const result = await inviteAdminTeamMember({ email: email.trim(), displayName: displayName.trim(), role }, accessToken);
        onSaved(result.invitationSent
          ? `Invitation envoyée à ${result.member.email} : le lien permet de choisir un mot de passe.`
          : `${result.member.email} avait déjà un compte : la connexion se fait avec son mot de passe habituel.`);
      }
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
          <p>Équipe</p>
          <h2 id={titleId}>{member ? `Rôle de ${member.displayName}` : "Inviter un membre"}</h2>
          <span>{member ? "Le nouveau rôle s’applique dès sa prochaine action." : "Un e-mail lui permettra de choisir son mot de passe."}</span>
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Fermer"><X /></button>
      </header>
      <div className="admin-room-dialog-body">
        <form className="admin-room-type-form" onSubmit={submit} noValidate>
          {!member && (
            <div className="admin-room-type-form-grid">
              <label className="wide"><span>Nom affiché</span><input value={displayName} maxLength={80} autoComplete="off" placeholder="Prénom Nom" onChange={(event) => setDisplayName(event.target.value)} /></label>
              <label className="wide"><span>Adresse e-mail professionnelle</span><input type="email" value={email} maxLength={320} autoComplete="off" placeholder="prenom@votre-hotel.fr" onChange={(event) => setEmail(event.target.value)} /></label>
            </div>
          )}
          <fieldset className="admin-team-roles">
            <legend>Rôle</legend>
            {roles.map((item) => (
              <label key={item.role} className={role === item.role ? "is-selected" : ""}>
                <input type="radio" name="team-role" value={item.role} checked={role === item.role} onChange={() => setRole(item.role)} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </label>
            ))}
          </fieldset>
          {error && <p className="admin-room-save-error" role="alert">{error}</p>}
          <footer className="admin-room-dialog-actions admin-room-type-form-actions">
            <span>{member ? "Modification du rôle" : "Invitation"}</span>
            <div>
              <button type="button" className="admin-room-dialog-cancel" disabled={saving} onClick={onClose}>Annuler</button>
              <button type="submit" className="admin-room-dialog-save" disabled={!valid || saving}>
                {saving ? <span className="admin-spinner light" /> : member ? <Save /> : <UserPlus />}
                {saving ? "Enregistrement…" : member ? "Enregistrer" : "Envoyer l’invitation"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </AdminModal>
  );
}
