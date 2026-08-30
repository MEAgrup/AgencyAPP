# CDPS — Consolidated State Machines (source config for the transition engine)

> Extracted verbatim from the PRD modules. Every transition not listed is **blocked server-side** with the BI message noted (default: `[transisi status tidak diizinkan]`). Every transition logs actor + timestamp, immutable.

## 1. Prospect attempt (M0/M1)
`Pending Validation` → `New Lead` → `Contacted` → { `Qualified` | `Not Qualified` } ; `Qualified` → Negotiation states → { `Closed-Success` | `Closed-Lost` }
- Intake collision ⇒ `Blocked` (no updates possible). Pool competitors on win ⇒ `[Closed - Kalah Kompetisi]` (auto).
- `Qualified` only via successful Qualified Form submit; exit without submit ⇒ stays `Contacted`.
- Negotiation states: `Negotiation - Pending Approval` → { `Negotiation - Approved` | `Negotiation - Revision Required` | `Negotiation - Rejected` }; Revision Required → (accept ⇒ Approved) | (resubmit ⇒ Pending Approval, new version); `Negotiation - Rejected` → (resubmit ⇒ Pending Approval, new version) | `Closed-Lost` (DECISIONS O16); No-nego path ⇒ `Negotiation - Auto Approved`. Closing only from Approved/Auto Approved.
- **Edit Service sebelum closing** (M0 §5.1, keputusan pemilik 2026-08-07): `Negotiation - Approved` / `Negotiation - Auto Approved` → `Negotiation - Pending Approval` (versi proposal baru, `require_lead = false` seperti seluruh edge masuk Pending Approval yang digerakkan sales; migrasi `20260807040000_edit_service_reapproval.sql`). Edge ini HANYA dipakai revisi ber-harga **custom** — revisi dengan harga standar MSL menulis versi proposal baru **tanpa transisi status sama sekali**, jadi tidak melewati mesin ini.

