/**
 * POST /api/v1/auth/client-portal/forgot-password — M15-C2: self-service
 * password-reset REQUEST (spec §3.3 jalur 2). The first self-service email
 * flow anywhere in CDPS — the employee realm deliberately has none
 * (DECISIONS 2026-07-19, "tanpa jalur self-service/email — reset dilakukan
 * admin"), and LT-61 vendor has none either.
 *
 * Realm boundary enforcement lives HERE, not in GoTrue: `email` is looked up
 * against `client_contacts` first (`findClientContactByEmailForReset`), and
 * GoTrue's `recover` endpoint is only called when that resolves — an
 * employee's or vendor's email never reaches GoTrue's recover call through
 * this route at all, so this cannot be used to bypass the employee realm's
 * admin-only reset decision.
 *
 * ALWAYS responds `{ status: 'ok' }` regardless of whether the email matched
 * anything (spec §5.3 non-disclosure) — the response is identical whether an
 * email was actually sent or not, by construction, not by convention.
 *
 * `CLIENT_PORTAL_URL` (server env) builds the redirect target GoTrue sends
 * the recovery link to; it must also be listed in the Supabase project's
 * allowed redirect URLs (Dashboard → Auth → URL Configuration) — an infra
 * prerequisite this code cannot configure. Email delivery itself additionally
 * requires SMTP configured on the project (same prerequisite, spec §3.3).
 */
import { clientPortalAuth } from '@cdps/domain';
import { db } from '@/lib/db';
import { requestPasswordRecovery } from '@/lib/gotrue';
import { BadRequestError, handle, json, readJson } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson<{ email?: string }>(request);
    const email = body.email?.trim() ?? '';
    if (email === '') {
      throw new BadRequestError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    }

    const authUserId = await clientPortalAuth.findClientContactByEmailForReset(db(), email);
    if (authUserId !== null) {
      const portalUrl = process.env.CLIENT_PORTAL_URL ?? '';
      const redirectTo = `${portalUrl.replace(/\/$/, '')}/reset-password`;
      await requestPasswordRecovery(email, redirectTo);
    }

    return json({ status: 'ok' });
  });
}
