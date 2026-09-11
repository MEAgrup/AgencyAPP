# Handoff — PR-3 SELESAI (Laporan Penjualan), lalu PR-4 & PR-5 (2026-09-11)

> **Baca ini lebih dulu.** Ia menggantikan §0 dan §1 dari
> `HANDOFF_ADOPSI_HR_LAPORAN_20260910.md` (sesi pertama) dan handoff sesi kedua,
> yang tetap berguna untuk §0 permintaan verbatim pemilik, §1 ketokan, dan §6
> temuan riset.
>
> Berkas ini menyatakan **posisi sebenarnya**: apa yang sudah mendarat DAN sudah
> di live, apa yang belum, dan jebakan apa yang sudah dipetakan supaya sesi
> berikutnya tidak menemukannya lagi dari nol.

## 0. Posisi lima PR

| PR | Bagian | Status |
|---|---|---|
| **PR-1** | Bagian 2 — Mutasi & Resign permanen (HR) | ✅ **MERGED** (`714da1a`). Migrasi di live. UAT empat aktor LOLOS |
| **PR-2** | Bagian 5 — Arsip & hapus Master Service List | ✅ **MERGED** (`ad69586`). Migrasi di live |
| **fix RLS** | (tidak diminta — ditemukan) Head Sales melihat NOL | ✅ **MERGED** bersama PR-2. Migrasi di live |
| **PR-3** | Bagian 3 — Laporan Penjualan (Finance & Head Sales) | ✅ **SELESAI sesi ini.** Migrasi `20261002010000` **SUDAH di live** (O65: apply dulu, merge sesudahnya) — dibuktikan lewat kueri, bukan `success: true` |
| PR-4 | Bagian 1 — Adopsi Sistem (jam pemakaian tools) | ⬜ belum |
| PR-5 | Bagian 4 — Layanan multi-platform (⚠️ jalur uang) | ⬜ belum, **tapi ketokannya SUDAH ada** (`DECISIONS.md` 2026-09-10) |

**221 migrasi** di repo, **ledger live 223**. Selisih 2 itu normal dan sudah lama
(satu duplikat `m6a_section_d` + satu allowlist `A2-DRIFT`) — diperiksa ulang
sesi ini lewat gerbang per-slug yang sama: **nol MISSING**, satu EXTRA dan ia
memang yang ada di `scripts/known-live-drift.txt`.

Gate: **155 tabel · 43 prefix · 34 mesin · 73 event** — tidak bergerak sejak
2026-09-09, dan migrasi sesi ini memang nol tabel/kolom/prefix/mesin/event.
Advisors `security` live **identik baseline 28/1/8/3/1**.

---

## 1. Apa yang PR-3 benar-benar mengubah

### 1a. Laporan Penjualan itu sendiri

`salesperf.salesReport(sql, actor, filter)` → tiga hal dalam satu jawaban:

1. **`rows`** — satu baris per salesperson: `totalDeal`, bauran
   baru/perpanjangan/cross-sell, `klienCount`, `omzet`, `komisiKontrak`,
   `komisiDiakui`. Diurut omzet menurun.
