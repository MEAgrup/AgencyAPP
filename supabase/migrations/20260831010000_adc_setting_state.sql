-- CDPS M16 §4.2 (Ads) — LT-40: state `[Setting]` BARU pada mesin `ad_campaign`
-- (STATE_MACHINES §14), sebagai state awal SEBELUM `Running`/`[Active]`.
--
-- Pemetaan label Ads -> state ADC- (keputusan pemilik 2026-08-28, `DECISIONS.md`
-- baris "keputusan per divisi"):
--   Setting -> [Setting]  (BARU, state awal)
--   Running -> [Active]
--   Hold    -> [Paused]
--   End     -> [Ended]
--
-- `ADC-` tetap SATU-satunya pemilik kebenaran "iklan jalan/hold/stop" — tidak
-- ada status kedua di Brief untuk ini. Sebelum modul ini, Ad Campaign lahir
-- `[Paused]` ("born held", M8 §2/§4 Rule 4: dibuat sementara Brief setup masih
-- `[In Progress]`, belum ada spend nyata). `[Setting]` menggantikan `[Paused]`
-- sebagai birth status supaya "belum jalan" (Setting) bisa dibedakan dari
-- "pernah jalan lalu dihentikan sementara" (Hold/`[Paused]`) — dua fakta yang
-- sebelumnya berbagi satu status.
--
-- Edge baru:
--   [Setting] -> [Active]   Launch. GATE SAMA dengan `[Paused]->[Active]` yang
--                           sudah ada (kode, bukan mesin): Brief setup [Approved]
--                           + seluruh Asset tertaut [Approved] (`ads.ts` §12).
--   [Setting] -> [Ended]    Batalkan sebelum pernah jalan — mencerminkan
--                           preseden `[Paused]->[Ended]` yang sudah ada ("A held
--                           campaign may be ended without ever launching").
-- `[Paused]<->[Active]` dan `->[Ended]` TIDAK berubah.
--
-- Data existing (kalau migrasi ini pernah jalan di DB berisi data): baris
-- `[Paused]` yang SUDAH ADA sengaja TIDAK di-backfill ke `[Setting]` — keduanya
-- sekarang punya arti berbeda (Setting = belum pernah Launch, Paused = pernah
-- Active lalu di-Hold) dan membedakan keduanya dari data lama tidak bisa
-- dilakukan aman tanpa riwayat transisi. `ads.ts createCampaign` menulis
-- `[Setting]` eksplisit untuk baris BARU (bukan bergantung pada DEFAULT kolom),
-- jadi ALTER DEFAULT di bawah murni dokumentasi/parity, tidak mengubah baris
-- yang sudah ada.

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('ad_campaign', '[Setting]', '[Active]', false),
    ('ad_campaign', '[Setting]', '[Ended]',  false);

UPDATE sm_machines SET initial_state = '[Setting]' WHERE name = 'ad_campaign';

ALTER TABLE ad_campaigns ALTER COLUMN status SET DEFAULT '[Setting]';

COMMENT ON COLUMN ad_campaigns.status IS
  'Mesin ad_campaign (STATE_MACHINES §14): [Setting] (lahir, M16 LT-40) -> [Active] (Running) <-> [Paused] (Hold) -> [Ended]. [Setting]->[Ended] juga sah (batal sebelum pernah jalan).';
