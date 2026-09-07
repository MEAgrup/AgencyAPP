# Keputusan pemilik yang ditunggu — gerbang Gelombang C & D

**Tanggal:** 2026-09-07 · **Diminta oleh:** Nerissa (COO) · **Diketok oleh:** Yohan
(Director), sebagian bersama Finance
**Kenapa dokumen ini ada:** Gelombang B sudah tutup dan uji terimanya lunas
(`UAT_GELOMBANG_B_20260907.md`). Gelombang C dan D **dua-duanya berhenti di meja
pemilik**, bukan di kode. Delapan pertanyaan di bawah adalah seluruh sisanya —
masing-masing dengan fakta yang sudah diverifikasi, opsi, untung-rugi, dan
rekomendasi. Semuanya juga tercatat di `docs/DECISIONS.md` §Open sebagai baris
`E9-RETENSI`, `C-1`, `C-2`, `C-3`, `D-1`…`D-4`.

> **Aturan rumah yang berlaku di sini:** tidak satu pun dari ini boleh ditebak.
> Kalau ditebak, angkanya masuk DB tanpa ada manusia yang pernah menyetujuinya —
> dan untuk empat pertanyaan D, yang masuk DB itu **angka pendapatan**.

---

## 0. Fakta yang sudah diverifikasi (kueri langsung ke DB live, 2026-09-07)

| Yang diukur | Angka live |
|---|---|
| Klien | **10** |
| Layanan (`services`) | **14** |
| Kontrak (`contracts`) | **3** |
| Strategi | **3** |
| Periode Plan | **2** |
| **Laporan klien** (`client_reports`) | **1** |
| `durasi_jasa` MSL terisi | **0 dari 14** layanan (2 dari 96 versi MSL) |

### ⚠️ Satu klaim handoff sebelumnya SALAH SEBAB — dan ini mengubah keputusan

`HANDOFF_GELOMBANG_B_20260906.md` §7 menyebut halaman Showcase akan kosong
karena *"payload laporan pra-R3 beku permanen, tak bisa di-backfill"*.
**Diverifikasi: itu bukan sebabnya.** Payload satu-satunya laporan live
(`CLI-202608-0006`, TikTok Shop, Jul 2026) justru **lengkap** — 21 kunci,
termasuk `insight` (6 kunci), `produk`, `video`, `live`, `afiliasi`, `kpi`,
schema `cdps.report.tiktok.v1`.

Sebab sebenarnya lebih sederhana, dan **tidak bisa diperbaiki dengan kode**:

> **Laporan klien baru ADA SATU di seluruh sistem, dan skornya 4,5 — label
> KRITIS.** Tidak ada "klien terbaik" untuk dipamerkan.

Artinya nilai Gelombang C bergantung pada **berapa laporan klien yang masuk**,
bukan pada masalah teknis apa pun. Itulah kenapa pertanyaan **C-2** di bawah
berbeda dari yang tertulis di handoff.

---

## 1. Gerbang Gelombang C — Showcase Klien Terbaik

### C-3 · Apakah kontrak klien mengizinkan angkanya dipakai di materi pitch, walau sudah dianonimkan?

**Ini yang paling atas.** Kalau jawabannya tidak, dua pertanyaan berikutnya tidak
perlu dijawab — yang perlu berubah adalah **klausul kontrak baru**, bukan
halamannya.

| Opsi | Untung | Rugi |
|---|---|---|
| **(a) Boleh, anonim sudah cukup** | Showcase jalan sekarang dengan klien yang sudah ada | Risiko legal kalau ada klien yang angkanya tetap bisa ditebak (kategori + rentang GMV sering cukup untuk mengenali toko) |
| **(b) Boleh, tapi hanya klien yang tanda tangan izin terpisah** | Aman secara legal, dan izinnya jadi aset | Butuh proses baru: siapa yang minta izin, kapan, disimpan di mana |
| **(c) Belum boleh — masukkan klausulnya ke kontrak baru dulu** | Nol risiko | Showcase baru berisi klien yang closing setelah klausul berlaku ⇒ kosong beberapa bulan |

