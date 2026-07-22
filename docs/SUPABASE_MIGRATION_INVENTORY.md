# Inventaris Sistem CDPS Saat Ini

**Dokumen induk:** `SUPABASE_MIGRATION_PLAN.md` · **Lampiran teknis:** `SUPABASE_MIGRATION_TECH_APPENDIX.md`
**Tanggal Audit:** 2026-07-22  
**Repository:** github.com/meagrup/agencyapp  
**Stack Saat Ini:** Go 1.24.7 + MySQL 8.x + React/Next.js + Railway

---

## Ringkasan Angka

| Metrik | Nilai |
|--------|-------|
| Jumlah Tabel Database | 49 tabel (hitung `CREATE TABLE` unik seluruh `*.up.sql`) |
| Jumlah Migrasi SQL | 26 file migrasi (0001–0037, dengan gap) |
| Jumlah Modul Backend | 16 modul (M0–M15 + core + utilities) |
| Jumlah Endpoint HTTP | ±195 registrasi route (hitung `HandleFunc`/`Handle` di `httpapi`) |
| Dependency Go Utama | `github.com/go-sql-driver/mysql v1.10.0`, `golang.org/x/crypto` |
| Versi Go | 1.24.7 |
| Versi Next.js | 16.2.10 |
| Versi React | 19.2.4 |

---

## 1. Daftar Tabel Database

**Catatan:** Fitur MySQL-spesifik yang perlu konversi ke Postgres:
- `TINYINT(1)` → `BOOLEAN`
- `AUTO_INCREMENT` → `SERIAL` / `BIGSERIAL`
- `DATETIME` / `DATETIME(3)` → `TIMESTAMP`
- `ON UPDATE CURRENT_TIMESTAMP` → trigger di Postgres
- `JSON` → `JSONB` di Postgres
- `VARCHAR(n)` → `VARCHAR(n)` (kompatibel)
- `DECIMAL(m,n)` → `NUMERIC(m,n)` (kompatibel)
- `ENUM` → custom enum type atau `VARCHAR`
- Trigger `BEFORE UPDATE/DELETE` (SIGNAL SQLSTATE) → postgres exception handling
- `DEFAULT CURRENT_TIMESTAMP(3)` → `DEFAULT NOW()`
- Engine `InnoDB` dan charset `utf8mb4` → default di Postgres
- Foreign keys dan indexes → kompatibel dengan setup yang tepat

### Sprint 0 / Inisialisasi (0001_init.up.sql)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `employees` | Mirror sinkron data HRIS (nama, email, divisi, jabatan, status_aktif, synced_at) | UNIQUE KEY email, DATETIME |
| `sessions` | Opaque session tokens terikat ke employee, revokable | DATETIME, FK employee |
| `id_sequences` | Monthly sequence store untuk PREFIX-YYYYMM-NNNN ID generation | PK: (prefix, period) |
| `audit_log` | Append-only immutable history (entity_type, entity_id, actor, action, before_json, after_json) | JSON, BIGINT AUTO_INCREMENT, BEFORE UPDATE/DELETE trigger (SIGNAL), DATETIME(3) |
| `role_mappings` | HRIS divisi+jabatan → CDPS division+level mapping | UNIQUE KEY (divisi, jabatan) |
| `employee_layered_roles` | Layered OD/Director roles on employee account (role, enabled, period) | UNIQUE KEY (employee_id, role), FK |
| `master_services` | Master Service List logical service ID (immutable parent) | VARCHAR(32) PK |
| `master_service_versions` | MSL versioned entries (name, standard_price, commission_rule, effective_from) | UNIQUE KEY (service_id, version_no), DECIMAL(15,2), FK |
| `notifications` | In-app notifications, mark-as-read only (tidak deletable) | BIGINT AUTO_INCREMENT, BEFORE DELETE trigger, DATETIME(3) |
| `demo_tasks` | Demo task exercising brief_task machine (DEMO- prefix) | status VARCHAR(64) |
| `demo_task_block_requests` | Block request workflow untuk demo task | FK demo_tasks |

