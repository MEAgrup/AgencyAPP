'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  DELETED_RECORD_STATUS,
  MINE_MODES,
  MINE_MODE_LABELS,
  SOURCES,
  approveLeadDelete,
  claimLead,
  listDeleteRequests,
  listLeads,
  listPool,
  bulkImportLeads,
  exportLeadsCsv,
  rejectLeadDelete,
  requestLeadDelete,
  type BulkReport,
  type BulkRow,
  type BulkRowResult,
  type DeleteRequestQueueRow,
  type LeadRow,
  type MineMode,
  type PoolRow,
} from '@/lib/leads';

// Record Status taxonomy verbatim (M1 §2 table) — 'Semua' is a client-only
// filter option (empty query param), not a server status.
// `[Deleted]` (owner decision 2026-07-29) is listed LAST and deliberately: the
// server hides deleted rows from the unfiltered Database list, so asking for
// them explicitly is the only way a Head can review what was deleted.
const RECORD_STATUSES = [
  '[Pool]',
  'active',
  '[Rejected]',
  '[Not Qualified]',
  '[Closed-Success]',
  DELETED_RECORD_STATUS,
];

type TabKey = 'mine' | 'pool' | 'database' | 'import' | 'deleteQueue';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

const TAB_LABELS: Record<TabKey, string> = {
  mine: 'Lead Saya',
  pool: 'Pool',
  database: 'Database',
  import: 'Import',
  deleteQueue: 'Permintaan Hapus',
};

