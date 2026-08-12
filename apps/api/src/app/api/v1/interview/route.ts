/**
 * /api/v1/interview
 *  - GET  ?client_id=… — the client's interview log (Account-scope), newest first.
 *  - POST — open a new Interview (ITV) for a client.
 *
 * The filler is the acting actor; only the client's assigned AM, an Account
 * lead/SPV (acting-for), or a Director may open one. The ID is minted only after
 * the client resolves and the permission check passes.
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json, readJson } from '@/lib/http';
import { interviewCreateFromWire, interviewDetailToWire, interviewListToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const clientId = new URL(request.url).searchParams.get('client_id');
    if (!clientId) throw new BadRequestError('client_id is required');
    const rows = await interview.listInterviewsByClient(db(), actor, clientId);
    return json({ data: interviewListToWire(rows) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<unknown>(request);
    const detail = await interview.createInterview(db(), actor, interviewCreateFromWire(b));
    return json(interviewDetailToWire(detail), 201);
  });
}
