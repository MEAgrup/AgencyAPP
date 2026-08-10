-- ===========================================================================
-- M6B B-08 — carry-over eksplisit (Rule 16 / PF-5)
-- ===========================================================================
-- Rule 16: "Carry-over is explicit." Baris yang berakhir `Sebagian` /
-- `Tidak Dikerjakan` di periode yang ditutup MEMINTA keputusan per baris:
-- dibawa ke periode berikutnya, dibatalkan, atau naik jadi revisi Strategi.
-- Pilihannya DICATAT (Rule 19), dan baris yang dibawa muncul di periode
-- berikutnya ditandai `Terbawa` + periode asalnya.
--
-- MEKANISME "dibawa" SUDAH PUNYA RUMAH (B-01): `plan_row.terbawa` (bool) +
-- `plan_row.periode_asal_id` menandai baris TUJUAN — baris baru yang lahir di
-- periode berikutnya. Yang belum punya rumah adalah KEPUTUSANNYA di baris ASAL:
-- `terbawa`/`periode_asal_id` hanya menceritakan sisi tujuan dari satu dari tiga
-- pilihan ("dibawa"); ia diam tentang "dibatalkan"/"revisi" dan tentang baris
-- asal MANA yang sudah diputuskan. Menjejak keputusan itu lewat `audit_log`
-- saja bisa, tapi setiap baca "baris mana yang masih menunggu keputusan" jadi
-- join ke audit, dan penjaga anti-keputusan-ganda jadi cek audit — sedangkan
-- B-04 sudah menetapkan preseden: keputusan yang menggerbangi perilaku ke depan
-- (di sana `status_persetujuan`) hidup sebagai KOLOM, dengan `audit_log` memikul
-- jejak immutable-nya. Carry-over sama persis: keputusan "dibawa" melahirkan
-- baris tujuan, "dibatalkan"/"revisi" menutup baris tanpa membawa apa pun, dan
-- sebuah baris hanya boleh diputuskan sekali.
--
-- Maka: SATU kolom di baris ASAL, `keputusan_carryover`. Ia BUKAN duplikat
-- `terbawa` — `terbawa` menandai baris TUJUAN (baris yang dibawa MASUK ke
-- periode ini), `keputusan_carryover` menandai disposisi baris ASAL (apa yang AM
-- putuskan atas baris tak-selesai ini saat periodenya ditutup). Nol tabel baru
-- (gerbang tabel tetap 89); satu kolom + satu CHECK.
--
-- CATATAN — komponen §263 "Σ negative variance where chosen to carry" pada
-- `defisit_terbawa` TIDAK dibangun di migrasi/ticket ini. `defisit_terbawa`
-- adalah nilai DIHITUNG (bukan kolom), dan komponen varians-nya tidak cukup
-- dispesifikasi PRD: contoh Alpha Digital tidak pernah membawa varians periode
-- ke deficit, PA-7 memperingatkan double-count, dan tidak ada field PRD yang
-- merekam "chosen to carry" untuk UANG (PF-5 membawa BARIS KERJA, bukan rupiah).
-- Dibuka sebagai pertanyaan pemilik di DECISIONS 2026-08-10 (X-18); deficit tetap
-- = Σ penyesuaian turun (B-04) sampai diputuskan. Karena ia dihitung, menambah
-- komponennya nanti nol-migrasi.

ALTER TABLE plan_row
    ADD COLUMN keputusan_carryover varchar(16) NULL;

COMMENT ON COLUMN plan_row.keputusan_carryover IS
  'M6B PF-5 (Rule 16) — disposisi carry-over baris ASAL yang berakhir Sebagian/'
  'Tidak Dikerjakan: dibawa / dibatalkan / revisi. NULL = belum diputuskan. '
  'Beda dari terbawa (yang menandai baris TUJUAN di periode berikutnya).';

-- Kosakata tertutup PF-5. NULL diizinkan (belum diputuskan / baris yang tak
-- pernah butuh keputusan karena bukan Sebagian/Tidak Dikerjakan).
ALTER TABLE plan_row
    ADD CONSTRAINT ck_plan_row_keputusan_carryover CHECK (
        keputusan_carryover IS NULL
        OR keputusan_carryover IN ('dibawa', 'dibatalkan', 'revisi'));
