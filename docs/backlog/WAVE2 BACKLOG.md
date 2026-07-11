# CDPS — Wave 2 Backlog (Delivery Engine: M6, M12, M7, M8, M9, M10)

> Prerequisite: Wave 1 exit criteria lulus (W1-20 UAT, Build Plan §4). Tiap tiket merujuk § PRD-nya — baca penuh sebelum implementasi. DoD dari CLAUDE.md berlaku.
> **Kolom Model** = agent pelaksana draft pertama (konsep Fable-planner, lihat `docs/handoff/WAVE2_PARALLEL_PLAN.md` §2): HARD → **opus** (Opus 4.8), STANDARD → **sonnet** (Sonnet 5), MECH → **haiku** (Haiku 4.5). Fable tidak menulis kode di draft awal — hanya QC & revisi.

## Fondasi (W2-F · orchestrator, sekali jalan, sebelum kedua jalur fork)

| # | Tiket | Isi | Model |
|---|---|---|---|
| W2-F1 | Migrasi skema Wave 2 (`0020_wave2_delivery.{up,down}.sql`) | Tabel: `strategies`, `briefs`, `complaints`, `assets`, `daily_outputs`, `block_requests`, `ad_campaigns`, `metric_entries`, `optimization_logs`, `bookings`, `creator_payment_requests`, `live_sessions`. Termasuk `sla_target` per task-entity, kolom rollup di `services`/`clients`. Smoke up/down hijau. **Skema ini BEKU setelah merge** — kontrak antar jalur. | opus |
| W2-F2 | Edge state machine Wave 2 | `STATE_MACHINES.md` + `core/statemachine/config.go`: Task kanonik (`[To Do]→[In Progress]→[Submitted]→[In Review]→[Approved]/[Revision Requested]/[Blocked]` + `[Cancelled — Service Voided]`), Service execution path (plan-gated & direct), Strategy, Complaint (`[Open]→[In Progress]→[Resolved]→[Closed]`), Ad Campaign (`[Active]↔[Paused]→[Ended]`), Booking (9 status M9), CPR (`[Requested]→[Received by Finance]→[Paid]/[Rejected]`), LSS (`[Requested]→[Confirmed by Vendor]→[Completed]→[Reconciled]/[Discrepancy Flagged]`). Pengecualian: LSS di luar mesin Task M12. | opus |
| W2-F3 | Split route + kontrak antar jalur | `httpapi/routes_delivery_a.go` (M12/M7/M8) & `routes_delivery_b.go` (M6/M9/M10); `testutil.Clean` mencakup tabel baru; interface `module12_tasks` (signature compute: `TurnaroundTime`, `SpeedScore`, `RevisionTurnaround`, `RevisionCount`) dibekukan agar Jalur B (mapping M9) bisa koding tanpa menunggu implementasi A. | sonnet |
| W2-F4 | Katalog notifikasi Wave 2 + DECISIONS | Registrasi event baru di `core/notification` (daftar dari PRD: assignment AM, strategy submit/approve, brief lifecycle, revision ≥3 flag, escalation KOL, CPR lifecycle, discrepancy LSS real-time SPV, ROAS 2-periode). Entri DECISIONS untuk keputusan fondasi. | haiku |

---

## JALUR A — M12 + M7 + M8

### Fase A1 — M12 Task Execution Engine (semua modul eksekusi bergantung di sini)

| # | Tiket | Referensi | Isi & AC inti | Rating | Model |
|---|---|---|---|---|---|
| W2-A01 | Task kanonik + SLA per-Task | M12 §2 R1-3,R10; M12-OA-1 | Task = peran AST/BKG/BRF-as-task (LSS dikecualikan). `sla_target` diisi individual per Task saat breakdown (Team Leader/SPV), bukan warisan Brief; kosong ⇒ Speed Score = N/A, tidak pernah backfill. AC: gating role, N/A path teruji. | HARD | opus |
| W2-A02 | Turnaround + interval `[Blocked]` + block-request queue | M12 §2 R4-8, §5.1-5.4; M12-OA-3 | Clock start di `[In Progress]` pertama, stop di `[Approved]` pertama; revisi TIDAK reset clock; `turnaround = Σ(interval In Progress) − Σ(durasi Blocked)`; multi-siklus block. `[Blocked]` HANYA SPV/Lead; staff/AM ajukan request → pending queue. AC: recompute-from-log identik, test permission anti-gaming. | HARD | opus |
| W2-A03 | Speed Score (uncapped) + Revision Turnaround + flag ≥3 | M12 §2 R12,14,15; M12-OA-2/5 | `speed_score = turnaround ÷ sla_target × 100`, TANPA cap atas; `revision_turnaround` = `[Revision Requested]` terakhir → `[Submitted]` berikut; `revision_count` ≥3 ⇒ auto-flag Quality (SPV, visibility-only). Ketiganya read-only, derivable dari log. | HARD | opus |
| W2-A04 | Hours Logged (opsional, konteks) | M12 §2 R9, §5.6; M12-OA-6 | Input manual numerik opsional per Task per hari; tampil di kartu Task di samping Speed Score; TIDAK pernah masuk skor. | MECH | haiku |
| W2-A05 | Rollup KPI staf per periode (feed M14) | M12 §2 R13, §5.5 | Per staf per bulan: avg speed_score (uncapped), distribusi revision_count, total hours — 3 seri terpisah, tidak dikomposit; hanya Task `[Approved]`; daftar flag ≥3. | HARD | opus |
| W2-A06 | Adopsi Brief-as-task Ads | M12 §5.3b; M12-OA-4 | Brief division=Ads memakai mesin Task M12 penuh; tidak ada "setup turnaround" M8 paralel. | STANDARD | sonnet |

