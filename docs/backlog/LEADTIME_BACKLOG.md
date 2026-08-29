# LEAD-TIME BACKLOG (M16 + M17)

> **Konteks/keputusan/desain lengkap: `docs/handoff/RENCANA_INDUK_M16_M17.md`.**
> Berkas ini tetap status tiket **otoritatif** (jangan diduplikasi ke
> dokumen lain) — perbarui di sini setiap tiket baru selesai.
>
> Spec: `docs/prd/CDPS_Module16_Lead_Time.md`, `docs/prd/CDPS_Module17_AI_Optimizer.md`
> Keputusan: `docs/DECISIONS.md` baris 2026-08-28/29 (cari `M16`) — 7 baris Decided + LT-1/2/3 + LT-4..LT-12/LT-14 Open
> Mesin: `docs/STATE_MACHINES.md` §18 (tahapan) + §19 (`REQ-`)

## 0. Status

| Fase | Isi | Status |
|---|---|---|
| 0 | Spec + keputusan | ✅ SELESAI |
| 1 | Registry divisi (Tahap F) | ✅ SELESAI |
| 2 | Pipeline tahapan + lead time | ✅ SELESAI (Akun A) |
| 2b | Metrik kecepatan + skor AM | ✅ SELESAI (Akun A) |
| 3 | Ads | ✅ SELESAI (Akun B) |
| 4 | `REQ-` + AI Optimizer | ✅ SELESAI (Akun B) |
| 5 | Portal vendor Live | (a) ✅ SELESAI · (b) ⬜ TERBLOKIR |
| 6 | Resolusi keputusan pemilik (LT-1..LT-11) | 🟡 BERJALAN — LT-1 (sebagian) / LT-3 / LT-4 ✅ terpasang 2026-08-29 |

---

## Fase 6 — Resolusi keputusan pemilik

Bukan pekerjaan baru: tiap baris di sini adalah satu pertanyaan §2 handoff yang dijawab
pemilik, dipasang sebagai **data** (migrasi seed/config), bukan desain baru. Yang belum
terjawab tetap berjalan dengan default amannya di produksi hari ini.

