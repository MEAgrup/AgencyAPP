'use client';

/**
 * Prasyarat (client prerequisite) controls (langkah 7 §7 + owner decision
 * 2026-08-11 bagian 2).
 *
 * Shows the current `prasyarat_status`, the "tandai prasyarat selesai" action
 * (POST /interview/{id}/prasyarat — advisory, never touches the verdict), and an
 * ADVISORY overdue hint. The authoritative overdue flag and completion duration
 * live in `interview_flag`, which no route serves yet; rather than invent them,
 * this derives the "menggantung/terlambat" hint from data we DO have —
 * `prasyarat_status` plus `dihitung_pada` — using the SAME ≥ 7-day threshold the
 * daily flag uses (`prasyarat_bersyarat_terlambat`, no upper bound). It is clearly
 * labelled as a derived hint, not the stored flag.
 */

import { PRASYARAT_LABELS, type InterviewKualifikasi } from '@/lib/interview';

/** Mirrors the daily flag threshold in the migration (>= 7 days, persistent). */
const AMBANG_TERLAMBAT_HARI = 7;

function hariSejak(iso: string): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.floor((Date.now() - then) / 86_400_000);
}

export default function PrasyaratPanel({
  kualifikasi,
  canWrite,
  busy,
  onResolve,
}: {
  kualifikasi: InterviewKualifikasi | null;
  canWrite: boolean;
  busy: boolean;
  onResolve: () => void;
}) {
  if (!kualifikasi) {
    return (
      <div className="card">
        <div className="cardHeader" style={{ marginBottom: 8 }}>
          Prasyarat Klien
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Belum ada skoring — prasyarat muncul setelah kualifikasi dihitung.
        </p>
      </div>
    );
  }

  const status = kualifikasi.prasyarat_status;
  const selesai = status === 'selesai';
  const hari = hariSejak(kualifikasi.dihitung_pada);
  const terlambat = !selesai && hari >= AMBANG_TERLAMBAT_HARI;
  const tone = selesai ? 'green' : terlambat ? 'red' : 'amber';

  return (
    <div className="card">
      <div className="cardHeader" style={{ marginBottom: 8 }}>
        Prasyarat Klien
        <span className={`badge badge-${tone}`}>{PRASYARAT_LABELS[status] ?? status}</span>
      </div>

      {selesai ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Prasyarat sudah ditandai selesai. Flag harian & eskalasi berhenti.
        </p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 13 }}>
            {hari} hari sejak skoring.{' '}
            {terlambat && (
              <span style={{ color: 'var(--color-danger)' }}>
                Melewati {AMBANG_TERLAMBAT_HARI} hari — kandidat flag <code>bersyarat terlambat</code> (indikatif).
              </span>
            )}
          </p>
          {canWrite && (
            <button type="button" className="btn btnPrimary btnSm" disabled={busy} onClick={onResolve}>
              Tandai prasyarat selesai
            </button>
          )}
        </div>
      )}
    </div>
  );
}
