# Bridge MSDPS→CDPS — Payload Contract v1

Fase 1 of the MSDPS (MEAGO!/MCN MEA, `MEAgrup/MEAGO_MSDPS`) → CDPS
(`MEAgrup/AgencyAPP`) bridge. This document is the **single source of truth**
for the payload MSDPS's `cdps_outbox` delivery job POSTs to
`POST /api/v1/internal/bridge/orders`. Both repos build against this file —
neither infers the shape from the other's code, and the fixture below
(`docs/fixtures/bridge_order_v1.json`) is committed **identically** in both
repos (decision D12: duplicated types, one shared fixture, no published
package — two private repos with different toolchains).

Authority: `docs/DECISIONS.md` 2026-09-10 (Bridge MSDPS→CDPS Fase 1). Parsed
by `packages/domain/src/bridge.ts` (`parsePayloadV1`); built by MSDPS's
`lib/bridge/payload.ts`.

## Envelope

| Header | Value |
|---|---|
| `Authorization` | `Bearer <BRIDGE_INGEST_SECRET>` — a secret SEPARATE from `CRON_SECRET`/`PLAN_TICK_SECRET` |
| `Idempotency-Key` | `<DEAL code>:<payload_versi>`, e.g. `DEAL-202609-0001:1`. A repeated key returns the ORIGINAL `ord_code`, HTTP 200, zero new rows |
| `Content-Type` | `application/json` |

Response: `{ "ord_code": "ORD-202609-0001", "status": "[Masuk]" }`.

## Body shape (v1)

```jsonc
{
  "payload_versi": 1,               // integer, MUST be 1 in Fase 1 — unknown
                                     // versions are rejected with an explicit
                                     // BI message, never guessed
  "deal_code": "DEAL-202609-0001",   // MSDPS brand_deals.code (immutable)
  "bd_identitas": "…",               // free text identifying the MEAGO BD who
                                     // brought this merchant — stored verbatim
                                     // in the immutable payload AND copied to
                                     // client_external_billing.diverifikasi_oleh_external
                                     // (D5 opsi b: it does NOT drive sales_pic_id)
  "merchant": {
    "external_id": "…",             // brand_deals.shop_id if present, else merchants.id
    "nama": "…",                    // brand_deals.brand_name / merchants.nama_toko —
                                     // NEVER the TikTok export's "Merchant" column
                                     // (OTA/delivery platforms) — see GLOSARIUM trap
    "kota": "…",
    "kategori_poi": "…",             // e.g. "Dining", "Accomodation" (sic — MSDPS DB
                                     // spelling, one 'm'; never renamed here)
    "pic_nama": "…",
    "pic_whatsapp": "…" | null,
    "tanggal_mulai_kontrak": "YYYY-MM-DD",  // WIB calendar string, NOT a visit window
    "tanggal_akhir_kontrak": "YYYY-MM-DD"
  },
  "attestation": {                  // MANDATORY block — CDPS refuses an order
                                     // without it, for ANY actor, Director
                                     // included (D4+D13 guarantee on the CDPS side)
    "external_trx_ref": "…",        // MSDPS transactions.id (or equivalent ref)
    "bentuk_kerjasama": "Berbayar", // ALWAYS this literal — Free/Barter never bridged
    "nilai": "15000000.00" | null,  // informational; integer-rupiah DECIMAL string,
                                     // never a float, never localized
    "diverifikasi_pada": "2026-09-10T03:15:00Z", // = transactions.released_to_account_at,
                                     // ISO 8601 instant. REQUIRED — absence is rejected
    "diverifikasi_oleh_external": "…" | null
  },
  "lines": [                        // at least 1
    {
      "jenis": "Account" | "Ads" | "Creative" | "Store Operation" | "KOL-Non-Roster" | "Live Stream",
      "qty": 1 | null,
      "catatan": "…" | null,
      "alasan_non_roster": "…" | null,  // REQUIRED when jenis = "KOL-Non-Roster"
      "nilai_cross_charge": "500000.00" | null  // integer-rupiah DECIMAL string, D16
    }
  ]
}
```

