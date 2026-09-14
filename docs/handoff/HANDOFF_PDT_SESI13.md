# HANDOFF — PDT (Pusat Data Toko) SESI 13 → SESI 14

> **Dibuat 2026-09-14.** Baca berkas ini sebelum lanjut (rantai: … → sesi 12 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI12.md` untuk konteks sub-langkah
> 2a kalau perlu). Instruksi sesi ini: "Start sub langkah 2b" (melanjutkan
> rekomendasi sesi 12 §1 butir 1) + permintaan tambahan: hitung/dokumentasikan
> berapa banyak tiket bernomor ada di "bagian G" (`### G<gelombang>-<nomor>`
> di `docs/backlog/PDT_BACKLOG.md`) — jawabannya **17** (G1 12, G2 2, G3 0,
> G4 3, G5 0), rinciannya di §3 catatan baru `PDT_BACKLOG.md` bagian atas.
>
> **Status: G1-09 sub-langkah 2b-i (rekonsiliasi Shopee) SELESAI.** PR #368
> (branch `claude/handoff-sesi10-build-gei0gn`, sesi 12 sub-langkah 2a) masih
> OPEN/draft saat sesi ini mulai — commit sesi ini menumpuk di branch/PR yang
> SAMA (bukan PR baru), lihat status PR di GitHub untuk keadaan terbaru.
> Sub-langkah 2b-ii (baris fakta tertipe) **BELUM dimulai** — lihat §1.

---

## 0. Ringkasan 60 detik

**G1-09 sub-langkah 2b-i — rekonsiliasi Shopee, SELESAI:**
`commitUploadBatch` (`packages/domain/src/pdt.ts`) sekarang memanggil
`pdt.rekonsiliasiGmvPesanan` (G1-07, `packages/core/src/pdt/rekonsiliasi.ts`)
— mesin itu sudah ada sejak sesi lama tapi **belum pernah dipanggil dari alur
nyata sampai sesi ini**. Berjalan HANYA ketika identitas `cocok`/
`tidak_dapat_divalidasi` DAN batch membawa `shopee_shop_stats` +
`shopee_parent_sku` yang KEDUANYA `status='ok'`; basis **Siap Dikirim**
(Rule 16). Lolos ambang (≤0,5%) ⇒ **`status='verified'` — PERTAMA KALI
status ini bisa ditulis** oleh sistem manapun di repo ini untuk PDT. Melebihi
⇒ `status='ditolak'` + `reconcile_delta_pct` + alasan Rule 14.

**Temuan besar SAAT membangun (bukan diasumsikan sejak awal):**
`shopee_parent_sku` **nol kolom jumlah-pesanan mentah per SKU** yang
terverifikasi — hanya GMV/views/klik/CR(%)/repeat-order(%)/pengunjung. Rule
13 literal minta DUA perbandingan (GMV DAN pesanan); memaksakan sisi pesanan
hari ini berarti mengarang angka (delta 0% palsu) — persis kelas bug yang
Rule 13-16 dibangun untuk mencegah (kasus Fim Motor). **Diselesaikan dengan
merevisi `rekonsiliasiGmvPesanan`**: `perSkuPesanan`/`shopLevelPesanan` jadi
opsional — hilang ⇒ perbandingan pesanan DILEWATI (`deltaPesananPct: null`,
bukan `0`), verdict murni dari GMV. 14 tes lama tetap identik (backward
compatible); 6 tes baru untuk jalur opsional. Dicatat sebagai Open baru
`G1-07-PERSKU-PESANAN`.

**TikTok TIDAK direkonsiliasi sama sekali** — G1-07 tidak (belum) punya
fungsi shop-level-vs-per-SKU untuk TikTok setara `parseShopeeShopStatsPerBasis`/
`sumShopeeParentSkuGmv`. Batch TikTok berhenti di `'parsing'` selamanya
sampai mesin itu ada — dicatat Open baru `G1-07-TIKTOK-REKONSILIASI`.

**BELUM dibangun (sengaja, sub-langkah 2b-ii + item lama):** baris fakta
tertipe (`pdt_fact_*`), UI halaman upload `web-internal` (sub-langkah 3),
endpoint konfirmasi identitas AM (`usulkan_ikat`), rekonsiliasi TikTok,
perbandingan pesanan Shopee.

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

