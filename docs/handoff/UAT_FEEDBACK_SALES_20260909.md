# UAT di peramban — Feedback tim Sales (enam butir) + FS-6b

**Tanggal ditulis:** 2026-09-09 · **Menutup:** utang **B2** —
`HANDOFF_FEEDBACK_SALES_TUTUP_20260909.md` §2.2 *"UAT di peramban — belum
pernah dilakukan"*.

Yang sudah terbukti sampai hari ini adalah **tesnya**, bukan **layarnya**:
api 495 · core 985 · db 64 · domain 2231 · web-internal 729, semuanya hijau,
dan CI 11/11 hijau di `main`. Runbook ini menutup celah yang tersisa —
kelas cacat yang lolos dari `tsc`, `vitest`, dan `next build` sekaligus:
**route menjawab 200, halamannya kosong** (O43), dan **RLS menolak diam-diam
untuk peran tertentu saja**.

> ⚠️ Ini dokumen **yang dijalankan**, bukan dibaca. Kolom Hasil di §5 diisi
> saat menjalankan, bukan sesudahnya dari ingatan.

---

## 0 · Persiapan

### 0.1 Basis data lokal + isinya

```bash
scripts/db-rebuild.sh --yes          # DROP + 216 migrasi + seed + gate
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps \
  npx tsx scripts/seed-browser-tour.ts > /tmp/tour-ids.json
```

`db-rebuild` memberi 10 karyawan + 6 layanan katalog. `seed-browser-tour`
menambah SATU rantai klien nyata (lead → closing → TRX → brief) supaya layar
yang hanya gagal secara visual punya baris sungguhan untuk dirender.
Jalankan **sekali** per rebuild — ia tidak idempoten.

### 0.2 Jalankan aplikasinya

Dua proses, dan **portnya tidak boleh tertukar**: `web-internal` mem-proxy
`/api/v1/*` ke `http://127.0.0.1:3001` (lihat `web-internal/next.config.ts`),
jadi `apps/api` HARUS di 3001 dan web-internal di 3000.

```bash
# terminal 1 — apps/api di 3001 (WAJIB eksplisit)
npm run dev -w @cdps/api -- -p 3001

# terminal 2 — web-internal di 3000
cd web-internal && npm run dev -- -p 3000
```

> `make dev-api` menjalankan `next dev` polos yang default-nya **3000** — sama
> dengan web-internal. Kalau keduanya dijalankan lewat Makefile, yang kedua
> akan bergeser sendiri ke port lain dan proxy-nya menunjuk ke tempat yang
> salah: setiap halaman memuat, setiap tabel kosong. Pakai perintah eksplisit
> di atas.

Buka `http://127.0.0.1:3000`.

### 0.3 Masuk sebagai peran — dan kenapa perannya WAJIB tepat

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps \
  node scripts/dev-jwt.mjs --employee EMP-0006     # cetak JWT
```

Pasang hasilnya sebagai cookie **`cdps_access_token`** di peramban (DevTools →
Application → Cookies → `http://127.0.0.1:3000`), lalu muat ulang halaman.

| Persona | employee_id | Peran CDPS | Dipakai untuk |
|---|---|---|---|
| Budi Santoso | `EMP-0001` | Sales **staff** | #1, #3, #5, FS-6b (kalkulator, QF, nego) |
| Dewi Anggraini | `EMP-0006` | Sales **Head** (lead) | **#2**, #6, persetujuan nego |
| Yohan Saputra | `EMP-0008` | Director | pembanding saja — lihat peringatan |
| Sinta Rahma | `EMP-0002` | Account Manager | #4 (opsional) |

> 🚨 **Jangan uji sebagai Director/OD lalu menyimpulkan "aman".** Keduanya lolos
> `jwt_can_read_all()`, jadi mereka **tidak pernah melihat** bug scope yang
> justru diperbaiki butir #2 dan #5. Uji dengan peran di kolom "Dipakai untuk";
> Director hanya berguna untuk membuktikan bahwa sebuah gejala memang
> peran-spesifik.

