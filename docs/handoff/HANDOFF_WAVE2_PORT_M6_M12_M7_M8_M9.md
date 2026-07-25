# HANDOFF — Wave 2 Port (M6 → M12 → M7 → M8 → M9 selesai; lanjut M10)

> Sesi ini memindahkan (port) modul eksekusi-delivery Wave 2 dari **Go source-of-truth** (`backend/internal/module*`) ke **stack Fase 1 (Next/Supabase)** di `packages/domain` + `apps/api`. Semua hijau, sudah di-push, dan PR sudah dibuka. Dokumen ini dibuat agar akun lain bisa lanjut **tanpa kehilangan konteks**.

---

## §0 — Mulai baca dari mana (urutan)

1. `CLAUDE.md` (root) — house rules non-negotiable (ID format, state machine server-side, immutable audit, derived fields, pesan BI `[...]`, IDR format, permission matrix).
2. **Handoff ini** (§1–§8).
3. `docs/prd/CDPS_Module10_Live_Stream.md` — PRD modul berikutnya (M10).
4. `backend/internal/module10_livestream/*.go` — **source of truth** M10 yang akan di-port.
5. Contoh port yang sudah jadi sebagai template: **`packages/domain/src/kol.ts`** (paling mirip M10: entity + native machine + roll-up + reads) dan **`packages/domain/src/ads.ts`** (money/derived reads).

---

## §1 — State saat ini

- **Repo:** `MEAgrup/AgencyAPP`
- **Branch:** `claude/wave2-port-start-cllq8v` (base `main` @ `32d6e97` "Merge PR #41: Fase 1 exit")
- **PR:** **#42** — https://github.com/MEAgrup/AgencyAPP/pull/42 (open, base `main`)
- **Working dir:** `/home/user/AgencyAPP`
- **Verifikasi terakhir (fresh Postgres):** `@cdps/domain` **288 tests** hijau, `@cdps/api` **80 tests** hijau, typecheck bersih.

### Commit di branch (urut lama→baru)
```
3059a4c M6 §3  Account intake & AM assignment
3a4bcc3 M6 §4  Strategy & Plan
0048938 M6 §5–§8 Briefs, review & Complaints
f0b5b94 M12    Task Execution (Brief-as-task path)
0fbee6c M7     Creative + M12 Asset source & Brief roll-up
63c405e M8     Ads — Ad Campaign + metrics/ROAS/attribution
8ede971 M9     KOL — Creator Booking + §11-mapped Speed Score
```

---

## §2 — Apa yang sudah di-port (ringkas per modul)

| Modul | File domain | Isi |
|---|---|---|
| **M6** Account & Service | `packages/domain/src/account.ts` | §3 intake/assign/reassign · §4 Strategy & Plan (create/draft/submit/approve/revise + requirement override + `guardBriefCreation`) · §5–§7 Brief breakdown/dispatch/review + `onBriefLeavesToDo` (hook Service→[In Execution]) · §8 Complaint door #2 |
| **M12** Task Execution | `packages/domain/src/task.ts` | Edge divisi-side brief_task (start/submit/rework/resume) · assign PIC + SLA · block-request queue · **`computeMetrics` (pure, core metrik dipakai lintas modul)** · **`recomputeBriefRollup`** · abstraksi `TaskSource` (brief + asset) |
| **M7** Creative | `packages/domain/src/creative.ts` | Asset (AST-) entity · createAsset (incremental, sequence) · review AM per-Asset (review/approve/request-revision) · logHours · reads. Exec edges + roll-up ada di `task.ts` (sourceAsset) |
| **M8** Ads | `packages/domain/src/ads.ts` | Ad Campaign (ADC-) · lifecycle [Paused]/[Active]/[Ended] + launch dependency · link/unlink Creative Asset · Optimization Log (budget >50% sign-off + creative swap) · Metric Entries + derived Total Spend/GMV/ROAS + Attributed-GMV feedback · `validateBriefSubmit` (guard §4 Rule 3 dipanggil M12) |
| **M9** KOL | `packages/domain/src/kol.ts` | Creator Booking (BKG-) native 8-state machine + QC (oleh KOL, bukan AM) + escalate/drop · coordinator/SLA/hours · roll-up · Creator Payment Request (CPR-, sisi Finance) · Creator List · Attributed GMV · **Speed Score via mapping §11 → `task.computeMetrics`** |

Semua diexport lewat `packages/domain/src/index.ts` (`export * as <name>`).

---

## §3 — Arsitektur port (WAJIB paham sebelum lanjut)

**Alur 1 request = shell tipis:**
```
apps/api/src/app/api/v1/**/route.ts   (Next route handler)
  → requireActor(request)             (JWT app_metadata → Actor; lib/auth.ts)
  → domain function (packages/domain) (semua logika + gate + audit + transisi)
  → wire mapper (apps/api/src/lib/wire.ts)  camelCase → snake_case FE contract
  → handle()/mapError() (apps/api/src/lib/http.ts) map error class → status
```

