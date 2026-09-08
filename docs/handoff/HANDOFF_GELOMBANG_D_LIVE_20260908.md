# Handoff — **Gelombang D: tiga dari empat SELESAI dan SUDAH DI LIVE. Tinggal D-3.**

> **Baca ini dulu, lalu:**
> 1. `docs/handoff/HANDOFF_GELOMBANG_D_ACCRUAL_20260908.md` — apa yang dibangun
>    dan **kenapa**. Handoff ini tidak mengulanginya; ia mencatat apa yang sudah
>    mendarat di live dan apa yang berikutnya.
> 2. `docs/DECISIONS.md` — sepuluh baris `Decided` bertanggal **2026-09-08**.
>    **§Open: nol baris 🔴.** Yang paling penting dibaca: *"KOREKSI D-4"* dan
>    *"D-3 BUKA-ULANG DIKETOK"* — keduanya **membatalkan** hal yang sempat
>    dibangun/diasumsikan beberapa jam sebelumnya di hari yang sama.

---

## 1. Posisi

| | Status |
|---|---|
| Gelombang A · B · C | ✅ tutup |
| **D-KOM** — kolom `pengakuan` | ✅ **DI LIVE** (2026-09-08) |
| **Mesin accrual** — D-1 hangus, D-2 hold | ✅ di `main` (kode; belum punya pemanggil) |
| **D-4** — PPN tombol Sales per invoice | ✅ **DI LIVE** (2026-09-08) |
| **D-3** — kunci tutup buku | 🟢 **SIAP DIBANGUN, nol baris kode.** Lihat §4 |

**PR #309 sudah MERGED** (commit `1fee983`). Tiga deploy Vercel produksi READY di
commit itu sebelum migrasi diterapkan — urutan yang benar, bukan kebetulan.

---

## 2. Keadaan live sesudah apply (diverifikasi lewat kueri, bukan `success:true`)

Live: **192 migrasi** (naik 2 dari 190).

### 2.1 D-KOM — `20260922010000_dkom_pengakuan_katalog`

```
per_periode       42
saat_selesai      37
bulan_berikutnya   1   <- Komisi
```

80 baris audit `ketokan_pengakuan` (satu per layanan aktif).

### 2.2 D-4 — `20260923010000_d4_ppn_kolom_terpisah`

| | |
|---|---|
| TRX ber-`include_ppn` | **3** — `TRX-202608-0008` `[Lunas]` · `-0009` Menunggu · `-0010` `[Lunas]` |
| Σ dasar (non-PPN) | **137.000.000** |
| Σ PPN | **15.070.000** |
| **Σ ditagih** | **152.070.000** — **sama persis dengan nilai gabungan sebelum migrasi** |
| Semua 11% tepat | ✅ `true` |
| Baris audit `pisah_ppn_d4` | 3 — persis yang berubah, tidak lebih |

**`TRX-202609-0002` sengaja UTUH**: `23.575.000 / ppn 0 / include_ppn false`.
Alasannya di handoff sebelumnya §4.3 — totalnya memuat Rp 18.025.000 dari baris
lain yang tidak bisa diatribusikan, jadi memisahnya menghasilkan PPN 2,4% yang
tidak punya arti di model baru. Nilai tercatat = ditagih = dibayar, ketiganya
tetap benar.

### 2.3 ⛔ Yang SENGAJA TIDAK diterapkan

**Empat migrasi Feedback OD dari PR #310/#311** (`20260922100000` F-2,
`20260922100100` F-3, `20260922100200` F-4, `20260922100300` A-2) **BELUM ada di
live** dan **bukan pekerjaan sesi ini** — pemilik memerintahkan eksplisit
2026-09-08: *"jangan gabungkan / migrasi apapun diluar pekerjaan kamu."*

Diverifikasi: kolom `briefs.jendela_budget` / `sumber_budget` **nol** di live.

⚠️ **Konsekuensi yang harus diketahui pemiliknya:** kode Feedback OD SUDAH
ter-deploy ke produksi (ia ikut di commit merge `1fee983`), sementara migrasinya
belum. Handoff mereka (`HANDOFF_FEEDBACK_OD_LANJUT_20260907.md` §2) menyatakan
keempatnya **aditif** dan harus di-apply **sebelum atau bersamaan** deploy —
jadi urutannya kini terbalik dari yang mereka rencanakan. **Itu perlu
diberitahukan ke pemilik pekerjaan itu**, bukan diperbaiki diam-diam dari sini.

Akibatnya ledger live juga punya **lubang di tengah**: `20260922010000` dan
`20260923010000` terpasang, empat di antaranya tidak. Itu tidak merusak apa pun
(nol ketergantungan antar keduanya) tapi harus disebut supaya tidak
membingungkan orang berikutnya.

