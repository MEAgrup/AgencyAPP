# HANDOFF — Cutover Sesi 21 (migrasi O46 SUDAH di live · tapi arm-nya MATI, perbaikannya menunggu apply)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI20.md` — §1-nya sudah **dieksekusi**, jangan dijalankan lagi.
> Yang masih berlaku tidak diulang: SESI9 §6 (aturan rumah), SESI12 §2.4 (`npm run db:rebuild`),
> SESI19 §3.1 & SESI20 §3.1 (daftar "jangan dikerjakan").

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **`main`** | **`efd59aa`** = Merge PR #81. Rantai: #75 → #77 → #76 → #79 → #78 → #80 → **#81** |
| **Branch aktif** | `claude/go-retirement-progress-eq0855` — di-reset dari `main@efd59aa`, **3 commit**: rename migrasi + docs · O49 (a) · **perbaikan O46 (`d31a7f9`)** |
| **PR terbuka** | satu — **#82**, untuk branch di atas, **CI hijau 11/11** pada `d31a7f9`. Sebelum itu **nol** |
| **Live `CDPS SG`** | ✅ **41 migrasi · 54 tabel · 17 event** — migrasi O46 **sudah di-apply 2026-07-30**, tapi **arm-nya MATI** (§1.2) |
| **Repo vs live** | 🟠 **42 repo vs 41 live** — SENGAJA. Selisihnya **satu** berkas: `20260730100000_fix_o46_division_resolution.sql`, menunggu persetujuan apply (§1.2). Untuk **41 migrasi yang sudah di live**, nama berkas = versi live **1:1** |

**Angka acuan** (Postgres 16 lokal, DB dibangun ulang dari nol, **42/42** migrasi bersih — diverifikasi
ulang 2026-07-30 sesudah commit perbaikan O46, bukan disalin dari sesi sebelumnya):
`apps/api` **307** · `@cdps/domain` **566** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** · 4 invariant SQL **PASS** (`rls_checks` **23 check**) ·
`route-parity` **5/5 `KNOWN_GAPS` KOSONG** · `NESTED_INLINE_UNCHECKED` **KOSONG** ·
`RFC3339_PENDING_DECISION` = **1 entri** (`managed_since`, §3).

> **Kenapa baris "Repo vs live" tidak lagi ✅:** versi pertama berkas ini menulis "COCOK 1:1 — 41 = 41",
> lalu commit perbaikan O46 menambah migrasi ke-42 di repo **tanpa** memperbarui tabel ini. Selisih
> repo↔live adalah satu-satunya angka yang mendeteksi drift kelas **O38**, jadi tabel yang
> melaporkannya hijau padahal selisihnya 1 justru mematikan alat deteksinya. Selisih yang **disengaja
> dan dinyatakan** aman; selisih yang **dilaporkan nol** tidak.

---

## 1. Yang dikerjakan: apply O46 ke live, dengan verifikasi dua arah

Pemilik memberi persetujuan per-apply eksplisit. Urutannya sengaja: **verifikasi premis dulu**,
apply, verifikasi hasil — bukan apply lalu berharap.

**Sebelum apply** (membuktikan premis handoff SESI20, tidak mengasumsikannya):
`40 migrasi · 54 tabel · 17 event · 0 helper O46 · 0 policy ber-arm lead`.

**Sesudah apply:**

| Cek | Hasil |
|---|---|
| jumlah migrasi | **41** ✓ (dari 40) |
| tabel `public` | **54** ✓ tidak bergerak |
| `notif_events` | **17** ✓ tidak bergerak |
| kedua helper | `private.jwt_division_owns_client`, `private.jwt_same_division` ✓ |
| helper bocor ke `public` | **0** ✓ — kalau bukan nol, itu permukaan RPC publik baru |
| policy ber-arm `jwt_is_lead()` | **2** ✓ (`transactions_select`, `audit_log_select`) |

### 1.1 🔴 Temuan yang harus dibawa ke setiap apply berikutnya

**`apply_migration` menetapkan versinya sendiri dari waktu apply, bukan dari nama berkas repo.**
Ia mencatat **`20260730091540`**, sedangkan berkasnya bernama `20260730073000`.

Itu penting karena repo ini menjaga invariant **nama berkas = versi live, 1:1** — diverifikasi:
kelima migrasi terakhir sebelum ini (`20260729162101`, `20260729104209`, `20260729032805`,
`20260729031525`, `20260727072443`) cocok **persis**. Membiarkan ketidakcocokan berarti
`supabase db push` dari clone bersih akan mencoba meng-apply versi yang **tidak ada di ledger
live** — drift kelas **O38**, penyakit yang seluruh aturan migrasi `CLAUDE.md` ada untuk mencegah.

