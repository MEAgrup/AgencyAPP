# Runbook — Deploy Staging + Seed Pilot (untuk Gate UAT Manusia Wave 1)

> Menyiapkan lingkungan staging agar pilot **Sales + Finance** bisa menjalankan
> `WAVE1_EXIT_UAT_RUNBOOK.md` di UI nyata. Operator (Dev/Anda) yang mengeksekusi;
> agent tak punya kredensial cloud.
>
> **ATURAN SECRET:** jangan pernah tempel secret di chat/PR/commit. Semua secret
> di-set di dashboard **Supabase** & **Railway** (atau secret store). File repo hanya
> memakai placeholder / variabel run-time. Password pilot dikirim ke `pilot_seed.sql`
> lewat `-v pilot_pw=...` saat run, bukan di-commit.

## 0. Arsitektur staging (yang di-deploy)

| Komponen | Apa | Host | Butuh |
|---|---|---|---|
| **DB + Auth** | Postgres 16 + GoTrue (login password) + claims hook | **Supabase project** (staging) | 53 migrasi + seed + pilot seed |
| **apps/api** | Next API (`/api/v1/*`), transpile `@cdps/*` | **Railway** service | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_JWT_SECRET` |
| **web-internal** | Next UI (boards/sales/finance/leads/account) — **proxy `/api/v1/*` → `BACKEND_URL`** | **Railway** service (`railway.json` sudah ada) | `BACKEND_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

`web-client-portal` = Wave 3, TIDAK di-deploy sekarang. `backend/` (Go) = legacy, abaikan.

---

## ✅ Update 2026-07-24 — dua blocker sudah BERES

- **Auth login end-to-end (opsi A) DIIMPLEMENTASI & diuji.** `/api/v1/auth/login` + `/me` + `/auth/logout` + cookie `cdps_session` di apps/api. Smoke-test HTTP nyata lolos: login Finance→cookie→`/me`→`GET /reminders` 200→password salah `[email atau password salah]`→logout; Director resolve `director:true`. (§ historis di bawah dipertahankan sebagai konteks.)
- **`next build` apps/api BERES (webpack).** Impor relatif dibuat extensionless + build pakai `next build --webpack`. `npm run build && npm run start` melayani `/api/v1/*`. CI kini punya gate `next build`.

⇒ Jalur UI-UAT **tidak lagi terblok** oleh auth/build. Sisa = deploy staging (butuh secret Anda) + konfirmasi proxy web-internal meneruskan cookie (§4).

## ⚠️ Konteks historis — blocker yang sudah diselesaikan

1. ~~**🔴 BLOCKER auth kontrak frontend↔API (login belum nyambung end-to-end).**~~ **RESOLVED (opsi A).**
   Verifikasi kode saat ini:
   - `web-internal` (login page + `lib/auth-context` + `lib/api`, `API_BASE=/api/v1`)
     login dengan `POST /api/v1/auth/login {email,password}`, cek sesi `GET /api/v1/me`,
     keluar `POST /api/v1/auth/logout` — pola **sesi lokal** (bukan klien GoTrue).
   - `apps/api` **TIDAK punya** route `/auth/login`, `/auth/logout`, atau `/me` (cek
     route tree). Yang ada: verifikasi **bearer JWT GoTrue** (`lib/auth.ts verifyJwtHS256`
     / `requireActor`) pada endpoint domain — tak ada endpoint yang MENERBITKAN token,
     dan frontend tak pernah memanggil GoTrue untuk mendapat token.

   ⇒ Kedua sisi tak bertemu: **login UI tak akan berfungsi** walau staging & pilot seed
   siap. Perlu keputusan + implementasi (pilih SATU):
   - **(A)** Tambah di `apps/api`: `POST /api/v1/auth/login` (validasi `employee_credentials`
     bcrypt → mint sesi/JWT), `/auth/logout`, `GET /api/v1/me` → cocok dengan frontend
     yang ada. (Auth lokal CDPS, sejalan `20260722060454_local_auth.sql`.), **atau**
   - **(B)** Rewire `web-internal` ke Supabase GoTrue client (login → `access_token`),
     kirim `Authorization: Bearer` ke apps/api yang sudah memverifikasinya.

   Sampai (A)/(B) selesai, **UI-UAT terblok**; money-path tetap bisa diuji di lapisan API
   dengan token GoTrue (§6 opsi B, jalur B) atau via dry-run otomatis
   (`WAVE1_EXIT_UAT_REPORT_AUTOMATED_20260723.md`). Ini kerja integrasi (frontend/api),
   bukan sekadar deploy — angkat ke pemilik/head dev sebelum menjadwalkan pilot.
2. **CI Actions runner** (isu terpisah): runner GitHub Actions org belum ter-provision
   (semua job "failure" ~1 dtk, runner_id 0). Tak memblok deploy manual, tapi perbaiki di
   Settings→Actions / billing agar CI hijau untuk kerja Wave 2.

---

## 1. Secret checklist (isi di dashboard, jangan di repo)

Dari Supabase project (Settings → Database / API / Auth):

| Env var | Dipakai oleh | Sumber |
|---|---|---|
| `DATABASE_URL` | apps/api (runtime) + apply migrasi | Connection pooling string (port 6543), `?pgbouncer=true` |
| `DIRECT_URL` | apply migrasi/seed (DDL) | Direct connection (port 5432) |
| `SUPABASE_JWT_SECRET` | apps/api (verifikasi JWT) | Settings → API → JWT Secret |
| `NEXT_PUBLIC_SUPABASE_URL` | web-internal (login) | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web-internal (login) | Settings → API → anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | (opsional) provisioning | Settings → API → service_role key |
| `BACKEND_URL` | web-internal (proxy target) | URL publik service apps/api di Railway |
| `PILOT_PW` | run `pilot_seed.sql` | password staging throwaway (JANGAN di-commit) |

`apps/api/.env.example` = daftar acuan. `NODE_ENV=production` di kedua service Railway.

---

## 2. Supabase project (DB + Auth)

1. **Buat project staging** baru (region terdekat). Catat ref, JWT secret, anon & service_role key, connection strings.
2. **Apply skema + data** (dari mesin operator, memakai `DIRECT_URL`):
   ```bash
   export DIRECT_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
   for f in $(ls supabase/migrations/*.sql | sort); do
     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done          # → 53 tabel, 14 mesin, 15 event
   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql      # fixture Alpha Digital (10 employee, 12 role map, 3 MSL)
   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -v pilot_pw="$PILOT_PW" \
        -f supabase/uat/pilot_seed.sql                                # 8 akun pilot + kredensial + provisioning GoTrue
   ```
   `pilot_seed.sql` idempoten & fail-fast tanpa `pilot_pw`. Di Supabase ia menjalankan
   `import_employee_credentials()` → membuat `auth.users` + `auth.identities` + link
   `employees.auth_user_id`. **Verifikasi tabel `auth.users`/`auth.identities` cocok versi
   GoTrue project sebelum run atas data riil** (DECISIONS O36; fungsi memakai SQL dinamis).
3. **Aktifkan Access Token Hook** (WAJIB — tanpa ini JWT tak berisi klaim CDPS, semua
   endpoint 401/permission kosong): Dashboard **Authentication → Hooks → Customize Access Token**
   → pilih `public.custom_access_token_hook`. (Setara `auth.hook.custom_access_token` di
   `config.toml` bila pakai CLI.) `pgcrypto` sudah pre-enabled di Supabase.
4. **Sanity klaim:** `select public.employee_claims('EMP-0007');` → `{division:Finance, level:staff, ...}`.

---

## 3. Deploy apps/api (Railway)

1. **New service** dari repo `MEAgrup/AgencyAPP`, branch staging (mis. `main`).
2. **Root/build context = ROOT repo** (bukan `apps/api`) — Next mem-`transpilePackages`
   `@cdps/*` dari `../../packages/*/src`, jadi sibling packages harus ada saat build.
   Resep build acuan = job `api` di `.github/workflows/ci.yml` (install `packages/db` +
   `packages/domain`, lalu `apps/api`). Untuk Railpack, set:
   - Install: `(cd packages/db && npm ci) && (cd packages/domain && npm ci) && (cd apps/api && npm ci)`
   - Build: `cd apps/api && npm run build`  ← memakai **webpack** (`next build --webpack`, sudah di package.json). **Turbopack TIDAK dipakai** (tak resolve paket TS-source `file:` @cdps/*).
   - Start: `cd apps/api && npm run start` (Next default port `$PORT`)
3. **Env:** `DATABASE_URL` (pooler 6543), `DIRECT_URL`, `SUPABASE_JWT_SECRET`, `NODE_ENV=production`.
4. **Verifikasi:** service up; simpan URL publiknya untuk `BACKEND_URL`.

---

## 4. Deploy web-internal (Railway)

1. **New service** dari repo yang sama; root = `web-internal` (`railway.json` sudah: RAILPACK, `npm run start`).
2. **Env:** `BACKEND_URL` = URL apps/api (§3.4); `NEXT_PUBLIC_SUPABASE_URL`;
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `NODE_ENV=production`.
3. Build `npm ci && npm run build`, start `npm run start`.
4. **Verifikasi:** buka URL, muncul layar login. (Jika tak ada login/token tak diteruskan → lihat pra-cek §⚠️.1.)

---

## 5. Roster pilot (hasil `pilot_seed.sql`) — password = `$PILOT_PW`

| Peran UAT | Employee | Email login | Klaim CDPS |
|---|---|---|---|
| Sales Staff | EMP-0001 Budi | budi@mea.co.id | Sales / staff |
| Sales Head (SPV) | EMP-0006 Dewi | dewi@mea.co.id | Sales / lead |
| Account Staff | EMP-0002 Sinta | sinta@mea.co.id | Account / staff |
| Account Lead | EMP-0012 (pilot) | accountlead@mea.co.id | Account / lead |
| Finance Staff | EMP-0007 Fajar | fajar@mea.co.id | Finance / staff |
| Finance Head (SPV) | EMP-0011 (pilot) | financehead@mea.co.id | Finance / lead |
| OD | EMP-0013 (pilot) | od@mea.co.id | od (read-only everywhere) |
| Director | EMP-0008 Yohan | yohan@mea.co.id | director (full) |

---

## 6. Smoke test sebelum serahkan ke pilot

**Opsi A — UI (target sebenarnya):** login tiap 8 akun di web-internal; pastikan token
terbentuk & sebuah halaman terproteksi (mis. `/finance`) memuat data; OD terbukti read-only.

**Opsi B — API langsung (bila UI auth belum wired):** ambil access token via GoTrue lalu panggil apps/api:
```bash
# login → access_token
curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H 'content-type: application/json' \
  -d '{"email":"fajar@mea.co.id","password":"'"$PILOT_PW"'"}' | jq -r .access_token
