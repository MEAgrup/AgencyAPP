# CDPS — Consolidated State Machines (source config for the transition engine)

> Extracted verbatim from the PRD modules. Every transition not listed is **blocked server-side** with the BI message noted (default: `[transisi status tidak diizinkan]`). Every transition logs actor + timestamp, immutable.

## 1. Prospect attempt (M0/M1)
`Pending Validation` → `New Lead` → `Contacted` → { `Qualified` | `Not Qualified` } ; `Qualified` → Negotiation states → { `Closed-Success` | `Closed-Lost` }
- Intake collision ⇒ `Blocked` (no updates possible). Pool competitors on win ⇒ `[Closed - Kalah Kompetisi]` (auto).

**`[Closed - Prospek Bersama]` — terminal, dan sengaja BUKAN `[Closed - Kalah Kompetisi]`
(FS-3, feedback tim Sales 2026-09-08; ketokan pemilik FS-1).** Satu `LEAD-` sudah lama
boleh punya banyak `PRSP-`, dan pintu pendaftaran tunggal (serta batch, yang
mendelegasikan ke sana) sudah mengembalikan outcome `join` — bukan `block` — saat lead
dipegang sales lain. Yang belum ada: penanda bahwa attempt itu lahir sebagai **prospek
bersama**, dan penutup yang tidak menghukum.

- Kolom `prospect_attempts.bersama_dengan_attempt_id` (migrasi `20260925030000`,
  preseden `contracts.contract_sebelumnya_id`) menunjuk attempt yang SUDAH ada saat
  attempt ini lahir lewat `join`. `NULL` untuk attempt tunggal **dan** untuk kontes lead
  `[Pool]` — dua hal yang perlakuan win-resolution-nya berbeda, jadi keduanya tidak boleh
  memakai nilai yang sama. "Dikerjakan bersama" adalah TURUNAN dari keberadaan penunjuk
  itu, bukan flag kedua yang bisa berbeda dengan kenyataannya.
- `leads.resolveWin` menutup saudara yang bertaut ke `[Closed - Prospek Bersama]`, dan
  saudara yang TIDAK bertaut tetap ke `[Closed - Kalah Kompetisi]`. Tautannya diperiksa
  **dua arah** (`o.bersama_dengan_attempt_id = pemenang` ATAU `pemenang.bersama_dengan = o.id`)
  karena penunjuknya hanya ada di baris yang menyusul sementara keduanya sama-sama pemilik
  prospeknya; kedua lengan divalidasi-mutasi terpisah.
- **Kenapa state sendiri:** `salesperf` menghitung contested-win-rate dari attempt yang
  kalah. Ketokan FS-1 adalah kepemilikan menjadi bersama dan komisi dibagi (50-50 atau
  kesepakatan, diketik di form Closing yang alokasinya kini prefill dua baris). Sales yang
  memegang 50% komisi tapi tercatat "kalah kompetisi" adalah dua pernyataan yang saling
  meniadakan pada orang yang sama — dan yang salah tidak pernah melempar galat, ia cuma
  menurunkan angka kinerja seseorang diam-diam.
- Edge masuknya **diturunkan** dari baris `[Closed - Kalah Kompetisi]` lewat
  `INSERT ... SELECT`, bukan daftar yang diketik ulang, supaya setiap state hulu (termasuk
  `[Unrespon]`) otomatis punya keduanya dan tidak bisa menyimpang.
- Masuk `TERMINAL_ATTEMPT_STATUSES`: tanpa itu attempt yang sudah ditutup masih terbaca
  "terbuka" dan pendaftaran berikutnya akan menautkan diri padanya — rantai prospek
  bersama yang tidak pernah putus.
- **Nol event notifikasi baru:** `m1.lead.co_pursuit` sudah ada dan sudah mengirim ke
  pemilik attempt lama saat `join` terjadi. Menambah event kedua berarti pintu kedua ke
  aturan yang sudah punya pintu.
- `Qualified` only via successful Qualified Form submit; exit without submit ⇒ stays `Contacted`.
- Negotiation states: `Negotiation - Pending Approval` → { `Negotiation - Approved` | `Negotiation - Revision Required` | `Negotiation - Rejected` }; Revision Required → (accept ⇒ Approved) | (resubmit ⇒ Pending Approval, new version); `Negotiation - Rejected` → (resubmit ⇒ Pending Approval, new version) | `Closed-Lost` (DECISIONS O16); No-nego path ⇒ `Negotiation - Auto Approved`. Closing only from Approved/Auto Approved.
- **Edit Service sebelum closing** (M0 §5.1, keputusan pemilik 2026-08-07): `Negotiation - Approved` / `Negotiation - Auto Approved` → `Negotiation - Pending Approval` (versi proposal baru, `require_lead = false` seperti seluruh edge masuk Pending Approval yang digerakkan sales; migrasi `20260807040000_edit_service_reapproval.sql`). Edge ini HANYA dipakai revisi ber-harga **custom** — revisi dengan harga standar MSL menulis versi proposal baru **tanpa transisi status sama sekali**, jadi tidak melewati mesin ini.