**Ditutup:** berkas di-`git mv` ke `20260730091540_rls_o46_lead_division_arms.sql`, dan **7 rujukan**
diperbarui (`rls_checks.sql` · `DECISIONS.md` ×2 · `PERMISSIONS.md` · `HANDOFF_CUTOVER_SESI20.md` ×3).
`grep -rn "20260730073000"` kini hanya mengembalikan **narasi yang mendokumentasikan penggantian
nama itu sendiri** (entri `DECISIONS.md` + berkas ini) — **nol rujukan fungsional**, diverifikasi.
DB lokal dibangun ulang dengan nama baru: 41 migrasi, semua gate & invariant lolos — urutan tetap
benar karena `091540` > `20260729162101`.

> **Aturan untuk sesi berikutnya:** sesudah `apply_migration`, **baca versi yang benar-benar
> tercatat** (`select version from supabase_migrations.schema_migrations order by version desc
> limit 1`) lalu ganti nama berkas repo supaya cocok. Jangan asumsikan nama berkas Anda yang
> dipakai.

### 1.2 🔴 Probe DIJALANKAN, dan arm O46 ternyata MATI di produksi

Probe read-only terhadap live (klaim JWT asli disuntik, `set local role authenticated`, `ROLLBACK`)
menemukan bahwa **kedua arm O46 tidak pernah menyala**:

| # | Skenario | Harapan | Hasil |
|---|---|---|---|
| 1 | audit: Sales **LEAD** baca entri divisinya | > 0 | 🔴 **0** |
| 2 | `private.jwt_same_division('2110040032')` dari Sales lead | true | 🔴 **false** |
| 4 | audit: Creative lead baca entri divisi Sales | 0 | ✅ 0 |
| 5 | audit: Sales **staff** baca entri orang lain | 0 | ✅ 0 |
| 7 | **kontrol** — Director baca semua | 40 | ✅ **40** |
| 8 | **kontrol negatif** — klaim kosong | 0 | ✅ **0** |

Baris 7 & 8 membuktikan harness-nya benar, jadi 1 & 2 adalah cacat nyata, bukan probe yang salah.

**Akarnya:** `employees.divisi` menyimpan **departemen HRIS** (`SALES`), `jwt_division()`
mengembalikan **divisi CDPS** (`Sales`). Helper membandingkannya langsung ⇒ selalu false.
Arahnya aman (lebih sempit, nol kebocoran) tapi fiturnya mati.

**Diperbaiki** oleh `20260730100000_fix_o46_division_resolution.sql` — kedua helper kini memakai
`public.employee_claims()`, fungsi kanonik yang **mengisi klaim JWT**, sehingga kedua sisi
perbandingan berasal dari satu sumber dan tidak bisa menyimpang lagi. **Belum di-apply ke live.**

> ### 🔴 Kenapa test lokal hijau padahal produksi mati — bawa ini terus
> Fixture `rls_checks` 18–23 memakai `divisi='Sales'` (bentuk **CDPS**), bukan `'SALES'` (bentuk
> **HRIS**). Ia meng-encode asumsi penulisnya, cocok secara **kebetulan**, dan keenam check lolos —
> padahal test itu sudah divalidasi 3 mutasi. **Mutasi hanya membuktikan test menjaga perilaku yang
> ia ASUMSIKAN, bukan bahwa asumsinya cocok dengan produksi.**
>
> Fixture sudah diperbaiki ke bentuk HRIS + 3 baris `role_mappings`, dan divalidasi **dua arah**:
> fixture betul + helper lama ⇒ `rls_checks` **MERAH**; + helper baru ⇒ **HIJAU**.
>
> **Aturan: fixture yang meng-encode asumsi penulis tentang bentuk data produksi bukan bukti.**

### 1.3 Yang masih BELUM diverifikasi — dan hanya Anda yang bisa

Policy sudah benar di DB. Yang **belum** diuji: apakah klaim JWT aktor riil benar-benar membawa
`level=lead` + `division` yang tepat sehingga arm-nya menyala. **Policy benar + klaim salah
menghasilkan hasil yang identik dengan policy salah.**

**Minta satu lead divisi login dan buka halaman transaksi/riwayat**, mis. Head of Account
`2305100275` atau Head of Sales `2101180004`, dan pastikan ia melihat data divisinya. Kalau kosong,
periksa `trg_sync_claims_mapping` (preseden verifikasi O33 2026-07-29), bukan policy-nya.

---

## 2. Sisa pekerjaan

