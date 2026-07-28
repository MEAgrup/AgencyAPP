/**
 * GET /api/v1/daily-output/{picId} — M7 §7 Daily Output feed: one PIC's
 * auto-logged output for one WIB calendar day (a pure derived read-model over the
 * immutable audit log, W2-M7-C2). Optional `?date=YYYY-MM-DD` (default = today).
 * Read gate (§9.1): the PIC themselves, the Creative Team Leader, OD, or Director.
 * Ports Go's handleDailyOutput.
 *
 * Forbidden → 403, incomplete pic → 400 (verbatim BI), bad date → 400.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { dailyOutputToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ picId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { picId } = await ctx.params;

    let day = new Date();
    const q = new URL(request.url).searchParams.get('date');
    if (q) {
      // Match Go's time.Parse("2006-01-02", q): a strict calendar date read as UTC
      // midnight, which the domain then buckets to its WIB day.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q)) {
        throw new BadRequestError('[format data tidak valid]');
      }
      const parsed = new Date(`${q}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestError('[format data tidak valid]');
      }
      day = parsed;
    }

    const out = await readAsActor(actor, (sql) => creative.dailyOutput(sql, actor, picId, day));
    return json(dailyOutputToWire(out));
  });
}
