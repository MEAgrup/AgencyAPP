# HANDOFF — PDT (Pusat Data Toko) SESI 32 → SESI 33

> **Dibuat 2026-09-15.** Pemilik mengunggah DUA sample sekaligus: "Shopee-Fim-Motor.zip" (ZIP
> ketiga, sama isinya dengan ZIP kedua sesi 30-31 — tidak membuka gap baru) dan **"Tiktok -
> Avitaskin.zip" (PERTAMA KALI ada sample TikTok asli di sesi mana pun)**, dengan instruksi
> "pakai untuk gap G1 yang butuh data... kalau butuh decision, berikan penjelasan lengkap dengan
> contoh kasus dan rekomendasi." Rantai: `HANDOFF_PDT_SESI32.md` → berkas ini.

---

## 0. Apa yang terjadi sesi ini

Sample TikTok Avitaskin dibuka+dibaca langsung (script `XLSX.read` ad-hoc, pola sama sesi
27/30/31) — 13 berkas: `Shop Analytics_Key metrics_*.xlsx` (×2, salah satunya drilldown 1-SKU),
`Live Analysis*.xlsx` (×2), `Video Performance List_*.xlsx` (×2), `Transaction_Analysis_
Product_List_*.xlsx`, `Transaction_Analysis_Creator_List_*.xlsx`, `product_list*.xlsx` (×2),
`Semua pesanan-*.csv`, `creative data for product campaigns *.xlsx`, `livestream data for live
campaigns *.xlsx`. Sample ini membuka SEMUA TIGA Open TikTok yang tersisa sekaligus — ketiganya
DITUTUP sesi ini, murni verifikasi teknis (nol keputusan bisnis genuinely dibutuhkan, meski
pemilik sudah menyiapkan diri untuk itu).

### G1-06-PERIODE-TIKTOK — DITUTUP
Ketiga kandidat label (`Date Range`/`Rentang Tanggal`/`Tanggal analisis`) TERNYATA ADA di sample,
tapi sebagai PREAMBLE satu-sel `"Label: value"` SEBELUM header (pola sama Shopee), BUKAN kolom
header seperti tebakan lama `ekstrakPeriodeKolomTiktok`. Empat bentuk konkret ditemukan (lihat
docblock `identitas.ts` untuk detail lengkap per jenis berkas). **Bug ditemukan dan diperbaiki
SEBELUM merge**: `XLSX.utils.sheet_to_json(header:1, defval:'')` memadatkan setiap baris ke lebar
kolom SHEET (bukan ragged array) — implementasi pertama (`row.length === 1`) gagal total terhadap
bentuk ASLI maupun round-trip XLSX nyata. Ditemukan lewat test `apps/api` yang menulis file xlsx
sungguhan (`XLSX.write`), bukan menyuntik AOA langsung — pelajaran: verifikasi lewat unit test
saja (AOA buatan tangan) tidak cukup untuk fungsi yang membaca bentuk baris, harus diuji lewat
round-trip library nyata juga.

### G1-09-2BII-TTLIVE — DITUTUP
`Live Analysis*.xlsx` sungguhan tidak membawa kolom ID sesi live terpisah (sama seperti dugaan
lama), tapi `ID Kreator` + `Waktu Live` (menit presisi) TERBUKTI 100% unik di 149 baris nyata
(nol duplikat) — pola SAMA PERSIS `shopee_live`/`Waktu Mulai` (sesi 24). `ekstrakBarisTtLive`
(baru) — modul KESEPULUH ke `pdt_fact_content`.

### G1-07-TIKTOK-REKONSILIASI — DITUTUP
`tt_shop_analytics` (shop-level) vs `tt_product_analytics` (Σ per-SKU) — GMV DAN Pesanan SKU
KEDUANYA terbukti sama persis (26.560.049/145). **Merevisi rekomendasi P-01 sesi 2** ("pakai
`tt_orders`, hindari `tt_shop_analytics`") — rekomendasi itu lahir dari investigasi KODE saja
tanpa sample nyata; sample asli membuktikan sebaliknya.

Diverifikasi (DB lokal rebuild bersih, 247 migrasi — nol migrasi baru): `@cdps/core` **1237/1237**,
`@cdps/domain` **2630/2630 (1 skip)**, `@cdps/db` **107/107**, `@cdps/api` **595/595 (2 skip)**;
typecheck 5 paket (termasuk `web-internal`) + lint `@cdps/api --max-warnings 0` bersih.

## 1. Posisi G1 sekarang

**Genuinely NOL Open TikTok tersisa.** Sisa Open G1 hanya dua, keduanya struktural (bukan
menunggu data):
1. **`G1-10-RETENSI-RECOMPUTE`** — menunggu G2-01/G5 punya baris produksi pertama.
2. **`G1-11-REPARSE-RECOMPUTE-STATUS`** — pertanyaan desain jarang-terjadi, tidak memblokir.

Tidak ada lagi item G1 yang bisa dikerjakan tanpa kemajuan G2/G5 terlebih dahulu.
`docs/backlog/PDT_BACKLOG.md` §8 "Aturan strangler" tetap berlaku: G2 menunggu G1 exit criteria
(≥10 klien nyata verified).

## 2. Rujukan

- `docs/DECISIONS.md` — cari `sesi 33` untuk baris Decided lengkap (ketiga item + bukti
  aritmetika + bug padding XLSX).
- `docs/backlog/PDT_BACKLOG.md` — status "sesi 33" di §G1-09; P-01 (§6) direvisi.
- `packages/core/src/pdt/identitas.ts` — `ekstrakPeriodePreambleTiktok`/`parseRentangTanggalTiktok`.
- `packages/core/src/pdt/fakta.ts` — `ekstrakBarisTtLive`.
- `packages/core/src/pdt/rekonsiliasi.ts` — `parseTiktokShopAnalytics`/`sumTiktokProductAnalyticsGmv`.
