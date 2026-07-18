# Handoff — Sesi 2026-07-17 D (GO gate exit Wave 2 + Wave 3: M3, M2, katalog, M11)

> Lanjutan `HANDOFF_SESSION_20260717C.md`. Dokumen lama tetap berlaku:
> `HANDOFF_WAVE2_SESSION3.md` (setup container + aturan worktree), `WAVE3_PLAN.md`
> (peta klaster Wave 3 — SUMBER urutan kerja sesi berikutnya).

## Status saat handoff

**Branch:** `claude/wave2-uat-gate-exit-asstfa` (dari main tip `8a3fd26`, PR #8–#10
sudah merged). Semua kerja sesi ini ter-push ke branch itu; PR BELUM dibuka.
Suite penuh fresh terakhir: **31 paket hijau, 0 skip** (`-p 1`, cdps_test).

## Keputusan manusia sesi ini

**GO — langkah 49 W2 (gate exit Wave 2) DIPUTUSKAN GO oleh Nerissa** via sesi ini
(AskUserQuestion; bahan = `W2_UAT_REPORT_20260717.md`). Tercatat DECISIONS
2026-07-17. **Wave 3 resmi terbuka.**

## Selesai sesi ini (semua QC orchestrator + suite fresh per klaster)

1. **Gap residual test M0 lunas** — `negotiation_flow_test.go` (8 test; test-only).
   Catatan interpretasi: double-submit Qualified terblokir PK `qualified_forms`
   dalam tx sebelum engine (efek sesuai M0 §4).
2. **`WAVE3_PLAN.md`** — peta klaster Wave 3 + titik keputusan.
3. **W3-M3-C1 Campaign core** — `module3_campaign`, migrasi 0030, rute
   **`/api/v1/marketing/campaigns`** (deviasi disetujui: `/api/v1/campaigns/{id}`
   milik frozen M8 ADC). Nol string BI baru.
4. **W3-CAT-1 pembukaan katalog Wave 3** — `EvHoursLoggedReminder` (event ke-15) +
   sweep end-of-day WIB `module7_creative.ScanHoursReminders` (pola M5), migrasi
   0031 (renumber dari 0030 executor), endpoint `POST /api/v1/assets/reminders/scan`.
   1 string BI baru disetujui. **Katalog kini FROZEN lagi (15 event).**
5. **W3-M3-C2 linkage** — origin/last-touch leads (kolom sudah ada sejak 0002!),
   gate O13 (Draft/Paused auto-activate + audit; Closed/Archived blokir verbatim),
   Channel→Source (peta incremental: `TikTok Ads → Leads - Iklan`), bulk `campaign_id`
   (deferral bulk.go tertutup), rollup derived `GET .../rollup`. Migrasi 0032 (index).
6. **W3-M2-C1 Marketing Performance Record** — budget 1:1 (0033), metrik derived:
   Attributed LAST-TOUCH + window 3 bulan (win date = audit `closing`), ROAS,
   Collected-ROAS (basis Amount Verified M5), CPL/CPRL/Quality, junk breakdown,
   div-zero `—`; dashboard split. Online/Offline SEKALI di campaigns. 1 string baru.

7. **W3-M11-C1 Unified Board** — `module11_board`: Dependency `DEP-` Brief↔Brief
   (Blocking/Informational; validasi same-client / no-dup / no-cycle BFS), status
   derived, **gate blocking pada transisi final Brief → `[Approved]`** (Resolved §6.3
   menang atas contoh §12; dua hook nil-guarded: M6 approve = tolak pesan template,
   M12 rollup = defer diam Rule 7), emisi `EvDependencySatisfied` fire-once via
   engine hook, My Tasks + Client Board universal columns §5.2. Migrasi 0034.
   8 string BI baru disetujui. **Deferral tercatat**: emisi utk source brief LS
   (close off-machine §10) belum ter-cover — edge non-blocking.

Detail tiap keputusan: entri DECISIONS 2026-07-17 (7 entri baru sesi ini).

## Pekerjaan sesi berikutnya (urutan WAVE3_PLAN)

1. **W3-M13-C1 Client Health** — snapshot bulanan WIB, redistribusi bobot (CSAT N/A),
   ROAS toggle, band + `EvClientBandDrop` (event sudah terdaftar).
2. **W3-M14-C1 Team Performance** — KPI profile per role, Client-Outcome Modifier,
   snapshot, `EvPerformancePublished`. O9 (target riil) → configurable + placeholder.
3. **W3-M15-C1 Team Portal**; **M15-C2 Client Portal TERAKHIR — DIBLOKIR O4+O5.**
4. Begitu file W1-19 masuk → import (dry-run dulu; lock `id_sequences`).
5. Opsional/nanti: emisi EvDependencySatisfied utk source LS off-machine (deferral
   M11 di atas); pertimbangkan buka PR branch ini utk review manusia.

## Menunggu manusia (tidak berubah kecuali #1 selesai)

| Apa | Siapa | Blocking |
|---|---|---|
| ~~Langkah 49 gate exit W2~~ ✅ **GO (Nerissa, sesi ini)** | — | — |
| O34 aktor produksi KOL/lead Creative/SPV Ads/staf LS | Yohan (+HR) | produksi M7–M9 |
| O35 model sub-tim Creative (3 keputusan) | Nerissa/Yohan (+HR) | klaster M7 terakhir |
| O33 aktor Finance produksi | Yohan | produksi M5 |
| O26 NIK+email Yohan & Nerissa (diberikan TERAKHIR) | HR/Yohan | produksi saja |
| **O5 security spec Client Portal** + **O4 cek embeddability** | head dev | **M15-C2** |
| O9 target periode M14 | SPV Ads + OD | tidak (configurable) |
| File import W1-19 + form pelengkap + `db_jasa.csv` | CRO/Finance/Sales | import riil |

## Pola kerja & environment (tetap)

Fable orchestrator/QC/revisi; executor Opus (fitur) / Sonnet (klaster kecil).
Worktree manual utk paralel (`git worktree add --detach`) + `CDPS_TEST_DSN` ke
`cdps_test2` **WAJIB dengan `?parseTime=true&multiStatements=true`** (tanpa itu
migrasi gagal → semua test SKIP diam-diam!). Test WAJIB `-p 1`; satu suite per DB.
Migrasi terakhir: **0034**. MariaDB bisa mati diam-diam (cek `service mariadb status`
bila ada SKIP "connection refused"). JANGAN `pkill -f` pola yang cocok shell sendiri
(kill by PID). Executor mati kena session limit → relaunch prompt sama setelah reset
(terbukti lagi sesi ini, W3-M2-C1). Setup container baru = HANDOFF_WAVE2_SESSION3 §Setup.