export default function LeadsPage() {
  const { role } = useAuth();

  // Divisi kanonik dari /me untuk modul ini adalah kapital 'Sales'/'Marketing'
  // (fe_m0m1_contract.md) — JANGAN lowercase.
  const isSales = role?.division === 'Sales';
  const isMarketing = role?.division === 'Marketing';
  const isOD = Boolean(role?.od);
  const isDirector = Boolean(role?.director);
  const odOnly = isOD && !isDirector;

  // Pool — Sales division (semua level), OD, Director.
  const canSeePool = isSales || isOD || isDirector;
  // Database — Marketing (staff/lead), Sales (SEMUA level), OD, Director.
  //
  // Sales staff ditambahkan 2026-08-06 (QA pemilik): sebelum ini seorang sales
  // yang mendaftarkan lead tidak punya tempat untuk melihatnya lagi — lead
  // scouted lahir `active`, jadi tidak pernah muncul di Pool (Pool = `[Pool]`
  // saja, memang begitu desainnya, M1 §6 rule 3), sementara tab ini menjawab
  // 403. Membuka tab-nya TIDAK memperluas apa yang terbaca: `leads_select` (RLS)
  // tetap membatasi barisnya ke lead yang ia daftarkan atau ia pegang.
  const canSeeDatabase = isMarketing || isSales || isOD || isDirector;
  // Import — Marketing division non-odOnly, atau Director.
  const canSeeImport = (isMarketing && !odOnly) || isDirector;
  // Claim — Sales division non-odOnly, atau Director.
  const canClaim = (isSales && !odOnly) || isDirector;
  // Permintaan Hapus — antrian ACC, jadi audiensnya yang bisa meng-ACC: Head
  // divisi apa pun (Sales maupun Marketing), plus OD/Director yang read-all.
  // Staff tidak diberi tab ini; status pengajuannya sendiri terbaca di halaman
  // detail lead-nya. Endpoint-nya sendiri tidak ber-gate — aktor tanpa hak
  // hanya menerima antrian kosong (kebijakan RLS lead_delete_requests_select).
  const canSeeDeleteQueue = Boolean(role?.level === 'lead') || isOD || isDirector;
  // Cermin permission.isLead: Director di mana saja, atau level 'lead'. Divisi
  // asal lead-nya dicek PER BARIS oleh server — daftar antrian bisa memuat lead
  // divisi lain untuk OD/Director, jadi tombolnya ada tapi server yang memutus.
  // Sengaja TIDAK menambah `!odOnly`: approveDelete tidak memanggil canWrite,
  // dan OD berlapis di atas akun Lead memang boleh meng-ACC dari scope divisinya.
  const canDecideDelete = isDirector || role?.level === 'lead';

  // "Lead Saya" ikut gate yang sama dengan Database — ia memakai endpoint yang
  // sama (`GET /leads?mine=`), hanya dengan pertanyaan yang berbeda. Ia DIDAHULUKAN
  // karena itulah yang dicari orang saat membuka halaman ini: lead yang baru saja
  // ia daftarkan, bukan seluruh database.
  const canSeeMine = canSeeDatabase;

  const visibleTabs = useMemo(() => {
    const tabs: TabKey[] = [];
    if (canSeeMine) tabs.push('mine');
    if (canSeePool) tabs.push('pool');
    if (canSeeDatabase) tabs.push('database');
    if (canSeeImport) tabs.push('import');
    if (canSeeDeleteQueue) tabs.push('deleteQueue');
    return tabs;
  }, [canSeeMine, canSeePool, canSeeDatabase, canSeeImport, canSeeDeleteQueue]);

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

      {activeTab === 'mine' && (
        <MineTab canRequestDelete={isDirector || (role?.division ?? '') !== ''} />
      )}
      {activeTab === 'pool' && <PoolTab canClaim={canClaim} />}
      {/* canRequestDelete mencerminkan permission.canWrite: Director selalu, sisanya
          butuh scope divisi (OD murni tanpa divisi tidak bisa menulis). */}
      {activeTab === 'database' && (
        <DatabaseTab canRequestDelete={isDirector || (role?.division ?? '') !== ''} canExport={isDirector} />
      )}
      {activeTab === 'import' && <ImportTab />}
      {activeTab === 'deleteQueue' && (
        <DeleteQueueTab canDecide={canDecideDelete} division={role?.division ?? ''} isDirector={isDirector} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead Saya tab (keputusan pemilik 2026-08-06)
//
// Tampilan TERPISAH dari Database untuk lead yang aktor sendiri daftarkan. Ia
// memakai endpoint yang sama (`GET /leads?mine=`), jadi tidak ada aturan kedua
// yang bisa menyimpang dari Database — yang berbeda hanya pertanyaannya.
//
// Kenapa ada pilihan mode dan bukan satu daftar: "lead saya" punya DUA arti di
// M1 dan menggabungkannya menyembunyikan pekerjaan. Lead yang didaftarkan
// sendiri (§4, scouted, eksklusif) bukan hal yang sama dengan lead pool yang
// diklaim (§6, boleh diperebutkan). Default `registered` = permintaan harfiah
// pemilik; dua mode lain ada supaya lead hasil klaim tidak jadi hilang dari
// pandangan seperti masalah yang tab ini perbaiki.
// ---------------------------------------------------------------------------

function MineTab({ canRequestDelete }: { canRequestDelete: boolean }) {
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<MineMode>('registered');
  const [qInput, setQInput] = useState('');
  const [sourceInput, setSourceInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [appliedSource, setAppliedSource] = useState('');

  // Pengajuan hapus inline — sama persis dengan tab Database (alasan wajib).
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  // P2 §6: server memaginasi. `nextCursor` null = sudah halaman terakhir.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listLeads({
        mine: mode,
        q: appliedQ || undefined,
        source: appliedSource || undefined,
      });
      setRows(res.data);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [mode, appliedQ, appliedSource]);

  // Menyambung, bukan mengganti — dan cursor selalu dari respons TERAKHIR, jadi
  // ganti filter (yang memanggil `load` ulang) otomatis mereset paginasinya.
  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await listLeads({
        mine: mode,
        q: appliedQ || undefined,
        source: appliedSource || undefined,
        cursor: nextCursor,
      });
      setRows((prev) => [...(prev ?? []), ...res.data]);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(qInput.trim());
    setAppliedSource(sourceInput);
  }

  async function submitDeleteRequest(e: FormEvent, leadId: string) {
    e.preventDefault();
    setDeleteError(null);
    setDeleteNotice(null);
    setSubmitting(true);
    try {
      await requestLeadDelete(leadId, reason);
      setDeleteNotice(`Permintaan hapus ${leadId} diajukan — menunggu ACC Head.`);
      setOpenFor(null);
      setReason('');
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Lead Saya</h2>
        {rows && (
          <span className="muted" style={{ fontSize: 13 }}>
            {rows.length} lead
          </span>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Semua lead yang Anda daftarkan sendiri &mdash; termasuk yang sudah berjalan ke Contacted,
        Qualified, atau closing. Lead scouting bersifat eksklusif (tidak masuk pool, tidak bisa
        diklaim sales lain).
      </p>

      <form className="formRow" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="mine-mode">Kepemilikan</label>
          <select id="mine-mode" value={mode} onChange={(e) => setMode(e.target.value as MineMode)}>
            {MINE_MODES.map((m) => (
              <option key={m} value={m}>
                {MINE_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mine-q">Cari (Nama/Telepon)</label>
          <input id="mine-q" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mine-source">Source (aktivitas asal)</label>
          <select id="mine-source" value={sourceInput} onChange={(e) => setSourceInput(e.target.value)}>
            <option value="">Semua</option>
            {SOURCES.map((s) => (
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

      {deleteError && <div className="alert alertError" role="alert">{deleteError}</div>}
      {deleteNotice && <div className="alert alertSuccess" role="status">{deleteNotice}</div>}
      {loading && <p className="muted">Memuat...</p>}
      {error && <div className="alert alertError" role="alert">{error}</div>}
      {!loading && !error && rows && rows.length === 0 && (
        <div className="emptyState">
          Belum ada lead di sini. Daftarkan lead baru dari <Link href="/sales">Sales Workspace</Link>.
        </div>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nama Lead</th>
                <th>Telepon</th>
                <th>Source</th>
                <th>Campaign</th>
                <th>Peran</th>
                <th>Status</th>
                <th>Kontes</th>
                <th>Didaftarkan</th>
                {canRequestDelete && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((r) => {
                // Cermin decideDeleteRequest, sama dengan tab Database.
                const deletable =
                  r.record_status !== '[Closed-Success]' &&
                  (r.winning_attempt_id ?? '') === '' &&
                  r.record_status !== DELETED_RECORD_STATUS;
                const peran = [
                  r.registered_by_me ? 'Didaftarkan' : '',
                  r.claimed_by_me ? 'Dikerjakan' : '',
                ]
                  .filter(Boolean)
                  .join(' + ');
                return [
                  <tr key={r.id}>
                    <td>
                      <Link href={`/leads/${r.id}`}>{r.id}</Link>
                    </td>
                    <td>{r.lead_name}</td>
                    <td>{r.phone_number}</td>
                    <td>{r.source}</td>
                    <td>{r.origin_campaign_id || '—'}</td>
                    <td>{peran || '—'}</td>
                    <td>
                      <StatusBadge status={r.record_status} />
                    </td>
                    <td>{r.open_attempt_count}</td>
                    <td>{formatDate(r.created_at)}</td>
                    {canRequestDelete && (
                      <td>
                        {deletable && (
                          <button
                            type="button"
                            className="btn btnSecondary btnSm"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteNotice(null);
                              setReason('');
                              setOpenFor(openFor === r.id ? null : r.id);
                            }}
                          >
                            {openFor === r.id ? 'Batal' : 'Ajukan Hapus'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>,
                  ...(canRequestDelete && openFor === r.id
                    ? [
                        <tr key={`${r.id}-delete-form`}>
                          <td colSpan={10}>
                            <form className="formRow" onSubmit={(e) => submitDeleteRequest(e, r.id)}>
                              <div className="field" style={{ flex: 1 }}>
                                <label htmlFor={`mine-reason-${r.id}`}>
                                  Alasan hapus {r.id} (wajib)
                                </label>
                                <input
                                  id={`mine-reason-${r.id}`}
                                  required
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                  placeholder="mis. lead uji coba, duplikat salah input"
                                />
                              </div>
                              <div className="field" style={{ justifyContent: 'flex-end' }}>
                                <label>&nbsp;</label>
                                <button type="submit" className="btn btnPrimary btnSm" disabled={submitting}>
                                  {submitting ? 'Memproses...' : 'Kirim Pengajuan'}
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>,
                      ]
                    : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor !== null && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button type="button" className="btn btnSecondary" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
          </button>
        </div>
      )}

    </section>
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

  // Pencarian & filter dijalankan SERVER (query param), bukan menyaring array
  // yang sudah diambil: pool tumbuh terus dan penyaringan klien hanya akan
  // menyembunyikan bahwa yang dimuat cuma sebagian.
  const [qInput, setQInput] = useState('');
  const [sourceInput, setSourceInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [appliedSource, setAppliedSource] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPool({ q: appliedQ || undefined, source: appliedSource || undefined });
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [appliedQ, appliedSource]);

  useEffect(() => {
    load();
  }, [load]);

  function applyPoolFilters(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(qInput.trim());
    setAppliedSource(sourceInput);
  }

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
        Lead yang Anda daftarkan sendiri (scouting) bersifat eksklusif dan tidak masuk pool &mdash; cari di tab{' '}
        <strong>Database</strong>.
      </p>
      <form className="formRow" onSubmit={applyPoolFilters}>
        <div className="field">
          <label htmlFor="pool-q">Cari (Nama/Telepon)</label>
          <input
            id="pool-q"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="mis. Alpha atau 0812"
          />
        </div>
        <div className="field">
          <label htmlFor="pool-source">Source (aktivitas asal)</label>
          <select id="pool-source" value={sourceInput} onChange={(e) => setSourceInput(e.target.value)}>
            <option value="">Semua</option>
            {SOURCES.map((s) => (
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
                  <td>{formatDate(r.created_at)}</td>
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

function DatabaseTab({ canRequestDelete, canExport }: { canRequestDelete: boolean; canExport: boolean }) {
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Pengajuan hapus inline: alasan WAJIB, jadi tombol per baris tidak bisa
  // langsung mengirim — ia membuka satu baris input di bawah lead-nya.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const [qInput, setQInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [sourceInput, setSourceInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [appliedStatus, setAppliedStatus] = useState('');
  const [appliedSource, setAppliedSource] = useState('');

  // P2 §6: server memaginasi. `nextCursor` null = sudah halaman terakhir.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listLeads({
        status: appliedStatus || undefined,
        q: appliedQ || undefined,
        source: appliedSource || undefined,
      });
      setRows(res.data);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [appliedStatus, appliedQ, appliedSource]);

  // Menyambung, bukan mengganti — dan cursor selalu dari respons TERAKHIR, jadi
  // ganti filter (yang memanggil `load` ulang) otomatis mereset paginasinya.
  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await listLeads({
        status: appliedStatus || undefined,
        q: appliedQ || undefined,
        source: appliedSource || undefined,
        cursor: nextCursor,
      });
      setRows((prev) => [...(prev ?? []), ...res.data]);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(qInput.trim());
    setAppliedStatus(statusInput);
    setAppliedSource(sourceInput);
  }

  async function submitDeleteRequest(e: FormEvent, leadId: string) {
    e.preventDefault();
    setDeleteError(null);
    setDeleteNotice(null);
    setSubmitting(true);
    try {
      await requestLeadDelete(leadId, reason);
      setDeleteNotice(`Permintaan hapus ${leadId} diajukan — menunggu ACC Head.`);
      setOpenFor(null);
      setReason('');
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // E2: meneruskan filter yang SUDAH DITERAPKAN (appliedQ/appliedStatus/
  // appliedSource), bukan draft input yang belum ditekan "Terapkan".
  //
  // Sejak P2 §6 tabelnya dipaginasi, jadi isi file = seluruh baris yang cocok
  // FILTER, bukan cuma halaman yang kebetulan sudah dimuat di layar. Itu yang
  // benar untuk sebuah export (route `/leads/export` sengaja tidak paginasi),
  // tapi bedanya perlu dikatakan ke pengguna — lihat catatan di bawah tombol.
  async function exportCsv() {
    setExportError(null);
    setExporting(true);
    try {
      await exportLeadsCsv({
        status: appliedStatus || undefined,
        q: appliedQ || undefined,
        source: appliedSource || undefined,
      });
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
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
        <div className="field">
          <label htmlFor="db-source">Source (aktivitas asal)</label>
          <select id="db-source" value={sourceInput} onChange={(e) => setSourceInput(e.target.value)}>
            <option value="">Semua</option>
            {SOURCES.map((s) => (
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
        {canExport && (
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label>&nbsp;</label>
            <button type="button" className="btn btnSecondary btnSm" disabled={exporting} onClick={exportCsv}>
              {exporting ? 'Mengekspor...' : 'Export CSV'}
            </button>
          </div>
        )}
      </form>
      <p className="muted" style={{ fontSize: 12 }}>
        Baris yang bisa Anda baca ditentukan server (staff = data sendiri). Untuk melihat khusus lead
        Anda sendiri, buka tab <strong>Lead Saya</strong>. Tabel dimuat bertahap — klik{' '}
        <strong>Muat lebih banyak</strong> di bawah untuk menambah baris.
        {canExport && ' Export CSV berisi SEMUA baris yang cocok filter, bukan hanya yang sudah dimuat.'}
      </p>

      {exportError && <div className="alert alertError" role="alert">{exportError}</div>}
      {deleteError && <div className="alert alertError" role="alert">{deleteError}</div>}
      {deleteNotice && <div className="alert alertSuccess" role="status">{deleteNotice}</div>}
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
                {canRequestDelete && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((r) => {
                // Cermin decideDeleteRequest: klien (atau sudah ada pemenang)
                // dan baris yang sudah terhapus tidak bisa diajukan oleh siapa
                // pun, jadi tombolnya tidak ditawarkan. Sisa gate-nya milik
                // server.
                const deletable =
                  r.record_status !== '[Closed-Success]' &&
                  (r.winning_attempt_id ?? '') === '' &&
                  r.record_status !== DELETED_RECORD_STATUS;
                return [
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
                    <td>{formatDate(r.created_at)}</td>
                    {canRequestDelete && (
                      <td>
                        {deletable && (
                          <button
                            type="button"
                            className="btn btnSecondary btnSm"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteNotice(null);
                              setReason('');
                              setOpenFor(openFor === r.id ? null : r.id);
                            }}
                          >
                            {openFor === r.id ? 'Batal' : 'Ajukan Hapus'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>,
                  ...(canRequestDelete && openFor === r.id
                    ? [
                        <tr key={`${r.id}-delete-form`}>
                          <td colSpan={12}>
                            <form
                              className="formRow"
                              onSubmit={(e) => submitDeleteRequest(e, r.id)}
                            >
                              <div className="field" style={{ flex: 1 }}>
                                <label htmlFor={`reason-${r.id}`}>
                                  Alasan hapus {r.id} (wajib)
                                </label>
                                <input
                                  id={`reason-${r.id}`}
                                  required
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                  placeholder="mis. lead uji coba, duplikat salah input"
                                />
                              </div>
                              <div className="field" style={{ justifyContent: 'flex-end' }}>
                                <label>&nbsp;</label>
                                <button
                                  type="submit"
                                  className="btn btnPrimary btnSm"
                                  disabled={submitting}
                                >
                                  {submitting ? 'Memproses...' : 'Kirim Pengajuan'}
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>,
                      ]
                    : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor !== null && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button type="button" className="btn btnSecondary" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
          </button>
        </div>
      )}

    </section>
  );
}

// ---------------------------------------------------------------------------
// Permintaan Hapus tab — antrian ACC Head (keputusan pemilik 2026-07-29).
//
// Baris yang tampil ditentukan kebijakan RLS `lead_delete_requests_select`, bukan
// oleh filter di sini: Head melihat divisi asal lead-nya, OD/Director melihat
// semua. Antrian kosong adalah jawaban jujur untuk aktor tanpa hak ACC.
// ---------------------------------------------------------------------------

const DELETE_STATUS_LABELS: Record<string, string> = {
  pending: 'Menunggu ACC',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

function DeleteQueueTab({
  canDecide,
  division,
  isDirector,
}: {
  canDecide: boolean;
  division: string;
  isDirector: boolean;
}) {
  const [rows, setRows] = useState<DeleteRequestQueueRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 'pending' = default server (yang bisa ditindak); '' = semua, untuk melihat
  // yang sudah diputuskan.
  const [statusFilter, setStatusFilter] = useState('pending');

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [decideNotice, setDecideNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDeleteRequests({ status: statusFilter });
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(row: DeleteRequestQueueRow, approve: boolean) {
    setDecideError(null);
    setDecideNotice(null);
    setDecidingId(row.id);
    const note = notes[row.id] ?? '';
    try {
      if (approve) {
        await approveLeadDelete(row.id, note);
        setDecideNotice(`${row.lead_id} disetujui — dipindahkan ke ${DELETED_RECORD_STATUS}.`);
      } else {
        await rejectLeadDelete(row.id, note);
        setDecideNotice(`Permintaan hapus ${row.lead_id} ditolak — lead dibiarkan utuh.`);
      }
      setNotes((prev) => ({ ...prev, [row.id]: '' }));
      await load();
    } catch (err) {
      setDecideError(errorMessage(err));
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Permintaan Hapus</h2>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Hapus lead wajib di-ACC Head divisi <strong>asal</strong> lead
        {isDirector ? ' (Director bisa di semua divisi)' : division ? ` — untuk Anda: ${division}` : ''}.
        ACC memindahkan lead ke <code>{DELETED_RECORD_STATUS}</code>; barisnya tidak pernah dibuang.
      </p>

      <form className="formRow" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="ldr-status">Status Permintaan</label>
          <select id="ldr-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="pending">Menunggu ACC</option>
            <option value="approved">Disetujui</option>
            <option value="rejected">Ditolak</option>
            <option value="">Semua</option>
          </select>
        </div>
      </form>

      {decideError && <div className="alert alertError" role="alert">{decideError}</div>}
      {decideNotice && <div className="alert alertSuccess" role="status">{decideNotice}</div>}
      {loading && <p className="muted">Memuat...</p>}
      {error && <div className="alert alertError" role="alert">{error}</div>}
      {!loading && !error && rows && rows.length === 0 && (
        <div className="emptyState">Tidak ada permintaan hapus.</div>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Lead</th>
                <th>Origin Divisi</th>
                <th>Status Lead</th>
                <th>Alasan</th>
                <th>Pengaju</th>
                <th>Status</th>
                <th>Diputuskan</th>
                {canDecide && <th>Keputusan</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>
                    <Link href={`/leads/${r.lead_id}`}>{r.lead_id}</Link>
                    <br />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {r.lead_name} &middot; {r.phone_number}
                    </span>
                  </td>
                  <td>{r.origin_division}</td>
                  <td>
                    <StatusBadge status={r.record_status} />
                  </td>
                  <td>{r.reason}</td>
                  <td>
                    {r.requested_by_nama}
                    <br />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatDateTime(r.created_at)}
                    </span>
                  </td>
                  <td>{DELETE_STATUS_LABELS[r.status] ?? r.status}</td>
                  <td>
                    {r.resolved_at ? (
                      <>
                        {r.resolved_by_nama || '—'}
                        <br />
                        <span className="muted" style={{ fontSize: 12 }}>
                          {formatDateTime(r.resolved_at)}
                        </span>
                        {r.decision_note && (
                          <>
                            <br />
                            <span className="muted" style={{ fontSize: 12 }}>
                              &ldquo;{r.decision_note}&rdquo;
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  {canDecide && (
                    <td>
                      {r.status === 'pending' ? (
                        <div className="stack" style={{ gap: 6 }}>
                          <input
                            aria-label={`Catatan keputusan ${r.id}`}
                            placeholder="Catatan (opsional)"
                            value={notes[r.id] ?? ''}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          />
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              type="button"
                              className="btn btnPrimary btnSm"
                              disabled={decidingId !== null}
                              onClick={() => decide(r, true)}
                            >
                              {decidingId === r.id ? 'Memproses...' : 'Setujui'}
                            </button>
                            <button
                              type="button"
                              className="btn btnSecondary btnSm"
                              disabled={decidingId !== null}
                              onClick={() => decide(r, false)}
                            >
                              Tolak
                            </button>
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
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
      // source may be sent empty — only valid when a Campaign ID is set; the
      // server is the sole authority and rejects that row per-row otherwise.
      const row: BulkRow = { lead_name, phone_number, source };
      if (email) row.email = email;
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
    const row: BulkRow = {
      lead_name: singleName.trim(),
      phone_number: singlePhone.trim(),
      source: singleSource,
    };
    if (singleEmail.trim()) row.email = singleEmail.trim();
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