| # | Isi | Status |
|---|---|---|
| LT-1 | Bobot `kecepatan_review_am` di profil AM | 🟡 **SEBAGIAN** — bobot **10%** di-carve proporsional (45/22,5/22,5/10 → 40,5/20,25/20,25/9 + 10), Σ=100; PLUS target normalisasi **24 jam** ber-`is_placeholder=true` tanpa mana komponennya akan tetap dikecualikan dan keputusan ini jadi no-op. Migrasi `20260901010000_lt1_am_review_weight.sql`; test `performance.test.ts` "LT-1: proportional carve" / "LT-1: kecepatan_review_am carries its 10%" + integrasi `LT-32: kecepatan_review_am wiring`. **Sisa terbuka:** konfirmasi angka 24 jam, dan bobot `role_type` AI Optimizer + Store Operation (tetap Σ=0) |
| LT-2 | Daftar & urutan kerja Store Operation | ⬜ **MENUNGGU PEMILIK** — "akan saya berikan menyusul" (2026-08-29). Pipeline `STORE_OPS` sengaja masih kosong (Rule 12); menyeednya = satu migrasi, nol kode TS |
| LT-3 | Target 14 hk KOL: per-tahap atau gabungan | ✅ **SELESAI** — 14 hk hanya `Follow up Video Creator`; `QC & Approval Video Creator` → 1 hk (standar QC). Migrasi `20260901020000_lt3_kol_qc_target.sql`; PRD §4.3 + `STATE_MACHINES.md` §18 disesuaikan |
| LT-4 | Jalur kirim-ulang brief yang dikembalikan | ✅ **SELESAI** — edge `Brief Dikembalikan ke AM → Cek Brief AM` di 4 pipeline (kini 5, lihat LT-5) + `stage_definition` ber-`gate_pihak='AM'` (tanpa itu justru divisi, bukan AM, yang bisa mengirim ulang) + prop FE `isAmOwner` di `StageTimelinePanel`. Migrasi `20260901030000_lt4_kirim_ulang_brief.sql`; test `stage.test.ts` "LT-4: …" ×3 |
| LT-5 | Live Stream: tambah gerbang intake, nama baru | ✅ **SELESAI** — `stage_code` tetap literal `'Cek Brief AM'` (kontrak `reviewBrief`), `label='Terima Brief AM'` — kasus pertama label≠kode dipakai sungguhan (LT-7). Edge balik LT-4 ikut dipasang untuk Live (simetri). FE: `isAmOwner={canManageLiveStream(role)}` di halaman detail Brief Live. Migrasi `20260901040000_lt5_live_terima_brief_am.sql`; test `stage.test.ts` "LT-5: …" ×2 + LT-60 test lama diupdate |
| LT-6 | Konfirmasi arti `gate_pihak='AM'` | ✅ **SELESAI** — dikonfirmasi gerbang PERAN (tetap terhitung lead time), nol kode berubah. Didokumentasikan `STATE_MACHINES.md` §18 |
| LT-7 | Label tampil tahap ≠ kode tahap? | ✅ **SELESAI** — dikonfirmasi aman dibiarkan identik; satu-satunya pengecualian sekarang adalah checkpoint intake Live Stream (LT-5) |
| LT-9 | Perluas skor AM ke portofolio AI Optimizer/Store Operation | ✅ **SELESAI** — `amPortfolioApprovedInPeriod` digeneralisasi ke `AM_PORTFOLIO_BRIEF_DIVISIONS = [Ads, AI Optimizer, Store Operation]` (KOL/Live Stream tetap di luar — entitas/mesin berbeda). Ini kode TS, bukan data. Test `performance.test.ts` "LT-9: …" ×2 |
| LT-2, LT-8 | Daftar Store Operation + alasan pengembalian brief-nya | ⬜ **MENUNGGU PEMILIK** — "menyusul". LT-8 sengaja ditahan agar dijawab bersama LT-2 |
| LT-10, LT-11 | Ads Management Date satuan hari · Routing Permintaan | ⬜ **MENUNGGU PEMILIK** — default aman sudah berjalan; lihat `docs/handoff/HANDOFF_M16_SESI_LANJUTAN.md` §2 |

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
| LT-20 | ✅ Migrasi `stage_pipeline` + `stage_definition` + `brief_stage_sla` + `brief_review` + kolom `briefs` + RLS | `20260830010000_m16_stage_schema.sql` |
| LT-21 | ✅ Seed `sm_machines`/`sm_edges`/`sm_terminal_states` per pipeline | `20260830020000_m16_stage_seed.sql` — Creative, KOL, Live, AI Opt ×2. Store Operation **kosong** |
| LT-22 | ✅ `packages/domain/src/stage.ts` | `advanceStage`, `reviewBrief` (Cek Brief AM), gate AM/KLIEN. **`p_entity_type='brief_stage'`** |
| LT-23 | ✅ `packages/domain/src/leadtime.ts` | `computeStageLeadTime` + `working_days_between` |
| LT-24 | ✅ Override SLA per brief | `stage.setStageSlaTarget`, gerbang `isLead(division)`, pola `setSlaTarget` |
| LT-25 | ✅ Route `apps/api` + `*ToWire` | `GET/POST .../briefs/{id}/stage[/review]`, ANCHOR WIRE A. `KNOWN_GAPS` tetap kosong |
| LT-26 | ✅ Guard `task.submitTask` | `MSG_STAGE_NOT_COMPLETE`, satu arah lewat `sm_terminal_states` |
| LT-27 | ✅ 5 event notifikasi + tick harian | `stage_overdue_tick` (`20260830030000`), idempoten lewat `notifications` (nol kolom/tabel penanda baru — HANDOFF §1.6) |
| LT-28 | ✅ FE: `StageTimelinePanel` (account/creative/kol/livestream brief detail) | Read-only timeline + Cek Brief AM + `advanceStage` UI ("Lanjutkan", LT-60) — `getStageOverview.nextStages` fills the "next edges" read gap this row used to note |

**Uji kunci:** `computeMetrics` untuk Brief yang sama wajib **identik** dengan sebelum fitur ini ada (bukti namespace `brief_stage` bekerja).

---

## Fase 2b — Metrik kecepatan + skor AM

| # | Isi | Catatan |
|---|---|---|
| LT-30 | ✅ `turnaroundKerjaHours` + `waktuAmBelumBukaHours` + `waktuAmReviewHours` (+ `speedScoreKerjaPct`) di `computeMetrics` | Pola `blockedMs()` digeneralisasi (`intervalMs`, "next transition" bukan "search ahead" — lihat komentar task.ts). `turnaroundHours` lama **tidak diubah** |
| LT-31 | ✅ Speed Score divisi pindah ke `speedScoreKerjaPct` | `previewCurrent` menghitung ulang live tiap request ⇒ periode berjalan otomatis terbarukan; snapshot periode tertutup (`runSnapshotJob`, fire-once + immutable) **tidak disentuh** |
| LT-32 | ✅ Component key `kecepatan_review_am`, **bobot 0** | `perf_kpi_weights` migrasi `20260830040000`. Rule 6 meredistribusi ⇒ nol skor bergeser (dibuktikan unit test murni) |
| LT-33 | ✅ `role_type` AI Optimizer + Store Operation, **bobot 0** | `perf_kpi_weights` migrasi sama; profil nyata dihitung (`briefDivisionCandidates`), hanya bobotnya 0 |

