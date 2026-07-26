# HANDOFF — Wave 3 Port (M13 Client Health selesai; lanjut M14 → M15)

> Sesi ini mem-**port** modul **M13 (Client Health Report)** dari **Go source-of-truth**
> (`backend/internal/module13_health/{health,compute,roas,service,snapshot}.go`) ke **stack
> Fase 1 (Next/Supabase)** di `packages/domain/src/health.ts` + `apps/api`. Semua hijau di DB
> fresh, di-commit & di-push. Melanjutkan seri port Wave 2/3 (lihat
> `HANDOFF_WAVE2_PORT_M6_M12_M7_M8_M9.md`, `HANDOFF_WAVE3_PORT_M11.md`,
> `HANDOFF_WAVE3_PORT_M3.md`, `HANDOFF_WAVE3_PORT_M2.md`).

---

## §0 — Mulai baca dari mana
1. `CLAUDE.md` (root) — house rules non-negotiable.
2. `docs/handoff/HANDOFF_WAVE2_PORT_M6_M12_M7_M8_M9.md` — §3 arsitektur, §4 pola 6-langkah, §7 verifikasi, §8 gotcha. **Masih berlaku.**
3. **Handoff ini** (§1–§7) untuk delta M13 + task berikutnya.
4. `docs/handoff/WAVE3_PLAN.md` — urutan klaster & titik keputusan (O4/O5/O9).

---

## §1 — State saat ini
- **Repo:** `MEAgrup/AgencyAPP`. **Branch:** `claude/port-m13-health` — **pushed**, base = `806a91c` (= `main` di GitHub). Commit port: **`643cd88`**.
- **PR:** #48 (M13 → main) — lihat §7 (dibuka bila diminta/sudah dibuka sesi ini).
- **Seri port terbuka (semua base `main`=`806a91c`):** #43 M10, #44 M7-daily, #45 M11, #46 M3, #47 M2 (stacked on #46), + M13. Semua branch sibling dari `main`; **M13 independen** (tidak stacked — tidak mengimpor M11/M3/M2).
- **Verifikasi (DB FRESH):** `@cdps/domain` **302/302** (incl. M13 14 test), `@cdps/api` **82/82**, typecheck domain+api bersih.
  > Catatan: di branch ini domain punya 15 file test (base Wave-2 + health). M11/M3/M2 test ada di branch masing-masing.

---

## §2 — Apa yang di-port sesi ini (M13)
`packages/domain/src/health.ts` (namespace `health`, export di `index.ts`):

| Bagian | Isi |
|---|---|
| **Pure scoring** (`score`, `bandFor`, `bandRank`) | 7 komponen (§2 Rule 2), bobot confirmed (Rule 3), **redistribusi proporsional** komponen hilang (Rule 4), cap 0–100 (Rule 5/6), band (Rule 7); all-excluded → score `null` render "—". Unit-testable tanpa DB. |
| **Gatherers** (compute.go) | GMV Growth (+grace Rule 8), ROAS Attainment (+toggle Rule 13, **reuse `ads.parseRoasTarget`**), Task Completion + Revision Burden (**reuse `task.computeMetrics`** recompute-from-log), Complaints (severity penalty), Payment Timeliness (installment pernah `[Jatuh Tempo]` dari audit log), Satisfaction **selalu N/A** (Module 15 belum ada). |
| **Snapshot** (§5) | `runSnapshotJob`/`runScan` — sweep bulan CLOSED terakhir (WIB), 1 CHR- immutable per Client, **fire-once** via `UNIQUE(client_id, period_start)` + row-lock; band-drop (Rule 12) emit `EvClientBandDrop` sekali ke Account SPV dalam tx yang sama; `trend` (Rule 9), `preview` (Rule 10, tak disimpan), `getSnapshot` by period. |
| **ROAS toggle** (Rule 13/§5.4) | `getRoasToggle`/`setRoasToggle` (AM own-book / lead / Director; OD read-only), audit before→after; N/A struktural tanpa layanan Ads. |
| **Gates** (§Rule 11) | `canView`/`canScope`/`canRunScan`/`canToggleRoas`. |

- **API:** `POST /api/v1/health/snapshots/scan`; `GET /api/v1/clients/{id}/health[?period=YYYYMM]`, `/health/trend`, `/health/preview`; `GET|PUT /api/v1/clients/{id}/health/roas-toggle`.
- **wire.ts:** `healthSnapshotToWire`, `roasToggleToWire`, `healthScanResultToWire`. **http.ts:** `health.NotFoundError`→404, `ForbiddenError`/`ScanForbiddenError`→403.
- **Cross-module (acyclic):** `health → {ads, task}` (import langsung; keduanya tak import balik).

---

## §3 — GOTCHA PENTING sesi ini (baca sebelum lanjut)

1. **`client_health_snapshots` = append-only (no-DELETE + no-UPDATE trigger) DAN punya FK keras `fk_chr_client` → `clients`.** Akibatnya: snapshot tak bisa dihapus, dan client yang punya snapshot tak bisa dihapus. Kalau dibiarkan, client "abadi" milik test M13 akan **meledakkan cleanup file test lain** yang pakai `delete from clients where created_by like 'ZZ-%'` (FK violation).
   - **Solusi di `health.test.ts` afterEach:** `sql.begin` + `set local session_replication_role = replica` (test connect sebagai superuser `postgres`) → menonaktifkan trigger + FK dalam tx, lalu hapus snapshot + clients + tabel terkait bersih. **Pola ini WAJIB dipakai modul lain yang bikin enttitas append-only ber-FK (mis. M14 snapshots).**
