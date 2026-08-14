'use client';

import { Fragment, use, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  KOL_DIVISION,
  SOURCE_POOL_OPTIONS,
  bookingBadgeTone,
  canCreateBooking,
  canManageCreatorList,
  compileCreatorList,
  createBooking,
  getBrief,
  getCreatorList,
  listBriefBookings,
  type Booking,
  type Brief,
  type CreatorList,
} from '@/lib/kol';
import StatusBadge from '@/components/StatusBadge';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

// Batch creator entry (M9 §4): one brief = one platform + one source pool + one
// coordinator; up to 20 creators per submit, each with its own rate + qty.
const BATCH_MAX = 20;

interface CreatorRow {
  key: number;
  creator_name: string;
  creator_handle: string;
  niche: string;
  agreed_rate: string; // decimal string
  qty_video: string; // integer string ("" => 0)
  qty_live: string; // integer string ("" => 0)
}

function emptyRow(key: number): CreatorRow {
  return { key, creator_name: '', creator_handle: '', niche: '', agreed_rate: '', qty_video: '', qty_live: '' };
}

/** A row with nothing typed is skipped silently at submit (not an error). */
function isRowBlank(r: CreatorRow): boolean {
  return (
    r.creator_name.trim() === '' &&
    r.creator_handle.trim() === '' &&
    r.niche.trim() === '' &&
    r.agreed_rate.trim() === '' &&
    r.qty_video.trim() === '' &&
    r.qty_live.trim() === ''
  );
}

/** Client-side validation of one intended row; returns a BI-style message or null. */
function validateRow(r: CreatorRow): string | null {
  if (r.creator_name.trim() === '') return '[nama creator wajib diisi]';
  const rate = Number(r.agreed_rate);
  if (r.agreed_rate.trim() === '' || !Number.isFinite(rate) || rate <= 0) return '[agreed rate wajib diisi & lebih dari 0]';
  for (const q of [r.qty_video, r.qty_live]) {
    if (q.trim() === '') continue;
    const n = Number(q);
    if (!Number.isInteger(n) || n < 0) return '[jumlah video/live harus bilangan bulat tidak negatif]';
  }
  return null;
}

function qtyOrUndefined(v: string): number | undefined {
  return v.trim() === '' ? undefined : Number(v);
}

