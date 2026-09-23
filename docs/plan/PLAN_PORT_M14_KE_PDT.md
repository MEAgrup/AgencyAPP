# PLAN — Port Mesin Laporan Klien (M14) ke PDT

**Pemilik permintaan:** Yohan Agustian (Director, PT MEA Agensi Digital) — *"Ok mulai jalankan dulu kekurangan PDT supaya sama dengan fitur M14."*
**Dibuat:** 2026-09-22 · **Branch:** `claude/gifted-hypatia-7ccp3n`
**PRD:** `docs/prd/CDPS_Module20_PDT_Laporan_Klien.md`
**Keputusan:** `docs/DECISIONS.md` Open `M14-VS-PDT-DUPLIKASI`
**Backlog induk:** `docs/backlog/PDT_BACKLOG.md` §2 (G2 — "Mematikan: Report Engine TikTok & Shopee")

> **Posisi 2026-09-22 (audit sesi `claude/audit-pdt-report-plan-df1xkt`,
> `docs/handoff/HANDOFF_M20_AUDIT_SATU_LAPORAN_20260922.md`):**
>
> | Gelombang | Status | Bukti |
> |---|---|---|
> | A | ✅ merge | PR #494 (`ae84629`) — blok `kelengkapan`, `insight.poin` bersih |
> | B | ✅ merge | PR #496 (`9609811`) — `pdt/render.ts` dua mode, rute `kiriman/{id}/html`, 4 tombol |
> | C | ✅ merge, ✅ migrasi C-01 di live (malam 2026-09-22) | PR #497 (`6cc4ce4`); CI `db-and-migrations` yang merah sejak #497 diperbaiki #500. Live `CDPS SG`: 186 tabel / 36 mesin, versi migrasi `20260922151204` |
> | D | ⏳ **berikutnya, nol blocker** — bentuk direvisi di bawah (ganti sumber, bukan tambah halaman; R11.3 versi terbaru per periode) | requirement pemilik 2026-09-22 (#499); D-00 selesai |
> | E, F, G | belum | — |

---

## 1. Kenapa ini ada

PDT dan "Laporan Performa Mingguan/Bulanan" di Direktori Klien **bukan dua
fitur** — mereka satu fitur dua generasi. PRD PDT dan backlog G2 sudah
menetapkan PDT mematikan M14. Audit 2026-09-22 menemukan penggantiannya belum
bisa dijalankan karena seluruh separuh hilir M14 tidak pernah dibangun di PDT:
renderer HTML, publikasi, portal, dan penulis agregat klien — plus dua bagian
laporan (Tokopedia, TikTok Ads Manager).

Rinciannya, berikut buktinya, ada di PRD §1. Rencana ini hanya menjawab
**urutan dan tiketnya**.

---

## 2. Prinsip yang mengikat rencana ini

1. **Nol regresi angka.** Modul ini tidak menyentuh lapisan fakta (G1), mesin
   skor (G2-01), atau katalog usulan (G4). Ia membangun hilir.
2. **R2 mendahului permukaan klien.** Permukaan klien yang hidup sebelum aturan
   caveat mendarat akan menerbitkan kalimat "belum lengkap" ke klien — persis
   kejadian yang memicu modul ini.
3. **Satu penulis per kolom.** `clients.total_sales` tidak boleh punya dua
   penulis, walau sebentar. Penulis M14 dimatikan (bukan dihapus) tepat saat
   penulis PDT hidup.
4. **M14 tidak dicabut per tiket.** Ia dicabut sekali, di Gelombang G, setelah
   syarat PRD §9 benar semuanya.
5. **PR kecil per klaster Rule/Flow**, pesan commit merujuk pasal PRD
   (mis. "M20 R2 caveat kelengkapan").
6. **Satu permukaan laporan di portal klien, selamanya — termasuk selama
   transisi.** Klien tidak pernah melihat dua daftar laporan, dua menu, atau
   dua dokumen untuk periode yang sama (PRD R11). Gelombang D **mengganti
   sumber** di balik halaman `/laporan` dan dua rute `client-portal/reports*`
   yang sudah ada; ia **tidak** menambah halaman, menu, atau rute baru di
   portal. Dikunci dua tes di `apps/api/src/lib/route-parity.test.ts` (blok
   `web-client-portal`, "M20 R11").

---

## 3. Gelombang

Urutan A → G. Gelombang berikutnya tidak dimulai sebelum kriteria keluar
gelombang sebelumnya lolos.

### Gelombang A — Kelengkapan jadi DATA, bukan prosa  *(prasyarat R2)*

| Tiket | Isi |
|---|---|
| **A-01** | `packages/core/src/pdt/laporan.ts`: blok `kelengkapan` terstruktur (`{ bagian, lengkap, alasan, modulHilang[] }`). Caveat berhenti didorong ke `insight.poin` (baris 1292 & 1297 hari ini). `insight.poin` kembali murni narasi performa. |
| **A-02** | Wire + FE internal membaca blok `kelengkapan`; ketiga banner `CatatanInternal` (sudah mendarat 2026-09-22) disuapi dari blok itu, bukan dari teks yang ditulis tangan di JSX. |
| **A-03** | Tes: `insight.poin` nol kalimat caveat; blok `kelengkapan` memuat alasannya; payload lama (tanpa blok) tetap terbaca. |

**Kriteria keluar:** satu laporan nyata dirender di internal dengan banner yang
sama seperti hari ini, tapi sumbernya blok `kelengkapan`; `insight.poin` bersih.

---

### Gelombang B — Renderer HTML dua mode  *(R1, R2)*

| Tiket | Isi |
|---|---|
| **B-01** | `packages/core/src/pdt/render.ts` — fungsi murni, nol DOM. Satu renderer untuk dua platform (payload PDT sudah satu bentuk; ini keunggulan PDT atas M14 yang punya dua renderer terpisah). Aset dokumen (`docassets`) dipakai ulang. |
| **B-02** | Aturan mode `klien`: blok internal **tidak dibangun**; metrik `null` **dihilangkan**, bukan jadi `—`; bagian yang metrik intinya `null` tidak dibangun; penomoran bagian diberikan saat render. |
| **B-03** | `GET /api/v1/account/pdt/laporan/kiriman/{id}/html?mode=klien\|internal[&download=1]`. Nama berkas diturunkan **di server** dari snapshot (toko, periode, mode) — sufiks mode itulah yang membedakan salinan internal dari salinan klien setelah berkasnya duduk di folder Downloads. |
| **B-04** | Empat tombol di halaman Laporan PDT: Lihat Klien / Unduh Klien / Lihat Internal / Unduh Internal (pola `ReportPanel.tsx`). |
| **B-05** | Tes paritas visual + tes keamanan: string blok internal **tidak ada** di keluaran `klien`. |

**Kriteria keluar:** AM bisa mengunduh HTML klien untuk TEST PDT Store 2
Agustus 2026, dan `grep` pada berkas itu nol untuk "belum lengkap", nol untuk
catatan dimensi skor, nol untuk versi benchmark.

---

### Gelombang C — Revisi insight + publikasi  *(R3, R4, R5)*

| Tiket | Isi |
|---|---|
| **C-01** | Migrasi: `pdt_laporan_insight` (append-only, `(revisi=0) = (sumber='mesin')`), `pdt_laporan_publikasi`, mesin `pdt_laporan` di `state_machine` (`[Draf]` → `[Terbit]` ⇄ `[Dicabut]`, nol terminal state), RLS mengikuti scope `pdt_laporan_kiriman`. Nomor versi dijaga `scripts/check-migration-versions.sh`. |
| **C-02** | Domain: `bacaInsightKiriman`, `simpanInsightKiriman`, `resetInsightKiriman`, `terbitkanKiriman`, `terbitkanUlangKiriman`, `cabutKiriman`, `insightUntukMode`. Transisi lewat `sm_transition`, bukan update mentah. |
| **C-03** | Rute API untuk tujuh verba di atas. |
| **C-04** | Editor FE: menyunting ringkasan/poin/rekomendasi/outlook/indikator/narasi tahap, **tambah & hapus poin manual**, tombol "Reset ke narasi mesin", label status publikasi. |
| **C-05** | Tes: paku revisi (klien membaca yang terpaku, pratinjau membaca terbaru); immutability; permission per peran. |

**Kriteria keluar:** satu laporan menempuh Kirim → sunting → Terbitkan →
sunting lagi → Terbitkan pembaruan, dan render klien hanya berubah pada tekan
Terbitkan.

---

### Gelombang D — Permukaan portal klien  *(R10, R11)*  — **DIREVISI 2026-09-22**

> **Yang berubah dari versi 2026-09-22 pagi.** Versi lama berbunyi "daftar +
> render laporan PDT" dan "halaman `web-client-portal`: daftar laporan +
> detail". Dibaca literal, itu melahirkan halaman/rute KEDUA di samping
> `/laporan` (M14) sampai Gelombang G — dan di rentang itu klien bisa melihat
> dua laporan. Pemilik melarangnya eksplisit: *"klien hanya melihat 1 bagian
> report, jangan sampai ada 2 report yg bisa dilihat klien."* Maka D
> **mengganti sumber**, bukan menambah permukaan. Nol data yang hilang: di
> live `client_reports` 0 baris, `client_report_publikasi` terbit 0, dan M14
> sudah dibekukan (`M20-M14-BEKU`).

| Tiket | Isi |
|---|---|
| **D-00** | ✅ **SELESAI 2026-09-22 malam.** ~~Prasyarat, bukan kode:~~ migrasi C-01 (`20261130010000_m20_c01_pdt_laporan_insight_publikasi.sql`) diterapkan ke live `CDPS SG` lewat `apply_migration` **sebelum** PR D di-merge. Tanpa itu, D mengubah halaman Laporan portal dari "kosong" menjadi **500** di live (query D-01 membaca `pdt_laporan_publikasi`). Verifikasi: 186 tabel, 36 mesin, fungsi `jwt_owns_pdt_kiriman_am` ada. |
| **D-01** | ✅ **SELESAI.** `packages/domain/src/client-portal.ts`: `listReports` dan `reportHtml` **berganti sumber** dari `client_reports`+`client_report_publikasi`+`client_report_insight` ke `pdt_laporan_kiriman`+`pdt_laporan_publikasi`+`pdt_laporan_insight`. Predikat klien tetap **di SQL-nya sendiri** (`client_platforms.client_id = scope.clientId`, `status = '[Terbit]'`, revisi = `insight_revisi` terpaku) karena pembacaan portal berjalan service-role. Render lewat `pdtCore.renderLaporanHtml(laporan, 'klien')` dengan `insight` di-overlay revisi terpaku (pola `laporanUntukRenderPdt`, tapi **tanpa** gerbang `canKirimLaporan` — gerbangnya kontak klien). Import `report`/`reportShopee` dari modul ini **dihapus** di PR yang sama; sesudah PR ini, `client-portal.ts` **nol rujukan** `client_reports`. |
| **D-01a** | ✅ **SELESAI.** **Aturan isi daftar (PRD R11.3, ketokan pemilik 2026-09-22 sore).** Satu baris per `(client_platform_id, periode_mulai)`: kandidatnya kiriman **terakhir** periode itu (dinyatakan sebagai "tidak ada kiriman lain toko+periode yang sama dengan `dikirim_pada`/`id` lebih besar", bukan `distinct on` — predikat `not exists` yang sama dipakai ulang di `reportHtml`), lalu **hanya** ditampilkan bila publikasinya `[Terbit]`. Kiriman lama periode yang sama **tidak terdaftar dan tidak bisa dibuka** lewat id. Kandidat terbaru yang `[Draf]`/`[Dicabut]` ⇒ periode itu **kosong** bagi klien, bukan jatuh ke versi lama. Kontrak 3 bulan ⇒ 3 baris berbeda periode; dua toko ⇒ satu baris per toko per periode. Urutan: periode terbaru dulu. |
| **D-02** | ✅ **SELESAI.** DTO `PortalReportRow` dan wire `portalReportRowToWire` **tidak berubah bentuk** (`report_id` = `pdt_laporan_kiriman.id`, `periode_tipe` = `'bulanan'` karena kiriman PDT selalu bulanan, `platform` dari `client_platforms.platform`, `diterbitkan_pada` dari publikasi, `periode_akhir` sekarang dari kolom `periode_selesai`). Rute `GET /client-portal/reports` dan `GET /client-portal/reports/{id}/html` **tetap path yang sama** — nol perubahan di rute/`wire.ts`. FE `web-client-portal` **nol halaman baru, nol menu baru**. |
| **D-03** | ✅ **SELESAI.** Pintu komplain M15 dipakai ulang **apa adanya** (ketokan `M20-PORTAL-KOMPLAIN` 2026-09-22) — nol kode. |
| **D-04** | ✅ **SELESAI.** Tes: kontak klien toko A tidak bisa membaca kiriman toko B (by id langsung → `[laporan tidak ditemukan]`); `[Draf]` dan `[Dicabut]` tidak terdaftar dan tidak terbaca; render klien membaca revisi **terpaku**, bukan revisi terbaru; nol string blok internal; tidak ada argumen permintaan yang bisa menghasilkan render `internal`. **Tes R11.3:** dua kiriman `[Terbit]` periode yang sama ⇒ daftar **satu** baris = kiriman terbaru, id kiriman lama → `[laporan tidak ditemukan]`; tiga periode terbit ⇒ **tiga** baris, urut periode terbaru dulu; kandidat terbaru `[Dicabut]` ⇒ periode hilang dari daftar (bukan jatuh ke kiriman lama, tidak bisa dibuka lewat id manapun). Fixture tes `client-portal.test.ts` (`laporanTerbit`) dipindahkan dari `createReport`/`publishReport` M14 ke `kirimLaporanPdt`/`simpanInsightKiriman`/`terbitkanKiriman` — fixture PDT tidak perlu berkas Excel sama sekali (`bacaLaporanPdt` mentolerir nol baris fakta). |
| **D-05** | ✅ **SELESAI.** **Tes penjaga R11 tetap hijau** (mendarat 2026-09-22 di `route-parity.test.ts`): rute portal ber-`report|laporan|pdt` **persis** dua, halaman `(portal)` ber-`laporan|report|pdt` **persis** dua — diverifikasi ulang HIJAU sesudah D-01..D-04. Ditambah satu tes sumber (`client-portal.test.ts`): `client-portal.ts` nol kemunculan string `client_reports`. |

**Kriteria keluar:** kontak klien membuka menu **Laporan** yang sama seperti hari
ini dan membaca dokumen yang **sama persis** (byte-identik) dengan berkas
"Unduh Klien" yang AM unduh di B-03 untuk kiriman yang sama; `grep` di kedua
berkas nol untuk "belum lengkap"; nav portal tetap **empat** tautan; tes R11
hijau. Skenario pemilik lolos di UAT: satu klien dengan kontrak 3 bulan dan
Agustus dua versi ⇒ klien melihat **3 baris** (Jun/Jul/Agu), Agustus berisi
versi terbaru, versi lama tidak bisa dibuka.

**Yang sengaja TIDAK dilakukan di D:** menghapus `report.renderReportHtml`,
`ReportPanel.tsx`, rute `/reports/*`, atau tabel `client_reports`. Jalur
portal M14 **mati** (tidak lagi punya pemanggil dari portal) tapi kodenya tetap
ada sampai Gelombang G, sesuai prinsip #4 — yang dicabut sekali di G tinggal sisi
internal dan penulis `total_sales`.

---

### Gelombang E — Agregat klien  *(R6, R7)*

| Tiket | Isi |
|---|---|
| **E-01** | ✅ SELESAI — `recomputeTotalSalesPdt` di `pdt.ts`: Σ `kpi.gmv` laporan **terbit** terakhir per `client_platform_id` aktif (`DISTINCT ON` per platform, urut `periode_mulai desc, dikirim_pada desc, id desc`). Kiriman PDT **selalu bulanan** (ditetapkan Gelombang D — `periode_selesai = periode_mulai + 1 bulan − 1 hari`), jadi tidak ada jalur mingguan untuk diskalakan; klausa "mingguan diskalakan ke 30 hari" di R7 tidak pernah berlaku untuk PDT. Baris audit `total_sales_recomputed` dengan `source: 'pdt'`. |
| **E-02** | ✅ SELESAI — `terbitkanKiriman`, `terbitkanUlangKiriman`, `cabutKiriman` masing-masing memanggil `recomputeTotalSalesPdt` di transaksi yang sama. Health Score snapshot **tidak** dihitung ulang untuk bulan yang sudah tertutup/terbit (append-only, house rule #3) — keputusan `docs/DECISIONS.md` `M20-R6-HEALTH-SCORE-SNAPSHOT-LAMA`: snapshot lama dibiarkan, hanya `total_sales` berubah live; Health Score bulan berjalan dan baseline Ads self-correct karena keduanya baca `clients.total_sales` live (`ads.effectiveGmvBaseline` sudah pure function, nol kode baru). |
| **E-03** | ✅ SELESAI — `recomputeAdsMetricEntriesPdt` di `pdt.ts`: Σ semua sumber `pdt_fact_ads` toko+bulan (bukan per `kampanye_id` — nol crosswalk andal ke `ad_campaigns.id`, keputusan `docs/DECISIONS.md` `M20-E03-ADS-METRIC-ENTRIES`) → flat even-split ke `ad_campaigns` `[Active]` yang overlap tanggal+platform (crosswalk `ads.pdtPlatformKeAdsPlatform`), pola sama M14 SH-06. Ditulis via `ads.insertAdsMetricEntryFromPdt`/`ads.deletePdtAdsMetricEntries` (migrasi `20261201010000` menambah `source`/`pdt_client_platform_id`/`pdt_periode` ke `metric_entries`). |
| **E-04** | ✅ SELESAI — kedua penulis M14 dimatikan lewat flag (dimatikan, bukan dihapus, jalur balik masih ada): `M14_WRITES_TOTAL_SALES = false` (total_sales) dan `M14_WRITES_SHOPEE_ADS_METRIC_ENTRIES = false` (`attributeShopeeAdsMetricEntries`, SH-06) — keduanya dimatikan di PR YANG SAMA dengan penulis PDT masing-masing, nol jendela dua penulis aktif bersamaan. |
| **E-05** | ✅ SELESAI — tes `recomputeTotalSalesPdt` (terbit, terbit-ulang, cabut, banyak platform, kandidat bukan-terbit diabaikan) + `recomputeAdsMetricEntriesPdt` (satu/dua/nol kampanye overlap, Σ multi-sumber, `[Paused]` diabaikan, crosswalk TikTok Shop, cabut menghapus, terbitkan-ulang menulis ulang bukan menumpuk, hapus `metric_entry_assets` sebelum `metric_entries`) di `pdt.test.ts`; `report.shopee.domain.test.ts` diperbarui — SH-06 tidak lagi menulis apa pun lewat `createReportShopee`. |

**Kriteria keluar:** Health Score satu klien nyata bergerak karena laporan PDT,
dan `clients.total_sales` + `metric_entries` (ROAS Attainment) masing-masing
punya tepat satu penulis. **Tercapai** — E-01 s/d E-05 selesai.

---

### Gelombang F — Tokopedia + TikTok Ads Manager  *(R8, R9)*

| Tiket | Isi |
|---|---|
| **F-01** | ✅ SELESAI — Modul parser `tt_shop_analytics_tokopedia` (tanda tangan kolom `baseline/detect.ts` `shop_tp`), penulis fakta ke `pdt_fact_shop_daily` dengan penanda kanal (`kanal` varchar, migrasi `20261203010000`), bagian laporan "Toko Tokopedia" (`render.ts::seksiTokopedia`). `prod_tp` sengaja **tidak** ikut. Terverifikasi terhadap sample asli pemilik (Ultrasleep) — struktur byte-identical dengan `tt_shop_analytics`; `docs/DECISIONS.md` M20-R8-F-01-TOKOPEDIA. |
| **F-02** | ✅ SELESAI — Kolom `tujuan` (upper/lower funnel) di `pdt_fact_ads`, supaya guardrail "belanja Ads Manager tidak masuk ROI GMV Max" ditegakkan di query, bukan cuma di prosa. Migrasi `20261202010000`, ditegakkan di `recomputeAdsMetricEntriesPdt`; `docs/DECISIONS.md` M20-F02-PDT-FACT-ADS-TUJUAN. |
| **F-03** | ✅ SELESAI (2026-09-23) — KEEMPAT modul parser TTAM dibangun: `tt_ads_manager_videoviews` (signature DIKOREKSI KEDUA KALINYA jadi `anyOf` tiga varian EN/EN/ID sekaligus, setelah sample tambahan membuktikan '6-second focused views' hanya SATU dari tiga varian nyata), `tt_ads_manager_consideration` (anchor `'New consideration size'`), `tt_ads_manager_follows` (anchor `'Paid follows'` + `mustNot` terhadap consideration), `tt_ads_manager_showcase` (anchor `anyOf` kolom funnel Shop). Dua kuirk struktural baru ditemukan+ditutup di SEMUA empat modul sekaligus: baris "Total of N results"/"Total N hasil" sintetis (difilter) dan `Ad name` tidak unik per baris (digabung-jumlah, mencegah pelanggaran `uq_pdt_fact_ads`) — `docs/DECISIONS.md` M20-R9-F-03-EMPAT-TIPE. |
| **F-04** | ✅ SELESAI (2026-09-23) — kolom `pdt_fact_ads.hasil` (video views/paid follows/add-to-cart, migrasi `20261207010000`) + `vv_impresi`/`vv_views`/`vv_cpm`/`vv_per1k`/`fol_follows`/`fol_cost`/`sc_atc`/`sc_cost_atc` dan funnel puncak langkah `atc` semuanya terisi dari KEEMPAT modul TTAM (bukan lagi hardcode `null`). Sekalian menutup bug F-03: `sc_impresi`/`sc_klik` DULU salah sumber (`tt_ads_product`/`tt_ads_live`, GMV Max — bukan Ads Manager), dikoreksi ke `tt_ads_manager_showcase` yang benar. `docs/DECISIONS.md` M20-R9-F-04-TAHAP-FUNNEL. |
| **F-05** | ✅ SELESAI (2026-09-23, digabung ke F-04) — tes end-to-end (`laporan.test.ts`/`pdt.test.ts`/`route.test.ts`) mengunci: pita "belum lengkap" hilang untuk `atc` begitu `tt_ads_manager_showcase` terisi; `bangunLaporanKelengkapan` tidak lagi menuduh "Ads Manager belum punya modul PDT" untuk rung yang sudah terisi atau yang penyebabnya bukan Ads Manager (`impresi`). |

**Kriteria keluar (DIKOREKSI 2026-09-23 — lihat `docs/DECISIONS.md`
M20-R9-F-04-TAHAP-FUNNEL):** kriteria asli ("blok `kelengkapan` untuk bagian
Tahap berbunyi `lengkap: true` pada satu toko nyata yang membawa keempat
ekspor Ads Manager") **tidak bisa tercapai secara literal** — rung `impresi`
("Impresi produk (toko)") PERMANEN `null` (gap `pdt_fact_shop_daily` tidak
terkait Ads Manager sama sekali, tidak diberi proksi karena itu akan
mencampur metrik toko dengan metrik iklan). Yang **tercapai**: bagian
Awareness + Add-to-Cart (`vv_*`/`fol_*`/`sc_*`/funnel `atc`) terisi penuh
dari data nyata untuk toko yang membawa keempat ekspor, dan `kelengkapan`
tidak lagi salah menuduh modul-modul itu belum ada — `alasan`/`modulHilang`
kini spesifik per rung, `impresi` tidak pernah lagi disalahkan ke Ads
Manager. Gelombang F dianggap **SELESAI** dengan kriteria yang dikoreksi
ini; menutup gap `impresi` (bila diinginkan) adalah tiket baru di luar M20
R8/R9, butuh skema `pdt_fact_shop_daily` baru.

---

### Gelombang G — Pencabutan M14 ✅ SELESAI 2026-09-23

Hanya dimulai setelah PRD §9 benar semuanya (A–F hijau, satu laporan nyata
sudah menempuh siklus penuh di live, `total_sales` satu penulis).

| Tiket | Isi |
|---|---|
| **G-01** | ✅ SELESAI. Cabut rute M14 (10 berkas `reports/[id]/*` + `clients/[id]/reports*`), `ReportPanel.tsx`, `ShopeeReportForm.tsx`, `InsightEditor.tsx`, `web-internal/src/lib/report.ts` + dua test filenya — satu PR. **Regresi kapabilitas ditemukan+dicegah sebelum penghapusan**: satu-satunya kontrol UI `client_platforms.tahap_fokus` hidup di dalam `ReportPanel.tsx` — dipindahkan ke tabel Platform `clients/[id]/page.tsx` (`web-internal/src/lib/clients.ts::setTahapFokus`, meniru pola `setShopId`) sebelum `ReportPanel.tsx` dihapus. **Jalur portal M14 tidak ada di daftar ini** karena sudah digantikan sumbernya di Gelombang D (R11); G-01 hanya membereskan sisi internal. |
| **G-02** | ✅ SELESAI. `route-parity.test.ts` hijau dengan `KNOWN_GAPS` **kosong**; `shape-parity.test.ts` hijau (`wire.ts` dipangkas — 10 tipe/konverter M14 dihapus, `PortalReportRowWire` dipertahankan). |
| **G-03** | ✅ SELESAI. Entri `DECISIONS.md` "M20-R9-GELOMBANG-G-SELESAI" menutup `M14-VS-PDT-DUPLIKASI`. |

Lihat `docs/DECISIONS.md` 2026-09-23 "M20-R9-GELOMBANG-G-SELESAI" untuk rincian
lengkap (berkas yang dicabut, yang sengaja dipertahankan, hasil uji). Dengan
ini seluruh Gelombang A→G plan M20 SELESAI.

`client_reports` dan tabel turunannya **tidak dihapus**: append-only, 0 baris,
biaya menyimpannya nol, dan ia jadi bukti riwayat.
`packages/core/src/report/**` juga tidak dihapus di PR yang sama — mesin murni
tanpa pemanggil tidak berbahaya, dan menghapusnya di PR pencabutan membuat
diff-nya mustahil dibaca. Penghapusannya tiket tersendiri sesudah satu siklus
laporan berjalan tenang.

---

## 4. Yang memblokir, hari ini  *(diperbarui 2026-09-23 — Gelombang G SELESAI, plan M20 tuntas A→G)*

| Kode | Memblokir | Status |
|---|---|---|
| `M20-URUTAN` | urutan gelombang | ✅ diketok 2026-09-22: A → B → C → D → E → F → G |
| `M20-M14-BEKU` | apakah M14 dibekukan | ✅ diketok 2026-09-22: **dibekukan** (bugfix kritis saja) sampai G |
| `M20-PORTAL-KOMPLAIN` | D-03 | ✅ diketok 2026-09-22: pakai pintu komplain M15 apa adanya |
| ~~`M20-TTAM-SAMPLE`~~ | F-03 (seluruhnya)/F-04/F-05 | ✅ **DITUTUP 2026-09-23:** pemilik mengunggah sample asli KEEMPAT tipe TTAM sekaligus (Brand Considerations/Follows/Showcase/Video views, multi-klien). F-03 SELESAI PENUH — `docs/DECISIONS.md` M20-R9-F-03-EMPAT-TIPE. F-04/F-05 sekarang TIDAK DIBLOKIR. |
| ~~`M20-TOKOPEDIA-SAMPLE`~~ | F-01 | ✅ **DITUTUP 2026-09-23:** sample asli (Ultrasleep) diterima dan diverifikasi, F-01 SELESAI. `docs/DECISIONS.md` M20-R8-F-01-TOKOPEDIA. F-02 SELESAI sebelumnya, tidak terpengaruh. |
| ~~`M20-C01-LIVE`~~ | D-00 | ✅ **DITUTUP 2026-09-22 malam:** migrasi `20261130010000` diterapkan ke live `CDPS SG` (versi live `20260922151204`), diverifikasi 186 tabel / 36 mesin / fungsi `jwt_owns_pdt_kiriman_am` ada. D-00 selesai. |

Gelombang D dan Gelombang F **SELESAI PENUH** (F-01 s/d F-05, `docs/DECISIONS.md` M20-R9-F-04-TAHAP-FUNNEL). **Gelombang G (pencabutan M14) SELESAI 2026-09-23** (`docs/DECISIONS.md` M20-R9-GELOMBANG-G-SELESAI) — nol blocker tersisa, dan dengan itu seluruh gelombang A→G plan M20 tuntas.

---

## 5. Risiko

| Risiko | Penangkal |
|---|---|
| Permukaan klien hidup sebelum R2 ⇒ caveat terbit ke klien | Gelombang A adalah gelombang PERTAMA, dan B-05 menguji ketiadaan string internal di keluaran klien |
| Dua penulis `clients.total_sales` ⇒ Health Score melompat tanpa sebab performa | E-04 mematikan penulis M14 di PR yang sama dengan E-01 |
| Metrik `null` dihilangkan dari render klien ⇒ klien mengira bagian itu memang tidak ada | Poin manual AM (R3) adalah tempat menjelaskannya; ini keputusan sadar, bukan efek samping |
| Tanda tangan TTAM ditebak dari kode M14 tanpa sample nyata ⇒ ekspor Showcase salah tergolong `follows` | ✅ tertutup — F-03 SELESAI terhadap sample asli KEEMPAT tipe; penyangkalan kolom funnel Shop (`showcase`) dan `mustNot` silang (consideration↔follows/videoviews) diverifikasi terhadap berkas nyata, `docs/DECISIONS.md` M20-R9-F-03-EMPAT-TIPE |
| Migrasi tabrakan prefix versi | `scripts/check-migration-versions.sh` sudah menjaganya; `supabase db push` tetap tidak bisa dipakai di repo ini |
| Gelombang D lahir sebagai halaman/rute KEDUA di portal ⇒ klien melihat dua laporan selama D→G | Prinsip #6 + PRD R11; dua tes R11 di `route-parity.test.ts` mengunci himpunan rute dan halaman portal **persis** — PR yang menambah `laporan-pdt`/`pdt` di portal merah di CI |
| D di-merge sebelum C-01 di live ⇒ halaman Laporan portal 500 (regresi dari "kosong") | D-00 prasyarat eksplisit; `M20-C01-LIVE` di §4 |
