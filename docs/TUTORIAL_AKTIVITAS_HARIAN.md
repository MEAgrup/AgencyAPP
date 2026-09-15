# Tutorial: Aktivitas Harian (fitur baru)

> **Untuk siapa dokumen ini.** Seluruh karyawan pengguna CDPS — Sales, Account,
> Finance, Creative, Ads, KOL, dst — bukan developer. Fitur ini **baru selesai
> dibangun 2026-09-14** sebagai jawaban atas permintaan lapangan dari tim
> Account: *"riwayat aktivitas harian — kegiatan (meeting klien/internal/
> training/webinar/input data), waktu (tanggal & jam), bukti pelaksanaan."*
> (`docs/handoff/HANDOFF_FEEDBACK_LAPANGAN_20260914.md` butir F-6). Siap dipakai
> sekarang — tidak perlu update apa pun di sisi Anda, tinggal login.

## Gunanya

Mencatat **apa yang Anda kerjakan hari ini** — bukan jam masuk/pulang. Jam
masuk-pulang tetap urusan sistem HR seperti biasa; CDPS bukan HRIS. Aktivitas
Harian adalah catatan **keluaran kerja**: meeting apa, training apa, kapan,
dan (kalau ada) bukti pelaksanaannya. Ke depan, catatan ini akan jadi salah
satu bahan skor performa tim (M14 Team Performance) — jadi semakin rutin
dicatat, semakin lengkap gambaran kerja Anda yang terekam di sistem.

## Di mana letaknya

Menu **"Aktivitas Harian"** di sidebar kiri, langsung di bawah **"Tugas
Saya"** — tampil untuk semua orang begitu login, tidak perlu izin khusus.
URL-nya `/aktivitas`.

## Cara pakai

1. Buka menu **Aktivitas Harian**.
2. Di form **"Catat Aktivitas Baru"**, isi:
   - **Jenis Kegiatan** — pilih salah satu dari enam pilihan (lihat tabel di
     bawah).
   - **Tanggal** — default hari ini, bisa diubah kalau mencatat aktivitas
     kemarin yang terlewat.
   - **Jam Mulai** — wajib.
   - **Jam Selesai** — opsional. Kalau diisi, harus lebih besar dari Jam
     Mulai.
   - **Keterangan** — **wajib**. Tulis ringkas apa yang dikerjakan, contoh:
     *"Meeting kick-off campaign Ramadan dengan klien Alpha Digital"*.
   - **Bukti Pelaksanaan** — opsional, berupa **link** (foto, dokumen, atau
     rekaman) — bukan upload file.
3. Tekan **Simpan Aktivitas**.

Baris yang baru saja disimpan langsung muncul di tabel **Riwayat** di bawah
form, terurut dari yang paling baru.

## Enam jenis kegiatan

Pilihannya tertutup (tidak bisa mengetik jenis sendiri) — kalau kegiatan Anda
tidak masuk lima kategori pertama, pilih **Lainnya**:

| Jenis Kegiatan |
|---|
| Meeting Klien |
| Meeting Internal |
| Training |
| Webinar |
| Input Data |
| Lainnya |

## Siapa bisa lihat riwayat siapa

Tabel Riwayat otomatis menyesuaikan dengan peran Anda — tidak ada tombol
filter yang perlu diatur:

| Peran | Yang terlihat |
|---|---|
| Staff | **Hanya riwayat milik sendiri** |
| Lead / SPV | Seluruh riwayat **divisinya** |
| OD / Director | **Seluruh riwayat**, semua divisi |

## Aturan penting

- **Bukan absensi.** Ini tidak menggantikan sistem kehadiran/HR yang ada.
- **Tidak bisa diedit atau dihapus setelah disimpan** — ini kebijakan rumah
  CDPS untuk semua riwayat, bukan bug. Kalau salah catat (misalnya salah
  tanggal atau salah jenis kegiatan), **catat ulang yang benar** — jangan
  khawatir, baris yang salah tidak akan mengurangi nilai apa pun; ia hanya
  akan diabaikan pembaca berikutnya.
- **Keterangan wajib diisi tiap kali.** Kosong akan ditolak sistem.
- Belum ada pengingat otomatis kalau lupa mencatat — jadikan kebiasaan
  harian, misalnya diisi sebelum pulang kerja.

## Pertanyaan yang mungkin muncul

**Q: Saya harus mencatat setiap kegiatan sepanjang hari, atau boleh digabung?**
Boleh digabung per blok kegiatan yang berarti (misalnya satu baris per
meeting), tidak perlu mencatat tiap 5 menit.

**Q: Kalau saya Lead, apakah saya juga mencatat aktivitas saya sendiri di
tempat yang sama?**
Ya — satu halaman untuk semua orang. Lead/SPV mencatat aktivitasnya sendiri
persis seperti staff, dan tambahannya hanya bisa **melihat** riwayat seluruh
divisinya di tabel yang sama.

**Q: Apakah ada notifikasi kalau saya belum mencatat aktivitas hari itu?**
Belum ada di versi ini. Fitur ini murni pencatatan — dorongan/pengingat
otomatis belum dibangun.

**Q: Apakah riwayat ini sudah masuk ke skor performa saya?**
Belum. Saat ini sistem baru **mencatat**; penggabungannya ke skor performa
(M14 Team Performance) adalah pekerjaan lanjutan yang belum dijadwalkan.
