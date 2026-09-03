# `docs/design/` — artefak desain, rujukan **satu arah**

Berkas di sini adalah **prototipe/desain yang sudah disetujui pemilik dan dipakai sebagai
spesifikasi porting**. Aturannya satu, dan penting:

> **Rujukan satu arah.** Begitu logikanya diport ke `packages/**`, berkas di sini **tidak
> dipelihara lagi**. Jangan memperbaiki bug di sini, jangan menyinkronkan dua arah.

Alasannya bukan kerapian: memelihara dua salinan aturan bisnis yang sama akan membuat keduanya
menyimpang, dan itu kegagalan yang `CLAUDE.md` peringatkan eksplisit (*"menciptakan versi kedua
dari aturan bisnis yang sama"*). Sesudah port, satu-satunya sumber kebenaran adalah kode di
`packages/**` beserta tesnya.

## Isi

| Berkas | Asal | Diport ke | Status |
|---|---|---|---|
| `BASELINE_TOOL_TIKTOK_v1.html` | Pemilik, 2026-08-17 (revisi ke-2) | `packages/core/src/baseline/` (tiket **RAB-02**) | **belum diport** |
| `SHOPEE_REPORT_ENGINE.html` | Pemilik, 2026-09-03 — unggahan asli (bukan ketikan ulang) | `packages/core/src/report/shopee/` (Gelombang 2, tiket **SH-01..SH-06**, `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` §5) | **belum diport** |
| `MEA_SKU_SCREENER_v2.html` | Pemilik, 2026-09-03 — unggahan asli, "MEA SKU Screener v2" | `packages/core/src/skuscreener/` (Gelombang 3, tiket **SC-01..SC-08**, plan §6) | **belum diport** |
| `PRD_MEA_SKU_SCREENER_v1.0.md` | Pemilik, 2026-09-03 — ekstraksi teks dari `.docx` asli (Dev asal: Hans, 27 Jul 2026) | Spesifikasi R01–R16 untuk `packages/core/src/skuscreener/`; A01–A10 dikonfirmasi di `DECISIONS.md` (**SC-00**) | **R01–R06, R09–R12 dikonfirmasi ada di kode `MEA_SKU_SCREENER_v2.html`; R07/R08/R13–R16 TIDAK ada di HTML — lihat catatan di bawah** |
| `TIKTOK_ADS_SCANNER.html` | Pemilik, 2026-09-03 — unggahan asli, "MEA SKU Triage — Panel Advertiser" | Gelombang 4 (`docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` §7) — jalur (embed vs port) **belum diputuskan** | **belum diputuskan jalurnya, jadi belum diport** |

### `BASELINE_TOOL_TIKTOK_v1.html`

Tool baseline riset toko: membaca export **TikTok Shop Seller Center + Ads Manager** (dan Analitik
Toko Tokopedia secara tipis), menghitung 5 pilar Skor Kondisi Toko, menghasilkan payload
`cdps.baseline.tiktok.v1`.

**Nilainya bagi porting** ada di hal-hal yang mudah salah dan sudah benar di sini — jangan
ditulis ulang, pindahkan apa adanya:

- `n(v,raw)` — Seller Center mengirim string `"Rp10.945.407"` (titik = **ribuan**), Ads Manager
  mengirim float `335164.77` (titik = **desimal**). Flag `raw` yang membedakannya.
- Heuristik deteksi baris header — memakai hitungan **label unik** supaya header kedua
  ("Data harian") dan baris filter `"Semua","Semua",…` tidak salah dibaca sebagai header.
- Ambang tayangan **adaptif** (median VV video yang terbukti jual), membuang baris sisa histori.
- **Median, bukan rata-rata**, sebagai jangkar baseline + penanda bulan campaign 1,8×.
- Guardrail *"pendapatan iklan tumpang tindih dengan GMV, jangan dijumlah"* — sejajar dengan
  guardrail single-source GMV M6D (RM-3).
- Bobot 5 pilar **sadar-cakupan**: pilar tanpa data → `null`, bobot dinormalisasi ulang.
- 12 tanda-tangan tipe file + **seluruh string nama kolom** (inilah peta yang tak boleh ditebak).

**Yang HARUS diperbaiki saat porting** (jangan diport apa adanya) —
lihat `docs/handoff/HANDOFF_M6ABC_SESI31.md` §2.2 untuk daftar lengkap dengan alasannya:

1. `null * 100` jadi `0`, membatalkan penjagaan null di setiap situs panggil `meter()`.
2. `n()` mengembalikan `0` untuk kolom kosong/hilang — kolom yang berganti nama terbaca sebagai nol.
3. `detect()` memisah toko-vs-afiliasi dari ambang `u.size<=2`.
4. Benchmark (`BENCH`, 16 angka) bisa diedit AM di browser ⇒ skor tak bisa dihitung ulang.
5. `new Date()` klien, bukan WIB server. 6. SheetJS/font dari CDN. 7. Identitas & riwayat GMV
   diketik ulang padahal sudah ada di `clients`/`qualified_forms`. 8. Output berhenti di clipboard.
   9. Nol baris audit.

> ⚠️ **Berkas ini adalah salinan yang dituliskan ulang dari pesan pemilik, bukan unggahan biner.**
> Kalau saat porting ada keraguan tentang satu baris — terutama string nama kolom atau angka
> benchmark — **minta pemilik menempelkan ulang versi aslinya** dan perlakukan itu sebagai yang
> benar, jangan menebak.

### `SHOPEE_REPORT_ENGINE.html`

Unggahan biner asli pemilik 2026-09-03 (bukan ketikan ulang) — sumber untuk **Gelombang 2**.
Strukturnya cermin `packages/core/src/report/` (TikTok, sudah ada): `parseNumber` → `PARSERS`
per modul (17 tanda tangan berkas via `MODULE_MAP`, cocok dengan ringkasan di plan §5) →
`buildReportData` → `computeScores` (6 dimensi berbobot, **`DIMENSI` di kode == persis** yang
dicatat plan: ROAS & Channel .22, Traffic Quality .22, Conversion & Retention .18, Product
Performance .14, Live Streaming .12, Kesehatan Toko .12) → `ruleBasedInsights` →
`reportBodyHTML`/`computeChartData`.

**Yang HARUS diperbaiki saat porting** (pola sama seperti baseline TikTok — jangan port apa
adanya, lihat checklist plan §5):

1. `null` dipetakan jadi `0` di banyak tempat (`.reduce((a,i)=>a+(i.omzet||0),0)`,
   `s.roi||0` di `scoreRoas`, dst) — port harus membedakan "nol beneran" dari "data tidak ada",
   sesuai aturan rumah #7 (pembagian nol → `—`, bukan `0` diam-diam).
2. Format uang di sini `'Rp '+Math.round(n).toLocaleString('id-ID')` (spasi setelah Rp, tanpa
   `,00`) — **bukan** format rumah CDPS `Rp. X.XXX.XXX,00`. Formatter rumah (`packages/core`
   yang dipakai TikTok) yang dipakai, bukan `fmtRp` di berkas ini.
3. Benchmark kuadran (`CONFIG.kuadran`, `CONFIG.health`) hardcoded di kode — harus jadi tabel
   `report_benchmark` berversi (pola sama dengan benchmark TikTok) supaya skor recomputable,
   bukan konstanta yang berubah lewat deploy diam-diam.
4. `new Date()` tidak dipakai langsung untuk timestamp laporan di sini (engine tidak menstempel
   tanggal sendiri, `period` diinput manual) — tapi field manapun yang CDPS tambahkan
   (`generated_at`, dsb) wajib jam WIB server, bukan klien.
5. Blok yang tidak boleh terlihat klien (kalau ada mode internal-only di masa depan) harus
   **tidak dibangun** di string, bukan `display:none` — pola yang sama dengan TikTok.
6. Parser angka Indonesia (`parseNumber`) di berkas ini **hampir sama** tapi bukan identik
   dengan `packages/core/src/baseline/angka.ts` (`n(v, raw)`) — cek dulu apakah keduanya betul
   ekuivalen sebelum menyatukan; jangan asumsikan dari nama fungsi saja.
7. `parseFilename` mengharap pola nama berkas `[prefix]-subtype && period && client && date.ext`
   (mis. `[bisnis]-Home && Juni 2026 && EzzyConnect && ....xlsx`) — ini konvensi ekspor pemilik,
   bukan nama asli Shopee Seller Centre. Perlu dikonfirmasi ke tim advertiser apakah proses
   rename manual ini tetap dipakai saat file diupload ke CDPS, atau CDPS perlu mendeteksi modul
   dari **isi** file (nama sheet/header) seperti TikTok, bukan dari nama berkas.
8. `extractIdentity`/validasi "file beda toko ditolak" bagus dipertahankan sebagai guardrail,
   tapi cek apakah CDPS sudah py identitas toko per klien di tempat lain (`clients` record) yang
   bisa dipakai silang — jangan biarkan jadi sumber kebenaran kedua untuk identitas toko.

### `MEA_SKU_SCREENER_v2.html`

Unggahan biner asli pemilik 2026-09-03 — sumber untuk **Gelombang 3, Modul A & B**
(screening/routing + sebelum-sesudah). **Tidak mengimplementasikan Modul C (Decision Log) atau
D (Tracker Optimasi)** — keduanya di PRD dispesifikasikan sebagai Google Sheets terpisah (§5.1
PRD), bukan bagian dari HTML ini. Port CDPS-nya (SC-07/SC-08) membangun ADL- dan trackernya
langsung di Postgres, tidak mem-port kode dari Sheets manapun (tidak ada Sheets untuk diport).

**Temuan porting penting — HTML lebih sederhana daripada PRD di beberapa titik, JANGAN
diselaraskan diam-diam:**

- **R07/R08 (target ROAS otomatis per fase dari margin/biaya platform/service fee) TIDAK ADA
  di HTML.** Input `target` di UI adalah angka manual (`<input id="target" value="4">`), dengan
  hint "Ambil dari tab EKONOMI_KLIEN" — advertiser menghitung floor kontribusi di spreadsheet
  terpisah lalu mengetik hasilnya di sini. **Keputusan porting: apakah CDPS mengotomasi R07/R08
  dari data ekonomi klien yang sudah tersimpan (kalau ada), atau tetap manual seperti tool
  ini?** Dicatat sebagai open question — lihat `DECISIONS.md`.
- **A08 (default target ROAS Fase 1) — PRD bilang 3,57 (hasil formula R07 dengan margin 40%,
  platform 12%), HTML shipped memakai default polos `4`.** Dua sumber kebenaran pemilik sendiri
  tidak sepakat. **Tidak ditebak** — lihat `DECISIONS.md` untuk status resolusi.
- A02/A03/A06 (nama sheet fallback, Kode Produk opsional dengan fallback nama, header CSV ads
  dicari dinamis bukan hardcode baris ke-7) — **sudah dijawab oleh kode HTML sendiri** lewat
  fallback defensif; port harus meniru pola fallback yang sama, bukan asumsi PRD yang lebih
  kaku. Detail per item ada di `DECISIONS.md` (SC-00 / SCR-1..SCR-10).
- Modul R13–R16 (Decision Log append-only, syarat minimum data kampanye, tangga keputusan,
  batas kampanye aktif) juga tidak ada di HTML ini — itu memang domain Modul C, bukan A/B,
  konsisten dengan pembagian PRD §3.3/§3.4. Bukan temuan gap, hanya konfirmasi cakupan.

**Yang HARUS diperbaiki saat porting** (pola sama seperti tool lain di sini):
1. `idNum()` di berkas ini adalah parser angka Indonesia versi ketiga (baseline TikTok punya
   `n(v,raw)`, Shopee Report Engine punya `parseNumber`, ini `idNum`) — **jangan tulis versi
   keempat**; satukan ke `packages/core/src/baseline/angka.ts` kalau perilakunya ekuivalen,
   atau dokumentasikan bedanya kalau tidak.
2. Median/ambang median toko (R04, `mCTR`/`mCR` di kode) memakai floor tetap
   (`views>=200`/`clicks>=20`, floor CTR 2%/CR 0,5%) — **PRD R04 minta penurunan ambang
   iteratif 50% sampai ≥5 SKU atau floor absolut (Views≥50/Clicks≥5)**, yang TIDAK ada di kode
   HTML (kode langsung pakai ambang tetap, tanpa iterasi penurunan). Port mengikuti **PRD**
   (R04 lengkap dengan iterasi), karena ini spesifik disebut sebagai rule bernomor yang wajib
   diimplementasikan penuh — bukan sekadar UI shortcut seperti R07/R08.
3. `new Date()` klien dipakai untuk `tgl()` (tanggal unduhan CSV tracker) — port pakai jam WIB
   server.
4. SheetJS dari CDN — vendor lokal (`public/tools/xlsx.full.min.js` sudah ada, pakai itu).
5. Anti-rule R06 (Views≥2.000 & CR<0,5% → 'ANTI-RULE') **tidak eksplisit sebagai label
   terpisah di HTML** — tercampur ke jalur PARKIR biasa. Port menegakkannya sebagai tanda
   terpisah sesuai PRD, karena PRD bilang ini "mengalahkan rute apapun" (harus terlihat beda
   dari PARKIR biasa, bukan CDPS balik menggabungkannya).

### `PRD_MEA_SKU_SCREENER_v1.0.md`

Ekstraksi teks dari `.docx` asli pemilik (dikirim 2026-09-03, ditulis Hans 27 Jul 2026) — spec
lengkap R01–R16 + 10 Open Assumptions (A01–A10) untuk Gelombang 3. **Bukan sinkron dua arah
dengan `MEA_SKU_SCREENER_v2.html`** — keduanya adalah dua unggahan pemilik yang independen, dan
sesi porting yang menemukan HTML lebih sederhana dari PRD (lihat catatan di atas) WAJIB dicatat
sebagai keputusan di `DECISIONS.md`, bukan diam-diam mengikuti salah satu tanpa alasan tertulis.
SC-00 (konfirmasi 10 asumsi) sudah dikerjakan sejauh bisa dari bukti kode + PRD sendiri — lihat
`DECISIONS.md` untuk yang closed dan yang masih perlu jawaban pemilik.

### `TIKTOK_ADS_SCANNER.html`

Unggahan biner asli pemilik 2026-09-03, judul aslinya "MEA SKU Triage — Panel Advertiser" —
**ini alat yang dijanjikan sebagai "TikTok Ads Scanner" untuk Gelombang 4** (plan §7). Beda
kelas dari dua alat Shopee di atas: dia sudah punya **portofolio multi-klien dengan penyimpanan
`localStorage` browser** (bukan sekali-pakai per laporan), skor SKU 0–100 dari 5 komponen
berbobot (konten 35%, GMV 25%, efisiensi ROI 20%, CTR 10%, CTOR 10%), 6 bucket keputusan (SCALE
UP, PERLU OPTIMASI, STOK VIDEO CUKUP, BANGUN KONTEN, BOROS, DIBLOKIR), realokasi budget lintas
SKU, dan mesin klasifikasi angle konten (9 kategori dari regex caption).

**Jalur porting (embed vs port) BELUM DIPUTUSKAN** — lihat plan §7 aturan pemisahnya: "angka
cuma dibaca manusia → embed; angka menggerakkan keputusan sistem → port". Alat ini jelas
**menggerakkan keputusan** (bucket routing, realokasi budget dalam Rupiah) sehingga condong ke
jalur **port**, tapi ini keputusan arsitektur yang harus dicatat eksplisit di `DECISIONS.md`
sebelum kode ditulis, bukan diasumsikan dari observasi ini. Jangan mulai men-port sebelum entri
`DECISIONS.md` ada.
