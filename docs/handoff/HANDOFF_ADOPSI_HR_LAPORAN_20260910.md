# Handoff — Lima fitur tambahan pemilik (2026-09-10)

> ⚠️ **SEBAGIAN SUDAH KADALUARSA.** Baca
> `HANDOFF_PR3_LAPORAN_PENJUALAN_20260910.md` LEBIH DULU — ia menggantikan §2
> (posisi PR) dan §9 (langkah berikutnya) di bawah, dan mencatat dua bug yang
> ditemukan sesudah berkas ini ditulis. Yang tetap berlaku di sini: §0 permintaan
> verbatim pemilik, §1 ketokan, §3 isi PR-1, §4 aksi pemilik, §6 temuan riset.

> **Baca ini lebih dulu, lalu `/root/.claude/plans/tambahan-fitur-buat-synchronous-bunny.md`**
> (rencana lengkap lima bagian, sudah disetujui pemilik). Berkas ini menyatakan **posisi
> sebenarnya**: apa yang sudah mendarat, apa yang belum, dan jebakan apa yang sudah dipetakan
> supaya sesi berikutnya tidak menemukannya lagi dari nol.

## 0. Permintaan pemilik (verbatim, satu sesi)

1. **Adopsi Sistem — Jam Pemakaian Tools.** Dari log page-view, sesi = aktivitas beruntun,
   **gap > 30 menit memulai sesi baru**. Kolom: Bulan · Anggota · Role · Jam/Bulan · Sesi ·
   Page View. Plus **baris persentase penggunaan fitur untuk role-nya**. Ditegaskan pemilik:
   *"Indikator adaptasi tim ke sistem baru — **bukan komponen reward**."*
2. **Menu HR/OD untuk mutasi + hapus akses (resign), permanen.**
3. **Laporan penjualan** all sales, total GMV, service list, bisa diakses **Finance & Head
   Sales**, **bisa diekspor**, di halaman `https://app.meagency.co.id/sales/kinerja`. Plus
   **kolom total sales**.
4. **Satu layanan untuk dua platform.** *"kalau ada klien yg membeli produk sama untuk 2
   platform, saat ini tidak bisa. padahal seharusnya bisa dan harga menjadi 2x. ini artinya
   ada 2 service berbeda, ada 2 link toko yg berbeda. sama juga ketika input komisi, bisa ada
   2 platform yg memberikan 2 komisi berbeda."*
5. **Fitur untuk menghapus Master Service List yang salah.**

## 1. Ketokan pemilik sesi ini (via `AskUserQuestion` — jangan ditanya ulang)

| # | Pertanyaan | Ketokan |
|---|---|---|
| 1 | Siapa boleh MENULIS mutasi & resign | **Director + Lead HR.** OD **tetap read-only** — invarian "OD tidak pernah menulis" tidak disentuh |
| 2 | Arti "permanent" | **Cabut akses, baris tetap** (tanpa undo di UI) **+ sekalian lepas penugasan aktif** |
| 3 | Arti "persentasi penggunaan fitur" | **Cakupan fitur role** — % menu yang boleh diakses role itu yang benar-benar pernah dibuka bulan itu |
| 4 | "total sales" & "total GMV" | **Baris TOTAL di kaki tabel** + **kolom jumlah deal per orang** |

## 2. Posisi: PR-1 SELESAI, empat sisanya belum dimulai

| PR | Bagian | Status |
|---|---|---|
| **PR-1** | Bagian 2 — Mutasi & Resign permanen (HR) | ✅ **SELESAI, migrasi di live, di-MERGE** (`714da1a`) — migrasi diterapkan ke `CDPS SG` lebih dulu (O65) dan UAT empat aktor lolos: `UAT_RESIGN_PERMANEN_20260910.md` |
| PR-2 | Bagian 5 — Arsip & hapus Master Service List | ✅ **SELESAI & di-commit** — migrasi `20260930010000_msl_arsip_hapus.sql`. Bug laten "layanan nonaktif masih terjual" ikut ditutup. ⚠️ **Migrasi BELUM diterapkan ke live** (O65: apply lebih dulu, merge sesudahnya) |
| PR-3 | Bagian 3 — Laporan Penjualan (Finance & Head Sales) | ⬜ belum |
| PR-4 | Bagian 1 — Adopsi Sistem | ⬜ belum |
| PR-5 | Bagian 4 — Layanan multi-platform (⚠️ jalur uang) | ⬜ belum |

