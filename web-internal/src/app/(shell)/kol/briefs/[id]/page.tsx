'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
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

  // Buat booking baru
  const [creatorName, setCreatorName] = useState('');
  const [creatorHandle, setCreatorHandle] = useState('');
  const [platform, setPlatform] = useState('');
  const [niche, setNiche] = useState('');
  const [sourcePool, setSourcePool] = useState<string>(SOURCE_POOL_OPTIONS[0]);
  const [poolReference, setPoolReference] = useState('');
  const [agreedRate, setAgreedRate] = useState('');
  const [assignedCoordinator, setAssignedCoordinator] = useState('');

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

  async function handleCreateBooking(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateMessage(null);
    setCreateSubmitting(true);
    try {
      const booking = await createBooking(id, {
        creator_name: creatorName,
        creator_handle: creatorHandle.trim() || undefined,
        platform,
        niche: niche.trim() || undefined,
        source_pool: sourcePool,
        pool_reference: poolReference.trim() || undefined,
        agreed_rate: agreedRate,
        assigned_coordinator: assignedCoordinator || undefined,
      });
      setCreateMessage(`Booking ${booking.id} berhasil dibuat untuk ${booking.creator_name}.`);
      setCreatorName('');
      setCreatorHandle('');
      setPlatform('');
      setNiche('');
      setPoolReference('');
      setAgreedRate('');
      setAssignedCoordinator('');
      await load();
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreateSubmitting(false);
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
            Kosongkan Coordinator untuk self-claim (staff KOL). Team Leader boleh menetapkan
            Coordinator eksplisit. Urutan prioritas sourcing: MCN MEA Roster &rarr; KOL External Pool
            &rarr; Ad-hoc New (last resort).
          </p>
          <form className="form" onSubmit={handleCreateBooking}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            {createMessage && <div className="alert alertSuccess" role="status">{createMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="creator-name">Nama Creator</label>
                <input id="creator-name" required value={creatorName} onChange={(e) => setCreatorName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="creator-handle">Handle (opsional)</label>
                <input id="creator-handle" value={creatorHandle} onChange={(e) => setCreatorHandle(e.target.value)} />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="platform">Platform</label>
                <input
                  id="platform"
                  required
                  placeholder="TikTok / Instagram / YouTube"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="niche">Niche (opsional)</label>
                <input id="niche" value={niche} onChange={(e) => setNiche(e.target.value)} />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="source-pool">Source Pool</label>
                <select id="source-pool" value={sourcePool} onChange={(e) => setSourcePool(e.target.value)}>
                  {SOURCE_POOL_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pool-reference">Pool Reference</label>
                <input
                  id="pool-reference"
                  placeholder="Link/ID roster acuan"
                  value={poolReference}
                  onChange={(e) => setPoolReference(e.target.value)}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="agreed-rate">Agreed Rate (Rp)</label>
                <input
                  id="agreed-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={agreedRate}
                  onChange={(e) => setAgreedRate(e.target.value)}
                />
              </div>
              {/* Left empty by a KOL staffer = self-claim, so this stays optional. */}
              <EmployeePicker
                id="assigned-coordinator"
                label="Coordinator (kosongkan untuk self-claim)"
                employees={coordCandidates}
                loading={coordLoading}
                error={coordError}
                value={assignedCoordinator}
                onChange={setAssignedCoordinator}
                emptyHint="Belum ada staff KOL aktif. Biarkan kosong — staff yang membuat Booking menjadi Coordinator-nya."
              />
            </div>
            <div>
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
