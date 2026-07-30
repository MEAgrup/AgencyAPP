# HANDOFF — Cutover Sesi 23 (O46 SELESAI dan TERBUKTI menyala di produksi · jalur kritis butir 1–2 tertutup)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI22.md`. **§0 dan §2 butir 1–2 berkas itu SALAH** — dan sudah
> salah pada saat ditulis (§1.1 di bawah). Berkas itu kini memuat spanduk "digantikan"; jangan salin
> §0-nya. Yang masih sahih darinya: §1.2 (pelajaran proses) dan §3 (jangan-dikerjakan).
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4 (`npm run db:rebuild`) ·
> SESI19 §3.1, SESI20 §3.1, SESI21 §3.1 (daftar "jangan dikerjakan") · SESI21 §3 (keputusan
> `managed_since`).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | **`claude/go-retirement-progress-eq0855`** — lanjutkan di sini, jangan buka branch baru |
| **Keadaan branch** | Working tree **bersih**, **nol commit belum ter-push**, `HEAD` = `origin/<branch>` — keadaan itu yang dijamin, **bukan** sha tertentu (SESI22 §1.2) |
| **`main`** | **`efd59aa`** = Merge PR #81. Rantai: #75 → #77 → #76 → #79 → #78 → #80 → **#81** |
| **PR** | **#82**, **terbuka**, **belum di-merge**. Menunggu review/merge pemilik |
| **CI** | Berkas ini memicu run baru — **baca check run PR #82**, jangan percaya baris mana pun di sini |
| **Live `CDPS SG`** | **42 migrasi · 54 tabel · 17 event**. Migrasi terakhir `20260730120433_fix_o46_division_resolution`, tercatat **2026-07-30 12:04:33 UTC** |
| **Repo vs live** | ✅ **42 = 42, nama berkas = versi live 1:1** — diverifikasi terhadap live **di sesi ini**, bukan diwarisi dari handoff (§1.1) |
| **O46** | ✅ **MENYALA dan TERBUKTI** — probe 8 skenario, 2 kontrol hijau (§1.2). Ini menutup butir 1 **dan** 2 SESI22 |

**Angka acuan** (Postgres 16 lokal, DB dibangun ulang dari nol, **42/42** migrasi bersih —
dijalankan di sesi ini):
`apps/api` **310** · `@cdps/domain` **566** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** (54 tabel · 14 `sm_machines` · 17 `notif_events`) ·
4 invariant SQL **PASS** (`rls_checks` **23 check**) · `route-parity` **5/5 `KNOWN_GAPS` KOSONG** ·
`NESTED_INLINE_UNCHECKED` **KOSONG** · `RFC3339_PENDING_DECISION` ✅ **KOSONG** (O49 (b) selesai —
`managed_since` adalah penghuni terakhirnya, §1.4). **Ketiga ledger kini kosong.**

> **Sha HEAD, jumlah commit, dan status CI SENGAJA tidak dipin** (alasan: SESI22 §1.2). Baca
> sumbernya:
>
> ```bash
> git log --oneline main..HEAD          # isi & jumlah commit branch
> git status --short                    # kosong = bersih
> ```
>
> **Dan baris "Live"/"Repo vs live" WAJIB dibaca ulang dari live** (`list_migrations`), bukan disalin
> dari tabel ini — itu justru cacat yang §1.1 catat.

**Perintah untuk melanjutkan:**

