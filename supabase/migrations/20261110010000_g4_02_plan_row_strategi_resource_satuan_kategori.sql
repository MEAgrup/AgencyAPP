-- G4-02 · Satuan bertipe (docs/backlog/PDT_BACKLOG.md G4-02, Rule 27-28).
--
-- `plan_row.satuan` (varchar(32) NOT NULL) dan `strategi_resource.satuan`
-- (varchar(24) NULL) tetap TEKS BEBAS — keduanya masih dipakai sebagai LABEL
-- tampilan dan, untuk divisi ber-katalog (`plantask.ts`), kunci identitas
-- `jenisBySatuan` (mis. Section F membedakan baris "video" vs "foto" lewat
-- `satuan`, bukan kolom baru). Peran itu TIDAK disentuh migrasi ini.
--
-- Yang hilang (Rule 27) adalah KATEGORI PENGUKURAN bertipe yang bisa dibaca
-- SATU formatter (Rule 28) — celah yang membuat "20 sesi live" tercetak
-- "Rp 20,00" dan sebuah persentase CTOR tercetak Rupiah (dua bug historis
-- yang dikutip ticket ini). `pdt_satuan_t` (rupiah/persen/hitungan/jam/hari/
-- views/rasio) sudah lahir G1-01 untuk `pdt_usulan_katalog.satuan` — dipakai
-- ULANG di sini (bukan enum baru untuk konsep yang sama), persis alasan
-- ticket ini ada ("tidak ada enum untuk dipakai ulang" — sekarang ADA).
--
-- Kategori diturunkan dari label bebas yang SUDAH ada lewat
-- `packages/core/src/satuan.ts` `kategoriDariSatuanLabel` (CASE di bawah
-- adalah transkripsi PERSIS tabelnya) — dipanggil ulang di SETIAP jalur tulis
-- (`createPlanRow`/`seedRowsFromPillars`/`copyRowToPeriod`/`saveResources`,
-- commit yang sama) supaya kolom ini tetap true setiap kali `satuan` berubah,
-- bukan hanya saat migrasi. Backfill di bawah memakai SQL CASE yang sama
-- (bukan memanggil TS) karena ini migrasi satu kali, bukan jalur tulis hidup.
--
-- Diverifikasi terhadap DATA LIVE (2026-09-17, sebelum migrasi ini ditulis):
-- `plan_row` 10 baris nyata (satuan: 'Rp' ×1, 'SKU' ×1, 'video' ×7, 'sku' ×1
-- — 'sku' Store Operation tidak cocok katalog manapun, jatuh ke default
-- `hitungan`, BENAR — itu hitungan SKU, bukan uang); `strategi_resource`
-- NOL baris (fitur Section F belum pernah dipakai produksi). Nol risiko
-- backfill salah kategori pada populasi hari ini.
--
-- `strategi_resource.jumlah_satuan_kategori` TETAP NULLABLE (cermin
-- `satuan` yang juga nullable — CHECK di bawah menjaga keduanya NULL/NOT
-- NULL BERSAMAAN, sinyal "satuan belum diisi" tidak boleh diam-diam jadi
-- `hitungan`). `nilai` (kolom Rupiah `strategi_resource`, PC/F-1) TIDAK
-- butuh kategori — ia SELALU Rupiah menurut definisi kolom (komentar tabel
-- asli "Rp amount, F-1"), formatter memanggil cabang `rupiah` LANGSUNG di
-- pemanggilnya untuk `nilai`, tanpa perlu kolom kategori.

ALTER TABLE plan_row ADD COLUMN satuan_kategori pdt_satuan_t NULL;

UPDATE plan_row SET satuan_kategori = (CASE lower(trim(satuan))
    WHEN 'rp' THEN 'rupiah'
    WHEN 'rupiah' THEN 'rupiah'
    WHEN 'persen' THEN 'persen'
    WHEN '%' THEN 'persen'
    WHEN 'jam' THEN 'jam'
    WHEN 'jam live' THEN 'jam'
    WHEN 'hari' THEN 'hari'
    WHEN 'views' THEN 'views'
    WHEN 'vv' THEN 'views'
    WHEN 'x' THEN 'rasio'
    WHEN 'rasio' THEN 'rasio'
    WHEN 'kali' THEN 'rasio'
    ELSE 'hitungan'
  END)::pdt_satuan_t;

ALTER TABLE plan_row
  ALTER COLUMN satuan_kategori SET NOT NULL,
  ALTER COLUMN satuan_kategori SET DEFAULT 'hitungan';

COMMENT ON COLUMN plan_row.satuan_kategori IS
  'Kategori pengukuran untuk formatter TUNGGAL (Rule 28, packages/core/src/satuan.ts '
  'formatNilaiSatuan) — diturunkan dari label bebas plan_row.satuan lewat '
  'kategoriDariSatuanLabel, ditulis ulang di SETIAP jalur tulis (createPlanRow/'
  'seedRowsFromPillars/copyRowToPeriod). satuan (label tampilan + kunci jenisBySatuan) '
  'TIDAK berubah perannya. DEFAULT hitungan cermin satuan DEFAULT kosong (aman — never '
  'Rupiah) — jalur tulis produksi SELALU menghitung+mengirim nilai eksplisit, default ini '
  'murni jaring pengaman skema/fixture SQL langsung, bukan sumber kebenaran.';

ALTER TABLE strategi_resource ADD COLUMN jumlah_satuan_kategori pdt_satuan_t NULL;

UPDATE strategi_resource SET jumlah_satuan_kategori = (CASE lower(trim(satuan))
    WHEN 'rp' THEN 'rupiah'
    WHEN 'rupiah' THEN 'rupiah'
    WHEN 'persen' THEN 'persen'
    WHEN '%' THEN 'persen'
    WHEN 'jam' THEN 'jam'
    WHEN 'jam live' THEN 'jam'
    WHEN 'hari' THEN 'hari'
    WHEN 'views' THEN 'views'
    WHEN 'vv' THEN 'views'
    WHEN 'x' THEN 'rasio'
    WHEN 'rasio' THEN 'rasio'
    WHEN 'kali' THEN 'rasio'
    ELSE 'hitungan'
  END)::pdt_satuan_t
 WHERE satuan IS NOT NULL;

ALTER TABLE strategi_resource
  ADD CONSTRAINT ck_strres_jumlah_satuan_kategori_bersamaan
  CHECK ((satuan IS NULL) = (jumlah_satuan_kategori IS NULL));

COMMENT ON COLUMN strategi_resource.jumlah_satuan_kategori IS
  'Kategori pengukuran untuk `jumlah` (formatter TUNGGAL Rule 28, packages/core/src/satuan.ts) '
  '— diturunkan dari label bebas strategi_resource.satuan, ditulis ulang tiap saveResources. '
  'NULL persis ketika satuan NULL (ck_strres_jumlah_satuan_kategori_bersamaan) — tidak pernah '
  'ditebak `hitungan` untuk baris yang satuannya belum diisi. `nilai` (kolom Rupiah) SELALU '
  'diformat cabang rupiah langsung, tidak butuh kolom kategori.';

-- Gerbang CI — nol perubahan struktural (dua kolom + satu CHECK di tabel yang sudah ada):
--   public base tables : 182 → 182 (nol tabel baru)
--   entity_prefix      : 45 → 45  (nol prefix baru)
--   sm_machines        : 35 → 35  (nol lifecycle baru)
--   notif_events       : 76 → 76  (nol event notifikasi baru)