**Engine bersama (`@cdps/core` + `@cdps/db`):**
- `permission` — `isLead/canReadDivision/canReadAll/LevelStaff/LevelLead`, `Actor`.
- `money` — **bigint minor-units (sen)**. `parse(s)`→bigint, `decimal(m)`→"1500000.00", `format(m)`→"Rp. 1.500.000,00". Rupiah = `Number(m)/100`.
- `statemachine.transition(ex.sm, {machine, entityType, table, entityId, to, actor})` → `{ok,from,to}` atau `{ok:false,code,message}`. **Satu-satunya jalan menulis kolom status.**
- `notification.emit(ex.notify, {event, entityType, entityId, actor, division?, explicitRecipients?})`. Event dari **frozen catalog** `notification.EVENTS`.
- `tz.dateString(d)`→"YYYY-MM-DD" (WIB). Untuk period "YYYY-MM": `tz.dateString(d).slice(0,7)` (⚠️ `tz.period` = "YYYYMM" tanpa dash, beda dari Go `2006-01`).
- `@cdps/db`: `executors(tx)` → `{sm, audit, ident, notify}`; `withTransaction(sql, fn)`; `Queryable = Sql | TransactionSql`.

**Cross-module (acyclic):** `creative → task → {account, ads}`, `kol → {account, task}`. `account` tidak import siapa pun. Import langsung fungsi (bukan interface) karena tidak ada cycle.

**Error taxonomy tiap modul** = 4 class lokal: `ValidationError`(400) / `ForbiddenError`(403) / `NotFoundError`(404) / `ConflictError`(409), didaftarkan di `apps/api/src/lib/http.ts` `mapError`. Transisi engine yang gagal: `role_denied`→Forbidden, lainnya→Conflict (lihat helper `transitionError`).

---

## §4 — Pola port 6-langkah (resep untuk M10)

1. **Baca PRD + Go**: `docs/prd/CDPS_Module10_Live_Stream.md` + semua `backend/internal/module10_livestream/*.go`. Catat: entity id prefix, machine name + edges (cek `supabase/migrations/20260102000002_statemachine.sql` + `backend/internal/core/statemachine/config.go`), tabel + kolom (cek DB langsung), pesan sentinel BI.
2. **Domain** `packages/domain/src/livestream.ts` (nama tebakan — sesuaikan): port 1:1 fungsi Go → TS. Reuse `computeMetrics`/`recomputeBriefRollup`/`onBriefLeavesToDo` bila relevan. Money via `@cdps/core` money. Export di `index.ts`.
3. **wire.ts**: mapper camelCase→snake_case (samakan dgn json tag struct Go / FE `web-internal/src/lib/*.ts`). `omitempty` → hilangkan key saat kosong (`...(x ? {k:x} : {})`).
4. **routes**: `apps/api/src/app/api/v1/.../route.ts` (cek path di `backend/internal/httpapi/routes_livestream.go`). Transisi → `transitionResponse(await ...)`. Field writes → `json({...})`.
5. **http.ts**: tambah 4 class error modul ke `mapError`.
6. **DoD/tests**: `livestream.test.ts` — unit predicate + pure metric core + integration (lifecycle, permission matrix incl OD/Director, immutability, derived/money). Run fresh DB → hijau. Lalu `@cdps/api` typecheck + tests. Commit + push.

---

## §5 — TASK BERIKUTNYA: **M10 (Live Stream)** — mulai dari sini

**Konteks M10 (dari M6 §6 Rule 2):** Brief Live Stream lahir **off-machine** dengan status `[Dispatched to Vendor]` — sengaja **dikecualikan** dari engine Task/M12 (bukan timed Task). M10 = **vendor tracker** untuk sesi live-stream ke vendor eksternal. Jadi polanya mirip M9 (entity + native machine + reads) tapi tanpa Speed Score internal.

File Go: `backend/internal/module10_livestream/*.go` (cek `wc -l` untuk ukuran). Tabel sudah ada: migrasi `20260101000028_live_stream_sessions.sql`. Machine (cek config.go): kemungkinan `live_stream_session` — verifikasi edges di migration statemachine.

Langkah konkret:
```bash
cd /home/user/AgencyAPP
wc -l backend/internal/module10_livestream/*.go
grep -nE "MLiveStream|live_stream" backend/internal/core/statemachine/config.go
grep -n "'live_stream" supabase/migrations/20260102000002_statemachine.sql
grep -n "HandleFunc" backend/internal/httpapi/routes_livestream.go   # path route
```
Lalu ikuti §4. Setelah M10 selesai, Wave 2 execution modules **lengkap**.

