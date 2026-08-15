/**
 * GET /api/v1/penugasan/rekap — Rekap Disiplin Penugasan, per PIC.
 *
 * A REPORT, not an M14 score: the owner chose "catat + dashboard terpisah"
 * (DECISIONS 2026-08-14), so nothing here feeds `PERF-`. Scope is identical to
 * `GET /penugasan` — the summary can never disagree with the list it summarises.
 *
 * Static segment, so it resolves ahead of `[id]`; a task id is always `TSK-…`
 * and can never collide with the literal "rekap".
 */
import { internaltask } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { disciplineRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const q = new URL(request.url).searchParams;
    const rows = await readAsActor(actor, (sql) =>
      internaltask.disciplineSummary(sql, actor, {
        assignee: q.get('assignee') ?? '',
        division: q.get('division') ?? '',
      }));
    return json({ data: rows.map(disciplineRowToWire) });
  });
}
