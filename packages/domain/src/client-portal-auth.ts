/**
 * M15-C2 Client Portal — the client-contact account realm (auth cluster).
 * Spec: docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md (RESOLVED 2026-08-31).
 *
 * Mirrors two existing modules at once, because `client_contacts` needs both
 * from its FIRST version (LT-61 vendor never built force-change/self-service;
 * the employee realm built its two password-management migrations weeks
 * apart):
 *   - packages/domain/src/vendor.ts "Vendor accounts" section — the
 *     provisioning/list/deactivate-reactivate admin-UI shape.
 *   - packages/domain/src/auth.ts — the password POLICY (reused directly,
 *     not duplicated: `validatePassword` is imported, not re-implemented)
 *     and the force-change gate shape.
 *
 * One deliberate difference from vendor: a Client can have MANY contacts
 * (M15 Rule 1, confirmed multi-contact), so "may manage/read" is not a flat
 * actor-only gate the way `canManageVendor` is — it also depends on WHICH
 * Client a given contact belongs to (spec §3.2: AM may manage contacts only
 * for Clients they are assigned — `clients.assigned_am_id` — Account
 * lead/Director may manage any Client's contacts).
 */
import bcrypt from 'bcryptjs';
import { permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import { validatePassword } from './auth';
import { BCRYPT_COST, DEFAULT_TEMP_PASSWORD } from './employees';

// --- BI messages. M15 doc has no error strings of its own, so these follow
// the house convention (CLAUDE.md #5) and the LT-61/vendor precedent. ---

/** Mandatory fields missing — the house default (CLAUDE.md #5). */
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
/** Actor is not the assigned AM for this Client / Account lead / Director. */
export const MSG_CONTACT_FORBIDDEN = '[anda tidak memiliki akses untuk mengelola kontak klien ini]';
/** The `client_id` does not resolve. */
export const MSG_CLIENT_NOT_FOUND = '[client tidak ditemukan]';
/** No `client_contacts` row for this auth_user_id (status-toggle/reset target). */
export const MSG_CONTACT_NOT_FOUND = '[kontak klien tidak ditemukan]';
/** The email is already the login for a different account (employee, vendor, or another contact). */
export const MSG_CONTACT_EMAIL_EXISTS = '[email tersebut sudah digunakan akun lain]';
/** The calling Actor is not a Client Portal contact (wrong-realm surface). */
export const MSG_NOT_CLIENT_CONTACT = '[akun ini bukan akun kontak klien]';

// ---------------------------------------------------------------------------
// Permission (spec §3.2, §5 "Larangan lintas-surface")
// ---------------------------------------------------------------------------

/**
 * canManageAllClientContacts: Account lead / Head of Account, or a Director —
 * may manage ANY Client's contacts, mirroring `vendor.canManageVendor`'s
 * shape exactly. An AM without lead/director authority still passes the
 * NARROWER per-record check (`canManageOneClientContact`) for their OWN
 * assigned Clients only — that check is NOT this function.
 */
export function canManageAllClientContacts(actor: Actor): boolean {
  return actor.role.director || permission.isLead(actor, ACCOUNT_DIVISION);
}

/** Director/OD/Account-lead may READ the full contact roster. OD is read-only. */
export function canReadAllClientContacts(actor: Actor): boolean {
  return canManageAllClientContacts(actor) || actor.role.od;
}

/**
 * canManageOneClientContact: the per-record gate (spec §3.2) — Account
 * lead/Director (any Client) OR the AM assigned to THIS Client
 * (`clients.assigned_am_id`, own-Client only). Distinct from
 * `canManageAllClientContacts`: an AM with no lead/director authority still
 * passes this for a Client they are assigned to.
 */
export function canManageOneClientContact(actor: Actor, assignedAmId: string | null): boolean {
  return canManageAllClientContacts(actor) || (assignedAmId !== null && assignedAmId === actor.employeeId);
}

// ---------------------------------------------------------------------------
// Admin roster (list / provision / deactivate-reactivate / admin reset)
// ---------------------------------------------------------------------------

/** One row of the admin client-contacts screen. */
export interface ClientContactRow {
  authUserId: string;
  clientId: string;
  namaKlien: string;
  nama: string;
  email: string | null;
  statusAktif: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  createdBy: string;
}

interface ClientContactDbRow {
  auth_user_id: string;
  client_id: string;
  nama_klien: string;
  assigned_am_id: string | null;
  nama: string;
  email: string | null;
  status_aktif: boolean;
  must_change_password: boolean;
  created_at: string | Date;
  created_by: string;
}

function rowToClientContact(r: ClientContactDbRow): ClientContactRow {
  return {
    authUserId: r.auth_user_id,
    clientId: r.client_id,
    namaKlien: r.nama_klien,
    nama: r.nama,
    email: r.email,
    statusAktif: r.status_aktif,
    mustChangePassword: r.must_change_password,
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by,
  };
}

/**
 * listClientContacts returns every contact the actor may see: Director/
 * Account-lead/OD see the full roster; an AM sees only contacts for Clients
 * they are assigned (`clients.assigned_am_id`). Unlike `vendor.listVendorAccounts`
 * (flat actor-only gate), scope here is per-row — so this never throws
 * `ForbiddenError` for a plain AM, it simply returns their own slice (an AM
 * with no assigned Clients at all gets `[]`, not a 403).
 */
export async function listClientContacts(sql: Sql, actor: Actor): Promise<ClientContactRow[]> {
  const rows = await sql<ClientContactDbRow[]>`select * from list_client_contacts() order by created_at desc`;
  const scoped = canReadAllClientContacts(actor)
    ? rows
    : rows.filter((r) => r.assigned_am_id !== null && r.assigned_am_id === actor.employeeId);
  return scoped.map(rowToClientContact);
}

/** Input for provisioning one client contact's login account. */
export interface ProvisionClientContactInput {
  clientId: string;
  nama: string;
  email: string;
  /** Optional initial temp password; blank => employees.ts DEFAULT_TEMP_PASSWORD. */
  tempPassword?: string;
}

/** lockClient selects FOR UPDATE so a concurrent AM-reassignment cannot race the gate check. */
async function lockClientAssignment(
  sql: Queryable,
  clientId: string,
): Promise<{ id: string; toko: string; assignedAmId: string | null }> {
  const rows = await sql<{ id: string; toko: string; assigned_am_id: string | null }[]>`
    select id, toko, assigned_am_id from clients where id = ${clientId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  }
  return { id: rows[0].id, toko: rows[0].toko, assignedAmId: rows[0].assigned_am_id };
}

/** True for a Postgres unique-violation (SQLSTATE 23505). Mirror of vendor.ts. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

/**
 * provisionClientContact mints a login for one invited contact: a GoTrue
 * `auth.users` + `auth.identities` row (via `provision_client_contact`,
 * mirroring `provision_vendor_account`'s direct-bcrypt-import shape — apps/api
 * has no service-role key, so this SQL path is the only way to create a
 * GoTrue user) plus the `client_contacts` link row, in one transaction.
 * `must_change_password` starts true (spec §3.2/§3.6 force-change gate).
 */
export async function provisionClientContact(
  sql: Sql,
  actor: Actor,
  input: ProvisionClientContactInput,
): Promise<ClientContactRow> {
  const clientId = (input.clientId ?? '').trim();
  const nama = (input.nama ?? '').trim();
  const email = (input.email ?? '').trim().toLowerCase();
  if (clientId === '' || nama === '' || email === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const target = await lockClientAssignment(tx, clientId);
    if (!canManageOneClientContact(actor, target.assignedAmId)) {
      throw new ForbiddenError(MSG_CONTACT_FORBIDDEN);
    }

    const temp = (input.tempPassword ?? '').trim() || DEFAULT_TEMP_PASSWORD;
    const hash = bcrypt.hashSync(temp, BCRYPT_COST);

    let authUserId: string;
    try {
      const rows = await tx<{ id: string }[]>`
        select provision_client_contact(${clientId}, ${nama}, ${email}, ${hash}, ${actor.employeeId}) as id`;
      authUserId = rows[0]!.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(MSG_CONTACT_EMAIL_EXISTS);
      }
      throw err;
    }

    await ex.audit.insertAudit({
      entityType: 'client_contact',
      entityId: authUserId,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { client_id: clientId, email, status_aktif: true },
      createdBy: actor.employeeId,
    });

    return {
      authUserId,
      clientId,
      namaKlien: target.toko,
      nama,
      email,
      statusAktif: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      createdBy: actor.employeeId,
    };
  });
}

/** locateContact resolves a client_contacts row + its Client's assigned AM, FOR UPDATE. */
async function locateContact(
  sql: Queryable,
  authUserId: string,
): Promise<{ clientId: string; assignedAmId: string | null; statusAktif: boolean }> {
  const rows = await sql<{ client_id: string; status_aktif: boolean }[]>`
    select client_id, status_aktif from client_contacts where auth_user_id = ${authUserId}::uuid for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_CONTACT_NOT_FOUND);
  }
  const client = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${rows[0].client_id}`;
  return {
    clientId: rows[0].client_id,
    assignedAmId: client[0]?.assigned_am_id ?? null,
    statusAktif: rows[0].status_aktif,
  };
}

/**
 * setClientContactStatus deactivates/reactivates one contact's login (+
 * audit), driving `set_client_contact_status` (mirror of
 * `set_vendor_account_status`). Never deletes the row — a mistaken
 * deactivation must be reversible, and complaint-submission history stays
 * attributed to this contact's id regardless (house convention #3).
 */
export async function setClientContactStatus(
  sql: Sql,
  actor: Actor,
  authUserId: string,
  statusAktif: boolean,
): Promise<void> {
  const id = (authUserId ?? '').trim();
  if (id === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const target = await locateContact(tx, id);
    if (!canManageOneClientContact(actor, target.assignedAmId)) {
      throw new ForbiddenError(MSG_CONTACT_FORBIDDEN);
    }
    await tx`select set_client_contact_status(${id}::uuid, ${statusAktif})`;
    await ex.audit.insertAudit({
      entityType: 'client_contact',
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: statusAktif ? 'reactivate' : 'deactivate',
      beforeJson: { status_aktif: target.statusAktif },
      afterJson: { status_aktif: statusAktif },
      createdBy: actor.employeeId,
    });
  });
}

/**
 * adminResetClientContactPassword sets a NEW temporary password for an
 * existing contact (spec §3.3 jalur 1 — always available, no email
 * dependency) and forces a change at next login. Same authority as managing
 * the contact itself (`canManageOneClientContact`).
 */
export async function adminResetClientContactPassword(
  sql: Sql,
  actor: Actor,
  authUserId: string,
  tempPassword: string,
): Promise<void> {
  const id = (authUserId ?? '').trim();
  const temp = (tempPassword ?? '').trim() || DEFAULT_TEMP_PASSWORD;
  if (id === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  validatePassword(temp);
  const hash = bcrypt.hashSync(temp, BCRYPT_COST);
  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const target = await locateContact(tx, id);
    if (!canManageOneClientContact(actor, target.assignedAmId)) {
      throw new ForbiddenError(MSG_CONTACT_FORBIDDEN);
    }
    const rows = await tx<{ ok: boolean }[]>`
      select admin_reset_client_contact_password(${id}::uuid, ${hash}, ${actor.employeeId}) as ok`;
    if (rows[0]?.ok !== true) {
      throw new NotFoundError(MSG_CONTACT_NOT_FOUND);
    }
    // NOTE: never write the password/hash to the audit log (CLAUDE.md #3).
    await ex.audit.insertAudit({
      entityType: 'client_contact',
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'admin_reset_password',
      beforeJson: null,
      afterJson: { must_change_password: true, sessions_revoked: true },
      createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Self-service surface (the contact's own session — /portal/me,
// change-password, forgot-password)
// ---------------------------------------------------------------------------

/**
 * A contact's own profile, returned on the Portal `/me` surface (snake_case
 * wire contract — mirrors `auth.MeEmployee`/`VendorMe`: this IS the public
 * auth contract, not a shape `apps/api/src/lib/wire.ts` translates).
 */
export interface ClientContactMe {
  nama: string;
  email: string;
  client_id: string;
  nama_klien: string;
  must_change_password: boolean;
}

/**
 * getClientContactMe reads the calling contact's own row (+ Client name).
 * Takes the PRIVILEGED client deliberately: `client_contacts` is "internal
 * murni" (RLS on, zero grant to `authenticated` — same lock-down class as
 * `vendor_accounts`), so there is no open-read table to fall back to the way
 * `getVendorMe` falls back to `vendors` (open to every employee, but a client
 * contact is not an employee at all). The actor's identity was already
 * verified from the JWT before this runs — `WHERE auth_user_id = ...` is
 * server-controlled, never client input, so bypassing RLS here is safe, the
 * same reasoning the admin roster functions already rely on.
 *
 * Trusts the caller to have already confirmed `permission.isClientContactActor(actor)`
 * (mirrors `getMe`/`getVendorMe`, neither of which self-checks its own realm
 * either) — the dedicated `GET /portal/me` route makes that check explicit,
 * as `GET /vendor/me` does, and maps a wrong-realm caller to 403
 * `MSG_NOT_CLIENT_CONTACT` rather than the 404 this function throws for a
 * resolved-but-gone-or-deactivated contact.
 */
export async function getClientContactMe(sql: Queryable, actor: Actor): Promise<ClientContactMe> {
  const authUserId = actor.clientContactId ?? '';
  const rows = await sql<
    { nama: string; email: string; client_id: string; nama_klien: string; must_change_password: boolean }[]
  >`
    select cc.nama, cc.email, cc.client_id, cl.toko as nama_klien, cc.must_change_password
    from client_contacts cc
    join clients cl on cl.id = cc.client_id
    where cc.auth_user_id = ${authUserId}::uuid and cc.status_aktif = true`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_NOT_CLIENT_CONTACT);
  }
  return rows[0];
}

/**
 * clearClientContactMustChangePassword records a SUCCESSFUL self-service
 * password change (self-service change-password, or self-service
 * email-reset completion) — flips the force-change gate and stamps
 * `password_changed_at`. Called AFTER GoTrue has accepted the new password —
 * never before (mirrors `auth.clearMustChangePassword` exactly).
 */
export async function clearClientContactMustChangePassword(sql: Sql, actor: Actor): Promise<void> {
  if (!permission.isClientContactActor(actor)) {
    throw new NotFoundError(MSG_NOT_CLIENT_CONTACT);
  }
  const authUserId = actor.clientContactId ?? '';
  await withTransaction(sql, async (tx) => {
    await tx`select clear_client_contact_must_change_password(${authUserId}::uuid)`;
    await executors(tx).audit.insertAudit({
      entityType: 'client_contact',
      entityId: authUserId,
      actorEmployeeId: actor.employeeId,
      action: 'change_password',
      beforeJson: null,
      afterJson: { must_change_password: false },
      createdBy: actor.employeeId,
    });
  });
}

/**
 * requestClientContactPasswordReset resolves whether `email` belongs to an
 * ACTIVE client contact (spec §3.3 jalur 2 — self-service). Returns the
 * `auth_user_id` to send a GoTrue recovery email to, or `null`. The caller
 * (the API route) MUST behave identically either way (spec §5.3
 * non-disclosure) — this function only decides whether an email actually
 * goes out, never what the HTTP response says.
 */
export async function findClientContactByEmailForReset(sql: Sql, email: string): Promise<string | null> {
  const trimmed = (email ?? '').trim();
  if (trimmed === '') {
    return null;
  }
  const rows = await sql<{ id: string | null }[]>`
    select client_contact_auth_user_by_email(${trimmed}) as id`;
  return rows[0]?.id ?? null;
}
