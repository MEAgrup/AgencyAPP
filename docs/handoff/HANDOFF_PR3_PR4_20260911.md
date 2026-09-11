# Handoff — PR-3 & PR-4 SELESAI, tersisa PR-5 (2026-09-11)

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
| **PR-3** | Bagian 3 — Laporan Penjualan (Finance & Head Sales) | ✅ **SELESAI sesi ini.** Migrasi `20261002010000` **SUDAH di live** (O65) — dibuktikan lewat kueri, bukan `success: true`. PR #342 |
| **PR-4** | Bagian 1 — Adopsi Sistem (jam pemakaian tools) | ✅ **SELESAI sesi ini.** Migrasi `20261003010000` **SUDAH di live** (O65), dibuktikan lewat kueri. PR #342 |
| **PR-5** | Bagian 4 — Layanan multi-platform (⚠️ jalur uang) | ⬜ **satu-satunya yang tersisa**, ketokannya SUDAH ada (`DECISIONS.md` 2026-09-10) |

**222 migrasi** di repo, **ledger live 224**. Selisih 2 itu normal dan sudah lama
(satu duplikat `m6a_section_d` + satu allowlist `A2-DRIFT`) — diperiksa ulang
sesi ini lewat gerbang per-slug yang sama: **nol MISSING**, satu EXTRA dan ia
memang yang ada di `scripts/known-live-drift.txt`.

Gate: **156 tabel** · 43 prefix · 34 mesin · 73 event. Tabel bergerak 155→156
untuk PR-4 (`page_views`); `scripts/db-rebuild.sh`, `.github/workflows/ci.yml`
dan `supabase/tests/rls_checks.sql` §9 ikut diperbarui. Migrasi PR-3 nol
tabel/kolom/prefix/mesin/event. Advisors `security` live **29/1/8/3/1** — +1
INFO dibanding baseline, dan itu tepat `public.page_views` (memang tanpa
policy, disengaja).

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

## 3b. Apa yang PR-4 benar-benar mengubah (Adopsi Sistem)

Permintaan pemilik verbatim: *"Dari log page-view, sesi = aktivitas beruntun,
**gap > 30 menit memulai sesi baru**. Kolom: Bulan · Anggota · Role · Jam/Bulan
· Sesi · Page View. Plus baris persentase penggunaan fitur untuk role-nya."*
Ketokan #3: **cakupan fitur role** — % menu yang boleh diakses role itu yang
benar-benar pernah dibuka bulan itu.

### 🔑 Satu kalimat pemilik yang membentuk SELURUH modul

> **"Indikator adaptasi tim ke sistem baru — bukan komponen reward."**

Itu bukan catatan kaki. Ia memutuskan tiga hal, dan **kalau salah satunya
dibongkar, kalimat itulah yang harus dibantah lebih dulu**:

1. **Nol peringkat, nol skor, nol ambang.** `adopsi.ts` mengembalikan angka
   mentah dan berhenti. Nol sambungan ke `performance.ts` (M14), nol kontribusi
   ke Health/Speed Score, nol notifikasi.
2. **Gerbangnya OD/Director saja.** Lead divisi ditolak, **termasuk lead HR** —
   mengelola siapa yang bekerja bukan hal yang sama dengan melihat berapa jam
   tiap orang membuka aplikasi.
3. **Jam yang dilaporkan sengaja KURANG**, tidak pernah dikarang.

### Isinya

| | |
|---|---|
| Migrasi | `20261003010000_adopsi_page_views.sql` — tabel `page_views`, append-only, terkunci PENUH dari `authenticated` (pola O51) |
| Domain | `packages/domain/src/adopsi.ts` — `sessionize` (murni), `recordPageView`, `adopsiReport`, `canViewAdopsi`, `canRecordPageView` |
| API | `POST /adopsi/page-view`, `GET /adopsi` |
| FE | `AdopsiTracker` (nol render) di `(shell)/layout.tsx`, halaman `/admin/adopsi`, `navFeatureOf`/`navTotalFor` di `nav.ts` |

