/**
 * /api/v1/sales/targets — Kinerja Sales View 4 (target/OKR), M0 §7.1 "OD
 * inputs/manages Sales OKR".
 *
 * GET: every configured target for one month bucket (`?period_start=YYYY-MM-01`,
 * defaults to the current WIB month), scope-gated same as the performance
 * views (Sales staff sees only their own row).
 *
 * PUT: upsert one target (Sales Lead/SPV, OD, or Director only —
 * `salesperf.canManageTarget`); appended to the immutable audit_log. Writes go
 * through the service-role connection + the TS gate (config table, not RLS
 * WITH CHECK) — same pattern as `performance/config/targets`.
 */
import { tz } from '@cdps/core';
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { salesTargetToWire } from '@/lib/wire';

function defaultMonthStart(now: Date): string {
  const period = tz.period(now); // "YYYYMM"
  return `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const url = new URL(request.url);
    const periodStart = url.searchParams.get('period_start') ?? defaultMonthStart(new Date());
    const targets = await readAsActor(actor, (sql) => salesperf.listTargets(sql, actor, periodStart));
    return json({ data: targets.map(salesTargetToWire) });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<{
      salesperson_id?: string;
      period_start?: string;
      period_kind?: string;
      target_omzet?: string;
    }>(request);
    await salesperf.setTarget(db(), actor, {
      salespersonId: b.salesperson_id ?? '',
      periodStart: b.period_start ?? '',
      periodKind: b.period_kind ?? '',
      targetOmzet: b.target_omzet ?? '',
    });
    return json({ ok: true });
  });
}
