# Backlog — Product Exchange M3

> Disusun 2026-09-15 dari `docs/prd/CDPS_ProductExchange_M3.md` (PRD v1.1) + ketokan pemilik sesi
> 2026-09-15 (`docs/DECISIONS.md`, entri "Product Exchange M3-B dibangun"). M3 terbagi dua bagian
> independen secara repo: **M3-A** (`yohanagustian-del/mcnapp`, eksporter coverage) dan **M3-B**
> (`MEAgrup/AgencyAPP`, penerima coverage + gerbang kelayakan + katalog — berkas ini).

## Status M3-B: **SELESAI dibangun sesi ini** (skema, mesin, domain, API, FE) — **AKTIVASI DITUNDA**

Migrasi `20261101010000` + `packages/core/src/px/` + `packages/domain/src/productexchange-m3.ts`
+ enam route API + dua halaman `web-internal` (`/px/kandidat`, `/px/katalog`). Lihat
`docs/DECISIONS.md` 2026-09-15 untuk rincian penuh (deviasi PX-M3-01..08 + verifikasi).

**Yang BELUM aktif** (ketokan pemilik — tick route manual, TANPA cron/hook otomatis, sampai PDT G1
`verified` di ≥10 klien):

| # | Titik aktivasi | Kapan dikerjakan |
|---|---|---|
| PX-M3-AKTIVASI-1 | Cron `apps/api/vercel.json` untuk `GET /internal/px/evaluate/tick` (mis. `15 18 * * *`, setelah reparse tick) | Setelah gerbang ≥10 klien PDT G1 `verified` terpenuhi |
| PX-M3-AKTIVASI-2 | Satu panggilan `productexchange.recomputeDanEvaluasi(db(), clientPlatformId)` di `apps/api/src/app/api/v1/account/pdt/batches/route.ts:97`, SETELAH `commitUploadBatch` mengembalikan status `verified` — di lapisan ROUTE, bukan `pdt.ts` (kepemilikan modul tetap terpisah) | Sama gerbang — bisa dikerjakan BERSAMAAN dengan AKTIVASI-1, tidak saling bergantung |

## Tiket untuk chat PDT

### `PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR` — `tt_orders` → `pdt_fact_sku_period` basis `'dibayar'`

**Kenapa ini penting untuk M3**: satu-satunya penulis `pdt_fact_sku_period` hari ini
(`shopee_ams_produk`) hanya Shopee. TikTok TIDAK punya penulis fakta per-SKU sama sekali —
setiap SKU TikTok akan SELALU `data_tidak_lengkap` di L2 Product Exchange sampai tiket ini
ditutup.

**Usulan implementasi** (sudah diriset dari sesi M3-B, belum diverifikasi ke sample `tt_orders`
asli — verifikasi itu bagian tiket ini, bukan diasumsikan selesai):
- Sumber: `tt_orders` (modul `Semua pesanan*.csv`, sudah terdaftar `pdt_parser_modul`).
- Agregasi per `(client_platform_id, platform_product_id, periode = bulan Paid Time)` — tambah
  `sku_id` bila varian ter-resolve ke `pdt_sku_master`, `NULL` bila level produk (pola
  `shopee_ams_produk`).
- `gmv = Σ SKU Subtotal After Discount` untuk baris berstatus dibayar/selesai (definisi persis
  status "dibayar" untuk TikTok — keputusan pemilik, verifikasi ke sample).
- `pesanan_sku = Σ Quantity`.
- `gmv_dari_kreator = Σ` baris ber-`Creator Handle` terisi (sinyal afiliasi PX, konsumen
  `pdt_fact_sku_period.gmv_dari_kreator` sudah ada sejak G1-01).
- Hormati unique index parsial `uq_pdt_fact_sku_period_produk`
  (`client_platform_id, platform_product_id, periode, basis` WHERE `sku_id IS NULL`).
- DELETE-then-INSERT per `(client_platform_id, periode, basis='dibayar', sku_id IS NULL)` —
  pola SAMA `shopee_ams_produk` (`pdt.ts` komentar G1-09 sub-langkah 2b-ii), bukan `ON CONFLICT`
  per baris (produk yang delisting dari laporan baru harus ikut hilang).
