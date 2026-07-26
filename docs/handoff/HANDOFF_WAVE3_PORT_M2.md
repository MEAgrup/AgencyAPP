# HANDOFF — Wave 3 Port (M2 Marketing selesai; lanjut M13 → M14 → M15)

> Sesi ini mem-**port** modul **M2 (Marketing — Performance Record + Auto-Metrics Engine)**
> dari **Go source-of-truth** (`backend/internal/module2_marketing/{marketing,metrics}.go`)
> ke **stack Fase 1 (Next/Supabase)** di `packages/domain/src/marketing.ts` + `apps/api`.
> Semua hijau di DB fresh, di-commit & di-push. Melanjutkan seri port Wave 2/3 (lihat
> `HANDOFF_WAVE2_PORT_M6_M12_M7_M8_M9.md` §3–§8, `HANDOFF_WAVE3_PORT_M11.md`,
> `HANDOFF_WAVE3_PORT_M3.md`).

---

## §0 — Mulai baca dari mana

1. `CLAUDE.md` (root) — house rules non-negotiable.
2. `docs/handoff/HANDOFF_WAVE2_PORT_M6_M12_M7_M8_M9.md` — §3 arsitektur port, §4 pola
   6-langkah, §7 verifikasi, §8 gotcha. **Masih 100% berlaku.**
3. **Handoff ini** (§1–§7) untuk delta M2 + task berikutnya.
4. `docs/handoff/WAVE3_PLAN.md` — urutan klaster & titik keputusan (O4/O5/O9).

---

## §1 — State saat ini

- **Repo:** `MEAgrup/AgencyAPP`
- **Branch:** `claude/port-m2-marketing` — **pushed**. Commit port: **`0541381`**.
- **⚠️ STACKING (penting):** branch M2 **di-branch dari branch M3** (`claude/port-m3-campaign`),
  BUKAN dari `main`, karena M2 secara sah meng-import service M3 (`campaign.getCampaign`/
  `listCampaigns` untuk gate §5 + baca Online/Offline 1:1 — persis desain Go
  `module2 imports module3`). Jadi `git log` branch ini memuat commit M3 (`57e2e42`,
  `9380628`) DI BAWAH commit M2. Rantai stack keseluruhan (semua open, belum ke `origin/main`
  yang masih `ab8a3ee`): PR #42(Wave2) → #43(M10) → #44(M7-daily) → M11 → **M3 → M2**.
  **Urutan merge WAJIB:** M3 sebelum M2. Bila `origin/main` sudah maju, rebase M3 dulu lalu M2.
- **PR:** belum dibuka (tidak diminta).
- **Verifikasi (DB FRESH — CI-equivalent):** `@cdps/domain` **318/318 hijau** (termasuk M2
  16 test + M3 15 test; bahkan finance scanReminders LULUS di DB benar-benar fresh),
  `@cdps/api` **84/84 hijau** (wire+http+auth), typecheck `@cdps/domain` + `@cdps/api` bersih.

---

## §2 — Apa yang di-port sesi ini (M2)

`packages/domain/src/marketing.ts` (namespace `marketing`, export di `index.ts`):

| Fungsi | Isi |
|---|---|
| `createRecord` / `updateBudget` | Marketing Performance Record 1:1 Campaign (input budget). Gate §3 Rule 5 / §5 Rule 3: **owner atau Director saja** (lead non-owner READ-ONLY atas record staff — beda dari M3 canManageCampaign yang izinkan any-lead). Budget wajib >0 (parse sebelum tulis); duplikat 1:1 ditolak (M3-OA-5); audit before→after. |
| `getRecord` | budget + Online/Offline (dibaca 1:1 dari Campaign); gate baca §5. |
| `metrics` | **Auto-Metrics Engine (§4), semua DERIVED**: Lead-by-Dashboard, Lead-Real-by-Sales (≥Qualified via audit log `transition:Contacted->Qualified`), Lead-Quality Rate, Attributed Sales (**LAST-TOUCH**, M2-OA-2, dalam window 3 bulan pasca-Close M3-OA-4), CPL/CPRL/ROAS, Collected-ROAS (verified-received = Σ installment `[Terverifikasi]` + Σ direct verification NULL installment_id, M2-OA-5), junk breakdown (NQ reasons verbatim). Div-zero → `—`. |
| `dashboard` | Split §5: staff own-only, lead/OD/Director all; campaign tanpa record tetap muncul (metrik budget-dependent `—`). Reuse `campaign.listCampaigns`. |

