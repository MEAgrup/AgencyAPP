# CDPS — Module 20: Permukaan Laporan Klien PDT

**Status:** **AKTIF — Gelombang A, B, C merge 2026-09-22 (PR #494, #496, #497), migrasi C-01 sudah di live; Gelombang D berikutnya dengan nol blocker** (posisi rinci: `docs/plan/PLAN_PORT_M14_KE_PDT.md` header). Lahir dari audit pemilik "report klien vs PDT, fitur serupa tapi double, hanya akan pakai 1" (`docs/DECISIONS.md` baris `M14-VS-PDT-DUPLIKASI`, diketok 2026-09-22). **R11 ditambah 2026-09-22 sore** dari requirement pemilik "klien hanya melihat 1 bagian report, jangan sampai ada 2 report yg bisa dilihat klien".
**Worked example:** TEST PDT Store 2 (`CLI-202609-0021`) · TikTok Shop · Agustus 2026 — toko yang dipakai pemilik saat menemukan pita kuning "Belum lengkap" (§8)
**Depends on:** PDT (`CDPS_PDT_Pusat_Data_Toko.md` — lapisan fakta, Rule 21/22/23/24), M13 Client Health Report (konsumen `clients.total_sales`), M15 Client & Team Portal (realm auth klien, pintu komplain), M8 Ads (baseline ROAS)
**Resolves:** `docs/DECISIONS.md` Open `M14-VS-PDT-DUPLIKASI` · `docs/backlog/PDT_BACKLOG.md` §2 G2 ("Mematikan: Report Engine TikTok & Shopee")

---

## 1. Background

PDT sudah dinyatakan pengganti Mesin Laporan Klien M14 di dua tempat:
`CDPS_PDT_Pusat_Data_Toko.md` baris 13 ("menggantikan … Report Engine TikTok,
dan Report Engine Shopee") dan `PDT_BACKLOG.md` §2 ("Mematikan: Report Engine
TikTok & Shopee"). Audit 2026-09-22 menemukan bahwa **penggantiannya belum bisa
dijalankan**, dan kekurangannya bukan soal kedalaman angka — melainkan soal
seluruh separuh hilir yang tidak pernah dibangun.

Empat celah, semuanya diverifikasi ke kode:

| # | Yang M14 punya | Yang PDT punya hari ini |
|---|---|---|
| 1 | Renderer HTML mandiri dua mode, `klien` & `internal`; blok internal **tidak dibangun** (bukan `display:none`), jadi tak terbaca lewat View Source | **nol renderer.** `kirimLaporanPdt` hanya membekukan JSONB ke `pdt_laporan_kiriman`. Klien tidak menerima apa pun |
| 2 | State machine publikasi (`client_report_publikasi`, `sm_transition` mesin `client_report`), halaman portal klien, pintu komplain M15 | **nol permukaan portal**, nol status. `pdt_laporan_kiriman` nol kolom status |
| 3 | Penulis tunggal `clients.total_sales` (`recomputeTotalSales`) — sinyal GMV yang dibaca `health.ts` sebagai komponen **GMV Growth**; sisi Shopee juga mengisi entri metrik Ads (**ROAS Attainment**) | **nol tulisan ke Health Score, nol tulisan ke `clients`, nol entri metrik Ads.** Rule 24 PDT mewajibkannya, mekanismenya belum ada sama sekali |
| 4 | Bagian **Tokopedia** dan **TikTok Ads Manager (upper funnel, 4 ekspor TTAM)** | keduanya **belum ada modul PDT**. Justru celah inilah yang melahirkan pita kuning "Belum lengkap" pada bagian Tahap |

**Kenyataan di live (2026-09-22):** `client_reports` **0 baris**,
`client_report_publikasi` terbit **0**, `pdt_laporan_kiriman` **0 baris**,
`clients` dengan `total_sales ≠ 0` **0**, `pdt_upload_batch` **14 baris**.
Artinya: M14 belum pernah dipakai di produksi, PDT yang hidup — mencabut M14
hari ini tidak menghilangkan satu pun data klien, tapi menghapus satu-satunya
jalur pengiriman ke klien yang pernah dibangun. Itulah kenapa modul ini
**port**, bukan fitur baru.

### 1.1 Pemicu langsung: pita kuning yang salah audiens

Pemilik menemukan pita kuning di Laporan PDT:

> *"Belum lengkap — sebagian angka Awareness (impresi/views campaign, follower
> berbayar) dan Add-to-Cart belum dipanen ke fakta, jadi ditandai '—' di bawah,
> BUKAN nol aktivitas."*

Kalimat itu **benar dan wajib** untuk AM: ia menegakkan Rule 12 (tidak diketahui
BUKAN nol). Ia **beracun** untuk klien: terbaca sebagai "agensinya sendiri tidak
tahu angkanya".

Audit jalur kebocorannya (2026-09-22): banner hanya ada di `web-internal`; RLS
`pdt_laporan_kiriman` nol realm portal klien; `web-client-portal` nol rujukan
PDT. Jadi banner **tidak** pernah sampai ke klien lewat sistem — yang nyata
membocorkannya adalah **screenshot dan share-screen**, dan itu sudah ditutup
penanda `CatatanInternal` (commit 2026-09-22).

Tetapi ada jalur KEDUA yang bukan banner: `packages/core/src/pdt/laporan.ts`
baris 1292 dan 1297 menulis kalimat caveat setara **ke dalam `insight.poin`**,
dan `insight` ikut dibekukan ke `pdt_laporan_kiriman.payload`. Begitu permukaan
klien dibangun tanpa aturan, caveat itu terbit ke klien. §3 R2 menutupnya di
tingkat mesin, bukan di tingkat CSS.

> **Catatan paritas:** M14 punya kebocoran sejenis yang lebih kecil —
> `report/render.ts:186` merender *"Rentang tanggal tidak terbaca dari berkas
> export"* di KEDUA mode. R2 berlaku untuk keduanya; port ini memperbaikinya,
> bukan memindahkannya.

---

## 2. Ruang lingkup

**Masuk:** renderer HTML PDT dua mode; lapisan revisi insight + publikasi;
permukaan portal klien + pintu komplain; penulis `clients.total_sales` /
Health Score / baseline Ads berikut pencabutan (Rule 24); modul parser + penulis
fakta + bagian laporan untuk **Tokopedia** dan **TikTok Ads Manager**; pencabutan
M14 pada titik yang ditentukan §9.

**Tidak masuk:** perubahan pada lapisan fakta yang sudah jalan (`pdt_fact_*`
G1), mesin skor (G2-01), katalog usulan (G4), dan Product Exchange. Modul ini
tidak menyentuh satu pun angka yang sudah dihitung — ia membangun hilirnya.

---

## 3. Rules

### R1 · Renderer dua mode, blok internal tidak dibangun
Payload PDT dirender jadi satu dokumen HTML mandiri lewat fungsi murni di
`packages/core/src/pdt/render.ts` (cermin `report/render.ts`: nol DOM, nol
dependensi xlsx, nol jam sendiri). Dua mode: `klien` dan `internal`.

Blok internal **tidak boleh dibangun stringnya** pada mode `klien` — bukan
disembunyikan CSS, bukan dikirim lalu di-`display:none`. Alasannya sama dengan
M14: berkas yang diteruskan klien bisa dibaca lewat View Source.

Yang tergolong internal: catatan per-dimensi skor, rentang sehat benchmark,
versi mesin/benchmark, daftar akun sendiri yang dikecualikan, dan **seluruh
penanda kelengkapan data (R2)**.

### R2 · Caveat kelengkapan DILARANG sampai ke klien — ditegakkan di mesin
Ini requirement pemilik, dan ia ditegakkan di tiga lapis:

1. **Mesin berhenti menulis caveat sebagai prosa.** `laporan.ts` tidak lagi
   mendorong kalimat "Catatan: rincian kanal/iklan belum lengkap …" ke
   `insight.poin`. Kelengkapan pindah ke blok terstruktur `kelengkapan`
   (`{ bagian, lengkap, alasan, modulHilang[] }`), yang bisa dibaca mesin dan
   dirender selektif. `insight.poin` kembali murni narasi performa.
2. **Mode `klien` tidak merender blok `kelengkapan` sama sekali.**
3. **Metrik yang nilainya `null` DIHILANGKAN dari render klien**, bukan
   ditampilkan sebagai `—`. Sebuah `—` tanpa penjelasan justru terbaca sebagai
   nol — persis yang Rule 12 larang. Kalau metrik inti sebuah bagian `null`,
   bagian itu tidak dibangun; penomoran bagian diberikan **saat render** (pola
   M14), jadi dokumen klien tidak pernah melompat dari 7 ke 9.

Mode `internal` tetap menampilkan `—` **berikut** blok `kelengkapan`-nya, karena
di sana "belum dipanen" adalah informasi kerja.

### R3 · AM menulis poin manual; angka tetap tidak bisa disentuh
AM boleh menyunting SELURUH bagian naratif — ringkasan eksekutif, poin insight,
rekomendasi prioritas tinggi/sedang, outlook, indikator, narasi per tahap — dan
boleh **menambah poin yang ditulis sendiri** untuk menjelaskan hal yang mesin
tidak tahu (termasuk konteks di balik metrik yang R2 hilangkan).

Angka **tidak** bisa disunting: GMV, ROAS, skor, tabel funnel, kuadran produk.
Suntingan disimpan sebagai **revisi append-only** (`pdt_laporan_insight`,
cermin `client_report_insight`), bukan menimpa payload — `pdt_laporan_kiriman`
beku oleh trigger `_frozen()` dan tetap beku.

Suntingan setelah kirim **tidak** meminta berkas ulang (PDT Rule 23).

### R4 · Revisi yang dilihat klien DIPAKU, bukan "terbaru menang"
`pdt_laporan_publikasi.insight_revisi` memaku revisi mana yang dibaca klien.
Menyimpan suntingan aman; yang mengubah apa yang klien lihat hanya
**Terbitkan pembaruan**, yang memindahkan paku. Pratinjau internal membaca
revisi **terbaru**; render klien membaca yang **terpaku**.

Alasannya sama dengan M14 keputusan arsitektur 1: kalau terbaru menang, setiap
tekan Simpan jadi pengumuman, dan AM tidak bisa menyunting laporan tayang tanpa
ditonton prosesnya.

### R5 · Status publikasi tidak di `pdt_laporan_kiriman`
Tabel itu beku untuk SEMUA update (bukan per kolom). Status hidup di
`pdt_laporan_publikasi`, ditulis **eksklusif** oleh `sm_transition`, mesin
`pdt_laporan`. Status: `[Draf]` → `[Terbit]` ⇄ `[Dicabut]`. **Nol terminal
state** — laporan tercabut harus bisa dikoreksi lalu diterbitkan lagi.

### R6 · Pencabutan wajib memicu hitung ulang agregat klien (PDT Rule 24)
Transisi ke `[Dicabut]` **wajib**, dalam transaksi yang sama, memicu hitung
ulang `clients.total_sales`, Health Score, dan baseline Ads. **Nol jalan keluar
lewat SQL manual.** Ini yang membuat Rule 24 PDT akhirnya punya mekanisme.

### R7 · `total_sales` disetarakan ke 30 hari, dan penulisnya HANYA satu
PDT jadi penulis `clients.total_sales` = Σ run-rate bulanan laporan terbit
terakhir per platform aktif. Laporan bulanan lewat apa adanya; laporan
mingguan diskalakan ke 30 hari **sebelum** ditulis — menulis GMV mingguan mentah
menjatuhkannya ~4× dan mencrater Health Score klien tanpa sebab performa (sama
persis keputusan 3 M14).

**Dua penulis untuk satu kolom adalah bug, bukan redundansi.** Selama masa
transisi, M14 dan PDT tidak boleh sama-sama menulis kolom ini — lihat §9.

### R8 · Bagian Tokopedia
Modul parser baru `tt_shop_analytics_tokopedia` (tanda tangan kolom, bukan nama
berkas — PDT Rule 6; sumber tanda tangan: `baseline/detect.ts` `shop_tp`, yaitu
`GMV` + `Pendapatan bruto` + `Pengunjung`, **menyangkal** `GMV dari LIVE kreator`
dan `ID Produk`). Penulis fakta ke `pdt_fact_shop_daily` dengan penanda kanal
Tokopedia. Bagian laporan: GMV, pesanan, pengunjung, CVR, produk terjual,
pembeli, dan perubahan periode.

`prod_tp` (Analitik Produk Tokopedia) **tidak** ikut — M14 sendiri menandainya
`UNUSED`, dan memanen kolom tanpa konsumen adalah skema spekulatif.

### R9 · Bagian TikTok Ads Manager (upper funnel)
Empat modul parser baru, tanda tangan diambil apa adanya dari
`report/detect.ts` `TTAM_TYPES` — termasuk **penyangkalan** pada `ttam_follows`
(wajib menyangkal kolom funnel Shop; ekspor Showcase juga membawa `Paid follows`,
dan tanpa penyangkalan ia salah tergolong):

| Modul | Tanda tangan |
|---|---|
| `tt_ads_manager_consideration` | `New consideration size` |
| `tt_ads_manager_follows` | `Paid follows` **dan bukan** kolom funnel Shop |
| `tt_ads_manager_showcase` | kolom funnel Shop (ATC / Initiate Checkout) |
| `tt_ads_manager_videoviews` | ~~`Video views` **dan** `CPM`~~ **DIKOREKSI 2026-09-23** (`docs/DECISIONS.md` M20-R9-F-03-TTAM-VIDEOVIEWS): sample asli membuktikan berkas nyata nol kolom literal `'Video views'` — dipakai `'6-second focused views'` **dan** `'CPM'` |

Belanja Ads Manager **tidak** boleh masuk perhitungan ROI GMV Max — kampanye ini
dioptimasi ke jangkauan/checkout, bukan pesanan; mencampurnya membuat kampanye
penjualan terlihat lebih buruk dari kenyataan. Kalimat guardrail M14 diport apa
adanya.

Konsekuensi yang dituju: begitu R9 mendarat, `tahap.funnel` Awareness dan
Add-to-Cart berhenti `null`, dan pita kuning §1.1 **hilang karena datanya ada** —
bukan karena disembunyikan.

### R10 · Portal klien membaca lewat modul domainnya sendiri
Pembacaan klien memakai DTO sempit di `packages/domain/src/client-portal.ts`
(allow-list), **bukan** objek domain internal yang di-serialize sebagian. Mode
`klien` di-**hardcode** pada jalur portal: tidak ada argumen dari permintaan
klien yang boleh menghasilkan render internal.

### R11 · Klien melihat TEPAT SATU permukaan laporan — juga selama transisi
Requirement pemilik (2026-09-22): *"klien hanya melihat 1 bagian report,
jangan sampai ada 2 report yg bisa dilihat klien."*

1. Portal klien punya **satu** menu Laporan, **satu** daftar, **satu** rute
   daftar (`GET /client-portal/reports`) dan **satu** rute dokumen
   (`GET /client-portal/reports/{id}/html`). Tidak ada `laporan-pdt`, tidak ada
   `/client-portal/pdt/**`, tidak ada tab "Laporan Lama / Laporan Baru".
2. Port ke PDT dilakukan dengan **mengganti sumber** di balik permukaan itu
   (`client_reports` → `pdt_laporan_kiriman` + `pdt_laporan_publikasi` +
   `pdt_laporan_insight`), **bukan** membangun permukaan kedua lalu mencabut
   yang lama belakangan. Tidak ada rentang waktu di mana keduanya hidup
   berdampingan di sisi klien.
3. **Isi daftar klien — diketok pemilik 2026-09-22 (sore):**
   *"Klien bisa melihat list report yang sudah selesai dari team. Kalau ada
   perubahan dalam report, misalnya Agustus ada 2 versi, yang dilihat adalah
   versi terbaru. Tapi kalau klien punya kontrak 3 bulan, dia bisa melihat 3
   report yang berbeda periode."*
   - **"Sudah selesai"** = status publikasi `[Terbit]` (R5). Draf dan yang
     dicabut tidak pernah terdaftar dan tidak bisa dibuka lewat id.
   - **Satu baris per (toko/platform, periode).** Klien dengan kontrak 3 bulan
     melihat **3 baris** untuk 3 periode berbeda; klien dengan dua toko (TikTok
     Shop + Shopee) melihat satu baris per toko per periode. Daftar diurutkan
     periode terbaru dulu.
   - **Satu periode = satu versi, yaitu yang TERBARU.** "Versi" di PDT ada di
     dua lapis, dan keduanya tunduk pada aturan ini: (a) antar-**kiriman** untuk
     periode yang sama (kiriman revisi ber-`menggantikan_kiriman_id`, atau
     kiriman ulang periode yang sama): hanya kiriman **terakhir** (`dikirim_pada`
     terbesar) per `(client_platform_id, periode_mulai)` yang menjadi kandidat;
     kiriman yang lebih lama **tidak lagi terdaftar dan tidak bisa dibuka** oleh
     klien lewat id, walau status publikasinya sendiri masih `[Terbit]`; (b) di
     dalam satu kiriman, narasi yang dibaca adalah revisi **terpaku**
     `insight_revisi` (R4), bukan revisi terbaru yang belum diterbitkan.
   - **Kandidat terbaru yang belum/tidak `[Terbit]` ⇒ periode itu KOSONG bagi
     klien**, bukan jatuh ke versi lama. Cabut berarti "tarik laporan periode
     ini dari klien"; versi lama yang sudah digantikan tidak pernah muncul
     kembali dengan sendirinya. Kalau AM ingin klien kembali melihat sesuatu
     untuk periode itu, AM menerbitkan (ulang) kandidat terbaru.
   - Klien **tidak** melihat riwayat versi, nomor revisi, atau tanda "direvisi";
     yang ia lihat hanya dokumen final periode itu.
4. Ditegakkan di CI, bukan disiplin: `apps/api/src/lib/route-parity.test.ts`
   mengunci himpunan rute portal ber-`report|laporan|pdt` dan himpunan halaman
   `(portal)` ber-`laporan|report|pdt` **persis** dua-dua. PR yang menambah
   salah satunya merah.

Konsekuensi pada §9: jalur **portal** M14 berhenti dipanggil di Gelombang D
(sumbernya diganti), sementara kode M14 sendiri (`report/**`, `ReportPanel`,
rute `/reports/*`) tetap ada sampai G. Ini bukan "mencabut M14 per tiket" —
tidak ada satu baris M14 pun yang dihapus di D; yang berubah adalah dari mana
`client-portal.ts` membaca.

---

## 4. Perubahan data model

| Objek | Bentuk | Catatan |
|---|---|---|
| `pdt_laporan_insight` | tabel baru, append-only | `(kiriman_id, revisi, sumber, ringkasan, poin, rekomendasi_tinggi, rekomendasi_sedang, outlook, indikator, tahap_narasi, ditulis_oleh, ditulis_pada)`; `(revisi = 0) = (sumber = 'mesin')`; `bigint GENERATED ALWAYS AS IDENTITY`, **nol prefix baru** (preseden `client_reports` / `pdt_laporan_kiriman`, koreksi K-2 PDT) |
| `pdt_laporan_publikasi` | tabel baru | `(kiriman_id, status, insight_revisi, diterbitkan_pada, diterbitkan_oleh, alasan_cabut)`; status ditulis **eksklusif** `sm_transition` |
| mesin `pdt_laporan` | baris `state_machine` baru | `[Draf]` → `[Terbit]` ⇄ `[Dicabut]`, nol terminal state |
| `pdt_parser_modul` | +5 baris seed | R8 (1) + R9 (4) |
| `pdt_fact_shop_daily` | +penanda kanal | menampung Tokopedia tanpa mencampurnya ke GMV TikTok Shop |
| `pdt_fact_ads` | +`tujuan` (upper/lower funnel) | supaya belanja Ads Manager bisa dijumlahkan terpisah dan R9 guardrail bisa ditegakkan di query, bukan cuma di prosa |

Tidak ada perubahan pada `pdt_laporan_kiriman` selain tetap beku.

---

## 5. Permission

Cermin predikat yang sudah ada di `packages/domain/src/pdt.ts` (K-3 PDT:
predikat bernama, ditegakkan RLS — bukan sistem permission-key):

| Aksi | Siapa |
|---|---|
| Sunting insight, kirim, terbitkan, terbitkan pembaruan | AM pemilik toko, Lead divisi Account, Director (`canKirimLaporan`) |
| Cabut | sama dengan di atas; **wajib** mengisi alasan |
| Baca render `internal` | sama dengan di atas + OD (read-only) |
| Baca render `klien` lewat portal | hanya kontak klien pemilik toko, lewat realm auth portal yang terpisah |

RLS `pdt_laporan_insight` dan `pdt_laporan_publikasi` mengikuti scope
`pdt_laporan_kiriman`. Pembacaan portal berjalan service-role, jadi predikat
klien **wajib ada di SQL-nya sendiri**, tidak boleh mengandalkan RLS saja.

---

## 6. Pesan validasi (Bahasa Indonesia, house rule #5)

| Konstanta | Pesan |
|---|---|
| `MSG_KIRIMAN_NOT_FOUND` | `[laporan tidak ditemukan]` |
| `MSG_SUDAH_TERBIT` | `[laporan sudah diterbitkan — cabut dulu sebelum menerbitkan ulang]` |
| `MSG_BELUM_TERBIT` | `[laporan belum diterbitkan]` |
| `MSG_TAK_ADA_REVISI` | `[tidak ada revisi insight baru untuk diterbitkan]` |
| `MSG_ALASAN_CABUT_WAJIB` | `[alasan pencabutan wajib diisi]` |
| `MSG_INSIGHT_NOT_FOUND` | `[insight laporan tidak ditemukan]` |
| `MSG_FORBIDDEN` | `[anda tidak memiliki akses ke data ini]` |

Pesan yang sudah ada di M14 dipakai ulang **persis**, bukan diparafrase — satu
string, satu makna.

---

## 7. Urutan yang mengikat

R1 dan R2 mendarat **sebelum** R4/R5/R10. Alasannya bukan estetika: begitu
permukaan klien hidup tanpa R2, caveat §1.1 terbit ke klien, dan itu persis
kejadian yang modul ini ada untuk mencegahnya.

R6/R7 mendarat **sebelum** M14 dicabut, karena M14-lah yang hari ini memegang
penulis `total_sales`. Mencabutnya lebih dulu memutus komponen GMV Growth Health
Score tanpa penggantinya.

---

## 8. Worked example

**TEST PDT Store 2 (`CLI-202609-0021`) · TikTok Shop · Agustus 2026.**

1. AM membuka Laporan PDT. Bagian **Tahap** menunjukkan Awareness dan
   Add-to-Cart `—`, dengan blok `kelengkapan` bertanda **Catatan internal**.
2. AM menyunting narasi: menghapus kalimat mesin yang bertele-tele, menambah
   **poin manual** "Fokus Agustus adalah menstabilkan ROAS Video Shopping Ads
   sebelum menaikkan belanja" — hal yang tidak ada di angka mana pun.
3. AM menekan **Kirim ke Klien**. Snapshot beku ditulis (`pdt_laporan_kiriman`,
   sudah jalan hari ini), revisi 0 = narasi mesin, revisi 1 = suntingan AM.
4. AM menekan **Terbitkan**. Paku pindah ke revisi 1.
5. AM mengunduh `Laporan-TEST-PDT-Store-2-2026-08.html` mode `klien` dan
   melampirkannya ke email. Dokumen itu: **nol** blok `kelengkapan`, **nol**
   baris `—` pada funnel (baris ber-`null` tidak dibangun), penomoran bagian
   rapat tanpa lompatan, poin manual AM terbaca.
6. Kontak klien membuka portal dan melihat dokumen yang **sama persis**, plus
   pintu komplain — di menu **Laporan** yang sama seperti sebelum port, bukan
   di menu baru (R11).
7. AM sadar satu angka salah karena berkas yang tertukar. AM menekan **Cabut**
   dengan alasan → `clients.total_sales`, Health Score, dan baseline Ads klien
   ini otomatis dihitung ulang (R6). Tidak ada berkas yang diminta ulang.

---

## 9. Titik pencabutan M14

M14 **tidak** dicabut per tiket; ia dicabut sekali, saat seluruh syarat ini
benar bersamaan:

1. R1–R7 mendarat dan hijau di CI.
2. Satu laporan nyata sudah menempuh Kirim → Terbitkan → baca di portal →
   Cabut → agregat terhitung ulang, di live.
3. `clients.total_sales` punya **tepat satu** penulis. Selama transisi, penulis
   M14 dimatikan lebih dulu (bukan dihapus) supaya jalur baliknya masih ada.

Sesudah itu: rute internal, halaman Direktori Klien ("Laporan Performa Mingguan/Bulanan"),
`ShopeeReportForm`, dan `ReportPanel` dicabut dalam satu PR, dan
`route-parity.test.ts` wajib tetap hijau dengan `KNOWN_GAPS` **kosong**.
Jalur **portal** M14 tidak termasuk daftar itu: sumbernya sudah diganti di
Gelombang D (R11), sehingga sejak D tidak ada pemanggil portal yang menyentuh
`client_reports`.
`client_reports` beserta isinya **tidak dihapus** — ia append-only dan 0 baris,
jadi biaya menyimpannya nol dan ia jadi bukti riwayat.

---

## 10. Pertanyaan terbuka

| Kode | Pertanyaan | Butuh dari |
|---|---|---|
| ~~`M20-URUTAN`~~ | ✅ diketok 2026-09-22: A → B → C → D → E → F → G | Yohan |
| ~~`M20-M14-BEKU`~~ | ✅ diketok 2026-09-22: M14 **dibekukan** (bugfix kritis saja) sampai G | Yohan |
| `M20-TTAM-SAMPLE` | 🟡 SEBAGIAN 2026-09-23: 1 dari 4 ekspor (Video Views) diunggah dan diverifikasi — `tt_ads_manager_videoviews` SELESAI, signature dikoreksi dari dugaan literal di atas (bukan `'Video views'`, tapi `'6-second focused views'` — `docs/DECISIONS.md` M20-R9-F-03-TTAM-VIDEOVIEWS). Masih menunggu sample `consideration`/`follows`/`showcase`; F-03 sisanya/F-04/F-05 menunggu, F-01/F-02/F-03-videoviews tidak | Yohan / Head of Account |
| ~~`M20-PORTAL-KOMPLAIN`~~ | ✅ diketok 2026-09-22: pintu komplain M15 apa adanya | Yohan |
| ~~`M20-C01-LIVE`~~ | ✅ ditutup 2026-09-22 malam: migrasi C-01 diterapkan ke live (versi `20260922151204`), 186 tabel / 36 mesin terverifikasi; D-00 selesai | — |

---

## 11. Definition of Done

- Render `klien` dan `internal` diuji berdampingan; tes membuktikan string blok
  internal **tidak ada** di keluaran `klien` (bukan sekadar tak terlihat).
- Tes membuktikan tiap metrik `null` **hilang** dari render `klien` dan **ada**
  (sebagai `—` + blok `kelengkapan`) di render `internal`.
- Tes membuktikan `insight.poin` mesin tidak lagi memuat kalimat caveat
  kelengkapan, dan caveat itu terbaca dari blok `kelengkapan`.
- Tes immutability: nol jalur mutasi pada `pdt_laporan_kiriman` dan
  `pdt_laporan_insight`.
- Tes permission per peran, termasuk OD/Director berlapis, dan tes bahwa kontak
  klien satu toko tidak bisa membaca laporan toko lain.
- Tes Rule 24: pencabutan menghitung ulang `total_sales`, Health Score, dan
  baseline Ads dalam satu transaksi; rollback membatalkan ketiganya.
- Tes `total_sales`: laporan mingguan dan bulanan menulis SATUAN yang sama.
- Seed fixture worked example §8 lolos ujung-ke-ujung.
- `route-parity.test.ts` hijau, `KNOWN_GAPS` kosong, **dan kedua tes R11**
  (rute portal ber-laporan persis dua; halaman `(portal)` ber-laporan persis
  dua) hijau.
- `packages/domain/src/client-portal.ts` nol rujukan `client_reports` sejak
  Gelombang D.
- Tes R11.3: satu toko dengan dua kiriman `[Terbit]` untuk Agustus ⇒ daftar
  klien memuat **satu** baris Agustus (kiriman terbaru), dan id kiriman lama
  menjawab `[laporan tidak ditemukan]`; satu toko dengan tiga periode terbit ⇒
  **tiga** baris; kandidat terbaru `[Dicabut]` ⇒ periode itu hilang, bukan
  jatuh ke kiriman lama.
