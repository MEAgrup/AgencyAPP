'use client';

/**
 * The "Kelola Klien" timeline — three steps, each measured against the owner's
 * SLA (2026-08-13): Riset Awal 2–3, Interview Meeting 1–2, Brand Strategy 5–7
 * working days.
 *
 * It sits above the tabs rather than inside one because it is the answer to a
 * question about the WHOLE session ("apakah timeline terlewat?"), and an AM
 * working on step 2 still needs to see that step 3's clock is about to start.
 *
 * Every number and every verdict here is computed server-side — working days
 * exclude weekends and the `hari_libur` calendar, which lives in a table this
 * page has no copy of. The component only renders.
 */

import {
  SLA_STATUS,
  SLA_STATUS_LABEL,
  formatAmbang,
  formatHariKerja,
  slaStatusTone,
  type KelolaKlienTimeline,
  type TimelineStep,
} from '@/lib/interview';

function waktu(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('id-ID');
}

/** What the elapsed figure MEANS for this step, so a number is never bare. */
function keterangan(step: TimelineStep): string {
  if (step.status === SLA_STATUS.TidakBerlaku) return 'Layanan ini tidak butuh strategi (plan gate).';
  if (step.status === SLA_STATUS.BelumMulai) return 'Menunggu langkah sebelumnya selesai.';
  return step.selesai ? 'Selesai' : 'Masih berjalan';
}

export default function TimelinePanel({ timeline }: { timeline: KelolaKlienTimeline | null }) {
  if (!timeline) return null;

  const terlambat = timeline.langkah.filter((s) => s.status === SLA_STATUS.Terlambat);

  return (
    <section className="card">
      <div className="cardHeader">
        <span>Timeline Kelola Klien</span>
        {terlambat.length > 0 && (
          <span className="badge badge-red">
            {terlambat.length} langkah terlambat
          </span>
        )}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Langkah</th>
              <th>Target</th>
              <th>Terpakai</th>
              <th>Status</th>
              <th>Mulai</th>
              <th>Selesai</th>
            </tr>
          </thead>
          <tbody>
            {timeline.langkah.map((s) => (
              <tr key={s.langkah}>
                <td>
                  <strong>
                    {s.langkah}. {s.nama}
                  </strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {keterangan(s)}
                  </div>
                </td>
                <td>{formatAmbang(s.target_hari, s.batas_hari)}</td>
                <td>{s.status === SLA_STATUS.TidakBerlaku ? '—' : formatHariKerja(s.hari_kerja)}</td>
                <td>
                  <span className={`badge badge-${slaStatusTone(s.status)}`}>
                    {SLA_STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </td>
                <td>{waktu(s.mulai_pada)}</td>
                <td>{waktu(s.selesai_pada)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
        Hari kerja = Senin–Jumat, di luar hari libur nasional yang terdaftar. Angka target diambil dari
        konfigurasi SLA v{timeline.config_version} — bukan ditulis di kode.
      </p>
    </section>
  );
}
