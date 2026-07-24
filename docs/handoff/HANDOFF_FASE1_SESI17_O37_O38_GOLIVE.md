# HANDOFF — Fase 1 Sesi 17: JWT asymmetric + O37 (RLS read-path) + O38 (forced password change) + go-live prod

> **Standalone.** Lanjutkan chat berikutnya dari dokumen ini.
> **Repo:** `MEAgrup/AgencyAPP` · **Branch kerja:** `claude/wave1-fe-handoff-924jdf`
> **Working dir:** `/home/user/AgencyAPP`
> **Supabase produksi:** **CDPS SG** = `egddxfcnrtecheiykhlf` (region ap-southeast-1 / Singapura).
> **Konektor MCP Supabase** menembus egress (HTTPS langsung ke `supabase.co` diblok — pakai `mcp__Supabase__*`).

---

## 0. Mulai baca dari mana (urutan)
1. **`CLAUDE.md`** (root) — konvensi wajib + build order.
2. **Dokumen ini** — state terkini + task berikutnya.
3. **`docs/DECISIONS.md`** — cari baris `O33`, `O34`, `O35` (masih OPEN); `O36/O37/O38` sudah RESOLVED.
4. **`docs/prd/`** — PRD per modul (spec). **`docs/prd/CDPS_Build_Plan.md`** = gelombang & exit criteria.
5. **`docs/GO_LIVE_RUNBOOK.md`** — langkah go-live prod (env, hook, smoke-login).
6. Sebelum port modul apa pun: baca PRD modulnya + `docs/DATA_MODEL.md` + `docs/STATE_MACHINES.md` untuk entitasnya.

---

## 1. Git state
- Branch `claude/wave1-fe-handoff-924jdf`, semua ter-push ke `origin`. Commit terakhir: `4d2bc65`.
- Rangkaian sesi ini (di atas `78cb2b8` = handoff sesi 16):
  - `b59dbe0` feat(auth): verify asymmetric (ES256/RS256) GoTrue tokens via JWKS
  - `c4b55b3` perf(db): covering indexes untuk 3 FK (advisor)
  - `77c0cd2` feat(api): enforce RLS on read path via readAs (**O37**)
  - `4d2bc65` feat(auth): forced first-login password change (**O38**)
  - (+ `6908fd1` docs)
- **Belum ada PR baru.** PR #41 sudah merged ke `main` sebelumnya. Branch ini berisi lanjutan di atas hasil merge itu.

---

## 2. Yang SELESAI sesi ini (kode + validasi + prod)

### 2a. JWT asymmetric (ES256/JWKS) — blocker login sebenarnya
CDPS SG (project dibuat 2026-07-22) menandatangani access token dgn **asymmetric key ES256** (`kid`=UUID), sedangkan `apps/api` dulu **HS256-only** → setiap login akan 401.
- **`apps/api/src/lib/jwks.ts`** (baru): fetch+cache JWKS project, verifikasi ES256/RS256 (ECDSA JOSE r||s).
- **`apps/api/src/lib/auth.ts`**: `verifyJwt` async menerima **HS256 (secret) + asymmetric (JWKS)**; `requireActor` kini **async**; login pakai `actorFromAccessToken`. Gate alg tetap tolak `none`/unknown.
- Semua ~35 call-site `requireActor` sudah `await`.
- **`SUPABASE_JWT_SECRET` TIDAK dibutuhkan** (ES256/JWKS). Tetap kompatibel HS256 bila project di-roll ke legacy.
- Test: `auth.asym.test.ts` (10) + HS256 lama.

### 2b. FK covering indexes (advisor performa)
`supabase/migrations/20260102000005_fk_covering_indexes.sql` — 3 index: `client_platforms.client_id`, `negotiation_proposal_lines.proposal_id`, `payment_verifications.installment_id`. **Sudah di prod.**