---

## 1 · Peta uji

| # | Butir | Layar | Peran wajib | Yang dibuktikan |
|---|---|---|---|---|
| 1 | Tombol WhatsApp | `/leads`, `/leads/{id}`, `/sales`, `/sales/{id}` | Sales staff | nomor **tetap terbaca** + tombol WA; nomor tak sah ⇒ **tanpa** tombol |
| 2 | Owner tampil nama | `/sales` kolom Owner | **Sales Head** | nama orang, bukan `EMP-…` |
| 3 | Prospek bersama | `/leads/{id}`, `/sales/{id}` | 2 sales | badge di **KEDUA** baris; alokasi prefill 50/50 |
| 4 | Jenis `bayar_komisi` | `/clients/{id}` panel Perpanjangan | Sales staff | **nol** kontrak lahir; alokasi **tidak** berpindah |
| 5 | Durasi kontrak | `/clients/{id}` panel Kontrak | **Sales staff** | **nol 403**; jendela kontrak tampil |
| 6 | Opsi durasi MSL (katalog) | `/master-services` | **Sales Head** | editor baris opsi; invarian ditolak server |
| 7 | **FS-6b** tenor sampai ke deal | kalkulator · QF · nego · RenewalPanel | Sales staff | harga **paket**, dan kontraknya **12 bulan** bukan 3 |

---

## 2 · Urutan wajib — #6 adalah PRASYARAT butir 7

Diperiksa 2026-09-09: `master_service_duration_options` **kosong (0 baris)** di
DB lokal **maupun** di live `CDPS SG`. Seluruh katalog hari ini bertenor
tunggal.

Artinya butir 7 **tidak bisa diuji sebelum butir 6 dijalankan** — tanpa satu
layanan ber-opsi, setiap dropdown Durasi memang seharusnya tidak muncul, dan
tester akan salah menyimpulkan "fiturnya tidak jalan".

**Urutan:** #1 → #2 → #3 → #4 → #5 → **#6 (buat layanan ber-opsi)** → #7.

---

## 3 · Langkah per butir

### #1 · Tombol WhatsApp

1. Sebagai `EMP-0001`, buka `/leads`.
2. Pada kolom nomor: harus terlihat **nomornya sebagai teks** *dan* tombol kecil **WA** di sebelahnya.
3. Klik WA → tab baru ke `wa.me` dengan sapaan otomatis berisi nama lead.
4. Ulangi di `/leads/{id}`, `/sales`, `/sales/{id}` — empat titik pasang.

| | |
|---|---|
| ✅ **LULUS** | nomor tetap terbaca DAN tombol ada; link membuka nomor yang benar |
| ❌ **GAGAL** | kolom nomor hilang diganti tombol · tombol muncul untuk nomor tak sah |

> Nomor tak sah sengaja dirender **tanpa** tombol: tombol yang menuju nomor
> tebakan lebih buruk daripada tanpa tombol — sales akan mengira pesannya
> sampai ke lead yang benar.

### #2 · Owner tampil nama — *bukti utama, jangan dilewati*

1. Masuk sebagai **`EMP-0006` (Sales Head)** — bukan Director.
2. Buka `/sales`.
3. Kolom **Owner** muncul (kolom ini memang hanya dirender untuk lead/OD/Director).

| | |
|---|---|
| ✅ **LULUS** | isinya nama, mis. `Budi Santoso` |
| ❌ **GAGAL** | isinya `EMP-0001` · `—` · kosong |

4. *(Pembanding, opsional)* ulangi sebagai `EMP-0008` Director. Kalau Director
   melihat nama tapi Sales Head melihat `EMP-…`, itu **tepat** bug scope yang
   diperbaiki — laporkan, jangan diabaikan.

### #3 · Prospek bersama

