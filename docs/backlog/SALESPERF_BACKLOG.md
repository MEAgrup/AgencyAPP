# KINERJA SALES BACKLOG (M0 §7.1 + Renewal)

> **Konteks/keputusan/desain lengkap: `docs/handoff/RENCANA_KINERJA_SALES.md`.**
> Berkas ini tetap status tiket **otoritatif** (jangan diduplikasi ke dokumen
> lain) — perbarui di sini setiap tiket baru selesai.
>
> Spec: `docs/prd/CDPS_Module0_Sales.md` §7.1/§8, `CDPS_Module1_Leads_Database.md` §7.
> Keputusan: `docs/DECISIONS.md` baris 2026-08-29 (cari "Kinerja Sales") — 4 baris
> Decided + KS-1..KS-4 Open.
> Bukan modul PRD baru — bagian M0 yang tidak pernah ditiketkan (nol hit di
> `docs/backlog/` sebelum berkas ini).

## 0. Status

| Stream | Isi | Status |
|---|---|---|
| A (S-01..S-05) | RLS fix + `sales_targets` + read-model + route + UI | ✅ SELESAI |
| B (R-01/R-02) | `contracts.jenis` + read-model renewal mix | ✅ SELESAI |
| B (R-03/R-04) | Pintu tulis renewal dari Client Record + UI | ⬛ **GARIS STOP** — lihat §3 |

---

## Stream A — Dashboard

