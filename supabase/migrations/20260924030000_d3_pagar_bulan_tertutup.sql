-- ===========================================================================
-- D-3 (3/3) — pagar DB: bulan tertutup menolak tulisan
-- ===========================================================================
--
-- Tanpa migrasi ini, "tertutup" hanya sebuah kata di kolom status. Kunci yang
-- hanya ditegakkan di TypeScript bisa dilewati panggilan service-role langsung
-- — dan aturan rumah CDPS sudah memilih sisi ini sejak awal: "Penegakan aturan
-- ada di DB, bukan cuma di TS" (CLAUDE.md).
--
-- YANG DIJAGA. Fakta uang yang MEMBAWA TANGGALNYA SENDIRI, karena hanya baris
-- semacam itu yang bisa dipindah antar bulan oleh seseorang yang mengetik:
--
--     payment_verifications.received_date   — kapan uang diterima
--     installments.verified_date            — kapan cicilan diverifikasi
--
-- TIGA arah ditolak, bukan satu:
--
--   1. MENULIS ke bulan tertutup      (INSERT / UPDATE yang mendarat di sana)
--   2. MEMINDAHKAN KELUAR dari bulan tertutup (UPDATE yang berangkat dari sana)
--   3. MENGHAPUS baris di bulan tertutup      (DELETE)
--
-- Arah kedua yang paling mudah terlupa dan paling mahal: memindahkan sebuah
-- penerimaan dari Agustus (tertutup) ke September (terbuka) mengubah angka
-- Agustus tanpa pernah menulis satu baris pun BERTANGGAL Agustus.
--
-- YANG TIDAK DIJAGA DI SINI, dan kenapa tidak perlu:
--
--   * `audit_log` — sudah menolak UPDATE dan DELETE sejak 20260722053824.
--     Seluruh tanggal transisi (mulai, selesai, hold, void) hidup di sana,
--     jadi tanggal-tanggal itu memang sudah tidak bisa disunting oleh siapa pun.
--   * Versi katalog MSL yang dipaku layanan — versi tidak pernah diubah, yang
--     ada versi baru; layanan tetap membaca versi yang dipakunya.
--   * Void yang terjadi HARI INI — mesin accrual mengiris per BULAN justru
--     supaya void tidak pernah menjangkau ke belakang (lihat kepala
--     packages/core/src/accrual.ts). Tidak ada yang perlu dijaga karena tidak
--     ada yang bisa berubah.
--
-- Yang TIDAK dijaga dan MEMANG masih lubang disebut jujur di
-- docs/DECISIONS.md 2026-09-08: `services.standard_price`. Lihat catatan di
-- bawah §3.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Trigger generik — satu fungsi untuk semua tabel bertanggal
-- ---------------------------------------------------------------------------
--
-- Nama kolom tanggalnya datang dari TG_ARGV, jadi tabel berikutnya yang punya
-- fakta uang bertanggal cukup memasang trigger — tanpa fungsi baru, tanpa
-- salinan aturan kedua yang akan berbeda begitu keduanya ada.
--
-- Barisnya dibaca lewat to_jsonb(NEW/OLD) alih-alih EXECUTE dinamis: tidak ada
-- SQL yang dirakit dari string, jadi tidak ada permukaan injeksi sama sekali,
-- dan biayanya satu konversi baris per tulisan.
CREATE OR REPLACE FUNCTION jaga_periode_tertutup() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_kolom text := TG_ARGV[0];
    v_baru  date;
    v_lama  date;
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_baru := (to_jsonb(NEW) ->> v_kolom)::date;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_lama := (to_jsonb(OLD) ->> v_kolom)::date;
    END IF;

    -- Arah 2 & 3: baris yang BERANGKAT dari bulan tertutup (dipindah atau
    -- dihapus). Diperiksa lebih dulu karena pesannya yang paling menjelaskan.
    IF v_lama IS NOT NULL AND periode_tertutup(v_lama) THEN
        RAISE EXCEPTION '[buku bulan % sudah ditutup, angkanya tidak bisa diubah — pakai jurnal koreksi di bulan berjalan]',
            bulan_indonesia(v_lama)
            USING ERRCODE = 'check_violation';
    END IF;

    -- Arah 1: baris yang MENDARAT di bulan tertutup.
    IF v_baru IS NOT NULL AND periode_tertutup(v_baru) THEN
        RAISE EXCEPTION '[buku bulan % sudah ditutup, tidak bisa menambah catatan ke dalamnya — pakai jurnal koreksi di bulan berjalan]',
            bulan_indonesia(v_baru)
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION jaga_periode_tertutup() IS
  'D-3 — menolak tulisan yang menyentuh bulan tertutup. Nama kolom tanggal di '
  'TG_ARGV[0]. Menolak TIGA arah: mendarat di bulan tertutup, berangkat dari '
  'bulan tertutup, dan dihapus dari bulan tertutup.';

-- ---------------------------------------------------------------------------
-- 2. Pemasangan
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_payver_periode_tertutup
    BEFORE INSERT OR UPDATE OR DELETE ON payment_verifications
    FOR EACH ROW EXECUTE FUNCTION jaga_periode_tertutup('received_date');

CREATE TRIGGER trg_inst_periode_tertutup
    BEFORE INSERT OR UPDATE OR DELETE ON installments
    FOR EACH ROW EXECUTE FUNCTION jaga_periode_tertutup('verified_date');

-- CATATAN yang sengaja tidak disembunyikan.
--
-- `installments.verified_date` NULLABLE, dan cicilan yang belum diverifikasi
-- bernilai NULL. Trigger MELEWATKAN baris ber-NULL — itu benar, karena cicilan
-- tanpa tanggal verifikasi belum masuk bulan mana pun. Konsekuensinya: sebuah
-- cicilan yang belum diverifikasi tetap bisa disunting bebas meski bulan
-- jatuh temponya sudah ditutup. Itu memang yang diinginkan — uang yang belum
-- masuk bukan angka bulan itu.
--
-- `services.standard_price` TIDAK dijaga trigger ini, dan itu lubang yang
-- nyata: mengubah harga sebuah layanan mengubah pendapatan accrual bulan-bulan
-- yang mungkin sudah ditutup. Ia tidak dijaga di sini karena pagarnya butuh
-- menjalankan mesin accrual DI DALAM trigger untuk tahu bulan mana saja yang
-- terpengaruh — mahal, dan melingkar. Yang benar adalah melarang UPDATE harga
-- pada layanan yang sudah pernah masuk snapshot mana pun. Dicatat sebagai
-- pekerjaan terbuka di docs/DECISIONS.md 2026-09-08, BUKAN diklaim beres.
