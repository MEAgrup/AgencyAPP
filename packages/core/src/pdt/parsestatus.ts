/**
 * PDT (Pusat Data Toko) — kegagalan parse tidak ditelan (G1-08, PRD §3.2
 * Rule 9-10, PDT_BACKLOG.md G1-08).
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (belum ada, G1-09) yang
 * menulis `pdt_file.parse_status`/`parse_error`.
 *
 * ⚠️ **Status `sebagian` BELUM punya pemicu terdefinisi.** `pdt_file.parse_status`
 * (migrasi G1-01) sudah punya CHECK `ok`/`sebagian`/`gagal`, tapi PRD/backlog
 * tidak pernah merinci APA yang membuat suatu berkas `sebagian` (bukan `ok`
 * atau `gagal`) — kandidat paling wajar ("kolom OPSIONAL hilang, kolom WAJIB
 * lengkap") butuh pembedaan bucket-1 (wajib)/bucket-2 (opsional) PER KOLOM di
 * `PdtModuleDef.kolomDipanen`, yang hari ini masih array datar tanpa
 * pembedaan itu (lihat `PDT_KOLOM_DIPANEN.md` yang membedakannya per
 * dokumen, bukan per kode). Fungsi di sini SENGAJA hanya menurunkan `ok`/
 * `gagal` — dicatat `docs/DECISIONS.md` G1-08-SEBAGIAN, bukan ditebak.
 */

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export interface PdtKolomWajibHasil {
  ditemukan: boolean;
  idx: number; // -1 bila tidak ditemukan
  lewatAlias: boolean;
}

/**
 * Cari SATU kolom wajib di baris header: exact match dulu, baru alias
 * (`pdt_kolom_alias`, G1-02/Rule 9 — "nama kolom berubah = kasus normal").
 */
export function cariKolomWajib(header: readonly unknown[], kolomKanonik: string, alias: readonly string[] = []): PdtKolomWajibHasil {
  const idxExact = header.findIndex((c) => norm(c) === norm(kolomKanonik));
  if (idxExact !== -1) return { ditemukan: true, idx: idxExact, lewatAlias: false };
  for (const a of alias) {
    const idxAlias = header.findIndex((c) => norm(c) === norm(a));
    if (idxAlias !== -1) return { ditemukan: true, idx: idxAlias, lewatAlias: true };
  }
  return { ditemukan: false, idx: -1, lewatAlias: false };
}

export interface PdtKolomWajibGagal {
  kolom: string;
  /** Bahasa Indonesia dalam kurung siku (aturan rumah #5), MENYEBUT nama kolom yang dicari (Rule 9). */
  pesan: string;
}

/**
 * Rule 9: validasi SELURUH kolom wajib sebuah modul terhadap satu header.
 * Setiap kolom yang tidak ditemukan DAN tidak punya alias yang cocok masuk
 * hasil (bisa lebih dari satu — batch tidak berhenti di kolom pertama yang
 * hilang, supaya AM melihat SEMUA kolom yang perlu diperbaiki sekaligus).
 */
export function validasiKolomWajib(
  header: readonly unknown[],
  kolomWajib: readonly string[],
  aliasPerKolom: Readonly<Record<string, readonly string[]>> = {},
): PdtKolomWajibGagal[] {
  const gagal: PdtKolomWajibGagal[] = [];
  for (const kolom of kolomWajib) {
    const hasil = cariKolomWajib(header, kolom, aliasPerKolom[kolom] ?? []);
    if (!hasil.ditemukan) gagal.push({ kolom, pesan: `[kolom wajib '${kolom}' tidak ditemukan di berkas]` });
  }
  return gagal;
}

export type PdtParseStatus = 'ok' | 'gagal';

export interface PdtParseStatusHasil {
  status: PdtParseStatus;
  /** `null` hanya bila `status === 'ok'` — cermin CHECK `ck_pdt_file_parse_error` (G1-01). */
  error: string | null;
}

/**
 * Rule 10: turunkan `parse_status`/`parse_error` dari kegagalan dekode
 * (G1-05, `PdtParseGagal.pesan`) DAN kolom wajib yang hilang (Rule 9) —
 * dua sumber kegagalan berbeda, satu status. **"Berkas tidak diunggah"
 * TIDAK PERNAH dipakai di sini** — parameter fungsi ini secara struktural
 * hanya bisa dipanggil untuk berkas yang SUDAH ada isinya (entri ZIP yang
 * `bacaDanEkstrakPdtZip` sudah ekstrak); ketidakhadiran berkas sama sekali
 * bukan kegagalan PARSE dan tidak pernah lewat fungsi ini.
 */
