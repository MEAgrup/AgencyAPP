'use client';

/**
 * Product Exchange › Kandidat PX — M3-B.
 *
 * Produk yang lolos L1-L2 (agency plan + volume Rp 200jt/bulan) dan menunggu
 * atau sudah lewat konfirmasi kategori AM (verdict `kategori_belum_dikonfirmasi`
 * / `kreator_kosong` / `lolos`). AM pemilik klien melihat kliennya sendiri;
 * Lead Account/Director/OD melihat semua.
 *
 * `gmv_30d` DITAMPILKAN di sini (D-06 melarang angka menyeberang ke MCN/
 * kreator, bukan ke AM pemilik klien) — TIDAK PERNAH di halaman Katalog.
 */

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  fmtRupiah,
  konfirmasiKategori,
  listKandidat,
  listKategoriOptions,
  type PxKandidat,
} from '@/lib/px';

const VERDICT_LABEL: Record<string, string> = {
  kategori_belum_dikonfirmasi: 'Menunggu Konfirmasi Kategori',
  kreator_kosong: 'Nol Kreator (MCN)',
  lolos: 'Lolos — Masuk Katalog',
};

export default function KandidatPxPage() {
  const { role } = useAuth();
  const canKonfirmasi = Boolean(role?.director || (role?.level === 'lead' && role?.division === 'Account') || role?.division === 'Account');

  const [rows, setRows] = useState<PxKandidat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [kandidat, opsi] = await Promise.all([listKandidat(), listKategoriOptions()]);
      setRows(kandidat.data);
      setOptions(opsi.options);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function rowKey(r: PxKandidat): string {
    return `${r.client_platform_id}:${r.platform_product_id}`;
  }

  async function handleKonfirmasi(r: PxKandidat) {
    const key = rowKey(r);
    const kategori = pending[key] ?? '';
    if (kategori === '') return;
    setSavingKey(key);
    setRowError((prev) => ({ ...prev, [key]: '' }));
    try {
      await konfirmasiKategori(r.client_platform_id, r.platform_product_id, { level2_category: kategori });
      await load();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [key]: errorMessage(err) }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>Kandidat PX — Product Exchange</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Produk yang sudah lolos gerbang agency plan dan volume (Rp 200jt/bulan), menunggu
          konfirmasi kategori sebelum bisa ditawarkan ke kreator MCN MEA.
        </p>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Kategori yang MEA <strong>belum punya kreatornya</strong> tidak muncul di daftar pilihan
          di bawah — hubungi Hans untuk master kategori bila kategori produk Anda tidak ada.
        </p>
      </div>

      {loadError && <div className="alert alertError" role="alert">{loadError}</div>}

      <section className="card">
        <div className="cardHeader">
          Kandidat {rows !== null && <span className="muted">({rows.length} produk)</span>}
        </div>
        {loading ? (
          <p className="pageLoading">Memuat...</p>
        ) : rows === null || rows.length === 0 ? (
          <div className="emptyState">Belum ada kandidat.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Toko</th>
                  <th>Produk</th>
                  <th>Kategori Platform</th>
                  <th>Harga Satuan</th>
                  <th>GMV 30 Hari</th>
                  <th>Status</th>
                  {canKonfirmasi && <th>Konfirmasi Kategori</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = rowKey(r);
                  return (
                    <tr key={key}>
                      <td>{r.nama_toko}</td>
                      <td>{r.nama_produk ?? r.platform_product_id}</td>
                      <td className="muted">{r.kategori_platform ?? '—'}</td>
                      <td>{fmtRupiah(r.harga_satuan)}</td>
                      <td>{fmtRupiah(r.gmv_30d)}</td>
                      <td>
                        {r.level2_category ? `${r.level2_category} / ${r.price_segment ?? '—'} · ` : ''}
                        {VERDICT_LABEL[r.verdict] ?? r.verdict}
                      </td>
                      {canKonfirmasi && (
                        <td>
                          {r.verdict === 'lolos' ? (
                            <span className="muted">Sudah dikonfirmasi</span>
                          ) : (
                            <div className="formRow" style={{ gap: 4 }}>
                              <select
                                value={pending[key] ?? r.level2_category ?? ''}
                                onChange={(e) => setPending((prev) => ({ ...prev, [key]: e.target.value }))}
                              >
                                <option value="">Pilih kategori…</option>
                                {options.map((o) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn btnPrimary"
                                disabled={savingKey === key || !(pending[key] ?? '')}
                                onClick={() => handleKonfirmasi(r)}
                              >
                                {savingKey === key ? 'Menyimpan...' : 'Konfirmasi'}
                              </button>
                              {rowError[key] && <div className="alert alertError" role="alert">{rowError[key]}</div>}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
