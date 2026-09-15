# HANDOFF — Product Exchange M3-B, SESI 1 (2026-09-15)

Baca ini dulu untuk tahu posisi sebenarnya sebelum menyentuh apa pun di modul `productexchange*`.

## 0. Apa yang terjadi sesi ini

Dibangun dari nol sampai selesai dalam SATU sesi, paralel dengan PDT G2 di chat lain:

- Migrasi `supabase/migrations/20261031010000_px_m3b_volume_eligibility_coverage.sql` — 5 tabel
  (`px_sku_volume`, `px_sku_kategori`, `px_sku_eligibility`, `px_coverage_snapshot`,
  `px_coverage_push`) + view `px_catalog_item_v` + seed `px_eligibility_policy` versi 2
  (`price_segment_bands`, `platforms: ["tiktok","shopee"]`).
- Mesin murni gerbang empat lapis: `packages/core/src/px/gerbang.ts`.
- Domain: `packages/domain/src/productexchange-m3.ts` (Flow A/B/C penuh, konfirmasi kategori,
  reads Kandidat/Katalog/kreator_kosong) + edit `productexchange.ts` (predikat baru, ContractError,
  `price_segment_bands` di `validasiNilai`, hook `createEligibilityPolicy`→`evaluateTick`).
- API: 6 route (`internal/bridge/px-coverage`, `internal/px/evaluate/tick`, `px/kandidat` (GET+PUT
  kategori), `px/kategori-options`, `px/katalog`, `px/laporan/kreator-kosong`) + `wire.ts` + `http.ts`
  (422) + `bridge-auth.ts` (`bridgePxSecretOk`).
- FE: `web-internal/src/lib/px.ts` diperluas, dua halaman baru (`/px/kandidat`, `/px/katalog`),
  `nav.ts` +2 entri.
- Dokumen: PRD verbatim `docs/prd/CDPS_ProductExchange_M3.md`, kontrak
  `docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md` + fixture `docs/fixtures/px_coverage_v1.json`,
  `docs/backlog/PX_M3_BACKLOG.md`, entri `docs/DECISIONS.md` (PX-M3-01..08 + lima baris Open +
  satu tiket PDT), `docs/DATA_MODEL.md`, `PERMISSIONS.md`, `docs/prd/CDPS_Build_Plan.md`.

**Delapan deviasi dari PRD dicatat sebagai PX-M3-01..08** — baca blok "Catatan penerapan di CDPS"
di puncak `docs/prd/CDPS_ProductExchange_M3.md` untuk daftar lengkap sebelum membaca §3+ PRD itu
sendiri, dan `docs/DECISIONS.md` 2026-09-15 untuk rincian penuh + verifikasi.

## 1. Yang BELUM dikerjakan sesi ini (bukan lupa — dicatat sengaja)

1. **Aktivasi tick/hook** — `docs/backlog/PX_M3_BACKLOG.md` §"Status M3-B", dua titik
   (`vercel.json` cron + hook route commit PDT). Ditunda ketokan pemilik sampai PDT G1 `verified`
   di ≥10 klien. Tick route (`POST/GET /internal/px/evaluate/tick`) SUDAH ADA dan bekerja — hanya
   belum dipanggil otomatis oleh siapa pun.
2. **M3-A** (`yohanagustian-del/mcnapp`) — sesi terpisah sama sekali, `add_repo` menolak lintas-owner
   dari sesi ini. Kontrak + fixture sudah siap disalin identik (§Tiket `PX_M3_BACKLOG.md`).
3. **`PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR`** — TikTok tidak punya penulis `pdt_fact_sku_period`.
   Dikirim ke chat PDT sebagai tiket lintas-tim, BUKAN dikerjakan di sini (module boundary: `pdt.ts`
   TIDAK disentuh sesi ini, sesuai pagar CLAUDE.md).
4. **Lima Open Assumptions PRD** belum terjawab manusia (`M3-01-REGION`, `M3-02-PRICE-SEGMENT-VALUES`,
   `M3-03-KATEGORI-MAPPING`, `M3-05-PUSH-TRIGGER`, `M3-08-SENGKETA-90-HARI`) — lihat `DECISIONS.md`
   §Open. Yang paling berbahaya bila diam-diam salah: `M3-02` — nilai `price_segment_bands`
   placeholder bisa membuat L4 gagal tanpa sebab yang kelihatan kalau berbeda dari taksonomi MCN
   sesungguhnya.

## 2. Berkas panas — JANGAN sentuh tanpa koordinasi chat PDT

`packages/domain/src/pdt.ts` (+test), `packages/core/src/pdt/*`, `docs/backlog/PDT_BACKLOG.md`.
Sesi ini TIDAK menyentuh satu pun — retensi PX-M3-08 sengaja ditulis dari sisi domain PX
(`evaluateStoreProducts`), bukan `planPdtPurgeTick`.

## 3. Rujukan cepat untuk sesi lanjutan

- **Kunci per produk, bukan varian** (PX-M3-07) — kalau PDT kelak membangun penulis fakta TikTok
  per-VARIAN (bukan per-produk), desain M3-B ini TIDAK otomatis benar untuk kasus itu; perlu ditinjau
  ulang bersamaan dengan tiket `PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR`.
- **Jendela = bulan kalender penuh** (PX-M3-02), BUKAN 30 hari rolling harfiah — `px.jendelaBulanPenuh`
  (`@cdps/core`). Jangan "perbaiki" ini ke rolling window tanpa membaca kenapa (granularitas fakta
  bulanan, bukan harian).
- **`evaluateTick`/`recomputeDanEvaluasi` self-contained** (fetch policy+coverage sendiri per
  panggilan) — dipilih demi kesederhanaan Phase 1 (skala pilot), BUKAN dioptimalkan untuk NFR PRD
  §6.1 ("~500 klien × ~1.500 SKU < 5 menit"). Kalau skala produksi mendekati itu, refactor untuk
  fetch policy+coverage SEKALI per sweep (parameter tambahan), bukan per-store.
- **`reevaluateAfterCoverage`** menelan error per-toko diam-diam (`.catch(() => {})`) — sengaja
  (Rule 46 PDT error path: satu toko gagal tidak menghentikan sisanya), tapi berarti KEGAGALAN
  SENYAP kalau seluruh sweep gagal sistemik (mis. policy hilang). Belum ada audit_log untuk kegagalan
  di jalur ini (beda dari `recomputeDanEvaluasi` yang punya) — kalau ini jadi masalah nyata di
  produksi, tambahkan audit per-toko di sini juga.

## 4. Verifikasi sesi ini (lokal, DB rebuild bersih)

`scripts/db-rebuild.sh --yes` → gate 181/45/35/76 hijau, 4 invariant SQL hijau. `@cdps/core`,
`@cdps/domain` (termasuk `productexchange-m3.test.ts` `describeDb`, butuh `DATABASE_URL`),
`@cdps/db`, `@cdps/api`, `web-internal` — typecheck + test seluruhnya hijau. Lihat
`docs/DECISIONS.md` 2026-09-15 untuk angka tes persis.