# pakai token ke apps/api
curl -s "$BACKEND_URL/api/v1/finance/reminders" -H "Authorization: Bearer <access_token>"
```
Klaim di JWT harus berisi `app_metadata` CDPS (bukti hook §2.3 aktif). Jika `app_metadata`
kosong → hook belum dipilih di Dashboard.

Setelah smoke test hijau → jalankan **`WAVE1_EXIT_UAT_RUNBOOK.md`** dengan pilot; catat hasil
di `WAVE1_EXIT_UAT_REPORT_TEMPLATE.md`; keputusan go/no-go Wave 2 → `docs/DECISIONS.md`.

---

## 7. Operasional & teardown

- **Nonaktifkan akun:** `select public.set_employee_banned('EMP-00XX', true);` (mirror deaktivasi HRIS → ban GoTrue).
- **Ganti password pilot:** re-run `pilot_seed.sql` dengan `pilot_pw` baru (upsert hash) lalu, di Supabase, hash baru otomatis dipakai GoTrue via kolom `encrypted_password` — untuk akun yang SUDAH ter-provision, update `auth.users.encrypted_password` manual atau reset via Dashboard (import hanya provisioning pertama).
- **Teardown:** hapus service Railway + pause/delete Supabase project staging. Data UAT jangan dibawa ke produksi.
- **Jangan** pakai project produksi untuk UAT; staging = throwaway.

## Referensi
- Auth internals: `supabase/migrations/20260723071013_supabase_auth.sql` (hook, `import_employee_credentials`, `set_employee_banned`), `docs/handoff/AUTH_UAT_RUNBOOK.md`.
- Pilot seed: `supabase/uat/pilot_seed.sql`. UAT skenario: `WAVE1_EXIT_UAT_RUNBOOK.md`. Dry-run: `WAVE1_EXIT_UAT_REPORT_AUTOMATED_20260723.md`.
