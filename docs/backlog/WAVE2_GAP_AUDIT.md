# Backlog — Wave 2 Gap Audit (M12 · M7 · M8 · M9 · M10 · M6D)

> Dibuat 2026-08-18. Audit paritas PRD↔kode untuk enam modul delivery Wave 2 (semua
> sudah terbangun di TS via cutover). **Tak ada blocker keamanan/permission/immutability** —
> invariant inti (transition-engine only, audit append-only, derived-from-log, gate role) solid.
> Metode: satu agent per modul memetakan tiap Rule/Flow/pesan-BI/permission ke kode, diverifikasi.
>
> **Status: Kelas A + B SELESAI; C4–C7 SELESAI (SESI43); C1 SELESAI (bagian 1 SESI44, bagian 2 SESI45); B4-residual SELESAI (SESI46 — baseline gate KPI-GMV kini hidup dari `clients.total_sales`, DECISIONS 2026-08-19).** Sisa: **hanya C2/C3** yang tetap menunggu pipeline affiliate-link tracking (belum ada; jangan mulai tanpa keputusan pemilik baru).

## Kelas A — perbaikan bersih (SELESAI, teruji)

| # | Modul | Gap | Fix | Bukti |
|---|---|---|---|---|
| A1 | M6D | Angka otomatis di-agregasi **sekali** saat open (minggu kosong), tak pernah refresh → recap membeku angka nol di close (kedua jalur: AM `closeRecap` + auto force-close). PRD §9 minta "refreshed on demand"; STATE_MACHINES §15 "dibekukan as-of penutupan". | Trigger `trg_wrr_reaggregate_on_close` re-jalankan `wrr_aggregate` saat status→`Ditutup`/`Ditutup Otomatis` (satu tempat, kedua jalur). Upsert `wrr__upsert_metrik`/`wrr__upsert_divisi` di-hardening **skip baris sengketa** (RM Rule 7 — dispute membekukan angka). Migrasi `20260818010000_m6d_wrr_freeze_on_close.sql`. | +2 tes `recap.close.test.ts` (refresh non-sengketa; sengketa terjaga) |
| A2 | M9 | `failQC` & `escalate` tak mengemit notifikasi ke KOL Lead, padahal event `KOLQCFailedOrEscalated` (`m9.kol.qc_failed_or_escalated`) sudah terdaftar & modul saudara M10 mengemit analognya. | `kol.ts` emit event via callback `after` di `edge` (atomic dalam transaksi transisi, mirror `livestream.flagDiscrepancy`). | +1 tes `kol.test.ts` (failQC→lead, escalate→lead) |

**A3 (DIBATALKAN — false positive).** Audit M12 menandai `assetToWire` omitempty (`hours_logged`/`sla_target_hours`/`revision_sla_target_hours`/`attributed_gmv`) sebagai pelanggaran aturan wire O43. **Bukan bug:** FE (`web-internal/src/lib/creative.ts:71-74`) mendeklarasikan keempatnya **opsional**, dan tes `wire.delivery.test.ts:109` **sengaja** menguji omitempty ini sebagai paritas Go terdokumentasi di `DECISIONS.md`. Auditor M10 mengonfirmasi pola identik di `sessionToWire` = paritas disengaja. Membaliknya = memecah tes + melanggar keputusan tercatat.

## Kelas B — gap nyata, butuh keputusan pemilik (entri DECISIONS sebelum fix)

