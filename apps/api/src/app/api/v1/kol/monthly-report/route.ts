/**
 * GET /api/v1/kol/monthly-report?coordinator=&year=&month= — the §9 Monthly KOL
 * Report rollup for one Coordinator + WIB month: total Bookings, QC pass rate,
 * average sourcing time, total spend (Σ Agreed Rate), and escalation count.
 *
 * `coordinator` defaults to the caller (a Coordinator's own report); `year`/`month`
 * default to the current month. Scope is enforced in the domain
 * (canSeeMonthlyReport): own / KOL lead / OD+Director. Runs on the service-role
 * client (db()) — the read is coordinator-scoped and aggregates over audit_log;
 * the in-app gate is the authority, same pattern as recap.getRecapDetail.
 */
import { kol } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { monthlyKolReportToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const url = new URL(request.url);
    const coordinator = url.searchParams.get('coordinator')?.trim() || actor.employeeId;
    const now = new Date();
    const year = Number(url.searchParams.get('year') ?? now.getUTCFullYear());
    const month = Number(url.searchParams.get('month') ?? now.getUTCMonth() + 1);
    const report = await kol.monthlyKolReport(db(), actor, coordinator, year, month);
    return json(monthlyKolReportToWire(report));
  });
}
