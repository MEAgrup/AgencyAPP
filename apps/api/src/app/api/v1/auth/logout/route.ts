/**
 * POST /api/v1/auth/logout — clears the session cookie (and best-effort revokes
 * the GoTrue session). Always returns 200 with a cleared cookie, even if the
 * server-side revoke fails or Supabase is unconfigured — logout must never leave
 * the browser holding a live cookie.
 */
import { clearedSessionCookie, cookieValue, SESSION_COOKIE } from '@/lib/auth';
import { signOut } from '@/lib/gotrue';
import { handle, json } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) {
      try {
        await signOut(token);
      } catch {
        // best-effort; the cookie is cleared regardless
      }
    }
    const res = json({ ok: true });
    res.headers.append('Set-Cookie', clearedSessionCookie());
    return res;
  });
}
