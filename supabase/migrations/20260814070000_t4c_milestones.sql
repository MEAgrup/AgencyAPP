-- T-4c (RM-11, M6D): Upcoming Milestones terstruktur (bukan lagi teks RM-C9).
--
-- Keputusan pemilik 2026-08-14: *"milestone terstruktur"*. Sebelumnya RM-11
-- "Upcoming Milestones" hanya catatan teks bebas. Sekarang dimodelkan sebagai
-- entitas per-klien: judul + tanggal target + status (dilacak, bisa ditandai
-- selesai / dibatalkan). Ditampilkan di rekap mingguan (yang mendatang) + halaman
-- klien.
--
-- Entitas CDPS lengkap: prefix `MLS-YYYYMM-NNNN` (registry), mesin
-- `client_milestone` (status HANYA via sm_transition), RLS client-scoped (cermin
-- client_health_snapshots), history immutable via audit_log (house rule #2/#3).

-- --- Prefix registry (MLS) --------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('MLS', 'Client Milestone (Upcoming Milestones)', 'M6D');

-- --- State machine: client_milestone ---------------------------------------
-- [Upcoming] → [Done] (tercapai) | [Cancelled] (dibatalkan). Keduanya terminal.
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('client_milestone', '[Upcoming]', false, '{}');
INSERT INTO sm_terminal_states (machine, state) VALUES
    ('client_milestone', '[Done]'),
    ('client_milestone', '[Cancelled]');
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('client_milestone', '[Upcoming]', '[Done]',      false),
    ('client_milestone', '[Upcoming]', '[Cancelled]', false);

-- --- Table -----------------------------------------------------------------
CREATE TABLE client_milestones (
    id           varchar(32)  NOT NULL PRIMARY KEY,          -- MLS-YYYYMM-NNNN
    client_id    varchar(32)  NOT NULL REFERENCES clients (id),
    title        text         NOT NULL,
    target_date  date         NOT NULL,                       -- kapan tonggak ini jatuh
    status       varchar(24)  NOT NULL DEFAULT '[Upcoming]',  -- mesin client_milestone
    created_at   timestamptz  NOT NULL DEFAULT now(),
    created_by   varchar(64)  NOT NULL,
    updated_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_milestones_client ON client_milestones (client_id, target_date);

CREATE TRIGGER trg_client_milestones_updated_at BEFORE UPDATE ON client_milestones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- RLS: client-scoped read (cermin client_health_snapshots §D.2) ----------
-- Director/OD (read-all) + Account lead + PIC klien. Tulis lewat service-role +
-- gerbang TS (pola D-12); RLS = kunci kedua.
ALTER TABLE public.client_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_milestones_select ON public.client_milestones FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
       OR private.jwt_owns_client(client_id));

REVOKE ALL ON public.client_milestones FROM anon;
