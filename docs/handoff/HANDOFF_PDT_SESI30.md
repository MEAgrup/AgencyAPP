# HANDOFF — PDT (Pusat Data Toko) SESI 29 → SESI 30

> **Dibuat 2026-09-15.** Instruksi Yohan sesi ini: "merge semua pr yg belum selesai sambil
> lanjutkan task" — PR #388 di-merge (instruksi eksplisit sebelumnya), tiga PR lama lain
> (#367/#330/#328, semua dari sesi jauh sebelum ini, semua sudah SUPERSEDED oleh pekerjaan yang
> sudah merge) ditutup TANPA merge (komentar penjelasan di tiap PR). PR #385 (docs tutorial
> F-6, sudah bersih/clean-merge) ikut di-merge. G1 sudah nol item murni-teknis
> (`HANDOFF_PDT_SESI29.md` §1) — satu-satunya item severity TINGGI yang bisa langsung dikerjakan
> begitu pemilik menjawab adalah `G1-09-SHEET-BUKAN-PERTAMA`; ditanyakan lewat `AskUserQuestion`,
> dijawab, dan DITUTUP sesi ini. Rantai: `HANDOFF_PDT_SESI28.md` → `HANDOFF_PDT_SESI29.md` →
> berkas ini.

---

## 0. Apa yang terjadi sesi ini

