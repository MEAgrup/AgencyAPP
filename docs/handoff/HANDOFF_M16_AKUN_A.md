# HANDOFF — M16 Akun A ("Tahapan & Metrik")

> Berkas milik Akun A. Jangan diedit Akun B (§6 `PARALEL_M16_DUA_AKUN.md`).
> Update terus selama bekerja — status, ambiguitas baru, dan berkas Akun B yang
> menurut Akun A perlu diubah (jangan diedit sendiri).

## 0. Rencana kerja (urutan LT-20 → LT-33)

1. **LT-20** — migrasi skema: `stage_pipeline`, `stage_definition`,
   `brief_stage_sla`, `brief_review` + kolom `briefs.production_stage` /
   `briefs.stage_pipeline_code` + RLS. ✅ `20260830010000_m16_stage_schema.sql`
2. **LT-21** — seed `sm_machines`/`sm_edges`/`sm_terminal_states` + isi
   `stage_pipeline`/`stage_definition` untuk SEMUA 5 pipeline. ✅
   `20260830020000_m16_stage_seed.sql`
3. **LT-22** — `packages/domain/src/stage.ts` (baru): `resolvePipeline`,
   `advanceStage`, `reviewBrief`, gate AM/KLIEN.
4. **LT-23** — `packages/domain/src/leadtime.ts` (baru): `computeStageLeadTime`.
5. **LT-24** — override SLA (`stage.setStageSlaTarget`, gerbang `isLead`).
6. **LT-25** — route `apps/api` + `*ToWire` di ANCHOR WIRE A.
7. **LT-26** — guard `task.submitTask`.
8. **LT-27** — 5 event notifikasi (dispatch/diterima/dikembalikan/butuh_aksi_am/
   lewat_target) + tick harian.
9. **LT-28** — FE: strip tahapan, kolom lead time, panel AM.
10. **LT-30** — `turnaroundKerjaHours` + `waktuAmBelumBuka` + `waktuAmReview` di
    `computeMetrics` (task.ts).
11. **LT-31** — Speed Score divisi pindah ke basis kerja.
12. **LT-32** — component key `kecepatan_review_am`, bobot 0.
13. **LT-33** — `role_type` AI Optimizer + Store Operation, bobot 0.

Status ter-update di bagian §3 di bawah setiap kali sebuah tiket selesai.

## 1. Keputusan desain yang TIDAK eksplisit di PRD/STATE_MACHINES (dipilih sadar, bukan diam-diam)

Bagian ini adalah kandidat baris `DECISIONS.md` baru — **jangan dipindahkan oleh
Akun A** (aturan emas §0.3); langkah penggabungan §5 yang memindahkannya.

### 1.1 "Brief Dikembalikan ke AM" = dead-end tak-terdaftar, bukan terminal resmi

PRD §2 Rule 11 mengunci guard `submitTask` ke "tahapannya mencapai state
terminal pipeline". `sm_terminal_states` murni introspeksi (komentar migrasi
`20260723055732`: "tidak dipakai enforcement"), jadi ia aman dipakai sebagai
sumber kebenaran guard TANPA mendaftarkan setiap dead-end di sana.

**Dipilih:** `Brief Dikembalikan ke AM` punya edge MASUK (dari `Cek Brief AM`)
di SETIAP pipeline yang punya gerbang itu, tapi **tidak didaftarkan** di
`sm_terminal_states`. Konsekuensi: guard LT-26 (yang mengecek keanggotaan
`sm_terminal_states`) tidak pernah salah meloloskan Brief yang dikembalikan
(belum dikerjakan) ke `[Submitted]`.

