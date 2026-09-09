'use client';

/**
 * Rekap Penyelesaian Hari-Sama (M19 Gap F / D5) — dashboard OPERASIONAL Leader.
 *
 * ⚠️ ANGKA DI SINI BUKAN KPI, dan halaman ini menyatakannya DI LAYAR. Alasannya
 * bukan kehati-hatian berlebihan: angka per-orang dalam persen, tanpa label,
 * akan dipakai seperti nilai kinerja — dan D5 mengetok bahwa ia TIDAK masuk
 * Modul 14 dan tidak punya bobot. Ia mengukur "apakah yang dijadwalkan hari itu
 * selesai hari itu"; Speed Score M12 mengukur SLA turnaround multi-hari per
 * Asset. Dua pertanyaan berbeda, dua tempat berbeda.
 *
 * Read-only. Posisinya meniru `creative/daily-output`: picker PIC hanya untuk
 * lead/OD/Director; staff melihat barisnya sendiri (dipersempit RLS di server,
 * bukan di sini).
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  canSeeAllPics,
  fmtPersen,
  geserHari,
  getSlotSummary,
  hariIniWib,
  type PicSameDay,
} from '@/lib/dailyops';

export default function RekapJadwalPage() {
  const { role } = useAuth();
  const semuaPic = canSeeAllPics(role);

  const [dari, setDari] = useState(geserHari(hariIniWib(), -29));
  const [sampai, setSampai] = useState(hariIniWib());
  const [rows, setRows] = useState<PicSameDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSlotSummary(dari, sampai);
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dari, sampai]);

  useEffect(() => { load(); }, [load]);

  function filter(e: FormEvent) {
    e.preventDefault();
    load();
  }

  return (
    <div className="stack">
      <div>
        <Link href="/creative/schedule" className="muted">&larr; Kembali ke Jadwal Produksi</Link>
      </div>

      <div>
        <h1>Rekap Penyelesaian Hari-Sama</h1>
        <p className="muted">
          Dashboard operasional Leader (M19 §5.5). <strong>Bukan KPI:</strong> angka di halaman ini
          tidak masuk Team Performance (Modul 14) dan tidak punya bobot penilaian &mdash; ketokan
          pemilik D5. Ia menjawab &ldquo;apakah yang dijadwalkan hari itu selesai hari itu&rdquo;,
          bukan &ldquo;seberapa cepat orang ini&rdquo; (itu Speed Score M12, per Asset, SLA
          multi-hari).
        </p>
        {!semuaPic && (
          <p className="muted">Anda melihat baris Anda sendiri.</p>
        )}
      </div>

      <section className="card">
        <form className="formRow" onSubmit={filter}>
          <div className="field">
            <label htmlFor="dari">Dari (WIB)</label>
            <input id="dari" type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sampai">Sampai (WIB)</label>
            <input id="sampai" type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          <div>
            <button type="submit" className="btn btnPrimary btnSm" disabled={loading}>
              {loading ? 'Memuat...' : 'Tampilkan'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && (
          rows.length === 0 ? (
            <div className="emptyState">Belum ada slot terjadwal pada periode ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>PIC</th>
                    <th>Slot</th>
                    <th>Slot ditutup</th>
                    <th>Σ target</th>
                    <th>Σ aktual</th>
                    <th>Penyelesaian</th>
                    <th>Slot fill</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.employee_id}>
                      <td>{r.nama || r.employee_id}</td>
                      <td>{r.jumlah_slot}</td>
                      <td>{r.slot_ditutup}</td>
                      <td>{r.total_target}</td>
                      <td>{r.total_actual}</td>
                      {/* `—` saat penyebutnya nol (aturan rumah #7) — bukan 0%,
                          yang akan terbaca sebagai pernyataan tentang orang
                          yang datanya belum ada. */}
                      <td>{fmtPersen(r.penyelesaian_pct)}</td>
                      <td>{fmtPersen(r.slot_fill_pct)}</td>
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
