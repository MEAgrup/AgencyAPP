/**
 * GET /api/v1/board?client={id} — M11 §5.3 Client Board: every Brief of one Client
 * as a Card, with its Universal Column + Dependency badge (derived on read). Read
 * scope: AM/SPV/OD/Director see any Client; a staff member only a Client where they
 * PIC a unit. Ports Go's handleClientBoard.
 */
import { board } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { cardToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const client = new URL(request.url).searchParams.get('client') ?? '';
    const cards = await readAsActor(actor, (sql) => board.clientBoard(sql, actor, client));
    return json({ data: cards.map(cardToWire) });
  });
}