export default function KolBriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  const [brief, setBrief] = useState<Brief | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Creator List (compile/refresh)
  const [creatorList, setCreatorList] = useState<CreatorList | null>(null);
  const [creatorListError, setCreatorListError] = useState<string | null>(null);
  const [clLink, setClLink] = useState('');
  const [clSubmitting, setClSubmitting] = useState(false);
  const [clSubmitError, setClSubmitError] = useState<string | null>(null);
  const [clMessage, setClMessage] = useState<string | null>(null);

  // Buat booking baru — batch entry (one platform / source pool / coordinator
  // per brief; many creators, one POST per row on a single submit).
  const [platform, setPlatform] = useState('');
  const [sourcePool, setSourcePool] = useState<string>(SOURCE_POOL_OPTIONS[0]);
  const [poolReference, setPoolReference] = useState('');
  const [assignedCoordinator, setAssignedCoordinator] = useState('');
  const [creatorRows, setCreatorRows] = useState<CreatorRow[]>(() => [emptyRow(0), emptyRow(1), emptyRow(2)]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const rowKeyCounter = useRef(3);

  // Coordinator candidates = active KOL STAFF (`kol.validateKolStaff`). Declared
  // here, above the loading early-return, because hooks must run every render.
  const {
    employees: coordCandidates,
    loading: coordLoading,
    error: coordError,
  } = useAssignableEmployees(KOL_DIVISION, LEVEL_STAFF, canCreateBooking(role));
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const b = await getBrief(id);
      setBrief(b);
      const res = await listBriefBookings(id);
      setBookings(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadCreatorList = useCallback(async () => {
    setCreatorListError(null);
    try {
      const cl = await getCreatorList(id);
      setCreatorList(cl);
    } catch (err) {
      setCreatorListError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadCreatorList();
  }, [load, loadCreatorList]);

  function updateRow(key: number, patch: Partial<CreatorRow>) {
    setCreatorRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setCreatorRows((rows) => (rows.length >= BATCH_MAX ? rows : [...rows, emptyRow(rowKeyCounter.current++)]));
  }
  function removeRow(key: number) {
    setCreatorRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)));
    setRowErrors((errs) => {
      if (!(key in errs)) return errs;
      const rest = { ...errs };
      delete rest[key];
      return rest;
    });
  }

  async function handleCreateBooking(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateMessage(null);

    if (platform.trim() === '') {
      setCreateError('[platform brief wajib diisi]');
      return;
    }
    const intended = creatorRows.filter((r) => !isRowBlank(r));
    if (intended.length === 0) {
      setCreateError('Tambahkan minimal satu creator.');
      return;
    }
    // Client-side validation first — surface every bad row at once, submit none.
    const preErrors: Record<number, string> = {};
    for (const r of intended) {
      const msg = validateRow(r);
      if (msg) preErrors[r.key] = msg;
    }
    if (Object.keys(preErrors).length > 0) {
      setRowErrors(preErrors);
      setCreateError('Perbaiki baris yang ditandai sebelum menyimpan.');
      return;
    }

    setRowErrors({});
    setCreateSubmitting(true);
    const succeeded: number[] = [];
    const failed: Record<number, string> = {};
    let okCount = 0;
    // One POST per row (no batch endpoint); the coordinator is the same for all.
    for (const r of intended) {
      try {
        await createBooking(id, {
          creator_name: r.creator_name.trim(),
          creator_handle: r.creator_handle.trim() || undefined,
          platform: platform.trim(),
          niche: r.niche.trim() || undefined,
          source_pool: sourcePool,
          pool_reference: poolReference.trim() || undefined,
          agreed_rate: r.agreed_rate.trim(),
          assigned_coordinator: assignedCoordinator || undefined,
          qty_video: qtyOrUndefined(r.qty_video),
          qty_live: qtyOrUndefined(r.qty_live),
        });
        succeeded.push(r.key);
        okCount += 1;
      } catch (err) {
        failed[r.key] = errorMessage(err);
      }
    }

    // Keep only rows that failed (with their errors) plus any untouched blank rows.
    setCreatorRows((rows) => {
      const kept = rows.filter((r) => !succeeded.includes(r.key));
      return kept.length === 0 ? [emptyRow(rowKeyCounter.current++)] : kept;
    });
    setRowErrors(failed);
    const failCount = Object.keys(failed).length;
    if (okCount > 0) {
      setCreateMessage(`${okCount} booking berhasil dibuat${failCount > 0 ? `, ${failCount} gagal — perbaiki baris yang tersisa.` : '.'}`);
    }
    if (failCount > 0 && okCount === 0) {
      setCreateError('Semua baris gagal disimpan — periksa pesan per baris.');
    }
    setCreateSubmitting(false);
    if (okCount > 0) {
      await load();
    }
  }

  async function handleCompileCreatorList(e: FormEvent) {
    e.preventDefault();
    setClSubmitError(null);
    setClMessage(null);
    setClSubmitting(true);
    try {
      const cl = await compileCreatorList(id, clLink.trim());
      setCreatorList(cl);
      setClMessage('Creator List berhasil disusun/diperbarui.');
      setClLink('');
    } catch (err) {
      setClSubmitError(errorMessage(err));
    } finally {
      setClSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !brief) {
    return (
      <div className="stack">
        <Link href="/kol" className="muted">&larr; Kembali ke KOL</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Brief tidak ditemukan.'}</div>
      </div>
    );
  }

  const canCreate = canCreateBooking(role);
  const canManageCL = canManageCreatorList(role);
  const isOtherDivision = brief.assigned_division !== KOL_DIVISION;

  const eligibleSet = new Set(creatorList?.eligible_bookings ?? []);
  const includedSet = new Set(creatorList?.included_bookings ?? []);
  const listsDiffer =
    creatorList !== null &&
    (eligibleSet.size !== includedSet.size || [...eligibleSet].some((x) => !includedSet.has(x)));
  const newEligibleCount = creatorList ? creatorList.eligible_bookings.filter((x) => !includedSet.has(x)).length : 0;

  return (
    <div className="stack">
      <div>
        <Link href="/kol" className="muted">&larr; Kembali ke KOL</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{brief.title}</h1>
          <p className="muted">{brief.id}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {brief.revision_flagged && <span className="badge badge-red">Revisi Berulang</span>}
          <StatusBadge status={brief.status} />
        </div>
      </div>

      {isOtherDivision && (
        <div className="alert alertInfo" role="status">
          Brief ini ditujukan ke divisi &ldquo;{brief.assigned_division}&rdquo;, bukan KOL. Pembuatan
          Booking kemungkinan akan ditolak server.
        </div>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Detail Brief</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Layanan</div>
            <div>{brief.service_id}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Deliverable Type</div>
            <div>{brief.deliverable_type}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>PIC Brief</div>
            <div>{brief.assigned_pic || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Prioritas</div>
            <div>{brief.priority}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Due Date</div>
            <div>{brief.due_date || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Instruksi</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{brief.instructions || '—'}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Booking ({bookings?.length ?? 0})</h2>
        </div>
        {bookings && bookings.length === 0 ? (
          <div className="emptyState">Belum ada Booking untuk Brief ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Creator</th>
                  <th>Platform</th>
                  <th>Source Pool</th>
                  <th>Agreed Rate</th>
                  <th>Video / Live</th>
                  <th>Status</th>
                  <th>Payment Status</th>
                  <th>Revisi</th>
                </tr>
              </thead>
              <tbody>
                {(bookings ?? []).map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/kol/bookings/${b.id}`}>{b.id}</Link></td>
                    <td>
                      {b.creator_name}
                      {b.creator_handle ? <span className="muted"> ({b.creator_handle})</span> : null}
                    </td>
                    <td>{b.platform}</td>
                    <td>{b.source_pool}</td>
                    <td>{b.agreed_rate_display}</td>
                    <td>{b.qty_video} / {b.qty_live}</td>
                    <td><span className={`badge badge-${bookingBadgeTone(b.status)}`}>{b.status}</span></td>
                    <td>{b.payment_status ? <StatusBadge status={b.payment_status} /> : '—'}</td>
                    <td>{b.revision_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canCreate && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Booking Baru</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Satu brief = satu <strong>Platform</strong> + satu <strong>Source Pool</strong> + satu{' '}
            <strong>Coordinator</strong> (otomatis Anda; Team Leader boleh menetapkan lain). Isi banyak
            creator sekaligus (maks {BATCH_MAX} baris) lalu simpan sekali. Urutan prioritas sourcing:
            MCN MEA Roster &rarr; KOL External Pool &rarr; Ad-hoc New (last resort).
          </p>
          <form className="form" onSubmit={handleCreateBooking}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            {createMessage && <div className="alert alertSuccess" role="status">{createMessage}</div>}

            {/* Batch-level — berlaku untuk semua baris creator di bawah. */}
            <div className="formRow">
              <div className="field">
                <label htmlFor="platform">Platform (berlaku untuk semua)</label>
                <input
                  id="platform"
                  required
                  placeholder="TikTok / Instagram / YouTube"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="source-pool">Source Pool (berlaku untuk semua)</label>
                <select id="source-pool" value={sourcePool} onChange={(e) => setSourcePool(e.target.value)}>
                  {SOURCE_POOL_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="pool-reference">Pool Reference (opsional)</label>
                <input
                  id="pool-reference"
                  placeholder="Link/ID roster acuan"
                  value={poolReference}
                  onChange={(e) => setPoolReference(e.target.value)}
                />
              </div>
              {/* Kosong = self-claim ke staff KOL yang submit; TL boleh override untuk seluruh batch. */}
              <EmployeePicker
                id="assigned-coordinator"
                label="Coordinator (kosongkan = otomatis Anda)"
                employees={coordCandidates}
                loading={coordLoading}
                error={coordError}
                value={assignedCoordinator}
                onChange={setAssignedCoordinator}
                emptyHint="Belum ada staff KOL aktif. Biarkan kosong — staff yang membuat Booking menjadi Coordinator-nya."
              />
            </div>

            {/* Per-creator rows — Nama & Agreed Rate wajib; qty & lainnya opsional. */}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '3%' }}>#</th>
                    <th>Nama Creator *</th>
                    <th>Handle</th>
                    <th>Niche</th>
                    <th style={{ width: '16%' }}>Agreed Rate (Rp) *</th>
                    <th style={{ width: '9%' }}>Qty Video</th>
                    <th style={{ width: '9%' }}>Qty Live</th>
                    <th style={{ width: '3%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {creatorRows.map((r, idx) => (
                    <Fragment key={r.key}>
                      <tr>
                        <td className="muted">{idx + 1}</td>
                        <td>
                          <input aria-label={`Nama Creator baris ${idx + 1}`} value={r.creator_name}
                            onChange={(e) => updateRow(r.key, { creator_name: e.target.value })} />
                        </td>
                        <td>
                          <input aria-label={`Handle baris ${idx + 1}`} value={r.creator_handle}
                            onChange={(e) => updateRow(r.key, { creator_handle: e.target.value })} />
                        </td>
                        <td>
                          <input aria-label={`Niche baris ${idx + 1}`} value={r.niche}
                            onChange={(e) => updateRow(r.key, { niche: e.target.value })} />
                        </td>
                        <td>
                          <input aria-label={`Agreed Rate baris ${idx + 1}`} type="number" min="0" step="0.01"
                            value={r.agreed_rate} onChange={(e) => updateRow(r.key, { agreed_rate: e.target.value })} />
                        </td>
                        <td>
                          <input aria-label={`Qty Video baris ${idx + 1}`} type="number" min="0" step="1"
                            value={r.qty_video} onChange={(e) => updateRow(r.key, { qty_video: e.target.value })} />
                        </td>
                        <td>
                          <input aria-label={`Qty Live baris ${idx + 1}`} type="number" min="0" step="1"
                            value={r.qty_live} onChange={(e) => updateRow(r.key, { qty_live: e.target.value })} />
                        </td>
                        <td>
                          <button type="button" className="btn btnSecondary btnSm" aria-label={`Hapus baris ${idx + 1}`}
                            onClick={() => removeRow(r.key)} disabled={creatorRows.length <= 1}>✕</button>
                        </td>
                      </tr>
                      {rowErrors[r.key] && (
                        <tr>
                          <td></td>
                          <td colSpan={7} style={{ color: 'var(--color-danger, #c0392b)', fontSize: 12 }}>
                            {rowErrors[r.key]}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <button type="button" className="btn btnSecondary btnSm" onClick={addRow} disabled={creatorRows.length >= BATCH_MAX}>
                + Tambah Baris ({creatorRows.length}/{BATCH_MAX})
              </button>
              <button type="submit" className="btn btnPrimary" disabled={createSubmitting}>
                {createSubmitting ? 'Menyimpan...' : 'Buat Booking'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Compiled Creator List</h2>
        </div>
        {creatorListError && <div className="alert alertError" role="alert">{creatorListError}</div>}
        {creatorList && (
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Link Creator List</div>
              <div>
                {creatorList.creator_list_link ? (
                  <a href={creatorList.creator_list_link} target="_blank" rel="noreferrer">Lihat</a>
                ) : (
                  '—'
                )}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Terakhir Disusun</div>
              <div>{formatDateTime(creatorList.last_compiled)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Booking Tersimpan (snapshot) &middot; <span title="Snapshot saat compile terakhir">🔒 read-only</span>
              </div>
              <div>{creatorList.included_bookings.length === 0 ? '—' : creatorList.included_bookings.join(', ')}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Booking Eligible Saat Ini ([QC Passed]) &middot;{' '}
                <span title="Computed live dari status booking saat ini">🔒 read-only</span>
              </div>
              <div>{creatorList.eligible_bookings.length === 0 ? '—' : creatorList.eligible_bookings.join(', ')}</div>
            </div>
          </div>
        )}
        {listsDiffer && (
          <div className="alert alertInfo" role="status" style={{ marginTop: 12 }}>
            {newEligibleCount} booking baru eligible sejak compile terakhir &mdash; susun ulang Creator
            List untuk memperbarui snapshot.
          </div>
        )}

        {canManageCL && (
          <form className="form" onSubmit={handleCompileCreatorList} style={{ marginTop: 12 }}>
            {clSubmitError && <div className="alert alertError" role="alert">{clSubmitError}</div>}
            {clMessage && <div className="alert alertSuccess" role="status">{clMessage}</div>}
            <div className="field">
              <label htmlFor="cl-link">Link Creator List (Google Drive)</label>
              <input
                id="cl-link"
                required
                placeholder="https://drive.google.com/..."
                value={clLink}
                onChange={(e) => setClLink(e.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={clSubmitting}>
                {clSubmitting ? 'Menyimpan...' : 'Susun / Perbarui Creator List'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