**Konsekuensi terbuka:** PRD tidak menspesifikasikan alur "AM memperbaiki
brief lalu minta divisi meninjau ulang". Karena `Brief Dikembalikan ke AM`
tidak punya edge KELUAR, Brief yang dikembalikan **mandek permanen** di tahap
itu sampai ada keputusan desain lanjutan (mis. re-dispatch membuat Brief BARU,
atau sebuah edge balik ke `Cek Brief AM` ditambahkan lewat migrasi susulan).
Tidak diblokir untuk merge — divisi tetap bisa memakai `brief_review` +
alasan untuk mengomunikasikan penolakan; hanya "kirim ulang otomatis" yang
belum ada. **Pertanyaan untuk pemilik** saat langkah penggabungan.

### 1.2 Live Stream tidak punya state `Cek Brief AM`

STATE_MACHINES §18 tabel pipeline menulis Live Stream sebagai
`Terima Sampel → Briefing Klien Live → Live Start` — TANPA `Cek Brief AM` di
depannya, walau PRD §2 Rule 10 bilang gerbang itu "wajib di semua divisi".

**Dipilih:** ikuti tabel pipeline literal (tidak menambah state yang tidak
diminta dokumen manapun). `brief_review` (keputusan Cek Brief AM) tetap
**universal** — divisi Live Stream tetap bisa mengisinya — tapi
`stage.reviewBrief` hanya menjalankan `sm_transition` kalau
`production_stage` brief PERSIS `'Cek Brief AM'`. Untuk Live Stream
(`initial_state = 'Terima Sampel'`) itu tidak pernah benar, jadi
`reviewBrief` pada Brief Live Stream menulis `brief_review` saja, tanpa
menggerakkan mesin. Rule 10 dan tabel pipeline sama-sama terpenuhi tanpa
kontradiksi: gerbang KEPUTUSAN universal (tabel `brief_review`), representasi
sebagai STATE bernama tidak.

**Pertanyaan untuk pemilik**: apakah Live Stream memang sengaja dikecualikan
dari state `Cek Brief AM`, atau ini kelalaian requirement yang perlu tabelnya
diperbaiki (menambah state via migrasi susulan, nol dampak kode TS).

### 1.3 `gate_pihak='AM'` = gerbang PERAN, bukan pengecualian lead time

PRD §2 Rule 9 dan STATE_MACHINES §18 hanya menyebut `gate_pihak='KLIEN'`
secara eksplisit sebagai "menghentikan jam" (dikeluarkan dari lead time
divisi). Enum kolom memuat `NULL | 'AM' | 'KLIEN'`, tapi makna `'AM'` tidak
pernah dielaborasi selain notasi `(gate AM)` di baris "Approve" pipeline
Optimasi SKU (STATE_MACHINES §18).

**Dipilih:** `gate_pihak='AM'` = gerbang PERAN (hanya AM pemilik klien atau
Director yang boleh menjalankan transisi KELUAR dari tahap itu di
`stage.advanceStage`), **bukan** pengecualian dari lead time. Alasan: latensi
AM sudah diukur terpisah lewat `turnaroundKerjaHours`/`waktuAmBelumBuka`
(§6 PRD) pada mesin `brief_task`; mengecualikannya JUGA dari lead time
`brief_stage` akan menghilangkan sinyal "tahap Approve lambat" dari AM tanpa
alasan yang PRD nyatakan eksplisit. Hanya `'KLIEN'` yang dikecualikan dari
`computeStageLeadTime` (leadtime.ts), sesuai teks Rule 9 yang literal.

**Pertanyaan untuk pemilik**: konfirmasi makna `gate_pihak='AM'` di atas.

### 1.4 `stage_definition.label` = identik `stage_code`

PRD §5.1 mendaftarkan `stage_code` dan `label` sebagai dua kolom terpisah,
tapi tidak satu pun dokumen (PRD/STATE_MACHINES/DECISIONS) memberi CONTOH di
mana keduanya berbeda — setiap checkpoint hanya punya SATU string BI (mis.
"Script", "QC Account Service"). **Dipilih:** `label` diisi identik dengan
`stage_code` di seed. Kalau nanti dibutuhkan kode pendek terpisah dari label
tampil, itu satu migrasi `UPDATE stage_definition SET stage_code = …`, tapi
mengubah `stage_code` SETELAH Brief berjalan berarti migrasi data pada
`briefs.production_stage` + `sm_edges` — jadi sebaiknya diputuskan sebelum
divisi pertama mulai memakai pipeline, bukan sesudah.

