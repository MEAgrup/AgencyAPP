# HANDOFF — Wave 3 Port (M3 Campaign selesai; lanjut M2 → M13 → M14 → M15)

> Sesi ini mem-**port** modul **M3 (Campaign)** dari **Go source-of-truth**
> (`backend/internal/module3_campaign/{campaign,lifecycle,read,rollup}.go`) ke **stack
> Fase 1 (Next/Supabase)** di `packages/domain/src/campaign.ts` + `apps/api`. Semua hijau,
> di-commit & di-push. Melanjutkan seri port Wave 2/3 (lihat
> `HANDOFF_WAVE2_PORT_M6_M12_M7_M8_M9.md` §3–§8 + `HANDOFF_WAVE3_PORT_M11.md`).

---

## §0 — Mulai baca dari mana

1. `CLAUDE.md` (root) — house rules non-negotiable.
2. `docs/handoff/HANDOFF_WAVE2_PORT_M6_M12_M7_M8_M9.md` — §3 arsitektur port, §4 pola
   6-langkah, §7 resep verifikasi, §8 gotcha. **Masih 100% berlaku.**
3. **Handoff ini** (§1–§6) untuk delta M3 + task berikutnya.
4. `docs/handoff/WAVE3_PLAN.md` — urutan klaster & titik keputusan (O4/O5/O9 + Online/Offline).

---

## §1 — State saat ini

