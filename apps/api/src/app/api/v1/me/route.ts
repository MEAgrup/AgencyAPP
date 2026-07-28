/**
 * GET /api/v1/me — the current session's employee profile + resolved role.
 *
 * Resolves the actor from the session cookie (or bearer token), then loads the
 * employee profile. A valid token whose employee no longer exists/active is a
 * dead session → 401 with the BI string. web-internal's auth-context calls this
 * on load to hydrate the session.
 */
import { auth } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json, UnauthorizedError } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    try {
      const me = await readAsActor(actor, (sql) => auth.getMe(sql, actor));
      return json(me);
    } catch (err) {
      if (err instanceof auth.NotFoundError) {
        throw new UnauthorizedError('[sesi tidak valid, silahkan login kembali]');
      }
      throw err;
    }
  });
}
