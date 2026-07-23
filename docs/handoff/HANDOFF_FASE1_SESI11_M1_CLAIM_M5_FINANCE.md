# HANDOFF — Fase 1 lanjut: M1 Pool claim + read models, dan M5 Admin & Finance LENGKAP (sesi 11)

> Standalone. Baca bersama `docs/handoff/HANDOFF_FASE1_SESI10_M0_CLOSING.md`,
> `packages/domain/src/{leads,sales,finance}.ts`, `docs/prd/CDPS_Module5_Admin_Finance.md`,
> `docs/prd/CDPS_Module1_Leads_Database.md` §6, `docs/prd/CDPS_Module0_Sales.md` §5.
> **Dua PR terbuka (BELUM di-merge), keduanya dari `origin/main` `bde32d4`:**
> - **PR #37** `claude/m1-pool-claim-attempt-client-syt5jx` — M1 Pool claim + read model.
> - **PR #38** `claude/m5-finance-payment-verification` — M5 Admin & Finance (LENGKAP).
> Keduanya independen (branch berbeda dari main); bisa direview & di-merge terpisah.

---

## ⭐ MULAI DI SINI

Setelah money-path M0 (registration→qualified→MSL→negotiation→closing) landed di `main`
(sesi 10), sesi ini menambah **M1 Pool claim + read model** dan **M5 Admin & Finance lengkap**.
Belum ada yang di-merge — begitu PR #37/#38 masuk `main`, kerja berikutnya = branch BARU dari
`origin/main` terbaru (buat PR baru; jangan menumpuk di branch lama).

### PR #37 — M1 Pool claim + read model attempt/client
- **`leads.claim(sql, actor, leadId)`** (M1 §6) + tabel keputusan murni **`decideClaim`**:
  won→block `[lead sudah menjadi klien]`; sudah pegang attempt terbuka→block
  `[anda sudah memiliki prospek aktif untuk lead ini]`; `[Pool]`→claim; `[Rejected]`/`[Not Qualified]`
  →**reclaim** (reopen `→[Pool]` via engine dulu); scouted-eksklusif→block
  `[lead sedang diproses oleh sales lain (nama)]`. Lock lead `FOR UPDATE`; audit `claim`/`claim_blocked`.
  Kompetisi multi-sales by design (M1-OA-1); pemenang di-resolve saat closing (`resolveWin`).
- **Read model** (`sales.ts`): `listAttempts`, `getAttempt` (Qualified draft + proposal terakhir=quote),
  `getClient` (M4 dasar: client + platforms + alokasi + services + transaction+installments).
- **API:** `POST /leads/{id}/claim`, `GET /attempts`, `/attempts/{id}`, `/clients/{id}`.

### PR #38 — M5 Admin & Finance (LENGKAP, §3–§7 + OA-1/3/4/5/6)
Modul baru **`packages/domain/src/finance.ts`**:
- **`verifyPayment`** (§3/§4/§5) — append event immutable `payment_verifications` → transisi
  `installment`→`[Terverifikasi]` → roll-up `transaction_payment`
  (`[Menunggu Verifikasi]`→`[Terverifikasi - Sebagian]`→`[Lunas]`) → **routing gate** (verifikasi
  PERTAMA merilis client ke Account). Guard: over-verifikasi `[jumlah melebihi total transaksi,
  periksa kembali]`; gate kontrak sebelum `[Lunas]` `[kontrak belum diupload, lengkapi sebelum
  verifikasi penuh]`. `[Lunas]` roll-up per §4 Rule 3: skema berjadwal butuh SEMUA installment
  `[Terverifikasi]`; Lunas/Sebagian berbasis jumlah.
- **`attachContract`** — set contract link (gate keras `[Lunas]`).
- **`scanReminders`** (§6/§7 Rule 3) — batch fire-once: overdue `→[Jatuh Tempo]` + notif
  `m0m5.installment.due`; H-3 upcoming; soft 7-hari kontrak → `m5.contract.not_received`.
  **`reminderDashboard`** — READ murni (overdue-first + label `[jatuh tempo X hari, segera tindak
  lanjuti]`, upcoming, "Outstanding No-Due-Date" utk Bayar Sebagian).
- **`flagBermasalah` / `resolveBermasalah`** (§5 Rule 5 / M5-OA-5) — flag dispute (tak ubah Payment
  Status), resolusi joint: KEDUA SPV (Finance∧Account lead) approve ATAU Director approve; vote
  append-only `transaction_issue_approvals`, per-siklus (`bermasalah_flagged_at`).
- **`changeScheme`** (§4 Rule 5 / M5-OA-6) — SPV/Head Finance/Director, alasan wajib, **pra-verifikasi
  saja** (bila ada pembayaran terverifikasi → `SchemeLockedError`); ganti scheme+jadwal (INST- baru),
  audit, tak hapus Transaction. `[total termin tidak sama dengan nilai transaksi]` bila jadwal ≠ total.
