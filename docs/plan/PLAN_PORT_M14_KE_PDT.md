# PLAN — Port Mesin Laporan Klien (M14) ke PDT

**Pemilik permintaan:** Yohan Agustian (Director, PT MEA Agensi Digital) — *"Ok mulai jalankan dulu kekurangan PDT supaya sama dengan fitur M14."*
**Dibuat:** 2026-09-22 · **Branch:** `claude/gifted-hypatia-7ccp3n`
**PRD:** `docs/prd/CDPS_Module20_PDT_Laporan_Klien.md`
**Keputusan:** `docs/DECISIONS.md` Open `M14-VS-PDT-DUPLIKASI`
**Backlog induk:** `docs/backlog/PDT_BACKLOG.md` §2 (G2 — "Mematikan: Report Engine TikTok & Shopee")

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

### Gelombang D — Permukaan portal klien  *(R10)*

| Tiket | Isi |
|---|---|
| **D-01** | `packages/domain/src/client-portal.ts`: daftar + render laporan PDT, DTO sempit allow-list, predikat klien ditulis **di SQL-nya sendiri** (pembacaan portal berjalan service-role, RLS tidak engage). |
| **D-02** | Halaman `web-client-portal`: daftar laporan + detail (same-origin, bukan iframe lintas-origin). Mode `klien` di-hardcode. |
| **D-03** | Pintu komplain M15 dipakai ulang (submit-only, nol endpoint GET) — menunggu jawaban `M20-PORTAL-KOMPLAIN`. |
| **D-04** | Tes: kontak klien toko A tidak bisa membaca laporan toko B; tidak ada argumen permintaan yang bisa menghasilkan render internal. |

**Kriteria keluar:** kontak klien membuka portal dan membaca dokumen yang sama
persis dengan berkas yang diunduh AM di B-03.

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
| **G-01** | Cabut rute M14, halaman "Laporan Performa (Mingguan/Bulanan)" di Direktori Klien, `ReportPanel.tsx`, `ShopeeReportForm.tsx`, dan tipe FE-nya — satu PR. |
| **G-02** | `route-parity.test.ts` hijau dengan `KNOWN_GAPS` **kosong**; `shape-parity.test.ts` hijau. |
| **G-03** | Entri `DECISIONS.md` menutup `M14-VS-PDT-DUPLIKASI`. |

`client_reports` dan tabel turunannya **tidak dihapus**: append-only, 0 baris,
biaya menyimpannya nol, dan ia jadi bukti riwayat.
`packages/core/src/report/**` juga tidak dihapus di PR yang sama — mesin murni
tanpa pemanggil tidak berbahaya, dan menghapusnya di PR pencabutan membuat
diff-nya mustahil dibaca. Penghapusannya tiket tersendiri sesudah satu siklus
laporan berjalan tenang.

---

## 4. Yang memblokir, hari ini

| Kode | Memblokir | Butuh dari |
|---|---|---|
| `M20-URUTAN` | pemilihan gelombang mana yang jalan lebih dulu sesudah A/B | Yohan |
| `M20-M14-BEKU` | apakah M14 dibekukan selama port berjalan | Yohan |
| `M20-TTAM-SAMPLE` | **F-03** — butuh empat ekspor TikTok Ads Manager nyata untuk memverifikasi tanda tangan kolom lewat pipeline PDT | Head of Account |
| `M20-PORTAL-KOMPLAIN` | **D-03** | Yohan |

Gelombang A dan B **tidak diblokir apa pun** dan bisa langsung dikerjakan.

---

## 5. Risiko

| Risiko | Penangkal |
|---|---|
| Permukaan klien hidup sebelum R2 ⇒ caveat terbit ke klien | Gelombang A adalah gelombang PERTAMA, dan B-05 menguji ketiadaan string internal di keluaran klien |
| Dua penulis `clients.total_sales` ⇒ Health Score melompat tanpa sebab performa | E-04 mematikan penulis M14 di PR yang sama dengan E-01 |
| Metrik `null` dihilangkan dari render klien ⇒ klien mengira bagian itu memang tidak ada | Poin manual AM (R3) adalah tempat menjelaskannya; ini keputusan sadar, bukan efek samping |
| Tanda tangan TTAM ditebak dari kode M14 tanpa sample nyata ⇒ ekspor Showcase salah tergolong `follows` | F-03 diblokir `M20-TTAM-SAMPLE`; penyangkalan kolom funnel Shop ditulis eksplisit di PRD R9 |
| Migrasi tabrakan prefix versi | `scripts/check-migration-versions.sh` sudah menjaganya; `supabase db push` tetap tidak bisa dipakai di repo ini |
