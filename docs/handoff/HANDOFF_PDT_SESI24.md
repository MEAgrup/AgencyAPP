# HANDOFF — PDT (Pusat Data Toko) SESI 23 → SESI 24 (lanjutan) → SESI 25

> **Dibuat 2026-09-14.** Baca berkas ini SEBELUM mulai kerja teknis baru — ia menutup
> `HANDOFF_PDT_SESI23.md` (tiga keputusan pemilik A/C/D dieksekusi, item E dicatat "boleh
> dikerjakan tanpa menunggu pemilik"). Instruksi pemilik: **"Lanjutkan task berikutnya"** —
> item E dikerjakan sampai selesai sesi ini.

---

## 0. Apa yang terjadi sesi ini

**E — `shopee_live` identitas sesi live → `G1-09-2BII-SHOPEELIVE` DITUTUP.** Modul KESEMBILAN
`shopee_live` sekarang menulis ke `pdt_fact_content` (jenis `'live'`). `platform_content_id`
dibentuk dari digit mentah `Waktu Mulai` (`YYYYMMDDHHmm`) — BUKAN `Informasi Streaming` (judul
bebas AM, terbukti bisa berulang di sample: `"jual berbagai body motor"` muncul di dua sesi
berbeda tanggal/jam). `Waktu Mulai` sendiri (menit presisi) TIDAK PERNAH berulang untuk satu
akun di sample — satu toko cuma bisa live satu sesi pada satu waktu.

**Nol migrasi baru** — `pdt_fact_content.jenis CHECK IN ('video','live')` sudah mengizinkan
`'live'` sejak G1-01 (migrasi pertama PDT), dan `shopee_live` `kolomDipanen`/`tandaTanganKolom`
tidak berubah. Murni kode: `packages/core/src/pdt/fakta.ts` (`ekstrakBarisShopeeLive`,
`parseWaktuMulaiShopeeLive`), `packages/domain/src/pdt.ts` (writer `ON CONFLICT DO UPDATE`, sama
pola `tt_video`).

**Lima tabel fakta PDT sekarang punya total SEMBILAN modul penulis**:
`pdt_fact_ads` (`shopee_ads_live`/`shopee_ads_cpc`/`shopee_ads_search`), `pdt_fact_content`
(`tt_video`/`shopee_live`), `pdt_sku_master` (`shopee_parent_sku`/`tt_orders`),
`pdt_fact_creator_period` (`tt_transaction_creator`/`shopee_ams_afiliasi`), `pdt_fact_sku_period`
(`shopee_ams_produk`).

Diverifikasi (DB lokal rebuild bersih): `@cdps/core` **1206/1206**, `@cdps/domain`
**2599/2599 (1 skip, tidak berubah)**, `@cdps/db` **107/107**, `@cdps/api` **576/576 (2 skip)**;
typecheck + lint bersih.

**Detail teknis penuh (WIB/UTC, identitas digit-mentah, `is_akun_toko` selalu `true`):**
`docs/DECISIONS.md` (cari `sesi 24`/`modul KESEMBILAN`), docblock kepala `fakta.ts`.

## 1. Semua item A-E dari SESI21/22/23 sekarang TERTUTUP

| Butir | Isi | Status |
|---|---|---|
| A | GMV per produk (`platform_product_id` + modul KEDELAPAN) | ✅ SESI23 |
| B | `shopee_ads_search` → `pdt_fact_ads` | ✅ SESI22 |
| C | `shopee_diskon`/`shopee_flash_sale` MVP | ✅ SESI23 |
| D | `shopee_video.wajib` → `false` | ✅ SESI23 |
| E | `shopee_live` identitas sesi | ✅ **SESI24 (baru)** |

**Investigasi ZIP Fim Motor (15 berkas) dari SESI20-21 sudah TUNTAS dieksekusi jadi kode** —
tidak ada lagi item dari putaran itu yang menunggu keputusan pemilik atau implementasi.

## 2. Yang TERSISA di `docs/DECISIONS.md` Open — TIDAK tersentuh sesi ini

Semua ini SUDAH ada sebelum sesi 21-24, tidak melibatkan Fim Motor, dan masing-masing butuh
data/keputusan yang genuinely belum ada (bukan sekadar belum sempat):

- **`G1-09-2BII-DISKON-FLASHSALE-STRUKTUR` (sisa)** — MVP sudah jalan (sesi 23), tapi opsi 2
  (rincian "Rincian Performa" per-promosi individual) masih tertunda sampai ada yang minta.
  Bukan Open baris terpisah lagi — dicatat di baris Decided sesi 23.
- **`G1-07-PERSKU-PESANAN`** — nol kolom jumlah-pesanan per-SKU terverifikasi di
  `shopee_parent_sku`. Rekomendasi lama: cek sheet LAIN workbook `parentskudetail.xlsx`
  (7-sheet, baru 1 sheet dipetakan) — butuh sample asli untuk diverifikasi, bukan tebakan.
- **`G1-07-PERSKU-DIBAYAR`** — sama kelas, kolom basis "dibayar" `shopee_parent_sku` belum
  terverifikasi namanya.
- **`G1-07-TIKTOK-REKONSILIASI`** — nol mesin rekonsiliasi shop-level-vs-per-SKU TikTok. Butuh
  klien TikTok aktif dengan data nyata untuk diuji — nilainya rendah tanpa itu.
- **`G1-09-DETEKSI-PREAMBLE-AMBIGU`** — potensi ambiguitas deteksi modul untuk berkas
  ber-preamble. Rekomendasi: verifikasi `detectPdtModule` terhadap seluruh sample Fim Motor
  sebagai regresi — kalau tidak ada yang ambiguous nyata, tutup sebagai "terbukti bukan
  masalah di praktik".
- **`G1-08-SEBAGIAN`** — pemicu `parse_status='sebagian'` belum terdefinisi PRD. Butuh
  keputusan bisnis pemilik, bukan sesuatu yang bisa diturunkan dari data.
- **`G1-06-PERIODE-TIKTOK`** — nama kolom periode TikTok Shop Analytics belum terverifikasi.
  Butuh sample asli TikTok (belum pernah diunggah).
- **`G1-09-2BII-SKU-STATUS-TRANSISI`** — transisi `status_listing` SKU ke `'nonaktif'`/
  `'dihapus_platform'` belum ada mesinnya. Rekomendasi tercatat (job periodik Vercel Cron, pola
  sama G1-10) — implementasi murni teknis, bisa dikerjakan tanpa menunggu pemilik kalau sesi
  berikutnya mau mengambilnya (baca `docs/DECISIONS.md` baris ini untuk 3 opsi lengkap).

**Kandidat paling siap untuk sesi berikutnya** (murni implementasi, pola sudah ada, rekomendasi
sudah tercatat lengkap): `G1-09-DETEKSI-PREAMBLE-AMBIGU` (regresi verifikasi) atau
`G1-09-2BII-SKU-STATUS-TRANSISI` (job cron). Sisanya butuh sample data baru atau keputusan
bisnis pemilik yang belum ada.

## 3. Setup teknis untuk sesi berikutnya

```
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
bash scripts/db-rebuild.sh --yes
```
Password TIDAK persisten antar restart cluster. `npm install` di root DAN
`cd web-internal && npm install` TERPISAH.

⚠️ **Jangan jalankan suite penuh `@cdps/domain` dua kali berturut-turut tanpa
`db-rebuild.sh` di antaranya** — `admin.test.ts`/`client.test.ts` menghitung baris `audit_log`
PERSIS. `afterEach` `pdt.test.ts` membersihkan `pdt_fact_ads`/`pdt_fact_content`/
`pdt_sku_master`/`pdt_fact_creator_period`/`pdt_fact_sku_period` SEBELUM `pdt_upload_batch`/
`client_platforms` (urutan FK) — modul PDT baru yang menulis tabel fakta LAGI harus menambah
baris `afterEach` yang sama, sebelum baris `delete from pdt_upload_batch`.

Command verifikasi standar:
```
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm run test -w @cdps/<pkg>
npm run typecheck --workspaces
npm run lint -w @cdps/api -- --max-warnings 0
```

## 4. Rujukan

- `HANDOFF_PDT_SESI21.md`/`SESI22.md`/`SESI23.md` — rantai keputusan A-E lengkap.
- `docs/DECISIONS.md` — cari `2026-09-14` + `sesi 24`/`modul KESEMBILAN` untuk baris Decided
  baru, `~~G1-09-2BII-SHOPEELIVE~~` untuk baris Open yang ditutup. Sisa Open lain (§2 di atas)
  BELUM tersentuh.
- `docs/DATA_MODEL.md` — baris `pdt_fact_content` diperbarui.
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §2.6 — diperbarui sesi ini.
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status "sesi 24" baru di akhir blok.
- `packages/core/src/pdt/fakta.ts` (docblock kepala berkas + `ekstrakBarisShopeeLive` +
  `parseWaktuMulaiShopeeLive`), `packages/domain/src/pdt.ts` (`commitUploadBatch`).
