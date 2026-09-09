'use client';

/**
 * Rekap SMO &amp; Content Strategist per PIC (M19 Gap G).
 *
 * ⚠️ ANGKA DI SINI BUKAN KPI. Ia tidak masuk Modul 14 dan tidak punya bobot,
 * sama seperti penyelesaian hari-sama (D5) dan Penugasan Internal. Halaman ini
 * menyatakannya di layar dengan sengaja: angka per-orang tanpa label akan
 * dipakai seperti nilai kinerja.
 *
 * Kolom standing dipisah dari deliverable, dan itu inti Gap G: menjumlahkan
 * keduanya memberi satu angka &ldquo;produktivitas&rdquo; yang naik hanya karena
 * seseorang mencatat pekerjaan harian yang memang selalu ada.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { geserHari, hariIniWib } from '@/lib/dailyops';
import { getSummary, type ScsPicSummary } from '@/lib/scs';

export default function ScsRekapPage() {
  const [dari, setDari] = useState(geserHari(hariIniWib(), -30));
  const [sampai, setSampai] = useState(hariIniWib());
  const [rows, setRows] = useState<ScsPicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSummary(dari, sampai);
      setRows(res.rekap);
    } catch (err) {
      setError(errorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dari, sampai]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="stack">
      <div>
        <Link href="/creative/scs" className="muted">&larr; Kembali ke Antrean</Link>
      </div>

      <div>
        <h1>Rekap SMO &amp; Content Strategist</h1>
        <div className="alert" role="note" style={{ background: '#f4f6f8' }}>
          <strong>Angka ini bukan KPI.</strong> Ia tidak masuk Modul 14 (Team Performance) dan
          tidak punya bobot penilaian. Gunanya operasional: melihat berapa banyak yang
          diselesaikan pada satu periode.{' '}
          <strong>Baris standing dihitung terpisah</strong> &mdash; pekerjaan harian yang berulang
          bukan deliverable, dan menjumlahkannya dengan deliverable memberi angka yang naik
          hanya karena seseorang mencatat pekerjaan yang memang selalu ada.
        </div>
      </div>

      <section className="card">
        <div className="formRow">
          <div className="field">
            <label htmlFor="dari">Dari (WIB)</label>
            <input id="dari" type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sampai">Sampai (WIB)</label>
            <input id="sampai" type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
        </div>
      </section>

      {error && <div className="alert alertError" role="alert">{error}</div>}

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {!loading && !error && (
          rows.length === 0 ? (
            <div className="emptyState">Tidak ada baris pada rentang ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>PIC</th>
                    <th>Deliverable selesai</th>
                    <th>Σ target deliverable</th>
                    <th>Standing selesai</th>
                    <th>Belum selesai</th>
                    <th>Total baris</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employee_id}>
                      <td>{r.nama || r.employee_id}</td>
                      <td>{r.deliverable_selesai}</td>
                      <td>{r.deliverable_qty}</td>
                      <td>{r.standing_selesai}</td>
                      <td>{r.belum_selesai}</td>
                      <td>{r.total_baris}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>
    </div>
  );
}
