# CDPS — Rencana Kerja Paralel Wave 1 (2 Akun Claude Code)

> Tujuan: dua akun Claude Code membangun Wave 1 (money path) **bersamaan tanpa saling bentrok**. Dokumen ini mengunci pembagian, kepemilikan file, kontrak antar-tim, dan aturan main. Baca penuh sebelum mulai.

## 0. Prinsip anti-bentrok (kenapa ini aman paralel)
1. **Foundation dulu (SUDAH SELESAI di sesi ini).** Skema DB semua entitas, edge state-machine, pembagian route, dan money-engine sudah ada di branch `claude/cdps-wave1-money-path-55y09d` (PR #1). Kedua tim **fork dari sini** → tidak ada tim yang perlu bikin migrasi/skema inti atau menyentuh `core/`.
2. **Environment terpisah.** Tiap akun = container sendiri = MariaDB sendiri. Tidak ada tabrakan test DB antar-akun.
3. **Kepemilikan file disjoint.** Tiap tim hanya menulis file di paket modulnya sendiri (lihat §3). File bersama sudah difinalkan; ada daftar "FROZEN" (§5).
4. **Branch + PR terpisah** (§6). Merge foundation dulu, lalu tiap tim rebase.

## 1. Status foundation (selesai — jangan diulang)
- ✅ `backend/migrations/0002_wave1_money_path.{up,down}.sql` — tabel `leads, prospect_attempts, prospect_attempt_nq_reasons, negotiation_proposals, negotiation_proposal_lines, clients, client_platforms, client_sales_allocations, services, transactions, installments`. Smoke up/down hijau.
- ✅ Edge state-machine `Negotiation - Rejected → {Pending Approval, Closed-Lost}` (DECISIONS O16) di `STATE_MACHINES.md` + `config.go`.
- ✅ Money engines (test-first): `core/money`, `module0_sales/{commission,allocation}`, `module5_finance/rollup`.
- ✅ Split route: `httpapi/routes_leads_sales.go` (Tim A) & `httpapi/routes_client_finance.go` (Tim B) + `testutil.Clean` sudah mencakup tabel baru.
- ✅ Semua keputusan PRD di `DECISIONS.md` (O1, O3, O10–O17).

## 2. Pembagian kerja (REKOMENDASI: per-modul full-stack)
> Cocok dengan contoh Anda "A jalankan alur 1, B jalankan alur 2". **Konfirmasi/ubah bila perlu (§8).**

| | **Akun A — Alur 1: Akuisisi → Closing** | **Akun B — Alur 2: Klien → Uang** |
|---|---|---|
| Modul | **M1 Leads + M0 Sales** | **M4 Client Record + M5 Admin/Finance** |
| Tiket | W1-01..04 (Leads), W1-05..09 (Sales) | W1-10..13 (Client), W1-14..18 (Finance) |
| Inti | dedup/registration, attempt lifecycle, Qualified Form, negosiasi, **Closing (buat CLI/TRX/SVC)** | client record birth, lock matrix, void service, payment intent, verifikasi 4 skema, rollup, routing gate, reminder |
| Money-engine dipakai | `module0_sales` (komisi, alokasi) | `module5_finance` (rollup) |
| Branch | `claude/cdps-wave1-alur1-leads-sales` | `claude/cdps-wave1-alur2-client-finance` |

**Alternatif** (bila tim tidak full-stack): Akun A = seluruh **backend**, Akun B = seluruh **frontend** (`web-internal/`). Paling minim konflik file tapi FE menunggu kontrak API.

## 3. Peta kepemilikan file (disjoint)

### Akun A (M1 + M0)
- `backend/internal/module1_leads/**` (baru) — LEAD/PRSP repo, dedup engine, import.
- `backend/internal/module0_sales/**` — **tambah** persistence/closing di paket yang sudah ada (`commission.go`/`allocation.go` sudah ada, jangan diubah tanda tangannya; tambah file baru `attempt.go`, `qualified.go`, `negotiation.go`, `closing.go`).
- `backend/internal/httpapi/routes_leads_sales.go` + file `*_handlers.go` baru milik A (mis. `leads_handlers.go`, `sales_handlers.go`).
- `web-internal/src/app/(shell)/leads/**`, `.../sales/**` (bila full-stack).

### Akun B (M4 + M5)
- `backend/internal/module4_client/**` (baru) — client record, lock matrix, void, payment intent.
- `backend/internal/module5_finance/**` — **tambah** persistence di paket yang sudah ada (`rollup.go` sudah ada, jangan ubah; tambah `transaction.go`, `verification.go`, `routing.go`, `reminder.go`).
- `backend/internal/httpapi/routes_client_finance.go` + `*_handlers.go` baru milik B (mis. `client_handlers.go`, `finance_handlers.go`).
- `web-internal/src/app/(shell)/clients/**`, `.../finance/**` (bila full-stack).

## 4. Kontrak handoff (titik temu satu-satunya)
Closing (Akun A, W1-09) adalah produsen; M4/M5 (Akun B) konsumen. Kontraknya = **skema tabel `clients`/`services`/`transactions`/`installments` di migrasi 0002** (sudah beku). Aturan:
- **Akun A menulis** baris awal `clients` (+ `client_platforms`, `client_sales_allocations`), `services`, `transactions` (status awal `[Menunggu Verifikasi]`), dan `installments` (bila Termin) **secara atomik** di satu transaksi DB saat closing. Pakai `module0_sales.ClosingParties.Validate()` + `BuildQuote()` untuk angka.
- **Akun B membaca/mengelola** siklus hidup baris itu (lock matrix M4, verifikasi M5, rollup `module5_finance`).
- Agar A tidak menunggu B: A cukup **INSERT sesuai skema 0002** (tidak perlu paket M4/M5). B membangun logika baca/ubah di atas skema yang sama.
- Bila butuh perubahan skema handoff → **koordinasi via `DECISIONS.md` + minta sesi orchestrator ubah migrasi 0002** (jangan salah satu tim ubah sepihak).

## 5. Aturan main (rules of engagement)

**File FROZEN — jangan diedit tanpa koordinasi (keduanya bergantung):**
- `backend/internal/core/**` (money, ident, audit, permission, statemachine, notification, db).
- `backend/migrations/0002_*` (skema handoff). Perubahan lewat orchestrator.
- `backend/internal/core/statemachine/config.go` — kalau butuh edge/machine baru: update `STATE_MACHINES.md` dulu + catat DECISIONS + minta orchestrator.

**Migrasi tambahan (bila perlu kolom/tabel baru):** rentang nomor dipesan supaya tak tabrakan —
- Akun A: `0003`–`0009`
- Akun B: `0010`–`0019`

**`httpapi/api.go`:** JANGAN diedit. Tambah route di file route milik tim masing-masing (§3). Bila perlu tambah dependency di `App` struct atau branch baru di `onTransition`, tambahkan di blok bertanda tim Anda dan sebutkan di deskripsi PR (konflik 1–2 baris, mudah di-resolve).

**`DECISIONS.md`:** append-only, rawan konflik. Protokol: tiap tim menambah baris di BAWAH, satu commit terpisah "docs(decision): ..."; kalau bentrok saat rebase, keduanya dipertahankan (union).

**Notifikasi:** pakai event katalog yang sudah ada (`notification.go`). Event M1/M0: `EvNegotiationPendingApproval`, `EvNegotiationDecision`. Event M5: `EvInstallmentDue`, `EvContractNotReceived`. Jangan ubah katalog; kalau kurang → koordinasi.

**Test:** wajib test-first untuk money & state machine (DoD CLAUDE.md). Jalankan `make test` (butuh MariaDB lokal, `-p 1`). Tiap endpoint: test permission per role + immutability + recompute-from-log.

## 6. Branch & PR + urutan merge
1. **Merge PR #1 (foundation) ke `main` lebih dulu.** (Butuh keputusan Anda: apakah Sprint 0 + foundation di-merge ke main sekarang, atau tetap sebagai base branch.)
2. Akun A: `git checkout -b claude/cdps-wave1-alur1-leads-sales` dari base foundation. Akun B: `git checkout -b claude/cdps-wave1-alur2-client-finance`.
3. Masing-masing buka **draft PR sendiri** ke `main`.
4. Rebase rutin ke base agar foundation update ikut. Karena file disjoint, rebase nyaris tanpa konflik.
5. Integrasi akhir: jalankan satu deal end-to-end (registrasi → qualified → nego → closing → verifikasi → routing) lintas hasil kedua tim = **W1-20 UAT**.

## 7. Daftar tiket per akun (mapping WAVE1_BACKLOG.md)
**Akun A:** W1-01 (LEAD + dedup, test-first tabel keputusan), W1-02 (bulk import + auto-activate campaign O13), W1-03 (pool claim + win resolution atomik), W1-04 (bad-lead + Last-Touch), W1-05 (attempt lifecycle), W1-06 (Qualified Form — **pakai `module0_sales.BuildQuote`**), W1-07/08 (negosiasi, pakai edge O16), W1-09 (Closing — **pakai `ClosingParties.Validate` + tulis tabel handoff**).

**Akun B:** W1-10 (client birth + provenance), W1-11 (lock matrix — string `[field ini terkunci, tidak bisa diubah]`), W1-12 (void service cascade — pakai `MService`/`MBriefTask` requireLead), W1-13 (payment intent handoff), W1-14 (TRX + INST schedule — **pakai `module5_finance.ValidateTerminSchedule`**), W1-15 (verifikasi 4 skema — **pakai `rollup.DesiredStatus`/`CheckVerification`**), W1-16 (routing gate — **pakai `ReleasesToAccount`**, fire-once via `released_to_account_at`), W1-17 (reminder dual-audience), W1-18 (contract 7-hari + `[Bermasalah]`).

**Bersama (akhir):** W1-19 (migrasi data — tunggu sample dari Yohan), W1-20 (UAT + exit review).

## 8. Perlu konfirmasi Anda sebelum tim mulai
1. **Sumbu split:** per-modul full-stack (rekomendasi, tabel §2) / backend-vs-frontend / M1-vs-M0? 
2. **Merge foundation:** PR #1 di-merge ke `main` dulu, atau kedua branch tim fork langsung dari branch PR #1?
3. **Cakupan:** kedua akun full-stack (BE+FE), atau FE ditunda sampai BE stabil?