---

## 3. Yang ada di `main` tapi BELUM punya pemanggil

**Mesin accrual `packages/core/src/accrual.ts` lengkap, teruji (47 tes, 6
mutasi), dan tidak dipanggil siapa pun.** Belum ada route, halaman, atau laporan
yang memakainya.

Artinya aturan kerja #1 ("setiap jahitan wajib punya satu tes yang memanggil
KEDUA sisi sungguhan") **belum bisa dipenuhi** untuk mesin ini. Itu pekerjaan
pertama sesudah D-3 — atau bersamaan dengannya, karena D-3 adalah pemanggil
alaminya.

Juga belum ada: **penurun riwayat hold dari `audit_log` untuk entitas
layanan/kontrak.** Mesin menerima `Hold[]`; `ads.computeTotalHariHold` adalah
polanya, tapi versi untuk layanan belum ditulis.

---

## 4. 🟢 D-3 — pekerjaan berikutnya, dan aturannya sudah lengkap

### 4.1 Wewenang BERTINGKAT — ini yang paling mudah salah dibangun

| Aksi | Siapa |
|---|---|
| **Menutup** bulan | `role.division === 'Finance' && role.level === 'lead'` **ATAU** `role.director` |
| **Membuka kembali** | **`role.director` SAJA** |

`Finance` lead yang menutup **tidak bisa membatalkan tutupannya sendiri.**
Asimetri itu yang membuat kuncinya menjaga sesuatu — kalau peran yang sama bisa
menutup dan membuka sesuka hati, "tertutup" tidak berarti apa-apa.

**Satu gerbang peran untuk kedua transisi adalah cacatnya.** Dua gerbang berbeda.

Pola pemetaan peran yang sudah ada dan bisa ditiru: `finance.canVoteBermasalah`.

### 4.2 Tiga konsekuensi buka-ulang yang WAJIB ikut dibangun

1. Buka-ulang adalah **TRANSISI di mesin status**, dengan **alasan tertulis
   wajib**, masuk `audit_log` — bukan `UPDATE` diam-diam.
2. Angka beku **TIDAK dihapus** saat dibuka — ia jadi **versi**, supaya "berapa
   angkanya waktu ditutup pertama kali" tetap bisa dijawab selamanya.
3. Tutup-ulang membekukan angka **BARU**, dan **selisih antar versi harus bisa
   ditampilkan**. Tanpa ini, buka-tutup jadi cara mengubah angka keuangan yang
   tidak meninggalkan jejak.

### 4.3 ⚠️ Satu turunan yang MASIH ASUMSI — belum diketok

**Jurnal koreksi** di bulan berjalan dibatasi ke peran yang **sama dengan
penutup**. Memperlebarnya berarti orang yang tidak boleh menutup buku tetap bisa
mengubah angkanya lewat pintu samping.

**Tanyakan ini SEBELUM mendaftarkan mesin statusnya.** Sesudah didaftarkan, ia
jadi transisi yang tercatat di `audit_log` dan tidak bisa ditarik.

### 4.4 Urutan membangun

1. Tabel bulan-tertutup + **angka yang dibekukan** per bulan, **berversi**
   (§4.2 nomor 2). Mesin laporan membaca bulan tertutup dari sini, BUKAN
   menghitung ulang dari data mentah.
2. Mesin status tutup-buku (`sm_machines` 31 → 32), **dua gerbang peran**.
3. Jalur **jurnal koreksi** di bulan berjalan, ikut `audit_log`.
4. Pagar di **DB**, bukan hanya TS: bulan tertutup menolak tulisan apa pun.
5. Tampilan selisih antar versi angka beku.

Mesin accrual sudah memenuhi syaratnya: **deterministik dan bebas jam**, jadi
angka beku bisa diadu dengan hasil hitung ulang kapan saja.

---

## 5. Verifikasi — perintah + angka acuan TERKINI

```
service postgresql start
su postgres -c "psql -c \\"ALTER USER postgres PASSWORD 'postgres';\\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm run typecheck --workspaces --if-present
npx vitest run --root packages/core
npx vitest run --root packages/db
npx vitest run --root packages/domain      # SENDIRIAN, sesudah db-rebuild
npx vitest run --root apps/api
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build && npm run lint
cd ../web-client-portal && npx vitest run
```

| Suite | Angka acuan |
|---|---|
| core | **983** |
| db | 53 |
| domain | **2016** (+1 skip) |
| apps/api | **492** |
| web-internal | 650 |
| web-client-portal | 19 |
| migrasi `db-rebuild` | **195** |
| migrasi **live** | **192** (kurang 4 Feedback OD — §2.3) |

