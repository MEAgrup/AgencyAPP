# HANDOFF — PDT (Pusat Data Toko) SESI 21 → SESI 22 (lanjutan) → SESI 23

> **Dibuat 2026-09-14.** Baca berkas ini SEBELUM mulai kerja teknis baru — ia menutup
> `HANDOFF_PDT_SESI21.md` (investigasi PENUH ZIP Fim Motor, 4 keputusan menunggu pemilik +
> 1 item "boleh langsung dikerjakan"). Instruksi pemilik: **"Baca handoff pst sesi 21 kemudian
> lanjutkan task berikutnya. Yg butuh decision berikan contoh kasus dan rekomendasi."**

---

## 0. Apa yang terjadi sesi ini

`HANDOFF_PDT_SESI21.md` §3 mencatat LIMA keputusan (A-E), satu di antaranya (**B**,
`shopee_ads_search`) eksplisit ditandai *"tidak perlu persetujuan bisnis — murni pekerjaan
implementasi mengikuti pola yang sudah ada. Boleh langsung dikerjakan sesi berikutnya TANPA
menunggu Yohan"*. Sesi ini mengerjakan **B** sampai selesai, PR sudah siap:

| Butir | Isi | Status |
|---|---|---|
| **B** | `shopee_ads_search` — writer `pdt_fact_ads` dibangun (modul KETUJUH) | ✅ **SELESAI sesi ini** |
| A | `G1-09-2BII-ADS-CPC-SKU` — lookup produk induk → SKU varian | 🟡 **MENUNGGU PEMILIK** (§1 di bawah) |
| C | `shopee_diskon`/`shopee_flash_sale` — kolom mana yang dipanen | 🟡 **MENUNGGU PEMILIK** (§2) |
| D | `shopee_video` — butuh sumber laporan lain dari Shopee Seller Center | 🟡 **MENUNGGU PEMILIK** (§3) |
| E | `shopee_live` — identitas sesi live (risiko rendah, boleh dikerjakan) | 🟢 **BOLEH DIKERJAKAN sesi berikutnya** (§4) |

**A/C/D butuh keputusan bisnis dari pemilik/Hans/Anty — TIDAK ditebak, sesuai instruksi
`CLAUDE.md`.** Ringkasan contoh kasus + rekomendasi ada di §1-3 di bawah (versi lengkap masih di
`HANDOFF_PDT_SESI21.md` §3, tidak diulang penuh di sini). **E** teknis berisiko rendah dan bisa
langsung dikerjakan Claude sesi berikutnya tanpa menunggu jawaban — dicatat di §4 sebagai
kandidat task berikutnya yang paling siap.

## 1. `shopee_ads_search` (B) — apa yang dibangun

`packages/core/src/pdt/modules.ts`: `kolomDipanen` dilebarkan
`['Jumlah Klik', 'Konversi', 'Nama Iklan', 'Biaya']`. `packages/core/src/pdt/fakta.ts`:
`ekstrakBarisShopeeAdsSearch` (Modul KETUJUH) — `kampanye_id` **KOMPOSIT**
(`` `${namaIklan} :: ${kataPencarian}` ``, BUKAN `nama iklan` polos seperti `shopee_ads_cpc`)
karena sample yang tersedia hanya SATU baris data, tidak membuktikan apakah satu iklan search
bisa punya banyak baris per keyword dalam satu periode. `Kata Pencarian` dibaca untuk identitas
baris tapi TIDAK masuk `kolomDipanen` (Q-6 masih ditahan). `packages/domain/src/pdt.ts`:
writer `pdt_fact_ads` (replace-on-recommit, sama pola `shopee_ads_cpc`/`shopee_ads_live`).
Migrasi `20261023010000_g1_09_2bii_pdt_parser_modul_ads_search_kolom.sql`.

Diverifikasi (DB lokal rebuild bersih): `@cdps/core` **1191/1191**, `@cdps/domain`
**2590/2590 (1 skip, tidak berubah)**, `@cdps/db` **107/107** (`pdt.registry.test.ts` TS≡DB
tetap hijau), `@cdps/api` **576/576 (2 skip)**; `npm run typecheck --workspaces` bersih;
`npm run lint -w @cdps/api -- --max-warnings 0` bersih. `web-internal`/`wire.ts` TIDAK
disentuh — baris fakta belum punya konsumen UI (sama seperti modul KEENAM).

**Q-6 (isi `Kata Pencarian`/`SOV` sebagai dimensi laporan) TETAP terbuka** — ini tidak
menutupnya, hanya memakai kolomnya untuk kunci unik baris.

## 2. Keputusan A — lookup produk induk → SKU varian (`G1-09-2BII-ADS-CPC-SKU`)

**Contoh kasus.** Produk "Cover Body ... Vario 125" (`Kode Produk 22571212550`) punya 14 varian
di `pdt_sku_master`. `ProductPerformance_*.csv` (`shopee_ams_produk`) melaporkan SATU baris
untuk `Kode Item 22571212550` dengan `Omzet Penjualan(Rp) 54.587.884` — gabungan 14 varian,
sistem tidak pernah tahu varian mana menyumbang berapa.

