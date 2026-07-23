# HANDOFF — Fase 1 lanjut: M0 Qualified stage landed (sesi 7)

> Standalone. Baca bersama `docs/handoff/HANDOFF_FASE1_SESI6_M1_REGISTER.md` (potongan M1),
> `docs/prd/CDPS_Module0_Sales.md` (§4–§6), `packages/domain/src/{leads,sales}.ts`.
> Branch: `claude/handoff-fase1-docs-bwr0jg` (memuat DUA potongan: M1 register + M0 qualified).

---

## ⭐ MULAI DI SINI

Branch ini kini memuat **dua potongan vertikal Wave 1 M0/M1** di atas `main` (Fase 0 + Fase 1
langkah 1–4):

1. **M1 Lead Registration door** (dedup v2) — `packages/domain/src/leads.ts` (sesi 6).
2. **M0 Qualified stage** (sesi 7, INI) — `packages/domain/src/sales.ts`:
   - `markContacted` — New Lead → Contacted (owner / Sales Lead / Director).
   - `previewQuote` — Estimasi Nilai + Komisi read-only (tanpa persist).
   - `submitQualifiedForm` — pin versi MSL efektif hari ini (WIB), enforce cap 1..5
     (`[maksimal pilih 5 jasa saja!]`), persist form + baris jasa (subtotal ter-pin
     supaya recomputable), Contacted → Qualified — SATU transaksi.
   - `setNotQualified` — Contacted → Not Qualified + taksonomi NQ (`[Lainnya ...] <teks>`).
   - **Kalkulator MSL v2** (flat / min_floor / batch_ceiling / passthrough + PPN 11%) &
     **grammar commission** (`N% of standard price` / `flat Rp N`) — math uang eksak via
     `@cdps/core money` (bigint minor units). Read MSL `effectiveAt` (port `admin.EffectiveAt`).

**apps/api (handler tipis, port rute Go):**
- `POST /api/v1/sales/quote-preview`
- `POST /api/v1/attempts/{id}/contacted`
- `POST /api/v1/attempts/{id}/qualify`
- `POST /api/v1/attempts/{id}/not-qualified`
- `lib/http.ts` `mapError` diperluas: `sales.Incomplete`/`TooManyServices`→400,
  `sales.NotFound`→404, `sales.Forbidden`→403 (transition result → `transitionResponse`).

**Verifikasi lokal (SUDAH dijalankan, hijau):**
```
cd packages/domain && npm ci && npm run typecheck && npm test    # 68 (leads 18 + sales 20 + demo 11 + employees 19)
# + core 106, db 9, apps/api 29 (typecheck bersih) — semua hijau
# DB: apply semua supabase/migrations/*.sql ke PG16 kosong → 53 tabel; DATABASE_URL diset →
#   integrasi sales: preview quote, mark contacted (+deny non-owner), submit qualified
#   (pin MSL + subtotal + status Qualified + audit), cap>5 tak persist, incomplete, not-qualified.
```
Start PG lokal: `initdb` sbg user `postgres`, `pg_ctl start -o '-p 5470 -k /tmp'`, `createdb cdps`,
apply migrasi, `DATABASE_URL=postgres://postgres@127.0.0.1:5470/cdps`.

---

## Yang SENGAJA ditunda (bukan bug — ikut build order)

- **MSL admin CRUD** (`internal/admin` write path): baru READ `effectiveAt` yang diport
  (dibutuhkan pricing). Endpoint kelola Master Service List (Sales Head/SPV, versioned)
  belum diport — perlu untuk seed data riil sebelum Qualified dipakai produksi.
- **Negotiation + Closing** (M0 §5–§6): `negotiation_proposals`(+lines) versioned →
  superior approval → Closing (alokasi Σ=100% basis-points, birth CLI/TRX/SVC/INST,
  `client_sales_allocations`). Rujukan Go: `module0_sales/{negotiation,closing,allocation}.go`.
- **Attempt read model** (`GET /attempts`, `/attempts/{id}`), campaign linkage (M3, Wave 3),
  bulk-import Marketing, Pool claim + win-resolution (M1 §6).

## Langkah kode berikutnya (urut)

1. **MSL admin (minimal)** — port `admin.master_service` create/list/effective supaya ada
   jalur seed Master Service List (Sales-owned, versioned). Tanpa ini Qualified/Closing
   tak punya katalog jasa riil.
2. **M0 Negotiation** — `negotiation_proposals`+lines versioned, status
   `Negotiation - Pending Approval/Auto Approved/Approved/Revision Required/Rejected`,
   notif `m0.negotiation.pending_approval`/`m0.negotiation.decision`.
3. **M0 Closing** — Closing Form: alokasi sales Σ=100% (basis points), Commission/Payment PIC,
   Payment Scheme, birth `clients`/`services`/`transactions`/`installments` (+ Payment Intent
   → antrian Finance M5). Win-resolution M1 §6 di dalam transaksi closing.

## Peringatan (tetap berlaku)

- Auto-calc (Estimasi/Komisi/subtotal/PPN) read-only & recomputable dari versi MSL ter-pin
  + seleksi (CLAUDE.md #4). Math uang HANYA via `@cdps/core money` (bigint) — jangan float.
- Predikat izin 3 implementasi (permission.ts / RLS / claims) tak boleh divergen.
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis; transisi HANYA `sm_transition`;
  audit append-only; ID hanya pasca-validasi. Setiap deviasi → entri `docs/DECISIONS.md`.
- Gate CI-infra & gate manusia Fase 1 (handoff sesi 5 §2/§3) masih berlaku.
