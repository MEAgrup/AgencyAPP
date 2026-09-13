# HANDOFF — PDT (Pusat Data Toko) SESI 13 → SESI 14

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: … → sesi 12 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI12.md` untuk konteks penuh ketiga
> pertanyaan yang sesi ini jawab). Instruksi sesi ini: Nerissa membaca
> `HANDOFF_PDT_SESI12.md` §1 dan menjawab ketiga pertanyaan (1a=A, 1b=B +
> upload sample `parentskudetail.xlsx`/`AMSAffiliatePerformance`/dst. ASLI
> Fim Motor, 1c=A) — sesi ini mengeksekusinya.

---

## 0. Ringkasan 60 detik

**Ketiga Open row `HANDOFF_PDT_SESI12.md` §1 DITUTUP sekaligus** (lihat
`docs/DECISIONS.md` baris teratas untuk detail penuh):

1. **`G1-09-TIDAKDAPATDIVALIDASI-LOLOS` — jawaban (A).** Pertahankan LOLOS
   seperti sudah diimplementasikan. **Nol perubahan kode** — komentar
   `commitUploadBatch` (`packages/domain/src/pdt.ts`) diperbarui menyebut
   ketokan ini eksplisit (bukan lagi "default operasional", tapi keputusan
   pemilik yang tercatat).
2. **`G1-09-PARENTSKU-PESANAN` — jawaban (B).** Nerissa mengunggah sample
   Fim Motor ASLI (`parentskudetail.20260701_20260731.xlsx`, 40 kolom, 1.504
   baris + 6 sheet lain). Kolom `Pesanan Dibuat`/`Pesanan Siap Dikirim`
   per-SKU **TERNYATA ADA** (indeks 16/17, sejajar dua kolom GMV yang sudah
   dipanen) — bukan "tidak diekspor Shopee" seperti dugaan sesi 12.
   Ditambahkan ke `shopee_parent_sku.kolomDipanen` (`modules.ts`).
   `commitUploadBatch` sekarang memanggil `rekonsiliasiGmvPesanan` PENUH
   (Rule 13/14: Σ GMV **dan** Σ pesanan per-SKU vs shop-level, basis Siap
   Dikirim) — fungsinya sendiri sudah ada sejak G1-07, tinggal diberi angka
   pesanan asli.
3. **`G1-09-SIGNATURE-AMS-COLLISION` — jawaban (A).** Sample ASLI
   berdampingan (`AMSAffiliatePerformance_*.csv` vs `Data+Keseluruhan+Iklan
   +Shopee-*.csv`/`Search-Ads-Overall-Data-*.csv`/`Data-Semua-Iklan-Live-*
   .csv`, semua Fim Motor) mengonfirmasi `'ID Affiliates'` HANYA muncul di
   export AMS afiliasi — nol kemunculan di ketiga modul ads Shopee lain,
   `shopee_shop_stats`, atau `shopee_parent_sku`. Ditambahkan ke `must`
   `shopee_ams_afiliasi.tandaTanganKolom`.

**Temuan sampingan sesi ini** (tidak mengubah keputusan, dicatat supaya
tidak ditebak lagi): (a) sample real membuktikan `shopee_ads_cpc` **dan**
`shopee_ads_search` SAMA-SAMA bentrok dengan `shopee_ams_afiliasi` sebelum
perbaikan — sesi 12 hanya menyadari `_cpc`/`_live`, bukan `_search`
(ternyata `_search` juga membawa `Username` + `Omzet Penjualan` di export
asli). (b) Sample real `shopee_ads_live` justru TIDAK membawa `Username` di
preamble-nya (beda dari asumsi Rule 2/fixture sintetik sesi 12) — tidak
mengubah kesimpulan, gerbang `ID Affiliates` menutup collision terlepas
dari itu, tapi berarti jangan lagi mengasumsikan preamble `Username` ada di
KETIGA modul ads Shopee tanpa sample.

**Migrasi baru:** `20261015010000_g1_09_signature_ams_collision_dan_parentsku_pesanan.sql`
— UPDATE `pdt_parser_modul` (bukan INSERT/tabel baru) untuk dua baris
(`shopee_ams_afiliasi.tanda_tangan_kolom`, `shopee_parent_sku.kolom_dipanen`),
menyinkronkan seed ke perubahan `modules.ts`. `pdt_parser_modul.versi`
(per-baris) **TIDAK** dinaikkan (kolom itu belum ada konsumen — G1-11 belum
dibangun, `pdt.registry.test.ts` menegaskan tetap `1`); `PDT_PARSER_VERSI`
(TS, penanda reparse yang SUDAH dipakai) naik 1→2. Nol tabel baru, nol
gerbang CI bergerak (175/44/35/74 tetap, `db-rebuild.sh --yes` ulang).

**BUG REGRESI DITEMUKAN+DIPERBAIKI SAAT VERIFIKASI (bukan gap yang
dibiarkan):** menambah `Pesanan Dibuat`/`Pesanan Siap Dikirim` ke
`shopee_parent_sku.kolomDipanen` otomatis membuat keduanya kolom **WAJIB**
(Rule 9 — `commitUploadBatch`/`bangunSatuPreviewBerkas` memakai SELURUH
`kolomDipanen` langsung sebagai daftar `validasiKolomWajib`, G1-08-SEBAGIAN
sudah mencatat array itu belum punya pembeda bucket wajib/opsional). Tiga
fixture lama yang memakai header 10-kolom (`preview/route.test.ts`,
`commit/route.test.ts`, `pdt-parse.test.ts` fixture `f11`) langsung jatuh
ke `parse_status='gagal'` begitu ditambahkan — terdeteksi lewat full test
suite (`preview/route.test.ts` gagal, `periode: null` bukan
`{status:'tolak'}`), dikonfirmasi REGRESI (bukan pra-ada) lewat `git stash`
+ jalankan ulang test yang sama di baseline. **Diperbaiki**: ketiga fixture
diperbarui menyertakan dua kolom baru.

---

## 1. Berkas baru/diubah sesi ini

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/modules.ts` | `shopee_parent_sku.kolomDipanen` +2 kolom; `shopee_ams_afiliasi.tandaTanganKolom` +`'ID Affiliates'`; `PDT_PARSER_VERSI` 1→2 |
| `packages/core/src/pdt/rekonsiliasi.ts` | Komentar `sumShopeeParentSkuGmv` diperbarui (generik, dipakai GMV+pesanan) — nol perubahan perilaku |
| `packages/domain/src/pdt.ts` | `commitUploadBatch` — rekonsiliasi memanggil `rekonsiliasiGmvPesanan` penuh (GMV+pesanan), bukan hitung delta GMV manual; komentar kepala fungsi diperbarui |
| `packages/core/src/pdt/detect.test.ts` (+3 tes) | Fixture `shopee_ams_afiliasi` +`ID Affiliates`; 2 fixture regresi (`shopee_ads_cpc`/`shopee_ads_search` dengan preamble Username TIDAK LAGI ambigu) |
| `apps/api/src/lib/pdt-parse.test.ts` (+1 tes) | Fixture `f20_ams_afiliasi`/`f11_parent_sku` diperbarui; tes BARU pipeline XLSX SUNGGUHAN (ZIP→`bacaDanEkstrakPdtZip`→`decodePdtAoa`→`detectPdtModule`) membuktikan ads_cpc+ams_afiliasi berdampingan dalam SATU batch keduanya tepat tidak ambigu |
| `packages/domain/src/pdt.test.ts` (+3 tes) | `shopeeParentSkuBerkas` fixture +parameter pesanan opsional; 3 call site lama diberi pesanan sejajar shop-level; 1 tes BARU (GMV per-SKU cocok, pesanan beda jauh ⇒ ditolak — kasus persis contoh handoff sesi 12 §1b) |
| `apps/api/.../pdt/batches/preview/route.test.ts`, `.../commit/route.test.ts` | Fixture `shopee_parent_sku` 10-kolom diperbarui +2 kolom (perbaikan regresi Rule 9, lihat §0) |
| `supabase/migrations/20261015010000_g1_09_signature_ams_collision_dan_parentsku_pesanan.sql` (BARU) | UPDATE 2 baris `pdt_parser_modul` — sinkron ke `modules.ts` |
| `docs/DECISIONS.md` | 1 baris Decided (teratas) + 3 Open row DITUTUP (`~~...~~`) |
| `docs/backlog/PDT_BACKLOG.md`, `docs/backlog/PDT_KOLOM_DIPANEN.md` | Catatan status sesi 13 |

