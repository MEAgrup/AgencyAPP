# HANDOFF — PDT (Pusat Data Toko) SESI 7 → SESI 8

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: sesi 6 →
> sesi 7, berkas ini; `docs/handoff/HANDOFF_PDT_SESI6.md` untuk riwayat
> G1-05 kalau perlu konteks lebih dalam).
>
> **Status: G1-06 SELESAI** (`packages/core` — nol migrasi, nol route baru,
> sesuai ekspektasi tiketnya: engine murni dulu, penulis DB menyusul
> G1-07/09). Belum di-PR/merge di awal sesi ini — commit + push + PR
> dilakukan di sesi ini sesudah handoff ditulis.

---

## 0. Ringkasan 60 detik

Instruksi sesi ini: "baca handoff sesi 6 dan lanjutkan" → sesi 6 melaporkan
G1-05 **sudah** merge (PR #361, terverifikasi ke `origin/main` di awal sesi
ini — item #1 handoff sesi 6 SUDAH selesai sebelum sesi ini mulai, nol
tindakan tambahan diperlukan untuk itu) → §3 handoff sesi 6 merekomendasikan
G1-06 → **G1-06 selesai** sesi ini.

**G1-06** — `packages/core/src/pdt/identitas.ts` (+ `identitas.test.ts`, 25
tes): identitas toko Shopee (Rule 2, `ID Toko` preamble vs
`client_platforms.shop_id`, termasuk `usulkan_ikat` Q-1 opsi A), identitas
TikTok (Rule 3-4, `ID Kreator` TERBANYAK vs `client_platforms.akun_konten_toko`),
dan resolusi periode batch (Rule 5 + toleransi bulan-sama sesi 2). **Dua
ketidakpastian format ditemukan dan DICATAT, bukan ditebak** — lihat §2.2 dan
`docs/DECISIONS.md` (baris teratas + satu baris Open baru
`G1-06-PERIODE-TIKTOK`).

---

## 1. Yang perlu ditindaklanjuti sesi ini/berikutnya

1. **Commit + push + PR belum dibuat untuk perubahan G1-06** — lakukan itu
   sebelum lanjut ke G1-07, ikuti alur PR standar repo ini (draft PR, watch
   CI).
2. Item lama handoff sesi 5 §1 butir 2 **masih terbuka**: tes `describeLive`
   di `apps/api/src/lib/pdt-storage.test.ts` (signed URL vs Storage live)
   belum dijalankan — sandbox sesi ini juga tidak punya
   `SUPABASE_SERVICE_ROLE_KEY`. Bukan bagian G1-06, tapi tetap gap terbuka
   G1-04 yang belum tertutup.
3. **`G1-06-PERIODE-TIKTOK` (Open, `docs/DECISIONS.md`) belum terjawab** —
   nama kolom periode TikTok (`Date Range`/`Rentang Tanggal`/`Tanggal
   analisis`) BELUM terverifikasi ke sample asli. Tidak memblokir G1-07,
   tapi kalau sample TikTok asli mendarat di repo sebelum G1-07/G1-10
   dikerjakan, verifikasi dulu `KANDIDAT_KOLOM_PERIODE_TIKTOK`
   (`packages/core/src/pdt/identitas.ts`) terhadap sample itu.
4. Kalau CI `db-and-migrations` merah lagi dengan
   `gelombang-c-showcase.e2e.test.ts`/`client_platforms` collision: bug
   pra-ada yang SAMA yang sudah dikonfirmasi non-flaky di PR #359 (lihat
   handoff sesi 5 §1 butir 1) — standing-down + satu re-run, JANGAN
   diperbaiki di PR G1-06 (G1-06 tidak menyentuh migrasi sama sekali).

---

## 2. G1-06 — SELESAI

