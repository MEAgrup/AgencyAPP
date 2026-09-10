# UAT peramban — enam butir feedback tim Sales (2026-09-10)

Menjalankan `TUTORIAL_UAT_M19_SALES_DRIFT_20260909.md` §2. **Utang B2 atas enam
butir feedback Sales lunas** — termasuk FS-6b (tenor sampai ke deal), yang sejak
mendarat hanya pernah dibuktikan lewat tes, tidak pernah lewat layar.

| | |
|---|---|
| Commit | `befb330` (branch `claude/dreamy-noether-ur790j`) |
| DB | lokal, lanjutan sesi UAT M19 (gate 155 · 43 · 34 · 73) |
| Aktor | EMP-0001 Sales staff · EMP-0006 **Head Sales** · EMP-0008 Director · EMP-0012 OD murni |
| Server | `apps/api` :3001 + `web-internal` :3000 |
| Tangkapan layar | `screenshots/uat-sales-*.png` |

## 1 · Hasil

**Putaran kedua (2026-09-10, sesudah semua perbaikan): 33 butir · 33 PASS ·
0 FAIL.** Naik dari 24 butir karena tiga butir yang dulu tidak bisa dibuktikan
kini punya fixture-nya (§4).

_Putaran pertama: 24 butir · 23 PASS · 1 FAIL._ Keenam butir feedback Sales
terbukti bekerja di layar; satu FAIL bukan bagian dari keenam butir itu — ia
observasi baru yang ditemukan sambil jalan (§3), dan kini sudah diperbaiki.

| Butir | Layar | Peran | Hasil |
|---|---|---|---|
| **#1** WhatsApp | `/sales` | Head Sales | ✅ tombol ada, `phone=62812743285000`, sapaan ter-encode |
| **#2** Owner tampil nama | `/sales` | **Head Sales** | ✅ **"Budi Santoso"**, bukan `EMP-0001` |
| **#2** gerbangnya | `/sales` | Sales staff | ✅ kolom Owner **tidak** tampil (level lead/od/director) |
| **#3** prospek bersama | `/sales/{id}` | Sales staff + Head Sales | ✅ **kedua sisi** — penanda tampil di kedua baris bertaut, menyebut nama rekannya (§4) |
| **#4** `bayar_komisi` | `/clients/{id}` | Sales staff | ✅ opsi `["Perpanjangan","Cross Sell","Bayar Komisi"]` |
| **#5** durasi di daftar | `/clients` | Sales staff | ✅ "6 bulan · 112 hari lagi", **dan** "Layanan tidak ada durasi" untuk klien tanpa kontrak (§4) |
| **#5** panel Kontrak | `/clients/{id}` | Sales staff | ✅ **nol galat di panel itu**, `CTR-202609-0001 · Baru · 6 bulan · 01 Jul 2026 → 31 Des 2026` |
| **#6** editor opsi durasi | `/master-services` | Sales Head | ✅ dua tenor tersimpan, tampil `1 / 6 bulan` di katalog |
| **#6/FS-6b** kalkulator | `/sales/kalkulator` | Sales staff | ✅ lihat §2 |
| **#6/FS-6b** Form Qualified | `/sales/{id}` | Sales staff | ✅ tenor `6` terbaca lagi DAN jadi nilai awal pemilih tenor di editor proposal (§4) |

### #2 adalah bukti utama, dan ia diuji dengan peran yang benar

Kolom Owner berisi **"Budi Santoso"**. Ini satu-satunya butir yang gejalanya
hanya muncul pada satu peran: OD dan Director lolos `jwt_can_read_all()` dan
tidak pernah melihatnya. Diuji sebagai **Head Sales**, sesuai yang diminta
handoff.
→ `screenshots/uat-sales-01-owner-nama.png`

## 2 · FS-6b — tenor benar-benar sampai ke harga

