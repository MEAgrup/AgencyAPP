# HANDOFF — Fase 1 lanjut: MSL admin (minimal) landed (sesi 8)

> Standalone. Baca bersama `docs/handoff/HANDOFF_FASE1_SESI7_M0_QUALIFIED.md`,
> `packages/domain/src/{msl,sales}.ts`, `docs/prd/CDPS_Module0_Sales.md` §9 (OD-2).
> Branch: `claude/handoff-fase1-docs-bwr0jg` → PR #34 (menargetkan `main`).

---

## ⭐ MULAI DI SINI

Branch ini kini memuat **tiga potongan Wave 1 M0/M1** di atas `main` (Fase 0 + Fase 1 1–4):

1. **M1 Lead Registration** (dedup v2) — `leads.ts` (sesi 6).
2. **M0 Qualified stage** — `sales.ts` (sesi 7).
3. **MSL admin (minimal)** — `msl.ts` (sesi 8, INI): katalog Master Service List
   Sales-owned (DECISIONS OD-2), versi **immutable** (setiap edit = versi baru).

**`packages/domain/src/msl.ts` (`@cdps/domain` → `msl`):**
- READ kanonik: `effectiveAt(sql, id, date)` + `listEffectiveAt` + `listVersions` + `ServiceView`
  (versi efektif = versi terbaru dgn `effective_from ≤ date`). **`sales.ts` kini meng-import
  read ini** (bukan lagi salinan lokal) — satu sumber, tak divergen (mirror split paket Go).
- WRITE (gate `canEditMasterServices` = Sales Lead/SPV atau Director; staff/OD ditolak,
  BI `[anda tidak memiliki akses untuk mengubah master service list]`):
  - `createService` — mint **MSV-** id (pasca-validasi), insert `master_services` + versi 1 + audit.
  - `updateService` — append versi immutable berikutnya + audit (tak ada mutate in-place).
  - `normalizeInput` — validasi MSL v2 (mode flat/min_floor/batch_ceiling/passthrough, frequency
    Monthly/One-time/Campaign, harga per-mode, min_qty whole positive). Math via `@cdps/core money`.

**apps/api (port rute Go):**
- `GET /api/v1/master-services` (efektif hari ini WIB), `POST /api/v1/master-services` (create),
  `PUT /api/v1/master-services/{id}` (versi baru), `GET /api/v1/master-services/{id}/versions`.
- `lib/http.ts` `mapError`: `msl.Incomplete`→400, `msl.ServiceNotFound`→404, `msl.Forbidden`→403.

**Infra tes:** `packages/domain/vitest.config.ts` set `fileParallelism: false` — tes integrasi
tiap file membuka pool postgres.js ke SATU DB; paralel penuh membanjiri slot koneksi. Serialisasi
antar-file (unit dalam file tetap paralel) → andal.

**Verifikasi lokal (SUDAH dijalankan, hijau):**
```
cd packages/domain && npm ci && npm run typecheck && npm test   # 75 (leads 18 + sales 20 + msl 7 + demo 11 + employees 19)
# + core 106, db 9, apps/api 29 (typecheck bersih)
# DB: apply semua supabase/migrations/*.sql ke PG16 kosong → 53 tabel; DATABASE_URL diset →
#   msl: create MSV + versi immutable + effectiveAt cutover + listEffectiveAt + gate izin.
```

---

## Langkah kode berikutnya (urut)

1. **M0 Negotiation** — `negotiation_proposals`(+lines) versioned; status
   `Negotiation - Pending Approval/Auto Approved/Approved/Revision Required/Rejected`;
   notif `m0.negotiation.pending_approval` / `m0.negotiation.decision`.
   Rujukan Go: `module0_sales/negotiation.go`.
2. **M0 Closing** — Closing Form: alokasi sales Σ=100% (basis points), Commission/Payment PIC,
   Payment Scheme; birth `clients`/`services`/`transactions`/`installments` (+ Payment Intent →
   antrian Finance M5); win-resolution M1 §6 dalam transaksi closing.
   Rujukan Go: `module0_sales/{closing,allocation}.go`.
3. **(Opsional)** attempt read model (`GET /attempts`, `/attempts/{id}`), Pool claim (M1 §6),
   MSL admin non-minimal (deactivate/echo penuh kategori/frequency di list bila UI perlu).

## Peringatan (tetap berlaku)

- Versi MSL immutable (INSERT-only) — snapshot Qualified/Closing yang mem-pin versi lama tetap
  reproducible (CLAUDE.md #3/#4). Math uang HANYA `@cdps/core money` (bigint) — jangan float.
- Predikat izin 3 implementasi (permission.ts / RLS / claims) tak boleh divergen.
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis; transisi HANYA `sm_transition`;
  audit append-only; ID hanya pasca-validasi. Setiap deviasi → entri `docs/DECISIONS.md`.
- Gate CI-infra & gate manusia Fase 1 (handoff sesi 5 §2/§3) masih berlaku.
