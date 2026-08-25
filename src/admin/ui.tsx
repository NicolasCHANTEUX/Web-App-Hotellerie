import { AlertCircle, ChevronLeft, ChevronRight, Inbox, RotateCcw } from "lucide-react";
import { ReactNode } from "react";
import { BookingStatus, PaymentStatus, RoomStatus } from "../api/admin";

const bookingLabels: Record<BookingStatus, string> = {
  DRAFT: "Brouillon",
  PENDING_PAYMENT: "Confirmation en attente",
  CONFIRMED: "Confirmée",
  CHECKED_IN: "Client arrivé",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
  COMPLETED: "Terminée",
  NO_SHOW: "Non-présenté",
};

const paymentLabels: Record<PaymentStatus, string> = {
  REQUIRES_PAYMENT: "À régler",
  PROCESSING: "En cours",
  SUCCEEDED: "Payé",
  FAILED: "Échoué",
  CANCELLED: "Annulé",
  PARTIALLY_REFUNDED: "Partiellement remboursé",
  REFUNDED: "Remboursé",
};

const roomLabels: Record<RoomStatus, string> = {
  ACTIVE: "En service",
  OUT_OF_SERVICE: "Hors service",
  ARCHIVED: "Archivée",
};

export function bookingStatusLabel(status: BookingStatus) {
  return bookingLabels[status] ?? status;
}

export function paymentStatusLabel(status: PaymentStatus) {
  return paymentLabels[status] ?? status;
}

export function roomStatusLabel(status: RoomStatus) {
  return roomLabels[status] ?? status;
}

function statusTone(status: BookingStatus | PaymentStatus | RoomStatus) {
  if (["CONFIRMED", "CHECKED_IN", "COMPLETED", "SUCCEEDED", "ACTIVE"].includes(status)) return "positive";
  if (["PENDING_PAYMENT", "REQUIRES_PAYMENT", "PROCESSING"].includes(status)) return "warning";
  if (["CANCELLED", "FAILED", "NO_SHOW", "OUT_OF_SERVICE"].includes(status)) return "danger";
  return "neutral";
}

export function StatusBadge({ status, kind }: {
  status: BookingStatus | PaymentStatus | RoomStatus;
  kind: "booking" | "payment" | "room";
}) {
  const label = kind === "booking"
    ? bookingStatusLabel(status as BookingStatus)
    : kind === "payment"
      ? paymentStatusLabel(status as PaymentStatus)
      : roomStatusLabel(status as RoomStatus);
  return <span className={`admin-status admin-status-${statusTone(status)}`}><i />{label}</span>;
}

function parseDate(value: string) {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatDateTime(value: string, timeZone?: string) {
  return formatDate(value, {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatMoney(amount: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}

export function stayNights(checkIn: string, checkOut: string) {
  const duration = parseDate(checkOut).getTime() - parseDate(checkIn).getTime();
  return Math.max(1, Math.round(duration / 86_400_000));
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="admin-page-heading">
      <div><p>{eyebrow}</p><h1>{title}</h1>{description && <span>{description}</span>}</div>
      {action && <div className="admin-page-action">{action}</div>}
    </header>
  );
}

export function MetricCard({ label, value, detail, icon }: { label: string; value: number; detail?: string; icon: ReactNode }) {
  return (
    <article className="admin-metric-card">
      <span className="admin-metric-icon">{icon}</span>
      <div><p>{label}</p><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
    </article>
  );
}

export function AdminErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="admin-state admin-state-error" role="alert">
      <span><AlertCircle /></span>
      <div><strong>Impossible de charger les données</strong><p>{message}</p></div>
      <button type="button" onClick={retry}><RotateCcw />Réessayer</button>
    </div>
  );
}

export function AdminEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="admin-state admin-state-empty">
      <span><Inbox /></span>
      <div><strong>{title}</strong><p>{description}</p></div>
    </div>
  );
}

function paginationPages(current: number, total: number) {
  const candidates = [1, current - 1, current, current + 1, total]
    .filter((page) => page >= 1 && page <= total);
  return [...new Set(candidates)].sort((a, b) => a - b);
}

export function AdminPagination({ page, totalPages, total, pageSize, onPageChange }: { page: number; totalPages: number; total: number; pageSize: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pages = paginationPages(page, totalPages);

  return (
    <nav className="admin-pagination" aria-label="Pagination">
      <p>{first}–{last} sur {total}</p>
      <div>
        <button type="button" aria-label="Page précédente" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft /></button>
        {pages.map((item, index) => (
          <span key={item} className="admin-pagination-item">
            {index > 0 && item - pages[index - 1] > 1 && <i>…</i>}
            <button type="button" className={item === page ? "active" : ""} aria-current={item === page ? "page" : undefined} onClick={() => onPageChange(item)}>{item}</button>
          </span>
        ))}
        <button type="button" aria-label="Page suivante" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight /></button>
      </div>
    </nav>
  );
}

export function AdminTableSkeleton({ columns = 6, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="admin-table-skeleton" role="status" aria-label="Chargement des données">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} style={{ gridTemplateColumns: `repeat(${columns}, minmax(70px, 1fr))` }}>
          {Array.from({ length: columns }, (_, column) => <span key={column} />)}
        </div>
      ))}
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
