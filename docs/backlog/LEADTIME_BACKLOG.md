# LEAD-TIME BACKLOG (M16 + M17)

> Spec: `docs/prd/CDPS_Module16_Lead_Time.md`, `docs/prd/CDPS_Module17_AI_Optimizer.md`
> Keputusan: `docs/DECISIONS.md` baris 2026-08-28 (6 baris Decided + LT-1/LT-2/LT-3 Open)
> Mesin: `docs/STATE_MACHINES.md` §18 (tahapan) + §19 (`REQ-`)

## 0. Status

| Fase | Isi | Status |
|---|---|---|
| 0 | Spec + keputusan | ✅ SELESAI |
| 1 | Registry divisi (Tahap F) | ✅ SELESAI |
| 2 | Pipeline tahapan + lead time | ⬜ |
| 2b | Metrik kecepatan + skor AM | ⬜ |
| 3 | Ads | ⬜ |
| 4 | `REQ-` + AI Optimizer | ⬜ |
| 5 | Portal vendor Live | ⬜ (b) TERBLOKIR |

---

## Fase 0 — Spec ✅

| # | Isi | Status |
|---|---|---|
| LT-00 | PRD `CDPS_Module16_Lead_Time.md` + `CDPS_Module17_AI_Optimizer.md` | ✅ |
| LT-01 | `STATE_MACHINES.md` §18 (tahapan) + §19 (`REQ-`) | ✅ |
| LT-02 | `DATA_MODEL.md` — 6 entitas baru + 3 baris computation registry | ✅ |
| LT-03 | `DECISIONS.md` — 6 baris Decided (spec baru, kamus 12 istilah, pemetaan status, Speed Score + latensi AM, registry divisi, keputusan per divisi) + LT-1/2/3 Open | ✅ |

---

## Fase 1 — Registry divisi

| # | Isi | Catatan |
|---|---|---|
| LT-10 | ✅ Migrasi `division_registry` + seed | 6 divisi existing + AI Optimizer + Store Operation. `nama` = label lama apa adanya ⇒ **nol migrasi data** |
| LT-11 | ✅ `packages/core/src/division.ts` + registry test | `division.registry.test.ts` (set-equal SELURUH flag) + `division.test.ts` (pasangan kuota ↔ `TASK_CATALOG`) |
| LT-12 | ✅ Ganti 8 daftar duplikat | 5 backend (`account`×2, `strategi`, `recap`, `plan`) + 3 `web-internal` lewat modul baru `divisions.ts`. **`board.ts`/`performance.ts` TIDAK termasuk** — bukan daftar duplikat |
| F-4..F-7 | ✅ Choke point paralel | Katalog notif v12 (7 event, satu bump untuk kedua stream), prefix `REQ`, gate `db-rebuild.sh` + `ci.yml` (122→123 / 35→36 / 58→65), dua anchor `wire.ts` |

**Terverifikasi dengan DB nyata** (bukan skip): db-rebuild 128 migrasi + semua gate lolos; core 290/290, db 53/53, domain 1484/1485 (1 e2e skip), api 383/383, web-internal 374/374.

Dua tes diubah, keduanya asersi keanggotaan daftar: `notification.test.ts` v11→v12, dan `strategi.test.ts` "I-2 identik" → "setiap divisi ber-kuota wajib bisa dipilih di I-2" (Store Operation adalah tujuan dispatch sah tanpa `TASK_CATALOG`).

---

## Fase 2 — Pipeline tahapan + lead time (inti)

| # | Isi | Catatan |
|---|---|---|
| LT-20 | Migrasi `stage_pipeline` + `stage_definition` + `brief_stage_sla` + `brief_review` + kolom `briefs` + RLS | |
| LT-21 | Seed `sm_machines`/`sm_edges`/`sm_terminal_states` per pipeline | Creative, KOL, Live, AI Opt ×2. Store Operation **kosong** |
| LT-22 | `packages/domain/src/stage.ts` | `advanceStage`, `reviewBrief` (Cek Brief AM), gate AM/KLIEN. **`p_entity_type='brief_stage'`** |
| LT-23 | `packages/domain/src/leadtime.ts` | `computeStageLeadTime` + `working_days_between` |
| LT-24 | Override SLA per brief | Gerbang `isLead(division)`, pola `setSlaTarget` |
| LT-25 | Route `apps/api` + `*ToWire` | snake_case, `null` eksplisit — **jangan** `omitempty`. `KNOWN_GAPS` wajib tetap kosong |
| LT-26 | Guard `task.submitTask` | Tolak submit sebelum tahap terminal. Satu arah |
| LT-27 | 6 event notifikasi + tick harian | Termasuk `brief_dispatched` yang menutup gap lama |
| LT-28 | FE: strip tahapan, kolom lead time di board, panel AM | |

**Uji kunci:** `computeMetrics` untuk Brief yang sama wajib **identik** dengan sebelum fitur ini ada (bukti namespace `brief_stage` bekerja).

---

## Fase 2b — Metrik kecepatan + skor AM

| # | Isi | Catatan |
|---|---|---|
| LT-30 | `turnaroundKerjaHours` + `waktuAmBelumBuka` + `waktuAmReview` di `computeMetrics` | Pola `blockedMs()` pada rentang berbeda. `turnaroundHours` lama **tidak diubah** |
| LT-31 | Speed Score divisi pindah + hitung ulang periode berjalan | Periode tertutup **tidak disentuh** |
| LT-32 | Component key `kecepatan_review_am`, **bobot 0** | Rule 6 meredistribusi ⇒ nol skor bergeser |
| LT-33 | `role_type` AI Optimizer + Store Operation, **bobot 0** | Jalur yang sama |