Urutan itu dipilih dari risiko, bukan dari besar-kecilnya: yang menyentuh jalur uang
dikerjakan terakhir, saat penjaga-penjaga lain sudah hijau.

## 3. Apa yang PR-1 benar-benar mengubah

Migrasi **`20260929010000_resign_permanen.sql`** (satu berkas, tiga bagian):
1. `employees.resigned_at`/`resigned_by` + `ck_employees_resign_lengkap` (keduanya terisi atau
   tidak sama sekali) + `ck_employees_resign_nonaktif` (ber-`resigned_at` tidak boleh aktif).
2. `private.employee_roster()` — roster **historis** (aktif maupun tidak).
3. `employees_select` + lengan `jwt_is_lead() AND jwt_division() = 'HR'`.

Kode: `admin.resignEmployee` / `handoverList` / `canReadAdmin`, `employees.syncEmployees`,
`salesperf.loadRoster`, route `resign` + `handover`, `wire.ts` (+3 wire), `nav.ts`,
`web-internal/src/lib/admin-employees.ts` (baru), halaman `admin/employees`.

**Gate 155/43/34/73 TIDAK bergerak** (kolom + fungsi, nol tabel baru). Seed karyawan
**10→11**, role_mappings **12→14** — dinaikkan di `scripts/db-rebuild.sh` **dan**
`.github/workflows/ci.yml`. Ledger O48 di `rls_checks.sql` **menyusut** satu baris.

### Tiga jebakan yang sudah ditutup (jangan buka lagi)

1. **Sinkron membatalkan resign.** `syncEmployees` meng-upsert `status_aktif` dari sumber lalu
   memanggil `set_employee_banned(false)` pada `priorActive === false`. Satu impor CSV yang
   masih menyebut orang itu aktif akan mengaktifkannya kembali — diam-diam. Kini `resigned_at`
   mengalahkan sumber. **Ada tes, dan tesnya dibuktikan hidup dengan mutasi.**
2. **Resign melenyapkan omzet historis.** `salesperf.loadRoster` dulu membaca
   `private.employee_assignable()` (memfilter `status_aktif`), jadi mem-resign seorang sales
   menghapus barisnya beserta seluruh closing-nya dari Kinerja Sales. Kini
   `private.employee_roster()`. **Picker penugasan TETAP `employee_assignable()`** — jangan
   satukan keduanya jadi satu fungsi ber-flag.
3. **Lead HR boleh menulis tapi tidak boleh membaca.** Cacat sejak 2026-08-10:
   `canManageEmployeeAssignment` mengizinkan mutasi, tapi `canReadAdmin` menolak daftar,
   `employees_select` hanya memberi baris dirinya sendiri, dan sumber tabel halaman Karyawan
   (`/auth/admin/credentials`) mempersempit seorang Lead ke divisinya. Ditutup semuanya.

### Yang SENGAJA tidak dikerjakan di PR-1

- **Password tidak ikut.** `auth.canManagePasswords`/`adminMayManage` nol perubahan — HR
  membaca roster, tidak me-reset password di luar divisinya (eskalasi hak lewat pengambilalihan
  password).
- **`handoverList` MELAPOR, tidak memindahkan.** Memindahkan `sales_pic_id` diam-diam
  memindahkan kepemilikan komisi — jebakan yang sudah ditolak `DECISIONS.md` 2026-09-08 (FS-4).
  Pemindahan tetap lewat jalur reassign M4 (Sales Lead, teraudit).
- **Tanpa undo** (ketokan pemilik). Panel konfirmasi menyatakan konsekuensinya sebelum bertanya.

