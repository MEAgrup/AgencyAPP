# HANDOFF — Wave 3 Port M13 (Client Health) — SELESAI ✅ · lanjut M14

> Sesi ini memindahkan (port) **M13 Client Health** dari **Go source-of-truth**
> (`backend/internal/module13_health/*.go`) ke **stack Fase 1 (Next/Supabase)**:
> `packages/domain/src/health.ts` + thin API layer di `apps/api`. Semua hijau di
> Postgres fresh. Dokumen ini agar sesi berikut lanjut **tanpa kehilangan konteks**.

---

## §0 — Mulai baca dari mana (urutan)

1. `CLAUDE.md` (root) — house rules non-negotiable (ID `PREFIX-YYYYMM-NNNN`, state
   machine server-side, immutable audit, derived read-only, pesan BI `[...]`, IDR,
   permission matrix, div-zero → `—`).
2. **Handoff ini** (§1–§7).
3. `docs/prd/CDPS_Module14_*.md` — PRD modul berikutnya (M14 Team Performance).
4. `backend/internal/module14_*/*.go` — **source of truth** M14 yang akan di-port.
5. Template port paling relevan: **`packages/domain/src/health.ts`** (pure scoring
   core + gatherers + monthly sweep + immutable snapshot + emit event) dan
   **`packages/domain/src/finance.ts`** (`scanReminders` = pola sweep fire-once).

---

## §1 — State saat ini

- **Repo:** `MEAgrup/AgencyAPP`
- **Branch kerja:** `claude/handoff-wave3-m13-health-93sd64`
  (base `main` @ `806a91c` "Merge PR #42: Wave 2 port")
- **Working dir:** `/home/user/AgencyAPP`
- **Verifikasi terakhir (Postgres fresh):** `@cdps/domain` **305 tests** hijau
  (M13 = **17** tests baru), `@cdps/api` **85 tests** hijau, typecheck dua-duanya bersih.
- **Migrasi:** `supabase/migrations/20260101000035_client_health.sql` **sudah ada
  dari sebelumnya** — tidak diubah. Menyediakan tabel `client_health_snapshots`
  (immutable, trigger `forbid_mutation` BEFORE UPDATE/DELETE) + kolom
  `clients.roas_health_included_override`.

