/**
 * POST /api/v1/auth/login — email/password → session cookie + MeResponse (or,
 * for a Live Stream vendor, `{ vendor }`).
 *
 * The BFF exchange: take the browser's credentials, trade them with Supabase
 * GoTrue for a JWT (server-side, so the anon key/tokens never reach the client),
 * resolve the actor from that JWT's CDPS claims, load the profile, and hand the
 * browser an httpOnly session cookie. Bad credentials surface as 401 with
 * `[email atau password salah]`; missing fields as 400 with the default
 * incomplete BI string.
 *
 * LT-61: one login endpoint serves both realms (owner decision — branch here
 * rather than a second `POST /vendor/auth/login`, per
 * docs/handoff/HANDOFF_LT61_CORE_SELESAI_FE_VENDOR_20260830.md §2/§3.4). Before
 * this branch, a vendor with a correct password still got a 401: `auth.getMe`
 * always queried `employees` by `actor.employeeId`, which for a vendor Actor
 * holds `vendors.id` — a row that table does not have. `permission.isVendorActor`
 * is checked BEFORE `auth.getMe` runs, so a vendor never hits that query at all.
 */
import { auth } from '@cdps/domain';
import { permission } from '@cdps/core';
import { actorFromToken, sessionCookie } from '@/lib/auth';
import { passwordGrant } from '@/lib/gotrue';
import { readAsActor } from '@/lib/db';
import { BadRequestError, handle, json, readJson, UnauthorizedError } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = body.email?.trim() ?? '';
    const password = body.password ?? '';
    if (!email || !password) {
      throw new BadRequestError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    }

    const session = await passwordGrant(email, password);
    const secret = process.env.SUPABASE_JWT_SECRET ?? '';
    const actor = actorFromToken(session.access_token, secret);

    let profile: unknown;
    try {
      // Same scoped read as GET /me / GET /vendor/me: the token is already
      // verified, so the profile lookup runs under RLS (self-read) rather than
      // as service role.
      profile = permission.isVendorActor(actor)
        ? { vendor: await readAsActor(actor, (sql) => auth.getVendorMe(sql, actor)) }
        : await readAsActor(actor, (sql) => auth.getMe(sql, actor));
    } catch (err) {
      if (err instanceof auth.NotFoundError) {
        throw new UnauthorizedError('[sesi tidak valid, silahkan login kembali]');
      }
      throw err;
    }

    const res = json(profile);
    res.headers.append('Set-Cookie', sessionCookie(session.access_token, session.expires_in));
    return res;
  });
}
