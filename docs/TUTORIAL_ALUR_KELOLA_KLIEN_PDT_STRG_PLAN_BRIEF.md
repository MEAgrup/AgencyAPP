# Tutorial: Alur Kelola Klien — Riset Awal, PDT, Strategi (STRG), Plan & Brief

> **Untuk siapa dokumen ini.** Account Manager (AM) dan SPV/Head of Account —
> alur ini adalah pekerjaan inti divisi **Account** sejak klien diserahkan
> Sales sampai pekerjaan sampai ke meja divisi eksekusi (Creative, Ads, KOL,
> Live Stream, AI Optimizer, Store Operation). Bukan untuk developer.

## ⚠️ Dua hal yang sering tertukar — baca dulu sebelum mulai

**"Riset Awal" dan "PDT" adalah DUA sistem yang terpisah, bukan satu.** Ini
sering disangka satu hal karena namanya mirip-mirip dan sama-sama soal
"upload data toko". Bedanya:

| | **Riset Awal** (fitur *Baseline Riset Awal*) | **PDT** (Pusat Data Toko) |
|---|---|---|
| Fungsinya | Syarat **wajib sebelum Interview** bisa dimulai | Sumber data untuk **Section B Strategi**, laporan periodik, dan Product Exchange |
| Tempat upload | Di dalam halaman **"Mulai Riset & Interview"** sendiri | Menu terpisah **Upload Data Toko (PDT)** |
| Dipakai berapa kali | **Sekali** per toko (bisa dikoreksi kalau salah upload) | **Berulang, setiap periode** (bulanan) |
| Kalau belum diisi | Interview **tidak bisa dimulai** — gerbang server keras | Section B Strategi tetap bisa diisi manual; sebagian field otomatis kalau PDT sudah ada datanya |

**Kenapa perlu ditegaskan:** dulu ada rencana PDT akan "mematikan" Riset
Awal sepenuhnya. Rencana itu **dibatalkan pemilik 2026-09-19** — Riset Awal
sengaja **tetap hidup permanen sebagai jaring pengaman**, bukan tahap
transisi menuju penghapusan. Jadi jangan menunggu PDT "menggantikan" tombol
Riset Awal — itu tidak akan terjadi kecuali ada ketokan pemilik baru.

**Yang benar-benar sudah pensiun (2026-09-21)** hanya dua *tool* HTML
terpisah yang dulu diakses lewat menu "MEA AI Tools": **AM Co-Pilot** (kini
digantikan editor pilar manual di Section E Strategi) dan **AM Baseline /
Video Factory** (tool iframe lama, bukan fitur Riset Awal yang Anda pakai
hari ini — tool itu memang tidak pernah menulis apa pun ke server, jadi
pensiunnya tidak mengurangi apa pun dari alur di bawah). Kalau Anda masih
mencari menunya: sudah tidak ada, dan itu bukan bug — lihat
`docs/DECISIONS.md` entri **PENSIUN-AMTOOLS**.

## Peta alur besar

Dari klien pertama diserahkan Sales sampai pekerjaan mendarat di divisi:

```
Sales closing (CLI-/TRX-/SVC-)
        ↓
Pembayaran pertama masuk → klien rilis ke Account (Anda)
        ↓
1. Riset Awal (fitur Baseline Riset Awal) — wajib, sekali per toko
        ↓
2. Interview Klien                — wawancara, pakai jawaban Riset Awal
        ↓
3. Upload Data Toko (PDT)          — data toko berkala, tiap periode
        ↓
4. Strategi (STRG)                 — Section A–J, sebagian terisi dari
                                      Interview & PDT, Pilar E-3..E-10 manual
        ↓
5. Plan                            — periode kerja, baris per pilar/kanal
        ↓
6. Brief (satu klik, warisi semua) — satu Brief per baris Plan per divisi
        ↓
7. Papan Divisi                    — Creative / Ads / KOL / Live Stream /
                                      AI Optimizer / Store Operation mengerjakan
```

