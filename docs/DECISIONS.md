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
| 2026-07-09 | Seluruh file PRD modul di-rename dari prefix `HRIS_` ke `CDPS_` + normalisasi nama file ke underscore (tanpa spasi); judul dokumen modul diubah `# HRIS —` → `# CDPS —`; istilah "HRIS" kini eksklusif untuk sistem HR eksternal (kontrak di `docs/HRIS_API_CONTRACT.md`). | Keseragaman penamaan, mencegah salah paham scope (lanjutan keputusan rename CDPS 2026-07-09). | Nerissa |
| 2026-07-09 | **S0-12 exit review — GO (engineering gate).** Gate teknis Sprint 0 lolos: `go vet` bersih, `go build ./...` bersih, seluruh test DB-backed hijau (11 paket), smoke `migrate up → seed → migrate down all` OK. Jalur demo S0-12 (login HRIS-synced → workspace role-mapped → entity berjalan di state machine dengan transisi diblokir + pesan BI + audit trail penuh → notifikasi in-app) tervalidasi via test. **Syarat sisa (non-teknis):** demo staging disaksikan head dev + Nerissa untuk sign-off manusia — tetap wajib sebelum go/no-go operasional final; keputusan GO ini adalah gate kualitas rekayasa, Wave 1 boleh mulai di branch fitur sambil menunggu witness. | Semua kriteria AC S0-01..S0-12 lolos otomatis; tidak ada blocker rekayasa untuk memulai Wave 1. Witness manusia tidak dapat dieksekusi oleh agent — dicatat sebagai syarat sisa, bukan blocker kode. | Yohan (via sesi build) |
| 2026-07-09 | **O1 RESOLVED — Service ID prefix = `SVC-YYYYMM-NNNN`.** Mengikuti pola registry house-convention (`docs/DATA_MODEL.md` §1 baris Service + catatan `*SVC-`). Master Service List entry tetap pakai `MSV-` (config berversi, entitas berbeda). | Butuh prefix konkret untuk W1-09 (Closing meng-generate Service IDs atomik). Nilai default sudah diusulkan di DATA_MODEL; diadopsi apa adanya, tidak menyimpang dari PRD. | Yohan (via sesi build) |
| 2026-07-09 | **W1-06 komisi — grammar `commission_rule` (PROVISIONAL, engineering default).** Parser ketat mendukung dua bentuk yang sudah ada di seed Sprint 0: `"<N>% of standard price"` (persentase dari harga standar layanan itu sendiri) dan `"flat Rp <N>"` (nominal tetap IDR). Bentuk lain ditolak dengan error (tidak menebak). Pembulatan: **round-half-up ke rupiah utuh** (tampilan `Rp. X.XXX.XXX,00` tanpa sen riil). | PRD/Phase0 §10 tidak mendefinisikan grammar/rounding; hanya 2 bentuk informal muncul di data seed. Parser ketat + log = tidak "diam-diam memilih". Menunggu konfirmasi grammar formal (lihat Open O14). | Yohan (via sesi build) — provisional |
| 2026-07-09 | **W1-09 alokasi — string BI baru diotorisasi (mengikuti preseden Sprint 0 yang mengarang string `[...]` tak-dipin-PRD).** Σ alokasi ≠ 100% ⇒ `[total alokasi sales harus 100%]`; salesperson closing > 5 ⇒ `[maksimal 5 salesperson per closing!]`. Konsisten pola bracket BI; PRD hanya menyebut aturannya tanpa mengutip string. | Butuh pesan konkret untuk enforcement server-side W1-09; PRD tidak mengutip verbatim. Preseden: HANDOFF_SPRINT0 §4 (string role/MSL baru). | Yohan (via sesi build) |
| 2026-07-09 | **O14 — grammar komisi tetap SEDERHANA (final).** Komisi riil bisa tiered dll, TAPI di sistem cukup 2 bentuk sederhana; perbedaan komisi antar-kuartal ditangani lewat **versioning MSL** (`effective_from` — deal mengunci versi pada tanggal closing), bukan grammar rumit. Tiered/aturan kompleks TIDAK diimplementasikan di v1. | Kompleksitas komisi bergeser tiap kuartal; versioning MSL sudah menangani perubahan periodik tanpa perlu grammar tiered. | Yohan |
| 2026-07-09 | **O15 — split komisi antar salesperson = % Sales Allocation (final).** Payout komisi antar ≤5 salesperson dibagi sesuai % Sales Allocation yang sama dengan closing achievement. Payout riil tetap di-recompute M5 atas amount terverifikasi. | Konsistensi satu angka alokasi untuk achievement & payout. | Yohan |
| 2026-07-09 | **O16 — `Negotiation - Rejected` dapat 2 outbound edge (final).** Tambah ke STATE_MACHINES.md §1 + config.go: `Negotiation - Rejected → Negotiation - Pending Approval` (proposal versi baru) dan `Negotiation - Rejected → Closed-Lost`. Update STATE_MACHINES.md DULU sebelum config.go (house rule). | Menyelaraskan narasi PRD §5 dengan tabel transisi. | Yohan |
| 2026-07-09 | **O10/O17 — string BI penolakan edit field terkunci = `[field ini terkunci, tidak bisa diubah]` (final).** Berlaku untuk Client Record (M4) maupun field pasca-submit Qualified Form (M0). | PRD tidak mengutip string; diotorisasi mengikuti preseden pola `[...]`. | Yohan |
| 2026-07-09 | **O11 — dua wording collision lead aktif: pakai default (final).** Import: `[lead sedang diproses oleh sales lain (nama)]`; registrasi manual: `[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama)]`. Verbatim per section. | Konfirmasi sengaja beda per konteks. | Yohan |
| 2026-07-09 | **O12 — default M1 dikonfirmasi (final).** Not-Qualified Reason = **multi-select**; `[Blocked - Duplikat]` = label intake (bukan node state machine LEAD). | — | Yohan |
| 2026-07-09 | **O13 — gate campaign import DIUBAH: auto-activate + log (final, override default lama).** Jika campaign belum `[Active]` tapi menghasilkan lead / menerima data impor, campaign **otomatis di-set `[Active]`** (menangani kasus tim lupa menyalakan campaign di CDPS) dan peristiwa auto-activate **dicatat di audit log**. Import TIDAK diblokir. | Realita operasional: tim sering lupa aktifkan campaign; leads tidak boleh hilang. Auto-activate + audit menjaga atribusi tanpa kehilangan data. | Yohan |
| 2026-07-09 | **O3 RESOLVED — Master Service List dikelola Head of Sales (final).** Menegaskan OD-2: hak edit MSL di Head of Sales (bukan salesperson individual). | Guardrail integritas komisi. | Yohan |