2. **`total`** — baris TOTAL di kaki tabel (ketokan pemilik #4).
3. **`services`** — rekap layanan terjual, per `master_service_id`.

Permukaannya: `GET /sales/report` + `GET /sales/report/export` (CSV), tab
**Laporan Penjualan** di `/sales/kinerja`, dan `/sales/kinerja` kini muncul di
menu Finance.

Kolom **`total_deal`** juga ditambahkan ke tab **Per Sales** — itulah "plus
kolom total sales" pada permintaan pemilik.

### 1b. Gerbangnya DUA, dan itu yang paling penting untuk tidak disatukan

```
canViewSalesPerf    = Sales (level apa pun) | OD | Director
canViewSalesReport  = canViewSalesPerf | Finance (level apa pun)
```

**Jangan pernah menyatukan keduanya.** Finance sengaja TIDAK punya lengan RLS ke
`leads`/`prospect_attempts` (keputusan 2026-09-10, dijaga tes "Finance TIDAK
diberi corong prospek"). Kalau `canViewSalesPerf` dilebarkan ke Finance,
`bySalesperson` menjawab **200** dengan SETIAP kolom corong berisi `0` — bukan
karena tidak ada aktivitas, melainkan karena RLS memotongnya. Itu bentuk
kegagalan yang **persis sama** dengan bug Head Sales yang ditutup sehari
sebelumnya, di layar yang sama.

`reportScopeFor` = `scopeFor` + Finance semua level = seluruh agensi. Sales
**staff** tetap `ownOnly` — laporan ini diminta untuk "Finance & Head Sales",
bukan untuk setiap sales staff, dan RLS pun tidak akan mengizinkannya.

### 1c. Migrasi `20261002010000_rls_services_sales_lead.sql`

Satu lengan: `(jwt_is_lead() AND jwt_division() = 'Sales')` pada
`services_select`.

**Ini membalik catatan yang ditulis kemarin**, dan alasannya ditulis di
migrasinya. Tes migrasi sebelumnya meng-assert `layanan: 0` untuk Head Sales
sebagai **disengaja**: *"rekap layanan adalah permukaan laporan Finance, dan
melebarkan Sales-lead ke sana tidak diminta siapa pun."* Pembacaan itu salah
terhadap permintaan pemiliknya: *"laporan penjualan … **service list** … bisa
diakses **Finance & Head Sales**"* — satu laporan, dua pembacanya, dan
`service list` ada DI DALAM laporan itu.

**Dibuktikan pada data live sebelum diterapkan:** klaim Head Sales melihat
**0 dari 31** baris `services`. Sesudah apply: **31**. Batas atas diperiksa di
live juga — Sales **staff** tetap **0**, lead Creative tetap **0**.

Bukan pelebaran kelas informasi: Head Sales sudah melihat `contracts` +
`client_sales_allocations` se-agensi sejak migrasi kemarin. Yang bertambah
adalah **resolusi**-nya.

---

## 2. 🔴 Bug uang yang ditemukan (dan ditutup) di jalan

**Omzet Kinerja Sales BERLIPAT untuk klien yang pernah diperpanjang.**

`gather` membaca satu baris gabungan `clients ⋈ contracts` dan menambahkan uang
klien **sekali per baris**. Klien yang diperpanjang punya DUA kontrak, tapi
`clients.transaction_id` hanya ditulis SEKALI, oleh `sales.close()`
(`sales.ts:1913`) — `renewal.eksekusi` sengaja tidak menyentuhnya. Kedua baris
membawa transaksi yang SAMA.

**Probe, sebelum sebaris kode ditulis:** satu klien Rp 10.000.000 dengan satu
kontrak ⇒ `omzet 10.000.000,00`; tambahkan satu kontrak `perpanjangan` untuk
klien yang sama — tanpa menyentuh uangnya sama sekali — ⇒ **`20.000.000,00`**.
Tanpa galat, tanpa baris ganda di layar.

**Kenapa ia tidak pernah terlihat:** hampir setiap fixture punya SATU kontrak,
dan filter satu-bulan memisahkan kedua kontrak ke bucket berbeda sehingga tiap
bulan terlihat benar. Yang menggelembung justru **tampilan default halaman
itu** — yang memang tanpa filter periode.

**Perbaikannya** (`loadDealFacts`) memisahkan dua fakta yang berbeda pemiliknya:

| | milik | dikumpulkan per | di-bucket ke |
|---|---|---|---|
| bauran jenis deal + `totalDeal` | KONTRAK | kontrak | `contracts.created_at` |
| omzet + komisi | TRANSAKSI | klien | `transactions.created_at` |

Nol perubahan untuk kasus satu-kontrak: `sales.close()` melahirkan kontrak dan
transaksi dalam SATU transaksi DB, jadi kedua stempel waktu itu identik.

**Diperiksa di live:** **nol** klien `CDPS SG` punya >1 kontrak hari ini. Bug ini
belum pernah menghasilkan satu angka salah pun di depan pemilik — dan sekarang
tidak akan pernah.

Penjaganya `salesperf.test.ts` → *"menambah kontrak perpanjangan TIDAK mengubah
omzet"*, dan ia **dibuktikan menggigit dengan mutasi**: mengembalikan join
per-kontrak membuatnya memerah dengan angka dua kali lipat.

### ⚠️ Yang TERBUKA sesudahnya — baca sebelum menyentuh jalur uang lagi

`DECISIONS.md` baris Open **`PR3-RNW-TRX`**: transaksi milik kontrak
**perpanjangan** tetap tidak terhitung di mana pun, karena tidak ada
`contracts.transaction_id` dan `clients.transaction_id` tidak pernah
dipindahkan (FS-4 menolak pemindahan diam-diam kepemilikan komisi).

Sampai sesi ini, itu tersembunyi di balik bug yang lebih besar. Sesudahnya ia
terlihat apa adanya: laporan sekarang **KURANG** melaporkan perpanjangan alih-alih
**MELIPATGANDAKAN** penjualan pertama — dan yang kedua jauh lebih berbahaya.

Menutupnya berarti migrasi skema pada jalur uang (`contracts.transaction_id`,
diisi `sales.close()` + `renewal.eksekusi`) plus backfill 8 kontrak live, lalu
`loadDealFacts.money` di-bucket per kontrak. **Sengaja tidak ditumpangkan pada
PR laporan** — itu akan jadi satu PR yang tidak bisa di-review sebagai satu hal.

---

## 3. Keputusan bentuk yang jangan dibongkar tanpa alasan baru

1. **Baris TOTAL memakai COUNT(DISTINCT ...), bukan Σ kolom.** Deal yang dijual
   berdua tercatat pada dua baris alokasi. Kolom `total_deal` per orang benar
   bernilai 1 untuk masing-masing; menjumlahkannya ke bawah melaporkan satu deal
   sebagai dua. Uang aman dijumlahkan (sudah pro-rata, Σ `basis_points` = 10000)
   — dan tesnya meng-assert Σ baris == total, sekaligus.
   `renderSalesReportCsv` punya tes yang sengaja memberinya baris **tak
   konsisten** (dua orang × 1 deal, total 1) supaya penjumlahan diam-diam di
   penulis CSV memerah.
2. **Rekap layanan tanpa kolom `qty`.** `nilai` = Σ `standard_price`, yang SUDAH
   subtotal baris (migrasi `20260925040000`) — mengalikannya dengan `qty`
   menghitung ganda. `qty` nullable dan artinya "tidak pernah dicatat", BUKAN 1,
   jadi tidak ada angka jujur yang bisa ditulis di kolom itu untuk baris lama.
3. **Rekap layanan tidak dibobot alokasi.** Pertanyaannya "layanan mana yang
   terjual", bukan "berapa bagian layanan ini milik siapa". Membobotnya
   menghasilkan "2,4 unit Store Management".
4. **Dikelompokkan per `master_service_id`, bukan per `services.name`.** Nama
   adalah snapshot; rename katalog akan memecah satu layanan jadi dua baris.
   Nama yang DITAMPILKAN diambil dari baris Service terbaru.
5. **`?source=`/`?campaign=` tidak diterima rute laporan** — keduanya menyaring
   lewat `leads`, tabel yang Finance tidak boleh baca. Filternya juga tidak
   dirender pada tab Laporan: filter yang terlihat tapi tidak berpengaruh
   membuat pembacanya menyimpulkan angka yang salah.
6. **Ekspor memakai gerbang + filter + `readAsActor` yang SAMA** dengan layarnya.
   Berkasnya tidak pernah bisa berisi lebih dari yang layarnya sudah tampilkan.
   Ini SENGAJA berbeda dari `leads/export` yang Director-only: laporan ini justru
   diminta untuk Finance & Head Sales.
7. **`loadDealFacts` dipakai `gather` DAN `salesReport`.** Ada tes yang
   meng-assert angka per orang IDENTIK antara tab Per Sales dan tab Laporan —
   dua layar yang menyebut omzet berbeda untuk periode yang sama adalah kelas
   bug tersendiri.

---

## 4. Angka verifikasi PR-3

```
db-rebuild.sh --yes   221 migrasi bersih
gate                  155 tabel · 43 prefix · 34 mesin · 73 event  (+ seed 11 karyawan / 14 role_mappings)
invariant SQL         ident ✓  immutability ✓  rls ✓  auth_claims ✓
packages/domain       2414 lolos + 1 skip
packages/core         985 lolos
packages/db           98 lolos
apps/api              503 lolos   (termasuk route/body/shape-parity)
web-internal          748 lolos
typecheck             bersih, 5 target
lint web-internal     3 error + 61 warning — IDENTIK baseline, semuanya pre-existing
live CDPS SG          ledger 222→223, gate tetap 155/43/34/73, advisors security identik 28/1/8/3/1
drift repo↔live       nol MISSING; satu EXTRA = `d3_tutup_buku_pulihkan_komentar_jaga_transisi` (A2-DRIFT, sudah di allowlist)
```

---

## 5. 🟠 Yang masih menggantung untuk pemilik (bukan kode)

1. **`role_mappings` → divisi `HR`** (warisan PR-1, masih terbuka). Nol baris
   nyata menunjuk divisi `HR`, jadi mutasi & resign praktis Director-only sampai
   Director membuat pemetaan riilnya lewat `/admin/role-mappings`.
2. **`role_mappings` → divisi `Finance`.** Gerbang laporan ini membaca
   `division = 'Finance'` dari klaim JWT. Kalau tidak ada karyawan yang
   ter-map ke `Finance`, laporannya praktis Director/OD/Sales-only — dan itu
   akan terbaca seperti fiturnya tidak jalan. **Periksa ini sebelum UAT.**
3. **UAT peramban belum dijalankan** untuk PR-3 (lihat §6).

---

## 6. Langkah berikutnya yang konkret

1. **UAT peramban `/sales/kinerja`** dengan empat aktor: Finance staff, Finance
   lead, Head Sales, Sales staff, plus Director sebagai pembanding. Yang harus
   dilihat, dan yang akan memerah kalau sesuatu salah:
   - Finance: hanya tab **Laporan Penjualan** yang muncul; tab lain tidak ada.
   - Head Sales: **Rekap Layanan terisi** (inilah yang migrasi ini tutup).
   - Sales staff: hanya barisnya sendiri, di tab Laporan maupun Per Sales.
   - Tombol **Ekspor CSV** menghasilkan berkas yang isinya sama dengan layar,
     dan baris `TOTAL` ada di dalamnya.
   - Kolom **Total Sales (deal)** muncul di KEDUA tab.
2. **Lanjut PR-4** (Adopsi Sistem — jam pemakaian tools). Ingat temuan riset
   sesi pertama yang masih berlaku: **nol telemetri di repo**, tidak ada tabel
   page-view, tidak ada middleware di `apps/api`. Preseden terdekat
   `strategi_share_access_log`. Konsekuensi yang WAJIB dinyatakan di UI: tidak
   ada data historis — baris pertama muncul dari tanggal deploy, jadi contoh
   `2026-08` pada permintaan pemilik **tidak bisa direproduksi surut**.
   Dan ketokan pemilik: ini **indikator adaptasi, BUKAN komponen reward**.
3. **Lalu PR-5** (layanan multi-platform, ⚠️ jalur uang). Urutan pekerjaannya
   **WAJIB**: perlebar kunci join `loadApprovedLines` (tambah `platform`) LEBIH
   DULU, baru `uq_qfs`. Terbalik, atau salah satunya saja, dan bug
   penggelembungan `total_agreed_value` hidup di jendela di antaranya — tanpa
   galat. Penjaganya harus tes yang menutup satu deal dua-platform dan
   meng-assert `total_agreed_value` **tepat 2×**, bukan 4×.
4. **Pertimbangkan `PR3-RNW-TRX`** (§2) sebelum perpanjangan pertama dieksekusi
   di produksi. Setelah itu, laporan mulai kurang melaporkan penjualan nyata.

---

## 7. Lingkungan sesi ini (biar tidak dicari ulang)

- **Dependensi tidak terpasang saat sesi dimulai.** `npm ci` di root **dan** di
  `web-internal` (ia BUKAN anggota workspace).
- **Postgres ada tapi mati.** `pg_ctlcluster 16 main start`, lalu
  `ALTER USER postgres WITH PASSWORD 'postgres';`.
  `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"`.
- **Tes domain WAJIB `db-rebuild` dulu.** `audit_log` append-only.
- `npm test --workspaces` **TIDAK** menjalankan `web-internal` — pakai
  `npx vitest run --root web-internal`.
- **Drift repo↔live dari sandbox:** jalur 1 & 2 `check-live-drift.sh` diblok
  egress. Yang bekerja: MCP Supabase. Sesi ini memakai varian yang lebih murah
  daripada jalur 3 (TSV) — **kirim daftar slug repo KE live** dan biarkan
  Postgres menghitung kedua arah selisihnya dalam satu kueri. Logika
  pencocokannya sama (lucuti SATU prefix numerik terkemuka dari kedua sisi).
