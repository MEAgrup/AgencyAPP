/**
 * Append-only audit log — TypeScript writer over the immutable `audit_log` table.
 *
 * Ported from backend/internal/core/audit. Immutability is enforced at the
 * storage layer by the `forbid_mutation()` BEFORE UPDATE/DELETE triggers on
 * `audit_log` (migration 20260101000001_init) — there is deliberately NO update
 * or delete code path here, exactly like the Go package.
 *
 * `write` builds the payload and delegates the INSERT to an executor (the same
 * transaction as the change it records). The "actor is mandatory" rule
 * (Go's ErrNoActor) is enforced here before the insert; the DB column is also
 * NOT NULL as a second net.
 *
 * before_json / after_json must NEVER carry a password/hash/token/secret
 * (SUPABASE_MIGRATION_TECH_APPENDIX §B.3). A trigger/RLS cannot enforce "which
 * fields may enter the JSON", so this stays a code-review + test rule; the
 * `hasSecretKey` helper below lets tests assert a payload is clean.
 */

/** Thrown when an audit write is attempted without an actor (Go's ErrNoActor). */
export class NoActorError extends Error {
  constructor() {
    super('audit: every write requires an actor');
    this.name = 'NoActorError';
  }
}

/** A request to append one immutable audit entry. `actor` is mandatory. */
export interface AuditRecord {
  entityType: string;
  entityId: string;
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

/** The concrete row handed to the executor for insertion into `audit_log`. */
export interface AuditRow {
  entityType: string;
  entityId: string;
  actorEmployeeId: string;
  action: string;
  beforeJson: unknown | null;
  afterJson: unknown | null;
  createdBy: string;
}

/**
 * Executor over the append-only insert. The real implementation wraps
 * postgres.js/drizzle and runs inside the caller's transaction:
 *
 *   sql`insert into audit_log (entity_type, entity_id, actor_employee_id, action,
 *        before_json, after_json, created_by) values (...)`
 */
export interface AuditExecutor {
  insertAudit(row: AuditRow): Promise<void>;
}

/**
 * write appends one immutable audit entry. It never updates or deletes. Throws
 * NoActorError when the actor is missing (mirror of Go's guard). `before`/`after`
 * are stored as jsonb (null when omitted).
 */
export async function write(exec: AuditExecutor, r: AuditRecord): Promise<void> {
  if (!r.actor) {
    throw new NoActorError();
  }
  await exec.insertAudit({
    entityType: r.entityType,
    entityId: r.entityId,
    actorEmployeeId: r.actor,
    action: r.action,
    beforeJson: r.before ?? null,
    afterJson: r.after ?? null,
    createdBy: r.actor,
  });
}

/** Keys that must never appear in an audit before/after payload. */
export const SECRET_KEY_RE = /pass(word)?|hash|token|secret|credential/i;

/**
 * hasSecretKey deep-scans a value for an object key that looks like a secret.
 * A testing/lint aid to assert audit payloads never carry credentials
 * (SUPABASE_MIGRATION_TECH_APPENDIX §B.3) — it does NOT sanitize, only detects.
 */
export function hasSecretKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretKey);
  }
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(k) || hasSecretKey(v)) {
      return true;
    }
  }
  return false;
}
