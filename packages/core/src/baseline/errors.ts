/**
 * Baseline engine — hard-fail error (RAB-02, fix #2).
 *
 * A REQUIRED column that is absent (e.g. TikTok renamed it) must fail LOUDLY
 * with a Bahasa-Indonesia `[...]` message naming the column — not silently read
 * as 0 and fabricate a "GMV Rp. 0,00" finding. Distinct from a present-but-empty
 * cell, which stays 0 (house rule #5 message format).
 */
export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineError';
  }
}

const q = (c: string): string => `"${c}"`;

/** Throw a BI `[...]` hard-fail if any required column is absent from the sheet. */
export function requireCols(cols: string[], present: string[], fileLabel: string): void {
  const missing = cols.filter((c) => !present.includes(c));
  if (missing.length) {
    throw new BaselineError(
      `[kolom wajib ${missing.map(q).join(', ')} tidak ada di file ${fileLabel} — cek apakah file di-export dari menu yang benar dan barisnya belum diedit]`,
    );
  }
}