### 1.5 `division_registry.nama` untuk resolusi pipeline

`stage_pipeline.division_code` FK ke `division_registry(code)` (kode pendek),
sedangkan `briefs.assigned_division` menyimpan `nama` (label BI, Rule dual-home
Fase 1). `stage.resolvePipeline` menerjemahkan lewat `division.byNama(nama)?.code`
sebelum query `stage_pipeline`. Divisi yang tidak terdaftar di registry (tidak
mungkin terjadi karena `BRIEF_ASSIGNABLE_DIVISIONS` sendiri diturunkan dari
registry) mengembalikan `null` pipeline — sama seperti divisi terdaftar tanpa
baris `stage_pipeline` (Store Operation hari ini).

### 1.6 Idempotensi `tahap_lewat_target` lewat tabel `notifications`, bukan tabel/kolom baru

Daripada menambah kolom penanda + trigger beku (pola `internal_tasks`) atau
tabel ledger baru, tick harian `stage_overdue_tick` mengecek
`NOT EXISTS (SELECT 1 FROM notifications WHERE event_type = 'm16.tahap.lewat_target'
AND entity_id = brief.id AND created_at >= <waktu masuk tahap ini>)` sebelum
mengemit ulang. Ini otomatis "reset" setiap kali tahap berganti (waktu masuk
tahap baru selalu setelah notifikasi tahap lama), nol tabel/kolom tambahan,
nol trigger baru. Dicek: `notifications` sudah punya `entity_type`/`entity_id`/
`created_at`/`event_type` (skema `notify_emit`, migrasi `20260723055732`).

### 1.7 Alasan pengembalian brief untuk divisi tanpa daftar eksplisit

PRD §4.1/§4.3 hanya mendaftarkan alasan terstruktur untuk Creative (5) dan KOL
(2). Live Stream, AI Optimizer, Store Operation tidak punya daftar. **Dipilih:**
`stage.REASON_CODES_BY_DIVISION` hanya mendaftarkan Creative + KOL; divisi lain
yang memanggil `reviewBrief` dengan `keputusan='Dikembalikan'` boleh memakai
SATU KODE UMUM `'Brief kurang jelas'` (anggota union CHECK constraint DB) —
dipilih karena itu satu-satunya alasan yang muncul di KEDUA daftar existing,
jadi paling aman sebagai fallback generik. **Pertanyaan untuk pemilik** saat
daftar pekerjaan Store Operation & requirement Live/AI Optimizer datang.

### 1.8 `kecepatan_review_am` portofolio TIDAK diperluas ke AI Optimizer/Store Operation

`amRevisionEscalation`/`amReviewSpeedCandidate` berbagi satu gather
(`amPortfolioApprovedInPeriod`) yang portofolionya (Creative Assets + Ads
Briefs) SUDAH ADA sebelum M16 — bukan sesuatu yang M16 tentukan. Sejak M16,
Brief AI Optimizer dan Store Operation JUGA mengalir lewat mesin
`brief_task` yang sama (Submitted→In Review→Approved), jadi secara teknis
bisa saja dimasukkan ke portofolio "Task AM" yang sama.

**Dipilih: TIDAK memperluasnya di tiket ini.** Melebarkan
`amPortfolioApprovedInPeriod` ke dua divisi baru akan mengubah
`amRevisionEscalation` (komponen SKOR EXISTING dengan bobot 22,5% AM) untuk
SETIAP AM yang salah satu kliennya punya Brief AI Optimizer/Store Operation —
perubahan perilaku yang lebih besar dari lingkup "tambah dua komponen bobot
0". Karena `kecepatan_review_am` sendiri juga bobot 0 hari ini, TIDAK ADA
skor yang berbeda akibat pilihan ini either way — jadi ditunda ke keputusan
eksplisit berikutnya (dicatat, bukan diputuskan diam-diam). **Pertanyaan
untuk pemilik** saat langkah penggabungan / saat bobot mulai ditetapkan.