| # | Modul | Gap | Sifat keputusan |
|---|---|---|---|
| B1 | M9 | Kreator unresponsive di `[Content In Progress]` **buntu** — tak bisa escalate (butuh `[QC Review]`) maupun drop (hanya dari `[Escalated]`/`[Booked]`/`[Sourcing]`). Persis kasus "kreator hilang" yang modul ini ada untuknya. | State-machine spec-level (kode setia ke STATE_MACHINES §8). Butuh edge baru `[Content In Progress]→[Escalated]` + entri DECISIONS. |
| B2 | M9 | §10.1 memberi **Coordinator** hak "escalate when needed", tapi `canEscalate` kunci ke KOL lead/Director saja. | Konflik PRD §10.1 vs pola SPV-minimum (M12 `[Blocked]`-lock). Pilih satu, catat. |
| B3 | M12 | Flow step 4 menyebut `[Blocked]` sebagai salah satu keluaran reviewer dari `[In Review]`, tapi edge `[Blocked]` hanya ada dari `[In Progress]`. | Inkonsistensi **internal PRD** — Rules 2/7/8 + STATE_MACHINES §7 setuju dengan kode (blocked = pause saat In Progress). Kemungkinan koreksi PRD, bukan kode. |
| B4 | M8 | Target KPI di-set Advertiser sebagai field bebas saat create, tanpa gate approval AM/SPV (§4 Rule 1 / M8-OA-4 "Advertisers never self-set targets"). | ✅ **SELESAI (#183, DECISIONS 2026-08-18):** gate KPI-GMV < baseline × 1.20 ⇒ ACC SPV Ads. **Residual (baseline hidup dari reporting) ✅ SELESAI SESI46** (DECISIONS 2026-08-19): baseline efektif = `max(gmv_baseline statis, total_sales hidup)` × 1.20 setelah C1 memberi GMV hidup. |

## Kelas C — fitur/integrasi lintas-modul lebih besar (tiket tersendiri)

| # | Modul | Gap | Catatan |
|---|---|---|---|
| C1 | M10 | GMV live reconciled → sinyal GMV klien untuk Health Score (§6.2 #5, §5 Rule 1) belum terpasang. | ✅ **SELESAI** (bagian 1 SESI44, bagian 2 SESI45; DECISIONS 2026-08-19). Bagian 1: mesin `@cdps/core/report` + 3 tabel. Bagian 2: `packages/domain/src/report.ts` (`createReport` upload→parse→score→persist→**tulis `clients.total_sales` = Σ run-rate bulanan laporan terbaru per platform aktif + baris `audit_log`**; `listReports`/`getReport`/`renderReport`), rute `POST/GET /clients/{id}/reports` + `GET /reports/{id}` + `GET /reports/{id}/html?mode=`, wire `clientReport*ToWire`, panel FE `ReportPanel` di halaman klien. `clients.total_sales` kini punya penulis tunggal. |
| C2 | M9 | Attributed GMV diketik manual oleh Coordinator (`recordAttributedGmv`), bukan dari affiliate-link tracking (§10.3 "read-only, populated via trackable link, never estimated"). | Tema sama C1/C3: pipeline tracking link belum dibangun. Kontras M8 yang derive dari metric rows immutable. |
| C3 | M7 | Monthly review-and-lock Attributed GMV (§8 Rule 3 / M7-OA-4 — provisional s.d. lock bulanan). | Scope M8/M13; sebagian tercakup deferral W2-M7-C1. |
| C4 | M8 | Eskalasi ROAS < target 2 periode berturut (§8 Rule 4 / M8-OA-5) hanya **flag pasif** di read, tak ada notif/log. | ✅ **SELESAI SESI43** (DECISIONS 2026-08-18 C4): event baru `m8.ads.roas_underperforming` (katalog v11, pemilik ACC), emit idempoten saat streak=2 → AM + SPV Ads. |
| C5 | M7 | Antrean Asset pribadi per-PIC lintas Brief (§3 Rule 2 / §9.1 "own Asset queue") — tak ada read/route. | ✅ **SELESAI SESI43** (DECISIONS 2026-08-18 C5): `listMyAssets` + `GET /assets/mine` + panel FE. |
| C6 | M9 | (a) Flag sourcing-stall dini (§4 Rule 4, Booking lewat separuh window). (b) Baris "total spend = Σ Agreed Rate" di laporan KOL bulanan (§9). | ✅ **SELESAI SESI43** (DECISIONS 2026-08-18 C6): (a) `sourcingStallFlagged` derived read-only + banner FE; (b) `monthlyKolReport` + `GET /kol/monthly-report` + section FE. |
| C7 | M6D | Field display auto RM-A5 (Service Aktif Minggu Ini) & RM-D4 (Keluhan Terkait) belum di read-model `getRecapDetail`. | ✅ **SELESAI SESI43** (DECISIONS 2026-08-18 C5+C7): diturunkan live di `getRecapDetail` + wire + FE. |

## Yang TIDAK dikerjakan di PR Kelas A
- Semua Kelas B & C (menunggu keputusan pemilik / tiket tersendiri).
- Perubahan API/wire/FE (nol — Kelas A murni domain + migrasi + tes).
