# CDPS — Wave 2 Backlog (Delivery Engine: M6, M12, M7, M8, M9, M10 + stream paralel M3/M2)

> Prasyarat: Wave 1 exit criteria (W1-20 UAT) lulus — wave gate R5 Build Plan tetap berlaku, tiket kode Wave 2 tidak dimulai sebelum gate. Hasil QC build plan 2026-07-12 (lihat DECISIONS.md §Wave 2 Plan QC): M12 dibangun paling awal sebagai core engine (sudah di Build Plan, dipertegas di sini), **M3+M2 dimajukan dari Wave 3** sebagai stream paralel (dependensinya hanya Wave 1), katalog notifikasi diperluas SEKALI terkoordinasi di awal wave, dan NFR skala menjadi gate exit. Tiap tiket: baca PRD-nya penuh + DoD CLAUDE.md.

## 0. Keputusan & utang Wave 1 yang menahan Wave 2 — kerjakan duluan

- **W2-01 · Keputusan timezone (O20) + implementasi serentak.** UTC vs `Asia/Jakarta` kini BLOCKING: M7 §7 Daily Output lock "23:59 local", SLA/turnaround M12, batas bulan snapshot M13/M14, prefix bulan ID, reminder M5. Putuskan sekali (rekomendasi teknis: `Asia/Jakarta` untuk seluruh bucketing kalender; timestamp storage tetap UTC), terapkan serentak di `core/ident`, `reminder.go`, dan jadi konstanta core untuk Wave 2. AC: test bucketing melewati tengah malam WIB; DECISIONS diupdate.
- **W2-02 · Katalog notifikasi v2 (satu tiket, satu pemilik core — bukan penambahan sepihak per tim).** Tambahkan sekali ke `notification.go` + Phase 0 v2 §9: rilis-ke-Account (deferral W1-16), handoff payment-intent ke Finance (deferral W1-13), AM assigned (M6 §3 Flow 3), Strategy submitted/decision (M6 §4 — cermin pola negosiasi M0), Brief dispatched ke antrean divisi (M6 §6), ROAS di bawah target 2 periode berturut (M8-OA-5), sourcing-window flag (M9 §4 Rule 4), CPR requested→Finance / decision→KOL (M9 §8), "lead juga sedang dikerjakan sales lain" (redesign dedup M1, DECISIONS 2026-07-10). Event M10–M14 sudah ada di katalog. AC: tabel §9 Phase 0 dan `notification.go` identik; resolver dual-audience reuse pola W1-17.
- **W2-03 · STATE_MACHINES.md dilengkapi DULU (house rule: docs sebelum config.go).** §6 Service saat ini ringkasan — tulis tabel transisi penuh M6 §2: `[Awaiting Onboarding]` → `[Strategy Drafting]` → `[Strategy Submitted for Approval]` → `[Strategy Approved]` → `[Briefed]` → `[In Execution]` dan jalur Direct `[Awaiting Onboarding]` → `[Direct Breakdown]` → `[Briefed]` → `[In Execution]`; tambah §baru mesin Strategy `STR-` (M6 §9.3). "Done state per Brief rollup" TIDAK didefinisikan M6 → resolve **O24** dulu (jangan mengarang status). AC: config.go Wave 2 hanya mengimplement tabel yang sudah tertulis.
- **W2-04 · Redesign dedup M1 kolaboratif (handoff resmi Akun A, DECISIONS 2026-07-10).** Registrasi nomor yang dipegang sales lain TIDAK ditolak — multi-attempt aktif per lead + notifikasi kolaborasi (event dari W2-02); update tabel keputusan dedup M1 + importer W1-19 mengikuti. AC: tabel keputusan baru table-driven test; pesan blokir lama tidak lagi dipakai untuk kasus ini.

## 1. Foundation Wave 2 (sekuensial, satu pemilik, sebelum fan-out stream)

