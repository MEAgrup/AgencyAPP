# HANDOFF — PDT (Pusat Data Toko) SESI 22 → SESI 23 (lanjutan) → SESI 24

> **Dibuat 2026-09-14.** Baca berkas ini SEBELUM mulai kerja teknis baru — ia menutup
> `HANDOFF_PDT_SESI22.md` (modul KETUJUH `shopee_ads_search`, tiga keputusan A/C/D menunggu
> pemilik + satu item E "boleh dikerjakan"). Pemilik menjawab A/C/D dalam satu pesan singkat
> ("A. Kebutuhan hanya gmv per produk bukan sampai varian / C. Jalan rekomendasi / D. Tidak
> ada") — sesi ini mengerjakan ketiganya sampai selesai + satu klarifikasi tambahan (`basis`
> AMS) lewat `AskUserQuestion`.

---

## 0. Apa yang terjadi sesi ini

| Butir | Isi | Status |
|---|---|---|
| **A** | `G1-09-2BII-ADS-CPC-SKU` — `platform_product_id` + modul KEDELAPAN `shopee_ams_produk` → `pdt_fact_sku_period` | ✅ **SELESAI** |
| **C** (§2 SESI22) | `G1-09-2BII-DISKON-FLASHSALE-STRUKTUR` — `shopee_diskon`/`shopee_flash_sale` MVP | ✅ **SELESAI** |
| **D** (§2 SESI22) | `G1-09-2BII-SHOPEEVIDEO-GRAIN` — `shopee_video.wajib` → `false` | ✅ **SELESAI** |
| **E** (§4 SESI22) | `shopee_live` identitas sesi (`platform_content_id` dari `Waktu Mulai`) | 🟢 **BELUM dikerjakan** — masih "boleh dikerjakan tanpa menunggu pemilik" |

**Semua tiga keputusan pemilik sudah dieksekusi penuh — kode, migrasi, tes, dokumentasi.** PR
belum dibuat/di-push sesi ini (cek `git status`/branch saat mulai sesi berikutnya). Rincian
lengkap tiap keputusan ada di `docs/DECISIONS.md` (cari `sesi 23`).

## 1. A — `platform_product_id` + modul KEDELAPAN (paling besar)

**Skema** (migrasi `20261025010000_g1_09_2bii_ads_cpc_sku_platform_product_id.sql`):
- `pdt_fact_ads.platform_product_id varchar(128) NULL` — salinan `Kode Produk`/`Kode Item`
  LANGSUNG dari sumber, BUKAN lookup ke `pdt_sku_master` (yang berkunci per varian). Diisi oleh
  `shopee_ads_cpc`; `shopee_ads_live`/`shopee_ads_search` tetap NULL (nol identitas produk).
- `pdt_fact_sku_period` dapat `client_platform_id bigint NOT NULL` (BARU, didenormalisasi dari
  konteks batch — backfill dari `pdt_sku_master`) + `platform_product_id varchar(128) NULL`.
  `sku_id` DILONGGARKAN nullable + CHECK (`sku_id IS NOT NULL OR platform_product_id IS NOT
  NULL`). Unique index lama diganti DUA index PARSIAL (`_sku` untuk baris ber-`sku_id`, `_produk`
  untuk baris `sku_id IS NULL`). **RLS `pdt_fact_sku_period_sel` diganti** memakai
  `jwt_owns_client_platform_am(client_platform_id)` LANGSUNG (path lama `jwt_owns_pdt_sku_am
  (sku_id)` tetap ada untuk baris ber-sku_id, tidak lagi satu-satunya jalur — baris level-produk
  akan SELALU gagal RLS lama karena `sku_id IS NULL`).

**Kode**: `ekstrakBarisShopeeAdsCpc` sekarang membaca `Kode Produk` (`'-'`/kosong ⇒ `null`).
`ekstrakBarisShopeeAmsProduk` (BARU, modul KEDELAPAN) — `Kode Item`→`platform_product_id`,
`Omzet Penjualan(Rp)`→`gmv`, `Produk Terjual`/`Pesanan` terisi, `Estimasi Komisi(Rp)`/`ROI`
SENGAJA tidak ditulis (tabel ini tidak punya kolom itu — sumbernya PX Flow D, domain lain belum
dibangun). Writer `commitUploadBatch`: replace-on-recommit (DELETE scope
`client_platform_id+sku_id IS NULL+basis+periode` lalu INSERT).

**`basis = 'dibayar'` literal** — ditanyakan ke pemilik lewat `AskUserQuestion` (AMS tidak
menyebut basis GMV-nya di kolom manapun, beda dari `shopee_parent_sku`/G1-07 yang eksplisit).
Pemilik memilih "Pesanan Dibayar/Selesai". **Kalau kelak terbukti salah** (mis. AMS ternyata
basis "dibuat"), titik koreksinya: `ekstrakBarisShopeeAmsProduk` docblock (`fakta.ts`) + baris
literal `'dibayar'` di `commitUploadBatch` (`pdt.ts`) — cari `basis = 'dibayar'`.

