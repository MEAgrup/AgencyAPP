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
