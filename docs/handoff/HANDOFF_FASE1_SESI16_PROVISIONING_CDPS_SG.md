# HANDOFF — Fase 1 Sesi 16: FE wiring lanjutan + notifications + provisioning 58 akun ke CDPS SG

> Standalone. Lanjutkan chat berikutnya dari dokumen ini.
> **Repo:** `MEAgrup/AgencyAPP` · **Branch kerja:** `claude/wave1-fe-wiring-done-2muvmy`
> **Working dir (sesi ini):** `/home/user/AgencyAPP`
> **Supabase project produksi:** **CDPS SG** = `egddxfcnrtecheiykhlf` (region ap-southeast-1 / Singapura).

---

## 0. Git state
- Branch `claude/wave1-fe-wiring-done-2muvmy`, semua ter-push ke `origin`.
- Commit terakhir (sebelum handoff ini): `ee3d133`. Rangkaian sesi ini:
  - `2f5d1cb` fix(api): align contract + scheme routes to FE contract (M5 §4/§7)
  - `9785c54` feat(api): wire in-app notifications inbox (house convention #8)
  - `8207e4d` docs(O37): decision brief read-path RLS vs service-role
  - `ee3d133` docs: go-live runbook + bootstrap SQL builder
  - (branch di-fast-forward dari `4e5299f`+`a9aa3c8` yang berisi Wave-1 wiring finance/clients/sales)
- Belum ada PR baru. PR #41 sudah merged ke `main` sebelumnya.

## 1. Yang SELESAI di sesi ini

### 1a. Kode (di branch, ter-push)
- **Contract/scheme routes** (`2f5d1cb`): `POST /transactions/{id}/contract` & `/scheme` kini `{ status:'ok' }` (dulu `{ ok:true }`); route scheme diperbaiki baca `payment_intent_scheme` (dulu salah `payment_scheme` → silent no-op). File: `apps/api/src/app/api/v1/transactions/[id]/{contract,scheme}/route.ts`.
- **Notifications inbox** (`9785c54`, house rule #8): `GET /notifications[?unread=1]` + `POST /notifications/{id}/read`.
  - Domain baru: `packages/domain/src/notifications.ts` (+ `.test.ts`), diekspor di `packages/domain/src/index.ts`.
  - Wire: `notificationRowToWire` di `apps/api/src/lib/wire.ts` (+ test).
  - Routes: `apps/api/src/app/api/v1/notifications/route.ts` + `notifications/[id]/read/route.ts`.
  - Own-inbox only (`recipient_employee_id = actor`), read_at satu-satunya mutasi.
- **O37 decision brief** (`8207e4d`): `docs/O37_RLS_DECISION_BRIEF.md` — rekomendasi opsi (a)+(c) (read as `authenticated` + inject `request.jwt.claims`). **Belum diimplementasi** (keputusan arsitektur; menunggu Yohan/Nerissa).
- **Go-live runbook + bundle builder** (`ee3d133`): `docs/GO_LIVE_RUNBOOK.md`, `scripts/build_bootstrap_sql.sh`.

### 1b. Validasi lokal (Postgres 16 bermigrasi)
- 31 migrasi apply bersih (fresh DB & bundle) — 14 machines, 15 events, 53 tables.
- `@cdps/db` 9 test + `@cdps/domain` **182 test** hijau (termasuk 4 notifications).
- Invariant SQL (ident / immutability / rls / auth_claims) hijau.
- `next build` @cdps/api OK.

### 1c. PROVISIONING PRODUKSI — 58 akun ke CDPS SG ✅ (lewat MCP Supabase)
Dilakukan langsung ke `egddxfcnrtecheiykhlf` (bukan lokal):
- Insert **58 employees / 38 role_mappings / 5 layered / 58 credentials** (upsert, idempoten).
- `SELECT public.import_employee_credentials()` → **58 akun GoTrue** dibuat.
- Terverifikasi: **58 auth.users + 58 identities(email) + 58 dengan klaim**; `app_metadata` peran benar (Director `director:true`, OD `od:true`, Sales/Account lead, KOL/Ads via override jabatan lintas-dept).
- **Password awal seragam `MeaCdps2026!`**, `must_change_password=true`.
- **7 karyawan di-skip** (di luar 6 divisi CDPS): HRGA ×1, Business Development ×5, Data & BI ×1.
- `employee_id` = **NIK** HRIS; `divisi`/`jabatan` disimpan mentah; peran diturunkan dari `role_mappings`.
- Sumber data: CSV `Data Karyawan V2` (65 baris). Skrip generator (di scratchpad sesi ini, TIDAK di repo — mengandung PII+hash): `generate_sql.mjs` (Node + bcryptjs), output `provision_employees.sql`.

### 1d. Temuan penting
- **Tidak ada drift migrasi sungguhan.** Remote CDPS SG punya migrasi terpisah `rls_harden_execute_surface` (`20260723064826`), tapi repo **sudah mengkonsolidasikannya** ke `20260102000003_rls_baseline.sql` §9 (baris 389-419: REVOKE/GRANT execute + retrofit search_path). Schema identik → tak perlu tambah file migrasi.
- **CDPS Sydney (`klrmguatvzbmujihzacl`, ap-southeast-2)** = salah region, **kosong** (0 tabel, 1 migrasi, 0 users). Aman dihapus.
- **Egress vs MCP**: environment Claude Code **memblokir HTTPS langsung** ke `supabase.co/.com` (403 CONNECT) — tapi **konektor MCP Supabase jalan** lewat kanal terpisah, jadi operasi DB ke project BISA lewat `mcp__Supabase__*`. (Google Docs tetap terblokir → data karyawan harus diberikan sebagai file/CSV, bukan link.)

## 2. Yang BELUM / langkah berikutnya

### 2a. Go-live CDPS SG — sisa langkah (butuh Dashboard, DI LUAR MCP)
1. **Aktifkan Custom Access Token hook**: Dashboard → Authentication → Hooks → "Customize Access Token (JWT) Claims" → Postgres → schema `public`, function `custom_access_token_hook`.
   - ℹ️ Login sudah membawa klaim dari `raw_app_meta_data` (ditulis import) walau hook belum aktif; hook + trigger `sync_employee_claims` menjaga klaim **fresh** saat peran berubah. Disarankan aktif, bukan blocker.
2. **Set 4 env var** (deploy apps/api + web-internal): `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`. **TIDAK butuh service_role key** (kode tak membacanya). Sumber: `docs/GO_LIVE_RUNBOOK.md` §Kredensial.
3. **Smoke-login** per peran (Sales staff/lead, Account lead, KOL, Finance, OD, Director) — verifikasi scope benar.

### 2b. Bisa dilanjut via MCP di sesi berikutnya
- **Hapus project CDPS Sydney** — tak ada tool `delete_project` di MCP; lakukan manual di Dashboard (sudah dikonfirmasi kosong).
- **Provisioning 7 karyawan non-CDPS** — bila sudah ada keputusan divisi (default sebelumnya: skip).
- **Reclassify 2 baris Sales lintas-fungsi** bila dikehendaki: Rizal Akda (SALES/Content Creator → kini Sales staff), Dini Mardiani (SALES/CRO → kini Sales staff).

### 2c. Kode / arsitektur terbuka
- **O37** (`docs/O37_RLS_DECISION_BRIEF.md`): read route apps/api masih service-role (RLS ter-bypass). Perlu keputusan → lalu implementasi `readAs()` (sketch ada di brief).
- FE 404 yang masih tersisa: `POST /leads/bulk` (ditunda), endpoint Wave 2/3 (jangan dikerjakan sebelum exit Wave-1 — build order).

## 3. Cara verifikasi cepat di sesi baru (MCP Supabase)
Konektor Supabase kadang perlu disambungkan ulang oleh user. Setelah tersambung:
```
mcp__Supabase__list_projects                      # pastikan CDPS SG = egddxfcnrtecheiykhlf
mcp__Supabase__execute_sql (project egddxfcnrtecheiykhlf):
  select (select count(*) from employees) e,
         (select count(*) from employees where auth_user_id is not null) provisioned,
         (select count(*) from auth.users) u;      # harap 58 / 58 / 58
```

## 4. File kunci
- **Domain:** `packages/domain/src/{finance,sales,client,leads,notifications}.ts` (+ `index.ts`).
- **Wire boundary:** `apps/api/src/lib/wire.ts` (+ `.test.ts`).
- **Routes:** `apps/api/src/app/api/v1/**` (notifications, transactions, finance, attempts, dst.).
- **FE contracts:** `web-internal/src/lib/{finance,sales,clients}.ts`, `web-internal/src/lib/types.ts`.
- **Auth/DB (apps/api):** `apps/api/src/lib/{auth,db,http}.ts`.
- **Migrasi:** `supabase/migrations/*.sql` (31 file); seed `supabase/seed.sql`; invariant `supabase/tests/*.sql`.
- **Docs go-live:** `docs/GO_LIVE_RUNBOOK.md`, `docs/O37_RLS_DECISION_BRIEF.md`, `scripts/build_bootstrap_sql.sh`.
- **Provisioning SQL** (regenerasi bila data karyawan berubah): scratchpad sesi ini `generate_sql.mjs` → `provision_employees.sql` (JANGAN commit — PII + hash). Password default `MeaCdps2026!`.

## 5. Konvensi yang wajib dijaga (ringkas — detail di `CLAUDE.md`)
- Build order: Wave-1 = M0/M1/M4/M5; jangan lompat ke Wave 2/3.
- ID `PREFIX-YYYYMM-NNNN`; state machine server-side; history immutable; derived read-only; pesan BI `[...]`; IDR `Rp. X.XXX.XXX,00`; notifikasi in-app (rule #8).
- Provisioning karyawan: `employee_id`=NIK, divisi/jabatan mentah, peran via `role_mappings`; OD/Director = layered (`employee_layered_roles`).
