// Tautan-dalam `/account/pdt/upload?client=…&platform=…` — aturan murni, nol
// fetch, nol import runtime.
//
// ## Kenapa ini modul tersendiri, bukan beberapa baris di dalam halamannya
//
// Sama alasan dengan `ads-client-picker.ts`: satu aturan di sini LOAD-BEARING
// dan gagalnya SENYAP.
//
// Sebuah `<select>` terkendali yang `value`-nya tidak cocok dengan satu pun
// `<option>` tidak mengeluh — browser menampilkan opsi PERTAMA sementara state
// React tetap memegang nilai yang tadi. Di halaman Upload PDT akibatnya bukan
// sekadar tampilan: `riwayatBatchPdt(platformId)` dan `siapkanUploadBatchPdt(
// platformId)` memakai STATE, bukan yang terlihat. AM akan melihat "— pilih
// platform —" di layar sambil halaman diam-diam menyiapkan unggahan untuk toko
// LAIN. Itulah kenapa parameter di sini divalidasi terhadap daftar yang benar-
// benar dimuat, bukan dipercaya begitu saja.
//
// Dependency-free ON PURPOSE (preseden `ads-client-picker` / `asset-picker`):
// alias `@/` tidak diresolusi vitest, jadi logika yang bisa diuji tidak boleh
// tinggal di modul yang meng-import `lib/api`.

/** Nama parameter — satu tempat, supaya penulis tautan dan pembacanya tak bisa berbeda. */
export const PARAM_KLIEN = 'client';
export const PARAM_PLATFORM = 'platform';
/** Ke mana AM kembali sesudah batch tersimpan (G1-KEMBALI). */
export const PARAM_KEMBALI = 'dari';

/** Papan Account & Service — tujuan kembali baku, selalu ditawarkan. */
export const ACCOUNT_BOARD_PATH = '/account';

/** Halaman tujuan (G1-09 sub-langkah 3). */
export const PDT_UPLOAD_PATH = '/account/pdt/upload';

/**
 * Bangun tautan ke halaman Upload PDT dengan klien (dan opsional toko) sudah
 * terpilih.
 *
 * `clientPlatformId` boleh `null` — itu keadaan yang wajar, bukan kesalahan:
 * pemanggil (mis. Section B Strategi) sering tahu kliennya tapi belum tahu toko
 * mana yang dimaksud AM. Halaman tujuan akan meminta AM memilih tokonya.
 */
export function pdtUploadHref(
  clientId: string,
  clientPlatformId?: number | null,
  kembali?: string | null,
): string {
  const id = clientId.trim();
  if (id === '') return PDT_UPLOAD_PATH;
  const q = new URLSearchParams({ [PARAM_KLIEN]: id });
  if (typeof clientPlatformId === 'number' && Number.isInteger(clientPlatformId) && clientPlatformId > 0) {
    q.set(PARAM_PLATFORM, String(clientPlatformId));
  }
  // `dari` hanya ikut kalau ia memang jalur internal yang aman — divalidasi
  // dengan fungsi yang SAMA dengan pembacanya, supaya penulis tautan tidak bisa
  // menghasilkan nilai yang nanti diam-diam dibuang.
  const aman = kembali === undefined ? null : jalurKembaliAman(kembali);
  if (aman !== null) q.set(PARAM_KEMBALI, aman);
  return `${PDT_UPLOAD_PATH}?${q.toString()}`;
}

/**
 * Jalur kembali yang boleh dipakai, atau `null`.
 *
 * Ini gerbang open-redirect, bukan sekadar rapi-rapi: nilainya datang dari
 * query string, yang siapa pun bisa susun. Yang diterima HANYA jalur internal
 * absolut — satu garis miring di depan, bukan dua.
 *
 * Yang ditolak dan kenapa:
 * - `//evil.test/x` — protocol-relative, browser membacanya sebagai host LAIN.
 * - `https://evil.test` (atau skema apa pun) — jelas eksternal.
 * - `/\evil.test` — sebagian browser memperlakukan `\` seperti `/`, jadi ini
 *   protocol-relative yang menyamar.
 * - jalur dengan karakter kontrol/spasi — bisa dipakai menyelundupkan `\n`
 *   ke header atau mengelabui pemeriksaan awalan.
 */
