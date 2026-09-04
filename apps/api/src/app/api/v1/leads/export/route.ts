/**
 * GET /api/v1/leads/export — CSV export of the Leads Database (E1, `docs/
 * backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md` Bagian 2).
 *
 * Director-only (keputusan pemilik: dibuka untuk SEMUA Director — Yohan,
 * Nerissa, Hans — bukan kunci per-email). A SEPARATE route from `GET
 * /leads`, deliberately: that route is the hot read path every sales staff
 * hits on every page render, and gating it behind Director-only or making
 * its response type conditional on a query param are both things a hot path
 * should never carry.
 *
 * Reads through the SAME `leads.leadsDatabase` as `GET /leads`, inside
 * `readAsActor`, with the SAME filter params (`status`/`q`/`source`/`mine`)
 * — RLS applies identically (export can never show more than the screen
 * already can), and the file always matches the table above it. Buffered,
 * not streamed: `readAsActor` commits when `fn` returns, so a `ReadableStream`
 * that outlives the callback would read outside the RLS transaction.
 */
import { tz } from '@cdps/core';
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { readAsActor } from '@/lib/db';
import { BadRequestError, handle } from '@/lib/http';

/**
 * Row cap — an explicit 400 with a BI message that says to narrow the
 * filter, rather than silently truncating a feature named "export the whole
 * database". *Perlu dikonfirmasi Nerissa* (docs/backlog/
 * REVISI_CDPS_SALES_CREATIVE_PERFORMA.md, "Perlu dikonfirmasi" #1) — 50.000
 * is the plan's proposed number, not a signed-off one.
 */
export const EXPORT_ROW_CAP = 50_000;
export const MSG_EXPORT_TOO_LARGE =
  '[hasil terlalu banyak untuk diekspor (maksimal 50.000 baris), silahkan persempit filter!]';

const HEADER = [
  'id', 'lead_name', 'phone_number', 'email', 'source', 'origin_division',
  'origin_campaign_id', 'last_touch_campaign_id', 'record_status',
  'winning_attempt_id', 'created_at', 'open_attempt_count',
] as const;

function rowToCsvCells(r: leads.LeadsDbRow): string[] {
  return [
    r.id, r.leadName, r.phoneNumber, r.email ?? '', r.source, r.originDivision,
    r.originCampaignId ?? '', r.lastTouchCampaignId ?? '', r.recordStatus,
    r.winningAttemptId ?? '', tz.dateTimeString(r.createdAt), String(r.openAttemptCount),
  ];
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!actor.role.director) {
      throw new leads.ForbiddenError();
    }

    const params = new URL(request.url).searchParams;
    const mine = params.get('mine');
    const rows = await readAsActor(actor, (sql) => leads.leadsDatabase(sql, {
      status: params.get('status') ?? undefined,
      q: params.get('q') ?? undefined,
      source: params.get('source') ?? undefined,
      mineEmployeeId: mine ? actor.employeeId : undefined,
      mineMode: leads.parseMineMode(mine),
    }));
    if (rows.length > EXPORT_ROW_CAP) {
      throw new BadRequestError(MSG_EXPORT_TOO_LARGE);
    }

    const csv = toCsv(HEADER, rows.map(rowToCsvCells));
    const filename = `leads-database-${tz.dateString(new Date())}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  });
}
