-- MSL-HARGA-0-AI-OPTIMIZER (docs/DECISIONS.md, Open) — dua layanan katalog
-- (`AI Video` MSV-202608-0046, `Optimasi SKU` MSV-202608-0047, ditanam
-- `20260831070000_msl_ai_optimizer_items.sql`) tidak bisa disimpan ulang sama
-- sekali: keduanya `pricing_mode='flat'` + `standard_price=0.00`, sementara
-- gerbang `msl.normalizeInput` menuntut harga > 0 untuk mode `flat` (hanya
-- `passthrough` yang boleh 0). Pemilik memilih opsi (a): kedua layanan ini
-- memang dijual dengan harga yang ditetapkan per-onboarding, bukan harga
-- katalog tetap — pindahkan ke `pricing_mode='passthrough'` (mode itu memang
-- untuk harga yang tidak ditetapkan katalog).
--
-- Pola: `insert ... select` menyalin versi terakhir APA ADANYA (meniru
-- `msl.setActive`, `packages/domain/src/msl.ts:1050-1062` — bukan lewat
-- `updateService`/`ServiceInput`, yang FULL REPLACE dan bisa diam-diam
-- menghapus field yang tidak disebut ulang, persis bahaya yang didokumentasikan
-- di komentar `setActive`). `price_note` diperbarui — teks lama ("placeholder
-- Rp 0 sampai diisi") tidak lagi akurat begitu `passthrough` jadi mode
-- permanen, bukan sekadar menunggu Admin mengisi angka tetap. Nol baris
-- `master_service_duration_options` untuk kedua versi ini (diverifikasi ke
-- live) — nol yang perlu disalin.
--
-- Aktor `'SYSTEM'` — meniru migrasi asal `20260831070000` yang menanam kedua
-- baris ini, bukan `updateService` interaktif (tidak ada Admin yang menekan
-- tombol Simpan, ini koreksi data).
DO $$
DECLARE
    v_service_id text;
    v_latest_id bigint;
    v_latest_version_no int;
    v_next_version_no int;
    v_note text;
BEGIN
    FOREACH v_service_id IN ARRAY ARRAY['MSV-202608-0046', 'MSV-202608-0047']
    LOOP
        SELECT id, version_no INTO v_latest_id, v_latest_version_no
          FROM master_service_versions
         WHERE service_id = v_service_id
         ORDER BY effective_from DESC, version_no DESC
         LIMIT 1;

        -- Idempoten: kalau versi terakhir sudah passthrough (migrasi ini
        -- pernah jalan, atau Admin sudah memperbaikinya lewat UI), lewati.
        IF NOT EXISTS (
            SELECT 1 FROM master_service_versions
             WHERE id = v_latest_id AND pricing_mode = 'passthrough'
        ) THEN
            v_next_version_no := v_latest_version_no + 1;
            v_note := 'Harga ditetapkan per-onboarding (passthrough) — bukan harga katalog tetap, MSL-HARGA-0-AI-OPTIMIZER 2026-09-18.';

            INSERT INTO master_service_versions
                (service_id, name, standard_price, commission_rule, category, unit, min_qty,
                 pricing_mode, apply_ppn, frequency, price_note, description, active,
                 requires_strategy_plan, plan_tier, durasi_bulan, qty_menambah, pengakuan,
                 version_no, effective_from, created_by)
            SELECT service_id, name, standard_price, commission_rule, category, unit, min_qty,
                   'passthrough', apply_ppn, frequency, v_note, description, active,
                   requires_strategy_plan, plan_tier, durasi_bulan, qty_menambah, pengakuan,
                   v_next_version_no, current_date, 'SYSTEM'
              FROM master_service_versions
             WHERE id = v_latest_id;

            INSERT INTO master_service_duration_options (version_id, durasi_bulan, harga, created_by)
            SELECT (SELECT id FROM master_service_versions
                     WHERE service_id = v_service_id AND version_no = v_next_version_no),
                   durasi_bulan, harga, 'SYSTEM'
              FROM master_service_duration_options
             WHERE version_id = v_latest_id;

            INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
            VALUES ('master_service', v_service_id, 'SYSTEM', 'new_version',
                    jsonb_build_object('version_no', v_latest_version_no, 'pricing_mode', 'flat'),
                    jsonb_build_object('version_no', v_next_version_no, 'pricing_mode', 'passthrough'),
                    'SYSTEM');
        END IF;
    END LOOP;
END $$;

-- Gerbang CI — nol perubahan struktural (dua baris versi baru + dua baris
-- audit ke tabel yang sudah ada):
--   public base tables : 183 → 183 (nol tabel baru)
