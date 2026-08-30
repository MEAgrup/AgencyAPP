/**
 * GET /api/v1/sales/performance — Kinerja Sales (M0 §7.1), View 1 (REPORT
 * ACTIVITY AND CLOSING): one row per salesperson, closing rate / deal cycle /
 * commission — all derived from the immutable logs (house rule #4).
 *
 * `?from=&to=` are inclusive "YYYY-MM" bounds; omit both for "All Periode".
 * `?salesperson=` narrows to one employee (a Sales STAFF may only ever narrow
 * to themselves — `salesperf.scopeFor` enforces it, RLS S-01 backs it).
 * `?source=`/`?campaign=` mirror `leads.source`/`origin_campaign_id`.
 *
 * Shell only — every gate and derivation lives in `salesperf`.
 */
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { salesPerfRowToWire } from '@/lib/wire';

export function parseSalesPerfFilter(url: URL): salesperf.SalesPerfFilter {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  return {
    period: from !== null && to !== null && from !== '' && to !== '' ? { from, to } : null,
    salespersonId: url.searchParams.get('salesperson'),
    source: url.searchParams.get('source'),
    campaignId: url.searchParams.get('campaign'),
  };
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const filter = parseSalesPerfFilter(new URL(request.url));
    const rows = await readAsActor(actor, (sql) => salesperf.bySalesperson(sql, actor, filter));
    return json({ data: rows.map(salesPerfRowToWire) });
  });
}
