# HANDOFF — Cutover Sesi 8

> Titik masuk **standalone**. Dokumen sesi 7 (`HANDOFF_CUTOVER_SESI7.md`) masih berguna sebagai
> latar temuan, tapi posisi branch/PR-nya sudah bergerak — **mulai dari dokumen ini.**

## 0. Posisi persis

> ✅ **PR #66 sudah DI-MERGE** (2026-07-29, `main` @ `df85181`). Seluruh kerja sesi 7→8 sudah ada di
> `main` — **tidak ada apa pun yang menunggu di branch.**

| | |
|---|---|
| **Mulai dari** | **`main` @ `df85181`** — bukan dari branch mana pun |
| **PR #66** | **ter-merge**, bukan draft lagi. **Jangan** menumpuk commit baru di atas riwayat yang sudah ter-merge |
| **PR terbuka** | **tidak ada** |
| **PR yang sudah selesai** | #66 **ter-merge** · #65 **ter-merge** · #63 **ditutup** (premisnya kedaluwarsa) |
| **Live** | Supabase `CDPS SG` (`egddxfcnrtecheiykhlf`, `ap-southeast-1`) — **38 migrasi ter-apply**, `master_services` 32 baris, `role_mappings` 38 baris. ⚠️ Migrasi ke-**39** (`…0011`) **belum** ter-apply — lihat §2.1 |

### 0.1 Cara memulai sesi berikutnya

Branch lama (`claude/handoff-cutover-sesi-6-x4i8tw`) isinya sudah ter-merge seluruhnya, jadi
**restart dari `main`** dengan nama branch yang sama:

```bash
git fetch origin main
git checkout -B claude/handoff-cutover-sesi-6-x4i8tw origin/main
npm ci                                # ⚠️ WAJIB dari ROOT repo — lihat §3.6
cd web-internal && npm ci && cd ..    # web-internal punya lockfile sendiri
```

PR baru yang dibuka dari branch itu adalah **PR baru** — bukan #66 yang sudah selesai.

### 0.2 Apa yang sudah masuk `main` lewat #66

| Commit | Isi |
|---|---|
| `08bb9c3` | **feat(auth): O44(c) A+B1** — ganti password sendiri + reset via admin (GoTrue) · migrasi `…0011` |
| `24f932c` | **feat(admin): O44(a)(b)** — paritas rekursif + port 6 route admin (buka jalan O42) |
| `93614fd` · `0c77530` · `da974a8` | docs — jawaban O42 (B), O43(a) diputus, temuan O44, dokumen ini |

### 0.3 Status CI saat di-merge

**11/11 hijau** di head `da974a8`: `api` ×2 · `core-engines` ×2 · `web-internal` ×2 ·
`db-and-migrations` ×2 · `backend` ×2 (5m22s & 5m29s) · Vercel. Nol review comment.

Yang penting: **kedua** job `db-and-migrations` lulus ⇒ migrasi `…0011` terbukti **apply dari nol**
di CI, bersama 470 test domain, keempat invariant SQL, dan gate seed.

⚠️ **Sandbox tidak bisa menjangkau live.** Nol kredensial di env, dan gateway menolak CONNECT ke
`supabase.co` (**403**). Setiap langkah yang menyentuh `CDPS SG` harus dijalankan pemilik atau dari
mesin ber-akses.

⚠️ **`ci.yml` terpicu DUA KALI per commit** (`push` + `pull_request`) ⇒ 11 check = 2×5 job + Vercel.
Kalau satu job tersangkut sementara kembarannya hijau, itu flakiness runner — **cek pasangannya dulu**
sebelum mendorong "perbaikan". Job `backend` normalnya **~6 menit**; jangan salah baca durasi (saya
pernah salah mengira 2 menit sebagai 60 menit di sesi ini).

## 1. Yang selesai di sesi 7→8

