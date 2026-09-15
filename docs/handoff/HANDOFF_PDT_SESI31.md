# HANDOFF — PDT (Pusat Data Toko) SESI 30 → SESI 31

> **Dibuat 2026-09-15.** Segera sesudah PR #389 (`G1-09-SHEET-BUKAN-PERTAMA`) merge, pemilik
> menandai PR ready+merge lalu mengunggah ZIP KEDUA ("Shopee - Fim Motor.zip", sample xlsx asli —
> beda dari "Sample nama asli" sesi 27) dan meminta lanjut HANYA ke item berikutnya yang tercatat:
> `G1-09-SHOPEESHOPSTATS-BASIS-TOTAL`, gap yang `G1-09-SHEET-BUKAN-PERTAMA` sengaja tinggalkan
> terbuka (butuh sample, bukan ditebak). Rantai: `HANDOFF_PDT_SESI30.md` → berkas ini.

---

## 0. Apa yang terjadi sesi ini

**PR #389 di-merge** (squash `58212c9`) atas instruksi eksplisit pemilik, sesudah dikonfirmasi
CI hijau (11/11 check).

**`G1-09-SHOPEESHOPSTATS-BASIS-TOTAL` DITUTUP** — ZIP kedua pemilik dibuka+dibaca langsung
(`XLSX.read` ad-hoc, pola sama sesi 27) untuk memverifikasi struktur BARIS di dalam sheet
`shopee_shop_stats` yang sekarang sudah TERISOLASI per basis (`namaSheet: 'Pesanan Siap
Dikirim'`, PR #389):

- `fim_motor.shopee-shop-stats.20260701-20260731.xlsx` punya PERSIS 12 sheet, mengonfirmasi
  tebakan `G1-09-SHEET-BUKAN-PERTAMA` byte-per-byte (`Pesanan Dibuat`/`Pesanan Siap Dikirim`/
  `Pesanan Dibayar` + sembilan sheet "Asal Kunjungan"/"Kontribusi" lain).
- Sheet `'Pesanan Siap Dikirim'`: baris 0 header (15 kolom, PERSIS `kolomDipanen` yang sudah ada
  sejak seed G1-02 — nol koreksi dibutuhkan), **baris 1 adalah ringkasan PERIODE PENUH** (kolom
  `Tanggal` = `"01-07-2026-31-07-2026"`, sebuah RENTANG — bukan satu tanggal), baris 2 kosong,
  baris 3 header berulang, baris 4-34 rincian 31 hari.
- **Dibuktikan dengan aritmetika**: Σ `Total Penjualan (IDR)`/`Total Pesanan` dari SELURUH 31
  baris harian PERSIS SAMA dengan baris 1 (`Rp1.515.002.476`/`12.801`) — angka yang SAMA PERSIS
  dengan `UAT_SHOPEE_FIM_MOTOR_20260903.md`, membuktikan fixture test LAMA sudah punya angka
  yang benar sejak awal, hanya STRUKTUR (satu sheet gabungan 3-marker-section) yang salah ditebak.

Dibangun: `parseShopeeShopStatsBasisTerisolasi` (baru, `packages/core/src/pdt/rekonsiliasi.ts`)
membaca `aoa[0]` sebagai header, `aoa[1]` (baris TEPAT SESUDAHNYA) sebagai ringkasan — pola SAMA
PERSIS "baris TOTAL = baris tepat sesudah header" yang mesin lama sudah pakai, TANPA syarat
marker section (terbukti tidak pernah ada di sheet terisolasi). **`parseShopeeShopStatsPerBasis`/
`parseShopStatsSection`/`MARKER_BASIS`/`cariBaris` DIHAPUS** — satu-satunya pemanggil
(`commitUploadBatch`) sudah diganti, dan `namaSheet` mengunci SATU-SATUNYA bentuk `aoa` yang
pernah sampai ke situ sebagai sheet terisolasi — mesin marker-3-section lama tidak pernah bisa
dipanggil lagi dengan input yang berarti (dead code, bukan cadangan berguna).

**Diverifikasi tambahan (bukan diminta, tapi murah dan berharga)**: script ad-hoc yang sama
dijalankan terhadap SELURUH 15 berkas Shopee di ZIP kedua ini lewat `detectPdtModuleAntarSheet`
(fungsi PR #389) — 14/15 terdeteksi TEPAT, nol ambigu (termasuk `shopee_shop_stats` dan
`shopee_live`, keduanya sekarang benar-benar hidup untuk berkas nyata); satu `null` adalah
`video-overview-v3...` yang MEMANG sengaja `UNVERIFIED_SIGNATURE` (`shopee_video`, DECISIONS.md
sesi 20 — bukan cacat, sudah didokumentasikan sebelumnya).

Diverifikasi (DB lokal rebuild bersih, 247 migrasi — nol migrasi baru, murni kode+tes):
`@cdps/core` **1213/1213**, `@cdps/domain` **2619/2619 (1 skip, tidak berubah)**, `@cdps/db`
**107/107**, `@cdps/api` **595/595 (2 skip, live-storage, tidak berubah)**; typecheck 5 paket +
lint `@cdps/api --max-warnings 0` bersih.

## 1. Posisi G1 sekarang — benar-benar KOSONG untuk item severity-tinggi/teknis

Sisa item G1, SEMUANYA menunggu keputusan/data pemilik (nol lagi yang severity tinggi):

1. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — butuh keputusan pemilik (3 opsi + rekomendasi,
   `HANDOFF_PDT_SESI26.md` §1a).
2. **TikTok Avitaskin** — butuh ZIP diunggah ulang. Membuka `G1-06-PERIODE-TIKTOK`,
   `G1-09-2BII-TTLIVE`, `G1-07-TIKTOK-REKONSILIASI`.
3. **`G1-10-RETENSI-RECOMPUTE`** — menunggu G2-01/G5 punya baris produksi pertama.
4. **`G1-11-REPARSE-RECOMPUTE-STATUS`** — pertanyaan desain jarang-terjadi, tidak memblokir.

`docs/backlog/PDT_BACKLOG.md` §8 "Aturan strangler" tetap berlaku: G2 (Laporan sebagai view)
menunggu G1 exit criteria (≥10 klien nyata verified) — butuh KLIEN NYATA, bukan kode.

## 2. Setup teknis

Sama seperti sesi-sesi lalu. Sample ZIP kedua ("Shopee - Fim Motor.zip") diekstrak ke
`/tmp/claude-0/.../scratchpad/shopee_sample/` sesi ini — TIDAK ikut ke chat baru (scratchpad
sesi-spesifik), sama seperti nasib sample sesi 27. Kalau dibutuhkan lagi (mis. verifikasi TikTok
Avitaskin format berbeda), minta diunggah ulang.

## 3. Rujukan

- `docs/DECISIONS.md` — cari `sesi 31` untuk baris Decided (`G1-09-SHOPEESHOPSTATS-BASIS-TOTAL`
  ditutup, dengan bukti aritmetika lengkap).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status "sesi 31" baru di akhir blok.
- `packages/core/src/pdt/rekonsiliasi.ts` — `parseShopeeShopStatsBasisTerisolasi` (baru).
- `packages/domain/src/pdt.ts` baris ~670 — pemanggil baru di `commitUploadBatch`.
