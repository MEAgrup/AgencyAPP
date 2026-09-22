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
| **D-01** | `packages/domain/src/client-portal.ts`: `listReports` dan `reportHtml` **berganti sumber** dari `client_reports`+`client_report_publikasi`+`client_report_insight` ke `pdt_laporan_kiriman`+`pdt_laporan_publikasi`+`pdt_laporan_insight`. Predikat klien tetap **di SQL-nya sendiri** (`client_platforms.client_id = scope.clientId`, `status = '[Terbit]'`, revisi = `insight_revisi` terpaku) karena pembacaan portal berjalan service-role. Render lewat `pdtCore.renderLaporanHtml(laporan, 'klien')` dengan `insight` di-overlay revisi terpaku (pola `laporanUntukRenderPdt`, tapi **tanpa** gerbang `canKirimLaporan` — gerbangnya kontak klien). Import `report`/`reportShopee` dari modul ini **dihapus** di PR yang sama; sesudah PR ini, `client-portal.ts` **nol rujukan** `client_reports`. |
| **D-01a** | **Aturan isi daftar (PRD R11.3, ketokan pemilik 2026-09-22 sore).** Satu baris per `(client_platform_id, periode_mulai)`: kandidatnya kiriman **terakhir** periode itu (`dikirim_pada` terbesar, `distinct on (k.client_platform_id, k.periode_mulai) … order by k.dikirim_pada desc`), lalu **hanya** ditampilkan bila publikasinya `[Terbit]`. Kiriman lama periode yang sama **tidak terdaftar dan tidak bisa dibuka** lewat id (`reportHtml` memakai predikat yang sama, bukan sekadar `status='[Terbit]'` pada id yang diminta). Kandidat terbaru yang `[Draf]`/`[Dicabut]` ⇒ periode itu **kosong** bagi klien, bukan jatuh ke versi lama. Kontrak 3 bulan ⇒ 3 baris berbeda periode; dua toko ⇒ satu baris per toko per periode. Urutan: periode terbaru dulu. |
| **D-02** | DTO `PortalReportRow` dan wire `portalReportRowToWire` **tidak berubah bentuk** (`report_id` = `pdt_laporan_kiriman.id`, `periode_tipe` = `'bulanan'` karena kiriman PDT selalu bulanan, `platform` dari `client_platforms.platform`, `diterbitkan_pada` dari publikasi). Rute `GET /client-portal/reports` dan `GET /client-portal/reports/{id}/html` **tetap path yang sama**. FE `web-client-portal` **nol halaman baru, nol menu baru**; yang boleh berubah hanya teks kosong-state (`"Laporan mingguan dan bulanan …"` → bulanan) dan judul. |
| **D-03** | Pintu komplain M15 dipakai ulang **apa adanya** (ketokan `M20-PORTAL-KOMPLAIN` 2026-09-22) — nol kode. |
| **D-04** | Tes: kontak klien toko A tidak bisa membaca kiriman toko B (by id langsung → `[laporan tidak ditemukan]`); `[Draf]` dan `[Dicabut]` tidak terdaftar dan tidak terbaca; render klien membaca revisi **terpaku**, bukan revisi terbaru; string blok internal (`kelengkapan`, catatan dimensi, versi benchmark) **nol** di keluaran; tidak ada argumen permintaan yang bisa menghasilkan render `internal`. **Tes R11.3:** Agustus dua kiriman `[Terbit]` ⇒ daftar **satu** baris Agustus = kiriman terbaru, id kiriman lama → `[laporan tidak ditemukan]`; tiga periode terbit ⇒ **tiga** baris, urut periode terbaru dulu; kandidat terbaru `[Dicabut]` ⇒ Agustus hilang dari daftar (bukan jatuh ke kiriman lama); dua toko satu klien ⇒ satu baris per toko per periode. Fixture tes `client-portal.test.ts` (`laporanTerbit`) dipindahkan dari `createReport`/`publishReport` M14 ke `kirimLaporanPdt`/`terbitkanKiriman`. |
| **D-05** | **Tes penjaga R11 tetap hijau** (sudah mendarat 2026-09-22 di `route-parity.test.ts`): rute portal ber-`report|laporan|pdt` **persis** dua, halaman `(portal)` ber-`laporan|report|pdt` **persis** dua. Ditambah satu tes sumber: `client-portal.ts` nol kemunculan string `client_reports`. |

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
| **E-01** | Penulis `clients.total_sales` versi PDT: Σ run-rate bulanan laporan **terbit** terakhir per platform aktif; laporan mingguan diskalakan ke 30 hari sebelum ditulis. Baris audit `total_sales_recomputed` dengan `source: 'pdt'`. |
| **E-02** | Pencabutan (R6): satu transaksi memicu hitung ulang `total_sales` + Health Score + baseline Ads. Nol jalan keluar lewat SQL manual. |
| **E-03** | Entri metrik Ads dari laporan PDT (padanan `insertMetricEntryFromReportEngine`) supaya komponen **ROAS Attainment** Health Score punya sumber. |
| **E-04** | **Matikan** penulis M14 (`recomputeTotalSales` dan penulis entri metrik Shopee) — dimatikan, bukan dihapus, supaya jalur baliknya masih ada. |
| **E-05** | Tes: mingguan & bulanan menulis satuan yang sama; rollback membatalkan ketiga perhitungan ulang; Health Score bergerak sesuai snapshot. |

**Kriteria keluar:** Health Score satu klien nyata bergerak karena laporan PDT,
dan `clients.total_sales` punya tepat satu penulis.

---

### Gelombang F — Tokopedia + TikTok Ads Manager  *(R8, R9)*