## 4. 🟠 Aksi pemilik yang masih menggantung (bukan kode)

**Belum ada satu pun baris `role_mappings` nyata yang menunjuk divisi `HR`.** Fixture
`supabase/seed.sql` punya `EMP-0011` (`HR`/`HR Head`) supaya tes gerbangnya tidak hanya pernah
menguji cabang Director, tapi di produksi **nol orang memegang peran ini** — jadi mutasi &
resign praktis Director-only sampai Director membuat pemetaan riilnya lewat
`/admin/role-mappings`. `supabase/seed/role_mappings_riil.csv` **sengaja tidak disentuh**:
isinya pemetaan sungguhan dan pasangan HRIS `divisi,jabatan` HR yang asli tidak diketahui dari
repo.

## 5. ✅ SUDAH DIKETOK PEMILIK (2026-09-10) — PR-5 tidak lagi tertahan

**Bagian 4 (layanan multi-platform) membalik sebagian ketokan Nerissa 2026-08-07**, yang
berbunyi: *"jasa yang sama dua kali dalam satu set kini DITOLAK … quantity-lah field untuk
'dua unit jasa ini', bukan baris kedua."*

Dan penolakan itu **menutup bug uang sungguhan**: `loadApprovedLines` (`sales.ts:1964`)
menyambung tiap baris proposal ke `qualified_form_services` dengan
`on qfs.attempt_id = np.attempt_id and qfs.master_service_id = npl.master_service_id`. Dua
baris snapshot untuk satu layanan **melipatgandakan join itu** — deal ditutup dengan Service
ganda dan `total_agreed_value` menggelembung, **tanpa galat di mana pun**.

🔴 **Karena itu mencabut `uq_qfs` saja akan membuka kembali bug itu.** Yang harus diperlebar
adalah **kunci join**-nya (tambah `platform`), bukan jaminan 1:1-nya yang dibuang.

**Ketokan pemilik 2026-09-10 (via `AskUserQuestion`) — dicatat penuh di `DECISIONS.md`:**

- **`qty`** = lebih banyak unit layanan yang sama **di toko yang sama**;
- **baris kedua** = **toko/platform yang berbeda**, masing-masing ber-`store_link` sendiri;
- **`uq_qfs` TIDAK dicabut** — kuncinya diperlebar dari `(attempt_id, master_service_id)`
  menjadi `(attempt_id, master_service_id, platform)`.

**Urutan pekerjaannya WAJIB: perlebar kunci join LEBIH DULU, baru `uq_qfs`.** Terbalik, atau
salah satunya saja, dan bug penggelembungan itu hidup di jendela di antaranya — tanpa galat.
Penjaganya harus tes yang menutup satu deal dua-platform dan meng-assert `total_agreed_value`
**tepat 2×**, bukan 4×: tes yang hanya meng-assert "dua baris tercatat" akan HIJAU di atas
join yang mekar.

## 6. Temuan riset yang menghemat sesi berikutnya

- **`packages/core/src/bi.ts` = Bahasa Indonesia, BUKAN business intelligence.** Jangan taruh
  apa pun soal analytics di sana. Preseden direktori engine: `core/src/report/`,
  `core/src/baseline/`.
- **Nol telemetri di repo** — tidak ada tabel page-view, tidak ada SDK analytics, **tidak ada
  middleware di `apps/api`**. Preseden terdekat "seseorang membuka X" adalah
  `strategi_share_access_log` (`20260809010000`). Konsekuensi yang harus dinyatakan di UI:
  **tidak ada data historis**, baris pertama muncul dari tanggal deploy — contoh `2026-08` di
  permintaan pemilik tidak bisa direproduksi surut.
- **`active` di `master_service_versions` hari ini KOSMETIK.** Ada checkbox & badge, tapi
  `listEffectiveAt` **dan** `effectiveAt` hanya memfilter `effective_from <= date`. Artinya
  **layanan yang sudah ditandai "Nonaktif" masih bisa dijual sekarang** — itu bug laten, dan
  memperbaikinya adalah inti PR-2.