### Wave 1: Money Path (0002_wave1_money_path.up.sql)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `leads` | Lead registry (LEAD- prefix), record_status via state machine | UNIQUE idx phone_norm, multiple indexes, DATETIME |
| `prospect_attempts` | One salesperson's attempt per lead (PRSP- prefix), status via state machine | FK leads, multiple TINYINT flags |
| `prospect_attempt_nq_reasons` | Multi-select not-qualified reasons | BIGINT AUTO_INCREMENT, UNIQUE KEY (attempt_id, reason), FK |
| `negotiation_proposals` | Versioned proposal (NEG- prefix) | UNIQUE KEY (attempt_id, version_no), FK |
| `negotiation_proposal_lines` | Service line items dalam proposal | BIGINT AUTO_INCREMENT, DECIMAL(15,2), FK |
| `clients` | Client record (CLI- prefix), sales PIC, commission PIC, GMV baseline/target | DECIMAL(15,2), multiple FKs, DATETIME |
| `client_platforms` | Platforms managed for client (Shopee, TikTok, dll) | BIGINT AUTO_INCREMENT, DATETIME, TINYINT active |
| `client_sales_allocations` | Sales allocation Σ=100% in basis points (10000=100%) | BIGINT AUTO_INCREMENT, UNIQUE KEY (client_id, salesperson_id), INT basis_points |
| `services` | Closed service line (SVC- prefix), snapshot of MSL version at closing | master_version_no INT, status, DECIMAL(15,2), FK |
| `transactions` | Transaction record (TRX- prefix), payment_intent_scheme, payment_status | DECIMAL(15,2), TINYINT bermasalah, FK |
| `installments` | Installment entries (INST- prefix), status via state machine, jatuh_tempo flag | UNIQUE KEY (transaction_id, installment_no), DECIMAL(15,2), DATETIME, FK |

### Module 0 Support & Qualified Forms (0006_qualified_forms.up.sql)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `qualified_forms` | Client draft + selected services saat qualification (attempt_id PK) | DECIMAL(15,2), DATETIME, FK prospect_attempts |
| `qualified_form_services` | Services dalam qualified form | BIGINT AUTO_INCREMENT, UNIQUE KEY (attempt_id, master_service_id), DECIMAL(15,2), FK |

### Briefs & Task Execution (0010, 0022, 0024)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `briefs` | Brief-task entity (service-scoped), status via state machine, title, due_date, priority | sla_target_hours DECIMAL NULL (added in 0024), DATETIME, FK services |
| `brief_block_requests` | Block request workflow (pending/approved/rejected) | VARCHAR(48) PK, DATETIME resolved_at NULL, FK briefs |

### Payment & Verification (0011, 0012)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `payment_verifications` | Installment payment verification audit trail | BIGINT AUTO_INCREMENT, status, verified_date, FK |
| `transaction_issue_approvals` | Bermasalah transaction approval workflow | VARCHAR(32) PK, status VARCHAR(16), FK |

### Strategy & Client Management (0021, 0023)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `strategy_plans` | Strategy plan per service (status, approval workflow) | VARCHAR(32) PK, DATETIME |
| `complaints` | Client complaints (status via state machine) | VARCHAR(32) PK, resolved_by/resolved_at NULL, DATETIME, FK |

### Assets & Creative (0025)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `assets` | Creative asset (AST- prefix), task-like entity, sla_target_hours, revision tracking | sequence_no INT, status, DECIMAL(10,2) NULL sla, output_link TEXT, ON UPDATE CURRENT_TIMESTAMP, UNIQUE (brief_id, sequence_no), FK briefs |
| `asset_block_requests` | Block request untuk asset | VARCHAR(48) PK, pending/approved/rejected, FK assets |

