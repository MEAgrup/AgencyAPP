# CDPS — Decision Log

> Every deviation from the PRD, every resolved ambiguity, every architecture choice: one row here. Claude Code: if the PRD is ambiguous or two modules conflict, STOP and add an **Open** row here instead of picking silently.

## Decided

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-09 | CDPS dibangun **standalone** (Golang modular monolith + React/Next + MySQL), terintegrasi tipis ke HRIS existing (employee sync + auth), bukan di dalam codebase HRIS. | Decoupling dari sistem HR kritis; satu sumber data karyawan; satu login; tim internal pegang stack yang sama. | Nerissa |
| 2026-07-09 | **M0 OD-1:** Module 4 `Sales PIC` = Primary Salesperson; field baru `Commission & Payment PIC` + `Sales Allocation` (read-only, Σ=100%) di Client Record. | Menjembatani closing multi-sales (max 5) dengan Client Record tanpa mengubah lock rules. | Nerissa |
| 2026-07-09 | **M0 OD-2:** Master Service List dimiliki divisi Sales, **dikelola Sales Head/SPV** (bukan salesperson individual); versioned & logged; deal mengunci versi harga pada tanggal closing; harga custom per deal tetap lewat approval negosiasi. | Guardrail integritas komisi (house convention §2.6): hak edit satu level di atas orang yang komisinya bergantung pada angka tersebut. | Nerissa (interpretasi guardrail oleh COO office — lihat Open #O3 jika maksud berbeda) |
| 2026-07-09 | **M0 OD-3:** Satu jadwal `INST-…`, dua audiens reminder — Sales/Commission PIC = collection ke klien; Finance = verifikasi & status otoritatif. | Menghapus dualisme reminder M0 vs M5 tanpa menghilangkan fungsi keduanya. | Nerissa |
| 2026-07-09 | **Notifikasi v1: in-app/workspace only** (Phase 0 v2 §9); tanpa email/WA; kanal bisa ditambah belakangan tanpa mengubah event producer. | Cukup untuk operasional internal; menghindari kompleksitas integrasi WA di v1. | Nerissa |
| 2026-07-09 | Paket direname **CDPS** (bukan HRIS); HRIS = sistem existing terpisah. | Mencegah salah paham scope developer. | Nerissa (via COO office review) |
| 2026-07-09 | Build order: Sprint 0 → Wave 1 (M0,M1,M4,M5) → Wave 2 (M6,M12,M7,M8,M9,M10) → Wave 3 (M2,M3,M11,M13,M14,M15); wave gate ketat. | Money path dulu; M12 dibangun awal Wave 2 karena M7–M9 plug ke engine-nya. | Nerissa |

## Open

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| O1 | **Service ID prefix** belum pernah dieksplisitkan di PRD (usulan: `SVC-YYYYMM-NNNN`). | Konfirmasi Nerissa/Yohan saat ticketing M0 | Wave 1 ticketing M0 |
| O2 | Jumlah dev (BE/FE) yang dialokasikan → konversi relative sizing jadi timeline bertanggal. | Head dev | Timeline only |
| O3 | Konfirmasi interpretasi OD-2: apakah maksud awal "sales yang closing" = per-client service selection (sudah ada di Closing Form) — bukan edit master list. Default berjalan: guardrail di atas. | Nerissa | No |
| O4 | `mea-client-reporting` embeddable (iframe) atau tidak. | Cek teknis 1 hari | Wave 3 (M15) |
| O5 | Spec keamanan detail Client Portal (minimum sudah di Phase 0 v2 §11). | Head dev, tulis sebelum Wave 3 | Wave 3 (M15) |
| O6 | Spec migrasi data spreadsheet (leads/klien existing) + PIC per divisi. | Nerissa + ops, selama Wave 1 | Wave 1 UAT |
| O7 | CSAT capture mechanism (Phase 0 OA-6) — Satisfaction tetap N/A + redistribusi bobot sampai Phase 2. | Phase 2 | No |
| O8 | Validasi Task-SLA vs Brief-SLA (M12) + retuning threshold Revision Count per divisi. | Data live pasca Wave 2 | No |
| O9 | Target periode nyata untuk M14 (GMV Impact, Optimization Activity, Creator Count per staff) — Phase 0 OA-5 benchmark entry. | SPV Ads + OD, selama Wave 2 | Wave 3 (M14) |
