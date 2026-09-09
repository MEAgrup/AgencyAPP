-- ============================================================================
-- FS-6 (Feedback tim Sales 2026-09-08 #6) — SATU layanan, BANYAK pilihan durasi.
--
-- KELUHANNYA. "Bagian master service list. Buat supaya 1 service ada pilihan
-- durasi, 1 bulan 3 bulan 6 bulan dstnya (dengan opsi harga berbeda), hal ini
-- supaya efektif dan membuat list tidak terlalu banyak."
--
-- KENAPA KATALOGNYA MEMBENGKAK HARI INI. Satu versi MSL hanya bisa memegang
-- SATU pasangan `(standard_price, durasi_bulan)`, jadi menambah tenor berarti
-- menambah `master_services` baru. Itu persis yang sudah terjadi: sembilan
-- layanan grup A (`DECISIONS.md` 2026-09-07 Q2) adalah paket 3/6/12 bulan yang
-- dipecah jadi baris terpisah — `Jasa Iklan Traffic Marketplace Basic` punya
-- TIGA baris dengan harga per bulan Rp 3,4jt → 3,2jt → 3,0jt.
--
-- `qty_menambah = 'durasi'` TIDAK bisa menggantikannya: ia mengalikan harga
-- secara LINEAR (qty × harga), jadi diskon tenor — yang justru inti paketnya —
-- tidak bisa dinyatakan sama sekali.
--
-- KETOKAN PEMILIK (FS-4, 2026-09-08): struktur barunya dibangun dan dipakai
-- untuk layanan BARU; sembilan baris lama DIBIARKAN hidup apa adanya. Nol
-- migrasi data di berkas ini — nol risiko terhadap kontrak yang sedang berjalan
-- (setiap `services` mem-pin `master_version_no`-nya sendiri).
--
-- ---------------------------------------------------------------------------
-- ATURAN YANG MENJAGA SELURUH PEMBACA LAMA TETAP BENAR
-- ---------------------------------------------------------------------------
-- Bila sebuah versi punya baris opsi, maka `standard_price` + `durasi_bulan`
-- versi itu WAJIB sama dengan opsi TERPENDEK.
--
-- Tanpa aturan itu, `sales.deriveDuration` (`MAX(durasi_bulan)` saat closing),
-- `ads.computeAdsManagementEndDate`, dan mesin accrual Gelombang D akan membaca
-- versi yang punya tiga harga sebagai satu angka yang tidak mewakili apa pun —
-- dan tak satu pun dari mereka akan melempar galat. Dengan aturan itu, ketiganya
-- terus membaca angka yang SAH (paket terpendek) meski belum tahu soal opsi,
-- dan tidak pernah menemui lubang.
--
-- Ditegakkan TRIGGER, bukan hanya TS: `msl.ts` menyatakan sendiri bahwa route
-- MSL bukan satu-satunya penulis tabel ini (psql, skrip seed, klien masa depan).
-- CONSTRAINT TRIGGER + DEFERRABLE INITIALLY DEFERRED karena baris versi ditulis
-- LEBIH DULU dari baris opsinya di dalam satu transaksi — pemeriksaan yang tidak
-- ditunda akan menolak penulisan yang sah hanya karena urutannya.
--
-- Nol prefix (anak ber-identity, pola `renewal_proposals`), nol mesin, nol event.
-- Tabel public 147 → 148 ⇒ gate di `scripts/db-rebuild.sh` dan `ci.yml` dinaikkan
-- bersama migrasi ini.
-- ============================================================================

CREATE TABLE master_service_duration_options (
    id           bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version_id   bigint        NOT NULL,
    durasi_bulan integer       NOT NULL,
    harga        numeric(15,2) NOT NULL,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    created_by   varchar(64)   NOT NULL,
    CONSTRAINT fk_msdo_version FOREIGN KEY (version_id)
        REFERENCES master_service_versions (id) ON DELETE CASCADE,
    CONSTRAINT uq_msdo UNIQUE (version_id, durasi_bulan),
    CONSTRAINT ck_msdo_durasi CHECK (durasi_bulan > 0),
    CONSTRAINT ck_msdo_harga  CHECK (harga >= 0)
);
CREATE INDEX idx_msdo_version ON master_service_duration_options (version_id);

COMMENT ON TABLE master_service_duration_options IS
  'FS-6: pilihan tenor per VERSI layanan (1/3/6/12 bulan dengan harga berbeda). Opsi TERPENDEK wajib sama dengan standard_price + durasi_bulan versinya — ditegakkan trg_msdo_terpendek.';

-- --- Invarian "opsi terpendek = harga & durasi versinya" ---------------------
CREATE OR REPLACE FUNCTION private.msdo_cek_terpendek(p_version_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_durasi integer;
  v_harga  numeric(15,2);
  v_min_durasi integer;
  v_min_harga  numeric(15,2);
BEGIN
  SELECT durasi_bulan, standard_price INTO v_durasi, v_harga
    FROM public.master_service_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RETURN;  -- versinya sudah hilang (ON DELETE CASCADE) — tidak ada yang dijaga
  END IF;

  SELECT o.durasi_bulan, o.harga INTO v_min_durasi, v_min_harga
    FROM public.master_service_duration_options o
   WHERE o.version_id = p_version_id
   ORDER BY o.durasi_bulan
   LIMIT 1;

  IF v_min_durasi IS NULL THEN
    RETURN;  -- nol opsi: versi berdiri sendiri, aturan lama berlaku apa adanya
  END IF;

  IF v_durasi IS DISTINCT FROM v_min_durasi OR v_harga IS DISTINCT FROM v_min_harga THEN
    RAISE EXCEPTION
      'master_service_versions %: durasi_bulan/standard_price (%/%) harus sama dengan opsi terpendek (%/%)',
      p_version_id, v_durasi, v_harga, v_min_durasi, v_min_harga;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.msdo_cek_terpendek(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.msdo_cek_terpendek(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.trg_msdo_terpendek() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  IF TG_TABLE_NAME = 'master_service_versions' THEN
    PERFORM private.msdo_cek_terpendek(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.msdo_cek_terpendek(OLD.version_id);
  ELSE
    PERFORM private.msdo_cek_terpendek(NEW.version_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_msdo_terpendek
  AFTER INSERT OR UPDATE OR DELETE ON master_service_duration_options
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.trg_msdo_terpendek();

-- Sisi versinya juga: tanpa ini, satu UPDATE atas `master_service_versions`
-- bisa memutus invarian dari arah yang tidak dijaga trigger di atas.
CREATE CONSTRAINT TRIGGER trg_msv_opsi_terpendek
  AFTER INSERT OR UPDATE ON master_service_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.trg_msdo_terpendek();

-- --- RLS: baca terbuka seperti katalog induknya, tulis lewat service-role ----
REVOKE ALL ON public.master_service_duration_options FROM anon;
REVOKE ALL ON public.master_service_duration_options FROM authenticated;
GRANT SELECT ON public.master_service_duration_options TO authenticated;
ALTER TABLE public.master_service_duration_options ENABLE ROW LEVEL SECURITY;
-- Cermin `master_service_versions_select` (20260723064438): seluruh staff perlu
-- membacanya untuk menyusun penawaran, dan tak ada satu pun kolom di sini yang
-- lebih sensitif daripada harga di baris induknya.
CREATE POLICY master_service_duration_options_select
  ON public.master_service_duration_options FOR SELECT TO authenticated USING (true);
