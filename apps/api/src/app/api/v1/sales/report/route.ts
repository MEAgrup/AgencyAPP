/**
 * GET /api/v1/sales/report — Laporan Penjualan (permintaan pemilik
 * 2026-09-10, Bagian 3): satu baris per salesperson dengan bauran deal + uang,
 * satu baris TOTAL, dan rekap layanan terjual.
 *
 * Filter `?from=&to=` (keduanya "YYYY-MM", inklusif) / `?salesperson=` sama
 * persis dengan `GET /sales/performance`, supaya kedua tab pada
 * `/sales/kinerja` bisa memakai satu state filter.
 *
 * PERMISSION — `salesperf.canViewSalesReport`, gerbang yang BERBEDA dari
 * `canViewSalesPerf`: Finance boleh membaca laporan ini (uang + layanan) tapi
 * tetap 403 di `/sales/performance`, karena ia sengaja tidak diberi lengan RLS
 * ke `leads`/`prospect_attempts`. Menjawab 200 dengan kolom corong berisi nol
 * akan terbaca sah dan salah; 403 jujur.
 *
 * `?source=`/`?campaign=` sengaja TIDAK diterima di sini: keduanya menyaring
 * lewat `leads`, tabel yang Finance tidak boleh baca. Menerimanya berarti
 * laporan Finance berubah diam-diam jadi kosong setiap kali filter itu
 * terpasang.
 */
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { reportFilter } from '@/lib/sales-report';
import { salesReportToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!salesperf.canViewSalesReport(actor)) {
      throw new salesperf.ForbiddenError();
    }
    const report = await readAsActor(actor, (sql) => salesperf.salesReport(sql, actor, reportFilter(request.url)));
    return json({ data: salesReportToWire(report) });
  });
}