**Rekomendasi: tambah kolom `platform_product_id varchar(64) NULL` (tanpa FK) di
`pdt_fact_sku_period`/`pdt_fact_ads`, diisi LANGSUNG dari `Kode Produk` (copy identitas, bukan
lookup), `sku_id` tetap NULL untuk baris level produk-induk.** Konsumen per-varian tetap pakai
`shopee_parent_sku`/`tt_orders` (sudah UPSERT ke `pdt_sku_master`); konsumen per-produk query
`platform_product_id` langsung, JOIN opsional 1-ke-banyak ke `pdt_sku_master` bila perlu daftar
varian. **Alternatif lebih murah**: tunda `shopee_ams_produk`/modul KETUJUH-nya tanpa batas
waktu, `shopee_ads_cpc.sku_id` tetap NULL selamanya (status quo, valid tapi GMV-per-SKU dari
iklan/AMS tidak akan pernah terisi).

**Butuh jawaban Yohan/Hans/Anty**: apakah ada kebutuhan bisnis nyata melihat GMV/komisi
**per PRODUK** (bukan per varian) dari iklan/AMS? Kalau ya → opsi kolom baru. Kalau tidak →
tunda (lebih murah). Detail lengkap: `HANDOFF_PDT_SESI21.md` §3.A.

## 3. Keputusan C — `shopee_diskon`/`shopee_flash_sale`, kolom mana yang dipanen

**Contoh kasus.** `discount_*.xlsx` sheet "Kriteria Utama" (`Tipe Promosi = "Diskon"`):
`Penjualan (Pesanan Dibuat) (IDR) = 1.132.581.681`, `Pesanan (Pesanan Dibuat) = 9.887`, dst. —
agregat harian per tipe promosi. Sheet "Rincian Performa" PULA punya baris per promosi
individual (nama, periode, status) — 20+ kolom lagi, belum ada yang minta.

**Rekomendasi (MVP): whitelist HANYA sheet "Kriteria Utama"** — `Tanggal`, `Tipe Promosi`,
`Penjualan (Pesanan Dibuat) (IDR)`, `Penjualan (Pesanan Siap Dikirim) (IDR)`,
`Pesanan (Pesanan Dibuat)`, `Pesanan (Pesanan Siap Dikirim)`. Cukup untuk "berapa GMV dari
diskon toko per hari". `shopee_flash_sale` sejajar + `Jumlah Produk Dilihat`/`Produk Diklik`
(funnel, satu-satunya hal unik flash sale). Signature deteksi sudah aman ditulis:
`shopee_diskon: must: ['Tanggal', 'Tipe Promosi']`; `shopee_flash_sale: must: ['Periode Waktu',
'Jumlah Produk Dilihat']`.

**Butuh jawaban Anty/Hans**: MVP (agregat harian) cukup, atau langsung mau tahu **promosi mana
yang paling efektif** (opsi 2, sheet "Rincian Performa", lebih mahal)? Rekomendasi: mulai MVP —
menambah baris `kolomDipanen` nanti tidak pernah breaking change. Detail: SESI21 §3.C.

## 4. Item D (menunggu pemilik) dan E (boleh dikerjakan) — ringkas

- **D — `shopee_video`**: TERVERIFIKASI DEFINITIF (PR #380) laporan "Video Overview" Shopee
  agregat satu akun per periode, NOL identitas video. **Butuh Yohan cek Shopee Seller Center**
  apakah ada laporan lain ("Content Performance"/"Daftar Video") SATU BARIS PER VIDEO. Kalau
  tidak ada sama sekali → turunkan `shopee_video` dari `wajib: true` PRD §7.2 (butuh persetujuan
  pemilik, ini deviasi scope PRD). Detail: SESI21 §3.D.
- **E — `shopee_live` identitas sesi**: `Waktu Mulai` (menit presisi) TIDAK PERNAH berulang
  di sample (satu akun = satu sesi live berjalan pada satu waktu). Rekomendasi:
  `platform_content_id = to_char(waktu_mulai, 'YYYYMMDDHH24MI')`. **Risiko rendah, TIDAK
  butuh keputusan bisnis** — boleh dikerjakan Claude sesi berikutnya langsung (dicatat sebagai
  deviasi `DECISIONS.md` seperti biasa, bukan menunggu jawaban). Detail: SESI21 §3.E.
  **Kandidat task paling siap untuk sesi 23.**

## 5. Setup teknis untuk sesi berikutnya

```
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
bash scripts/db-rebuild.sh --yes
```
Password TIDAK persisten antar restart cluster. `npm install` di root DAN
`cd web-internal && npm install` TERPISAH (bukan bagian dari root workspaces).

⚠️ **Jangan jalankan suite penuh `@cdps/domain` dua kali berturut-turut tanpa
`db-rebuild.sh` di antaranya** — `admin.test.ts`/`client.test.ts` menghitung baris `audit_log`
PERSIS dan gagal PALSU di run kedua (bukan regresi).

Command verifikasi standar:
```
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm run test -w @cdps/<pkg>
npm run typecheck --workspaces
npm run lint -w @cdps/api -- --max-warnings 0
```

## 6. Rujukan

- `HANDOFF_PDT_SESI21.md` — investigasi ZIP Fim Motor lengkap, kelima keputusan (A-E) versi
  penuh dengan seluruh contoh kasus.
- `docs/DECISIONS.md` — cari `2026-09-14` + `sesi 22`/`modul KETUJUH` untuk baris Decided baru,
  `~~G1-09-2BII-ADS-SEARCH~~` untuk baris Open yang ditutup.
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §2.4 — diperbarui sesi ini.
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status baru "sesi 22" di akhir blok.
- `packages/core/src/pdt/fakta.ts`/`fakta.test.ts`, `packages/domain/src/pdt.ts`/`pdt.test.ts`
  — diff kode lengkap modul KETUJUH.
