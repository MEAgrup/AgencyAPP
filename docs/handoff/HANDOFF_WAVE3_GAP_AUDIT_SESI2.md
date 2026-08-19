# HANDOFF — Wave 3 gap-audit: M13-G1 + M14-G1 (scheduler) + M11-G3 (wire) DITUTUP — Sesi 2

> Rantai: … → HANDOFF_WAVE3_GAP_AUDIT_SESI1 (M11-G1 ditutup) → **SESI2 (ini — scheduler
> snapshot bulanan M13/M14 + omitempty wire M11-G3).** Baca yang bernomor tertinggi lebih dulu.
>
> **Status: 3 temuan Wave 3 ditutup sesi ini.** M13-G1 + M14-G1 (scheduler bulanan, #1 di
> urutan tutup) + M11-G3 (omitempty wire, #2). Berikutnya: M2-G1 / M3-G1.

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **PR SESI2** | **#189 SUDAH MERGED ke `main`** (merge commit `d333eba`). Isi SESI2 kini ada di `main`. |
| **Mulai dari mana (chat berikutnya)** | Karena #189 sudah merged, **JANGAN** tumpuk commit di atasnya — mulai fresh: `git fetch origin main && git checkout -B <branch-tujuan> origin/main`, lalu buka PR BARU. |
| **Migrasi** | **119** (NOL migrasi baru — M13/M14 murni rute API, M11-G3 murni wire+FE+test). |
| **Gate** | `tabel public` 121 · `entity_prefix` 35 / `sm_machines` 23 / `notif_events` 58 **TETAP**. |
| **Backlog audit** | `docs/backlog/WAVE3_GAP_AUDIT.md` (STATUS SESI 2 + 3 temuan ditandai ✅). |
| **Keputusan** | `docs/DECISIONS.md` **2026-08-19** baris teratas ("Wave 3 gap-audit SESI2"). |

> **CI #189 saat merge:** api / web-internal / core-engines / db-and-migrations / backend semua ✅ (Go oracle hijau — diff tak menyentuh `backend/`). Nol konflik, single commit.

### 0.1 Aturan main (tak berubah) — CLAUDE.md + SESI1 §0.1
- Tes domain WAJIB serial (`--no-file-parallelism`); `npm ci` sebelum test; rebuild DB setelah migrasi baru.
- Wire snake_case lewat `apps/api/src/lib/wire.ts`; `null` eksplisit (bukan omitempty).
- `route-parity` `KNOWN_GAPS` **tetap kosong**.
- `backend/**` = oracle paritas read-only; jangan tambah fitur di sana.

### 0.2 Setup di container baru
```bash
service postgresql start
su postgres -c "psql -d postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm ci
bash scripts/db-rebuild.sh --yes                # 'tabel public 121'
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
( cd apps/api && npx vitest run --no-file-parallelism )   # 359 hijau
```

---

## 1. Yang SELESAI sesi ini (jangan ulang)

### 1.1 Keputusan pemilik — mekanisme cron (via AskUserQuestion)
- **Pattern A: HTTP tick ber-shared-secret + cron eksternal** (BUKAN pg_cron Supabase, BUKAN
  manual-only). Alasan: konsisten dengan 2 scheduler yang sudah ada (`internal/plan/tick`,
  `internal/penugasan/tick`), route bisa dites tanpa scheduler hidup, provider-agnostic.
- **Wiring provider cron (Vercel Cron / GitHub Action) DITUNDA** persis seperti plan/tick —
  route dulu, provider di-wire saat deploy. (plan/tick pun belum punya cron ter-wire di repo.)

### 1.2 M13-G1 + M14-G1 — scheduler snapshot bulanan — DITUTUP
`health.runSnapshotJob`/`performance.runSnapshotJob` sudah benar + idempotent + murni terhadap
jam, tapi satu-satunya entry adalah POST manual Director (`snapshots/scan`). Tanpa trigger
otomatis: dashboard band kosong + trend berlubang permanen. **Fix — 2 rute BARU**, meniru
`internal/plan/tick`/`penugasan/tick`:
```
POST /api/v1/internal/health/tick        → health.runSnapshotJob(db(), when)
POST /api/v1/internal/performance/tick   → performance.runSnapshotJob(db(), when)
```
- Gate secret **`PLAN_TICK_SECRET`** header `x-plan-tick-secret` — **di-REUSE** (bukan kredensial
  sistem kedua; preseden eksplisit `penugasan/tick`). **Unset ⇒ CLOSED** (401), tak pernah open.
- Body opsional `{ "waktu": "<RFC3339>" }` override "now" untuk backfill/test; default jam dinding.
- Route = shell tipis (nol logika domain baru). Job idempoten ⇒ double-call no-op.
- **Nol web-internal caller by design** (cron satu-satunya klien; route-parity FE→API tak
  menuntut sebaliknya — `KNOWN_GAPS` tetap kosong).
- **Tes:** 4+4 secret-gate (tolak sebelum sentuh DB, nol DATABASE_URL), meniru `plan/tick/route.test.ts`.

### 1.3 M11-G3 — omitempty wire → null eksplisit — DITUTUP
`cardToWire`/`dependencyToWire` (`wire.ts`) memakai `...(cond ? {k} : {})` untuk
`pic`/`due_date`/`dependency_badge`/`created_at`/`note` — kelas O43 (kunci hilang = halaman blank).
**Fix (preseden `installmentToWire`):**
- `CardWire`/`DependencyWire`: field-field itu → `string | null`; mapper emit `cond ? v : null`.
- FE mirror `web-internal/src/lib/board.ts` `Card`/`Dependency` → `string | null` (drop `?`).
- 2 tes `wire.delivery.test.ts` yang meng-assert **absence** kunci → assert **null eksplisit**.
- Shape-parity tetap seimbang (membandingkan SET kunci, strip `?`). Risiko laten (belum ada FE `/board`).

### 1.4 Berkas berubah
```
BARU  apps/api/src/app/api/v1/internal/health/tick/route.ts          (+ route.test.ts)
BARU  apps/api/src/app/api/v1/internal/performance/tick/route.ts     (+ route.test.ts)
EDIT  apps/api/src/lib/wire.ts                 (cardToWire/dependencyToWire → null eksplisit)
EDIT  apps/api/src/lib/wire.delivery.test.ts   (2 tes: absence → null eksplisit)
EDIT  web-internal/src/lib/board.ts            (Card/Dependency → string | null)
EDIT  docs/backlog/WAVE3_GAP_AUDIT.md          (STATUS SESI 2 + 3 temuan ✅)
EDIT  docs/DECISIONS.md                        (baris teratas 2026-08-19 SESI2)
BARU  docs/handoff/HANDOFF_WAVE3_GAP_AUDIT_SESI2.md (ini)
```

## 2. Verifikasi
- **api 359 hijau** (21 file — termasuk 8 tick secret-gate + wire.delivery 44 + shape-parity 11 + route-parity 5).
- domain health **17** + performance **27** hijau (domain TAK berubah — sanity).
- typecheck api bersih; web-internal bersih **selain** error `xlsx` pra-ada di `riset-awal.ts` (bukan dari sesi ini).
- `db-rebuild.sh --yes`: 121 tabel + semua gate + 4 invariant hijau; **nol migrasi baru**.

## 3. BERIKUTNYA — urutan tutup (WAVE3_GAP_AUDIT.md §"Urutan tutup")
1. ✅ M13-G1 + M14-G1 (sesi 2) · ✅ M11-G3 (sesi 2).
2. **M2-G1 / M3-G1** — requirement produk PRD (compare-across-staff dashboard metrics; per-campaign
   client list + service-status drill-down). ← **BERIKUTNYA.**
3. Sisa B kecil (M2-G3/G5/G6, M3-G2/G3/G4, M15-G1/G2).
4. C OPEN → log keputusan / tes.
5. **Client Portal (M15 C-cluster) TERAKHIR** — diblokir O4+O5, ditunda pemilik. Jangan mulai.

### Catatan operasional (deploy)
Rute tick sudah ADA tapi **belum ada cron yang memanggilnya** (sama seperti plan/tick). Saat deploy,
pemilik/head dev perlu: (1) set env `PLAN_TICK_SECRET`, (2) pasang cron bulanan (Vercel Cron `vercel.json`
ATAU GitHub Action `schedule`) yang `POST` ke `/api/v1/internal/{health,performance}/tick` dengan header
`x-plan-tick-secret`. Idempoten ⇒ aman kalau ke-trigger lebih dari sekali.

## 4. Sumber kebenaran
- `docs/backlog/WAVE3_GAP_AUDIT.md` — semua temuan + status + urutan.
- `docs/DECISIONS.md` 2026-08-19 (SESI2 + SESI1 M11-G1).
- Kode: `apps/api/src/app/api/v1/internal/{health,performance}/tick/route.ts`, `apps/api/src/lib/wire.ts`,
  `web-internal/src/lib/board.ts`. Preseden: `internal/plan/tick`, `penugasan/tick`, `installmentToWire`.
- PRD `docs/prd/CDPS_Module{13,14,11}_*.md`.
