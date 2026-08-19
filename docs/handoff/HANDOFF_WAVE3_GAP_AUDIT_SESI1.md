# HANDOFF — Wave 3 gap-audit DIBUKA; M11-G1 (Severity A) DITUTUP — Sesi 1

> Rantai: … → HANDOFF_WAVE2_GAP_AUDIT_SESI46 (Wave 2 tutup) → **SESI1 Wave 3 (ini —
> gap-audit 6 modul + fix M11-G1 gate roll-up).** Baca yang bernomor tertinggi lebih dulu.
>
> **Status: Wave 3 gap-audit DIBUKA.** Modul Wave 3 (M2/M3/M11/M13/M14/M15) sudah di-port
> saat cutover tapi belum pernah gap-audit PRD-vs-implementasi. Sesi ini menjalankan audit
> itu (6 audit paralel), menulis backlognya, dan menutup satu-satunya temuan Severity-A.

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/wave-3-handoff-lanjutan-thc14e` (dari `main` setelah #186 C1 merged). |
| **Migrasi** | **119** (NOL migrasi baru — M11-G1 murni domain: 2 file src + 1 file test). |
| **Gate** | `tabel public` 121 · `entity_prefix` 35 / `sm_machines` 23 / `notif_events` 58 **TETAP**. |
| **Backlog audit** | `docs/backlog/WAVE3_GAP_AUDIT.md` (BARU — semua temuan + urutan tutup). |
| **Keputusan** | `docs/DECISIONS.md` **2026-08-19** baris teratas ("Wave 3 gap-audit DIBUKA + M11-G1"). |

### 0.1 Aturan main (tak berubah) — CLAUDE.md + SESI44/45 §0.1
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
( cd packages/domain && npx vitest run src/board.test.ts src/task.test.ts src/kol.test.ts src/creative.test.ts --no-file-parallelism )  # 88 hijau
```

---

## 1. Yang SELESAI sesi ini (jangan ulang)

### 1.1 Audit Wave 3 (6 modul) → `docs/backlog/WAVE3_GAP_AUDIT.md`
Verdict ringkas: semua modul port **faithful**; **satu** Severity-A (M11-G1, ditutup).
Sisanya B/C. Highlight:
- **M13-G1 + M14-G1 (kandidat berikut, sistemik):** snapshot bulanan Health & Team-Perf
  **tak punya scheduler** — hanya jalan via POST Director manual. Tanpa cron, dashboard band
  kosong + trend berlubang permanen (tanpa backfill). Fix: rute `internal/{health,performance}/tick`
  (pola `internal/plan/tick`, shared-secret) + cron eksternal. **Butuh 1 keputusan pemilik**
  soal mekanisme cron (Vercel Cron / GitHub Action) — bawa ke Nerissa/head dev.
- **M3 linkage WRITE ternyata SUDAH ada** (kekhawatiran WAVE3_PLAN W3-M3-C2 basi).
- **M15 Client Portal** tetap diblokir O4+O5 + ditunda pemilik — jangan mulai.

### 1.2 M11-G1 — gate roll-up DEFER (Severity A) — DITUTUP
**Bug.** `board.validateBriefApproval` (throw `board.ConflictError`) dipanggil telanjang di
**dua** roll-up caller — `task.ts recomputeBriefRollup` (Creative/M12) & `kol.ts
recomputeBriefRollup` (KOL/M9). Tak ada try/catch ⇒ exception keluar dari roll-up ⇒
`withTransaction` rollback **semua**, termasuk transisi child pemicu. Approve Asset/Booking
**terakhir** dari Brief yang jadi Target Blocking-Dependency (Source belum `[Approved]`)
**gagal total**. Melanggar §2 Rule 7, menyimpang Go oracle (`errors.As(BlockedError)→return
nil`), membalik keputusan W3-M11-C1.

**Fix (2 file src).** Tangkap kelas board & DEFER:
```ts
import { ConflictError as BoardConflictError, onBriefReachedTerminal, validateBriefApproval } from './board';
// ...
if (to === STATUS_APPROVED) {
  try { await validateBriefApproval(tx, briefId); }
  catch (e) { if (e instanceof BoardConflictError) return; throw e; }
}
```
Jalur AM eksplisit `account.ts driveReviewEdge`/`approveBrief` **TETAP throw** (benar — AM
harus lihat gate). **JEBAKAN:** `task.ts`/`kol.ts` punya `ConflictError` LOKAL sendiri
(TaskConflictError/KolConflictError) — `e instanceof ConflictError` lokal TIDAK menangkap
error board. Wajib import `ConflictError as BoardConflictError` dari `./board`.

**Tes (M11-G2).** `board.test.ts` describe "Blocking gate DEFERS on the roll-up path":
Creative (`creative.approveAsset`) + KOL (`kol.passQC`). Assert child commit + Brief parkir
`[In Review]` + pemulihan. **Diverifikasi gagal tanpa fix** (git stash src → 2 test merah
dengan `BoardConflictError`), lalu hijau dengan fix.

### 1.3 Berkas berubah
```
EDIT  packages/domain/src/task.ts          (import BoardConflictError + defer di recomputeBriefRollup)
EDIT  packages/domain/src/kol.ts           (idem)
EDIT  packages/domain/src/board.test.ts    (+2 defer test + helper assetStatus/bookingStatus + import creative,kol)
BARU  docs/backlog/WAVE3_GAP_AUDIT.md       (backlog audit Wave 3)
EDIT  docs/DECISIONS.md                      (baris teratas 2026-08-19)
BARU  docs/handoff/HANDOFF_WAVE3_GAP_AUDIT_SESI1.md (ini)
```

## 2. Verifikasi
- board 18 · task 19 · kol 23 · creative 28 = **88 hijau**; 6 suite Wave 3 = **102 hijau**.
- Full domain suite serial: (lihat commit / CI — dijalankan sebelum push).
- typecheck domain bersih selain TS5101 baseUrl (pra-ada, tsconfig-level).
- `db-rebuild.sh --yes`: 121 tabel + semua gate + 4 invariant hijau; nol migrasi baru.

## 3. BERIKUTNYA — urutan tutup (lihat WAVE3_GAP_AUDIT.md §"Urutan tutup")

1. **M13-G1 + M14-G1 (scheduler bulanan)** — sistemik, satu pola. **Butuh keputusan pemilik**
   mekanisme cron dulu. Nyalakan exit-criteria Wave 3.
2. **M11-G3** (omitempty di `wire.ts cardToWire/dependencyToWire`) — house-rule non-negotiable.
3. **M2-G1** (owner di dashboard metrics) / **M3-G1** (per-campaign won-client list).
4. Sisa B kecil (M2-G3/G5/G6, M3-G2/G3/G4, M15-G1/G2).
5. C OPEN → log keputusan / tes.
6. **Client Portal (M15 C-cluster) TERAKHIR** — diblokir O4+O5, ditunda pemilik. Jangan mulai.

## 4. Sumber kebenaran
- `docs/backlog/WAVE3_GAP_AUDIT.md` — semua temuan + status + urutan.
- `docs/DECISIONS.md` 2026-08-19 (M11-G1) + W3-M11-C1 (2026-07-17, keputusan defer asli).
- Kode fix: `packages/domain/src/{task,kol}.ts` (`recomputeBriefRollup`), `board.test.ts`.
- `docs/prd/CDPS_Module11_PM_Kanban.md` §2 Rule 7; Go oracle `backend/internal/module{12_task,9_kol}/rollup.go`.
