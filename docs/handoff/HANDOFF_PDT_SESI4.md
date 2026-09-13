# HANDOFF — PDT (Pusat Data Toko) SESI 4 → SESI 5

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut. Cabang kerja sesi ini:
> `claude/handoff-sesi-3-continuation-n483la`.
>
> **Status: PR #356 (G1-01) di-merge ke `main`. G1-02 SELESAI** (seed
> `pdt_parser_modul`/`pdt_kolom_alias`, registry TS + pencocok tanda tangan +
> 29 tes, diterapkan ke live `CDPS SG`). Sesi 5 lanjut ke **G1-03** (normalisasi
> angka terpusat → NaN) — lihat §4.

---

## 0. Ringkasan 60 detik

Sesi ini dimulai dengan instruksi "baca handoff dan lanjutkan, merge PR #356
kalau diperlukan". PR #356 (G1-01, dari sesi 3) masih terbuka dengan satu CI
job merah (`db-and-migrations`) — sudah diverifikasi sesi 3 sebagai bug
pra-ada (`gelombang-c-showcase.e2e.test.ts`, fixture `client_platforms`
collision) yang direproduksi identik di `main`, dengan komentar standing-down
dan satu re-run sudah dipakai. Sesuai aturan CI-merah (bukan punya PR ini,
sudah di-root-cause, sudah di-comment), PR **di-merge** (squash) — lihat §1.

Setelah merge, sesi ini mengerjakan **G1-02** penuh: menyatukan EMPAT registry
tanda tangan kolom lama (`baseline/detect.ts`, `report/detect.ts`,
`report/shopee/detect.ts`, `adsscanner/tiktok/detect.ts`) + 3 modul baru
(`shopee_video`, `shopee_chat_broadcast`, `meta_ads`) menjadi **25 baris**
`pdt_parser_modul` (9 TikTok + 15 Shopee + 1 meta), plus 5 baris
`pdt_kolom_alias`. Migrasi diterapkan ke live. **Tiga modul** (`shopee_diskon`,
`shopee_flash_sale`, `shopee_video`) di-seed TANPA sinyal isi terverifikasi —
dicatat jujur di `docs/DECISIONS.md`, bukan ditebak (lihat §3).

---

## 1. PR #356 (G1-01) — merged