1. Sebagai `EMP-0001`, daftarkan lead baru di `/leads` — catat nomor teleponnya.
2. Ganti persona ke `EMP-0006`, daftarkan lead **dengan nomor telepon yang sama**
   lewat pendaftaran satuan.
3. Buka `/leads/{id}` lead itu.

| | |
|---|---|
| ✅ **LULUS** | badge kuning **"Prospek Bersama"** muncul di **KEDUA** baris attempt |
| ❌ **GAGAL** | badge hanya di satu baris · pendaftaran kedua ditolak sebagai duplikat |

4. Buka `/sales/{attempt-id}` → header menampilkan **"Prospek Bersama dengan
   \<nama rekan\>"**.
5. Bawa attempt sampai layar closing → tabel alokasi ter-prefill **dua baris
   50/50**, bukan satu baris 100%.
6. Sesudah salah satu menang: attempt yang lain berstatus
   **`[Closed - Prospek Bersama]`**, *bukan* `[Closed - Kalah Kompetisi]`.

> Butir 5 dan 6 adalah inti keluhannya: rekannya tidak boleh hilang dari
> alokasi (itu dasar komisi), dan tidak boleh dicatat sebagai kalah.

### #4 · Jenis `bayar_komisi`

1. Sebagai `EMP-0001`, buka `/clients/{id}` klien hasil seed → panel **Perpanjangan / Cross Sell**.
2. Pilih jenis **"Bayar Komisi"**.
3. Dropdown jasa hanya menawarkan layanan ber-`pengakuan = bulan_berikutnya`
   (mis. *Komisi*) — bukan seluruh katalog.
4. Ajukan → setujui → eksekusi.

| | |
|---|---|
| ✅ **LULUS** | lahir `SVC-` + `TRX-` saja; **`contract_id` null** (tidak ada `CTR-` baru di panel Kontrak); alokasi sales **tidak berubah** |
| ❌ **GAGAL** | muncul `CTR-` baru · alokasi berpindah ke eksekutor |

> Komisi adalah tagihan atas penjualan yang **sudah** terjadi, bukan
> kesepakatan baru — tidak ada jendela yang dimulai, jadi tidak ada kontrak.
> Dan penagihan komisi tidak boleh memindahkan kepemilikan klien.

### #5 · Durasi kontrak di Client Record

1. Masuk sebagai **`EMP-0001` (Sales staff)** — perannya penting.
2. Buka `/clients/{id}` → gulir ke panel **Kontrak** (anchor `#kontrak`).

| | |
|---|---|
| ✅ **LULUS** | tabel tampil: Kontrak · Jenis · **Durasi** · Mulai · Berakhir · Sisa · Catatan — **nol 403** |
| ❌ **GAGAL** | 403 / panel kosong tanpa penjelasan |

3. Untuk klien yang **hanya** membeli layanan sekali jadi: panel menampilkan
   *"Belum ada kontrak untuk klien ini"* **berikut alasannya**. Itu perilaku
   benar, bukan bug — "belum ada" dan "hilang" terlihat sama di layar kalau
   alasannya tidak ditulis.

### #6 · Opsi durasi MSL — *dan ini menyiapkan butir 7*

1. Masuk sebagai **`EMP-0006` (Sales Head)** → `/master-services`.
2. Tambah/ubah layanan. Cari bagian **"Pilihan Durasi & Harga Paket (opsional)"**.
3. Klik **+ Tambah Pilihan Durasi** tiga kali, isi meniru keluhan aslinya:

   | Durasi (bulan) | Harga Paket (Rp) |
   |---|---|
   | 3 | 10.200.000 |
   | 6 | 19.200.000 |
   | 12 | 36.000.000 |

4. **Samakan** `Harga Standar` = `10200000` dan `Durasi (bulan)` = `3` —
   yaitu opsi **TERPENDEK**.
5. Simpan.

