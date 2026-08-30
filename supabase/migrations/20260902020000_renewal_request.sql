-- ============================================================================
-- R-03 (Kinerja Sales, docs/DECISIONS.md "Kinerja Sales #4/#5") — the renewal/
-- cross-sell WRITE door from the Client Record, arah (a) disetujui pemilik.
--
-- `sales.close()` always mints a fresh `CLI-`; selling again to an EXISTING
-- client would duplicate it. The owner's decision: renewal = a SECOND `CTR-`
-- on the same `CLI-`; cross-sell = a new `SVC-` outside the running contract's
-- scope. See STATE_MACHINES.md §20 for the full machine + design rationale
-- (why a parallel entity instead of reusing `negotiation_proposals`/
-- `prospect_attempts` — "nol LEAD-/PRSP- palsu").
--
-- Mirrors `prospect_attempts` (stateful parent) + `negotiation_proposals`/
-- `negotiation_proposal_lines` (versioned line-item snapshots) EXACTLY, with
-- one substitution: the anchor is `client_id`, not `attempt_id`.
-- ============================================================================

-- --- Prefix registry (RNW) ---------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('RNW', 'Renewal/Cross-Sell Request', 'M0 (Kinerja Sales R-03)');

-- --- State machine: renewal_request ------------------------------------------
-- Pending Approval → Approved | Rejected (require_lead — Sales Head/SPV only,
-- sejajar prospect_attempt's negotiation edges). Auto Approved is the no-nego
-- entry (all-standard-price lines), reached the SAME way `prospect_attempts`
-- reaches 'Negotiation - Auto Approved': inserted directly at row creation,
-- never via sm_transition (there is no "from" state for a brand-new row).
-- Rejected → Pending Approval is a RESUBMIT on the SAME row (new proposal
-- version), not a new RNW-. Approved/Auto Approved → Executed is the separate
-- execution step (mirrors close() as a distinct action after negotiation
-- approval, not an automatic side effect of approving).
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('renewal_request', 'Pending Approval', false, '{}');
INSERT INTO sm_terminal_states (machine, state) VALUES
    ('renewal_request', 'Executed');
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('renewal_request', 'Pending Approval', 'Approved',  true),
    ('renewal_request', 'Pending Approval', 'Rejected',  true),
    ('renewal_request', 'Rejected',         'Pending Approval', false),
    ('renewal_request', 'Approved',         'Executed',  false),
    ('renewal_request', 'Auto Approved',    'Executed',  false);

-- --- Tables ------------------------------------------------------------------

-- Parent: one per renewal/cross-sell OFFER on an existing client. `jenis`
-- mirrors `contracts.jenis` (excluding 'baru' — this entity never produces a
-- first-time contract). `proposed_by` is the salesperson executing the
-- renewal — the credit target per KS-2 (see STATE_MACHINES.md §20).
CREATE TABLE renewal_requests (
    id              varchar(32)  NOT NULL PRIMARY KEY,      -- RNW-YYYYMM-NNNN
    client_id       varchar(32)  NOT NULL,
    jenis           varchar(16)  NOT NULL,                   -- 'perpanjangan' | 'cross_sell'
    proposed_by     varchar(64)  NOT NULL,
    status          varchar(32)  NOT NULL DEFAULT 'Pending Approval',
    decision_note   varchar(500) NULL,
    contract_id     varchar(32)  NULL,                       -- set by executeRenewal
    transaction_id  varchar(32)  NULL,                       -- set by executeRenewal
    created_at      timestamptz  NOT NULL DEFAULT now(),
    created_by      varchar(64)  NOT NULL,
    CONSTRAINT fk_rnw_client FOREIGN KEY (client_id) REFERENCES clients (id),
    CONSTRAINT fk_rnw_contract FOREIGN KEY (contract_id) REFERENCES contracts (id),
    CONSTRAINT fk_rnw_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id),
    CONSTRAINT ck_rnw_jenis CHECK (jenis IN ('perpanjangan', 'cross_sell'))
);
CREATE INDEX idx_rnw_client ON renewal_requests (client_id);
CREATE INDEX idx_rnw_proposed_by ON renewal_requests (proposed_by);

