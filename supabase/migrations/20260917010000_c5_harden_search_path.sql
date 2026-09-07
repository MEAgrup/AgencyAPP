-- ===========================================================================
-- C-5 lanjutan — kunci `search_path` fungsi trigger `client_pitch_consents_frozen`.
--
-- KENAPA MIGRASI TERSENDIRI, BUKAN MENYUNTING 184. Migrasi
-- `20260916010000_c5_izin_pitch_klien.sql` SUDAH dijalankan di proyek live
-- (2026-09-07). Menyunting berkas yang sudah di-apply berarti berkas repo dan
-- keadaan live berhenti menggambarkan hal yang sama — persis kelas drift yang
-- O38 lahir darinya dan yang O65 masih tangani sampai hari ini. `CREATE OR
-- REPLACE` di migrasi baru menghasilkan keadaan akhir yang IDENTIK di kedua
-- tempat, dan riwayatnya jujur menunjukkan kapan pengerasannya menyusul.
--
-- KENAPA DIKERASKAN. Supabase database-linter menandai
-- `function_search_path_mutable` untuk fungsi ini, dan repo sudah menetapkan
-- konvensinya sejak SH-01 (`20260909010000`) lalu Gelombang 4
-- (`20260910010000`): setiap fungsi trigger baru ditulis
-- `LANGUAGE plpgsql SET search_path = public`. 184 melewatkannya — ini
-- menyelaraskannya, bukan menemukan aturan baru.
--
-- Bahaya nyatanya kecil (badan fungsi hanya `RAISE EXCEPTION`, nol rujukan ke
-- objek apa pun, jadi tak ada yang bisa dibajak lewat search_path). Yang
-- diperbaiki adalah dua hal lain: satu peringatan permanen di dashboard
-- keamanan pemilik, dan sebuah pengecualian diam-diam terhadap konvensi yang
-- akan disalin oleh migrasi berikutnya yang memakai berkas ini sebagai contoh.
--
-- NOL perubahan perilaku: badan fungsi, nama trigger, dan tabelnya tak
-- tersentuh. Tabel tetap 146, prefix 40, mesin 31, event 69.
-- ===========================================================================

CREATE OR REPLACE FUNCTION client_pitch_consents_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'client_pitch_consents: riwayat izin immutable (aturan rumah #3) — mencabut izin = INSERT baris aksi=cabut, bukan mengubah baris lama';
END $$;
