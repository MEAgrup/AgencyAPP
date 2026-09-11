/**
 * GET /api/v1/sales/report/export — Laporan Penjualan sebagai CSV (pemilik
 * 2026-09-10: *"bisa diekspor"*).
 *
 * Rute TERPISAH dari `GET /sales/report`, pola rumah yang sama dengan
 * `GET /leads/export`: rute baca panas tidak dibebani tipe respons yang
 * bercabang pada query param.
 *
 * Gerbangnya SAMA (`canViewSalesReport`) dan filternya SAMA (`reportFilter`),
 * dibaca lewat `readAsActor` yang sama — jadi berkas yang diunduh tidak pernah
 * bisa berisi lebih dari yang layarnya sudah tampilkan, dan selalu cocok
 * dengan tabel di atasnya. Ini SENGAJA berbeda dari `leads/export` yang
 * Director-only: laporan ini justru diminta untuk Finance & Head Sales, dan
 * mengekspor persis yang sudah terlihat bukan pelebaran hak.
 *
 * Buffered, bukan streamed: `readAsActor` commit begitu callback-nya selesai,
 * jadi `ReadableStream` yang hidup lebih lama akan membaca di luar transaksi
 * RLS.
 *
 * ── Kenapa SATU berkas berisi tiga blok ───────────────────────────────────
 *
 * Laporannya memang tiga hal: baris per sales, satu baris TOTAL, dan rekap
 * layanan. Memecahnya jadi tiga unduhan memindahkan pekerjaan menyatukan
 * kembali ke pembacanya. Blok dipisah satu baris kosong dan diberi judul
 * sendiri — bentuk yang dibaca Excel apa adanya.
 *
 * Baris TOTAL diberi label `TOTAL` di kolom pertama dan sengaja memakai angka
 * dari server (COUNT DISTINCT kontrak), BUKAN hasil menjumlahkan kolom di
 * atasnya: satu deal yang dijual berdua muncul pada dua baris.
 */
import { tz } from '@cdps/core';
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { CSV_BOM, CSV_DELIMITER, csvEscape } from '@/lib/csv';
import { readAsActor } from '@/lib/db';
import { handle } from '@/lib/http';
import { reportFilter } from '@/lib/sales-report';

const HEADER_SALES = [
  'salesperson_id', 'nama', 'level_sales', 'total_deal',
  'klien_baru', 'klien_perpanjangan', 'klien_cross_sell', 'klien_count',
  'omzet', 'komisi_kontrak', 'komisi_diakui',
] as const;

const HEADER_LAYANAN = ['master_service_id', 'nama_layanan', 'jumlah', 'nilai'] as const;

/** Satu baris CSV — `;` sebagai pemisah (Excel locale Indonesia), lihat `lib/csv.ts`. */
function line(cells: readonly string[]): string {
  return cells.map(csvEscape).join(CSV_DELIMITER);
}

export function renderSalesReportCsv(r: salesperf.SalesReport): string {
  const lines: string[] = [];
  lines.push(line(['Laporan Penjualan — per Sales']));
  lines.push(line(HEADER_SALES));
  for (const row of r.rows) {
    lines.push(line([
      row.salespersonId, row.nama, row.levelSales, String(row.totalDeal),
      row.klienBaru, row.klienPerpanjangan, row.klienCrossSell, row.klienCount,
      row.omzet, row.komisiKontrak, row.komisiDiakui,
    ]));
  }
  lines.push(line([
    'TOTAL', `${r.total.salespersonCount} sales`, '', String(r.total.totalDeal),
    '', '', '', String(r.total.klienCount),
    r.total.omzet, r.total.komisiKontrak, r.total.komisiDiakui,
  ]));
  lines.push('');
  lines.push(line(['Rekap Layanan Terjual']));
  lines.push(line(HEADER_LAYANAN));
  for (const s of r.services) {
    lines.push(line([s.masterServiceId, s.nama, String(s.jumlah), s.nilai]));
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!salesperf.canViewSalesReport(actor)) {
      throw new salesperf.ForbiddenError();
    }
    const report = await readAsActor(actor, (sql) => salesperf.salesReport(sql, actor, reportFilter(request.url)));
    const filename = `laporan-penjualan-${tz.dateString(new Date())}.csv`;
    return new Response(renderSalesReportCsv(report), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  });
}
