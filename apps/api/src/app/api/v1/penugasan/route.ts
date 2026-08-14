/**
 * /api/v1/penugasan — Penugasan Internal (`TSK-`).
 *
 * GET:  the tasks the actor may see (own / division / everywhere), newest due
 *       date first. Filters: ?assignee=&division=&status=&terlambat=1.
 * POST: hand out one task — Director, or a division Lead/SPV to their own staff.
 *       Body: { judul, deskripsi?, assignee_id, due_date, lampiran_link? }.
 *
 * Incomplete/invalid → 400 with the exact BI message, Forbidden → 403.
 */
import { internaltask } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { internalTaskToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const q = new URL(request.url).searchParams;
    const rows = await readAsActor(actor, (sql) =>
      internaltask.listTasks(sql, actor, {
        assignee: q.get('assignee') ?? '',
        division: q.get('division') ?? '',
        status: q.get('status') ?? '',
        hanyaTerlambat: q.get('terlambat') === '1',
      }));
    return json({ data: rows.map(internalTaskToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<{
      judul?: string; deskripsi?: string; assignee_id?: string;
      due_date?: string; lampiran_link?: string;
    }>(request);
    const t = await internaltask.createTask(db(), actor, {
      judul: b.judul ?? '',
      deskripsi: b.deskripsi ?? '',
      assigneeId: b.assignee_id ?? '',
      dueDate: b.due_date ?? '',
      lampiranLink: b.lampiran_link ?? '',
    });
    return json(internalTaskToWire(t), 201);
  });
}