**`[Unrespon]` — bukan terminal (DEVIASI PRD, keputusan pemilik 2026-09-04, lihat
`docs/DECISIONS.md` REV-1/REV-2, `docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md`
L1).** M1 §2/§9.3 tidak menyebut status ini — ditambahkan atas permintaan pemilik:
lead yang didaftarkan tapi tidak digerakkan sales mangkrak tanpa jaring pengaman.
Mengikuti gaya bracket §2 `[Deleted]`, tapi untuk mesin **attempt** (per-sales), bukan
mesin **record** (registry pusat) — `leads.record_status` tidak disentuh sama sekali.

| From | To | `require_lead` | Effect |
|---|---|---|---|
| `New Lead` | `[Unrespon]` | true | job harian `leads_unrespon_tick` — 3 hari diam sejak transisi status terakhir (audit log), WIB kalender |
| `Contacted` | `[Unrespon]` | true | idem |
| `[Unrespon]` | `Contacted` | false | sales hidupkan lagi sendiri — jam penuaan reset (jangkar berikutnya = audit row `[Unrespon]` terbaru) |
| `[Unrespon]` | `Not Qualified` | false | auto setelah 14 hari diam di `[Unrespon]`, alasan `[Tidak ada respon]` (M1-OA-8, `created_by='SISTEM'`); atau tutup manual lebih awal |
| `[Unrespon]` | `[Closed - Kalah Kompetisi]` | false | wajib — tanpa edge ini, `leads.resolveWin` gagal menutup deal pada lead Pool yang satu attempt-nya sudah menua, dan ROLLBACK seluruh Closing (§1.2 backlog L1) |

- **Tidak ada edge `[Unrespon]` → `Qualified`** — M0 §4: `Qualified` hanya lewat submit
  Qualified Form dari `Contacted`. Jalur hidup lagi = `[Unrespon]` → `Contacted` → form.
- Kedua edge penuaan `require_lead=true` — digerakkan sistem/Head, bukan pintu kabur
  sales; job SQL memanggil `sm_transition(..., 'SISTEM', true, false)`.
- `[Unrespon]` **tidak** masuk `TERMINAL_ATTEMPT_STATUSES` (`packages/domain/src/leads.ts`)
  — tetap terhitung `open_attempt_count`, tetap ditutup `resolveWin` saat lead menang di
  tempat lain (sama seperti attempt `Contacted` biasa).
