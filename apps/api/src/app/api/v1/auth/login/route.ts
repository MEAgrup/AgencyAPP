/**
 * POST /api/v1/auth/login — email/password → session cookie + MeResponse.
 *
 * The BFF exchange: take the browser's credentials, trade them with Supabase
 * GoTrue for a JWT (server-side, so the anon key/tokens never reach the client),
 * resolve the actor from that JWT's CDPS claims, load the employee profile, and
 * hand the browser an httpOnly session cookie. Bad credentials surface as 401
 * with `[email atau password salah]`; missing fields as 400 with the default
 * incomplete BI string.
 */
import { auth } from '@cdps/domain';
import { actorFromToken, sessionCookie } from '@/lib/auth';
import { passwordGrant } from '@/lib/gotrue';
import { db } from '@/lib/db';
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

    let me;
    try {
      me = await auth.getMe(db(), actor);
    } catch (err) {
      if (err instanceof auth.NotFoundError) {
        throw new UnauthorizedError('[sesi tidak valid, silahkan login kembali]');
      }
      throw err;
    }

    const res = json(me);
    res.headers.append('Set-Cookie', sessionCookie(session.access_token, session.expires_in));
    return res;
  });
}