| # | Isi | Catatan |
|---|---|---|
| S-01 | ✅ RLS Sales lead scope | Migrasi `20260901010000_rls_sales_lead_scope.sql` — arm `jwt_is_lead() AND jwt_division() = 'Sales'` pada `prospect_attempts_select` (dikembarkan `prospect_activities_select`), `clients_select` (sejajar arm Account), `transactions_select`/`installments_select` (sejajar arm Finance, dibangun dari definisi TERAKHIR `20260729032805`/`20260730091540`, bukan baseline stale — lihat `DECISIONS.md` Kinerja Sales #1). Tes: `packages/domain/src/reads_rls.test.ts` "S-01 (Kinerja Sales...)" (Sales lead vs staff vs lead divisi lain, keempat tabel dalam satu query gabungan) |
| S-02 | ✅ `sales_targets` | Migrasi `20260901020000_sales_targets.sql`. Nol prefix baru, kunci alami `(salesperson_id, period_start, period_kind)`. RLS `sales_targets_select` cermin `salesperf.scopeFor` |
| §3a | ✅ `sales_level_labels` | Migrasi `20260901030000_sales_level_labels.sql` — 6 baris jabatan→label. Dual-home dengan `salesperf.SALES_LEVEL_LABELS`, dijaga tes registry `salesperf.test.ts` "SALES_LEVEL_LABELS (§3a dual-home)" |
| S-03 | ✅ `packages/domain/src/salesperf.ts` (baru) | `canViewSalesPerf`/`scopeFor`/`bySalesperson`/`byMonth`/`bySource`/`listTargets`/`setTarget`. Reuse: `core/money` (proRata/format/parse/mul), `core/tz` (period/dateString/daysBetween), `finance.commissionAchievement` (shares sudah ter-alokasi), grouped query baru atas `prospect_activities` untuk breakdown Follow Up/Visit/Online Meeting (bukan `activity.effortCounts`, yang hanya total per attempt — lihat header berkas). Tes: `packages/domain/src/salesperf.test.ts` (12 kasus: unit gate + integrasi funnel/money/permission/recompute-from-log/OKR) |
| S-04 | ✅ Route API | `GET /api/v1/sales/performance[/monthly\|/sources]`, `GET\|PUT /api/v1/sales/targets`. Wire: `salesPerfRowToWire`/`salesPerfMonthRowToWire`/`leadSourceRowToWire`/`salesTargetToWire`/`toSetTargetInput` di `apps/api/src/lib/wire.ts`; `salesperf.ForbiddenError`/`ValidationError` terdaftar di `http.ts` `mapError`. Terdaftar `apps/api/src/lib/shape-parity.test.ts` `WIRE_TO_FE` + `FE_FILES` |
| S-05 | ✅ UI | `web-internal/src/app/(shell)/sales/kinerja/page.tsx` (4 tab: Per Sales/Per Bulan/Sumber Lead/Target) + `web-internal/src/lib/salesperf.ts`. `nav.ts` `ACQUISITION_LINKS` + `nav.test.ts` (3 titik: workspace Sales staff, simetri divisi lain, OD/Director) |

**Terverifikasi dengan DB nyata:** `scripts/db-rebuild.sh --yes` — 148 migrasi, gate **130/36/29/65** (tabel naik 128→130: `sales_targets` + `sales_level_labels`, nol prefix/mesin/event baru — `db-rebuild.sh` dan `ci.yml` diperbarui bersamaan), `rls_checks`/`ident_checks`/`immutability_checks`/`auth_claims_checks` semua PASS. Full suite: core (typecheck bersih, tidak disentuh), domain (`salesperf.test.ts` 12/12, `reads_rls.test.ts` 12/12, seluruh suite lain tidak disentuh), api (`shape-parity`/`route-parity`/`body-parity`/`gate-reachability` semua PASS), web-internal (`nav.test.ts` + 373 lainnya PASS).

---

## Stream B — Renewal & Cross-Sell

### ✅ Jalan sekarang (read-model saja)

| # | Isi | Catatan |
|---|---|---|
| R-01 | ✅ Migrasi `contracts.jenis` | `20260901040000_contracts_jenis.sql` — `jenis ∈ baru\|perpanjangan\|cross_sell` (default `baru`) + `contract_sebelumnya_id` nullable FK self. Backfill semua kontrak eksisting sebagai `baru`. Nol prefix baru, nol perubahan FK ke `strategi`/`services` |
| R-02 | ✅ Read-model | `salesperf.ts` membaca `contracts.jenis` per klien (weighted by `client_sales_allocations.basis_points`), mengisi `klienBaru`/`klienPerpanjangan`/`klienCrossSell`/`klienCount` di `SalesPerfRow`. Dicakup tes `salesperf.test.ts` "aggregates the full funnel..." (`klienBaru: '1.00'` dari fixture) |

### ⬛ GARIS STOP — berhenti sampai pekerjaan Account selesai

| # | Isi | Kenapa berhenti |
|---|---|---|
| R-03 | ⬛ Pintu renewal dari Client Record | Membuka `canWriteContract` (`contract.ts:141`, hari ini hanya AM pemilik/Account lead/Director) untuk Sales, **dan** setiap kontrak baru mewajibkan siklus Strategi+Plan baru (M6A Rule 2 "exactly one active Strategi per Contract", M6B B-02 "n periode Plan = n bulan kontrak") — mesin yang sedang diperbaiki paralel. Prasyarat: (1) pekerjaan Account Service mendarat `main`; (2) KS-2 (`DECISIONS.md` Open) — kredit alokasi + aturan komisi perpanjangan |
| R-04 | ⬛ UI tombol "Perpanjangan / Cross Sell" di `/clients/[id]` + notifikasi | Menunggu R-03 |

---

## 1. Yang tidak dikerjakan (lihat `DECISIONS.md` Kinerja Sales #3 + §Open)

| Item | Status |
|---|---|
| Chat Pagi/Total/Sisa, Blaster, Jumlah Respon, Call | ❌ tidak dibuat — nol sumber CDPS |
| Istilah "Seller"/"Affiliator" | ❌ tidak diperkenalkan — Qualified/Non-Qualified dipertahankan |
| Tiering T1–T5 | ❓ KS-1, Open — perlu definisi Cena |
| R-03/R-04 | ⬛ berhenti — lihat §3 |
| Role type `Sales` di M14 + skor `PERF-` | ❓ KS-4, Open — bobot 0 mengikuti preseden LT-32/LT-33 |
| Snapshot Level Sales per periode | ⏸ terima "level saat ini"; revisit hanya kalau level dipakai komisi/skor |
| Sheet ketiga (`19pfVwm…`) | ❓ KS-3, Open — tidak bisa diakses, minta dibagikan ulang |
