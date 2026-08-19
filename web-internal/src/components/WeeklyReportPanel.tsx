'use client';

/**
 * Laporan Mingguan Advertiser untuk Brief-as-task divisi Ads
 * (follow-up PR #172 — keputusan pemilik 2026-08-19, DECISIONS.md).
 *
 * Laporan pemilik: Advertiser (PIC) "bertugas meningkatkan performa dan
 * memberikan saran perbaikan setiap minggunya" — dan tak punya tempat
 * melakukannya. Panel ini adalah tempat itu, di halaman yang sama dengan
 * penetapan PIC.
 *
 * Realisasi-saja (bukan target vs realisasi): angka mingguan dihitung ulang
 * server-side dari Metric Entry kampanye brief ini dan tak bisa diketik; yang
 * diisi Advertiser hanyalah analisa + saran (+ kendala opsional). Target
 * per-brief hidup di Strategy, bukan di sini. Satu laporan per minggu ISO,
 * append-only — laporan yang dikirim tak bisa diubah (koreksi = minggu depan).
 *
 * Nol format angka di file ini: setiap `*_display` sudah dibentuk server
 * (Rp. X.XXX.XXX,00, "4x", "1,50%", dan "—" untuk pembagian nol / angka absen).
 * Peran di sini cermin server (yang tetap penentu): form laporan hanya dirender
 * untuk PIC/SPV-Lead/Director (`canReport`); tabel dibaca siapa pun yang boleh
 * membaca brief-nya.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import {
  fileAdsWeeklyReport,
  getAdsWeeklyReports,
  weekLabel,
  type AdsWeeklyReportView,
} from '@/lib/ads-weekly';

interface Props {
  briefId: string;
  /** PIC brief ini, SPV/Lead Ads, atau Director — boleh mengisi laporan mingguan. */
  canReport: boolean;
}

