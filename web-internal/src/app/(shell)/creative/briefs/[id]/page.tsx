'use client';

import { Fragment, use, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  CREATIVE_DIVISION,
  createAssetBatch,
  getBrief,
  isCreativeDivision,
  isDirector,
  isODOnly,
  listBriefAssets,
  type Asset,
  type Brief,
} from '@/lib/creative';
import StatusBadge from '@/components/StatusBadge';

/**
 * "Assign Team untuk Creative Production" — the Brief breakdown of M7 §3 Rule 4 as
 * the work is actually handed out: one line per PIC saying how many units of the
 * Brief they take ("10 video ke Rian, 10 ke Dita", or all 30 to one person). The
 * Sequence # is not asked for: it is the position within the Brief's
 * Quantity/Target (§9.3), allocated server-side from the free slots, because
 * whoever hands out 10 videos is not choosing WHICH ten.
 *
 * PIC per line stays a human choice by the Team Leader (owner 2026-08-14);
 * M7-OA-1's auto-assign by availability/workload is not built.
 */
const ASSIGN_MAX_ROWS = 10;

interface AssignRow {
  key: number;
  assigned_pic: string;
  quantity: string; // integer string ("" => baris dilewati)
}

function emptyAssignRow(key: number): AssignRow {
  return { key, assigned_pic: '', quantity: '' };
}

export default function CreativeBriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  const [brief, setBrief] = useState<Brief | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Assign team: sejumlah unit Brief ke tiap PIC (satu submit, satu transaksi)
  const [assignRows, setAssignRows] = useState<AssignRow[]>(() => [emptyAssignRow(0), emptyAssignRow(1)]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const rowKeyCounter = useRef(2);
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

  function updateRow(key: number, patch: Partial<AssignRow>) {
    setAssignRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setAssignRows((rows) =>
      rows.length >= ASSIGN_MAX_ROWS ? rows : [...rows, emptyAssignRow(rowKeyCounter.current++)],
    );
  }

  function removeRow(key: number) {
    setAssignRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)));
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleCreateAssets(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateMessage(null);
    setRowErrors({});

    // Baris yang benar-benar kosong dilewati tanpa error (pola batch M9).
    const intended = assignRows.filter((r) => !(r.quantity.trim() === '' && r.assigned_pic === ''));
    if (intended.length === 0) {
      setCreateError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    const errors: Record<number, string> = {};
    for (const r of intended) {
      const qty = Number(r.quantity);
      if (r.quantity.trim() === '' || !Number.isInteger(qty) || qty <= 0) {
        errors[r.key] = '[jumlah aset yang di-assign harus lebih dari 0]';
      }
    }
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors);
      setCreateError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }

    setCreateSubmitting(true);
    try {
      // Satu POST untuk seluruh batch: Sequence # dialokasikan server-side dan
      // seluruh batch gagal bersama kalau melebihi sisa target Brief.
      const res = await createAssetBatch(
        id,
        intended.map((r) => ({
          assigned_pic: r.assigned_pic || undefined,
          quantity: Number(r.quantity),
        })),
      );
      const created = res.data;
      setCreateMessage(
        `${created.length} Asset dibuat (${created[0]?.id ?? '—'}${created.length > 1 ? ` s/d ${created[created.length - 1].id}` : ''}).`,
      );
      setAssignRows([emptyAssignRow(rowKeyCounter.current++), emptyAssignRow(rowKeyCounter.current++)]);
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
  // Advisory only — the server re-derives both under the Brief's row lock and
  // rejects an overrun batch wholesale (§9.3 Sequence # unique per Brief).
  const remainingSlots = Math.max(0, brief.quantity_target - createdCount);
  const plannedTotal = assignRows.reduce((sum, r) => {
    const n = Number(r.quantity);
    return sum + (Number.isInteger(n) && n > 0 ? n : 0);
  }, 0);

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
            <h2>Assign Team untuk Creative Production</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Tentukan <strong>berapa unit</strong> yang dikerjakan tiap orang — mis. 10 video ke A, 10 ke
            B, atau seluruhnya ke satu orang. Nomor urut Asset ditetapkan otomatis dari slot yang masih
            kosong (bukan diisi manual). Kosongkan PIC untuk self-claim (staff Creative) atau untuk
            melempar ke queue umum Creative (Lead). Sisa slot Brief:{' '}
            <strong>{remainingSlots}</strong> dari {brief.quantity_target}.
          </p>
          <form className="form" onSubmit={handleCreateAssets}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            {createMessage && <div className="alert alertSuccess" role="status">{createMessage}</div>}

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '4%' }}>#</th>
                    <th>PIC (kosongkan untuk self-claim)</th>
                    <th style={{ width: '22%' }}>Jumlah Asset *</th>
                    <th style={{ width: '4%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {assignRows.map((r, idx) => (
                    <Fragment key={r.key}>
                      <tr>
                        <td className="muted">{idx + 1}</td>
                        <td>
                          <EmployeePicker
                            id={`asset-pic-${r.key}`}
                            label={`PIC baris ${idx + 1}`}
                            employees={picCandidates}
                            loading={picLoading}
                            error={picError}
                            value={r.assigned_pic}
                            onChange={(v) => updateRow(r.key, { assigned_pic: v })}
                            emptyHint="Belum ada staff Creative aktif. Biarkan kosong — staff yang membuat Asset otomatis menjadi PIC-nya."
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Jumlah Asset baris ${idx + 1}`}
                            type="number"
                            min="1"
                            step="1"
                            max={remainingSlots}
                            value={r.quantity}
                            onChange={(e) => updateRow(r.key, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btnSecondary btnSm"
                            aria-label={`Hapus baris ${idx + 1}`}
                            onClick={() => removeRow(r.key)}
                            disabled={assignRows.length <= 1}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                      {rowErrors[r.key] && (
                        <tr>
                          <td></td>
                          <td colSpan={3} style={{ color: 'var(--color-danger, #c0392b)', fontSize: 12 }}>
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
              <button
                type="button"
                className="btn btnSecondary btnSm"
                onClick={addRow}
                disabled={assignRows.length >= ASSIGN_MAX_ROWS}
              >
                + Tambah PIC ({assignRows.length}/{ASSIGN_MAX_ROWS})
              </button>
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  Total di-assign: <strong>{plannedTotal}</strong>
                  {plannedTotal > remainingSlots && ' — melebihi sisa slot'}
                </span>
                <button type="submit" className="btn btnPrimary" disabled={createSubmitting || remainingSlots === 0}>
                  {createSubmitting ? 'Menyimpan...' : 'Assign & Buat Asset'}
                </button>
              </div>
            </div>
            {remainingSlots === 0 && (
              <p className="muted" style={{ fontSize: 12 }}>
                Semua {brief.quantity_target} unit Brief ini sudah dibuat sebagai Asset.
              </p>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