| | |
|---|---|
| ✅ **LULUS** | tersimpan; tabel katalog menampilkan `3 / 6 / 12 bulan` di kolom opsi |
| ❌ **GAGAL** | tersimpan padahal harga/durasi versi **tidak** sama dengan opsi terpendek |

6. **Uji negatif (wajib):** ubah `Harga Standar` jadi `9000000` (tidak lagi sama
   dengan opsi 3 bulan) lalu simpan → **harus DITOLAK server**.

> Invarian itu (`trg_msdo_terpendek`) yang membuat setiap pembaca lama —
> jendela kontrak, mesin accrual, Ads Management Date — terus membaca angka
> yang sah. Kalau uji negatif ini LOLOS, hentikan UAT dan laporkan.

### #7 · FS-6b — tenor benar-benar bisa DIJUAL

Pakai layanan ber-opsi yang baru dibuat di #6. Sebagai `EMP-0001`.

**7a · Kalkulator** — `/sales/kalkulator`
1. Temukan layanan itu; kolom **Durasi** berisi dropdown
   `3 bulan — Rp. 10.200.000,00` / `6 …` / `12 …`.
2. Bawaannya **3 bulan** (tenor terpendek) → kolom Harga `Rp. 10.200.000,00`.
3. Isi Quantity `1`, ganti dropdown ke **12 bulan**.

| | |
|---|---|
| ✅ **LULUS** | kolom Harga → **`Rp. 36.000.000,00`**, Ringkasan Estimasi Nilai ikut berubah |
| ❌ **GAGAL** | harga tetap 10,2jt · harga jadi `40.800.000` (= 4 × 10,2jt) |

> `40.800.000` berarti tenor diperlakukan sebagai pengali linear — justru
> diskon paketnya yang hilang, yaitu keluhan aslinya.

**7b · Form Qualified** — `/sales/{attempt-id}`
1. Attempt berstatus *Contacted* → isi Form Qualified.
2. Baris jasa punya kolom **Durasi**; pilih **12 bulan**. Submit.
3. Sesudah submit, tabel snapshot Qualified menampilkan kolom **Durasi** = `12 bulan`.

| ✅ **LULUS** | tenor terkirim **dan terbaca kembali** |
|---|---|
| ❌ **GAGAL** | kolom Durasi menampilkan `—` sesudah submit (tenor hilang di perjalanan) |

**7c · Editor proposal (negosiasi + Edit Service)**
1. Buka negosiasi → editor baris punya kolom **Durasi**, ter-prefill `12 bulan`
   dari snapshot.
2. **Ganti jasa** pada satu baris → dropdown Durasi **ikut ganti** ke opsi milik
   jasa baru (atau hilang kalau jasa itu bertenor tunggal).

| ✅ **LULUS** | tenor jasa lama **tidak** menempel di jasa baru |
|---|---|
| ❌ **GAGAL** | `12` tersisa untuk jasa yang tidak menawarkannya ⇒ submit ditolak `[data tidak lengkap…]` pada baris yang tampak wajar |

3. Lanjutkan "No Negotiation Required" → closing.

**7d · Bukti uang — kontraknya**
Sesudah closing, buka `/clients/{id-baru}` → panel **Kontrak**.

| | |
|---|---|
| ✅ **LULUS** | **Durasi = 12 bulan**; Berakhir = mulai + 12 bulan; nilai transaksi `Rp. 36.000.000,00` |
| ❌ **GAGAL** | **Durasi = 3 bulan** — inilah cacat yang FS-6b tutup |

> Kalau muncul 3, kontraknya berakhir sembilan bulan sebelum layanan yang
> dibayar selesai, dan setiap periode Plan sesudahnya jatuh di luar jendelanya
> — tanpa satu galat pun.

**7e · RenewalPanel** — `/clients/{id}` panel Perpanjangan
1. Ajukan perpanjangan dengan layanan ber-opsi → kolom **Durasi** ada di editor baris.
2. Pilih 12 bulan, eksekusi → layanan yang lahir berdurasi 12 bulan, harga `36.000.000`.