## 2. Berkas Akun B yang menurut Akun A perlu disentuh (JANGAN diedit sendiri)

- Tidak ada per saat ini. `stage_pipeline`/`stage_definition` (dipakai AI
  Optimizer, divisi milik B) sudah diseed lengkap oleh migrasi Akun A di atas
  — B tidak perlu menyentuh migrasi tahapan sama sekali, hanya
  `role_mappings`/`asset_type`/MSL miliknya sendiri (Fase 4).

## 3. Status per tiket — SEMUA SELESAI

- LT-20 ✅ `20260830010000_m16_stage_schema.sql` — 4 tabel baru + kolom `briefs` + RLS.
- LT-21 ✅ `20260830020000_m16_stage_seed.sql` — 5 mesin, sm_edges, stage_pipeline/stage_definition lengkap.
- LT-22 ✅ `packages/domain/src/stage.ts` — `resolvePipeline`, `advanceStage`, `reviewBrief`, `setStageSlaTarget`, `getStageOverview`, `runStageOverdueTick`.
- LT-23 ✅ `packages/domain/src/leadtime.ts` — `computeStageLeadTime` (+ `intake`).
- LT-24 ✅ `stage.setStageSlaTarget`, gerbang `isLead`.
- LT-25 ✅ `GET/POST .../briefs/{id}/stage[/review|/advance|/sla]`, wire di ANCHOR WIRE A, `StageOverviewWire`/`StageDefWire`/`StageLeadTimeRowWire` + FE mirror `web-internal/src/lib/stage.ts` (dibutuhkan `shape-parity.test.ts` — lihat §4 baru di bawah).
- LT-26 ✅ `task.ts` `validateStageComplete` + `MSG_STAGE_NOT_COMPLETE`.
- LT-27 ✅ `account.insertBrief` (brief_dispatched), `stage.reviewBrief` (diterima/dikembalikan), `stage.advanceStage` (butuh_aksi_am), `stage_overdue_tick` SQL (lewat_target) + `/internal/stage/tick` route + pg_cron 01:00 UTC.
- LT-28 ✅ **SELESAI PENUH** (lanjutan sesi ini). `web-internal/src/components/StageTimelinePanel.tsx` dipasang di `account/creative/kol` brief detail — timeline read-only + aksi Cek Brief AM + tombol `advanceStage` generik. Yang menutup celah "belum ada endpoint next-edges": `getStageOverview` sekarang mengembalikan `allowedTransitions` (`stage.ts`) lewat `engine.allowedTransitions` (`packages/domain/src/engine.ts`, LAMA — dipakai `sales.ts` untuk `AttemptDetail.allowedTransitions`, pola yang sama persis, nol helper baru) atas `private.sm_allowed_transitions` (SECURITY DEFINER, RLS-aman). Diwire ke `StageOverviewWire.allowed_transitions` (ANCHOR WIRE A) + FE mirror `stage.ts`. Panel merender satu tombol per edge yang dikembalikan — DB yang sama menolak `sm_transition` juga yang memutuskan tombol mana yang ada, jadi tombol dan guard tidak pernah berselisih. Gerbang render (bukan penegakan — server tetap final): `canReview` (staff/lead divisi eksekusi atau Director) untuk stage BUKAN `gate_pihak='AM'`; prop baru `isAmOrDirector` (dipasang di halaman `account/briefs/[id]` dari `isAMReviewer` yang sudah ada) untuk stage YANG `gate_pihak='AM'` (mis. `Approve` di `AI_OPT_SKU`) — populasi ini tidak tersedia di `creative`/`kol` sehingga defaultnya `false` di sana, aman karena pipeline mereka hari ini tidak punya stage gate AM. Tombol pada `Cek Brief AM` sengaja disembunyikan (aksi Terima/Kembalikan yang sudah ada yang menjalankannya, bukan tombol generik — dua jalur untuk transisi yang sama akan membingungkan).
- LT-30 ✅ `task.ts` `turnaroundKerjaHours`/`waktuAmBelumBukaHours`/`waktuAmReviewHours`/`speedScoreKerjaPct` — `intervalMs` (generalisasi `blockedMs`, **bug ditemukan+diperbaiki saat menulis tes**: pencarian "state tujuan tertentu" salah mengaitkan siklus revisi; diganti "transisi berikutnya" apa pun state-nya).
- LT-31 ✅ `creativeCandidates`/`adsCandidates`/`briefDivisionCandidates` memakai `speedScoreKerjaPct`. Periode berjalan otomatis ikut karena `previewCurrent` selalu menghitung ulang live; snapshot periode tertutup (`performance_snapshots`) fire-once + immutable, tidak tersentuh.
- LT-32 ✅ `COMP_KECEPATAN_REVIEW_AM`, `amReviewSpeedCandidate` (berbagi gather `amPortfolioApprovedInPeriod` dengan `amRevisionEscalation`), seed bobot 0 `20260830040000_m16_perf_weights_zero.sql`.
- LT-33 ✅ `ROLE_AI_OPT`/`ROLE_STORE_OPS`, `aiOptCandidates`/`storeOpsCandidates`/`briefDivisionCandidates`, `roleTypeOfDivision` diperluas, FE `ROLE_TYPES`/`DIVISIONS`/`KPI_COMPONENTS` (web-internal/src/lib/performance.ts) diperluas untuk config UI Director.

