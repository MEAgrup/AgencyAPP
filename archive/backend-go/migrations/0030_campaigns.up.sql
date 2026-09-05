-- CDPS Wave 3 — Module 3 (Campaign), Cluster 1: the acquisition Campaign (CMP-).
--
-- A Campaign is MEA's OWN lead-gen / acquisition effort (M3 §1/§2) — the first-class
-- "thread" that later ties Leads -> Clients -> execution. It is DISTINCT from Module 8's
-- Ad Campaign (ADC-, ad_campaigns), the client-facing paid-media record (M3-OA-1).
--
-- Cluster 1 owns identity + lifecycle + ownership ONLY. Budget/metrics live on the 1:1
-- Marketing Performance Record (Module 2, M3-OA-5) and are NOT columns here. The
-- leads/clients linkage, Source auto-set and read-only rollups (Leads generated, Real
-- leads, Clients won, Total value won) are the NEXT cluster (W3-M3-C2) — no such column
-- exists yet.
--
-- House rules honoured (CLAUDE.md #1/#2/#3):
--   - id is CMP-YYYYMM-NNNN, minted (ident.Next) only after mandatory-field validation
--     passes (house rule 1); immutable, never reused.
--   - status is the campaign machine (STATE_MACHINES §3), born 'Draft' at INSERT; every
--     later move goes through the transition engine, never a raw UPDATE (house rule 2).
--   - end_date is a DATA column (§6.3 "Set on [Closed]"), set as an effect of the Closed
--     transition — it is not a status.
--   - online/offline is the multi-select checklist {Online, Offline} (M2/M3 §6.3): two
--     independent flags, at least one required (enforced in the application, mirroring the
--     other modules that keep multi-select/at-least-one guards in code rather than a CHECK).
--
-- Migration range: Wave-3 M3 takes 0030 (next free after Wave-2's 0020-0029). Earlier
-- migrations stay frozen. employee-id columns follow the prospect_attempts precedent
-- (VARCHAR(64), indexed, NOT hard-FK'd — employees sync from HRIS).

CREATE TABLE campaigns (
    id                VARCHAR(32)  NOT NULL PRIMARY KEY,   -- CMP-YYYYMM-NNNN
    name              VARCHAR(191) NOT NULL,               -- Campaign Name (text; carried into Sales)
    channel           VARCHAR(191) NOT NULL,               -- free-text (M3-OA-2); drives Lead.Source in C2
    is_online         TINYINT(1)   NOT NULL DEFAULT 0,     -- Online/Offline checklist (multi-select)
    is_offline        TINYINT(1)   NOT NULL DEFAULT 0,
    start_date        DATE         NOT NULL,
    end_date          DATE         NULL,                   -- set on [Closed] (§6.3)
    owner_employee_id VARCHAR(64)  NOT NULL,               -- Marketing owner (reassignable, logged)
    status            VARCHAR(24)  NOT NULL DEFAULT 'Draft',
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by        VARCHAR(64)  NOT NULL,
    KEY idx_cmp_owner (owner_employee_id),
    KEY idx_cmp_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
