# Handoff — durasi layanan pindah ke BULAN, katalog terisi, Gelombang D tinggal `D-KOM`

> Lanjutan `HANDOFF_LANJUT_20260907_MSL_DURASI.md`. Baca itu dulu untuk tahu
> kenapa field durasinya sempat tidak ada sama sekali; berkas ini melanjutkan
> dari sana.

---

## 1. Posisi

| | Status |
|---|---|
| Gelombang A · B · C | ✅ tutup |
| **Penghalang D #1 — `durasi_jasa` kosong** | ✅ **TUTUP** — field dibangun, satuan diketok, 80 layanan terisi |
| Penghalang #2 (jumlah laporan klien) | ⏸️ tetap operasional |
| Penghalang #3 (izin pitch, 0 baris) | ⏸️ tetap operasional |
| **Gelombang D** | ⏸️ penghalangnya sekarang **`D-KOM`**, bukan lagi data durasi |

---

## 2. Tujuh ketokan yang mengubah bentuk masalahnya

Pemilik (Nerissa, COO) mengetok Q1–Q7 sekaligus 2026-09-07. Rinciannya di
`DECISIONS.md`; ringkasnya yang mengubah kode:

- **Satuan durasi bukan HARI lagi, tapi BULAN.** `durasi_jasa` di-rename jadi
  `durasi_bulan`. Ini **deviasi PRD yang disengaja** terhadap M16 LT-42.
- **`qty_menambah` lahir** karena qty yang dibeli klien tidak selalu berarti
  bulan. `Nano KOL` beli 10 adalah 10 KOL, bukan kontrak 10 bulan.
- **Durasi dihitung dari layanan MULAI JALAN** (Ads: start campaign). Periode
  riset tidak dihitung.
- **`durasi_bulan = NULL` berarti "sekali jadi"**, bukan "belum diisi":
  pendapatannya diakui sekaligus saat selesai.

---

## 3. Temuan yang paling mahal, dan kenapa ia sempat tak terlihat

Kolom `unit` di 44 layanan **tidak berisi satuan** — ia berisi **angka bulan**.
Tim Sales menuliskannya di sana karena kolom durasi belum ada.

Buktinya bukan tafsir: `Jasa Iklan Traffic Marketplace Basic` ada **tiga entri
terpisah** yang hanya beda `unit` (3 / 6 / 12), dan harga per bulannya turun
makin panjang paket — Rp 3.400.000 → Rp 3.200.000 → Rp 3.000.000. Itu struktur
diskon paket.

Kalau sembilan layanan itu diberi durasi 1 bulan (seperti instruksi awal
"semua layanan lama jadi 1 bulan"), harganya adalah harga paket dan akan
diakui **seluruhnya di bulan pertama**:

> `GMV MAX MEA PRO` — Rp 20.000.000, paket 6 bulan.
> Durasi 1 bulan ⇒ diakui Rp 20.000.000 di bulan-1.
> Durasi 6 bulan ⇒ Rp 3.333.333/bulan × 6.
> **Selisih bulan-1: Rp 16.666.667 kelebihan akui.** Dikali 9 layanan, dikali
> jumlah klien yang membelinya.

