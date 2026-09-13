# HANDOFF — PDT (Pusat Data Toko) SESI 8 → SESI 9

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut (rantai: sesi 7 →
> sesi 8, berkas ini; `docs/handoff/HANDOFF_PDT_SESI7.md` untuk riwayat
> G1-06 kalau perlu konteks lebih dalam).
>
> **Status: G1-07 SELESAI** (`packages/core` — nol migrasi, nol route baru).
> Sesi ini terikat ke branch `claude/lucid-goldberg-0ekacu` yang SAMA dengan
> G1-06 (instruksi sistem: jangan pindah branch tanpa izin eksplisit) —
> commit G1-07 masuk PR #362 yang SUDAH ADA (bukan PR terpisah), belum
> di-push di awal sesi ini.
>
> **Catatan babysitting PR #362 (G1-06):** CI `db-and-migrations` merah di
> PR itu adalah bug PRA-ADA (`gelombang-c-showcase.e2e.test.ts` /
> `uq_client_platforms_active_platform` collision, confirmed non-flaky sejak
> PR #359, juga merah di `main` sendiri) — sudah di-standing-down dengan
> komentar + satu re-run (hasil sama) di PR itu. **Bukan bagian G1-07,
> jangan diperbaiki di sini** — lihat §1 butir 3.

---

## 0. Ringkasan 60 detik

Instruksi sesi ini: "lanjutkan ke task berikutnya" (di tengah membabysit PR
#362/G1-06) → §3 handoff sesi 7 merekomendasikan G1-07 → **G1-07 selesai**
sesi ini, PR #362 (G1-06) tetap diawasi paralel.

**G1-07** — `packages/core/src/pdt/rekonsiliasi.ts` (`rekonsiliasiGmvPesanan`/
`parseShopeeShopStatsPerBasis`/`sumShopeeParentSkuGmv`/`hitungDeltaPersen`):
gerbang rekonsiliasi 0,5% (Rule 13-14), dites terhadap **angka Fim Motor
SUNGGUHAN** (bukan sintetis) dari `UAT_SHOPEE_FIM_MOTOR_20260903.md` — DoD
"kasus Fim Motor direproduksi sebagai fixture" terpenuhi literal, termasuk
angka "18,2%" yang persis cocok. Algoritma pembaca 3-basis `shopee_shop_stats`
**disalin (bukan diimpor) dari mesin lama `report/shopee/metrik.ts`**
(sudah benar sejak perbaikan SHP-1) — alasan penuh di §2.2 dan
`docs/DECISIONS.md`. Satu ketidakpastian kolom baru ditemukan dan dicatat
(`G1-07-PERSKU-DIBAYAR`), tidak memblokir.

---

## 1. Yang perlu ditindaklanjuti sesi ini/berikutnya

1. **Commit + push G1-07 belum dilakukan di awal sesi ini** — masuk PR #362
   yang sudah ada (branch sesi ini sama dengan G1-06), lakukan sebelum
   lanjut ke G1-08.
2. **PR #362 (G1-06 + G1-07) masih terbuka, masih diawasi** (subscribed via
   `subscribe_pr_activity`, check-in 60 menit terjadwal). CI merah di sana
   adalah bug pra-ada TERKONFIRMASI (lihat header berkas ini) — kalau sesi
   berikutnya melihatnya merah lagi, itu KONSISTEN dengan yang sudah
   dilaporkan, bukan regresi baru. Jangan perbaiki `client_platforms`/
   `gelombang-c-showcase.e2e.test.ts` di PR G1-07 — itu di luar cakupan
   tiket ini juga.
3. Item lama handoff sesi 5 §1 butir 2 **masih terbuka**: tes `describeLive`
   di `apps/api/src/lib/pdt-storage.test.ts` (signed URL vs Storage live)
   belum dijalankan — sandbox sesi ini juga tidak punya
   `SUPABASE_SERVICE_ROLE_KEY`.
4. **`G1-06-PERIODE-TIKTOK`** (sejak sesi 7) dan **`G1-07-PERSKU-DIBAYAR`**
   (baru sesi ini) — dua baris Open `docs/DECISIONS.md` yang BELUM
   terjawab. Tidak memblokir G1-08/09, tapi verifikasi dulu kalau sample
   asli (TikTok Shop Analytics / `parentskudetail.xlsx` 40-kolom) mendarat
   di repo sebelum modul terkait disentuh lagi.

---

## 2. G1-07 — SELESAI

### 2.1 Berkas

| Berkas | Isi |
|---|---|
| `packages/core/src/pdt/rekonsiliasi.ts` | `rekonsiliasiGmvPesanan` (gerbang Rule 13-14), `hitungDeltaPersen` (formula delta, ambang `max(a,b)`), `parseShopeeShopStatsPerBasis`/`parseShopStatsSection`/`cariBaris` (baca 3 basis `shopee_shop_stats`), `sumShopeeParentSkuGmv` (Σ per-SKU), `AMBANG_REKONSILIASI_PERSEN` (konstanta 0,5), `PdtModulTerlibat`/`PdtRekonsiliasiHasil`/`PdtBasisShopee` |
| `packages/core/src/pdt/rekonsiliasi.test.ts` | 14 tes — fixture Fim Motor SUNGGUHAN (3 basis, angka real), reproduksi "18,2%" persis, per-SKU Σ, gerbang verified/ditolak (termasuk tepat-di-ambang), urutan `modulPenyebab` |
| `packages/core/src/pdt/index.ts` | + `export * from './rekonsiliasi'` |
| `docs/DECISIONS.md` | 1 baris Decided baru (di ATAS G1-06) + 1 baris Open baru (`G1-07-PERSKU-DIBAYAR`) |

Tidak ada migrasi — skema yang G1-07 tulis nanti (`pdt_upload_batch.reconcile_delta_pct`,
`pdt_fact_shop_daily.basis` CHECK `net`/`dibuat`/`siap_dikirim`/`dibayar`)
sudah lahir di migrasi G1-01. Tidak ada route baru, tidak ada perubahan
gerbang CI.

### 2.2 Kontrak & keputusan penting

- **Formula delta `hitungDeltaPersen(a,b) = |a-b| / max(|a|,|b|) × 100`**
  — DIPILIH karena ini SATU-SATUNYA definisi yang mereproduksi angka
  "18,2%" yang sudah tercatat & disetujui pemilik (UAT Fim Motor:
  `295.710.122 / 1.624.937.476 = 18,2%`, dan `1.624.937.476 =
  max(1.624.937.476, 1.329.227.354)`). Dua kandidat lain (penyebut =
  shop-level tetap, atau rata-rata kedua sisi) dicoba lebih dulu dan
  DIBUANG karena menghasilkan 22,25%/20,02% — angka yang BERBEDA dari
  kebenaran yang sudah ada.
- **`rekonsiliasiGmvPesanan` mengecek DUA metrik (GMV dan pesanan)
  terpisah** (Rule 13 literal menyebut keduanya), ditolak bila SALAH SATU
  melebihi ambang; `deltaPct` yang disimpan = yang LEBIH BESAR dari
  keduanya (kolom DB `reconcile_delta_pct` singular). Tes membuktikan ini
  eksplisit: delta GMV Fim Motor 18,2% tapi delta PESANAN 18,4% (batal/retur
  menyusutkan jumlah pesanan lebih tajam daripada nilainya) — `deltaPct`
  hasil = 18,4%, bukan 18,2%, dan `pesan` menyebut metrik mana ("GMV")
  yang melewati ambang lebih dulu.
- **`parseShopeeShopStatsPerBasis` adalah SALINAN ALGORITMA, bukan impor,
  dari `report/shopee/metrik.ts`** (`parseBisnisHome`/`parseHomeSection`/
  `findRow`, mesin LAMA yang sudah benar sejak SHP-1). Alasan TIDAK
  mengimpor: PDT (PDT-17, strangler) dimaksud MENGGANTIKAN mesin lama —
  membuatnya bergantung pada kode yang sedang digantikannya akan mengunci
  arah ketergantungan yang salah untuk saat mesin lama akhirnya dimatikan.
  Pagar penting ikut disalin: mencari section BERIKUTNYA setelah section
  sebelumnya (bukan dari awal setiap kali), supaya sheet LAIN di workbook
  yang sama (`"(pesanan dibayar)Asal Penjualan"`) tidak salah tertangkap
  sebagai section shop-level kedua — diuji eksplisit di
  `rekonsiliasi.test.ts` dengan fixture yang literally menyertakan sheet
  jebakan itu.
- **⚠️ Kolom Σ per-SKU basis `dibayar` (`shopee_parent_sku`) BELUM
  terverifikasi** — dicatat `G1-07-PERSKU-DIBAYAR`, tidak memblokir:
  rekonsiliasi basis Dibuat/Siap Kirim (dipakai laporan klien default)
  penuh berjalan; basis Dibayar (gerbang PX, PDT-19) sementara hanya
  bisa dibandingkan shop-level-vs-shop-level sampai kolom SKU-nya ketemu.
- **TikTok (`tt_orders`, kanonik per P-01) SENGAJA belum dipetakan ke
  angka bertipe di tiket ini** — `Order Status` (kolom yang membedakan
  pesanan valid dari batal) tidak punya daftar nilai literal terverifikasi
  di dokumen manapun; memetakannya sekarang berarti mengarang gerbang
  bisnis ("status mana yang dihitung GMV"). Ini BUKAN gap tak sadar —
  sengaja ditunda, beda dari `G1-07-PERSKU-DIBAYAR` (yang cuma nama kolom)
  karena ini butuh KEPUTUSAN bisnis (nilai enum mana = valid), bukan cuma
  verifikasi sample.
- **Tes (`rekonsiliasi.test.ts`, 14 tes)** — memakai angka Fim Motor
  SUNGGUHAN (Dibuat Rp1.624.937.476/13.568, Siap Kirim Rp1.515.002.476/12.801,
  Dibayar Rp1.329.227.354/11.071), bukan angka sintetis, supaya klaim DoD
  "kasus Fim Motor direproduksi" jujur. Mencakup: 3-basis extraction +
  pagar anti-salah-tangkap, formula delta (termasuk kedua-nol), Σ per-SKU,
  verified/ditolak (termasuk tepat-di-ambang 0,5%), urutan modulPenyebab.
- **Diverifikasi:** `npm run typecheck` (root, 4 workspace) bersih;
  `npm run test -w @cdps/core` — **1111/1111 tes lulus** (14 baru).

### 2.3 Yang BELUM dilakukan (sengaja, bukan gap tak sadar)

- **Penulisan hasil rekonsiliasi ke `pdt_upload_batch`/`pdt_fact_*`** —
  belum ada route/domain yang menulis tabel-tabel ini sama sekali (sama
  seperti G1-06). G1-07 menyediakan gerbang murni; G1-09 (halaman upload)
  yang memanggilnya sesudah parse selesai.
- **Pemetaan `tt_orders`/modul TikTok lain ke angka bertipe untuk
  rekonsiliasi** — ditunda, butuh keputusan bisnis `Order Status` (lihat
  §2.2 di atas), bukan sekadar verifikasi nama kolom.
- **Basis `dibayar` per-SKU Shopee** — `G1-07-PERSKU-DIBAYAR`, menunggu
  sample.

---

## 3. Rekomendasi sesi 9 — mulai G1-08

`docs/backlog/PDT_BACKLOG.md` §1 G1-08 (Kegagalan parse tidak boleh
ditelan, Rule 10 + skor netral dihapus, Rule 12):

1. Tiap berkas punya `parse_status` (`ok`/`sebagian`/`gagal`) + `parse_error`
   **tersimpan** — pesan "berkas tidak diunggah" DILARANG untuk berkas yang
   diunggah tapi gagal parse.
2. Kolom wajib tidak ditemukan **dan** tidak punya alias (`pdt_kolom_alias`,
   G1-02) ⇒ `parse_status='gagal'` dengan pesan **menyebut nama kolom yang
   dicari**.
3. **Skor netral 5/10 DIHAPUS.** Dimensi tanpa berkas ⇒ `null` + label
   `data tidak tersedia`, dimensi itu **dikeluarkan dari pembobotan** (bobot
   dinormalisasi ulang) — preseden normalisasi-ulang bobot sudah ada di
   `performance.ts` (Rule 6 M14), pola yang sama kemungkinan bisa
   dipinjam/disalin (bukan diimpor, konsisten §2.2 di atas) untuk skor PDT.
4. Setelah G1-08: G1-09 (halaman upload + dropdown override manual) —
   **di sinilah G1-05/06/07 pertama kali dipanggil bersama dari alur
   nyata**, dan di sinilah `pdt_upload_batch`/`pdt_file`/
   `client_platforms.shop_id`/`akun_konten_toko` benar-benar ditulis.

**Jangan lompat ke G1-09** sebelum G1-08 — build order eksplisit
`PDT_BACKLOG.md` §0.

---

## 4. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` — Rule 13-16 (rekonsiliasi & basis).
- `docs/backlog/PDT_BACKLOG.md` — G1-07 (sesi ini) → G1-08 (sesi berikutnya).
- `docs/DECISIONS.md` — baris teratas (2026-09-13, PDT G1-07) + Open row
  `G1-07-PERSKU-DIBAYAR` (dan `G1-06-PERIODE-TIKTOK` dari sesi 7, masih
  terbuka).
- `packages/core/src/pdt/rekonsiliasi.ts` + `rekonsiliasi.test.ts`.
- `packages/core/src/report/shopee/metrik.ts` (`parseBisnisHome` — mesin
  LAMA yang algoritmanya disalin, BUKAN diimpor, ke `rekonsiliasi.ts`).
- `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md` — sumber angka fixture
  SUNGGUHAN yang dipakai `rekonsiliasi.test.ts`.
- `docs/handoff/HANDOFF_PDT_SESI7.md` — riwayat G1-06 + PR #362 (masih
  diawasi, CI merah pra-ada).