export function jalurKembaliAman(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  if (!v.startsWith('/')) return null;
  if (v.startsWith('//') || v.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\u007f\s\\]/.test(v)) return null;
  return v;
}

/** `?dari=` → jalur kembali internal yang aman, atau `null`. */
export function bacaParamKembali(get: (k: string) => string | null): string | null {
  return jalurKembaliAman(get(PARAM_KEMBALI));
}

/** `?client=` → ID klien, atau `''` bila tak ada/kosong. Nilainya TIDAK divalidasi di sini — lihat `butuhOpsiBayanganKlien`. */
export function bacaParamKlien(get: (k: string) => string | null): string {
  return (get(PARAM_KLIEN) ?? '').trim();
}

/**
 * `?platform=` → `client_platform_id`, atau `null`.
 *
 * Hanya bilangan bulat positif yang diterima. `Number('')` adalah `0` dan
 * `Number('12abc')` adalah `NaN`; keduanya harus jatuh ke `null`, bukan ke
 * angka yang kebetulan lolos ke `riwayatBatchPdt`.
 */
export function bacaParamPlatform(get: (k: string) => string | null): number | null {
  const raw = (get(PARAM_PLATFORM) ?? '').trim();
  if (raw === '') return null;
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Baris klien seminimal yang picker butuhkan. */
export interface PdtClientRow {
  id: string;
  toko: string;
}

/**
 * Perlukah opsi bayangan untuk klien `value`?
 *
 * `true` hanya kalau ada sesuatu yang dipilih DAN ia tidak ada di daftar yang
 * dimuat. Tautan `?client=…` bisa membawa ID klien di luar scope baca aktor
 * (mis. AM lain), dan tanpa opsi bayangan `<select>`-nya akan menampilkan
 * "— pilih klien —" sementara state tetap memegang ID itu.
 */
export function butuhOpsiBayanganKlien(value: string, clients: readonly PdtClientRow[]): boolean {
  if (value === '') return false;
  return !clients.some((c) => c.id === value);
}

/** Satu baris dropdown klien: nama toko dulu (yang orang ingat), lalu ID-nya. */
export function labelKlienPdt(c: PdtClientRow): string {
  return `${c.toko} (${c.id})`;
}

/** Opsi dropdown klien, berurutan — dikembalikan sebagai data supaya bisa diuji. */
export function opsiKlienPdt(
  value: string,
  clients: readonly PdtClientRow[],
  opts: { loading: boolean },
): { value: string; label: string }[] {
  const out = [{ value: '', label: opts.loading ? 'Memuat klien…' : '— pilih klien —' }];
  if (butuhOpsiBayanganKlien(value, clients)) {
    out.push({ value, label: `${value} (di luar daftar klien Anda)` });
  }
  for (const c of clients) out.push({ value: c.id, label: labelKlienPdt(c) });
  return out;
}

/** Baris toko seminimal yang validasi butuhkan. */
export interface PdtPlatformRow {
  client_platform_id: number;
}

/**
 * Toko `diminta` (dari `?platform=`) boleh dipakai?
 *
 * Untuk toko TIDAK ada opsi bayangan — dan itu disengaja. Daftar toko
 * (`listPlatformPdtKlien`) sudah dipersempit ke Shopee/TikTok Shop yang AKTIF;
 * ID di luar daftar berarti toko tidak aktif, bukan platform PDT, atau milik
 * klien lain — ketiganya akan ditolak server (`[platform toko '…' tidak
 * didukung PDT …]` / gerbang izin). Menawarkannya sebagai pilihan hanya
 * memindahkan penolakan ke langkah yang lebih jauh, setelah ZIP diunggah.
 *
 * Mengembalikan `null` berarti "abaikan parameternya, minta AM memilih".
 */
export function platformDipakai(
  diminta: number | null,
  options: readonly PdtPlatformRow[],
): number | null {
  if (diminta === null) return null;
  return options.some((p) => p.client_platform_id === diminta) ? diminta : null;
}
