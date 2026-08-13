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

`Terjadwal` → `Draft` (periode 1) → `Diajukan` → (`Aktif` | kembali `Draft`); `Terjadwal` → `Aktif` (auto, periode 2..n); `Terjadwal` → `Menunggu Persetujuan` → `Aktif`; `Aktif` → `Ditutup` | `Ditutup Otomatis`.

| From | To | Who | Effect |
|---|---|---|---|
| `Terjadwal` | `Draft` | sistem/AM | Periode 1 dibuka untuk diisi (Rule 2) |
| `Draft` | `Diajukan` | AM pemilik | AM mengajukan periode 1 (Rule 3) |
| `Diajukan` | `Aktif` | SPV / Head Account (requireLead) | Persetujuan periode 1 — yang mengaktifkan mekanisme Plan seluruh kontrak (Rule 3) |
| `Diajukan` | `Draft` | SPV / Head Account (requireLead) | Dikembalikan, catatan WAJIB (Rule 3) |
| `Terjadwal` | `Aktif` | sistem (job 00:00 WIB) | Periode 2..n auto-aktif di tanggal mulainya (Rule 4). BUKAN requireLead: dijalankan service-role, bukan seorang lead |
| `Terjadwal` | `Menunggu Persetujuan` | sistem | Penyesuaian `Turun >10%` tertunda menahan aktivasi (Rule 4/9) |
| `Menunggu Persetujuan` | `Aktif` | sistem/SPV | Penyesuaian diselesaikan, atau kedaluwarsa di tanggal mulai ⇒ aktif dengan target Strategi asli (Rule 4) |
| `Aktif` | `Ditutup` | AM pemilik | Penutupan periode oleh AM (Rule 15) — GMV manual + semua baris terminal + review lengkap, transaksional |
| `Aktif` | `Ditutup Otomatis` | sistem | Force-close saat lewat jendela (Rule 5/15). Terminal |

- **Terminal:** `Ditutup`, `Ditutup Otomatis`.
- `Disetujui`/`Dikembalikan` di PRD §8 **bukan state** — PA-5 tidak memuat keduanya; itu cara §8 menuliskan aksi "SPV setuju ⇒ `Aktif`" / "SPV kembalikan ⇒ `Draft`".
- **Hanya satu periode `Aktif` per rantai** (Rule 5) ditegakkan index parsial `uq_plan_aktif_kontrak`/`uq_plan_aktif_klien`, bukan oleh mesin.
- **Edge = data (B-01); GERBANG = domain (B-03, MENDARAT).** Mesin ini mendaftar transisi MANA yang sah; SIAPA yang boleh menekan tombol mana adalah `packages/domain/src/plan.ts`: `submitPlanPeriode` (`Draft → Diajukan`, AM pemilik + PA-7 wajib), `approvePlanPeriode`/`returnPlanPeriode` (periode 1, gerbang `isLead(Account)`, catatan wajib saat kembali), `activatePlanPeriode` (`Terjadwal → Aktif`, service-role, bukan lead). Semua lewat `transitionPlan` — pembungkus tunggal atas `sm_transition`. **Masih tiketnya:** KAPAN `Terjadwal` harus lewat `Menunggu Persetujuan` (penyesuaian `Turun >10%`) = B-04; job aktivasi/force-close 00:00 WIB = B-09.
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
- M12 mapping: Sourcing/Booked/Content In Progress ⇒ In Progress bucket; Content Submitted/QC Review ⇒ Submitted/In Review; QC Passed ⇒ Approved; Escalated ⇒ Blocked-equivalent; Dropped ⇒ excluded.

## 9. Creator Payment Request `CPR-` (M9)
`[Requested]` → `[Received by Finance]` → { `[Paid]` | `[Rejected]` (reason mandatory, back to KOL) }.

## 10. Live Stream Session `LSS-` (M10)
`[Requested]` → `[Confirmed by Vendor]` → `[Completed]` (result fields + Vendor Report Link mandatory) → { `[Reconciled]` (terminal) | `[Discrepancy Flagged]` (notes mandatory; SPV notified real-time; non-blocking → may later move to `[Reconciled]`) }.
- Brief closes to `[Approved]` when its Sessions reach `[Reconciled]`.
- **Reopen (O27 resolved 2026-07-14, choice b):** an `[Approved]` Live Stream Brief may be **reopened** back to `[Dispatched to Vendor]` to add Sessions for the running recurring period (M10-OA-4 weekly cadence). Like the close, this is an **off-machine audited action** (`ls_brief_reopened` — the LS Brief never joined the §7 machine), allowed only from `[Approved]`, only for a Live-Stream-division Brief, never for a voided Brief; actor gate = owning AM or Director (same §6.1 write gate as Sessions). After reopen, the existing roll-up re-closes the Brief once ALL Sessions (old + new) are `[Reconciled]`.

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

`Terjadwal` → `Terbuka` (auto, Senin 00:00 WIB) → `Ditutup` (konfirmasi AM) | `Ditutup Otomatis` (force-close sistem).

| From | To | Who | Effect |
|---|---|---|---|
| `Terjadwal` | `Terbuka` | sistem (job Senin 00:00 WIB) | Rekap dibuka untuk tiap klien aktif; angka otomatis mulai terakumulasi sepanjang minggu (M6D Rule 1). Service-role, bukan lead |
| `Terbuka` | `Ditutup` | AM/CRO pemilik | Konfirmasi mingguan (M6D Rule 8) — semua angka otomatis teratasi + fallback manual terisi/`—` + narasi RM-D1/RM-D3 lengkap, transaksional. Angka otomatis dibekukan as-of penutupan |
| `Terbuka` | `Ditutup Otomatis` | sistem | Force-close saat lewat jendela **N=2 hari kerja** (RM-5 diputus 2026-08-13, owner-tunable) + tanda tidak lengkap. Terminal |

- **Terminal:** `Ditutup`, `Ditutup Otomatis`.
- Satu rekap per klien per minggu ISO (index parsial `(client_id, iso_year, iso_week)`), bukan ditegakkan mesin.
- **Aggregation-only, bukan pemilik data:** angka RM-B/RM-C dibaca dari modul eksekusi (M7/M8/M9/M10) + M6B; baris `otomatis` di `WRR_DIVISI`/`WRR_METRIK` **UPDATE-blocked** untuk aktor JWT (AM) di DB + RLS (invariant beku, bentuk sama `plan_actual` M6B). Hanya fallback manual (RM-C) + narasi (RM-D) yang AM-writable.
- **GMV single-source (M6D §3):** `GMV Eksekusi (interim)` di rekap adalah Σ sumber yang sudah memiliki GMV (Ads/Live/affiliate), read-only, **bukan** GMV resmi. GMV bulanan otoritatif tetap entry manual AM di M6B P-E (Rule 11) — rekap tak pernah menulisnya.
- **Rollup, bukan pengganti:** rekap `Ditutup` memasok PE-3/PE-8 periode Plan yang tertaut (M6B); untuk klien `Tanpa Plan` rekap berdiri sendiri sebagai satu-satunya catatan hasil periodik. Tak ada `PLAN-` yang wajib.
- Menambah **nol grade baru** (M6D Rule 11): Health (M13) & Performance (M14) tetap membaca sumber yang sama seperti sebelumnya.
