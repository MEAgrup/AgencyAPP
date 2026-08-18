/**
 * Baseline engine — sheet reading + header detection (RAB-02).
 * Ported VERBATIM from the tool (`readSheet`, `cleanRows`, `periodeOf`,
 * `periode2key`, lines 441-484 / 601-605 / 677-678).
 *
 * ⛔ JANGAN ubah heuristik deteksi header: ia menangani header kedua ("Data
 * harian") dan baris filter `"Semua","Semua",…` lewat hitungan LABEL UNIK.
 *
 * Input is an already-parsed array-of-arrays (the caller runs
 * `XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:false})`
 * — kept out of core so this stays DOM/dep free, see types.ts).
 */
import type { Aoa, Sheet } from './types';

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

export const has = (d: Pick<Sheet, 'cols'>, c: string): boolean => d.cols.includes(c);

/** "sel mirip label": teks pendek yang bukan nilai (bukan Rp…, bukan angka/persen/tanggal). */
function labelLike(x: unknown): boolean {
  if (typeof x !== 'string') return false;
  const s = x.trim();
  if (s.length < 2 || s.length > 70) return false;
  if (/^rp/i.test(s)) return false;
  if (/^[\d]/.test(s)) return false;
  if (/^[\d.,%+\-\s]+$/.test(s)) return false;
  return true;
}

/**
 * Detect the header row in the first 8 rows and key data rows by column name.
 * Returns null when no header-like row is found (caller emits the BI `[...]`
 * message). Duplicate column names get an `#j` suffix on the later columns
 * (exactly the tool's behaviour).
 */
export function readSheet(aoa: Aoa, fname: string): Sheet | null {
  const cnt: number[] = [];
  for (let i = 0; i < Math.min(8, aoa.length); i++) {
    // label UNIK: baris filter ("Semua","Semua",…) punya banyak sel tapi sedikit label unik
    cnt.push(new Set((aoa[i] || []).filter(labelLike).map((x) => (x as string).trim())).size);
  }
  const mx = Math.max(...cnt, 0);
  if (mx < 2) return null;
  // baris header PALING AWAL yang jumlah labelnya mendekati maksimum —
  // penting karena Analitik Toko punya header kedua (Data harian) di bawah
  const hi = cnt.findIndex((c) => c >= mx * 0.9 && c >= 2);
  if (hi < 0) return null;
  const cols = (aoa[hi] || []).map((x, j) => (x == null || String(x).trim() === '' ? '__c' + j : String(x).trim()));
  const rows: Record<string, unknown>[] = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (!r.some((x) => x != null && x !== '')) continue;
    const o: Record<string, unknown> = {};
    cols.forEach((c, j) => {
      if (o[c] === undefined) o[c] = r[j];
      else o[c + '#' + j] = r[j];
    });
    rows.push(o);
  }
  // header meta (baris pertama biasanya rentang tanggal)
  const meta = (aoa[0] || []).map((x) => (x == null ? '' : String(x))).join(' ');
  return { file: fname, cols, rows, meta, headerRow: hi };
}

/**
 * Buang baris keterangan/tooltip: kalau kolom angka utama isinya teks panjang.
 * (Defensif — tak dipanggil di tool v1, disediakan untuk adapter FE.)
 */
export function cleanRows(d: Sheet, numCol?: string): Sheet {
  if (!numCol || !has(d, numCol)) return d;
  d.rows = d.rows.filter((r) => {
    const v = r[numCol];
    if (v == null || v === '') return true;
    if (typeof v === 'number') return true;
    const s = String(v);
    return s.length < 40 || /^[\dRp.,%\-\s]+$/.test(s);
  });
  return d;
}

/** Ambil bulan referensi dari meta rentang tanggal, mis. "Agu 2026". */
export function periodeOf(meta: unknown): string {
  const s = String(meta);
  const m = s.match(/(\d{4})[-/](\d{2})[-/](\d{2})\s*[~–-]/) || s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  if (m[0].includes('/') && m[3] && m[3].length === 4) return MON[+m[2] - 1] + ' ' + m[3];
  return MON[+m[2] - 1] + ' ' + m[1];
}

/** "Agu 2026" → "2026-08" (tool `periode2key`). */
export function periode2key(p: unknown): string {
  if (!p) return '';
  const [m, y] = String(p).split(' ');
  const i = (MON as readonly string[]).indexOf(m);
  return i < 0 ? '' : y + '-' + String(i + 1).padStart(2, '0');
}
