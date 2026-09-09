/**
 * /api/v1/creative/scs/tasks/{id} — satu baris pekerjaan.
 *
 * GET    baris + angka turunannya (turnaround, Speed Score, jumlah revisi),
 *        yang SEMUANYA dihitung ulang dari `audit_log` — nol kolom jangkar.
 * PUT    sunting RENCANA-nya, HANYA selama `[To Do]`.
 * DELETE cabut baris yang salah catat, HANYA selama `[To Do]`. Ini pengganti
 *        edge pembatalan yang mesin #34 sengaja tidak punya.
 *
 * Status TIDAK punya jalur di sini — ia bergerak lewat `/transition`, dengan
 * gerbang perannya sendiri. Memisahkannya adalah yang membuat status tidak bisa
 * digeser lewat pintu sunting.
 */
import { scs } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { scsMetricsToWire, scsTaskToWire, toScsTaskInput } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const { row, metrics } = await readAsActor(actor, async (sql) => ({
      row: await scs.getScsTask(sql, actor, id),
      metrics: await scs.scsTaskMetrics(sql, actor, id),
    }));
    return json({ task: scsTaskToWire(row), metrics: scsMetricsToWire(metrics) });
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toScsTaskInput>[0]>(request);
    const row = await scs.updateScsTask(db(), actor, id, toScsTaskInput(b ?? {}));
    return json(scsTaskToWire(row));
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await scs.deleteScsTask(db(), actor, id);
    return json({ ok: true });
  });
}
