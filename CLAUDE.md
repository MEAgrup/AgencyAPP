# CLAUDE.md — CDPS (Client Delivery & Performance System), MEA Agency

## What this project is
Standalone internal system covering MEA Agency's full client lifecycle: lead intake → sales closing → payment gate → delivery execution (Creative/Ads/KOL/Live-Stream-vendor) → client health scoring → team performance → client/team portals. It is NOT an HRIS — MEA's HRIS (employee/attendance/leave) is a separate existing system we integrate with (read-only employee sync only; CDPS auth is local — see `docs/DECISIONS.md` 2026-07-19). See `docs/prd/CDPS_Build_Plan.md` for waves and `docs/prd/` for the 18 PRD documents.

## Stack & architecture (decided — do not change without a logged decision)

> ### ⛔ GO + MYSQL SUDAH PENSIUN DAN SUDAH DIARSIP — JANGAN BANGUN DI SANA
>
> Stack CDPS adalah **TypeScript + Supabase/Postgres** (keputusan `docs/DECISIONS.md`
> 2026-07-29 "Pensiun Go"). **C-05 dieksekusi 2026-09-04:** `backend/` sudah **pindah ke
> `archive/backend-go/`**, job CI `backend` sudah dicabut, dan service Railway dimatikan.
> MySQL tidak dipakai sama sekali.
>
> `archive/backend-go/**` adalah **arsip read-only**. Ia disimpan untuk satu alasan:
> sejak O47 memutuskan `cmd/import` ditinggalkan, di situlah spesifikasi tiga alur
> klien itu masih bisa dibaca. Ia **bukan** stack produksi, tidak di-deploy, tidak
> dijalankan CI, dan **bukan lagi** oracle paritas yang wajib dijaga hijau.
>
> **Jangan tulis apa pun di sana.** Menambah kode Go berarti menciptakan versi kedua
> dari aturan bisnis yang sama, di pohon yang tidak dijalankan siapa pun.
>
> Untuk paritas **bentuk respons**, rujukannya `apps/api/src/lib/shape-parity.test.ts`
> (ber-anchor tipe FE), bukan Go.

- **Backend:** **TypeScript**, modular monolith. `apps/api` (Next.js route handlers,
  lapisan tipis) di atas `packages/domain` (satu modul per modul PRD: `sales`,
  `leads`, … `portal`) di atas `packages/core` (engine bersama: ident, statemachine,
  money, permission, audit, notification, bi, tz) dan `packages/db`.
  Route handler = shell: resolve actor dari klaim JWT → validasi → panggil domain.
- **Frontend:** React/Next. Two apps: `web-internal` (workspaces/boards/dashboards) and `web-client-portal` (external, **separate auth realm**, strict allow-list data layer — never a permission-trimmed internal view).
- **DB:** **Supabase/Postgres**, single schema (`public`), proyek live `CDPS SG`.
  Migrasi HANYA lewat `supabase/migrations/**` + `supabase db push` / `apply_migration`
  — **jangan pernah** `psql -f` (itulah yang melahirkan drift O38), dan jangan
  hand-edit schema. DB lokal dibangun ulang HANYA lewat `scripts/db-rebuild.sh`.
- **Penegakan aturan ada di DB, bukan cuma di TS:** transisi status ditulis
  eksklusif oleh fungsi SQL `sm_transition` (row lock + validasi edge + gate role +
  baris audit immutable, satu transaksi), RLS memikul row-scope, dan riwayat
  dilindungi trigger. Kode TS adalah pembungkus atas kontrak itu — jangan
  reimplementasi engine-nya di TS.
- **Batas camelCase↔snake_case:** domain berbicara camelCase; badan respons wire
  snake_case. Penerjemahnya `apps/api/src/lib/wire.ts` (`*ToWire`) dan itu
  **satu-satunya** tempatnya. Route yang mengirim objek domain mentah adalah bug
  kelas O43: halamannya blank walau route-nya menjawab 200. Kunci yang HILANG lebih
  berbahaya daripada null — kirim `null` eksplisit, jangan `omitempty`.
- **Integration:** existing HRIS provides `GET /employees` only (employee data sync — no auth endpoint). CDPS keeps a role-mapping table (HRIS jabatan/divisi → CDPS role). Auth is local to CDPS (password login, change-password, admin password reset) atas Supabase GoTrue. Employee deactivated in HRIS ⇒ CDPS access revoked on next sync.