Setiap langkah dijelaskan di bawah: gunanya, di mana letak menunya, dan cara
pakainya.

---

## 0. Klien diterima dari Sales

Ini bukan pekerjaan Account, tapi titik mulainya. Begitu Sales closing dan
pembayaran **pertama** terverifikasi Finance (tidak perlu lunas — sekali
uang masuk sudah cukup), klien otomatis **rilis ke Account** dan muncul di:

- **Account & Service** (`/account`) — kartu **Intake** (untuk SPV/Head
  Account yang menugaskan AM) dan daftar **Service** yang perlu diurus.

SPV/Head Account menugaskan AM pemilik lewat tombol **assign/reassign AM**
di kartu Intake. Sejak saat itu, Service klien berstatus
**`[Awaiting Onboarding]`** dan menunggu langkah 1–6 di bawah.

---

## 1. Riset Awal — fitur *Baseline Riset Awal*

**Gunanya.** Membangun baseline kondisi toko klien (AOV, jumlah SKU, skor
kondisi toko per platform) dari export data yang Anda unggah, **sebelum**
Interview boleh dimulai. Ini bukan bagian dari PDT — mesinnya sendiri
(`baseline.runBaseline()`) dan tabelnya sendiri (`riset_awal_analisa`),
berjalan di server sejak lama, terpisah dari tool AM Baseline yang sudah
pensiun.

**Di mana letaknya.** Tombol **"Mulai Riset & Interview"** di halaman
detail klien (`/clients/{id}`) atau halaman Service
(`/account/services/{id}`). Membuka halaman ini **langsung memulai jangkar
waktu** — tidak ada tombol "mulai" terpisah. Langkah Riset Awal adalah
bagian PERTAMA di halaman itu, sebelum form Interview.

**Cara pakai.**
1. Untuk setiap toko **aktif** milik klien, unggah export platformnya
   (satu atau beberapa berkas export dari Seller Center/Creator Center,
   bukan berkas ZIP PDT). Untuk platform yang belum punya mesin analisa
   otomatis (misalnya Tokopedia), isi **manual** — tetap sah, tidak
   memblokir apa pun.
2. Sistem menghitung baseline dan mengisi sejumlah angka otomatis (usulan).
   **Konfirmasi setiap angka auto-fill** satu per satu.
3. Tekan **submit** untuk langkah Riset Awal ini.

**Gerbang wajib.** Interview **tidak bisa dimulai** sebelum:
- Riset Awal tersubmit, **dan**
- setiap toko aktif klien punya baseline (analisa otomatis **atau**
  manual — dua-duanya sah), **dan**
- setiap angka auto-fill sudah dikonfirmasi.

Kalau salah satu belum terpenuhi, sistem menolak dengan pesan:
`[riset awal belum selesai — setiap platform aktif wajib punya baseline
yang terkonfirmasi dan riset awal disubmit sebelum interview dimulai]`.

**Kalau salah upload.** Ada jalur koreksi — submit ulang membuat baseline
baru yang menggantikan yang lama; baseline lama tidak dihapus, hanya
ditandai "digantikan". Tidak perlu takut sekali salah upload lalu terkunci
selamanya.

---

## 2. Interview Klien

**Gunanya.** Melengkapi hal-hal yang **tidak** bisa dibaca dari data toko —
model bisnis, margin kotor, ruang harga, kesiapan akses, prasyarat klien,
dll — lewat wawancara terstruktur.

