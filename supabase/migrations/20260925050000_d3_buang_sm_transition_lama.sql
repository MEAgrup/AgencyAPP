-- ===========================================================================
-- D-3 (penutup) — membuang `sm_transition` 10-argumen
-- ===========================================================================
--
-- ⚠️ MIGRASI INI DITERAPKAN **SESUDAH** KODE BARU MENDARAT DI PRODUKSI.
--
-- `20260925010000` sengaja membiarkan versi 10-argumen hidup berdampingan
-- dengan yang 11-argumen, karena tanda tangan baru = fungsi baru: membuang
-- yang lama sebelum kode baru ter-deploy akan membuat SETIAP transisi status
-- di seluruh sistem gagal, bukan cuma tutup buku. Aturan rilis rumah ini:
-- migrasi aditif boleh mendahului kode, migrasi DROP wajib mengikutinya.
--
-- Sesudah kode baru berjalan, tidak ada lagi yang memanggil versi 10-argumen —
-- dua pemanggil SQL-nya (`wrr_monday_job`, `leads_unrespon_tick`) sudah
-- ditulis ulang di `20260925010000`, dan sisanya lewat `packages/db`.
--
-- ── Kenapa dibuang sama sekali, bukan dibiarkan ───────────────────────────
--
-- PL/pgSQL me-resolve nama fungsi saat EKSEKUSI. Selama versi 10-argumen ada,
-- sebuah job SQL yang masih memanggilnya akan "berhasil" — sampai suatu hari
-- ia melewati edge ber-`require_division` dan ditolak dengan pesan yang tidak
-- menyebut sebab sebenarnya, di dalam cron, pada baris yang tidak ada yang
-- lihat. Overload yang hidup berdampingan adalah pintu itu, dan
-- `packages/domain/src/engine.test.ts` menguncinya: "tepat satu overload, 11
-- argumen".
-- ===========================================================================

DROP FUNCTION IF EXISTS sm_transition(
    text, text, text, text, text, text, text, text, boolean, boolean);
