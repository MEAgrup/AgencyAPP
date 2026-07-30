# HANDOFF — Cutover Sesi 22 (semua kerja engineering ter-commit & ter-push · satu apply menunggu persetujuan)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI21.md`. §0-nya **sudah dikoreksi** di sesi ini — versi yang
> Anda baca sekarang akurat; jangan pakai salinan §0 dari catatan/chat lama, ia memuat
> `repo↔live 41 = 41` dan `apps/api 301` yang keduanya **salah**.
>
> Yang masih berlaku dan tidak diulang di sini: SESI9 §6 (aturan rumah) · SESI12 §2.4
> (`npm run db:rebuild`) · SESI19 §3.1, SESI20 §3.1, SESI21 §3.1 (daftar "jangan dikerjakan") ·
> SESI21 §1.1 (runbook apply: **baca versi yang benar-benar tercatat**) · SESI21 §3 (keputusan
> `managed_since`).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | **`claude/go-retirement-progress-eq0855`** — lanjutkan di sini, jangan buka branch baru |
| **Keadaan branch** | Working tree **bersih**, **nol commit belum ter-push**, `HEAD` = `origin/<branch>` — keadaan itu yang dijamin, **bukan** sha tertentu (§1.2) |
| **`main`** | **`efd59aa`** = Merge PR #81. Rantai: #75 → #77 → #76 → #79 → #78 → #80 → **#81** |
| **PR** | **#82**, **terbuka**, **belum di-merge**, `mergeable_state: clean`. Menunggu review/merge pemilik |
| **CI** | **hijau seluruhnya** pada commit terakhir sebelum berkas ini ditambahkan. Berkas ini **memicu run baru**, jadi baca check run PR #82 — jangan percaya baris ini |
| **Live `CDPS SG`** | **41 migrasi · 54 tabel · 17 event** — migrasi O46 sudah di-apply 2026-07-30, tapi **arm-nya MATI** (§2 butir 1) |
| **Repo vs live** | 🟠 **42 repo vs 41 live** — **SENGAJA**. Selisihnya **satu** berkas: `20260730100000_fix_o46_division_resolution.sql`, menunggu persetujuan apply. Untuk **41 migrasi yang sudah di live**, nama berkas = versi live **1:1** |

**Angka acuan** (Postgres 16 lokal, DB dibangun ulang dari nol, **42/42** migrasi bersih — dijalankan
ulang 2026-07-30 di sesi ini, **bukan** disalin dari commit message atau sesi sebelumnya):
`apps/api` **307** · `@cdps/domain` **566** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** (54 tabel · 14 `sm_machines` · 17 `notif_events`) ·
4 invariant SQL **PASS** (`rls_checks` **23 check**) · `route-parity` **5/5 `KNOWN_GAPS` KOSONG** ·
`NESTED_INLINE_UNCHECKED` **KOSONG** · `RFC3339_PENDING_DECISION` **1 entri** (`managed_since`).

> **Sha HEAD, jumlah commit, dan status CI SENGAJA tidak dipin di tabel ini** — berkas ini sendiri
> menggeser ketiganya saat di-commit, jadi angka apa pun di sini salah pada commit yang menuliskannya.
> Itu bukan kehati-hatian teoretis: versi SESI21 melakukannya dan butuh dua commit untuk dibereskan
> (§1.2). Baca sumbernya, yang tidak bisa basi:
>
> ```bash
> git log --oneline main..HEAD          # isi & jumlah commit branch
> git status --short                    # kosong = bersih
> ```
>
> …dan check run PR #82 untuk CI.

**Perintah untuk melanjutkan:**

```bash
git fetch origin claude/go-retirement-progress-eq0855
git checkout claude/go-retirement-progress-eq0855   # sudah ada di remote
git log --oneline main..HEAD                        # commit teratas = kerja terakhir sesi ini
npm run db:rebuild -- --yes                         # 42/42 migrasi; butuh Postgres 16 lokal jalan
```