- **API** (namespaced di `/api/v1/marketing/...`, sejajar M3): `campaigns/[id]/performance`
  (POST create, GET record+metrics), `campaigns/[id]/performance/budget` (POST|PATCH),
  `performance-dashboard` (GET).
- **wire.ts:** `performanceRecordToWire`, `marketingMetricsToWire`. **http.ts:**
  `marketing.ValidationError`→400, `NotFoundError`→404, `ForbiddenError`→403,
  `DuplicateError`→409.
- **Cross-module (acyclic):** `marketing → campaign` (import langsung; campaign tak import balik).
  Error M3 di-re-wrap ke error M2 via `mapCampaignErr` (pesan BI byte-identik).

---

## §3 — GOTCHA PENTING sesi ini (baca sebelum lanjut)

**`audit_log` append-only (trigger `audit_log_no_delete` + `audit_log_no_update`) TIDAK bisa
dibersihkan di `afterEach`.** Test integrasi yang men-seed `prospect_attempts`/`clients`
meninggalkan baris audit (`transition:Contacted->Qualified`, `closing`) selamanya. Bila dua
file test memakai **id entity yang sama** (mis. `ZZ-PRSP-2`), baris audit basah dari satu file
**meracuni** query DISTINCT/COUNT file lain di **DB dev yang persist** (fresh DB CI aman).

- **Aturan:** id yang menjadi `audit_log.entity_id` (prospect_attempt, client) **WAJIB unik
  per run** (`uid()`), JANGAN literal tetap. `marketing.test.ts` sudah pakai `uid()`/`ph()`.
- **Catatan:** `campaign.test.ts` (M3) masih pakai id tetap `ZZ-PRSP-1/2/3` — aman di DB fresh &
  aman terhadap re-run-nya sendiri (ia tak pernah tulis `ZZ-PRSP-2` sebagai Qualified), tapi
  rapuh bila file lain menulis audit Qualified utk id itu. M2 sudah dibuat tidak menabraknya.
  Untuk modul baru: **selalu `uid()` untuk entity ber-audit.**
- **DB dev yang sudah keburu terpolusi** (mis. `cdps`) akan terus menggagalkan
  `campaign.test` rollup ("expected 2 to be 1"). **Bukan bug** — pakai DB fresh untuk validasi:
  `dropdb/createdb cdps_v3` → apply 31 migrasi → run. (finance scanReminders juga hanya
  gagal di DB terakumulasi; di DB fresh lulus.)

---

## §4 — TASK BERIKUTNYA: **M13 (Client Health)**

Per `WAVE3_PLAN.md`: M3 → M2 → **M13 → M14 → M15** (Client Portal TERAKHIR, diblokir O5/O4).
M3 & M2 selesai. Berikutnya **M13 Client Health**.

Go source: `backend/internal/module13_health/*.go`. Isi (W3-M13-C1): snapshot job bulanan
(WIB), Health Score + redistribusi bobot (CSAT N/A — OA-6 Phase 2), ROAS toggle, band +
emisi `EvClientBandDrop` → SPV (event SUDAH di katalog FROZEN, tinggal emit). Recompute-from-log;
band drop = perpindahan band turun antar snapshot. Migrasi tabel: cek `0035_client_health.sql`
(sudah ada di `supabase/migrations/`).

Mulai konkret:
```bash
cd /home/user/AgencyAPP
wc -l backend/internal/module13_health/*.go
sed -n '1,30p' backend/internal/module13_health/*.go       # header interpretasi tiap file
grep -n "ClientBandDrop\|EvClientBandDrop" packages/core/src/notification.ts
grep -n "HandleFunc" backend/internal/httpapi/*health*.go   # path route
ls supabase/migrations/ | grep -i health
```
Ikuti **pola 6-langkah** handoff Wave-2. Template terdekat: `marketing.ts`/`campaign.ts`
(derived reads + money + reuse antar-modul), `finance.ts` (money/verified ledger).
Branch: buat `claude/port-m13-health` dari branch M2 bila M13 butuh baca M2/M3 (cek import Go);
kalau tidak, dari base terkini. (Konvensi user: 1 modul = 1 branch/PR.)