2. **`ident_next(prefix, at)` bucket by WIB month** (`wib_period` = `+7h` lalu YYYYMM). Untuk CHR- (bucket = bulan PERIODE), pass `per.startUTC` (instant UTC dari WIB midnight awal bulan) — sudah benar di kode.
3. **Validasi jujur di DB FRESH.** DB dev terakumulasi (audit_log/snapshot append-only) bikin test count-based & `finance.scanReminders` gagal palsu. Selalu buat DB baru (`cdps_vN`) + apply semua migrasi sebelum menyimpulkan.
4. **`ads.parseRoasTarget` & `task.computeMetrics`** sudah ada & dipakai ulang — jangan duplikasi math ROAS/Speed-Score.

---

## §4 — TASK BERIKUTNYA: **M14 (Team Performance)**
Per `WAVE3_PLAN.md`: M3 → M2 → M13 → **M14 → M15** (Client Portal TERAKHIR, diblokir O5/O4).
M13 selesai. Berikutnya **M14 Team Performance**.

Go source: `backend/internal/module14_performance/*.go`. Isi (W3-M14-C1): KPI profile per role
(bobot admin-configurable), Client-Outcome Modifier, snapshot bulanan, emit `EvPerformancePublished`
→ tiap staff (event SUDAH di katalog FROZEN). **O9** (target periode riil) masih terbuka — bangun
dengan target configurable + seed placeholder. Migrasi tabel: cek `0036_team_performance.sql` (sudah ada).

Mulai konkret:
```bash
cd /home/user/AgencyAPP
wc -l backend/internal/module14_performance/*.go
sed -n '1,30p' backend/internal/module14_performance/*.go
grep -n "PerformancePublished" packages/core/src/notification.ts
grep -n "HandleFunc" backend/internal/httpapi/*performance*.go
ls supabase/migrations/ | grep -i performance
```
Ikuti **pola 6-langkah** handoff Wave-2. Template terdekat: `health.ts` (snapshot bulanan +
recompute-from-log + emisi + append-only cleanup pattern §3.1). Branch baru
`claude/port-m14-performance` dari `main` (atau dari branch M13 bila M14 mengimpor `health` —
cek import Go dulu).

Setelah M14: **M15 Portal** — Team Portal dulu (W3-M15-C1, boleh paralel), **Client Portal
(W3-M15-C2) PALING AKHIR & DIBLOKIR O5 (security spec) + O4 (embeddability)** — jangan mulai C2
sebelum keduanya jelas.

---

## §5 — Environment (⚠️ ephemeral)
```bash
cd /home/user/AgencyAPP
npm install                                             # node_modules TIDAK persist
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/cdps_pgdata -o "-p 5433 -k /tmp" -l /tmp/pg_run.log start
psql "postgres://postgres@localhost:5433/postgres" -c "create database cdps_v6;"   # DB FRESH
for f in supabase/migrations/*.sql; do psql "postgres://postgres@localhost:5433/cdps_v6" -f "$f" || break; done
export DATABASE_URL="postgres://postgres@localhost:5433/cdps_v6"
npx vitest run <file>.test.ts --root packages/domain
npx tsc -p packages/domain/tsconfig.json --noEmit ; npx tsc -p apps/api/tsconfig.json --noEmit
```
> ⚠️ Postgres cluster sering mati (connection refused) — cek `psql "$DATABASE_URL" -c "select 1"` & restart.
> ⚠️ Classifier exec-safety sempat outage (memblok `npx`/MCP; `git`/`echo` jalan) — transient, tunggu & ulangi.

---

## §6 — Kegagalan PRA-ADA & catatan
1. **`finance.test.ts scanReminders idempotent`** gagal HANYA di DB terakumulasi; **lulus di DB fresh**. Bukan tugasmu.
2. **Status HTTP validasi = 400** (Go 422) — konvensi port TS baku.
3. **Backlog port:** M14, M15. Semua modul lain (M2/M3/M11/M13, + M10/M7-daily) = PR/branch open, belum merge ke `main`.
4. **Linkage WRITE** (`leads.origin/last_touch_campaign_id`, `clients.origin_campaign_id`) masih deferred (W3-M3-C2) — read-only rollups membacanya; tidak memengaruhi M13.

---

## §7 — Berkas berubah sesi ini
```
BARU   packages/domain/src/health.ts                 (port health+compute+roas+service+snapshot)
BARU   packages/domain/src/health.test.ts            (14 test: 5 unit + 9 integrasi)
BARU   apps/api/src/app/api/v1/health/snapshots/scan/route.ts
BARU   apps/api/src/app/api/v1/clients/[id]/health/{route,trend,preview,roas-toggle}
EDIT   packages/domain/src/index.ts                  (export health)
EDIT   apps/api/src/lib/http.ts                       (map error M13: 403/404)
EDIT   apps/api/src/lib/wire.ts                       (healthSnapshotToWire, roasToggleToWire, healthScanResultToWire)
EDIT   apps/api/src/lib/wire.test.ts                 (test 3 mapper)
```

### Ringkas 1 baris
> M13 (Client Health: scoring 7-komponen + snapshot bulanan + band-drop + ROAS toggle)
> **selesai di-port & hijau di DB fresh** (domain 302/302, api 82/82) di branch
> `claude/port-m13-health` (commit `643cd88`, PR #48). Lanjut = port **M14 → M15** ikut
> `WAVE3_PLAN.md`; ingat pola cleanup append-only+FK via `session_replication_role=replica` (§3.1)
> & validasi di DB FRESH (§5).
