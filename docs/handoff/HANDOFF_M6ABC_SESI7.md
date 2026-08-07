# HANDOFF — M6A/M6B/M6C Sesi 7 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI6 → **SESI7 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> Sesi ini punya **dua bagian**. Bagian 1 menutup pertanyaan terbuka dengan
> jawaban pemilik (X-05 · O26 · O34 · O35 · O25 · O6 · O9) dan membersihkan satu
> baris backlog basi (X-10). Bagian 2 — sesudah pemilik memilih — **mengeksekusi
> ronde cacat 🔴**: O52 (b) · O51 (a) · O48 (b)+ledger mendarat di repo DAN di
> live, dan O47b diputus (b).
>
> **Mulai dari sini:** §6 — apa yang tersisa. Ringkasnya: O47b langkah (2)
> (rewrite histori, butuh sesi bersih), O42 pertanyaan (3), lalu kembali ke
> fitur M6 (A-08/A-09/A-13, B-01).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| Branch | `claude/handoff-m6abc-sesi6-bku90h` |
| `main` | `574200c` — PR #105 (handoff SESI6) ter-merge |
| PR terbuka | **NOL** per awal sesi ini |
| Migrasi | **68 berkas** (65 + O51 · O52 · O48-GrupB). Live `CDPS SG` **sinkron & terverifikasi** — sidik jari `698e526c05aabd27e14cf11bb15cd117` \| 11 fakta, identik di lokal & live |
| Gate | tabel **76** · prefix **31** · mesin **16** · event **33** — **tidak berubah** (ketiga migrasi hanya menambah fungsi/policy) |
| Skor | M6A **57%** (8/14) · M6B **8%** (1/12) — tidak berubah; sesi ini ronde cacat, bukan fitur |
| Test | domain 165 + 241 + 257 + 76 hijau · `apps/api` 324 hijau · 4 invariant SQL hijau |

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

## 2. Cacat 🔴 — DIPUTUS DAN (tiga dari lima) DIEKSEKUSI

Pemilik memilih **2026-08-07**, dan pilihannya sama dengan rekomendasi di bawah:

| # | Pilihan pemilik | Status |
|---|---|---|
| O52 | **(b)** | ✅ mendarat — migrasi `20260807150000`, di-apply ke live |
| O51 | **(a)** | ✅ mendarat — migrasi `20260807140000`, di-apply ke live |
| O48 | **(b)** | ✅ `assets_select` + **ledger 38 policy** — migrasi `20260807160000`, di-apply ke live |
| O47b | **(b)** | 🟡 diputus; langkah (1)+(3) disetujui, **langkah (2) rewrite BELUM** — lihat §4 |
| O45 | — | ⏸️ belum ditanya lagi; rekomendasi §2.5 masih berdiri |
| O44-asal | — | ⚠️ **ternyata sudah selesai sejak 29 Juli** — lihat §2.3 |

Bagian di bawah ini adalah **alasannya**, dan sengaja dibiarkan utuh: yang
berharga bukan pilihannya melainkan mengapa alternatifnya ditolak.

### 2.0 Yang hanya ketahuan saat mengeksekusi — dan kenapa itu penting

**O52 (b) sendirian TIDAK menyembuhkan halaman Asset.** Sesudah
`private.brief_owner_am` dipasang, test jalur-baca-nyata (`reads_rls.test.ts`,
klaim `Creative/lead` di bawah `SET LOCAL ROLE authenticated`) menunjukkan Brief
lolos tapi **Asset tetap 404** — karena baris `assets` itu sendiri tak terlihat:

```
assets_select = jwt_can_read_all() OR assigned_pic = me OR created_by = me
```

Lead Creative bukan PIC dan bukan pembuat. Itu **O48 Grup B**, dan karena pemilik
sudah memilih (b) "per tabel sesuai kebutuhan halaman", tabel yang dibutuhkan
halaman hari ini adalah tabel ini — jadi arm-nya dipasang di ronde yang sama.

**Yang membuat ini bisa ditemukan sama sekali:** suite privileged biasa
**lolos di kedua keadaan**. Hanya test yang menjalankan klaim nyata di bawah
`SET LOCAL ROLE authenticated` yang bisa merah. Itulah sebabnya §2.1 dulu menulis
"perbaikannya wajib membawa test semacam itu" — dan itu terbukti bukan formalitas.

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

### 2.3 O44-asal / O42 — ⚠️ KOREKSI: O44-asal SUDAH SELESAI SEJAK 29 JULI

