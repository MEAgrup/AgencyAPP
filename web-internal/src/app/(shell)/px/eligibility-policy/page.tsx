'use client';

/**
 * Product Exchange › Kebijakan Kelayakan SKU — PX-M2a.
 *
 * Kalibrasi berversi yang menggerakkan gerbang uang Product Exchange M3
 * (ambang penjualan, basis pengukuran, window, commission floor, syarat
 * stok, cakupan platform). Director-only untuk membaca DAN menulis
 * (`productexchange.canKelolaPolicy`) — preseden `adsscanner_benchmark`,
 * BUKAN pola OD-baca/Director-tulis yang dipakai kebanyakan bidang admin
 * lain, karena kalibrasi ini langsung menggerakkan gerbang uang M3.
 *
 * Append-only: versi baru TIDAK PERNAH mengubah versi lama (nol tombol edit
 * di halaman ini, dengan sengaja). Versi aktif = versi TERTINGGI yang
 * `aktif = true` — kolom "Aktif" di bawah karena itu bukan checkbox yang
 * bisa dibalik di sini, hanya ditetapkan saat versi itu dibuat.
 *
 * Server tetap otoritasnya; tombol yang disembunyikan di sini adalah
 * kesopanan, bukan keamanan.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { createEligibilityPolicy, listEligibilityPolicy, type PxEligibilityPolicy } from '@/lib/px';

function formatTanggal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID');
}

function formatIdr(n: number): string {
  return `Rp. ${n.toLocaleString('id-ID')}`;
}

export default function EligibilityPolicyPage() {
  const { role } = useAuth();
  const canWrite = Boolean(role?.director);

  const [rows, setRows] = useState<PxEligibilityPolicy[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [salesThresholdIdr, setSalesThresholdIdr] = useState('200000000');
  const [thresholdBasis, setThresholdBasis] = useState('per_sku');
  const [thresholdWindowDays, setThresholdWindowDays] = useState('30');
  const [commissionFloorPct, setCommissionFloorPct] = useState('');
  const [requireStockIn, setRequireStockIn] = useState(true);
  const [platforms, setPlatforms] = useState('tiktok');
  const [catatan, setCatatan] = useState('');
  const [aktif, setAktif] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listEligibilityPolicy();
      setRows(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (catatan.trim() === '') {
      setFormError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setSubmitting(true);
    try {
      await createEligibilityPolicy({
        nilai: {
          sales_threshold_idr: Number(salesThresholdIdr),
          threshold_basis: thresholdBasis.trim(),
          threshold_window_days: Number(thresholdWindowDays),
          commission_floor_pct: commissionFloorPct.trim() === '' ? null : Number(commissionFloorPct),
          require_stock_in: requireStockIn,
          platforms: platforms.split(',').map((p) => p.trim()).filter((p) => p !== ''),
        },
        catatan: catatan.trim(),
        aktif,
      });
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
        <h1 style={{ marginBottom: 4 }}>Kebijakan Kelayakan SKU — Product Exchange</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Kalibrasi yang menentukan SKU mana boleh ditawarkan ke kreator MCN MEA lewat Product
          Exchange (M3). Append-only — versi baru tidak pernah mengubah versi lama. Versi aktif =
          versi tertinggi yang berstatus Aktif.
        </p>
      </div>

      {loadError && <div className="alert alertError" role="alert">{loadError}</div>}

      {canWrite && (
        <section className="card">
          <div className="cardHeader">Buat versi baru</div>
          <form className="form" onSubmit={handleCreate}>
            {formError && <div className="alert alertError" role="alert">{formError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="ep-threshold">Ambang Penjualan (Rp, per SKU)</label>
                <input
                  id="ep-threshold"
                  type="number"
                  min={0}
                  required
                  value={salesThresholdIdr}
                  onChange={(e) => setSalesThresholdIdr(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="ep-basis">Basis Pengukuran</label>
                <input
                  id="ep-basis"
                  required
                  value={thresholdBasis}
                  onChange={(e) => setThresholdBasis(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="ep-window">Window (hari)</label>
                <input
                  id="ep-window"
                  type="number"
                  min={1}
                  required
                  value={thresholdWindowDays}
                  onChange={(e) => setThresholdWindowDays(e.target.value)}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="ep-floor">Commission Floor % (kosongkan = tanpa floor)</label>
                <input
                  id="ep-floor"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={commissionFloorPct}
                  onChange={(e) => setCommissionFloorPct(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="ep-platforms">Platform (pisahkan koma)</label>
                <input
                  id="ep-platforms"
                  required
                  value={platforms}
                  onChange={(e) => setPlatforms(e.target.value)}
                />
              </div>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={requireStockIn}
                    onChange={(e) => setRequireStockIn(e.target.checked)}
                  />{' '}
                  Wajib Stok Masuk
                </label>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ep-catatan">Catatan (wajib)</label>
              <textarea
                id="ep-catatan"
                required
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
              />
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
          <div className="emptyState">Belum ada versi kebijakan.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Versi</th>
                  <th>Ambang</th>
                  <th>Basis</th>
                  <th>Window</th>
                  <th>Commission Floor</th>
                  <th>Stok Wajib</th>
                  <th>Platform</th>
                  <th>Aktif</th>
                  <th>Catatan</th>
                  <th>Dibuat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.versi}>
                    <td>{r.versi}</td>
                    <td>{formatIdr(r.nilai.sales_threshold_idr)}</td>
                    <td>{r.nilai.threshold_basis}</td>
                    <td>{r.nilai.threshold_window_days} hari</td>
                    <td>{r.nilai.commission_floor_pct === null ? 'Tanpa floor' : `${r.nilai.commission_floor_pct}%`}</td>
                    <td>{r.nilai.require_stock_in ? 'Ya' : 'Tidak'}</td>
                    <td>{r.nilai.platforms.join(', ')}</td>
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
