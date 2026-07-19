'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  SOURCES,
  claimLead,
  listLeads,
  listPool,
  bulkImportLeads,
  type BulkReport,
  type BulkRow,
  type BulkRowResult,
  type LeadRow,
  type PoolRow,
} from '@/lib/leads';

// Record Status taxonomy verbatim (M1 §2 table) — 'Semua' is a client-only
// filter option (empty query param), not a server status.
const RECORD_STATUSES = ['[Pool]', 'active', '[Rejected]', '[Not Qualified]', '[Closed-Success]'];

type TabKey = 'pool' | 'database' | 'import';

const TAB_LABELS: Record<TabKey, string> = {
  pool: 'Pool',
  database: 'Database',
  import: 'Import',
};

export default function LeadsPage() {
  const { role } = useAuth();

  // Divisi kanonik dari /me untuk modul ini adalah kapital 'Sales'/'Marketing'
  // (fe_m0m1_contract.md) — JANGAN lowercase.
  const isSales = role?.division === 'Sales';
  const isMarketing = role?.division === 'Marketing';
  const isSalesLead = Boolean(isSales && role?.level === 'lead');
  const isOD = Boolean(role?.od);
  const isDirector = Boolean(role?.director);
  const odOnly = isOD && !isDirector;

  // Pool — Sales division (semua level), OD, Director.
  const canSeePool = isSales || isOD || isDirector;
  // Database — Marketing (staff/lead), Sales lead, OD, Director. TIDAK Sales staff.
  const canSeeDatabase = isMarketing || isSalesLead || isOD || isDirector;
  // Import — Marketing division non-odOnly, atau Director.
  const canSeeImport = (isMarketing && !odOnly) || isDirector;
  // Claim — Sales division non-odOnly, atau Director.
  const canClaim = (isSales && !odOnly) || isDirector;

  const visibleTabs = useMemo(() => {
    const tabs: TabKey[] = [];
    if (canSeePool) tabs.push('pool');
    if (canSeeDatabase) tabs.push('database');
    if (canSeeImport) tabs.push('import');
    return tabs;
  }, [canSeePool, canSeeDatabase, canSeeImport]);

  const [activeTab, setActiveTab] = useState<TabKey | null>(null);

  useEffect(() => {
    setActiveTab((prev) => {
      if (prev && visibleTabs.includes(prev)) return prev;
      return visibleTabs[0] ?? null;
    });
  }, [visibleTabs]);

  return (
    <div className="stack">
      <div>
        <h1>Leads</h1>
        <p className="muted">
          Leads Database (M1) &mdash; pool marketing (klaim kompetitif), database leads, dan intake Marketing.
        </p>
      </div>

      {role && visibleTabs.length === 0 && (
        <section className="card">
          <div className="emptyState">Tidak ada tampilan untuk role Anda.</div>
        </section>
      )}

      {visibleTabs.length > 0 && (
        <div className="row" style={{ gap: 8 }}>
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`btn ${activeTab === tab ? 'btnPrimary' : 'btnSecondary'} btnSm`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'pool' && <PoolTab canClaim={canClaim} />}
      {activeTab === 'database' && <DatabaseTab />}
      {activeTab === 'import' && <ImportTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pool tab
// ---------------------------------------------------------------------------

function PoolTab({ canClaim }: { canClaim: boolean }) {
  const [rows, setRows] = useState<PoolRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<ReactNode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPool();
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleClaim(leadId: string) {
    setClaimError(null);
    setClaimMessage(null);
    setClaimingId(leadId);
    try {
      const res = await claimLead(leadId);
      setClaimMessage(
        <>
          Berhasil klaim &mdash; Prospect{' '}
          <Link href={`/sales/${res.attempt.id}`}>{res.attempt.id}</Link> dibuat.
        </>,
      );
      await load();
    } catch (err) {
      setClaimError(errorMessage(err));
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Pool</h2>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Lead marketing yang belum dimenangkan. Klaim diizinkan lebih dari satu sales per lead (kontes closing skill).
      </p>
      {claimError && <div className="alert alertError" role="alert">{claimError}</div>}
      {claimMessage && <div className="alert alertSuccess" role="status">{claimMessage}</div>}
      {loading && <p className="muted">Memuat...</p>}
      {error && <div className="alert alertError" role="alert">{error}</div>}
      {!loading && !error && rows && rows.length === 0 && (
        <div className="emptyState">Tidak ada lead di pool.</div>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nama Lead</th>
                <th>Telepon</th>
                <th>Source</th>
                <th>Campaign</th>
                <th>Dibuat</th>
                <th>Stale</th>
                <th>Kontes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.stale ? 'flaggedRow' : ''}>
                  <td>{r.lead_name}</td>
                  <td>{r.phone_number}</td>
                  <td>{r.source}</td>
                  <td>{r.origin_campaign_id || '—'}</td>
                  <td>{r.created_at}</td>
                  <td>{r.stale ? <span className="badge badge-amber">STALE</span> : '—'}</td>
                  <td>{r.open_attempt_count > 0 ? `${r.open_attempt_count} sales mengerjakan` : '—'}</td>
                  <td>
                    {canClaim && (
                      <button
                        type="button"
                        className="btn btnPrimary btnSm"
                        disabled={r.my_open_attempt || claimingId !== null}
                        onClick={() => handleClaim(r.id)}
                      >
                        {r.my_open_attempt
                          ? 'Sudah diklaim'
                          : claimingId === r.id
                            ? 'Memproses...'
                            : 'Claim'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Database tab
// ---------------------------------------------------------------------------

function DatabaseTab() {
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qInput, setQInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [appliedStatus, setAppliedStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listLeads({ status: appliedStatus || undefined, q: appliedQ || undefined });
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [appliedStatus, appliedQ]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(qInput.trim());
    setAppliedStatus(statusInput);
  }

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Database</h2>
      </div>
      <form className="formRow" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="db-q">Cari (Nama/Telepon)</label>
          <input id="db-q" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="db-status">Status Record</label>
          <select id="db-status" value={statusInput} onChange={(e) => setStatusInput(e.target.value)}>
            <option value="">Semua</option>
            {RECORD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <label>&nbsp;</label>
          <button type="submit" className="btn btnSecondary btnSm">
            Terapkan
          </button>
        </div>
      </form>

      {loading && <p className="muted">Memuat...</p>}
      {error && <div className="alert alertError" role="alert">{error}</div>}
      {!loading && !error && rows && rows.length === 0 && (
        <div className="emptyState">Tidak ada lead yang cocok dengan filter.</div>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nama Lead</th>
                <th>Telepon</th>
                <th>Email</th>
                <th>Source</th>
                <th>Origin Divisi</th>
                <th>Campaign</th>
                <th>Status</th>
                <th>Kontes</th>
                <th>Pemenang</th>
                <th>Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/leads/${r.id}`}>{r.id}</Link>
                  </td>
                  <td>{r.lead_name}</td>
                  <td>{r.phone_number}</td>
                  <td>{r.email || '—'}</td>
                  <td>{r.source}</td>
                  <td>{r.origin_division}</td>
                  <td>{r.origin_campaign_id || '—'}</td>
                  <td>
                    <StatusBadge status={r.record_status} />
                  </td>
                  <td>{r.open_attempt_count}</td>
                  <td>{r.winning_attempt_id || '—'}</td>
                  <td>{r.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Import tab
// ---------------------------------------------------------------------------

// Client-side split-by-comma parser — no CSV library per contract. Format:
// lead_name,phone_number,email,source (email/source boleh kosong). Server is
// the sole authority on whether a row is valid; this only shapes the payload.
function parseBulkText(text: string): BulkRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      const [lead_name = '', phone_number = '', email = '', source = ''] = parts;
      const row: BulkRow = { lead_name, phone_number };
      if (email) row.email = email;
      if (source) row.source = source;
      return row;
    });
}

function rowStatusLabel(r: BulkRowResult): string {
  if (r.imported && r.reopened) return 'Reopened';
  if (r.imported) return 'Imported';
  return 'Rejected';
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadRejectionsCsv(rejections: BulkRowResult[]) {
  const header = 'row_number,lead_name,phone_number,reason';
  const lines = rejections.map((r) =>
    [r.row_number, csvEscape(r.lead_name), csvEscape(r.phone_number), csvEscape(r.reason || '')].join(','),
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'penolakan-import-leads.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function ReportView({ report }: { report: BulkReport }) {
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <div className="alert alertInfo" role="status">
        {report.summary}
      </div>
      <p className="muted">
        Imported: {report.imported} &middot; Rejected: {report.rejected}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Baris</th>
              <th>Nama Lead</th>
              <th>Telepon</th>
              <th>Status</th>
              <th>Lead ID</th>
              <th>Alasan</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.row_number}>
                <td>{r.row_number}</td>
                <td>{r.lead_name}</td>
                <td>{r.phone_number}</td>
                <td>{rowStatusLabel(r)}</td>
                <td>{r.lead_id ? <Link href={`/leads/${r.lead_id}`}>{r.lead_id}</Link> : '—'}</td>
                <td>{r.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.rejections.length > 0 && (
        <div>
          <div className="cardHeader">
            <h3>Daftar Penolakan</h3>
            <button
              type="button"
              className="btn btnSecondary btnSm"
              onClick={() => downloadRejectionsCsv(report.rejections)}
            >
              Unduh CSV Penolakan
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Baris</th>
                  <th>Nama Lead</th>
                  <th>Telepon</th>
                  <th>Alasan</th>
                </tr>
              </thead>
              <tbody>
                {report.rejections.map((r) => (
                  <tr key={r.row_number}>
                    <td>{r.row_number}</td>
                    <td>{r.lead_name}</td>
                    <td>{r.phone_number}</td>
                    <td>{r.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportTab() {
  // Single-row form — always goes through the Marketing bulk door
  // (bulkImportLeads with a 1-row array), never registerLead (that's Sales'
  // door and creates an attempt owned by the sender).
  const [singleName, setSingleName] = useState('');
  const [singlePhone, setSinglePhone] = useState('');
  const [singleEmail, setSingleEmail] = useState('');
  const [singleSource, setSingleSource] = useState<string>(SOURCES[0]);
  const [singleCampaign, setSingleCampaign] = useState('');
  const [singleSubmitting, setSingleSubmitting] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [singleReport, setSingleReport] = useState<BulkReport | null>(null);

  async function handleSingleSubmit(e: FormEvent) {
    e.preventDefault();
    setSingleError(null);
    setSingleReport(null);
    setSingleSubmitting(true);
    const row: BulkRow = { lead_name: singleName.trim(), phone_number: singlePhone.trim() };
    if (singleEmail.trim()) row.email = singleEmail.trim();
    if (singleSource) row.source = singleSource;
    try {
      const res = await bulkImportLeads(singleCampaign.trim() || undefined, [row]);
      setSingleReport(res);
      if (res.imported > 0) {
        setSingleName('');
        setSinglePhone('');
        setSingleEmail('');
        setSingleCampaign('');
      }
    } catch (err) {
      setSingleError(errorMessage(err));
    } finally {
      setSingleSubmitting(false);
    }
  }

  // Bulk paste — client-side comma split, no CSV library. Preview row count
  // before submit; server rejects per-row (e.g. empty source without a
  // campaign) so this never hard-blocks client-side.
  const [bulkCampaign, setBulkCampaign] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkReport, setBulkReport] = useState<BulkReport | null>(null);

  const bulkRows = useMemo(() => parseBulkText(bulkText), [bulkText]);

  async function handleBulkSubmit(e: FormEvent) {
    e.preventDefault();
    setBulkError(null);
    setBulkReport(null);
    if (bulkRows.length === 0) return;
    setBulkSubmitting(true);
    try {
      const res = await bulkImportLeads(bulkCampaign.trim() || undefined, bulkRows);
      setBulkReport(res);
    } catch (err) {
      setBulkError(errorMessage(err));
    } finally {
      setBulkSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="cardHeader">
          <h2>Import Satu Baris</h2>
        </div>
        <form className="form" onSubmit={handleSingleSubmit}>
          {singleError && <div className="alert alertError" role="alert">{singleError}</div>}
          <div className="formRow">
            <div className="field">
              <label htmlFor="single-name">Nama Lead</label>
              <input
                id="single-name"
                required
                value={singleName}
                onChange={(e) => setSingleName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="single-phone">Nomor Telepon</label>
              <input
                id="single-phone"
                required
                value={singlePhone}
                onChange={(e) => setSinglePhone(e.target.value)}
              />
            </div>
          </div>
          <div className="formRow">
            <div className="field">
              <label htmlFor="single-email">Email (opsional)</label>
              <input id="single-email" value={singleEmail} onChange={(e) => setSingleEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="single-source">Source</label>
              <select id="single-source" value={singleSource} onChange={(e) => setSingleSource(e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="single-campaign">Campaign ID (opsional)</label>
            <input
              id="single-campaign"
              placeholder="CMP-YYYYMM-NNNN"
              value={singleCampaign}
              onChange={(e) => setSingleCampaign(e.target.value)}
            />
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={singleSubmitting}>
              {singleSubmitting ? 'Memproses...' : 'Import'}
            </button>
          </div>
        </form>
        {singleReport && <ReportView report={singleReport} />}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Bulk Import (Paste CSV)</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Format per baris: lead_name,phone_number,email,source (email/source boleh kosong; source kosong
          hanya valid bila Campaign ID diisi &mdash; baris tetap dikirim, server yang menolak per baris).
        </p>
        <form className="form" onSubmit={handleBulkSubmit}>
          {bulkError && <div className="alert alertError" role="alert">{bulkError}</div>}
          <div className="field">
            <label htmlFor="bulk-campaign">Campaign ID (opsional)</label>
            <input
              id="bulk-campaign"
              placeholder="CMP-YYYYMM-NNNN"
              value={bulkCampaign}
              onChange={(e) => setBulkCampaign(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="bulk-text">Data CSV</label>
            <textarea
              id="bulk-text"
              rows={8}
              placeholder={'Budi Santoso,081234567890,budi@mail.com,Website\nSiti Aminah,082345678901,,'}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            {bulkRows.length} baris terdeteksi.
          </p>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={bulkSubmitting || bulkRows.length === 0}>
              {bulkSubmitting ? 'Memproses...' : 'Import Bulk'}
            </button>
          </div>
        </form>
        {bulkReport && <ReportView report={bulkReport} />}
      </section>
    </div>
  );
}