- **`master_service_id` tidak punya FK di mana pun** (`services`, `qualified_form_services`,
  `negotiation_proposal_lines`, `renewal_proposal_lines` semuanya `varchar(32)` biasa). `DELETE`
  **tidak akan ditolak Postgres** dan tidak memberi galat — ia hanya meninggalkan pointer
  menggantung. Perlindungannya harus ditulis; ia belum ada.
- **`updateService` ber-semantik FULL REPLACE.** `DECISIONS.md` 2026-09-07 mencatat kerusakan
  yang ditimbulkannya: setiap "Ubah" yang tidak mengirim `durasi_jasa` **menghapus** nilai itu
  diam-diam. Jadi **jangan** mengarsip dengan `updateService({ active: false })` — salin versi
  berjalan verbatim dan balik satu flag.
- **Link toko per platform adalah utang yang SUDAH tercatat.** `DECISIONS.md` 2026-08-27:
  *"BELUM (di luar cakupan, dicatat eksplisit): Qualified Lead Form masih satu `store_link`
  untuk semua platform."* `qualified_forms.platform` adalah string **koma-gabungan** dari
  checklist UI, dipecah lagi di `close()` (`sales.ts:1795-1800`) — tapi setiap baris
  `client_platforms` mendapat `store_link` yang SAMA. PR-5 menutup utang itu, bukan menambah
  cakupan baru.
- **Finance sudah punya lengan RLS** di `clients_select` dan
  `transactions_select`/`installments_select`. Yang **kurang** untuk PR-3: `services_select`
  dan `client_sales_allocations_select` (yang terakhir masih baseline `20260723064438:261`).
- **Ekspor CSV punya pola rumah**: `apps/api/src/app/api/v1/leads/export/route.ts` +
  `apps/api/src/lib/csv.ts` (delimiter `;` + BOM untuk Excel Indonesia, buffered bukan
  streamed). **Tidak ada penulis XLSX di repo** — `xlsx` hanya dipakai untuk mem-parse impor.
- **`clients.total_sales` SUDAH ADA** dan artinya GMV klien (ditulis `report.ts`). Kolom baru
  di PR-3 harus ber-kunci wire **`total_deal`**, bukan `total_sales`, walau labelnya di layar
  "Total Sales".
- Deal yang dijual berdua tercatat pada dua baris ⇒ baris TOTAL wajib
  **`COUNT(DISTINCT contract)`**, bukan penjumlahan kolom per orang. Nilai uang aman
  dijumlahkan (sudah di-pro-rata per `basis_points`, Σ=10000 — `salesperf.ts:595`).

## 7. Lingkungan sesi ini (biar tidak dicari ulang)

- **Dependensi tidak terpasang saat sesi dimulai.** Butuh `npm ci` di root **dan** di
  `web-internal` (ia BUKAN anggota workspace).
- **Postgres ada tapi mati.** `pg_ctlcluster 16 main start`, lalu
  `ALTER USER postgres WITH PASSWORD 'postgres';` supaya koneksi TCP jalan.
  `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"`.
- **`npm run typecheck` bisa menyesatkan tanpa `node_modules`**: `npx tsc` mengambil
  TypeScript 6.0.2 dan gagal pada `TS5101 baseUrl deprecated` (repo memin `^5`). Itu artefak
  instalasi, bukan galat kode.
- **Tes domain WAJIB `db-rebuild` dulu.** `audit_log` append-only, jadi beberapa tes yang
  mencacah per `entity_id` (mis. `hari libur`) menumpuk antar-run dan memerah tanpa rebuild.
  Itu perilaku terdokumentasi, bukan regresi.
- `npm test --workspaces` **TIDAK** menjalankan `web-internal` — pakai
  `npx vitest run --root web-internal`.

## 8. Angka verifikasi PR-1 (baseline untuk PR berikutnya)

