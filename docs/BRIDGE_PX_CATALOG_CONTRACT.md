# Bridge CDPS→MCN — Product Exchange Catalog Payload Contract v1

Product Exchange, arah BALIK dari Flow C (`docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md`
adalah MCN→CDPS; dokumen ini adalah CDPS→MCN). Sumber kebenaran untuk payload
yang di-POST CDPS ke endpoint MCN `POST /api/bridge/px-catalog`. Kedua repo
membangun dari dokumen ini — bukan menebak bentuknya dari kode sisi lain — dan
fixture di bawah (`docs/fixtures/px_catalog_v1.json`) WAJIB disalin
byte-identik ke `MEAgrup/AgencyAPP` (preseden D12/PX-M3-A: tipe diduplikasi,
satu fixture bersama, tanpa paket terbit).

Sumber data sisi CDPS: view `px_catalog_item_v` (migrasi
`20261101010000_px_m3b_volume_eligibility_coverage.sql`) — SKU dengan verdict
`lolos` terbaru pada policy aktif. Job push sisi CDPS SUDAH dibangun
(2026-09-23, `MEAgrup/AgencyAPP` `docs/DECISIONS.md` "PX-CATALOG-PUSH-CDPS") — lihat §"Sisi CDPS"
di bawah untuk lokasi kodenya.

## Envelope

| Header | Value |
|---|---|
| `Authorization` | `Bearer <BRIDGE_PX_SECRET>` — SECRET YANG SAMA yang sudah dipegang kedua sisi untuk Flow C (bukan secret baru) |
| `Idempotency-Key` | `px-catalog-<YYYYMMDD>-<sha256(payload)[0:12]>` — kunci berulang mengembalikan hasil ASLI, HTTP 200, nol baris baru |
| `Content-Type` | `application/json` |

Response: `{ "batch_key": "px-catalog-20260923-a1b2c3d4e5f6", "rows_received": 214, "duplicate": false }`.

## Body shape (v1)

```jsonc
{
  "snapshot_at": "2026-09-23T02:14:00Z",  // ISO 8601 instant — waktu payload dibuat DI CDPS
  "source": "cdps",                       // pengirim, apa adanya
  "policy_note": "px_catalog_item_v; verdict lolos pada policy aktif",  // catatan bebas, WAJIB hadir sebagai key
  "rows": [                               // 0..5000 baris — snapshot PENUH, boleh kosong (lihat Non-negotiables #6)
    {
      "client_platform_id": "CLI-00042",       // identitas KLIEN CDPS, bukan kreator (K-2)
      "platform_product_id": "1729384756102",  // id produk di platform (Shopee/TikTok)
      "nama_produk": "Serum Wajah 30ml",
      "platform": "tiktok",                    // TEXT apa adanya dari CDPS, bukan enum MCN
      "nama_toko": "Toko Contoh Official",
      "level2_category": "Kecantikan",         // taksonomi MCN — dipakai langsung oleh Product Match
      "price_segment": "high",                 // TEXT milik taksonomi MCN (low/entry/sweet/high/premium);
                                                // CDPS mengisi dari taksonomi yang SAMA, bukan enum sendiri
      "sudah_afiliasi": false,                 // bool — SKU ini sudah punya kreator terhubung atau belum
      "dihitung_pada": "2026-09-22T18:00:00Z"  // ISO 8601 instant, kapan verdict CDPS dihitung; nullable
    }
  ]
}
```

## Non-negotiables (both sides assert these)