**Tidak ada angka bobot di kode** — semuanya lewat `perf_kpi_weights` Director-gated (Σ=100 ditegakkan server).

---

## Fase 3 — Ads

| # | Isi | Status | Catatan |
|---|---|---|---|
| LT-40 | State `Setting` pada mesin `ADC-` | ✅ | Migrasi `20260831010000` |
| LT-41 | Tipe Iklan | ✅ | GMV Max Product / GMV Max Live / TTAM — migrasi `20260831020000` |
| LT-42 | Ads Management Date | ✅ | `end_date` turunan (fungsi baru, nol kolom) — lihat `HANDOFF_M16_AKUN_B.md` untuk keputusan kolom+satuan yang perlu konfirmasi pemilik |
| LT-43 | Mini / Monthly / Content Analysis report | ✅ | Di atas mekanisme `ads_weekly_reports` — migrasi `20260831030000` |

---

## Fase 4 — `REQ-` + AI Optimizer

| # | Isi | Status | Catatan |
|---|---|---|---|
| LT-50 | Entitas `REQ-` + 3 jenis + prefix registry | ✅ | `packages/domain/src/req.ts` baru — migrasi `20260831040000`+`050000` |
| LT-51 | Seed divisi `AI_OPT` + 2 pipeline + `role_mappings` | ✅ | **Nol kode** — `role_mappings` sudah generik admin-managed sejak sebelum M16; pipeline milik Akun A |
| LT-52 | `asset_type` `AI Video` + `Optimasi SKU` | ✅ | Migrasi `20260831060000` — lihat HANDOFF untuk temuan "3 fungsi = 1 fungsi diredefinisi 3x" |
| LT-53 | Item MSL `AI Video` + `Optimasi SKU` | ✅ | Migrasi `20260831070000` |
| LT-54 | Sinkron SKU balik ke STRG | ✅ | `strategi.ts syncAiOptimizerSkuRevision` — **lihat HANDOFF untuk gap signifikan** (Rule 13(c) `asumsiGugur` membuat sync defer untuk klien dengan D-8) |
| LT-55 | Baris `wrr_divisi` AI Optimizer | ✅ | Migrasi `20260831060000` (sama dengan LT-52) |

Detail lengkap tiap tiket (keputusan implementasi, temuan, kontrak lintas-stream
untuk `stage.ts`): `docs/handoff/HANDOFF_M16_AKUN_B.md`.

> ⚠️ **LT-52 jebakan:** `asset_type` di-hardcode sebagai `count(*) FILTER (WHERE asset_type = …)` di
> `20260813040000_m6d_wrr_aggregate.sql`, `20260814040000_t3_ad_metrics.sql`,
> `20260814060000_t4b_cpl.sql`. Tanpa memperluas ketiganya, produksi AI Optimizer
> **tidak terhitung** di Rekap Hasil Mingguan.

---

## Fase 5 — Portal vendor Live

| # | Isi | Status |
|---|---|---|
| LT-60 | Input tahapan Live oleh tim internal atas nama vendor | ✅ **SELESAI** — gate `stage.canExecuteStage` yang sudah ada (division staff/lead Live Stream, atau Director); `StageTimelinePanel` dipasang di halaman detail Brief Live Stream + tombol "Lanjutkan" baru (`getStageOverview.nextStages`, `stage.test.ts` "getStageOverview.nextStages (LT-60)"). Nol migrasi baru. Detail: `DECISIONS.md` 2026-08-29 "LT-60 SELESAI" |
| LT-61 | Login vendor sendiri (realm auth eksternal) | 🔴 **TERBLOKIR** |

> 🔴 **LT-61 blocker nyata.** CDPS belum punya realm auth eksternal sama sekali. M15 Client
> Portal — satu-satunya portal eksternal — masih ditunda, diblok O4+O5 menunggu spec
> keamanan (`WAVE3_GAP_AUDIT.md`), dan Build Plan menempatkan portal paling akhir
> *setelah* spec itu. Memberi vendor pihak-ketiga login mendahului gate tersebut.
> LT-61 = workstream sendiri menunggu spec keamanan yang sama.

---

## Uji wajib (lintas fase) — ✅ SEMUA 14 diverifikasi saat langkah penggabungan (DB rebuild + full suite, 2026-08-29)