### 1.1 O44(a) — paritas FE↔API tidak lagi buta
`feCalls()` (`apps/api/src/lib/route-parity.test.ts`) dulu `readdirSync` **datar** atas
`web-internal/src/lib` ⇒ buta terhadap `src/app/**`. Kini **rekursif** atas seluruh
`web-internal/src`, `.ts` **dan** `.tsx`. Begitu diaktifkan ia langsung memunculkan **6 route** yang
luput. Pelajarannya: `KNOWN_GAPS` **bukan** buku besar lengkap sampai alat ukurnya benar.

### 1.2 O44(b) — 6 route admin diport, dua halaman admin hidup
`GET /admin/employees` · `GET|POST /admin/role-mappings` · `DELETE /admin/role-mappings/{id}` ·
`GET|POST /admin/layered-roles`. Modul domain baru `packages/domain/src/admin.ts`.
**Ini penyebab akar O42** — bukan keputusan yang belum diambil, tapi port yang belum dikerjakan.

`POST /admin/employee-sync` **sengaja tidak diport** (OQ-4: pull HRIS ditinggalkan); yang diperbaiki
FE-nya, kini mengunggah CSV ke `POST /admin/employee-import`.

### 1.3 O44(c) — auth: A + B1 SELESAI, B2 menunggu SMTP
- **A. `/akun/password`** — ganti password sendiri, **ungated** di nav (karyawan yang sedang dipaksa
  ganti harus bisa mencapainya). Alur: re-grant password lama → `PUT /auth/v1/user` →
  `clear_must_change_password()` → re-grant password baru untuk cookie.
- **B1.** `POST /auth/admin/set-password` + `GET /auth/admin/credentials`, UI di halaman Karyawan,
  dan `Lupa password?` di halaman login yang **menjelaskan prosedur** (bukan menautkan halaman mati).
- Migrasi baru **`20260102000011_admin_set_password.sql`** — belum ter-apply ke live (lihat §2.1).

**Detail arsitektural yang penting dipahami sebelum menyentuh auth:** otoritas password adalah
**GoTrue**, bukan `employee_credentials`. Port verbatim dari Go = bug senyap. `apps/api` **tidak
punya** `SUPABASE_SERVICE_ROLE_KEY`, jadi jalur tulis admin memakai RPC SECURITY DEFINER.
Lockout Go **sengaja tidak diport** (GoTrue yang memiliki login ⇒ GoTrue yang membatasi rate).

### 1.4 O43(a) diputus
Proyeksi sempit `clientListRowToWire` **dipertahankan**, nol perubahan kode. Dasarnya: **M4 §6 hanya
mengatur BARIS, tidak menyebut kolom roster** ⇒ `clientView` Go bukan spec; dan paritas penuh justru
akan **menghapus** `sales_pic_nama` yang dirender roster.

### 1.5 Verifikasi (2026-07-29, Postgres NYATA, DB dimigrasi ulang dari nol)
`@cdps/domain` **470** · `apps/api` **194** · `web-internal` **26** · `core` **112** · `db` **9** ·
keempat invariant SQL **PASS** · typecheck seluruh workspace bersih · 38 migrasi → **53 tabel** ·
gate seed utuh (10 employees / 12 role_mappings / 14 machines / 15 events).

## 2. Yang HARUS dikerjakan berikutnya

### 2.1 🔴 Apply migrasi `20260102000011` ke `CDPS SG`
Tanpa ini **B1 mati di produksi** (`admin_set_employee_password` tidak ada ⇒ reset password admin
gagal). Live saat ini 38 migrasi; setelah ini **39**. Migrasi ini idempoten
(`CREATE OR REPLACE FUNCTION`) dan tidak mengubah skema tabel.

### 2.2 🔴 Eksekusi O42 ke live — `docs/handoff/RUNBOOK_O42_MARKETING_ACTOR.md`
Urutan **wajib**: **impor karyawan DULU → mapping KEMUDIAN** (dibalik = baris yatim, M3-OA-6 tetap
mati karena `validateOwnerCandidate` butuh kandidat aktif).

