# Tutorial User CDPS — Lanjutan 6 Nov 2026

> Salinan dari bagian yang DITAMBAHKAN ke Google Doc "Tutorial & Changelog CDPS (Agency App) MEA"
> (append, bukan menimpa). Isi ditulis dari kode yang sudah di-merge ke `main`
> (PR #563, #564, #565, #566).

---

## Changelog — Update 6 Nov 2026 (lanjutan)

| PR | Perubahan | Pelapor | Role terdampak | Status |
|---|---|---|---|---|
| #564 | Antrean Intake (Belum Ditugaskan) menampilkan **Layanan Dibeli** (nama layanan + Service ID), bukan hanya angka | Yulianti (Head Account) | SPV/Head Account, OD, Director | Live sejak 6 Nov 2026 |
| #565 | Modul PDT baru **Tokopedia — Analitik Produk (via TikTok Shop)**; berkas "Tokopedia produk" tidak lagi macet di "Perlu Pilih Modul" | Yulianti (Head Account), 29 Okt | AM, Head Account, Ads | Live sejak 6 Nov 2026 |
| #566 | **SPK/Link Kontrak opsional** saat verifikasi payment + penanda **"Belum SPK"** | Jia (Finance), 4 Nov | Finance | Live sejak 6 Nov 2026 |
| #563 | Bridge MSDPS: angka baseline BD tampil read-only di **Terima order** (tambahan status integrasi MSDPS) | Yulianti & Tim OD, 30 Okt | Head Account, Director | Live sejak 6 Nov 2026 (sisi CDPS) |

---

## 1. Antrean Intake: Lihat Layanan yang Dibeli Klien (#564)

**Role:** SPV / Head Account (lead divisi Account), OD (lihat saja), Director.

**Tujuan:** Sebelum menunjuk AM, Head Account bisa langsung melihat layanan apa saja yang dibeli klien — tanpa harus membuka profil klien satu per satu.

**Langkah:**
1. Buka menu **Delivery → Papan Divisi → Account & Service**.
2. Gulir ke bagian **Antrean Intake (Belum Ditugaskan)**. Klien diurutkan dari yang paling lama menunggu.
3. Lihat kolom **Layanan Dibeli**: setiap baris memuat daftar nama layanan, dan di sampingnya Service ID (huruf kecil abu-abu).
4. Bila klien membeli lebih dari satu layanan, di bawah daftar muncul keterangan jumlahnya (mis. "3 layanan").
5. Setelah yakin, klik **Assign AM** di baris klien → pilih AM di panel **Tugaskan AM untuk …** → simpan.

**Field di tabel:** Toko · Kota · Kategori · **Layanan Dibeli** (baru, menggantikan kolom angka "Service") · Dirilis ke Account · tombol Assign AM.

**Tips:**
- Tanda **"—"** di Layanan Dibeli berarti klien belum punya layanan tercatat — cek ke Sales/Finance sebelum menunjuk AM.
- Status layanan tidak ditampilkan di sini karena di tahap ini selalu *Awaiting Onboarding*; jalur Plan/Direct baru ditentukan AM setelah ditugaskan.

**Live sejak 6 Nov 2026.**

---

## 2. PDT: Modul Tokopedia — Analitik Produk (via TikTok Shop) (#565)

**Role:** AM, Head Account, Ads (siapa pun yang mengunggah data toko PDT).

**Tujuan:** Berkas **"[nama bisnis]-Tokopedia produk ….xlsx"** dari ekspor TikTok Shop sekarang dikenali otomatis, sehingga batch tidak lagi macet di status **Perlu Pilih Modul** dan laporan PDT bisa dilanjutkan.

**Langkah:**
1. Buka **Klien → Upload Data Toko (PDT)**.
2. Pilih klien/toko TikTok Shop dan unggah ZIP ekspor seperti biasa (berkas Tokopedia produk boleh ikut di ZIP yang sama).
3. Di tabel pratinjau, cek kolom **Modul Terdeteksi** untuk berkas Tokopedia produk: seharusnya tertulis **Tokopedia — Analitik Produk (via TikTok Shop)**.
4. Bila masih tertulis lain / Perlu Pilih Modul, buka dropdown **Timpa Modul** di baris itu → pilih **Tokopedia — Analitik Produk (via TikTok Shop)**.
5. Lanjutkan ke **Identitas & Periode** dan simpan batch seperti biasa.

**Field penting:** Modul Terdeteksi · Timpa Modul · Status · Kolom Dipanen (untuk modul ini: Produk, GMV tab Toko, GMV dari kartu produk).

**Tips:**
- Modul ini **opsional** — batch tetap sah walau berkas Tokopedia produk tidak diunggah.
- **Penting:** untuk saat ini berkas hanya dikenali, divalidasi, dan disimpan. **Angka per-produk Tokopedia belum muncul di Laporan PDT.** Bagian laporan "Produk Tokopedia" menyusul setelah tim menerima contoh berkas asli; batch lama akan diproses ulang otomatis saat itu.
- Toko yang platform **utamanya** Tokopedia (bukan lewat TikTok Shop) masih belum didukung PDT.

**Live sejak 6 Nov 2026.**

---

## 3. Finance: SPK Opsional saat Verifikasi Payment + Penanda "Belum SPK" (#566)

**Role:** Finance (staff & lead). Director bisa melihat.

**Tujuan:** Finance bisa memverifikasi pembayaran — termasuk sampai status **Lunas** dan merilis klien ke Account — **tanpa menunggu SPK ditandatangani klien**. Transaksi yang belum punya link kontrak diberi penanda **Belum SPK** supaya tidak terlupa.

**Langkah — verifikasi pembayaran:**
1. Buka **Keuangan → Finance** (antrean transaksi).
2. Klik transaksi yang ingin diverifikasi.
3. Di form verifikasi isi: **Termin** (bila ada), **Jumlah Diterima**, **Tanggal Diterima**, **Bukti Pembayaran** (link, opsional).
4. **Link Kontrak SPK/MoU** sekarang **opsional** — isi bila sudah ada, kosongkan bila belum.
5. Klik tombol verifikasi. Verifikasi tetap tersimpan walau link kontrak kosong.

**Langkah — melengkapi SPK menyusul:**
1. Di antrean **Finance**, cari transaksi berlabel kuning **Belum SPK** (transaksi Lunas yang Belum SPK ada di **paling bawah** antrean).
2. Buka transaksinya → tempel link di field **Link Kontrak SPK/MoU**.
3. Klik **Simpan Link Kontrak** (di samping field). Tidak perlu mengulang verifikasi.
4. Muncul pesan **"Link kontrak berhasil disimpan."**; penanda Belum SPK hilang dan, bila sudah Lunas, transaksi keluar dari antrean.

**Field:** Termin · Jumlah Diterima · Tanggal Diterima · Bukti Pembayaran (opsional) · **Link Kontrak SPK/MoU (opsional, bisa dilengkapi menyusul)** · Kontrak (di detail: badge *Belum SPK* atau tautan *Lihat Kontrak*).

**Tips:**
- Status **Lunas** kini berarti "pembayaran lengkap", belum tentu "berkas legal lengkap" — selalu cek badge Belum SPK.
- Pengingat 7 hari kontrak belum diterima tetap berjalan seperti sebelumnya.
- Link kontrak SPK/MoU di **MSDPS Finance** (merchant MEAGO!) adalah fitur terpisah — lihat tutorial MSDPS Finance yang sudah ada; tidak diulang di sini.

**Live sejak 6 Nov 2026.**

---

## 4. Bridge MSDPS: Angka Baseline BD di Terima Order — Status Integrasi (#563)

> Tutorial lengkap cara Terima order sudah ada di bagian **"Bridge Terima Order: Baseline Read-only dari MSDPS (#563, 6 Nov)"**. Bagian ini hanya menambahkan kapan angka muncul dan status pengiriman dari MSDPS.

**Role:** Head Account (lead Account), Director, OD (lihat saja).

**Tujuan:** Memahami kapan angka baseline dari BD muncul di halaman Terima order, dan apa artinya bila masih kosong.

**Langkah:**
1. Buka **Keuangan → Bridge MSDPS (MEAGO!)** → klik order di inbox.
2. Lihat blok **Data baseline dari BD (MSDPS)**: GMV baseline, Target GMV, Link toko, Kategori.
3. Bila angka terisi → cukup cek, lalu klik **Terima order** (atau isi alasan dan Tolak).
4. Bila tertulis **"— (belum diisi BD)"** → order tetap boleh diterima; minta BD melengkapi di MSDPS untuk deal berikutnya.

**Kapan angka muncul:** hanya bila MSDPS mengirim isian `merchant.gmv_baseline`, `merchant.target_gmv`, `merchant.link_toko`, `merchant.kategori` di data order. Kategori kosong ditampilkan sebagai Kategori POI.

**Status 6 Nov 2026:** sisi CDPS sudah siap menerima dan menampilkan. **Pengiriman keempat field dari MSDPS belum terkonfirmasi aktif** (builder payload / flag kirim di MSDPS perlu diperbarui di repo MSDPS; cek ke tim MSDPS) — selama belum aktif, blok baseline akan tampil "— (belum diisi BD)" untuk order baru, dan klien baru tersimpan dengan nilai netral (tercatat di audit). Begitu MSDPS mulai mengirim, angka muncul otomatis tanpa perubahan apa pun di CDPS.

**Tips:** Head Account **tidak perlu** (dan tidak bisa) mengetik ulang baseline di CDPS. Target GMV tetap bisa disesuaikan AM lewat alur penyesuaian target M6 (butuh sign-off Head bila target dari BD 0).

**Live sejak 6 Nov 2026** (sisi CDPS).