### Fase A2 — M7 Creative

| # | Tiket | Referensi | Isi & AC inti | Rating | Model |
|---|---|---|---|---|---|
| W2-A07 | Asset CRUD + state machine + validasi link output | M7 §2,§4,§9.3 | `AST-` lahir inkremental (M7-OA-6), warisan field dari Brief, transisi per mesin kanonik; submit terblokir tanpa link: `[link output wajib diisi sebelum submit]`. | STANDARD | sonnet |
| W2-A08 | Assignment + reassign Team Leader (logged) | M7 §3-4; M7-OA-1 | Auto-assign by workload (saran), override Team Leader tercatat immutable (from/to/actor/timestamp). | STANDARD | sonnet |
| W2-A09 | Revision loop level Asset + Revision SLA | M7 §6; M7-OA-3 | Feedback wajib; counter +1; turnaround asli tidak reset; Revision SLA Target 24–48 jam per Asset Type di-set saat breakdown; `revision_speed_score = revision_turnaround ÷ revision_sla` (diagnostik); rollup count ke Brief. | HARD | opus |
| W2-A10 | Rollup Brief dari Asset | M7 §2 | Brief `[Submitted]` saat SEMUA Asset ≥ `[Submitted]`; `[Approved]` hanya saat SEMUA `[Approved]`; auto pada tiap transisi Asset. | STANDARD | sonnet |
| W2-A11 | Daily Output auto-log + kunci EOD 23:59 | M7 §7; M7-OA-5 | Tiap transisi Asset auto-create record (tanpa entri ganda); lock 23:59; koreksi pasca-lock butuh approval Team Leader + audit. Mengganti 4 sheet legacy. | STANDARD | sonnet |
| W2-A12 | KPI Creative (Speed, Quantity, GMV Impact, Revision) | M7 §5,§8 | 4 sinyal per PIC, terpisah tidak diblender; GMV Impact read-only diisi feedback M8 (kunci bulanan M7-OA-4); dashboard per role. | HARD | opus |
| W2-A13 | UI Creative (`web-internal`) | M7 semua | Board Asset per division queue, kartu Task (score + hours), form QC/review AM, dashboard KPI. | STANDARD | sonnet |

### Fase A3 — M8 Ads

| # | Tiket | Referensi | Isi & AC inti | Rating | Model |
|---|---|---|---|---|---|
| W2-A14 | Ad Campaign CRUD + lifecycle | M8 §2,§4 | `ADC-` lahir saat Brief `[In Progress]`; lifecycle `[Active]↔[Paused]→[Ended]` ORTHOGONAL ke Brief; siklus rekuren = Brief baru, ADC sama lanjut (M8-OA-6). | STANDARD | sonnet |
| W2-A15 | Gate submit Brief + guardrail Asset `[Approved]` | M8 §4 R3 | Submit terblokir bila ADC tak lengkap: `[campaign belum lengkap, lengkapi platform/budget/aset kreatif sebelum submit]`; Asset ter-link WAJIB `[Approved]` sebelum launch. | STANDARD | sonnet |
| W2-A16 | Target KPI: negosiasi AM + sign-off SPV Ads | M8 §4 R1; M8-OA-4 | AM propose → SPV Ads approve; terkunci pasca-approve (ubah = siklus approval baru); Advertiser read-only. | HARD | opus |
| W2-A17 | Metric Entry mingguan + running totals + ROAS | M8 §5; M8-OA-2 | `MTR-` per periode, additive; `ROAS = Total GMV Ads ÷ Total Spend` read-only; entri memicu recompute atribusi. | STANDARD | sonnet |
| W2-A18 | Optimization Log + gate budget >50% | M8 §6; M8-OA-3 | `OPT-` immutable; budget >50% WAJIB sign-off AM/SPV SEBELUM apply, ≤50% bebas (logged); creative swap catat Asset lama→baru. | HARD | opus |
| W2-A19 | Atribusi Attributed GMV → Asset (write-back) | M8 §7; M8-OA-1; M7-OA-4 | Split rata antar Asset ter-link simultan; swap = split by date boundary; akumulatif; review-and-lock bulanan sebelum final. | HARD | opus |
| W2-A20 | Dashboard KPI Ads + flag ROAS 2 periode | M8 §8; M8-OA-5 | Speed (via M12), ROAS vs target (amber <target, merah 2 periode berturut → auto-flag SPV Ads + notifikasi), GMV Impact, count optimasi (sekunder). | HARD | opus |
| W2-A21 | Queue Ads + reassign + UI | M8 §3 | Queue per Advertiser (sort due date / health), reassign Team Leader logged; UI campaign workspace + metric entry + optimization form. | STANDARD | sonnet |