### Ads & Performance (0026, 0030, 0033)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `ad_campaigns` | Ad campaign (ADC- prefix), platform (Shopee Ads/TikTok/Social), budget, target_kpi | budget DECIMAL(20,2), ON UPDATE CURRENT_TIMESTAMP, status default '[Paused]', FK briefs |
| `ad_campaign_assets` | Creative-asset linkage dengan period (linked_at, unlinked_at) | BIGINT AUTO_INCREMENT, unlinked_at NULL (swap history), FK |
| `metric_entries` | Periodic performance input (MTR- prefix), spend/gmv, optional ctr/cvr | DECIMAL(20,2) spend/gmv, entry_method Manual\|File Export, FK |
| `metric_entry_assets` | Immutable snapshot linked assets per metric entry | PK (metric_entry_id, asset_id), FK |
| `optimization_logs` | Campaign optimization changes (OPT- prefix), before/after/reason, append-only | VARCHAR(32) PK, change_type Budget\|Targeting\|Creative Swap\|Schedule\|Other, FK |
| `campaigns` | Lead-generation campaign (CMP- prefix), distinct from Ad Campaign | VARCHAR(32) PK |
| `marketing_performance_records` | Marketing module performance snapshots | VARCHAR(32) PK |

### KOL & Livestream (0027, 0028)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `creator_bookings` | KOL booking (BKG- prefix), platform, niche, source_pool (MCN/External/Ad-hoc) | agreed_rate DECIMAL(20,2), ON UPDATE CURRENT_TIMESTAMP, status '[Sourcing]' default, sla_target_hours NULL, FK briefs |
| `creator_payment_requests` | KOL payment request (CPR- prefix), amount, payment_details, status via state machine | DECIMAL(20,2) amount, rejection_reason NULL, FK |
| `creator_lists` | Pool of creators (MCN roster, external pool) | VARCHAR(32) PK |
| `live_stream_sessions` | Livestream session (LSS- prefix), platform, start/end datetime | VARCHAR(32) PK, DATETIME |

### Override & Linkage (0029, 0032)

Migrasi 0029 (`strategy_requirement_override`) dan 0032 (`campaign_linkage`) **tidak membuat tabel
baru** — keduanya hanya ALTER/penambahan kolom & index pada tabel existing (verifikasi: tidak ada
`CREATE TABLE` di kedua file).

### Dependencies & Health Scoring (0034, 0035)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `dependencies` | Entity dependencies (untuk blocking/gating) | VARCHAR(32) PK |
| `client_health_snapshots` | Monthly health score per client (CHR- prefix) | final_health_score DECIMAL(6,3) NULL, band VARCHAR(16), components_json JSON, UNIQUE (client_id, period_start), BEFORE UPDATE/DELETE trigger, FK |

### Performance Metrics (0036)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `performance_snapshots` | Team performance snapshot (PERF- prefix) | VARCHAR(32) PK, DATETIME |
| `perf_kpi_weights` | KPI weights untuk performance scoring | BIGINT AUTO_INCREMENT |
| `perf_period_targets` | Period-based performance targets | BIGINT AUTO_INCREMENT |

### Local Auth (0037_local_auth.up.sql)

| Tabel | Deskripsi | Fitur Khusus |
|-------|-----------|-------------|
| `employee_credentials` | Bcrypt password hash lokal, must_change_password, brute-force lockout tracking | password_hash VARCHAR(255), TINYINT must_change_password, failed_attempts INT, locked_until DATETIME NULL, ON UPDATE CURRENT_TIMESTAMP, FK employees |

---

## 2. Modul Backend

**Lokasi:** `/home/user/AgencyAPP/backend/internal/`

### Core Engines
- **`core/`**: Shared foundational engines (state machine, ID generation, audit log, HRIS sync, database connection pooling)

### Integration & Auth
- **`auth/`**: Local bcrypt authentication, session management, actor resolution; HRIS employee sync gateway (read-only)
- **`hris/`**: HRIS API contract client, employee sync scheduling, fallback CSV importer
- **`integration/`**: External service integrations (payment gateways, platform APIs, etc.)

### HTTP & Utilities
- **`httpapi/`**: HTTP router (14 route files + 20+ handler files), permission middleware, response formatting, audit logging
- **`db/`**: Database abstraction layer, migrations runner, connection lifecycle
- **`admin/`**: Admin-only operations (role assignment, password reset, HRIS sync trigger)
- **`importer/`**: Bulk data import (leads, employees CSV fallback)
- **`seed/`**: Fixture seeding (Alpha Digital worked example)
- **`demo/`**: Demo-mode handlers & test utilities
- **`testutil/`**: Test helpers, mock database, in-memory fixtures

