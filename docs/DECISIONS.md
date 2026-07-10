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
| 2026-07-10 | **O1 resolved:** prefix ID Service = `SVC-YYYYMM-NNNN`. | Sesuai usulan DATA_MODEL.md; konsisten pola registry. | Yohan (2026-07-10) |
| 2026-07-10 | **O10 resolved:** komponen bulan `YYYYMM` pada semua ID dihitung dalam **WIB (UTC+7)** — generator mengonversi `at` ke WIB sebelum format (`ids.PeriodZone`). | Waktu bisnis MEA; deal closing malam akhir bulan masuk bucket bulan kalender operasional. | Yohan (2026-07-10) |
| 2026-07-10 | **O11 resolved:** `Closed-Lost` hanya dari `Negotiation - Rejected`. Lead gagal pra-nego tetap lewat `Not Qualified`. | Interpretasi paling ketat; sesuai encoding engine. | Yohan (2026-07-10) |
| 2026-07-10 | **O15 resolved:** 14 slug event notifikasi buatan dev (mis. `m0.negotiation.pending_approval_submitted`) disetujui **kanonik**, termasuk split `due_h3`/`overdue`. Modul Wave 1+ publish memakai nama ini; edge state-machine terkait diberi `Event` override agar match katalog. | §9 hanya prosa; butuh string stabil sebelum Wave 1 publish. | Yohan (2026-07-10) |
| 2026-07-10 | **Sprint 0 dev-level (S0-01…S0-11):** (a) test DB terisolasi per test-run (`cdps_test_<pkg>_<rand>`), SQL kompatibel MySQL 8 + MariaDB 10.11; (b) immutability audit log & notifikasi ditegakkan di storage layer via trigger `SIGNAL 45000`; (c) `audit.Entry.At` kosong ⇒ default `time.Now().UTC()` (lihat O17); (d) MSL disimpan full-snapshot per versi (`service_entry_versions` memuat name/price/commission/active), header `service_entries` = mirror denormalisasi; (e) MSL read terbuka untuk semua role internal ter-resolve (staff divisi lain butuh konteks delivery), write tetap Sales Head/SPV + Director; (f) `[Jatuh Tempo]` di-encode ganda sesuai teks PRD: flag paralel di TRX (§4), status di INST (§5); (g) label status byte-exact termasuk kurung siku (§4–§11) vs tanpa kurung (§1/§3); (h) session auth: token 32-byte acak, hanya SHA-256 hash disimpan, fail-closed saat HRIS down. | Keputusan level implementasi Sprint 0, tidak menyimpang dari PRD; dicatat agar konsisten dipakai wave berikutnya. | Dev (Claude Code session 2026-07-10) — review Yohan |

## Open

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| O2 | Jumlah dev (BE/FE) yang dialokasikan → konversi relative sizing jadi timeline bertanggal. | Head dev | Timeline only |
| O3 | Konfirmasi interpretasi OD-2: apakah maksud awal "sales yang closing" = per-client service selection (sudah ada di Closing Form) — bukan edit master list. Default berjalan: guardrail di atas. | Nerissa | No |
| O4 | `mea-client-reporting` embeddable (iframe) atau tidak. | Cek teknis 1 hari | Wave 3 (M15) |
| O5 | Spec keamanan detail Client Portal (minimum sudah di Phase 0 v2 §11). | Head dev, tulis sebelum Wave 3 | Wave 3 (M15) |
| O6 | Spec migrasi data spreadsheet (leads/klien existing) + PIC per divisi. | Nerissa + ops, selama Wave 1 | Wave 1 UAT |
| O7 | CSAT capture mechanism (Phase 0 OA-6) — Satisfaction tetap N/A + redistribusi bobot sampai Phase 2. | Phase 2 | No |
| O8 | Validasi Task-SLA vs Brief-SLA (M12) + retuning threshold Revision Count per divisi. | Data live pasca Wave 2 | No |
| O9 | Target periode nyata untuk M14 (GMV Impact, Optimization Activity, Creator Count per staff) — Phase 0 OA-5 benchmark entry. | SPV Ads + OD, selama Wave 2 | Wave 3 (M14) |
| O12 | **SM §1: source-set auto `[Closed - Kalah Kompetisi]`** tidak dienumerasi ("pool competitors on win"). Encoded: 7 state pursuit aktif (New Lead … Negotiation - Auto Approved). | Nerissa | Wave 1 (M1 W1-03) |
| O13 | **SM §6: status "done" Service tidak bernama** ("done state per Brief rollup") dan tidak ada status Service-voided (label `[Cancelled — Service Voided]` milik Brief, bukan Service). Mesin Service saat ini berhenti di `[In Execution]`, tanpa terminal. | Nerissa | Wave 2 (M6) |
| O14 | **SM §8/§9: target resolusi `[Escalated - Creator Unresponsive]`** ("AM/Lead decide" — memutuskan jadi apa?) dan target `CPR [Rejected]` "back to KOL" tidak bernama. Keduanya encoded tanpa edge keluar (blocked sampai diklarifikasi). | Nerissa/Head Account | Wave 2 (M9) |
| O16 | **Event ops** (`hris.sync.failed` setelah 2 kegagalan beruntun, `hris.employee.missing_from_sync`) tidak ada di katalog §9 dan belum punya recipient (role Admin/IT belum ada di Role Matrix). Pilih: tambah ke katalog + role admin, atau kanal ops terpisah di luar notification center. | Yohan | Sprint 0 exit (S0-12) |
| O17 | **`audit.Entry.At`**: apakah caller WAJIB selalu mengisi timestamp bisnis (semua metrik durasi turun dari timestamp ini), atau default now-UTC cukup? Terkait O10 (timezone). | Yohan | Wave 1 |
