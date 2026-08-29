/**
 * Registry divisi CDPS (M16) — SATU sumber kebenaran untuk "divisi apa saja yang
 * ada, dan masing-masing boleh apa".
 *
 * KENAPA ADA. Sebelum modul ini, daftar divisi `['Creative','Ads','KOL','Live
 * Stream']` ditulis ulang di sembilan tempat: `account.ALLOWED_DIVISIONS` +
 * `account.BRIEF_ASSIGNABLE_DIVISIONS`, `strategi.DISPATCH_DIVISIONS`,
 * `recap.DIVISIONS`, `plan.ts`, `board.ts` (switch), `performance.ts`, dan dua
 * salinan di `web-internal`. Menambah satu divisi berarti membedah semuanya —
 * dan melewatkan satu saja menghasilkan divisi yang bisa menerima Brief tapi
 * tidak muncul di rekap, atau sebaliknya. Pemilik meminta divisi baru bisa
 * ditambahkan (AI Optimizer, lalu Store Operation dalam sesi yang sama), jadi
 * duplikasi itu berhenti di sini.
 *
 * DUAL-HOME, seperti registry prefix ID. Kebenarannya hidup di DUA tempat yang
 * dijaga tetap identik: konstanta di berkas ini dan tabel `division_registry`.
 * `packages/db/src/division.registry.test.ts` gagal kalau keduanya berbeda.
 * Polanya sengaja meniru `PREFIXES` + `entity_prefix` + `ident.registry.test.ts`:
 * tipe TS tetap sempit (banyak kode bergantung pada union nama divisi) sekaligus
 * penambahan divisi cukup satu baris di sini + satu migrasi.
 *
 * `nama` MEMAKAI LABEL LAMA APA ADANYA (`'Live Stream'`, bukan `'LIVE'`).
 * `briefs.assigned_division`, `role_mappings.division`, dan `wrr_divisi.divisi`
 * semuanya menyimpan string label itu — memakai kode pendek akan menuntut migrasi
 * data pada tiga tabel produksi. Kode pendek hanya kunci registry, tidak pernah
 * ditulis ke baris kerja.
 *
 * TIGA FLAG, BUKAN SATU. Ketiga daftar lama TIDAK identik, dan perbedaannya
 * disengaja (lihat komentar `ALLOWED_DIVISIONS` di `account.ts`): memperlebar
 * himpunan "punya kuota satuan" tanpa entri `TASK_CATALOG` akan meng-crash
 * comparator `normalizeTasks` (`TASK_CATALOG[a.divisi].findIndex(...)` atas
 * `undefined`). Jadi tiap sifat punya flag sendiri, dan menambah divisi berarti
 * memilih flag secara sadar — bukan mewarisi keempatnya sekaligus.
 */

/** Satu divisi beserta apa yang boleh dilakukannya. */
export interface Division {
  /** Kunci registry. Tidak pernah ditulis ke baris kerja — lihat header. */
  readonly code: string;
  /** Label BI yang tersimpan di `briefs.assigned_division` dkk. */
  readonly nama: string;
  /** Divisi nonaktif tidak muncul di picker mana pun, tapi barisnya tetap ada. */
  readonly aktif: boolean;
  /** Boleh jadi `briefs.assigned_division` (M6B PC-8). */
  readonly briefAssignable: boolean;
  /** Boleh jadi tujuan dispatch Strategi (M6A I-2). */
  readonly dispatchTarget: boolean;
  /**
   * Punya entri `account.TASK_CATALOG` ⇒ boleh muncul di kuota task satuan
   * Strategi. **Wajib false kalau `TASK_CATALOG` belum punya barisnya** —
   * inilah flag yang meng-crash `normalizeTasks` kalau salah.
   */
  readonly punyaKuotaSatuan: boolean;
  /** Dikerjakan vendor luar, bukan staff internal (Live Stream). */
  readonly vendorManaged: boolean;
  /** Urutan tampil di picker dan laporan. */
  readonly urutan: number;
}

/**
 * Registry kanonik. Enam baris pertama adalah divisi yang sudah ada sejak Wave 2
 * — flag-nya disalin PERSIS dari perilaku sebelum M16, supaya penggantian
 * sembilan literal itu nol-perilaku. Dua terakhir baru (M16/M17).
 */