Ini yang paling layak dicatat, karena inilah keluhan aslinya ("supaya list tidak
terlalu banyak") dan ia menyentuh jalur uang.

Satu layanan `UAT Paket Tenor` dibuat lewat layar sebagai Sales Head dengan dua
tenor berharga **berbeda** — 1 bulan Rp 3.000.000 dan 6 bulan Rp 15.000.000
(paket utuh, bukan per bulan, jadi diskon paket bisa dinyatakan sama sekali).
Lalu di kalkulator sebagai Sales staff:

```
dropdown Durasi : ["1 bulan — Rp. 3.000.000,00", "6 bulan — Rp. 15.000.000,00"]
pilih 6 bulan   : kolom Harga  Rp. 3.000.000,00 → Rp. 15.000.000,00
                  Ringkasan    ikut berubah
```

Harga **paket utuh** tenor terpilih yang dipakai, bukan `standard_price` versi.
Inilah yang tidak ada sebelum FS-6b, dan yang membuat tim Sales terpaksa memakai
sembilan layanan terpecah.
→ `screenshots/uat-sales-02-kalkulator-tenor.png`

## 3 · ✅ OBS-1 (SUDAH DIPERBAIKI 2026-09-10) — Client Record memunculkan tiga pita galat MERAH pada halaman yang boleh dibuka

> **STATUS: DIPERBAIKI & DIVERIFIKASI.** Nol pita untuk keempat peran, dan
> ketiga panel TETAP tampil bagi yang berhak. Rinciannya §3a.
> → `screenshots/uat-sales-04-client-record-sesudah-perbaikan.png`

**Bukan bagian dari keenam butir**, ditemukan sambil menguji #5.

Sales staff **pemilik klien** membuka `/clients/CLI-202609-0001` dan mendapat
tiga pita merah, padahal tidak ada yang salah dan panel yang jadi haknya
(Kontrak, Perpanjangan) berfungsi penuh:

```
[anda tidak memiliki akses ke data ini]
[Anda tidak berhak mengakses laporan klien ini]      ← report.ts MSG_FORBIDDEN
[anda tidak memiliki akses untuk melakukan transisi ini]
```

Diukur per peran:

| Aktor | jumlah pita merah |
|---|---|
| Sales staff (pemilik klien) | **3** |
| Head Sales | **3** |
| Director | 0 |
| OD murni | 0 |

**Ini cacat presentasi, bukan cacat izin.** Gerbangnya BENAR — laporan klien dan
transisi Service memang milik Account/AM, dan Sales memang tidak berhak. Yang
salah adalah panel yang bukan haknya menyatakan itu sebagai **galat merah**
alih-alih menyembunyikan diri atau berkata "panel ini untuk Account Manager".
Akibatnya setiap Sales yang membuka klien miliknya sendiri melihat layar yang
tampak rusak.

Sumber yang sudah dipastikan: `ReportPanel` (`report.ts` `MSG_FORBIDDEN`). Dua
sisanya pemuatan tingkat halaman di `clients/[id]/page.tsx` — belum dipisahkan
satu per satu, dan itu jujur ditulis di sini alih-alih ditebak.

⚠️ **Pola ketiganya sama dengan `M19-NAMA-RLS` dan dengan feedback Sales `#2`
sendiri: tak terlihat oleh Director/OD.** Tiga kali dalam satu sesi UAT. Setiap
verifikasi yang hanya memakai Director akan melaporkan "bersih".
→ `screenshots/uat-sales-03-client-record-pita-galat.png`

### 3a · Perbaikan yang mendarat (2026-09-10)

Tiga panel yang 403 saat MEMUAT kini menyembunyikan diri alih-alih berteriak
merah, lewat satu penolong bersama `isForbidden(err)` di `lib/api.ts`
(`ApiError.status === 403`):

| Panel | Endpoint yang 403 | Perilaku baru |
|---|---|---|
| Unified Board | `GET /board?client=…` | `return null` |
| Laporan Performa | `GET /clients/{id}/reports` | `return null` |
| Upcoming Milestones | `GET /clients/{id}/milestones` | `return null` |

**Batas yang dijaga dengan sengaja, dan ini bagian terpenting dari perbaikannya:
HANYA 403, dan HANYA saat memuat.**

- **Status lain tetap terlihat.** 500 atau kegagalan jaringan yang
  disembunyikan akan mengubah KERUSAKAN menjadi "datanya memang tidak ada" —
  persis kelas cacat termahal di repo ini. Satu tes memaku 0/400/401/404/409/
  422/500/502/503 semuanya `false`.
- **403 atas sebuah AKSI tetap merah.** Di situ pengguna menekan sesuatu dan
  berhak tahu kenapa ditolak (aturan rumah #5 — pesan BI `[...]` verbatim).

Diukur ulang sesudah perbaikan, dan yang diperiksa BUKAN cuma "nol pita"
melainkan juga bahwa panelnya tidak ikut hilang bagi yang berhak:

| Aktor | pita merah | board | laporan | milestones | kontrak |
|---|---|---|---|---|---|
| Sales staff (pemilik) | **0** | — | — | — | ✅ |
| Head Sales | **0** | — | — | — | ✅ |
| Director | **0** | ✅ | ✅ | ✅ | ✅ |
| OD murni | **0** | ✅ | ✅ | ✅ | ✅ |

Empat tes di `web-internal/src/lib/api.test.ts` (berkas baru).

## 4 · ✅ Tiga butir yang dulu TIDAK bisa dibuktikan — kini SUDAH, dan lulus

> **STATUS 2026-09-10 (putaran kedua): ketiganya DIUJI dan PASS.** Yang
> memblokirnya bukan aplikasinya melainkan **fixture**, dan fixture itu sudah
> diperbaiki (§5a). UAT Sales naik **24 → 33 butir, 33 PASS**.

| Butir | Yang sekarang terbukti |
|---|---|
| **#3** prospek bersama, sisi POSITIF | Penanda **"Prospek Bersama" tampil di KEDUA baris** yang bertaut, dan menyebut **nama** rekannya — `Dewi Anggraini` di baris Budi, `Budi Santoso` di baris Dewi. Sisi negatifnya (nol rekan ⇒ nol penanda) tetap diuji. |
| **#5** cabang FS-5b tanpa kontrak | Klien yang hanya membeli layanan sekali jadi menampilkan **"Layanan tidak ada durasi"** — teks eksplisit, bukan sel kosong. |
| **#6/FS-6b** tenor di Form Qualified | Tenor `6` **terbaca lagi** di layar attempt Qualified, editor proposalnya punya pemilih tenor (`1 bulan`/`6 bulan`), dan **nilai awalnya `6`** — tenor pilihan klien benar-benar terbawa dari Form Qualified ke editor negosiasi. |

Teks di bawah ini adalah catatan aslinya, ditinggalkan sebagai jejak KENAPA
ketiganya sempat tidak teruji.

### 4a · (catatan asli) Yang TIDAK bisa dibuktikan, dan kenapa

**#3 prospek bersama — hanya sisi negatifnya.** Attempt fixture
(`PRSP-202609-0001`) tidak punya rekan, jadi yang terbukti adalah penanda
"Prospek Bersama" **tidak** muncul saat memang tidak ada rekan. Sisi positifnya
— dua sales mengejar lead yang sama, penanda muncul di **kedua** baris — butuh
attempt kedua pada lead yang sama, dan `seed-browser-tour.ts` tidak membuatnya.
Menambahkannya ke fixture adalah pekerjaan kecil dan layak dilakukan sebelum
UAT berikutnya.

**#5 cabang "tidak ada kontrak" (FS-5b)** — teks eksplisit untuk klien tanpa
kontrak tidak bisa dilihat: DB lokal hanya punya SATU klien, dan ia punya
kontrak. Butuh klien kedua tanpa layanan berdurasi.

**#6/FS-6b sisi Form Qualified** — attempt fixture sudah `Closed-Success`, jadi
form-nya tidak lagi bisa disunting. Jalur kalkulator (§2) membuktikan mekanisme
tenor→harga yang sama; yang belum terbukti khusus adalah tenor **terkirim lalu
terbaca lagi** di tabel snapshot Form Qualified. Butuh attempt baru sampai tahap
Qualified.

## 5 · Catatan penyiapan data yang WAJIB diketahui sesi berikutnya

`seed-browser-tour.ts` memakai aktor sintetis **`B2TOUR-BUDI`**, dan itu
**bukan baris `employees`**. Akibatnya, sebelum diperbaiki:

- **#2 gagal palsu** — `owner_employee_id` yang bukan karyawan tidak punya nama
  untuk di-resolve, jadi kolom Owner akan menampilkan `B2TOUR-BUDI` dan terlihat
  seperti bug `#2` yang belum diperbaiki;
- **#5 gagal palsu** — `clients.sales_pic_id` yang bukan karyawan berarti TIDAK
  ADA aktor yang bisa memenuhi lengan `private.jwt_owns_client`, jadi Sales staff
  mana pun kena 403 dan itu terbaca seperti FS-5 yang tidak bekerja.

Yang dilakukan: kepemilikan fixture dipindahkan ke `EMP-0001` (`leads.created_by`,
`prospect_attempts.owner_employee_id`/`created_by`, `clients.sales_pic_id`/
`commission_payment_pic_id`/`created_by`, `transactions.created_by`,
`services.created_by`). Ini **bukan** melonggarkan gerbang — justru membuatnya
dievaluasi sungguhan, karena aktornya kini pemilik yang sah.

```sql
update leads             set created_by = 'EMP-0001' where created_by = 'B2TOUR-BUDI';
update prospect_attempts set owner_employee_id = 'EMP-0001', created_by = 'EMP-0001'
                             where owner_employee_id = 'B2TOUR-BUDI';
update clients           set sales_pic_id = 'EMP-0001', commission_payment_pic_id = 'EMP-0001',
                             created_by = 'EMP-0001' where sales_pic_id = 'B2TOUR-BUDI';
update transactions      set created_by = 'EMP-0001' where created_by = 'B2TOUR-BUDI';
update services          set created_by = 'EMP-0001' where created_by = 'B2TOUR-BUDI';
```

**Perbaikan yang lebih baik:** ajari `seed-browser-tour.ts` memakai `EMP-0001`
sejak awal. Selama ia memakai aktor non-karyawan, setiap UAT Sales berikutnya
akan mengulang dua kegagalan palsu di atas.

### 5a · ✅ SUDAH DIKERJAKAN (2026-09-10) — fixture-nya sendiri yang diperbaiki

`seed-browser-tour.ts` kini memakai **karyawan sungguhan**: `EMP-0001` (Budi,
Sales staff), `EMP-0006` (Dewi, Sales Head) sebagai admin katalog. **Nol UPDATE
manual** lagi sesudah menjalankannya — `clients.sales_pic_id` langsung `EMP-0001`.

Dan tiga fixture ditambahkan, tepat untuk membuka §4:

| Fixture | Membuka |
|---|---|
| Lead kedua didaftarkan **dua sales** (Budi lalu Dewi, nomor sama) — sengaja **tidak ditutup** | `#3` sisi positif. Prospek bersama lahir sendiri lewat `leads.register` outcome `join`; menutupnya justru menghapus yang mau dilihat |
| Klien kedua dari layanan **tanpa `durasi_bulan`** ⇒ nol kontrak | cabang FS-5b "Layanan tidak ada durasi" |
| Attempt ketiga ditinggal **DI tahap Qualified**, ber-`durasi_bulan = 6`, atas layanan ber-opsi tenor 1/6 bulan | `#6/FS-6b` Form Qualified. Ditinggal di Qualified dengan sengaja: sesudah ditutup, formnya tidak bisa disunting dan pemilih tenornya hilang |

`seedService` juga bisa memasang `master_service_duration_options` langsung,
supaya pemilih tenor punya sesuatu untuk dipilih tanpa harus melewati layar MSL
lebih dulu.

## 6 · Koreksi skrip UAT (tujuh, semuanya milik skrip — bukan aplikasi)

Ditulis supaya sesi berikutnya tidak mengulanginya:

1. **`/sales` dan `/clients` punya LEBIH DARI SATU `<table>`.** `table thead th`
   menggabungkan header semuanya dan indeks kolomnya meleset. Pilih tabel lewat
   salah satu judul kolomnya dulu.
2. **Tautan WhatsApp adalah `api.whatsapp.com/send?phone=…`, bukan `wa.me`.**
3. **Dropdown Jenis perpanjangan baru dirender SESUDAH tombol
   "+ Penawaran / Tagihan" diklik** — ia tidak ada di DOM saat halaman dimuat.
4. **Tanggal kontrak dirender "01 Jul 2026", bukan ISO.**
5. **`has-text` adalah SUBSTRING.** `button:has-text("Negotiation Required")`
   juga cocok dengan **"No** Negotiation Required" ⇒ hitungannya 2, bukan 1.
   Pakai `getByRole('button', { name: …, exact: true })`.
6. **Editor proposal di tahap Qualified ada DI BALIK tombol** ("Negotiation
   Required" / "No Negotiation Required") — ia tidak ada di DOM saat dimuat.
7. **Sesudah fixture bertambah, `/clients` punya dua baris.** Asersi yang
   membaca "baris pertama" jadi salah sasaran; targetkan klien yang dimaksud.

## 7 · Yang TIDAK dijalankan

- **§3 mengisi 21 Kategori + 8 Sub Type** — butuh pemilik.
- **§4 drift check penuh** — tetap tidak bisa dari sandbox.
- ~~Perbaikan `M19-NAMA-RLS`~~ — ✅ selesai 2026-09-10, plus sapuan modul lain:
  `UAT_M19_BROWSER_20260909.md` §2b–§2c.
- ~~Perbaikan OBS-1~~ — ✅ selesai 2026-09-10 (§3a).
- ~~Tiga butir yang tidak bisa dibuktikan~~ — ✅ fixture-nya dibangun, ketiganya
  diuji dan PASS (§4, §5a).
- ~~Pesan `prospect attempt not found`~~ — ✅ **diperbaiki 2026-09-10.**
  Ditemukan di sini sebagai pita galat bagi AM yang bukan `assigned_am_id`
  klien: bahasa Inggris, tanpa kurung siku, melanggar aturan rumah #5. Default
  `sales.NotFoundError` kini `MSG_NOT_FOUND = '[prospek tidak ditemukan]'`,
  mengikuti pendahulunya di `account.ts` (`[klien tidak ditemukan]`,
  `[layanan tidak ditemukan]`).

**Yang benar-benar tersisa, dan bukan pekerjaan UAT:** isi 21 Kategori + 8 Sub
Type (butuh pemilik) dan drift check penuh (butuh operator/CI).