## 4. Berkas bersama yang disentuh DI LUAR daftar §3 PARALEL_M16_DUA_AKUN.md (dan kenapa aman)

- `apps/api/src/lib/shape-parity.test.ts` — tambah `WIRE_TO_FE` entries + `FE_FILES` (`stage.ts`) untuk 5 interface baru. Mekanisme test murni tambahan (menambah baris, bukan mengubah baris existing) — nol risiko konflik dengan Akun B kecuali B kebetulan menambah baris di titik yang SAMA persis; kalau begitu, "keep both" (pola `packages/domain/src/index.ts` §4).
- `apps/api/src/lib/wire.test.ts` / `wire.delivery.test.ts` / `wire.plan.test.ts` — fixture `account.Brief`/`task.Metrics` diperluas 2/5 field baru (tipe TS menuntutnya). Murni penambahan properti pada literal existing, bukan perubahan assertion.
- `web-internal/src/lib/account.ts`, `web-internal/src/lib/tasks.ts` — dua field baru pada `Brief`/`Metrics` (mirror `BriefWire`/`MetricsWire`).
- `web-internal/src/lib/performance.ts` — `ROLE_TYPES`/`DIVISIONS` diperluas (LT-33) + `KPI_COMPONENTS` +`kecepatan_review_am` (LT-32). Murni tambahan, tidak menghapus entri.
- `supabase/tests/rls_checks.sql` — ledger O48 diperluas 2 baris (`stage_pipeline_select`/`stage_definition_select`), dijustifikasi di komentar berkas itu sendiri (kelas sama `master_services_select`) DAN di §1 dokumen ini sebagai kandidat baris DECISIONS.

Tidak satu pun dari berkas ini disebut di §3/§4 `PARALEL_M16_DUA_AKUN.md`
sebagai milik atau perlu dijaga oleh Akun B — tapi dicatat di sini karena
Akun B ATAU langkah penggabungan bisa jadi menyentuhnya juga.

## 5. Verifikasi

DB nyata (Postgres lokal, `scripts/db-rebuild.sh --yes`): 132 migrasi, semua
gate (tabel 127, entity_prefix 36, sm_machines 28, notif_events 65) +
invariant (`ident_checks`, `immutability_checks`, `rls_checks`,
`auth_claims_checks`) lolos.

