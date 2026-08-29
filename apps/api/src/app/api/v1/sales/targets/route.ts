/**
 * /api/v1/sales/targets — Kinerja Sales View 4 (Sales OKR, M0 §7.1).
 *
 * GET ?period_start=YYYY-MM-DD: every target for that period bucket, scoped
 * like the rest of Kinerja Sales (staff = own row, lead/SPV = division, OD/
 * Director = all).
 *
 * PUT: upsert one salesperson's target for one period. OD/Director only —
 * Sales itself never writes its own OKR (M0 §7.1: "OD inputs/manages Sales
 * OKR"). Appended to the immutable audit_log.
 */
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { salesTargetToWire, toSetTargetInput } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const periodStart = new URL(request.url).searchParams.get('period_start');
    if (periodStart === null || periodStart === '') {
      throw new salesperf.ValidationError();
    }
    const list = await readAsActor(actor, (sql) => salesperf.listTargets(sql, actor, periodStart));
    return json({ data: list.map(salesTargetToWire) });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<{
      salesperson_id?: string; period_start?: string; period_kind?: string; target_omzet?: string;
    }>(request);
    await salesperf.setTarget(db(), actor, toSetTargetInput(body));
    return json({ ok: true });
  });
}