**Di mana letaknya.** Halaman yang sama dengan langkah 1
(`/clients/{id}` atau `/account/services/{id}`, tombol **"Mulai Riset &
Interview"**) — begitu Riset Awal tersubmit, form Interview terbuka di
bawahnya.

**Cara pakai.**
1. Isi pertanyaan yang muncul. Field yang sudah bisa dibaca dari Riset Awal
   (misalnya AOV dan jumlah SKU) **sudah otomatis terisi** dan tidak
   ditanyakan ulang — ini datang dari Riset Awal (langkah 1), **bukan** dari
   PDT.
2. Selesaikan interview → sistem menghasilkan **verdict**
   (`growth_ready` / `bersyarat` / `risiko_tinggi` / `tidak_siap`). Verdict
   ini **hanya penanda**, bukan gerbang — Strategi tetap bisa dibuat berapa
   pun verdictnya, sepanjang interview-nya berstatus selesai.

**Siapa yang mengisi.** AM pemilik klien, atau Account lead/SPV/Director.
Sales tidak melihat isian penuhnya, hanya verdict ringkas.

---

## 3. Upload Data Toko (PDT)

**Gunanya.** Berbeda dari Riset Awal di langkah 1 (yang sekali per toko),
ini adalah upload **berulang setiap periode** (biasanya bulanan). Datanya
dipakai ulang oleh Section B Strategi, laporan klien, dan Product Exchange
— jadi berkas yang sama tidak perlu diunggah dua-tiga kali ke tempat
berbeda seperti dulu. Ini juga menggantikan Report Engine TikTok dan Report
Engine Shopee yang lama.

**Di mana letaknya.** Menu **Klien → Upload Data Toko (PDT)**
(`/account/pdt/upload`). Laporan hasilnya ada di **Klien → Laporan PDT**
(`/account/pdt/laporan`).

**Cara pakai (alur upload).**
1. Pilih klien → pilih toko (platform) → pilih periode.
2. Unggah **satu berkas ZIP** berisi seluruh export platform untuk periode
   itu.
3. Sistem mendeteksi modul di dalamnya secara otomatis dan menampilkan tabel
   hasil deteksi (modul apa saja yang terbaca, kolom apa yang dipakai)
   **sebelum** disimpan. Kalau ada yang salah deteksi, Anda bisa
   menimpanya dari dropdown.
4. Sistem mengecek identitas toko (ID Toko/ID Kreator harus cocok dengan
   data toko klien) dan periode. Kalau tidak cocok, batch ditolak dan
   sistem menjelaskan sebabnya.
5. Setelah lolos (status `verified`), sistem menghitung skor per dimensi,
   kuadran SKU, dan mengisi otomatis field Section B Strategi yang memang
   punya sumber di data ini (lihat langkah 4).

**Cara pakai (kirim laporan ke klien).**
1. Buka **Laporan PDT** untuk periode yang sudah `verified`.
2. Cek angkanya (QC) — kalau ada yang perlu dikoreksi, koreksi di sumbernya
   (data toko/benchmark), bukan di tampilan laporan.
3. Tekan **Kirim ke klien** — laporan dibekukan sebagai snapshot. Revisi
   berikutnya jadi laporan baru yang menunjuk laporan lama, **tidak** perlu
   upload ulang berkasnya.

**Catatan.** Batch yang gagal validasi tetap tersimpan berstatus `ditolak`
dengan keterangan penyebabnya — bisa didiagnosis tanpa upload ulang dari
awal. Upload PDT **tidak** memenuhi gerbang Riset Awal di langkah 1 — dua
hal itu tetap terpisah.

---

## 4. Strategi (STRG)

**Gunanya.** Dokumen strategi resmi per klien: konteks bisnis, baseline,
diagnosa, target, dan — bagian yang paling sering dipakai sehari-hari —
**pilar eksekusi** yang nanti diturunkan jadi Plan lalu Brief.

**Di mana letaknya.** Menu **Account & Service** (`/account`) → kartu
Service yang sudah lolos Riset Awal & Interview akan menawarkan tombol
**"Buat Strategi"**. Halamannya `/account/strategi/{id}`.

**Struktur singkatnya (Section A–J) dan asal datanya.**

| Section | Isi | Asal data |
|---|---|---|
| A | Konteks Klien & Bisnis (sekali per Strategi) | Sebagian **otomatis dari Interview** (model bisnis, margin kotor) dengan badge "terisi dari Interview"; posisi harga tetap manual |
| B | Baseline per Channel | **Sebagian** otomatis dari **PDT** (GMV, jumlah pesanan, refund rate, pengunjung, conversion rate, poin penalti kesehatan toko — untuk periode yang Anda upload di langkah 3 dan sudah `verified`); kalau PDT belum punya data periode itu, field ini jatuh balik ke data Riset Awal lama; sisanya tetap manual |
| C | Diagnosa & Akar Masalah | Manual |
| D | Target & KPI | Manual (floor dari kontrak, stretch AM-set) |
| **E** | **Pilar Strategi (E-3…E-10)** | Manual — lihat di bawah |
| F–J | Resource, Kalender, Risiko, Turunan ke Plan, Approval & Versi | Manual |

Perhatikan: **Section B tidak 100% otomatis** — hanya field yang memang
punya sumber fakta di PDT yang terisi otomatis dan read-only (dengan tautan
ke batch sumbernya). Field lain di Section B tetap Anda ketik manual dari
riset/export sesuai kondisi klien.

**Mengisi Section E (pilar) — cara baru sejak AM Co-Pilot pensiun.**
1. Buka kartu **"E-3…E-10 · Pilar Strategi"**.
2. Tekan tombol tambah pilar → **pilih dari katalog 20 aksi** (5 aksi ×
   4 jenis: Video/Konten, Live, Affiliate/KOL, Iklan). Katalog ini murni
   daftar pilihan statis — tidak butuh Riset Awal atau PDT untuk dipilih,
   jadi klien tanpa data lengkap pun tetap bisa diisi pilarnya.
3. Untuk empat jenis pilar yang **tidak ada** di katalog — **SKU, Harga,
   Retensi, Operasional** — ketik manual lewat baris "ketik-tangan" di
   editor yang sama.
4. Kartu ini **opsional**, bukan gerbang lagi — Anda boleh mengajukan
   Strategi dengan pilar kosong kalau memang belum ada yang perlu diisi.
   Tapi ingat: **baris Plan periode 1 disemai otomatis dari pilar** (lihat
   langkah 5) — Strategi tanpa pilar berarti Plan lahir kosong dan Anda
   mengetik baris kerja manual satu-satu.

**Approval.**
`Draft` → **AM mengajukan** → `Diajukan` → **SPV/Head Account menyetujui**
→ `Aktif` (atau **dikembalikan** ke `Draft` dengan catatan wajib). Antrean
persetujuan SPV ada di menu **Persetujuan** (`/persetujuan`). Begitu
`Aktif`, Service otomatis naik ke `[Strategy Approved]` dan gerbang Brief
terbuka.

---

## 5. Plan

**Gunanya.** Memecah Strategi jadi periode kerja bulanan dengan baris kerja
konkret per kanal/pilar — inilah yang nanti diwariskan jadi Brief.

**Di mana letaknya.** Begitu Strategi `Aktif`, periode Plan pertama otomatis
terbentuk. Bukanya lewat kartu Service di `/account` atau langsung
`/account/plan/{id}`.

**Cara pakai.**
1. Periode 1 lahir `Draft`, dengan **baris kerja (Section P-C) tersemai
   otomatis** dari pilar Strategi yang sudah diisi — hanya pilar berjenis
   Konten, Iklan, Affiliate, Live, dan Operasional yang punya divisi
   pemilik jelas sehingga bisa tersemai otomatis; pilar SKU/Harga/Retensi
   perlu Anda pilihkan divisinya manual.
2. Lengkapi tiap baris: kuota/satuan, SKU sasaran, budget (kalau ada),
   channel, dan **Instruksi Brief** (boleh teks bebas atau link, misalnya
   link Google Drive referensi).
3. Tekan **aktifkan periode** — sejak deviasi 2026-08-28, AM bisa
   mengaktifkan periode 1 **langsung**, tanpa menunggu approval SPV.
   (Penyesuaian target turun >10% tetap butuh approval SPV.)

---

## 6. Brief — "satu klik, warisi semua"

**Gunanya.** Meneruskan pekerjaan dari Plan ke divisi eksekusi, tanpa
mengetik ulang apa yang sudah ditulis di baris Plan.

**Di mana letaknya.** Di halaman periode Plan yang `Aktif`
(`/account/plan/{id}`), kartu **"Berikan Brief (satu klik)"**.

**Cara pakai.**
1. Untuk setiap baris Plan yang siap dikerjakan, isi hanya dua kolom:
   **Jatuh Tempo** dan **Prioritas** (Low/Medium/High).
2. Tekan tombol satu klik. Sistem membuat **satu Brief per baris** dan
   mewariskan semuanya secara otomatis: divisi tujuan, jenis
   deliverable, kuota/target, judul, dan instruksi (kanal, pilar, aksi,
   SKU sasaran, budget, prasyarat, Instruksi Brief) — Anda tidak mengetik
   ulang apa pun dari itu.
3. Baris yang **tidak** menghasilkan Brief akan ditandai beserta alasannya,
   misalnya: belum diisi jatuh tempo/prioritas, sudah pernah diwariskan
   (klik ulang aman, tidak dobel), kuota masih 0, atau baris "Di Luar
   Strategi"/"Di Luar Service" yang memang tidak menunjuk layanan mana pun.
4. Brief pertama pada sebuah Service otomatis mendorong Service itu ke
   status **`[Briefed]`**.

**Kalau butuh Brief manual (jalur lama).** Jalur manual dari Strategi lama
(`STR-`) masih hidup untuk kasus tertentu, tapi jalur yang dipakai
sehari-hari sekarang adalah warisan satu-klik dari Plan di atas.

---

## 7. Papan Divisi — pekerjaan diterima

Begitu Brief lahir, ia langsung terlihat di papan divisi tujuan:

| Divisi | Menu | Tahap pertama |
|---|---|---|
| Creative | `/creative` | Cek Brief AM → Script → QC internal → Shooting → Edit → … |
| Ads | `/ads` | (mengikuti status Ad Campaign Setting/Running/Hold/End) |
| KOL | `/kol` | Cek Brief AM → Buat Campaign → Approach Creator → … |
| Live Stream | `/livestream` | Cek Brief AM → Terima Sampel → Briefing Klien Live → Live Start |
| AI Optimizer | `/tasks?division=AI+Optimizer` | Cek Brief AM → Ambil SKU/Script → … |
| Store Operation | `/store-ops` | (pipeline kerja menyusul) |

Brief masuk dengan status **`[To Do]`**. AM tetap jadi pemegang persetujuan
akhir: alur normalnya `[Submitted]` → (lead divisi boleh menahan untuk QC
internal, atau meneruskan) → `[In Review]` → **AM menyetujui** →
`[Approved]`. Revisi diminta lewat `[Revision Requested]`, kembali ke
`[In Progress]`.

---

## Ringkasan menu

| Langkah | Menu | URL |
|---|---|---|
| 0. Intake klien | Account & Service | `/account` |
| 1. Riset Awal | tombol di halaman Klien/Service | `/clients/{id}`, `/account/services/{id}` |
| 2. Interview | (halaman yang sama, lanjutan langkah 1) | `/clients/{id}`, `/account/services/{id}` |
| 3. Upload data toko | Upload Data Toko (PDT) | `/account/pdt/upload` |
| 3. Laporan toko | Laporan PDT | `/account/pdt/laporan` |
| 4. Strategi | (dari kartu Service) | `/account/strategi/{id}` |
| 4. Approval Strategi | Persetujuan | `/persetujuan` |
| 5–6. Plan & Brief | (dari kartu Service) | `/account/plan/{id}` |
| 7. Papan divisi | Creative / Ads / KOL / Live Stream / Store Operation | `/creative`, `/ads`, `/kol`, `/livestream`, `/store-ops` |

## Aturan penting

- **Riset Awal ≠ PDT.** Riset Awal (langkah 1) wajib sekali per toko dan
  menggerbang Interview; PDT (langkah 3) berulang tiap periode dan mengisi
  sebagian Section B Strategi. Upload ke satu sistem **tidak** mengisi
  sistem yang lain.
- **Riset Awal wajib selesai sebelum Interview dimulai** — gerbang server
  keras, bukan bisa dilewati lewat PDT atau cara lain.
- **Riset Awal tetap ada secara permanen** — ketokan pemilik 2026-09-19
  membatalkan rencana lama untuk mematikannya begitu PDT matang; PDT jadi
  sumber utama untuk field yang memang punya datanya, Riset Awal tetap
  jadi jaring pengaman untuk sisanya.
- **AM Co-Pilot dan tool AM Baseline/Video Factory sudah pensiun permanen**
  (2026-09-21) — jangan mencari tombolnya lagi, dan jangan menyimpan
  bookmark lama karena akan menampilkan pesan "sudah tidak dipakai, pilih
  pilar langsung di Section E halaman Strategi". Ini **beda** dari Riset
  Awal di langkah 1, yang tidak terpengaruh keputusan ini.
- **Section E (pilar) sekarang opsional**, tapi mempengaruhi seberapa
  banyak baris Plan yang tersemai otomatis — mengisinya tetap menghemat
  kerja Anda di langkah Plan.
- **Brief yang sudah diwariskan tidak bisa diwariskan dua kali** — klik
  ulang tombol satu-klik itu aman (idempotent), baris yang sudah punya
  Brief otomatis dilewati.
- **Riwayat setiap transisi status tidak bisa dihapus/diedit** — kebijakan
  rumah CDPS di semua modul, bukan cuma di sini.

## Pertanyaan yang mungkin muncul

**Q: Saya sudah upload data toko ke PDT — apakah itu otomatis mengisi
Riset Awal supaya Interview bisa dimulai?**
**Tidak.** PDT dan Riset Awal adalah dua sistem yang berbeda dengan tabel
dan tombol upload masing-masing. Upload ke PDT tidak menyentuh gerbang
Interview sama sekali — Anda tetap harus menyelesaikan Riset Awal lewat
tombol "Mulai Riset & Interview" (langkah 1).

**Q: Kalau begitu, apakah suatu saat tombol Riset Awal akan dihapus dan
digantikan PDT sepenuhnya?**
Berdasarkan keputusan pemilik yang tercatat (2026-09-19), **tidak** —
Riset Awal sengaja dipertahankan permanen sebagai jaring pengaman, bukan
tahap transisi menuju penghapusan. Mengubah ini butuh ketokan pemilik baru.

**Q: Klien saya sudah lama jalan dan tidak punya Riset Awal lengkap — apakah
Strategi-nya terkunci selamanya?**
Section E (pilar) tidak lagi terkunci oleh itu — katalog pilar manual tidak
butuh Riset Awal, jadi Anda tetap bisa mengisi pilar dan mengajukan
Strategi. Tapi Interview tetap butuh Riset Awal selesai lebih dulu — itu
gerbang yang berbeda dan tidak berubah oleh perubahan Section E ini.

**Q: Saya sudah upload data toko di PDT bulan lalu — apakah bulan ini harus
upload ulang semua berkas?**
Tidak. PDT menyimpan riwayat per periode; laporan bulan berjalan membaca
batch terbaru yang `verified`, dan riwayat GMV 6 bulan otomatis dibaca dari
batch-batch sebelumnya.

**Q: Kalau saya salah pilih divisi di baris Plan, apakah Brief-nya bisa
diperbaiki setelah terlanjur diwariskan?**
Perbaiki baris Plan-nya dulu kalau baris itu belum diwariskan. Kalau Brief
sudah terlanjur lahir dengan divisi yang salah, tangani lewat mekanisme
koreksi Brief yang ada di papan divisi/Task Execution — dokumen ini fokus
ke jalur normal Plan→Brief, bukan jalur koreksi.

**Q: Apakah jalur Brief manual (STR-) masih bisa dipakai?**
Untuk kasus tertentu masih tersedia, tapi jalur harian yang dipakai
sekarang adalah warisan satu-klik dari Plan (langkah 6 di atas) — pakai itu
kecuali ada alasan khusus.
