/**
 * PDT (Pusat Data Toko) — tipe registry modul parser (G1-02, PRD §6.3/§7).
 *
 * `pdt_parser_modul.tanda_tangan_kolom` (jsonb) menyimpan EXACTLY the shape
 * declared here (`PdtSignature`) — lihat `modules.ts` untuk komentar "kenapa
 * bentuk ini" dan `detect.ts` untuk pencocokannya.
 */

/** Platform CHECK di `pdt_parser_modul` (migrasi G1-01). */
export type PdtPlatform = 'tiktok' | 'shopee' | 'meta';

/**
 * Versi mesin pipeline parse PDT (Rule 11) — dicatat ke
 * `pdt_upload_batch.parser_versi` dan (menyusul sub-langkah 2b) ke setiap
 * baris fakta. SATU angka global untuk seluruh pipeline G1-04..09 (bukan
 * per-modul — `pdt_parser_modul.versi` sudah memegang versi PER MODUL).
 * Naik hanya saat pipeline (deteksi/parse/identitas/periode) berubah dengan
 * cara yang mengubah hasil baris fakta — bukan setiap commit kode.
 */
export const PDT_PARSER_VERSI = 1;

/**
 * Satu grup AND/NOT: seluruh `must` harus muncul (cocok substring, tanpa
 * membedakan huruf besar/kecil) DI SUATU BARIS pada sheet, dan tak satu pun
 * `mustNot` boleh muncul. Ini mengizinkan kolom penanda seksi (mis. baris
 * `['Pesanan Dibuat']` sebelum header `shopee_shop_stats`) ikut jadi sinyal,
 * bukan cuma nama kolom header literal — konsisten dengan Rule 7 ("baris
 * header dicari, tidak diasumsikan"): pemindaian tidak bergantung pada baris
 * mana yang sebenarnya header.
 */
export interface PdtMatchGroup {
  must?: readonly string[];
  mustNot?: readonly string[];
}

/**
 * Tanda tangan isi (Rule 6 — TIDAK PERNAH bergantung nama berkas). `must`/
 * `mustNot` di level atas adalah gerbang AND/NOT dasar; `anyOf`, bila ada,
 * menambah syarat OR — SALAH SATU grupnya juga harus cocok, di atas gerbang
 * dasar. Bentuk ini cukup ekspresif untuk memindahkan tanda tangan EMPAT
 * registry lama secara verbatim:
 *  - `baseline/detect.ts` (has() AND / !has() NOT),
 *  - `report/detect.ts` TTAM (must AND, mustNot NOT — `ttam_follows` vs
 *    `ttam_showcase`),
 *  - `report/shopee/detect.ts` CONTENT_SIGNATURES (OR-dari-AND-grup),
 *  - `adsscanner/tiktok/detect.ts` FILE_SIGS (must AND per baris header tetap).
 *
 * Modul yang BELUM punya sinyal isi terverifikasi (lihat `modules.ts` §catatan
 * per modul, dan `docs/DECISIONS.md` G1-02) memakai sentinel
 * `UNVERIFIED_SIGNATURE` — sebuah `must` yang sengaja tidak mungkin cocok ke
 * berkas nyata mana pun, supaya modul itu TIDAK PERNAH "menang" pencocokan
 * secara diam-diam. Baris seed-nya tetap ada (DoD: "setiap modul di PRD §7
 * punya baris"), tapi deteksinya jujur menyerah ke pilihan manual AM
 * (dropdown, Rule G1-09) sampai sample asli menemukan pembedanya.
 */
export interface PdtSignature extends PdtMatchGroup {
  anyOf?: readonly PdtMatchGroup[];
}

