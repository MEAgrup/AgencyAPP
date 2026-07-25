# HANDOFF — Wave 3 Port (M11 PM/Kanban + Dependency gate selesai; lanjut M3/M2 → M13 → M14 → M15)

> Sesi ini mem-**port** modul **M11 (Project Management / Kanban)** dari **Go source-of-truth**
> (`backend/internal/module11_board/{board,views,gate}.go`) ke **stack Fase 1 (Next/Supabase)**
> di `packages/domain/src/dependency.ts` + `apps/api`. Semua hijau, sudah di-commit & di-push.
> Melanjutkan seri port Wave 2/3 (lihat `HANDOFF_WAVE2_PORT_M6_M12_M7_M8_M9.md`).

---

## §0 — Mulai baca dari mana (urutan)

1. `CLAUDE.md` (root) — house rules non-negotiable (ID `PREFIX-YYYYMM-NNNN`, state machine
   server-side, immutable audit, derived fields, pesan BI `[...]`, IDR format, permission matrix).
2. **Handoff Wave-2 Port** `docs/handoff/HANDOFF_WAVE2_PORT_M6_M12_M7_M8_M9.md` — §3 arsitektur port,
   §4 pola 6-langkah, §7 resep verifikasi, §8 gotcha. **Masih 100% berlaku.**
3. **Handoff ini** (§1–§8) untuk delta M11 + task berikutnya.
4. `docs/handoff/WAVE3_PLAN.md` — urutan klaster Wave 3 & titik keputusan manusia (O4/O5/O9).
5. PRD modul berikutnya di `docs/prd/` + Go source `backend/internal/module<N>_*/*.go`.

---

## §1 — State saat ini

- **Repo:** `MEAgrup/AgencyAPP`
- **Branch:** `claude/port-m11-pm-kanban-dep-vt8ty8` — **pushed**, base = `806a91c`
  ("Merge PR #42: Wave 2 port"). Commit port: **`a3d538f`**.