## Non-negotiables (both sides assert these)

1. **Dates are WIB calendar strings** (`YYYY-MM-DD`), never a UTC instant
   sliced — CDPS freezes `WIB_OFFSET_HOURS=7` as a single-source invariant,
   and a post-17:00 WIB slice of a UTC instant is a whole calendar day wrong.
2. **Money is a decimal string in integer rupiah**, never a float, never a
   localized string (`"15.000.000"` is wrong). `nilai`/`nilai_cross_charge`
   parse with `@cdps/core` `money.parse`.
3. **`attestation` is mandatory and `bentuk_kerjasama` is always `"Berbayar"`**
   — the payment gate (D4+D13) lives at the MSDPS source (`deal_bridge_lines`
   triggers); CDPS re-asserts it on every read of the stored payload
   (`bridge.parsePayloadV1`), not only at intake.
4. **`jenis` is the closed set of six values above.** D2 (2026-09-10) originally
   excluded `"Live Stream"` (MSDPS keeping it as its own vendor tracker); the
   owner reversed that 2026-09-12 (`docs/DECISIONS.md` D2 amendment) — Live
   Stream work is now bridged like the rest. The closed set is enforced ONLY
   as a MSDPS CHECK constraint (`deal_bridge_lines`, migration
   `0362_bridge_livestream_jenis.sql`); this parser accepts `jenis` as a free
   string matched against `external_service_map.external_service_type`, so no
   CDPS-side code changed when the set grew. `"KOL-Non-Roster"` without
   `alasan_non_roster` is rejected.
5. **The `merchant` glossary trap**: `nama`/`kota` etc. describe the
   brand/POI. MSDPS's `otaPlatformsRaw` "Merchant" column (TikTok export,
   OTA/delivery platforms) must NEVER reach this payload — see MSDPS
   `docs/GLOSARIUM.md`.
6. **`kreator_needed`/`konten_needed`/visit window/VT reporting are NEVER
   bridged.** Creator needs met from the MCN MEA roster are structurally
   impossible to represent here (D1) — they stay in MEAGO's campaign/POI SOP
   engines.
7. **Unknown `payload_versi` is rejected with an explicit BI message.** A v2
   payload sent against this v1 contract is a bug on the MSDPS side, not a
   silent best-effort parse.

## Storage on the CDPS side

`external_orders.payload` stores this JSON **exactly as received** (raw wire
shape, snake_case) — immutable via trigger. `bridge.getOrder` /
`bridge.accept` re-derive the typed shape via `parsePayloadV1` on every read;
nothing caches a parsed/renamed copy.

## What is deliberately NOT in this payload

- No CDPS `TRX-`/transaction id — CDPS never creates a shadow transaction for
  a MEAGO order (see `docs/DECISIONS.md` 2026-09-10, A7 anti-drift).
- No `gmv_baseline`/`target_gmv`/`link_toko`/`kategori` — these are typed by
  the human accepting the order (D7), never derived from MSDPS data whose
  definitions differ from CDPS's own.
- No status callback fields — Fase 1 is one-way. `cdps_order_status` and any
  polling belong to Fase 2.

## Fixture

`docs/fixtures/bridge_order_v1.json` — one worked example (3 bridged lines:
`Account`, `Ads`, `KOL-Non-Roster` with its mandatory reason), committed
identically in both `MEAgrup/AgencyAPP` and `MEAgrup/MEAGO_MSDPS`. Used by:

- CDPS: `packages/domain/src/bridge.test.ts` (parses + accepts it end-to-end
  against a seeded `external_service_map`).
- MSDPS: `scripts/qc_bridge_payload.mjs` (payload builder output must match
  this fixture's shape byte-for-byte on the same input row).

## Amending this contract

If a bridged line turns out to need a field not listed here: update this
document **first**, flag it in `docs/DECISIONS.md`, and only then write code
that reads it on either side. A field invented on one side that the other
silently ignores is exactly the drift this document exists to prevent.
