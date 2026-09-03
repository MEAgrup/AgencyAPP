# Backlog — Insight Laporan Editable + Client Portal (Gelombang 1)

Rencana penuh (empat gelombang) ada di rencana sesi 2026-09-08. Berkas ini melacak
**Gelombang 1**, yang SUDAH SELESAI, plus sisa gelombangnya sebagai daftar tiket.

Konteks: tim advertiser MEA memakai tiga alat HTML standalone (MEA SKU Screener v2,
Shopee Report Engine, TikTok Report Engine) di luar CDPS, dan laporan bulanan
dikirim ke klien sebagai link embed manual. Audit kode menemukan engine laporan
**TikTok sudah ada di CDPS dan lebih detail** daripada HTML yang dipakai tim
(13 seksi vs 12) — yang hilang hanya (a) insight bisa disunting, (b) klien punya
tempat membacanya.

---

## Gelombang 1 — SELESAI (2026-09-08)

| # | Tiket | Status | Bukti |
|---|---|---|---|
| CR-01 | Core: `PayloadInsight`, `renderBody/renderReportHtml` terima override, `insight-edit.ts` (validasi + normalisasi, pesan BI) | ✅ | core 327/327; uji regresi "tanpa override identik byte-per-byte" |
| CR-02 | Migrasi `20260908010000`: mesin `client_report` #31, `client_report_insight` (append-only), `client_report_publikasi` (paku revisi), pintu komplain #3, rate limit | ✅ | `db-rebuild` 167 migrasi, semua gate + 4 invariant; 14 uji perilaku constraint langsung di Postgres |
| CR-03 | Migrasi `20260908020000`: `sm_transition` sadar tipe kolom id (cast di parameter) | ✅ | domain 1716/1716 — 30 mesin lain tak berubah perilaku |
| CR-04 | Domain `report.ts`: get/save/reset insight, publish/republish/revoke | ✅ | 27 tes `report.domain.test.ts` termasuk alur paku penuh |
| CR-05 | Domain `client-portal.ts`: listReports, reportHtml, serviceProgress, healthSummary, submitComplaint, logAccess | ✅ | 22 tes, termasuk isolasi antar-klien lewat id EKSPLISIT di URL |
| CR-06 | Route internal (5) + route portal (5) + `mapError` | ✅ | api 390/390, `route-parity` `KNOWN_GAPS` tetap kosong |
| CR-07 | `wire.ts` mapper + guard O43 diperluas ke `web-client-portal` | ✅ | `shape-parity` menangkap 3 hal saat dikerjakan, bukan hijau karena pengecualian |
| CR-08 | `web-internal`: `InsightEditor.tsx` + integrasi `ReportPanel` | ✅ | web-internal 427/427, `tsc` bersih |
| CR-09 | `web-client-portal`: 4 halaman + nav + CSP | ✅ | `npm run build` sukses (10 route), 19/19, lint bersih |
| CR-10 | Paritas visual dokumen: 2 chart kuadran, ikon, meter skor, unduh PDF | ✅ | dibuka di Chromium sungguhan: 6/6 kanvas TERGAMBAR |
| CR-11 | Dokumen: DECISIONS ×5, STATE_MACHINES §21, DATA_MODEL, catatan security spec, backlog ini | ✅ | — |

### Yang TIDAK dikerjakan di Gelombang 1 (sadar, bukan terlupa)

- Multipart upload / Supabase Storage — parse tetap di browser, provenance tetap sha256.
- Komponen/bobot baru di Health Score M13 — laporan **ditampilkan**, tidak **dinilai**. `Satisfaction` tetap N/A sampai CSAT punya tiketnya sendiri.
- Surface invoice/pembayaran di portal (OQ-6: nol di v1).
- Riwayat komplain untuk klien (M15 Rule 6 submit-only).
- Mem-vendor Tailwind/Chart.js/FontAwesome lokal untuk dokumen laporan — CSP-nya sudah allow-list eksplisit; ini perbaikan lanjutan (**CR-12**), bukan blocker.
- 1 error lint `react-hooks/static-components` di `web-internal/src/app/(shell)/admin/employees/page.tsx` — **PRE-EXISTING** (terbukti identik saat perubahan gelombang ini di-stash), di luar cakupan.

