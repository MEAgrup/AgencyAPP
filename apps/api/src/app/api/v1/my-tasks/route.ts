/**
 * GET /api/v1/my-tasks?employee={id} — M11 §5.4 My Tasks: the actor's own work
 * units across all Clients (Brief/Asset/Booking/Session) with Universal Columns.
 * Read scope is intrinsically "own"; OD/Director/Account-lead may pass ?employee=
 * to view that person's tasks. Ports Go's handleMyTasks.
 */
import { board } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { cardToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const employee = new URL(request.url).searchParams.get('employee') ?? '';
    const cards = await readAsActor(actor, (sql) => board.myTasks(sql, actor, employee));
    return json({ data: cards.map(cardToWire) });
  });
}
