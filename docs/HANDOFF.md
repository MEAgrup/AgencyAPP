# CDPS — Session Handoff (living document)

> Update this file at the end of every build session: what landed, what's next, what's blocked. Read it FIRST when resuming work. Complements (never replaces) `docs/DECISIONS.md`.

## 2026-07-10 — Sprint 0 (Foundation) implemented

**Branch:** `claude/platform-dev-continue-c3vtde` · **Base:** `main` (docs-only)

### Ticket status (docs/backlog/SPRINT0 BACKLOG.md)

| Ticket | Status | Where |
|---|---|---|
| S0-01 Repo & scaffolding | ✅ | monorepo: `backend/` (Go), `web-internal/` + `web-client-portal/` (shells), `.github/workflows/ci.yml` (vet+test dengan MySQL service), `Makefile` |
| S0-02 DB & migration tooling | ✅ | golang-migrate (`cmd/migrate`), `backend/migrations/` — up/down/re-up terverifikasi penuh; numbering range per area di `docs/DEV_ENVIRONMENT.md` |
| S0-03 ID generator | ✅ | `internal/core/ids` — `PREFIX-YYYYMM-NNNN`, atomic `LAST_INSERT_ID(seq+1)` row-lock; paralel tanpa gap/duplikat; rollback tidak mengonsumsi nomor |
| S0-04 Audit log engine | ✅ | `internal/core/audit` — append-only; UPDATE/DELETE diblok trigger `SIGNAL 45000` di storage layer; actor wajib |
| S0-05 Status-machine engine | ✅ | `internal/core/statemachine` — 10 mesin / 76 transisi dari `STATE_MACHINES.md`, byte-exact BI messages, role-gated `[Blocked]`, flag paralel; 469 kasus test |
| S0-06 HRIS employee sync | ✅ | `internal/core/hris` — `EmployeeSource` CSV + HTTP (kontrak §1), sync idempoten, deaktivasi revoke session, missing-from-full-sync flag, alert 2 kegagalan beruntun |
| S0-07 HRIS auth | ✅ | `internal/core/auth` — delegasi verify ke HRIS (fail-closed `[sistem HRIS tidak dapat dihubungi…]`), session token hash-only, middleware Bearer; tanpa password store |
| S0-08 Role mapping + permission | ✅ | `internal/core/authz` — matrix Phase 0 §4, layered OD/Director, mapping efektif tanpa redeploy, admin Director-only + audited |
| S0-09 Master Service List | ✅ | `internal/core/msl` — versioned full-snapshot, write Sales Head/SPV+Director saja, `EffectiveAt` lookup versi-pada-tanggal (money-critical, boundary-tested) |
| S0-10 Notification center | ✅ | `internal/core/notify` — 14 entri katalog §9 (resolver placeholder "not yet wired", lihat O15), inbox/unread/mark-read; no-delete ditegakkan trigger |
| S0-11 Seed & fixtures | ✅ | `internal/seed` + `cmd/seed` (`make seed`, idempoten) — roster OA-14 (Budi/Sinta/Rian/Kenny/Putri dst. via CSV sync), mapping+override, 3 jasa Alpha Digital (M0 §4.3); smoke test = gladi resik S0-12 |
| S0-12 Sprint 0 exit review | ⬜ | **Manusia:** demo di staging + go/no-go Wave 1 dicatat di DECISIONS.md. Rehearsal otomatisnya sudah jalan di CI (`internal/seed` TestSprint0Smoke) |

### Cara menjalankan
Lihat `docs/DEV_ENVIRONMENT.md`. Ringkas: MySQL/MariaDB lokal → `make migrate-up` → `make seed` → `make test`. Test DB-bound membuat database terisolasi per run dan skip bila DB tak tersedia.

### Keputusan & pertanyaan terbuka yang lahir dari sesi ini
- **Decided (dev-level):** baris 2026-07-10 di `docs/DECISIONS.md` (trigger immutability, MSL full-snapshot, dsb.) — perlu review Yohan.
- **Open baru: O10–O17** di `docs/DECISIONS.md` — paling penting sebelum Wave 1: **O10** (timezone `YYYYMM` ID), **O11/O12** (sumber `Closed-Lost` & source-set `[Closed - Kalah Kompetisi]`), **O15** (konfirmasi slug event notifikasi), **O16** (recipient event ops HRIS sync).
- Commission rule di seed MSL adalah placeholder `{"type":"pending_master_list"}` — menunggu daftar tervalidasi Sales Head (Build Plan R3). Wave 1 W1-06 TIDAK boleh menghitung komisi dari placeholder ini.

### Langkah berikutnya (jalur 1/A)
1. **S0-12** exit review (manusia) + go/no-go Wave 1.
2. Selesaikan **O10–O17** yang menandai Wave 1.
3. Mulai **Wave 1** per `docs/backlog/WAVE1 BACKLOG.md`: epics M1 (W1-01…04) dan M0 (W1-05…09) bisa paralel; M4 menunggu closing M0; M5 menunggu handoff M4. Semua create-flow memakai `ids.Generator` + `statemachine.Engine` + `audit.Logger` yang sudah ada — jangan tulis jalur status/ID sendiri.
4. Eksternal (blocker nyata): 2 endpoint HRIS (kontrak `docs/HRIS API CONTRACT.md` perlu sign-off maintainer), daftar Master Service List dari Sales Head.