1. **Rekomendasi utama — G1-09 sub-langkah 2b-ii: baris fakta tertipe (Flow
   A langkah 8).** Peta `kolomDipanen` (whitelist per modul) → kolom tabel
   fakta BERTIPE (`pdt_fact_shop_daily`/`pdt_fact_sku_period`/
   `pdt_fact_content`/`pdt_fact_creator_period`/`pdt_fact_ads`/
   `pdt_sku_master`) BELUM ada sama sekali — pekerjaan besar tersendiri (25
   modul × kolom masing-masing). **Mulai dari SATU modul dulu** untuk
   membuktikan pola sebelum menggeneralisasi:
   - Kandidat termudah: `shopee_ads_cpc`/`shopee_ads_search`/`shopee_ads_live`
     → `pdt_fact_ads` (skema kolom sudah cocok 1:1 dengan `kolomDipanen`
     ketiga modul ini, nol turunan rumit).
   - `tt_video`/`shopee_video` → `pdt_fact_content` juga relatif langsung.
   - `shopee_shop_stats`/`tt_shop_analytics` → `pdt_fact_shop_daily` BUTUH
     keputusan basis eksplisit per baris (Shopee 3 basis = 3 baris terpisah,
     Rule 15) — lebih rumit, kerjakan belakangan.
   - `shopee_parent_sku`/TikTok SKU modules → `pdt_sku_master` +
     `pdt_fact_sku_period` — perlu strategi upsert (Rule 19: SKU tidak
     pernah dihapus, hanya `status_listing`/`last_seen_at` berubah).
   Setelah minimal satu modul per tabel fakta berjalan, `commitUploadBatch`
   bisa menulis baris fakta SEKALIGUS dengan batch+file dalam transaksi
   yang sama (byte parsed sudah di tangan, nol I/O tambahan).
2. **`G1-07-PERSKU-PESANAN` (Open BARU sesi ini).** Perlu sample
   `parentskudetail.xlsx` asli (40 kolom total, `PDT_KOLOM_DIPANEN.md` §2.2
   baru mendokumentasikan ~10) untuk menemukan kolom jumlah-pesanan mentah
   per SKU, kalau memang ada. Tanpa ini, rekonsiliasi Shopee PERMANEN hanya
   GMV-saja (bukan cacat, tapi kepatuhan Rule 13 tidak pernah 100%).
3. **`G1-07-TIKTOK-REKONSILIASI` (Open BARU sesi ini).** Perlu ditulis
   `parseTiktokShopAnalytics`/fungsi setara + fungsi Σ per-SKU TikTok,
   SETELAH kolom-kolomnya diverifikasi ke sample TikTok asli (jangan tebak
   nama kolom — pola yang sama seperti `G1-06-PERIODE-TIKTOK` sudah
   peringatkan). Baru setelah itu batch TikTok bisa mencapai `'verified'`.
4. **G1-09 sub-langkah 3: halaman upload `web-internal`.** Masih seperti
   sesi-sesi sebelumnya — kontrak wire (`PdtCommitBatch` + `reconcile_delta_pct`
   sekarang) sudah lengkap, halaman/tombolnya belum ada.
5. **Endpoint konfirmasi identitas AM** (`usulkan_ikat` → menulis
   `client_platforms.shop_id`/`akun_konten_toko`) — masih belum ada, lihat
   `HANDOFF_PDT_SESI12.md` §1 butir 3 untuk rinciannya (tidak berubah).
6. **`G1-09-DETEKSI-PREAMBLE-AMBIGU`** (Open dari sesi 12) — masih terbuka,
   tidak tersentuh sesi ini.
7. Item lama masih terbuka: `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`,
   `G1-07-PERSKU-DIBAYAR` (beda dari `G1-07-PERSKU-PESANAN` baru — yang lama
   soal basis Dibayar spesifik, yang baru soal kolom pesanan di SEMUA basis).

---

## 2. G1-09 sub-langkah 2b-i — SELESAI, rinci