---

## Gelombang 2 — Report engine Shopee (paritas penuh) — SELESAI (2026-09-03)

| # | Tiket | Status |
|---|---|---|
| SH-01 | `packages/core/src/report/shopee/detect.ts` — 17 tanda tangan berkas (`bisnis_home\|produk\|live\|video\|kesehatan`, `ads_toko\|produk\|live\|banner`, `aff_product\|creator`, `promo_diskon\|voucher\|flashsale`, `layanan_chat\|broadcast`, `meta`) | ✅ |
| SH-02 | `metrik.ts` + `skor.ts` — 6 dimensi berbobot (ROAS & Channel .22, Traffic Quality .22, Conversion & Retention .18, Product Performance .14, Live Streaming .12, Kesehatan Toko .12) | ✅ |
| SH-03 | `insight.ts` + `payload.ts` (`cdps.report.shopee.v1`) + `render.ts` + `run.ts` | ✅ |
| SH-04 | `client_reports.payload_schema varchar(48) NOT NULL DEFAULT 'cdps.report.tiktok.v1'` — kolom ditambah di kanan; tabel beku untuk UPDATE, jadi DEFAULT mengisi baris lama tanpa update. `renderReport` memilih renderer dari nilai itu | ✅ |
| SH-05 | Benchmark Shopee berversi (perluas `report_benchmark` atau tabel sendiri) — skor WAJIB recomputable | ✅ |
| SH-06 | **Metric Entry (`MTR-`) dari hasil parse** — jalur "tidak upload manual" untuk M6D RM-C. `MTR-` sudah punya `entry_method='File Export'` (M8 §9.4). BUKAN menulis `wrr_metrik` langsung: baris `otomatis` di sana UPDATE-blocked dan itu invariant beku | ✅ |
| SH-07 | **UI form laporan Shopee** — `ShopeeReportForm.tsx` + radio "Mesin laporan" di `ReportPanel`, `parseShopeeExportFile` (SEMUA sheet + penanda `__SHEET__:`), 17 override modul, pemilih kampanye yang dikecualikan lewat `GET /clients/{id}/reports/shopee/campaigns` | ✅ 2026-09-03 |

**Wajib diperbaiki saat porting** (pola `docs/design/README.md`, jangan port apa adanya): `null` jangan jadi `0`; format uang rumah `Rp. X.XXX.XXX,00` dan pembagian nol → `—`; `new Date()` klien → jam WIB server; benchmark editable di browser ⇒ tak recomputable; blok internal **tidak dibangun** di mode klien, bukan `display:none`. Parser angka Indonesia SUDAH ada (`packages/core/src/baseline/angka.ts` `n(v, raw)`) — jangan tulis yang kedua.

---

## Gelombang 3 — MEA SKU Screener (Modul A, B, C, D) — SELESAI (2026-09-03)

Prefix baru: `SCR-` (screening run, dipakai Modul A **dan** B lewat kolom `jenis`) dan `ADL-` (Ads Decision Log, Modul C). Modul D anak dari `SCR-` (keyed `screening_id, product_code`, nol prefix). `entity_prefix` 37 → 39 di **tiga** tempat + dua gerbang hitungan.