export default function WeeklyReportPanel({ briefId, canReport }: Props) {
  const [weekly, setWeekly] = useState<AdsWeeklyReportView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reportWeek, setReportWeek] = useState('');
  const [analisa, setAnalisa] = useState('');
  const [saran, setSaran] = useState('');
  const [kendala, setKendala] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const w = await getAdsWeeklyReports(briefId);
      setWeekly(w);
      // Default the filing form to the oldest week still owed, else the running
      // week — the one the Advertiser almost certainly means.
      const owed = w.minggu.find((m) => m.terlambat) ?? w.minggu.find((m) => m.berjalan);
      setReportWeek(owed?.minggu_mulai ?? '');
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [briefId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFileReport(e: FormEvent) {
    e.preventDefault();
    setReportError(null);
    setReportMessage(null);
    setSubmitting(true);
    try {
      const r = await fileAdsWeeklyReport(briefId, { minggu_mulai: reportWeek, analisa, saran, kendala });
      setReportMessage(`Laporan ${weekLabel(r)} tersimpan.`);
      setAnalisa('');
      setSaran('');
      setKendala('');
      await load();
    } catch (err) {
      setReportError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError !== null) {
    return (
      <section className="card">
        <div className="cardHeader"><h2>Laporan Mingguan Ads</h2></div>
        <div className="alert alertError" role="alert">{loadError}</div>
      </section>
    );
  }
  if (weekly === null) {
    return (
      <section className="card">
        <div className="cardHeader"><h2>Laporan Mingguan Ads</h2></div>
        <p className="muted">Memuat...</p>
      </section>
    );
  }

  // Weeks that can still be filed: everything not yet reported, newest first, so
  // the running week sits at the top of the picker.
  const fillableWeeks = weekly.minggu.filter((m) => !m.terisi).reverse();

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Laporan Mingguan Ads</h2>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Realisasi per minggu dihitung ulang dari Metric Entry kampanye brief ini &mdash; tidak bisa
        diketik. Yang diisi Advertiser adalah analisa performa dan saran perbaikan untuk minggu
        berikutnya. Satu laporan per minggu, dan laporan yang sudah dikirim tidak bisa diubah.
      </p>

      {weekly.minggu.length === 0 ? (
        <p className="muted">
          Belum ada minggu berjalan &mdash; laporan mingguan dimulai setelah brief masuk
          [In Progress].
        </p>
      ) : (
        <>
          {weekly.belum_diisi > 0 && (
            <div className="alert alertInfo" role="status">
              {weekly.belum_diisi} minggu sudah selesai tetapi belum ada laporannya.
            </div>
          )}
          {weekly.dipotong && (
            <p className="muted" style={{ fontSize: 12 }}>
              Menampilkan 26 minggu terakhir; minggu yang lebih lama tidak ditampilkan.
            </p>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Minggu</th>
                  <th>Metrik</th>
                  <th>Realisasi</th>
                  <th>Laporan</th>
                </tr>
              </thead>
              <tbody>
                {[...weekly.minggu].reverse().map((w) => (
                  w.metrik.map((m, i) => (
                    <tr key={`${w.iso_year}-${w.iso_week}-${m.key}`}>
                      {i === 0 && (
                        <td rowSpan={w.metrik.length}>
                          {weekLabel(w)}
                          {w.berjalan && <div className="muted" style={{ fontSize: 12 }}>berjalan</div>}
                        </td>
                      )}
                      <td>{m.label}</td>
                      <td>{m.realisasi_display}</td>
                      {i === 0 && (
                        <td rowSpan={w.metrik.length}>
                          {w.terisi ? (
                            <>
                              <div><strong>Analisa:</strong> {w.analisa}</div>
                              <div><strong>Saran:</strong> {w.saran}</div>
                              {w.kendala !== '' && <div><strong>Kendala:</strong> {w.kendala}</div>}
                              <div className="muted" style={{ fontSize: 12 }}>
                                {w.diisi_oleh}
                                {w.diisi_pada !== null && <> &middot; {new Date(w.diisi_pada).toLocaleString('id-ID')}</>}
                              </div>
                            </>
                          ) : w.terlambat ? (
                            <span className="badge badge-purple">Belum diisi</span>
                          ) : (
                            <span className="muted">Belum diisi (minggu berjalan)</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canReport && fillableWeeks.length > 0 && (
        <form className="form" onSubmit={handleFileReport} style={{ marginTop: 14 }}>
          {reportError && <div className="alert alertError" role="alert">{reportError}</div>}
          {reportMessage && <div className="alert alertSuccess" role="status">{reportMessage}</div>}
          <div className="formRow">
            <div className="field">
              <label htmlFor="report-week">Minggu yang dilaporkan</label>
              <select id="report-week" value={reportWeek} onChange={(e) => setReportWeek(e.target.value)}>
                {fillableWeeks.map((w) => (
                  <option key={w.minggu_mulai} value={w.minggu_mulai}>
                    {weekLabel(w)}{w.berjalan ? ' (berjalan)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="report-analisa">Analisa performa minggu ini (wajib)</label>
            <textarea
              id="report-analisa" rows={3} required value={analisa}
              onChange={(e) => setAnalisa(e.target.value)}
              placeholder="Mis. ROAS 4,75x di atas ekspektasi; spend baru terserap 50% karena listing hero SKU belum siap."
            />
          </div>
          <div className="field">
            <label htmlFor="report-saran">Saran perbaikan untuk minggu depan (wajib)</label>
            <textarea
              id="report-saran" rows={3} required value={saran}
              onChange={(e) => setSaran(e.target.value)}
              placeholder="Mis. naikkan budget kampanye Shopee 20%, matikan ad group dengan CTR terendah, uji hook baru."
            />
          </div>
          <div className="field">
            <label htmlFor="report-kendala">Kendala (opsional)</label>
            <textarea id="report-kendala" rows={2} value={kendala} onChange={(e) => setKendala(e.target.value)} />
          </div>
          <div className="formRow">
            <button type="submit" className="btn btnPrimary btnSm" disabled={submitting}>
              {submitting ? 'Mengirim...' : 'Kirim Laporan Mingguan'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