| Tiket | Isi |
|---|---|
| **F-01** | Modul parser `tt_shop_analytics_tokopedia` (tanda tangan kolom `baseline/detect.ts` `shop_tp`), penulis fakta ke `pdt_fact_shop_daily` dengan penanda kanal, bagian laporan Tokopedia. `prod_tp` sengaja **tidak** ikut. |
| **F-02** | Kolom `tujuan` (upper/lower funnel) di `pdt_fact_ads`, supaya guardrail "belanja Ads Manager tidak masuk ROI GMV Max" ditegakkan di query, bukan cuma di prosa. |
| **F-03** | Empat modul parser TikTok Ads Manager, tanda tangan diambil apa adanya dari `report/detect.ts` `TTAM_TYPES` — **termasuk penyangkalan kolom funnel Shop pada `ttam_follows`**, tanpa itu ekspor Showcase salah tergolong. Diblokir `M20-TTAM-SAMPLE`. |
| **F-04** | Bagian laporan `ads_manager` + pengisian `tahap.funnel` Awareness dan Add-to-Cart. |
| **F-05** | Tes: pita "belum lengkap" pada bagian Tahap **hilang karena datanya ada**, bukan karena disembunyikan. |

**Kriteria keluar:** blok `kelengkapan` untuk bagian Tahap berbunyi `lengkap:
true` pada satu toko nyata yang membawa keempat ekspor Ads Manager.

---

### Gelombang G — Pencabutan M14

Hanya dimulai setelah PRD §9 benar semuanya (A–F hijau, satu laporan nyata
sudah menempuh siklus penuh di live, `total_sales` satu penulis).

| Tiket | Isi |
|---|---|
| **G-01** | Cabut rute M14 (`/reports/*`, `/clients/{id}/reports*`), halaman "Laporan Performa (Mingguan/Bulanan)" di Direktori Klien, `ReportPanel.tsx`, `ShopeeReportForm.tsx`, dan tipe FE-nya — satu PR. **Jalur portal M14 tidak ada di daftar ini** karena sudah digantikan sumbernya di Gelombang D (R11); G-01 hanya membereskan sisi internal. |
| **G-02** | `route-parity.test.ts` hijau dengan `KNOWN_GAPS` **kosong**; `shape-parity.test.ts` hijau. |
| **G-03** | Entri `DECISIONS.md` menutup `M14-VS-PDT-DUPLIKASI`. |

`client_reports` dan tabel turunannya **tidak dihapus**: append-only, 0 baris,
biaya menyimpannya nol, dan ia jadi bukti riwayat.
`packages/core/src/report/**` juga tidak dihapus di PR yang sama — mesin murni
tanpa pemanggil tidak berbahaya, dan menghapusnya di PR pencabutan membuat
diff-nya mustahil dibaca. Penghapusannya tiket tersendiri sesudah satu siklus
laporan berjalan tenang.

---

## 4. Yang memblokir, hari ini  *(diperbarui 2026-09-22 sore)*

| Kode | Memblokir | Status |
|---|---|---|
| `M20-URUTAN` | urutan gelombang | ✅ diketok 2026-09-22: A → B → C → D → E → F → G |
| `M20-M14-BEKU` | apakah M14 dibekukan | ✅ diketok 2026-09-22: **dibekukan** (bugfix kritis saja) sampai G |
| `M20-PORTAL-KOMPLAIN` | D-03 | ✅ diketok 2026-09-22: pakai pintu komplain M15 apa adanya |
| `M20-TTAM-SAMPLE` | F-03/F-04/F-05 | ⏳ pemilik akan mengunggah 4 ekspor TikTok Ads Manager nyata; F-01/F-02 tidak diblokir |
| ~~`M20-C01-LIVE`~~ | D-00 | ✅ **DITUTUP 2026-09-22 malam:** migrasi `20261130010000` diterapkan ke live `CDPS SG` (versi live `20260922151204`), diverifikasi 186 tabel / 36 mesin / fungsi `jwt_owns_pdt_kiriman_am` ada. D-00 selesai. |

Gelombang D bisa dikodekan **dan di-merge** sekarang — satu-satunya blocker yang tersisa (`M20-TTAM-SAMPLE`) hanya menyentuh Gelombang F.

---

## 5. Risiko

| Risiko | Penangkal |
|---|---|
| Permukaan klien hidup sebelum R2 ⇒ caveat terbit ke klien | Gelombang A adalah gelombang PERTAMA, dan B-05 menguji ketiadaan string internal di keluaran klien |
| Dua penulis `clients.total_sales` ⇒ Health Score melompat tanpa sebab performa | E-04 mematikan penulis M14 di PR yang sama dengan E-01 |
| Metrik `null` dihilangkan dari render klien ⇒ klien mengira bagian itu memang tidak ada | Poin manual AM (R3) adalah tempat menjelaskannya; ini keputusan sadar, bukan efek samping |
| Tanda tangan TTAM ditebak dari kode M14 tanpa sample nyata ⇒ ekspor Showcase salah tergolong `follows` | F-03 diblokir `M20-TTAM-SAMPLE`; penyangkalan kolom funnel Shop ditulis eksplisit di PRD R9 |
| Migrasi tabrakan prefix versi | `scripts/check-migration-versions.sh` sudah menjaganya; `supabase db push` tetap tidak bisa dipakai di repo ini |
| Gelombang D lahir sebagai halaman/rute KEDUA di portal ⇒ klien melihat dua laporan selama D→G | Prinsip #6 + PRD R11; dua tes R11 di `route-parity.test.ts` mengunci himpunan rute dan halaman portal **persis** — PR yang menambah `laporan-pdt`/`pdt` di portal merah di CI |
| D di-merge sebelum C-01 di live ⇒ halaman Laporan portal 500 (regresi dari "kosong") | D-00 prasyarat eksplisit; `M20-C01-LIVE` di §4 |