### 2.1 Berkas baru/diubah

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/rekonsiliasi.ts` (+ 6 tes) | `rekonsiliasiGmvPesanan` direvisi — `perSkuPesanan`/`shopLevelPesanan` opsional, `deltaPesananPct: number \| null` |
| `packages/domain/src/pdt.ts` (+ 5 tes `pdt.test.ts`) | `commitUploadBatch` menjalankan rekonsiliasi Shopee, `status` bisa `'verified'`, `+reconcileDeltaPct` di `PdtCommitPersiapan`, `isUniqueViolation` untuk `uq_pdt_upload_batch_verified` |
| `apps/api/src/lib/wire.ts` | `PdtCommitBatchWire.reconcile_delta_pct` |
| `web-internal/src/lib/pdt.ts` | `PdtCommitBatch.reconcile_delta_pct` |
| `docs/DECISIONS.md` | 1 baris Decided (teratas) + 2 baris Open baru (`G1-07-PERSKU-PESANAN`, `G1-07-TIKTOK-REKONSILIASI`) |
| `docs/backlog/PDT_BACKLOG.md` | catatan status G1-09 (2b-i) + ringkasan jumlah tiket per gelombang (17 total) |

### 2.2 Kontrak & keputusan penting

Lihat `docs/DECISIONS.md` baris teratas (2026-09-14, entri KEDUA dari atas —
di atas entri sub-langkah 2a) untuk penjelasan lengkap. Ringkasnya:

- **Gerbang rekonsiliasi**: identitas `cocok`/`tidak_dapat_divalidasi` SAJA
  (identitas `tolak`/`usulkan_ikat` tidak masuk akal direkonsiliasi) DAN
  `shopee_shop_stats`+`shopee_parent_sku` keduanya `'ok'` DAN basis Siap
  Dikirim ADA di `shopee_shop_stats` (section-nya bisa absen bila berkas
  tidak membawanya — batch berhenti di `'parsing'`, bukan error).
- **`shopee_shop_stats` py DUA struktur header berbeda dalam satu sheet**:
  (a) baris 15-metrik DATAR yang divalidasi `validasiKolomWajib` (G1-08,
  Rule 9); (b) mini-tabel PER BASIS (`parseShopeeShopStatsPerBasis`, G1-07)
  yang dibaca terpisah — lihat fixture `shopeeShopStatsBerkas` di
  `pdt.test.ts` untuk bentuk lengkapnya kalau perlu contoh nyata.
- **Rule 13 pesanan dilewati** (bukan dipalsukan) — lihat `G1-07-PERSKU-PESANAN`.
- **TikTok tidak direkonsiliasi** — lihat `G1-07-TIKTOK-REKONSILIASI`.
- **`uq_pdt_upload_batch_verified`** ditangkap via SQLSTATE `23505`,
  diterjemahkan ke `ValidationError` BI yang menyebut Flow D (reparse)
  sebagai jalur yang benar untuk memperbaiki batch verified yang salah,
  BUKAN commit batch verified baru untuk periode yang sama.
- Diverifikasi (sandbox): `@cdps/core` 1145/1145, `@cdps/domain` 2550/2551
  (1 skip, tidak berubah), `@cdps/db` 107/107, `@cdps/api` 555/569 (14 skip,
  kecuali satu kegagalan pra-ada `gelombang-c-showcase.e2e.test.ts`),
  `web-internal` 763/763. `npm run typecheck` bersih di seluruh workspace;
  `npm run lint -w @cdps/api -- --max-warnings 0` bersih.

### 2.3 Yang BELUM dilakukan (sengaja)

- **Baris fakta tertipe** (Flow A langkah 8) — sub-langkah 2b-ii, §1 butir 1.
- **Rekonsiliasi TikTok** — `G1-07-TIKTOK-REKONSILIASI`, §1 butir 3.
- **Perbandingan pesanan Shopee** — `G1-07-PERSKU-PESANAN`, §1 butir 2.
- **Halaman upload `web-internal`** — sub-langkah 3, §1 butir 4.
- **Endpoint konfirmasi identitas AM** — §1 butir 5.

---

## 3. Ringkasan jumlah tiket "bagian G" (diminta sesi ini)

`docs/backlog/PDT_BACKLOG.md` §1-§5 punya **17 tiket bernomor**
(`### G<gelombang>-<nomor>`):

| Gelombang | Jumlah tiket | Status ringkas |
|---|---|---|
| **G1** | 12 (`G1-00`…`G1-11`) | `G1-00`…`G1-08` SELESAI; `G1-09` SEDANG BERJALAN (4 dari ~6 sub-langkah: pratinjau, BODY-BESAR, commit 2a, rekonsiliasi 2b-i — baris fakta 2b-ii + UI sub-langkah 3 menyusul); `G1-10`/`G1-11` belum dimulai |
| **G2** | 2 (`G2-01`/`G2-02`) | belum dimulai |
| **G3** | 0 | §3 masih prosa (Prefill/PDT-18), belum dipecah jadi tiket bernomor |
| **G4** | 3 (`G4-01`…`G4-03`) | belum dimulai |
| **G5** | 0 | ⛔ diblokir, sengaja belum dijadwalkan (P-05 tertutup — lihat §5/§6 `PDT_BACKLOG.md`) |

Rincian + tanggal (2026-09-14) ada di `docs/backlog/PDT_BACKLOG.md`, tepat
sesudah blok "Update sesi 2" di kepala berkas. Angka ini TIDAK menghitung
Open Assumptions (§6) atau tiket non-coding (§7) — keduanya bukan "tiket G".

---

## 4. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Flow A langkah 7, Rule 13-16.
- `docs/backlog/PDT_BACKLOG.md` — G1-09 (status sub-langkah) + ringkasan
  tiket §3 di atas.
- `docs/DECISIONS.md` — baris teratas (2026-09-14, sub-langkah 2b-i) + dua
  Open baru (`G1-07-PERSKU-PESANAN`/`G1-07-TIKTOK-REKONSILIASI`).
- `packages/core/src/pdt/rekonsiliasi.ts` + `.test.ts` — mesin G1-07,
  sekarang punya pemanggil nyata.
- `packages/domain/src/pdt.ts` `commitUploadBatch` (bagian rekonsiliasi) +
  `packages/domain/src/pdt.test.ts` (describeDb rekonsiliasi Shopee,
  fixture `shopeeShopStatsBerkas`/`shopeeParentSkuBerkas`).
- `docs/handoff/HANDOFF_PDT_SESI12.md` — riwayat sub-langkah 2a (commit).
