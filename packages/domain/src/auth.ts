/**
 * Auth read model — the `/me` surface consumed by web-internal's auth-context.
 *
 * CDPS auth itself is owned by Supabase GoTrue (password login issues the JWT;
 * our custom_access_token_hook injects the five CDPS claims — see
 * supabase/migrations/20260723071013_supabase_auth.sql). The @cdps/api route
 * layer verifies that JWT and resolves an `Actor` from its claims
 * (`permission.actorFromClaims`). This module adds the one piece the token does
 * NOT carry: the human-facing employee profile (nama / email / divisi /
 * jabatan), read from the `employees` table.
 *
 * `getMe` returns the exact wire shape web-internal expects (MeResponse):
 * `{ employee: { employee_id, nama, email, divisi, jabatan }, role }`, where
 * `role` is the JWT-resolved permission.Role. Kept snake_case here because this
 * IS the public auth contract (mirrors the Go backend's `MeResponse`).
 */
import bcrypt from 'bcryptjs';
import { permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

type Actor = permission.Actor;

/** Employee profile as returned on the /me surface (snake_case wire contract). */
export interface MeEmployee {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
}

/** The /me payload: profile + the JWT-resolved role. */
export interface Me {
  employee: MeEmployee;
  role: permission.Role;
}

/** Raised when the actor's employee row is absent or deactivated — the caller
 *  maps it to a 401 (`[sesi tidak valid, silahkan login kembali]`): a valid
 *  token whose employee no longer exists/active is not a usable session. */
export class NotFoundError extends Error {
  constructor(message = 'employee not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** LT-61: an employee Actor called a vendor-only surface (`GET /vendor/me`,
 *  `GET /vendor/briefs`). Distinct from `NotFoundError`: the session itself is
 *  valid, it is simply the wrong realm for this endpoint. */
export const MSG_NOT_VENDOR_ACCOUNT = '[akun ini bukan akun vendor]';

/**
 * getMe reads the actor's active employee row and combines it with the role
 * already resolved from the JWT claims. Only active employees resolve — a
 * deactivated/banned account (HRIS off-boarding → GoTrue ban) has no live
 * session even if it presents an unexpired token.
 */
export async function getMe(sql: Queryable, actor: Actor): Promise<Me> {
  const rows = await sql<MeEmployee[]>`
    select employee_id, nama, email, divisi, jabatan
    from employees
    where employee_id = ${actor.employeeId} and status_aktif = true`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return { employee: rows[0], role: actor.role };
}

/**
 * Vendor profile as returned on the vendor `/me` surface (LT-61 FE). Kept
 * snake_case for the same reason as `MeEmployee` — this IS the public wire
 * contract, not a domain shape @/lib/wire.ts translates. Deliberately narrow:
 * `vendors.catatan_kinerja` is MEA-internal performance notes about the
 * vendor (M6A §7) and must never reach the vendor whose performance it
 * describes.
 */
export interface VendorMe {
  vendor_id: string;
  nama_vendor: string;
}

/**
 * getVendorMe reads the calling vendor's own profile (LT-61). Unlike `getMe`,
 * no separate active-account check is needed here: `vendor_claims` (migration
 * 20260903010000) already omits the JWT's `vendor_id` claim entirely for a
 * `vendor_accounts.status_aktif = false` account, so a deactivated vendor
 * never resolves to a vendor Actor in the first place (see
 * `apps/api/src/lib/auth.ts` `requireActor`).
 */
export async function getVendorMe(sql: Queryable, actor: Actor): Promise<VendorMe> {
  const rows = await sql<{ id: string; nama_vendor: string }[]>`
    select id, nama_vendor from vendors where id = ${actor.vendorId ?? actor.employeeId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return { vendor_id: rows[0].id, nama_vendor: rows[0].nama_vendor };
}

// ---------------------------------------------------------------------------
// Password management (O44(c)) — ported from archive/backend-go/internal/auth/local.go.
//
// WHERE THE PASSWORD ACTUALLY LIVES. On this stack the authority is GoTrue
// (`auth.users.encrypted_password`); `employee_credentials` is only the transit
// table the importer seeds GoTrue from (OQ-3). Porting Go's ChangePassword
// verbatim would therefore be a BUG: it would rewrite a hash nobody logs in
// with, and the user's real password would not change.
//
// So the split is:
//   - the GoTrue side lives in the route layer (`apps/api/src/lib/gotrue.ts`),
//     because it is an HTTP call, not SQL;
//   - this module owns the POLICY (length rules + exact BI strings), the
//     Director/Lead AUTHORIZATION matrix, the credential read model, and the
//     DB-side effects — each through the SECURITY DEFINER RPCs that already
//     exist for exactly this purpose (`clear_must_change_password`,
//     `admin_set_employee_password`).
//
// Lockout is deliberately NOT ported: on the Go stack CDPS counted failed
// attempts itself, but here GoTrue owns login, so it owns rate limiting. The
// `[akun terkunci ...]` string is therefore unused rather than reimplemented —
// a second, weaker lockout would only give a false sense of coverage.
// ---------------------------------------------------------------------------

/** Minimum password length, in CHARACTERS (Go: MinPasswordLen). */
export const MIN_PASSWORD_LEN = 8;
/**
 * Maximum password length, in BYTES (Go: MaxPasswordBytes). This is bcrypt's
 * input limit — a longer input is silently truncated, so it is rejected up front
 * rather than accepted with a surprise.
 */
export const MAX_PASSWORD_BYTES = 72;
/** bcrypt cost, matching the importer and Go's bcrypt.DefaultCost. */
const BCRYPT_COST = 10;

/** Exact BI messages — ported verbatim from the Go handlers. Do NOT reword. */
export const MSG_PASSWORD_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_PASSWORD_WEAK = '[password minimal 8 karakter]';
export const MSG_PASSWORD_TOO_LONG = '[password maksimal 72 karakter]';
export const MSG_OLD_PASSWORD_MISMATCH = '[password lama tidak sesuai]';
export const MSG_SET_PASSWORD_DENIED = '[anda tidak memiliki akses untuk mengatur password karyawan ini]';
export const MSG_EMPLOYEE_NOT_FOUND = '[karyawan tidak ditemukan]';

/** NEW string — no Go precedent (Go never had per-IP login throttling). M15-C2
 *  follow-up, spec §5.2 OQ-5, DECISIONS.md O64 (2026-08-31). */
export const MSG_LOGIN_RATE_LIMITED =
  '[terlalu banyak percobaan login dari alamat ini, silahkan coba lagi dalam 15 menit]';

/** Password fails the length policy (carries the verbatim BI message). */
export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthPasswordPolicyError';
  }
}

/** The supplied current password is wrong (→ 401). */
export class OldPasswordError extends Error {
  constructor() {
    super(MSG_OLD_PASSWORD_MISMATCH);
    this.name = 'AuthOldPasswordError';
  }
}

/** Actor may not manage this employee's password (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_SET_PASSWORD_DENIED) {
    super(message);
    this.name = 'AuthForbiddenError';
  }
}

/**
 * The target employee does not exist (→ 404). Distinct from `NotFoundError`,
 * which means "the CALLER's own employee row is gone" and maps to 401.
 */
export class EmployeeNotFoundError extends Error {
  constructor() {
    super(MSG_EMPLOYEE_NOT_FOUND);
    this.name = 'AuthEmployeeNotFoundError';
  }
}

/** Too many login attempts from this IP within the window (→ 429). */
export class RateLimitedError extends Error {
  constructor() {
    super(MSG_LOGIN_RATE_LIMITED);
    this.name = 'AuthRateLimitedError';
  }
}

const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const LOGIN_RATE_LIMIT_WINDOW_MINUTES = 15;

/**
 * enforceLoginRateLimit — spec M15-C2 §5.2 (OQ-5: 10/IP/15min), applied
 * UNIFORMLY to every `POST /auth/login` attempt regardless of which realm
 * ultimately resolves (employee / LT-61 vendor / M15-C2 client-contact).
 *
 * The spec's number was written for the Client Portal specifically, but
 * `/auth/login` is ONE shared endpoint across all three realms, branching by
 * resolved Actor only AFTER GoTrue authenticates — too late to gate repeated
 * bad-password attempts per-realm. See DECISIONS.md 2026-08-31 (O64 closed)
 * for the full reasoning: a uniform ceiling only ADDS protection for
 * employee/vendor logins (GoTrue's own baseline still applies underneath); it
 * never restricts a legitimate human logging in ten times in fifteen minutes.
 *
 * DB-backed (`check_login_rate_limit`, 20260906010000_login_rate_limit.sql),
 * not in-memory: `apps/api` runs as Vercel serverless functions, where an
 * in-process counter would not reliably survive between invocations.
 */
export async function enforceLoginRateLimit(sql: Queryable, ipAddress: string): Promise<void> {
  const rows = await sql<{ allowed: boolean }[]>`
    select public.check_login_rate_limit(
      ${ipAddress}, ${LOGIN_RATE_LIMIT_MAX_ATTEMPTS}, ${LOGIN_RATE_LIMIT_WINDOW_MINUTES}
    ) as allowed`;
  if (rows[0]?.allowed !== true) {
    throw new RateLimitedError();
  }
}

/**
 * validatePassword enforces the length policy: minimum in characters (so a
 * multi-byte password is not judged by its byte count), maximum in BYTES (so
 * bcrypt never truncates silently). Mirrors Go's validatePassword.
 */
export function validatePassword(password: string): void {
  if ([...password].length < MIN_PASSWORD_LEN) {
    throw new PasswordPolicyError(MSG_PASSWORD_WEAK);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new PasswordPolicyError(MSG_PASSWORD_TOO_LONG);
  }
}

/**
 * canManagePasswords is the coarse gate: only a Director or a division Lead may
 * ever touch someone else's password. Mirrors Go's first check in SetPassword /
 * ListCredentials. The per-target check is `adminMayManage`.
 */
export function canManagePasswords(actor: Actor): boolean {
  return actor.role.director || actor.role.level === permission.LevelLead;
}

/**
 * adminMayManage decides whether `actor` may set `targetId`'s password.
 *
 * Director → anyone. A division Lead → only employees whose MAPPED CDPS division
 * equals theirs, and never a layered OD/Director target (a Lead must not be able
 * to reset the password of someone above them — that would be privilege
 * escalation by password takeover). An unmapped target is Director-only, since
 * without a mapping there is no division to compare.
 *
 * Mirrors Go's adminMayManage. Takes the privileged client: it reads
 * `role_mappings` + `employee_layered_roles`, which are default-deny under RLS.
 */
export async function adminMayManage(sql: Queryable, actor: Actor, targetId: string): Promise<boolean> {
  const rows = await sql<{ divisi: string; jabatan: string }[]>`
    select divisi, jabatan from employees where employee_id = ${targetId}`;
  if (rows.length === 0) {
    throw new EmployeeNotFoundError();
  }
  if (actor.role.director) {
    return true;
  }
  if (actor.role.level !== permission.LevelLead || actor.role.division === '') {
    return false;
  }
  const mapped = await sql<{ division: string }[]>`
    select division from role_mappings
     where divisi = ${rows[0].divisi} and jabatan = ${rows[0].jabatan}`;
  if (mapped.length === 0 || mapped[0].division !== actor.role.division) {
    return false;
  }
  const layered = await sql<{ n: number }[]>`
    select count(*)::int as n from employee_layered_roles
     where employee_id = ${targetId} and enabled = true and role in ('od', 'director')`;
  return layered[0].n === 0;
}

/**
 * setPassword sets a TEMPORARY password for another employee (B1 — the
 * no-email recovery path) and forces a change at next login.
 *
 * The whole DB effect goes through `admin_set_employee_password`, which writes
 * the hash into BOTH `employee_credentials` and `auth.users`, resets the lockout
 * counters, and deletes the target's GoTrue refresh tokens so old sessions
 * cannot outlive the reset.
 *
 * `sql` must be the privileged client (the RPC is service-role only).
 */
export async function setPassword(
  sql: Sql,
  actor: Actor,
  targetId: string,
  tempPassword: string,
): Promise<void> {
  if (!canManagePasswords(actor)) {
    throw new ForbiddenError();
  }
  const target = targetId.trim();
  if (target === '' || tempPassword === '') {
    throw new PasswordPolicyError(MSG_PASSWORD_INCOMPLETE);
  }
  if (!(await adminMayManage(sql, actor, target))) {
    throw new ForbiddenError();
  }
  validatePassword(tempPassword);
  const hash = await bcrypt.hash(tempPassword, BCRYPT_COST);
  await withTransaction(sql, async (tx) => {
    const rows = await tx<{ ok: boolean }[]>`
      select public.admin_set_employee_password(${target}, ${hash}, ${actor.employeeId}) as ok`;
    if (rows[0]?.ok !== true) {
      throw new EmployeeNotFoundError();
    }
    // NOTE: the audit payload must never carry the password or its hash
    // (SUPABASE_MIGRATION_TECH_APPENDIX §B.3) — only the fact and the effect.
    await executors(tx).audit.insertAudit({
      entityType: 'employee_credential',
      entityId: target,
      actorEmployeeId: actor.employeeId,
      action: 'admin_set_password',
      beforeJson: null,
      afterJson: { must_change_password: true, sessions_revoked: true },
      createdBy: actor.employeeId,
    });
  });
}

/**
 * clearMustChangePassword records a SUCCESSFUL self-service password change:
 * flips the forced-change gate on both tables and stamps `password_changed_at`.
 *
 * Called AFTER GoTrue has accepted the new password — never before, or a failed
 * GoTrue call would leave the gate open with the old password still live. The
 * `employee_credentials.password_hash` is deliberately left stale: GoTrue is the
 * authority now, and the importer only ever reads that column for employees who
 * have no `auth_user_id` yet.
 */
export async function clearMustChangePassword(sql: Sql, actor: Actor): Promise<void> {
  await withTransaction(sql, async (tx) => {
    await tx`select public.clear_must_change_password(${actor.employeeId})`;
    await executors(tx).audit.insertAudit({
      entityType: 'employee_credential',
      entityId: actor.employeeId,
      actorEmployeeId: actor.employeeId,
      action: 'change_password',
      beforeJson: null,
      afterJson: { must_change_password: false },
      createdBy: actor.employeeId,
    });
  });
}

/** One row of the credential-status list (B1's admin view). */
export interface CredentialInfo {
  employeeId: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  passwordChangedAt: Date | null;
}

/**
 * listCredentials returns credential status for the employees this admin may
 * manage: Director → all active; division Lead → own mapped division only.
 * Mirrors Go's ListCredentials, including the `[]`-not-null empty result.
 *
 * Privileged client: it joins `role_mappings` and `employee_credentials`, both
 * default-deny under RLS. The gate is enforced here.
 */
export async function listCredentials(sql: Queryable, actor: Actor): Promise<CredentialInfo[]> {
  if (!canManagePasswords(actor)) {
    throw new ForbiddenError();
  }
  // Director sees every active employee; a Lead is filtered to their division.
  // `${null}` for a Director makes the predicate a no-op without branching SQL.
  const scope = actor.role.director ? null : actor.role.division;
  const rows = await sql<
    {
      employee_id: string; nama: string; email: string; divisi: string; jabatan: string;
      has_password: boolean; must_change_password: boolean;
      locked_until: Date | null; password_changed_at: Date | null;
    }[]
  >`
    select e.employee_id, e.nama, e.email, e.divisi, e.jabatan,
           (c.employee_id is not null) as has_password,
           coalesce(c.must_change_password, false) as must_change_password,
           c.locked_until, c.password_changed_at
      from employees e
      left join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
      left join employee_credentials c on c.employee_id = e.employee_id
     where e.status_aktif
       and (${scope}::text is null or rm.division = ${scope})
     order by e.employee_id`;
  return rows.map((r) => ({
    employeeId: r.employee_id,
    nama: r.nama,
    email: r.email,
    divisi: r.divisi,
    jabatan: r.jabatan,
    hasPassword: r.has_password,
    mustChangePassword: r.must_change_password,
    lockedUntil: r.locked_until,
    passwordChangedAt: r.password_changed_at,
  }));
}
