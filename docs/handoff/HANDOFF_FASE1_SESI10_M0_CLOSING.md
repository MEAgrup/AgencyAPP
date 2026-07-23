# HANDOFF — Fase 1 lanjut: M0 Closing landed (sesi 10)

> Standalone. Baca bersama `docs/handoff/HANDOFF_FASE1_SESI9_M0_NEGOTIATION.md`,
> `packages/domain/src/{sales,leads}.ts`, `docs/prd/CDPS_Module0_Sales.md` §6.
> **Lokasi branch terakhir:** `claude/handoff-fase1-docs-bwr0jg` — sudah **di-merge ke `main`**
> (lihat §Status). Kerja berikutnya = perubahan BARU di atas `origin/main` terbaru
> (branch di-restart dari main; buat **PR baru**, jangan pakai PR lama).

---

## ⭐ MULAI DI SINI

`main` kini memuat **Wave 1 M0/M1 SAMPAI CLOSING** (money path M0 lengkap end-to-end):
M1 Lead Registration → M0 Qualified → MSL admin → M0 Negotiation → **M0 Closing** (sesi 10, INI).

**M0 Closing** ditambahkan ke `packages/domain/src/sales.ts`:
- `close(sql, actor, attemptId, input)` — dari attempt **Negotiation - Approved/Auto Approved**
  (else `NotClosableError` →409), dalam SATU transaksi melahirkan:
  - **CLI-** (`clients`, inherit data Qualified terkunci + `origin_campaign_id` dari lead),
  - **client_platforms** (snapshot platform), **client_sales_allocations** (Σ=100% basis points),
  - **SVC-** per line (`services` `[Awaiting Onboarding]`, inherit `requires_strategy_plan` versi MSL),
  - **TRX-** (`transactions` `[Menunggu Verifikasi]`, total = Σ proposed_price versi proposal terakhir)
    + update `clients.transaction_id`/`payment_intent`,
  - **INST-** (`installments` `[Belum Jatuh Tempo]`) untuk `[Termin]`/`[Bayar di Belakang]`,
  - transisi attempt → **Closed-Success**, lalu **win-resolution M1 §6** (kompetitor Pool →
    `[Closed - Kalah Kompetisi]`), audit `closing`.
- `validateParties` (Σ **tepat 10000 bp** else `AllocationTotalError`; ≤5 else `TooManySalespeopleError`;
  Primary wajib punya share; PIC wajib & anggota bila >1 sales; solo → PIC = Primary).
- `validateShape` (skema `[Bayar Penuh (Lunas)]`/`[Bayar Sebagian]`/`[Termin]`/`[Bayar di Belakang]`
  ↔ jadwal; Termin ≥1, DiBelakang =1, Lunas/Sebagian =0; jumlah installment == total).

**M1 win-resolution** ditambahkan ke `packages/domain/src/leads.ts`:
- `resolveWin(tx, leadId, winningAttemptId, winnerEmployeeId)` — kunci lead FOR UPDATE, set
  `winning_attempt_id`, tutup semua attempt lain non-terminal → `[Closed - Kalah Kompetisi]`
  (SYSTEM/Director actor), audit `win_resolved`. `AlreadyResolvedError` bila sudah ada pemenang.
  Dipanggil dari `sales.close` DALAM transaksi closing (atomik, tak ada 2 pemenang).
  Catatan desain: `sales.ts` import `leads.resolveWin` (tak ada cycle — `leads.ts` tak import `sales`).

**apps/api:** `POST /api/v1/attempts/{id}/close` (body `{parties:{primary_salesperson_id, allocations:
[{salesperson_id, basis_points}], commission_payment_pic_id}, payment_scheme, installments:[{amount,
due_date}], managed_since}`); `mapError`: `AllocationTotal`/`TooManySalespeople` →400, `NotClosable`/
`AlreadyResolved` →409.

**Verifikasi lokal (SUDAH dijalankan, hijau):**
```
cd packages/domain && npm ci && npm run typecheck && npm test   # 91 (sales 36 [+8 closing] + leads 18 + msl 7 + demo 11 + employees 19)
# + core 106, db 9, apps/api 29 (typecheck bersih)
# DB: apply semua supabase/migrations/*.sql ke PG16 kosong → 53 tabel; DATABASE_URL diset →
#   closing: solo Lunas (CLI/TRX/SVC/alloc/audit), Termin (installments == total, else reject),
#   not-closable (Qualified), contested pool → kompetitor Kalah Kompetisi + winning_attempt_id.
```

---

## Langkah kode berikutnya (urut) — TASK TERDEKAT

1. **M1 Pool claim** (M1 §6) — `POST /leads/{id}/claim` (Sales klaim lead `[Pool]`), buat PRSP baru;
   sudah ada win-resolution. Rujukan Go: `module1_leads/claim.go`.
2. **Attempt/Client read model** — `GET /attempts`, `/attempts/{id}` (detail negosiasi/quote),
   `GET /clients/{id}` (Client Record M4 dasar). Rujukan Go: `module0_sales/reads.go`, `module1_leads/reads.go`.
3. **Mulai M5 Admin & Finance** (Wave 1 money path lanjutan) — verifikasi pembayaran installment
   (`[Terverifikasi - Sebagian]`/`[Lunas]`), routing gate, commission achievement pada Amount Verified.
   Rujukan Go: `module5_finance/*`.

## Peringatan (tetap berlaku)

- Alokasi Σ **tepat 100%** (basis points 10000) — math uang HANYA `@cdps/core money` (bigint), jangan float.
- Status birth (CLI/TRX/SVC/INST) di-insert langsung = state awal machine (seperti demo/leads); transisi
  lanjutan HANYA `sm_transition`. Versi proposal/MSL immutable; auto-calc read-only & recomputable.
- Predikat izin 3 implementasi (permission.ts / RLS / claims) tak boleh divergen.
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis; audit append-only; ID hanya pasca-validasi.
  Setiap deviasi → entri `docs/DECISIONS.md`.
- Gate CI-infra & gate manusia Fase 1 (handoff sesi 5 §2/§3) masih berlaku.