### 2c. O37 — RLS read-path (RESOLVED)
Dulu semua read jalan di service-role (BYPASSRLS) & mayoritas GET tak ber-auth → user bisa baca lintas-scope.
- **`apps/api/src/lib/db.ts`**: `readAs(actor, fn)` (buka tx, inject `request.jwt.claims` + `SET LOCAL ROLE authenticated` → **RLS men-scope**) + `readAsSystem(fn)` (jalur service-role bernama).
- **~20 route GET** user-facing dikonversi ke `readAs(actor,…)` + wajib auth (leads DB/detail/pool, attempts, clients, transaksi detail/payment/commission/bermasalah, demo-tasks, notifications, master-services, me).
- **3 dashboard finance** (reminders, finance/reminders, finance/queue) = `readAsSystem` + gate `permission.canReadDivision(actor,'Finance')` (persis scope yang RLS beri: Finance lead/OD/Director).
- **`supabase/migrations/20260102000006_employee_display_name.sql`**: `employee_display_name()` SECURITY DEFINER — nama owner/PIC tetap tampil di bawah RLS (ganti 13 `left join employees` di leads/sales/client). **Sudah di prod.**
- **Prasyarat deploy:** role `DATABASE_URL` harus bisa `SET ROLE authenticated` (pooler Supabase & superuser lokal bisa — sudah dibuktikan di CDPS SG: staff→1 baris, Director→58).
- Test: `apps/api/src/lib/db.integration.test.ts` (5, guard `DATABASE_URL`). Brief: `docs/O37_RLS_DECISION_BRIEF.md` (status IMPLEMENTED).

### 2d. O38 — forced first-login password change (RESOLVED, GoTrue-native)
58 akun lahir dgn `must_change_password=true` + default `MeaCdps2026!`, dulu tak ada cara ganti.
- **`supabase/migrations/20260102000007_change_password.sql`**: RPC `clear_must_change_password()` SECURITY DEFINER. **Sudah di prod.**
- **`apps/api/src/lib/gotrue.ts`**: `updatePassword(token,new)` via `PUT /auth/v1/user`.
- **`apps/api/src/app/api/v1/auth/change-password/route.ts`**: verifikasi sandi lama (password grant) → set baru via GoTrue → clear gate → re-issue cookie → return MeResponse.
- **`packages/domain/src/auth.ts`** `getMe`: `/me` kini bawa `must_change_password`.
- **FE `web-internal`**: `Employee` type + `(shell)/layout.tsx` & `login/page.tsx` redirect ke **`/change-password`** selama flag true; layar baru `src/app/change-password/`.

### 2e. Validasi (lokal Postgres 16 + prod)
- 34 migrasi apply bersih + seed; invariant SQL (ident/immutability/rls/auth_claims) **hijau**.
- Test: **apps/api 71**, **@cdps/core 112**, **@cdps/db 9**, **@cdps/domain 182** (integrasi aktif). Typecheck + `next build` (apps/api & web-internal) hijau.
- **Prod CDPS SG**: 58/58/58 akun; fungsi `employee_display_name` & `clear_must_change_password` ada; 3 index ada; scoping RLS terbukti (staff→own, Director→all).

---

## 3. Status provisioning prod (tak berubah dari sesi 16)
- 58 akun karyawan riil di CDPS SG (auth.users + identities + klaim app_metadata benar). Password default `MeaCdps2026!`.
- Sebaran peran (via `employee_claims`): Director 2, OD 3, Sales lead 1/staff 12, Account lead 2/staff 11, Ads staff 10, Creative lead 1/staff 9, KOL staff 4, Finance staff 3.
- **Gap kepemimpinan** (tercatat O33/O34, masih perlu keputusan Yohan): tak ada lead Ads/KOL/Finance, tak ada divisi Live Stream/Marketing di roster. Tak memblok Wave-1; berdampak saat modul Wave-2/3 butuh aktor peran itu.

---

## 4. SISA GO-LIVE (murni aksi manusia — di luar kode, sebagian di luar MCP)
1. **Set env deploy:**
   - `apps/api`: `DATABASE_URL` (Transaction pooler :6543), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. (`SUPABASE_JWT_SECRET` **tidak perlu**.)
   - `web-internal`: `BACKEND_URL` = URL deploy apps/api (rewrite `/api/v1/*`).
   - Nilai URL & anon key ada di `GO_LIVE_RUNBOOK.md`.
2. **Custom Access Token hook** — user bilang sudah di-set (Auth → Hooks → `custom_access_token_hook`). Verifikasi tetap.
3. **Leaked-password protection** — Dashboard → Auth → Password Security (advisor WARN; sekalian mitigasi default password).
4. **Deploy** apps/api + web-internal.
5. **Smoke-login** per peran: login pertama → **paksa `/change-password`**; sesudah ganti → workspace. Scope RLS: staff data sendiri, lead se-divisi, OD/Director semua.