- **Merge method:** squash, `9af02f3` di `main`.
- **CI job merah `db-and-migrations`:** sudah di-root-cause sesi 3 (komentar PR
  #356), bug pra-ada `gelombang-c-showcase.e2e.test.ts`, direproduksi identik
  di `main` sebelum PR ini. Re-run yang tersedia sudah dipakai sesi 3 (gagal
  lagi dengan error yang sama — bukan flaky). Ini **bukan** milik PR #356;
  tidak diperbaiki di sini (di luar cakupan migrasi skema), proposed patch
  sudah tercatat `HANDOFF_PDT_SESI2.md` §4 dan komentar PR #356.
- Branch lokal sesi ini (`claude/handoff-sesi-3-continuation-n483la`) di-rebase
  ke `main` pasca-merge sebelum G1-02 mulai.

---

## 2. G1-02 — SELESAI

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/types.ts` | `PdtSignature`/`PdtMatchGroup` (bentuk `{must, mustNot?, anyOf?}`) + `PdtModuleDef`/`PdtKolomAliasDef` |
| `packages/core/src/pdt/modules.ts` | `PDT_MODULES` (25 modul) + `PDT_KOLOM_ALIAS` (5 alias) + `UNVERIFIED_SIGNATURE` sentinel — komentar per modul mengutip sumber persis (PDT_KOLOM_DIPANEN §, PRD §7, atau detect.ts lama yang dipindahkan verbatim) |
| `packages/core/src/pdt/detect.ts` | `detectPdtModule`/`matchesSignature` — pencocok generik, pindai-seluruh-sheet case-insensitive (Rule 6/7), mengembalikan `ambiguous` alih-alih menang-diam-diam saat >1 modul cocok |
| `packages/core/src/pdt/detect.test.ts` | 29 tes — satu fixture per modul (24 modul terverifikasi) + tes lintas-registry (nol salah-slot) + tes eksplisit untuk 3 modul unverified |
| `packages/core/src/index.ts` | `export * as pdt from './pdt'` |
| `packages/db/src/pdt.registry.test.ts` | Gerbang dual-home TS≡DB (skip tanpa `DATABASE_URL`), pola sama `storeops.registry.test.ts`/`dailyops.registry.test.ts` |
| `supabase/migrations/20261012010000_g1_02_seed_pdt_parser_modul.sql` | Seed 25 baris `pdt_parser_modul` + 5 baris `pdt_kolom_alias`, cermin literal `modules.ts` |
| `docs/DECISIONS.md` | 1 baris baru (2026-09-13, PDT G1-02, di ATAS baris G1-01) — bentuk signature, penyempitan negasi `tt_shop_analytics`, 3 modul unverified, gap `shopee_shop_stats`/casing `shopee_ads_search`/`shopee_chat_broadcast` |
| `docs/DATA_MODEL.md` | Baris "Registry modul parser PDT" diperbarui (G1-01/G1-02, jumlah seed, dijaga `pdt.registry.test.ts`) |

Diterapkan ke live `CDPS SG` (`egddxfcnrtecheiykhlf`) via `apply_migration`.
Security advisor dicek pasca-apply: nol temuan baru (pola RLS `USING (true)`
identik `pdt_benchmark`/`px_eligibility_policy` yang sudah ada).

**Nol perubahan gerbang CI** (`ci.yml`/`db-rebuild.sh`) — G1-02 murni seed
data, nol tabel baru, nol prefix/mesin/notifikasi baru.

### 2.1 Verifikasi

- `db-rebuild.sh --yes`: hijau, 175/44/35/74 (tidak bergerak, sesuai rencana),
  231 migrasi.
- `packages/core` 1015/1015 lolos (termasuk 29 tes `pdt/detect.test.ts`).
- `packages/db` 107/107 lolos (termasuk 8 tes `pdt.registry.test.ts` terhadap
  DB lokal hasil rebuild — TS≡DB dikonfirmasi baris per baris).
- `packages/domain` 2502/2502 lolos (nol regresi dari perubahan `packages/core/src/index.ts`).
- `apps/api`: 497 lolos, **satu kegagalan pra-ada** yang sama seperti PR #356
  (`gelombang-c-showcase.e2e.test.ts`) — tidak disentuh, di luar cakupan G1-02.
- `npm run typecheck` bersih di `@cdps/core` dan `@cdps/db`.

### 2.2 Desain `tanda_tangan_kolom` (jsonb)

Bentuk `{must, mustNot?, anyOf?}`, dicocokkan dengan memindai SETIAP baris
sheet (bukan indeks kolom tetap) mencari kata kunci case-insensitive di mana
pun — bukan "kolom header persis". Ini menyatukan tiga gaya pencocokan lama
(`has()` kolom-persis baseline, `anyRowHas()`/`anyCellEquals()` substring
Shopee, `FILE_SIGS` baris-header-tetap Ads Scanner) jadi satu mesin. Rincian
lengkap dan SATU penyempitan yang dilakukan (negasi `'ID'` polos di
`tt_shop_analytics` dijatuhkan — targetnya file Tokopedia yang PDT tidak
model, dan di bawah pemindai-substring ia salah menolak dirinya sendiri lewat
kata seperti "video") ada di `docs/DECISIONS.md` baris G1-02.

### 2.3 Tiga modul TANPA sinyal isi terverifikasi (dicatat, bukan ditebak)

| Modul | Kenapa |
|---|---|
| `shopee_diskon` | UAT Fim Motor (SHP-3) membuktikan pasangan diskon/flash-sale hanya terselesaikan lewat nama berkas MENTAH — Rule 6 PDT melarangnya. `shopee_voucher` yang satu keluarga punya jangkar unik (`'Nama Voucher'`) yang tidak dimiliki keduanya. |
| `shopee_flash_sale` | Sama seperti di atas — pasangan yang sama, gap yang sama. |
| `shopee_video` | `PDT_KOLOM_DIPANEN.md` §2.7 menulis "11 dari 54 kolom" ABSTRAK. Nol dari 54 nama kolom tertulis literal di dokumen/kode manapun di repo ini — fixture `bisnisVideoAoa` memodelkan berkas LAIN ("[bisnis]-Video" konvensi tim, bukan `video-overview-v3` mentah 54-kolom 2-lapis header). |

Ketiganya di-seed dengan sentinel `{"must": ["__pdt_g1_02_belum_ada_sinyal_isi_terverifikasi__"]}`
— string yang mustahil cocok ke isi berkas nyata. Baris seed-nya tetap ada
(DoD backlog: "setiap modul di PRD §7 punya baris"), tapi `detectPdtModule`
tidak akan pernah memilihnya secara otomatis — AM memilih modul lewat
dropdown (Rule G1-09) sampai salah satu dari ini terjadi:
1. Sample asli `shopee_video`/`discount_*`/`In_Shop_Flash_Sale_*` didapat dan
   kolomnya diverifikasi (baca real file, bukan tebak dari nama).
2. Pemilik memutuskan `shopee_diskon`/`shopee_flash_sale` digabung jadi satu
   modul PDT (karena memang tidak bisa dibedakan) — butuh entri
   `docs/DECISIONS.md` baru dan kemungkinan perubahan `PDT_BACKLOG.md`/PRD §7.

**Jangan** menyalin signature `shopee_voucher` ke `shopee_diskon`/`shopee_flash_sale`
untuk "membuatnya kelihatan bekerja" — itu akan membuat salah satu modul
selalu kalah ke yang lain secara diam-diam, persis kelas bug UAT Fim Motor §3
sudah buktikan berbahaya.

### 2.4 Gap kecil lain yang dicatat (tidak memblokir G1-03)

- `shopee_shop_stats.kolom_dipanen` hanya mencakup basis "Pesanan Dibuat" (15
  metrik, dari `HOME_HEADER` teruji). Dua sheet lain di workbook 12-sheet-nya
  ("asal kunjungan"/"asal penjualan") tidak disertakan — nama kolom literalnya
  tidak tertulis di dokumen/kode manapun.
- `shopee_ads_search` (`klik`/`konversi`) dan `shopee_chat_broadcast`
  (`penerima`/`dibaca`/`diklik`/`pesanan`) disimpan huruf kecil apa adanya,
  mengikuti persis casing prosa PRD — casing Title-Case pastinya belum
  terverifikasi ke sample asli.
- `shopee_parent_sku` alias `'Persentase Klik'` sengaja TIDAK di-seed ke
  `pdt_kolom_alias` — `PDT_KOLOM_DIPANEN.md` §5 sendiri menandainya "ejaan
  kanoniknya di export 40-kolom belum terverifikasi".

Semua di atas: kalau sample asli datang (dari pemilik/AM), tugasnya menambah
baris `pdt_kolom_alias`/memperbarui `kolomDipanen`/mengisi `tandaTanganKolom`
yang tepat — TIDAK PERNAH menebak dulu untuk "menutup gap".

---

## 3. Yang TIDAK disentuh sesi ini

- **G1-00 sisa** (pembersihan klien testing) — masih ditunda pemilik, belum
  ada instruksi baru (sama seperti SESI2/SESI3).
- **Bug pra-ada `gelombang-c-showcase.e2e.test.ts`** — direproduksi lagi sesi
  ini (lewat suite `apps/api` penuh), masih belum diperbaiki. Proposed patch
  tetap di `HANDOFF_PDT_SESI2.md` §4.
- **G1-03 dan seterusnya** — belum dimulai.

---

## 4. Rekomendasi sesi 5 — mulai G1-03

`docs/backlog/PDT_KOLOM_DIPANEN.md` intro dan `PDT_BACKLOG.md` §1 G1-03:
**"Normalisasi angka terpusat — pilih NaN, bukan 0."**

1. Baca `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §6.7 (encoding: CSV Shopee
   `utf-8-sig`, angka format Indonesia `1.234,56`; Ads Manager pakai titik
   sebagai desimal — dua konvensi berbeda dalam satu sistem, lihat catatan
   `UAT_TIKTOK_AVITASKIN_20260904.md` §2.2 soal `toNum`).
2. Satu fungsi normalisasi angka terpusat (bukan per-modul) yang mengembalikan
   `NaN` untuk nilai yang tidak bisa diparse — BUKAN `0` (Rule: nol yang
   dikarang menyembunyikan kolom yang sebenarnya gagal terbaca; `NaN` yang
   lolos ke tabel fakta harus terlihat, bukan diam-diam jadi nol di
   agregasi/skor).
3. `packages/core` sudah punya presedan normalisasi angka lokal per-mesin
   (`baseline`, `report`, `report/shopee`, `adsscanner/tiktok`) — G1-03
   kemungkinan menyatukan itu juga, mirip semangat G1-02 menyatukan
   detect.ts. Cek dulu apakah keempatnya benar-benar identik atau ada
   perbedaan tersembunyi (mis. locale) sebelum menyatukan.
4. Setelah G1-03: G1-04 (bucket `pdt-raw` + pagar ZIP) → G1-05 (parse di
   server, DI SINI-lah `packages/core/src/pdt/detect.ts` sesi ini akan
   benar-benar dipakai membaca upload nyata) → G1-06 (identitas toko dari
   berkas) → G1-07 (rekonsiliasi) → G1-08 (kegagalan parse tidak ditelan) →
   G1-09 (halaman upload, termasuk dropdown override manual untuk 3 modul
   unverified §2.3).

**Jangan lompat ke G1-09** sebelum G1-03..08 — build order eksplisit di
`PDT_BACKLOG.md` §0.

---

## 5. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` (v1.2) — PRD, §7 modul & peta kolom.
- `docs/backlog/PDT_BACKLOG.md` — G1-02 (sesi ini) → G1-03 (sesi berikutnya).
- `docs/backlog/PDT_KOLOM_DIPANEN.md` — whitelist `kolom_dipanen` mengikat.
- `docs/DECISIONS.md` — baris kedua dari atas (2026-09-13, PDT G1-02).
- `docs/DATA_MODEL.md` §1 — baris "Registry modul parser PDT" diperbarui.
- `packages/core/src/pdt/` — registry + pencocok + 29 tes.
- `packages/db/src/pdt.registry.test.ts` — gerbang dual-home.
- `supabase/migrations/20261012010000_g1_02_seed_pdt_parser_modul.sql`.
- Live: `CDPS SG` (`egddxfcnrtecheiykhlf`), migrasi `g1_02_seed_pdt_parser_modul`
  sudah live per `list_migrations`.
