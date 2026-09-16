# Bridge MCN→CDPS — Product Exchange Coverage Payload Contract v1

Product Exchange M3, Flow C (`docs/prd/CDPS_ProductExchange_M3.md` §4/§7). This
document is the **single source of truth** for the payload `mcnapp`'s
coverage-push pipeline POSTs to CDPS's
`POST /api/v1/internal/bridge/px-coverage`. Both repos build against this
file — neither infers the shape from the other's code, and the fixture below
(`docs/fixtures/px_coverage_v1.json`) is committed **identically** in both
repos (preseden D12, `BRIDGE_MSDPS_CONTRACT.md`: duplicated types, one shared
fixture, no published package).

Authority: `docs/DECISIONS.md` 2026-09-15 (Product Exchange M3-B). Parsed by
`packages/domain/src/productexchange-m3.ts` (`intakeCoverage`); built by
`mcnapp`'s `src/lib/px/coverage-push.ts` (M3-A, sesi terpisah).

**PX-M3-03**: path final adalah `/internal/bridge/px-coverage` (konvensi path
repo), BUKAN `/api/bridge/px-coverage` yang PRD §7 ilustrasikan.

## Envelope

| Header | Value |
|---|---|
| `Authorization` | `Bearer <BRIDGE_PX_SECRET>` — secret SEPARATE dari `BRIDGE_INGEST_SECRET`/`CRON_SECRET`/`PLAN_TICK_SECRET` |
| `Idempotency-Key` | `px-coverage-<YYYYMMDD>-<sha256(payload)[0:12]>` — kunci berulang mengembalikan hasil ASLI, HTTP 200, nol baris baru |
| `Content-Type` | `application/json` |

Response: `{ "batch_key": "px-coverage-20260918-a1b2c3d4e5f6", "rows_received": 214, "duplicate": false }`.

## Body shape (v1)

```jsonc
{
  "snapshot_at": "2026-09-18T02:14:00Z",  // ISO 8601 instant — waktu payload
                                          // dibuat DI MCN, bukan waktu terima
  "source": "mcnapp",                    // pengirim, apa adanya
  "policy_note": "aggregate-only; no creator identity (K-2)",  // catatan bebas, opsional secara semantik tapi WAJIB hadir sebagai key
  "rows": [                              // 1..5000 baris
    {
      "level2_category": "Sepatu Wanita",     // nilai dari taksonomi MCN, apa adanya
      "price_segment": "mid",                 // TEXT, bukan enum CDPS — lihat Non-negotiables #2
      "creator_count": 7,
      "total_slots_available": 19,
      "total_proven_gmv": 1284000000.00,       // numeric, BUKAN string berformat lokal
      "status": "covered"                     // "covered" | "kosong", tepat dua nilai
    }
  ]
}
```

## Non-negotiables (both sides assert these)

1. **Persis 6 kolom per baris + `snapshot_at`/`source`/`policy_note` di top-level** (K-1). Kolom asing di MANA PUN (top-level atau baris) ⇒ **422** — `ProductExchangeContractError`, pesan `[payload coverage tidak sesuai kontrak: kolom '<x>' tidak dikenal]`. Menambah kolom = perubahan kontrak (edit dokumen ini dulu), bukan perubahan kode diam-diam.
2. **`price_segment` adalah TEXT, bukan enum CDPS.** Nilainya dimiliki MCN — meng-enum-kannya di CDPS menciptakan dua sumber kebenaran untuk daftar segmen. `px_coverage_snapshot.price_segment` menyimpannya apa adanya.
3. **Nol identitas kreator, MUTLAK (K-2).** `creator_id`/`creator_ids`/nama kreator/apa pun yang menunjuk SATU kreator TIDAK PERNAH ada di payload ini — ditolak 422 lewat aturan #1 (bukan kolom yang dikenal), diuji eksplisit (bukan tersirat) di kedua repo.
4. **Angka volume klien TIDAK PERNAH ke arah sebaliknya (D-06).** Payload ini murni agregat coverage; `gmv_30d`/pesanan/angka apa pun milik klien CDPS tidak pernah muncul di sini maupun di respons.
5. **Arah: MCN push → CDPS terima, selalu.** CDPS tidak pernah menarik dari MCN (D-20). Frekuensi: mingguan, di akhir pipeline ingest MCN — lebih sering percuma (`proven_*` hanya berubah saat ingest).
6. **Idempotensi wajib.** `Idempotency-Key` yang berulang ⇒ HTTP 200, hasil ASLI dari `px_coverage_push` (bukan re-parse payload baru), nol baris `px_coverage_snapshot` baru.
7. **Baris ≤ 5.000 per request; nol baris ⇒ 422** (`rows` kosong bukan payload yang sah — MCN yang punya nol coverage baru sama sekali tidak perlu push).
8. **Degradasi: snapshot basi TIDAK memblokir katalog.** Bila push MCN gagal/terlambat, CDPS memakai snapshot TERAKHIR yang berhasil — katalog PX tetap tampil dengan banner "data basi" (> 10 hari kalender), hanya pembuatan match baru (M5, belum dibangun) yang diblokir. CDPS tidak menghapus/mengosongkan snapshot lama karena push baru gagal.

## Storage on the CDPS side

`px_coverage_push.payload` menyimpan JSON ini **APA ADANYA** (raw, snake_case),
immutable via trigger (pola `external_orders.payload`) — kunci idempotensi +
jawaban ASLI untuk key berulang. `px_coverage_snapshot` menyimpan salinan
TERURAI per baris, JUGA append-only via trigger, dan **TERBUKA `SELECT` untuk
`authenticated`** (`USING(true)`, ledger O48 `rls_checks.sql` §42) — agregat
lintas kategori/segmen tanpa data klien/kreator, bukan pelebaran akses.

## What is deliberately NOT in this payload

- **Nol identitas kreator** (K-2) — lihat Non-negotiables #3.
- **Nol angka volume klien** (D-06) — lihat Non-negotiables #4.
- **Nol `coverage_snapshot_id` per baris.** `px_sku_eligibility` merujuk
  `coverage_snapshot_batch_key` (text, kunci idempotensi), bukan satu baris
  snapshot spesifik — L4 mengevaluasi per `(level2_category, price_segment)`,
  yang bisa berupa beberapa baris snapshot dalam satu `batch_key` yang sama.
- **Nol status callback.** Fase 1 satu arah; MCN tidak menerima apa pun balik
  selain `{batch_key, rows_received, duplicate}` di respons HTTP itu sendiri.

## Fixture

`docs/fixtures/px_coverage_v1.json` — tiga baris (`Sepatu Wanita/mid covered`,
`Tas Wanita/mid kosong`, satu `high`), committed identik di
`MEAgrup/AgencyAPP` dan `yohanagustian-del/mcnapp`. Digunakan oleh:

- CDPS: `packages/domain/src/productexchange-m3.test.ts` (parses + intake
  end-to-end via `intakeCoverage`, dibaca lewat `readFileSync`).
- MCN (M3-A, sesi terpisah): pembangun payload output-nya harus cocok bentuk
  fixture ini byte-untuk-byte pada input yang sama.

## Amending this contract

Bila satu baris coverage butuh field baru: perbarui dokumen ini **dulu**,
catat di `docs/DECISIONS.md` (kedua repo), baru tulis kode yang membacanya di
kedua sisi. Field yang diciptakan satu sisi dan diam-diam diabaikan sisi lain
adalah persis drift yang dokumen ini mencegah.
