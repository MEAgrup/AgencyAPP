# Tutorial: Alur Kelola Klien — PDT, Strategi (STRG), Plan & Brief

> **Untuk siapa dokumen ini.** Account Manager (AM) dan SPV/Head of Account —
> alur ini adalah pekerjaan inti divisi **Account** sejak klien diserahkan
> Sales sampai pekerjaan sampai ke meja divisi eksekusi (Creative, Ads, KOL,
> Live Stream, AI Optimizer, Store Operation). Bukan untuk developer.
>
> **Perubahan penting (2026-09-21).** **AM Co-Pilot** dan **AM Baseline**
> (dua tool HTML terpisah yang dulu diakses lewat menu *"MEA AI Tools"*)
> **sudah dipensiunkan** — tombolnya dicabut dan tidak akan muncul lagi.
> Fungsinya sekarang dipegang dua hal:
> - **PDT (Pusat Data Toko)** — tempat AM mengunggah data toko. Satu upload
>   per toko per periode, dipakai ulang oleh Riset Awal, Strategi, Plan,
>   Brief, laporan klien, dan Product Exchange sekaligus. Ini juga
>   menggantikan Report Engine TikTok dan Report Engine Shopee yang lama.
> - **Editor Pilar manual** di Section E halaman Strategi — AM memilih
>   sendiri dari katalog 20 aksi (atau mengetik manual untuk empat jenis
>   yang tidak ada di katalog), tanpa perlu Riset Awal lebih dulu seperti
>   yang dituntut AM Co-Pilot dulu.
>
> Kalau Anda masih mencari menu AM Co-Pilot / AM Baseline / Video Factory:
> menu itu memang sudah tidak ada. Ini bukan bug — lihat `docs/DECISIONS.md`
> entri **PENSIUN-AMTOOLS** (2026-09-21) kalau ingin tahu alasannya.

## Peta alur besar

Dari klien pertama diserahkan Sales sampai pekerjaan mendarat di divisi,
urutannya begini:

```
Sales closing (CLI-/TRX-/SVC-)
        ↓
Pembayaran pertama masuk → klien rilis ke Account (Anda)
        ↓
1. Upload Data Toko (PDT)         — data mentah toko
        ↓
2. Riset & Interview Klien         — Riset Awal (dari PDT) + wawancara
        ↓
3. Strategi (STRG)                 — Section A–J, termasuk Pilar E-3..E-10
        ↓
4. Plan                            — periode kerja, baris per pilar/kanal
        ↓
5. Brief (satu klik, warisi semua) — satu Brief per baris Plan per divisi
        ↓
6. Papan Divisi                    — Creative / Ads / KOL / Live Stream /
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
**`[Awaiting Onboarding]`** dan menunggu langkah 1–5 di bawah.

---

## 1. Upload Data Toko (PDT)

**Gunanya.** Satu tempat AM mengunggah export data toko (Shopee, TikTok
Shop, Meta Ads, dll) **satu kali per toko per periode**. Data ini otomatis
dipakai ulang oleh Riset Awal, Section B Strategi, Plan, laporan klien, dan
Product Exchange — tidak perlu upload berkas yang sama berkali-kali seperti
dulu.

**Di mana letaknya.** Menu **Klien → Upload Data Toko (PDT)**
(`/account/pdt/upload`). Laporan hasilnya ada di **Klien → Laporan PDT**
(`/account/pdt/laporan`).

**Cara pakai (alur upload).**
1. Pilih klien → pilih toko (platform) → pilih periode.
2. Unggah **satu berkas ZIP** berisi seluruh export platform untuk periode
   itu — bukan berkas satu-satu lagi.
3. Sistem mendeteksi modul di dalamnya secara otomatis dan menampilkan tabel
   hasil deteksi (modul apa saja yang terbaca, kolom apa yang dipakai)
   **sebelum** disimpan. Kalau ada yang salah deteksi, Anda bisa
   menimpanya dari dropdown.
4. Sistem mengecek identitas toko (ID Toko/ID Kreator harus cocok dengan
   data toko klien) dan periode. Kalau tidak cocok, batch ditolak dan
   sistem menjelaskan sebabnya.
5. Setelah lolos, sistem menghitung ulang skor per dimensi, kuadran SKU, dan
   mengisi otomatis form-form hilir (Riset Awal, Section B Strategi, dst).

**Cara pakai (kirim laporan ke klien).**
1. Buka **Laporan PDT** untuk periode yang sudah `verified`.
2. Cek angkanya (QC) — kalau ada yang perlu dikoreksi, koreksi di sumbernya
   (data toko/benchmark), bukan di tampilan laporan.
3. Tekan **Kirim ke klien** — laporan dibekukan sebagai snapshot. Revisi
   berikutnya jadi laporan baru yang menunjuk laporan lama, **tidak** perlu
   upload ulang berkasnya.

**Catatan.** Batch yang gagal validasi tetap tersimpan berstatus `ditolak`
dengan keterangan penyebabnya — bisa didiagnosis tanpa upload ulang dari
awal.

---

## 2. Riset & Interview Klien

**Gunanya.** Dua langkah yang harus selesai sebelum Strategi bisa dibuat:
Riset Awal (baca data dari PDT) dan Interview (wawancara hal yang belum
terjawab data).

**Di mana letaknya.** Tombol **"Mulai Riset & Interview"** di halaman detail
klien (`/clients/{id}`) atau halaman Service (`/account/services/{id}`).
Membuka halaman ini **langsung memulai jangkar waktu** — tidak ada tombol
"mulai" terpisah.

**Cara pakai.**
1. **Riset Awal** — pastikan setiap toko **aktif** milik klien sudah punya
   baseline dari PDT (langkah 1 di atas; platform yang belum punya mesin
   analisa otomatis, misalnya Tokopedia, tetap bisa diisi manual). Konfirmasi
   setiap angka auto-fill, lalu submit langkah ini.
   - **Gerbang wajib:** Interview **tidak bisa dimulai** sebelum Riset Awal
     tersubmit dan setiap platform aktif punya baseline terkonfirmasi.
     Pesannya kalau gagal: `[riset awal belum selesai — setiap platform
     aktif wajib punya baseline yang terkonfirmasi dan riset awal disubmit
     sebelum interview dimulai]`.
2. **Interview** — isi hanya pertanyaan yang **belum** terjawab data (model
   bisnis, margin kotor, ruang harga, kesiapan akses, prasyarat klien, dll).
   Field yang sudah terisi dari Riset Awal (mis. AOV, jumlah SKU) tidak
   ditanyakan ulang.
3. Selesaikan interview → sistem menghasilkan **verdict** (`growth_ready` /
   `bersyarat` / `risiko_tinggi` / `tidak_siap`). Verdict ini **hanya
   penanda**, bukan gerbang — Strategi tetap bisa dibuat berapa pun
   verdictnya, sepanjang interview-nya sudah selesai.

**Siapa yang mengisi.** AM pemilik klien, atau Account lead/SPV/Director.
Sales tidak melihat isian penuhnya, hanya verdict ringkas.

---

## 3. Strategi (STRG)

**Gunanya.** Dokumen strategi resmi per klien: konteks bisnis, baseline,
diagnosa, target, dan — bagian yang paling sering dipakai sehari-hari —
**pilar eksekusi** yang nanti diturunkan jadi Plan lalu Brief.

**Di mana letaknya.** Menu **Account & Service** (`/account`) → kartu
Service yang sudah lolos Riset & Interview akan menawarkan tombol
**"Buat Strategi"**. Halamannya `/account/strategi/{id}`.

**Struktur singkatnya (Section A–J).**

| Section | Isi |
|---|---|
| A | Konteks Klien & Bisnis (sekali per Strategi) — sebagian **otomatis terisi dari Interview** (model bisnis, margin kotor) dengan badge "terisi dari Interview"; posisi harga tetap diisi manual |
| B | Baseline per Channel — terisi dari PDT, bukan diketik ulang |
| C | Diagnosa & Akar Masalah |
| D | Target & KPI |
| **E** | **Pilar Strategi (E-3…E-10)** — lihat di bawah |
| F–J | Resource, Kalender, Risiko, Turunan ke Plan, Approval & Versi |

**Mengisi Section E (pilar) — cara baru sejak AM Co-Pilot pensiun.**
1. Buka kartu **"E-3…E-10 · Pilar Strategi"**.
2. Tekan tombol tambah pilar → **pilih dari katalog 20 aksi** (5 aksi ×
   4 jenis: Video/Konten, Live, Affiliate/KOL, Iklan). Katalog ini murni
   daftar pilihan statis — tidak butuh Riset Awal seperti AM Co-Pilot dulu,
   jadi klien **tanpa** Riset Awal lengkap pun tetap bisa diisi pilarnya.
3. Untuk empat jenis pilar yang **tidak ada** di katalog — **SKU, Harga,
   Retensi, Operasional** — ketik manual lewat baris "ketik-tangan" di
   editor yang sama.
4. Kartu ini **opsional**, bukan gerbang lagi — Anda boleh mengajukan
   Strategi dengan pilar kosong kalau memang belum ada yang perlu diisi.
   Tapi ingat: **baris Plan periode 1 disemai otomatis dari pilar** (lihat
   langkah 4) — Strategi tanpa pilar berarti Plan lahir kosong dan Anda
   mengetik baris kerja manual satu-satu.

**Approval.**
`Draft` → **AM mengajukan** → `Diajukan` → **SPV/Head Account menyetujui**
→ `Aktif` (atau **dikembalikan** ke `Draft` dengan catatan wajib). Antrean
persetujuan SPV ada di menu **Persetujuan** (`/persetujuan`). Begitu
`Aktif`, Service otomatis naik ke `[Strategy Approved]` dan gerbang Brief
terbuka.

---

## 4. Plan

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

## 5. Brief — "satu klik, warisi semua"

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

## 6. Papan Divisi — pekerjaan diterima

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
| 1. Upload data toko | Upload Data Toko (PDT) | `/account/pdt/upload` |
| 1. Laporan toko | Laporan PDT | `/account/pdt/laporan` |
| 2. Riset & Interview | tombol di halaman Klien/Service | `/clients/{id}`, `/account/services/{id}` |
| 3. Strategi | (dari kartu Service) | `/account/strategi/{id}` |
| 3. Approval Strategi | Persetujuan | `/persetujuan` |
| 4–5. Plan & Brief | (dari kartu Service) | `/account/plan/{id}` |
| 6. Papan divisi | Creative / Ads / KOL / Live Stream / Store Operation | `/creative`, `/ads`, `/kol`, `/livestream`, `/store-ops` |

## Aturan penting

- **AM Co-Pilot dan AM Baseline sudah pensiun permanen** (2026-09-21) —
  jangan mencari tombolnya lagi, dan jangan menyimpan bookmark lama karena
  akan menampilkan pesan "sudah tidak dipakai, pilih pilar langsung di
  Section E halaman Strategi".
- **Riset Awal wajib selesai sebelum Interview dimulai** — bukan bisa
  dilewati, ini gerbang server.
- **Section E (pilar) sekarang opsional**, tapi mempengaruhi seberapa
  banyak baris Plan yang tersemai otomatis — mengisinya tetap menghemat
  kerja Anda di langkah Plan.
- **Brief yang sudah diwariskan tidak bisa diwariskan dua kali** — klik
  ulang tombol satu-klik itu aman (idempotent), baris yang sudah punya
  Brief otomatis dilewati.
- **Riwayat setiap transisi status tidak bisa dihapus/diedit** — kebijakan
  rumah CDPS di semua modul, bukan cuma di sini.

## Pertanyaan yang mungkin muncul

**Q: Klien saya sudah lama jalan dan tidak punya Riset Awal lengkap — apakah
Strategi-nya terkunci selamanya?**
Tidak lagi. Sejak Section E jadi opsional dan katalog pilar manual tidak
butuh Riset Awal, Anda tetap bisa mengisi pilar dan mengajukan Strategi
walau Riset Awal-nya tipis. (Interview tetap butuh Riset Awal selesai
lebih dulu — itu gerbang yang berbeda dan belum berubah.)

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
sekarang adalah warisan satu-klik dari Plan (langkah 5 di atas) — pakai itu
kecuali ada alasan khusus.
