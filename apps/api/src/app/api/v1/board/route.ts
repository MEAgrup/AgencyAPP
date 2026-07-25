/** GET /api/v1/board?client={id} — the Client Board: all Briefs grouped by Universal Column (M11 §5.3). */
import { dependency } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { cardToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const url = new URL(request.url);
    const cards = await dependency.clientBoard(db(), actor, url.searchParams.get('client') ?? '');
    return json({ data: cards.map(cardToWire) });
  });
}
