# HANDOFF — Fase 1 Sesi 14: fix build + auth BFF + FE wiring (master-services, leads)

> Standalone. Lanjutkan chat berikutnya dari dokumen ini. Branch: `claude/handoff-fase1-exit-uat-auth-b5mb89` (semua sudah di-push). PR: **#41** (`MEAgrup/AgencyAPP`, → `main`).

## 0. Git state
- Branch `claude/handoff-fase1-exit-uat-auth-b5mb89`, PR #41 ke `main`.
- Commit (urut): `ed57b59` fix next build → `9bc029f` auth smoke → `f5157a9` auth BFF + wiring → `9c4fc49` master-services wiring → `cb8c5de` leads wiring.
- Semua verifikasi lokal hijau (lihat §4). Keputusan tercatat di `docs/DECISIONS.md` (5 entri 2026-07-23) + open baru **O37** (RLS/service-role).

## 1. Arsitektur yang sudah mapan (baca dulu)
- **Monorepo npm workspace** (repo-root `package.json` `workspaces:["apps/*","packages/*"]`). Satu `npm install` di root. `apps/api` (Next 16 + Supabase, backend go-forward — Go di `backend/` diarsip read-only, DECISIONS O36), `packages/{core,db,domain}`.
- **Import extensionless** (bukan `.js`) di semua paket; `moduleResolution: bundler`. `packages/*` punya `exports:{".":"./src/index.ts"}`.
- **Kontrak wire = snake_case; domain = camelCase; ROUTE = boundary.** Request body snake→camel via `toInput` inline; response camel→snake via `apps/api/src/lib/wire.ts` (`*ToWire`). List dibungkus `{data:[...]}` (konvensi FE/Go).
- **Auth = Supabase GoTrue + BFF di apps/api.** Login server-side (`apps/api/src/lib/gotrue.ts` `passwordGrant`), JWT di **cookie httpOnly `cdps_access_token`**, `requireActor` (`apps/api/src/lib/auth.ts`) terima cookie ATAU bearer. Route: `POST /api/v1/auth/login`, `GET /api/v1/me`, `POST /api/v1/auth/logout`. `packages/domain/src/auth.ts` `getMe`.
- **web-internal (FE):** proxy `/api/v1/*` → apps/api (`next.config.ts` `BACKEND_URL` default `http://127.0.0.1:3001`). `src/lib/api.ts` baca body error `{error}` (+ fallback `{message}`). Auth-context/login page TAK diubah (kontrak `MeResponse` cocok).

## 2. Modul FE yang SUDAH di-wire (fungsional ke apps/api)
- **auth** — login/me/logout (butuh Supabase live utk login riil, lihat §5).
- **master-services** — `GET /master-services` (`{data}`, honor `?effective_at=YYYY-MM-DD`), `GET /master-services/{id}/versions`. Mapper `masterServiceToWire`.
- **leads** — `GET /leads/pool` (BARU), `GET /leads?status=&q=`, `GET /leads/{id}`, `POST /leads` (register), `POST /leads/{id}/claim`. Mapper `leadStubToWire`/`attemptStubToWire`/`poolRowToWire`/`leadRowToWire`/`leadDetailToWire`. Read model domain: `poolBoard`/`leadsDatabase`/`leadDetailView`.

## 3. Pekerjaan berikutnya (urutan saran)
1. **Wiring modul Wave-1 tersisa** (pola sama: read model domain camelCase → `wire.ts` `*ToWire` → route `{data}`):
   - **finance** (`web-internal/src/lib/finance.ts`, 152 baris) — transaksi, verifikasi, reminders. apps/api sudah punya route `transactions/*`, `reminders/*` (cek shape vs FE).
   - **clients** (`clients.ts`, 149) — client record, platforms. Route `clients/*` ada.
   - **sales** (`sales.ts`, 308 — paling besar) — attempts, quote-preview, qualified form. Route `attempts/*`, `sales/quote-preview` ada.
   - Bandingkan tipe FE (`web-internal/src/lib/<modul>.ts`) vs respons route apps/api; tambah `*ToWire`.
