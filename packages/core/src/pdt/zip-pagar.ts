/**
 * PDT (Pusat Data Toko) — pagar paket ZIP (G1-04, PRD §3.8 Rule 38-44, §6.7).
 *
 * Fungsi ini MURNI — menerima metadata entri yang sudah dibaca dari direktori
 * pusat ZIP (nama, ukuran terkompresi, ukuran asli, status enkripsi), TANPA
 * pernah membuka/mendekompres satu entri pun. Ini menegakkan Rule 42 secara
 * harfiah: *"Terlampaui ⇒ paket ditolak SEBELUM entri mana pun dibaca."*
 * Pembaca ZIP sungguhan (yang benar-benar membuka berkas, mengekstrak
 * streaming ke disk, menghitung sha256) hidup di `apps/api/src/lib/pdt-zip.ts`
 * — TIDAK di sini, supaya keputusan (apa yang ditolak/dilewati/diproses) bisa
 * diuji tanpa I/O sama sekali, konsisten dengan `detect.ts`/`angka.ts`.
 *
 * Rule 38-40: satu batch = satu ZIP, nama berkas di dalamnya tidak diatur,
 * struktur folder diabaikan (dibaca rata). Rule 41 (per-entri):
 *   - **Ditolak** (paket TIDAK gagal total, tapi entri itu tidak diproses —
 *     jadi kegagalan parse bernama per berkas, Rule 10, bukan menelan diam-diam):
 *     ZIP bersarang (ekstensi `.zip`), entri terenkripsi/berkata sandi,
 *     ekstensi di luar `.xlsx`/`.xls`/`.csv`, path zip-slip (keluar akar arsip).
 *   - **Dilewati TANPA peringatan** (bukan penolakan — sample nyata membawanya
 *     dan itu normal untuk ZIP dari macOS): `__MACOSX/`, `.DS_Store`, `._*`.
 * Rule 42 (agregat paket, DIPERIKSA LEBIH DULU sebelum entri diklasifikasi
 * sama sekali): ukuran paket ≤ 50 MB, jumlah entri (mentah, dari direktori
 * pusat — cara termurah menghitungnya SEBELUM tahu mana yang junk/valid) ≤ 40,
 * rasio dekompresi TOTAL (Σ ukuran asli ÷ ukuran paket terkompresi) ≤ 100:1.
 */

const BATAS_UKURAN_PAKET_BYTES = 50 * 1024 * 1024; // Rule 42
const BATAS_JUMLAH_ENTRI = 40; // Rule 42
const BATAS_RASIO_DEKOMPRESI = 100; // Rule 42

const EKSTENSI_DIDUKUNG = new Set(['.xlsx', '.xls', '.csv']); // Rule 41

export interface PdtZipEntryMeta {
  /** Nama entri APA ADANYA di dalam ZIP (Rule 39 — tidak diatur/divalidasi selain pagar ini). */
  nama: string;
  ukuranTerkompresi: number;
  ukuranAsli: number;
  terenkripsi: boolean;
}

export type PdtZipEntriKeputusan =
  | { kode: 'diproses' }
  | { kode: 'dilewati'; alasan: 'macos_junk' }
  | { kode: 'ditolak'; alasan: 'zip_bersarang' | 'terenkripsi' | 'ekstensi_tidak_didukung' | 'zip_slip' };

export interface PdtZipEntriHasil {
  meta: PdtZipEntryMeta;
  keputusan: PdtZipEntriKeputusan;
}

export type PdtZipAlasanTolakPaket = 'ukuran_melebihi_50mb' | 'entri_melebihi_40' | 'rasio_dekompresi_melebihi_100x';

export interface PdtZipPagarHasil {
  ok: boolean;
  /** Terisi hanya bila `ok=false` KARENA gerbang paket (Rule 42) — bukan karena satu/lebih entri ditolak (Rule 41, itu tidak menggagalkan paket). */
  alasanTolakPaket?: PdtZipAlasanTolakPaket;
  /** Kosong bila `alasanTolakPaket` terisi — Rule 42: "ditolak sebelum entri mana pun dibaca", jadi entri sengaja TIDAK diklasifikasi. */
  entri: readonly PdtZipEntriHasil[];
}

function namaDasar(nama: string): string {
  const bersih = nama.replace(/\\/g, '/');
  const idx = bersih.lastIndexOf('/');
  return idx === -1 ? bersih : bersih.slice(idx + 1);
}

/** Rule 41 — entri macOS yang dilewati TANPA peringatan (bukan penolakan). */
function isMacosJunk(nama: string): boolean {
  const posix = nama.replace(/\\/g, '/');
  if (posix.startsWith('__MACOSX/') || posix.includes('/__MACOSX/')) return true;
  const dasar = namaDasar(posix);
  return dasar === '.DS_Store' || dasar.startsWith('._');
}

/**
 * Rule 41 zip-slip — path yang, setelah dinormalisasi, keluar dari akar arsip
 * (mis. `../../etc/passwd.xlsx`) atau path absolut (`/etc/passwd.xlsx`,
 * `C:\...`). Diperiksa di STRING mentah, tanpa filesystem apa pun — pencocok
 * ini hanya memutuskan, ekstraksi sungguhan (`apps/api/src/lib/pdt-zip.ts`)
 * yang menulis ke disk.
 */