### Lima jebakan yang sudah ditutup — jangan buka lagi

1. **`GET /adopsi` TIDAK boleh pakai `readAsActor`.** `page_views` terkunci dari
   `authenticated`, jadi `readAsActor` menabrak 42501 dan halamannya menjawab
   **500**. Itu benar-benar terjadi saat tes rute ini pertama dijalankan. Ia
   memakai `db()` + gerbang domain, pola `strategi_share_*`. **Konsekuensinya:
   di rute itu RLS BUKAN penegaknya** — `canViewAdopsi` lah penegaknya, dan ia
   diperiksa SEBELUM `db()` disentuh.
2. **`employee_id` tidak pernah datang dari badan permintaan.** Ia diambil dari
   klaim JWT. Ada tes yang mengirim `employee_id` palsu dan meng-assert baris
   yang lahir tetap milik aktornya — itu satu-satunya alasan angka laporan ini
   bisa dipercaya sama sekali.
3. **Query string DIBUANG sebelum ditulis.** Ia memuat isi filter: nama klien,
   id karyawan, kata kunci pencarian. Menyimpannya berarti membangun log
   pencarian per-orang yang tidak diminta siapa pun. Ada tesnya.
4. **Rute perekam tidak pernah menolak.** `path` panjang dipotong, `navTotal`
   negatif dijepit ke 0, badan cacat tetap **201**. Ia dipanggil dari lapisan
   shell setiap halaman; sebuah 400 di situ muncul sebagai galat pada halaman
   yang sebenarnya baik-baik saja.
5. **Satu baris per RUTE, bukan per render.** `AdopsiTracker` menyimpan rute
   terakhir di `useRef`. Tanpa itu "Page View" mengukur jumlah render, bukan
   jumlah kunjungan. Ia juga **menunggu `role` termuat** — `navTotalFor(null)`
   mengembalikan item universal (kecil tapi bukan nol), dan melapor dengan
   penyebut itu menggelembungkan cakupan fitur.

### Kenapa `nav_href`/`nav_total` datang dari KLIEN

Cakupan fitur butuh dua angka: berapa menu dibuka, dan berapa menu **boleh**
dibuka. Yang kedua hanya diketahui satu tempat — `visibleNav(role)` di
`web-internal/src/lib/nav.ts` — dan gerbangnya adalah **fungsi**
(`ownedBy(...)`, `divisionQueue(...)`, `canUseSkuScreener`), bukan data.
Menyalinnya ke server menciptakan versi kedua dari aturan yang sama, dan versi
kedua itu menyimpang diam-diam.

**Konsekuensinya dinyatakan, bukan disembunyikan:** pemanggil yang membuat
permintaannya sendiri bisa melaporkan `nav_total` palsu dan menggeser cakupan
fitur **dirinya sendiri**. Itu bisa diterima justru karena angka ini bukan
komponen reward — tidak ada yang didapat dari memalsukannya. Kalau suatu hari
ia jadi komponen penilaian, penyebutnya **harus pindah ke server**.

`nav_total` disimpan **per baris**, bukan dihitung saat laporan dibaca: permukaan
fitur berubah, dan menghitung cakupan Agustus dengan penyebut hari ini membuat
angka masa lalu bergerak setiap kali kita merilis apa pun.

### ⚠️ TIDAK ADA DATA HISTORIS — dan layarnya mengatakannya sendiri

Repo ini **nol telemetri** sampai migrasi ini. Baris pertama lahir dari tanggal
deploy; contoh `2026-08` pada permintaan pemilik **tidak bisa direproduksi
surut**. `adopsiReport` mengembalikan `mulaiTercatat` (tanggal baris paling
awal, **tidak** ikut difilter periode) justru supaya halaman bisa menyatakan:
bulan sebelum tanggal itu kosong karena **belum ada pencatatan**, bukan karena
sistem tidak dipakai. Tanpa kalimat itu, laporan yang benar terbaca seperti
tuduhan.