- **Repo:** `MEAgrup/AgencyAPP`
- **Branch:** `claude/port-m3-campaign` — **pushed**, base = `806a91c` ("Merge PR #42:
  Wave 2 port"). Commit port: **`57e2e42`**. Sibling bersih dari M11 (branch terpisah).
- **PR:** belum dibuka (tidak diminta).
- **⚠️ Stacking (sama seperti sebelumnya):** `806a91c` belum termerge ke `origin/main`
  (`origin/main` masih `ab8a3ee`, titik Fase-1). Branch M3 ini sejajar dengan #42/#43(M10)/
  #44(M7)/M11. **Rebase ke base terbaru** kalau `origin/main` sudah maju saat mulai.
- **Verifikasi (fresh Postgres):** `@cdps/domain` **15 test M3** hijau (suite penuh
  302/303 — 1 gagal PRA-ADA `finance.test.ts scanReminders`, lihat §5), `@cdps/api`
  **52 test** hijau (wire+http), typecheck `@cdps/domain` + `@cdps/api` bersih.

---

## §2 — Apa yang di-port sesi ini (M3)

`packages/domain/src/campaign.ts` (namespace `campaign`, diexport di `index.ts`):

| Fungsi | Isi |
|---|---|
| `createCampaign` | Mandatory Name/Channel/Online\|Offline(≥1)/Start Date; owner = aktor; born `Draft`; **CMP- di-mint setelah validasi** (rule 1). |
| `transitionCampaign` | Mesin `campaign` (Draft→Active⇄Paused→Closed→Archived) via engine SAJA; otoritas dicek di kode DULU (§6.1); **reaching Closed → stamp `end_date` = hari ini WIB** (efek kolom data ter-audit §6.3). Edge ilegal = `TransitionResult {ok:false}` → route 409 (transitionResponse). |
| `reassignCampaign` | Handover owner; **hanya Marketing lead/head atau Director** (M3-OA-6); target wajib Marketing staff aktif; audit before→after. |
| `getCampaign` / `listCampaigns` | Visibilitas §5: staff own-only, lead/OD/Director all, divisi lain ditolak. |
| `campaignRollup` | Funnel derived (M3 §4 Rule 4): leads generated, real leads (≥Qualified dari audit log `transition:Contacted->Qualified`), clients won, total value won (SUM trx, IDR). Reuse gate §5. |

- **API (namespaced di `/api/v1/marketing/campaigns`** — M8 ADC sudah pakai
  `/api/v1/campaigns`, M3-OA-1): `route.ts` (POST/GET), `[id]/route.ts`,
  `[id]/rollup`, `[id]/transition`, `[id]/reassign`.
- **wire.ts:** `marketingCampaignToWire` (owner→`owner_employee_id`, `end_date` nullable,
  `online/offline`), `campaignRollupToWire`. **Jangan** tabrak `campaignToWire` (itu M8 ADC).
- **http.ts:** `campaign.ValidationError`→400, `NotFoundError`→404, `ForbiddenError`→403.
  Tak ada ConflictError — transisi pakai `transitionResponse`.

---

## §3 — TASK BERIKUTNYA: **M2 (Marketing Performance Record)**

Per `WAVE3_PLAN.md` urutan: **M3 → M2 → M13 → M14 → M15** (Client Portal PALING AKHIR,
diblokir O5/O4). M3 sudah. Berikutnya **M2**.

Go source (~1.3k LoC): `backend/internal/module2_marketing/{marketing,metrics}.go` (+ tests).
Isi (per WAVE3_PLAN W3-M2-C1): Marketing Performance Record 1:1 Campaign (Budget wajib >0);
auto-metrics read-only derived — Lead-by-Dashboard, Lead-Real-by-Sales (≥Qualified),
Quality Rate, Attributed Sales (last-touch, window 3 bulan), CPL, CPRL, ROAS,
Collected-ROAS (basis Amount Verified M5, M2-OA-5), junk breakdown; div-zero → `—`.

Mulai konkret:
```bash
cd /home/user/AgencyAPP
wc -l backend/internal/module2_marketing/*.go
sed -n '1,30p' backend/internal/module2_marketing/marketing.go     # header interpretasi
grep -n "HandleFunc" backend/internal/httpapi/*marketing*.go        # path route
ls supabase/migrations/ | grep -i "marketing\|performance"          # migrasi tabel
```
Titik keputusan (log ke DECISIONS saat implementasi): **lokasi Online/Offline** (M2 §6.3 vs
M3 §6.3 1:1 — M3 sudah simpan di Campaign `is_online/is_offline`; M2 sebaiknya baca via 1:1).
Ikuti **pola 6-langkah** handoff Wave-2. Template terdekat: `campaign.ts` (rollup derived +
money) & `finance.ts`/`ads.ts` (metrik money/ROAS).

Setelah M2: **M13 Client Health** → **M14 Team Performance** → **M15 Portal** (Team dulu,
Client Portal terakhir, diblokir O5/O4).

---

## §4 — Environment (⚠️ ephemeral — rebuild tiap container)

```bash
cd /home/user/AgencyAPP
npm install                                             # node_modules TIDAK persist — WAJIB
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/cdps_pgdata -o "-p 5433 -k /tmp" -l /tmp/pg_run.log start
# kalau cluster hilang total: initdb → start → create database cdps → apply supabase/migrations/*.sql lexical
export DATABASE_URL="postgres://postgres@localhost:5433/cdps"
npx vitest run <file>.test.ts --root packages/domain
npx tsc -p packages/domain/tsconfig.json --noEmit       # jalankan polos (base tsconfig set ignoreDeprecations)
npx tsc -p apps/api/tsconfig.json --noEmit
```
> Cluster **sering mati** (connection refused / "N failed" mendadak) — cek `psql "$DATABASE_URL"
> -c "select 1"` & restart dulu sebelum simpulkan bug.

---

## §5 — Kegagalan PRA-ADA (BUKAN tugasmu) & catatan

1. **`finance.test.ts` → `scanReminders … idempotent`** GAGAL (akumulasi installment lintas
   test dalam file itu sendiri) — gagal baik diisolasi maupun di suite penuh, independen dari
   M3. **Biarkan** kecuali diminta.
2. **Status HTTP validasi = 400** (Go pakai 422) — konvensi port TS baku, bukan deviasi baru.
3. **Test mint-after-validation** JANGAN andalkan `count(id_sequences where prefix=...)` — global,
   persist lintas run di DB bersama (bikin flaky). M3 memakai cek `count(campaigns where
   created_by like 'ZZ-%')` setelah create gagal (=0). Pola ini yang benar.
4. **Linkage WRITE belum di-port:** `leads.origin_campaign_id`/`last_touch_campaign_id` di
   register/import (M1 §5) & `clients.origin_campaign_id` di closing (M0) masih deferred
   (W3-M3-C2 di `leads.ts` komentar). `campaignRollup` MEMBACA kolom itu — test menyeed langsung.
   Bila FE butuh angka rollup riil, port write-linkage ini (bagian M1/M0, bukan M3 core).

---

## §6 — Berkas berubah sesi ini

```
BARU   packages/domain/src/campaign.ts             (port campaign+lifecycle+read+rollup)
BARU   packages/domain/src/campaign.test.ts        (15 test: 4 unit + 11 integrasi)
BARU   apps/api/src/app/api/v1/marketing/campaigns/{route, [id]/route, [id]/rollup, [id]/transition, [id]/reassign}
EDIT   packages/domain/src/index.ts                (export campaign)
EDIT   apps/api/src/lib/http.ts                     (map error M3: 400/403/404)
EDIT   apps/api/src/lib/wire.ts                     (marketingCampaignToWire, campaignRollupToWire)
EDIT   apps/api/src/lib/wire.test.ts               (test 2 mapper)
```

### Ringkas 1 baris
> M3 (acquisition Campaign CMP- + lifecycle + reassign + §5 reads + rollup) **selesai di-port
> & hijau** di branch `claude/port-m3-campaign` (commit `57e2e42`). Lanjut = port **M2 →
> M13 → M14 → M15** ikut `WAVE3_PLAN.md` + pola 6-langkah handoff Wave-2; `npm install` + start
> Postgres dulu (§4); waspada kegagalan finance pra-ada (§5).
