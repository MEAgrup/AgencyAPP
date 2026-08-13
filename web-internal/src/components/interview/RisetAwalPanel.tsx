'use client';

/**
 * Langkah 1 "Kelola Klien" — **Riset Awal** (owner QA 2026-08-12).
 *
 * The AM logs into the client's store and records the baseline. This panel is
 * the measurement half of that step, which is all of part 1: when it started,
 * when it was submitted, and how long it took.
 *
 * Two things are deliberately absent:
 *
 *  - **A "mulai" button.** The clock starts when Kelola Klien is opened — the
 *    server stamps it with the interview. A start the AM has to press is a start
 *    that can be pressed late, and the whole point of this step is a timeline
 *    that cannot quietly slip.
 *  - **A duration field.** The elapsed figure here is derived from the two
 *    anchors (the running counter locally, the final one server-side by the same
 *    rule). Nothing on this page can type a duration.
 *
 * The isian (fields carried over from the interview question list) is part 2 and
 * is not built yet; the panel says so rather than showing an empty form.
 */

import { useEffect, useState } from 'react';
import {
  RISET_AWAL_STATUS,
  formatDurasiMenit,
  menitBerjalanSejak,
  risetAwalStatusTone,
  type InterviewRisetAwal,
} from '@/lib/interview';

/** How often the running counter re-renders. Minute precision needs no faster. */
const TICK_MS = 30_000;

function waktu(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('id-ID');
}

export default function RisetAwalPanel({
  risetAwal,
  canWrite,
  busy,
  onSubmit,
}: {
  risetAwal: InterviewRisetAwal | null;
  canWrite: boolean;
  busy: boolean;
  onSubmit: () => void;
}) {
  // Re-render on a timer so the running duration stays honest without the AM
  // reloading. Only mounted while the step is running.
  const running = risetAwal?.status === RISET_AWAL_STATUS.Berjalan;
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!running) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, [running]);

  if (!risetAwal) {
    return (
      <section className="card">
        <div className="cardHeader">Langkah 1 · Riset Awal</div>
        <p className="muted" style={{ fontSize: 13 }}>
          Riset awal belum tercatat untuk interview ini.
        </p>
      </section>
    );
  }

  const selesai = risetAwal.status === RISET_AWAL_STATUS.Selesai;
  // While running the counter is computed against `now`; before the first tick
  // lands (SSR/first paint) it stays `—` rather than rendering a stale figure.
  const menit = selesai ? risetAwal.durasi_menit : now ? menitBerjalanSejak(risetAwal.dimulai_pada, now) : null;

  return (
    <section className="card">
      <div className="cardHeader">
        <span>Langkah 1 · Riset Awal</span>
        <span className={`badge badge-${risetAwalStatusTone(risetAwal.status)}`}>{risetAwal.status}</span>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Login ke toko klien dan catat seluruh data baseline. Waktu mulai tercatat otomatis saat halaman Kelola
        Klien dibuka — tekan <strong>Submit riset awal</strong> begitu pencatatan selesai.
      </p>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Dimulai</label>
          <div>
            {waktu(risetAwal.dimulai_pada)}{' '}
            <span className="muted" style={{ fontSize: 12 }}>
              oleh {risetAwal.dimulai_oleh}
            </span>
          </div>
        </div>
        <div className="field">
          <label>Disubmit</label>
          <div>
            {waktu(risetAwal.disubmit_pada)}{' '}
            {risetAwal.disubmit_oleh && (
              <span className="muted" style={{ fontSize: 12 }}>
                oleh {risetAwal.disubmit_oleh}
              </span>
            )}
          </div>
        </div>
        <div className="field">
          <label>{selesai ? 'Lama pengerjaan' : 'Sudah berjalan'}</label>
          <div style={{ fontWeight: 600 }}>{formatDurasiMenit(menit)}</div>
        </div>
      </div>

      {selesai ? (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Waktu mulai & submit terkunci — durasi dihitung dari keduanya, tidak pernah diketik.
        </p>
      ) : (
        canWrite && (
          <div className="row" style={{ marginTop: 12, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btnPrimary btnSm"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Submit riset awal? Waktu selesai dicatat sekarang dan tidak bisa diubah.')) {
                  onSubmit();
                }
              }}
            >
              Submit riset awal
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              Sekali submit, waktu selesai terkunci.
            </span>
          </div>
        )
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
        Kolom isian riset awal (sebagian dipindah dari daftar pertanyaan Interview) menyusul di langkah 2.
      </p>
    </section>
  );
}
