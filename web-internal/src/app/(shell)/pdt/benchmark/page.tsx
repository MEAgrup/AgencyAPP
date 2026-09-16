'use client';

/**
 * PDT › Benchmark Skor (G2-02) — kalibrasi `pdt_benchmark` TikTok.
 *
 * Menutup Rule 25 ("mengubah ambang tidak boleh lagi butuh migrasi+deploy"):
 * sebelum halaman ini, menaikkan versi kalibrasi HANYA lewat migrasi SQL
 * (`docs/backlog/PDT_BACKLOG.md` G2-02). Director-only untuk membaca DAN
 * menulis (`pdt.canKelolaBenchmark`) — preseden HURUF PER HURUF
 * `/px/eligibility-policy`, BUKAN pola OD-baca/Director-tulis kebanyakan
 * bidang admin lain: kalibrasi ini langsung menggerakkan skor performa klien
 * yang dikirim ke klien.
 *
 * Append-only: versi baru TIDAK PERNAH mengubah versi lama (nol tombol edit
 * di halaman ini, dengan sengaja). Versi aktif = versi TERTINGGI yang
 * `aktif = true` — form di bawah di-prefill dari versi aktif itu supaya
 * Director mengubah DELTA, bukan mengetik ulang seluruh sepuluh ambang dari
 * nol setiap kali.
 *
 * TikTok SAJA — Shopee tidak memakai `pdt_benchmark` sama sekali (ambangnya
 * hardcode di `computeSkorShopee`, asimetri sengaja).
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { listBenchmarkVersi, tambahVersiBenchmark, type PdtBenchBand, type PdtBenchmarkVersi } from '@/lib/pdt';

const KUNCI_LABEL: Record<string, string> = {
  roi_gmvmax: 'ROI GMV Max Ads',
  cpa_ratio: 'CPA Ratio',
  gmv_per_jam_live: 'GMV per Jam LIVE (Rp)',
  sesi_live: 'Jumlah Sesi LIVE',
  gpm_video: 'GMV per Video / GPM (Rp)',
  pct_video_sales: '% Penjualan dari Video',
  cvr_toko: 'CVR Toko',
  pct_kreator_produktif: '% Kreator Produktif',
  quad_klik: 'Ambang Klik — Kuadran SKU',
  quad_cvr: 'Ambang CVR — Kuadran SKU',
};

const KUNCI_URUTAN = Object.keys(KUNCI_LABEL);

const DEFAULT_NILAI: Record<string, PdtBenchBand> = {
  roi_gmvmax: { good: 8, warn: 4 },
  cpa_ratio: { good: 0.1, warn: 0.2 },
  gmv_per_jam_live: { good: 300000, warn: 150000 },
  sesi_live: { good: 20, warn: 12 },
  gpm_video: { good: 30000, warn: 10000 },
  pct_video_sales: { good: 0.05, warn: 0.02 },
  cvr_toko: { good: 0.015, warn: 0.008 },
  pct_kreator_produktif: { good: 0.2, warn: 0.1 },
  quad_klik: { good: 150, warn: 25 },
  quad_cvr: { good: 0.015, warn: 0.005 },
};

function formatTanggal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID');
}

export default function PdtBenchmarkPage() {
  const { role } = useAuth();
  const canWrite = Boolean(role?.director);

  const [rows, setRows] = useState<PdtBenchmarkVersi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, PdtBenchBand>>(DEFAULT_NILAI);
  const [catatan, setCatatan] = useState('');
  const [aktif, setAktif] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listBenchmarkVersi('tiktok');
      setRows(res.data);
      const versiAktif = res.data.find((r) => r.aktif);
      if (versiAktif) setForm(versiAktif.nilai);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setBand(kunci: string, field: 'good' | 'warn', value: string) {
    setForm((prev) => ({ ...prev, [kunci]: { ...prev[kunci], [field]: Number(value) } }));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (catatan.trim() === '') {
      setFormError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setSubmitting(true);
    try {
      await tambahVersiBenchmark({ platform: 'tiktok', nilai: form, catatan: catatan.trim(), aktif });
      setCatatan('');
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>Benchmark Skor PDT — TikTok</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Ambang yang menggerakkan Skor Performa TikTok (enam dimensi) dan klasifikasi kuadran SKU.
          Append-only — versi baru tidak pernah mengubah versi lama, dan hanya berlaku untuk laporan
          yang BELUM dikirim ke klien; laporan yang sudah dikirim tetap memakai versi saat pengiriman.
        </p>
      </div>

      {loadError && <div className="alert alertError" role="alert">{loadError}</div>}

      {canWrite && (
        <section className="card">
          <div className="cardHeader">Buat versi baru</div>
          <form className="form" onSubmit={handleCreate}>
            {formError && <div className="alert alertError" role="alert">{formError}</div>}
            {KUNCI_URUTAN.map((kunci) => (
              <div className="formRow" key={kunci}>
                <div className="field" style={{ flex: 2 }}>
                  <label>{KUNCI_LABEL[kunci]}</label>
                </div>
                <div className="field">
                  <label htmlFor={`bm-${kunci}-good`}>Good</label>
                  <input
                    id={`bm-${kunci}-good`}
                    type="number"
                    step="any"
                    required
                    value={form[kunci]?.good ?? ''}
                    onChange={(e) => setBand(kunci, 'good', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`bm-${kunci}-warn`}>Warn</label>
                  <input
                    id={`bm-${kunci}-warn`}
                    type="number"
                    step="any"
                    required
                    value={form[kunci]?.warn ?? ''}
                    onChange={(e) => setBand(kunci, 'warn', e.target.value)}
                  />
                </div>
              </div>
            ))}
            <div className="field">
              <label htmlFor="bm-catatan">Catatan (wajib)</label>
              <textarea id="bm-catatan" required value={catatan} onChange={(e) => setCatatan(e.target.value)} />
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} /> Aktifkan versi
                ini
              </label>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={submitting}>
                {submitting ? 'Menyimpan...' : 'Buat Versi Baru'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          Riwayat Versi {rows !== null && <span className="muted">({rows.length} versi)</span>}
        </div>
        {loading ? (
          <p className="pageLoading">Memuat...</p>
        ) : rows === null || rows.length === 0 ? (
          <div className="emptyState">Belum ada versi benchmark.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Versi</th>
                  <th>Aktif</th>
                  <th>Catatan</th>
                  <th>Dibuat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.versi}>
                    <td>{r.versi}</td>
                    <td>{r.aktif ? 'Aktif' : 'Nonaktif'}</td>
                    <td>{r.catatan || '—'}</td>
                    <td className="muted">
                      {formatTanggal(r.dibuat_pada)} · {r.dibuat_oleh}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