Test suite penuh dengan `DATABASE_URL` diset ke DB itu:
- `@cdps/core` 290/290
- `@cdps/db` 53/53
- `@cdps/domain` 1516/1517 (1 e2e skip, sama seperti sebelum M16) — termasuk
  `stage.test.ts` (17, baru), `leadtime.test.ts` (7, baru), penambahan di
  `task.test.ts` (+4) dan `performance.test.ts` (+4).
- `@cdps/api` 383/383 (termasuk `route-parity`/`shape-parity`/`body-parity`
  dengan endpoint + tipe FE baru terdaftar)
- `web-internal` 374/374, `tsc --noEmit` bersih di kelima paket, `eslint`
  bersih untuk seluruh berkas yang disentuh.

**Re-verifikasi sesi lanjutan (LT-28 `advanceStage` FE, lihat §3)** — ulang
dari nol, `scripts/db-rebuild.sh --yes`: 132 migrasi, gate/invariant identik
di atas lolos lagi. Test suite penuh:
- `@cdps/core` 290/290, `@cdps/db` 53/53 (tidak disentuh sesi ini).
- `@cdps/domain` **1517/1517** (1 e2e skip) — `stage.test.ts` 17→**18**
  (assersi `allowedTransitions` ditambah ke test existing + satu test baru
  untuk kasus `[]`: no-pipeline/terminal/`Brief Dikembalikan ke AM`).
- `@cdps/api` 383/383 (`shape-parity`/`route-parity`/`body-parity` tetap
  hijau dengan `StageOverviewWire.allowed_transitions` baru), `eslint -w
  @cdps/api --max-warnings 0` bersih.
- `web-internal` 374/374 (tidak ada test komponen baru — `StageTimelinePanel`
  tidak pernah punya test unit sebelumnya, pola berkas ini konsisten dengan
  `src/components/strategi/*.test.ts` yang hanya menguji helper murni, bukan
  render), `tsc --noEmit` bersih, `eslint` bersih untuk berkas yang disentuh
  (satu error pre-existing tak terkait di `admin/employees/page.tsx`,
  diverifikasi ada juga sebelum perubahan sesi ini).

Dua test domain (`admin.test.ts` "hari libur (integration)", `client.test.ts`
"Hold Service two-step") sempat gagal saat suite dijalankan BERULANG kali
tanpa `db-rebuild.sh` di antaranya (audit_log terakumulasi lintas run pada DB
lokal yang sama) — bukan flake lintas-file paralel, dan bukan disebabkan
perubahan sesi ini: direproduksi identik pada `git stash` (kode SEBELUM sesi
ini) dengan DB yang sama, dan hilang total setelah `db-rebuild.sh --yes`
ulang. Dicatat di sini supaya sesi berikutnya tidak salah menyimpulkan
regresi — cukup rebuild DB sebelum re-run, jangan reuse DB lintas beberapa
`npm test` berturut-turut untuk file yang menulis literal/tanggal tetap.

Tidak ada tes existing yang assertion-nya diubah — hanya fixture yang
diperluas field barunya (lihat §4).

## 6. Deviasi dari §4 `PARALEL_M16_DUA_AKUN.md` ("berkas F saja")

`scripts/db-rebuild.sh` (dan `.github/workflows/ci.yml` untuk konsistensi)
DINAIKKAN oleh Akun A untuk delta Akun A sendiri (tabel 123→127, sm_machines
23→28), menyimpang dari anotasi "F saja" di §4 tabel berkas bersama. Alasan:
instruksi tugas eksplisit meminta `scripts/db-rebuild.sh --yes` dibuktikan
hijau dengan DB nyata SEBELUM push — itu tidak mungkin tanpa gate-nya
mencerminkan tabel/mesin yang baru ditambahkan. Akun B (atau langkah
penggabungan) menaikkan lagi di atas angka ini untuk delta Akun B — angka
aditif, bukan konflik semantik.