### Kenapa jam-nya kurang, dan kenapa itu tetap sahih

Durasi sesi = (page-view terakhir − pertama). Sesi berisi SATU page-view
berdurasi **0**; halaman terakhir sesi mana pun menyumbang **nol**. Tidak ada
sumber di CDPS yang tahu berapa lama halaman terakhir dibaca. Mengarang
"asumsikan 3 menit" menghasilkan angka yang **tidak bisa dihitung ulang dari
log** (aturan rumah #4), lalu angka karangan itu dikutip di rapat seolah ia
pengukuran.

Kekurangannya **seragam** untuk semua orang, jadi PERBANDINGAN antar-anggota
dan antar-bulan — yang justru pemilik minta — tetap sahih. Kalau suatu hari
angka absolutnya harus benar, jalannya heartbeat dari tab terbuka (Page
Visibility API): **sumber BARU, bukan asumsi baru**.

---

## 4. Angka verifikasi (PR-3 + PR-4)

```
db-rebuild.sh --yes   222 migrasi bersih
gate                  156 tabel · 43 prefix · 34 mesin · 73 event  (+ seed 11 karyawan / 14 role_mappings)
invariant SQL         ident ✓  immutability ✓  rls ✓  auth_claims ✓
packages/domain       2434 lolos + 1 skip
packages/core         985 lolos
packages/db           98 lolos
apps/api              509 lolos   (termasuk route/body/shape/page-parity)
web-internal          757 lolos
typecheck             bersih, 5 target
lint web-internal     3 error + 61 warning — IDENTIK baseline, semuanya pre-existing
drift repo↔live       nol MISSING; satu EXTRA = `d3_tutup_buku_pulihkan_komentar_jaga_transisi` (A2-DRIFT, sudah di allowlist)
```

**Live `CDPS SG`, dibuktikan lewat kueri (bukan `success: true`):**

| | |
|---|---|
| gate | 156 tabel · 43 prefix · 34 mesin · 73 event |
| ledger | 222 → **224** |
| `services_select` | Head Sales **0 → 31** baris; Sales staff **0**; lead Creative **0** |
| `page_views` | 0 policy · 2 trigger aktif · RLS aktif · klaim Director **DITOLAK** (42501) · UPDATE & DELETE menggigit dua arah · 0 baris tersisa |
| advisors `security` | **29**/1/8/3/1 — +1 INFO dibanding baseline, tepat `public.page_views` (memang tanpa policy, disengaja) |

⚠️ **Dua tes domain memerah kalau suite dijalankan tanpa `db-rebuild` lebih
dulu** (`admin.test.ts` hari libur, `client.test.ts` Hold Service): `audit_log`
append-only, jadi cacahan per `entity_id` menumpuk antar-run. Itu perilaku
terdokumentasi, bukan regresi — dan sesi ini mengalaminya lalu membuktikannya
dengan rebuild + rerun (2434 lolos).

---

## 5. 🟠 Yang masih menggantung untuk pemilik (bukan kode)

Empat hal, dan dua di antaranya membuat fitur yang SUDAH jadi terbaca seperti
tidak jalan kalau tidak dikerjakan:

1. **🔴 `role_mappings` → divisi `Finance`.** Gerbang Laporan Penjualan membaca
   `division = 'Finance'` dari klaim JWT. Kalau nol karyawan ter-map ke
   `Finance`, laporannya praktis Director/OD/Sales-only — dan itu akan terbaca
   seperti fiturnya tidak jalan. **Periksa ini sebelum UAT.**
2. **🔴 `role_mappings` → divisi `HR`** (warisan PR-1, masih terbuka). Nol baris
   nyata menunjuk divisi `HR`, jadi mutasi & resign praktis Director-only sampai
   Director membuat pemetaan riilnya lewat `/admin/role-mappings`.
3. **Ketokan `PR4-SIAPA-BOLEH-LIHAT`** (`DECISIONS.md` Open): apakah lead divisi
   boleh membuka Adopsi Sistem untuk divisinya sendiri. Yang ter-implementasi
   adalah bacaan paling sempit (OD/Director saja), dipilih begitu karena
   **melebarkannya nanti aditif, sedangkan mencabutnya tidak** — begitu jam
   pemakaian anak buah sudah dilihat, ia tidak bisa di-unlihat.
4. **UAT peramban belum dijalankan** untuk kedua PR (lihat §6).

---

## 6. Langkah berikutnya yang konkret

### 6a. UAT peramban — PR-3 (`/sales/kinerja`)

Empat aktor, plus Director sebagai pembanding. Yang harus terlihat, dan yang
memerah kalau ada yang salah:

- **Finance staff & lead** — HANYA tab *Laporan Penjualan* yang muncul; tab lain
  tidak ada. Rekap Layanan **terisi**.
- **Head Sales** — semua tab muncul, dan Rekap Layanan **terisi** (inilah yang
  migrasi `20261002010000` tutup; sebelum itu kosong tanpa galat).
- **Sales staff** — hanya barisnya sendiri, di tab Laporan maupun Per Sales.
- Tombol **Ekspor CSV** menghasilkan berkas yang isinya sama dengan layar, dan
  baris `TOTAL` ada **di dalam berkasnya**.
- Kolom **Total Sales (deal)** muncul di KEDUA tab.

### 6b. UAT peramban — PR-4 (`/admin/adopsi`)

- **OD & Director** — menu *Adopsi Sistem* muncul di seksi Admin, halamannya
  terbuka.
- **Lead divisi mana pun (termasuk HR & Finance)** — menu TIDAK muncul, dan
  membuka URL-nya langsung memberi pesan tanpa akses.
- Setelah beberapa orang memakai sistem sehari, barisnya muncul dengan `Jam`,
  `Sesi`, `Page View`, dan `Cakupan Fitur` terisi.
- Kalimat **"Pencatatan dimulai …"** muncul di atas tabel — itu bagian dari
  fiturnya, bukan hiasan.

### 6c. PR-5 — layanan multi-platform (⚠️ JALUR UANG), satu-satunya yang tersisa

Ketokannya **sudah ada** (`DECISIONS.md` 2026-09-10), jadi tidak perlu bertanya
lagi:

- **`qty`** = lebih banyak unit layanan yang sama **di toko yang sama**;
- **baris kedua** = **toko/platform yang berbeda**, masing-masing ber-`store_link`
  sendiri;
- **`uq_qfs` TIDAK dicabut** — kuncinya diperlebar dari
  `(attempt_id, master_service_id)` menjadi
  `(attempt_id, master_service_id, platform)`.

🔴 **Urutan pekerjaannya WAJIB: perlebar kunci join `loadApprovedLines`
(`sales.ts:1964`, tambah `platform`) LEBIH DULU, baru `uq_qfs`.** Terbalik, atau
salah satunya saja, dan bug penggelembungan `total_agreed_value` hidup di
jendela di antaranya — **tanpa galat di mana pun**. Penjaganya harus tes yang
menutup satu deal dua-platform dan meng-assert `total_agreed_value` **tepat
2×**, bukan 4×: tes yang hanya meng-assert "dua baris tercatat" akan HIJAU di
atas join yang mekar.

Utang yang PR-5 tutup sekalian (sudah tercatat `DECISIONS.md` 2026-08-27):
`qualified_forms.platform` adalah string koma-gabungan, dipecah lagi di
`close()` (`sales.ts:1795-1800`) — tapi setiap baris `client_platforms`
mendapat `store_link` yang SAMA.

### 6d. Pertimbangkan `PR3-RNW-TRX` sebelum perpanjangan pertama di produksi

Lihat §2. Setelah perpanjangan pertama dieksekusi, laporan mulai **kurang**
melaporkan penjualan nyata — dan itu tidak akan memberi galat apa pun.

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
