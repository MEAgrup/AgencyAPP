// House IDR formatting convention (CLAUDE.md #7): "Rp. X.XXX.XXX,00"
// Thousands separated by dots, comma decimals. Division-by-zero / missing
// derived values render as an em dash, never an error.

export function formatIDR(value: number | string | null | undefined): string {
  // Backend sends DECIMAL columns as strings (e.g. "10000000.00").
  const num = typeof value === 'string' ? Number(value) : value;
  if (num === null || num === undefined || Number.isNaN(num)) {
    return '—'; // —
  }
  const isNegative = num < 0;
  const intPart = Math.trunc(Math.abs(num)).toString();
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${isNegative ? '-' : ''}Rp. ${grouped},00`;
}

/**
 * G4-02 — kategori pengukuran plan_row.satuan_kategori / strategi_resource.
 * jumlah_satuan_kategori (`@cdps/core` `pdt_satuan_t`, docs/backlog/
 * PDT_BACKLOG.md G4-02). web-internal tidak punya dependency `@cdps/*`
 * (lihat docblock `plan-row-suggest.ts`) — cermin MANUAL dari
 * `packages/core/src/satuan.ts` `formatNilaiSatuan`, sama pola.
 */
export type PdtSatuanKategori = 'rupiah' | 'persen' | 'hitungan' | 'jam' | 'hari' | 'views' | 'rasio';

/**
 * Formatter TUNGGAL (Rule 28) untuk plan_row.kuota/strategi_resource.jumlah
 * — WAJIB dipakai, bukan menebak dari nama divisi/jenis task. `persen`/
 * `rasio` menganggap `nilai` SUDAH dalam skala tampil (mis. 1.5 untuk
 * "1,5%"), bukan pecahan 0..1.
 */
export function formatNilaiSatuan(
  value: number | string | null | undefined,
  kategori: PdtSatuanKategori,
): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (num === null || num === undefined || Number.isNaN(num)) return '—';
  switch (kategori) {
    case 'rupiah':
      return formatIDR(num);
    case 'persen':
      return num.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    case 'rasio':
      return num.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'x';
    case 'jam':
      return Math.round(num).toLocaleString('id-ID') + ' jam';
    case 'hari':
      return Math.round(num).toLocaleString('id-ID') + ' hari';
    case 'views':
      return Math.round(num).toLocaleString('id-ID') + ' views';
    case 'hitungan':
    default:
      return Math.round(num).toLocaleString('id-ID');
  }
}

/** Safe ratio formatter for derived metrics: division-by-zero renders '—'. */
export function formatRatio(numerator: number | null | undefined, denominator: number | null | undefined, digits = 2): string {
  if (
    numerator === null ||
    numerator === undefined ||
    denominator === null ||
    denominator === undefined ||
    denominator === 0 ||
    Number.isNaN(numerator) ||
    Number.isNaN(denominator)
  ) {
    return '—';
  }
  return (numerator / denominator).toFixed(digits);
}
