/**
 * /api/v1/strategi/{id}/share-link — the internal control over the client link
 * A-11 (§7 D20). Three verbs, one resource:
 *
 *   GET    — the current status (no secret), for the Strategi page.
 *   POST   — mint (or rotate) the link; the plaintext token is in the response
 *            body ONCE and never again (`shareTokenCreatedToWire`).
 *   DELETE — revoke instantly (§7 "AM or SPV can revoke instantly").
 *
 * The public render lives elsewhere (`/s/{token}`), unauthenticated by design —
 * the token is the credential. This file is the authenticated half; the domain
 * enforces AM-owner / Account-lead on POST and DELETE and read-scope on GET.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { shareLinkStatusToWire, shareTokenCreatedToWire } from '@/lib/wire';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const status = await strategi.getShareLinkStatus(db(), actor, id);
    return json(shareLinkStatusToWire(status));
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const made = await strategi.createShareToken(db(), actor, id);
    return json(shareTokenCreatedToWire(made));
  });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const status = await strategi.revokeShareToken(db(), actor, id);
    return json(shareLinkStatusToWire(status));
  });
}