**Trade-off dicatat**: query "GMV per SKU" yang berasumsi `sku_id` selalu terisi untuk SEMUA
baris `pdt_fact_ads`/`pdt_fact_sku_period` sekarang harus menangani campuran (`sku_id` ADA) vs
(`platform_product_id` ADA, `sku_id` NULL) — belum ada konsumen hilir yang dibangun di atas ini
(dashboard/laporan), jadi belum ada regresi nyata, tapi dicatat untuk sesi yang membangun
konsumen tersebut.

## 2. C/D — diskon/flash_sale MVP + shopee_video wajib=false

Ringkas (detail penuh di `DECISIONS.md`/`PDT_KOLOM_DIPANEN.md` §2.7/§2.8):
- `shopee_diskon`/`shopee_flash_sale`: `tandaTanganKolom` + `kolomDipanen` MVP (agregat harian
  sheet "Kriteria Utama") dinyalakan. **Nol writer fact-table** — sama seperti `shopee_voucher`/
  `shopee_chat`/`shopee_chat_broadcast`/`meta_ads`, modul-modul ini cukup `parse_status='ok'` +
  audit `pdt_file.kolom_dipanen`. Kalau nanti ada yang minta dashboard "GMV dari diskon/flash
  sale per hari", writer-nya BELUM ada — pekerjaan terpisah (butuh keputusan tabel fakta mana,
  kemungkinan `pdt_fact_shop_daily` sejenis atau tabel promo baru).
- `shopee_video.wajib` → `false`. `tandaTanganKolom`/`kolomDipanen` TIDAK berubah (tetap
  `UNVERIFIED_SIGNATURE`/kosong — PR #380 sudah membuktikan berkas ini struktural tidak bisa
  menulis apa pun). **Nol konsumen kode membaca `.wajib` hari ini** (digrep kosong) — flag ini
  murni registry sampai gerbang "kelengkapan berkas minimum" dibangun.

## 3. Migrasi baru sesi ini

```
20261024010000_g1_09_2bii_pdt_parser_modul_diskon_flashsale_video.sql   (C + D)
20261025010000_g1_09_2bii_ads_cpc_sku_platform_product_id.sql            (A — skema besar)
```

## 4. Item E — belum dikerjakan, paling siap untuk sesi berikutnya

Ringkas dari `HANDOFF_PDT_SESI22.md` §4: `shopee_live` identitas sesi live. Rekomendasi
`platform_content_id = to_char(waktu_mulai, 'YYYYMMDDHH24MI')` — `Waktu Mulai` (menit presisi)
TIDAK PERNAH berulang di sample (satu akun = satu sesi live berjalan pada satu waktu). **Risiko
rendah, TIDAK butuh keputusan bisnis** — boleh dikerjakan Claude sesi berikutnya langsung
(dicatat sebagai deviasi `DECISIONS.md` seperti biasa). Detail lengkap: `HANDOFF_PDT_SESI21.md`
§3.E.

## 5. Setup teknis untuk sesi berikutnya

```
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
bash scripts/db-rebuild.sh --yes
```
Password TIDAK persisten antar restart cluster (container idle bisa mematikan cluster —
`pg_ctlcluster 16 main start` aman dipanggil ulang, `Removed stale pid file` bukan error).
`npm install` di root DAN `cd web-internal && npm install` TERPISAH.

⚠️ **Jangan jalankan suite penuh `@cdps/domain` dua kali berturut-turut tanpa `db-rebuild.sh` di
antaranya** — `admin.test.ts`/`client.test.ts` menghitung baris `audit_log` PERSIS. **Baru
sesi ini**: `afterEach` `pdt.test.ts` HARUS membersihkan `pdt_fact_sku_period` SEBELUM
`pdt_upload_batch` (FK baru `pdt_fact_sku_period.batch_id`) — kalau menambah tabel fakta PDT
baru lagi yang FK ke `pdt_upload_batch`/`client_platforms`, tambahkan baris `afterEach` yang
sama SEBELUM baris `delete from pdt_upload_batch`/`client_platforms`, urutannya mengikuti arah
FK (lihat komentar di `afterEach` `pdt.test.ts` untuk pola lengkap).

Command verifikasi standar:
```
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm run test -w @cdps/<pkg>
npm run typecheck --workspaces
npm run lint -w @cdps/api -- --max-warnings 0
```

## 6. Rujukan

- `HANDOFF_PDT_SESI21.md`/`SESI22.md` — konteks lengkap keputusan A-E.
- `docs/DECISIONS.md` — cari `2026-09-14` + `sesi 23` untuk tiga baris Decided baru + tiga Open
  yang ditutup (`~~G1-09-2BII-ADS-CPC-SKU~~`, `~~G1-09-2BII-DISKON-FLASHSALE-STRUKTUR~~`,
  `~~G1-09-2BII-SHOPEEVIDEO-GRAIN~~`).
- `docs/DATA_MODEL.md` — baris `pdt_fact_ads`/`pdt_fact_sku_period` diperbarui.
- `docs/backlog/PDT_KOLOM_DIPANEN.md` §2.3/§2.7/§2.8/§2.10 — diperbarui sesi ini.
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status "sesi 23" baru di akhir blok.
- `packages/core/src/pdt/fakta.ts` (docblock kepala berkas + `ekstrakBarisShopeeAmsProduk` +
  `ekstrakBarisShopeeAdsCpc` diperbarui), `packages/domain/src/pdt.ts` (`commitUploadBatch`).