## Non-negotiable house conventions (Phase 0 — enforced in code review)
1. **IDs:** `PREFIX-YYYYMM-NNNN`, generated ONLY after mandatory-field validation passes. Immutable, never reused. Prefix registry: `docs/DATA_MODEL.md`.
2. **State machines:** every lifecycle entity has an explicit transition table (`docs/STATE_MACHINES.md`). Invalid transitions are **blocked server-side** and return the specified Bahasa Indonesia message in `[...]`. No status field is ever set by raw update — only through the transition engine.
3. **Immutable history:** every transition/edit appends to an audit log (actor, action, before→after, timestamp). No UPDATE/DELETE path exists for history rows. All duration metrics derive from these timestamps.
4. **Auto-calculated fields are read-only:** ROAS, CPL, Speed Score, Health Score, commission, turnaround, all rollups — computed, never user-typed, always recomputable from the event/timestamp log.
5. **Validation messages:** Bahasa Indonesia in square brackets. Default: `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`. Use the exact strings from the PRDs.
6. **Permissions:** Phase 0 §4 Role Matrix. Staff = own data only; Lead/SPV = division-wide; OD = read-only everywhere + OKR; Director = full. OD/Director are layered roles on one employee account. Every endpoint has permission tests.
7. **IDR formatting:** `Rp. X.XXX.XXX,00`. Division-by-zero in metrics renders `—`, never an error.
8. **Notifications:** in-app only (v1), derived from the audit log, event catalog in Phase 0 v2 §9. Never deletable, only read/unread.

## Where truth lives
- `docs/prd/` — the 18 PRD files. **The PRD is the spec.** If code and PRD disagree, the PRD wins; if the PRD is ambiguous or two modules conflict, STOP and flag it in `docs/DECISIONS.md` as an open question — do not silently pick an interpretation.
- `docs/DATA_MODEL.md` — entity registry, relations, key fields.
- `docs/STATE_MACHINES.md` — consolidated transition tables (source for the transition-engine config).
- `docs/DECISIONS.md` — decision log. Any deviation from the PRD requires an entry (date, decision, reason, approved by).
- `docs/backlog/` — ticket breakdowns per wave (start with `SPRINT0_BACKLOG.md`).
- `docs/backlog/CUTOVER_BACKLOG.md` — cutover Go/MySQL → TS/Supabase. `docs/handoff/HANDOFF_CUTOVER_SESI*.md` adalah rantai handoff-nya; **baca yang bernomor tertinggi lebih dulu** untuk tahu posisi sebenarnya.

## Build order (do not jump ahead)
Sprint 0 (core engines + HRIS integration + Master Service List admin) → Wave 1: M0, M1, M4, M5 (money path) → Wave 2: M6, **M12 early**, M7, M8, M9, M10 → Wave 3: M2, M3, M11, M13, M14, M15 (Client Portal last, after security spec). No Wave-N+1 tickets before Wave-N exit criteria pass (Build Plan §4).

## Definition of Done (every ticket)
- Server-side validation + exact BI `[...]` messages.
- Permission tests per role (incl. layered OD/Director).
- Immutability test (no mutation path on history).
- Derived fields covered by recompute-from-log tests.
- Seed fixture (Alpha Digital worked example) still passes end-to-end.
- Notification events registered where the catalog requires them.

## Working style for Claude Code
- Before implementing a module, read its PRD file in `docs/prd/` fully, plus `docs/DATA_MODEL.md` and `docs/STATE_MACHINES.md` entries for its entities.
- Small PRs per Rule/Flow cluster; reference the PRD section (e.g. "M5 §5 routing gate") in commit messages.
- Never invent fields, statuses, or transitions not in the PRD. Never rename BI labels.
- Tests first for state machines and money math (commission, allocation Σ=100%, installment rollup, ROAS).
- If an external dependency is unavailable (HRIS endpoint not ready), implement behind the sync interface with a CSV-import fallback — never hardcode employee data.
- `archive/backend-go/**` adalah **arsip read-only** (C-05, 2026-09-04). Boleh dibaca sebagai rujukan riwayat; jangan tambah fitur, jangan perbaiki bug di sana, dan jangan bangunkan lagi job CI-nya. Keadaan terakhirnya pada jalur asli `backend/` ada di commit `133f717`.
- Sebelum menambah endpoint: cek `apps/api/src/lib/route-parity.test.ts`. Setiap path yang dipanggil `web-internal` wajib dilayani `apps/api`. `KNOWN_GAPS` di sana harus tetap **kosong** — menambah satu baris berarti mengakui satu halaman tidak berfungsi, dan itu butuh entri `DECISIONS.md`.