### Module 0–15 (Product Modules)

| Module | Lokasi | Fungsi Utama |
|--------|--------|-------------|
| **M0** | `module0_sales/` | Sales: negotiation proposals, closing logic, allocation, commission calc |
| **M1** | `module1_leads/` | Leads: registration, bulk import, pool claim, lead-to-prospect workflow |
| **M2** | `module2_marketing/` | Marketing: performance metrics, rollup, helper analytics |
| **M3** | `module3_campaign/` | Lead-gen campaigns (CMP-), lifecycle, rollup aggregation |
| **M4** | `module4_client/` | Client records, intent tracking, client-lock mechanism |
| **M5** | `module5_finance/` | Finance: transactions, installments, bermasalah handling, payment reminders |
| **M6** | `module6_account/` | Account: briefs (M6 tier 1), brief review/approval, AM assignment |
| **M7** | `module7_creative/` | Creative: assets, output delivery, daily-output rollup, block requests |
| **M8** | `module8_ads/` | Ads: ad campaigns, metrics, optimization logs, ROAS recompute |
| **M9** | `module9_kol/` | KOL: creator bookings, payment requests, pool management, sourcing workflow |
| **M10** | `module10_livestream/` | Livestream: sessions, status lifecycle, reopening logic |
| **M11** | `module11_board/` | Board: aggregated views, gate logic for multi-module workflows |
| **M12** | `module12_task/` | Task execution: SLA targets, speed score, turnaround, block requests |
| **M13** | `module13_health/` | Client health: health scoring (0–100), band classification, ROAS toggle, immutable snapshots |
| **M14** | `module14_performance/` | Team performance: KPI weights, period targets, modifier logic |
| **M15** | `module15_portal/` | Client portal: separate auth realm, per-client allow-list data access (Wave 3) |

---

## 3. HTTP API Endpoints

**Basis:** Go 1.22 ServeMux routes via 14 route files + inline handlers

### Routes by Module

| File | Rute & Endpoint Count | Modul |
|------|--------------------|----|
| `routes_leads_sales.go` | 14 endpoint (`POST /api/v1/leads`, `/leads/{id}/claim`, negotiation lifecycle) | M0, M1 |
| `routes_account.go` | ~15 endpoint (brief CRUD, AM assignment, review/approval) | M6 |
| `routes_creative.go` | ~12 endpoint (asset CRUD, output upload, block requests) | M7 |
| `routes_campaign.go` | ~8 endpoint (campaign CRUD, lifecycle) | M3 |
| `routes_ads.go` | ~18 endpoint (ad campaign, metric entry, optimization log CRUD) | M8 |
| `routes_kol.go` | ~14 endpoint (creator booking, payment request, pool list) | M9 |
| `routes_livestream.go` | ~8 endpoint (session CRUD, lifecycle transitions) | M10 |
| `routes_task.go` | ~6 endpoint (SLA set, speed score read, block request CRUD) | M12 |
| `routes_marketing.go` | ~8 endpoint (marketing performance, metrics read) | M2 |
| `routes_client_finance.go` | ~12 endpoint (transaction, installment, bermasalah workflow) | M5 |
| `routes_health.go` | ~6 endpoint (health snapshot read, band history) | M13 |
| `routes_perf.go` | ~8 endpoint (performance snapshot, KPI weight, target management) | M14 |
| `routes_board.go` | ~8 endpoint (board views, workflow gate logic) | M11 |
| `routes_portal.go` | (empty, Wave 3) | M15 |

**Total:** ±195 registrasi route HTTP (hitung `HandleFunc`/`Handle`); angka per-file di atas adalah perkiraan kasar per modul

**Pola Umum:**
- `POST /api/v1/{resource}` — create
- `GET /api/v1/{resource}` — list/search (dengan pagination)
- `GET /api/v1/{resource}/{id}` — detail
- `POST /api/v1/{resource}/{id}/{action}` — state transition / action (e.g., `/leads/{id}/claim`, `/attempts/{id}/close`)