---

## JALUR B — M6 + M9 + M10

### Fase B1 — M6 Account & Service (pintu Brief semua divisi)

| # | Tiket | Referensi | Isi & AC inti | Rating | Model |
|---|---|---|---|---|---|
| W2-B01 | Unassigned queue + assignment AM manual | M6 §3; M6-OA-2/6 | Klien muncul di queue SPV pasca-rilis Finance (gate W1-16); SPV pilih AM manual (tanpa round-robin), tepat SATU AM per klien; log immutable; counter beban AM (soft signal). | STANDARD | sonnet |
| W2-B02 | Execution path per-Service + override flag | M6 §2; M6-OA-1 | `requires_strategy_plan` diwarisi dari Master Service List; plan-gated vs direct bisa koeksis per klien; override AM/SPV per-engagement dengan alasan tercatat. | STANDARD | sonnet |
| W2-B03 | Strategy & Plan: draft→submit→approve + addendum | M6 §4; M6-OA-5 | 5 field wajib; `[Strategy Drafting]→[Strategy Submitted for Approval]→[Strategy Approved]` / reject + feedback wajib + counter; Brief terkunci sebelum approved; addendum ringan SPV tanpa restart. | STANDARD | sonnet |
| W2-B04 | Service → Brief breakdown fan-out + kaskade void | M6 §5 | Satu Service → N Brief, satu Brief = satu divisi; Service auto `[Briefed]`/`[In Execution]`; integrasi kaskade Void W1-12: Brief belum `[Approved]` → `[Cancelled — Service Voided]`. | HARD | opus |
| W2-B05 | Dispatch Brief + review AM + pengecualian Live Stream | M6 §6; M6-OA-7 | Routing ke queue divisi `[To Do]`; AM reviewer (bukan SPV-gate ke klien); Brief Live Stream SKIP Kanban → vendor tracker M10. | HARD | opus |
| W2-B06 | Revision routing + counter + rollup + flag ≥3 | M6 §7; M6-OA-3 | Feedback wajib; kembali ke PIC sama; rollup count Brief→Service→Client (input Health M13); ≥3 auto-flag SPV (visibility). | STANDARD | sonnet |
| W2-B07 | Complaint door AM (WhatsApp manual-log) | M6 §8; M6-OA-4 | `CPL-`: deskripsi + severity wajib (Low −5 / Medium −15 / High −30), link Service/Brief opsional (divisi read-only), source tetap "WhatsApp (AM-logged)"; `[Open]→[In Progress]→[Resolved]→[Closed]`, notes wajib di Resolved. | STANDARD | sonnet |
| W2-B08 | UI Account (`web-internal`) | M6 semua | Unassigned queue SPV, workspace AM (klien→service→strategy→brief), form review, log komplain. | STANDARD | sonnet |

### Fase B2 — M9 KOL