Setelah M13: **M14 Team Performance** → **M15 Portal** (Team dulu; Client Portal terakhir,
DIBLOKIR O5 security spec + O4 embeddability — jangan mulai C2 sebelum keduanya).

---

## §5 — Environment (⚠️ ephemeral — rebuild tiap container)

```bash
cd /home/user/AgencyAPP
npm install                                             # node_modules TIDAK persist — WAJIB
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/cdps_pgdata -o "-p 5433 -k /tmp" -l /tmp/pg_run.log start
# DB FRESH utk validasi jujur (hindari akumulasi audit_log, lihat §3):
psql "postgres://postgres@localhost:5433/postgres" -c "create database cdps_v3;"
for f in supabase/migrations/*.sql; do psql "postgres://postgres@localhost:5433/cdps_v3" -f "$f" || break; done
export DATABASE_URL="postgres://postgres@localhost:5433/cdps_v3"
npx vitest run <file>.test.ts --root packages/domain
npx tsc -p packages/domain/tsconfig.json --noEmit ; npx tsc -p apps/api/tsconfig.json --noEmit
```
> ⚠️ Cluster Postgres **sering mati** (connection refused). Cek `psql "$DATABASE_URL" -c "select 1"`
> & restart dulu. ⚠️ **Classifier exec-safety sempat outage** sesi ini (memblok `npx`/MCP;
> `git status`/`echo` tetap jalan) — bila kejadian lagi, tunggu & ulangi, itu transient infra.

---

## §6 — Kegagalan PRA-ADA & catatan

1. **`finance.test.ts scanReminders idempotent`** gagal HANYA di DB terakumulasi (append-only
   installment/audit lintas test dalam file itu); **lulus di DB fresh**. Bukan tugasmu.
2. **Status HTTP validasi = 400** (Go 422) — konvensi port TS baku.
3. **Linkage WRITE belum di-port** (`leads.origin/last_touch_campaign_id` di register/import,
   `clients.origin_campaign_id` di closing) — deferred W3-M3-C2. M2/M3 rollup MEMBACA kolom itu;
   test menyeed langsung. Bila FE butuh angka rollup/attributed riil end-to-end, port write-linkage
   ini (bagian M1/M0).
4. **Backlog port:** M13, M14, M15 (§4). M10/M7-daily = PR open (#43/#44); M11, M3, M2 = branch
   open belum merge ke origin/main.

---

## §7 — Berkas berubah sesi ini (di atas base M3)

```
BARU   packages/domain/src/marketing.ts             (port marketing+metrics)
BARU   packages/domain/src/marketing.test.ts        (16 test: 1 unit + 15 integrasi, id unik)
BARU   apps/api/src/app/api/v1/marketing/campaigns/[id]/performance/{route,budget/route}.ts
BARU   apps/api/src/app/api/v1/marketing/performance-dashboard/route.ts
EDIT   packages/domain/src/index.ts                 (export marketing)
EDIT   apps/api/src/lib/http.ts                      (map error M2: 400/403/404/409)
EDIT   apps/api/src/lib/wire.ts                      (performanceRecordToWire, marketingMetricsToWire)
EDIT   apps/api/src/lib/wire.test.ts               (test 2 mapper)
```

### Ringkas 1 baris
> M2 (Marketing Performance Record + Auto-Metrics Engine, reuse M3 campaign) **selesai di-port
> & hijau di DB fresh** (domain 318/318, api 84/84) di branch `claude/port-m2-marketing`
> (stacked on M3, commit `0541381`). Lanjut = port **M13 → M14 → M15** ikut `WAVE3_PLAN.md` +
> pola 6-langkah; **selalu `uid()` untuk entity ber-audit** (§3); validasi di DB FRESH (§5).
