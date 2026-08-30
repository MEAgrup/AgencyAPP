/**
 * GET /api/v1/vendor/me — LT-61: the calling vendor's own profile. The
 * vendor-realm counterpart to `GET /me` (employee profile) — kept as its own
 * endpoint rather than a branch inside `/me`, since `auth.getMe`'s contract is
 * specifically "the employee profile" (see its docstring) and a vendor Actor
 * has no row in `employees` to read. web-internal's vendor route group calls
 * this to hydrate/revalidate its session, the same way the internal
 * auth-context calls `/me`.
 *
 * An employee caller (valid session, wrong realm) gets 403
 * `[akun ini bukan akun vendor]`, not 401 — the session itself is fine.
 */
import { auth } from '@cdps/domain';
import { permission } from '@cdps/core';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json, UnauthorizedError } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!permission.isVendorActor(actor)) {
      throw new auth.ForbiddenError(auth.MSG_NOT_VENDOR_ACCOUNT);
    }
    try {
      const vendor = await readAsActor(actor, (sql) => auth.getVendorMe(sql, actor));
      return json({ vendor });
    } catch (err) {
      if (err instanceof auth.NotFoundError) {
        throw new UnauthorizedError('[sesi tidak valid, silahkan login kembali]');
      }
      throw err;
    }
  });
}
