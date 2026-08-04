'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  CREATIVE_DIVISION,
  createAsset,
  getBrief,
  isCreativeDivision,
  isDirector,
  isODOnly,
  listBriefAssets,
  type Asset,
  type Brief,
} from '@/lib/creative';
import StatusBadge from '@/components/StatusBadge';

export default function CreativeBriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  const [brief, setBrief] = useState<Brief | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fan-out: buat Asset baru
  const [sequenceNo, setSequenceNo] = useState('');
  const [assignedPic, setAssignedPic] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const b = await getBrief(id);
      setBrief(b);
      const res = await listBriefAssets(id);
      setAssets(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const canCreateAsset = !isODOnly(role) && (isCreativeDivision(role) || isDirector(role));

  // Asset PIC candidates = active Creative STAFF (`creative.validateCreativeStaff`).
  // Declared above the loading early-return: hooks must run on every render.
  const {
    employees: picCandidates,
    loading: picLoading,
    error: picError,
  } = useAssignableEmployees(CREATIVE_DIVISION, LEVEL_STAFF, canCreateAsset);

  async function handleCreateAsset(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateMessage(null);
    setCreateSubmitting(true);
    try {
      const seq = Number(sequenceNo);
      const asset = await createAsset(id, {
        sequence_no: seq,
        assigned_pic: assignedPic || undefined,
      });
      setCreateMessage(`Asset ${asset.id} berhasil dibuat (urutan #${asset.sequence_no}).`);
      setSequenceNo('');
      setAssignedPic('');
      await load();
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreateSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !brief) {
    return (
      <div className="stack">
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Brief tidak ditemukan.'}</div>
      </div>
    );
  }

  const isOtherDivision = brief.assigned_division !== CREATIVE_DIVISION;
  const createdCount = assets?.length ?? 0;

  return (
    <div className="stack">
      <div>
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
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
          Brief ini ditujukan ke divisi &ldquo;{brief.assigned_division}&rdquo;, bukan Creative. Pembuatan
          Asset kemungkinan akan ditolak server.
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
            <div className="muted" style={{ fontSize: 12 }}>
              Progress Asset &middot; <span title="Dibanding quantity_target Brief">🔒 read-only</span>
            </div>
            <div>{createdCount} dari {brief.quantity_target} dibuat</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Instruksi</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{brief.instructions || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Referensi / Lampiran</div>
            <div>
              {brief.reference_attachments ? (
                <a href={brief.reference_attachments} target="_blank" rel="noreferrer">Lihat</a>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Asset ({createdCount}/{brief.quantity_target})</h2>
        </div>
        {assets && assets.length === 0 ? (
          <div className="emptyState">Belum ada Asset dibuat untuk Brief ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Urutan</th>
                  <th>Tipe</th>
                  <th>PIC</th>
                  <th>Status</th>
                  <th>Revisi</th>
                </tr>
              </thead>
              <tbody>
                {(assets ?? []).map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/creative/assets/${a.id}`}>{a.id}</Link></td>
                    <td>{a.sequence_no}</td>
                    <td>{a.asset_type || '—'}</td>
                    <td>{a.assigned_pic || '—'}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td>
                      {a.revision_count}
                      {a.revision_flagged && (
                        <span className="badge badge-purple" style={{ marginLeft: 6 }}>Quality Flag</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canCreateAsset && (
        <section className="card">
          <div className="cardHeader">
            <h2>Fan-out Asset Baru</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Kosongkan PIC untuk self-claim (staff Creative). Lead boleh menetapkan PIC eksplisit.
          </p>
          <form className="form" onSubmit={handleCreateAsset}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            {createMessage && <div className="alert alertSuccess" role="status">{createMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="asset-sequence">Nomor Urut (1 s/d {brief.quantity_target})</label>
                <input
                  id="asset-sequence"
                  type="number"
                  min="1"
                  max={brief.quantity_target}
                  required
                  value={sequenceNo}
                  onChange={(e) => setSequenceNo(e.target.value)}
                />
              </div>
              {/* Left empty by a Creative staffer = self-claim (§4 Flow 1), which
                  is why this stays optional and the hint says so. */}
              <EmployeePicker
                id="asset-pic"
                label="PIC (kosongkan untuk self-claim)"
                employees={picCandidates}
                loading={picLoading}
                error={picError}
                value={assignedPic}
                onChange={setAssignedPic}
                emptyHint="Belum ada staff Creative aktif. Biarkan kosong — staff yang membuat Asset otomatis menjadi PIC-nya."
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={createSubmitting}>
                {createSubmitting ? 'Menyimpan...' : 'Buat Asset'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
