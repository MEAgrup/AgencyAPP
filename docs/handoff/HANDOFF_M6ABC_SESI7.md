# HANDOFF — M6A/M6B/M6C Sesi 7 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI6 → **SESI7 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> Sesi ini **tidak membangun fitur**. Ia menutup **tujuh** pertanyaan terbuka
> dengan jawaban pemilik (X-05 · O26 · O34 · O35 · O25 · O6 · O9), membersihkan
> satu baris backlog basi (X-10), dan menyiapkan **rekomendasi bernomor** untuk
> lima cacat 🔴 yang masih menunggu pilihan pemilik.
>
> **Mulai dari sini:** §2 — cacat 🔴. Rekomendasinya sudah ditulis; yang kurang
> hanya kata "ya" dari pemilik.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| Branch | `claude/handoff-m6abc-sesi6-bku90h` |
| `main` | `574200c` — PR #105 (handoff SESI6) ter-merge |
| PR terbuka | **NOL** per awal sesi ini |
| Migrasi | **65 berkas**, live `CDPS SG` sinkron penuh & terverifikasi (SESI6 §2) |
| Gate | tabel **76** · prefix **31** · mesin **16** · event **33** |
| Skor | M6A **57%** (8/14) · M6B **8%** (1/12) — tidak berubah; sesi ini nol fitur |

## 1. Yang mendarat sesi ini

### 1.1 X-05 / RA-5 — G-0 default = tanggal mulai kontrak (kode)

Pemilik: *"tanggal mulai siklus = tanggal mulai kontrak"*.

`normalizeHeader` (`packages/domain/src/strategi.ts`) dulu **sengaja** tidak
menerapkan default itu — komentarnya menyebut asumsi masih terbuka, jadi G-0
kosong tersimpan `null`. Sekarang kosong berarti **"pakai default"**.

Yang membuat default ini bukan tebakan: `contract.ensureContractForService`
menolak jendela yang berselisih dengan kontrak tersimpan
(`MSG_WINDOW_MISMATCH`), jadi tanggal yang dipakai **tidak bisa** menyimpang
dari `contracts.tanggal_mulai` — termasuk saat Service sudah dikelompokkan
lebih dulu di bawah kontrak yang ada.

Yang **tidak** berubah:

- Override AM tetap hidup. RA-5 menyebut default, bukan aturan.
- Rule 17 tidak dilonggarkan — `siklus_terkunci` tetap menolak perpindahan
  sesudah periode 1 tutup, di domain **dan** di trigger DB.
- Cek `G-0` di `checkCompleteness` **dipertahankan**. Jalur normal tak bisa lagi
  menghasilkan `null`, tapi baris lama dan tulis service-role bisa; menghapus
  asersinya berarti mencabut penegak Rule 17 karena jalur bahagia kebetulan
  aman. Tesnya membuat `null` itu lewat SQL langsung.

Nol migrasi. 119/119 test `strategi` + `contract` hijau.

### 1.2 Enam pertanyaan terbuka ditutup (nol kode)