**Tidak ada angka bobot di kode** — semuanya lewat `perf_kpi_weights` Director-gated (Σ=100 ditegakkan server).

---

## Fase 3 — Ads

| # | Isi | Catatan |
|---|---|---|
| LT-40 | State `Setting` pada mesin `ADC-` | State awal baru |
| LT-41 | Tipe Iklan | GMV Max Product / GMV Max Live / TTAM |
| LT-42 | Ads Management Date | `end_date` turunan = `start + durasi_jasa + additional_days + total_hari_hold` |
| LT-43 | Mini / Monthly / Content Analysis report | Di atas mekanisme `ads_weekly_reports` yang sudah ada |

---

## Fase 4 — `REQ-` + AI Optimizer

| # | Isi | Catatan |
|---|---|---|
| LT-50 | Entitas `REQ-` + 3 jenis + prefix registry | Deadline 1 hari kerja; keterlambatan turunan; `due_date` beku |
| LT-51 | Seed divisi `AI_OPT` + 2 pipeline + `role_mappings` | |
| LT-52 | `asset_type` `AI Video` + `Optimasi SKU` | ⚠️ **wajib** perluas 3 fungsi agregat SQL — lihat di bawah |
| LT-53 | Item MSL `AI Video` + `Optimasi SKU` | |
| LT-54 | Sinkron SKU balik ke STRG | **Revisi bernomor** lewat mesin `STRG-`; tidak menembus freeze/approval |
| LT-55 | Baris `wrr_divisi` AI Optimizer | |

> ⚠️ **LT-52 jebakan:** `asset_type` di-hardcode sebagai `count(*) FILTER (WHERE asset_type = …)` di
> `20260813040000_m6d_wrr_aggregate.sql`, `20260814040000_t3_ad_metrics.sql`,
> `20260814060000_t4b_cpl.sql`. Tanpa memperluas ketiganya, produksi AI Optimizer
> **tidak terhitung** di Rekap Hasil Mingguan.

---

## Fase 5 — Portal vendor Live

| # | Isi | Status |
|---|---|---|
| LT-60 | Input tahapan Live oleh tim internal atas nama vendor | ⬜ — dikerjakan **lebih dulu** agar lead time Live tidak tersandera |
| LT-61 | Login vendor sendiri (realm auth eksternal) | 🔴 **TERBLOKIR** |

> 🔴 **LT-61 blocker nyata.** CDPS belum punya realm auth eksternal sama sekali. M15 Client
> Portal — satu-satunya portal eksternal — masih ditunda, diblok O4+O5 menunggu spec
> keamanan (`WAVE3_GAP_AUDIT.md`), dan Build Plan menempatkan portal paling akhir
> *setelah* spec itu. Memberi vendor pihak-ketiga login mendahului gate tersebut.
> LT-61 = workstream sendiri menunggu spec keamanan yang sama.

---

## Uji wajib (lintas fase)

1. **Tidak-tercampur:** `computeMetrics` identik sebelum/sesudah tahapan aktif — bukti `entity_type='brief_stage'`.
2. **Registry:** `division_registry` (DB) ≡ konstanta TS.
3. **Paritas Fase 1:** suite existing lulus tanpa perubahan.
4. **Hari kerja:** tahap mulai Jumat target 1 hk ⇒ jatuh tempo **Senin**; sisipkan tanggal ke `hari_libur` ⇒ jatuh tempo bergeser (kasus Lebaran).
5. **Gate klien:** menunggu Approval Sampel **tidak** menambah lead time divisi KOL.
6. **Latensi AM:** PIC mulai Sen 09:00, submit Sel 09:00, AM buka Kam 09:00, approve Kam 11:00, SLA 24 jam ⇒ `turnaround`=**74** (tetap), `turnaroundKerja`=**24**, `waktuAmBelumBuka`=**48**, `waktuAmReview`=**2**, Speed kerja=**100%**.
7. **End-Date Ads:** hold 3 hari lalu resume ⇒ `end_date` maju 3 hari; hold lagi 2 hari ⇒ maju 2 hari lagi.
8. **Bobot nol:** dengan `kecepatan_review_am` bobot 0, skor tiap AM **identik** dengan sebelumnya. Lalu set bobot ⇒ Σ=100 ditegakkan server.
9. **Cutover:** `PERF-` periode tertutup **tidak berubah**; periode berjalan satu definisi untuk semua staff.
10. **Divisi tanpa pipeline:** Brief ke Store Operation bisa didispatch, `Cek Brief AM` terukur, nol error.
11. **Extensibility:** seed pipeline Store Operation lewat migrasi baru **tanpa menyentuh kode TS**.
12. **Transisi ilegal ditolak di DB** (mis. `Script → Jadwal Posting`), buktikan lewat `execute_sql`.
13. **`route-parity.test.ts` dengan `KNOWN_GAPS` kosong.**
14. **Fixture Alpha Digital** (`wave1_uat.e2e.test.ts`) tetap lulus.

## Aturan operasional

- Migrasi **hanya** lewat `supabase/migrations/**` + `supabase db push` / `apply_migration`. **Jangan `psql -f`** (penyebab drift O38). DB lokal dibangun ulang hanya via `scripts/db-rebuild.sh`.
- `backend/**` tidak disentuh (Go sudah dipensiunkan; hanya oracle paritas).
- Mesin `brief_task`, `BKG-`, `LSS-` tidak dibongkar.
