# HANDOFF — Wave 3 gap-audit: M2-G1 + M3-G1 DITUTUP — Sesi 3

> Rantai: … → SESI1 (M11-G1) → SESI2 (M13/M14 scheduler + M11-G3 wire) → **SESI3 (ini —
> M2-G1 dashboard compare-across-staff + M3-G1 per-campaign won-client list).**
> Baca yang bernomor tertinggi lebih dulu.
>
> **Status: 2 temuan Wave 3 ditutup sesi ini** (M2-G1 + M3-G1). Keduanya requirement
> produk PRD. Berikutnya: sisa B kecil (M2-G3/G5/G6, M3-G2/G3/G4, M15-G1/G2).

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/m2-g1-m3-g1-lanjutan-fqzra6` (lanjutan dari chain SESI2). |
| **Migrasi** | **119** (NOL migrasi baru — M2-G1/M3-G1 murni domain+API+wire+FE). |
| **Gate** | `tabel public` 121 · `entity_prefix` 35 / `sm_machines` 23 / `notif_events` 58 **TETAP**. |
| **Backlog audit** | `docs/backlog/WAVE3_GAP_AUDIT.md` (STATUS SESI 3 + 2 temuan ✅). |
| **Keputusan** | `docs/DECISIONS.md` **2026-08-19** baris teratas ("Wave 3 gap-audit SESI3"). |

### 0.1 Aturan main (tak berubah) — CLAUDE.md + SESI1/2 §0.1
- Tes domain WAJIB serial (`--no-file-parallelism`); `npm ci` sebelum test; rebuild DB setelah migrasi baru.
- Wire snake_case lewat `apps/api/src/lib/wire.ts`; `null` eksplisit (bukan omitempty).
- `route-parity` `KNOWN_GAPS` **tetap kosong**; `shape-parity` `INLINE_NESTED` **tetap kosong**.
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

### 1.1 M2-G1 — dashboard compare-across-staff (M2 §5 Rule 2) — DITUTUP
Lead/Head dashboard tak bisa "compare … across staff" karena metrics tak membawa pemilik
campaign. **Fix:**
- `packages/domain/src/marketing.ts`: field baru `owner: string` di `Metrics`;
  `computeMetrics` mengisi `owner: c.owner` — **NOL query baru** (`Campaign` sudah di-fetch
  oleh gate baca §5). Read-only, fully derived (house rule 4).
- `apps/api/src/lib/wire.ts`: `MarketingMetricsWire.owner_employee_id`, dipetakan
  `owner_employee_id: m.owner` (konsisten `MarketingCampaignWire.owner_employee_id`).
- `web-internal/src/lib/marketing.ts`: mirror `Metrics.owner_employee_id`.
- Tes: `marketing.test.ts` — `m.owner` di worked-example + list Lead memuat owner ≥2 staff
  (`ZZ-LIA`,`ZZ-DINA`); `wire.test.ts` mapper `.toEqual` di-update.

### 1.2 M3-G1 — per-campaign won-client list + service-status drill-down (M3 §4 Rule 4 / Flow 2) — DITUTUP
Rollup cuma 4 angka; "client list dengan service status (read from Account)" tak ada di TS
maupun Go. **Fix — domain baru + rute BARU:**
- `packages/domain/src/campaign.ts`: `campaignClients(sql, actor, id)` — reuse gate §5 via
  `getCampaign` (sama seperti `campaignRollup`), clients di mana `origin_campaign_id=id`
  (first-touch — **basis identik `Rollup.clientsWon`** ⇒ list & count selalu rekonsiliasi,
  §4 Rule 5) LEFT JOIN `services` → `{serviceId,name,status}` verbatim per Service; client
  tanpa Service ⇒ `services: []`. Urut client tertua dulu (`created_at,id`), service by `id`.
  Types baru: `CampaignClient`, `CampaignClientService`.
- Rute BARU `GET /api/v1/marketing/campaigns/{id}/clients` (shell tipis, `readAsActor`,
  respons `{data}`; pola `…/rollup` + list `…/campaigns`).
- `apps/api/src/lib/wire.ts`: `CampaignClientWire` + `CampaignClientServiceWire`
  (**named interface, bukan inline** — jaga `shape-parity` INLINE_NESTED tetap kosong) +
  `campaignClientToWire`.
- `web-internal/src/lib/marketing.ts`: `CampaignClient` + `CampaignClientService` +
  `getCampaignClients(id)`.
- `apps/api/src/lib/shape-parity.test.ts`: 2 entri registry baru (`CampaignClientWire`,
  `CampaignClientServiceWire`).
- Tes: `campaign.test.ts` — 4 tes (own vs other-campaign + urutan service, empty-services
  LEFT JOIN, empty campaign, gate §5 forbidden/not-found/OD). Helper `seedService` + cleanup
  `services` di `afterEach`.

### 1.3 Berkas berubah
```
EDIT  packages/domain/src/marketing.ts          (Metrics.owner + computeMetrics)
EDIT  packages/domain/src/marketing.test.ts     (owner assertions)
EDIT  packages/domain/src/campaign.ts           (campaignClients + types + row iface)
EDIT  packages/domain/src/campaign.test.ts      (campaignClients block + seedService + cleanup)
BARU  apps/api/src/app/api/v1/marketing/campaigns/[id]/clients/route.ts
EDIT  apps/api/src/lib/wire.ts                   (owner_employee_id + CampaignClient*Wire)
EDIT  apps/api/src/lib/wire.test.ts              (marketingMetricsToWire .toEqual)
EDIT  apps/api/src/lib/shape-parity.test.ts      (2 registry entri)
EDIT  web-internal/src/lib/marketing.ts          (Metrics.owner_employee_id + CampaignClient* + getCampaignClients)
EDIT  docs/backlog/WAVE3_GAP_AUDIT.md            (STATUS SESI 3 + 2 temuan ✅)
EDIT  docs/DECISIONS.md                          (baris teratas 2026-08-19 SESI3)
BARU  docs/handoff/HANDOFF_WAVE3_GAP_AUDIT_SESI3.md (ini)
```

## 2. Verifikasi
- **api 359 hijau** (21 file — termasuk shape-parity + route-parity + wire + body-parity).
- domain **campaign 25** + **marketing 15** hijau (leads_campaign 18 sanity hijau).
- typecheck api & domain bersih; web-internal bersih **selain** error `xlsx` pra-ada di
  `riset-awal.ts` (bukan dari sesi ini — dicatat sejak SESI2).
- **NOL migrasi baru** — tak perlu `db-rebuild` untuk fitur ini (DB tetap 119/121).

## 3. BERIKUTNYA — urutan tutup (WAVE3_GAP_AUDIT.md §"Urutan tutup")
1. ✅ M13-G1 + M14-G1 (sesi 2) · ✅ M11-G3 (sesi 2) · ✅ M2-G1 + M3-G1 (sesi 3).
2. **Sisa B kecil** — M2-G3 (sort/flag low-ROAS, butuh threshold OKR M2-G2 → mungkin FE-owned),
   M2-G5 (assert `err.message` bukan cuma error class), M2-G6 (negative immutability test),
   M3-G2 (edit-field campaign PATCH — atau log out-of-scope), M3-G3 (assert BI blocked-transition),
   M3-G4 (restrict/log Marketing-Lead create broadening), M15-G1 (filter division-mix), M15-G2
   (`boardRef` di `MgmtRow`). ← **BERIKUTNYA.**
3. C OPEN → log keputusan / tes.
4. **Client Portal (M15 C-cluster) TERAKHIR** — diblokir O4+O5, ditunda pemilik. Jangan mulai.

## 4. Sumber kebenaran
- `docs/backlog/WAVE3_GAP_AUDIT.md` — semua temuan + status + urutan.
- `docs/DECISIONS.md` 2026-08-19 (SESI3 baris teratas).
- Kode: `packages/domain/src/{marketing,campaign}.ts`, `apps/api/src/lib/wire.ts`,
  `apps/api/src/app/api/v1/marketing/campaigns/[id]/clients/route.ts`,
  `web-internal/src/lib/marketing.ts`. Preseden: `campaignRollup`, `…/rollup` route.
- PRD `docs/prd/CDPS_Module{2,3}_*.md` (M2 §5 Rule 2, M3 §4 Rule 4 / Flow 2).
