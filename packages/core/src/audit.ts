// Append-only audit log (S0-04).
//
// Ported from backend/internal/core/audit/audit.go (SUPABASE_MIGRATION_TECH_APPENDIX
// §B.3). Immutability is enforced at the storage layer by Postgres BEFORE UPDATE /
// BEFORE DELETE triggers (`forbid_mutation()`, migration 20260101000000) PLUS a
// REVOKE UPDATE,DELETE from authenticated/anon (defense in depth, §B.3). There is
// deliberately NO update or delete code path here or in the DB.
//
// The Go `Write()` is a thin INSERT builder; here we keep that pure part — payload
// construction + the mandatory-actor check — so it is unit-testable without a DB.
// The INSERT itself runs via the db client (packages/db, Fase 1), normally inside
// the SAME transaction as the change it records (e.g. from sm_transition).

/** AuditRecord is a request to append an audit entry. Actor is mandatory.
 * (Named AuditRecord, not Record, to avoid shadowing the built-in Record<K,V>.) */
export interface AuditRecord {
  entityType: string;
  entityId: string;
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

/** The row payload written to audit_log (before/after are jsonb, or null). */
export interface EntryPayload {
  entity_type: string;
  entity_id: string;
  actor_employee_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  created_by: string;
}

/** NoActorError mirrors audit.ErrNoActor — every write requires an actor. */
export class NoActorError extends Error {
  constructor() {
    super("audit: every write requires an actor");
    this.name = "NoActorError";
  }
}

/**
 * SecretInAuditError guards the house rule (§B.3): password/hash/token fields must
 * NEVER land in a before/after payload. A trigger/RLS cannot enforce which JSON
 * keys are allowed, so this is a code-level guard backing the code-review rule.
 */
export class SecretInAuditError extends Error {
  constructor(key: string) {
    super(`audit: forbidden secret field ${JSON.stringify(key)} in before/after payload`);
    this.name = "SecretInAuditError";
  }
}

// Keys that must never be serialized into an audit before/after payload.
const SECRET_KEYS = ["password", "password_hash", "passwordhash", "token", "secret"];

function scanForSecrets(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) scanForSecrets(v);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown> & object)) {
    if (SECRET_KEYS.includes(k.toLowerCase())) {
      throw new SecretInAuditError(k);
    }
    scanForSecrets(v);
  }
}

function marshalNullable(v: unknown): string | null {
  if (v === undefined || v === null) {
    return null;
  }
  scanForSecrets(v);
  return JSON.stringify(v);
}

/**
 * buildEntry validates the record (mandatory actor, no secret fields) and returns
 * the immutable audit_log row payload. It never updates or deletes.
 */
export function buildEntry(r: AuditRecord): EntryPayload {
  if (r.actor === "") {
    throw new NoActorError();
  }
  return {
    entity_type: r.entityType,
    entity_id: r.entityId,
    actor_employee_id: r.actor,
    action: r.action,
    before_json: marshalNullable(r.before),
    after_json: marshalNullable(r.after),
    created_by: r.actor,
  };
}
