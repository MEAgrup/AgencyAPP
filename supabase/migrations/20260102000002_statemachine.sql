-- Penambahan native Postgres (bukan port skema) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §B.2 (statemachine) + §B.6 (notification).
-- Ditulis SETELAH semua migrasi port (timestamp 20260102...) karena bergantung pada
-- tabel audit_log / notifications / employees / role_mappings (port 20260101000001_init).
--
-- Meng-engine-kan house rule CLAUDE.md #2/#3/#8:
--   - transisi status HANYA lewat sm_transition (satu-satunya jalur tulis kolom status);
--   - transisi invalid diblok server-side dengan pesan BI [...] terkonfigurasi;
--   - transisi role-restricted (requireLead) dievaluasi DI DALAM fungsi SQL (bukan hanya TS),
--     supaya panggilan langsung via service-role tetap tidak bisa melewati gate;
--   - setiap transisi menulis satu baris audit_log immutable, dalam transaksi yang sama;
--   - notifikasi (notify_emit) di-derive dari event, atomik dengan pemicunya, tidak best-effort.
--
-- Port dari backend/internal/core/statemachine/{statemachine.go,config.go} (14 machine) dan
-- backend/internal/core/notification/notification.go (15 event FROZEN, Phase 0 v2 §9 + O29/W3-CAT-1).
-- Pola: TABEL data (machine/edge) + SATU fungsi transisi generik + SATU fungsi emit generik
-- (bukan per-entity trigger / per-machine function) — supaya "no raw UPDATE ever sets status"
-- dijamin arsitektur dan penambahan machine baru tidak butuh redeploy kode.

-- ============================================================================
-- Tabel konfigurasi state machine (data, bukan hardcode kode)
-- ============================================================================

CREATE TABLE sm_machines (
    name          text        NOT NULL PRIMARY KEY,
    initial_state text        NOT NULL,
    block_message text        NOT NULL DEFAULT '[transisi status tidak diizinkan]',
    auto_computed boolean     NOT NULL DEFAULT false,
    flags         text[]      NOT NULL DEFAULT '{}',
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    varchar(64) NOT NULL DEFAULT 'SYSTEM'
);

CREATE TABLE sm_edges (
    machine      text        NOT NULL REFERENCES sm_machines (name),
    from_state   text        NOT NULL,
    to_state     text        NOT NULL,
    require_lead boolean     NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   varchar(64) NOT NULL DEFAULT 'SYSTEM',
    PRIMARY KEY (machine, from_state, to_state)
);
CREATE INDEX idx_sm_edges_lookup ON sm_edges (machine, from_state);

-- Terminal states (introspeksi/paritas dengan Machine.terminal Go; tidak dipakai
-- enforcement — terminal = state tanpa edge keluar, tapi disimpan eksplisit spt Go).
CREATE TABLE sm_terminal_states (
    machine    text        NOT NULL REFERENCES sm_machines (name),
    state      text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(64) NOT NULL DEFAULT 'SYSTEM',
    PRIMARY KEY (machine, state)
);

-- ============================================================================
-- sm_transition — satu fungsi transisi generik (port Engine.Transition)
-- ============================================================================
-- Mengembalikan jsonb terstruktur {ok, ...} alih-alih exception (§B.2 rekomendasi),
-- supaya route handler memetakan ke HTTP 409/403 tanpa string-matching error Postgres.
--   sukses  : {"ok": true,  "from": <state>, "to": <state>}
--   gagal   : {"ok": false, "code": <kode>, "message": <pesan BI [...] atau teknis>}
-- Kode: no_actor | unknown_machine | auto_computed | not_found | blocked | role_denied.
--
-- Actor & role di-resolve di TypeScript (dari JWT claim) dan DITERUSKAN sebagai parameter
-- eksplisit (bukan di-lookup ulang oleh fungsi) — §B.2. Rule "ID/aksi hanya setelah validasi
-- field wajib lolos" tetap tanggung jawab route handler; fungsi ini tidak memvalidasi bisnis.
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

    -- Kunci baris entity & baca status otoritatif (SELECT ... FOR UPDATE dinamis).
    -- Catatan: EXECUTE TIDAK meng-set variabel FOUND di PL/pgSQL, jadi deteksi
    -- "tidak ada baris" memakai v_from IS NULL — valid karena kolom status entity
    -- selalu NOT NULL (skema port), sehingga NULL ⇔ baris tidak ditemukan.
    EXECUTE format('SELECT %I FROM %I WHERE %I = $1 FOR UPDATE', p_status_col, p_table, p_id_col)
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
    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', p_table, p_status_col, p_id_col)
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

