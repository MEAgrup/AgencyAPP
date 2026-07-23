# HANDOFF — Fase 1 sesi 13: Merge Wave 1 money-path + prep exit UAT + auth login lokal

> Standalone. Melanjutkan `HANDOFF_FASE1_SESI12_WAVE1_MONEYPATH.md`. Cukup untuk lanjut
> di chat lain tanpa konteks tambahan. Semua kerja di branch **`claude/cdps-phase1-wave2-exit-kqeg6c`**.

---

## 0. TL;DR status

- ✅ **Wave 1 money-path MERGED ke `main`** (PR #37 M1 claim → #38 M5 Finance → #39 M4 Client, urut). `main` @ `7bf4829`. Diverifikasi hijau pasca-merge (core 112 · db 9 · domain 170 · api 29).
- ✅ **Dry-run UAT otomatis 30/30** (harness eksekutabel) — money-path end-to-end lolos di lapisan domain.
- ✅ **Runbook exit UAT + template laporan** (implementation-accurate).
- ✅ **Runbook deploy staging + pilot seed** (8 akun login pilot) — tervalidasi lokal.
- ✅ **Auth login lokal (opsi A) diimplementasi** di `apps/api` — `/auth/login`, `/auth/logout`, `/me` + cookie session; menyatukan kontrak frontend↔API. Type + unit + integration hijau (domain 178 · api 37).
- 🔴 **BLOKER PRA-ADA ditemukan → TUGAS BERIKUTNYA:** `apps/api` gagal `next build` (turbopack, 45 error) — tak resolve import relatif `.js` maupun `@cdps/*`. App belum bisa jalan di Next ⇒ deploy staging + UI-UAT terblok sampai ini beres. CI tak menangkap (hanya typecheck+vitest).

---

## 1. Git state

`main` @ `7bf4829` (Merge PR #39). Branch kerja **`claude/cdps-phase1-wave2-exit-kqeg6c`** (dibuat ulang dari `main` pasca-merge) berisi commit:
```
feat(auth): local CDPS password login end-to-end (apps/api)          ← auth opsi A
docs(wave1): correct the deploy runbook's auth blocker
docs(wave1): staging deploy runbook + pilot login seed
test(wave1): executable end-to-end UAT harness + automated dry-run report
docs(wave1): implementation-accurate exit UAT runbook + report template
```
PR branch→`main` = **PR #40** (lihat GitHub). PR #37/#38/#39 sudah merged.

> **CATATAN CI:** runner GitHub Actions org belum ter-provision (job "failure" ~1 dtk, `runner_id:0`). Merah CI = infra, BUKAN kode. Perbaiki di Settings→Actions / billing agar CI hidup untuk Wave 2. Verifikasi nyata dilakukan lokal (lihat §6).

---

## 2. Deliverable + LOKASI FILE

### A. Exit UAT (gerbang manusia)
- `docs/handoff/WAVE1_EXIT_UAT_RUNBOOK.md` — skenario satu deal end-to-end, dipetakan ke endpoint `/api/v1` nyata + status state-machine + string BI verbatim.
- `docs/handoff/WAVE1_EXIT_UAT_REPORT_TEMPLATE.md` — checklist per-langkah + go/no-go.
- `docs/handoff/WAVE1_EXIT_UAT_REPORT_AUTOMATED_20260723.md` — hasil dry-run otomatis **30/30**.
- `packages/domain/src/wave1_uat.e2e.test.ts` — **harness eksekutabel** (env-gated `UAT=1`, DB segar/terdedikasi). Jalankan: `cd packages/domain && UAT=1 DATABASE_URL=<db> npm run uat:wave1`.

### B. Deploy staging + pilot
- `docs/handoff/WAVE1_STAGING_DEPLOY_RUNBOOK.md` — Supabase (migrasi+seed+pilot seed+Access Token Hook) → apps/api (Railway) → web-internal (Railway) → smoke-test per-peran. **Checklist secret** (operator isi di dashboard, nol secret di repo). Berisi juga catatan blocker auth (§⚠️.1) + blocker build (baru, lihat §4 di sini).
- `supabase/uat/pilot_seed.sql` — 8 akun login pilot (Sales staff/head, Account staff/lead, Finance staff/head, OD, Director). Idempoten, fail-fast, password via `-v pilot_pw=...`. Menambah 3 akun yang kurang (EMP-0011 Finance Head, EMP-0012 Account Lead, EMP-0013 OD), credential bcrypt, panggil `import_employee_credentials()` (GoTrue; skip di PG polos).

### C. Auth login lokal (opsi A)
- `packages/domain/src/auth.ts` — `authenticate` (bcrypt + lockout 5×/15mnt, port Go `internal/auth/local.go`), `loadClaims`/`loadIdentity`/`mustChangePassword`. Errors: `InvalidCredentialsError`/`NotProvisionedError`/`LockedError` (string BI verbatim).
- `packages/domain/src/auth.test.ts` — 8 test integration.
- `packages/domain/src/index.ts` — `export * as auth`.
- `apps/api/src/app/api/v1/auth/login/route.ts` · `.../auth/logout/route.ts` · `.../me/route.ts` — endpoint.
- `apps/api/src/lib/auth.ts` — `signJwtHS256`, `sessionCookie`, `buildSessionCookie`/`clearSessionCookie`, `requireActor` kini terima **bearer ATAU cookie `cdps_session`**.
- `apps/api/src/lib/http.ts` — envelope error bawa `error` + `message` (frontend baca `message`); map error auth (401/423).
- `apps/api/src/lib/auth.test.ts`, `http.test.ts` — +test.
- `apps/api/.gitignore` — `.next/`, `next-env.d.ts`.
- Keputusan + deviasi: `docs/DECISIONS.md` (entri 2026-07-23 auth opsi A; deviasi opaque-session→stateless-cookie, revokasi server-side deferred).

---

## 3. Arsitektur auth (yang berlaku sekarang)

- Login: `POST /api/v1/auth/login {email,password}` → `auth.authenticate` (bcrypt vs `employee_credentials`, cek `status_aktif` + lockout) → mint **HS256 JWT** (`app_metadata`=`employee_claims`, exp 12h) → set cookie **httpOnly `cdps_session`** (SameSite=Lax, Secure di produksi) → balikan `{employee, role, must_change_password}`.
- Tiap request: `requireActor` ambil token dari **bearer header ATAU cookie** → `verifyJwtHS256` → `actorFromClaims`. Satu format token ⇒ jalur bearer (GoTrue/programatik) & cookie (browser) identik; parity RLS/klaim terjaga (`employee_claims` = sumber sama).
- `/me`: resolve actor dari cookie → `{employee, role, must_change_password}`. `/auth/logout`: clear cookie.
- **Deviasi dari Go (ter-log):** sesi = JWT stateless dalam cookie, BUKAN opaque token tabel `sessions`. Logout = clear cookie (tanpa revokasi server-side; kedaluwarsa 12h). Revokasi server-side + change-password + admin set-password = DEFERRED.

---

## 4. 🔴 TUGAS BERIKUTNYA (urut) — mulai di sini

1. **PERBAIKI `next build` apps/api (turbopack resolver) — BLOKER deploy.**
   - Gejala: `cd apps/api && npm run build` → 45 error `Module not found`: `./http.js` (import relatif ber-`.js`) + `@cdps/core`/`@cdps/db`/`@cdps/domain` (paket workspace). `npm run dev` sama.
   - Akar: turbopack tak me-resolve (a) specifier `.js` ke file `.ts`, dan (b) alias `@cdps/*` (tsconfig `paths` → `../../packages/*/src`, tanpa index eksplisit). `transpilePackages` saja tak cukup.
   - Kandidat fix (`apps/api/next.config.ts`): tambah `turbopack.resolveAlias` untuk `@cdps/core|db|domain` → `../../packages/*/src/index.ts`, dan atur resolusi ekstensi/`.js`→`.ts`. Jika `.js`↔`.ts` tak bisa via config, opsi: (i) buat `package.json#exports`/симlink di tiap `packages/*`, atau (ii) seragamkan impor jadi extensionless (besar, dozens file) — **pilih config dulu**.
   - **DoD:** `npm run build` sukses + `npm run start` melayani `/api/v1/*`; smoke-test HTTP login (lihat §5) hijau. Tambah job `next build` ke CI agar tak regres.
   - Catatan: kode auth sudah benar (type+unit+integration hijau); ini murni resolver build.

2. **Smoke-test HTTP auth end-to-end** (setelah #1): jalankan apps/api, seed pilot, `curl` login→me→endpoint terproteksi→logout. Lihat §5.

3. **Wiring frontend** (frontend agent): pastikan `web-internal` login page → `/api/v1/auth/login`, kirim cookie (`credentials:'include'` sudah ada), render string BI dari `body.message` (sudah didukung backend). Konfirmasi proxy `BACKEND_URL` meneruskan cookie.

4. **Deploy staging + jalankan gate UAT manusia** (`WAVE1_STAGING_DEPLOY_RUNBOOK.md` + `WAVE1_EXIT_UAT_RUNBOOK.md`) → catat hasil di `WAVE1_EXIT_UAT_REPORT_TEMPLATE.md` → keputusan go/no-go di `docs/DECISIONS.md`.

5. **Baru** setelah exit Wave 1 lolos → **Wave 2** (M6 Account & Service, M12 early, M7–M10). JANGAN mulai sebelum exit (Build Plan §4 / R5).

---

## 5. Smoke-test HTTP auth (setelah build diperbaiki)

```bash
export DATABASE_URL="postgres://postgres@127.0.0.1:5433/cdps"
export SUPABASE_JWT_SECRET="<any-strong-secret>"
psql "$DATABASE_URL" -f supabase/seed.sql
psql "$DATABASE_URL" -v pilot_pw="UAT-Staging-2026!" -f supabase/uat/pilot_seed.sql
(cd apps/api && npm run start &)   # port 3000

# login (Finance staff) → 200 + Set-Cookie cdps_session
curl -si -c ck.txt http://127.0.0.1:3000/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"fajar@mea.co.id","password":"UAT-Staging-2026!"}'
curl -s -b ck.txt http://127.0.0.1:3000/api/v1/me            # {employee, role, must_change_password}
curl -s http://127.0.0.1:3000/api/v1/me                       # no cookie → 401 [.. "message": ..]
# wrong password → 401 [email atau password salah]; 5× → 423 [akun terkunci ...]
curl -s -b ck.txt -X POST http://127.0.0.1:3000/api/v1/auth/logout   # 204 + clear cookie
```

---

## 6. Cara jalankan test lokal (WAJIB — `DATABASE_URL` tak diset = integration auto-skip)

PG16 sebagai user `postgres` (root ditolak):
```bash
PGROOT=/var/lib/postgresql/cdpstest
rm -rf "$PGROOT"; mkdir -p "$PGROOT/data" "$PGROOT/run"; chown -R postgres:postgres "$PGROOT"
su postgres -c "/usr/lib/postgresql/16/bin/initdb -U postgres -A trust '$PGROOT/data'"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D '$PGROOT/data' -o '-p 5433 -k $PGROOT/run -c listen_addresses=127.0.0.1' -l '$PGROOT/pg.log' start"
su postgres -c "/usr/bin/psql -h 127.0.0.1 -p 5433 -U postgres -c 'create database cdps;'"
DBURL="postgres://postgres@127.0.0.1:5433/cdps"
for f in $(ls supabase/migrations/*.sql | sort); do psql "$DBURL" -v ON_ERROR_STOP=1 -q -f "$f"; done   # 53 tabel
export DATABASE_URL="$DBURL"
# npm ci sekali per paket; lalu:
(cd packages/core && npm run typecheck && npm test)     # 112
(cd packages/db && npm test)                            # 9
(cd packages/domain && npm run typecheck && npm test)   # 178 (+1 skipped = harness UAT)
(cd apps/api && npm run typecheck && npm test)          # 37
# harness UAT (DB segar/terdedikasi): (cd packages/domain && UAT=1 npm run uat:wave1)  # 30/30
```
Catatan: `notifications` & `audit_log` append-only ⇒ jalankan integration di DB segar antar-run bila hasil bergantung hitungan global (mis. finance scanReminders, harness UAT).

---

## 7. Aturan rumah yang dipegang sesi ini
- **0 string BI baru** (auth di-port VERBATIM dari Go `internal/auth`). **0 migrasi baru.** **0 event notif baru** (katalog FROZEN 15).
- Status HANYA lewat `sm_transition`; audit append-only; uang HANYA `@cdps/core money`; auto-calc DERIVED & recomputable.
- Predikat izin 3 implementasi (`permission.ts`/RLS/`employee_claims`) tak divergen — auth cookie pakai `employee_claims` yang sama.
- Tiap deviasi/interpretasi → `docs/DECISIONS.md` (auth opsi A + deviasi stateless-cookie sudah di-log).