> Catatan Wave-3 lain (M11/M3/M2, M10 #43, M7-daily #44) ada di **branch masing-masing**,
> belum ter-merge ke `main`. M13 tidak bergantung padanya (murni agregasi
> M4/M5/M6/M8/M12), jadi di-port di atas `main` (Wave-2).

---

## §2 — Apa yang di-port (M13)

| Layer | File | Isi |
|---|---|---|
| **Domain** | `packages/domain/src/health.ts` | **Pure scoring core** (`score`/`bandFor`): 7 komponen, bobot Rule 3, redistribusi proporsional komponen-hilang Rule 4, capping [0,100] Rule 5/6, banding Rule 7. **Gatherers** (`gatherComponents` + per-komponen) baca dari M4 (GMV), M8 (ROAS via `ads.parseRoasTarget` + Σ metric), M12 (Task Completion + Revision Burden via `task.computeMetrics` dari audit log), M6 (Complaints), M5 (Payment Timeliness dari audit log), Satisfaction selalu N/A (Rule 2). **Period WIB** (bulan closed = bulan lalu, O20). **Sweep bulanan** `runSnapshotJob`/`runScan` fire-once + idempotent (lock client + `UNIQUE(client_id, period_start)`), tulis snapshot immutable + emit `EvClientBandDrop` (Rule 12) di transaksi yang sama. **Live preview** bulan berjalan (tak disimpan, Rule 10). **Trend** (Rule 9). **ROAS Inclusion Toggle** (Rule 13/§5.4, override di kolom terpisah + audit before→after). Gate visibility (Rule 11) + gate scan. |
| **API** | `apps/api/src/app/api/v1/...` | `POST client-health/scan` · `GET clients/{id}/health?period=YYYYMM` · `GET clients/{id}/health/trend` · `GET clients/{id}/health/preview` · `GET`+`PUT clients/{id}/roas-toggle`. Semua thin shell → `requireActor` → domain → `snapshotToWire`/`roasToggleToWire`/`scanResultToWire`. |
| **Wire/errors** | `apps/api/src/lib/{wire,http}.ts` | `snapshotToWire`, `componentToWire`, `roasToggleToWire`, `scanResultToWire`. `mapError`: `health.NotFoundError`→404, `health.ForbiddenError`/`health.ScanForbiddenError`→403. |

Diexport lewat `packages/domain/src/index.ts` (`export * as health`).

### Angka worked example (§4) — direproduksi 1:1 di test
GMV 40 · ROAS 84 · Task 90 · Revision 76 · Complaints 95 · Payment 100 · Satisfaction
excluded → 10%-nya di-redistribusi ÷0.9 → **74.56 → Watch**. Snapshot id `CHR-202606-NNNN`
(bucket = bulan **periode**, bukan bulan run — DECISIONS W3-M13-C1).

---

## §3 — Gotcha kunci (WAJIB baca untuk M14)

1. **`audit_log` append-only** → tak ada path UPDATE/DELETE. Semua metrik turunan
   (turnaround, speed score, revision count, payment timeliness) **direkomputasi dari
   log**, bukan disimpan.
2. **DB fresh untuk test sweep.** Snapshot CHR **immutable** — satu-satunya cara
   bersih adalah `TRUNCATE` (bypass trigger); `health.test.ts` `afterEach` melakukan
   `truncate client_health_snapshots` lalu hapus klien `ZZ-`. Assertion count-based
   (`snapshotsMade`/`bandDropsFlagged`) **valid di DB fresh**; notifikasi append-only
   (tak bisa dihapus) → assertion notifikasi **di-scope ke `entity_id` snapshot
   spesifik** run itu, bukan count per-recipient (kalau tidak, akumulasi antar-run
   bikin gagal palsu — sama seperti `finance.scanReminders`, pre-existing).
3. **Postgres jsonb array:** komponen ditulis via `tx.json(components)` — kalau
   dilempar array JS mentah, postgres.js meng-encode-nya jadi **array Postgres**, bukan
   jsonb. Ingat ini untuk M14 kalau menyimpan payload jsonb.
4. **`count(*) filter (where ...)`** menggantikan `SUM(status = ?)` MySQL (Postgres tak
   bisa `SUM(boolean)`).
5. **id entity ber-audit di test** → pakai id unik (`uid()`), jangan id tetap yang
   bisa bentrok dengan log lama di DB dev terakumulasi.

---

## §4 — Cara verifikasi lokal (Postgres fresh)

```bash
# 1) start scratch PG (as postgres user), createdb cdps
# 2) apply semua migrasi urut + seed:
for f in $(ls supabase/migrations/*.sql | sort); do psql -d cdps -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -d cdps -q -f supabase/seed.sql
# 3) test:
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/cdps"
npm test -w @cdps/domain    # 305 hijau
npm test -w @cdps/api       # 85 hijau
npm run typecheck -w @cdps/domain && npm run typecheck -w @cdps/api
```

---

## §5 — Task berikutnya

- **M14 Team Performance** → `packages/domain/src/team.ts` (`backend/internal/module14_*`).
  Migrasi `20260101000036_team_performance.sql` **sudah ada**. Publikasikan skor
  performa bulanan → emit `EvPerformancePublished` (event sudah di katalog, resolver
  `explicit` → tiap staff). Pola sweep + immutable snapshot mirip M13.
- Lalu **M15 Portal** (Client Portal terakhir, diblokir spec keamanan O5/O4).

---

## §6 — Definition of Done yang sudah dipenuhi (M13)

- Server-side gate + pesan BI `[...]` (ForbiddenError/NotFoundError/ScanForbiddenError).
- Permission tests per-role incl. layered OD/Director (visibility Rule 11 + scan gate).
- Immutability test (UPDATE/DELETE snapshot ditolak trigger).
- Derived fields recompute-from-log (Task/Payment) + worked example §4 end-to-end.
- Event `EvClientBandDrop` fire-once (Rule 12), teruji.

---

## §7 — Commit sesi ini
```
feat(api): port M13 Client Health — snapshot bulanan + scoring + ROAS toggle (Wave 3)
```