- Whitelist `kolom_dipanen` modul `tt_orders` — cek sudah memuat `SKU Subtotal After Discount`/
  `Quantity`/`Creator Handle`/kolom identitas produk; kalau belum, perluasan whitelist + reparse
  seluruh batch TikTok yang sudah ter-`verified` dibutuhkan SEBELUM tiket ini bisa dianggap
  selesai (PDT D-27, `docs/prd/CDPS_ProductExchange_M3.md` catatan pembuka (a)).

**Juga cek** (kemungkinan sudah selesai, verifikasi saja): `pdt_sku_master.harga_satuan_terakhir`
terisi dari `SKU Unit Original Price` — penulisnya disebut sudah ada di `pdt.ts:1148-1159` per
audit sesi M3-B, belum dikonfirmasi ulang di sesi ini.

**Blocking**: L2 Product Exchange M3 untuk SELURUH SKU TikTok. Shopee tidak terpengaruh.

## Tiket untuk sesi `mcnapp` (M3-A) — **SELESAI 2026-09-16**

Ditutup di `yohanagustian-del/mcnapp` PR #23 (squash `9158b11`, sesi terpisah — `add_repo`
lintas-owner ditolak dari sesi CDPS). Ringkasan penutupan ada di `docs/DECISIONS.md`
2026-09-16 (entri "PX-M3-A (`mcnapp`) mendarat") dan di `mcnapp`'s `docs/HANDOFF.md`.
Satu deviasi dicatat: `bridge.px_coverage_export()` (butir 2 di bawah) TIDAK dibangun —
`public.px_coverage()` yang sudah ada dari PX-M1 sudah persis passthrough yang dibutuhkan,
nol migrasi baru. Rincian tiket asli (untuk riwayat):

1. Salin `docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md` + `docs/fixtures/px_coverage_v1.json` **identik**
   (byte-untuk-byte) ke `mcnapp`. Dokumen kontrak adalah sumber kebenaran tunggal — jangan
   menebak bentuknya dari kode CDPS.
2. `bridge.px_coverage_export()` (schema `bridge`, sisi MCN) — wrapper atas `px_coverage_map()`
   (sudah ada dari PX-M1) yang HANYA menambah `snapshot_at`. Nol kolom lain (K-1) — menambah kolom
   berarti mengubah kontrak, edit dokumen dulu.
3. Eksporter `src/lib/px/coverage-push.ts`, dipicu dari AKHIR pipeline ingest yang sudah ada.
   Nol scheduler baru (konsisten PX-M1).
4. Secret `BRIDGE_PX_SECRET`, TERPISAH dari `CRON_SECRET` dan `BRIDGE_INGEST_SECRET` sisi CDPS
   (preseden D12) — nilai disepakati di luar kode (env var kedua sisi, tidak di-commit).
5. Tes: bentuk payload persis 6 kolom + `snapshot_at` (gagal bila kolom tambahan); nol
   `creator_id`/`creator_ids` (K-2, tes eksplisit); `.qa-manual.test.ts` push ke CDPS staging,
   verifikasi 200 + jumlah baris.
6. `Idempotency-Key: px-coverage-<YYYYMMDD>-<sha256(payload)[0:12]>` — hash dihitung dari body
   PERSIS yang dikirim (urutan key JSON stabil), supaya retry mengirim key yang sama.

## Open Assumptions PRD masih terbuka (lihat `docs/DECISIONS.md` §Open untuk rincian)

~~`M3-01-REGION`~~ dan ~~`M3-02-PRICE-SEGMENT-VALUES`~~ **SUDAH TERTUTUP** (2026-09-16 — region
diverifikasi live, band price_segment dijawab langsung pemilik & persis cocok taksonomi MCN
existing, `px_eligibility_policy` versi 3 migrasi `20261102010000`). ~~`M3-05-PUSH-TRIGGER`~~ juga
tertutup (M3-A `mcnapp` merge). Masih terbuka: `M3-03-KATEGORI-MAPPING` (Hans),
`M3-08-SENGKETA-90-HARI` (Nerissa). `M3-04`
(`optimization_tracker` sebagai basis master SKU) dan `M3-06`/`M3-07` dari PRD §8 tidak dibawa ke
Open terpisah — M3-06 (`require_stock_in`) sudah diputuskan tidak dibaca Phase 1 (PX-M3-05, lihat
`docs/DECISIONS.md`), M3-07 (`kolom_dipanen` lengkap) menyatu dengan tiket
`PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR` di atas.
