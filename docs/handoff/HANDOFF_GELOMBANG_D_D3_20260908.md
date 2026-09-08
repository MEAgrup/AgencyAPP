# Handoff — **Gelombang D SELESAI di kode. D-3 dibangun penuh; belum di live.**

> **Baca berurutan:**
> 1. `HANDOFF_GELOMBANG_D_LIVE_20260908.md` — posisi live sebelum sesi ini
>    (D-KOM & D-4 sudah mendarat, D-3 masih nol baris).
> 2. `docs/DECISIONS.md` — **tujuh baris `Decided` baru bertanggal 2026-09-08**.
>    Dua di antaranya bertanda 🔴 (temuan keamanan) dan satu 🟠 (utang yang
>    disebut, bukan diklaim beres). Jangan lewati ketiganya.
> 3. `docs/STATE_MACHINES.md` §22 — mesin `book_period`.

---

## 1. Posisi

| | Status |
|---|---|
| Gelombang A · B · C | ✅ tutup |
| D-KOM · D-1 · D-2 · D-4 | ✅ **di live** sejak 2026-09-08 |
| **D-3 — kunci tutup buku** | ✅ **dibangun penuh di `main`-branch kerja, BELUM di live** |

**Nol pertanyaan terbuka tersisa di Gelombang D.** Asumsi terakhir (siapa boleh
menulis jurnal koreksi) diketok pemilik 2026-09-08.

---

## 2. Apa yang dibangun

Lima migrasi (satu di antaranya **pasca-deploy**), satu modul domain, enam rute, satu halaman.

| Migrasi | Isi |
|---|---|
| `20260925010000_d3_gerbang_edge_bertingkat` | `sm_edges.require_director` + `require_division`; `sm_transition` parameter ke-11 `p_role_division`; versi 10-argumen **dibuang**; `wrr_monday_job` & `leads_unrespon_tick` ditulis ulang; ACL + `SECURITY DEFINER` dipulihkan |
| `20260925020000_d3_tutup_buku` | `book_periods` (PK = bulan) + `book_period_snapshots` (berversi, immutable) + mesin **#33** `book_period` + `periode_tertutup(date)` + `bulan_indonesia(date)` + trigger `trg_bp_jaga_transisi` |
| `20260925030000_d3_pagar_bulan_tertutup` | `jaga_periode_tertutup()` dipasang di `payment_verifications.received_date` & `installments.verified_date` — menolak **tiga** arah |
| `20260925040000_d3_services_qty` | `services.qty` NULLABLE + backfill yang hanya menyentuh yang bisa dibuktikan |
| `20260925050000_d3_buang_sm_transition_lama` | **Diterapkan SESUDAH deploy kode.** Membuang `sm_transition` 10-argumen |

Kode: `packages/domain/src/tutupbuku.ts` (+ tes 29 kasus), rute di
`apps/api/src/app/api/v1/finance/tutup-buku/**`, halaman
`/finance/tutup-buku`, klien `web-internal/src/lib/tutupbuku.ts`.

### Wewenang, sekali lagi karena ini yang paling mudah salah dibangun

| Aksi | Siapa | Ditegakkan di |
|---|---|---|
| **Menutup** bulan | Finance lead **ATAU** Director | `sm_edges.require_lead=true` + `require_division='Finance'` |
| **Membuka kembali** | **Director SAJA** | `sm_edges.require_director=true` |
| **Jurnal koreksi** | sama dengan yang menutup | `tutupbuku.bolehJurnalKoreksi` |

---

## 3. ✅ SUDAH DI LIVE — rilis D-3 dieksekusi 2026-09-08

**Selesai.** PR #313 merged sebagai `be1877b`; kelima migrasi D-3 ada di live.
Ledger live sekarang **207 migrasi**.

### Yang benar-benar dijalankan, berurutan

| # | Langkah | Hasil |
|---|---|---|
| 1 | apply `20260925010000` | dua overload `sm_transition` hidup berdampingan (10 **dan** 11 argumen) |
| 2 | apply `20260925020000` | 146→148 tabel, 31→32 mesin |
| 3 | apply `20260925030000` | dua trigger pagar terpasang — **inert** sampai ada bulan ditutup |
| 4 | apply `20260925040000` | 18 dari 21 layanan terisi qty |
| 5 | merge PR #313 → tiga deploy produksi `READY` di `be1877b` | api, web-internal (`app.meagency.co.id`), portal |
| 6 | apply `20260925050000` | overload 10-argumen dibuang; tersisa **tepat satu**, 11 argumen |

Jendela merahnya **nol**: selama langkah 1–5 kode lama tetap menemukan fungsi
10-argumennya, dan sejak langkah 5 kode baru menemukan yang 11.