> ⚠️ Advisor security WARN `jwt_owns_*` executable by `authenticated` — **JANGAN dicabut**; itu helper RLS, mencabut EXECUTE bisa mematahkan policy. INFO `rls_enabled_no_policy` pada tabel sistem = deny-all disengaja.

---

## 5. Batas arsitektur: yang SUDAH di-port vs BELUM (penting untuk wave berikutnya)
- **Go backend `backend/internal/` = source of truth LENGKAP** (M0–M15, teruji; diarsipkan read-only per O36). Ini acuan port.
- **Port Fase 1 (Supabase+Next)** baru mencakup **Wave-1 money path**:
  - `packages/domain/src/`: `auth, client, finance, leads, msl, sales, notifications, employees, demo`.
  - `apps/api/src/app/api/v1/`: `auth, me, leads, attempts, clients, services, transactions, finance, reminders, master-services, sales, notifications, demo-tasks, admin`.
  - `web-internal/`: halaman Wave-1 + shell/login/change-password.
- **BELUM di-port ke TS/Next** (masih hanya di Go): **Wave 2** — M6 account (`module6_account`), M7 creative (`module7_creative`), M8 ads (`module8_ads`), M9 kol (`module9_kol`), M10 livestream (`module10_livestream`), M12 task (`module12`); **Wave 3** — M2 marketing, M3 campaign, M11 board, M13 health, M14 performance, M15 portal.
  - Catatan: **schema DB Wave 2/3 SUDAH ada** (migrasi briefs/assets/ad_campaigns/kol/live_stream/campaigns/client_health/team_performance/complaints/dependencies) + **RLS policy** sudah tergelar untuk tabel-tabel itu. Jadi port = domain-logic + route + FE, bukan schema.

---

## 6. TASK BERIKUTNYA — mulai Wave 2 (port M6, M12, M7, M8, M9, M10)

**Prasyarat:** Wave-1 exit = money path code-complete ✅ (tinggal go-live manusia §4). Boleh mulai Wave 2 (Build Plan: **M6, lalu M12 early, M7, M8, M9, M10**).

**Pola port (ikuti Wave-1 yang sudah jadi):**
1. Baca PRD modul (`docs/prd/`) + entri `DATA_MODEL.md`/`STATE_MACHINES.md` + **implementasi Go** `backend/internal/module6_account/` dst. (source of truth).
2. Port domain-logic ke **`packages/domain/src/<modul>.ts`** (mirror fungsi Go; state machine via engine `@cdps/core`; tulis via RPC `sm_transition`/`ident_next`/`notify_emit`; money math test-first). Ekspor di `packages/domain/src/index.ts`.
3. Tambah wire snake_case di **`apps/api/src/lib/wire.ts`** (+ test).
4. Buat route di **`apps/api/src/app/api/v1/<modul>/…`**:
   - **Read user-facing → `readAs(actor, tx => domain.read(tx,…))`** (WAJIB, O37). Cross-scope/system → `readAsSystem` + gate app-layer eksplisit.
   - Write → `db()` + RPC SECURITY DEFINER + audit.
5. FE `web-internal` (halaman + `src/lib/<modul>.ts` fetch, `credentials:'include'`).
6. **DoD tiap tiket** (CLAUDE.md): validasi server-side + pesan BI `[...]`; permission test per peran (termasuk layered OD/Director); immutability test; derived recompute-from-log; seed Alpha Digital tetap lolos; notif event terdaftar bila katalog mewajibkan.

**Perhatian khusus Wave 2:**
- **O34/O33 (OPEN):** roster prod tak punya lead Ads/KOL/Finance, tak ada divisi Live Stream/Marketing. M9 (KOL) **tak punya operator riil**; gate lead M7/M8 hanya Director. UAT pakai fixture berlabel (`employees_uat.csv`/`role_mappings_uat.csv`). **Butuh keputusan Yohan** sebelum operasional riil modul-modul ini — flag, jangan pilih diam-diam.
- **O35 (OPEN):** granularitas sub-tim Creative (Video/Graphic) M7 §3 belum bisa dikodekan (model peran tak punya dimensi sub-tim) — gate saat ini = lead divisi. Butuh 3 keputusan sebelum assign-PIC granular.
- **O30/O31/O32** sudah RESOLVED (state awal Service `[Awaiting Onboarding]`; ADC born-`[Paused]`+Launch) — pakai keputusan itu.

