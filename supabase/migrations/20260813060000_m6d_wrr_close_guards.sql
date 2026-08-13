-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-05: NARASI WAJIB SAAT TUTUP +
-- WRR_CATATAN_DIVISI APPEND-ONLY.
--
-- Dua penegakan DB, keduanya milik D-05 (backlog M6D_BACKLOG.md):
--
--   1. **Narasi wajib saat tutup (RM-D · Rule 8).** Menutup rekap
--      (`Terbuka → Ditutup`, edge AM/CRO) mensyaratkan narasi RM-D terisi:
--      RM-D1 «Yang Bergerak» + RM-D3 «Fokus Minggu Depan» WAJIB; RM-D2 «Yang
--      Tertahan» wajib BILA ADA blocker minggu ini (Brief `[Blocked]`, terbaca
--      dari `wrr_divisi.rincian.brief.blocked`). Ditegakkan BEFORE UPDATE di DB
--      (bukan hanya TS) — CLAUDE.md "penegakan aturan ada di DB". Force-close
--      (`Terbuka → Ditutup Otomatis`, D-06) SENGAJA tak lewat gerbang ini: Rule 8
--      "force-close on overrun sets an incomplete flag" — sistem menutup paksa
--      justru KARENA narasi tak lengkap, lalu menandainya, bukan memblokirnya.
--      Buka-kembali (`Ditutup Otomatis → Terbuka`) juga tak kena (NEW.status ≠
--      Ditutup).
--
--   2. **`wrr_catatan_divisi` append-only (RM-D6 · Rule 10).** Thread catatan
--      divisi immutable: tiap divisi berutang satu catatan mingguan, "read-only
--      untuk AM, tak bisa dihapus". BEFORE UPDATE/DELETE → `forbid_mutation()`
--      (pola sama `audit_log`), jadi tak ada jalur UPDATE/DELETE dari SIAPA pun
--      (termasuk service-role BYPASSRLS). INSERT tetap terbuka (jalur tulis divisi
--      = D-09). D-01 sudah membangun tabelnya tanpa `updated_at` (append-only by
--      shape); guard ini menutupnya.
--
-- ---------------------------------------------------------------------------
-- YANG TIDAK di sini (hindari duplikasi / salah-scope)
-- ---------------------------------------------------------------------------
--   * **Sengketa Angka → notif SPV (Rule 7).** Perekaman sengketa sudah TERBUKA
--     di D-03 (`wrr_metrik.sengketa` / `wrr_divisi.sengketa` boleh digerakkan AM
--     pemilik), dan dua jaminan Rule 7 — "tak memblok tutup" & "tak mengubah angka
--     auto" — sudah dipegang invariant auto-block D-03 (gerbang narasi ini pun tak
--     membaca `sengketa`, jadi sengketa terisi tak menghalangi tutup). Yang belum:
--     EMISI notifikasi ke SPV — butuh event di katalog, dan katalog M6D (v7=48,
--     +4 event) adalah **D-07** (`notify_emit` menuntut event terdaftar). Jadi
--     emisi sengketa mendarat bersama katalog D-07, bukan di-fabrikasi di sini.
--   * **Kelengkapan metrik saat tutup** ("setiap metrik hasil isi atau `—`",
--     Rule 8) — DIPINDAH ke operasi close domain **D-09** (bukan D-05, mengoreksi
--     catatan-maju migrasi D-04): gerbang DB tak bisa tahu apakah agregasi (D-06)
--     sudah jalan, sedang "validasi field wajib = tanggung jawab route handler"
--     (kontrak `sm_transition`). D-09 memvalidasi kelengkapan metrik + narasi di
--     domain (belt) di atas gerbang narasi DB ini (braces). Dicatat: DECISIONS
--     2026-08-13.
--
-- Nol tabel/mesin/prefix/event baru → gate 112/33/21/44 tetap. Migrasi lewat
-- supabase/migrations/** + apply_migration — JANGAN `psql -f` (O38). DB lokal
-- rebuild HANYA lewat scripts/db-rebuild.sh.

-- ===========================================================================
-- 1. Narasi wajib saat tutup — BEFORE UPDATE, hanya pada edge AM `Terbuka →
--    Ditutup`. Membaca wrr_catatan (RM-D) + wrr_divisi (deteksi blocker RM-D2).
-- ===========================================================================
CREATE OR REPLACE FUNCTION guard_wrr_narasi_saat_tutup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bergerak    text;
  v_tertahan    text;
  v_fokus       text;
  v_ada_blocker boolean;
BEGIN
  -- Hanya penutupan AM (Terbuka → Ditutup). Force-close (→ Ditutup Otomatis),
  -- buka-kembali (→ Terbuka), dan UPDATE non-status apa pun tidak kena gerbang.
  IF NOT (OLD.status = 'Terbuka' AND NEW.status = 'Ditutup') THEN
    RETURN NEW;
  END IF;

  SELECT yang_bergerak, yang_tertahan, fokus_minggu_depan
    INTO v_bergerak, v_tertahan, v_fokus
    FROM wrr_catatan WHERE recap_id = NEW.id;

  -- RM-D1 + RM-D3 wajib (Rule 8). Baris wrr_catatan absen ⇒ ketiganya NULL ⇒ blok.
  IF v_bergerak IS NULL OR btrim(v_bergerak) = ''
     OR v_fokus IS NULL OR btrim(v_fokus) = '' THEN
    RAISE EXCEPTION '[narasi mingguan wajib: isi «Yang Bergerak» dan «Fokus Minggu Depan» sebelum menutup rekap]';
  END IF;

  -- RM-D2 wajib BILA ADA blocker minggu ini (Brief [Blocked] terbaca dari
  -- rincian agregasi per divisi). Tak ada baris divisi / nol blocker ⇒ opsional.
  SELECT EXISTS (
    SELECT 1 FROM wrr_divisi d
     WHERE d.recap_id = NEW.id
       AND coalesce((d.rincian -> 'brief' ->> 'blocked')::int, 0) > 0
  ) INTO v_ada_blocker;

  IF v_ada_blocker AND (v_tertahan IS NULL OR btrim(v_tertahan) = '') THEN
    RAISE EXCEPTION '[«Yang Tertahan» wajib diisi karena ada Brief tertahan minggu ini]';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wrr_narasi_saat_tutup BEFORE UPDATE ON weekly_result_recap
    FOR EACH ROW EXECUTE FUNCTION guard_wrr_narasi_saat_tutup();

COMMENT ON FUNCTION guard_wrr_narasi_saat_tutup() IS
  'M6D RM-D / Rule 8 — memblok Terbuka→Ditutup (penutupan AM) bila narasi RM-D '
  'belum lengkap: RM-D1 «Yang Bergerak» + RM-D3 «Fokus Minggu Depan» wajib, '
  'RM-D2 «Yang Tertahan» wajib bila ada Brief [Blocked] minggu ini. Force-close '
  '(→ Ditutup Otomatis) & buka-kembali (→ Terbuka) sengaja tak kena. Kelengkapan '
  'metrik saat tutup = domain close D-09. Emisi notif sengketa = katalog D-07.';

-- ===========================================================================
-- 2. `wrr_catatan_divisi` append-only (RM-D6 / Rule 10) — no UPDATE/DELETE dari
--    SIAPA pun (termasuk service-role). Pola sama audit_log; INSERT tetap terbuka
--    (jalur tulis divisi = D-09).
-- ===========================================================================
CREATE TRIGGER wrr_catatan_divisi_no_update BEFORE UPDATE ON wrr_catatan_divisi
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER wrr_catatan_divisi_no_delete BEFORE DELETE ON wrr_catatan_divisi
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