### Yang diverifikasi, dan caranya

Bukan dari `success: true` — setiap langkah diadu ke katalog:

- **Badan fungsi disamakan byte-per-byte dengan berkas repo.** `md5(prosrc)`
  live vs DB lokal hasil `db-rebuild` cocok persis untuk kelima fungsi D-3
  (`sm_transition` 11-arg `3b04c492…`, `jaga_transisi_book_period`
  `28d5fd9c…`, `jaga_periode_tertutup`, `periode_tertutup`,
  `bulan_indonesia`). Ini yang menangkap satu penyimpangan nyata: transkripsi
  pertama `jaga_transisi_book_period` **memangkas komentar di dalam badannya**.
  Logikanya identik (md5 tanpa komentar sama di kedua sisi) tapi sumbernya
  beda — dipulihkan lewat migrasi tambahan, karena komentar itulah yang
  menjelaskan kenapa yang dibandingkan **waktunya**, bukan nomor versinya.
  Perbaikan itu **tidak menambah berkas di repo**: `20260925020000` memang
  sudah memuat versi ber-komentar, jadi `db-rebuild` menghasilkan fungsi yang
  identik. Yang bertambah hanya satu entri di ledger live — dan ledger itu
  sudah lama tidak sejajar dengan nama berkas (O65).
- **Menimpa dua job SQL tidak mengubur pekerjaan siapa pun.** `wrr_monday_job`
  dan `leads_unrespon_tick` versi live diadu dengan versi repo SESUDAH argumen
  ke-11 dicabut kembali: cocok persis (`0de0d523…`, `bc44c472…`). Yang berbeda
  hanya komentar — salinan live-nya memang tersimpan tanpa komentar.
- **Keamanan.** `sm_transition` sekarang `prosecdef = true` dengan
  `proacl = {postgres=X, service_role=X}` — `anon` dan `authenticated` **tidak**
  bisa memanggilnya.
- **Uji-kering backfill qty dijalankan ke live SEBELUM apply, dan yang
  diperiksa invariannya, bukan jumlah barisnya.** Ketiga nilai non-1 cocok
  persis dengan rasio harganya (21↔21, 99↔99, 6↔6). Dari 14 layanan `durasi`,
  **satu** sengaja dibiarkan NULL: `SVC-202609-0003`, layanan nego berasio 0,8
  — persis kasus yang membuktikan rumus harga tidak aman.
- **Asap sesudah DROP.** `sm_transition` dipanggil dengan entity id yang
  sengaja tidak ada; ia menjawab `not_found`, artinya fungsi 11-argumen
  ter-resolve dan berjalan melewati lookup mesin, tipe kolom id, dan row lock.
  Nol tulisan.
- Sebelum DROP: katalog dipindai untuk pemanggil `sm_transition` yang tersisa.
  Hanya dua job itu, dan keduanya sudah 11-argumen.

### Yang MASIH belum di live, dan itu bukan pekerjaan sesi ini

- **dua migrasi M18 Store Operation** (`20260924010000`, `20260924020000`).
  Kodenya sudah di `main`, migrasinya belum diterapkan. Karena itu live
  **148 tabel / 32 mesin**, sedangkan repo `db-rebuild` menghasilkan
  **149 / 33** — selisihnya persis M18, dan itu **bukan drift**, itu utang
  jalur lain. Pemilik menginstruksikan sesi ini tidak menyentuh migrasi di
  luar pekerjaannya.

⛔ **JANGAN `supabase db push`** (ledger live memakai stempel APPLY — O65).
⛔ **Jangan percaya `success: true`.** Verifikasi lewat kueri.

### Yang BELUM diverifikasi, dan jujur disebut

- **Halaman `/finance/tutup-buku` belum pernah dibuka di peramban.**
- **Gerbang dua tingkat belum pernah diuji di live.** Ia butuh baris
  `book_periods` yang nyata untuk sampai ke pemeriksaan gerbangnya, dan
  menanam baris uji di tabel keuangan produksi bukan harga yang pantas
  dibayar. Yang sudah ada: 29 tes domain hijau (gerbangnya dibuktikan bisa
  merah lewat mutasi) + data edge di live diverifikasi lewat kueri
  (`[Terbuka]→[Tertutup]` = lead+Finance, `[Tertutup]→[Terbuka]` = director).
- **Angka D-3 belum pernah dihitung atas data live.**

---

## 4. Verifikasi — perintah + angka acuan TERKINI

