-- CDPS Wave 2 — Module 10 (Live Stream), Cluster 1: the Live Stream Session (LSS-)
-- entity — MEA's own record of what the AM REQUESTED from the outsourced sister-company
-- vendor and what the vendor actually DELIVERED (M10 §2).
--
-- Live Stream is the confirmed exception to the execution-division pattern (M10 §1):
-- MEA does NOT run the stream, so there is no internal Kanban and no "work in progress"
-- status — a Session records request + result on ONE row. Its parent is a Live Stream
-- Brief, which is OFF-MACHINE (born [Dispatched to Vendor], skips the brief_task machine
-- entirely — STATE_MACHINES §7 / DECISIONS W2-M6-C3). A single Brief holds MANY Sessions
-- across a recurring package (M10-OA-4); when every Session reaches [Reconciled] the
-- Brief closes to [Approved] via an audited off-machine UPDATE (module10_livestream,
-- action ls_brief_reconciled — the same off-machine precedent as void_cascade_offmachine).
--
-- House rules honoured (CLAUDE.md #1/#2/#4/#7):
--   - the LSS- id is minted (ident.Next) ONLY after the §6.3 mandatory REQUEST fields
--     validate (house rule 1);
--   - status is set at birth by INSERT (a creation, born [Requested]) and every later
--     move goes through the transition engine — machine live_stream_session
--     (STATE_MACHINES §10) — never a raw UPDATE (house rule 2);
--   - GMV / Data Confidence Tier are read-only vendor-reported facts; GMV is stored in
--     DECIMAL rupiah and rendered "Rp. X.XXX.XXX,00" (rule 7); the confidence tier is
--     the auto Vendor-Reported badge (§5 Rule 2 / M10-OA-5) — full value, never discounted.
--
-- Migration range: Wave-2 M10 takes 0028 (logged in DECISIONS.md — W2-M10-C1).
-- Migrations 0002–0027 stay frozen.

-- live_stream_sessions (LSS-): field spec M10 §6.3. Status = the live_stream_session
-- machine (STATE_MACHINES §10), born [Requested]. Request fields set at creation;
-- result fields (actual_*, viewers_*, orders_generated, gmv, vendor_report_link) filled
-- at [Completed]; reconciliation_notes required on [Discrepancy Flagged].
CREATE TABLE live_stream_sessions (
    id                    VARCHAR(32)   NOT NULL PRIMARY KEY,               -- LSS-YYYYMM-NNNN
    brief_id              VARCHAR(32)   NOT NULL,                           -- parent Live Stream Brief (FK)
    platform              VARCHAR(48)   NOT NULL,                           -- TikTok Shop Live | Shopee Live (mandatory)
    requested_datetime    DATETIME      NOT NULL,                          -- requested date/time (mandatory)
    target_duration_hours DECIMAL(6,2)  NOT NULL,                          -- target duration in hours (mandatory)
    products_talent       TEXT          NULL,                              -- products/talent to feature (optional)
    special_instructions  TEXT          NULL,                              -- optional
    status                VARCHAR(48)   NOT NULL DEFAULT '[Requested]',    -- live_stream_session machine
    actual_datetime       DATETIME      NULL,                              -- when actually held (result; mandatory before [Completed])
    actual_duration_hours DECIMAL(6,2)  NULL,                              -- actual duration hours (result; mandatory before [Completed])
    viewers_peak          INT           NULL,                              -- optional (vendor reporting detail)
    viewers_avg           INT           NULL,                              -- optional
    orders_generated      INT           NULL,                              -- result; mandatory before [Completed]
    gmv                   DECIMAL(20,2) NULL,                              -- GMV from live (Rp); mandatory before [Completed]; feeds Client GMV (§5)
    vendor_report_link    TEXT          NULL,                              -- vendor's own report/proof; mandatory before [Completed] (audit trail)
    reconciliation_notes  TEXT          NULL,                              -- required on [Discrepancy Flagged] (§4 Rule 3)
    data_confidence_tier  VARCHAR(32)   NOT NULL DEFAULT 'Vendor-Reported', -- auto badge (§5 Rule 2 / M10-OA-5); full value, never discounted
    created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by            VARCHAR(64)   NOT NULL,
    KEY idx_lss_brief_status (brief_id, status),
    CONSTRAINT fk_lss_brief FOREIGN KEY (brief_id) REFERENCES briefs (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