**Diverifikasi** (sandbox — `service postgresql start` + `db-rebuild.sh
--yes`, password `postgres` di-set eksplisit; `npm install` root dijalankan
ulang sesi ini karena `node_modules` tidak ada di sandbox segar):
**`@cdps/core` 1149/1149**, **`@cdps/domain` 2549/2549 (1 skip)**,
**`@cdps/db` 107/107**, **`@cdps/api` 559/559 (15 skip) kecuali SATU
kegagalan `gelombang-c-showcase.e2e.test.ts`** (direproduksi identik di
baseline `git stash` — bukan regresi sesi ini, sama seperti dicatat sesi
2-12). `pdt.registry.test.ts` (dual-home TS≡DB) hijau. `npm run typecheck`
(seluruh workspace) dan `npm run lint -w @cdps/api -- --max-warnings 0`
bersih.

---

## 2. Sisanya yang perlu ditindaklanjuti sesi berikutnya

Sama seperti dicatat sesi 12 §2 (tidak berubah oleh sesi ini):

1. **Rekomendasi utama — G1-09 sub-langkah 2b: baris fakta.**
   `commitUploadBatch` punya `terparse` di tangan sebelum menulis DB — peta
   `kolomDipanen`→kolom `pdt_fact_*` BELUM ada (butuh keputusan tipe per
   kolom). Pertimbangkan `pdt_fact_shop_daily` dulu (`parseShopeeShopStatsPerBasis`
   sudah ada) sebelum fakta per-SKU/konten/kreator/ads.
