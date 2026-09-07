-- ============================================================================
-- F-4 — empat kolom aditif di `briefs`: jendela campaign, budget, dan Brief
-- Creative sumber.
--
-- `briefs` adalah tabel yang paling banyak dipakai bersama di repo ini, jadi
-- SATU `ALTER TABLE` di fondasi jauh lebih murah daripada dua migrasi datang
-- dari dua jalur paralel yang menyentuh tabel yang sama.
--
-- Aditif dan nullable seluruhnya: nol backfill, nol perubahan perilaku, nol
-- baris yang jadi tidak sah. Brief yang sudah ada tetap sah dengan keempatnya
-- NULL. Nol tabel/prefix/mesin/event baru ⇒ gate 146/40/31/73 TETAP.
--
-- ---------------------------------------------------------------------------
-- KENAPA KOLOM, BUKAN TEKS DI DALAM `instructions`
-- ---------------------------------------------------------------------------
-- Keluhan KOL #1. Jendela campaign hari ini memang ADA — di
-- `plan.tanggal_mulai` / `plan.tanggal_akhir` — tapi tidak pernah
-- diproyeksikan ke Brief, dan budget hanya "nyangkut" sebagai potongan teks di
-- dalam `instructions` (`brief-inherit.ts:181`). Angka yang hidup di dalam
-- prosa tidak bisa diurutkan, difilter, dibandingkan dengan target, atau
-- dipakai memicu pengingat — itulah kenapa tim KOL masih memegang Google Sheet
-- paralel. Tipenya diselaraskan dengan sumbernya, bukan ditebak:
-- `plan.tanggal_mulai`/`tanggal_akhir` bertipe `date`, dan `plan_row.budget`
-- `numeric(18,2)`.
--
-- ---------------------------------------------------------------------------
-- `source_creative_brief_id` — ketokan K-3
-- ---------------------------------------------------------------------------
-- Keluhan Ads: Advertiser tidak punya cara menemukan aset yang harus
-- diiklankan; kolomnya textbox untuk mengetik `AST-…` dari ingatan. Ketokan
-- pemilik K-3: brief Ads MENUNJUK brief Creative sumbernya, dan picker aset
-- menyaring ke situ. FK ke `briefs` sendiri (self-referencing), nullable —
-- mayoritas Brief tidak punya sumber, dan Brief Ads yang belum ditunjuk pun
-- tetap sah (picker jatuh ke seluruh aset [Approved] milik klien itu).
--
-- `ON DELETE SET NULL` sengaja TIDAK dipakai: baris `briefs` tidak punya jalur
-- hapus di domain ini (riwayatnya immutable, aturan rumah #3), jadi menuliskan
-- perilaku hapus di sini berarti mengarang aturan untuk peristiwa yang tidak
-- ada. Default RESTRICT membuat percobaan hapus gagal keras, dan itu jawaban
-- yang benar kalau suatu hari ada yang mencoba.
--
-- Indeks: satu di `source_creative_brief_id` — arah kueri yang sebenarnya
-- dipakai adalah "aset dari Brief sumber ini" lewat kolom itu, dan sebuah FK
-- tanpa indeks di sisi anak membuat setiap pencarian jadi seq scan atas tabel
-- tersibuk di repo.
-- ============================================================================

ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS tanggal_mulai            date,
  ADD COLUMN IF NOT EXISTS tanggal_akhir            date,
  ADD COLUMN IF NOT EXISTS budget                   numeric(18, 2),
  ADD COLUMN IF NOT EXISTS source_creative_brief_id character varying(32);

-- Jendela yang terbalik tidak pernah benar, dan lebih murah ditolak DB
-- daripada dicari di laporan. NULL di salah satu sisi tetap lolos: jendela
-- yang belum lengkap bukan jendela yang salah.
ALTER TABLE public.briefs
  DROP CONSTRAINT IF EXISTS ck_briefs_jendela_urut;
ALTER TABLE public.briefs
  ADD CONSTRAINT ck_briefs_jendela_urut
  CHECK (tanggal_mulai IS NULL OR tanggal_akhir IS NULL OR tanggal_mulai <= tanggal_akhir);

-- Budget negatif bukan budget. Nol diizinkan (baris tanpa alokasi uang).
ALTER TABLE public.briefs
  DROP CONSTRAINT IF EXISTS ck_briefs_budget_non_negatif;
ALTER TABLE public.briefs
  ADD CONSTRAINT ck_briefs_budget_non_negatif
  CHECK (budget IS NULL OR budget >= 0);

-- Sebuah Brief tidak bisa menjadi sumbernya sendiri.
ALTER TABLE public.briefs
  DROP CONSTRAINT IF EXISTS ck_briefs_sumber_bukan_diri;
ALTER TABLE public.briefs
  ADD CONSTRAINT ck_briefs_sumber_bukan_diri
  CHECK (source_creative_brief_id IS NULL OR source_creative_brief_id <> id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_briefs_source_creative_brief'
  ) THEN
    ALTER TABLE public.briefs
      ADD CONSTRAINT fk_briefs_source_creative_brief
      FOREIGN KEY (source_creative_brief_id) REFERENCES public.briefs(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_briefs_source_creative
  ON public.briefs (source_creative_brief_id)
  WHERE source_creative_brief_id IS NOT NULL;

COMMENT ON COLUMN public.briefs.tanggal_mulai IS
  'F-4/KOL #1 — awal jendela campaign, diproyeksikan dari plan.tanggal_mulai. '
  'Kolom sungguhan, bukan teks di dalam instructions.';
COMMENT ON COLUMN public.briefs.tanggal_akhir IS
  'F-4/KOL #1 — akhir jendela campaign (plan.tanggal_akhir). Sumber pengingat '
  'm9.campaign.mendekati_akhir (katalog v15).';
COMMENT ON COLUMN public.briefs.budget IS
  'F-4/KOL #1 — budget Brief, diturunkan dari plan_row.budget. Sebelumnya hanya '
  'nyangkut sebagai teks di instructions, jadi tidak bisa diurutkan/dibandingkan.';
COMMENT ON COLUMN public.briefs.source_creative_brief_id IS
  'F-4/ketokan K-3 — Brief Creative sumber yang ditunjuk sebuah Brief Ads; '
  'picker aset menyaring ke situ. NULL = tidak ditunjuk (picker jatuh ke seluruh '
  'aset [Approved] milik klien).';