-- Versioned line-item snapshot — pola PERSIS negotiation_proposals, hanya
-- anchor-nya renewal_request_id, dan ID-nya bigint identity (nol prefix baru
-- untuk anak versi ini, sama seperti banyak tabel `_version`/anak lain).
CREATE TABLE renewal_proposals (
    id                 bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    renewal_request_id varchar(32)  NOT NULL,
    version_no         integer      NOT NULL,
    proposed_by        varchar(64)  NOT NULL,
    decision_note      varchar(500) NULL,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    created_by         varchar(64)  NOT NULL,
    CONSTRAINT uq_rnwprop_version UNIQUE (renewal_request_id, version_no),
    CONSTRAINT fk_rnwprop_request FOREIGN KEY (renewal_request_id) REFERENCES renewal_requests (id)
);

CREATE TABLE renewal_proposal_lines (
    id                bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proposal_id       bigint        NOT NULL,
    master_service_id varchar(32)   NOT NULL,
    proposed_price    numeric(15,2) NOT NULL,
    commission_rule   varchar(191)  NOT NULL,
    payment_terms     varchar(191)  NULL,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    created_by        varchar(64)   NOT NULL,
    CONSTRAINT fk_rnwline_proposal FOREIGN KEY (proposal_id) REFERENCES renewal_proposals (id)
);
CREATE INDEX idx_rnwline_proposal ON renewal_proposal_lines (proposal_id);

-- --- RLS (tabel lahir setelah baseline — grant hygiene eksplisit, pola
--     prospect_activities/TSK-/sales_targets). Read scope cermin S-01: klien
--     PIC/lead/created_by, Sales lead se-divisi (via jwt_owns_client — client
--     ownership arms sudah termasuk sales_pic_id), OD/Director. Tulis lewat
--     service-role + gate TS; RLS = kunci kedua.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.renewal_requests FROM anon;
REVOKE ALL ON public.renewal_requests FROM authenticated;
GRANT SELECT ON public.renewal_requests TO authenticated;
ALTER TABLE public.renewal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY renewal_requests_select ON public.renewal_requests FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR proposed_by = jwt_employee_id()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Sales'));

REVOKE ALL ON public.renewal_proposals FROM anon;
REVOKE ALL ON public.renewal_proposals FROM authenticated;
GRANT SELECT ON public.renewal_proposals TO authenticated;
ALTER TABLE public.renewal_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY renewal_proposals_select ON public.renewal_proposals FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR EXISTS (SELECT 1 FROM renewal_requests r
                   WHERE r.id = renewal_proposals.renewal_request_id
                     AND (r.proposed_by = jwt_employee_id()
                          OR private.jwt_owns_client(r.client_id)
                          OR (jwt_is_lead() AND jwt_division() = 'Sales'))));

REVOKE ALL ON public.renewal_proposal_lines FROM anon;
REVOKE ALL ON public.renewal_proposal_lines FROM authenticated;
GRANT SELECT ON public.renewal_proposal_lines TO authenticated;
ALTER TABLE public.renewal_proposal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY renewal_proposal_lines_select ON public.renewal_proposal_lines FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR EXISTS (SELECT 1 FROM renewal_proposals p
                   JOIN renewal_requests r ON r.id = p.renewal_request_id
                  WHERE p.id = renewal_proposal_lines.proposal_id
                    AND (r.proposed_by = jwt_employee_id()
                         OR private.jwt_owns_client(r.client_id)
                         OR (jwt_is_lead() AND jwt_division() = 'Sales'))));

COMMENT ON TABLE renewal_requests IS
  'R-03 (Kinerja Sales): renewal/cross-sell offer on an EXISTING client. Mesin #30 renewal_request, STATE_MACHINES.md §20.';
