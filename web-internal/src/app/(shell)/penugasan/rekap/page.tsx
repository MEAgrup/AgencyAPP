'use client';

/**
 * Rekap Disiplin Penugasan — the "menghitung performa team" half of the owner's
 * request.
 *
 * This is a REPORT, not an M14 score. The owner chose "catat + dashboard
 * terpisah" (DECISIONS 2026-08-14): M14's KPI weights were signed off on
 * 2026-08-13 (RM-9a) and each role profile sums to exactly 100, so no component
 * is folded in here and no `PERF-` snapshot is touched. Whether this becomes a
 * weighted component is a decision to make once there are a couple of months of
 * real data — not one to smuggle in through a dashboard.
 *
 * Every number is derived from the same rows `/penugasan` lists, so the report
 * can never disagree with the list it summarises.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PENUGASAN_DIVISIONS, getRekapDisiplin, type RekapDisiplin } from '@/lib/penugasan';

export default function RekapDisiplinPage() {
  const { role } = useAuth();
  // Only OD/Director read across divisions; everyone else is already row-scoped
  // by the server, so the filter would do nothing for them.
  const canPickDivision = Boolean(role?.director || role?.od);

  const [division, setDivision] = useState('');
  const [rows, setRows] = useState<RekapDisiplin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRekapDisiplin({ division: division || undefined });
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [division]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="stack">
      <div>
        <Link href="/penugasan" className="muted">&larr; Kembali ke Penugasan</Link>
        <h1>Rekap Disiplin Penugasan</h1>
        <p className="muted">
          Ketepatan waktu penyelesaian penugasan internal, per orang. Diturunkan dari tanggal jatuh
          tempo dan waktu selesai yang keduanya dibekukan &mdash; bukan angka yang bisa diketik ulang.
        </p>
      </div>

      <div className="alert alertInfo" role="note">
        Angka di halaman ini <strong>belum</strong> masuk ke skor Team Performance (M14). Bobot KPI M14
        sudah ditandatangani 2026-08-13 dan tiap profil peran pas 100 &mdash; menyisipkan komponen baru
        perlu keputusan tersendiri, setelah ada data nyata.
      </div>

      {canPickDivision && (
        <section className="card">
          <div className="field">
            <label htmlFor="r-division">Divisi</label>
            <select id="r-division" value={division} onChange={(e) => setDivision(e.target.value)}>
              <option value="">Semua divisi</option>
              {PENUGASAN_DIVISIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </section>
      )}

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && rows && rows.length === 0 && (
          <div className="emptyState">Belum ada penugasan yang tercatat.</div>
        )}
        {!loading && !error && rows && rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Karyawan</th>
                  <th>Divisi</th>
                  <th>Total</th>
                  <th>Selesai Tepat Waktu</th>
                  <th>Selesai Terlambat</th>
                  <th>Terlambat Berjalan</th>
                  <th>Berjalan</th>
                  <th>Dibatalkan</th>
                  <th>Ketepatan</th>
                  <th>Total Hari Telat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assignee_id} className={r.terlambat_berjalan > 0 ? 'flaggedRow' : ''}>
                    <td>{r.assignee_id}</td>
                    <td>{r.assignee_division}</td>
                    <td>{r.total}</td>
                    <td>{r.selesai_tepat_waktu}</td>
                    <td>
                      {r.selesai_terlambat > 0
                        ? <span className="badge badge-amber">{r.selesai_terlambat}</span>
                        : 0}
                    </td>
                    <td>
                      {r.terlambat_berjalan > 0
                        ? <span className="badge badge-red">{r.terlambat_berjalan}</span>
                        : 0}
                    </td>
                    <td>{r.berjalan}</td>
                    <td>{r.dibatalkan}</td>
                    {/* Rendered VERBATIM — "—" when nothing has been closed yet.
                        Never recomputed here (house rule #7: a zero denominator
                        renders a dash, and 0% would be a lie about a new hire). */}
                    <td>{r.ketepatan_display}</td>
                    <td>{r.total_hari_terlambat}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Ketepatan = selesai tepat waktu &divide; (tepat waktu + terlambat). Penugasan yang
          <strong> dibatalkan</strong> tidak masuk penyebut &mdash; pekerjaan itu ditarik, bukan dilewatkan.
        </p>
      </section>
    </div>
  );
}
