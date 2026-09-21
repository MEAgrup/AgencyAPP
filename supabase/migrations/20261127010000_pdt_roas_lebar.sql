-- ============================================================================
-- PDT-ROAS-LEBAR — `pdt_fact_ads.roas`: numeric(8,3) → numeric(15,3)
-- (docs/DECISIONS.md 2026-09-21).
--
-- KENAPA: laporan pemilik 2026-09-21 — unggah PDT TikTok "TEST PDT Store 2"
-- periode Agustus 2026 berhenti di "internal server error" pada tombol
-- "Simpan Batch". Log runtime produksi (POST /api/v1/account/pdt/batches,
-- 09:18:52 dan 09:20:21 WIB) menunjukkan sebabnya persis:
--
--   SQLSTATE 22003 numeric field overflow
--   detail: A field with precision 8, scale 3 must round to an absolute
--           value less than 10^5.
--
-- `pdt_fact_ads.roas` adalah SATU-SATUNYA kolom numeric(8,3) di seluruh skema
-- (diverifikasi lewat information_schema pada CDPS SG), jadi tidak ada kandidat
-- lain. ROAS `tt_ads_product`/`tt_ads_live` DITURUNKAN (`gmv ÷ biaya`,
-- `@cdps/core` `pdt/fakta.ts`), dan satu baris iklan berbiaya nyaris nol
-- (mis. biaya Rp 1 dengan GMV Rp 500.000) menghasilkan 500.000 — di atas
-- batas 10^5 kolom lama. Karena penulisan fakta terjadi DI DALAM transaksi
-- commit, satu sel itu menjatuhkan SELURUH batch: nol baris tersimpan, nol
-- diagnosis untuk AM. Bukan soal "ada berkas tambahan di dalam ZIP" — berkas
-- yang tidak dibutuhkan memang sudah dilewati/ditolak per entri sejak Rule 41
-- tanpa menggagalkan paket.
--
-- KENAPA DILEBARKAN, BUKAN DIBULATKAN/DI-NULL-KAN: ROAS sebesar itu NYATA
-- (biayanya memang nyaris nol), dan `pdt_fact_ads` menyimpan `gmv` + `biaya`
-- di sebelahnya sebagai numeric(15,2) — kolom rasionya yang tertinggal sempit,
-- bukan datanya yang salah. numeric(15,3) memberi 12 digit di depan koma:
-- biaya terkecil yang mungkin (Rp 0,01) terhadap GMV terbesar yang pernah
-- tercatat di tabel ini (Rp 868 juta) = 8,7 × 10^10, masih di bawah 10^12.
-- Agregat laporan tidak terpengaruh: "iklan" menurunkan ROAS-nya sendiri dari
-- Σgmv ÷ Σbiaya (docs/DATA_MODEL.md §Fakta ads PDT), bukan merata-ratakan
-- kolom ini.
--
-- Menaikkan presisi numeric TANPA mengubah skala adalah perubahan tipe yang
-- tidak menulis ulang tabel (Postgres ≥ 12) dan tidak bisa menolak satu baris
-- pun yang sudah ada — nilai lama (maks. 5.692,367 saat migrasi ini ditulis)
-- muat seluruhnya.
--
-- Pagar kode pendampingnya ada di `@cdps/core` `pdt/fakta.ts` (`roasTersimpan`):
-- angka di luar jangkauan kolom ini disimpan `null`, supaya overflow berikutnya
-- (kalau pun ada) menjadi satu sel kosong, bukan satu paket gagal unggah.
-- ============================================================================

ALTER TABLE public.pdt_fact_ads
    ALTER COLUMN roas TYPE numeric(15,3);

COMMENT ON COLUMN public.pdt_fact_ads.roas IS
  'Rasio (pdt_satuan_t.rasio, F-6) — gmv ÷ biaya. numeric(15,3) sejak 2026-09-21: '
  'numeric(8,3) tumpah (SQLSTATE 22003) pada baris iklan berbiaya nyaris nol dan '
  'menjatuhkan seluruh commit batch. NULL = tidak dapat dihitung (biaya 0) atau di '
  'luar jangkauan kolom.';