export function turunkanParseStatus(input: {
  decodeGagal: string | null;
  kolomWajibGagal: readonly PdtKolomWajibGagal[];
}): PdtParseStatusHasil {
  if (input.decodeGagal != null) return { status: 'gagal', error: input.decodeGagal };
  if (input.kolomWajibGagal.length > 0) {
    return { status: 'gagal', error: input.kolomWajibGagal.map((g) => g.pesan).join('; ') };
  }
  return { status: 'ok', error: null };
}

// ===========================================================================
// Rule 12 — skor netral 5/10 dihapus; dimensi tanpa berkas ⇒ null + bobot
// dinormalisasi ulang. Preseden: packages/domain/src/performance.ts Rule 6
// (M14) — algoritma DISALIN (bukan diimpor: core tidak boleh bergantung pada
// domain, arah dependensi repo ini domain → core, bukan sebaliknya), bentuk
// generik sehingga berlaku untuk dimensi skor PDT MANAPUN (TikTok/Shopee),
// bukan hanya salinan `report/shopee/skor.ts` yang masih dipakai mesin lama
// (PDT-17 strangler: tidak diubah di sini, tetap berjalan sampai dimatikan
// bertahap).
// ===========================================================================

/** Label tampil dimensi yang dikeluarkan dari pembobotan (Rule 12) — pengganti "netral (5/10)". */
export const LABEL_DIMENSI_TIDAK_TERSEDIA = 'data tidak tersedia';

export interface PdtDimensiSkor {
  kode: string;
  label: string;
  /** 0..1, Σ bobotDasar SELURUH dimensi modul = 1 (mis. 0.22 ROAS & Channel). */
  bobotDasar: number;
  /** `null` = berkasnya tidak ada — BUKAN skor 5 (Rule 12), dan BUKAN 0 (aturan rumah #4). */
  nilai: number | null;
}

export interface PdtDimensiSkorHasil extends PdtDimensiSkor {
  disertakan: boolean;
  /** 0 bila `disertakan` false; kalau tidak, `bobotDasar` dinormalisasi ulang terhadap Σ bobotDasar dimensi yang tersedia. */
  bobotEfektif: number;
  labelTampil: string;
}

/**
 * Rule 12: dimensi ber-`nilai: null` DIKELUARKAN dari pembobotan — bobot
 * dasar dimensi yang TERSEDIA dinormalisasi ulang supaya Σ bobot efektif = 1
 * (identik pola `performance.ts` `scoreProfile`, Rule 6 M14: `eff = base *
 * 100/Σavailable`, di sini dalam skala 0..1). Ini yang menutup bug
 * "ROAS berbobot 22% diberi 5/10" — dimensi yang absen tidak lagi menarik
 * total ke arah angka netral yang mengarang data.
 */
export function renormalisasiDimensi(dimensi: readonly PdtDimensiSkor[]): PdtDimensiSkorHasil[] {
  const availableBase = dimensi.filter((d) => d.nilai != null).reduce((s, d) => s + d.bobotDasar, 0);
  return dimensi.map((d) => {
    if (d.nilai == null) {
      return { ...d, disertakan: false, bobotEfektif: 0, labelTampil: LABEL_DIMENSI_TIDAK_TERSEDIA };
    }
    return { ...d, disertakan: true, bobotEfektif: availableBase > 0 ? d.bobotDasar / availableBase : 0, labelTampil: '' };
  });
}

/**
 * Total skor dari dimensi yang sudah dinormalisasi. `null` (bukan `0`) bila
 * SELURUH dimensi absen — aturan rumah #7 (pembagi-nol/ketiadaan → `—` di
 * tampilan, bukan `0` yang mengarang "performa terburuk").
 */
export function totalSkorDimensi(dimensi: readonly PdtDimensiSkorHasil[]): number | null {
  if (!dimensi.some((d) => d.disertakan)) return null;
  const total = dimensi.reduce((s, d) => s + (d.disertakan ? d.bobotEfektif * (d.nilai as number) : 0), 0);
  return Math.round(total * 100) / 100;
}
