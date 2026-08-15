'use client';

/**
 * One Penugasan Internal: what it is, whether it was late, and the two actions
 * that exist — the PIC works it, the atasan withdraws it.
 *
 * The lateness banner is rendered from the server's derived fields verbatim. It
 * stays visible after completion on purpose: a task finished late reads late
 * forever, because that is the record the discipline report counts.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  batalPenugasan,
  getPenugasan,
  isTerminal,
  labelKeterlambatan,
  mulaiPenugasan,
  selesaiPenugasan,
  type Penugasan,
} from '@/lib/penugasan';

export default function PenugasanDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { role, employee } = useAuth();

  const [task, setTask] = useState<Penugasan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [linkHasil, setLinkHasil] = useState('');
  const [alasan, setAlasan] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setTask(await getPenugasan(id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<Penugasan>) {
    setActionError(null);
    setBusy(true);
    try {
      setTask(await fn());
      setLinkHasil('');
      setAlasan('');
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="stack"><Link href="/penugasan" className="muted">&larr; Kembali</Link><p className="muted">Memuat...</p></div>;
  }
  if (error || !task) {
    return (
      <div className="stack">
        <Link href="/penugasan" className="muted">&larr; Kembali ke Penugasan</Link>
        <div className="alert alertError" role="alert">{error ?? 'Penugasan tidak ditemukan.'}</div>
      </div>
    );
  }

  const me = employee?.employee_id ?? '';
  // Mirrors `internaltask.canWork` / `canCancel`. The server is the authority;
  // these only decide which controls to draw.
  const isPic = me === task.assignee_id;
  const canCancel =
    Boolean(role?.director)
    || (!role?.od && (me === task.created_by
      || (role?.level === 'lead' && role?.division === task.assignee_division)));

  const terminal = isTerminal(task);
  const late = labelKeterlambatan(task);

  return (
    <div className="stack">
      <Link href="/penugasan" className="muted">&larr; Kembali ke Penugasan</Link>

      <div>
        <h1>{task.judul}</h1>
        <p className="muted">{task.id} &middot; <StatusBadge status={task.status} /></p>
      </div>

      {late !== '' && (
        <div className={`alert ${task.selesai_terlambat ? 'alertWarning' : 'alertError'}`} role="status">
          {task.selesai_terlambat
            ? `Diselesaikan terlambat ${task.hari_terlambat} hari dari jatuh tempo ${task.due_date}. Tercatat permanen.`
            : `Terlambat ${task.hari_terlambat} hari — jatuh tempo ${task.due_date} sudah lewat dan tugas belum selesai.`}
        </div>
      )}

      <section className="card">
        <div className="cardHeader"><h2>Detail</h2></div>
        <div className="formRow">
          <div><div className="muted" style={{ fontSize: 12 }}>Ditugaskan Kepada</div><div>{task.assignee_id}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Divisi</div><div>{task.assignee_division}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Diberikan Oleh</div><div>{task.created_by}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Jatuh Tempo</div><div>{task.due_date}</div></div>
        </div>

        {task.deskripsi && (
          <>
            <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>Deskripsi / Instruksi</div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{task.deskripsi}</p>
          </>
        )}

        <div className="formRow" style={{ marginTop: 14 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Lampiran dari Pemberi Tugas</div>
            <div>
              {task.lampiran_link
                ? <a href={task.lampiran_link} target="_blank" rel="noreferrer">Buka Lampiran</a>
                : '—'}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Link Hasil Kerja</div>
            <div>
              {task.link_hasil
                ? <a href={task.link_hasil} target="_blank" rel="noreferrer">Buka Hasil</a>
                : '—'}
            </div>
          </div>
        </div>

        <div className="formRow" style={{ marginTop: 14 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Mulai Dikerjakan</div>
            <div>{task.dimulai_pada ? new Date(task.dimulai_pada).toLocaleString('id-ID') : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Diselesaikan</div>
            <div>{task.selesai_pada ? new Date(task.selesai_pada).toLocaleString('id-ID') : '—'}</div>
          </div>
        </div>

        {task.status === '[Dibatalkan]' && (
          <div style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>Alasan Pembatalan</div>
            <div>{task.alasan_pembatalan || '—'}</div>
          </div>
        )}
      </section>

      {!terminal && (isPic || canCancel) && (
        <section className="card">
          <div className="cardHeader"><h2>Aksi</h2></div>
          {actionError && <div className="alert alertError" role="alert">{actionError}</div>}

          {isPic && task.status === '[Ditugaskan]' && (
            <div>
              <button
                type="button"
                className="btn btnPrimary"
                disabled={busy}
                onClick={() => run(() => mulaiPenugasan(task.id))}
              >
                {busy ? 'Memproses...' : 'Mulai Kerjakan'}
              </button>
            </div>
          )}

          {isPic && task.status === '[Dikerjakan]' && (
            <div className="form">
              <div className="field">
                <label htmlFor="a-link">Link Hasil Kerja (wajib)</label>
                <input
                  id="a-link"
                  value={linkHasil}
                  onChange={(e) => setLinkHasil(e.target.value)}
                  placeholder="https://drive.google.com/..."
                />
                <p className="muted" style={{ fontSize: 12 }}>
                  Tidak bisa diganti setelah tugas ditandai selesai.
                </p>
              </div>
              <div>
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={busy || linkHasil.trim() === ''}
                  onClick={() => run(() => selesaiPenugasan(task.id, linkHasil.trim()))}
                >
                  {busy ? 'Memproses...' : 'Tandai Selesai'}
                </button>
              </div>
            </div>
          )}

          {isPic && (
            <p className="muted" style={{ fontSize: 12 }}>
              Anda tidak bisa membatalkan tugas sendiri &mdash; hanya pemberi tugas atau atasan divisi.
            </p>
          )}

          {canCancel && (
            <div className="form" style={{ marginTop: 14 }}>
              <div className="field">
                <label htmlFor="a-alasan">Batalkan Penugasan &mdash; alasan (wajib)</label>
                <input
                  id="a-alasan"
                  value={alasan}
                  onChange={(e) => setAlasan(e.target.value)}
                  placeholder="mis. prioritas berubah"
                />
              </div>
              <div>
                <button
                  type="button"
                  className="btn btnDanger"
                  disabled={busy || alasan.trim() === ''}
                  onClick={() => run(() => batalPenugasan(task.id, alasan.trim()))}
                >
                  {busy ? 'Memproses...' : 'Batalkan Penugasan'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
