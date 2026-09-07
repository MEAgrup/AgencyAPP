-- ============================================================================
-- B-3 — pengingat KOL: Booking mendekati/lewat jatuh tempo, dan campaign
--       mendekati tanggal akhir.
--
-- Keluhan KOL #1: worksheet KOL asli memuat `Duration · end date · Urgency`,
-- dan CDPS punya angkanya — `briefs.due_date` sejak awal, `briefs.tanggal_akhir`
-- sejak F-4 — tapi **tidak pernah memberi tahu siapa pun**. Koordinator KOL
-- mengejar tenggat dari ingatan dan dari Google Sheet paralel.
--
-- Dua event ini SUDAH didaftarkan di katalog v15 oleh F-3 (`m9.booking.jatuh_tempo`,
-- `m9.campaign.mendekati_akhir`), keduanya resolver `explicitOrLeads`. Migrasi
-- ini memasang EMITTER-nya. ⛔ **JANGAN naikkan `notif_events`** — sudah 73,
-- dinaikkan sekali di F-5, dan migrasi ini nol event baru.
--
-- ---------------------------------------------------------------------------
-- KENAPA ATURAN SELEKSINYA DI SQL, BUKAN DI TYPESCRIPT
--
-- Preseden `penugasan_reminder_tick` (`20260814120000`) dan `wrr_reminder_tick`:
-- di Supabase, pg_cron memanggil fungsi SQL-nya LANGSUNG. Menyalin aturan
-- seleksinya ke TS berarti membuat aturan kedua yang bisa berbeda dari yang
-- benar-benar berjalan di produksi. Jadi TS-nya (`kol.runKolReminderTick`)
-- adalah pembungkus tipis, dan rute internalnya jalan masuk manual/cron-luar.
--
-- ---------------------------------------------------------------------------
-- TIGA CABANG, DAN KENAPA MASING-MASING ADA
--
--   (a) H-1 Booking      jatuh tempo Brief induk BESOK, Booking belum terminal.
--   (b) lewat tenggat    jatuh tempo Brief induk sudah LEWAT, belum terminal.
--   (c) campaign H-7     `briefs.tanggal_akhir` dalam 7 hari, Brief belum
--                        `[Approved]`.
--
-- Cabang (c) memakai jendela **H-7, bukan H-1**: sebuah campaign KOL yang
-- berakhir besok sudah tidak bisa diselamatkan — creator butuh waktu untuk
-- brief, produksi, dan QC. Tujuh hari adalah tenggat terakhir yang masih bisa
-- ditindaklanjuti. (H-1 tetap benar untuk Booking di (a): itu satu deliverable,
-- bukan sebuah campaign.)
--
-- Penerimanya: koordinator Booking + AM pemilik klien (eksplisit), plus lead
-- divisi KOL lewat `division` (resolver `explicitOrLeads`). AM pemilik
-- diresolusi lewat `private.brief_owner_am` — BUKAN join `services`→`clients`,
-- yang di bawah RLS nol arm divisi eksekusi (perangkap O52). Di sini fungsinya
-- SECURITY DEFINER jadi join apa pun akan lolos, tapi memakai pintu yang sama
-- seperti kode lain menjaga satu jawaban untuk satu pertanyaan.
--
-- ---------------------------------------------------------------------------
-- SEKALI, BUKAN SETIAP HARI — dan penanda hanya boleh false→true
--
-- Tiga penanda idempotensi, pola `pengingat_h1_terkirim` (M6D D-06 /
-- Penugasan). Tanpa itu job harian akan mengirim "terlambat" setiap pagi sampai
-- Booking-nya beres, dan kotak masuk yang berisik adalah kotak masuk yang tidak
-- dibaca. Konsekuensi yang DITERIMA: pemberitahuan terlambat hanya SEKALI;
-- eskalasi berulang butuh keputusan tersendiri.
--
-- Penandanya dijaga trigger supaya tidak bisa di-reset: penanda yang bisa
-- di-reset = notifikasi yang bisa dikirim ulang, dan itu mengembalikan persis
-- kebisingan di atas.
--
-- Booking yang lahir SUDAH lewat tenggat melompati (a) dan langsung dapat (b) —
-- benar: tidak ada yang perlu diingatkan tentang besok yang sudah kemarin.
--
-- NOL tabel / prefix / mesin / event baru (tiga KOLOM penanda + satu, bukan
-- tabel) ⇒ gerbang 146 / 40 / 31 / 73 TETAP.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Penanda idempotensi.
-- ---------------------------------------------------------------------------
ALTER TABLE public.creator_bookings
  ADD COLUMN IF NOT EXISTS pengingat_h1_terkirim  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS jatuh_tempo_terkirim   boolean NOT NULL DEFAULT false;

ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS campaign_akhir_terkirim boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.creator_bookings.pengingat_h1_terkirim IS
  'B-3: penanda idempotensi cabang H-1 kol_reminder_tick. HANYA false->true (trigger).';