**Auth:** Semua route diproteksi via `a.protect(handler)` middleware; extract actor dari context (`r.Context()`)

**Error & Response:**
- Errors: Bahasa Indonesia dalam `[...]` bracket, via `writeErr(w, message)`
- Success: JSON via `writeJSON(w, data)`

---

## 4. Frontend

### web-internal (Next.js Internal Portal)

**Status:** Active development  
**Stack:** Next.js 16.2.10, React 19.2.4, TypeScript 5  

**Lokasi:** `/home/user/AgencyAPP/web-internal/`

**Fitur:**
- Workspaces, boards, dashboards
- Multi-module views (leads, clients, briefs, tasks, performance)
- Role-based UI (Staff, Lead/SPV, OD/Director)
- HTTP client likely uses `BASE_URL` env var pointing to backend API (`http://localhost:8080/api/v1` in dev, Railway URL in prod)

**Build:** `npm run build` → `.next/` (Vercel-optimized output)

**Deploy:** Railway RAILPACK builder, `npm run start`

### web-client-portal (External Client Portal)

**Status:** Empty shell placeholder (Wave 3, Module 15)  
**Lokasi:** `/home/user/AgencyAPP/web-client-portal/`

**Constraints (from README):**
- Separate authentication realm (NOT employee/HRIS)
- Strict per-client data allow-list (query layer, NOT permission-trimmed view)
- Requires security spec before build (Phase 0 v2 §11)
- Planned minimums: per-client data isolation, rate limiting, session expiry, per-contact audit

---

## 5. Deploy & Integrations

### Backend Deployment

**Docker:** Multi-stage build (`backend/Dockerfile`)
- Build stage: Go 1.24-alpine, static binary, migrations bundled
- Runtime: Alpine 3.20 + ca-certificates + tzdata, runs as non-root user `cdps`
- Env: `CDPS_MIGRATIONS_DIR=/app/migrations` (auto-migrate on startup)
- Healthcheck: `GET /healthz` (120s timeout)

**Railway Config:** `backend/railway.json`
- Builder: `DOCKERFILE` (build context = backend/)
- Start: `/app/cdps`
- Restart: ON_FAILURE (max 10 retries)
- Healthcheck path: `/healthz`

**Database:** MySQL 8.x (Railway managed MySQL service)
- DSN format: `user:pass@tcp(host:3306)/dbname?parseTime=true&multiStatements=true`
- Migrations auto-applied on server boot (via `cmd/migrate` CLI or embedded via `cmd/cdps`)

### Frontend Deployment

**Next.js Build:** `npm run build` → `.next/`

**Railway Config:** `web-internal/railway.json`
- Builder: `RAILPACK` (Node.js auto-detection)
- Start: `npm run start`
- Restart: ON_FAILURE (max 10 retries)

**Env Vars (likely needed):**
- `NEXT_PUBLIC_API_BASE_URL` — backend API endpoint

### HRIS Integration

**Contract:** `docs/HRIS_API_CONTRACT.md`

**Endpoint:** `GET /api/v1/employees` (HRIS side, called by CDPS)

**Query params:** `updated_since` (ISO 8601, incremental), `page`, `page_size`

**Response fields:** `employee_id`, `nama`, `email`, `divisi`, `jabatan`, `status_aktif`, `updated_at`

**Sync strategy:** 
- Incremental every 15 min via `updated_since`
- Full sync nightly
- Manual refresh trigger available to admin
- `status_aktif=false` → revoke sessions & access on next sync
- Fallback: CSV importer (dev/staging only, via `cmd/importer`)

**Auth:** Static service token or mTLS via `Authorization: Bearer <token>` header

### Local Authentication

**Implementation:** `backend/internal/auth/`, `backend/migrations/0037_local_auth.up.sql`

**Flow:**
1. HRIS synced employee created in `employees` table
2. Admin provisions temporary password → `employee_credentials.password_hash` (bcrypt), `must_change_password=1`
3. Employee login → verify bcrypt hash, forced password change on first login
4. Brute-force lockout: 5 failures → locked 15 minutes
5. Session issued as opaque token → `sessions` table (tied to employee, revocable)