- **W2-05 · Migrasi skema inti Wave 2.** Perluas `briefs` stub (0010) → kontrak penuh M6 §9.4; tabel baru: `strategies`, `complaints`, `assets`, `bookings`, `ad_campaigns`, `metric_entries`, `optimization_logs`, `live_sessions`, `creator_payment_requests`, `block_requests`, `task_block_intervals`, `dependencies` (skema saja — dipakai M11 Wave 3). Rentang migrasi anti-bentrok: foundation 0020–0029, Stream A 0030–0039, B 0040–0049, C 0050–0059, D 0060–0069. AC: smoke up/down; skema = kontrak beku ala 0002.
- **W2-06 · M12 Task Execution Engine (core) — test-first.** Mesin kanonik di atas engine S0: `turnaround_time` (jeda `[Blocked]` dikecualikan, revisi TIDAK reset), `revision_turnaround`, `speed_score` (uncapped; N/A bila SLA target kosong — tidak pernah di-default), `revision_speed_score` (M7-OA-3), revision count, auto-flag ≥3; `[Blocked]` SPV/Lead-only + block-request queue (staf/AM request, pending sampai di-action); SLA per Task diset saat breakdown. AC: seluruh M12 §5 recompute-from-log; contoh Rian §4 (112,5%, RC=1) jadi fixture; permission test blocked-transition per role.
- **W2-07 · Rollup engine Brief ↔ sub-entity (config per divisi).** Creative: Brief `[Submitted]` saat semua Asset ≥ Submitted, `[Approved]` saat semua Approved (M7 §2); KOL: semua Booking QC Passed / formal dropped (M9 §2); Live Stream: Session `[Reconciled]` (M10 §2); revision count rollup Asset→Brief→Service→Client (M6 §7 R3). Denormalized event-driven + selalu recomputable dari log (konvensi #4) — worst-case rollup TIDAK dihitung per render board. AC: recompute test; index kolom rollup.

## 2. Stream A — Epic M6 Account & Service

- **W2-08 · Intake queue + AM assignment manual** (M6 §3): antrean unassigned hanya SPV/Head Account; assignment/reassignment manual ber-log + alasan; workload counter read-only; notif AM (W2-02). **Sekalian tutup deferral W1-10:** visibilitas Account Staff = assigned clients saja (hapus interim "semua klien rilis"), Lead/SPV tetap semua. AC: permission test per role; klien pra-rilis tetap tak terlihat (M5 §5 R2).
- **W2-09 · Strategy & Plan** (M6 §4, §9.3): `STR-` 1:1 Service; SPV approve/revision loop (notes wajib); addendum ringan (M6-OA-5); override flag Requires-Plan per-engagement ber-log (M6-OA-1); Brief tidak bisa dibuat sebelum `[Strategy Approved]`. AC: revision counter; gate server-side dengan pesan BI.
- **W2-10 · Service→Brief fan-out multi-divisi** (M6 §5): Brief per divisi tunggal; plan-gated trace ke outline; Direct langsung; status Service maju `[Briefed]`/`[In Execution]`; cascade Void W1-12 tetap jalan di tabel penuh. AC: fixture Alpha Digital (Brief #1 Creative + #2 Ads + #3 KOL); void cascade regression.
- **W2-11 · Brief Kanban + review AM + revision routing** (M6 §6–7): Brief berjalan di mesin M12 (BRF-as-task untuk Ads); feedback wajib; counter + flag 3+ SPV; routing balik ke divisi/PIC yang sama. AC: transisi ilegal diblokir + pesan BI; Live Stream Brief tidak masuk Kanban ini.
- **W2-12 · Complaint door** (M6 §8, §9.5): `CPL-` severity Low/Med/High (penalti M6-OA-4 tersimpan sebagai data untuk M13); source WhatsApp(AM)/Sales; notif AM+SPV (katalog existing); resolusi milik AM; **plus editor koreksi `platform_list` M4 (deferral W1-11)** — editor multi-row per M4-OA-2, policy lock matrix sudah dites `CanEdit`. AC: complaint terhubung Service/Brief opsional; audit lengkap.

## 3. Stream B — Epic M7 Creative + M8 Ads (loop atribusi satu pemilik)

- **W2-13 · Asset sub-entity + assignment** (M7 §2–3): `AST-` inkremental (M7-OA-6), "5 of 12 created"; auto-assign availability/workload + TL override ber-log (M7-OA-1). AC: progress counter; reassign audit.
- **W2-14 · Asset lifecycle di mesin M12** (M7 §4–6): gate `[link output wajib diisi sebelum submit]`; revision loop per-Asset (sibling tidak terpengaruh); Revision SLA 24–48j (M7-OA-3) → `revision_speed_score`; flag 3+ TL. AC: fixture 12 video (2 revisi) dari contoh PRD; rollup Brief via W2-07.
- **W2-15 · Daily Output = read-model turunan log transisi** (M7 §7; DECISIONS 2026-07-12 — bukan tabel tulis-ganda): lock EOD per timezone W2-01; koreksi pasca-lock butuh approval TL ber-log; reminder EOD Hours Logged (M7-OA-2). Resolve **O25** (output unit Social Media Officer vs Asset Type) sebelum implementasi penuh. AC: recompute dari log = tampilan harian; lock immutability test.
- **W2-16 · Creative KPI view** (M7 §8): Speed/Quantity/GMV Impact (kosong sampai W2-20)/Revision per PIC; visibilitas Staff-own/TL-subteam/SPV-all. AC: permission test; pembagian-nol `—`.
- **W2-17 · Ad Campaign + guardrail launch** (M8 §4): `ADC-` fields wajib; linkage Asset `[Approved]` (filtered per Client/Service) wajib sebelum launch — guardrail implisit sistem (M11 R9); blokir `[campaign belum lengkap, lengkapi platform/budget/aset kreatif sebelum submit]`; review setup AM; Target KPI jalur M8-OA-4. AC: launch tanpa Asset Approved ditolak server-side.
- **W2-18 · Metric Entry mingguan + ROAS** (M8 §5): `MTR-` additive, running totals read-only; ROAS = ΣGMV÷ΣSpend; flag SPV Ads bila di bawah target 2 periode berturut (M8-OA-5, event W2-02). AC: fixture Kenny (4.75x → 3.875x); recompute-from-entries.
- **W2-19 · Optimization Log** (M8 §6): `OPT-` immutable; tanpa gate kecuali budget >50% (AM/SPV sign-off dulu, M8-OA-3); creative swap mencatat old/new Asset. AC: attempt ubah kampanye live tanpa OPT record tidak ada jalurnya; gate 50% test.
- **W2-20 · Attribution feedback → Attributed GMV** (M8 §7): equal split multi-Asset (M8-OA-1); GMV pasca-swap ke Asset baru; read-only dari sisi Creative; siklus re-strategy = Brief baru, ADC lanjut (M8-OA-6). AC: fixture swap Minggu 2 (atribusi Minggu 1 permanen).

## 4. Stream C — Epic M9 KOL + M10 Live Stream

- **W2-21 · Creator Booking lifecycle** (M9 §2–4): `BKG-` sourcing cascade MCN Roster → External Pool → Ad-hoc (M9-OA-1); content link wajib; sourcing-window flag (½ sisa waktu Brief); mapping M12 per tabel M9 §11 (Dropped dikecualikan dari Speed Score). AC: Sourcing/Delivery Turnaround terpisah + gabungan speed_score.
- **W2-22 · QC + eskalasi** (M9 §5): checklist QC; cap 1 revisi (M9-OA-2) → `[Escalated]`; keputusan AM+TL, tie-breaker SPV/Head Account (M9-OA-6); `[Dropped]` + re-source booking baru. AC: cap enforcement; notifikasi KOL Lead (katalog existing).
- **W2-23 · Creator List compile** (M9 §6): eligibility otomatis (`[QC Passed]` saja), generate/refresh manual one-click (M9-OA-3). AC: Escalated/Dropped tidak pernah masuk list.
- **W2-24 · Creator Payment Request → Finance** (M9 §8): `CPR-` hanya pasca QC Passed; amount = Agreed Rate; antrean Finance (kontrak dengan `module5_finance` — koordinasi pemilik stream, pola VerifyInTx W1-19 sebagai preseden); `[Rejected]` reason wajib; payment status mirror read-only di Booking. **Resolve O26** (sumber trackable link Attributed GMV M9-OA-4; null bila tidak ada — tidak pernah diestimasi). AC: permission Finance-only untuk Paid; immutability.
- **W2-25 · Monthly KOL Report** (M9 §9): rollup read-only per Coordinator/tim (bookings, QC pass rate, avg sourcing time, spend, escalation count). AC: recompute dari data booking; angka fixture Putri.
- **W2-26 · Live Stream Session tracker** (M10): `LSS-` request→confirm→completed (Vendor Report Link wajib)→reconciled/discrepancy (notes wajib, notif SPV real-time — katalog existing); GMV confidence tier `Vendor-Reported` full value + badge (M10-OA-5); Brief close saat Sessions `[Reconciled]`; DIKECUALIKAN dari mesin M12. AC: fixture LSS discrepancy → reconciled.

## 5. Stream D — Epic M3 Campaign + M2 Marketing (dimajukan dari Wave 3; dependensi hanya Wave 1)

- **W2-27 · M3 Campaign entity penuh** (M3 §3–5): lifecycle Draft→Active→Paused→Closed→Archived (STATE_MACHINES §3 sudah ada); gantikan stub flag campaign W1-02; import gate + auto-activate O13 tetap; Channel→`Lead.Source` (M3-OA-2 free-text); atribusi late-conversion ≤3 bulan (M3-OA-4); ownership reassignable (M3-OA-6). AC: leads existing ter-link mundur ke `CMP-` tanpa kehilangan atribusi; gate import test.
- **W2-28 · M2 Marketing Performance Record + Auto-Metrics** (M2 §3–5): 1:1 `CMP-`; input hanya name/checklist/budget; CPL, CPRL, Quality Rate, Attributed Sales (last-touch M2-OA-2), ROAS, **Collected-ROAS** (basis Amount Verified M5 — M2-OA-5), junk breakdown; pembagian-nol `—`; dashboard Staff-own vs Lead-all. AC: fixture `CMP-202603-0007` §4 angka-per-angka; semua metric read-only + recomputable.

## 6. Skala & exit wave

- **W2-29 · Load fixture + gate performa.** Generator fixture skala basis Build Plan (500 klien, 100+ karyawan, ≥50rb Task/Asset, ≥200rb baris audit, ≥100rb notifikasi). Budget: p95 < 400ms untuk endpoint antrean personal, board, dan dashboard di atas fixture ini; recompute event-driven tidak N+1; batch bulanan chunked + idempotent + resumable. AC: dijalankan di CI/staging; hasil tercatat di exit review.
- **W2-30 · Wave 2 UAT + exit review** (Build Plan §4): siklus penuh Alpha-Digital-style — Service → Brief ≥2 divisi → Task dengan Speed Score live → 1 revision loop → 1 blocked interval dikecualikan dari turnaround → sesi live-stream ter-rekonsiliasi → metric Ads → Attributed GMV muncul di dashboard Creative → complaint ter-log → campaign M3/M2 menghitung ROAS akuisisi. Go/no-go Wave 3 dicatat di DECISIONS.

## 7. NFR skala — tambahan DoD SETIAP tiket Wave 2

1. Semua endpoint list/queue **paginated** (cursor/limit, default 50) — tidak ada unbounded `SELECT`.
2. **Indeks komposit** mengikuti pola akses: antrean personal `(assigned_pic, status, due_date)`; board per klien `(client_id, status)`; audit `(entity_type, entity_id, created_at)`; notifikasi `(user_id, read_flag, created_at)`.
3. Query board/dashboard = **agregasi server-side satu-dua query**, bukan N+1 per card; kolom rollup denormalized (W2-07) yang dibaca, bukan hitung ulang per render.
4. Field turunan **event-driven** saat transisi (idempotent), cron hanya untuk snapshot bulanan & reminder — konsisten Build Plan §2.3.
5. Penulisan riwayat append-only tetap satu transaksi dengan mutasi entitasnya (pola Wave 1).

## 8. Errata PRD kecil (catatan, tidak mengubah spec)

- M7 §7 R4 & M9 §9 R3 menyebut Team Performance sebagai "Module 13" — yang benar M13 = Client Health, M14 = Team Performance (M14 sendiri sudah benar).
- Referensi M6 "Client Portal (Module 14)" dibaca Module 15 (sudah dicatat di header M15).
