# HANDOFF — Fase 1 lanjut: M0 Negotiation landed (sesi 9)

> Standalone. Baca bersama `docs/handoff/HANDOFF_FASE1_SESI8_MSL_ADMIN.md`,
> `packages/domain/src/sales.ts`, `docs/prd/CDPS_Module0_Sales.md` §5.
> **Lokasi branch terakhir:** `claude/handoff-fase1-docs-bwr0jg` — sudah **di-merge ke `main`**
> (lihat §Status). Kerja berikutnya = perubahan BARU di atas `main` terbaru (branch di-restart
> dari `origin/main`; PR baru, bukan PR lama).

---

## ⭐ MULAI DI SINI

`main` kini memuat **Wave 1 M0/M1** sampai **Negotiation** (di atas Fase 0 + Fase 1 1–4):
M1 Lead Registration → M0 Qualified → MSL admin → **M0 Negotiation** (sesi 9, INI).

**M0 Negotiation** ditambahkan ke `packages/domain/src/sales.ts` (satu modul M0, reuse
`loadAttempt`/`canWriteAttempt`/`attemptTransition`/`parseCommissionRule`):
- `submitNegotiation(sql, actor, attemptId, lines, noNego)` —
  - `noNego=true` (+ tanpa lines): ambil term standar dari snapshot Qualified Form
    (proposed_price = **subtotal ter-pin**, bukan unit price) → **Negotiation - Auto Approved**
    (bypass superior). `noNego` + lines → `CustomTermRequiresNegotiationError` (→400).
  - custom: tulis proposal versioned (**NEG-**) + lines → **Negotiation - Pending Approval**,
    emit `m0.negotiation.pending_approval` (leadsOfDivision Sales).
- `resubmitNegotiation` — versi proposal baru setelah Revision/Reject → Pending Approval.
- `decideNegotiation(actor, decision, note)` — superior `approve`/`revise`/`reject`
  (revise/reject **wajib note**); edge Lead/Director-only **ditegakkan engine** (role_denied →403,
  tak menulis apa pun); decision_note ditulis ke versi proposal terbaru yang belum ber-note;
  emit `m0.negotiation.decision` ke owner (explicit).
- `acceptCounter` — owner terima counter: Revision Required → Approved.
- Pola transaksi: **transition dulu** (edge tak valid/role_denied → return hasil, nihil ditulis);
  proposal ditulis hanya bila transition ok → rollback atomik bila write gagal.

**apps/api (port rute Go):**
- `POST /api/v1/attempts/{id}/negotiation` (submit; body `{no_negotiation, lines:[{master_service_id,
  proposed_price, commission_rule, payment_terms}]}`)
- `POST /api/v1/attempts/{id}/negotiation/decision` (`{decision, note}`)
- `POST /api/v1/attempts/{id}/negotiation/accept`
- `POST /api/v1/attempts/{id}/negotiation/resubmit`
- `lib/http.ts` `mapError`: `sales.CustomTermRequiresNegotiationError` → 400.

**Verifikasi lokal (SUDAH dijalankan, hijau):**
```
cd packages/domain && npm ci && npm run typecheck && npm test   # 83 (sales 28 [+8 nego] + leads 18 + msl 7 + demo 11 + employees 19)
# + core 106, db 9, apps/api 29 (typecheck bersih)
# DB: apply semua supabase/migrations/*.sql ke PG16 kosong → 53 tabel; DATABASE_URL diset →
#   nego: no-nego→Auto Approved (proposal dari subtotal), custom→Pending→approve (+notif owner),
#   non-superior decide→role_denied (nihil ditulis), revise→resubmit v2, revise→acceptCounter→Approved.
```
Start PG lokal: `initdb` sbg user `postgres`, `pg_ctl start -o '-p 5470 -k /tmp'`, `createdb cdps`,
apply migrasi, `DATABASE_URL=postgres://postgres@127.0.0.1:5470/cdps`.

---

## Langkah kode berikutnya (urut) — TASK TERDEKAT = M0 Closing

1. **M0 Closing** (M0 §6) — Closing Form dari attempt `Negotiation - Approved`/`Auto Approved`:
   - Primary Salesperson (locked) + s.d. 5 sales, **alokasi Σ=100%** (basis points, `client_sales_allocations`),
     Commission & Payment PIC (bila >1 sales).
   - Birth **CLI-** (`clients`, inherit data Qualified terkunci + origin campaign), **TRX-** (`transactions`,
     Payment Intent/Scheme), **SVC-** (`services` per jasa), `Termin` → **INST-** (`installments` jadwal).
   - Win-resolution M1 §6 (kompetitor Pool → `[Closed - Kalah Kompetisi]`) DALAM transaksi closing
     (Go pakai `WinResolverFunc` untuk hindari cycle; di TS panggil `leads.resolveWin` bila sudah ada).
   - Rujukan Go: `module0_sales/{closing,allocation}.go`, `allocation_test.go` (Σ=100% basis points).
2. **M1 Pool claim + win-resolution** (M1 §6) — `module1_leads/{claim,winresolve}.go`.
3. **(Opsional)** attempt read model (`GET /attempts`, `/attempts/{id}` + detail negosiasi).

## Peringatan (tetap berlaku)

- Alokasi Σ **tepat 100%** (basis points, 10000) — else block; math uang HANYA `@cdps/core money`
  (bigint). Versi proposal/MSL immutable; auto-calc read-only & recomputable (CLAUDE.md #3/#4).
- Predikat izin 3 implementasi (permission.ts / RLS / claims) tak boleh divergen.
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis; transisi HANYA `sm_transition`;
  audit append-only; ID hanya pasca-validasi. Setiap deviasi → entri `docs/DECISIONS.md`.
- Gate CI-infra & gate manusia Fase 1 (handoff sesi 5 §2/§3) masih berlaku.
