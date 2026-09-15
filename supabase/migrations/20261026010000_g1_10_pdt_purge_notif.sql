-- CDPS — PDT G1-10: job purge harian (Flow E, Rule 45-49). Katalog v18.
--
-- Nol tabel/kolom baru — `pdt_upload_batch` (migrasi G1-01) sudah punya
-- seluruh kolom yang job ini butuh (`retensi_sampai`, `legal_hold`,
-- `raw_dihapus_pada`, `raw_path`, `raw_bytes`). Cakupan sesi ini: HANYA
-- menutup Rule 48 (pagar 5%/hari + notifikasi Director saat terlampaui) —
-- lihat `packages/domain/src/pdt.ts` `planPdtPurgeTick`/`finalizePdtPurgeTick`
-- dan `apps/api/.../internal/pdt/purge/tick/route.ts`. DUA hal dari Rule
-- 45/49 SENGAJA belum dibangun sesi ini (dicatat `docs/DECISIONS.md`):
--   (a) recompute perpanjangan retensi penuh — dua dari empat pemicunya
--       (laporan terkirim → `pdt_laporan_kiriman`, katalog PX →
--       `px_sku_volume`) menunjuk tabel yang belum ada (G2-01/G5 belum
--       dibangun);
--   (b) pass kedua Flow E (objek yatim > 7 hari) — butuh listing bucket
--       rekursif, pembungkusnya belum ada di `pdt-storage.ts`.
--
-- ---------------------------------------------------------------------------
-- SATU EVENT, DAN KE SIAPA
-- ---------------------------------------------------------------------------
--   pdt.purge.guard_exceeded   Pagar 5%/hari (Rule 48) terlampaui — job
--       berhenti, NOL objek dihapus tick itu. Ke Directors (peran berlapis,
--       resolver `explicit` — sama pola `m5.transaction.change_requested`).
--
-- Gate hitung notif_events 75 → 76 dinaikkan di .github/workflows/ci.yml +
-- scripts/db-rebuild.sh bersama migrasi ini (satu commit). Nol mesin/tabel/
-- prefix baru ⇒ gate lain TETAP. Invariant O55 (SUM(event_count) =
-- COUNT(notif_events)) tetap dijaga — JANGAN hardcode 76 di tempat lain.

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (18,
     'PDT G1-10 (job purge harian) — 1 event: pdt.purge.guard_exceeded (pagar 5%/hari, Rule 48, terlampaui → Directors, nol objek dihapus tick itu).',
     1,
     'docs/DECISIONS.md 2026-09-15 (G1-10 purge harian)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('pdt.purge.guard_exceeded',
     'Pagar 5%/hari purge PDT terlampaui — nol objek dihapus, ke Directors',
     'explicit',
     18);
