/**
 * CSV rendering helpers for `apps/api` export routes (E1, `docs/backlog/
 * REVISI_CDPS_SALES_CREATIVE_PERFORMA.md`).
 *
 * Delimiter is `;`, not `,`: Excel under an Indonesian (or most non-US)
 * locale treats `;` as the list separator and would otherwise dump a
 * comma-delimited file into a single column per row. BOM (`﻿`) so
 * Excel recognizes the file as UTF-8 instead of guessing a legacy codepage
 * and mangling non-ASCII names. No `sep=;` directive line — that fixes
 * Excel but breaks a strict RFC 4180 parser (Google Sheets included), and a
 * file this is imported into is a real use case here (M1 Leads Database).
 *
 * `web-internal`'s own `csvEscape` (`(shell)/leads/page.tsx`) is NOT reused
 * — `apps/api` never imports from `web-internal` — but the logic is the
 * same shape, extended for the `;` delimiter: a field containing `;` MUST
 * be quoted here (it wasn't a delimiter for the comma-based helper, so
 * that regex never needed to catch it).
 */

/** BOM that makes Excel recognize the file as UTF-8. */
export const CSV_BOM = '﻿';

/** The field delimiter — `;`, not `,` (Excel Indonesia locale). */
export const CSV_DELIMITER = ';';

/** csvEscape quotes a field iff it contains the delimiter, a quote, or a newline. */
export function csvEscape(value: string): string {
  if (/[",;\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * toCsv renders rows (already-stringified cells) as `;`-delimited CSV with
 * CRLF line endings and a leading BOM. `header` is one row, rendered first.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(CSV_DELIMITER));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