Rantainya sudah dibuktikan ujung-ke-ujung di Postgres lokal dengan data NIKEN riil (**11/11 PASS**),
jadi tidak ada kejutan yang diharapkan. **Masih ditunggu dari pemilik:** baris HRIS (`divisi` +
`jabatan` **persis**) untuk **orang eksekutor ads**. Kalau divisinya `BUSINESS DEVELOPMENT`, ia
mestinya dipetakan ke **`Ads`**, **BUKAN** `Marketing` — kalau salah, ia jadi kandidat owner Campaign
(M3-OA-6) yang bukan wewenangnya.

> **Marketing `lead` tetap kosong** selama belum ada jabatan kepala BD/Marketing yang aktif ⇒
> reassign owner Campaign di produksi **tetap hanya Director**, dan arm Marketing-lead
> `leads.leadListScope` tetap mati. Itu konsekuensi struktur organisasi, bukan bug — sebaiknya
> ditandai keputusan sadar.

### 2.3 O44(c) B2 — lupa password self-service
Menunggu **provider email** (Resend/SES/dll) + domain pengirim. SMTP bawaan Supabase dibatasi rate
dan resmi bukan untuk produksi. Catatan desain: link reset standar Supabase menyerahkan token ke
**browser**, bertabrakan dengan BFF ⇒ perlu halaman `/reset-password` yang meneruskan token ke API
kita, bukan memanggil Supabase dari klien.