```bash
git fetch origin claude/go-retirement-progress-eq0855
git checkout claude/go-retirement-progress-eq0855
git log --oneline main..HEAD
npm install                                          # deps tidak ada di container baru
service postgresql start                             # Postgres 16 lokal
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""   # test pakai TCP, bukan peer
npm run db:rebuild -- --yes                          # 42/42 migrasi
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

---

## 1. Yang dikerjakan sesi ini

Nol perubahan perilaku produk. Satu **rename migrasi** (wajib, §1.1), satu **probe live read-only**
(§1.2), dan koreksi dokumen yang mengikutinya. Live **tidak ditulis** sama sekali di sesi ini —
apply-nya sudah terjadi sebelum sesi ini dimulai.

### 1.1 🔴 Temuan: §0 SESI22 sudah SALAH pada saat ditulis — dan kenapa itu lolos

SESI22 §0 menyatakan `Repo vs live: 42 repo vs 41 live` dan §2 butir 1 menyatakan perbaikan O46
**menunggu persetujuan apply**. Keduanya salah:

| | |
|---|---|
| Perbaikan tercatat di live | **2026-07-30 12:04:33 UTC**, sebagai `20260730120433_fix_o46_division_resolution` |
| Commit yang menulis SESI22 (`21230e0`) | **13:22:11 UTC** — **78 menit SESUDAHNYA** |

Apply-nya dilakukan pemilik di luar sesi. Isi kedua fungsi di live diverifikasi dengan
`pg_get_functiondef` dan **identik** dengan berkas repo, jadi ini apply yang benar — hanya tidak
tercatat di handoff.

**Kenapa ini pelajaran, bukan sekadar koreksi.** Seluruh SESI22 dihabiskan memperbaiki dokumen yang
melaporkan keadaan **lebih sehat daripada kenyataan** — lalu melakukan kesalahan yang sama, dalam
arah sebaliknya. Sesi itu memverifikasi ulang angkanya dengan sungguh-sungguh: DB lokal dibangun
ulang dari nol, semua test dihitung ulang, `git log` dibaca. Yang **tidak** dilakukannya: menanyai
live, satu kali pun.

> **Aturan yang lahir: membangun ulang DB lokal membuktikan repo konsisten dengan DIRINYA SENDIRI; ia
> tidak bisa memberi tahu apa yang ada di `CDPS SG`.** Baris apa pun tentang keadaan **live** wajib
> dibaca dari live **pada sesi yang menuliskannya**. Handoff adalah **klaim**, bukan pengukuran —
> mewarisinya adalah cara sebuah angka basi bertahan melintasi sesi yang masing-masing merasa sudah
> memverifikasi.

**Rename yang mengikutinya (aturan SESI21 §1.1).** `apply_migration` sekali lagi menetapkan versi
dari **waktu apply** (`120433`), bukan dari nama berkas (`100000`). Berkas di-`git mv` ke
`20260730120433_…`; DB lokal dibangun ulang **42/42 bersih**. **Dua dari dua apply terakhir menggeser
versi ⇒ perlakukan pergeseran itu sebagai perilaku NORMAL `apply_migration`, bukan anomali.**

### 1.2 ✅ Probe pasca-apply — O46 menyala, dan dua ambiguitas lama ikut tertutup

Read-only: klaim JWT disuntik, `set local role authenticated`, `ROLLBACK`. **Angka pembedanya
ditetapkan lebih dulu** supaya hasilnya tidak bisa ditafsirkan dua arah: Sales lead `2101180004`
punya **32** entri audit sendiri sementara divisi Sales punya **36** ⇒ **36 = arm menyala, 32 = arm
mati.**

| # | Skenario | Harapan | Hasil |
|---|---|---|---|
| S1 | lead Sales baca `audit_log` | 36 | ✅ **36** (sebelum perbaikan: 32) |
| S2 | `private.jwt_same_division('2110040032')` dari lead Sales | true | ✅ **true** (sebelumnya `false`) |
| S3 | **staff** Sales baca `audit_log` | 0 | ✅ **0** — staff tidak ikut melebar |
| S4 | lead **Creative** baca `audit_log` | 0 | ✅ **0** — 36 baris Sales **tidak bocor** |
| S5 | **kontrol** Director | 40 | ✅ **40** |
| S6 | **kontrol-negatif** klaim kosong | 0 | ✅ **0** |
| S7 | OD ber-divisi **kosong** | 40 | ✅ **40** — guard tidak mematikan OD |
| S8 | **lead** ber-divisi **kosong** | 0 | ✅ **0** |

**Guard `jwt_division() <> ''` terbukti LOAD-BEARING, bukan kerapian:** **7** karyawan live saat ini
resolve ke divisi **kosong**. Tanpa guard, satu lead ber-divisi kosong akan mencocokkan ketujuhnya.

**Kontrol itu bukan formalitas — S5 sempat MERAH (0, bukan 40).** Sebabnya klaim probe saya salah
kunci: `is_director`, padahal helper membaca `director`. Policy-nya tidak pernah salah; **probe
sayalah yang salah.** Persis kelas kesalahan yang kontrol positif ada untuk menangkap — tanpa S5,
angka "0" dari skenario mana pun tidak bisa dibedakan dari harness rusak.

**Ambiguitas SESI21 yang ikut tertutup.** SESI21 memperingatkan: *"policy benar + klaim salah memberi
hasil identik dengan policy salah"*, jadi probe ber-klaim-suntikan saja **tidak** cukup — ia
membuktikan policy benar **jika** klaimnya benar. Karena itu `auth.users.raw_app_meta_data` dibaca
langsung dari live:

| `employee_id` | division | level |
|---|---|---|
| `2101180004` | `Sales` | **`lead`** |
| `2305100275` | `Account` | **`lead`** |
| `2412230480` | `Creative` | **`lead`** |
| `2110040032` | `Sales` | `staff` |

Klaim tersimpan **identik** dengan yang disuntikkan ⇒ policy **dan** klaim sama-sama benar.
`trg_sync_claims_mapping` tidak perlu diperiksa.

### 1.3 🟠 Batas bukti — dinyatakan, bukan didiamkan

- **`transactions` KOSONG di live (0 baris).** Arm `transactions_select` karena itu bersandar pada
  helper bersama (`private.jwt_division_owns_client`, resolusi `employee_claims()` yang sama) +
  `rls_checks`, dan **belum** terbukti oleh data live. **Probe ulang begitu transaksi riil ada.**
- **Head of Account `2305100275` bukan subjek probe yang berguna hari ini:** divisi Account punya
  **0** entri audit, jadi hasilnya `0` baik arm menyala maupun mati — **tidak membedakan apa pun.**
  SESI21/SESI22 menyarankannya sebagai subjek probe; jangan pakai. Gunakan `2101180004` (Sales), satu-
  satunya divisi dengan selisih own-vs-divisi yang nyata (32 vs 36).
- **O48 kembali ke 36/45.** Angka 45/45 (SESI22 §1.1) benar **hanya selama** arm-nya mati. Yang tetap
  berlaku dari temuan itu: **survei O48 menghitung TEKS policy, bukan apakah arm-nya MENYALA.**

### 1.4 ✅ O49 butir (b) `managed_since` — ditutup, dan cara menutupnya adalah poinnya

Diputuskan **`tz.dateString()`** (`YYYY-MM-DD`), mengikuti tipe kolom
(`client_platforms.managed_since` = `date`) dan 3 dari 4 sumber. Ledger
`RFC3339_PENDING_DECISION` kini **kosong** — `managed_since` penghuni terakhirnya.

**Yang menahannya dua sesi adalah RISIKO, bukan ambiguitas:** kalau salah satu dari dua halaman
pemakainya mem-parsing nilainya sebagai timestamp, mengubah format memecahkan halaman itu. Itu
diselesaikan dengan **pengukuran**, bukan keberanian:

| Pemakai | Ternyata | Risiko |
|---|---|---|
| `sales/[id]/page.tsx` | form **TULIS** `<input type="date">` — **mengirim** `YYYY-MM-DD`, tidak pernah membaca wire | **nol** |
| `clients/[id]/page.tsx` | satu-satunya **PEMBACA**: `new Date(v).toLocaleString('id-ID')` | **nol** — diukur |

`new Date('2026-05-01')` (bentuk date-only = **UTC** per spec ECMAScript) menghasilkan instant
**identik** dengan `new Date('2026-05-01T00:00:00.000Z')` ⇒ rendering **byte-identical**, diuji di TZ
`Asia/Jakarta` dan `UTC`.

> **Pelajaran:** dua sesi menahan ini sebagai *"butuh keputusan head dev"*. Yang sebenarnya
> dibutuhkan adalah `node -e` dua baris. **Sebelum mengeskalasi sebuah keputusan, periksa apakah yang
> menahannya sebetulnya fakta yang bisa diukur.**

Dikunci **3 test baru** (`apps/api` 307 → **310**), termasuk satu yang mengunci **premis** kesetaraan
instant itu sendiri — jadi kalau kelak formatter FE diganti ke tengah malam **lokal**, test-nya merah
dan orangnya tahu halaman klien ikut bergeser. Divalidasi **2 mutasi**: balik ke `toISOString()` ⇒ 2
merah (nilai + gate sumber); ledger tidak jujur ⇒ test *"ledger jujur"* merah.

**🟠 Cacat FE terpisah yang SENGAJA tidak diperbaiki:** `formatDate` di `clients/[id]/page.tsx`
memakai `toLocaleString` (bukan `toLocaleDateString`), jadi ia merender jam **`07.00.00`** untuk
kolom tanggal. Salah sebelum maupun sesudah perubahan ini, dan **bukan** disebabkan olehnya.
Perbaikannya perubahan rendering FE dengan tiketnya sendiri.

---

## 2. Sisa pekerjaan

| # | Butir | Siapa |
|---|---|---|
| ~~1~~ | ✅ **Apply perbaikan O46** — tercatat live `20260730120433` (§1.1) | selesai |
| ~~2~~ | ✅ **Probe lead** — 8 skenario + klaim riil, O46 terbukti menyala (§1.2) | selesai |
| ~~3~~ | ✅ **O49 butir (b) `managed_since`** — `tz.dateString()`, ledger `RFC3339_PENDING_DECISION` KOSONG (§1.4) | selesai |
| 1 | **Merge PR #82** | **pemilik** |
| 2 | **C-03 — 3 SKIP** 🔴 *jalur kritis* — runbook `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`, **titik masuknya `HANDOFF_C03_MESIN_VERCEL.md`** (apa yang berubah sejak runbook ditulis + satu probe end-to-end baru). Dari mesin ber-akses `*.vercel.app` | **pemilik** |
| 4 | **A4** — daftar pertanyaan **tertutup** `O34_O26_O35_WORKSHEET_ROSTER_V2.md` §3.1–§3.6; **§5 memuat verifikasi live**: Ads/KOL/Marketing **nol pemegang lead**, 24 dari 69 karyawan terdampak. **Mendahului O48** | **pemilik** |
| 5 | **O48** — **`O48_ANALISIS_KEPUTUSAN.md`**: angka terukur **35/45** (bukan 36), **32 kandidat nyata**, dikelompokkan A–E, **nol helper baru** (keduanya sudah live & terbukti). **Sesudah A4.** Rekomendasi: putuskan Grup C+D dulu | keputusan **pemilik + head dev**, eksekusi Claude |
| 6 | **Backup MySQL Railway + OQ-2** · **rencana rollback** | **pemilik** |
| 7 | **Gate GO** → **C-05** (cabut `backend/`) | **pemilik** → Claude |
| 8 | **Probe ulang `transactions`** begitu ada transaksi riil (§1.3) | Claude, saat datanya ada |

**O47b** (PII di histori git, 89 branch) tidak memblokir apa pun — rekomendasi tetap: terima
risikonya dengan pemicu eksplisit.

## 3. Yang JANGAN dikerjakan

Seluruh daftar SESI19 §3.1, SESI20 §3.1, SESI21 §3.1, dan SESI22 §3 masih berlaku. Penegasan yang
paling relevan sekarang:

- **Jangan apply ulang `20260730091540` atau `20260730120433`** — keduanya sudah di live.
- **Jangan ganti nama migrasi yang sudah di live.** Nama repo mengikuti ledger live, bukan sebaliknya.
- **Jangan salin baris "Live"/"Repo vs live" dari handoff mana pun** — baca dari live (§1.1).
- **Jangan tulis ulang entri `DECISIONS.md` yang lama.** Log itu append-only (aturan rumah #3). Entri
  lama yang menyebut `20260730100000` **tetap apa adanya**; koreksinya adalah entri **baru** di
  atasnya, dan itu memang bentuk yang benar.
- **Jangan tambah baris ke `KNOWN_GAPS`, `NESTED_INLINE_UNCHECKED`, atau `RFC3339_PENDING_DECISION`**
  tanpa entri `DECISIONS.md`. Ketiganya hanya boleh **menyusut**.
- **Jangan bangun apa pun di `backend/`** — ia oracle paritas read-only sampai C-05 mencabutnya.