-- ============================================================================
-- Katalog notifikasi (15 event FROZEN) + notify_emit (port Catalog.Emit)
-- ============================================================================

CREATE TABLE notif_events (
    event_type  text        NOT NULL PRIMARY KEY,
    description text        NOT NULL,
    resolver    text        NOT NULL,  -- explicit | leadsOfDivision | explicitOrLeads
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  varchar(64) NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_notif_resolver CHECK (resolver IN ('explicit', 'leadsOfDivision', 'explicitOrLeads'))
);

-- notify_emit — resolusi recipient + INSERT satu notifikasi per recipient (port Emit).
-- Dipanggil di transaksi yang sama dengan transisi pemicu (atomik). Actor dikecualikan
-- kecuali p_notify_actor. Dedup by-set. Deep-link default '/entity_type/entity_id'.
-- Catatan paritas: resolver 'leadsOfDivision' & 'explicitOrLeads' menghasilkan SET recipient
-- identik setelah dedup (leads(divisi) ∪ explicit); perbedaan hanya urutan/duplikasi yang
-- di-dedup Emit di Go — jadi keduanya diperlakukan sama di SQL.
CREATE OR REPLACE FUNCTION notify_emit(
    p_event       text,
    p_entity_type text,
    p_entity_id   text,
    p_actor       text,
    p_deep_link   text,
    p_division    text,
    p_explicit    text[],
    p_notify_actor boolean
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_resolver  text;
    v_deep_link text := COALESCE(NULLIF(p_deep_link, ''), '/' || p_entity_type || '/' || p_entity_id);
    v_notified  text[];
BEGIN
    SELECT resolver INTO v_resolver FROM notif_events WHERE event_type = p_event;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'notification: unknown event %', p_event;
    END IF;

    WITH candidates AS (
        SELECT unnest(COALESCE(p_explicit, ARRAY[]::text[])) AS rid
        UNION ALL
        SELECT e.employee_id
          FROM employees e
          JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
         WHERE v_resolver IN ('leadsOfDivision', 'explicitOrLeads')
           AND COALESCE(p_division, '') <> ''
           AND rm.division = p_division
           AND rm.level = 'lead'
           AND e.status_aktif = true
    ),
    filtered AS (
        SELECT DISTINCT rid FROM candidates
         WHERE rid IS NOT NULL AND rid <> ''
           AND (p_notify_actor OR rid <> p_actor)
    ),
    ins AS (
        INSERT INTO notifications (recipient_employee_id, event_type, entity_type, entity_id, actor_employee_id, deep_link, created_by)
        SELECT rid, p_event, p_entity_type, p_entity_id, p_actor, v_deep_link, p_actor FROM filtered
        RETURNING recipient_employee_id
    )
    SELECT array_agg(recipient_employee_id ORDER BY recipient_employee_id) INTO v_notified FROM ins;

    RETURN jsonb_build_object('ok', true, 'notified', COALESCE(to_jsonb(v_notified), '[]'::jsonb));
END;
$$;

-- mark_notification_read — satu-satunya jalur UPDATE notifications (port MarkRead), idempotent.
CREATE OR REPLACE FUNCTION mark_notification_read(p_id bigint, p_recipient text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE notifications SET read_at = now()
     WHERE id = p_id AND recipient_employee_id = p_recipient AND read_at IS NULL;
$$;

-- ============================================================================
-- SEED — 14 machine + edges (transkripsi 1:1 dari config.go) & 15 event
-- ============================================================================

INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('prospect_attempt',        'Pending Validation',      false, '{}'),
    ('lead_record',             '[Pool]',                  false, '{}'),
    ('campaign',                'Draft',                   false, '{}'),
    ('transaction_payment',     '[Menunggu Verifikasi]',   false, '{"[Jatuh Tempo]","[Bermasalah]"}'),
    ('installment',             '[Belum Jatuh Tempo]',     false, '{"[Jatuh Tempo]"}'),
    ('service',                 '[Awaiting Onboarding]',   false, '{}'),
    ('strategy_plan',           '[Strategy Drafting]',     false, '{}'),
    ('brief_task',              '[To Do]',                 false, '{}'),
    ('creator_booking',         '[Sourcing]',              false, '{}'),
    ('creator_payment_request', '[Requested]',             false, '{}'),
    ('live_stream_session',     '[Requested]',             false, '{}'),
    ('complaint',               '[Open]',                  false, '{}'),
    ('dependency',              'Pending',                 true,  '{}'),
    ('ad_campaign',             '[Paused]',                false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('prospect_attempt', 'Not Qualified'),
    ('prospect_attempt', 'Closed-Success'),
    ('prospect_attempt', 'Closed-Lost'),
    ('prospect_attempt', 'Blocked'),
    ('prospect_attempt', '[Closed - Kalah Kompetisi]'),
    ('campaign', 'Archived'),
    ('transaction_payment', '[Lunas]'),
    ('installment', '[Terverifikasi]'),
    ('service', 'Done'),
    ('service', '[Cancelled — Service Voided]'),
    ('strategy_plan', '[Strategy Approved]'),
    ('brief_task', '[Approved]'),
    ('brief_task', '[Cancelled — Service Voided]'),
    ('creator_booking', '[QC Passed]'),
    ('creator_booking', '[Dropped]'),
    ('creator_payment_request', '[Paid]'),
    ('creator_payment_request', '[Rejected]'),
    ('live_stream_session', '[Reconciled]'),
    ('complaint', '[Closed]'),
    ('ad_campaign', '[Ended]');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    -- §1 prospect_attempt
    ('prospect_attempt', 'Pending Validation', 'New Lead', false),
    ('prospect_attempt', 'New Lead', 'Contacted', false),
    ('prospect_attempt', 'Contacted', 'Qualified', false),
    ('prospect_attempt', 'Contacted', 'Not Qualified', false),
    ('prospect_attempt', 'Qualified', 'Negotiation - Pending Approval', false),
    ('prospect_attempt', 'Qualified', 'Negotiation - Auto Approved', false),
    ('prospect_attempt', 'Negotiation - Pending Approval', 'Negotiation - Approved', true),
    ('prospect_attempt', 'Negotiation - Pending Approval', 'Negotiation - Revision Required', true),
    ('prospect_attempt', 'Negotiation - Pending Approval', 'Negotiation - Rejected', true),
    ('prospect_attempt', 'Negotiation - Revision Required', 'Negotiation - Approved', false),
    ('prospect_attempt', 'Negotiation - Revision Required', 'Negotiation - Pending Approval', false),
    ('prospect_attempt', 'Negotiation - Rejected', 'Negotiation - Pending Approval', false),
    ('prospect_attempt', 'Negotiation - Rejected', 'Closed-Lost', false),
    ('prospect_attempt', 'Negotiation - Approved', 'Closed-Success', false),
    ('prospect_attempt', 'Negotiation - Approved', 'Closed-Lost', false),
    ('prospect_attempt', 'Negotiation - Auto Approved', 'Closed-Success', false),
    ('prospect_attempt', 'Negotiation - Auto Approved', 'Closed-Lost', false),
    ('prospect_attempt', 'New Lead', '[Closed - Kalah Kompetisi]', false),
    ('prospect_attempt', 'Contacted', '[Closed - Kalah Kompetisi]', false),
    ('prospect_attempt', 'Qualified', '[Closed - Kalah Kompetisi]', false),
    ('prospect_attempt', 'Negotiation - Pending Approval', '[Closed - Kalah Kompetisi]', false),
    ('prospect_attempt', 'Negotiation - Revision Required', '[Closed - Kalah Kompetisi]', false),
    ('prospect_attempt', 'Negotiation - Approved', '[Closed - Kalah Kompetisi]', false),
    ('prospect_attempt', 'Negotiation - Auto Approved', '[Closed - Kalah Kompetisi]', false),
    -- §2 lead_record
    ('lead_record', '[Rejected]', '[Pool]', false),
    ('lead_record', '[Not Qualified]', '[Pool]', false),
    ('lead_record', '[Pool]', 'active', false),
    ('lead_record', 'active', '[Rejected]', false),
    ('lead_record', 'active', '[Not Qualified]', false),
    -- §3 campaign
    ('campaign', 'Draft', 'Active', false),
    ('campaign', 'Active', 'Paused', false),
    ('campaign', 'Paused', 'Active', false),
    ('campaign', 'Active', 'Closed', false),
    ('campaign', 'Paused', 'Closed', false),
    ('campaign', 'Closed', 'Archived', false),
    -- §4 transaction_payment
    ('transaction_payment', '[Menunggu Verifikasi]', '[Terverifikasi - Sebagian]', false),
    ('transaction_payment', '[Menunggu Verifikasi]', '[Lunas]', false),
    ('transaction_payment', '[Terverifikasi - Sebagian]', '[Lunas]', false),
    -- §5 installment
    ('installment', '[Belum Jatuh Tempo]', '[Jatuh Tempo]', false),
    ('installment', '[Jatuh Tempo]', '[Terverifikasi]', false),
    ('installment', '[Belum Jatuh Tempo]', '[Terverifikasi]', false),
    -- §6 service
    ('service', '[Awaiting Onboarding]', '[Strategy Approved]', false),
    ('service', '[Awaiting Onboarding]', '[Briefed]', false),
    ('service', '[Strategy Approved]', '[Briefed]', false),
    ('service', '[Briefed]', '[In Execution]', false),
    ('service', '[In Execution]', 'Done', false),
    ('service', '[Awaiting Onboarding]', '[Cancelled — Service Voided]', true),
    ('service', '[Strategy Approved]', '[Cancelled — Service Voided]', true),
    ('service', '[Briefed]', '[Cancelled — Service Voided]', true),
    ('service', '[In Execution]', '[Cancelled — Service Voided]', true),
    -- §6a strategy_plan
    ('strategy_plan', '[Strategy Drafting]', '[Strategy Submitted for Approval]', false),
    ('strategy_plan', '[Strategy Submitted for Approval]', '[Strategy Approved]', true),
    ('strategy_plan', '[Strategy Submitted for Approval]', '[Strategy Drafting]', true),
    -- §7 brief_task
    ('brief_task', '[To Do]', '[In Progress]', false),
    ('brief_task', '[In Progress]', '[Submitted]', false),
    ('brief_task', '[Submitted]', '[In Review]', false),
    ('brief_task', '[In Review]', '[Approved]', false),
    ('brief_task', '[In Review]', '[Revision Requested]', false),
    ('brief_task', '[Revision Requested]', '[In Progress]', false),
    ('brief_task', '[In Progress]', '[Blocked]', true),
    ('brief_task', '[Blocked]', '[In Progress]', true),
    ('brief_task', '[To Do]', '[Cancelled — Service Voided]', true),
    ('brief_task', '[In Progress]', '[Cancelled — Service Voided]', true),
    ('brief_task', '[Submitted]', '[Cancelled — Service Voided]', true),
    ('brief_task', '[In Review]', '[Cancelled — Service Voided]', true),
    ('brief_task', '[Revision Requested]', '[Cancelled — Service Voided]', true),
    ('brief_task', '[Blocked]', '[Cancelled — Service Voided]', true),
    -- §8 creator_booking
    ('creator_booking', '[Sourcing]', '[Booked]', false),
    ('creator_booking', '[Booked]', '[Content In Progress]', false),
    ('creator_booking', '[Content In Progress]', '[Content Submitted]', false),
    ('creator_booking', '[Content Submitted]', '[QC Review]', false),
    ('creator_booking', '[QC Review]', '[QC Passed]', false),
    ('creator_booking', '[QC Review]', '[QC Failed - Revision Requested]', false),
    ('creator_booking', '[QC Review]', '[Escalated - Creator Unresponsive]', true),
    ('creator_booking', '[QC Failed - Revision Requested]', '[Content Submitted]', false),
    ('creator_booking', '[Escalated - Creator Unresponsive]', '[Dropped]', true),
    ('creator_booking', '[Escalated - Creator Unresponsive]', '[Content Submitted]', false),
    ('creator_booking', '[Booked]', '[Dropped]', true),
    ('creator_booking', '[Sourcing]', '[Dropped]', true),
    -- §9 creator_payment_request
    ('creator_payment_request', '[Requested]', '[Received by Finance]', false),
    ('creator_payment_request', '[Received by Finance]', '[Paid]', false),
    ('creator_payment_request', '[Received by Finance]', '[Rejected]', false),
    -- §10 live_stream_session
    ('live_stream_session', '[Requested]', '[Confirmed by Vendor]', false),
    ('live_stream_session', '[Confirmed by Vendor]', '[Completed]', false),
    ('live_stream_session', '[Completed]', '[Reconciled]', false),
    ('live_stream_session', '[Completed]', '[Discrepancy Flagged]', false),
    ('live_stream_session', '[Discrepancy Flagged]', '[Reconciled]', false),
    -- §11 complaint
    ('complaint', '[Open]', '[In Progress]', false),
    ('complaint', '[In Progress]', '[Resolved]', false),
    ('complaint', '[Resolved]', '[Closed]', false),
    -- §14 ad_campaign
    ('ad_campaign', '[Paused]', '[Active]', false),
    ('ad_campaign', '[Active]', '[Paused]', false),
    ('ad_campaign', '[Active]', '[Ended]', false),
    ('ad_campaign', '[Paused]', '[Ended]', false);

INSERT INTO notif_events (event_type, description, resolver) VALUES
    ('m0.negotiation.pending_approval', 'Negotiation Pending Approval submitted', 'leadsOfDivision'),
    ('m0.negotiation.decision',         'Negotiation decision',                   'explicit'),
    ('m0m5.installment.due',            'Installment due/overdue',                'explicitOrLeads'),
    ('m5.contract.not_received',        'Contract not received 7 days after routing', 'explicitOrLeads'),
    ('m6.complaint.logged',             'Complaint logged (any door)',            'explicitOrLeads'),
    ('m9.kol.qc_failed_or_escalated',   'QC Failed / Booking Escalated',          'leadsOfDivision'),
    ('m10.session.discrepancy_flagged', 'Session Discrepancy Flagged',            'leadsOfDivision'),
    ('m11.dependency.satisfied',        'Blocking Dependency Satisfied',          'explicit'),
    ('m12.block_request.submitted',     'Block request submitted',                'leadsOfDivision'),
    ('m12.block_request.decided',       'Block request approved/rejected',        'explicit'),
    ('m12.revision_count.flag',         'Revision Count >= 3 (Quality flag)',     'leadsOfDivision'),
    ('m13.client.band_drop',            'Client band drop',                       'leadsOfDivision'),
    ('m14.performance.published',       'Monthly Performance Score published',    'explicit'),
    ('m1.lead.co_pursuit',              'Lead dikerjakan lebih dari satu sales',  'explicit'),
    ('m7.hours_logged.reminder',        'Hours Logged end-of-day reminder',       'explicit');