```
pg_isready || service postgresql start
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
| core | **985** |
| db | 64 |
| domain | **2188** (+1 skip) |
| apps/api | **494** |
| web-internal | **695** |
| web-client-portal | 19 |
| migrasi `db-rebuild` | **209** |
| tabel public | **149** · sm_machines **33** · entity_prefix 41 · notif_events 73 |
| migrasi **live** | **192** (kurang 4 Feedback OD + 5 D-3) |

### Jebakan — yang paling mahal lebih dulu

- ⚠️ **JANGAN jalankan dua `db-rebuild` bersamaan**, dan jangan jalankan suite
  domain dua kali tanpa rebuild di antaranya. Tes yang menghitung baris akan
  menghitung jejak run sebelumnya dan gagal dengan angka yang terlihat seperti
  bencana. Terjadi lagi sesi ini.
- ⚠️ **Postgres mati sendiri.** Terjadi dua kali lagi sesi ini. `pg_isready`
  dulu; `service postgresql start` menyelesaikannya.
- ⚠️ **Pembersihan fikstur bisa DITOLAK pagar bulan tertutup.** Baris bertanggal
  di bulan tertutup tidak boleh dihapus — termasuk oleh tes. Buka periodenya
  dulu (`bersihkanPeriode()` di `tutupbuku.test.ts`), baru bersihkan baris uang.
- ⚠️ `cd web-internal && npm install` TERPISAH dari `npm install` root.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

---

## 5. Aturan kerja — tiga yang BARU dari sesi ini

Dua belas aturan sebelumnya tetap berlaku.

13. **Constraint yang tidak punya urutan tulis yang sah bukan penjaga, ia jalan
    buntu.** Ini sudah tertulis di `ck_crp_cabut_lengkap` (20260908010000) dan
    **tetap terulang** di sesi ini: dua CHECK `book_periods` saling mengunci
    sehingga penutupan pertama mustahil dari dua arah. Yang menemukannya bukan
    review, melainkan `psql` — sepuluh baris SQL yang menjalankan alurnya.
    **Setiap constraint yang mengikat KOMBINASI kolom wajib dijalankan
    alurnya, bukan dibaca.**

14. **Mengganti tanda tangan fungsi SQL memutus pemanggil yang tidak bisa
    di-`grep` dari TypeScript — dan tanda tangan baru adalah FUNGSI baru, jadi
    menambah + membuang dalam satu migrasi adalah pemadaman, bukan perubahan.** PL/pgSQL me-resolve nama saat EKSEKUSI, jadi
    `wrr_monday_job` dan `leads_unrespon_tick` patah **tanpa satu pun migrasi
    menolak** — dan patahnya muncul sebagai 23 tes merah yang tidak menyebut
    sebabnya. Sebelum mengubah fungsi SQL: `select proname from pg_proc where
    prosrc like '%nama_fungsi(%'`.

15. **`CREATE OR REPLACE FUNCTION` membuang atribut yang tidak disebut ulang;
    `DROP FUNCTION` membuang ACL.** Dua cara berbeda untuk melonggarkan
    keamanan tanpa satu baris pun yang terlihat seperti perubahan keamanan.
    `rls_checks` tidak memeriksa fungsi. Sesudah menyentuh fungsi apa pun:
    bandingkan `prosecdef` dan `proacl` terhadap saudara-saudaranya.

---

## 6. Yang masih BELUM dibuktikan — disebut jujur

- **Halaman `/finance/tutup-buku` belum pernah dibuka di peramban.** Ia lolos
  `tsc`, `vitest`, `next build`, `lint`, gerbang shape-parity DAN body-parity,
  dan rutenya diuji — **yang terbukti kontraknya, bukan tata letaknya.**
  Utang FE sekarang **lima layar/field**: empat dari sesi sebelumnya (Durasi
  Jasa, Kalau Klien Beli Lebih dari Satu, Kapan Pendapatan Diakui, Include PPN)
  plus layar ini.
- **`/showcase` di peramban** — utang lama Gelombang C, masih belum dibayar.
- **`services.standard_price` belum dijaga pagar bulan tertutup** — 🟠 di
  `DECISIONS.md`. Ini lubang nyata, bukan detail.
- **Mesin accrual sekarang PUNYA pemanggil** (`tutupbuku.hitungAngkaPeriode`),
  jadi utang §3 handoff sebelumnya lunas. Tapi **penurun riwayat hold hanya
  ada untuk `service`** — belum untuk kontrak.
- **Angka D-3 belum pernah dihitung atas data LIVE.** Semua tes memakai
  fikstur. Begitu migrasinya mendarat, hitung satu bulan lampau dan **baca
  daftar `tidak_terhitung`-nya** sebelum menutup apa pun.
- **Empat migrasi Feedback OD masih belum di live sementara kodenya sudah
  ter-deploy** — perlu diberitahukan ke pemilik pekerjaan itu.