### Jebakan — yang paling mahal lebih dulu

- ⚠️ **JANGAN pernah menjalankan dua `db-rebuild` bersamaan.** Terjadi sesi ini:
  dua job latar me-rebuild DB sementara suite berjalan, hasilnya **1055 tes
  merah** — angka yang terlihat seperti bencana dan sepenuhnya palsu.
  Dijalankan ulang berurutan: 2016 hijau. **Rebuild dulu, sendirian, baru cari
  bug.**
- ⚠️ **Postgres mati sendiri TIGA KALI sesi ini**, dan sekali membuat
  `db-rebuild` gagal dengan pesan yang terlihat seperti cacat migrasi.
  `pg_isready` dulu; `service postgresql start` menyelesaikannya.
- ⚠️ **`cd web-internal && npm install` TERPISAH dari `npm install` root.** Tanpa
  itu `xlsx` tidak ada dan `report-shopee-parse.test.ts` gagal **collect** —
  tampil sebagai "2 test file gagal" padahal 1 tes yang merah.
- ⚠️ **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`.**
- `audit_log` menolak DELETE; `client_pitch_consents` menolak UPDATE/DELETE.
- `rm -rf web-internal/.next` kalau muncul *"Another next build process is
  already running"*.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

---

## 6. Aturan rilis — yang terbukti sesi ini, dipakai apa adanya

Urutan yang dijalankan dan berhasil:

> **merge → tunggu TIGA deploy Vercel PRODUKSI `READY` di commit merge →
> `apply_migration` per berkas → verifikasi lewat kueri → baru simpulkan.**

⛔ **JANGAN `supabase db push`** — ledger live memakai stempel APPLY, berbeda
*wholesale* dari nama berkas repo (`O65`, masih terbuka).

⛔ **Jangan percaya `success: true`.** Setiap apply sesi ini diverifikasi lewat
kueri katalog/data, dan itulah yang membuktikan angkanya benar.

**Migrasi yang SUDAH di-apply ke live tidak boleh disunting.** Perbaikan atasnya
= migrasi BARU. (Migrasi 191 sempat DITULIS ULANG di tempat sesi ini — itu sah
**hanya** karena ia belum pernah menyentuh live. Sekarang sudah; pintu itu
tertutup.)

---

## 7. Aturan kerja — dua yang BARU dari sesi ini

Sepuluh aturan sebelumnya tetap berlaku (`HANDOFF_GELOMBANG_D_20260907.md` §8 +
`HANDOFF_GELOMBANG_D_ACCRUAL_20260908.md` §7).

11. **Mutasi yang tetap HIJAU punya tiga kemungkinan jawaban, bukan dua:**
    kodenya berlebihan, tesnya bohong, atau — yang paling mahal — **field itu
    memang tidak pernah terpakai**. Yang ketiga terjadi dua kali sesi ini, dan
    keduanya bug. **Wajib dijelaskan, tidak boleh diabaikan.**

12. **Uji-kering backfill ke data live SEBELUM apply menemukan hal yang tidak
    bisa ditemukan dengan membaca kode.** Uji-kering D-4 memunculkan transaksi
    keempat yang join-nya sempat menyapu masuk, dan menunjukkan hasil pisahnya
    akan jadi 2,4% bukan 11%. Yang menemukannya satu `SELECT` read-only, bukan
    review. **Backfill apa pun ke live: uji-kering dulu, dan periksa
    invariant-nya, bukan cuma jumlah barisnya.**

---

## 8. Yang masih BELUM dibuktikan — disebut jujur

- **Nol field baru sesi ini pernah dibuka di peramban.** Dropdown **Kapan
  Pendapatan Diakui**, **Durasi Jasa (bulan)**, **Kalau Klien Beli Lebih dari
  Satu**, dan tombol **Include PPN** (di kalkulator Sales DAN form closing).
  Semuanya lolos `tsc`, `vitest`, `next build`, `lint`, gerbang shape-parity, dan
  rutenya diuji — **yang terbukti kontraknya, bukan tata letaknya.** Utang ini
  sekarang **empat field**.
- **`/showcase` di peramban** — utang lama Gelombang C, masih belum dibayar.
- **Mesin accrual belum punya pemanggil** (§3).
- **Penurun riwayat hold untuk layanan belum ada** (§3).
- **Jurnal koreksi D-3 masih asumsi** (§4.3).
- **Empat migrasi Feedback OD belum di-live sementara kodenya sudah ter-deploy**
  (§2.3) — perlu diberitahukan ke pemilik pekerjaan itu.