Rekomendasi yang berdiri di sini sebelumnya ("port 3 route auth ke `apps/api`")
**menjawab masalah yang sudah tidak ada.** Diverifikasi di kode, bukan di
dokumen:

- **(a)** `parity-scan.ts` sudah punya `walkFe(FE_SRC)` **rekursif** atas seluruh
  `web-internal/src` — bukan `readdirSync` datar atas `src/lib`.
- **(b)** Keenam route admin dilayani:
  `apps/api/src/app/api/v1/admin/{employees,role-mappings,layered-roles,employee-import}`.
- **(c)** Ketiga route auth **ada** — `auth/change-password`,
  `auth/admin/set-password`, `auth/admin/credentials`. O44c diputus pemilik
  2026-07-29 arah (c) dan sudah diimplementasi.

`KNOWN_GAPS` kosong. **O44-asal tidak memblokir C-04, dan sudah tidak sejak 29
Juli.**

Yang benar-benar tersisa dari kluster itu: **O42 pertanyaan (3) — rekonsiliasi
`role_mappings` 38-vs-23-vs-12**, mana yang jadi sumber kebenaran. Itu milik
pemilik.

**Ini kejadian kedua berturut-turut** (yang pertama X-10, §1.3): daftar
"terbuka" yang disalin antar-handoff hidup lebih lama dari masalahnya. Aturan
yang dipasang: **cocokkan §Open ke §Decided SEBELUM menyalin, bukan sesudah.**

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

### 2.6 Urutan yang DIJALANKAN (dan koreksinya)

Urutan yang direncanakan menaruh **O44-asal lebih dulu** karena ia dikira
memblokir C-04. Verifikasi kode menghapus langkah itu seluruhnya (§2.3), jadi
yang benar-benar dikerjakan:

1. **O51 (a)** — kecil, menutup kelasnya, `role_mappings` masuk `rls_checks` §9.
2. **O52 (b)** — read model inti; test klaim-nyata dibuat lebih dulu supaya
   perbaikannya bisa dibuktikan, bukan diasumsikan.
3. **O48 Grup B** — tidak direncanakan sebagai tiket terpisah; ia **muncul dari**
   test O52 yang tetap merah (§2.0). Ledger §42 dipasang bersamanya.
4. **O45** — tetap di checklist QA, bukan tiket kode.

Yang layak dibawa ke sesi berikutnya sebagai kebiasaan: **tulis test jalur-baca
di bawah klaim nyata SEBELUM perbaikannya.** Di ronde ini test itulah yang
memberi tahu bahwa perbaikan pertama belum menyembuhkan halamannya.

## 3. Yang masih menunggu pemilik sesudah sesi ini

| # | Isi | Bentuk jawaban yang dibutuhkan |
|---|---|---|
| **O42 (3)** | Rekonsiliasi `role_mappings` **38-vs-23-vs-12** | Mana yang jadi sumber kebenaran. Ini **satu-satunya** sisa kluster O42/O44 |
| **O45** | Cek paritas-grant menembak live | Rekomendasi §2.5: langkah QA ber-service-role, bukan CI |
| **O24** | `commission_rule` riil per 32 layanan MSL | Rate per layanan. O25 sudah selesai; ini tidak |
| **X-06** | RA-7 — tautan klien tanpa riwayat/diff | Konfirmasi posisi (contoh di backlog §4) |
| **X-11** | 🆕 D-3 jadi turunan D-2, atau tetap diketik? | Konsekuensi jawaban X-04. Mengubah `W`→Auto butuh persetujuan. **Menggigit di A-08** |
| **X-12** | 🆕 "point log buruk" X-07 belum punya komponen KPI | Nama komponen + bobot (dari mana diambil, total tetap 100) + ambang "terlambat" |

**X-08** tetap terbuka tapi **bukan milik pemilik** — itu keputusan developer
(daftar metrik manual ditulis eksplisit, tidak dicampur dengan yang auto).

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

### 4.1 Keputusan pemilik: **(b)** — dan apa yang BELUM dijalankan

Pemilik menyetujui (b). Yang perlu dibaca apa adanya sebelum siapa pun
melaporkannya selesai:

- **Menghapus branch ≠ menghapus PII.** Menghapus ~85 branch basi mengecilkan
  permukaan rewrite; ia tidak menghapus satu byte pun selama `f8faf12` masih
  terjangkau dari `main`.
