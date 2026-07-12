-- CDPS Wave 2 — Module 6 (Account & Service), Cluster 4: Complaint door #2
-- (AM via WhatsApp, M6 §8). This migration creates the Complaint entity (CPL-)
-- per the §9.5 field spec. Migrations 0002/0010/0020/0021/0022 stay frozen;
-- Wave-2 M6 owns the 0020–0029 range.
--
-- A Complaint is parented to a Client (DATA_MODEL: CPL- → CLI). It is ONE entity
-- with a `Source` field (§9.5) designed from day one for all three effective
-- complaint doors — `WhatsApp (AM-logged)` (this cluster, §8), `Client Portal`
-- (Module 15) and `Sales` (Module 4 §6). Only door #2 (AM/WhatsApp) is wired in
-- this cluster; the column already accepts the other two values so those modules
-- add only their logging paths, not a schema change.
--
-- Field mapping to PRD §9.5:
--   client_id        -> Client ID (mandatory parent).
--   related_ref      -> Related Service/Brief (optional). One nullable reference
--                       that may point at a Service (SVC-) or a Brief (BRF-) of
--                       the SAME client; no single FK can span both tables, so
--                       referential integrity is enforced in the application
--                       layer (LogComplaint). When it points at a Brief, that
--                       Brief's division gets read-only context visibility
--                       (§8 Rule 4).
--   source           -> Source (single choice; the three doors above).
--   description      -> Description (mandatory).
--   severity         -> Severity (Low / Medium / High, mandatory; penalties in
--                       M6-OA-4 feed Health Score in M13).
--   status           -> Status, runs the CPL- state machine (STATE_MACHINES §11):
--                       [Open] -> [In Progress] -> [Resolved] -> [Closed].
--   assigned_to      -> Assigned To (defaults to the owning AM; §9.5). Nullable
--                       so a Director-logged complaint on an AM-less client is
--                       still representable.
--   resolution_notes -> Resolution Notes (conditional; required before
--                       [Resolved], enforced in the app). Latest note for
--                       display; every status move is also recorded immutably in
--                       audit_log (the source of truth; open-complaint counts and
--                       history derive from the log — house rule 3/4).
CREATE TABLE complaints (
    id               VARCHAR(32)  NOT NULL PRIMARY KEY,
    client_id        VARCHAR(32)  NOT NULL,
    related_ref      VARCHAR(32)  NULL,
    source           VARCHAR(32)  NOT NULL,
    description      TEXT         NOT NULL,
    severity         VARCHAR(16)  NOT NULL,
    status           VARCHAR(24)  NOT NULL,
    assigned_to      VARCHAR(64)  NULL,
    resolution_notes TEXT         NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by       VARCHAR(64)  NOT NULL,
    KEY idx_complaints_client (client_id),
    KEY idx_complaints_status (status),
    KEY idx_complaints_related (related_ref),
    CONSTRAINT fk_complaints_client FOREIGN KEY (client_id) REFERENCES clients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