**No HRIS auth:** CDPS owns password verification locally; HRIS is data-source-only

---

## 6. Development & Build Commands

**Makefile:** `/home/user/AgencyAPP/Makefile`

```bash
make test              # Run backend tests (serialized, DB-backed)
make migrate-up        # Apply pending migrations
make migrate-down      # Rollback (ARGS=all for everything)
make seed              # Load Alpha Digital fixture
make run-backend       # Start API server (auto-migrate)
make run-mockhris      # Start dev mock HRIS (from seed CSV)
make run-web           # Placeholder; frontend agent owns this
make vet               # Go vet backend
make build             # Compile Go binaries
make tidy              # go mod tidy
```

**DSN (Database):**
- Dev: `cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps?parseTime=true&multiStatements=true`
- Test: `cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps_test?parseTime=true&multiStatements=true`

---

## 7. Key Architectural Decisions

*Ref: `docs/DECISIONS.md`*

1. **Monolithic backend** per CLAUDE.md: one Go service, module boundaries via packages
2. **Immutable audit log:** every transition appended (not updated/deleted), BEFORE UPDATE/DELETE triggers enforce
3. **State machines:** every lifecycle entity has explicit transition table, invalid transitions blocked server-side
4. **Local auth** (2026-07-19): CDPS owns bcrypt verification; HRIS is employee data sync only
5. **Derived fields read-only:** ROAS, Health Score, Speed Score, commission, turnaround — computed from audit log, never user-typed
6. **Separate portal auth realm:** web-client-portal NOT wired to internal employee sessions
7. **Bahasa Indonesia validation messages** in square brackets `[...]`

---

## 8. Migration Path Constraints

**MySQL → Postgres conversion notes:**

1. **Type mapping:**
   - `TINYINT(1)` → `BOOLEAN`
   - `AUTO_INCREMENT` → `SERIAL` / `BIGSERIAL`
   - `DATETIME(3)` → `TIMESTAMP(3)`
   - `JSON` → `JSONB` (safer)
   - `DECIMAL` → `NUMERIC`
   - No `ENGINE=InnoDB` or `CHARSET=utf8mb4` (Postgres defaults handle it)

2. **Immutability enforcement:**
   - MySQL `BEFORE UPDATE/DELETE` triggers (SIGNAL SQLSTATE) → Postgres `BEFORE` triggers (RAISE EXCEPTION)

3. **Default values:**
   - `DEFAULT CURRENT_TIMESTAMP` → `DEFAULT NOW()`
   - `ON UPDATE CURRENT_TIMESTAMP` → Postgres `UPDATE` trigger setting `updated_at = NOW()`

4. **Foreign keys & indexes:** Fully compatible; require explicit setup

5. **Auto-migration:** Backend currently reads SQL files at runtime; will need Postgres-compatible migration runner (e.g., Flyway, golang-migrate, Supabase migrations)

6. **JSON fields:** Audit log `before_json`, `after_json`, component snapshots `components_json` — test JSONB performance / indexing

---

## 9. Catatan Dependency untuk Migrasi

- **Backend Go DIBEKUKAN dan tetap di MySQL** (keputusan hybrid/strangler) — TIDAK ada penggantian
  driver Go; backend baru ditulis TypeScript (lihat dokumen induk). Penggantian driver (`pgx` dsb.)
  hanya relevan jika suatu saat Go perlu jalan di Postgres — tidak direncanakan.
- **SQL dialect:** `ON UPDATE CURRENT_TIMESTAMP`, `SIGNAL SQLSTATE`, `AUTO_INCREMENT` → padanan
  Postgres, dipetakan lengkap di Lampiran Teknis §A.
- **Deploy target baru:** Next.js (UI + API routes) di Vercel; DB/Auth/Storage/Realtime di Supabase
  — topologi di Lampiran Teknis §E.

---

## 10. Data Volume Estimate (Sprint 0 seed fixture)

**Alpha Digital worked example** (via `cmd/seed`):
- 1 client, ~5 employees, demo workflows exercising state machines
- Actual production scale: TBD (not yet live)