1. **Persis 9 kolom per baris + `snapshot_at`/`source`/`policy_note` di top-level** (K-1, sama pola Flow C). Kolom asing di MANA PUN ⇒ **422**, pesan `[payload katalog PX tidak sesuai kontrak: kolom '<x>' tidak dikenal]`. Menambah kolom = perubahan kontrak (edit dokumen ini dulu di kedua repo), bukan perubahan kode diam-diam.
2. **Nol angka volume, MUTLAK (D-06).** `gmv_30d`/pesanan/harga satuan/apa pun angka performa TIDAK PERNAH ada di payload ini — itu semua berhenti di CDPS. Baris hanya identitas produk + taksonomi + status afiliasi.
3. **Nol identitas kreator, MUTLAK (K-2).** `creator_id`/`creator_ids`/nama kreator TIDAK PERNAH ada — `sudah_afiliasi` adalah boolean agregat ("ada kreator atau tidak"), bukan daftar siapa.
4. **`price_segment` milik taksonomi MCN, diisi CDPS dari taksonomi yang sama** (kebalikan dari Flow C di mana `price_segment` milik MCN dikirim apa adanya ke CDPS yang menyimpannya sebagai TEXT bebas). Di sini nilainya harus salah satu dari lima segmen MCN (`low|entry|sweet|high|premium`) — nilai lain ⇒ 422 (bagian dari validasi kolom, bukan diterima lalu diabaikan).
5. **Arah: CDPS push → MCN terima, selalu.** MCN tidak pernah menarik dari CDPS. Frekuensi: setelah tiap `evaluate/tick` di sisi CDPS (lihat §Sisi CDPS untuk lokasi kode job-nya).
6. **Snapshot = keadaan PENUH, bukan delta.** Tiap push menggantikan pemahaman MCN tentang katalog PX: baris yang ADA di push sebelumnya tapi TIDAK ADA lagi di push terbaru (batch_key berbeda dan berhasil diproses) ⇒ `active=false` di `px_catalog_items` — bukan dihapus (jejak tetap ada). `rows` boleh kosong (`[]`) untuk menyatakan "katalog PX kosong sekarang" — itu payload sah, bukan 422 (beda dari Flow C yang menolak nol baris, karena MCN kosong artinya "belum push", sedangkan CDPS kosong bisa berarti benar-benar tidak ada SKU lolos verdict saat ini).
7. **Idempotensi wajib.** `Idempotency-Key` yang berulang ⇒ HTTP 200, hasil ASLI dari `px_catalog_pushes` (bukan re-proses payload baru), nol perubahan `px_catalog_items`.
8. **Baris ≤ 5.000 per request.** Lebih dari itu ⇒ CDPS yang perlu paginasi (perubahan kontrak), bukan dipotong diam-diam di MCN.
9. **Degradasi: snapshot basi TIDAK memblokir Product Match.** Bila push CDPS gagal/terlambat, MCN memakai snapshot TERAKHIR yang berhasil (baris `active=true` yang ada). Sampai push pertama pernah terjadi, seksi PX di Product Match/portal kreator menampilkan "Belum ada produk PX dari CDPS (snapshot: —)" — bukan error, bukan kosong diam-diam.

## Storage on the MCN side

`px_catalog_pushes.payload` menyimpan JSON ini APA ADANYA (raw, snake_case),
immutable — kunci idempotensi + jawaban ASLI untuk key berulang.
`px_catalog_items` menyimpan salinan TERURAI per baris (PK
`(client_platform_id, platform_product_id)`), upsert per push + `active=false`
untuk baris yang hilang dari snapshot terbaru. RLS: `select` terbuka untuk
`authenticated` (dipakai Product Match & CM Workspace), DITAMBAH restrictive
deny untuk `is_creator_user()` (pola sama `products_tap` — portal kreator
membaca lewat server action admin, bukan langsung).

## What is deliberately NOT in this payload

- Tidak ada `gmv_30d`, pesanan, harga satuan, atau angka performa apa pun (D-06).
- Tidak ada `creator_id`/nama kreator (K-2).
- Tidak ada komisi/rate — Product Match menampilkan produk PX tanpa harga/komisi (label "Seller manage by MEA" saja), karena CDPS tidak mengirimkannya.
- Tidak ada `deal_id`/kontrak — katalog PX bukan bagian dari `products_tap`/`brand_deals`, tabelnya terpisah (`px_catalog_items`), digabung hanya di lapisan tampilan (Product Match engine, `source: 'px'`).

## Sisi CDPS — SUDAH DIBANGUN (2026-09-23, `MEAgrup/AgencyAPP`)

Dipicu dari akhir `POST/GET /internal/px/evaluate/tick` (Flow A+B) setiap
tick berjalan — `productexchange.buildCatalogSnapshot(sql)` (baca
`px_catalog_item_v`, bentuk payload persis kontrak di atas) +
`apps/api/src/lib/px-catalog-push.ts::pushCatalogSnapshot()` (fetch +
header sama persis §Envelope) + `productexchange.recordCatalogPush(sql, …)`
(audit_log). `MCN_BRIDGE_URL` = env di sisi CDPS (URL dasar deployment
`mcnapp`, contoh di `.env.example`). `price_segment` di luar taksonomi
lima-segmen MCN (`low|entry|sweet|high|premium`) diubah jadi null di sisi
CDPS sebelum dikirim (Non-negotiables #4) — satu baris kotor tidak
menggagalkan seluruh payload. Rincian keputusan (termasuk pemetaan field
`client_platform_id`) ada di `docs/DECISIONS.md` "PX-CATALOG-PUSH-CDPS".
AKTIVASI mengikuti `evaluate/tick` sendiri (ketokan 2026-09-15): sampai cron
dipasang, push ini pun hanya jalan mengikuti tick manual — di luar jam tick
manual MCN tetap menampilkan pesan "Belum ada produk PX dari CDPS"
(Non-negotiables #9), bukan bug.