2. **G1-09 sub-langkah 3: halaman upload `web-internal`.** Kontrak FE
   (`PdtCommitBatch`, `web-internal/src/lib/pdt.ts`) sudah lengkap tiga
   langkah (`upload-url`→PUT→`preview`→`commit`), halaman belum dibangun.
3. Item lama masih terbuka, masih tidak memblokir: `G1-08-SEBAGIAN`,
   `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR` (lihat `docs/DECISIONS.md`
   Open — TIDAK disentuh sesi ini, di luar lingkup ketiga pertanyaan
   sesi 12).
4. `apps/api/src/lib/pdt-storage.test.ts` `describeLive` masih belum pernah
   dijalankan (nol `SUPABASE_SERVICE_ROLE_KEY` di sandbox manapun sejauh
   ini) — tidak berubah sesi ini.
5. **Catatan sampingan (bukan blocker):** `gelombang-c-showcase.e2e.test.ts`
   tetap gagal (duplicate key `uq_client_platforms_active_platform`),
   dikonfirmasi ULANG pra-ada lewat `git stash` di sandbox ini — bukan
   regresi, tidak diperbaiki di sini (di luar lingkup PDT).

---

## 3. Rujukan

- `docs/handoff/HANDOFF_PDT_SESI12.md` §1 — tiga pertanyaan asli + contoh
  kasus + rekomendasi (jawaban ada di `docs/DECISIONS.md` baris teratas
  sesi ini).
- `docs/DECISIONS.md` — baris Decided teratas (2026-09-13, sesi 13) + tiga
  baris `~~...~~` DITUTUP.
- `packages/core/src/pdt/modules.ts` — `shopee_parent_sku`/`shopee_ams_afiliasi`
  (cari komentar "DITAMBAHKAN sesi ini"/"SENGAJA BERBEDA").
- `packages/domain/src/pdt.ts` `commitUploadBatch` (rekonsiliasi Rule 13-16
  penuh) + `packages/domain/src/pdt.test.ts` (3 tes baru).
- `packages/core/src/pdt/detect.test.ts` + `apps/api/src/lib/pdt-parse.test.ts`
  — bukti disambiguasi lewat XLSX SUNGGUHAN.
- `supabase/migrations/20261015010000_g1_09_signature_ams_collision_dan_parentsku_pesanan.sql`
  (BARU).
- Sample asli yang menutup kedua Open row: diunggah Nerissa sesi ini
  (folder `Shopee - Fim Motor`/`Tiktok - Avitaskin`, bukan tersimpan di
  repo — data klien).
