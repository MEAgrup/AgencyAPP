# HANDOFF — Fase 1 lanjut: M1 Lead Registration (money-path entry) landed (sesi 6)

> Standalone. Baca bersama `docs/handoff/HANDOFF_FASE1_SESI5_MERGED.md` (§5 build order),
> `docs/prd/CDPS_Module0_Sales.md` (§3–§6), `docs/prd/CDPS_Module1_Leads_Database.md`,
> `packages/domain/src/demo.ts` (pola referensi vertikal).

---

## ⭐ MULAI DI SINI

Sesi ini menyelesaikan **langkah 1 §5 handoff sesi 5**, potongan pertama Wave 1 M0/M1:
**pintu registrasi lead (Sales single-registration, dedup v2)** — titik masuk seluruh
money path. Satu registrasi mencetak **LEAD-** (record sentral M1) + **PRSP-** (attempt
si sales), lewat SATU transaksi `@cdps/db` yang memakai KEEMPAT executor
(ident LEAD+PRSP, sm_transition `lead_record` di jalur reopen, audit, notify co-pursuit).

**Yang ditambahkan (stack Supabase/TS):**
- `packages/domain/src/leads.ts` (`@cdps/domain` → `leads`) — port dari Go
  `internal/module1_leads/{leads,dedup,normalize,reads}.go`:
  - `normalizePhone` (kunci dedup), tabel keputusan dedup murni `decide()`
    (create/block/reopen/join), pesan BI verbatim.
  - `register()` transaksional: create / reopen (terminal → [Pool] → active via
    engine) / join (co-pursuit + notif `m1.lead.co_pursuit`) / block (audit
    `dedup_blocked` tetap di-commit, lalu `BlockedError`).
  - Reads `list()` + `get()` (lead + attempt contest). Scope diserahkan ke RLS
    (sama seperti vertikal demo).
- `apps/api` — handler tipis: `GET/POST /api/v1/leads` + `GET /api/v1/leads/{id}`.
  `lib/http.ts` `mapError` diperluas: `leads.IncompleteError`→400,
  `leads.NotFoundError`→404, `leads.BlockedError`→**409** (padan Go `ErrBlocked`).

**Verifikasi lokal (SUDAH dijalankan, hijau):**
```
cd packages/domain && npm ci && npm run typecheck && npm test    # 48 (13 unit leads baru + 5 integration leads baru)
# + core 106, db 9, apps/api 29 (typecheck bersih) — semua hijau
# DB: apply semua supabase/migrations/*.sql ke PG16 kosong → 53 tabel;
#     DATABASE_URL diset → 5 integration leads jalan (create/list/co-pursuit/own-attempt-block/reopen)
```
Cara start PG lokal: `initdb` sbg user `postgres`, `pg_ctl start -o '-p 5470 -k /tmp'`,
`createdb cdps`, apply migrasi, `DATABASE_URL=postgres://postgres@127.0.0.1:5470/cdps`.

---

## Yang SENGAJA ditunda (bukan bug — ikut build order)

- **Campaign linkage / Source auto-derive** (M3, Wave 3): `RegisterInput.campaign_id`,
  `resolveCampaignForIntake`, `updateLastTouch`, origin/last-touch write. Kolom
  `origin_campaign_id`/`last_touch_campaign_id` di-insert NULL untuk sekarang.
- **Pintu Bulk Import Marketing** (M1 §3, channel `import`): tabel keputusan `decide()`
  sudah mendukung `CHANNEL_IMPORT` (diuji unit), tapi importer + endpoint belum diport.
- **Read-scope per-role penuh** (M1 reads.go: Pool board stale-flag, Leads DB scope
  Marketing-staff via campaigns): reads saat ini minimal; RLS jadi penegak (pola demo).

## Langkah kode berikutnya (urut)

1. **M0 Qualified stage** — Qualified Lead Form (`prospect_attempt` Contacted→Qualified),
   maks 5 jasa (`[maksimal pilih 5 jasa saja!]`), Estimasi Nilai Transaksi + Komisi
   auto (read-only, dari Master Service List — `backend/internal/admin/master_service.go`
   + `module0_sales/pricing.go`,`commission.go`). Kunci data klien pasca-submit.
2. **M0 Negotiation** (`negotiation_proposals`+lines, versioned) → **Closing**
   (alokasi Σ=100% basis-points, CLI/TRX/SVC/INST, `client_sales_allocations`).
   Rujukan Go: `module0_sales/{negotiation,closing,allocation}.go`.
3. **M1 Pool claim + win-resolution** (§6, `[Closed - Kalah Kompetisi]`) —
   `module1_leads/{claim,winresolve}.go`.

## Peringatan (tetap berlaku dari sesi 5)

- Predikat izin 3 implementasi (permission.ts / RLS / claims) tak boleh divergen.
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis; transisi HANYA
  `sm_transition`; audit append-only; ID hanya pasca-validasi.
- Gate CI-infra & gate manusia Fase 1 (sesi 5 §2/§3) masih berlaku — belum berubah.