2. **`POST /leads/bulk` (DITUNDA)** — Marketing import door (M1 §3). Port `backend/internal/module1_leads/bulk.go`. FE `bulkImportLeads` masih 404 sampai ini ada.
3. **Endpoint yang FE pakai tapi apps/api belum punya:** `notifications` (FE `use-unread-count.ts`, `notifications/page.tsx` — engine `notification` ada di core), dan endpoint Wave 2/3 (ads/kol/creative/livestream/marketing/health/performance/tasks/board/portal — modul backend Wave 2/3 belum di-port ke apps/api sama sekali).
4. **O37 — RLS vs service-role (KEPUTUSAN ARSITEKTUR).** `db()` konek service-role → RLS ter-bypass di semua read route. Putuskan: (a) koneksi ber-JWT-user supaya RLS berlaku, (b) gate app-layer per read (port `canReadPool`/`leadListScope` dari Go `reads.go`), atau (c) kombinasi. Sampai diputus, read over-permissive (OK utk UAT internal terkendali).
5. **Gate manusia (§5)** lalu deploy staging → UAT.

## 4. Cara verifikasi lokal (semua hijau saat handoff)
```bash
# deps (sekali)
npm install                      # di repo root (workspace)
# typecheck + unit (tanpa DB)
npm run typecheck --workspaces --if-present
npm test -w @cdps/core           # 112
npm test -w @cdps/api            # 51 (auth cookie/token, gotrue mock, wire mappers)
# build
(cd apps/api && npm run build)   # hijau; semua route /api/v1/* + auth + /leads/pool
(cd web-internal && npm install && npx tsc --noEmit && npm run build)  # hijau

# integration DB (butuh Postgres 16). Setup cluster non-root:
PGBIN=/usr/lib/postgresql/16/bin; mkdir -p /tmp/pgdata /tmp/pgrun; chown -R postgres:postgres /tmp/pgdata /tmp/pgrun
su postgres -c "$PGBIN/initdb -D /tmp/pgdata -U postgres --auth=trust"
su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-p 5433 -k /tmp/pgrun -c listen_addresses=127.0.0.1' -l /tmp/pg.log start"
createdb -h 127.0.0.1 -p 5433 -U postgres cdps
for f in $(ls supabase/migrations/*.sql|sort); do psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -q -f supabase/seed.sql
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps"
npm test -w @cdps/db             # 9
npm test -w @cdps/domain         # 178 (fresh DB — jangan re-run tanpa drop; scanReminders notif akumulasi → false-fail pollution)
# invariant SQL (mirror CI db-and-migrations): ident/immutability/rls/auth_claims_checks.sql

# smoke HTTP auth (apps/api built):
cd apps/api && SUPABASE_JWT_SECRET=x npx next start -p 3111 &
BASE=http://127.0.0.1:3111 SUPABASE_JWT_SECRET=x node scripts/auth-smoke.mjs   # 13/13
```
> **Awas pollution:** `@cdps/domain` DB test menulis notif committed (`ZZ-BUDI`). Re-run tanpa drop+re-migrate DB bikin `scanReminders` idempotency-test gagal (`expected N to be 2`). Selalu DB fresh (CI otomatis fresh).

## 5. Gate manusia tersisa (di luar kode — DECISIONS O36 / entri auth)
1. **Aktifkan hook** `custom_access_token_hook` di Supabase Dashboard (Auth > Hooks) — tanpa ini JWT tak berisi `app_metadata`, actor tak resolve, RLS default-deny, login BFF 401.
2. **`import_employee_credentials()`** atas data karyawan riil (CSV) setelah verifikasi versi GoTrue.
3. **Env apps/api:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL` (pooler). web-internal: `BACKEND_URL` → URL apps/api.
4. **Smoke-login SEMUA role di staging**, lalu gate UAT manusia → go Wave 2.

## 6. File kunci
- Auth: `apps/api/src/lib/{auth,gotrue,http}.ts`, `apps/api/src/app/api/v1/{auth/login,auth/logout,me}/route.ts`, `packages/domain/src/auth.ts`, `apps/api/scripts/auth-smoke.mjs`.
- Wire boundary: `apps/api/src/lib/wire.ts` (+`.test.ts`).
- Leads: `packages/domain/src/leads.ts` (`poolBoard`/`leadsDatabase`/`leadDetailView`), `leads_reads.test.ts`, `apps/api/src/app/api/v1/leads/{route,pool/route,[id]/route,[id]/claim/route}.ts`.
- Porting source (Go, read-only ref): `backend/internal/module1_leads/reads.go`.
- FE lib kontrak: `web-internal/src/lib/*.ts` (mirror struct Go snake_case).
- Keputusan: `docs/DECISIONS.md` (2026-07-23 ×5 + O37).