| # | Tiket | Status |
|---|---|---|
| SC-00 | **Konfirmasi 10 asumsi terbuka PRD (A01–A10) SEBELUM sprint** — A08 (default ROAS Fase 1 = 3,57) dan A03 (Kode Produk sebagai primary key) paling berdampak. Masuk `DECISIONS.md` bagian Open sebagai `SCR-1..SCR-10` | ✅ |
| SC-01 | `packages/core/src/skuscreener/route.ts` — R05 lima rute berurutan (Scale / Kandidat Iklan / Optimasi Gambar-Judul / Optimasi Deskripsi-Harga / Parkir) | ✅ |
| SC-02 | `cpc.ts` — R06 `CPC max = AOV × CR × faktor ÷ target ROAS`, filter CPC pasar, **anti-rule** (views ≥2.000 & CR <0,5% mengalahkan rute apa pun) | ✅ |
| SC-03 | `median.ts` — R04 median toko sendiri + penurunan ambang iteratif 50% sampai ≥5 SKU atau floor (Views 50 / Clicks 5); floor absolut CTR 2,0% / CR 0,5% | ✅ |
| SC-04 | `roas.ts` — R07/R08 target per fase 1/2/3, biaya platform dari harga jual, service fee flat bulanan ÷ pesanan | ✅ |
| SC-05 | `compare.ts` — R09 kunci Kode Produk → fallback nama ternormalisasi; R10 ambang 20 klik; R11 verdict +20% / −10%; R12 metrik dinilai ditentukan jenis perubahan, **tolak** dua jenis sekaligus | ✅ |
| SC-06 | R02 hanya baris produk induk (`Kode Variasi = '-'`) — cegah double-count GMV. R03 nilai negatif tetap negatif | ✅ |
| SC-07 | Modul C `ADL-`: tangga keputusan R15, tanda `PREMATUR` R14, batas kampanye aktif R16 (`budget_mingguan ÷ Rp350.000`). **Dua entitas, bukan satu** — `OPT-` (M8) log perubahan per KAMPANYE, `ADL-` keputusan pra-kampanye per SKU; alasannya wajib ditulis di `DECISIONS.md` supaya tidak terbaca sebagai duplikasi | ✅ |
| SC-08 | **Domain layer (Modul A-D) + 11 rute API** — `packages/domain/src/skuscreener.ts`, `/api/v1/clients/{id}/skuscreener/**` + `/api/v1/skuscreener/runs/{id}/**`. _Label ini dipakai sesi 2026-09-03 untuk lapisan domain+API; UI-nya jadi SC-09 supaya riwayat commit tetap terbaca._ | ✅ |
| SC-09 | **UI `web-internal/src/app/(shell)/ads/screening/`** — empat tab: A unggah+tabel rute (blok median R04 ditampilkan), B sebelum/sesudah, C Decision Log append-only, D Tracker Optimasi; tombol "keputusan"/"tracker" per SKU = "tempel ke Decision Log/Tracker". ID klien KOLOM bukan picker (SCR-UI-1) | ✅ 2026-09-03 |

Catatan: hasil screening **tidak** mengisi RM-C — screening bukan realisasi, ia alat keputusan.

---

## Gelombang 4 (BELUM dimulai) — TikTok Ads Scanner

Pemilik akan membuat HTML-nya setelah build ini. Yang dicatat di sini adalah slot & kontraknya, bukan spesifikasi fitur (alatnya belum ada untuk dibaca).

| # | Tiket |
|---|---|
| AS-01 | Pilih jalur **sadar**: (a) embed `.html` via `web-internal/public/tools/` + entri `embedded-tools.ts` + baris nav ber-gate, atau (b) port ke `packages/core/`. Aturan pemisahnya: **angka cuma dibaca manusia → embed; angka menggerakkan keputusan sistem → port** (skor yang tak bisa dihitung ulang server-side melanggar aturan rumah #4). Wajib entri `DECISIONS.md` |
| AS-02 | Kalau embed: SheetJS di-vendor lokal (`public/tools/xlsx.full.min.js` sudah ada), payload berversi `cdps.adsscanner.tiktok.v1`, importer server **me-re-derive** field yang menggerakkan keputusan; identitas klien + `generated_at` diinjeksi server (jam WIB), bukan `new Date()` browser |
| AS-03 | Kalau port: ikuti bentuk `report/` — `detect` → `metrik` → `skor` → `insight` → `payload` → `render` → `run`, murni & DOM-free, benchmark berversi |
| AS-04 | Kalau outputnya laporan klien: pakai `renderBody`/`renderReportHtml` yang ada + polish CR-10, bukan sistem desain kedua. Insight editable + portal klien langsung berlaku kalau masuk `client_reports` dengan `payload_schema` sendiri (kolom SH-04) |
