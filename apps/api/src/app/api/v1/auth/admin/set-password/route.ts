/**
 * POST /api/v1/auth/admin/set-password — an admin sets a TEMPORARY password for
 * an employee (O44(c) part B1: the recovery path that needs no email). Ports
 * Go's handleAdminSetPassword.
 *
 * This is the answer to "lupa password" until self-service reset (B2) has an SMTP
 * provider: Director (anyone) or a division Lead (own division, never a layered
 * OD/Director target) sets a temp password, the forced-change gate is raised, the
 * target's GoTrue refresh tokens are deleted so old sessions die, and the
 * employee is made to change it at next login.
 *
 * All authorization + policy lives in the domain layer; the DB effect goes
 * through the `admin_set_employee_password` SECURITY DEFINER RPC, which is the
 * only thing that can write `auth.users` without a service-role key.
 */
import { auth } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<{ employee_id?: string; temp_password?: string }>(request);
    await auth.setPassword(db(), actor, body.employee_id ?? '', body.temp_password ?? '');
    return json({ status: 'ok' });
  });
}