- **Langkah (2) — `git filter-repo` + force-push — TIDAK dijalankan di sesi
  ini, dan itu keputusan sadar.** Sesi ini membawa tiga migrasi + perbaikan cacat
  yang belum di-merge; menulis ulang histori di bawah kerja yang mengambang
  adalah cara paling mudah kehilangan keduanya.
- **Langkah (2) butuh sesi tersendiri**: nol pekerjaan mengambang, clone segar,
  dan pemilik siap mengabari kontributor untuk re-clone.
- **Langkah (3) tiket GitHub Support** tetap wajib — tanpa gc dari sisi mereka,
  halaman commit di PR lama tetap bisa dibuka lewat URL langsung.

### 4.2 🔴 …dan kemudian premisnya runtuh — dengan cara yang menguntungkan

Saat menyiapkan langkah (1), premis seluruh rencana diverifikasi alih-alih
dipercaya:

```
git merge-base --is-ancestor f8faf12 origin/main   # -> FALSE
```

**`main` tidak menjangkau commit PII-nya.** Repo pernah di-re-root; lineage lama
terputus, dan **46 branch bahkan tidak punya merge base** dengan `main`. Hanya
**26 ref** yang menjangkau `f8faf12`, dan `main` bukan salah satunya.

| | Rencana (b) sebagaimana ditulis | Yang sebenarnya dibutuhkan |
|---|---|---|
| Rewrite histori `main` | wajib | **tidak perlu** |
| Force-push · re-clone semua orang | wajib | **tidak perlu** |
| Branch dihapus | ~85 | **26** |
| Tiket GitHub Support | wajib | wajib (tidak berubah) |

**Langkah (1) dicoba dan DITOLAK dari sesi ini** — `403` dari remote;
hapus-branch di luar izin sesi. Runbook lengkap, daftar 26 branch, SHA
pemulihan tiap branch, dan cara menghasilkan ulang daftarnya:
**`docs/handoff/RUNBOOK_O47b_SCRUB_PII.md`**.

**Catatan metode yang layak dibawa:** klasifikasi "branch basi" tidak boleh
bersandar pada `rev-list --count main..branch` saja — PR di-squash-merge, jadi
branch yang kerjanya sudah masuk tetap terlihat punya ratusan commit unik.
Percobaan kedua salah lebih halus dan lebih berbahaya: `git diff main...branch`
**gagal** dengan *no merge base* untuk 46 branch, dan skrip yang membaca
keluaran kosong sebagai "aman" nyaris menandai 46 branch sebagai aman-dihapus
**karena perintahnya error**. Ketahuan sebelum ada yang dihapus, dan hanya
karena angkanya (46 "aman" mendadak muncul dari nol) tidak masuk akal.

Sampai langkah (2) verifikasi dan (3) Support selesai: **jangan laporkan PII
sudah bersih.**

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

## 6. Apa yang tersisa — urutan yang disarankan

1. **O47b langkah (1)** — hapus 26 branch pembawa PII, lalu verifikasi, lalu
   tiket Support. Butuh izin hapus-branch (sesi ini `403`). **Bukan** lagi
   operasi berisiko: nol rewrite, nol force-push, nol re-clone. Runbook:
   `docs/handoff/RUNBOOK_O47b_SCRUB_PII.md`.
2. **O42 (3)** — butuh jawaban pemilik, bukan kode.
3. **Kembali ke fitur M6** sesuai O56 sesudah ronde cacat: **A-08** (Section D +
   asumsi) → **A-09** (Section E…J) → **A-13** (halaman & form) → **B-01**
   (`PLAN` + 6 tabel anak).
   - A-08 **terblokir X-11** (D-3 turunan atau diketik). Jangan pilih sendiri.
   - B-06/B-07/B-09 wajib dibaca ulang dengan **deviasi X-07**: penutupan
     periode berhenti mengunci.
4. **O48** berjalan terus sebagai pekerjaan, bukan pertanyaan: setiap kali sebuah
   halaman butuh tabel dari ledger §42, tabel itu dapat arm-nya dan barisnya
   dicoret dari daftar — dalam commit yang sama.

## 7. Jebakan lingkungan — tambahan atas §5.1

Postgres di-SIGKILL **lagi** di tengah sesi ini (SESI6 §3.2, kambuh). Gejalanya
kali ini bukan test merah melainkan `pg_isready` menolak koneksi begitu saja.
`service postgresql start` + set ulang password menyelesaikannya; DB `cdps`
selamat, tapi jangan berasumsi begitu — `npm run db:rebuild -- --yes` murah.