### Log aktivitas prospek — SENGAJA BUKAN MESIN (keputusan pemilik 2026-08-06)
`prospect_activities` (`ACT-`) mencatat Follow Up / Jadwal Meeting / Online Meeting / Visit / Lainnya
dari status `Qualified` sampai state negosiasi terakhir. Ia **tidak punya kolom status**, tidak muncul
di `sm_machines`, dan tidak pernah menyentuh `prospect_attempts.status`: mencatat aktivitas BUKAN
transisi. Yang membatasinya bukan `sm_edges` melainkan gate status di `packages/domain/src/activity.ts`
(`ACTIVITY_ALLOWED_STATUSES`) — di luar rentang itu ditolak `[aktivitas hanya bisa dicatat setelah lead
qualified]`. Barisnya append-only (trigger `forbid_mutation` menolak UPDATE dan DELETE), sehingga metrik
"effort sampai closing" selalu bisa dihitung ulang dari log (aturan rumah #3/#4). Lihat `DECISIONS.md`.

## 2. Lead record (M1)
`[Pool]` (Marketing-imported, claimable) / active (scouted-owned) / `[Rejected]` / `[Not Qualified]` / `[Blocked - Duplikat]` (intake event).
- Duplicate of active external lead ⇒ reject row: `[lead sudah ada & sedang diproses, tidak diimport]` (attempt logged, not counted).
- Duplicate of Rejected/Not Qualified ⇒ reopen to `[Pool]`.
- Import gate: parent Campaign must be `[Active]`, else `[campaign belum/tidak aktif, lead tidak bisa diimport]`.

**`[Deleted]` — terminal (DEVIASI PRD, keputusan pemilik 2026-07-29, lihat `DECISIONS.md`).**
M1 tidak punya pintu hapus; ini ditambahkan atas permintaan pemilik. Tidak ada
`DELETE FROM leads` — "hapus" = transisi ke state terminal, jadi `audit_log` dan anak
`PRSP-`-nya tetap utuh (aturan rumah #3).

| From | To | Effect |
|---|---|---|
| active | `[Deleted]` | `require_lead` — ACC Head divisi asal lead (Director di mana saja) |
| `[Pool]` | `[Deleted]` | idem |
| `[Rejected]` | `[Deleted]` | idem |
| `[Not Qualified]` | `[Deleted]` | idem |

- Gate ada di **SQL**: keempat edge ber-`require_lead = true`, jadi `sm_transition` sendiri
  menolak staff dengan `[anda tidak memiliki akses untuk melakukan transisi ini]` —
  panggilan langsung via service-role tidak bisa memutari ACC.
- Dua pintu: sales **mengajukan** (`LDR-`, alasan wajib) → Head **ACC/tolak**. Satu antrian
  pending per lead, dijamin indeks `uq_ldr_one_pending`.
- **`[Closed-Success]` sengaja TIDAK diberi edge** ke `[Deleted]`: sudah klien, punya turunan
  uang (`CLI`/`TRX`/`INST`) ⇒ `[lead sudah menjadi klien, tidak bisa dihapus]`.
- **Tidak ada edge KELUAR** dari `[Deleted]`, termasuk untuk Director. Kalau hapus harus bisa
  dibatalkan, itu desain **restore** yang berbeda dan butuh keputusan tersendiri.
- Konsekuensi baca: `matchByPhone` **mengecualikan** baris terhapus (state terminal ⇒ intake
  tak punya langkah legal), `decideClaim` **memblokir** (`[lead sudah dihapus]`),
  `leadsDatabase` menyembunyikannya kecuali diminta `status='[Deleted]'` eksplisit.

## 3. Campaign `CMP-` (M3)
| From | To | Effect |
|---|---|---|
| Draft | Active | starts accepting leads |
| Active | Paused | stops accepting/attributing new leads |
| Paused | Active | resumes |
| Active/Paused | Closed | no new leads; late conversions attribute ≤ 3 months after Closed |
| Closed | Archived | read-only |
All else blocked: `[transisi status tidak diizinkan]`.

## 4. Transaction payment status (M5)
`[Menunggu Verifikasi]` → `[Terverifikasi - Sebagian]` → (further verifications) → `[Lunas]` (terminal)
- Lunas scheme: may jump `[Menunggu Verifikasi]` → `[Lunas]` in one verification.
- `[Jatuh Tempo]` = parallel flag per overdue installment (not a status); clears on verification.
- `[Bermasalah]` = dispute/reversal flag; resolution needs joint SPV Finance + SPV Account approval (M5-OA-5).
- **Routing gate:** Client releases to Account on first transition into `[Terverifikasi - Sebagian]` or `[Lunas]`. Before that, record visible to Finance only.
- **Transaction change (`TCR-`, M5-OA-7 — owner decision 2026-08-04, `DECISIONS.md`).** Changing the payment scheme / open schedule does **not** touch this machine: `payment_status` is untouched by the change, and `TCR-.status` (pending → approved/rejected/cancelled) is the request row's own field, not a machine status — the same modelling as `lead_delete_requests` and `demo_task_block_requests`. Two doors: SPV/Head Finance **files**, Director **ACCs** (only the ACC applies it). One pending per Transaction, guaranteed by the index `uq_tcr_one_pending`. Allowed until `[Lunas]` — verified installments and verification records are never replaced, so only the open part of the schedule is rewritten, and its Σ must equal Amount Outstanding.

## 5. Installment `INST-` (M5)
`[Belum Jatuh Tempo]` → `[Jatuh Tempo]` (due date passed unverified) → `[Terverifikasi]`; or `[Belum Jatuh Tempo]` → `[Terverifikasi]` directly. Transaction = `[Lunas]` only when ALL installments `[Terverifikasi]`.

## 6. Service (M6)
`[Awaiting Onboarding]` → `[Strategy Approved]` (plan-gated only; Direct services skip) → `[Briefed]` (first Brief created) → `[In Execution]` (any Brief leaves `[To Do]`) → done state per Brief rollup. Void Service (M4-OA-5): SPV/Account Lead approval; cascades child Briefs not yet `[Approved]` → `[Cancelled — Service Voided]`.
- **Hold Service DUA-LANGKAH (T-2 + T-2b / RM-2, keputusan pemilik 2026-08-14):** AM **mengajukan** `[In Execution] → [Hold Requested]` (`require_lead=false`); Head of Account **menyetujui** `[Hold Requested] → [On Hold]` atau **menolak** `[Hold Requested] → [In Execution]` (keduanya `require_lead=true`); **resume** `[On Hold] → [In Execution]` (`require_lead=true`). Edge langsung `[In Execution] → [On Hold]` (versi T-2 awal) DICABUT. Gate SIAPA di domain (`client.ts::requestHold`/`approveHold`/`rejectHold`/`resumeService`): request = AM pemilik / Account lead / Director; approve/reject/resume = Head of Account (Account Lead) / Director. Alasan **wajib** saat mengajukan. `[Hold Requested]` & `[On Hold]` **non-terminal**; `[Hold Requested]` masih dianggap **aktif** (klien tetap dibuka rekap sampai hold disetujui). **Tidak cascade** ke Brief/Asset/Campaign anak. Tiap langkah menulis `audit_log` + emit notif v8 (T-2c: request→Head of Account; approve/reject/resume→AM pemilik). Konsekuensi RM-2: klien yang **semua** service-nya `[On Hold]` tak dibuka rekap mingguan (`wrr_monday_job`, D-06) — TAPI **tetap muncul di Client Health report** dengan keterangan hold (`health.portfolio.onHold`). Migrasi `20260814030000_t2_service_hold.sql` (state On Hold + exclude recap + health flag) → `20260814080000_t2b_hold_twostep.sql` (state Hold Requested + jalur dua-langkah + notif v8).
- **Per-Service flag `Requires Strategy Plan`** (§2): inherited read-only from the Service Catalog (MSL) at closing and pinned on the Service row. `Yes` ⇒ Plan-gated, `No` ⇒ Direct.
- **Direct-breakdown guard (data-dependent, enforced in `module6_account`, NOT the config engine):** the edge `[Awaiting Onboarding]` → `[Briefed]` is the **Direct path only**. A Plan-gated Service (flag = `Yes`) may reach `[Briefed]` **only after** `[Strategy Approved]`; taking the direct edge while still `[Awaiting Onboarding]` is rejected with `[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]`. The config engine cannot see the per-row flag, so this gate is a code guard the Brief-creation cluster must call before driving that edge.

## 6a. Strategy & Plan `STR-` (M6 §4) — plan-gated services only
`[Strategy Drafting]` → `[Strategy Submitted for Approval]` → `[Strategy Approved]` (terminal)
| From | To | Who | Effect |
|---|---|---|---|
| `[Strategy Drafting]` | `[Strategy Submitted for Approval]` | owning AM (owner action, not lead) | AM submits the Plan for approval |
| `[Strategy Submitted for Approval]` | `[Strategy Approved]` | SPV/Head Account only (requireLead) | On approval the parent Service also transitions `[Awaiting Onboarding]` → `[Strategy Approved]` (§6) in the same transaction; `Approved By` recorded |
| `[Strategy Submitted for Approval]` | `[Strategy Drafting]` | SPV/Head Account only (requireLead) | Revision requested; `Revision Notes` mandatory; Revision Count +1 (derived from the audit log, never a stored tally) |
- One Strategy per Service (1:1, §4 Rule 1). Direct-path Services have **no** STR record (§4 Rule 6).
- Only `[Strategy Approved]` unlocks Brief creation for that Service (§4 Rule 5).
- The approval gate is division-specific (Account lead / Director), stricter than the engine's division-agnostic `requireLead`; the code checks it before the transition (mirrors the Void-Service gate).

## 6b. Strategi `STRG-` (M6A) — mesin #15, Full Store Management

`Draft` → `Diajukan` → (`Aktif` | kembali ke laci asalnya); `Aktif` → `Kedaluwarsa` | `Diarsipkan`.

| From | To | Who | Effect |
|---|---|---|---|
| `Draft` | `Diajukan` | AM pemilik (Direksi lolos) | Gerbang kelengkapan berjalan di transaksi yang SAMA (Rules 3/5/8/9/17 + minimum D-8/H-1); `diajukan_pada` dicatat |
| `Draft Revisi` | `Diajukan` | AM pemilik | Sama, untuk versi n+1 |
| `Diajukan` | `Aktif` | SPV / Head Account (requireLead) | Rule 12. Kalau ada `versi_sebelumnya_id` yang masih `Aktif`, versi itu diarsipkan di transaksi yang sama (Rule 13) |
| `Diajukan` | `Draft` | SPV / Head Account (requireLead) | Dikembalikan, catatan WAJIB, nomor versi TIDAK berubah (Rule 12) |
| `Diajukan` | `Draft Revisi` | SPV / Head Account (requireLead) | Idem untuk versi >1 — `sm_edges` tidak bisa melihat asal sebuah `Diajukan`, jadi domain yang memilih tujuan dari `versi_no` |
| `Aktif` | `Kedaluwarsa` | AM pemilik / SPV | Kontrak berakhir (Rule 14). Terminal |
| `Aktif` | `Diarsipkan` | AM/SPV (lewat persetujuan versi n+1) | Versi digantikan (Rule 13). Terminal |
| `Draft Revisi` | `Diarsipkan` | AM pemilik | Revisi dibatalkan sebelum diajukan — kalau tidak, `uq_strategi_inflight_per_service` terkunci selamanya |
| `Draft` | `Diarsipkan` | SPV (requireLead) | Draft v1 dibatalkan |

- **Satu versi = satu baris.** §7 PRD menuliskan `Aktif → Draft Revisi`, yang bertentangan dengan Rule 13 di dokumen yang sama ("version n stays Aktif until n+1 is approved"). Rule 13 yang dipakai; edge itu TIDAK didaftarkan. Dicatat di `DECISIONS.md` 2026-08-06.
- Rule 2 ditegakkan index parsial `uq_strategi_aktif_per_service`, bukan oleh kode.
- **Belum membuka gerbang Brief.** `account.guardBriefCreation` masih membaca entitas M6 §4 (`STR-`) yang dipakai halaman Service hari ini; penyambungannya ikut penggantian form (backlog A-05…A-09).
- Empat event notifikasi M6A belum diemisikan — katalog v2 masih menunggu tanda tangan (O55). Transisinya tetap tercatat penuh di `audit_log` lewat `sm_transition`.

## 6c. Vendor `VND-` (M6A §7) — master record bersama

`Aktif` ⇄ `Nonaktif`; keduanya → `Blacklist`; `Blacklist` → `Nonaktif`.

| From | To | Who | Effect |
|---|---|---|---|
| `Aktif` | `Nonaktif` | lead Account / Direksi (requireLead) | Vendor tidak lagi ditawarkan di picker E-8/F-4 |
| `Nonaktif` | `Aktif` | lead Account / Direksi | Diaktifkan kembali |
| `Aktif` / `Nonaktif` | `Blacklist` | lead Account / Direksi | Tidak dipakai lagi |
| `Blacklist` | `Nonaktif` | lead Account / Direksi | Jalan pulang, SENGAJA dua langkah |

- **`Blacklist` bukan terminal.** Kalau terminal, satu-satunya cara membatalkan blacklist yang salah adalah UPDATE mentah — persis yang dilarang aturan rumah #2.
- Semua edge `requireLead`: vendor dipakai bersama, satu AM tidak boleh mematikan vendor yang dibooking AM lain.
- Mesin ini TIDAK bernomor di PRD (M6A/6B/6C hanya menomori #15 Strategi dan #16 Plan; #17 sudah dipesan M6C §7 untuk dormansi Plan Satuan). Didaftarkan atas aturan rumah #2 — dicatat di `DECISIONS.md` 2026-08-06.

## 6d. Plan `PLAN-` (M6B §8) — mesin #16, periode Plan

`Terjadwal` → `Draft` (periode 1) → `Aktif` LANGSUNG (AM, tanpa persetujuan SPV — deviasi 2026-08-28); `Terjadwal` → `Aktif` (auto, periode 2..n); `Terjadwal` → `Menunggu Persetujuan` → `Aktif`; `Aktif` → `Ditutup` | `Ditutup Otomatis`.

| From | To | Who | Effect |
|---|---|---|---|
| `Terjadwal` | `Draft` | sistem/AM | Periode 1 dibuka untuk diisi (Rule 2) |
| `Draft` | `Aktif` | AM pemilik | **2026-08-28 (DEVIASI PRD DISETUJUI PEMILIK, `docs/DECISIONS.md`).** AM mengaktifkan periode 1 langsung — PA-7 (catatan pembuka) tidak lagi wajib, dan tidak ada lagi persetujuan SPV di antaranya |
| `Terjadwal` | `Aktif` | sistem (job 00:00 WIB) | Periode 2..n auto-aktif di tanggal mulainya (Rule 4). BUKAN requireLead: dijalankan service-role, bukan seorang lead |
| `Terjadwal` | `Menunggu Persetujuan` | sistem | Penyesuaian `Turun >10%` tertunda menahan aktivasi (Rule 4/9) |
| `Menunggu Persetujuan` | `Aktif` | sistem/SPV | Penyesuaian diselesaikan, atau kedaluwarsa di tanggal mulai ⇒ aktif dengan target Strategi asli (Rule 4) |
| `Aktif` | `Ditutup` | AM pemilik | Penutupan periode oleh AM (Rule 15) — GMV manual + semua baris terminal + review lengkap, transaksional |
| `Aktif` | `Ditutup Otomatis` | sistem | Force-close saat lewat jendela (Rule 5/15). Terminal |

- **Terminal:** `Ditutup`, `Ditutup Otomatis`.
- **Vestigial sejak 2026-08-28, TIDAK dihapus:** `Draft → Diajukan`, `Diajukan → Aktif` (requireLead), `Diajukan → Draft` (requireLead). PA-5 masih mendaftar `Diajukan` sebagai state yang sah, dan `approvePlanPeriode`/`returnPlanPeriode` masih kode yang berfungsi — tapi sejak `submitPlanPeriode` menargetkan `Aktif` langsung, tidak ada jalur normal manapun yang lagi menaruh periode ke `Diajukan`. `Disetujui`/`Dikembalikan` di PRD §8 **bukan state** — PA-5 tidak memuat keduanya; itu cara §8 (versi lama) menuliskan aksi "SPV setuju ⇒ `Aktif`" / "SPV kembalikan ⇒ `Draft`".
- **Hanya satu periode `Aktif` per rantai** (Rule 5) ditegakkan index parsial `uq_plan_aktif_kontrak`/`uq_plan_aktif_klien`, bukan oleh mesin.
- **Edge = data (B-01); GERBANG = domain (B-03, MENDARAT).** Mesin ini mendaftar transisi MANA yang sah; SIAPA yang boleh menekan tombol mana adalah `packages/domain/src/plan.ts`: `submitPlanPeriode` (`Draft → Aktif` langsung sejak 2026-08-28, AM pemilik, guard status eksplisit karena edge `Terjadwal → Aktif` yang sama juga dipakai job auto-aktivasi), `approvePlanPeriode`/`returnPlanPeriode` (vestigial, periode 1, gerbang `isLead(Account)` + guard status `Diajukan` eksplisit — edge `Draft → Aktif` baru membuatnya tidak cukup mengandalkan mesin saja, catatan wajib saat kembali), `activatePlanPeriode` (`Terjadwal → Aktif`, service-role, bukan lead). Semua lewat `transitionPlan` — pembungkus tunggal atas `sm_transition`. **Masih tiketnya:** KAPAN `Terjadwal` harus lewat `Menunggu Persetujuan` (penyesuaian `Turun >10%`) = B-04; job aktivasi/force-close 00:00 WIB = B-09.
- **Dormansi Plan Satuan = mesin #17** — MENDARAT (B-10), lihat §6e. Periode-nya sendiri tetap memakai mesin #16 ini apa adanya.

## 6e. Plan Satuan dormansi — mesin #17 (M6C §7, B-10)

`Aktif ⇄ Dorman`. Bukan status sebuah periode melainkan status **rantai** Plan Satuan per klien: ia hidup di kolom `plan_satuan.status_dormansi` (tabel rantai, PK `client_id`), bukan di `plan` — dormansi adalah fakta rantai, dan menaruhnya di tiap baris periode = n salinan (anti-pola `defisit_terbawa`). Digerakkan `sm_transition(machine='plan_satuan', id_col='client_id', status_col='status_dormansi')`.

| From | To | Who | Effect |
|---|---|---|---|
| `Aktif` | `Dorman` | sistem (job §10c) | Semua service satuan berakhir ⇒ periode berhenti tumbuh. `markPlanSatuanDormant` menolak selagi ada periode non-terminal (`[Plan Satuan tidak dapat didormankan selagi ada periode berjalan]`) |
| `Dorman` | `Aktif` | sistem/AM (via gate) | Service Plan-gated baru MEREAKTIVASI rantai yang SAMA (Rule 8, "keeps one continuous history") + membuka periode segar (`periode_no` lanjut, `Terjadwal`) |

- **BUKAN terminal.** `Dorman` bisa bangun lagi — mendaftarkannya terminal berarti satu-satunya jalan keluar adalah UPDATE mentah (langgar aturan rumah #2). Karena itu `sm_terminal_states` untuk `plan_satuan` KOSONG.
- Kedua edge `require_lead = false`: dormansi dijalankan job service-role; reaktivasi dijalankan saat AM menentukan service baru butuh Plan (gerbang kepemilikan di `plangate.decideGate`/`openOrJoinPlanSatuanTx`, bukan lead).
- **Rule 6 (buka/gabung)** bukan mesin ini: membuka rantai (baris `plan_satuan` + periode 1 `Draft`), menggabung (link ke periode berjalan), dan reaktivasi dijalankan `openOrJoinPlanSatuanTx`, dipanggil di transaksi `decideGate` saat `keputusan_am='butuh_plan'`. Hanya transisi `Aktif ⇄ Dorman` yang lewat mesin #17.

## 6f. Riset Awal — mesin #20 (langkah 1 "Kelola Klien", QA pemilik 2026-08-12)

`Berjalan → Selesai` (Selesai terminal). Hidup di `interview_riset_awal.status`, tabel anak 1:1 dari `interview`
(PK `interview_id`, tanpa prefix ID sendiri), digerakkan `sm_transition(machine='riset_awal', table='interview_riset_awal', id_col='interview_id')`.

| From | To | Who | Effect |
|---|---|---|---|
| *(baris lahir)* | `Berjalan` | AM (otomatis) | Baris dibuat di transaksi yang SAMA dengan `interview` saat AM klik "Kelola Klien". `dimulai_pada` = jangkar mulai. **Tidak ada tombol "mulai"** — membuka halaman ITU mulainya |
| `Berjalan` | `Selesai` | AM pemegang klien / Account lead / Director | `submitRisetAwal`: tulis `disubmit_pada`/`disubmit_oleh` lalu transisi di satu transaksi. Submit kedua = `ConflictError` `[riset awal sudah disubmit]`, bukan no-op |

- **Nol edge buka-kembali.** Kembali ke `Berjalan` akan memindahkan jangkar yang justru jadi alasan langkah ini ada; kalau revisi memang dibutuhkan, itu keputusan pemilik dulu (belum ada).
- **Durasi bukan kolom.** Ia diturunkan saat baca (`disubmit_pada − dimulai_pada`) oleh satu fungsi core `durasiRisetAwalMenit`, dan `null`/`—` selama berjalan — bukan 0 (aturan rumah #4 & #7).
- Jangkar dibekukan trigger `trg_riset_awal_jangkar`: mengubah `dimulai_pada`, menimpa `disubmit_pada`, atau membalik dari `Selesai` ditolak DB — termasuk lewat service-role.

### Gerbang prasyarat — `assertRisetAwalGate` (RAB-07 · prasyarat; dicatat RAB-20)

Bukan edge mesin #20, melainkan **gerbang yang mesin #19 (`interview`) lewati saat MULAI**. `assertRisetAwalGate(sql, interviewId, clientId)` (`packages/domain/src/interview.ts`) dipanggil di **dua transisi mulai** interview: `scheduleInterview → Terjadwal` dan `transitionInterview → Sedang Berlangsung`. Ia menolak interview dimulai sampai riset awal **benar-benar** selesai, dengan tiga syarat yang harus terpenuhi bersama:

1. **Langkah riset awal disubmit** — `interview_riset_awal.status = Selesai` (jangkar waktu langkah 1 tertutup).
2. **Setiap platform AKTIF punya baseline** — tiap baris `client_platforms` `active` milik klien wajib punya baris `riset_awal_analisa` untuk interview ini (`aktif > 0 AND aktif === tertutup`). Baseline boleh `analisa` ATAU `manual` — bukan wajib analisa.
3. **Setiap isian auto-fill terkonfirmasi** — `interview_riset_awal_isian`: `total > 0 AND total === dikonfirmasi` (cermin `getBaseline().semua_terkonfirmasi`, usulan→konfirmasi per angka).

Gagal salah satu ⇒ `ValidationError` `[riset awal belum selesai — setiap platform aktif wajib punya baseline yang terkonfirmasi dan riset awal disubmit sebelum interview dimulai]`.

- **Per-PLATFORM, bukan per-analisa — inilah yang membuatnya bebas-deadlock.** Klien Shopee-saja (Shopee tak punya mesin analisa → baseline `manual`) tetap bisa lolos; gerbang tak pernah menunggu analisa TikTok yang tak bisa diproduksi. Mengikatnya ke analisa TikTok akan mengunci mayoritas klien (Shopee 156× vs TikTok 16× di seed) — persis kasus anti-deadlock yang diuji DoD RAB-07.
- **AM yang terblokir tak pernah buntu:** `submitBaseline`/`confirmIsian`/`submitRisetAwal` independen dari status interview, jadi AM menyelesaikan riset awal dulu lalu transisi mulai yang sama lolos.

### Timeline SLA tiga langkah (keputusan pemilik 2026-08-13) — BUKAN mesin

Ukuran waktu, bukan status: tidak ada state baru dan tidak ada edge. Angkanya data
(`kelola_klien_sla_config` v1), semuanya **hari kerja** (Sen–Jum minus `hari_libur`,
dihitung `working_days_between`):

| Langkah | Target–batas | Jangkar mulai | Jangkar selesai |
|---|---|---|---|
| 1 · Riset Awal | 2–3 hk | `interview_riset_awal.dimulai_pada` (klik Kelola Klien) | `disubmit_pada` |
| 2 · Interview Meeting | 1–2 hk | `interview_riset_awal.disubmit_pada` | `interview.meeting_diamankan_pada` — mana yang lebih dulu antara `→ Terjadwal` dan `→ Sedang Berlangsung` |
| 3 · Brand Strategy | 5–7 hk | `interview.selesai_pada` (`→ Selesai` / `Selesai Dengan Catatan`) | `strategi.diajukan_pada` ATAU `strategy_plans.diajukan_pada` (AM mengajukan) |

- Jangkar langkah 2 & 3 di-stamp **trigger** `trg_interview_stamp_timeline`, bukan kode TS:
  `sm_transition` satu-satunya penulis kolom status, jadi trigger menangkap setiap jalur —
  termasuk yang belum ditulis. Sekali terisi, **beku**.
- Lewat batas ⇒ baris `interview_flag` dari `interview_daily_tick`
  (`sla_riset_awal_terlambat` / `sla_meeting_terlambat` / `sla_strategi_terlambat`), sekali
  per interview, `retroaktif` dikecualikan. Ini **menggantikan** `sla_belum_dijadwalkan` &
  `sla_belum_selesai` yang lama — satu sumber angka, bukan dua.
- Langkah 3 `tidak_berlaku` hanya kalau plan gate service-nya memutus `tanpa_plan`.

- Mesin `interview` sendiri (#19, `Belum Dijadwalkan … Selesai/Dibatalkan`) belum punya bagian di dokumen ini; sumbernya `supabase/migrations/20260811030000_interview.sql` §12 dan `INTERVIEW_EDGES` di `web-internal/src/lib/interview.ts`.

## 7. Brief `BRF-` (M6) — also the canonical Task machine (M12) applied to AST / BKG / BRF-as-task
`[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` → `[Approved]` (terminal)
- `[In Review]` → `[Revision Requested]` → `[In Progress]` (loop; Revision Count +1; turnaround does NOT reset).
- `[Blocked]`: pause, resume to `[In Progress]`; **SPV/Lead-only transition**; staff/AM submit block requests (pending queue). Blocked intervals excluded from turnaround.
- `[Cancelled — Service Voided]`: terminal, only via Void cascade.
- Live Stream Briefs skip this machine entirely (M10).
- Ads: Brief-as-task uses this machine (M12 §5.3b); post-Approved optimization lives on ADC, not the Brief.

## 8. Creator Booking `BKG-` (M9)
`[Sourcing]` → `[Booked]` → `[Content In Progress]` → `[Content Submitted]` (content link mandatory) → `[QC Review]` → { `[QC Passed]` (terminal) | `[QC Failed - Revision Requested]` (→ creator fixes → `[Content Submitted]`, counter +1, cap per M9) | `[Escalated - Creator Unresponsive]` (AM/Lead decide; SPV/Head Account final call on disagreement) | `[Dropped]` (terminal; excluded from Speed Score entirely) }.
- **`[Dropped]` is reachable from `[Sourcing]` / `[Booked]` / `[Content In Progress]` / `[Escalated]`** — all lead-gated (`canDrop`). The `[Content In Progress]→[Dropped]` edge (B1, `DECISIONS.md` 2026-08-18) unblocks a creator who goes unresponsive after terms are agreed but before ever submitting content; without it the Booking could reach neither `[QC Review]` nor `[Escalated]` and sat stuck.
- **`[QC Review]→[Escalated]` is NOT lead-only:** the assigned Coordinator may escalate (M9 §10.1 "escalate when needed"; B2, `DECISIONS.md` 2026-08-18). Gate `canExecute` = assigned Coordinator / KOL Lead / Director; the escalation surfaces to the SPV (KOL Team Leader), who under M9-OA-6 may take it to the Director. Both the escalation and its resolution are in the immutable audit log.
- M12 mapping: Sourcing/Booked/Content In Progress ⇒ In Progress bucket; Content Submitted/QC Review ⇒ Submitted/In Review; QC Passed ⇒ Approved; Escalated ⇒ Blocked-equivalent; Dropped ⇒ excluded.

## 9. Creator Payment Request `CPR-` (M9)
`[Requested]` → `[Received by Finance]` → { `[Paid]` | `[Rejected]` (reason mandatory, back to KOL) }.

## 10. Live Stream Session `LSS-` (M10)
`[Requested]` → `[Confirmed by Vendor]` → `[Completed]` (result fields + Vendor Report Link mandatory) → { `[Reconciled]` (terminal) | `[Discrepancy Flagged]` (notes mandatory; SPV notified real-time; non-blocking → may later move to `[Reconciled]`) }.
- Brief closes to `[Approved]` when its Sessions reach `[Reconciled]`.
- **Reopen (O27 resolved 2026-07-14, choice b):** an `[Approved]` Live Stream Brief may be **reopened** back to `[Dispatched to Vendor]` to add Sessions for the running recurring period (M10-OA-4 weekly cadence). Like the close, this is an **off-machine audited action** (`ls_brief_reopened` — the LS Brief never joined the §7 machine), allowed only from `[Approved]`, only for a Live-Stream-division Brief, never for a voided Brief; actor gate = owning AM or Director (same §6.1 write gate as Sessions). After reopen, the existing roll-up re-closes the Brief once ALL Sessions (old + new) are `[Reconciled]`.
- **LT-61 (vendor self-service, 2026-09-03):** the `[Requested]→[Confirmed by Vendor]` and `[Confirmed by Vendor]→[Completed]` edges are now ALSO reachable by the vendor Actor assigned to the Session (`live_stream_sessions.vendor_id`, stamped once at creation from the client's Aktif Strategi `live` pillar) — additive to the owning-AM/Director gate, never replacing it. `[Completed]→[Reconciled]`/`[Discrepancy Flagged]` stay AM/Director-only by construction (`edge()`'s `allowVendor` opt-in is never passed for those two calls) — the AM checking the vendor's own numbers is the entire point of reconciliation. Spec: `docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md`.

## 11. Complaint `CPL-` (M6)
`[Open]` → `[In Progress]` → `[Resolved]` → `[Closed]` (AM confirms client satisfaction — distinct from Resolved). Source ∈ {Sales, WhatsApp (AM-logged), Client Portal}.

## 12. Dependency `DEP-` (M11)
Status auto-computed, no manual transitions: `Pending` (source not started) → `Blocking` (source unfinished & type=Blocking) → `Satisfied` (source reached terminal). Create-time validations (server-side): same Client only; no duplicate active pair; no cycles (graph traversal). Blocking gate rejects the Target's final transition with e.g. `"Brief ini belum bisa lanjut ke [In Execution] karena menunggu BRF-… selesai Approved."` Built-in implicit dependency: linked Creative Asset must be `[Approved]` before Ad Campaign Launch (M8) — hardcoded, never user-declared.

## 13. No-status entities
`CHR-` and `PERF-` snapshots: created immutable by monthly batch, never transition. Notification records: unread → read only.

## 14. Ad Campaign `ADC-` (M8) — the ongoing paid-media record, separate from the setup Brief
The Ad Campaign is a **living** record that **outlives** its setup Brief (M8 §2): the Brief (a Brief-as-task on the §7 machine) closes once setup is approved, but the `ADC-` keeps running and accumulating metrics/optimizations underneath it. Lifecycle (M8 §2 / §9.3 — exactly three statuses, no others):
`[Paused]` (born held — created while the parent Brief is `[In Progress]`, **not launched with real spend** yet, §4 Rule 4) `↔` `[Active]` → `[Ended]` (terminal).

| From | To | Who | Effect |
|---|---|---|---|
| `[Paused]` | `[Active]` | Advertiser (Ads staff/lead) / Director | **Launch / Resume.** Real spend begins (§4 Flow 2). Gated in code (not the engine): the parent Brief must be `[Approved]` **and** every currently-linked Creative Asset must be `[Approved]` (the built-in implicit dependency, §12 — hardcoded, never user-declared). |
| `[Active]` | `[Paused]` | Advertiser / Director | **Pause** — optimization/held (e.g. while the setup Brief is in `[Revision Requested]`). No approval gate (routine optimization, §6 Rule 3). |
| `[Active]` | `[Ended]` | Advertiser / Director | End date reached, budget exhausted, or manually stopped (§2). Terminal. |
| `[Paused]` | `[Ended]` | Advertiser / Director | A held campaign may be ended without ever launching. Terminal. |

- Born `[Paused]` (engine `initial`), **not** via the engine — creation is a birth-status INSERT (same precedent as Brief/Asset/Strategy birth statuses); every later move goes through the engine (house rule 2).
- The `[Paused]↔[Active]` edges are **not** `requireLead` at the engine level — the Advertiser optimizes freely (§6 Rule 3). The Launch dependency (Brief + Assets `[Approved]`) is a **code guard** on the `[Paused]→[Active]` edge (mirrors the Void-Service / Direct-breakdown code guards), because the engine cannot see the parent Brief's or linked Assets' statuses.
- Metric Entries (`MTR-`) and Optimization Log entries (`OPT-`) are **append-only child rows** (M8 §5/§6), not state machines: they carry no status and never transition. Total Spend / Total GMV / ROAS and each Asset's Attributed GMV are **derived** from these immutable rows (house rules 3/4), never stored as mutable running columns.
- **Recurring strategy cycles (M8-OA-6):** a new setup `BRF-` is created each cycle, but the **same `ADC-` continues uninterrupted** — the campaign is never restarted; only the Brief above it is new.

## 15. Rekap Hasil Mingguan `WRR-` (M6D) — mesin #18, rekap mingguan per klien

`Terjadwal` → `Terbuka` (auto, Senin 00:00 WIB) → `Ditutup` (konfirmasi AM) | `Ditutup Otomatis` (force-close sistem) → (dibuka lagi oleh Head) `Terbuka`.

| From | To | Who | Effect |
|---|---|---|---|
| `Terjadwal` | `Terbuka` | sistem (job Senin 00:00 WIB) | Rekap dibuka untuk tiap klien aktif; angka otomatis mulai terakumulasi sepanjang minggu (M6D Rule 1). Service-role, bukan lead |
| `Terbuka` | `Ditutup` | AM/CRO pemilik | Konfirmasi mingguan (M6D Rule 8) — semua angka otomatis teratasi + fallback manual terisi/`—` + narasi RM-D1/RM-D3 lengkap, transaksional. Angka otomatis dibekukan as-of penutupan |
| `Terbuka` | `Ditutup Otomatis` | sistem | Force-close saat lewat jendela **N=2 hari kerja** (RM-5 diputus 2026-08-13, owner-tunable) + tanda tidak lengkap. **Menyetel `pernah_ditutup_otomatis=true` permanen** (sinyal non-performa AM, tak pernah dicabut) |
| `Ditutup Otomatis` | `Terbuka` | **Head of Account** (atasan AM, BUKAN AM pemilik) | **Buka kembali** (RM-5 diputus 2026-08-13) — Head memberi AM kesempatan melengkapi. Angka otomatis mencair lagi (accrue) sampai ditutup ulang. **`pernah_ditutup_otomatis` TETAP true** — buka-kembali TIDAK menghapus catatan bahwa AM tak perform; ia hanya menyelamatkan datanya. Butuh alasan (audit) |

- **Terminal:** hanya `Ditutup`. `Ditutup Otomatis` **quasi-terminal** — buntu bagi AM, tapi Head bisa membukanya kembali (satu-satunya edge keluar).
- **`pernah_ditutup_otomatis`** (boolean, default false) di-set true saat force-close dan **tak pernah** kembali false — bahkan setelah Head buka-kembali dan AM menutup dengan benar (`Ditutup`). Skor disiplin M14 (RM-9/RM-9a) & H-2 menghitung **flag ini**, bukan status akhir: rekap yang pernah dipaksa-tutup tetap merugikan AM walau akhirnya rapi. Buka-kembali menyelamatkan **data**, bukan **nilai AM**.
- Satu rekap per klien per minggu ISO (index parsial `(client_id, iso_year, iso_week)`), bukan ditegakkan mesin.
- **Aggregation-only, bukan pemilik data:** angka RM-B/RM-C dibaca dari modul eksekusi (M7/M8/M9/M10) + M6B; baris `otomatis` di `WRR_DIVISI`/`WRR_METRIK` **UPDATE-blocked** untuk aktor JWT (AM) di DB + RLS (invariant beku, bentuk sama `plan_actual` M6B). Hanya fallback manual (RM-C) + narasi (RM-D) yang AM-writable.
- **GMV single-source (M6D §3):** `GMV Eksekusi (interim)` di rekap adalah Σ sumber yang sudah memiliki GMV (Ads/Live/affiliate), read-only, **bukan** GMV resmi. GMV bulanan otoritatif tetap entry manual AM di M6B P-E (Rule 11) — rekap tak pernah menulisnya.
- **Rollup, bukan pengganti:** rekap `Ditutup` memasok PE-3/PE-8 periode Plan yang tertaut (M6B); untuk klien `Tanpa Plan` rekap berdiri sendiri sebagai satu-satunya catatan hasil periodik. Tak ada `PLAN-` yang wajib.
- Menambah **nol grade baru** (M6D Rule 11): Health (M13) & Performance (M14) tetap membaca sumber yang sama seperti sebelumnya.

## 16. Client Milestone `MLS-` (M6D / RM-11) — mesin baru (T-4c, sm_machines 21→22), Upcoming Milestones terstruktur
`[Upcoming]` → `[Done]` | `[Cancelled]` (dua edge, keduanya terminal, `require_lead=false`).
| From | To | Who (gate domain) | Effect |
|---|---|---|---|
| `[Upcoming]` | `[Done]` | Account (AM pemilik / lead) atau Director (`milestone.canManage`) | Tonggak tercapai |
| `[Upcoming]` | `[Cancelled]` | idem | Tonggak dibatalkan |
- Entitas per-klien (T-4c, keputusan pemilik 2026-08-14 "milestone terstruktur"): judul + tanggal target + status. Menggantikan catatan teks bebas RM-C9 untuk milestones.
- Gerbang SIAPA di domain (`packages/domain/src/milestone.ts`), status **hanya** via `sm_transition` (house rule #2); riwayat immutable di `audit_log`. Baca via service-role + gate TS (`canView`: AM pemilik / Account lead / OD / Director), RLS `client_milestones_select` = kunci kedua (cermin `client_health_snapshots`).
- Ditampilkan: halaman klien (kelola: tambah / selesai / batalkan) + blok read-only "Upcoming Milestones" di rekap mingguan (yang masih `[Upcoming]`, target terdekat dulu). Prefix `MLS-YYYYMM-NNNN` (registry). Migrasi `20260814070000_t4c_milestones.sql`.

## 17. Penugasan Internal `TSK-` (Penugasan) — mesin #21 (`sm_machines` 22→23), tugas atasan → anggota tim
`[Ditugaskan]` → `[Dikerjakan]` → `[Selesai]`; `[Ditugaskan]` | `[Dikerjakan]` → `[Dibatalkan]`. Terminal: `[Selesai]`, `[Dibatalkan]`.

| From | To | `require_lead` | Who (gate domain) | Effect |
|---|---|---|---|---|
| `[Ditugaskan]` | `[Dikerjakan]` | `false` | **PIC saja** (`internaltask.canWork`) | Membekukan `dimulai_pada` |
| `[Dikerjakan]` | `[Selesai]` | `false` | **PIC saja** | Membekukan `selesai_pada` + `link_hasil` (wajib) |
| `[Ditugaskan]` | `[Dibatalkan]` | `true` | Pemberi tugas / lead divisi tujuan / Director (`canCancel`) | Menulis `alasan_pembatalan` (wajib) + `dibatalkan_pada` |
| `[Dikerjakan]` | `[Dibatalkan]` | `true` | idem | idem |

- **Kenapa mesin sendiri, bukan `brief_task` (§7).** PRD M12 §2 Rule 1 membekukan Task = Asset | Creator Booking | Brief-as-task, ketiganya wajib turunan rantai Klien→Service→Brief (M6 §5). Tidak ada satu pun jalan menugaskan pekerjaan yang bukan pekerjaan klien — mis. *"Direktur → Head Finance: siapkan laporan bulanan"*. Melonggarkan M12 supaya Brief boleh tanpa Service akan membongkar gerbang pembayaran M4/M5 yang justru menjadi alasan rantai itu ada. Jadi: entitas kedua yang berdiri sendiri; `brief_task`, Speed Score, dan turnaround M12 **tidak disentuh**.
- **`require_lead=true` hanya pada dua edge `[Dibatalkan]`.** PIC yang bisa membatalkan tugasnya sendiri bisa menghapus keterlambatannya sendiri dari catatan — mode gagal yang sama persis dengan alasan M12 §5.3a mengunci `[Blocked]` ke SPV/Lead. Sebaliknya, `[Dikerjakan]` dan `[Selesai]` justru **hanya** boleh PIC: lead yang menandai tugas orang lain "mulai" akan memalsukan jangkar yang durasinya diukur dari situ.
- **Tidak ada edge "buka kembali"** dari `[Selesai]`. Ia akan memindahkan `selesai_pada` dan merusak ukuran yang menjadi alasan modul ini ada — butuh keputusan pemilik lebih dulu (preseden mesin #20 `riset_awal`).
- **Keterlambatan BUKAN status.** Sebuah tugas bisa terlambat lalu tetap diselesaikan; menjadikannya status akan menuntut edge dari setiap state dan menghilangkan fakta "pernah terlambat" begitu tugasnya beres. Ia diturunkan saat baca dari `due_date` + `selesai_pada` + `status` dalam kalender **WIB** (aturan rumah #4), dan ketiga jangkarnya dibekukan trigger `trg_internal_tasks_jangkar` — termasuk `due_date`, karena menggesernya adalah cara termudah menghapus keterlambatan dari catatan performa. `[Dibatalkan]` tidak pernah dihitung terlambat: pekerjaannya ditarik, bukan dilewatkan.
- **Notifikasi (katalog v9 + v10).** Masuk `[Ditugaskan]` ⇒ `penugasan_ditugaskan` (→PIC). Masuk `[Selesai]` ⇒ `penugasan_selesai` (→pemberi tugas). Masuk `[Dibatalkan]` ⇒ `penugasan_dibatalkan` (→PIC — tanpa ini PIC terus mengerjakan pekerjaan yang sudah ditarik). Di luar transisi, job harian `penugasan_reminder_tick` mengirim `penugasan_mendekati_jatuh_tempo` (H-1, **→PIC saja**: pengingat yang ditembuskan ke atasan berhenti jadi pengingat) dan `penugasan_jatuh_tempo` (**→PIC + pemberi tugas + lead divisi** — di sinilah atasan memang perlu tahu). Keduanya **sekali saja**, dijaga penanda searah `pengingat_h1_terkirim`/`jatuh_tempo_terkirim` (trigger menolak reset).
- Prefix `TSK-YYYYMM-NNNN` (registry). RLS `internal_tasks_select` + `GRANT SELECT TO authenticated` (tanpa GRANT, `readAsActor` ditolak sebelum policy sempat dievaluasi — `rls_checks` §43). Migrasi `20260814110000_penugasan_internal.sql` + `20260814120000_penugasan_notif_jatuh_tempo.sql`.

## 18. Tahapan Produksi Brief (`brief_stage`) — mesin #22.. (M16), lapisan lead time per divisi

**Satu mesin per pipeline divisi**, semuanya menulis kolom `briefs.production_stage` lewat `sm_transition` yang sudah ada:

```
p_machine     = stage_pipeline.machine_name
p_entity_type = 'brief_stage'        ← WAJIB, lihat "Namespace log" di bawah
p_table       = 'briefs'
p_id_col      = 'id'
p_status_col  = 'production_stage'
```

Karena `sm_transition` sudah generik (`p_table`/`p_id_col`/`p_status_col`), **tidak ada satu baris pun fungsi SQL engine yang berubah** — mesin baru = baris di `sm_machines` + `sm_edges` + `sm_terminal_states`, murni migrasi.

### Namespace log — kenapa `entity_type='brief_stage'`, bukan `'brief'`

`sm_transition` menulis baris audit `'transition:' || from || '->' || to` dengan `entity_type = p_entity_type`. `computeMetrics` (M12) membaca `audit_log` dengan filter `entity_type='brief'` + `action like 'transition:%'`.

Menulis transisi tahapan sebagai `entity_type='brief'` membuat baris tahapan **ikut terbaca sebagai transisi status** dan merusak turnaround, Speed Score, dan revision count SETIAP Brief. `audit_log.entity_type` adalah `varchar(64)` tanpa constraint, jadi namespace terpisah gratis, dan `loadTransitions` (`packages/domain/src/transitions.ts`) dipakai apa adanya dengan argumen `'brief_stage'`.

### Pipeline yang di-seed

| Divisi | Deliverable | Tahapan (hk = hari kerja) |
|---|---|---|
| Creative | Content Production | `Cek Brief AM` → `Script` (1) → `QC internal` (1) → `Shooting` (1) → `Edit` (1) → ⟨`QC Account Service`⟩ (1) → ⟨`Revisi`⟩ (1) → `Jadwal Posting` (1) |
| KOL | — | `Cek Brief AM` → `Buat Campaign` (1) → `Approach Creator & Sebar Link Product` (3) → `Buat & Update Daftar Creator` (1) → `Nego & Dealing Creator` (2) → `Approval Sampel` (1, gate KLIEN) → `Follow up Video Creator` (14) → `QC & Approval Video Creator` (1) |
| Live Stream | — | `Cek Brief AM` (label "Terima Brief AM", LT-5) → `Terima Sampel` → `Briefing Klien Live` → `Live Start` |
| AI Optimizer | Optimasi SKU | `Cek Brief AM` → `Ambil SKU` → `Riset` → `Perbaikan` → `QC` → `Approve` (gate AM) → `Terapkan` |
| AI Optimizer | AI Video | `Cek Brief AM` → `Script` → `Generate AI` → `Edit` → `QC` → `Jadwal Posting` |
| Store Operation | — | **pipeline kosong** — divisi aktif, daftar pekerjaan menyusul (`DECISIONS.md` LT-2) |

Ads **tidak punya mesin tahapan sendiri**: status `Setting`/`Running`/`Hold`/`End` dipetakan ke mesin `ADC-` (§14) supaya tidak ada dua sumber kebenaran untuk "iklan lagi jalan".

### ⟨…⟩ = checkpoint yang DIPETAKAN, bukan state

`stage_definition.sumber` menentukan asal sebuah checkpoint:

- `'stage'` — punya state sendiri di mesin ini; durasi dari `audit_log` `entity_type='brief_stage'`.
- `'status_brief'` — **tidak menyimpan apa pun**; `status_dipetakan` menunjuk status Brief yang sudah ada, durasinya diturunkan dari log status itu (`entity_type='brief'`). Dipakai untuk `QC Account Service` = `[In Review]` dan `Revisi` = `[Revision Requested]`.

Mendaftarkan keduanya sebagai state tersendiri akan membuat dua kolom mengklaim fakta yang sama ("AM sedang me-review") dan memaksa sinkronisasi dua arah. Memetakannya justru **memunculkan** angka yang selama ini tersembunyi tanpa menambah satu baris data pun.

### Hubungan dengan mesin `brief_task` (§7)

Keduanya berjalan berdampingan pada baris `briefs` yang sama, di kolom berbeda — `status` vs `production_stage`. Mesin tahapan **tidak pernah menulis kolom `status`** (aturan rumah #2).

Satu-satunya kaitan ditegakkan **satu arah** sebagai guard di `task.submitTask`: Brief tidak boleh masuk `[Submitted]` sebelum tahapannya mencapai state terminal pipeline.

### Gate pihak luar menghentikan jam

`stage_definition.gate_pihak` ∈ {`NULL`, `'AM'`, `'KLIEN'`}. Tahap ber-gate `KLIEN` (mis. `Approval Sampel`) dicatat durasinya tapi **dikeluarkan** dari lead time divisi — perlakuan identik dengan interval `[Blocked]` (M12 Rule 7). Menunggu klien bukan kelambatan tim.

**`gate_pihak='AM'` DIKONFIRMASI (LT-6, pemilik 2026-08-29): gerbang PERAN, bukan pengecualian lead time.** Tahap ber-gate `AM` (mis. `Approve` AI Optimizer SKU, `Brief Dikembalikan ke AM`) TETAP terhitung dalam lead time divisi — hanya AM pemilik klien (atau Director) yang boleh menjalankan transisi keluarnya. Interpretasi konservatif ini sudah berjalan sejak awal; tidak ada kode yang berubah untuk LT-6, murni konfirmasi tertulis di sini.

### Cek Brief AM — gerbang intake wajib semua divisi

Tahap pertama setiap pipeline. Divisi memilih *Terima & proses* (lanjut) atau *Brief Dikembalikan ke AM* + alasan terstruktur (Creative: brief kurang jelas / sampel belum diterima / talent tidak tersedia / properti tidak tersedia / lokasi butuh approval — KOL: brief kurang jelas / data tidak lengkap). Inilah rentang yang menjawab "lead time dari AM ke team".

- Durasi **tidak disimpan** — seluruh angka lead time diturunkan dari `audit_log`, satuan **hari kerja** lewat `working_days_between` (Sen–Jum minus `hari_libur`).
- Target per tahap: default `stage_definition.target_hari_kerja`, override per Brief di `brief_stage_sla` (gerbang `isLead(division)`, pola `setSlaTarget` M12). Tanpa target ⇒ `N/A`, tidak pernah di-default diam-diam.
- Migrasi: lihat `docs/backlog/LEADTIME_BACKLOG.md` Fase 2.

**Live Stream mendapat gerbang intake (LT-5, pemilik 2026-08-29).** Live Stream tidak lagi jadi pengecualian §2 Rule 10 — `stage_live` kini punya checkpoint pertama `stage_code='Cek Brief AM'` (persis literal yang `reviewBrief`/`STAGE_CEK_BRIEF_AM` hardcode, supaya mesinnya digerakkan lewat kontrak yang sama tanpa kode TS berubah) dengan **`label='Terima Brief AM'`** — kasus pertama LT-7 (label boleh berbeda dari kode) benar-benar dipakai. `sm_machines.initial_state` pindah dari `'Terima Sampel'` ke `'Cek Brief AM'`; Brief Live yang sudah ada (masih di `'Terima Sampel'`) tidak disentuh. Edge `'Cek Brief AM' -> 'Brief Dikembalikan ke AM'` WAJIB ikut dipasang — bukan opsional — karena `reviewBrief` dengan `keputusan='Dikembalikan'` selalu mencoba transisi itu begitu `production_stage` adalah `'Cek Brief AM'`, tanpa memandang divisi.

**Kirim ulang brief yang dikembalikan (LT-4, pemilik 2026-08-29).** `Brief Dikembalikan ke AM` bukan lagi dead-end: ada edge balik `Brief Dikembalikan ke AM → Cek Brief AM` pada kelima pipeline yang punya state itu (Creative, KOL, AI Optimizer SKU, AI Optimizer Video, dan sejak LT-5 juga Live Stream). Detail yang menentukan:

- Checkpoint itu didaftarkan `gate_pihak='AM'`, `urutan=99`, target `NULL`. Gerbangnya PERAN — **AM pemilik klien (atau Director) yang mengirim ulang**, bukan divisi yang menolak. Tanpa baris `stage_definition` itu, `advanceStage` jatuh ke gerbang divisi dan hasilnya kebalikan dari yang dimaksud.
- `sm_terminal_states` **tetap** tidak memuatnya: guard `submitTask` (Rule 11) membaca tabel itu, dan brief yang dikembalikan justru belum dikerjakan. Edge keluar tidak menjadikannya tahap sukses.
- `brief_review` tetap **append-once**: pengembalian pertama adalah catatan permanen dan kiriman ulang tidak menghapusnya. Setelah kembali ke `Cek Brief AM`, divisi melanjutkannya lewat `advanceStage` ke tahap kerja pertama — `reviewBrief` kedua tetap 409.
- `urutan=99` menjaga checkpoint cabang ini selalu di baris terakhir timeline; Brief yang tidak pernah dikembalikan mendapat `N/A` di baris itu, nol kontribusi ke `totalHariKerja`.

## 19. Permintaan `REQ-` (M16 §5.5) — mesin #.., permintaan divisi yang TERKAIT KLIEN
`[Diajukan]` → `[Diproses]` → `[Selesai]`; `[Diajukan]` | `[Diproses]` → `[Ditolak]`. Terminal: `[Selesai]`, `[Ditolak]`.

Jenis: `Top-up Saldo` (Ads → **Finance**, LT-11), `Contract Creator` (KOL → **AM pemilik klien**, satu-satunya jenis yang dirute ke AM — LT-11), `Creator Payment Approval` (KOL → Finance, menyambung `CPR-` M9 yang sudah ada). Routing dikonfirmasi pemilik 2026-08-29 (LT-11); sebelumnya Top-up Saldo & Contract Creator berdua dirute ke AM sebagai tebakan implementasi.

- **Kenapa entitas sendiri, bukan `TSK-` (§17).** `internal_tasks` sengaja **tidak punya** `client_id`/`service_id` — §17 menyatakan melonggarkannya "akan membongkar gerbang pembayaran M4/M5". Permintaan Top-up Saldo jelas terkait klien (saldo iklan klien), jadi ia tidak boleh menumpang di sana. Sebaliknya ia juga bukan "Task" M12 (= Asset | Creator Booking | Brief-as-task), karena bukan deliverable yang di-review AM.
- Deadline **1 hari kerja** lewat `working_days_between` — bukan 24 jam, bukan 1 hari kalendar (keputusan pemilik; requirement semula menulis keduanya).
- **Keterlambatan bukan status**: diturunkan saat baca dari `due_date` + `selesai_pada` + `status` dalam WIB, dengan trigger pembeku `due_date` — pola persis §17, karena menggeser `due_date` adalah cara termudah menghapus keterlambatan dari catatan performa.
- Prefix `REQ-YYYYMM-NNNN` (registry; `REQ` diverifikasi bebas).

## 20. Renewal/Cross-Sell Request `renewal_request` (`RNW-`, M0 R-03) — mesin #30 (`sm_machines` 29→30)
`Pending Approval` → `Approved` | `Rejected`; `Auto Approved` (jalur non-negosiasi, semua baris harga standar MSL) → langsung setara `Approved`. `Rejected` → `Pending Approval` (kirim ulang, versi proposal baru — pola persis `negotiation_proposals`/M0 §5, entitas yang SAMA, bukan `RNW-` baru). `Approved` / `Auto Approved` → `Executed` (menulis `CTR-`/`SVC-`/`TRX-` ke klien yang sudah ada). Terminal: `Executed`.

- **Kenapa entitas sendiri, bukan menumpang `negotiation_proposals`/`prospect_attempts`.** Arah (a) renewal (keputusan pemilik, `DECISIONS.md` Kinerja Sales #4) eksplisit: "**nol** `LEAD-`/`PRSP-` palsu". Alur negosiasi existing terikat `attempt_id` (`prospect_attempts`) sampai ke akarnya — memaksakan renewal ke sana berarti mencetak PRSP- palsu (persis yang dilarang) atau merombak skema inti M0 yang dipakai 57 tes `sales.test.ts`. `renewal_requests` (parent, mesin ini) + `renewal_proposals`/`renewal_proposal_lines` (versi baris harga, anak — pola PERSIS `negotiation_proposals`/`negotiation_proposal_lines`, cuma anchor-nya `client_id` bukan `attempt_id`) adalah pasangan paralel yang berdiri sendiri.
- **Harga baris dipatok mesin yang SAMA dengan closing baru.** `sales.resolveProposalLine`/`sales.isCustomLine`/`sales.validateShape` (di-export ulang khusus untuk ini) dipakai apa adanya — baris standar dihitung dari MSL versi berlaku (kalkulator, sama seperti `sales.previewQuote`), baris custom butuh persetujuan Sales Head/SPV (`require_lead=true` pada edge `Pending Approval`→`Approved`/`Rejected`, sejajar `prospect_attempt`), nol logika harga kedua yang bisa menyimpang.
- **Eksekusi = langkah terpisah dari persetujuan**, sejajar `sales.close()` (attempt `Negotiation - Approved` menunggu `close()` dipanggil dengan skema pembayaran) — `executeRenewal` butuh input skema pembayaran + cicilan sendiri, ditulis SETELAH `Approved`/`Auto Approved`, bukan otomatis saat approve.
- **Kredit alokasi (KS-2, keputusan pemilik 2026-08-29): kredit berpindah penuh ke sales yang mengeksekusi renewal — sales lama TIDAK lagi memegang kredit.** `client_sales_allocations` (scope per KLIEN, dibaca `finance.commissionAchievement` tanpa peduli transaksi) di-GANTI SELURUHNYA saat eksekusi — baris lama dihapus, baris baru dari alokasi renewal ditulis (Σ=10000 bp, aturan §6 rule 3 yang sama, `sales.validateParties` dipakai ulang). `clients.sales_pic_id`/`commission_payment_pic_id` ikut diperbarui ke PIC baru. **Konsekuensi tercatat**: karena `commissionAchievement` murni turunan-saat-baca (aturan rumah #4, nol yang disimpan), baca ULANG atas transaksi LAMA klien itu setelah realokasi akan menunjukkan sales BARU — bukan retroaktif mengubah apa yang sudah dibayar Finance secara historis, tapi TIDAK ADA snapshot yang membekukan siapa pemilik komisi transaksi lama pada saat itu. Diterima eksplisit oleh pemilik, dicatat `DECISIONS.md` Kinerja Sales #5. Komisi TIDAK punya skema khusus renewal — `services.commission_rule` (MSL) dipakai apa adanya, dihitung Finance seperti closing biasa (jawaban KS-2 kedua).
- **`contracts.jenis`** (R-01) ditulis sesuai tombol yang dipakai: `perpanjangan` (dengan `contract_sebelumnya_id` = kontrak terakhir klien itu) atau `cross_sell` (tanpa rantai). Strategi/Plan TIDAK dibuat di sini — jalur AM yang sudah ada (`contract.ensureContractForService`, dipanggil saat AM membuka Strategi untuk Service baru) tetap satu-satunya pencetak Strategi/Plan; R-03 hanya menyediakan `CTR-`/`SVC-` yang mengalir ke jalur itu, sama seperti closing baru hari ini.
- Prefix `RNW-YYYYMM-NNNN` (registry, baru).
