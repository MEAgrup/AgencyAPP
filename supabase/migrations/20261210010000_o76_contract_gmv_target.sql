-- CDPS — O76: field GMV kontraktual di closing, dan `sumber_floor` ketiga.
--
-- Keputusan pemilik (docs/DECISIONS.md, AskUserQuestion batch 2026-09-24)
-- ---------------------------------------------------------------------------
-- O76 sendiri menjawab SATU hal: "dari mana floor GMV bulanan datang" — jawaban
-- pemilik "Contractual field at closing", sejalan K-2 (syarat kesepakatan
-- ditetapkan Sales, bukan diketik AM). Itu TIDAK menjawab bagaimana satu angka
-- kontraktual (mis. Rp 400jt/bulan) terhubung ke `strategi_target`, yang
-- baris floornya per (channel, month_index) — bukan satu angka total. Follow-up
-- kedua menjawab itu, pilihan "Kunci penuh dari kontrak (Rekomendasi)":
--   * `contracts` dapat SATU angka floor bulanan (flat, berlaku untuk semua
--     bulan kontrak — bukan kurva ramp per bulan; itu di luar cakupan yang
--     disetujui).
--   * AM tetap memecah angka itu ke channel di form Strategi (`saveTargets`,
--     TS), tapi jumlah pecahan tiap bulan WAJIB sama dengan angka kontrak.
--   * Begitu tersimpan, baris floor 'gmv' bulan itu langsung `sumber_floor =
--     'dari_kontrak'` — read-only SEJAK AWAL, TANPA lewat alur persetujuan
--     Head O57(b) (`input_am` → `disetujui_head`). Sales sudah menguncinya di
--     closing; Head tidak perlu menyetujui ulang apa yang sudah jadi kesepakatan
--     tertulis dengan klien.
--   * Kontrak TANPA angka floor (opsional — tidak semua deal punya komitmen
--     GMV) tetap memakai alur lama input_am → disetujui_head, tidak berubah.
--
-- Kenapa TANPA kolom alasan/override (beda dari K-2 durasi)
-- ---------------------------------------------------------------------------
-- `durasi_bulan` K-2 punya DEFAULT (dari katalog) yang bisa DIOVERRIDE, jadi
-- alasan wajib ada supaya penyimpangan dari default itu punya jejak. Floor GMV
-- kontraktual tidak punya default apa pun untuk disimpang — ia murni input
-- elektif Sales (boleh diisi, boleh dikosongkan). Tidak ada "override" di sini,
-- jadi tidak ada alasan wajib untuk dicatat.
--
-- Kenapa validasi jumlah ada di TS (saveTargets), bukan CHECK
-- ---------------------------------------------------------------------------
-- Aturannya merentang BANYAK baris (semua channel satu bulan harus berjumlah
-- sama dengan satu angka kontrak) — CHECK per-baris Postgres tidak bisa
-- mengekspresikan itu tanpa constraint trigger beragregasi. Presedennya sama
-- dengan `resolveClosingWindow` K-2: validasi money-adjacent lintas-baris hidup
-- di domain (TS), sedang CHECK per-baris (`ck_contracts_durasi`,
-- `ck_strategi_target_floor_source` di bawah) tetap jadi sabuk pengaman DB.

-- ===========================================================================
-- 1. `contracts.target_gmv_bulanan` — opsional, flat per bulan, dikunci Sales.
-- ===========================================================================
ALTER TABLE contracts ADD COLUMN target_gmv_bulanan numeric(18,2) NULL;
ALTER TABLE contracts ADD CONSTRAINT ck_contracts_target_gmv_bulanan
    CHECK (target_gmv_bulanan IS NULL OR target_gmv_bulanan > 0);

COMMENT ON COLUMN contracts.target_gmv_bulanan IS
  'O76 — floor GMV bulanan kontraktual, dikunci Sales saat closing. NULL = deal '
  'ini tidak punya komitmen GMV (sah — bukan setiap deal punya). Kalau terisi, '
  '`strategi_target.sumber_floor` untuk metric gmv menjadi dari_kontrak dan '
  'jumlah floor lintas-channel per bulan WAJIB sama dengan angka ini — '
  'ditegakkan `saveTargets` (packages/domain/src/strategi.ts), bukan CHECK, '
  'karena aturannya lintas-baris.';

-- ===========================================================================
-- 2. `strategi_target.sumber_floor` — nilai ketiga 'dari_kontrak'.
-- ===========================================================================
ALTER TABLE strategi_target DROP CONSTRAINT ck_strategi_target_floor_source;
ALTER TABLE strategi_target ADD CONSTRAINT ck_strategi_target_floor_source CHECK (
    (nilai_floor IS NULL AND sumber_floor IS NULL)
 OR (nilai_floor IS NOT NULL AND sumber_floor IN ('input_am', 'disetujui_head', 'dari_kontrak')));

-- `ck_strategi_target_floor_approval` (O57) tidak berubah: 'dari_kontrak' jatuh
-- ke cabang ELSE-nya sama seperti 'input_am' — floor_disetujui_oleh/pada tetap
-- harus NULL, karena tidak ada persetujuan Head yang terjadi untuk baris ini.

-- Dinding Rule 7 diperluas: baris 'dari_kontrak' beku sejak ditulis, sama
-- seperti baris yang sudah 'disetujui_head' — satu-satunya jalur legal untuk
-- MENGUBAH pecahan channel selama Draft adalah `saveTargets` yang menghapus
-- lalu menulis ulang seluruh matriks (bukan UPDATE baris), jadi memperluas
-- guard ke 'dari_kontrak' tidak mengganggu alur AM yang sah — ia hanya menutup
-- jalur UPDATE mentah (bypass service-role) yang sama seperti 'disetujui_head'.
CREATE OR REPLACE FUNCTION guard_floor_disetujui()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.sumber_floor IN ('disetujui_head', 'dari_kontrak') THEN
        IF NEW.nilai_floor IS DISTINCT FROM OLD.nilai_floor THEN
            RAISE EXCEPTION '[target floor tidak dapat diubah setelah disetujui Head Account]';
        END IF;
        IF NEW.sumber_floor IS DISTINCT FROM OLD.sumber_floor THEN
            RAISE EXCEPTION '[target floor tidak dapat diubah setelah disetujui Head Account]';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON COLUMN strategi_target.sumber_floor IS
  'O57 butir (b) + O76 — JALUR floor: input_am (diketik AM, masih boleh berubah) '
  '→ disetujui_head (beku, persetujuan Head); ATAU dari_kontrak (beku sejak '
  'ditulis — Sales sudah mengunci angkanya di closing lewat '
  'contracts.target_gmv_bulanan, Head tidak perlu menyetujui ulang). Nilai lama '
  '`kontrak` (pra-O57) tetap tidak dipakai — jangan disamakan dengan '
  '`dari_kontrak` yang baru ini, walau namanya mirip: `kontrak` dulu adalah '
  'klaim tanpa Contract entity untuk menopangnya, `dari_kontrak` sekarang '
  'menunjuk baris `contracts.target_gmv_bulanan` yang benar-benar ada.';