1. ✅ **Tidak-tercampur:** `computeMetrics` identik sebelum/sesudah tahapan aktif — bukti `entity_type='brief_stage'`. (`leadtime.test.ts`, `task.test.ts`)
2. ✅ **Registry:** `division_registry` (DB) ≡ konstanta TS. (`packages/db/src/division.registry.test.ts`)
3. ✅ **Paritas Fase 1:** suite existing lulus tanpa perubahan. (full suite hijau — lihat §14 di bawah)
4. ✅ **Hari kerja:** tahap mulai Jumat target 1 hk ⇒ jatuh tempo **Senin**; sisipkan tanggal ke `hari_libur` ⇒ jatuh tempo bergeser (kasus Lebaran). (`leadtime.test.ts` — "inserting a national holiday between the two dates shifts the due date (Lebaran case)")
5. ✅ **Gate klien:** menunggu Approval Sampel **tidak** menambah lead time divisi KOL. (`leadtime.test.ts` — "gate_pihak='KLIEN' is recorded but excluded from totalHariKerja (Rule 9)")
6. ✅ **Latensi AM:** PIC mulai Sen 09:00, submit Sel 09:00, AM buka Kam 09:00, approve Kam 11:00, SLA 24 jam ⇒ `turnaround`=**74** (tetap), `turnaroundKerja`=**24**, `waktuAmBelumBuka`=**48**, `waktuAmReview`=**2**, Speed kerja=**100%**. (`task.test.ts` — "matches the PRD §6.2 worked example exactly (SLA 24h)")
7. ✅ **End-Date Ads:** hold 3 hari lalu resume ⇒ `end_date` maju 3 hari; hold lagi 2 hari ⇒ maju 2 hari lagi. (`ads.test.ts` — LT-42 suite)
8. ✅ **Bobot nol:** dengan `kecepatan_review_am` bobot 0, skor tiap AM **identik** dengan sebelumnya. Lalu set bobot ⇒ Σ=100 ditegakkan server. (`performance.test.ts` — "LT-32/LT-33: a weight-0 component NEVER shifts the profile")
9. ✅ **Cutover:** `PERF-` periode tertutup **tidak berubah**; periode berjalan satu definisi untuk semua staff. (`performance.test.ts` snapshot-immutability suite, tidak disentuh M16)
10. ✅ **Divisi tanpa pipeline:** Brief ke Store Operation bisa didispatch, `Cek Brief AM` terukur, nol error. (`stage.test.ts` — "a Store Operation Brief is born with NO pipeline (Rule 12)")
11. ✅ **Extensibility:** seed pipeline Store Operation lewat migrasi baru **tanpa menyentuh kode TS**. (Rule 12 di `stage.ts` membaca `stage_pipeline` murni dari data — dibuktikan lewat item 10 memakai divisi TANPA baris seed)
12. ✅ **Transisi ilegal ditolak di DB** (mis. `Script → Jadwal Posting`). (`stage.test.ts` — `advanceStage(...'Jadwal Posting')` menolak dengan `ConflictError`, `sm_transition`)
13. ✅ **`route-parity.test.ts` dengan `KNOWN_GAPS` kosong.** (`apps/api/src/lib/route-parity.test.ts` — `KNOWN_GAPS = new Set([])`)
14. ✅ **Fixture Alpha Digital** (`wave1_uat.e2e.test.ts`) tetap lulus — 31/31 langkah, `UAT=1` terhadap DB gabungan hasil merge Akun A + Akun B.

**Uji lintas-stream tambahan (§5 `PARALEL_M16_DUA_AKUN.md`, ditulis khusus untuk langkah penggabungan Akun B):** `packages/domain/src/m16_cross_stream.test.ts` — Brief AI Optimizer (`Optimasi SKU`) berjalan lewat pipeline tahapan NYATA milik Akun A (`stage.ts`, seed `AI_OPT_SKU`) sampai `Terapkan`, deliverable-nya (Asset `asset_type='Optimasi SKU'`) `[Approved]`, dan terhitung `jumlah_produksi=1` di `wrr_divisi` lewat `wrr_aggregate` milik Akun B — satu jalur yang menyentuh kedua stream sekaligus, bukan duplikat cakupan test per-stream. ✅ Lulus.

## Aturan operasional

- Migrasi **hanya** lewat `supabase/migrations/**` + `supabase db push` / `apply_migration`. **Jangan `psql -f`** (penyebab drift O38). DB lokal dibangun ulang hanya via `scripts/db-rebuild.sh`.
- `backend/**` tidak disentuh (Go sudah dipensiunkan; hanya oracle paritas).
- Mesin `brief_task`, `BKG-`, `LSS-` tidak dibongkar.