**Pembersihan PR**: #388 (G1-10-ORPHAN-PASS + G1-11) di-merge atas instruksi eksplisit. Tiga PR
lama (#367 sesi ~13, #330 sesi ~sales-tenor, #328 Gelombang D) SEMUANYA ditemukan sudah
sepenuhnya superseded — isinya sudah ada (dan lebih lengkap) di `main` lewat jalur lain, dan
mencoba merge-nya akan MENIMPA pekerjaan lebih baru dengan versi lama (dibuktikan lewat
`git merge-tree` — konflik nyata di `pdt-storage.ts`/`DECISIONS.md`/handoff docs). Ditutup dengan
komentar penjelasan di tiap PR, bukan dipaksa merge. #385 (docs tutorial, bersih) di-merge.

**`G1-09-SHEET-BUKAN-PERTAMA` DITUTUP** — bug severity TINGGI dari sesi 27 (pipeline PDT hanya
pernah membaca sheet PERTAMA tiap xlsx; `shopee_live`/`shopee_shop_stats` datanya ada di sheet
lain pada workbook multi-sheet asli, keduanya kode mati/nol-rekonsiliasi untuk berkas nyata).
Ditanyakan ke pemilik lewat `AskUserQuestion` (tiga opsi dari `docs/DECISIONS.md`) — **opsi (c)
dipilih: `namaSheet` eksplisit per modul.**

Dibangun:
- `PdtModuleDef.namaSheet?: string` (baru) — sheet PERSIS tempat modul itu hidup, `undefined` =
  sheet pertama (perilaku lama, TIDAK berubah untuk 23 dari 25 modul).
- `detectPdtModuleAntarSheet` (baru, `@cdps/core` `pdt/detect.ts`) — tiap modul dicocokkan
  terhadap sheet-NYA SENDIRI, bukan satu sheet dipaksakan untuk semua modul seperti
  `detectPdtModule` lama (yang tetap dipertahankan, masih dipakai test-nya sendiri + sanity-check
  "hasil identik untuk workbook satu-sheet").
- `apps/api/src/lib/pdt-parse.ts` — mendekode SELURUH sheet yang relevan (sheet pertama ∪ tiap
  `namaSheet` registry, hanya yang benar-benar ADA di workbook ITU) sekali per entri ZIP, lalu
  memanggil fungsi di atas.
- `shopee_live` → `namaSheet: 'Daftar Streaming'` (sudah terverifikasi sesi 24, cuma tidak pernah
  disambungkan ke pipeline).
- `shopee_shop_stats` → `namaSheet: 'Pesanan Siap Dikirim'` (basis DEFAULT laporan klien Rule 16,
  SUDAH dipakai `commitUploadBatch`); `tandaTanganKolom` diganti dari marker SALAH
  (`'Pesanan Dibuat'` TERBUKTI cuma nama TAB, bukan isi sel) ke kolom yang SUNGGUH ADA di sheet
  terisolasi; `barisHeaderHint` turun 2→1 (header LANGSUNG baris pertama, nol baris penanda).
- Migrasi baru `20261028010000_g1_09_shopee_shop_stats_sheet_terisolasi.sql` — UPDATE seed
  `pdt_parser_modul` (gerbang dual-home `pdt.registry.test.ts` menegakkan TS≡DB untuk
  `tanda_tangan_kolom`/`baris_header_hint`; `namaSheet` TS-only, bukan kolom DB).
- **Override AM ikut diperbaiki** (root cause SAMA, bukan tiket terpisah): `PdtPreviewBerkasInput
  .sheets` (baru) membawa seluruh sheet relevan berkas itu; `commitUploadBatch`/`reparsePdtBatch`
  memakai `aoaUntukModulEfektif` (baru) untuk me-remap `aoa` ke sheet `namaSheet` modul OVERRIDE —
  sebelum ini, AM yang meng-override ke `shopee_live` pada berkas yang deteksi otomatisnya gagal
  akan tetap membaca sheet yang salah (bug yang sama, jalur berbeda, belum pernah kejadian nyata
  tapi laten sejak `namaSheet` tidak ada sama sekali).

**Sengaja TIDAK diubah, dicatat Open baru** (`G1-09-SHOPEESHOPSTATS-BASIS-TOTAL`):
`parseShopeeShopStatsPerBasis` (`rekonsiliasi.ts`) masih mengasumsikan format LAMA (marker
section + baris Total sesudahnya) — struktur BARIS di dalam sheet yang sekarang sudah terisolasi
per basis (murni harian? ada baris ringkasan?) belum terverifikasi ke sample. Menebak algoritma
Σ di sini adalah kelas kesalahan MONEY MATH (bisa menghitung ganda kalau ternyata ada baris
ringkasan tercampur baris harian) — **bukan regresi**: jalur rekonsiliasi via `shopee_shop_stats`
sudah nol dari sumber 12-sheet ini SEBELUM perbaikan sesi ini juga (modul tidak pernah terdeteksi
sama sekali). Perbaikan sesi ini murni menutup DETEKSI (modul berhenti jadi kode mati, `pdt_file`/
`parse_status` sekarang benar) — rekonsiliasi via jalur itu tetap terpisah, butuh sample lagi.

Diverifikasi (DB lokal rebuild bersih, 247 migrasi): `@cdps/core` **1212/1212**, `@cdps/domain`
**2619/2619 (1 skip, tidak berubah)**, `@cdps/db` **107/107** (`pdt.registry.test.ts` TS≡DB tetap
hijau), `@cdps/api` **595/595 (2 skip, live-storage)**; typecheck 5 paket + lint `@cdps/api
--max-warnings 0` bersih. Satu migrasi baru (murni UPDATE seed, nol tabel baru).

## 1. Posisi G1 sekarang

Item G1 murni-teknis benar-benar NOL lagi setelah `G1-09-SHEET-BUKAN-PERTAMA` ditutup. Sisa item:

1. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — butuh keputusan pemilik (3 opsi + rekomendasi,
   `HANDOFF_PDT_SESI26.md` §1a).
2. **`G1-09-SHOPEESHOPSTATS-BASIS-TOTAL`** (baru sesi ini) — butuh sample export
   `shopee-shop-stats` asli, sheet 'Pesanan Siap Dikirim': apakah baris pertama sesudah header
   adalah ringkasan/Total, atau murni baris harian tanpa ringkasan sama sekali.
3. **TikTok Avitaskin** — butuh ZIP diunggah ulang (scratchpad sesi lalu tidak ikut ke chat baru).
   Membuka `G1-06-PERIODE-TIKTOK`, `G1-09-2BII-TTLIVE`, `G1-07-TIKTOK-REKONSILIASI`.
4. **`G1-10-RETENSI-RECOMPUTE`** — menunggu G2-01/G5 punya baris produksi pertama.
5. **`G1-11-REPARSE-RECOMPUTE-STATUS`** — pertanyaan desain jarang-terjadi, tidak memblokir.

Semua LIMA butuh sample data atau keputusan pemilik — nol pekerjaan teknis baru untuk Claude
tanpa salah satu dari itu. `docs/backlog/PDT_BACKLOG.md` §8 "Aturan strangler" tetap berlaku:
G2 (Laporan sebagai view) menunggu G1 exit criteria (≥10 klien nyata verified) yang butuh KLIEN
NYATA, bukan sesuatu yang bisa dipenuhi lewat kode.

## 2. Setup teknis

Sama seperti sesi-sesi lalu — `pg_ctlcluster 16 main start`, `db-rebuild.sh --yes`, `npm install`
terpisah tiap paket.

## 3. Rujukan

- `docs/DECISIONS.md` — cari `sesi 30` untuk baris Decided (`G1-09-SHEET-BUKAN-PERTAMA` ditutup)
  dan Open baru `G1-09-SHOPEESHOPSTATS-BASIS-TOTAL`.
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status "sesi 30" baru di akhir blok.
- `packages/core/src/pdt/types.ts`/`modules.ts`/`detect.ts` — `namaSheet`, `detectPdtModuleAntarSheet`.
- `apps/api/src/lib/pdt-parse.ts` — `decodeSheetsRelevan`, alur deteksi multi-sheet baru.
- `packages/domain/src/pdt.ts` — `aoaUntukModulEfektif`, `PdtPreviewBerkasInput.sheets`.