---

## 1. Yang dikerjakan sesi ini — koreksi dokumen, nol perubahan perilaku

Sesi ini **tidak** menambah fitur dan **tidak** menyentuh live. Isinya lima commit koreksi (tabel di
bawah) **plus berkas handoff ini** — **semuanya dokumentasi**: nol perubahan kode, migrasi, skema, dan
nol perubahan aturan izin. Didaftar per **kerja**, bukan per hitungan, dengan alasan yang sama seperti
§0.

Pemicunya: commit `d31a7f9` (perbaikan O46, sesi sebelumnya) menggeser dua angka —
**repo 41→42 migrasi**, `apps/api` **301→307** — dan **mencabut satu klaim** (*"lead sudah bisa baca
audit divisinya"*). Dokumen yang menyatakannya tidak ikut bergerak, jadi mereka melaporkan keadaan
**lebih sehat daripada kenyataan**: kelas cacat yang sama dengan yang `d31a7f9` temukan di DB, hanya
di prosa.

| Commit | Yang diperbaiki |
|---|---|
| `9a4888a` | **`SESI21` §0** — `Repo vs live: ✅ COCOK 1:1 — 41 = 41` (nyatanya 42 vs 41) · `41/41` · `apps/api 301`. Ditambah **§2 butir 0**: apply perbaikan adalah **prasyarat** probe lead |
| `5999f1b` | **`PERMISSIONS.md`** — membaca `O46 RESOLVED` tanpa kualifikasi, padahal arm-nya ship **MATI** |
| `e1202d5` | §0 hasil koreksi saya sendiri menulis "3 commit · CI hijau pada `d31a7f9`" — **basi pada commit yang menuliskannya** |
| `a7626a3` | Blockquote `e1202d5` mendarat **di tengah tabel §0** dan memecahnya jadi dua |
| `132cb49` | Catatan **O48** masih menyebut `transactions`/`audit_log` *"enforced"* — **bertentangan** dengan catatan merah 20 baris di atasnya |

### 1.1 🔴 Temuan baru yang harus masuk keputusan O48

Kalau kedua arm O46 tidak menyala, angka O48 yang sebenarnya **bukan 36 dari 45** policy SELECT tanpa
arm lead, melainkan **45 dari 45**. Survei O48 menghitung **TEKS** policy, bukan apakah arm-nya
benar-benar **menyala** — dan perbedaan itu justru seluruh isi temuan O46. Angka 36 akan pulih
menjadi benar begitu `20260730100000` di-apply. **Ambil keputusan O48 dengan angka yang benar.**

### 1.2 Pelajaran proses dari sesi ini

- **Angka yang menghitung sesuatu yang mencakup dirinya sendiri tidak bisa benar di dalam berkas yang
  ia hitung.** "3 commit" jadi salah oleh commit yang menuliskannya; menaikkannya ke "5" membuatnya 6.
  Solusinya **menghapus** angkanya dan menunjuk sumber yang tidak bisa basi, bukan memperbaruinya.
- **Catat keadaan + alasannya, bukan angka yang butuh disentuh setiap commit.** Pola itu sudah dipakai
  baris *"Repo vs live"* dan sekarang dipakai baris commit/CI juga.
- **Baca kembali hasil edit, jangan asumsikan tempelan mendarat di tempat yang benar.** `a7626a3` ada
  karena `e1202d5` memecah tabel yang sedang ia anotasi — ketahuan hanya karena tabelnya dibaca ulang.
- **Tiga dari lima commit sesi ini memperbaiki cacat yang sesi ini sendiri buat.** Itu bukan
  kecelakaan statistik: mengedit tabel "posisi persis" sambil menjadi bagian dari posisi itu memang
  rawan, jadi perlakukan §0 dengan kecurigaan ekstra.

---

## 2. Sisa pekerjaan — urutan butir 1 → 2 MENGIKAT

| # | Butir | Siapa |
|---|---|---|
| 1 | 🔴 **Apply `20260730100000_fix_o46_division_resolution.sql` ke live** — *jalur kritis*. Sesudah apply, **baca versi yang benar-benar tercatat** (`select version from supabase_migrations.schema_migrations order by version desc limit 1`) lalu **ganti nama berkas repo** supaya cocok (SESI21 §1.1) | persetujuan **pemilik** → eksekusi Claude |
| 2 | **Probe lead riil** — mis. Head of Account `2305100275`, Head of Sales `2101180004`: login, buka halaman transaksi/riwayat, pastikan melihat data divisinya. **HANYA sesudah butir 1** | **pemilik** |
| 3 | **Merge PR #82** (CI hijau, `mergeable_state: clean`) | **pemilik** |
| 4 | **C-03 — 3 SKIP** 🔴 *jalur kritis* — `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`, dari mesin ber-akses `*.vercel.app` | **pemilik** |
| 5 | **O49 butir (b) `managed_since`** — butuh **1 kalimat** head dev; eksekusinya satu baris + hapus entri ledger (test *"ledger jujur"* akan **memaksa** penghapusan itu). Rekomendasi: `tz.dateString()`. Detail SESI21 §3 | **head dev** → Claude |
| 6 | **O48** — pakai angka **45/45**, bukan 36/45 (§1.1) | keputusan **pemilik**, eksekusi Claude |
| 7 | **A4** — 12 mapping ambigu + lead Ads/Marketing/KOL + O35 + O9 → `O34_O26_O35_WORKSHEET_ROSTER_V2.md` | **pemilik** |
| 8 | **Backup MySQL Railway + OQ-2** · **rencana rollback** | **pemilik** |
| 9 | **Gate GO** → **C-05** (cabut `backend/`) | **pemilik** → Claude |

**Kenapa urutan 1 → 2 mengikat:** selama arm masih mati, probe lead **dijamin** kosong, dan hasil
kosong **tidak bisa dibedakan** antara *"arm mati"* dan *"klaim JWT tidak membawa `level=lead`"*.
Policy benar + klaim salah memberi hasil **identik** dengan policy salah. Menjalankan butir 2 lebih
dulu menghasilkan bukti yang tidak bisa ditafsirkan. Kalau ia kosong **sesudah** apply, yang diperiksa
`trg_sync_claims_mapping` (preseden verifikasi O33 2026-07-29), **bukan** policy-nya.

**O47b** (PII di histori git, 89 branch) tidak memblokir apa pun — rekomendasi tetap: terima risikonya
dengan pemicu eksplisit.

## 3. Yang JANGAN dikerjakan

Seluruh daftar SESI19 §3.1, SESI20 §3.1, dan SESI21 §3.1 masih berlaku. Penegasan yang paling relevan
sekarang:

- **Jangan apply ulang `rls_o46_lead_division_arms`** — sudah di live sebagai `20260730091540`.
- **Jangan ganti nama migrasi yang sudah di live.** Nama repo mengikuti ledger live, bukan sebaliknya.
- **Jangan anggap `20260730100000` sudah di live** hanya karena ia ada di repo dan CI hijau. CI
  membangun DB **lokal**; ia tidak pernah menyentuh `CDPS SG`.
- **Jangan tulis ulang entri `DECISIONS.md` yang lama** supaya "konsisten" dengan temuan baru — log
  keputusan itu **append-only** (aturan rumah #3). Entri `O46 RESOLVED` 2026-07-30 tetap apa adanya;
  koreksinya adalah entri **baru** di atasnya, dan itu memang bentuk yang benar.
- **Jangan tambah baris ke `KNOWN_GAPS`, `NESTED_INLINE_UNCHECKED`, atau `RFC3339_PENDING_DECISION`**
  tanpa entri `DECISIONS.md`. Ketiganya hanya boleh **menyusut**.
- **Jangan bangun apa pun di `backend/`** — ia oracle paritas read-only sampai C-05 mencabutnya.