export interface PdtModuleDef {
  kode: string;
  platform: PdtPlatform;
  namaTampilan: string;
  tandaTanganKolom: PdtSignature;
  /**
   * Nama sheet PERSIS (case-sensitive) tempat modul ini hidup di workbook —
   * `undefined` berarti SHEET PERTAMA (`wb.SheetNames[0]`, perilaku lama).
   * Ditambahkan G1-09-SHEET-BUKAN-PERTAMA (`docs/DECISIONS.md`): pipeline
   * dulu SELALU membaca sheet pertama saja, dan TERBUKTI dua modul ber-sinyal-
   * terverifikasi (`shopee_live`/`shopee_shop_stats`) datanya justru ada di
   * sheet lain pada workbook multi-sheet asli — nol baris pernah tertulis
   * untuk keduanya walau kode penulisnya sudah lengkap. Dicek SEBELUM
   * `tandaTanganKolom`: modul ini TIDAK PERNAH cocok bila workbook tidak
   * punya sheet bernama ini (lihat `detect.ts` `detectPdtModuleAntarSheet`).
   */
  namaSheet?: string;
  /**
   * Sheet TAMBAHAN (nama persis) yang modul ini juga butuh untuk EKSTRAKSI —
   * BUKAN untuk deteksi (`detectPdtModuleAntarSheet` tidak pernah membacanya,
   * `tandaTanganKolom` tetap hanya dicek terhadap `namaSheet`). Ditambahkan
   * sesi 34 (G1-09-2BII-SHOPDAILY-SHOPEE): `shopee_shop_stats` sungguhan
   * TIGA sheet basis terpisah (`Pesanan Dibuat`/`Pesanan Siap Dikirim`/
   * `Pesanan Dibayar`, tab persis) untuk SATU modul yang sama — mendaftarkan
   * dua sheet lain sebagai modul TERPISAH ber-`tandaTanganKolom` identik akan
   * membuat SATU berkas cocok ke BEBERAPA `kode` sekaligus
   * (`detectPdtModuleAntarSheet` menghitungnya sebagai `matches.length > 1`
   * ⇒ ambigu, meregresi deteksi `shopee_shop_stats` yang sudah benar).
   * Field ini murni menambah entri ke `namaDibutuhkan`
   * (`apps/api/src/lib/pdt-parse.ts` `decodeSheetsRelevan`) supaya sheet itu
   * ikut masuk `PdtPreviewBerkasInput.sheets`, dibaca lewat `input.sheets.get(...)`
   * oleh fungsi ekstraksi modul yang SAMA — bukan lewat `aoa`/`namaSheet` modul
   * lain. TS-only, TIDAK ada kolom pasangannya di `pdt_parser_modul` (sama
   * seperti `namaSheet` sendiri — `packages/db/src/pdt.registry.test.ts` tidak
   * membandingkannya).
   */
  sheetTambahan?: readonly string[];
  /** Baris header, 1-terindeks — HINT untuk parser (Rule 7: dicari, bukan diasumsikan), bukan indeks mutlak. */
  barisHeaderHint: number;
  /** Whitelist PDT-27 (`docs/backlog/PDT_KOLOM_DIPANEN.md`) — kolom yang benar-benar dipanen ke tabel fakta. Boleh berbeda dari `tandaTanganKolom` (sinyal deteksi boleh memakai kolom yang tidak dipanen). */
  kolomDipanen: readonly string[];
  /**
   * Nama kolom DATA yang membawa rentang periode berkas, dipakai HANYA bila
   * preamble tidak menghasilkan rentang apa pun. `undefined` = perilaku lama
   * (preamble saja).
   *
   * Seluruh resolusi periode PDT membaca PREAMBLE (baris di atas header),
   * tidak pernah sel data — dan itu tetap aturannya. Field ini adalah
   * pengecualian ber-nama untuk satu bentuk ekspor yang TERBUKTI tidak punya
   * preamble sama sekali (`tt_affiliate_video`: header di baris 1, rentangnya
   * ada di kolom `Date` dan KONSTAN di seluruh baris). Tanpa ini berkas
   * semacam itu selalu "tidak membawa periode terbaca" (Rule 5 ayat 2) dan
   * batch yang HANYA berisi berkas itu ditolak.
   *
   * Yang dibaca adalah nilai TERBANYAK kolom tsb (`kolomTerbanyak`, pola sama
   * `ID Kreator`), bukan baris pertama — supaya baris `Summary`/placeholder
   * tidak bisa menang. TS-only, TIDAK ada kolom pasangannya di
   * `pdt_parser_modul` (sama seperti `namaSheet`/`sheetTambahan`).
   */
  kolomPeriode?: string;
  wajib: boolean;
}

export interface PdtKolomAliasDef {
  modulKode: string;
  kolomKanonik: string;
  alias: string;
}
