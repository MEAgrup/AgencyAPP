# 🔗 Wave-3 FE↔API Contract Smoke — 5 modul (M2/M3/M10/M13/M14)

_Dijalankan: 2026-07-27. Tujuan: pre-deploy check yang diminta di
`HANDOFF_WAVE3_PORT_M14_M15.md` §UPDATE — memastikan halaman `web-internal`
(dibuat sebelum merge Wave-3) masih cocok dengan route `/api/v1` yang baru
di-merge ke `main` (HEAD `1f0203a`, PR #55)._

## TL;DR

**Lolos — 0 mismatch.** Untuk kelima modul Wave-3, setiap panggilan klien FE
cocok dengan route API yang ter-merge pada **tiga level kontrak**: (1) path,
(2) HTTP method, (3) bentuk respons (pembungkus `{data:[]}` vs objek + nama
field snake_case dari `wire.ts`). Tidak ada drift path, tidak ada field yang
hilang/berganti nama.

Verifikasi ini **statis** (baca kedua sisi kontrak dari source) karena
deployment produksi masih di balik Vercel Deployment Protection dan belum ada
data QA ter-seed. Skrip smoke live tersedia untuk dijalankan ulang di staging —
lihat §"Cara re-run".

## Peta modul → klien FE → route API

| Modul | Klien FE | Route dir API |
|-------|----------|---------------|
| M2 Marketing + M3 Campaign | `web-internal/src/lib/marketing.ts` | `apps/api/.../v1/marketing/**` |
| M10 Live Stream | `web-internal/src/lib/livestream.ts` | `apps/api/.../v1/{sessions,briefs,divisions}/**` (route generik, bukan prefix `/livestream`) |
| M13 Client Health | `web-internal/src/lib/health.ts` | `apps/api/.../v1/{clients/[id]/health,health}/**` |
| M14 Team Performance | `web-internal/src/lib/performance.ts` | `apps/api/.../v1/{performance,staff/[id]/performance}/**` |

> Catatan M10: FE tadinya diduga butuh folder `/livestream` — ternyata **tidak
> ada mismatch**. M10 sengaja memakai route generik `/sessions/*`,
> `/briefs/{id}/sessions`, dan `/divisions/{division}/brief-queue` (persis pola
> M8 Ads yang sudah shipping).

## Matriks kontrak per endpoint

Legenda: ✔ = path ada · method cocok · shape cocok.

### M2 Marketing + M3 Campaign (`marketing.ts`)
| FE fn | Method + path | Route | Shape (dari `wire.ts`) | |
|-------|---------------|-------|------------------------|---|
| `createCampaign` | POST `/marketing/campaigns` | `marketing/campaigns/route.ts` | `marketingCampaignToWire` → objek | ✔ |
| `listCampaigns` | GET `/marketing/campaigns` | idem | `{ data: Campaign[] }` | ✔ |
| `getCampaign` | GET `/marketing/campaigns/{id}` | `…/[id]/route.ts` | objek | ✔ |
| `getCampaignRollup` | GET `/marketing/campaigns/{id}/rollup` | `…/[id]/rollup/route.ts` | `campaignRollupToWire` → objek | ✔ |
| `transitionCampaign` | POST `/marketing/campaigns/{id}/transition` | `…/[id]/transition/route.ts` | `statemachine.Result` (tak diparse) | ✔ |
| `reassignCampaign` | POST `/marketing/campaigns/{id}/reassign` | `…/[id]/reassign/route.ts` | objek Campaign | ✔ |
| `createPerformanceRecord` | POST `/marketing/campaigns/{id}/performance` | `…/[id]/performance/route.ts` | `performanceRecordToWire` → objek | ✔ |
| `updateBudget` | **PATCH** `/marketing/campaigns/{id}/performance/budget` | `…/performance/budget/route.ts` (`export const PATCH = update`) | objek Record | ✔ |
| `getPerformance` | GET `/marketing/campaigns/{id}/performance` | `…/[id]/performance/route.ts` | `{ record, metrics }` | ✔ |
| `performanceDashboard` | GET `/marketing/performance-dashboard` | `marketing/performance-dashboard/route.ts` | `{ data: Metrics[] }` | ✔ |

### M10 Live Stream (`livestream.ts`)
| FE fn | Method + path | Route | | |
|-------|---------------|-------|--|--|
| `createSession` | POST `/briefs/{id}/sessions` | `briefs/[id]/sessions/route.ts` | objek Session (201) | ✔ |
| `listBriefSessions` | GET `/briefs/{id}/sessions` | idem | `{ data: Session[] }` | ✔ |
| `getSession` | GET `/sessions/{id}` | `sessions/[id]/route.ts` | objek Session | ✔ |
| `confirmSession` | POST `/sessions/{id}/confirm` | `sessions/[id]/confirm/route.ts` | Result | ✔ |
| `logResults` | POST `/sessions/{id}/results` | `sessions/[id]/results/route.ts` | Result | ✔ |
| `reconcileSession` | POST `/sessions/{id}/reconcile` | `sessions/[id]/reconcile/route.ts` | Result | ✔ |
| `flagDiscrepancy` | POST `/sessions/{id}/flag-discrepancy` | `sessions/[id]/flag-discrepancy/route.ts` | Result | ✔ |
| `reopenBrief` | POST `/briefs/{id}/reopen` | `briefs/[id]/reopen/route.ts` | `{ id, status }` | ✔ |
| `getBrief` | GET `/briefs/{id}` | `briefs/[id]/route.ts` | objek (borrowed M6 read¹) | ✔ |
| `listLiveStreamBriefQueue` | GET `/divisions/Live%20Stream/brief-queue` | `divisions/[division]/brief-queue/route.ts` | `{ data: [...] }` (borrowed M6/M12¹) | ✔ |

¹ `getBrief` / brief-queue adalah read pinjaman M6/M12 (di luar 5 modul port ini),
di-mirror 1:1 dari `lib/ads.ts` yang sudah shipping. Path + method terverifikasi
ada; shape objek Brief milik M6 (pre-existing), bukan artefak port Wave-3.

### M13 Client Health (`health.ts`)
| FE fn | Method + path | Route | Shape | |
|-------|---------------|-------|-------|--|
| `getTriggerScan` | POST `/health/snapshots/scan` | `health/snapshots/scan/route.ts` | `healthScanResultToWire` | ✔ |
| `getSnapshot` | GET `/clients/{id}/health[?period=]` | `clients/[id]/health/route.ts` | `healthSnapshotToWire` | ✔ |
| `getTrend` | GET `/clients/{id}/health/trend` | `clients/[id]/health/trend/route.ts` | `{ data: Snapshot[] }` | ✔ |
| `getPreview` | GET `/clients/{id}/health/preview` | `clients/[id]/health/preview/route.ts` | `healthSnapshotToWire` | ✔ |
| `getROASToggle` | GET `/clients/{id}/health/roas-toggle` | `clients/[id]/health/roas-toggle/route.ts` | `roasToggleToWire` | ✔ |
| `setROASToggle` | **PUT** `/clients/{id}/health/roas-toggle` | idem (`GET,PUT`) | `roasToggleToWire` | ✔ |

### M14 Team Performance (`performance.ts`)
| FE fn | Method + path | Route | Shape | |
|-------|---------------|-------|-------|--|
| `triggerPerformanceScan` | POST `/performance/snapshots/scan` | `performance/snapshots/scan/route.ts` | ScanResult | ✔ |
| `getStaffPerformance` | GET `/staff/{id}/performance[?period=]` | `staff/[id]/performance/route.ts` | `perfSnapshotToWire` | ✔ |
| `getStaffPerformanceTrend` | GET `/staff/{id}/performance/trend` | `staff/[id]/performance/trend/route.ts` | `{ data: Snapshot[] }` | ✔ |
| `getTeamRollup` | GET `/performance/teams/{division}[?period=]` | `performance/teams/[division]/route.ts` | `perfTeamRollupToWire` (objek) | ✔ |
| `getWeightsConfig` | GET `/performance/config/weights` | `performance/config/weights/route.ts` | `{ data: KPIWeight[] }` | ✔ |
| `updateWeightsConfig` | **PUT** `/performance/config/weights` | idem (`GET,PUT`) | `{ ok: true }` | ✔ |
| `getTargetsConfig` | GET `/performance/config/targets` | `performance/config/targets/route.ts` | `{ data: PeriodTarget[] }` | ✔ |
| `updateTargetsConfig` | **PUT** `/performance/config/targets` | idem (`GET,PUT`) | `{ ok: true }` | ✔ |

## Field-name check (nama snake_case FE == emisi `wire.ts`)

Diverifikasi field-by-field, semua cocok:

- `marketingCampaignToWire` → `Campaign` (perhatikan domain `owner` → wire
  `owner_employee_id`, `endDate` → `end_date` nullable). ✔
- `campaignRollupToWire` → `Rollup` (`total_value_won` + `_idr`). ✔
- `performanceRecordToWire` → `Record` (`budget` + `budget_idr`). ✔
- `marketingMetricsToWire` → `Metrics` (17 field + `junk_breakdown:[{reason,count}]`). ✔
- `sessionToWire` → `Session` (field result `omitempty` absen sampai `[Completed]`;
  `gmv` angka raw utk kalkulasi, render lewat `gmv_display`). ✔
- `healthSnapshotToWire` + `healthComponentToWire` → `Snapshot`/`Component`
  (`final_health_score` nullable, `computed_at/by` omitempty di preview). ✔
- `roasToggleToWire` → `ROASToggle`; `healthScanResultToWire` → `ScanResult`. ✔
- `perfSnapshotToWire` + `perfComponentToWire` + `perfModifierToWire` →
  `Snapshot`/`SnapshotComponent`/`PerformanceModifier`. ✔
- `perfTeamRollupToWire` → `TeamRollup`+`TeamMember`; `perfWeightToWire` →
  `KPIWeight`; `perfTargetToWire` → `PeriodTarget`. ✔

## Cara re-run (live, di staging)

Skrip: `apps/api/scripts/wave3-contract-smoke.mjs`. Menandatangani JWT HS256
valid (pola sama seperti `auth-smoke.mjs`) lalu memanggil **setiap** endpoint
yang dideklarasikan klien FE, memastikan route ter-wire (bukan routing-404 /
405). Read-only untuk GET; mutation dipanggil dengan body kosong sehingga
berhenti di gate auth/validasi — **tidak menulis data**.

```bash
# butuh server apps/api yang jalan + secret JWT-nya
BASE=https://agency-app-api.vercel.app \
SUPABASE_JWT_SECRET=... \
node apps/api/scripts/wave3-contract-smoke.mjs
```

Jika target di balik Vercel Deployment Protection, sertakan bypass:
`BYPASS=<protection-bypass-token>` (dikirim sebagai
`x-vercel-protection-bypass`).

## Catatan untuk QA
- Kontrak path/method/shape **aman** — halaman FE Wave-3 tidak perlu perubahan.
- Yang tersisa untuk QA fungsional penuh (di luar scope smoke ini): seed data QA
  + jalankan skrip di atas terhadap staging setelah Deployment Protection dibuka.
</content>
</invoke>