- **Read model DERIVED** (house rule #4, nol tabel): `getPaymentStatus` (Amount Verified/Outstanding),
  **`commissionAchievement`** (M0 §5 §138 — komisi dikenali pro-rata ke Amount Verified, dipecah per
  alokasi). Primitif uang BARU **`money.proRata(amount, num, den)`** di `@cdps/core`.
- **API:** `POST /transactions/{id}/verify` `/contract` `/scheme` `/bermasalah` `/bermasalah/resolve`,
  `GET /transactions/{id}/payment` `/commission`, `GET /reminders`, `POST /reminders/scan`.

**Verifikasi lokal (SUDAH dijalankan, hijau) — PG16 fresh + SEMUA 53 migrasi + integration nyata:**
```
# PR #38 branch:  core 112 (+6 proRata)   db 9   domain 122 (finance 31)   api 29
# PR #37 branch:  core 106   db 9   domain 109 (claim + read model)   api 29
# Semua typecheck bersih. NOL string BI baru, NOL event baru, NOL migrasi baru (kedua PR;
#   PR #37 juga nol migrasi). Katalog notifikasi tetap 15 event FROZEN.
```
> Menjalankan integration test lokal: butuh Postgres 16 (`initdb`/`pg_ctl` sebagai user `postgres`,
> BUKAN root), `createdb cdps`, apply `supabase/migrations/*.sql` berurut → 53 tabel, lalu
> `DATABASE_URL=postgres://postgres@127.0.0.1:5433/cdps npm test` di tiap paket.

---

## Langkah kode berikutnya (urut) — TASK TERDEKAT

Wave 1 money-path M0/M1/M5 kini pada dasarnya lengkap. Yang tersisa di Wave 1 (Build Plan §4):

1. **M4 Client Record v2** (`docs/prd/CDPS_Module4_*.md`) — epik Wave 1 terakhir:
   - **Lock matrix server-side** (§4) — siapa boleh edit field apa & kapan (banyak field terkunci
     pasca-closing; hanya jalur tertentu boleh ubah). `getClient` dasar sudah ada (PR #37) — tinggal
     jalur tulis + gate.
   - **Void Service + cascade** (§ M4-OA-5 / STATE_MACHINES §6) — SPV/Account Lead approval; cascade
     child Briefs belum `[Approved]` → `[Cancelled — Service Voided]` (Brief machine baru masuk Wave 2,
     jadi kemungkinan slice tipis dulu).
   - **Client platforms management** + visibility (own vs all, §6). Provenance & OD-1 fields
     (Commission PIC + Sales Allocation) sudah lahir saat closing.
   - Rujukan Go: `module4_client/*`.
2. **Gate exit Wave 1 (UAT)** — Build Plan §4: satu deal riil end-to-end (register→qualified→
   negotiated→closed→IDs→Termin→Finance verify→routing ke Account; komisi dicek silang vs MSL).
   Pola runbook: `docs/handoff/W1-20_UAT_RUNBOOK.md`. **Gerbang manusia** (Sales+Finance pilot).
3. Setelah exit Wave 1 → **Wave 2** (M6 Account & Service, **M12 early**, M7–M10). JANGAN mulai tiket
   Wave 2 sebelum kriteria exit Wave 1 lolos (Build Plan §4 / R5).

## Peringatan (tetap berlaku)

- **Kedua PR belum di-merge.** Bila di-merge dengan urutan berbeda mungkin ada konflik ringan di
  `apps/api/src/lib/http.ts` (mapError) & `packages/domain/src/index.ts` (export) & `docs/DECISIONS.md`
  (kedua entri append) — resolusi trivial (ambil kedua sisi). `packages/domain/src/sales.ts`: PR #37
  menambah read model, PR #38 mengimpor `computeCommission`/`parseCommissionRule` (sudah ada di main)
  — tak bentrok.
- Status birth (CLI/TRX/SVC/INST) di-insert = state awal; transisi lanjutan HANYA `sm_transition`.
  Uang HANYA `@cdps/core money` (bigint). Versi proposal/MSL immutable; auto-calc read-only &
  recomputable (Amount Verified & commission achievement = derived dari log, nol kolom mutable).
- ID hanya pasca-validasi & tak reuse (installment baru di `changeScheme` pakai `ident_next('INST')`).
- Predikat izin 3 implementasi (permission.ts / RLS / claims) tak boleh divergen.
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis; audit append-only. Setiap deviasi →
  entri `docs/DECISIONS.md` (dua entri M5 + satu entri M1-claim sudah ditulis sesi ini).
- **Interpretasi ter-log M5** (lihat DECISIONS 2026-07-23 "M5 LENGKAP"): `[Jatuh Tempo]` = status
  lifecycle + boolean `jatuh_tempo` cermin denormalisasi (bergerak bersama); `changeScheme` pra-verifikasi
  saja; scan = SYSTEM actor + WIB. Bila pemilik ingin scheme-change pasca-pembayaran, itu keputusan baru.
- Gate CI-infra & gate manusia Fase 1 (handoff sesi 5 §2/§3, sesi 4 auth) masih berlaku.