COMMENT ON COLUMN public.creator_bookings.jatuh_tempo_terkirim IS
  'B-3: penanda idempotensi cabang lewat-tenggat kol_reminder_tick. HANYA false->true (trigger).';
COMMENT ON COLUMN public.briefs.campaign_akhir_terkirim IS
  'B-3: penanda idempotensi cabang campaign-mendekati-akhir kol_reminder_tick. HANYA false->true (trigger).';

-- ---------------------------------------------------------------------------
-- 2. Penanda tidak boleh di-reset.
--
-- Trigger terpisah per tabel, BUKAN menyisipkan aturan ini ke trigger beku yang
-- sudah ada: trigger yang sudah ada punya alasannya sendiri, dan menumpanginya
-- membuat dua aturan berbeda hidup di satu fungsi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.penanda_pengingat_hanya_maju()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'creator_bookings' THEN
    IF OLD.pengingat_h1_terkirim AND NOT NEW.pengingat_h1_terkirim THEN
      RAISE EXCEPTION 'pengingat_h1_terkirim tidak dapat dikembalikan ke false';
    END IF;
    IF OLD.jatuh_tempo_terkirim AND NOT NEW.jatuh_tempo_terkirim THEN
      RAISE EXCEPTION 'jatuh_tempo_terkirim tidak dapat dikembalikan ke false';
    END IF;
  ELSE
    IF OLD.campaign_akhir_terkirim AND NOT NEW.campaign_akhir_terkirim THEN
      RAISE EXCEPTION 'campaign_akhir_terkirim tidak dapat dikembalikan ke false';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Fungsi trigger: sama alasannya, sebut role-nya eksplisit. Ia dipanggil oleh
-- trigger (privilege pemilik tabel), bukan oleh klien, jadi nol yang hilang.
REVOKE EXECUTE ON FUNCTION private.penanda_pengingat_hanya_maju() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS creator_bookings_penanda_maju ON public.creator_bookings;
CREATE TRIGGER creator_bookings_penanda_maju
  BEFORE UPDATE ON public.creator_bookings
  FOR EACH ROW EXECUTE FUNCTION private.penanda_pengingat_hanya_maju();

DROP TRIGGER IF EXISTS briefs_penanda_maju ON public.briefs;
CREATE TRIGGER briefs_penanda_maju
  BEFORE UPDATE ON public.briefs
  FOR EACH ROW EXECUTE FUNCTION private.penanda_pengingat_hanya_maju();