export const DIVISIONS: readonly Division[] = [
  { code: 'CREATIVE',  nama: 'Creative',       aktif: true, briefAssignable: true, dispatchTarget: true,  punyaKuotaSatuan: true,  vendorManaged: false, urutan: 1 },
  { code: 'ADS',       nama: 'Ads',            aktif: true, briefAssignable: true, dispatchTarget: true,  punyaKuotaSatuan: true,  vendorManaged: false, urutan: 2 },
  { code: 'KOL',       nama: 'KOL',            aktif: true, briefAssignable: true, dispatchTarget: true,  punyaKuotaSatuan: true,  vendorManaged: false, urutan: 3 },
  { code: 'LIVE',      nama: 'Live Stream',    aktif: true, briefAssignable: true, dispatchTarget: true,  punyaKuotaSatuan: true,  vendorManaged: true,  urutan: 4 },
  // Account/Ops: divisi PIC baris Plan yang mengerjakan pekerjaan internalnya
  // sendiri. Brief ke sana dibaca lewat antrian `/tasks` generik, bukan board
  // divisi (keputusan pemilik 2026-08-27) — jadi bukan dispatch target Strategi
  // dan tidak punya kuota satuan.
  { code: 'ACCOUNT',   nama: 'Account',        aktif: true, briefAssignable: true, dispatchTarget: false, punyaKuotaSatuan: false, vendorManaged: false, urutan: 5 },
  { code: 'OPS',       nama: 'Ops',            aktif: true, briefAssignable: true, dispatchTarget: false, punyaKuotaSatuan: false, vendorManaged: false, urutan: 6 },
  // M17 — optimasi SKU klien + pembuatan AI video. `punyaKuotaSatuan: true`
  // hanya sah karena `TASK_CATALOG` mendapat barisnya di migrasi yang sama.
  { code: 'AI_OPT',    nama: 'AI Optimizer',   aktif: true, briefAssignable: true, dispatchTarget: true,  punyaKuotaSatuan: true,  vendorManaged: false, urutan: 7 },
  // M16 — daftar pekerjaan menyusul (DECISIONS.md LT-2). Sengaja TANPA kuota
  // satuan: `TASK_CATALOG` belum punya barisnya, dan menyalakan flag ini tanpa
  // itu akan meng-crash `normalizeTasks`. Brief tetap bisa didispatch dan
  // `Cek Brief AM` tetap terukur — itulah gunanya flag dipisah.
  { code: 'STORE_OPS', nama: 'Store Operation', aktif: true, briefAssignable: true, dispatchTarget: true, punyaKuotaSatuan: false, vendorManaged: false, urutan: 8 },
];

/** Urutan tampil, hanya yang aktif. */
function aktifTerurut(): Division[] {
  return DIVISIONS.filter((d) => d.aktif).sort((a, b) => a.urutan - b.urutan);
}

/** Nama divisi yang boleh menerima Brief (`account.BRIEF_ASSIGNABLE_DIVISIONS`). */
export function briefAssignableNames(): string[] {
  return aktifTerurut().filter((d) => d.briefAssignable).map((d) => d.nama);
}

/** Nama divisi tujuan dispatch Strategi (`strategi.DISPATCH_DIVISIONS`). */
export function dispatchNames(): string[] {
  return aktifTerurut().filter((d) => d.dispatchTarget).map((d) => d.nama);
}

/** Nama divisi yang punya kuota task satuan (`account.ALLOWED_DIVISIONS`). */
export function kuotaSatuanNames(): string[] {
  return aktifTerurut().filter((d) => d.punyaKuotaSatuan).map((d) => d.nama);
}

/** Cari satu divisi berdasarkan label BI-nya; `undefined` kalau tidak terdaftar. */
export function byNama(nama: string): Division | undefined {
  return DIVISIONS.find((d) => d.nama === nama);
}

/** Apakah divisi ini dikerjakan vendor luar (Live Stream)? */
export function isVendorManaged(nama: string): boolean {
  return byNama(nama)?.vendorManaged === true;
}
