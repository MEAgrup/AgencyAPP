/**
 * PDT (Pusat Data Toko) — pencocok tanda tangan generik (G1-02).
 *
 * Satu fungsi pencocokan untuk SELURUH baris `pdt_parser_modul`, menggantikan
 * empat pencocok terpisah (`baseline/detect.ts`, `report/detect.ts`,
 * `report/shopee/detect.ts`, `adsscanner/tiktok/detect.ts`) dengan satu bentuk
 * deklaratif (`PdtSignature`, lihat `types.ts`).
 *
 * Rule 6 (⛔ TIDAK PERNAH bergantung nama berkas) dan Rule 7 (baris header
 * dicari, tidak diasumsikan) berlaku sekaligus: pencocokan memindai SELURUH
 * baris sheet (bukan indeks tetap), dan parameternya hanya isi sheet — nama
 * berkas tidak pernah masuk fungsi ini.
 */
import type { PdtMatchGroup, PdtModuleDef, PdtSignature } from './types';

/**
 * Setiap baris sheet diratakan jadi satu string huruf-kecil (sel digabung
 * dengan pemisah yang tak mungkin muncul di isi kolom), supaya pencarian
 * "muncul di suatu baris" bertahan pada seluruh variasi tata letak header
 * yang sudah terbukti di 4 registry lama: header satu baris, header 2 lapis,
 * baris penanda seksi sebelum header (`shopee_shop_stats`), dan baris header
 * yang posisinya berbeda antar modul.
 */
function rowsToHaystack(rows: readonly (readonly unknown[])[]): string[] {
  return rows.map((row) => (row ?? []).map((c) => (c == null ? '' : String(c)).trim().toLowerCase()).join(' ␟ '));
}

const norm = (s: string): string => s.trim().toLowerCase();

const containsSomewhere = (haystack: readonly string[], needle: string): boolean => {
  const n = norm(needle);
  return haystack.some((row) => row.includes(n));
};

function matchesGroup(haystack: readonly string[], group: PdtMatchGroup): boolean {
  const must = group.must ?? [];
  const mustNot = group.mustNot ?? [];
  return must.every((m) => containsSomewhere(haystack, m)) && mustNot.every((m) => !containsSomewhere(haystack, m));
}

/** Cocokkan satu tanda tangan terhadap isi sheet (array-of-arrays mentah). */
export function matchesSignature(rows: readonly (readonly unknown[])[], sig: PdtSignature): boolean {
  const haystack = rowsToHaystack(rows);
  if (!matchesGroup(haystack, sig)) return false;
  if (sig.anyOf && sig.anyOf.length > 0) return sig.anyOf.some((g) => matchesGroup(haystack, g));
  return true;
}

export interface DetectPdtModuleResult {
  /** Kode modul bila TEPAT satu tanda tangan cocok; `null` bila nol atau lebih dari satu. */
  kode: string | null;
  /** True bila LEBIH dari satu modul cocok — AM harus memilih manual (dropdown, Rule G1-09), bukan ditebak. */
  ambiguous: boolean;
  /** Seluruh kode modul yang cocok, urutan sesuai daftar `modules` yang diberikan. */
  matches: readonly string[];
}

/**
 * Klasifikasikan satu sheet terhadap registry `pdt_parser_modul` (biasanya:
 * seluruh baris berplatform sama dengan batch yang sedang diproses).
 *
 * Sengaja TIDAK "menang otomatis lewat urutan pertama" ketika lebih dari satu
 * modul cocok — beberapa modul (`shopee_diskon`/`shopee_flash_sale`,
 * `shopee_video` — lihat `modules.ts`) memang belum punya sinyal isi yang
 * terverifikasi cukup untuk membedakan dari modul lain, dan menebak salah
 * slot lebih berbahaya daripada tidak terdeteksi (UAT Fim Motor,
 * `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md` §3).
 */
export function detectPdtModule(rows: readonly (readonly unknown[])[], modules: readonly PdtModuleDef[]): DetectPdtModuleResult {
  const matches = modules.filter((m) => matchesSignature(rows, m.tandaTanganKolom)).map((m) => m.kode);
  if (matches.length === 1) return { kode: matches[0], ambiguous: false, matches };
  return { kode: null, ambiguous: matches.length > 1, matches };
}