| # | Butir | Siapa |
|---|---|---|
| 0 | 🔴 **Apply `20260730100000_fix_o46_division_resolution.sql` ke live** — **prasyarat butir 1**, dan urutannya bukan selera: sampai ini di-apply, arm O46 di produksi **terbukti mati**, jadi probe lead riil dijamin kosong dan tidak membuktikan apa pun. Sesudah apply, **baca versi yang benar-benar tercatat** lalu ganti nama berkasnya (§1.1) | persetujuan **pemilik** → eksekusi Claude |
| 1 | **Probe lead riil** (§1.2) — konfirmasi arm O46 menyala di produksi. **Jalankan sesudah butir 0**, kalau tidak hasilnya tidak bisa ditafsirkan: kosong akan berarti "arm mati" dan "klaim salah" sekaligus | **pemilik** |
| 2 | **C-03 — 3 SKIP** 🔴 *jalur kritis* — `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` dari mesin ber-akses `*.vercel.app`. Sekarang waktunya tepat: live sudah memuat keadaan yang akan rilis | **pemilik** |
| 3 | **A4** — 12 mapping ambigu + lead Ads/Marketing/KOL + O35 + O9 → `O34_O26_O35_WORKSHEET_ROSTER_V2.md` | **pemilik** |
| ~~4~~ | ✅ **O49 (a) SELESAI** — 3 field diperbaiki ke `tz.dateString()`, kerja commit hilang `46e2a6d` dipulihkan, dikunci `wire.datecolumns.test.ts` (+6 test, `apps/api` 301→**307**) + gate anti-tumbuh-kembali, divalidasi 2 mutasi. **Sisa: butir (b) `managed_since`** — butuh 1 keputusan head dev, §3 | **pemilik/head dev** |
| 5 | **O48** — 36 dari 45 policy SELECT tanpa arm lead/divisi (`assets_select`, `employees_select` paling menggigit) | keputusan pemilik, eksekusi Claude |
| 6 | **Backup MySQL Railway + OQ-2** · **rencana rollback** | **pemilik** |
| 7 | **Gate GO** → **C-05** | **pemilik** → Claude |

**O47b** (PII di histori git, 89 branch) tidak memblokir apa pun — rekomendasi: terima risikonya
dengan pemicu eksplisit, karena menghapus branch **tidak** melepas commit yang masih dirujuk PR
lama; tanpa tiket GitHub Support, scrub separuh hanya memindahkan PII.

## 3. Satu keputusan kecil yang menahan O49 butir (b)

`clientDetailToWire.platforms[].managed_since` masih dikirim RFC3339, dan ia **satu-satunya** entri
di ledger `RFC3339_PENDING_DECISION` (`wire.datecolumns.test.ts`). Tidak ditebak karena sumbernya
saling bertentangan:

| Sumber | Bentuk |
|---|---|
| `backend/internal/module0_sales/closing.go:50` | `string`, komentar **`// optional YYYY-MM-DD`** |
| `backend/internal/module4_client/client.go:53` | `*time.Time` ⇒ **RFC3339** |
| `web-internal/src/lib/sales.ts:208` | `managed_since?: string; // "YYYY-MM-DD"` |
| `web-internal/src/lib/clients.ts:12` | `managed_since?: string \| null` — **tanpa anotasi** |
| kolom DB `client_platforms.managed_since` | **`date`** |

Kolom `date` + tiga dari empat sumber menunjuk `YYYY-MM-DD`, jadi rekomendasi saya
**`tz.dateString()`** — sama seperti tiga field yang sudah diperbaiki. Tapi ia dikirim ke **dua**
halaman berbeda (`clients` dan `sales`), jadi kalau salah satu halaman ternyata mem-parsing-nya
sebagai timestamp, mengubahnya memecahkan halaman itu. Satu kalimat dari head dev cukup; sesudah itu
eksekusinya satu baris + hapus entri ledger (test "ledger jujur" akan **memaksa** penghapusan itu —
ia merah kalau ledger menyebut field yang sudah diperbaiki).

### 3.1 Yang JANGAN dikerjakan

Seluruh daftar SESI19 §3.1 dan SESI20 §3.1 masih berlaku. Tambahan dari sesi ini:

- **Jangan apply ulang `rls_o46_lead_division_arms`** — sudah di live sebagai `20260730091540`.
- **Jangan ganti nama migrasi yang sudah di live** ke versi lain; nama repo mengikuti ledger live,
  bukan sebaliknya.
- **Jangan melonggarkan `audit_log_select` untuk staff** tanpa entri `DECISIONS.md` — `rls_checks`
  check 23 sengaja merah kalau itu terjadi. "Staff = own entries only" adalah **perilaku PRD**.
