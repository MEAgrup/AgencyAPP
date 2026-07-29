# HANDOFF — Cutover Sesi 8

> Titik masuk **standalone**. Dokumen sesi 7 (`HANDOFF_CUTOVER_SESI7.md`) masih berguna sebagai
> latar temuan, tapi posisi branch/PR-nya sudah bergerak — **mulai dari dokumen ini.**

## 0. Posisi persis

| | |
|---|---|
| **Branch kerja** | **`claude/handoff-cutover-sesi-6-x4i8tw`** |
| **Commit SUBSTANTIF terakhir** | **`08bb9c3`** — commit docs boleh menyusul di atasnya (termasuk yang menulis baris ini), jadi ambil hash head yang sebenarnya dari `git log`, bukan dari dokumen ini |
| **PR** | **#66** — https://github.com/MEAgrup/AgencyAPP/pull/66 · masih **draft**, nol review comment |
| **Base** | `main` @ **`446f6502`** (hasil merge PR #65) |
| **PR lain yang terbuka** | **tidak ada** — #66 satu-satunya |
| **PR yang sudah selesai** | #65 **ter-merge**; #63 **ditutup** (premisnya kedaluwarsa — lihat komentar di PR-nya) |
| **Live** | Supabase `CDPS SG` (`egddxfcnrtecheiykhlf`, `ap-southeast-1`) — **39 migrasi ter-apply** (`…0011` masuk 2026-07-29, §2.1), `master_services` 32 baris, `role_mappings` **39** baris (O42 dieksekusi, §2.2), `employees`/`employee_credentials`/`auth.users`/`auth.identities` **69** semuanya. ⚠️ **live di depan `main`** sampai #66 merge |

### 0.1 Tidak ada pekerjaan tertinggal (diverifikasi saat menulis dokumen ini)

```
belum ter-commit : 0
belum ter-push   : 0
stash            : 0
PR terbuka       : hanya #66
```

**Empat commit di branch** (terbaru dulu), semuanya sudah ter-push:

| Commit | Isi |
|---|---|
| `08bb9c3` | **feat(auth): O44(c) A+B1** — ganti password sendiri + reset via admin (GoTrue) · migrasi `…0011` · handoff ini |
| `24f932c` | **feat(admin): O44(a)(b)** — paritas rekursif + port 6 route admin (buka jalan O42) |
| `93614fd` | docs — jawaban O42 (B), O43(a) diputus, temuan O44 |
| `0c77530` | docs — jawaban O42(4), koreksi framing O43(a) |

```bash
git fetch origin main
git checkout claude/handoff-cutover-sesi-6-x4i8tw
git pull origin claude/handoff-cutover-sesi-6-x4i8tw
npm ci                                # ⚠️ WAJIB dari ROOT repo — lihat §3.6
cd web-internal && npm ci && cd ..    # web-internal punya lockfile sendiri
```

### 0.2 Status CI di `08bb9c3`

**10/11 hijau** saat dokumen ini ditulis: `api` ×2 · `core-engines` ×2 · `web-internal` ×2 ·
**`db-and-migrations` ×2** · `backend` ×1 (5m28s) · Vercel. Satu kembaran `backend` masih
`in_progress` — pola §0/§3 (dua run per commit), dan **diff ini nol berkas Go**, jadi bukan dari
perubahan di sini.

Yang penting: **kedua** job `db-and-migrations` lulus ⇒ migrasi baru `…0011` terbukti **apply dari
nol** di CI, bersama 470 test domain, keempat invariant SQL, dan gate seed.

> **Status CI hidup selalu dari PR-nya**, bukan dari angka di dokumen ini — angka apa pun di sini
> kedaluwarsa begitu commit berikutnya mendarat.

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
- Migrasi baru **`20260102000011_admin_set_password.sql`** — ✅ **sudah ter-apply ke live** 2026-07-29
  sebagai `20260729104209_admin_set_password` (lihat §2.1), jadi B1 hidup di produksi.

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

### 2.1 ✅ Apply migrasi `20260102000011` ke `CDPS SG` — **SELESAI 2026-07-29**
Tanpa ini **B1 mati di produksi** (`admin_set_employee_password` tidak ada ⇒ reset password admin
gagal). Migrasi ini idempoten (`CREATE OR REPLACE FUNCTION`) dan tidak mengubah skema tabel.

**Sudah di-apply** lewat MCP `apply_migration` (bukan `psql -f` — supaya tercatat di
`supabase_migrations.schema_migrations`, pola sama dengan 0009/0010). Live kini **39 migrasi**,
tercatat sebagai **`20260729104209_admin_set_password`**. Payload yang dikirim di-diff byte-per-byte
lawan berkas repo lebih dulu (`md5 07aee4942da2cce94011727899403631`, identik) — bukan SQL ad-hoc.

Verifikasi sesudah apply:

| Cek | Hasil |
|---|---|
| Fungsi ada, `SECURITY DEFINER`, `search_path=public, pg_temp` | ✅ |
| ACL = `{postgres=X/postgres,service_role=X/postgres}` | ✅ **identik** dengan `clear_must_change_password` & `set_employee_banned`; `anon`/`authenticated` **tidak** bisa EXECUTE |
| Probe fungsional **non-mutasi** (`employee_id` tak ada ⇒ `false`) | ✅ dibungkus `BEGIN`/`ROLLBACK`; **nol** password nyata disentuh |
| Data live tidak bergeser | ✅ `master_services` 32 · `role_mappings` 38 · 53 tabel · `employees` 68 · `employee_credentials` 68 · cermin `must_change_password` **58 = 58** · `auth.refresh_tokens` 2 (sesi hidup utuh) |
| Advisor keamanan | ✅ **nol** temuan baru; khususnya **tidak** ada `function_search_path_mutable` (karena `SET search_path`). 10 lint sisanya pra-ada (9 INFO `rls_enabled_no_policy` deny-by-default + WARN leaked-password) |

**Penempatan skema (bukan penyimpangan):** fungsi ini ada di `public`, sementara 0008 memindahkan
helper SECDEF ke `private`. Yang dipindahkan 0008 hanyalah helper **predikat RLS** (`jwt_owns_*`,
`employee_display_name` — 5 fungsi). RPC tulis service-role tetap di `public` dengan ACL terkunci
(13 fungsi, termasuk `set_employee_banned`). Jadi `…0011` **mengikuti** pola yang sudah ada.

> ⚠️ **Konsekuensi yang harus ditutup: live sekarang DI DEPAN `main`.** `…0011` hidup di branch
> PR **#66** (masih draft) dan **belum ada di `main`** — `main` punya 37 berkas migrasi, live 39 baris
> (37 + `…0011` + 1 baris yatim pra-ada `20260723064826_rls_harden_execute_surface` yang memang tidak
> punya berkas repo, utang §7.1). Ini **persis pola drift yang menciptakan blocker O38**, dan runbook
> 0009/0010 §0 mensyaratkan PR merge **dulu**; di sini urutannya terbalik karena apply diminta
> eksplisit sementara #66 belum merge. **Peredam:** migrasi idempoten, nol perubahan skema tabel, dan
> CI sudah membuktikan ia apply dari nol (kedua job `db-and-migrations` hijau di `08bb9c3`).
> **Penutup drift: merge #66.** Sampai itu terjadi, jangan anggap `main` menggambarkan live.

### 2.2 ✅ Eksekusi O42 ke live — **SELESAI 2026-07-29**
Runbook `docs/handoff/RUNBOOK_O42_MARKETING_ACTOR.md` §2–§4 dijalankan ke `CDPS SG`; hasil persisnya
di **runbook §7**. Urutan wajib **impor DULU → mapping KEMUDIAN** dipatuhi.

| | |
|---|---|
| Impor | `2504240539` NIKEN SEPTA ARISANDHY · `BUSINESS DEVELOPMENT`/`MARKETING STRATEGIST` · lewat `employees.importEmployees` (bukan INSERT manual) ⇒ `employees` + `employee_credentials` + link GoTrue dalam satu transaksi · audit `audit_log id=42` |
| Mapping | `role_mappings id=40` → `Marketing`/`staff`, **persis** tabel runbook §3 |
| Verifikasi | `employee_claims` = `{division: Marketing, level: staff}` ✅ · `marketing_staff_aktif` **0 → 1** ⇒ arm `0009` **bisa** diuji · 69/69/69/69 employees·credentials·auth.users·auth.identities · `flagged` **0** · `refresh_tokens` tetap **2** |

**Klaim audit `3818d4a` bertahan:** `aktif_tanpa_mapping` tetap **7**, **7/7** pemegang layered role
(3 Director + 4 OD). Tidak ada koreksi audit yang perlu ditulis.

> **Marketing `lead` tetap kosong** selama belum ada jabatan kepala BD/Marketing yang aktif ⇒
> reassign owner Campaign di produksi **tetap hanya Director**, dan arm Marketing-lead
> `leads.leadListScope` tetap mati. Konsekuensi struktur organisasi, bukan bug — sudah ditandai
> **keputusan sadar** di `DECISIONS` 2026-07-29.

**Pertanyaan `orang eksekutor ads` TIDAK lagi memblokir.** Grain mapping divisi×**jabatan**
(`uq_role_mapping`), jadi baris `MARKETING STRATEGIST` di atas **tidak** mengangkat jabatan lain di
bawah `BUSINESS DEVELOPMENT` — eksekutor ads berjabatan lain tetap bisa dipetakan ke **`Ads`** tanpa
menyentuh baris ini. Peringatan versi sebelumnya menyasar **orang itu**, bukan NIKEN (yang jabatannya
memang Marketing).

**Sisa yang belum teruji:** arm `0009` baru *bisa* diuji, belum *teruji* — butuh satu campaign nyata,
lalu QA di UI sebagai Director (reassign owner Campaign harus memunculkan kandidat Marketing/staff,
bukan `NotFoundError`).

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

### 2.8 Kalau PR #66 sudah di-merge sebelum sesi berikutnya

Perlakukan pekerjaan lanjutan sebagai perubahan **baru**: PR yang sudah merge tidak bisa dipakai lagi.
Mulai ulang branch dari `main` terbaru dengan **nama branch yang sama**, lalu buka PR baru:

```bash
git fetch origin main
git checkout -B claude/handoff-cutover-sesi-6-x4i8tw origin/main
```

Kalau branch masih memuat commit yang **belum** ter-merge, jangan dibuang — rebase ke base baru.

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
| **O42 data** | baris HRIS (divisi+jabatan persis) untuk orang eksekutor ads → `Ads` atau `Marketing` | **Tidak lagi** — O42 sudah dieksekusi (§2.2); grain divisi×jabatan bikin keputusan ini berdiri sendiri |
| **Marketing `lead`** | tidak ada jabatan kepala BD/Marketing aktif ⇒ `lead` kosong; konfirmasi dibiarkan kosong atau tunjuk jabatan | Tidak — Director tetap bisa reassign owner Campaign |
| ~~**Apply `…0011`**~~ | ~~ke `CDPS SG`~~ | ✅ **SELESAI** 2026-07-29 (§2.1) — B1 hidup di produksi. Sisa: **merge #66** untuk menutup drift live-di-depan-`main` |
| **O34 · O26 · O35 · O9** | aktor Wave 2 · NIK/email Director · sub-tim Creative · target M14 | → `HANDOFF_CUTOVER_SESI5.md` §3.1 |

**O24 · O33 · O37 · O38 · O40 · O43(a) sudah RESOLVED — jangan dibuka lagi.**
