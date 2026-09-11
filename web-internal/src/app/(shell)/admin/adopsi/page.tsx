'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  canViewAdopsi,
  getAdopsiReport,
  labelBulan,
  type AdopsiReport,
} from '@/lib/adopsi';

/** "—" untuk persentase yang penyebutnya nol — server yang memutuskan, jangan hitung ulang. */
function dash(v: number | null, suffix = ''): string {
  return v === null ? '—' : `${v}${suffix}`;
}

export default function AdopsiPage() {
  const { role } = useAuth();
  const bolehLihat = canViewAdopsi(role);

  const [from, setFrom] = useState(''); // "YYYY-MM"
  const [to, setTo] = useState('');
  const [report, setReport] = useState<AdopsiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bolehLihat) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport((await getAdopsiReport({ from: from || undefined, to: to || undefined })).data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [bolehLihat, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  if (!bolehLihat) {
    return (
      <div className="stack">
        <div><h1>Adopsi Sistem</h1></div>
        <section className="card">
          <div className="alert alertError" role="alert">Anda tidak memiliki akses ke data ini.</div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Adopsi Sistem</h1>
        <p className="muted">
          Seberapa jauh tim benar-benar memakai CDPS: jam pemakaian, jumlah sesi, page view, dan
          cakupan fitur perannya — per anggota, per bulan. Sesi dihitung dari aktivitas beruntun;
          jeda lebih dari 30 menit memulai sesi baru.
        </p>
        {/* Kalimat pemilik, ditulis di layar dan bukan cuma di kode: angka ini
            akan dibaca orang yang tidak membaca `adopsi.ts`. */}
        <p className="muted">
          <strong>Ini indikator adaptasi tim ke sistem baru — bukan komponen penilaian.</strong>{' '}
          Tidak ada peringkat dan tidak ada ambang; angkanya tidak masuk ke skor performa mana pun.
        </p>
      </div>

      <section className="card">
        <div className="formRow" style={{ marginBottom: 16 }}>
          <div className="field">
            <label htmlFor="adopsi-from">Dari (bulan)</label>
            <input id="adopsi-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="adopsi-to">Sampai (bulan)</label>
            <input id="adopsi-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}

        {!loading && !error && report !== null && (
          <>
            {/* Batas yang WAJIB dinyatakan, bukan disembunyikan: sebelum tanggal
                ini tidak ada pencatatan sama sekali, jadi bulan yang kosong
                bukan berarti tidak ada yang memakai sistem. Tanpa kalimat ini,
                laporan yang benar terbaca seperti tuduhan. */}
            <div className="alert" role="status" style={{ marginBottom: 16 }}>
              {report.mulai_tercatat === null ? (
                <>Belum ada satu pun pemakaian yang tercatat. Pencatatan dimulai sejak fitur ini di-deploy — tidak ada data untuk bulan-bulan sebelumnya.</>
              ) : (
                <>Pencatatan dimulai <strong>{report.mulai_tercatat}</strong>. Bulan sebelum tanggal itu kosong karena <strong>belum ada pencatatan</strong>, bukan karena sistem tidak dipakai.</>
              )}
            </div>

            {report.rows.length === 0 ? (
              <div className="emptyState">Tidak ada pemakaian tercatat untuk filter ini.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Bulan</th><th>Anggota</th><th>Role</th>
                      <th>Jam/Bulan</th><th>Sesi</th><th>Page View</th>
                      <th>Fitur Dibuka</th><th>Cakupan Fitur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={`${r.employee_id}-${r.period}`}>
                        <td>{labelBulan(r.period)}</td>
                        <td>{r.nama} <span className="muted">({r.employee_id})</span></td>
                        <td>{r.role}</td>
                        <td>{r.jam}</td>
                        <td>{r.sesi}</td>
                        <td>{r.page_view}</td>
                        <td>{r.fitur_dibuka} <span className="muted">dari {r.fitur_tersedia}</span></td>
                        <td>{dash(r.cakupan_fitur_pct, '%')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="muted" style={{ marginTop: 16 }}>
              <strong>Cara membacanya.</strong> <em>Jam/Bulan</em> dihitung dari selang antar page
              view di dalam satu sesi, jadi halaman terakhir setiap sesi menyumbang nol — angkanya
              konsisten lebih rendah dari waktu layar yang sebenarnya. Itu disengaja: tidak ada
              sumber di CDPS yang tahu berapa lama halaman terakhir dibaca, dan menebaknya akan
              menghasilkan angka yang tidak bisa dihitung ulang. Kekurangannya seragam untuk semua
              orang, jadi perbandingan antar-anggota dan antar-bulan tetap sahih.{' '}
              <em>Cakupan Fitur</em> = berapa menu berbeda yang dibuka bulan itu, dibagi jumlah menu
              yang boleh diakses perannya saat itu.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