**7f · Regresi wajib — layanan tenor tunggal tidak boleh berubah**
1. Pakai layanan katalog lama (tanpa opsi) di kalkulator.

| ✅ **LULUS** | kolom Durasi menampilkan **teks biasa** (`—` atau `N bulan`), **bukan** dropdown; harga & alur persis seperti sebelum FS-6 |
|---|---|
| ❌ **GAGAL** | muncul dropdown kosong · submit ditolak `[data tidak lengkap…]` |

> Ini yang membuktikan **nol backfill** benar-benar nol: 100% katalog hari ini
> bertenor tunggal dan tidak boleh terpengaruh sedikit pun.

---

## 4 · Jebakan yang sudah menggigit sebelumnya

1. **Menguji sebagai Director lalu menyimpulkan aman.** OD/Director lolos
   `jwt_can_read_all()`; butir #2 dan #5 justru hanya bergejala di bawah peran
   Sales. Salah persona = false negative.
2. **Menguji butir 7 sebelum butir 6.** Katalog nol opsi ⇒ dropdown memang
   tidak muncul ⇒ salah lapor "fitur tidak jalan".
3. **`web-internal` BUKAN workspace npm.** `npm install` di akar tidak memasang
   deps-nya (`workspaces` = `apps/*`, `packages/*`). Obatnya `npm install`
   **di dalam** `web-internal/`.
4. **Lupa `seed-browser-tour`.** Tanpa itu tidak ada klien/kontrak untuk
   dirender, dan panel kosong terlihat seperti bug.
5. **`seed-browser-tour` dijalankan dua kali.** Tidak idempoten — mendaftarkan
   lead kedua. Tidak berbahaya, hanya membingungkan saat mencocokkan ID.
6. **Halaman menjawab 200 tapi kosong** adalah kelas cacat O43 (kunci wire
   hilang), bukan "lambat". Kalau sebuah tabel kosong padahal barisnya ada di
   DB, itu temuan — catat, jangan muat ulang lalu lanjut.

---

## 5 · Lembar hasil

Isi saat menjalankan. `—` berarti belum dijalankan, **bukan** lolos.

| # | Butir | Peran diuji | Hasil | Catatan / bukti |
|---|---|---|---|---|
| 1 | Tombol WhatsApp (4 layar) | | — | |
| 2 | Owner tampil nama | Sales Head | — | |
| 3 | Prospek bersama (badge 2 sisi) | | — | |
| 3b | Alokasi prefill 50/50 | | — | |
| 3c | `[Closed - Prospek Bersama]` | | — | |
| 4 | `bayar_komisi` — nol `CTR-` | | — | |
| 4b | alokasi tidak berpindah | | — | |
| 5 | Panel Kontrak, nol 403 | Sales staff | — | |
| 6 | Editor opsi durasi tersimpan | Sales Head | — | |
| 6b | Uji negatif invarian **ditolak** | Sales Head | — | |
| 7a | Kalkulator: 12 bln ⇒ Rp 36jt | | — | |
| 7b | QF: tenor terbaca kembali | | — | |
| 7c | Ganti jasa ⇒ tenor ikut ganti | | — | |
| 7d | **Kontrak = 12 bulan** | | — | |
| 7e | Renewal ber-tenor | | — | |
| 7f | Regresi tenor tunggal | | — | |

**Verdict akhir:** _(diisi)_

---

## 6 · Kalau ada yang GAGAL

1. Catat **layar + peran + langkah** — tanpa peran, laporannya tidak bisa
   direproduksi (lihat jebakan #1).
2. Sertakan tangkapan layar **dan** apa yang ada di DB untuk baris itu
   (`select … from …`), supaya "route 200, halaman kosong" bisa dibedakan dari
   "datanya memang tidak ada".
3. Temuan jalur uang (butir 4, 7d) **menghentikan** UAT — angkanya mengalir ke
   `transactions` dan mesin accrual Gelombang D.