**Rekomendasi: (b).** (a) menaruh risiko legal di tangan Sales yang tidak
melihatnya, dan (c) menunda nilai berbulan-bulan padahal izin bisa diminta ke
klien yang hasilnya bagus — justru klien yang paling mungkin mau. (b) juga
memberi Sales cerita yang **boleh disebut namanya**, yang jauh lebih kuat
daripada studi kasus anonim.

### C-1 · Sales dibuka aksesnya ke halaman Showcase, atau cukup terima dokumen anonim?

| Opsi | Untung | Rugi |
|---|---|---|
| **(a) Sales/BizDev punya akses baca ke halaman Showcase** | Sales ambil sendiri, nol permintaan ke Account, materi selalu terbaru | Menaruh angka klien nyata di mata divisi yang tidak memilikinya — melawan Role Matrix Fase 0 §4 (*Staff = data sendiri*) yang jadi dasar seluruh permission CDPS |
| **(b) Halaman untuk Account/OD/Director; Sales terima dokumen anonim hasil export** | Batas peran utuh, dan Account tetap jadi penyaring apa yang layak keluar | Satu langkah manual tiap Sales butuh materi (dan Account jadi bottleneck di jam sibuk) |

**Rekomendasi: (b), dengan satu tambahan** — tombol **"Export materi pitch"** di
halaman Showcase yang menghasilkan dokumen anonim siap kirim. Alasannya
hitungan, bukan selera: membuka (a) berarti **satu pengecualian di Role Matrix**,
dan pengecualian pertama adalah yang paling mahal — ia jadi preseden untuk
permintaan berikutnya ("kalau Sales boleh lihat Showcase, kenapa tidak lihat
Health Score?"). Biaya (b) cuma satu klik Account, dan tombol export
menghilangkan bottleneck-nya.

### C-2 · Showcase menampilkan apa selagi laporan baru 1 dan skornya KRITIS?

| Opsi | Untung | Rugi |
|---|---|---|
| **(a) Bangun sekarang; halaman menampilkan kalimat jujur "belum ada klien yang memenuhi ambang"** | Begitu laporan masuk, Showcase langsung berisi tanpa kerja tambahan | Beberapa minggu pertama halamannya kosong — dan halaman kosong sering dibaca tim sebagai "fiturnya rusak" |
| **(b) Tunda sampai ada minimal N laporan ber-skor baik** | Tidak ada halaman kosong; effort dev dipakai untuk hal lain dulu | Butuh pemilik menetapkan **N** dan **ambang skornya** sekarang; dan kalau lupa, fiturnya tidak pernah dibangun |
| **(c) Longgarkan ambangnya — klien terbaik = terbaik dari yang ada, apa pun skornya** | Halaman selalu berisi | **Berbahaya:** materi pitch berisi klien ber-skor KRITIS. Itu bukan showcase, itu bukti sebaliknya |

**Rekomendasi: (b), dengan N = 5 laporan dan ambang skor ≥ 7,0.** (c) gw tidak
sarankan dalam bentuk apa pun — memamerkan klien KRITIS merugikan closing, bukan
membantu. Antara (a) dan (b): angkanya jelas — **1 laporan hari ini**, jadi (a)
berarti membangun halaman yang pasti kosong. Yang lebih mendesak justru **kenapa
baru 1 dari 10 klien punya laporan** — itu masalah operasional (laporan bulanan
belum jadi kebiasaan tim Account), dan tidak ada kode yang menyelesaikannya.

> **Konsekuensi kalau (b) dipilih:** Gelombang C **tidak** dibangun minggu ini.
> Yang dikerjakan sebagai gantinya: menaikkan jumlah laporan klien (operasional,
> bukan dev), lalu C dibangun begitu N tercapai.

---

## 2. Gerbang Gelombang D — laporan keuangan accrual

**Semuanya bersama Finance.** Empat pertanyaan ini menentukan **angka pendapatan**
yang muncul di seluruh laporan CDPS; salah pilih di awal berarti seluruh angka
historis harus dihitung ulang.

### D-4 · Pendapatan diakui bruto atau dipisah PPN?

| Opsi | Untung | Rugi |
|---|---|---|
| **(a) Bruto (termasuk PPN)** | Cocok dengan angka yang tertagih di invoice — tidak ada selisih saat rekonsiliasi bank | Pendapatan terlihat lebih besar dari yang sebenarnya jadi milik perusahaan; margin jadi menyesatkan |
| **(b) Dipisah: pendapatan neto + kolom PPN terpisah** | Angka pendapatan = yang benar-benar milik perusahaan; margin bisa dipercaya | Butuh kolom pajak di skema dan disiplin input; rekonsiliasi ke bank butuh satu langkah tambah |

**Rekomendasi: (b).** PPN bukan pendapatan MEA — ia titipan negara. Laporan yang
mencampur keduanya membuat setiap keputusan berbasis margin salah ±11%, dan itu
persis jenis keputusan yang laporan ini ada untuk mendukung. **Jawab ini
pertama** — tiga pertanyaan D lainnya berdiri di atasnya.

### D-3 · Perlukah kunci tutup buku per bulan?

| Opsi | Untung | Rugi |
|---|---|---|
| **(a) Ya, ada kunci tutup buku** | Angka bulan lalu tidak bisa berubah diam-diam; laporan yang sudah dikirim bisa dipertanggungjawabkan | Butuh peran yang berwenang menutup + jalur koreksi resmi (jurnal koreksi di bulan berjalan, **bukan** mengedit bulan tertutup) |
| **(b) Tidak, angka selalu dihitung ulang dari data terbaru** | Tidak ada proses baru; koreksi otomatis terpantul ke laporan | Laporan yang sama bisa menunjukkan angka berbeda di dua hari berbeda — dan tidak ada yang tahu mana yang dikirim ke klien |

**Rekomendasi: (a).** Ini sejalan dengan aturan rumah CDPS yang sudah berlaku di
seluruh sistem (*riwayat immutable, semua metrik turunan dari log*). Tanpa kunci,
laporan keuangan jadi satu-satunya bagian CDPS yang angkanya bisa berubah tanpa
jejak — dan itu justru bagian yang paling tidak boleh.

### D-2 · Apakah `[On Hold]` menjeda pengakuan pendapatan?

| Opsi | Untung | Rugi |
|---|---|---|
| **(a) Ya, hold menjeda** | Pendapatan hanya diakui saat pekerjaan benar-benar jalan — jujur ke klien dan ke internal | Butuh riwayat hold (tanggal mulai/selesai) yang dibaca mesin laporan; skedul jadi bergeser dan harus dihitung ulang |
| **(b) Tidak, tetap diakui** | Rumus tetap sederhana: kontrak dibagi rata sepanjang periodenya | Klien yang di-hold dua bulan tetap "menghasilkan pendapatan" — dan itu tidak benar |

**Rekomendasi: (a).** Tapi ini menuntut satu hal dari operasional: `[On Hold]`
harus **selalu** diinput saat kejadian, bukan diingat belakangan. Kalau tim
Account belum disiplin di situ, (a) menghasilkan angka yang salah dengan cara
yang lebih sulit dilacak daripada (b).

### D-1 · Layanan di-void di tengah periode: porsinya dibagikan ulang, atau hangus?

| Opsi | Untung | Rugi |
|---|---|---|
| **(a) Hangus — diakui hanya untuk hari yang sudah jalan** | Paling jujur; cocok dengan D-2 opsi (a) | Pendapatan bulan itu turun, dan target tim ikut kena |
| **(b) Dibagikan ulang ke periode berikutnya** | Total pendapatan kontrak tetap utuh | Mengakui pendapatan untuk pekerjaan yang tidak pernah dilakukan — hanya benar kalau layanannya benar-benar diganti, bukan dibatalkan |
| **(c) Diakui penuh karena kontraknya sudah tertagih** | Sesuai kas masuk | Melawan prinsip accrual yang jadi alasan Gelombang D ada |

**Rekomendasi: (a), dengan satu pengecualian tertulis:** kalau layanan di-void
**dan diganti** layanan lain di kontrak yang sama, sisanya dipindahkan ke
layanan pengganti (bukan hangus, bukan dibagi rata). Pengecualian itu harus
disebut eksplisit di aturannya, bukan diserahkan ke penilaian per kasus — kalau
tidak, ia jadi celah yang dipakai untuk menambal target bulan yang jelek.

---

## 3. Sisa satu: pilar `retensi`

### E9-RETENSI · Divisi pemilik pilar `retensi` (E-9: follow-up chat, WhatsApp broadcast / Sebari)

Pemilik sudah menetapkan pemilik untuk `sku` dan `harga` (AI Optimizer atau
Store Operation, AM memilih), **belum** untuk `retensi`. Hari ini `retensi` ikut
masuk daftar "menunggu pilihan AM" yang sama — bukan karena diputuskan begitu,
tapi karena menebaknya melanggar keputusan yang sama.

| Opsi | Untung | Rugi |
|---|---|---|
| **(a) Ikut pola `sku`/`harga` — AM memilih** | Nol perubahan kode; sudah berjalan | Setiap pilar retensi butuh satu klik AM, selamanya |
| **(b) Satu divisi tetap** (mis. Account atau Socmed) | Baris `retensi` bisa disemai otomatis seperti lima pilar lain | Salah pilih = baris kerja masuk ke divisi yang tidak mengerjakannya |
| **(c) `retensi` bukan pekerjaan CDPS** — dikerjakan di Sebari, tidak jadi baris Plan | Batas sistem jadi jelas | Pekerjaan retensi jadi tidak terukur di CDPS, dan kontribusinya ke GMV tidak terlihat |

**Rekomendasi: (a), biarkan seperti sekarang.** Ini satu-satunya dari delapan
pertanyaan yang **tidak memblokir apa pun** — jalur (a) sudah jalan dan tidak
salah. Ketok (b) hanya kalau ternyata pilar `retensi` sering dipakai dan satu
klik AM itu terasa; sampai itu terbukti, mengubahnya adalah menebak.

---

## 4. Ringkasan — apa yang gw butuh diketok

| # | Pertanyaan | Rekomendasi | Memblokir |
|---|---|---|---|
| **C-3** | Kontrak mengizinkan angka dipakai di pitch? | (b) izin terpisah per klien | Gelombang C — **paling atas** |
| **C-1** | Sales akses Showcase? | (b) dokumen anonim + tombol export | Gelombang C |
| **C-2** | Showcase dibangun sekarang? | (b) tunda; N = 5 laporan, skor ≥ 7,0 | Gelombang C |
| **D-4** | Bruto atau pisah PPN? | (b) pisah PPN | Gelombang D — **jawab pertama** |
| **D-3** | Kunci tutup buku? | (a) ya | Gelombang D |
| **D-2** | `[On Hold]` menjeda pendapatan? | (a) ya | Gelombang D |
| **D-1** | Layanan di-void: hangus? | (a) hangus, kecuali diganti | Gelombang D |
| **E9-RETENSI** | Divisi pilar `retensi`? | (a) biarkan AM memilih | **tidak memblokir** |

**Yang gw sarankan dikerjakan sambil menunggu ketokan** (tidak butuh keputusan
siapa pun):

1. **Isi `durasi_jasa` di MSL** — 0 dari 14 layanan terisi. Tanpa ini Gelombang D
   menghasilkan skedul pendapatan kosong untuk **semua** layanan, apa pun jawaban
   D-1…D-4. Ini pekerjaan admin, bukan dev.
2. **Naikkan jumlah laporan klien** — 1 dari 10 klien. Ini yang menentukan apakah
   Showcase (C) punya isi, dan tidak ada kode yang bisa menggantikannya.

Keduanya bikin C dan D **langsung berguna** begitu diketok, alih-alih menghasilkan
halaman jujur-tapi-kosong.