-- ---------------------------------------------------------------------------
-- 3. Job-nya.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kol_reminder_tick(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today    date    := wib_date(p_now);
  v_h1       integer := 0;
  v_late     integer := 0;
  v_campaign integer := 0;
  r          record;
  v_am       varchar(64);
BEGIN
  -- (a) H-1: jatuh tempo Brief induk BESOK, Booking belum terminal.
  FOR r IN
    SELECT bk.id, bk.brief_id, bk.assigned_coordinator
      FROM creator_bookings bk
      JOIN briefs b ON b.id = bk.brief_id
     WHERE bk.pengingat_h1_terkirim = false
       AND bk.status NOT IN ('[QC Passed]', '[Dropped]')
       AND b.due_date = v_today + 1
  LOOP
    v_am := private.brief_owner_am(r.brief_id);
    PERFORM notify_emit('m9.booking.jatuh_tempo', 'creator_booking', r.id, 'SISTEM',
                        '/kol/bookings/' || r.id, 'KOL',
                        ARRAY(SELECT x FROM unnest(ARRAY[r.assigned_coordinator, v_am]) AS x
                               WHERE x IS NOT NULL AND x <> ''), false);
    UPDATE creator_bookings SET pengingat_h1_terkirim = true WHERE id = r.id;
    v_h1 := v_h1 + 1;
  END LOOP;

  -- (b) LEWAT TENGGAT: jatuh tempo Brief induk sudah lewat, Booking belum terminal.
  FOR r IN
    SELECT bk.id, bk.brief_id, bk.assigned_coordinator
      FROM creator_bookings bk
      JOIN briefs b ON b.id = bk.brief_id
     WHERE bk.jatuh_tempo_terkirim = false
       AND bk.status NOT IN ('[QC Passed]', '[Dropped]')
       AND b.due_date < v_today
  LOOP
    v_am := private.brief_owner_am(r.brief_id);
    PERFORM notify_emit('m9.booking.jatuh_tempo', 'creator_booking', r.id, 'SISTEM',
                        '/kol/bookings/' || r.id, 'KOL',
                        ARRAY(SELECT x FROM unnest(ARRAY[r.assigned_coordinator, v_am]) AS x
                               WHERE x IS NOT NULL AND x <> ''), false);
    UPDATE creator_bookings SET jatuh_tempo_terkirim = true WHERE id = r.id;
    v_late := v_late + 1;
  END LOOP;

  -- (c) CAMPAIGN MENDEKATI AKHIR: `tanggal_akhir` dalam 7 hari (termasuk hari
  --     ini dan yang sudah lewat), Brief KOL belum [Approved].
  FOR r IN
    SELECT b.id, b.assigned_division
      FROM briefs b
     WHERE b.campaign_akhir_terkirim = false
       AND b.assigned_division = 'KOL'
       AND b.status <> '[Approved]'
       AND b.tanggal_akhir IS NOT NULL
       AND b.tanggal_akhir <= v_today + 7
  LOOP
    v_am := private.brief_owner_am(r.id);
    PERFORM notify_emit('m9.campaign.mendekati_akhir', 'brief', r.id, 'SISTEM',
                        '/kol/briefs/' || r.id, 'KOL',
                        ARRAY(SELECT x FROM unnest(ARRAY[v_am]) AS x
                               WHERE x IS NOT NULL AND x <> ''), false);
    UPDATE briefs SET campaign_akhir_terkirim = true WHERE id = r.id;
    v_campaign := v_campaign + 1;
  END LOOP;

  RETURN jsonb_build_object('h1', v_h1, 'jatuh_tempo', v_late, 'campaign_akhir', v_campaign);
END;
$$;

COMMENT ON FUNCTION public.kol_reminder_tick(timestamptz) IS
  'B-3 — job harian KOL: (a) H-1 & (b) lewat tenggat Booking => m9.booking.jatuh_tempo '
  'ke koordinator + AM pemilik + lead KOL; (c) tanggal_akhir dalam 7 hari => '
  'm9.campaign.mendekati_akhir. Idempoten lewat tiga kolom penanda. Nol event baru '
  '(katalog v15 sudah mendaftarkannya di F-3).';

-- `FROM PUBLIC` SAJA TIDAK CUKUP di Supabase: `anon` dan `authenticated` adalah
-- role bernama yang mewarisi grant-nya sendiri, jadi keduanya harus disebut
-- eksplisit. Invariant `rls_checks.sql` §"SECURITY DEFINER dapat dieksekusi
-- anon" menangkap kelalaian ini — dan memang menangkapnya saat migrasi ini
-- pertama kali di-apply. Sebuah fungsi SECURITY DEFINER yang bisa dipanggil anon
-- adalah jalur tulis tanpa autentikasi.
REVOKE EXECUTE ON FUNCTION public.kol_reminder_tick(timestamptz) FROM public, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.kol_reminder_tick(timestamptz) TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Jadwal pg_cron (dibungkus guard — absen di Postgres polos CI).
--    07:00 WIB = 00:00 UTC: pengingat tenggat berguna di AWAL hari kerja.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('kol_reminder_tick', '0 0 * * *',
                          $job$ SELECT public.kol_reminder_tick(now()); $job$);
  END IF;
END;
$cron$;
