# KINERJA SALES BACKLOG (M0 §7.1 + Renewal)

> **Konteks/keputusan/desain lengkap: `docs/handoff/RENCANA_KINERJA_SALES.md`.**
> Berkas ini tetap status tiket **otoritatif** (jangan diduplikasi ke dokumen
> lain) — perbarui di sini setiap tiket baru selesai.
>
> Spec: `docs/prd/CDPS_Module0_Sales.md` §7.1/§8, `CDPS_Module1_Leads_Database.md` §7.
> Keputusan: `docs/DECISIONS.md` baris 2026-08-29 (cari "Kinerja Sales") — 5 baris
> Decided (R-03 = #5) + KS-1..KS-4 (semua terjawab; KS-4b masih Open).
> Bukan modul PRD baru — bagian M0 yang tidak pernah ditiketkan (nol hit di
> `docs/backlog/` sebelum berkas ini).

## 0. Status

| Stream | Isi | Status |
|---|---|---|
| A (S-01..S-05) | RLS fix + `sales_targets` + read-model + route + UI | ✅ SELESAI |
| B (R-01/R-02) | `contracts.jenis` + read-model renewal mix | ✅ SELESAI |
| B (R-03) | Domain + API renewal/cross-sell (propose/decide/resubmit/execute) | ✅ SELESAI — lihat §3 |
| B (R-04) | UI tombol "Perpanjangan / Cross Sell" di Client Record | ✅ SELESAI — lihat §3 |

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

### ✅ R-03 — dibangun (GARIS STOP dicabut, lihat `DECISIONS.md` Kinerja Sales #5)

| # | Isi | Catatan |
|---|---|---|
| R-03 | ✅ `packages/domain/src/renewal.ts` (baru) — `renewal_requests`/`renewal_proposals`/`renewal_proposal_lines`, mesin `renewal_request` (`RNW-`, `sm_machines` #30) | Migrasi `20260902020000_renewal_request.sql`. Paralel ke `sales.ts`'s attempt-anchored negotiation (nol `LEAD-`/`PRSP-` palsu, keputusan pemilik `#4`); harga baris dipatok ulang `sales.resolveProposalLine` (di-export ulang khusus). `proposeRenewal`/`resubmitRenewal`/`decideRenewal`/`executeRenewal`. GARIS STOP semula (`canWriteContract`/siklus Strategi+Plan baru) TIDAK PERNAH tersentuh — eksekusi menulis `CTR-`/`SVC-` langsung, permission `renewal.canWriteRenewal` berdiri sendiri, `contract.ensureContractForService` yang sudah ada memvalidasi/menerima Contract yang sudah terisi persis seperti Service kelahiran closing biasa. **KS-2**: eksekusi MENGGANTI SELURUH `client_sales_allocations` klien (bukan menambah) — kredit lama dihapus, kredit baru dari alokasi eksekusi ditulis; `clients.sales_pic_id`/`commission_payment_pic_id` ikut pindah. Tes: `packages/domain/src/renewal.test.ts` (23 kasus — permission unit, propose/decide/resubmit/execute penuh, KS-2 penggantian alokasi eksplisit termasuk split, chaining `contract_sebelumnya_id` lintas dua renewal, 404/Forbidden/NotClosable) |

**Terverifikasi dengan DB nyata:** `scripts/db-rebuild.sh --yes` — 150 migrasi, gate **133/37/30/65**, `rls_checks`/`ident_checks`/`immutability_checks`/`auth_claims_checks` semua PASS. Full suite: core (tidak disentuh), db (tidak disentuh), domain (2266 tes lolos termasuk `renewal.test.ts` 23/23 + `sales.test.ts` 57/57 tidak regresi), api (383 tes lolos, `shape-parity`/`route-parity` belum menyentuh renewal — lihat R-03b di bawah untuk rute API).

### ✅ R-03b + R-04 — route API + UI

| # | Isi | Catatan |
|---|---|---|
| R-03b | ✅ Route API renewal | `GET/POST /clients/{id}/renewals`, `GET /clients/{id}/renewals/{rid}`, `POST .../resubmit`, `POST .../decision`, `POST .../execute` — shell tipis atas `renewal.ts`. `RenewalWire`/`RenewalLineWire`/`RenewalDetailWire` di `wire.ts`; `renewal.*Error` sudah ter-map `http.ts` (reuse instance `sales.*Error`, nol perubahan `mapError`). Terdaftar `shape-parity.test.ts` `WIRE_TO_FE` + `FE_FILES`. `getRenewalDetail` (baru, `renewal.ts`) menambah "lines" ke `RenewalRequest` untuk layar review/decide/execute — dites `renewal.test.ts` |
| R-04 | ✅ UI tombol "Perpanjangan / Cross Sell" | `web-internal/src/lib/renewal.ts` (wrapper API, reuse `ProposalLineInput`/`ClosingParties`/`ClosingInstallmentInput` dari `sales.ts` — nol tipe duplikat) + `web-internal/src/components/clients/RenewalPanel.tsx` (self-fetching, pola `MilestonesSection`/`ReportPanel`), dipasang di `/clients/[id]`. Riwayat request + form ajukan (jenis, no-nego, editor jasa) + per-baris: decide (Sales Lead/Director) / resubmit (setelah Reject) / eksekusi (durasi+tanggal+alokasi+skema pembayaran, KS-2 dicatat eksplisit di label form "kredit ini MENGGANTI seluruh alokasi lama klien"). Notifikasi terpisah TIDAK ditambah — event catalog (Phase 0 v2 §9) FROZEN 15-event, dan `renewal_request` sudah mewarisi notifikasi state-machine standar (belum event bernama khusus; dicatat sebagai lingkup masa depan, bukan gap tersembunyi) |

**Terverifikasi dengan DB nyata:** `scripts/db-rebuild.sh --yes` — 150 migrasi, gate **133/37/30/65** tidak berubah dari R-03 (R-03b/R-04 nol migrasi baru). Full suite bersih (single clean run pasca rebuild — run kedua tanpa rebuild ulang mewarisi flakiness pre-existing `admin.test.ts`/`client.test.ts` dari akumulasi `audit_log`, tidak terkait perubahan ini): api 23/23 file (`shape-parity`/`route-parity`/`body-parity` semua PASS dengan endpoint renewal terdaftar), domain 65/66 file (1 skip UAT, `renewal.test.ts` 24/24), web-internal 27/27 file (374 tes, termasuk typecheck bersih atas `RenewalPanel.tsx`/`lib/renewal.ts`).

---

## 1. Yang tidak dikerjakan (lihat `DECISIONS.md` Kinerja Sales #1..#5 + §Open)

| Item | Status |
|---|---|
| Chat Pagi/Total/Sisa, Blaster, Jumlah Respon, Call | ❌ tidak dibuat — nol sumber CDPS |
| Istilah "Seller"/"Affiliator" | ❌ tidak diperkenalkan — Qualified/Non-Qualified dipertahankan |
| Tiering T1–T5 | ✅ KS-1 dijawab — TIDAK DIBANGUN, nilai komisi yang dihitung manual (ambang berubah per kuartal) |
| Notifikasi renewal bernama khusus | ⏸ tidak ditambah — event catalog FROZEN (Phase 0 v2 §9); `renewal_request` mewarisi notifikasi state-machine standar |
| Role type `Sales` di M14 + skor `PERF-` | ❓ KS-4b, Open — bobot 0 mengikuti preseden LT-32/LT-33 |
| Snapshot Level Sales per periode | ⏸ terima "level saat ini"; revisit hanya kalau level dipakai komisi/skor |
| Sheet ketiga (`19pfVwm…`) | ✅ KS-3 dijawab — rekap per campaign, sudah tercakup `salesperf.bySource` (View 3) |
