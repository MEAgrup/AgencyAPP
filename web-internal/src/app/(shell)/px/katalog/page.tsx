'use client';

/**
 * Product Exchange › Katalog PX — M3-B.
 *
 * SKU yang lolos keempat lapis gerbang (`px_catalog_item_v`). Lead Account/
 * Director/OD saja — sisi kreator adalah halaman portal terpisah (M4/M5, di
 * luar cakupan M3-B).
 *
 * Nol `gmv_30d`/pesanan di sini (D-06) — angka volume klien TIDAK PERNAH
 * ditampilkan di Katalog, beda dari halaman Kandidat.
 *
 * Banner kuning saat snapshot coverage MCN terbaru > 10 hari (Rule 17 PRD):
 * katalog TETAP tampil — hanya pembuatan match baru (M5) yang diblokir.
 */

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { listKatalog, listKreatorKosong, type PxCoverageMeta, type PxKatalogItem, type PxKreatorKosong } from '@/lib/px';

function formatTanggal(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('id-ID');
}

export default function KatalogPxPage() {
  const [items, setItems] = useState<PxKatalogItem[] | null>(null);
  const [snapshot, setSnapshot] = useState<PxCoverageMeta | null>(null);
  const [kreatorKosong, setKreatorKosong] = useState<PxKreatorKosong[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [katalog, laporan] = await Promise.all([listKatalog(), listKreatorKosong()]);
      setItems(katalog.data);
      setSnapshot(katalog.snapshot);
      setKreatorKosong(laporan.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>Katalog PX — Product Exchange</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          SKU yang lolos keempat lapis gerbang (agency plan, volume, kategori, ketersediaan
          kreator) — siap ditawarkan lewat Product Exchange.
        </p>
      </div>

      {loadError && <div className="alert alertError" role="alert">{loadError}</div>}

      {snapshot?.basi && (
        <div className="alert alertWarning" role="alert">
          Data coverage terakhir dari MCN: {formatTanggal(snapshot.snapshot_at)}
          {snapshot.umur_hari !== null && ` (${snapshot.umur_hari} hari lalu)`} — katalog tetap
          tampil; pembuatan match baru diblokir sampai MCN mengirim snapshot terbaru.
        </div>
      )}

      <section className="card">
        <div className="cardHeader">
          Katalog {items !== null && <span className="muted">({items.length} produk)</span>}
        </div>
        {loading ? (
          <p className="pageLoading">Memuat...</p>
        ) : items === null || items.length === 0 ? (
          <div className="emptyState">Belum ada produk di katalog.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produk</th>
                  <th>Toko</th>
                  <th>Platform</th>
                  <th>Kategori</th>
                  <th>Segmen Harga</th>
                  <th>Sudah Afiliasi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={`${it.client_platform_id}:${it.platform_product_id}`}>
                    <td>{it.nama_produk ?? it.platform_product_id}</td>
                    <td>{it.nama_toko}</td>
                    <td className="muted">{it.platform}</td>
                    <td>{it.level2_category ?? '—'}</td>
                    <td>{it.price_segment ?? '—'}</td>
                    <td>{it.sudah_afiliasi ? 'Ya' : 'Belum'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">Kategori Ber-Demand Tanpa Kreator (input rekrutmen MCN)</div>
        {loading ? (
          <p className="pageLoading">Memuat...</p>
        ) : kreatorKosong === null || kreatorKosong.length === 0 ? (
          <div className="emptyState">Nol kategori kosong saat ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Kategori</th>
                  <th>Segmen Harga</th>
                  <th>Jumlah Produk</th>
                  <th>Jumlah Klien</th>
                </tr>
              </thead>
              <tbody>
                {kreatorKosong.map((k) => (
                  <tr key={`${k.level2_category}:${k.price_segment}`}>
                    <td>{k.level2_category}</td>
                    <td>{k.price_segment}</td>
                    <td>{k.jumlah_produk}</td>
                    <td>{k.jumlah_klien}</td>
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