| # | Tiket | Referensi | Isi & AC inti | Rating | Model |
|---|---|---|---|---|---|
| W2-B09 | Booking lifecycle + flag lag sourcing | M9 §2,§4 | `BKG-` 9 status; content link wajib sebelum `[Content Submitted]`; Sourcing/Delivery Turnaround auto; flag `[Sourcing]` >50% sisa due date (non-blocking). | STANDARD | sonnet |
| W2-B10 | QC review + cap revisi 1 ronde | M9 §5; M9-OA-2 | Checklist QC; feedback wajib saat fail; counter capped 1 — lebih ⇒ jalur eskalasi. | STANDARD | sonnet |
| W2-B11 | Eskalasi creator unresponsive: keputusan gabungan + tie-break SPV | M9 §5 R3-4; M9-OA-6 | `[Escalated - Creator Unresponsive]`; AM + Team Leader putuskan drop/re-source/accept; selisih pendapat → SPV final (logged); drop ⇒ BKG baru, asli `[Dropped]` (dikecualikan dari Speed Score — omitted, bukan 0%). | HARD | opus |
| W2-B12 | Source pool field + reporting | M9 §4 R2; M9-OA-1 | MCN MEA Roster / KOL External Pool / Ad-hoc New; guidance UI (tidak enforce); % per pool. | MECH | haiku |
| W2-B13 | CPR → handoff Finance (M5) | M9 §8; M9-OA-5 | `CPR-` lahir hanya pasca-`[QC Passed]`; amount = Agreed Rate (validasi); masuk queue Finance M5; reject ⇒ alasan wajib; `payment_status` Booking = cermin read-only status CPR. | HARD | opus |
| W2-B14 | Kompilasi Creator List (Drive doc, trigger manual) | M9 §6; M9-OA-3 | Eligibility otomatis (hanya `[QC Passed]`); tombol Generate/Refresh; Escalated/Dropped dikecualikan; timestamp Last_Compiled. | STANDARD | sonnet |
| W2-B15 | Laporan KOL bulanan (snapshot immutable) | M9 §9 | Per Coordinator/tim: total booking, QC pass rate, avg sourcing time, total spend (Σ Agreed Rate), count eskalasi. | MECH | haiku |
| W2-B16 | Mapping Booking → mesin Task M12 | M9 cross-module; STATE_MACHINES §8 | Peta status BKG → status kanonik; `[Dropped]` exclude; pakai interface `module12_tasks` yang dibekukan W2-F3. **Integrasi riil setelah Fase A1 merge.** | STANDARD | sonnet |
| W2-B17 | Queue Coordinator + reassign + UI KOL | M9 §3 | Queue personal (sort due + urgensi stage), reassign Team Leader logged; UI booking board + QC form + eskalasi. | STANDARD | sonnet |

### Fase B3 — M10 Live Stream (vendor tracker)

| # | Tiket | Referensi | Isi & AC inti | Rating | Model |
|---|---|---|---|---|---|
| W2-B18 | Session request + konfirmasi vendor | M10 §3; M10-OA-1 | `LSS-` oleh AM (tanggal/jam, durasi target, platform TikTok Shop Live/Shopee Live, produk/talent, instruksi); `[Requested]→[Confirmed by Vendor]` manual-log. | STANDARD | sonnet |
| W2-B19 | Capture hasil + gate Vendor Report Link | M10 §4 | Field hasil aktual + Orders + GMV from Live; `[Completed]` TERBLOKIR tanpa Vendor Report Link; confidence tier auto `Vendor-Reported`. | STANDARD | sonnet |
| W2-B20 | Rekonsiliasi + flag discrepancy + notif SPV real-time | M10 §4; M10-OA-3 | Side-by-side requested vs actual; notes wajib saat discrepancy; `[Discrepancy Flagged]` non-blocking; SPV dinotifikasi REAL-TIME (bukan batch). | STANDARD | sonnet |
| W2-B21 | Feed GMV → rollup Client (confidence tier) | M10 §5; M10-OA-5 | Hanya sesi `[Reconciled]`; nilai PENUH (tak didiskon), badge `Vendor-Reported` terlihat; rollup Brief→Service→Client (dipakai M13 Wave 3). | HARD | opus |
| W2-B22 | Gating status Brief dari rekonsiliasi + UI | M10 §2,§6; M10-OA-4 | Brief M10 TANPA Kanban internal; status = computed: `[Approved]` hanya saat SEMUA sesi `[Reconciled]`; satu Brief menampung banyak sesi rekuren; UI session tracker. | STANDARD | sonnet |

---

## Penutup wave (lintas jalur)

| # | Tiket | Isi |
|---|---|---|
| W2-X1 | Integrasi M9↔M12 + M6-Brief↔M7/M8 end-to-end | Setelah kedua jalur merge: Booking hidup di mesin Task riil; Brief riil dari M6 mengalir ke Asset/ADC. |
| W2-X2 | UAT Wave 2 + exit review | Klien ala Alpha Digital jalan siklus penuh: Service → Brief ≥2 divisi → Task dengan Speed Score live → satu loop revisi → satu interval `[Blocked]` ter-exclude dari turnaround → sesi live stream ter-rekonsiliasi (Build Plan §4 exit criteria). Go/no-go Wave 3 di DECISIONS.md. |

## Rekap beban

| | HARD (opus) | STANDARD (sonnet) | MECH (haiku) | Total |
|---|---|---|---|---|
| Fondasi | 2 | 1 | 1 | 4 |
| Jalur A | 9 | 10 | 1 | 20 (dgn A13/A21 UI) |
| Jalur B | 4 | 15 | 3 | 22 |
| **Total** | **15** | **26** | **5** | **46 + 2 lintas** |
