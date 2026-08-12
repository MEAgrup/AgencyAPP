-- CDPS — Modul Interview: izinkan MULAI interview tanpa jadwal terpaku (QA
-- pemilik 2026-08-12).
--
-- ---------------------------------------------------------------------------
-- KENAPA
-- ---------------------------------------------------------------------------
-- Jadwal klien sering berubah tak terduga, jadi memaksa alur "kunci jadwal
-- (→ Terjadwal) DULU, baru boleh Sedang Berlangsung" menahan AM yang klien-nya
-- tiba-tiba siap. Mesin `interview` (mesin #19) hanya punya
-- 'Terjadwal' → 'Sedang Berlangsung' (20260811030000). Dua edge baru membuka
-- "mulai sekarang" dari kedua state pra-interview lain — TANPA menyentuh jalur
-- jadwal, tanpa mengubah gate/urutan lain.
--
--   'Belum Dijadwalkan'  → 'Sedang Berlangsung'   (mulai tanpa pernah menjadwalkan)
--   'Dijadwalkan Ulang'  → 'Sedang Berlangsung'   (klien siap saat jadwal ulang menggantung)
--
-- require_lead = false: sama seperti 'Terjadwal' → 'Sedang Berlangsung' yang
-- sudah ada — memulai interview adalah aksi AM biasa, bukan aksi reviewer.
--
-- Nol tabel/mesin/event/prefix baru — gate 104/19/44/32 tak berubah. `sm_edges`
-- tidak dihitung gate. sm_transition tetap satu-satunya penulis kolom status;
-- ini hanya menambah dua edge sah ke tabel yang ia baca.

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('interview', 'Belum Dijadwalkan', 'Sedang Berlangsung', false),
    ('interview', 'Dijadwalkan Ulang', 'Sedang Berlangsung', false);