- **PR:** belum dibuka (tidak diminta). Buka bila diperlukan.
- **⚠️ Stacking:** `806a91c` (base branch ini, = konten PR #42) **belum termerge ke `origin/main`**
  (origin/main masih di `ab8a3ee`, titik Fase-1). PR #42/#43(M10)/#44(M7 daily-output) semuanya
  masih open & stacked. Branch M11 ini sejajar dgn #43/#44 (base sama `806a91c`). Orchestrator
  yang mengatur urutan merge. Bila `origin/main` sudah maju saat kamu mulai: **rebase** branch
  lanjutan ke base terbaru (jangan tumpuk di atas history yang sudah termerge).
- **Verifikasi terakhir (fresh Postgres):** `@cdps/domain` **20 test M11** hijau (307/308 suite
  penuh — 1 gagal PRA-ADA di `finance.test.ts`, lihat §6), `@cdps/api` **82 test** hijau (incl.
  wire mapper baru), typecheck `@cdps/domain` + `@cdps/api` bersih.

---

## §2 — Apa yang di-port sesi ini (M11)

| Item | File | Isi |
|---|---|---|
| **Dependency (DEP-)** | `packages/domain/src/dependency.ts` | `createDependency` — validasi server-side SEBELUM mint id (same-Client §2 Rule 4, no-duplicate-pair, **no-cycle BFS** §2 Rule 6, tipe/entity valid, self-ref); audit immutable; **tanpa jalur cancel** (v1). `getDependency`/`listDependencies`. Status **derived** (Pending/Blocking/Satisfied §5.1) — tak pernah disimpan. |
| **Read-models** | idem | `clientBoard` (§5.3) + `myTasks` (§5.4) + pemetaan **Universal Column** (§5.2) lintas Brief/Asset/Booking/Session. Semua derived on read. |
| **Gate blocking** | idem (`validateBriefApproval`) | Kunci transisi final Brief `[In Review]→[Approved]` selama Source Blocking belum terminal. Pesan template STATE_MACHINES §12. |
| **Emisi** | idem (`onBriefReachedTerminal`) | `EvDependencySatisfied` fire-once per dependency (`satisfied_notified_at`) ke PIC Target Brief. |
| **Wiring** | `account.ts` `driveReviewEdge`; `task.ts` `recomputeBriefRollup` | lihat §3. |
| **API** | `apps/api/src/app/api/v1/{dependencies,dependencies/[id],board,my-tasks}/route.ts` | mirror path Go `routes_board.go`. Query: `?source=&target=` (list), `?client=` (board), `?employee=` (my-tasks). |
| **Wire + error** | `apps/api/src/lib/wire.ts` (`dependencyToWire`,`cardToWire`) + `wire.test.ts`; `http.ts` | error class M11 → status. |

Diexport: `export * as dependency from './dependency'` di `packages/domain/src/index.ts`.

---

## §3 — KRUX PORT M11: wiring gate+emisi TANPA engine hook (baca!)

Stack TS **tidak punya** engine `onTransition` hook (di Go, `httpapi.onTransition` yang memanggil
guard+emisi). Jadi keduanya **diinject inline** pada tiap jalur yang menggerakkan Brief `→[Approved]`.
Untuk hindari import cycle: **`dependency.ts` TIDAK meng-import apa pun dari `account`/`task`**
(gate-nya baca DB langsung). `account`/`task` yang meng-import dari `dependency` — bukan sebaliknya.

Dua jalur `→[Approved]` dan perilaku gate-nya **BERBEDA** (ini bukan bug, sudah dicocokkan 1:1
dengan Go + DECISIONS W3-M11-C1):

1. **`account.approveBrief`** (jalur AM single-unit, `driveReviewEdge`): guard **melempar**
   `dependency.BlockedError` ke caller (transaksi rollback, tak ada perubahan). Route → 409.
2. **`task.recomputeBriefRollup`** (jalur roll-up Creative/Asset): guard **DEFER diam** — pada
   `BlockedError` di-`catch` lalu `return` (walk berhenti; Brief tetap `[In Review]`; transisi
   Asset pemicu **tetap commit** §2 Rule 7). Error non-Blocked tetap dilempar. Cocok
   `backend/internal/module12_task/rollup.go` (`return nil` pada BlockedError).

Emisi (`onBriefReachedTerminal`) dipanggil di kedua jalur **setelah** Brief benar-benar sampai
`[Approved]`, dalam transaksi yang sama (fire-once via `satisfied_notified_at` + row lock).

> ⚠️ Kalau kamu pikir gate roll-up "harusnya" melempar seperti jalur AM — JANGAN. Perbedaan
> propagate vs silent-defer itu disengaja (worked example §Rule 7: transisi Asset pemicu tak boleh
> ikut hangus). Ada test khusus untuk ini: *"roll-up path defers silently"* di `dependency.test.ts`.

Deferral tercatat (edge, non-blocking): Brief Live Stream ditutup lewat **aksi off-machine** (§10,
`ls_brief_reconciled`, TIDAK lewat engine) ⇒ emisi utk source LS belum ter-cover. Sama seperti Go.

---

## §4 — TASK BERIKUTNYA: lanjut port Wave 3

Modul Go yang **BELUM** di-port ke `packages/domain`:
`module2_marketing` (M2), `module3_campaign` (M3), `module13_health` (M13),
`module14_performance` (M14), `module15_portal` (M15).
(M10 livestream = PR #43 open; M7 daily-output = PR #44 open — belum di-merge ke main, jadi belum
ada di `index.ts` base branch ini. Bila sudah termerge, tarik dulu.)

**Urutan rekomendasi (dependensi, per `WAVE3_PLAN.md`):**
**M3 core → M3 linkage (M1/M0) → M2 metrics → M13 → M14 → M15 (Team Portal dulu, Client Portal
PALING AKHIR, DIBLOKIR O5/O4).** Alasan: M2 record 1:1 nempel Campaign; M13/M14 baca hasil
M2/M3 + Wave 2; M15 mengagregasi semua.

Mulai konkret (contoh M3):
```bash
cd /home/user/AgencyAPP
wc -l backend/internal/module3_campaign/*.go
sed -n '1,30p' backend/internal/module3_campaign/campaign.go        # header dokumentasi interpretasi
grep -nE "MCampaign|'campaign" backend/internal/core/statemachine/config.go supabase/migrations/20260102000002_statemachine.sql
grep -n "HandleFunc" backend/internal/httpapi/routes_campaign.go    # path route
ls supabase/migrations/ | grep -i campaign                          # migrasi tabel sudah ada?
```
Lalu ikuti **pola 6-langkah §4 handoff Wave-2**. Template terdekat: `sales.ts`/`leads.ts` (M0/M1,
banyak read + linkage), `dependency.ts` (read-model derived + wiring lintas modul).

---

## §5 — Environment (⚠️ ephemeral — rebuild tiap container baru)

Node modules & Postgres **tidak persist**. Bootstrap:
```bash
cd /home/user/AgencyAPP
npm install                                             # node_modules TIDAK persist — WAJIB dulu

# Postgres (cluster di /tmp, port 5433, trust auth):
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/cdps_pgdata -o "-p 5433 -k /tmp" -l /tmp/pg_run.log start
# kalau cluster hilang total:
#   sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /tmp/cdps_pgdata
#   (start), lalu psql "postgres://postgres@localhost:5433/postgres" -c "create database cdps;"
#   for f in supabase/migrations/*.sql; do psql "postgres://postgres@localhost:5433/cdps" -f "$f" || break; done

export DATABASE_URL="postgres://postgres@localhost:5433/cdps"
npx vitest run <file>.test.ts --root packages/domain   # test integrasi (skip otomatis tanpa URL)
npx tsc -p packages/domain/tsconfig.json --noEmit      # typecheck (tanpa DB); base tsconfig sudah
npx tsc -p apps/api/tsconfig.json --noEmit             #   set ignoreDeprecations — jalankan polos
```
> Cluster **sering mati** antar-panggilan (connection refused / "20 failed" mendadak). Cek & restart
> dulu sebelum menyimpulkan ada bug: `psql "$DATABASE_URL" -c "select 1"` gagal ⇒ `pg_ctl ... start`.

---

## §6 — Kegagalan PRA-ADA (BUKAN tugasmu) & deferral

1. **`finance.test.ts` → `scanReminders … idempotent`** GAGAL ("expected 8 to be 2") **hanya saat
   suite penuh dijalankan bareng** (akumulasi installment lintas file), **lolos saat diisolasi**.
   Independen dari M11 — diverifikasi sejak handoff sebelumnya. **Biarkan** kecuali diminta.
2. **Status HTTP validasi = 400** di port TS (Go pakai 422). Ini konvensi port TS yang sudah baku
   lintas modul (`http.ts` komentar "validation → 400") — bukan deviasi baru, bukan bug.
3. **Backlog port:** M2, M3, M13, M14, M15 (§4). M10/M7-daily = PR open (#43/#44).
4. **FE re-pointing** `web-internal` (bentuk transisi Go-era `{From,To}` → Fase-1 `{ok,from,to}`)
   masih backlog lintas modul (lihat handoff Wave-2 §6).

---

## §7 — Gotcha spesifik M11 (tambahan atas §8 handoff Wave-2)

1. **No import cycle:** `dependency.ts` murni `@cdps/core` + `@cdps/db`. Jangan import `account`/
   `task` ke dalamnya — nanti cycle (`task → dependency → task`). Literal status di views dibuat
   inline (persis views.go), bukan import dari `task.ts`.
2. **Gate propagate vs silent-defer** — §3. Test `dependency.test.ts` "roll-up path defers silently"
   menjaga ini; jangan longgar.
3. **`BlockedError`** = class domain M11 (mirror Go `statemachine.BlockedError`). Dipetakan ke **409**
   di `http.ts`. Emisi event `m11.dependency.satisfied` sudah di katalog FROZEN (resolver `explicit`)
   — tak perlu registrasi baru.
4. **Recipient `explicit`** tak butuh baris `employees` riil (notify_emit hanya `unnest` array).
5. **`wire.ts` di-reformat linter** saat diedit (whitespace/reflow) — normal, jangan di-revert.
6. **Test gate memakai `setBriefStatus` (raw SQL) untuk parkir Brief di `[In Review]`** — shortcut
   setup yang sama dipakai `board_test.go` Go; fokus test ada di edge approve, bukan jalur submit
   (jalur submit Ads kena guard M8 campaign-complete yang di luar scope M11).

---

## §8 — Berkas yang berubah sesi ini

```
BARU   packages/domain/src/dependency.ts            (port board+views+gate)
BARU   packages/domain/src/dependency.test.ts       (20 test: 8 unit + 12 integrasi)
BARU   apps/api/src/app/api/v1/dependencies/route.ts
BARU   apps/api/src/app/api/v1/dependencies/[id]/route.ts
BARU   apps/api/src/app/api/v1/board/route.ts
BARU   apps/api/src/app/api/v1/my-tasks/route.ts
EDIT   packages/domain/src/index.ts                 (export dependency)
EDIT   packages/domain/src/account.ts               (wiring guard-propagate + emisi di approveBrief)
EDIT   packages/domain/src/task.ts                  (wiring guard-silent-defer + emisi di recomputeBriefRollup)
EDIT   apps/api/src/lib/http.ts                      (map error M11: 400/403/404/409)
EDIT   apps/api/src/lib/wire.ts                      (dependencyToWire, cardToWire)
EDIT   apps/api/src/lib/wire.test.ts                 (test 2 mapper)
```

### Ringkas 1 baris
> M11 (Dependency + gate blocking + Client Board + My Tasks) **selesai di-port & hijau** di branch
> `claude/port-m11-pm-kanban-dep-vt8ty8` (commit `a3d538f`). Lanjut = port **M3 → M2 → M13 → M14 →
> M15** (Client Portal terakhir, diblokir O5/O4) ikut `WAVE3_PLAN.md` + pola 6-langkah handoff Wave-2;
> `npm install` + start Postgres dulu (§5); waspada gate propagate-vs-silent-defer (§3) & kegagalan
> finance pra-ada (§6).
