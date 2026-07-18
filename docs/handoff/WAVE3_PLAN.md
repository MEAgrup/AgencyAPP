# Wave 3 — Rencana klaster (dibuka 2026-07-17, pasca GO gate exit Wave 2)

> Dasar: Build Plan §4 Wave 3 (M2, M3, M11, M13, M14, M15 — "Attribution, visibility
> & scoring"; Client Portal M15 TERAKHIR setelah security spec O5 + cek embeddability O4).
> GO gate exit Wave 2 = keputusan Nerissa 2026-07-17 (DECISIONS). Pola kerja tetap:
> Fable orchestrator/QC, executor Opus/Sonnet/Haiku, worktree manual bila paralel,
> test `-p 1`, satu suite per DB.

## Urutan implementasi (dependensi, bukan urutan epic Build Plan)

M3 core → M3 linkage (M1/M0) → M2 metrics → katalog+M11 → M13 → M14 → M15
(Team Portal dulu, Client Portal paling akhir). Alasan: M2 record 1:1 menempel
pada Campaign; M13/M14 membaca hasil M2/M3+Wave 2; M15 mengagregasi semuanya.

## Klaster

| # | Isi | Catatan desain |
|---|---|---|
| **W3-M3-C1 Campaign core** | Migrasi `0030_campaigns`; package `module3_campaign`: Create (wajib: Name, Channel, Online/Offline≥1, Start Date, Owner=creator; `CMP-` setelah validasi), transisi via engine (mesin §3 SUDAH terdaftar `config.go` `MCampaign`), End Date terisi saat `[Closed]`, reassign ownership (M3-OA-6, Marketing lead + Director, ter-audit), Get/List per visibilitas (staff own / lead semua / OD read-only / Director full), httpapi + permission test lengkap. | Channel free-text (M3-OA-2). TANPA linkage lead & TANPA performance record (klaster berikut). Nol event notifikasi M3. |
| **W3-M3-C2 Linkage M1/M0** | `leads.origin_campaign_id` (immutable) + `last_touch_campaign_id` (M1 §5); param campaign di Register/BulkImport (buka scoped-deferral `bulk.go`); **O13**: campaign belum aktif menerima import → **auto-activate + audit** (bukan blokir) — berlaku untuk edge legal `Draft/Paused→Active`; dari `Closed`/`Archived` edge tidak ada ⇒ blokir dengan `[campaign belum/tidak aktif, lead tidak bisa diimport]` (interpretasi dicatat di DECISIONS saat implementasi); Source auto-set dari Channel (M3 §2); stamp Origin Campaign ke Client saat closing (M0); rollup read-only campaign (Leads, Real, Clients won by Origin, Total value won); window atribusi 3 bulan pasca-Closed (M3-OA-4) berlaku pada metrik kredit — lineage Origin tetap distempel permanen. | Perhatikan divergensi sah Origin (M3 rollup) vs Last-Touch (M2 Attributed Sales) — M2-OA-2, by design. |
| **W3-M2-C1 Marketing Performance Record** | Record 1:1 Campaign (Budget wajib >0); Auto-Metrics read-only: Lead-by-Dashboard, Lead-Real-by-Sales (≥Qualified), Quality Rate, Attributed Sales (last-touch, basis closing value; window 3 bulan), CPL, CPRL, ROAS, **Collected-ROAS** (basis Amount Verified M5, M2-OA-5), junk breakdown (taksonomi NQ M1); div-zero → `—`; dashboard split staff/lead. | **Titik keputusan**: Online/Offline ada di field spec M2 §6.3 DAN M3 §6.3 (1:1) — usulan: simpan SEKALI di Campaign, record membaca via 1:1; log ke DECISIONS saat implementasi. Semua metrik derived, recompute-from-log test wajib. |
| **W3-CAT-1 Pembukaan katalog** | Satu-satunya pembukaan katalog Wave 3 (O29): registrasi `EvHoursLoggedReminder` + sweep end-of-day WIB M7 (pola `module5_finance/reminder.go`) → Creative staff dengan Asset aktif tanpa jam tercatat hari itu. 13 event v1 + `EvLeadCoPursuit` sudah terdaftar; M11/M13/M14 (`EvDependencySatisfied`, `EvClientBandDrop`, `EvPerformancePublished`) TIDAK butuh registrasi baru — hanya emisi saat modulnya dibangun. | Sesudah klaster ini katalog FROZEN lagi. |
| **W3-M11-C1 Unified Board** | Dependency entity (same-client, no-duplicate-active-pair, cek siklus graf; status derived Pending/Blocking/Satisfied), gate blocking di transisi final Target + pesan spesifik, emisi `EvDependencySatisfied` → Target Brief PIC; universal-column mapping (read-model lintas modul); My Tasks. | Implicit dependency Asset→Launch M8 sudah hardcoded (jangan diduplikasi sebagai baris user). |
| **W3-M13-C1 Client Health** | Snapshot job bulanan (WIB), Health Score + redistribusi bobot (CSAT N/A — OA-6 Phase 2), ROAS toggle, band + `EvClientBandDrop` → SPV. | Recompute-from-log; band drop = perpindahan band turun antar snapshot. |
| **W3-M14-C1 Team Performance** | KPI profile per role (bobot admin-configurable), Client-Outcome Modifier, snapshot bulanan, `EvPerformancePublished` → tiap staff. | **O9** (target periode riil) masih terbuka — bangun dengan target configurable, seed placeholder ditandai. |
| **W3-M15-C1 Team Portal** | Agregasi + block-approval queue (konsumsi M12) + Management Dashboard. | Boleh sebelum/paralel M13-M14 read-model tersedia. |
| **W3-M15-C2 Client Portal (TERAKHIR)** | Realm auth terpisah, allow-list data layer (BUKAN internal view yang dipangkas), embed/link-out `mea-client-reporting`. | **DIBLOKIR O5** (security spec, head dev) + **O4** (cek embeddability). Jangan mulai sebelum keduanya. |

## Titik keputusan manusia yang menyangkut Wave 3

- **O4** embeddability `mea-client-reporting` (cek teknis 1 hari) — blocking M15-C2.
- **O5** security spec Client Portal (head dev) — blocking M15-C2.
- **O9** target periode M14 (SPV Ads + OD) — non-blocking (configurable + placeholder).
- Lokasi penyimpanan Online/Offline (M2 vs M3, lihat W3-M2-C1) — diputuskan dev + log
  DECISIONS, eskalasi hanya bila Nerissa keberatan.
- Interpretasi O13 untuk `Closed`/`Archived` (lihat W3-M3-C2) — sama: log DECISIONS.

## Definition of Done per klaster — tidak berubah (CLAUDE.md + Build Plan §5)

Validasi server-side + BI verbatim; permission test per role (incl. layered OD/Director);
immutability history; derived recomputable; fixture Alpha Digital; event katalog sesuai;
`Rp. X.XXX.XXX,00`; ID `PREFIX-YYYYMM-NNNN`; suite `-p 1` fresh hijau sebelum push.
