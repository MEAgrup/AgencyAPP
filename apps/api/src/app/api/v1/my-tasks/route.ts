/** GET /api/v1/my-tasks?employee={id} — the actor's own work units across Clients (M11 §5.4). */
import { dependency } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { cardToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const url = new URL(request.url);
    const cards = await dependency.myTasks(db(), actor, url.searchParams.get('employee') ?? '');
    return json({ data: cards.map(cardToWire) });
  });
}