---

## §6 — Deferral yang harus dibereskan (backlog, catat di DECISIONS bila diputus)

1. **M10 Live Stream** — modul terakhir Wave 2 (task di atas).
2. **M11 Blocking-Dependency** gate — hook `approveBrief` (account.ts) & asset roll-up (task.ts) saat ini nil-safe/dilewati. Port M11 (Wave 3) lalu sambungkan.
3. **M7 §7 Daily Output** (`daily_output.go`) + **Hours reminder** (`reminder.go`, Wave-3 catalog) — belum di-port (cluster tambahan M7).
4. **FE re-pointing:** halaman `web-internal` masih pukul **Go API** dengan bentuk transisi Go-era `{From,To}`. Route Next pakai konvensi Fase-1 `transitionResponse` = `{ok,from,to}`. Saat M6–M9 dialihkan ke Next API, update `web-internal/src/lib/{account,creative,tasks,ads,kol}.ts` (terutama tipe `TransitionResult`). Read/write non-transisi mostly sudah 1:1.
5. **M2/M3/M11/M13/M14/M15** — Wave 3 (belum disentuh).

---

## §7 — Resep verifikasi lokal (Postgres) — PENTING

⚠️ **Cluster Postgres di environment ini sering mati** (connection refused). Selalu cek/restart dulu.

```bash
# Restart bila perlu
su - postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || pg_ctlcluster 16 main start

# Buat/segarkan DB fresh + apply SEMUA migrasi (mirror CI):
su - postgres -c "psql -tAc \"DROP DATABASE IF EXISTS cdps\""
su - postgres -c "psql -tAc \"CREATE DATABASE cdps OWNER postgres\""
# (role postgres password 'postgres' sudah diset sesi ini; kalau DB baru: ALTER ROLE postgres PASSWORD 'postgres')
for f in $(ls supabase/migrations/*.sql | sort); do
  PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d cdps -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "FAIL $f"; break; }
done

export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm test -w @cdps/domain            # integration test aktif kalau DATABASE_URL diset
npm test -w @cdps/api               # unit (lib) — tak butuh DB
npm run typecheck -w @cdps/domain && npm run typecheck -w @cdps/api
# Test satu file: npm test -w @cdps/domain -- <substring>  (hati-hati: "ads" match "leads")
```
Tes integrasi skip otomatis bila `DATABASE_URL` tak diset (`describe.skipIf(!URL)`).

---

## §8 — Konvensi & gotcha yang dipelajari sesi ini (baca!)

1. **Validasi sinkron di fungsi non-async = jebakan test.** Kalau fungsi `export function foo(...)` melempar `throw` SEBELUM `return promise`, maka `expect(foo()).rejects` gagal (throw sinkron saat evaluasi argumen). **Solusi:** buat fungsi `async` (lihat `creative.requestAssetRevision`, `kol.reject`).
2. **`notifications` & `audit_log` = append-only** (trigger no-update/no-delete). **Jangan** `delete` di `afterEach` (poisons semua teardown). Assertion notifikasi filter by `entity_id` unik per test.
3. **Error class lintas modul di test.** Fungsi yang tinggal di modul lain melempar error class modul itu. Contoh: `task.submitAsset`/`task.assetMetrics` dipakai di `creative.test.ts` → assert pakai `task.ValidationError`/`task.ForbiddenError` (import aliased), bukan class `creative`.
4. **postgres.js identifier dinamis:** `tx(src.table)` / `tx(col)` untuk nama tabel/kolom dinamis; nested fragment `sql\`...\`` untuk komposisi SELECT (jangan await fragment lalu embed).
5. **Kolom `numeric` (sla/hours/gmv/rate)** dibaca postgres.js sebagai **string** → `Number(x)`; uang pakai `money.parse`. Kolom boolean Postgres (vs int MySQL di Go) — cek `status_aktif === true || === 1`.
6. **ID prefix** di-mint via `ex.ident.identNext('PREFIX', now)` — `ident_next` terima prefix apa pun (tak ada registry check).
7. **Machine edges** wajib cek di `supabase/migrations/20260102000002_statemachine.sql` (requireLead di kolom terakhir). Pin source state di kode sebelum transisi (lihat `edge`/`driveExecEdge`).
8. **DoD checklist tiap modul:** pesan BI verbatim · permission test per role (incl OD/Director berlapis) · immutability test (audit no-mutation) · derived-field recompute test · money math test · notification event terdaftar.

---

### Ringkas 1 baris
> Lanjut = port **M10 Live Stream** (`backend/internal/module10_livestream/*.go`) ke `packages/domain/src/livestream.ts` + routes + tests mengikuti pola §4, verifikasi fresh Postgres (§7), commit ke branch `claude/wave2-port-start-cllq8v`, PR #42 sudah open.
