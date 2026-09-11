/**
 * Laporan Penjualan (pemilik 2026-09-10, Bagian 3) — bagian `lib/salesperf.ts`
 * yang murni dan karena itu bisa diuji tanpa DOM maupun jaringan: pembentuk
 * URL unduhan dan pembaca `Content-Disposition`.
 *
 * Yang dijaga URL-nya bukan kosmetik. `source`/`campaign` menyaring lewat
 * `leads` — tabel yang Finance tidak boleh baca dan yang memang tidak ikut
 * dalam laporan ini. Server sudah mengabaikan keduanya; membuangnya juga di
 * sisi klien memastikan berkas dan layar tidak pernah tampak dibentuk oleh
 * filter yang sebenarnya tidak berpengaruh.
 */
import { describe, expect, it } from 'vitest';
import { reportFilenameFrom, salesReportCsvUrl } from './salesperf';

describe('salesReportCsvUrl', () => {
  it('tanpa filter -> URL telanjang', () => {
    expect(salesReportCsvUrl()).toBe('/api/v1/sales/report/export');
    expect(salesReportCsvUrl({})).toBe('/api/v1/sales/report/export');
  });

  it('meneruskan from/to/salesperson', () => {
    expect(salesReportCsvUrl({ from: '2026-06', to: '2026-08', salesperson: 'EMP-0001' }))
      .toBe('/api/v1/sales/report/export?from=2026-06&to=2026-08&salesperson=EMP-0001');
  });

  it('MEMBUANG source/campaign — keduanya menyaring lewat `leads`, yang bukan bagian laporan ini', () => {
    expect(salesReportCsvUrl({ from: '2026-06', to: '2026-06', source: 'Scouting', campaign: 'CMP-1' }))
      .toBe('/api/v1/sales/report/export?from=2026-06&to=2026-06');
  });

  it('meng-encode nilai yang perlu di-encode', () => {
    expect(salesReportCsvUrl({ salesperson: 'EMP 0001&x=1' }))
      .toBe('/api/v1/sales/report/export?salesperson=EMP+0001%26x%3D1');
  });
});

describe('reportFilenameFrom', () => {
  it('mengambil nama dari header', () => {
    expect(reportFilenameFrom('attachment; filename="laporan-penjualan-2026-09-10.csv"'))
      .toBe('laporan-penjualan-2026-09-10.csv');
  });

  it('header hilang atau tanpa filename -> nama cadangan, bukan galat', () => {
    expect(reportFilenameFrom(null)).toBe('laporan-penjualan.csv');
    expect(reportFilenameFrom('attachment')).toBe('laporan-penjualan.csv');
  });
});
