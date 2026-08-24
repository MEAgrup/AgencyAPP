-- CDPS — M6A A-15/A-16: tambah status "tidak butuh akses" + blocker hanya dari ditolak.
--
-- ## Kenapa (owner QA 2026-08-24, DECISIONS.md)
-- A-15 hanya punya tiga status (`sudah`/`pending`/`ditolak`). Banyak baris akses
-- (mis. Affiliate Center untuk channel yang tidak menjual lewat afiliasi, atau
-- akses gudang untuk channel dropship) memang TIDAK PERNAH diminta — memaksa
-- AM memilih `pending` untuk kasus itu mencemari dashboard SPV dengan "blocker"
-- palsu yang tidak akan pernah "sudah". Pemilik minta pilihan keempat
-- `tidak_butuh` (tidak butuh akses untuk channel ini).
--
-- Pemilik juga menyempitkan makna blocker: dulu `pending` ATAU `ditolak` boleh
-- ditandai `memblokir` (asal punya target tanggal, `ck_strakses_blocker` lama).
-- Itu salah cerita — akses yang masih `pending` (diminta, menunggu) bukan
-- hambatan untuk maju ke langkah berikutnya, hanya akses yang benar-benar
-- DITOLAK yang layak menghentikan eksekusi. Sekarang: **hanya `ditolak` yang
-- boleh `memblokir=true`**; `sudah`/`pending`/`tidak_butuh` tidak pernah
-- menjadi bloker.
--
-- ## Yang diubah
--   ck_strakses_status  — tambah 'tidak_butuh' ke set enum.
--   ck_strakses_blocker — status persyaratan blocker dari "<> 'sudah'" jadi
--                         "= 'ditolak'".

ALTER TABLE strategi_akses DROP CONSTRAINT IF EXISTS ck_strakses_status;
ALTER TABLE strategi_akses ADD CONSTRAINT ck_strakses_status
    CHECK (status IN ('sudah', 'pending', 'ditolak', 'tidak_butuh'));

ALTER TABLE strategi_akses DROP CONSTRAINT IF EXISTS ck_strakses_blocker;
ALTER TABLE strategi_akses ADD CONSTRAINT ck_strakses_blocker CHECK (
    NOT memblokir OR (status = 'ditolak' AND target_tanggal_beres IS NOT NULL));

COMMENT ON TABLE strategi_akses IS
  'M6A A-15 (matriks channel × akses × status: sudah/pending/ditolak/tidak_butuh) '
  '+ A-16 (blocker = flag memblokir + target_tanggal_beres pada baris yang sama, '
  'HANYA sah saat status=ditolak — owner QA 2026-08-24, DECISIONS).';