### 2.1 Berkas

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/identitas.ts` | `parseTanggalId`/`parseRentangTanggal` (util tanggal `DD/MM/YYYY`), `ekstrakPreambleShopee` (Rule 2, preamble `ID Toko`/`Username`/`Nama Toko`/`Periode`), `kolomTerbanyak` (Rule 4, nilai kolom terbanyak — dipakai untuk `ID Kreator`), `ekstrakPeriodeKolomTiktok` (Rule 5, best-effort — lihat §2.2), `validasiIdentitasShopee`/`validasiIdentitasTiktok` (verdict `cocok`/`usulkan_ikat`/`tolak`, Rule 2-4), `resolvePeriodeBatch` (Rule 5 + toleransi bulan-sama), `bangunIdentitasSumberShopee` (shape `pdt_upload_batch.identitas_sumber`) |
| `packages/core/src/pdt/identitas.test.ts` | 25 tes — dua bentuk fixture preamble (lihat §2.2), majority-vote `ID Kreator`, ketiga verdict identitas ×2 platform, toleransi bulan-sama + penolakan lintas-bulan + pewarisan berkas-tanpa-periode |
| `packages/core/src/pdt/index.ts` | + `export * from './identitas'` |
| `docs/DECISIONS.md` | 1 baris Decided baru (di ATAS G1-05) + 1 baris Open baru (`G1-06-PERIODE-TIKTOK`) |

Tidak ada migrasi — skema yang G1-06 butuh (`client_platforms.akun_konten_toko`
jsonb, `shop_username` text) **sudah lahir di migrasi G1-01**
(`20261011010000_g1_01_pdt_tables.sql:648-658`), diverifikasi ke berkas
migrasi sungguhan sebelum menulis kode, bukan diasumsikan perlu migrasi
baru. Tidak ada route baru, tidak ada perubahan gerbang CI.

### 2.2 Kontrak & keputusan penting

- **`ekstrakPreambleShopee` menerima DUA bentuk baris preamble, bukan satu.**
  Repo ini sendiri sudah punya dua fixture berbeda untuk baris yang sama:
  `pdt/detect.test.ts`/`apps/api/pdt-parse.test.ts` (dibangun G1-02/G1-05)
  pakai SATU sel `"ID Toko: 938284780"`; `report/shopee/shopee.test.ts`
  `extractIdentity` (kode LAMA, non-PDT) pakai DUA sel
  `['ID Toko', 'SHOP-1']`. Tanpa sample asli, memilih satu berarti menebak
  — fungsi ini menangani keduanya (dites eksplisit, dua `describe` block
  terpisah di `identitas.test.ts`).
- **⚠️ Nama kolom periode TikTok BELUM terverifikasi** (`KANDIDAT_KOLOM_PERIODE_TIKTOK`
  = `['Date Range', 'Rentang Tanggal', 'Tanggal analisis']`, sentinel best-effort
  pola sama `UNVERIFIED_SIGNATURE` `modules.ts`) — nol kemunculan literal
  ketiganya di `PDT_KOLOM_DIPANEN.md`/PRD §7/kode manapun. Dicatat sebagai
  Open row baru `G1-06-PERIODE-TIKTOK`, **tidak memblokir G1-06/07**: berkas
  TikTok yang tidak cocok satu pun kandidat dianggap "tidak membawa periode
  terbaca" dan mewarisi periode dari berkas lain di batch (perilaku Rule 5
  ayat 2 yang sama, bukan kegagalan) — lihat §1 butir 3 untuk risiko sisa.
- **Rule 2 (pengikatan `shop_id`, Q-1 opsi A) dan Rule 3-4 (pengikatan
  `akun_konten_toko`) sama-sama tiga-cabang:** `cocok` (nilai tersimpan
  sudah ada dan sama) / `usulkan_ikat` (kolom masih kosong — batch PERTAMA,
  BUKAN ditolak, sistem mengusulkan nilai dari berkas) / `tolak` (nilai
  tersimpan ADA tapi beda dari berkas — pesan **menyebut kedua nilai**,
  house convention #5). Fungsi ini TIDAK menulis DB — pemanggil (belum ada,
  G1-07/09) yang menerjemahkan verdict jadi `pdt_upload_batch.status` dan,
  sesudah AM konfirmasi, `UPDATE client_platforms`.
- **`resolvePeriodeBatch`** memfilter ke berkas yang MEMBAWA periode saja;
  berkas tanpa periode terbaca tidak pernah jadi alasan penolakan (itulah
  mekanisme "mewarisi" Rule 5 ayat 2 — bukan langkah terpisah). Bulan
  dibandingkan dari `mulai` tiap berkas SAJA (rentang per modul yang
  sebenarnya belum bisa diverifikasi ke sample asli, P-04/A-3 §9 PRD) —
  dicatat sebagai batasan di docblock, bukan disembunyikan.
- **Tes (`identitas.test.ts`, 25 tes)** — mencakup: parse tanggal valid +
  kalender tidak valid (31/02), dua bentuk preamble, preamble kosong,
  majority-vote `ID Kreator` (termasuk kolom tak-ditemukan dan nol baris
  data), tiga verdict × dua platform (termasuk pesan tolak menyebut KEDUA
  nilai — diverifikasi via `toContain`), rentang-beda-bulan-sama diterima
  + hasil rentang terluas, berkas-tanpa-periode tidak menjatuhkan batch,
  bulan-berbeda ditolak dengan pesan menyebut nama berkas + bulannya, dan
  shape `identitas_sumber`.
- **Diverifikasi:** `npm run typecheck` (root, seluruh 4 workspace) bersih;
  `npm run test -w @cdps/core` — **1097/1097 tes lulus** (termasuk 25 baru).
  `npm install` dijalankan lebih dulu di sesi ini (sandbox segar, node_modules
  belum ada) — `package-lock.json` **tidak berubah** (nol dependensi baru,
  murni TypeScript).

### 2.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Pemanggilan sungguhan dari alur upload** — belum ada route/domain yang
  menulis `pdt_upload_batch` sama sekali (nol hasil grep `pdt_upload_batch`
  di `apps/api/src`/`packages/domain/src` sebelum maupun sesudah sesi ini).
  G1-06 menyediakan fungsi murni; G1-09 (halaman upload) yang memanggilnya.
- **Pemetaan `kolomDipanen` → kolom bertipe + `parsePdtAngka` per sel** —
  masih milik G1-07 (rekonsiliasi butuh nilai bertipe: Σ GMV per-SKU vs
  shop-level), BUKAN G1-06 (identitas/periode tidak butuh angka bertipe).
- **Penulisan ke `client_platforms.shop_id`/`akun_konten_toko`/`shop_username`
  sesudah AM konfirmasi usulan** — bagian dari G1-09 (dropdown konfirmasi
  AM ada di UI upload), G1-06 hanya menyediakan verdict + nilai usulan.

---

## 3. Rekomendasi sesi 8 — mulai G1-07 (Rekonsiliasi, PDT-16)

`docs/backlog/PDT_BACKLOG.md` §1 G1-07:

1. Σ GMV per-SKU vs GMV shop-level **pada basis yang sama** (Rule 15 — basis
   tidak boleh dicampur: TikTok = GMV − refund satu basis; Shopee TIGA basis
   terpisah `Pesanan Dibuat`/`Pesanan Siap Dikirim`/`Pesanan Dibayar`,
   disimpan sebagai baris berbeda `pdt_fact_shop_daily`).
2. Selisih ≤ 0,5% ⇒ `verified`; > 0,5% ⇒ `ditolak` + `reconcile_delta_pct` +
   UI menunjuk modul penyebab (modul `parse_status != 'ok'` disebut lebih
   dulu).
3. **Di sinilah pemetaan `kolomDipanen`→kolom bertipe + `parsePdtAngka`
   per sel yang G1-05 tunda kemungkinan besar mulai terbentuk** — G1-07
   butuh nilai GMV/pesanan BERTIPE dari AoA untuk dijumlahkan, bukan cuma
   nama kolom whitelist.
4. ⚠️ `tt_shop_analytics` **tidak boleh** jadi satu-satunya sisi rekonsiliasi
   TikTok (P-01: dua sample beda 11 vs 14 kolom) — pakai `tt_orders` sebagai
   sisi kanonik.
5. Setelah G1-07: G1-08 (kegagalan parse tidak ditelan + skor netral
   dihapus) → G1-09 (halaman upload + dropdown override — **di sinilah
   G1-06 pertama kali benar-benar dipanggil dari alur nyata**, dan di
   sinilah `client_platforms.shop_id`/`akun_konten_toko` benar-benar
   ditulis).

**Jangan lompat ke G1-09** sebelum G1-07/08 — build order eksplisit
`PDT_BACKLOG.md` §0.

---

## 4. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Rule 2-5 (identitas & periode),
  §9 P-04 (lingkup G1 melebar, belum blocking).
- `docs/backlog/PDT_BACKLOG.md` — G1-06 (sesi ini) → G1-07 (sesi berikutnya).
- `docs/DECISIONS.md` — baris teratas (2026-09-13, PDT G1-06) + Open row
  `G1-06-PERIODE-TIKTOK`.
- `packages/core/src/pdt/identitas.ts` + `identitas.test.ts`.
- `supabase/migrations/20261011010000_g1_01_pdt_tables.sql` (baris 648-658 —
  `client_platforms.akun_konten_toko`/`shop_username`, sudah ada sejak G1-01).
- `packages/core/src/pdt/modules.ts` (G1-02, `PDT_MODULES` — `barisHeaderHint`
  per modul yang `kolomTerbanyak`/`ekstrakPreambleShopee` konsumsi).
- `docs/handoff/HANDOFF_PDT_SESI6.md` — riwayat G1-05 + gap signed-URL live
  yang masih terbuka.
