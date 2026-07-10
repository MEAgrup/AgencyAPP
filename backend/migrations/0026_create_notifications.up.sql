-- S0-10 · In-app notification center (CLAUDE.md convention #8 / Phase 0 v2 §9).
-- One row per resolved recipient per cataloged event; in-app only, no
-- delivery channel fields (email/WA are out of scope for v1). A notification
-- is DERIVED from the audit log, never a substitute for it, and is never
-- deletable (convention #3/#8) -- only its read_at may ever change, and only
-- forward (there is no "mark unread" requirement).
-- No FK to the employees table (owned by another agent/migration range);
-- recipient_employee_id is a plain string identifier resolved by the
-- publishing module / notify.RecipientResolver.
-- Runs on MySQL 8 and MariaDB 10.11: utf8mb4, InnoDB, DATETIME(6), snake_case.
CREATE TABLE notifications (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_employee_id VARCHAR(32)     NOT NULL,
  event_name            VARCHAR(100)    NOT NULL,
  entity_type           VARCHAR(50)     NULL,
  entity_id             VARCHAR(50)     NULL,
  title                 VARCHAR(255)    NOT NULL,
  body                  TEXT            NULL,
  deep_link             VARCHAR(500)    NULL,
  payload_json          JSON            NULL,
  read_at               DATETIME(6)     NULL,
  created_at            DATETIME(6)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_notifications_recipient_read (recipient_employee_id, read_at),
  KEY idx_notifications_recipient_created (recipient_employee_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Never deletable (convention #3/#8), enforced at the storage layer, not
-- just by omitting a delete method from the Go API.
CREATE TRIGGER notifications_no_delete BEFORE DELETE ON notifications
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'notifications are never deletable';

-- read_at is the only mutable column (read/unread is the only mutable bit).
-- Every other column is fixed at insert time; any attempt to change them
-- (including via an UPDATE that happens to also touch read_at) is blocked.
CREATE TRIGGER notifications_read_only BEFORE UPDATE ON notifications
FOR EACH ROW
BEGIN
  IF NOT (
       OLD.recipient_employee_id <=> NEW.recipient_employee_id
   AND OLD.event_name            <=> NEW.event_name
   AND OLD.entity_type           <=> NEW.entity_type
   AND OLD.entity_id             <=> NEW.entity_id
   AND OLD.title                 <=> NEW.title
   AND OLD.body                  <=> NEW.body
   AND OLD.deep_link             <=> NEW.deep_link
   AND CAST(OLD.payload_json AS CHAR) <=> CAST(NEW.payload_json AS CHAR)
   AND OLD.created_at            <=> NEW.created_at
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'notifications: only read_at may be updated';
  END IF;
END;