**Pelajarannya:** instruksi pemilik yang terdengar sederhana ("semua jadi 1
bulan") tetap wajib diadu dengan data nyata sebelum dieksekusi. Yang menemukan
ini bukan review kode — tapi satu kueri `group by unit` atas katalog live.

---

## 4. Yang dibangun

**Dua migrasi: 186 (skema) dan 187 (data).**

| # | Berkas | Isi |
|---|---|---|
| **186** | `20260918010000_d0_durasi_bulan_qty_menambah.sql` | rename `durasi_jasa`→`durasi_bulan` + konversi nilai, `qty_menambah` + 2 CHECK |
| **187** | `20260919010000_d0_isi_durasi_katalog.sql` | isi 80 layanan aktif + 80 baris `audit_log` |

Plus: `tz.addMonthsToDate` di `@cdps/core`, `ads.ts` end-date jadi bulan-lalu-hari,
form MSL dapat field bulan + dropdown aturan qty, dua kolom baru di kedua tabel.

### Klasifikasi 80 layanan (diketok per GRUP, bukan per baris)

| Grup | Aturan | Durasi | qty | Jml |
|---|---|---|---|---|
| A | `unit` angka > 1 | angka itu (3/6/12) | durasi | 9 |
| B | nama menyebut "JAM" | 1 bulan | durasi | 9 |
| C | `frequency = 'One-time'` | NULL | volume | 5 |
| D | Jasa Pengajuan/Buka Toko/Website | NULL | volume | 7 |
| E | `unit` = '1' sisanya | 1 bulan | durasi | 19 |
| F | satuan volume sisanya | NULL | volume | 26 |
| F* | 4 yang jelas bulanan | 1 bulan | volume | 4 |
| F* | `GMV Max` | 1 bulan | **durasi** | 1 |

**Urutan CASE = urutan prioritas**, dan itu yang menjamin satu baris tidak masuk
dua grup (layanan ber-"JAM" yang `unit`-nya '1' adalah B, bukan E). Dry-run ke
katalog live sebelum menulis: **9+9+5+7+19+1+4+26 = 80**, nol baris tak
terklasifikasi.

### Kenapa mengoreksi baris versi yang ada, bukan menerbitkan versi baru

Diketok pemilik lewat `AskUserQuestion`. Durasi itu **selalu ada** — `GMV MAX
MEA PRO` memang paket 6 bulan sejak hari pertama, angkanya cuma tercatat di
kolom yang salah. Jadi ini koreksi **salah-catat**, bukan perubahan atas apa
yang dijual.

Menerbitkan versi baru justru akan berbohong: klien yang kontraknya sedang
berjalan ter-pin ke versi lama, jadi paket 6 bulan yang baru jalan 2 bulan
**tidak akan pernah punya durasi** dan sisa pendapatannya tidak pernah masuk
skedul accrual. Jejaknya tetap ada — 80 baris `audit_log` dengan nilai sebelum
dan sesudah, dan `audit_log` menolak UPDATE/DELETE.

---

## 5. ⚠️ Aturan urutan rilis yang lahir sesi ini — BACA SEBELUM APPLY MIGRASI

Sesi-sesi sebelumnya membiasakan "apply migrasi ke live dulu, merge belakangan".
Itu **aman untuk migrasi ADITIF** (184 dan 185 hanya menambah tabel). Untuk
migrasi 186 itu adalah **pemadaman**: ia me-rename kolom yang dibaca kode yang
sedang berjalan, dan `origin/main` masih mengueri `durasi_jasa` di 8 tempat
(`msl.ts` select list, `ads.ts`, dua route `master-services`, `wire.ts`).

> **Migrasi aditif boleh mendahului kode.**
> **Migrasi yang me-rename atau menghapus kolom harus MENYUSUL deploy kodenya.**

Urutan yang benar dan yang dipakai sesi ini:
**merge → tunggu deploy → `apply_migration` per berkas → verifikasi lewat kueri
katalog → baru isi data.**

---

## 6. Verifikasi — angka acuan BARU

| Suite | Sebelum sesi | Sesudah |
|---|---|---|
| core | 930 | **935** (+5 `addMonthsToDate`) |
| db | 53 | 53 |
| apps/api | 490 | 490 |
| domain | 1977 (+1 skip) | **1988** (+11) |
| web-internal | 640 | **650** (+10) |
| web-client-portal | 19 | 19 |
| migrasi `db-rebuild` | 185 | **188** |

`npm run typecheck --workspaces` bersih di empat workspace (**sesudah**
`npm install` — jebakan lama masih berlaku). `web-internal`: `tsc --noEmit`
bersih, `next build` sukses. `db-rebuild.sh` lolos `ident_checks`,
`immutability_checks`, `rls_checks`, `auth_claims_checks`.

Lint: 1 error **pre-existing** (`react-hooks/static-components` di
`admin/employees/page.tsx`), di luar cakupan.

### Dua gerbang rumah yang sempat merah — dan keduanya benar

1. **`web-internal/src/lib/msl.test.ts`** (tes round-trip yang dibuat sesi
   sebelumnya) memerah saat `qty_menambah` ditambahkan ke payload, dan tidak
   mau hijau sampai mapping-nya menyatakan cara field baru bertahan melewati
   edit. Itu persis kelas cacat yang ia dibangun untuk mencegah, dan ia
   menangkapnya pada kesempatan pertama.
2. **`apps/api/src/lib/body-parity.test.ts`** memerah saat payload dipindah ke
   `lib/`. Sebabnya: gerbang itu me-resolve badan request dari interface yang
   dideklarasikan **di berkas yang sama** dengan panggilan `api.*`, jadi
   halaman yang mengirim payload bertipe modul lain terbaca `unresolved` — dan
   **badan yang tidak ter-resolve tidak memeriksa apa pun**. Perbaikan naif
   (biarkan halaman memanggil `api.put` langsung) akan diam-diam **mematikan**
   gerbangnya. Yang dilakukan: panggilan tulisnya dipindah ke
   `saveMasterService()` di `lib/msl.ts`, mengikuti pola yang gerbang itu
   sendiri sebutkan. Dibuktikan masih hidup lewat mutasi.

---

## 6b. Keadaan LIVE — diterapkan dan diverifikasi

Ketiga migrasi sudah di-apply ke `CDPS SG` **sesudah** PR #306 di-merge dan
ketiga deploy Vercel produksi READY di commit merge. Diverifikasi lewat kueri
katalog, bukan dari `success: true`:

| | Hasil |
|---|---|
| kolom `durasi_jasa` | **hilang** |
| `durasi_bulan` · `qty_menambah` | ada, **3 CHECK** terpasang |
| nilai lama 30 hari | terkonversi ⇒ **1 bulan** |
| tabel `public` | **146** (tetap) |
| layanan aktif | **80** |
| punya durasi | **42** (7×6 bln · 1×3 · 1×12 · 33×1) |
| sekali jadi (NULL) | **38** |
| `qty_menambah='durasi'` | **38** · `volume` **42** |
| pelanggaran CHECK | **0** |
| `unit` masih angka | **0** |

Contoh terverifikasi: `GMV MAX MEA PRO` → 6 bulan, `unit=paket`, qty=durasi ·
`Nano KOL` → NULL, volume · `Jasa Pengajuan Shopee Mall` → NULL, `unit=paket`.

**Migrasi 188 lahir dari verifikasi, bukan dari membaca ulang migrasinya.**
Sesudah 187 diterapkan, kueri melaporkan 16 layanan aktif masih ber-`unit`
numerik — 187 hanya membersihkan grup A dan E, sementara grup B (9 ber-JAM) dan
D (7 sekali jadi) juga ber-`unit`='1'. 188 memakai aturan *"unit yang isinya
MURNI angka"*, bukan daftar nama; daftar nama persis cara 187 melewatkannya.

### 🟠 Satu cacat yang diakui dan permanen

Baris audit `koreksi_unit_sisa_angka` mencatat **44** layanan padahal hanya
**16** yang benar-benar berubah. `INSERT` audit di 188 menyaring
`WHERE active AND unit = 'paket'`, dan itu dievaluasi **SESUDAH** `UPDATE`-nya,
jadi ikut mencocoki 28 layanan grup A/E yang `unit`-nya sudah `'paket'` sejak
187. Data katalognya **benar**; yang keliru hanya narasi auditnya.

Tidak diperbaiki dengan menghapus baris (`audit_log` menolak DELETE) maupun
dengan menyunting 188 (sudah berjalan di live). **Cara membaca angkanya:** 44
adalah jumlah layanan yang SEKARANG ber-`unit='paket'`; yang diubah 188 ada 16.

**Pelajarannya:** filter `INSERT ... SELECT` audit yang membaca kolom yang baru
saja di-`UPDATE` mencatat keadaan SESUDAH, bukan yang berubah. Filternya harus
memakai daftar id dari `UPDATE ... RETURNING`, bukan predikat atas nilai barunya.

---

## 7. Yang tersisa untuk Gelombang D

Penghalangnya **bukan lagi data durasi**. Yang tersisa satu, dan ia lahir dari
jawaban pemilik sendiri:

### 🔴 `D-KOM` — `Komisi` butuh perlakuan KETIGA

Pemilik: *"Komisi sebetulnya service pelengkap tambahan yang tidak bisa
di-track di awal karena bentuknya komisi dari hasil penjualan yang diketahui di
bulan depannya, maka dari itu dibuat bisa diisi sendiri oleh Sales."*

Masalahnya: sesudah pengisian hari ini, `Komisi` tersimpan `durasi_bulan =
NULL` — **nilai yang sama persis** dengan `Jasa Pengajuan Shopee Mall` (grup D).
Padahal keduanya diakui berbeda:

| | Diakui kapan |
|---|---|
| Grup D (sekali jadi) | **sekaligus saat selesai** |
| `Komisi` | **satu bulan setelah penjualannya terjadi** |

Mesin accrual tidak akan bisa membedakannya. Ini persis aturan kerja #4 —
*"ketiadaan yang diam tidak bisa dibedakan dari kerusakan"* — dan kelas
kekeliruan yang sama dengan `0` vs `null`.

Dua opsi yang perlu diketok: **(a)** penanda ketiga di katalog (mis.
`pengakuan` = `saat_selesai` / `per_periode` / `bulan_berikutnya`), atau
**(b)** `Komisi` dikeluarkan dari mesin accrual dan jadi jurnal manual Finance.

### Empat layanan yang sengaja diberi pilihan aman

`Store Management (Paket)`, `Customer Review Management`, `AI Video`,
`Optimasi SKU` diberi `qty_menambah = 'volume'`. Keempatnya **mungkin**
`'durasi'` — tapi `volume` adalah sisi yang aman, dan koreksinya sekarang
**murah**: form MSL sudah punya dropdown-nya, jadi Sales Head bisa mengubahnya
sendiri tanpa migrasi.

---

## 8. Urutan yang disarankan untuk sesi berikutnya

1. **Ketok `D-KOM`** — itu satu-satunya yang memblokir mesin accrual.
2. **Bangun Gelombang D** sesuai `HANDOFF_GELOMBANG_C_20260907.md` §4. Empat
   aturan uangnya (D-1…D-4) sudah diketok; **jangan diketok ulang**. Mulai dari
   mesin accrual di `@cdps/core`, tes ditulis DULUAN untuk pro-rate hangus D-1
   dan pergeseran hold D-2.
3. **UAT `/showcase` di peramban** — masih satu-satunya hal Gelombang C yang
   belum dibuktikan mata.
4. `B23-SHP` dan `KS-4` kalau prioritasnya naik.

---

## 9. Aturan kerja yang ditambahkan sesi ini

1. **Instruksi pemilik pun diadu dengan data sebelum dieksekusi.** "Semua
   layanan lama jadi 1 bulan" terdengar sederhana dan tetap salah untuk 9
   layanan, senilai Rp 16,6 juta kelebihan akui per layanan per klien. Yang
   menemukannya satu kueri `group by`, bukan review kode.
2. **Migrasi aditif boleh mendahului kode; rename/drop harus menyusul deploy.**
   Kebiasaan lama "apply dulu" lahir dari migrasi yang kebetulan semuanya
   aditif.
3. **Gerbang yang memerah karena refactor kadang benar-benar sedang bekerja.**
   Dua kali sesi ini, dan dua-duanya jawabannya adalah menyesuaikan kode ke
   pola yang gerbang itu jaga — bukan mengecualikan gerbangnya. Sebuah gerbang
   yang "diperbaiki" dengan pengecualian berhenti menjaga apa pun, dan
   diamnya tidak bisa dibedakan dari hijau.
4. **Dua bentuk kekosongan yang artinya berbeda wajib punya penanda berbeda.**
   `Komisi` dan `Jasa Pengajuan Shopee Mall` sama-sama `NULL` hari ini, dan
   itu sudah cukup untuk membuat mesin accrual salah. Ditemukan bukan dari
   kode, tapi dari satu kalimat penjelasan pemilik tentang kenapa Komisi
   berbeda.