- Jangkar jam turunan murni `audit_log` (aturan rumah #4) — tanpa kolom `unrespon_at` baru.

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
- **KANONIK sejak ketokan pemilik 2026-09-08; membuka gerbang Brief sejak A-3 (2026-09-07).** Jalur `STR-` (§6a) **dipensiunkan** di commit yang sama: route tulisnya 410, tombolnya dicabut dari `/persetujuan` dan `/account/strategies/{id}`, dan flag `SHOW_LEGACY_STR_PATH` beserta blok matinya dihapus. Sebelum ketokan itu sempat ada **dua penulis hidup** ke `services.status` selama sehari — tabrakannya terukur (STRG- disetujui lebih dulu ⇒ persetujuan STR- gagal `[transisi status tidak diizinkan]` dan ter-rollback, SPV terkunci permanen), nol instance di produksi.
- **Rincian mekanismenya (A-3).** `approveStrategi` mendorong Service `[Awaiting Onboarding]` → `[Strategy Approved]` di transaksi yang sama (M6A §5.7), dan `account.guardBriefCreation` menerima STRG- `Aktif` sebagai pembuka gerbang di samping jalur lama `STR-`. Karena satu Strategi memayungi n Service lewat kontrak (O57), yang didorong adalah **setiap** Service tergerbang-Plan pada kontrak itu — Service Direct tidak disentuh, jalurnya `[Awaiting Onboarding]` → `[Briefed]`. Baris yang sudah mentok sebelum betulan ini didorong migrasi `20260922100400` lewat `sm_transition` (aktor `SISTEM`), bukan `UPDATE` mentah.
  Lengan gerbangnya perlu ADA DUA — status Service saja tidak cukup: Service yang menempel ke kontrak SESUDAH Strategi-nya disetujui tidak pernah hadir di momen persetujuan, jadi tidak ada yang menggerakkan statusnya, dan membaca status saja akan mengunci Service itu selamanya.
  Brief jalur STRG- menyimpan `briefs.strategy_id = NULL` (FK-nya ke `strategy_plans`, dan baris `STR-`-nya memang tidak ada) — konvensi yang sama dengan jalur pewarisan M6B di `brief-inherit.ts`.
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

## 6f. Riset Awal — mesin #20 (langkah 1 "Riset & Interview Klien", QA pemilik 2026-08-12)

`Berjalan → Selesai` (Selesai terminal). Hidup di `interview_riset_awal.status`, tabel anak 1:1 dari `interview`
(PK `interview_id`, tanpa prefix ID sendiri), digerakkan `sm_transition(machine='riset_awal', table='interview_riset_awal', id_col='interview_id')`.

| From | To | Who | Effect |
|---|---|---|---|
| *(baris lahir)* | `Berjalan` | AM (otomatis) | Baris dibuat di transaksi yang SAMA dengan `interview` saat AM klik "Mulai Riset & Interview". `dimulai_pada` = jangkar mulai. **Tidak ada tombol "mulai"** — membuka halaman ITU mulainya |
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
| 1 · Riset Awal | 2–3 hk | `interview_riset_awal.dimulai_pada` (klik "Mulai Riset & Interview") | `disubmit_pada` |
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
- **`[Submitted]` → `[Revision Requested]` — QC internal divisi, lead-only (B-4, ketokan pemilik K-1 2026-09-07, opsi B).** Migrasi `20260922200000_b4_gerbang_lead_creative.sql`, `require_lead = true`. Lead divisi pelaksana menolak hasil PIC **sebelum** brief-nya pernah sampai ke AM; feedback **wajib** (M7 §6 Rule 1, sama seperti pintu AM). Jalan keluarnya edge yang sudah ada: `[Revision Requested]` → `[In Progress]`.
  - **Revision Count TIDAK naik di pintu ini.** Ia diturunkan dari `audit_log` dengan action persis `transition:[In Review]->[Revision Requested]` (`creative.deriveAssetRevisionCount`), jadi QC internal tidak ikut terhitung — dan itu memang yang dikehendaki: Revision Count adalah ukuran revisi yang diminta **klien** lewat AM, bukan ketegasan QC divisi sendiri. Konsekuensinya flag §6 Rule 4 (revisi ke-3) juga hanya dievaluasi di pintu AM.
- **`[Submitted]` → `[In Review]` aktornya dilebarkan (B-4/K-1):** selain AM pemilik klien dan Director, **lead divisi pelaksana** boleh menjalankannya (= "lolos QC internal, teruskan ke AM"). Pelebarannya di TypeScript (`creative.canDriveReviewEdge`), bukan `require_lead` — `sm_transition` tidak tahu divisi mana yang dimaksud, jadi DB memikul gerbang kasar dan domain memikul yang butuh konteks baris. Berlaku untuk pintu tunggal **dan** batch (`reviewAssetBatch`), lewat satu predikat yang sama.
- **`[In Review]` → `[Approved]` TETAP milik AM pemilik klien (+ Director).** K-1 menyebutnya eksplisit: "AM tetap pemegang approval akhir". Lead yang bisa approve berarti divisi menyetujui pekerjaannya sendiri.
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
- **`bayar_komisi` (FS-4, feedback tim Sales 2026-09-08) — jenis KETIGA, dan ia sengaja TIDAK mencetak `CTR-`.** Ketokan pemilik: bayar komisi adalah **tagihan** atas penjualan yang sudah terjadi, bukan kesepakatan baru. `executeRenewal` karena itu melewati DUA langkah untuk jenis ini: langkah 1 (`insert into contracts`) dan langkah 5 (alokasi). Yang lahir hanya `SVC-` (ber-`contract_id` NULL) + `TRX-` (+ `INST-` bila skemanya terjadwal), dan transisi ke `Executed` berjalan seperti biasa. **Kenapa langkah 5 dilewati, dan kenapa itu bukan penyederhanaan:** KS-2 MENGGANTI SELURUH `client_sales_allocations` setiap eksekusi dan memindahkan `clients.sales_pic_id`. Komisi ditagih SETIAP BULAN — memakai jalur itu apa adanya berarti kepemilikan klien berpindah tiap bulan, diam-diam, ke siapa pun yang kebetulan menekan tombol tagih. **Konsekuensi yang disengaja:** karena nol `CTR-` dicetak, `contracts.jenis` tidak pernah menerima nilai keempat — `ck_contracts_jenis` tidak disentuh, dan `salesperf.ts` (yang mencocokkan string literal `baru`/`perpanjangan`/`cross_sell` dan akan diam-diam melewatkan nilai tak dikenal) juga tidak perlu diubah. **Layanan yang sah digerbangi penanda katalog, bukan nama:** tepat satu baris, dan layanannya harus ber-`master_service_versions.pengakuan = 'bulan_berikutnya'` (D-KOM) — nama "Komisi" bisa disunting Sales Head lewat form MSL kapan saja. Gerbang itu berlaku di `proposeRenewal` **dan** `resubmitRenewal`. `ExecuteRenewalResult.contractId` karena itu `string | null`.
- Prefix `RNW-YYYYMM-NNNN` (registry, baru).

## 21. Publikasi Laporan Klien `client_report` (C1 lanjutan) — mesin #31 (`sm_machines` 30→31)
`[Draf]` → `[Terbit]` → `[Dicabut]` → `[Draf]`. **Nol state terminal, sengaja.** Migrasi `20260908010000_c1_laporan_insight_publikasi.sql`.

| From | To | Who | Effect |
|---|---|---|---|
| `[Draf]` | `[Terbit]` | AM pemilik klien / lead Account / Director (`require_lead=false`) | Laporan tayang di Client Portal, dan `insight_revisi` **DIPAKU** ke revisi teks terbaru. Sejak titik ini klien membaca revisi ITU dan bukan yang lebih baru, sampai ada `republish`. Stamp `diterbitkan_pada`/`diterbitkan_oleh` |
| `[Terbit]` | `[Dicabut]` | sama | Laporan berhenti terbaca klien (`status` yang menggerbang, bukan paku). Alasan **wajib** — klien akan bertanya ke mana laporannya. Paku **dipertahankan** sebagai jejak revisi mana yang sudah dibaca |
| `[Dicabut]` | `[Draf]` | sama | Laporan dikoreksi (insight diperbaiki) supaya bisa diterbitkan lagi. Dilewati otomatis oleh `publishReport` sebelum ia masuk `[Terbit]` |

- **Kenapa nol terminal.** `client_reports` punya `UNIQUE(client_platform_id, periode_tipe, periode_mulai, periode_akhir)` — satu periode satu baris, dan barisnya immutable. Mengunci `[Dicabut]` sebagai terminal berarti satu salah unggah menghanguskan periode itu **selamanya**, karena baris pengganti ditolak UNIQUE dan baris lamanya tak bisa dihidupkan lagi.
- **Kenapa `require_lead=false` di ketiga edge.** Keputusan pemilik 2026-09-08: AM menyunting DAN menerbitkan sendiri, tanpa gerbang review. Ruang lingkupnya tetap sempit — `report.canWriteReport` (AM pemilik klien / lead Account / Director) digerbang di domain dan diulang RLS; `require_lead` engine adalah gerbang *seniority*, bukan *kepemilikan baris*, jadi menyalakannya justru akan mengunci AM staf keluar dari laporan kliennya sendiri.
- **Kenapa tabel pendamping, bukan kolom di `client_reports`.** Tabel itu beku terhadap UPDATE apa pun (trigger `client_reports_frozen`) — bukan per kolom. Menaruh `status` di sana berarti melonggarkan satu-satunya penjaga angka laporan demi kenyamanan penulisan. `sm_transition` sudah menerima `p_table`/`p_id_col`/`p_status_col` sebagai parameter, jadi `client_report_publikasi` (PK `report_id`) jalan tanpa perubahan engine.
- **Mesin pertama berkunci surrogate `bigint`.** Semua entitas CDPS lain berkunci `PREFIX-YYYYMM-NNNN`; laporan bukan entitas ber-prefix (`client_reports.id` bigint identity). Ini menyingkap keterbatasan `sm_transition` yang selama ini tak terlihat — predikatnya `WHERE %I = $1` dengan `$1 text` ⇒ `operator does not exist: bigint = text`. Diperbaiki migrasi `20260908020000_sm_transition_id_type_aware.sql`: tipe kolom dibaca dari katalog dan **parameternya** yang di-cast (`$1::<tipe>`), bukan kolomnya — cast di kolom akan mengeluarkannya dari indeks. Nol perubahan perilaku untuk 30 mesin lain.
- **Nol prefix baru** (`entity_prefix` tetap 37) dan **nol event katalog baru** (`notif_events` tetap 67 — komplain portal memakai event komplain yang sudah ada).
- Teks insight sendiri hidup di `client_report_insight`, **append-only** (revisi 0 = snapshot mesin) dan **bukan** mesin status.

## 22. Baris SKU Store Operation `store_ops_sku` (`SKU-`, M18) — mesin #32 (`sm_machines` 31→32)

`[Menunggu Eksekusi]` → `[Dikerjakan]` → `[Terupload]` → `[Dievaluasi]`, plus `[Dikerjakan]` ⇄ `[Gagal Upload]`. Terminal: `[Dievaluasi]`. Migrasi `20260924010000_m18_store_ops_sku.sql`. PRD `docs/prd/CDPS_Module18_Store_Ops.md` §4.

| From | To | `require_lead` | Effect |
|---|---|---|---|
| `[Menunggu Eksekusi]` | `[Dikerjakan]` | `false` | PIC mulai. **Sejak titik ini seluruh kolom cakupan + target BEKU** — dijaga trigger, bukan hanya domain |
| `[Dikerjakan]` | `[Terupload]` | `false` | **SELESAI PRODUKSI** (ketokan K-6). `link_output` wajib (gerbang domain). Ini jangkar `actual_done` dan awal jendela dampak ±30 hari |
| `[Dikerjakan]` | `[Gagal Upload]` | `false` | Upload ditolak marketplace. `catatan_ops` wajib |
| `[Gagal Upload]` | `[Dikerjakan]` | `false` | Coba lagi pada baris yang **SAMA** |
| `[Terupload]` | `[Dievaluasi]` | `false` | Langkah review ±30 hari kemudian: enam angka dampak (CTR/CVR/rating sebelum & sesudah) |

- **Kenapa `[Terupload]` bukan terminal.** Ketokan K-6 memisahkan angka dampak dari "selesai": CTR/CVR baru bisa dinilai ~30 hari setelah upload, dan menjadikannya gerbang status selesai berarti leadtime **produksi** Store Ops ternoda waktu tunggu pasar. Angka leadtime yang mengukur dua hal sekaligus tidak mengukur apa pun. Rollup Brief (M18 §8) karena itu berhenti di `[Terupload]`, bukan `[Dievaluasi]`.
- **Kenapa `[Gagal Upload]` sebuah STATE, bukan kolom flag.** Worksheet divisi menghitung "% SKU Gagal Upload"; sebuah flag boolean bisa ditulis ulang oleh orang yang sedang dinilai, sebuah state meninggalkan baris `audit_log` yang tidak punya jalur UPDATE/DELETE (aturan rumah #3). Mode gagal yang sama dengan alasan `internal_tasks` menolak kolom `pernah_terlambat` (§17). Penyebutnya dibaca sebagai "**pernah menyentuh** `[Gagal Upload]`", bukan status terkini — SKU yang gagal lalu berhasil tetap pernah gagal.
- **Kenapa kembalinya ke baris yang sama, bukan `SKU-` baru.** SKU-nya sama, targetnya sama, janjinya ke klien sama; baris baru akan menyembunyikan kegagalan pertama dari penyebut metriknya sendiri.
- **Nol edge ber-`require_lead`.** Keempat transisi adalah pekerjaan PIC atas barisnya sendiri (pola `creator_booking`, §8). Gerbang "siapa boleh menyentuh baris ini" dipikul RLS `store_ops_skus_select` + gerbang domain — `require_lead` adalah gerbang *seniority*, dan menyalakannya akan mengunci staf Store Ops keluar dari barisnya sendiri.
- **DUA PENULIS pada satu baris, dan dindingnya di DB.** Ketokan 2026-09-08: AM menulis cakupan + target saat baris lahir; Store Operation menulis hasil saat eksekusi lalu dampak saat evaluasi. `trg_store_ops_skus_dinding_penulis` menolak tulisan dari sisi yang salah, membekukan Kelompok 1 begitu status meninggalkan `[Menunggu Eksekusi]`, dan menolak UPDATE yang tidak mendeklarasikan sisinya sama sekali. Penandanya GUC transaction-local `cdps.sku_writer` — **bukan** `jwt_division()`, karena jalur tulis CDPS berjalan privileged tanpa klaim JWT dan sebuah trigger ber-JWT akan melihat NULL pada setiap tulisan sungguhan (dinding yang selalu terbuka lebih buruk daripada nol dinding). Pengecualiannya satu dan sempit: UPDATE status-saja, yaitu pintu `sm_transition` sendiri.
- **Nol kolom durasi/keterlambatan/`actual_done`** — semuanya turunan `audit_log` saat baca (aturan rumah #3/#4, PRD §5), preseden M16 Rule 4 dan `internal_tasks`.
- Prefix `SKU-YYYYMM-NNNN` (registry, baru — `entity_prefix` 40→41).

## 23. Tutup Buku `book_period` (D-3, Gelombang D) — mesin #33 (`sm_machines` 32→33)
`[Terbuka]` → `[Tertutup]` → `[Terbuka]`. **Nol state terminal, sengaja** — `[Tertutup]` bukan akhir, karena Director boleh membukanya lagi (ketokan pemilik 2026-09-08). Migrasi `20260925020000_d3_tutup_buku.sql`.

| From | To | Who | Effect |
|---|---|---|---|
| `[Terbuka]` | `[Tertutup]` | **Finance level lead ATAU Director** (`require_lead=true` + `require_division='Finance'`) | Angka bulan itu **dibekukan** sebagai versi baru di `book_period_snapshots`, lalu bulannya dikunci. Sejak titik ini setiap tulisan bertanggal di bulan itu ditolak DB |
| `[Tertutup]` | `[Terbuka]` | **Director SAJA** (`require_director=true`) | Kunci dibuka. Alasan tertulis **wajib**. Angka beku **TIDAK dihapus** — ia tetap ada sebagai versi, dan tutup-ulang menambah versi baru di sebelahnya |

- **Dua gerbang yang SENGAJA berbeda, dan itu inti keputusannya.** Finance lead yang menutup **tidak bisa** membatalkan tutupannya sendiri. Kalau peran yang sama bisa menutup dan membuka sesuka hati, "tertutup" tidak berarti apa-apa. Satu gerbang untuk kedua transisi adalah cacatnya, bukan penyederhanaannya.
- **Mesin pertama yang butuh gerbang selain `require_lead`.** Mesin lama hanya punya `require_lead`, yang berbunyi `director OR lead` — lolos untuk lead **divisi mana pun**. Dipakai apa adanya, edge "menutup" akan mengizinkan lead Creative menutup buku keuangan, dan edge "membuka" akan meloloskan lead mana pun. Migrasi `20260925010000_d3_gerbang_edge_bertingkat.sql` menambah `sm_edges.require_director` (Director saja) dan `require_division` (menyempitkan cabang lead ke satu divisi), plus parameter ke-11 `p_role_division` di `sm_transition`. **Nol perubahan perilaku untuk 32 mesin lama**: pada `(false, NULL)` ekspresi gerbangnya tereduksi kata-per-kata menjadi gerbang lama.
- **Versi 10-argumen `sm_transition` DIBUANG, bukan dibiarkan berdampingan.** Konsekuensinya dua job SQL (`wrr_monday_job`, `leads_unrespon_tick`) ikut ditulis ulang: keduanya memanggil `sm_transition` dari dalam badan PL/pgSQL, yang me-resolve nama saat **eksekusi** — jadi versi berdampingan berarti panggilan lama tetap "berhasil" sampai suatu hari sebuah edge ber-divisi menolaknya dengan pesan yang menyesatkan. `engine.test.ts` mengunci "tepat satu overload, 11 argumen".
- **Kunci utamanya BULAN, bukan ID rumah.** `book_periods.periode` bertipe `date` (hari pertama bulan, WIB). "Agustus 2026" hanya ada satu selamanya, jadi kunci alami membuat duplikat **mustahil** alih-alih sekadar "tidak seharusnya terjadi". Preseden: `client_reports.id` bigint (§21). `sm_transition` sudah sadar tipe kolom id sejak `20260908020000`, jadi kunci `date` dilayaninya tanpa perlakuan khusus.
- **Tiga syarat yang ditegakkan trigger, bukan CHECK** (`trg_bp_jaga_transisi`), karena ketiganya menengok ke tabel lain dan ke **arah** perpindahan (CHECK tidak melihat `OLD`):
  1. **menutup** ⇒ angka versi `versi_terakhir` benar-benar sudah ada. `versi_terakhir >= 1` saja tidak membuktikan apa pun.
  2. **membuka** ⇒ ada alasan tertulis, DAN alasan itu **lebih baru** dari penutupan yang dibatalkannya — tanpa syarat kedua, buka-ulang berikutnya bisa memakai alasan lama yang masih menempel di barisnya, jejak yang terlihat sah dan sebenarnya bohong.
  3. **tutup-ulang** ⇒ angkanya dibekukan **lagi** sesudah dibuka. Yang dibandingkan waktunya, bukan nomor versinya: nomor bisa dinaikkan tanpa menghitung apa pun.
- **Versi pertama constraint-nya BUNTU, dan itu ditemukan dengan menjalankannya.** "Tertutup ⇒ ada angka" dan "terbuka setelah pernah ditutup ⇒ wajib beralasan" saling mengunci sehingga penutupan PERTAMA mustahil dari dua arah — `sm_transition` hanya menulis kolom `status`, jadi `versi_terakhir` harus naik sebelum transisi, dan itulah yang dilarang constraint kedua. Pelajaran yang sudah tertulis di `ck_crp_cabut_lengkap` (§21) dan tetap terulang. Urutan tulis yang sah sekarang: **bekukan → naikkan versi → transisi** untuk menutup, dan **stamp alasan → transisi** untuk membuka.
- **Pagar tulisan ada di DB** (`20260925030000_d3_pagar_bulan_tertutup.sql`), menolak **tiga** arah: mendarat di bulan tertutup, **berangkat** dari bulan tertutup, dan dihapus dari sana. Arah kedua yang paling mudah terlupa — memindahkan penerimaan dari Agustus (tertutup) ke September mengubah angka Agustus tanpa pernah menulis satu baris pun bertanggal Agustus. Terpasang di `payment_verifications.received_date` dan `installments.verified_date`. Yang **belum** dijaga (`services.standard_price`) disebut apa adanya di komentar migrasi dan di `DECISIONS.md`, bukan diklaim beres.
- **Koreksi bulan tertutup lewat JURNAL KOREKSI di bulan berjalan**, bukan dengan menyunting bulan tertutup (pilihan pemilik saat memilih D-3 opsi (a)). Wewenangnya **sama** dengan yang boleh menutup (ketokan 2026-09-08) — melebarkannya berarti orang yang tidak boleh menutup buku tetap bisa menggerakkan angkanya lewat pintu samping. Disimpan di `audit_log` (`entity_type='jurnal_koreksi'`), bukan tabel baru: audit_log sudah menolak UPDATE/DELETE, sudah punya aktor + waktu + before/after, dan sudah jadi tempat orang mencari riwayat.
- **Nol prefix baru** (`entity_prefix` tetap 40 — kunci alami `date`, tak pernah disebut manusia lewat ID) dan **nol event katalog baru** (`notif_events` tetap 73).

## 24. Baris `SMO & Content Strategist` `scs_task` (`SCS-`, M19) — mesin #34 (`sm_machines` 33→34)
`[To Do]` → `[In Progress]` → `[Submitted]` → `[In Review]` → `[Approved]`, plus `[Submitted]`|`[In Review]` → `[Revision Requested]` → `[In Progress]` dan `[In Progress]` ⇄ `[Blocked]`. Terminal: `[Approved]`. Migrasi `20260928010000_m19_scs_task_engine.sql`. PRD `docs/prd/CDPS_Module19_Creative_Daily_Ops.md` §13. Ketokan `M19-SCS-ENGINE` opsi (b), 2026-09-09.

| From | To | Who | Effect |
|---|---|---|---|
| `[To Do]` | `[In Progress]` | **PIC baris itu SAJA** (gerbang domain) | Jangkar turnaround lahir di `audit_log` |
| `[In Progress]` | `[Submitted]` | **PIC baris itu SAJA** | `link_hasil` WAJIB — ditegakkan domain DAN `ck_scs_submit_butuh_link` |
| `[Submitted]` | `[In Review]` | Lead Creative / Director | Review dibuka |
| `[Submitted]` | `[Revision Requested]` | Lead (`require_lead=true`) | QC lead sebelum review dibuka — cermin edge B4 pada `brief_task` |
| `[In Review]` | `[Approved]` | Lead Creative / Director | Terminal |
| `[In Review]` | `[Revision Requested]` | Lead Creative / Director | Ronde revisi; tiap kedatangan terhitung satu revisi |
| `[Revision Requested]` | `[In Progress]` | **PIC baris itu SAJA** | Kerjakan ulang |
| `[In Progress]` ⇄ | `[Blocked]` | Lead (`require_lead=true`, **dua arah**) | Waktu blocked DIKURANGKAN dari turnaround |

- **Ia SALINAN VERBATIM konfigurasi `brief_task`, dan itu seluruh alasannya boleh ada.** State sama, edge sama, gerbang `require_lead` sama; yang berbeda hanya NAMA mesinnya, karena `sm_transition` mengunci mesin ke pasangan entityType/table dan dua entitas yang berbagi satu baris `sm_machines` berarti gerbang role salah satunya tidak bisa digeser tanpa menggeser yang lain. Kesamaan kosakata itulah yang membuat `task.computeMetrics()` (exported, pure) **dipakai ulang apa adanya** — ia membaca nama state dari `audit_log`, jadi Speed Score, turnaround, dan jumlah revisi punya SATU implementasi di seluruh CDPS. ⚠️ Mode gagalnya senyap: "merapikan" `[Approved]` jadi `[Selesai]` di sini membuat Speed Score SELURUH baris SCS diam-diam `null` tanpa satu pun galat. `packages/db/src/scs.registry.test.ts` membandingkan HIMPUNAN state dan edge kedua mesin — ia yang merah lebih dulu.
- **Kenapa mesin sendiri dan bukan `brief_task` langsung.** M12 §2 Rule 1 membekukan Task = Asset | Creator Booking | Brief-as-task, ketiganya turunan WAJIB Klien→Service→Brief. Baris `all client: Brief` di sheet SMO **tidak punya klien**, dan `PREFIXES.REQ` (`ident.ts`) sudah mencatat bahwa melonggarkan `client_id` *"akan membongkar gerbang pembayaran M4/M5"*. Preseden yang sudah memilih arah ini: mesin #21 `internal_task` (§17).
- **Nol state pembatalan, dan itu keputusan.** `brief_task` membatalkan lewat `[Cancelled — Service Voided]`; baris SCS tidak punya Service sehingga sebab itu tak pernah terjadi, dan menyalinnya berarti menjanjikan sebab yang tidak ada. Nama state pembatalan BARU tidak dikarang — ia butuh ketokan pemilik lebih dulu (sikap yang sama yang diambil mesin #21 terhadap edge "buka kembali"). Penggantinya: baris `[To Do]` boleh DIHAPUS, dan hanya itu — dijaga trigger `scs_tasks_hapus_hanya_todo()`, karena tanpa batas itu "hapus lalu catat ulang" adalah cara termudah menghapus revisi dan keterlambatan dari catatan performa.
- **Gerbang "mengerjakan" LEBIH SEMPIT daripada `require_lead` di DB.** DB hanya bisa berkata "lead atau bukan"; yang dituntut di sini adalah "PIC baris ini", yang hidup di gerbang domain (`canWorkTask`). Lead yang menandai baris orang lain `[In Progress]` memalsukan jangkar yang turnaround-nya diukur dari situ. Kebalikannya untuk `[Blocked]`: ia lead-saja justru karena waktunya dikurangkan dari turnaround, jadi PIC yang bisa memblokir barisnya sendiri memotong sendiri angka yang menilainya (gerbang M12 §5.3a).
- **Nol kolom jangkar waktu, nol kolom turunan** — turnaround, Speed Score, jumlah revisi semuanya diturunkan dari `audit_log` saat baca (aturan rumah #3/#4), persis seperti Asset dan Brief-as-task. Kolom jangkar kedua adalah angka kedua yang bisa menyimpang dari log.
- **Baris beku begitu meninggalkan `[To Do]`** (`trg_scs_tasks_beku`): tanggal, Kategori, PIC, target qty, klien. Kategori membawa SLA yang dipakai menghitung Speed Score baris yang sedang dinilai; memindahkannya sesudah pengerjaan dimulai adalah mode gagal yang sama dengan `internal_tasks: due_date beku`. `link_hasil` beku sesudah `[Approved]`.
- **SLA-nya datang dari Kategori, bukan dari baris.** Kategori standing wajib `sla_jam IS NULL` (CHECK), dan `computeMetrics(evs, null)` memberi Speed Score **`N/A`** — bukan `0%`, yang akan terbaca sebagai pernyataan tentang kecepatan seseorang atas pekerjaan yang tidak pernah di-SLA-kan.
- Prefix `SCS-YYYYMM-NNNN` (registry, baru — `entity_prefix` 42→43). **Nol event katalog baru** (`notif_events` tetap 73): antrean SCS adalah layar yang dibuka setiap hari, bukan sesuatu yang butuh inbox, dan event didaftarkan BERSAMA emitternya (preseden v9 `internal_tasks`).
