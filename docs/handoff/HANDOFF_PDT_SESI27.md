# HANDOFF — PDT (Pusat Data Toko) SESI 26 → SESI 27

> **Dibuat 2026-09-15.** Instruksi Yohan sesi ini: mengunggah ZIP **"Sample nama asli"** (Fim
> Motor/Shopee + **Avitaskin/TikTok, BARU** — bukan cuma re-upload Fim Motor lama) sebagai
> tindak lanjut permintaan sesi 26 untuk memverifikasi `G1-09-DETEKSI-PREAMBLE-AMBIGU`. Rantai:
> `HANDOFF_PDT_SESI25.md` → `HANDOFF_PDT_SESI26.md` (G1-10 dibangun, PR #386 merged) → berkas ini.

---

## 0. Apa yang terjadi sesi ini

**`G1-09-DETEKSI-PREAMBLE-AMBIGU` DITUTUP — diverifikasi ke sample asli, TERBUKTI nyata (bukan
hipotetis).** Menjalankan `detectPdtModule` sungguhan (bukan fixture) terhadap
`Data+Keseluruhan+Iklan+Shopee-*.csv` (`shopee_ads_cpc`) dan `Search-Ads-Overall-Data-*.csv`
(`shopee_ads_search`) dari ZIP asli membuktikan KEDUANYA memang ambigu terhadap
`shopee_ams_afiliasi` sebelum perbaikan — preamble baris 2 (`Username,fim_motor`) memenuhi
`anyOf` afiliasi, header ber-`Omzet` memenuhi `must`-nya. **Perbaikan: `mustNot: ['ID Toko']`**
ditambahkan ke `shopee_ams_afiliasi` (`packages/core/src/pdt/modules.ts`) — pola PERSIS sama
`shopee_ams_produk` (`mustNot: 'ID Affiliates'`, sudah ada). Diverifikasi ulang: seluruh 15
berkas Shopee asli di ZIP, NOL ambiguitas baru, NOL regresi. Detail lengkap `docs/DECISIONS.md`
(cari "sesi 27").

**TEMUAN BARU severity TINGGI, DICATAT SEBAGAI OPEN (`G1-09-SHEET-BUKAN-PERTAMA`) — TIDAK
diperbaiki sesi ini.** Investigasi yang sama membuka bug jauh lebih serius: pipeline PDT
(`apps/api/src/lib/pdt-parse.ts`) **hanya pernah membaca sheet PERTAMA** tiap berkas `.xlsx`.
Dua modul yang sudah "DITUTUP"/berjalan di produksi ternyata datanya ada di sheet LAIN:

1. **`shopee_live`** (modul KESEMBILAN, DITUTUP sesi 24) — data sesi live sungguhan ada di sheet
   KETIGA "Daftar Streaming" dari workbook 3-sheet (`Tinjauan`/`Tren Metrik`/`Daftar Streaming`).
   Sheet pertama ("Tinjauan") berstruktur TOTAL BEDA (ringkasan agregat, bukan per-sesi) —
   **`shopee_live` TIDAK PERNAH terdeteksi untuk berkas asli. Writer `pdt_fact_content` jenis
   'live' yang dibangun sesi 24 adalah kode MATI di produksi.**
2. **`shopee_shop_stats`** (basis rekonsiliasi G1-07) — marker deteksi `'Pesanan Dibuat'`
   ternyata NAMA TAB sheet pertama dari workbook 12-sheet, BUKAN isi sel. `parseShopeeShopStats
   PerBasis` juga mengasumsikan ketiga basis ('Pesanan Dibuat'/'Siap Dikirim'/'Dibayar') muncul
   sebagai SECTION dalam SATU sheet (warisan algoritma legacy) — di sample asli, ketiganya
   adalah TIGA SHEET TERPISAH. **`shopee_shop_stats` TIDAK PERNAH terdeteksi untuk berkas asli
   — rekonsiliasi GMV shop-level G1-07 nol dari sumber ini untuk klien dengan struktur seperti
   sample ini.**

Kenapa tidak diperbaiki langsung: perbaikannya butuh **keputusan arsitektur** yang PRD tidak
pernah bahas (workbook multi-sheet sama sekali tidak disinggung) — apakah satu ZIP entry tetap
1 baris `pdt_file` (lalu sheet mana yang menang kalau beberapa sheet sama-sama cocok, seperti
3 basis `shopee_shop_stats` yang STRUKTURNYA IDENTIK?), atau berubah jadi 1 baris `pdt_file` per
sheet yang cocok (mengubah invarian sejak G1-01)? Tiga opsi + trade-off lengkap ada di
`docs/DECISIONS.md` baris `G1-09-SHEET-BUKAN-PERTAMA` — **butuh keputusan Hans/Anty/pemilik**
sebelum dikerjakan, bukan ditebak.

**Bonus: ZIP juga berisi sample TikTok "Avitaskin" BARU** (bukan Fim Motor) — `Shop Analytics_
Key metrics`, `Live Analysis` (x2), `Transaction_Analysis_Creator_List`/`Product_List`, `Semua
pesanan`, `product_list`, `Video Performance List` (x2), `creative data`/`livestream data` for
campaigns. **BELUM dipakai sesi ini** (di luar cakupan permintaan) — berpotensi membuka:
- `G1-06-PERIODE-TIKTOK` (nama kolom periode `Shop Analytics_Key metrics` belum terverifikasi).
- `G1-09-2BII-TTLIVE` (`tt_live` BLOCKED — nol kolom identitas sesi live stabil; `Live Analysis`
  Avitaskin belum diperiksa strukturnya, mungkin punya ID sesi yang `tt_live` PRD sebutkan).
- `G1-07-TIKTOK-REKONSILIASI` (butuh klien TikTok nyata — Avitaskin adalah klien TikTok NYATA
  pertama yang tersedia untuk PDT sejak sesi-sesi lalu).

Sesi berikutnya yang mau menggarap tiga item ini: minta pemilik unggah ulang ZIP yang sama
(scratchpad sesi ini tidak ikut ke chat baru, sama seperti catatan sesi-sesi lalu).

Diverifikasi (DB lokal rebuild bersih ×2, antar `@cdps/core`/`@cdps/domain`/`@cdps/api`):
`@cdps/core` **1207/1207**, `@cdps/domain` **2605/2605 (1 skip)**, `@cdps/db` **107/107**,
`@cdps/api` **584/584 (2 skip)**; typecheck 4 paket + lint `@cdps/api --max-warnings 0` bersih.

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **`G1-09-SHEET-BUKAN-PERTAMA`** (BARU, severity tinggi) — butuh keputusan arsitektur pemilik
   (3 opsi, `docs/DECISIONS.md`). Setelah diputuskan, ini kandidat implementasi murni teknis.
2. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — masih menunggu keputusan pemilik (`HANDOFF_PDT_SESI26.md`
   §1a, 3 opsi + rekomendasi, belum berubah).
3. **TikTok Avitaskin** — kalau pemilik unggah ulang ZIP yang sama, tiga Open di atas (§0) bisa
   digarap: `G1-06-PERIODE-TIKTOK`, `G1-09-2BII-TTLIVE`, `G1-07-TIKTOK-REKONSILIASI`.
4. **`G1-10-ORPHAN-PASS`**/**`G1-11`** (reparse) — murni teknis, belum disentuh, lihat
   `HANDOFF_PDT_SESI26.md` §2.

## 2. Setup teknis

Sama seperti sesi-sesi lalu — start cluster Postgres, `db-rebuild.sh`, `npm install` terpisah
tiap paket (root/`apps/api`/`web-internal`). Container sesi ini sempat restart (cluster Postgres
berhenti mid-sesi) — kalau psql menolak koneksi, `pg_ctlcluster 16 main start` dulu.

## 3. Rujukan

- `docs/DECISIONS.md` — cari `2026-09-15`/`sesi 27` untuk baris Decided (ambiguitas ditutup) dan
  Open baru `G1-09-SHEET-BUKAN-PERTAMA` (rincian lengkap 3 opsi perbaikan).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status "sesi 27" baru di akhir blok.
- `packages/core/src/pdt/modules.ts` (`shopee_ams_afiliasi`, komentar `mustNot: ['ID Toko']`),
  `packages/core/src/pdt/detect.test.ts` (fixture CPC/Search preamble penuh + tes regresi baru).
- `apps/api/src/lib/pdt-parse.ts` (baris `wb.SheetNames[0]` — akar `G1-09-SHEET-BUKAN-PERTAMA`),
  `packages/core/src/pdt/rekonsiliasi.ts` (`parseShopeeShopStatsPerBasis`, asumsi 1-sheet warisan
  legacy yang tidak cocok struktur sample asli).
