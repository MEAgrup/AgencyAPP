# PLAN — Konsolidasi Alat Advertiser MEA ke dalam CDPS

**Pemilik permintaan:** Yohan Agustian (Director, PT MEA Agensi Digital)
**Dibuat:** 2026-09-03 · **Branch:** `claude/cdps-advertiser-tools-consolidation-xxpzow` · **PR:** [#276](https://github.com/MEAgrup/AgencyAPP/pull/276)
**Status (2026-09-03, setelah PR [#277](https://github.com/MEAgrup/AgencyAPP/pull/277) merge):** Gelombang 1 **SELESAI & sudah di live**. Gelombang 2 (Shopee, SH-01…SH-07) dan Gelombang 3 (SKU Screener, SC-00…SC-09) **SELESAI di `main`, termasuk UI** — dan **migrasinya SUDAH diterapkan ke `CDPS SG` live** (2026-09-03, lewat `apply_migration`: `gelombang3_sku_screener` + `sh01_shopee_report_engine`; `entity_prefix` 39, relasi 144, semua gate cocok dengan lokal). **UAT dengan export Shopee ASLI sudah dijalankan** (Fim Motor Juli 2026, 15 berkas — engine LOLOS, semua angka cocok ke berkas mentah): `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`. Tiga keputusan pemilik yang muncul dari UAT itu **sudah dijawab dan ditindaklanjuti hari yang sama** (SHP-1 opsi C: `gmv_kotor`=Pesanan Dibuat & `gmv_net`=Pesanan Dibayar, `clients.total_sales` ikut Dibayar; SHP-2 ambang skor dibiarkan; SHP-3 pengenalan nama berkas mentah Shopee ditambahkan — deteksi export asli naik dari 8/15 ke **15/15 tanpa override**). Lihat `DECISIONS.md` dan §7 dokumen UAT. Gelombang 4 (TikTok Ads Scanner) belum dimulai: engine `packages/core/src/adsscanner/tiktok/` sudah ada, migrasi + domain + UI belum.
**Handoff eksekusi:** `docs/handoff/HANDOFF_INSIGHT_EDITABLE_CLIENT_PORTAL_20260908.md`
**Tiket kecil:** `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md`

---

## 1. Kenapa ini ada

Tim advertiser MEA memakai tiga alat HTML standalone **di luar** CDPS:

| Alat | Bentuk | Dipakai untuk |
|---|---|---|
| **MEA SKU Screener v2** | HTML + PRD v1.0 (R01–R16, Modul A/B/C/D) | memilih SKU mana yang layak diiklankan |
| **MEA Shopee Report Engine** | HTML, 17 modul berkas, 12 seksi | laporan performa Shopee |
| **MEA TikTok Report Engine** | HTML, 12 modul, 12 seksi | laporan performa TikTok |

Konsekuensinya: laporan bulanan dikirim ke klien sebagai **link embed HTML manual**, klien tidak punya tempat mengajukan komplain selain WhatsApp AM, dan angka hasil parse berhenti di clipboard — tidak pernah mengisi laporan mingguan/bulanan CDPS.

Yang dituju: **satu sistem.** Export mentah diparse jadi insight → insight tersimpan dan mengisi laporan CDPS tanpa upload manual → teks insight bisa disunting tim (angka **tidak**) → klien membaca hasil final di portal dan bisa komplain di sana.

### Yang ternyata sudah ada (hasil audit kode, bukan asumsi)

Temuan terpenting sesi ini: **report engine TikTok SUDAH ADA di CDPS dan lebih detail daripada HTML yang dipakai tim.**

| Yang dicari | Status |
|---|---|
| Report engine TikTok | ✅ `packages/core/src/report/` — **13 seksi vs 12**; punya seksi *TikTok Ads Manager (Brand & Upper Funnel)* yang HTML kiriman tidak punya; blok INTERNAL **dibuang dari string** (bukan `display:none`, jadi tak kebaca di View Source); benchmark berversi (`report_benchmark`) ⇒ skor recomputable. **Yang dipakai: versi CDPS.** |
| Insight bisa diedit | ✅ **dibangun Gelombang 1** (sebelumnya tidak bisa — `payload` dibekukan trigger) |
| Klien lihat laporan | ✅ **dibangun Gelombang 1** |
| Klien ajukan komplain | ✅ **dibangun Gelombang 1** (pintu #3) |
| Report engine Shopee | ❌ Gelombang 2 |
| SKU Screener A/B/C/D | ❌ Gelombang 3 |
| TikTok Ads Scanner | ⏳ Gelombang 4 — HTML akan dibuat pemilik menyusul |

---

## 2. Keputusan pemilik yang mengikat

Diambil lewat `AskUserQuestion` di sesi ini. **Jangan ditafsir ulang tanpa entri `DECISIONS.md` baru.**

| # | Keputusan |
|---|---|
| 1 | Insight editable, **AM menyunting dan menerbitkan sendiri** — tanpa gerbang review Head of Account |
| 2 | Shopee **diport penuh** (bukan sekadar di-embed) |
| 3 | SKU Screener **keempat modul** masuk (A screening, B sebelum/sesudah, C Decision Log, D Tracker Optimasi) |
| 4 | Portal klien **sekalian Service Progress + Health band** |
| 5 | Urutan: **insight editable + portal klien dulu**, lalu Shopee, lalu SKU Screener |
| 6 | **Tampilan HTML wajib semenarik output engine milik pemilik** |
| 7 | **TikTok Ads Scanner menyusul** setelah build ini — slot & kontrak integrasinya dicatat sebagai Gelombang 4 |

---

## 3. Keputusan arsitektur yang harus dipertahankan

1. **Insight editan TIDAK masuk `payload`.** Lapisan revisi append-only (`client_report_insight`) + `client_report_publikasi.insight_revisi` yang **memaku** revisi mana yang dilihat klien. Angka tetap immutable (aturan rumah #3/#4); teks boleh direvisi berkali-kali; klien tidak pernah melihat draf.
   *Kenapa dipaku, bukan "revisi terbaru menang":* kalau terbaru menang, setiap tekan Simpan langsung jadi pengumuman — AM tak bisa menyunting laporan yang sudah tayang tanpa klien menonton prosesnya. Dengan paku: menyimpan aman, **Terbitkan pembaruan** yang memindahkan paku. Pratinjau internal membaca revisi **terbaru**; render klien membaca yang **terpaku**.
2. **Status publikasi TIDAK di `client_reports`.** Tabel itu beku untuk SEMUA update — bukan per kolom. Status hidup di `client_report_publikasi`, ditulis **eksklusif** oleh `sm_transition` (mesin `client_report`, #31).
3. **Laporan dirender same-origin, bukan iframe lintas-origin.** Karena engine-nya milik CDPS sendiri, **OQ-8 (token pass-through ke `mea-client-reporting`) tertutup dengan sendirinya** — tak ada sistem eksternal, tak ada token untuk dilewatkan. M15 Rule 3 ("natively embedded") tetap terpenuhi dengan permukaan serang lebih kecil.
4. **Parse di browser, skor di server.** Pola RAB-04 yang sudah jalan: browser → `{filename, aoa, sha256, ukuranBytes}` → server `readSheet` → `detect` → `runReport`. Supabase Storage belum dikonfigurasi; provenance = sha256. **Jangan** tambah multipart/Storage.
5. **Komplain submit-only** (M15 Rule 6) — nol endpoint GET, juga tidak sebagai stub.
6. **Portal punya modul domain sendiri** (`packages/domain/src/client-portal.ts`) yang mengembalikan DTO sempit — **bukan** objek domain internal yang di-serialize sebagian (spec §4.3).

---

## 4. GELOMBANG 1 — Insight editable + Client Portal ✅ SELESAI

Sudah dibangun, diuji, di-commit, dan **migrasinya sudah di `CDPS SG` live** (2026-09-03).

| Klaster | Isi |
|---|---|
| §1.1 Core | `PayloadInsight` diekspor; `renderBody(p, mode, insight?)` dengan **satu** titik resolusi (`const I = insight ?? p.insight`) — bukan pilihan per-seksi, karena halaman yang mencampur prosa editan dan prosa mesin terbaca seperti dua penulis. `insight-edit.ts` baru: batas panjang, pesan BI `[...]`, tolak `<`/`>` sebagai lapisan kedua di atas `esc()` |
| §1.2 Migrasi | mesin `client_report` (#31, **nol terminal state** — laporan tercabut harus bisa dikoreksi lalu diterbitkan lagi), `client_report_insight` (append-only, `(revisi=0) = (sumber='mesin')`), `client_report_publikasi`, pintu komplain #3, rate limit |
| §1.3 Domain | `report.ts` + 7 verba (`getReportInsight`, `saveReportInsight`, `resetReportInsight`, `publishReport`, `republishReport`, `revokeReport`, `insightForMode`); `client-portal.ts` baru; `insertComplaint` diekstrak jadi helper bersama supaya aturan komplain hanya punya SATU tempat |
| §1.4–1.6 | 8 route baru (5 internal + 4 portal); `wire.ts` + DTO; editor insight di `web-internal` |
| §1.7 | 4 halaman portal: daftar laporan, detail (iframe same-origin), progres, komplain |
| §1.8 | Paritas visual: FontAwesome, **6 kanvas** (termasuk 2 bubble kuadran sumbu logaritmik), meter skor `conic-gradient`, unduh PDF |
| §1.9 | `DECISIONS.md`, `STATE_MACHINES.md` §21, `DATA_MODEL.md`, spec M15, backlog, handoff |

**Keadaan live:** 168 migrasi · 139 tabel · 31 mesin · `entity_prefix` 37 (tak berubah) · `notif_events` 67 (tak berubah).

**Sisa Gelombang 1 (bukan kode):** UAT dengan export Seller Center **nyata**. **Sebagian ditutup 2026-09-03** — sisi ENGINE sudah diuji dengan export Shopee asli (Fim Motor Juli 2026, 15 berkas: `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`), laporan terbentuk penuh dan setiap angka cocok persis ke berkas mentah. Yang **masih terbuka**: (a) belum ada satu laporan pun — TikTok maupun Shopee — yang **diterbitkan lalu dibaca kontak klien sungguhan**; (b) sisi TikTok belum pernah kena export asli; (c) atribusi `MTR-` belum kena data nyata (klien uji tak punya kampanye Shopee Ads aktif). Itu milik pemilik/AM.

---

## 5. GELOMBANG 2 — Report engine Shopee (paritas penuh)

Cermin struktur `packages/core/src/report/` yang sudah terbukti. **Jangan tulis engine gaya baru.**

- `packages/core/src/report/shopee/` — `detect.ts` (17 tanda tangan berkas dari `MODULE_MAP` alat: `bisnis_home|produk|live|video|kesehatan`, `ads_toko|produk|live|banner`, `aff_product|creator`, `promo_diskon|voucher|flashsale`, `layanan_chat|broadcast`, `meta`), `metrik.ts`, `skor.ts` (6 dimensi berbobot: ROAS & Channel .22, Traffic Quality .22, Conversion & Retention .18, Product Performance .14, Live Streaming .12, Kesehatan Toko .12), `insight.ts`, `payload.ts` (`cdps.report.shopee.v1`), `render.ts`, `run.ts`.
- **Wajib diperbaiki saat porting** (checklist `docs/design/README.md` — jangan port apa adanya): `null` jangan jadi `0`; format uang rumah `Rp. X.XXX.XXX,00`; pembagian nol → `—`; `new Date()` klien → jam WIB server; benchmark ke tabel berversi supaya skor recomputable; blok internal **tidak dibangun** di mode klien.
- Parser angka Indonesia (titik-ribuan) **sudah ada** di `packages/core/src/baseline/angka.ts` (`n(v, raw)`). Pakai itu.
- `client_reports`: tambah `payload_schema varchar(48) NOT NULL DEFAULT 'cdps.report.tiktok.v1'` — kolom di kanan, dan `renderReport` memilih renderer dari nilai itu. Tabel beku untuk UPDATE, jadi `DEFAULT` mengisi baris lama tanpa update.
- Insight editable Gelombang 1 **langsung berlaku** — bentuk `insight` sama, nol pekerjaan tambahan di portal.

### Tiket paling bernilai: SH-06 — inilah jalur "tidak upload manual"

Rantainya sudah ada, tinggal disambung, dan **jangan bikin sumber kedua**:

- `client_reports` sudah jadi **penulis tunggal** `clients.total_sales` → dibaca Health Score M13.
- M6D RM-C (`wrr_metrik`) mengambil metrik `otomatis` dari modul pemiliknya. Baris `otomatis` **UPDATE-blocked** untuk AM — itu invariant beku, jangan disentuh.
- Karena itu jalurnya adalah **membuat Metric Entry (`MTR-`) dari hasil parse**, bukan menulis `wrr_metrik` langsung. `MTR-` sudah punya `entry_method='File Export'` (M8 §9.4) yang persis untuk ini.
- GMV bulanan otoritatif **tetap** entri manual AM di M6B P-E (M6D §3 Rule 11). Laporan tidak pernah menulisnya.

---

## 6. GELOMBANG 3 — MEA SKU Screener (Modul A, B, C, D)

**Prasyarat: SC-00 dulu.** 10 asumsi terbuka PRD (A01–A10) wajib dikonfirmasi pemilik **sebelum** sprint, masuk `DECISIONS.md` sebagai `SCR-1..SCR-10`. Dua paling berdampak: **A08** (default target ROAS Fase 1 = 3,57) dan **A03** (`Kode Produk` sebagai primary key).

Prefix baru: `SCR-` (screening run, dipakai Modul A **dan** B lewat kolom `jenis`) dan `ADL-` (Ads Decision Log, Modul C). Modul D anak dari `SCR-` (keyed `screening_id, product_code`, nol prefix). `entity_prefix` 37 → 39 di **tiga** tempat (tabel `entity_prefix`, `PREFIXES` di `packages/core/src/ident.ts`, `docs/DATA_MODEL.md`) + dua gerbang hitungan.

`packages/core/src/skuscreener/` — murni & DOM-free:

| Berkas | Aturan |
|---|---|
| `route.ts` | R05 lima rute berurutan: Scale / Kandidat Iklan / Optimasi Gambar-Judul / Optimasi Deskripsi-Harga / Parkir |
| `cpc.ts` | R06 `CPC max = AOV × CR × faktor ÷ target ROAS`, filter CPC pasar, **anti-rule** views ≥2.000 & CR <0,5% mengalahkan rute apa pun |
| `median.ts` | R04 median toko sendiri + penurunan ambang iteratif 50% sampai ≥5 SKU atau floor Views 50/Clicks 5; floor absolut CTR 2,0% / CR 0,5% |
| `roas.ts` | R07/R08 target per fase 1/2/3 + biaya platform dari harga jual + service fee flat bulanan ÷ pesanan |
| `compare.ts` | R09 kunci `Kode Produk` → fallback nama ternormalisasi; R10 ambang 20 klik; R11 verdict +20% / −10%; R12 metrik dinilai ditentukan jenis perubahan, **tolak** dua jenis sekaligus |

- **R02 hanya baris produk induk** (`Kode Variasi = '-'`) — cegah double-count GMV. **R03** nilai negatif tetap negatif.
- **Modul C vs yang sudah ada, dipetakan sadar:** `OPT-` (M8) adalah log perubahan **per kampanye**; `ADL-` adalah keputusan **pra-kampanye per SKU** + tangga keputusan R15 + tanda `PREMATUR` R14 + batas kampanye aktif R16 (`budget_mingguan ÷ Rp350.000`). **Dua entitas, bukan satu** — alasannya ditulis di `DECISIONS.md` supaya tidak terbaca sebagai duplikasi.
- UI: `web-internal/src/app/(shell)/ads/screening/` — unggah → tabel rute → tempel ke Decision Log/Tracker.
- **Hasil screening mengisi Section RM-C? TIDAK.** Screening bukan realisasi; ia tetap alat keputusan.

---

## 7. GELOMBANG 4 (menyusul) — TikTok Ads Scanner

Pemilik akan membuat HTML-nya **setelah build ini selesai**. Yang dicatat di sini adalah **slot dan kontraknya**, bukan spesifikasi fiturnya — belum ada alatnya untuk dibaca, jadi **jangan mengarang aturannya**.

**Dua jalur masuk yang sudah terbukti, pilih sadar:**

- **(a) Embed dulu, port nanti** — jatuhkan `.html` self-contained ke `web-internal/public/tools/`, satu entri di `src/lib/embedded-tools.ts`, satu baris nav ber-gate di `nav.ts`; rute `/tools/[slug]` merender apa pun yang terdaftar, nol endpoint baru. Preseden: `video-factory`, `am-copilot` (`DECISIONS.md` 2026-08-21).
- **(b) Port ke `packages/core/`** kalau angkanya akan menggerakkan gerbang/skor CDPS. Preseden: `packages/core/src/baseline/`, `packages/core/src/report/`.

> **Aturan pemisahnya:** kalau angkanya **cuma dibaca manusia → embed**; kalau angkanya **menggerakkan keputusan sistem → port** — karena skor yang tidak bisa dihitung ulang server-side melanggar aturan rumah #4.

- **Kalau embed:** SheetJS **di-vendor lokal** (`public/tools/xlsx.full.min.js` sudah ada — pakai itu, jangan `<script>` CDN), keluarkan payload berversi `cdps.adsscanner.tiktok.v1`, dan importer server **me-re-derive** field yang menggerakkan keputusan (pola `POST /interview/[id]/baseline`: payload yang dioplos harus ditolak). Identitas klien + `generated_at` **diinjeksi server** (jam WIB `tz`), bukan `new Date()` browser.
- **Kalau port:** ikuti bentuk `report/` — `detect.ts` → `metrik.ts` → `skor.ts` → `insight.ts` → `payload.ts` → `render.ts` → `run.ts`, murni & DOM-free, benchmark berversi.
- **Tampilan:** kalau ia menghasilkan laporan, pakai `renderBody`/`renderReportHtml` yang sudah ada + polish §1.8 — **bukan sistem desain kedua**. Kalau ia alat kerja, tampilannya bebas tapi tetap wajib lolos gate peran `access(role)` di `embedded-tools.ts`.
- **Insight editable + portal klien Gelombang 1 langsung berlaku** kalau outputnya masuk `client_reports` dengan `payload_schema` sendiri (kolom yang ditambahkan Gelombang 2) — nol pekerjaan tambahan di portal.
- Butuh **satu entri `DECISIONS.md`** saat alatnya masuk: jalur mana yang dipilih dan alasannya.

---

## 8. Verifikasi

**Unit (`npm test -w @cdps/core`)** — `insight-edit.test.ts`: setiap batas panjang, setiap pesan BI `[...]` persis, HTML dalam input tidak lolos. `report.test.ts`: `renderBody(p,'klien',override)` memakai teks override; **tanpa** override keluarannya identik byte-per-byte dengan sebelumnya (regresi nol); mode klien nol string blok INTERNAL.

**Domain (`npm test -w @cdps/domain`, butuh Postgres)** — `createReport` menulis publikasi `[Draf]` + insight revisi 0 dalam satu tx; `UPDATE`/`DELETE` `client_report_insight` **gagal**; alur paku lengkap (simpan → terbit → simpan lagi → `mode=klien` tetap yang lama, `mode=internal` yang baru → terbitkan pembaruan → cabut); izin per peran termasuk OD & Director berlapis; **isolasi portal diuji lewat id eksplisit di URL, bukan hanya lewat daftar**; komplain ke-6 dalam sejam ditolak; Health band diuji dengan snapshot key DTO (nol angka).

**Invariant SQL** — `scripts/db-rebuild.sh --yes` hijau: `immutability_checks`, `rls_checks`, `ident_checks`, `auth_claims_checks`. Seed diterapkan **dua kali** (idempoten).

**Paritas & gerbang** — `route-parity` (**`KNOWN_GAPS` wajib tetap kosong**), `body-parity`, `shape-parity`, `gate-reachability`; `typecheck --workspaces`; `lint -w @cdps/api -- --max-warnings 0`. **`web-internal` dan `web-client-portal` TIDAK ikut `--workspaces`** — jalankan di masing-masing direktori.

**Angka Gelombang 1 (DB bersih, Postgres nyata):** core **327** · api **397** · db **53** · domain **1716 lulus / 1 skip** · web-internal **427** · web-client-portal **19**.

---

## 9. Yang TIDAK dikerjakan (eksplisit)

- Multipart upload / Supabase Storage — parse tetap di browser, provenance tetap sha256.
- Menyentuh `backend/**` (Go, referensi read-only).
- Menambah komponen/bobot ke Health Score M13 — laporan **ditampilkan**, tidak **dinilai**. Komponen `Satisfaction` tetap N/A sampai CSAT punya tiketnya sendiri.
- Surface invoice/pembayaran di portal (OQ-6 RESOLVED: nol di v1).
- Riwayat komplain untuk klien (M15 Rule 6 submit-only).
- Event notifikasi katalog baru — komplain portal memakai `EvComplaintLogged` yang sudah ada, jadi `notif_events` tetap **67**.
