/**
 * Auth read model — the `/me` surface consumed by web-internal's auth-context.
 *
 * CDPS auth itself is owned by Supabase GoTrue (password login issues the JWT;
 * our custom_access_token_hook injects the five CDPS claims — see
 * supabase/migrations/20260102000004_supabase_auth.sql). The @cdps/api route
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
import { permission } from '@cdps/core';
import { type Queryable } from '@cdps/db';

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