---

## 7. File kunci
- **Konvensi/spec:** `CLAUDE.md`, `docs/prd/`, `docs/DATA_MODEL.md`, `docs/STATE_MACHINES.md`, `docs/DECISIONS.md`.
- **Domain (TS):** `packages/domain/src/*.ts` (+ `index.ts`). **Core engines:** `packages/core/src/` (permission, state machine, tz), `packages/db/src/` (client, executors).
- **apps/api:** `src/lib/{auth,jwks,gotrue,db,http,wire}.ts`; routes `src/app/api/v1/**`.
- **web-internal:** `src/lib/{api,types,finance,sales,clients,marketing}.ts`, `src/lib/auth-context.tsx`, `src/app/**`, `next.config.ts` (rewrite `BACKEND_URL`).
- **Migrasi:** `supabase/migrations/*.sql` (34 file); seed `supabase/seed.sql`; invariant `supabase/tests/*.sql`.
- **Go (acuan port):** `backend/internal/module*/`.
- **Docs go-live:** `docs/GO_LIVE_RUNBOOK.md`, `docs/O37_RLS_DECISION_BRIEF.md`.

---

## 8. Verifikasi cepat di sesi baru

### Lokal (Postgres 16 — resep yang dipakai sesi ini)
```bash
pg_ctlcluster 16 main start
sudo -u postgres psql -tAc "drop database if exists cdps_val; create database cdps_val;"
for f in supabase/migrations/*.sql; do sudo -u postgres psql -d cdps_val -v ON_ERROR_STOP=1 -f "$f"; done
sudo -u postgres psql -d cdps_val -f supabase/seed.sql
sudo -u postgres psql -tAc "alter role postgres with password 'valpwd';"
export DATABASE_URL="postgresql://postgres:valpwd@127.0.0.1:5432/cdps_val"
npm install
DATABASE_URL="$DATABASE_URL" npm run test --workspaces --if-present   # integrasi aktif
for t in ident immutability rls auth_claims; do sudo -u postgres psql -d cdps_val -v ON_ERROR_STOP=1 -f "supabase/tests/${t}_checks.sql"; done
# web-internal bukan workspace root: cd web-internal && npm install && npm run build
```
> pg cluster bisa mati sendiri antar-turn; `pg_ctlcluster 16 main start` lagi bila "connection refused".

### Prod (MCP Supabase — konektor kadang perlu reconnect + approve dari user)
```
mcp__Supabase__execute_sql (egddxfcnrtecheiykhlf):
  select (select count(*) from employees) e,
         (select count(*) from employees where auth_user_id is not null) prov,
         (select count(*) from auth.users) u;                    -- 58/58/58
  -- scoping RLS (non-mutating):
  begin; set local role authenticated;
  select set_config('request.jwt.claims','{"app_metadata":{"employee_id":"<id>","division":"Sales","level":"staff","od":false,"director":false}}',true);
  select count(*) from employees; rollback;                       -- staff → 1
mcp__Supabase__get_advisors (security|performance)
```
> Versi migrasi di prod pakai timestamp otomatis (`20260724…`) ≠ nomor file repo (`20260102000005/6/7`) — **schema identik**, DDL idempoten, `supabase db push` re-apply aman.

---

## 9. Konvensi wajib (ringkas — detail `CLAUDE.md`)
- Build order: jangan lompat gelombang; Wave-2 = M6/M12/M7/M8/M9/M10.
- ID `PREFIX-YYYYMM-NNNN` (setelah validasi); state machine server-side (transition engine, tak pernah raw update); history immutable (append-only audit); derived read-only (recompute-from-log); pesan BI `[...]`; IDR `Rp. X.XXX.XXX,00`, bagi-nol → `—`; notifikasi in-app (rule #8, dari audit log).
- Permission: Staff=data sendiri, Lead/SPV=se-divisi, OD=read-only semua+OKR, Director=penuh; OD/Director layered.
- **Read wajib lewat `readAs` (O37)**; write lewat RPC service-role.
- PRD menang bila konflik; **ambigu → STOP & catat di `DECISIONS.md`**, jangan pilih diam-diam.
