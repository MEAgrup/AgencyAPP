-- ============================================================================
-- PDT-MINGGUAN — `pdt_laporan_kiriman.jenis_periode` ('bulanan' | 'mingguan').
--
-- Keputusan pemilik 2026-10-01 (Yohan): "Upload PDT bisa dibuat untuk report
-- mingguan juga bukan hanya bulanan" — dipilih versi RINGKAS: laporan mingguan
-- dirakit dari fakta HARIAN saja (KPI, tren harian, Tokopedia vs minggu lalu,
-- cancel rate), tampil di portal klien, TIDAK menulis Total Sales / Health
-- Score / ROAS (tetap dari laporan bulanan). Rincian di `docs/DECISIONS.md`
-- PDT-MINGGUAN.
--
-- KENAPA KOLOM, BUKAN TEBAKAN DARI PANJANG RENTANG. Tiga pembaca memakai
-- "satu kiriman terbaru per (toko, periode_mulai)" sebagai kunci:
-- `client-portal.ts` listReports/reportHtml (R11.3) dan pencarian kiriman
-- sebelumnya di `kirimLaporanPdt`. Laporan mingguan yang kebetulan mulai
-- Senin tanggal 1 akan berbagi `periode_mulai` dengan laporan bulanan bulan
-- itu dan saling menyembunyikan. Jenis periode harus bagian dari kunci.
--
-- Baris lama: DEFAULT 'bulanan' — benar untuk seluruh kiriman yang ada (sampai
-- migrasi ini setiap kiriman PDT berupa satu bulan kalender). ADD COLUMN dengan
-- default konstan tidak menulis ulang baris, jadi trigger immutable
-- `trg_pdt_laporan_kiriman_frozen` (BEFORE UPDATE) tidak tersentuh.
--
-- CHECK hanya untuk 'mingguan' (Senin s/d Minggu, 7 hari) — bentuk baris
-- bulanan lama tidak diubah/dikunci di sini.
-- Nol tabel baru, nol prefix ID, nol mesin state, nol notif event, nol RLS.
-- ============================================================================

ALTER TABLE public.pdt_laporan_kiriman
  ADD COLUMN jenis_periode varchar(16) NOT NULL DEFAULT 'bulanan';

ALTER TABLE public.pdt_laporan_kiriman
  ADD CONSTRAINT ck_pdt_laporan_kiriman_jenis_periode
  CHECK (jenis_periode IN ('bulanan', 'mingguan'));

ALTER TABLE public.pdt_laporan_kiriman
  ADD CONSTRAINT ck_pdt_laporan_kiriman_mingguan_senin
  CHECK (jenis_periode <> 'mingguan'
         OR (extract(isodow FROM periode_mulai) = 1 AND periode_selesai = periode_mulai + 6));

CREATE INDEX idx_pdt_laporan_kiriman_jenis_mulai
  ON public.pdt_laporan_kiriman (client_platform_id, jenis_periode, periode_mulai);

COMMENT ON COLUMN public.pdt_laporan_kiriman.jenis_periode IS
  'PDT-MINGGUAN (2026-10-01): bulanan = satu bulan kalender; mingguan = Senin–Minggu, versi ringkas '
  '(fakta harian saja). Bagian dari kunci "kiriman terbaru per (toko, jenis, periode_mulai)" di portal. '
  'Hanya kiriman bulanan yang menulis total_sales / metric entries Ads.';
