/**
 * Local CDPS authentication (M-auth) — password login against employee_credentials.
 *
 * Ported from Go's `internal/auth` (local.go / session.go). CDPS auth is LOCAL
 * (CLAUDE.md; DECISIONS 2026-07-19): a bcrypt password per employee, checked here
 * with a failed-attempt lockout. `authenticate` returns the employee id; the API
 * shell then mints the session token (a signed HS256 JWT carrying the same
 * app_metadata claims the request verifier reads — so cookie and bearer resolve
 * an identical Actor, and RLS/claims parity is preserved).
 *
 * The claims themselves are DERIVED by the SQL `employee_claims(employee_id)`
 * function (migration 20260102000004) — the SAME source the GoTrue hook and the
 * RLS layer use, so the three never diverge.
 */
import bcrypt from 'bcryptjs';
import { executors, type Sql, type Queryable } from '@cdps/db';

// Lockout policy (mirror Go local.go).
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// Verbatim BI messages (ported 1:1 from the Go handlers).
export const MSG_INVALID_CREDENTIALS = '[email atau password salah]';
export const MSG_NOT_PROVISIONED = '[akun belum diaktifkan, hubungi admin untuk pengaturan password awal]';
export const MSG_LOCKED = '[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]';

/** 401 — unknown email, wrong password, or a deactivated employee (no enumeration). */
export class InvalidCredentialsError extends Error {
  constructor() { super(MSG_INVALID_CREDENTIALS); this.name = 'InvalidCredentialsError'; }
}
/** 401 — active employee that has no credentials row yet (admin must set a password). */
export class NotProvisionedError extends Error {
  constructor() { super(MSG_NOT_PROVISIONED); this.name = 'NotProvisionedError'; }
}
/** 423 — locked_until is in the future. */
export class LockedError extends Error {
  constructor() { super(MSG_LOCKED); this.name = 'LockedError'; }
}

interface CredRow {
  password_hash: string;
  must_change_password: boolean;
  failed_attempts: number;
  locked_until: Date | null;
}

/**
 * authenticate verifies an ACTIVE employee by email + password against the local
 * bcrypt hash, applying the failed-attempt lockout. Ordering mirrors Go: the lock
 * is checked BEFORE the hash (a correct password is still rejected while locked),
 * and a wrong password increments the shared counter, locking on the 5th failure.
 */
export async function authenticate(
  sql: Sql,
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<{ employeeId: string; mustChange: boolean }> {
  // Unknown email OR deactivated employee → the same generic error (no account enumeration).
  const emp = await sql<{ employee_id: string; status_aktif: boolean }[]>`
    select employee_id, status_aktif from employees where email = ${email}`;
  if (emp.length === 0 || !emp[0].status_aktif) {
    throw new InvalidCredentialsError();
  }
  const employeeId = emp[0].employee_id;

  const cred = await sql<CredRow[]>`
    select password_hash, must_change_password, failed_attempts, locked_until
    from employee_credentials where employee_id = ${employeeId}`;
  if (cred.length === 0) {
    throw new NotProvisionedError();
  }
  const c = cred[0];

  // Locked window: reject before verifying the hash.
  if (c.locked_until !== null && new Date(c.locked_until) > now) {
    throw new LockedError();
  }

  if (!bcrypt.compareSync(password, c.password_hash)) {
    await registerFailure(sql, employeeId, c.failed_attempts, now);
    throw new InvalidCredentialsError();
  }

  // Success: clear the failure counter and any (expired) lock.
  await sql`update employee_credentials set failed_attempts = 0, locked_until = null where employee_id = ${employeeId}`;
  return { employeeId, mustChange: c.must_change_password };
}

/**
 * registerFailure increments the consecutive-failure counter and, on the 5th
 * failure, sets the 15-minute lock and resets the counter (so the next post-lock
 * cycle starts fresh). The lock is audited (append-only, no secret material).
 */
async function registerFailure(sql: Sql, employeeId: string, prev: number, now: Date): Promise<void> {
  const next = prev + 1;
  if (next >= MAX_FAILED_ATTEMPTS) {
    const until = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    await sql`update employee_credentials set failed_attempts = 0, locked_until = ${until} where employee_id = ${employeeId}`;
    await executors(sql).audit.insertAudit({
      entityType: 'employee_credential', entityId: employeeId, actorEmployeeId: employeeId,
      action: 'account_locked', beforeJson: null, afterJson: { lock_minutes: LOCK_MINUTES },
      createdBy: employeeId,
    });
  } else {
    await sql`update employee_credentials set failed_attempts = ${next} where employee_id = ${employeeId}`;
  }
}

/**
 * mustChangePassword reports whether the employee has a pending forced change. A
 * missing credentials row reports false (login is impossible without one).
 */
export async function mustChangePassword(sql: Queryable, employeeId: string): Promise<boolean> {
  const rows = await sql<{ must_change_password: boolean }[]>`
    select must_change_password from employee_credentials where employee_id = ${employeeId}`;
  return rows.length > 0 && rows[0].must_change_password;
}

/** The CDPS claims (app_metadata) for an employee — DERIVED by SQL `employee_claims`. */
export interface Claims {
  employee_id: string;
  division: string;
  level: string;
  od: boolean;
  director: boolean;
}

/** loadClaims returns the app_metadata claims for `employeeId` (token payload source). */
export async function loadClaims(sql: Queryable, employeeId: string): Promise<Claims> {
  const rows = await sql<{ c: Claims }[]>`select public.employee_claims(${employeeId}) as c`;
  if (rows.length === 0 || rows[0].c === null) {
    throw new NotProvisionedError();
  }
  return rows[0].c;
}

/** The login/me response identity (snake_case = fixed API contract, mirrors Go identityDTO). */
export interface Identity {
  employee: { employee_id: string; nama: string; email: string; divisi: string; jabatan: string };
  role: { division: string; level: string; od: boolean; director: boolean };
  must_change_password: boolean;
}

/** loadIdentity assembles the {employee, role, must_change_password} response for an employee. */
export async function loadIdentity(sql: Queryable, employeeId: string, mustChange: boolean): Promise<Identity> {
  const rows = await sql<{ nama: string; email: string; divisi: string; jabatan: string }[]>`
    select nama, email, divisi, jabatan from employees where employee_id = ${employeeId}`;
  if (rows.length === 0) {
    throw new NotProvisionedError();
  }
  const e = rows[0];
  const claims = await loadClaims(sql, employeeId);
  return {
    employee: { employee_id: employeeId, nama: e.nama, email: e.email, divisi: e.divisi, jabatan: e.jabatan },
    role: { division: claims.division, level: claims.level, od: claims.od, director: claims.director },
    must_change_password: mustChange,
  };
}
