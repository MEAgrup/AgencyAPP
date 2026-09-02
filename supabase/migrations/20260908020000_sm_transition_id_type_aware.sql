-- ===========================================================================
-- sm_transition: sadar tipe kolom id (generalisasi, bukan pelonggaran)
-- ===========================================================================
--
-- TEMUAN. Tanda tangan `sm_transition` mengaku bekerja untuk TRIPLE apa pun —
-- `(p_table, p_id_col, p_status_col)` semuanya parameter. Kenyataannya ia hanya
-- bekerja untuk kolom id bertipe teks, karena predikatnya dibangun sebagai
-- `WHERE %I = $1` dengan `$1` bertipe `text`:
--
--     ERROR: operator does not exist: bigint = text
--
-- Selama ini tak pernah terlihat karena SETIAP entitas CDPS berkunci
-- `PREFIX-YYYYMM-NNNN` (varchar), jadi perbandingannya selalu text=text.
-- `client_report_publikasi` (20260908010000) adalah mesin pertama yang
-- entitasnya berkunci surrogate `bigint` — `client_reports.id` memang bigint
-- identity, bukan ID rumah, karena laporan bukan entitas ber-prefix.
--
-- YANG DIPERBAIKI. Tipe kolom id dibaca dari katalog sekali, lalu parameternya
-- yang di-cast: `WHERE %I = $1::<tipe_kolom>`.
--
-- MENGAPA CAST DI PARAMETER, BUKAN DI KOLOM. `WHERE %I::text = $1` juga
-- menghilangkan error, tapi mengecualikan kolom dari indeksnya — lookup PK
-- berubah jadi seq scan pada tabel yang bisa tumbuh. Cast di parameter tetap
-- sargable: Postgres mengevaluasi `$1::bigint` sekali lalu memakai indeks
-- seperti biasa.
--
-- MENGAPA INI BUKAN "melonggarkan engine demi satu tiket". Nol perilaku yang
-- berubah untuk mesin yang sudah ada: untuk kolom varchar/text, `$1::varchar`
-- adalah cast yang tidak mengubah nilai maupun rencana query. Yang berubah
-- hanya: triple yang SEHARUSNYA sudah didukung sekarang benar-benar didukung.
-- Alternatifnya adalah menambah kolom teks tiruan di tabel publikasi (kunci
-- kedua untuk baris yang sama) atau menegakkan transisi di TS (persis yang
-- CLAUDE.md larang: "jangan reimplementasi engine-nya di TS") — dua-duanya
-- membayar lebih mahal untuk menutupi keterbatasan yang letaknya di sini.
--
-- Yang TIDAK berubah: urutan langkah, row lock `FOR UPDATE`, validasi edge,
-- gerbang `require_lead`, baris audit, dan bentuk jsonb yang dikembalikan.
-- `p_entity_id` tetap `text` (dan `audit_log.entity_id` tetap varchar), jadi
-- kontrak pemanggil tak bergeser sedikit pun.
--
-- Lihat docs/DECISIONS.md 2026-09-08.
-- ===========================================================================
CREATE OR REPLACE FUNCTION sm_transition(
    p_machine           text,
    p_entity_type       text,
    p_table             text,
    p_id_col            text,
    p_status_col        text,
    p_entity_id         text,
    p_to                text,
    p_actor_employee_id text,
    p_role_director     boolean,
    p_role_lead         boolean
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_machine      sm_machines%ROWTYPE;
    v_from         text;
    v_require_lead boolean;
    v_id_type      text;
BEGIN
    -- Actor wajib (mirror audit.ErrNoActor) — jaring pengaman kedua di sisi SQL.
    IF p_actor_employee_id IS NULL OR p_actor_employee_id = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'no_actor',
                                  'message', 'audit: every write requires an actor');
    END IF;

    SELECT * INTO v_machine FROM sm_machines WHERE name = p_machine;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'unknown_machine',
                                  'message', format('statemachine: unknown machine %L', p_machine));
    END IF;
    IF v_machine.auto_computed THEN
        RETURN jsonb_build_object('ok', false, 'code', 'auto_computed',
                                  'message', format('statemachine: %L status is auto-computed; manual transitions are not allowed', p_machine));
    END IF;

    -- Tipe kolom id, dibaca dari katalog. `format_type` menghasilkan nama tipe
    -- kanonik dari sistem (bukan masukan pemanggil), jadi aman diinterpolasi.
    -- Tabel/kolom yang tidak ada ⇒ v_id_type NULL ⇒ jatuh ke `text` dan error
    -- aslinya muncul apa adanya, bukan tertutup pesan yang menyesatkan.
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_id_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = p_table
       AND a.attname = p_id_col AND a.attnum > 0 AND NOT a.attisdropped;
    v_id_type := coalesce(v_id_type, 'text');

    -- Kunci baris entity & baca status otoritatif (SELECT ... FOR UPDATE dinamis).
    -- Catatan: EXECUTE TIDAK meng-set variabel FOUND di PL/pgSQL, jadi deteksi
    -- "tidak ada baris" memakai v_from IS NULL — valid karena kolom status entity
    -- selalu NOT NULL (skema port), sehingga NULL ⇔ baris tidak ditemukan.
    EXECUTE format('SELECT %I FROM %I WHERE %I = $1::%s FOR UPDATE',
                   p_status_col, p_table, p_id_col, v_id_type)
        INTO v_from USING p_entity_id;
    IF v_from IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found',
                                  'message', format('statemachine: entity %s not found', p_entity_id));
    END IF;

    -- Cek edge (from -> to). Tidak terdaftar = blocked dengan pesan machine.
    SELECT e.require_lead INTO v_require_lead
      FROM sm_edges e
     WHERE e.machine = p_machine AND e.from_state = v_from AND e.to_state = p_to;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'message', v_machine.block_message);
    END IF;

    -- Gate role: edge requireLead hanya untuk Director atau Lead. OD tidak pernah menulis.
    IF v_require_lead AND NOT (p_role_director OR p_role_lead) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'role_denied',
                                  'message', '[anda tidak memiliki akses untuk melakukan transisi ini]');
    END IF;

    -- Terapkan perubahan status (SATU-SATUNYA tempat kolom status ditulis).
    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2::%s', p_table, p_status_col, p_id_col, v_id_type)
        USING p_to, p_entity_id;

    -- Baris audit immutable (before -> after), dalam transaksi yang sama.
    INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
    VALUES (p_entity_type, p_entity_id, p_actor_employee_id,
            'transition:' || v_from || '->' || p_to,
            jsonb_build_object('status', v_from),
            jsonb_build_object('status', p_to),
            p_actor_employee_id);

    RETURN jsonb_build_object('ok', true, 'from', v_from, 'to', p_to);
END;
$$;

COMMENT ON FUNCTION sm_transition(text, text, text, text, text, text, text, text, boolean, boolean) IS
  'Engine transisi status: row lock + validasi edge + gerbang role + baris audit '
  'dalam SATU transaksi. Satu-satunya penulis kolom status. Sadar tipe kolom id '
  '(20260908020000): cast di PARAMETER, bukan kolom, supaya indeks tetap terpakai.';
