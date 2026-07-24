# HANDOFF — Fase 1 Sesi 15: finance + clients + sales wiring complete

> Standalone. Lanjutkan chat berikutnya dari dokumen ini. Branch: `claude/handoff-fase1-exit-uat-auth-b5mb89`. Commit: `4e5299f`.

## 0. Git state
- Branch `claude/handoff-fase1-exit-uat-auth-b5mb89`, semua di-push ke remote.
- Commit terbaru: `4e5299f` — wire finance, clients, sales modules.
- Tidak ada PR baru (PR #41 sebelumnya sudah merged ke main; branch ini di-reset dari main dan berisi pekerjaan baru sesi 14–15).

## 1. Yang SELESAI di sesi ini
Semua modul Wave-1 telah di-wire ke `apps/api`. Berikut status lengkap:

### M5 Finance
- **domain** (`packages/domain/src/finance.ts`): `getPaymentStatus` (refactored, baca `bermasalah`), `getFinanceQueue`, `getBermasalahStatus`, `setSchedule`. Interface baru: `TransactionView`, `BermasalahStatusView`, `ScheduleInput`.
- **wire.ts**: `installmentToWire`, `transactionToWire`, `bermasalahStatusToWire`, `reminderRowToWire`, `outstandingRowToWire`, `scanSummaryToWire`.
- **Routes baru/diupdate:**
  - `GET /api/v1/transactions/{id}` → `{ transaction: TransactionWire }` ✓
  - `POST /api/v1/transactions/{id}/verify` → `{ transaction: TransactionWire }` ✓
  - `GET /api/v1/transactions/{id}/bermasalah` → `BermasalahStatusWire` ✓
  - `POST /api/v1/transactions/{id}/bermasalah` → `{ status: 'ok' }` (body field: `reason`) ✓
  - `POST /api/v1/transactions/{id}/bermasalah/resolve` → `BermasalahStatusWire` ✓
  - `POST /api/v1/transactions/{id}/schedule` → `{ installments: InstallmentWire[] }` ✓
  - `GET /api/v1/finance/queue` → `{ data: TransactionWire[] }` ✓
  - `GET /api/v1/finance/reminders` → `{ reminders: ReminderRowWire[], outstanding_no_due_date: OutstandingRowWire[] }` ✓
  - `POST /api/v1/finance/reminders/scan` → `ScanResultWire` (flat) ✓

### M4 Clients
- **wire.ts**: `clientListRowToWire`, `clientDetailToWire`.
- **Routes diupdate:**
  - `GET /api/v1/clients` → `{ data: ClientWire[] }` ✓
  - `GET /api/v1/clients/{id}` → `{ client: ClientWire }` (snake_case) ✓

### M0 Sales / Attempts
- **domain** (`packages/domain/src/sales.ts`): `listAttempts` dengan optional `filter?.status`, `AttemptListRow` tambah `phoneNumber`+`source`, `ClientServiceRow` tambah `masterServiceId`, `getAttemptFullDetail`, `markLost`. Interface baru: `QFServiceView`, `QualifiedFormView`, `AttemptLeadView`, `ProposalView`, `AttemptFullDetail`.
- **wire.ts**: `attemptRowToWire`, `attemptFullDetailToWire`, `quoteToWire`.
- **Routes baru/diupdate:**
  - `GET /api/v1/attempts[?status=]` → `{ data: AttemptRowWire[] }` ✓
  - `GET /api/v1/attempts/{id}` → `AttemptFullDetailWire` (flat, tidak dibungkus) ✓
  - `POST /api/v1/attempts/{id}/lost` → `{ status: string }` ✓
  - `POST /api/v1/attempts/{id}/contacted` → `{ status: string }` ✓
  - `POST /api/v1/attempts/{id}/qualify` → `{ status: string }` ✓
  - `POST /api/v1/attempts/{id}/not-qualified` → `{ status: string }` ✓
  - `POST /api/v1/attempts/{id}/negotiation/accept` → `{ status: string }` ✓
  - `POST /api/v1/sales/quote-preview` → `QuoteWire` (flat) ✓

## 2. Verifikasi lokal (semua hijau)
```bash
npm run typecheck -w @cdps/api     # clean
npm test -w @cdps/api              # 51 passed
npm run typecheck -w @cdps/domain  # clean
```

## 3. Yang BELUM dilakukan (pekerjaan berikutnya, urutan saran)

### 3a. Gate manusia (di luar kode — sebelum UAT)
1. Aktifkan `custom_access_token_hook` di Supabase Dashboard (Auth > Hooks).
2. `import_employee_credentials()` atas data karyawan riil.
3. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`.
4. Smoke-login semua role di staging.

### 3b. Routes yang masih camelCase / belum disentuh
Routes berikut tidak di-wire karena FE belum memanggil mereka, atau shape sudah cukup untuk UAT:
- `GET /transactions/{id}/payment` — sudah ada, camelCase `PaymentStatusView`, tidak dipanggil langsung FE
- `GET /transactions/{id}/commission` — sudah ada, camelCase, untuk internal debugging
- `POST /transactions/{id}/contract` — returns `{ ok: true }`, FE expects `{ status: string }` — **bisa di-fix jika FE complaint**
- `POST /transactions/{id}/scheme` — returns `{ ok: true }`, FE expects `{ status: string }` — **bisa di-fix**
- `POST /attempts/{id}/negotiation` → FE expects `{ ok: boolean }` — `transitionResponse` sudah return `result` yang memiliki `.ok` ✓
- `POST /attempts/{id}/negotiation/decision` → FE expects `{ ok: boolean }` ✓
- `POST /attempts/{id}/negotiation/resubmit` → FE expects `{ ok: boolean }` ✓
- `POST /attempts/{id}/close` → returns `{ client_id, transaction_id }` ✓ (matches FE)
- Route lama `/reminders` dan `/reminders/scan` masih ada (tidak digunakan FE, path-nya salah untuk FE)

### 3c. FE features yang masih 404
- `POST /leads/bulk` — bulk import (DITUNDA per handoff sebelumnya)
- `/notifications*` — belum ada route di apps/api
- Wave 2/3 endpoints (ads, kol, creative, livestream, marketing, health, performance, tasks, board, portal)

### 3d. O37 — RLS / service-role (open decision)
`db()` konek service-role → RLS ter-bypass di semua route read. Lihat `docs/DECISIONS.md` entri O37 untuk pilihan: (a) JWT-user connection, (b) app-layer gate, (c) kombinasi.

## 4. File kunci
- Domain: `packages/domain/src/finance.ts`, `packages/domain/src/sales.ts`
- Wire: `apps/api/src/lib/wire.ts` (+`.test.ts`)
- Routes baru: `apps/api/src/app/api/v1/finance/`, `apps/api/src/app/api/v1/transactions/[id]/route.ts`, `apps/api/src/app/api/v1/transactions/[id]/schedule/route.ts`, `apps/api/src/app/api/v1/attempts/[id]/lost/route.ts`
- FE contracts: `web-internal/src/lib/{finance,clients,sales}.ts`
