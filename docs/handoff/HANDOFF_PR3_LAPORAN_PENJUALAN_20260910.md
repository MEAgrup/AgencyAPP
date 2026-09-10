# Handoff — lanjutan lima fitur pemilik: PR-3, PR-4, PR-5 (2026-09-10, sesi kedua)

> **Baca ini lebih dulu.** Ia menggantikan §2 dan §9 dari
> `HANDOFF_ADOPSI_HR_LAPORAN_20260910.md` (sesi pertama), yang tetap berguna untuk
> §0 permintaan verbatim pemilik, §1 ketokan, dan §6 temuan riset.
>
> Berkas ini menyatakan **posisi sebenarnya**: apa yang sudah mendarat DAN sudah
> di live, apa yang belum, dan jebakan apa yang sudah dipetakan supaya sesi
> berikutnya tidak menemukannya lagi dari nol.

## 0. Posisi lima PR

| PR | Bagian | Status |
|---|---|---|
| **PR-1** | Bagian 2 — Mutasi & Resign permanen (HR) | ✅ **MERGED** (`714da1a`, PR #340). Migrasi di live. UAT empat aktor LOLOS |
| **PR-2** | Bagian 5 — Arsip & hapus Master Service List | ✅ **MERGED** (`ad69586`, PR #341). Migrasi di live |
| **fix RLS** | (tidak diminta — ditemukan) Head Sales melihat NOL | ✅ **MERGED** bersama PR #341. Migrasi di live |
| **PR-3** | Bagian 3 — Laporan Penjualan (Finance & Head Sales) | 🟡 **SEPARUH** — lengan RLS-nya sudah mendarat, isi laporannya BELUM |
| PR-4 | Bagian 1 — Adopsi Sistem (jam pemakaian tools) | ⬜ belum |
| PR-5 | Bagian 4 — Layanan multi-platform (⚠️ jalur uang) | ⬜ belum, **tapi ketokannya SUDAH ada** (`DECISIONS.md` 2026-09-10) |

`main` = `ad69586`. **220 migrasi** di repo, **ledger live 222** (selisih 2 itu
normal dan sudah lama: satu duplikat + satu allowlist `A2-DRIFT`, lihat
`scripts/check-live-drift.sh`).

Gate: **155 tabel · 43 prefix · 34 mesin · 73 event** — tidak bergerak sejak
2026-09-09, dan ketiga migrasi sesi ini memang nol tabel/prefix/mesin/event.

## 1. 🎯 PR-3 — apa yang SUDAH ada dan apa yang belum

### Sudah mendarat (dan sudah di live)

Migrasi `20261001010000_rls_kinerja_sales_lead_finance.sql`:

- lengan `jwt_division() = 'Finance'` di `client_sales_allocations_select`,
  `contracts_select`, `services_select` — **setengah RLS** dari laporan;
- lengan `jwt_is_lead() AND jwt_division() = 'Sales'` di
  `client_sales_allocations_select` — itu **bukan** bagian PR-3, itu perbaikan bug
  (lihat §2);
- penjaga `packages/domain/src/salesperf-scope.rls.test.ts` (8 tes, `withClaims`).

**Konsekuensi penting:** Finance masih **403** di `/sales/kinerja`, dan itu benar
— `salesperf.canViewSalesPerf`/`scopeFor` belum menyebut Finance. Lengan RLS saja
tidak mengubah apa pun yang terlihat lewat layar mana pun. Membuka gerbang domain
itu bagian dari pekerjaan di bawah.

### Belum dikerjakan — inilah PR-3 sebenarnya

Permintaan pemilik verbatim: *"**Laporan penjualan** all sales, total GMV, service
list, bisa diakses **Finance & Head Sales**, **bisa diekspor**, di halaman
`https://app.meagency.co.id/sales/kinerja`. Plus **kolom total sales**."*

Ketokan pemilik yang sudah ada (jangan ditanya ulang):

| Pertanyaan | Ketokan |
|---|---|
| Arti "total sales" & "total GMV" | **Baris TOTAL di kaki tabel** + **kolom jumlah deal per orang** |
| Arti "service list" | **Bagian tersendiri: rekap per layanan** — per layanan: berapa deal, berapa unit, berapa omzet. Ikut terekspor. (Ketokan 2026-09-10 sesi kedua) |

Yang harus dibangun:

1. **Kolom jumlah deal per orang.** Kunci wire **`total_deal`**, BUKAN
   `total_sales` — `clients.total_sales` SUDAH ADA dan artinya **GMV klien**
   (ditulis `report.ts`). Labelnya di layar boleh "Total Sales"; kuncinya tidak
   boleh.
2. **Baris TOTAL di kaki tabel.** ⚠️ Wajib `COUNT(DISTINCT contract)` untuk jumlah
   deal — **bukan** menjumlahkan kolom per orang. Deal yang dijual berdua tercatat
   pada DUA baris `client_sales_allocations`, jadi penjumlahan akan melebihkan
   jumlah deal. **Nilai uangnya aman dijumlahkan** — sudah di-pro-rata per
   `basis_points` dengan Σ=10000 (`salesperf.ts` sekitar baris 600).
3. **Rekap per layanan.** Sumbernya `services` (snapshot `master_service_id` +
   `standard_price` + `master_version_no`), jadi rekapnya bisa disusun tanpa
   menyentuh katalog hidup — dan itu memang yang benar, karena katalog bisa
   berubah sesudah deal ditutup.
4. **Ekspor.** Pola rumah: `apps/api/src/app/api/v1/leads/export/route.ts` +
   `apps/api/src/lib/csv.ts` (`toCsv`/`csvEscape`, delimiter `;` + BOM untuk Excel
   Indonesia, **buffered bukan streamed**). **Tidak ada penulis XLSX di repo** —
   `xlsx` hanya dipakai untuk mem-PARSE impor. Jangan tambah dependensi tanpa
   entri `DECISIONS.md`.
5. **Gerbang domain untuk Finance:** `salesperf.canViewSalesPerf` dan `scopeFor`.

### ⚠️ Keputusan rancangan yang sudah diambil dan alasannya

**Finance TIDAK dibuka ke seluruh Kinerja Sales — hanya ke laporan uang.**
Pemilik meminta laporan **PENJUALAN**, bukan corong prospek. Karena itu lengan RLS
sesi ini hanya menyentuh tiga tabel uang (`contracts`,
`client_sales_allocations`, `services`); `leads`, `prospect_attempts`,
`prospect_activities`, dan alasan NQ **tidak** dibuka, dan itu **dijaga tes batas
atas** di `salesperf-scope.rls.test.ts` ("Finance TIDAK diberi corong prospek").

Konsekuensinya untuk PR-3: laporan Finance berisi **uang + layanan, tanpa kolom
aktivitas**. Kalau Anda membangunnya sebagai "halaman Kinerja Sales yang sama,
dibuka untuk Finance", Anda akan menabrak tes itu — dan tes itu benar. Bentuk yang
benar adalah **read/permukaan tersendiri** (mis. `salesperf.salesReport` +
`/sales/performance/report` + `/report/export`), bukan melebarkan `bySalesperson`.

**Jangan ubah bentuk wire `/sales/performance` yang sudah ada.** Ia dipakai
halaman Kinerja Sales hari ini dan dijaga `shape-parity`. Tambah endpoint, jangan
ubah yang lama.

## 2. 🔴 Bug yang ditemukan sesi ini — dua-duanya sudah ditutup, tapi PELAJARANNYA berlaku terus

Keduanya **tidak dilaporkan siapa pun**. Keduanya ditemukan karena menelusuri
permintaan pemilik, dan keduanya punya bentuk yang sama: **penjaga yang terlihat
ada**.

### 2.1 `master_service_versions.active` selama ini KOSMETIK

Checkbox + badge "Nonaktif" ada di layar MSL sejak `init.sql`, tapi nol pembaca
menghormatinya. Sales Head menandai layanan nonaktif dan **tidak ada apa pun yang
berubah pada perilaku** — deal berikutnya tetap ditutup pada harga itu.

Sudah ditutup (`msl.sellableAt`/`listSellableAt`). Yang harus dijaga ke depan:

> ⚠️ **JANGAN menulis pembacanya sebagai `WHERE active … LIMIT 1`.** Kueri itu
> tidak melihat versi yang mengarsipkan, jadi ia jatuh ke versi AKTIF SEBELUMNYA
> dan **menjual pada harga lama**. Mengarsipkan sesuatu akan diam-diam
> menghidupkan versi sebelumnya. `active` adalah fakta TENTANG versi yang
> berlaku, bukan filter untuk mencari versi lain.

Alasan itu ditulis di tiga tempat supaya tidak diperkenalkan ulang: §1 migrasi
`20260930010000`, `COMMENT ON COLUMN master_service_versions.active`, dan docstring
`msl.sellableAt`. Migrasinya **sengaja tidak menambah indeks parsial `WHERE
active`** — godaan itu tidak diberi penopang.

### 2.2 Head Sales melihat kolom klien & omzet TIM-nya berisi `0.00`

`client_sales_allocations_select` punya tiga lengan dan **ketiganya per-orang**
(`created_by`, `jwt_owns_client`). Nol lengan divisi. Kinerja Sales membaca tabel
itu lewat `readAsActor`, jadi Head Sales mendapat nol baris — sementara baris
**orang**-nya tetap muncul, karena roster datang dari `private.employee_roster()`
yang `SECURITY DEFINER`. Tabelnya **tampak normal dan salah**.

Diukur di data live: Head Sales melihat **8 dari 28** alokasi. **20 deal (71%)**
tidak terlihat.

**Dua sebab ia hidup lama, dan ini yang harus diingat:**

1. **Director dan OD lolos lewat `jwt_can_read_all()`** dan SELALU melihat angka
   yang benar. Satu-satunya peran yang melihat bug ini adalah peran yang tidak
   dipakai untuk memeriksa. **Setiap pemeriksaan "halaman ini bekerja" yang
   dilakukan sebagai Director akan lolos.** Kalau Anda mem-verifikasi layar
   apa pun, verifikasi dengan peran yang paling sempit, bukan yang paling luas.
2. **Suite domain secara struktural tidak bisa menangkap kelas ini**: koneksinya
   `BYPASSRLS`, jadi ia membuktikan gerbang TS benar dan tidak pernah menanyakan
   apakah barisnya **terlihat**. Dan `scopeFor` memang sudah benar sejak awal —
   ia sudah berbunyi "Sales lead/SPV = seluruh divisi". **Policy-nya lah yang
   membantah gerbang domainnya.**

⇒ Setiap kali Anda menambah gerbang peran di TS, tanyakan apakah RLS-nya setuju.
Penjaganya harus ber-`withClaims` (pola `brief-scope.rls.test.ts`,
`salesperf-scope.rls.test.ts`), bukan tes domain biasa.

## 3. Ketokan PR-5 — SUDAH diketok, jangan tanya ulang

`DECISIONS.md` 2026-09-10:

- **`qty`** = lebih banyak unit layanan yang sama **di toko yang SAMA**;
- **baris kedua** = **toko/platform yang BERBEDA**, masing-masing ber-`store_link` sendiri;
- **`uq_qfs` TIDAK dicabut** — kuncinya diperlebar dari
  `(attempt_id, master_service_id)` menjadi `(attempt_id, master_service_id, platform)`.

⚠️ **Urutan kerjanya WAJIB: perlebar kunci join LEBIH DULU, baru `uq_qfs`.**
`loadApprovedLines` (`packages/domain/src/sales.ts`, cari
`left join qualified_form_services qfs`) menyambung baris proposal ke snapshot
Qualified dengan kunci yang **tidak menyebut platform**. Dua baris snapshot untuk
satu layanan **melipatgandakan `left join` itu** — deal ditutup dengan Service
ganda dan `total_agreed_value` menggelembung, **tanpa galat di mana pun**.
Terbalik, atau salah satunya saja, dan bug itu hidup di jendela di antaranya.

Penjaganya harus tes yang menutup satu deal dua-platform dan meng-assert
`total_agreed_value` **tepat 2×, bukan 4×**. Tes yang hanya meng-assert "dua baris
tercatat" akan HIJAU di atas join yang mekar.

## 4. PR-4 (Adopsi Sistem) — satu hal yang harus dinyatakan di UI

**NOL telemetri di repo**: tidak ada tabel page-view, tidak ada SDK analytics,
tidak ada middleware di `apps/api`. Preseden terdekat "seseorang membuka X" adalah
`strategi_share_access_log` (`20260809010000`).

⇒ **Tidak ada data historis.** Baris pertama muncul dari tanggal deploy, jadi
contoh `2026-08` di permintaan pemilik **tidak bisa direproduksi surut**. Itu harus
dinyatakan di layar, bukan ditemukan pemilik nanti.

Ketokan pemilik yang sudah ada: sesi = aktivitas beruntun, **gap > 30 menit
memulai sesi baru**; "persentasi penggunaan fitur" = **cakupan fitur role** (% menu
yang boleh diakses role itu yang benar-benar pernah dibuka bulan itu). Dan
ditegaskan pemilik: *"Indikator adaptasi tim ke sistem baru — **bukan komponen
reward**."*

Catatan direktori: **`packages/core/src/bi.ts` = Bahasa Indonesia, BUKAN business
intelligence.** Jangan taruh apa pun soal analytics di sana. Preseden direktori
engine: `core/src/report/`, `core/src/baseline/`.

## 5. 🟠 Aksi pemilik yang masih menggantung (bukan kode)

**Nol baris `role_mappings` NYATA yang menunjuk divisi `HR`.** Fixture
`supabase/seed.sql` punya `EMP-0011` (`HR`/`HR Head`) supaya gerbangnya teruji di
kedua cabang, tapi di produksi **nol orang memegang peran ini** — jadi mutasi &
resign praktis **Director-only** sampai Director membuat pemetaan riilnya lewat
`/admin/role-mappings`. `supabase/seed/role_mappings_riil.csv` sengaja tidak
disentuh: isinya pemetaan sungguhan, dan pasangan HRIS `divisi,jabatan` HR yang
asli tidak diketahui dari repo.

## 6. Tiga temuan PRE-EXISTING yang dicatat tapi TIDAK diperbaiki

Rinciannya `UAT_RESIGN_PERMANEN_20260910.md` §3. Nol di antaranya lubang hak
akses; ketiganya diverifikasi ada juga sebelum PR-1.

| Kode | Isi |
|---|---|
| `OBS-OD-PANEL-TULIS` | Halaman **Karyawan** menyodorkan panel "Impor karyawan" dan "Reset password" kepada OD dan Lead divisi lain. Server menolak (403), jadi cacat tampilan. Perbaikannya butuh **DUA** penjaga, bukan satu: impor Director-only, reset password sah untuk Lead atas divisinya sendiri. (Layar **MSL** sudah diperbaiki di PR-2 — `Ubah`/`Tambah` kini ber-`canEdit`; halaman Karyawan belum) |
| `OBS-IMPORT-PESAN-INGGRIS` | `POST /admin/employee-import` menjawab `{"error":"forbidden: Director role required"}` — melanggar rumah aturan #5. Pesan tanpa `[...]` juga tidak tertangkap pola pita penolakan di layar |
| `OBS-PASSWORD-RESIGN` | Password bisa diset untuk orang yang sudah resign (200). Bukan lubang — `admin_set_employee_password` tidak pernah menyentuh `banned_until`, jadi ban-nya bertahan — tapi ia menulis baris audit yang mengklaim sesuatu yang tak berguna |

## 7. Lingkungan — jebakan yang SUDAH ditemukan, jangan cari ulang

- **`npm ci` dibutuhkan di root DAN di `web-internal`** — yang kedua BUKAN anggota workspace.
- **Postgres ada tapi mati:** `pg_ctlcluster 16 main start`, lalu (sebagai postgres)
  `ALTER USER postgres WITH PASSWORD 'postgres';`. Sesudah container idle ia bisa
  mengeluh "stale pid file" — jalankan ulang, ia menghapusnya sendiri.
  `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"`.
- **Tes domain WAJIB `db-rebuild` dulu.** `audit_log` append-only, jadi beberapa tes
  yang mencacah per `entity_id` menumpuk antar-run dan memerah tanpa rebuild.
  Perilaku terdokumentasi, bukan regresi.
- **`npm test --workspaces` TIDAK menjalankan `web-internal`** — pakai
  `npx vitest run --root web-internal`.
- **`npm run typecheck` bisa menyesatkan tanpa `node_modules`**: `npx tsc` mengambil
  TypeScript 6.x dan gagal pada `TS5101 baseUrl deprecated` (repo memin `^5`).
  Artefak instalasi, bukan galat kode.
- **`/api/v1/sales/kinerja` TIDAK ADA.** Halaman `/sales/kinerja` dilayani
  `GET /api/v1/sales/performance`. Menebak dari URL halaman memberi 404 yang
  terlihat seperti bug.
- **`auth/login` tidak bisa diuji lokal** — ia lewat `passwordGrant` ke GoTrue, yang
  tidak ada di sandbox. Yang bisa diuji lokal adalah gerbang sebelum dan sesudahnya.
- Body `POST /auth/admin/set-password` adalah `{employee_id, temp_password}` —
  bukan `password`.
- **Aktor OD harus dibuat manual** untuk UAT — seed hanya punya tiga baris
  `director`, nol `od`. Lihat `UAT_RESIGN_PERMANEN_20260910.md` §5.
- **Harness UAT peramban:** `scripts/dev-jwt.mjs` + `scripts/browser-tour.mjs`.
  `apps/api` butuh `.env.local` ber-`SUPABASE_JWT_SECRET` yang SAMA dengan yang
  diberikan ke `dev-jwt.mjs`. `apps/api` di :3001, `web-internal` di :3000.

## 8. Penjaga yang harus tetap hijau (dan yang tidak boleh tumbuh)

| Penjaga | Aturan |
|---|---|
| `apps/api/src/lib/route-parity.test.ts` | `KNOWN_GAPS` harus tetap **KOSONG**. Menambah satu baris = mengakui satu halaman tidak berfungsi ⇒ butuh entri `DECISIONS.md` |
| `apps/api/src/lib/shape-parity.test.ts` | Setiap wire interface baru wajib punya anchor tipe FE di `WIRE_TO_FE`. `NESTED_INLINE_UNCHECKED` hanya boleh MENYUSUT |
| `apps/api/src/lib/body-parity.test.ts` | Badan request harus dideklarasikan di berkas yang SAMA dengan panggilan `api.*`-nya |
| `supabase/tests/rls_checks.sql` ledger O48 | Daftar policy tanpa lengan divisi. Ia **menyusut** dua kali sesi ini (`employees_select`, `client_sales_allocations_select`). Menambah baris butuh alasan tertulis |
| `scripts/db-rebuild.sh` + `.github/workflows/ci.yml` | Gate berhitung ada di **DUA** tempat. Naikkan keduanya di commit yang sama — kalau tidak, `main` merah dengan cara yang membingungkan (itu yang terjadi pada prefix `SCS` 42→43) |

## 9. Langkah berikutnya yang konkret

1. **Bangun sisa PR-3** (§1). Mulai dari domain: read tersendiri untuk laporan,
   `total_deal` per orang, baris TOTAL ber-`COUNT(DISTINCT contract)`, rekap per
   layanan. Lalu route + ekspor CSV, lalu layar, lalu gerbang Finance.
2. **Terapkan migrasinya ke live LEBIH DULU kalau PR-3 butuh migrasi** (O65), dan
   buktikan lewat kueri — bukan lewat `success: true`. Kalau PR-3 murni kode
   (mungkin, karena lengan RLS-nya sudah mendarat), tidak ada yang perlu di-apply.
3. **UAT peramban dengan peran yang PALING SEMPIT**, bukan Director. §2.2 adalah
   alasannya: Director lolos lewat `jwt_can_read_all()` dan tidak pernah melihat
   bug RLS.
4. **Minta pemilik membuat pemetaan `role_mappings` → divisi `HR`** (§5).
5. Sesudah PR-3: PR-4 (Adopsi Sistem, §4), lalu **PR-5 terakhir** karena ia
   satu-satunya yang menyentuh jalur uang (§3) — dikerjakan saat penjaga lain
   sudah hijau.

## 10. Angka verifikasi (baseline untuk PR berikutnya)

```
db-rebuild.sh --yes   220 migrasi bersih
gate                  155 tabel · 43 prefix · 34 mesin · 73 event
                      + seed 11 karyawan / 14 role_mappings / 6 master_services / 1 demo_task
invariant SQL         ident ✓  immutability ✓  rls ✓  auth_claims ✓
packages/domain       2401 lolos + 1 skip
packages/core         985 lolos
packages/db           98 lolos
apps/api              496 lolos   (termasuk route/body/shape-parity)
web-internal          741 lolos
typecheck             bersih, 5 target
lint @cdps/api        0 error 0 warning
lint web-internal     3 error + 61 warning — IDENTIK baseline, semuanya pre-existing
```

Live `CDPS SG`: ledger **222**, gate **155/43/34/73**, advisors `security`
**28 / 1 / 8 / 3 / 1** (28 `rls_enabled_no_policy` INFO, 1 `security_definer_view`
ERROR, 8 `function_search_path_mutable` WARN, 3
`authenticated_security_definer_function_executable` WARN, 1
`auth_leaked_password_protection` WARN). Semua pre-existing — **kalau angka ini
berubah sesudah migrasi Anda, itu temuan Anda.**
