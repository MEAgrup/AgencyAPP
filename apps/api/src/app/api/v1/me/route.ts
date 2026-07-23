/**
 * GET /api/v1/me — the current session's identity.
 *
 * Resolves the Actor from the session cookie (or bearer token), then returns the
 * {employee, role, must_change_password} identity the web-internal AuthProvider
 * consumes. 401 when there is no valid session. Ports Go's handleMe.
 */
import { auth } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const mustChange = await auth.mustChangePassword(db(), actor.employeeId);
    const identity = await auth.loadIdentity(db(), actor.employeeId, mustChange);
    return json(identity);
  });
}
