-- ============================================================================
-- O73 — QA Sales: Qualified Lead Form menolak 56 dari 96 versi katalog
--
-- LAPORAN. Tim sales mengisi Qualified Lead Form, memilih jasa (mis. "Massive
-- Video Affiliate Basic"), lalu form menolak submit dengan pesan Inggris mentah:
--
--     module0_sales: unrecognized commission_rule: "0"
--
-- SEBAB. Grammar `commission_rule` (DECISIONS O14) hanya mengenal dua bentuk:
--
--     "<N>% of standard price"      persen dari nilai deal baris itu
--     "flat Rp <N>"                 nominal tetap (titik = pemisah ribuan)
--
-- Jalur SEED (`apps/api/scripts/mslseed/validate.ts`) sudah menjaga grammar itu.
-- Jalur ADMIN (`msl.normalizeInput` → form Master Service List) TIDAK: ia hanya
-- menuntut string tidak kosong. Maka 56 versi tersimpan dengan aturan yang tidak
-- bisa dibaca kalkulator, dan biayanya jatuh ke orang yang salah — baris lolos
-- disimpan admin, lalu meledak di depan sales yang formnya sudah benar.
--
-- Isi 56 baris itu, apa adanya:
--
--   44 baris  "0"
--             Angka nol telanjang. Maksudnya jelas dan tidak ambigu: jasa ini
--             tidak menghasilkan komisi dari standard price-nya. Bentuk kanonik
--             untuk maksud yang SAMA sudah dipakai 37 baris lain di katalog ini:
--             "0% of standard price". Normalisasi ke sana lossless — dua-duanya
--             menghitung Rp. 0,00. Tidak ada rupiah yang dikarang.
--
--   12 baris  prosa Bahasa Indonesia, tiga rumus:
--             - "komisi berdasarkan spend budget perhitungan dari omzet iklan"
--             - "komisi dari kenaikan omzet 50 juta keatas dari rata rata omzet
--                6 bulan terakhir sebelum di kelola mea"
--             - "1%-2% dari all omzet bisnis tiktok"
--             Ketiganya aturan bisnis SUNGGUHAN, dan ketiganya menghitung komisi
--             dari basis DI LUAR nilai deal (spend iklan, kenaikan omzet, omzet
--             TikTok) — tidak satu pun bisa diturunkan dari standard price. Jadi
--             kontribusi baris itu ke kalkulator memang nol, dan menuliskannya
--             sebagai persen apa pun berarti mengarang uang (CLAUDE.md #4).
--
--             Polanya sudah diputuskan: DECISIONS 2026-08-06 menaruh layanan
--             "Komisi" (`pricing_mode = 'passthrough'`, `commission_rule =
--             'flat Rp 0'`) justru untuk kasus "komisinya nominal bebas, diketik
--             sales per-deal". 12 baris ini mengikuti pola yang sama:
--             `commission_rule = 'flat Rp 0'` (kalkulator menyumbang Rp. 0,00),
--             dan PROSANYA DIPINDAH UTUH ke `price_note` supaya sales tetap
--             membacanya di katalog — teks bisnisnya tidak hilang, hanya pindah
--             dari kolom yang dibaca mesin ke kolom yang dibaca manusia. Komisi
--             riilnya ditagih lewat baris "Komisi" passthrough seperti biasa.
--             Ke-12 baris itu `price_note`-nya NULL semua, jadi tidak ada
--             catatan lama yang tertimpa; kalau toh ada, prosanya DITAMBAHKAN di
--             belakang catatan yang sudah ada, tidak menimpa dan tidak dilewati.
--
-- PENJAGA. Backfill saja mengulang masalahnya bulan depan. Karena itu grammar
-- ditegakkan di DB, bukan cuma di TS (CLAUDE.md §Stack): CHECK constraint di
-- `master_service_versions` menutup SEMUA penulis — form admin, skrip seed,
-- psql, siapa pun. Sisi TS-nya (`msl.normalizeInput` sekarang memanggil
-- `parseCommissionRule`) tetap ada supaya pelanggaran muncul sebagai pesan BI
-- `[...]` di field, bukan sebagai constraint violation.
--
-- CATATAN VERSI. `master_service_versions` append-only untuk EDIT PRODUK: setiap
-- perubahan harga/nama jadi versi baru supaya snapshot Qualified/Closing lama
-- tetap reproducible. Migrasi ini bukan edit produk — ia perbaikan data rusak
-- yang tidak pernah bisa dipakai (tidak ada satu pun `qualified_form_services`,
-- `negotiation_proposal_lines`, atau `services` yang menunjuk aturan cacat ini;
-- form menolaknya, jadi tidak ada snapshot yang berubah artinya). Menambah versi
-- baru justru akan meninggalkan versi rusak sebagai versi efektif di tanggal
-- lampau, dan bug-nya tetap hidup untuk setiap pembacaan `effectiveAt` historis.
--
-- Dicatat di docs/DECISIONS.md (O73).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Backfill: "0" → "0% of standard price" (lossless, dua-duanya Rp. 0,00)
-- ---------------------------------------------------------------------------
update public.master_service_versions
set commission_rule = '0% of standard price'
where btrim(commission_rule) = '0';

-- ---------------------------------------------------------------------------
-- 2. Backfill: aturan prosa → 'flat Rp 0', prosanya diselamatkan ke price_note
--
--    Urutannya penting: price_note diisi DULU dari commission_rule, baru
--    commission_rule ditimpa. Satu statement, jadi tidak ada jendela di mana
--    prosanya sudah hilang tapi catatannya belum ada.
-- ---------------------------------------------------------------------------
update public.master_service_versions
set price_note = case
      when coalesce(btrim(price_note), '') = ''
        then 'Komisi: ' || btrim(commission_rule)
      -- APPEND, jangan lewati: kalau baris kebetulan sudah punya catatan harga,
      -- melewatinya berarti prosa komisinya HILANG diam-diam. Di CDPS SG ke-12
      -- baris ini price_note-nya NULL semua, jadi cabang ini tidak terpakai hari
      -- ini — ia ada supaya migrasi ini tetap benar di database lain (staging,
      -- rebuild lokal) yang isinya tidak persis sama.
      else btrim(price_note) || ' · Komisi: ' || btrim(commission_rule)
    end,
    commission_rule = 'flat Rp 0'
where btrim(commission_rule) !~ '^[0-9]+(\.[0-9]+)?% of standard price$'
  and btrim(commission_rule) !~ '^flat Rp ([0-9]+|[0-9]{1,3}(\.[0-9]{3})+)$';

-- ---------------------------------------------------------------------------
-- 3. Penjaga permanen: grammar O14 sebagai CHECK
--
--    Dua bentuk yang sah, persis seperti regex di
--    `packages/domain/src/commission_rule.ts` — kalau keduanya pernah
--    menyimpang, baris ditolak DB dan tesnya (`msl.test.ts`) merah. Sengaja
--    tidak dipasang di tabel snapshot (`services`, `qualified_form_services`,
--    `negotiation_proposal_lines`, `renewal_proposal_lines`): semuanya bersih,
--    dan penulisnya sudah lewat `resolveProposalLine` yang memanggil
--    `parseCommissionRule`. Menambahkannya di sana urusan terpisah, bukan bagian
--    dari perbaikan ini.
-- ---------------------------------------------------------------------------
alter table public.master_service_versions
  drop constraint if exists ck_msv_commission_rule_grammar;

alter table public.master_service_versions
  add constraint ck_msv_commission_rule_grammar
  check (
    commission_rule ~ '^[0-9]+(\.[0-9]+)?% of standard price$'
    or commission_rule ~ '^flat Rp ([0-9]+|[0-9]{1,3}(\.[0-9]{3})+)$'
  );

comment on constraint ck_msv_commission_rule_grammar on public.master_service_versions is
  'O73: grammar commission_rule (DECISIONS O14) — "<N>% of standard price" atau "flat Rp <N>". Cermin dari packages/domain/src/commission_rule.ts; jangan biarkan menyimpang.';