```
db-rebuild.sh --yes   218 migrasi bersih
gate                  155 tabel · 43 prefix · 34 mesin · 73 event   (+ seed 11 karyawan / 14 role_mappings)
invariant SQL         ident ✓  immutability ✓  rls ✓  auth_claims ✓
packages/domain       2367 lolos + 1 skip   (naik dari 2355 + 1)
packages/core         985 lolos
packages/db           98 lolos
apps/api              496 lolos   (termasuk route/body/shape-parity)
web-internal          737 lolos   (naik dari 736)
typecheck             bersih, 5 target
lint web-internal     3 error + 61 warning — IDENTIK baseline, semuanya pre-existing
```

## 9. Langkah berikutnya yang konkret

1. ~~**Terapkan migrasi PR-1 ke live `CDPS SG` LEBIH DULU, merge sesudahnya** (O65).~~
   ✅ **SELESAI 2026-09-10.** Gate live tetap 155/43/34/73, ledger 219→220,
   `employees_select` 3→4 lengan (ketiga lengan baseline utuh), advisors `security`
   identik 28/1/8/3/1. Kedua CHECK diuji menggigit di live dalam transaksi ber-rollback;
   jebakan #2 dibuktikan pada data live (roster 60 tetap 60, assignable 55→54). PR #340
   di-merge sesudahnya (`714da1a`). Rinciannya `UAT_RESIGN_PERMANEN_20260910.md` §1.
2. **Minta pemilik membuat pemetaan `role_mappings` → divisi `HR`** (§4), kalau tidak fiturnya
   Director-only.
3. ~~**UAT browser halaman Karyawan** dengan 4 aktor.~~ ✅ **SELESAI 2026-09-10, LOLOS** —
   `UAT_RESIGN_PERMANEN_20260910.md` §2, tiga tangkapan layar di `screenshots/uat-resign-*`.
   Jebakan #1 diuji ujung-ke-ujung (impor CSV yang masih menyebut orangnya aktif ⇒
   `skippedResigned: 1`, `reactivated: 0`, ban dipasang ulang), jebakan #2 lewat
   `GET /sales/performance` yang barisnya bertahan identik.
   **Tiga temuan PRE-EXISTING dicatat di sana §3** (`OBS-OD-PANEL-TULIS`,
   `OBS-IMPORT-PESAN-INGGRIS`, `OBS-PASSWORD-RESIGN`) — semuanya di luar cakupan PR-1,
   nol di antaranya lubang hak akses.
4. ~~**Lanjut PR-2** (arsip/hapus MSL).~~ ✅ **SELESAI 2026-09-10.** Bug laten "layanan nonaktif
   masih terjual" ditutup: `active` selama ini KOSMETIK karena nol pembaca menghormatinya.
   Sekarang ada `msl.sellableAt`/`listSellableAt` (jalur JUAL) di samping `effectiveAt`
   (pengayaan deal yang sudah disetujui) — DUA pembaca, bukan satu flag. Hapus dijaga trigger
   DB `trg_master_services_hapus_terjaga` karena `master_service_id` nol FK di mana pun.
   Dibuktikan dengan **enam mutasi**, termasuk pengecualian `bayar_komisi` yang teruji DUA ARAH.
   ⚠️ **Langkah berikutnya untuk PR-2: terapkan migrasinya ke live `CDPS SG` LEBIH DULU (O65),
   baru merge** — dan buktikan lewat kueri, bukan lewat `success: true`.

   Yang PR-2 sengaja TIDAK kerjakan: layar MSL masih tanpa gerbang peran untuk `Ubah`/`Tambah`
   sebelum PR ini — keduanya kini digerbangi `canEdit`, tapi cacat sekelasnya di halaman
   Karyawan (`OBS-OD-PANEL-TULIS`, lihat `UAT_RESIGN_PERMANEN_20260910.md` §3) TETAP terbuka.
5. ~~**Ajukan ketokan §5 ke pemilik**~~ ✅ **SELESAI 2026-09-10** — lihat §5 di atas dan barisnya di `DECISIONS.md`. PR-5 tidak lagi tertahan.