| # | Jawaban pemilik | Konsekuensi yang harus dibaca apa adanya |
|---|---|---|
| **O26** | Role Direktur, NIK & email **sudah ada** | Selesai penuh. Berhenti ditanyakan |
| **O34** | "Abaikan, saya update langsung di sistem" | Turun dari **blocker** jadi **prasyarat QA**. Tiket M7/M8/M9 boleh mendarat, tapi klaim *"teruji dengan operator produksi"* TIDAK boleh dibuat sebelum roster terisi |
| **O35** | idem | Roster boleh diisi, tapi **dimensi sub-tim tidak lahir dari mengisi roster** — skema `role_mappings` cuma divisi×jabatan. **Gate M7 tetap lead-divisi**; M7 §3 "TL hanya assign Asset sub-timnya" tetap belum ada |
| **O25** | Anomali kalkulator **sudah diedit** di sheet | Koreksi mendarat lewat **versi MSL baru** di admin `/master-services`, bukan otomatis. **O24 tetap terbuka** — mengedit anomali bukan menetapkan rate komisi |
| **O6** | **Tidak ada migrasi klien. Mulai dari klien baru** | Menutup O6, **menunda eksekusi** O22 & O23 (jawabannya tidak dicabut; parsernya tidak dibangun). W1-19 keluar dari lintasan kritis. Metrik yang butuh baseline historis mulai dari nol untuk klien lama — **bukan bug** |
| **O9** | Target M14 menyusul **di QA** | Tabel target tetap dibangun; angka masuk lewat benchmark entry saat QA Wave 3. **Nol angka tebakan di seed** — pembagian nol dirender `—` (aturan rumah #7), dan itu tampilan yang benar |

### 1.3 X-10 ternyata sudah selesai sejak sesi 5 — barisnya saja yang basi

Backlog §4 masih mencantumkan X-10 ("enam field daftar bertanda WAJIB") sebagai
terblokir, dan SESI6 §5/§7.4 ikut menyalinnya. Padahal O58 sudah **dijawab
pemilik dan diimplementasi** 2026-08-07: kolom `{field}_tidak_ada` untuk **lima**
field (A-11, A-14, B-5.3, B-8.1, B-8.2 — bukan enam; B-3.5/B-4.5 sudah opsional),
gerbang submit "daftar terisi XOR checkbox dicentang", pesan
`MSG_TIDAK_ADA_BELUM_DIJAWAB`. Barisnya sudah dicoret.

**Pelajaran:** daftar "terbuka" yang disalin antar-handoff bisa hidup lebih lama
dari masalahnya. Cocokkan §Open dengan §Decided sebelum menyalin, jangan
sesudahnya.

## 2. Cacat 🔴 — REKOMENDASI, tinggal disetujui

Kelimanya menunggu pilihan pemilik sejak SESI6 §7.2. Berikut rekomendasi
bernomor: apa cacatnya dalam satu contoh, pilihannya, dan mana yang dipilih
kalau tidak ada arahan lain.

### 2.1 O52 — halaman Task/Asset/Booking 404 untuk divisi eksekusinya sendiri

**Contoh:** SPV Creative membuka `/assets/AST-202608-0007` — Asset yang timnya
sendiri kerjakan. Halaman menjawab **404 `[aset tidak ditemukan]`**. Bukan 403.
Menurut halaman itu, Asset-nya tidak ada.

Sebabnya bukan gate domain (`canSeeBrief` justru **mengizinkan** staff/lead
divisi tujuan) melainkan RLS di tabel yang di-JOIN: `loadBrief` men-join
`services` + `clients`, dan **kedua policy itu tidak punya arm divisi eksekusi**
⇒ join membuang barisnya. Probe: `briefs` 1 baris, `services` **0**, `clients`
**0**, join ketiganya **0**.

| | Isi | Biaya |
|---|---|---|
| (a) | Tambah arm divisi-eksekusi ke `services_select` + `clients_select` | Cepat — satu migrasi. **Tapi membuka baris KLIEN ke seluruh divisi eksekusi**, dan itu keputusan visibility yang PRD M4 §6 tidak berikan |
| (b) | Pindahkan `loadBrief`/`loadAsset` ke fungsi `private.*` SECURITY DEFINER yang hanya mengembalikan **jawabannya** (brief + `assigned_am_id`) | Lebih sempit, sejalan pola `sm_allowed_transitions`/`employee_assignable`. Menyentuh read model inti ⇒ butuh sweep verifikasi tersendiri |

**➡️ Rekomendasi: (b).** (a) menukar cacat 404 dengan kebocoran data klien yang
tidak pernah diminta siapa pun — divisi Creative tidak butuh melihat baris
`clients`, ia butuh melihat **brief-nya**. (b) memberi persis itu. Biaya
sweep-nya nyata tapi sekali; (a) berbiaya selamanya karena setiap tabel klien
baru mewarisi keputusan visibility yang salah.

**Peringatan gate:** tidak ada test yang akan merah karena O52 —
`route-parity` melihat path, `shape-parity` melihat kunci, keduanya tidak pernah
men-join di bawah RLS. Perbaikannya wajib membawa test yang **menjalankan**
klaim divisi eksekusi lewat `SET LOCAL ROLE authenticated`.

### 2.2 O51 — `GET /portal/me` 500 untuk SEMUA aktor

**Contoh:** siapa pun membuka `/portal` → **500 opaque**. Rantainya
`portal.staffLanding` → `performance.previewCurrent` → `performance.staffRoleType`,
yang men-`select … from employees e join role_mappings rm …`. `role_mappings`
default-deny untuk `authenticated` ⇒ `42501 permission denied`, dan `staffLanding`
hanya menelan `NotFoundError` sehingga error Postgres lolos jadi 500.

| | Isi | Biaya |
|---|---|---|
| (a) | Fungsi `private.employee_role(employee_id)` SECURITY DEFINER | Mengikuti pola `employee_claims`. Perilaku identik untuk `staffID` apa pun — kontrak fungsinya utuh |
| (b) | `previewCurrent` ambil roleType dari **klaim aktor** saat `staffID = actor.employeeId` | Nol kueri. Tapi mempersempit kontrak fungsi ke satu-satunya pemakaian yang ada **hari ini** |

**➡️ Rekomendasi: (a).** (b) benar untuk pemakaian hari ini dan salah untuk
pemakaian berikutnya — M15 §Team/Management justru meminta melihat roleType
**orang lain**, jadi (b) akan dibongkar lagi di tiket M15 berikutnya. (a) juga
menutup kelasnya, bukan instansnya.

**Sekalian, dan murah:** `rls_checks.sql` §9 hanya meng-assert 4 tabel
(`sessions`, `employee_credentials`, `id_sequences`, `sm_edges`).
`role_mappings` **tidak** ada di daftar itu — itulah kenapa invariannya tidak
pernah merah. Tambahkan ia ke daftar dalam commit yang sama.

### 2.3 O44-asal / O42 — **satu-satunya yang MEMBLOKIR C-04**

Ini bukan pilihan (a)/(b) untuk butir (a) dan (b) — itu **pekerjaan developer
yang tinggal dikerjakan**:

- **(a)** `feCalls()` di `route-parity.test.ts` hanya membaca
  `web-internal/src/lib`, tidak rekursif, tidak menyentuh `src/app/**`. Jadikan
  rekursif atas **seluruh** `web-internal/src`.
- **(b)** Port 6 route admin — `GET/POST /admin/role-mappings`,
  `DELETE /admin/role-mappings/{}`, `GET /admin/employees`,
  `POST /admin/layered-roles`, `POST /admin/employee-sync`.

Yang butuh pemilik hanya **(c) arah auth**: tiga route (`POST /auth/change-password`,
`POST /auth/admin/set-password`, `GET /auth/admin/credentials`) diport, atau
digantikan Supabase Auth client-side. Hari ini **tidak ada** pemakaian
`updateUser`/`resetPasswordForEmail` di `web-internal/src` — artinya
**ganti-password de-facto tidak tersedia bagi pengguna**.

**➡️ Rekomendasi: port ketiganya ke `apps/api` (bukan client-side).** Alasannya
bukan preferensi: `auth/admin/*` harus di-gate `adminMayManage` **di server**,
dan memindahkannya ke klien berarti gate itu hidup di tempat yang bisa dilewati.
Ganti-password mandiri boleh menyusul; yang mendesak adalah admin bisa
me-reset password saat onboarding.

⚠️ **Catatan penting terhadap SESI6 §7.2:** baris O44-asal/O42 di sana
mencampur dua hal. Sebagian besar O42 (siapa pemilik proses ubah-peran, lewat UI
apa) **sudah terjawab oleh kode yang ada** — Director/OD, lewat halaman admin
yang sudah dibangun. Yang benar-benar tersisa dari O42 adalah **pertanyaan (3):
rekonsiliasi 38-vs-23-vs-12 baris `role_mappings`** — mana yang jadi sumber
kebenaran. Itu masih milik pemilik.

### 2.4 O48 — kelas O46 ternyata 36 policy, bukan 3

**Contoh:** lead Creative membuka daftar anggota timnya → **200, kosong**.
`employees_select` = `jwt_can_read_all() OR employee_id = me OR created_by` —
tidak ada arm divisi. Halaman tidak terlihat rusak; ia terlihat seperti tim yang
tidak punya anggota.

Survei (bukan sampel): **9 policy SELECT punya** arm lead/divisi, **36 tidak**.
Sebagian dari 36 adalah tabel anak yang mewarisi lewat `jwt_owns_*` —
memperbaiki induknya cukup. Yang menggigit langsung: `assets_select`,
`employees_select`, `clients_select`, keluarga `*_block_requests`.

| | Isi | Biaya |
|---|---|---|
| (a) | Sapu arm `Lead/SPV = division-wide` ke seluruh 36 sekali, dengan invariant yang meng-assert daftarnya (pola `KNOWN_GAPS`) | Aman terhadap gap senyap. **Memperluas baca di 36 tabel dalam satu migrasi** |
| (b) | Per-tabel, sesuai kebutuhan halaman | Kecil per langkah, tapi setiap halaman baru berpotensi menemukan gap yang sama lagi |

**➡️ Rekomendasi: (b) dengan invariant (a).** Yaitu: perbaiki per-tabel sesuai
halaman yang dikerjakan, **tapi pasang sekarang** invariant yang mendaftar
ke-36 policy itu sebagai daftar eksplisit yang harus menyusut, tidak boleh
tumbuh. Menyapu 36 tabel sekaligus berarti memperluas baca di tabel yang belum
ada halamannya — perluasan yang tak seorang pun bisa review dengan sungguh-sungguh
dalam satu PR. Daftar yang tercatat membuat sisanya tidak bisa dilupakan; itu
yang O46 tidak punya, dan itu sebabnya angkanya salah tiga kali lipat.

### 2.5 O45 — invariant lokal buta terhadap grant yang bocor di live

**Dampak terukur hari ini: NOL** (diaudit — 11 fungsi `public` bisa dipanggil
`anon`, nol di antaranya `SECURITY DEFINER`). Yang cacat adalah **gerbangnya**:
Supabase memberi DEFAULT PRIVILEGES EXECUTE ke `anon, authenticated,
service_role` untuk setiap fungsi baru di `public`; Postgres bare tidak. Jadi
`rls_checks.sql` **tidak akan pernah** merah karena REVOKE yang lupa ditulis.

**➡️ Rekomendasi: langkah cek ber-service-role di ronde QA, bukan di CI.**
Satu kueri yang menegaskan "set fungsi `public` yang `anon`-executable =
allow-list", dijalankan saat QA/UAT terhadap live. Menaruhnya di CI berarti CI
butuh kredensial produksi — harga yang tidak sebanding untuk kelas cacat yang
dampaknya hari ini nol dan yang advisor Supabase juga tangkap.

### 2.6 Urutan yang disarankan

1. **O44-asal (a)+(b)** — satu-satunya yang memblokir C-04, dan (a) mencegah
   kelas ini tumbuh lagi.
2. **O51 (a)** — kecil, menutup kelasnya, + `role_mappings` masuk `rls_checks`.
3. **O52 (b)** — terbesar dari ketiganya; butuh sweep verifikasi sendiri.
4. **O48 invariant** — dipasang bersama O52, karena O52 adalah instans O48.
5. **O45** — masuk checklist QA, bukan tiket kode.

## 3. Yang masih menunggu pemilik sesudah sesi ini

| # | Isi | Bentuk jawaban yang dibutuhkan |
|---|---|---|
| **O52 · O51 · O48 · O45** | Lihat §2 | "setuju rekomendasi" atau sebut pilihan lain |
| **O44-asal (c)** | Arah auth ganti-password | Rekomendasi §2.3: port ke `apps/api` |
| **O42 (3)** | Rekonsiliasi `role_mappings` 38-vs-23-vs-12 | Mana yang jadi sumber kebenaran |
| **O47b** | Retensi PII di histori git — lihat §4 | Setuju hapus ~85 branch basi, atau terima PII tetap terjangkau di histori |
| **O24** | `commission_rule` riil per 32 layanan MSL | Rate per layanan (O25 sudah selesai; ini tidak) |
| **X-03 · X-04 · X-06 · X-07** | M6-spesifik — contoh masing-masing ada di backlog §4 | Angka/konfirmasi, semuanya kecil |

## 4. O47b dijelaskan — kenapa "berkasnya sudah dihapus" tidak berarti bersih

Pertanyaan pemilik: *apa maksudnya O47b*.

2026-07-30 kita menghapus `backend/testdata/import_samples/` (7 CSV berisi PII
klien/lead riil) dari repo. Itu mengeluarkan PII dari **tree** — daftar berkas
hari ini. Ia **tidak** mengeluarkannya dari **histori**.

**Contoh yang bisa dicoba siapa pun** dengan akses repo:

```
git show f8faf12:backend/testdata/import_samples/<nama berkas>.csv
```

Perintah itu **tetap bekerja**, dan menampilkan isi CSV-nya lengkap. Git
menyimpan setiap versi setiap berkas; "delete" hanyalah commit baru yang bilang
"berkas ini tidak ada lagi **mulai sekarang**".

Yang membuatnya lebih mahal daripada terdengarnya: **4 commit** memuat berkas
itu, yang paling awal `f8faf12` — jauh di dalam histori `main`. Setiap branch
yang turun dari titik itu ikut memuatnya, dan remote punya **89 branch**. Jadi
menulis ulang `main` saja **tidak menghapus apa pun**: PII tetap terjangkau
lewat 80-an branch lain, dan melaporkannya "sudah bersih" akan jadi laporan
palsu.

Scrub yang benar-benar bekerja butuh salah satu dari:

- **(a)** `git filter-repo` atas **seluruh ref**, lalu force-push semua branch —
  memutus setiap clone yang ada; setiap kontributor harus re-clone.
- **(b)** **Hapus ~85 branch basi lebih dulu** (kebanyakan sudah ter-merge atau
  ditinggalkan — SESI6 §4b sudah memverifikasi tidak ada PR terbuka di
  antaranya), lalu rewrite yang tersisa hidup.

**Dan bahkan sesudahnya:** GitHub menyimpan objek yang sudah tak terjangkau —
halaman commit di PR lama tetap bisa dibuka lewat URL langsung — sampai **GitHub
Support menjalankan gc** atas repo. Jadi "PII hilang dari GitHub" tidak bisa
dicapai tanpa tiket ke Support.

**➡️ Rekomendasi: (b), dan hanya kalau kebijakan retensi memang menuntutnya.**
(b) jauh lebih murah karena ~85 branch itu memang tidak dipakai siapa pun, dan
ia mengecilkan permukaan rewrite ke beberapa branch saja. Yang perlu pemilik
setujui persis dua hal: **hapus ~85 branch basi** dan **buka tiket GitHub
Support**. Kalau kebijakan retensi MEA tidak menuntut sampai tingkat itu,
jawaban yang sah adalah "terima" — asalkan ia dicatat sebagai keputusan, bukan
dibiarkan menggantung sebagai temuan yang tidak pernah dijawab.

**Tidak memblokir apa pun** — bukan cutover, bukan C-05.

## 5. Aturan yang tidak berubah (diulang karena mahal)

1. Migrasi **hanya** lewat `supabase/migrations/**` + `db push` /
   `apply_migration`. **Jangan pernah** `psql -f` ke live (asal drift O38).
2. DB lokal dibangun ulang **hanya** lewat `scripts/db-rebuild.sh`.
3. Angka gate hidup di **DUA** berkas (`scripts/db-rebuild.sh` +
   `.github/workflows/ci.yml`). Menaikkan satu saja = CI merah.
4. Sesudah `db push`, jalankan **sidik jari struktural** (SESI6 §2). Jangan
   percaya "tidak error".
5. Suite penuh (~844 test) **tidak andal dijalankan lokal** — postgres di
   container ini di-SIGKILL sebelum selesai (SESI6 §3.2). Jalankan berkas yang
   relevan; serahkan suite penuh ke CI.

### 5.1 Tambahan sesi ini — postgres perlu dinyalakan dan diberi password

Container ini start **tanpa** postgres berjalan, dan clusternya **PG16**, bukan
17 (`pg_ctlcluster 17 main start` gagal dengan *cluster does not exist*).

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
```

Langkah kedua tidak opsional: `db-rebuild.sh` memakai socket `su postgres`
sehingga ia berhasil tanpa password, tetapi test memakai TCP
`postgres://postgres:postgres@127.0.0.1:5432/cdps` dan akan gagal seluruhnya
dengan `password authentication failed` — **119 kegagalan yang tidak ada
hubungannya dengan kode**. Gejalanya mirip §3.2 SESI6 dan sama-sama palsu.

Juga: **jangan** jalankan `npm ci` dari dalam `packages/*`. Itu membuat
`node_modules` bersarang yang menutupi workspace root dan menghasilkan
`Cannot find package 'vitest'`. Selalu dari root repo.