## Open

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| O1 | ✅ **RESOLVED** (lihat Decided): Service ID prefix = `SVC-YYYYMM-NNNN`. | — | — |
| O2 | Jumlah dev (BE/FE) yang dialokasikan → konversi relative sizing jadi timeline bertanggal. | Head dev | Timeline only |
| O3 | ✅ **RESOLVED** (Decided): Master Service List dikelola **Head of Sales**. | — | — |
| O4 | `mea-client-reporting` embeddable (iframe) atau tidak. | Cek teknis 1 hari | Wave 3 (M15) |
| O5 | Spec keamanan detail Client Portal (minimum sudah di Phase 0 v2 §11). | Head dev, tulis sebelum Wave 3 | Wave 3 (M15) |
| O6 | Spec migrasi data spreadsheet (leads/klien existing) + PIC per divisi. **Yohan akan kirim sample data menyusul** (2026-07-09) → parser/dry-run import W1-19 dibangun setelah sample masuk. | Yohan (sample menyusul) | Wave 1 UAT |
| O7 | CSAT capture mechanism (Phase 0 OA-6) — Satisfaction tetap N/A + redistribusi bobot sampai Phase 2. | Phase 2 | No |
| O8 | Validasi Task-SLA vs Brief-SLA (M12) + retuning threshold Revision Count per divisi. | Data live pasca Wave 2 | No |
| O9 | Target periode nyata untuk M14 (GMV Impact, Optimization Activity, Creator Count per staff) — Phase 0 OA-5 benchmark entry. | SPV Ads + OD, selama Wave 2 | Wave 3 (M14) |
| O10 | ✅ **RESOLVED** (Decided): string `[field ini terkunci, tidak bisa diubah]`. | — | — |
| O11 | ✅ **RESOLVED** (Decided): pakai dua wording default verbatim per section. | — | — |
| O12 | ✅ **RESOLVED** (Decided): Not-Qualified Reason multi-select; `[Blocked - Duplikat]` = label intake. | — | — |
| O13 | ✅ **RESOLVED** (Decided): campaign non-aktif yang menerima lead/impor → auto-activate + audit log (bukan blokir). | — | — |
| O14 | ✅ **RESOLVED** (Decided): grammar komisi tetap sederhana (2 bentuk); variasi kuartal via versioning MSL. | — | — |
| O15 | ✅ **RESOLVED** (Decided): split komisi = % Sales Allocation. | — | — |
| O16 | ✅ **RESOLVED** (Decided): tambah 2 edge dari `Negotiation - Rejected` (STATE_MACHINES.md dulu). | — | Wave 1 W1-08 (implementasi) |
| O17 | ✅ **RESOLVED** (Decided): sama seperti O10 — `[field ini terkunci, tidak bisa diubah]`. | — | — |