function isZipSlip(nama: string): boolean {
  const posix = nama.replace(/\\/g, '/');
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return true;
  const segmen = posix.split('/');
  let kedalaman = 0;
  for (const s of segmen) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      kedalaman--;
      if (kedalaman < 0) return true;
    } else {
      kedalaman++;
    }
  }
  return false;
}

function ekstensi(nama: string): string {
  const dasar = namaDasar(nama);
  const idx = dasar.lastIndexOf('.');
  return idx === -1 ? '' : dasar.slice(idx).toLowerCase();
}

function klasifikasiEntri(meta: PdtZipEntryMeta): PdtZipEntriKeputusan {
  if (isMacosJunk(meta.nama)) return { kode: 'dilewati', alasan: 'macos_junk' };
  if (isZipSlip(meta.nama)) return { kode: 'ditolak', alasan: 'zip_slip' };
  if (meta.terenkripsi) return { kode: 'ditolak', alasan: 'terenkripsi' };
  const ext = ekstensi(meta.nama);
  if (ext === '.zip') return { kode: 'ditolak', alasan: 'zip_bersarang' };
  if (!EKSTENSI_DIDUKUNG.has(ext)) return { kode: 'ditolak', alasan: 'ekstensi_tidak_didukung' };
  return { kode: 'diproses' };
}

export interface PdtZipPaket {
  /** Ukuran paket ZIP itu sendiri (bytes) — bukan jumlah `ukuranTerkompresi` entri (paket punya overhead direktori pusat). */
  ukuranPaketBytes: number;
  entries: readonly PdtZipEntryMeta[];
}

/** Evaluasi pagar Rule 41-42 dari metadata direktori pusat SAJA — nol I/O. */
export function evaluatePdtZipPagar(paket: PdtZipPaket): PdtZipPagarHasil {
  // Rule 42 — gerbang paket LEBIH DULU, sebelum satu entri pun diklasifikasi.
  if (paket.ukuranPaketBytes > BATAS_UKURAN_PAKET_BYTES) {
    return { ok: false, alasanTolakPaket: 'ukuran_melebihi_50mb', entri: [] };
  }
  if (paket.entries.length > BATAS_JUMLAH_ENTRI) {
    return { ok: false, alasanTolakPaket: 'entri_melebihi_40', entri: [] };
  }
  const totalAsli = paket.entries.reduce((a, e) => a + e.ukuranAsli, 0);
  // Paket kosong (nol entri) tidak punya rasio yang berarti — lolos gerbang ini, bukan div/0.
  if (paket.ukuranPaketBytes > 0) {
    const rasio = totalAsli / paket.ukuranPaketBytes;
    if (rasio > BATAS_RASIO_DEKOMPRESI) {
      return { ok: false, alasanTolakPaket: 'rasio_dekompresi_melebihi_100x', entri: [] };
    }
  }

  // Gerbang paket lolos — sekarang klasifikasi per entri (Rule 41). Satu/lebih
  // entri "ditolak" TIDAK menggagalkan paket ini sendiri (beda dari Rule 42) —
  // itu jadi kegagalan parse BERNAMA per berkas di lapisan pemanggil (Rule 10).
  const entri = paket.entries.map((meta) => ({ meta, keputusan: klasifikasiEntri(meta) }));
  return { ok: true, entri };
}

const PESAN_ALASAN_TOLAK_ENTRI: Record<Extract<PdtZipEntriKeputusan, { kode: 'ditolak' }>['alasan'], string> = {
  zip_bersarang: 'adalah ZIP bersarang, tidak didukung',
  terenkripsi: 'terenkripsi/berkata sandi, tidak dapat dibaca',
  ekstensi_tidak_didukung: 'berekstensi tidak didukung (hanya .xlsx/.xls/.csv)',
  zip_slip: 'memiliki path tidak valid, dilewati',
};

/**
 * Rule 41 (G1-09): pesan BI `[...]` (aturan rumah #5) untuk satu entri
 * ber-`keputusan.kode === 'ditolak'` — dipakai pemanggil (route pratinjau
 * batch) untuk menampilkan berkas yang pagar tolak SEBELUM sempat diekstrak,
 * beda dari kegagalan decode (Rule 10, `turunkanParseStatus`).
 */
export function formatAlasanTolakEntri(nama: string, alasan: Extract<PdtZipEntriKeputusan, { kode: 'ditolak' }>['alasan']): string {
  return `[berkas '${nama}' ${PESAN_ALASAN_TOLAK_ENTRI[alasan]}]`;
}

const PESAN_ALASAN_TOLAK_PAKET: Record<PdtZipAlasanTolakPaket, string> = {
  ukuran_melebihi_50mb: '[paket ZIP melebihi 50 MB]',
  entri_melebihi_40: '[paket ZIP berisi lebih dari 40 entri]',
  rasio_dekompresi_melebihi_100x: '[paket ZIP mencurigakan — rasio dekompresi melebihi 100:1]',
};

/** Rule 42: pesan BI `[...]` untuk paket yang ditolak SEBELUM satu entri pun diklasifikasi. */
export function formatAlasanTolakPaket(alasan: PdtZipAlasanTolakPaket): string {
  return PESAN_ALASAN_TOLAK_PAKET[alasan];
}
