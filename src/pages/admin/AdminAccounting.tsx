import { FileDown, FileText, ReceiptText, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AdminApiError,
  MonthlyInvoiceReport,
  downloadAdminInvoice,
  downloadMonthlyInvoiceReport,
  getMonthlyInvoiceReport,
} from "../../api/admin";
import { useAdminAuth } from "../../admin/auth";
import { AdminEmptyState, AdminErrorState, MetricCard, PageHeading, formatDateTime, formatMoney } from "../../admin/ui";

function currentMonth(timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", timeZone })
    .formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function AdminAccounting() {
  const { accessToken, logout, profile } = useAdminAuth();
  const timeZone = profile?.membership.property.timezone;
  const [month, setMonth] = useState(() => currentMonth(timeZone));
  const [report, setReport] = useState<MonthlyInvoiceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [download, setDownload] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setReport(null);
    getMonthlyInvoiceReport(month, accessToken, controller.signal)
      .then((value) => { setReport(value); setLoading(false); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof AdminApiError && reason.status === 401) { logout(); return; }
        setError(reason instanceof Error ? reason.message : "Le dossier n'a pas pu être chargé.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, logout, month, retry]);

  async function downloadPdf(id?: string) {
    if (!accessToken || download) return;
    setDownload(id ?? "month");
    setDownloadError(null);
    try {
      if (id) await downloadAdminInvoice(id, accessToken);
      else await downloadMonthlyInvoiceReport(month, accessToken);
    } catch (reason) {
      if (reason instanceof AdminApiError && reason.status === 401) { logout(); return; }
      setDownloadError(reason instanceof Error ? reason.message : "Le téléchargement a échoué.");
    } finally {
      setDownload(null);
    }
  }

  const currency = report?.currency ?? profile?.membership.property.currency ?? "EUR";

  return <>
    <PageHeading eyebrow="Comptabilité" title="Documents comptables" description="Retrouvez les factures et avoirs par mois d'émission." />

    <section className="admin-panel admin-accounting-panel">
      <div className="admin-panel-head admin-accounting-toolbar">
        <label htmlFor="accounting-month">Mois d'émission <input id="accounting-month" type="month" value={month} min="2000-01" max="2099-12" onChange={(event) => { setMonth(event.target.value); setDownloadError(null); }} /></label>
        <button type="button" className="admin-room-create-button" disabled={loading || !report?.documents.length || Boolean(download)} onClick={() => downloadPdf()}><FileDown />{download === "month" ? "Préparation…" : "Télécharger le dossier mensuel"}</button>
      </div>
      <p className="admin-accounting-hint">Le dossier contient un récapitulatif suivi de chaque facture et avoir original. Il ne crée aucun nouveau document comptable.</p>
    </section>

    {downloadError && <p className="admin-accounting-error" role="alert">{downloadError}</p>}
    {error && <AdminErrorState message={error} retry={() => setRetry((value) => value + 1)} />}
    {loading && <div className="admin-accounting-loading" role="status">Chargement des documents…</div>}
    {!loading && report && <>
      <div className="admin-metrics admin-accounting-metrics">
        <MetricCard label="Factures" value={report.invoiceCount} detail={formatMoney(report.invoicedTotal, currency)} icon={<FileText />} />
        <MetricCard label="Avoirs" value={report.creditNoteCount} detail={formatMoney(report.creditedTotal, currency)} icon={<ReceiptText />} />
        <MetricCard label="Total net" value={formatMoney(report.netTotal, currency)} icon={<Wallet />} />
      </div>
      <section className="admin-panel">
        <div className="admin-panel-head"><div><h2>Documents du mois</h2><p>{report.documents.length} document{report.documents.length > 1 ? "s" : ""} émis</p></div></div>
        {report.documents.length === 0 ? <AdminEmptyState title="Aucun document pour ce mois" description="Choisissez un autre mois ou enregistrez un règlement pour émettre une facture." /> : <div className="admin-accounting-table-wrap"><table className="admin-accounting-table"><thead><tr><th>Document</th><th>Émission</th><th>Réservation</th><th>Montant TTC</th><th><span className="sr-only">Télécharger</span></th></tr></thead><tbody>
          {report.documents.map((item) => <tr key={item.id}>
            <td><strong>{item.documentType === "INVOICE" ? "Facture" : "Avoir"} {item.number}</strong>{item.originalInvoiceNumber && <small>Facture d'origine {item.originalInvoiceNumber}</small>}</td>
            <td>{formatDateTime(item.issuedAt, timeZone)}</td>
            <td><Link to={`/admin/reservations?booking=${encodeURIComponent(item.bookingId)}`}>{item.bookingReference}</Link></td>
            <td>{formatMoney(item.total, currency)}</td>
            <td><button type="button" aria-label={`Télécharger ${item.number}`} disabled={Boolean(download)} onClick={() => downloadPdf(item.id)}><FileDown /></button></td>
          </tr>)}
        </tbody></table></div>}
      </section>
    </>}
  </>;
}
