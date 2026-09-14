# HANDOFF — PDT (Pusat Data Toko) SESI 17 → SESI 18

> **Dibuat 2026-09-14.** Baca berkas ini sebelum lanjut (rantai: … → sesi 16 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI16.md` untuk ringkasan merge PR #368,
> `HANDOFF_PDT_SESI14.md`/`HANDOFF_PDT_SESI15.md` untuk detail teknis modul
> pertama/kedua — TIDAK diulang di sini).

---

## 0. Apa yang terjadi sesi ini

Rekomendasi sesi 16 (`shopee_live`/`shopee_video` sebagai kandidat modul KETIGA)
**diinvestigasi dulu, bukan langsung dibangun** (pola yang sudah terbukti perlu
setiap sesi) — **keduanya ternyata BLOCKED**:

1. **`shopee_live`** — kelas blocker SAMA seperti `tt_live` (sudah blocked sejak
   sesi 16): `kolomDipanen`-nya (`Informasi Streaming`, `Waktu Mulai`, `Pengunjung`,
   `Penjualan`) NOL kolom identitas sesi live yang stabil. `Informasi Streaming`
   adalah judul bebas ketikan AM (`detect.test.ts` fixture nyata: `'Live Juli'`),
   bukan ID platform — dua sesi live berjudul sama akan bertabrakan di
   `uq_pdt_fact_content`. Dicatat **Open baru `G1-09-2BII-SHOPEELIVE`**
   (`docs/DECISIONS.md`).
2. **`shopee_video`** — dikonfirmasi ULANG masih `UNVERIFIED_SIGNATURE`
   (`modules.ts`), tidak berubah sejak G1-02.

**`pdt_sku_master` dibangun sebagai gantinya** — peringkat "paling berharga"
sesuai `HANDOFF_PDT_SESI16.md` §1 sendiri (prasyarat `shopee_ads_cpc`,
`pdt_fact_sku_period`, dan `sku_id` di modul manapun):

- **Shopee**: `shopee_parent_sku` SENDIRIAN (Rule 18) — `Kode Produk` →
  `platform_product_id`, `Kode Variasi` → `platform_variation_id` (default `''`),
  `SKU Induk` → `seller_sku`. `nama_produk`/`kategori_platform`/
  `harga_satuan_terakhir` SENGAJA `null` — modul ini genuinely tidak membawa
  ketiganya di `kolomDipanen`.
- **TikTok**: `tt_orders` SENDIRIAN — **DEVIASI SADAR dari Rule 18 harfiah**
  (PRD minta digabung `tt_transaction_product`, tapi nol kolom kunci-gabung
  terverifikasi antara `SKU ID` level-varian dan `Product ID` level-produk-induk
  yang diduga; lihat `docs/DECISIONS.md` untuk alasan lengkap). `tt_orders`
  SENDIRI sudah membawa `Product Category` di `kolomDipanen`-nya, jadi
  `kategori_platform` tetap terisi tanpa berkas kedua. `platform_variation_id`
  TikTok selalu `''`.
- **UPSERT sungguhan** (`ON CONFLICT (client_platform_id, platform_product_id,
  platform_variation_id) DO UPDATE`) — BEDA dari `pdt_fact_ads` (delete-then-
  insert) dan `pdt_fact_content` (`ON CONFLICT DO UPDATE` polos): field opsional
  di-`COALESCE` dengan nilai lama (supaya sumber yang tidak membawa field itu
  tidak menimpanya jadi NULL), `status_listing` selalu `'aktif'` saat SKU
  terlihat di batch (Rule 19), `first_seen_at` HANYA diisi sekali (saat INSERT).

**Kode & tes:**
- `packages/core/src/pdt/fakta.ts` — `ekstrakBarisSkuMasterShopeeParentSku`,
  `ekstrakBarisSkuMasterTtOrders` (fungsi murni, dedup per `(platformProductId,
  platformVariationId)` di dalam masing-masing berkas).
- `packages/domain/src/pdt.ts` `commitUploadBatch` — blok UPSERT baru sebelum
  `insertAudit`.
- `packages/core/src/pdt/fakta.test.ts` — 10 tes baru (murni, tanpa DB).
- `packages/domain/src/pdt.test.ts` — 6 tes baru (`describeDb`, perlu
  `DATABASE_URL`): satu baris/SKU, UPSERT commit-ulang (`first_seen_at` tetap,
  `last_seen_at` maju), identitas `tolak` ⇒ nol baris, dedup lintas-baris-pesanan
  TikTok. `afterEach` juga ditambah pembersihan `pdt_sku_master` (FK ke
  `client_platforms` tanpa `ON DELETE CASCADE`, sama pola `pdt_fact_ads`/
  `pdt_fact_content` — lupa menambah ini di awal sempat membuat `afterEach`
  gagal dengan FK violation, sudah diperbaiki sebelum commit).

**Verifikasi dijalankan (lingkungan sesi ini kosong `node_modules`/DB — keduanya
disiapkan dari nol):**
- `npm install` di root (421 paket).
- Local Postgres 16 cluster (`pg_ctlcluster 16 main start`) + `scripts/db-rebuild.sh
  --yes` — 232 migrasi, seluruh gate (`public` 175, `entity_prefix` 44,
  `sm_machines` 35, `notif_events` 74) dan 4 invariant SQL lolos. **Nol migrasi
  baru sesi ini** — `pdt_sku_master` sudah ada sejak G1-01, gate tidak bergerak.
- `npm run typecheck --workspaces` — bersih (4 paket).
- `npm run test -w @cdps/core` — 1164 tes lolos (termasuk 29 tes `fakta.test.ts`,
  19 lama + 10 baru).
- `npm run test -w @cdps/domain` (dengan `DATABASE_URL` ke DB lokal) — 2564
  lolos, 1 skip (termasuk 73 tes `pdt.test.ts`, 67 lama + 6 baru).
- `npm run test -w @cdps/api -- pdt` — 58 lolos, 2 skip (tidak tersentuh sesi
  ini, dijalankan untuk memastikan nol regresi).
- `npm run lint --workspaces` — bersih.

Password role `postgres` di cluster lokal di-set ke `postgres` (`ALTER USER
postgres WITH PASSWORD 'postgres'`) supaya `DATABASE_URL=postgres://postgres:
postgres@127.0.0.1:5432/cdps` bisa dipakai — kalau sesi berikutnya mendapat
kontainer baru, ulangi urutan ini: `pg_ctlcluster 16 main start` →
`su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""` →
`scripts/db-rebuild.sh --yes`.

**Nol perubahan migrasi/skema** — `pdt_sku_master` dipakai APA ADANYA dari
skema G1-01, nol kolom baru.

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — lanjutkan G1-09 sub-langkah 2b-ii ke modul KEEMPAT,**
   atau mulai kaitkan `sku_id` yang baru lahir ke modul yang SUDAH ditulis:
   - **Kaitkan `pdt_sku_master` ke `shopee_ads_cpc` → `pdt_fact_ads`** — Open
     `G1-09-2BII-ADS-CPC` sekarang TERBUKA (SKU master ada). `Kode Produk` di
     modul ini bisa di-lookup ke `pdt_sku_master.id` (via
     `(client_platform_id, platform_product_id='Kode Produk', platform_variation_id)`
     — perlu diputuskan variation id apa yang dipakai kalau CPC tidak
     membawanya sendiri, mungkin `''` mengikuti pola SKU induk).
   - **Resolusi `sku_id` untuk `tt_video`/`shopee_ads_live` yang SUDAH ditulis**
     — keduanya sekarang menulis `sku_id=NULL` selamanya; dengan
     `pdt_sku_master` ada, ini bisa diisi (butuh keputusan: `tt_video` sumber
     SKU-nya kolom `Produk` yang BELUM diverifikasi formatnya cocok dengan
     `tt_orders.SKU ID` atau `Product Name` — verifikasi dulu, jangan tebak).
   - **`shopee_video`/`tt_live` masih BLOCKED** (Open `G1-09-2BII-SHOPEELIVE`
     yang baru + `G1-09-2BII-TTLIVE` lama) — jangan diulang kecuali ada sample
     asli baru.
   - **`G1-09-2BII-SKU-STATUS-TRANSISI`** (Open baru sesi ini) — kriteria
     `status_listing` → `nonaktif`/`dihapus_platform` belum ditentukan PRD;
     perlu keputusan pemilik/Hans-Anty sebelum dibangun.
2. Item lama masih terbuka, tidak tersentuh sejak sesi 13-16: `G1-07-
   PERSKU-PESANAN`, `G1-07-TIKTOK-REKONSILIASI`, `G1-09-DETEKSI-PREAMBLE-
   AMBIGU`, `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR`.
3. G1-09 sub-langkah 3 (halaman upload `web-internal`) dan endpoint konfirmasi
   identitas AM (`usulkan_ikat` → menulis `client_platforms.shop_id`/
   `akun_konten_toko`) — masih belum ada.
4. **CI `db-and-migrations`** — masih belum diperbaiki (pra-ada sejak sebelum
   sesi 16, di luar cakupan PDT murni). Tidak dicek ulang sesi ini (nol push ke
   GitHub sesi ini — lihat §2).

## 2. Konteks penting untuk sesi berikutnya

- **Kerja sesi ini ADA DI BRANCH SESI** (`claude/ecstatic-cannon-78wwsn`,
  fast-forward dari `origin/main` saat sesi dimulai) — BELUM di-PR/merge.
  Sesi berikutnya: cek dulu apakah branch ini sudah di-PR-kan/merge sebelum
  menumpuk komit baru di atasnya; kalau sudah merged, mulai dari `main` seperti
  instruksi baku (lihat `HANDOFF_PDT_SESI16.md` §2 untuk pola yang sama).
- **Tiga modul/tiga tabel fakta (dari enam) kini punya penulis**:
  `pdt_fact_ads` (`shopee_ads_live`), `pdt_fact_content` (`tt_video`),
  `pdt_sku_master` (`shopee_parent_sku`+`tt_orders`). Sisa: `pdt_fact_sku_period`,
  `pdt_fact_creator_period`, dan seluruh modul lain yang belum dipetakan ke
  `pdt_fact_ads`/`pdt_fact_content`.
- **Progress ringkas G1-09**: lihat `docs/backlog/PDT_BACKLOG.md` §G1-09 status
  teratas untuk rincian lengkap sesi ini.

---

## 3. Rujukan

- `docs/handoff/HANDOFF_PDT_SESI16.md` — ringkasan merge PR #368 (nol kode baru
  sesi itu, murni administratif).
- `docs/handoff/HANDOFF_PDT_SESI14.md`/`HANDOFF_PDT_SESI15.md` — modul
  pertama/kedua, detail teknis lengkap.
- `docs/DECISIONS.md` — baris Decided 2026-09-14 (modul KETIGA, paling atas) +
  Open baru `G1-09-2BII-SHOPEELIVE`/`G1-09-2BII-SKU-STATUS-TRANSISI` (paling
  atas tabel Open).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status ringkas seluruh sub-langkah.
- `packages/core/src/pdt/fakta.ts` — docblock kepala berkas menjelaskan urutan
  ketiga modul dan kenapa masing-masing dipilih.
