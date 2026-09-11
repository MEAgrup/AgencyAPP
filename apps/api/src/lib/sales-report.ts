/**
 * Bagian yang dipakai BERSAMA oleh `GET /sales/report` dan
 * `GET /sales/report/export` (Laporan Penjualan, pemilik 2026-09-10 Bagian 3).
 *
 * Ia hidup di `lib/` dan bukan di salah satu `route.ts` karena keduanya wajib
 * membaca filter yang IDENTIK: berkas yang diunduh harus cocok dengan tabel
 * yang sedang dilihat, dan dua salinan parser query yang boleh menyimpang
 * adalah cara termudah membuat keduanya berbeda tanpa ada yang sadar.
 */
import type { salesperf } from '@cdps/domain';

/**
 * reportFilter membaca `?from=&to=&salesperson=` — sama persis dengan
 * `GET /sales/performance`, supaya kedua tab pada `/sales/kinerja` bisa
 * berbagi satu state filter.
 *
 * `source`/`campaign` sengaja dipaku `null`: keduanya menyaring lewat `leads`,
 * tabel yang Finance TIDAK boleh baca. Menerimanya berarti laporan Finance
 * berubah diam-diam jadi kosong setiap kali salah satu filter itu terpasang —
 * kegagalan diam, bukan penolakan yang terbaca.
 */
export function reportFilter(url: string): salesperf.SalesPerfFilter {
  const q = new URL(url).searchParams;
  const from = q.get('from');
  const to = q.get('to');
  return {
    period: from !== null && to !== null ? { from, to } : null,
    salespersonId: q.get('salesperson'),
    source: null,
    campaignId: null,
  };
}