### 2.4 O42(3) — sumber kebenaran `role_mappings`
Rekomendasi yang sudah diajukan, **menunggu persetujuan**: live/**38** = sumber kebenaran (konsisten
preseden **O38** *"repo mengikuti live"*); `backend/seed/role_mappings_riil.csv` (**23**) = referensi
historis, diarsipkan bersama Go di C-05; `supabase/seed.sql` (**12**) tetap fixture dev/CI **+ diberi
pengaman**. Risiko konkretnya: blok `role_mappings` di `seed.sql` diakhiri
`ON CONFLICT (divisi,jabatan) DO UPDATE SET division, level` ⇒ menjalankannya ke live akan **menulis**
ke akar perizinan.

### 2.5 Sisa O41 — 6 endpoint, urut hulu-ke-hilir
`apps/api/src/lib/route-parity.test.ts` (`KNOWN_GAPS`) adalah buku besarnya:

| # | Endpoint | Catatan |
|---|---|---|
| 1 | `GET /finance/queue` | Go `Service.Queue`; aktor Finance riil SUDAH ada (O33) |
| 2 | `GET /transactions/{id}` | **`trxVisibility` JANGAN diport** — visibilitas baris = RLS (O37); penolakan muncul sebagai **404** |
| 3 | `POST /transactions/{id}/schedule` | lock baris, guard idempotensi, Σ termin = total, mint `INST-` |
| 4 | `GET /transactions/{id}/bermasalah` | berkas route-nya ADA, hanya meng-ekspor `POST` |
| 5 | `POST /leads/bulk` | bersinggungan O22 **dan** O42 (aktor Marketing) |
| 6 | `GET /audit` | panel riwayat aset Creative |

> 🔴 **Periksa BENTUK respons, bukan cuma keberadaan route** (O43). Halaman
> `finance/transactions/[id]` membaca `res.transaction.installments`.

### 2.6 O43(b)(c) — hentikan kelas bug bentuk respons
**(c)** buat test paritas-**bentuk** otomatis (diff kunci wire mapper vs `interface` di
`web-internal/src/lib/*.ts`, seperti route-parity mendiff path); **(b)** lalu audit **60+ route GET**
dengan alat itu. Angka sebenarnya tidak diketahui — asumsikan >0.

### 2.7 Sisa cutover
3 SKIP **C-03** dari mesin ber-internet · **O22** impor lead historis · aktor **O34/O26/O35** ·
konfirmasi data Railway riil atau UAT · backup MySQL + rencana rollback → gate go/no-go → **C-05**
(buang job CI Go, arsipkan `backend/` **dengan tag** — Go adalah oracle paritas satu-satunya,
matikan Railway).

### 2.8 Aturan branch (berlaku terus)

Sekali sebuah PR ter-merge, PR itu **selesai** — jangan menumpuk commit baru di atas riwayat yang
sudah ter-merge, dan jangan membuka ulang PR-nya. Restart branch dari `main` (§0.1), lalu buka PR
**baru**. Kalau branch masih memuat commit yang **belum** ter-merge, rebase ke base baru — jangan
dibuang.

## 3. Aturan rumah yang paling sering menggigit

1. **Setiap objek domain lewat wire mapper.** camelCase/bigint mentah ⇒ 500 atau halaman kosong
   (penyebab C03-F2 **dan** O43).
2. **Baca lewat `readAsActor`** — KECUALI tabel default-deny (`role_mappings`,
   `employee_layered_roles`, `employee_credentials`): di sana `readAsActor` mengembalikan **nol
   baris**, jadi gate ditegakkan di app layer dengan client privileged. Lihat docstring
   `packages/domain/src/admin.ts`.
3. **`audit_log` append-only** — `forbid_mutation` memblokir DELETE, jadi `afterEach` **tidak bisa**
   membersihkannya. Assertion audit harus pakai **watermark `max(id)`** sebelum aksi, bukan menghitung
   per `entity_id` (kalau tidak: lulus di DB bersih, gagal di run kedua — terjadi dua kali di sesi ini).
4. **Nol string BI baru tanpa entri DECISIONS.** Tiga string baru di sesi ini sudah dicatat di `O44c`.
5. **Deteksi method route** harus mencakup `export const POST = handler`, bukan hanya
   `export async function POST` — pola pertama dipakai di beberapa route dan sempat menghasilkan
   2 false positive saat audit.
6. **`npm ci` HARUS dari ROOT repo.** Dari dalam `packages/*`/`apps/*` menghasilkan pohon ter-prune
   lalu typecheck gagal `Cannot find module 'next'` — artefak instalasi, bukan regresi kode.

## 4. Cara menjalankan test DB-backed di sandbox

```bash
pg_ctlcluster 16 main start          # "Removed stale pid file" itu normal
su postgres -c "psql -c 'DROP DATABASE IF EXISTS cdps;' -c 'CREATE DATABASE cdps;'"
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
for f in $(ls supabase/migrations/*.sql | sort); do
  su postgres -c "psql -d cdps -v ON_ERROR_STOP=1 -q -f '$f'" || echo "GAGAL $f"
done
su postgres -c "psql -d cdps -q -f supabase/seed.sql"
# harus 53 tabel:
su postgres -c "psql -d cdps -tAc \"select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'\""

DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
cd web-internal && npm test          # 26 test, terpisah dari workspaces
```

Invariant SQL: `psql` butuh berkas yang bisa dibaca user `postgres` ⇒ **copy ke `/tmp` + `chmod 644`**
dulu, kalau tidak dapat `Permission denied` dari scratchpad.

```bash
mkdir -p /tmp/inv && cp supabase/tests/*.sql /tmp/inv/ && chmod 644 /tmp/inv/*.sql
for f in ident_checks immutability_checks rls_checks auth_claims_checks; do
  su postgres -c "psql -d cdps -v ON_ERROR_STOP=1 -q -f /tmp/inv/$f.sql" && echo "PASS $f"
done
```

## 5. Menunggu keputusan pemilik (ringkas)

| # | Isi | Memblokir? |
|---|---|---|
| **O44(c) B2** | provider email/SMTP untuk lupa-password self-service | Tidak — B1 sudah jadi jalur pemulihan |
| **O42(3)** | sumber kebenaran `role_mappings` 38 vs 23 vs 12 | Tidak, tapi ada risiko `seed.sql` menulis ke live |
| **O42 data** | baris HRIS (divisi+jabatan persis) untuk orang eksekutor ads | **Ya** — menentukan baris mapping |
| **Apply `…0011`** | ke `CDPS SG` | **Ya** — B1 mati di produksi tanpanya |
| **O34 · O26 · O35 · O9** | aktor Wave 2 · NIK/email Director · sub-tim Creative · target M14 | → `HANDOFF_CUTOVER_SESI5.md` §3.1 |

**O24 · O33 · O37 · O38 · O40 · O43(a) sudah RESOLVED — jangan dibuka lagi.**
