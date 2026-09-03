/**
 * MEA SKU Screener — Modul D Optimization Tracker (SC-08).
 *
 *  - GET  /api/v1/skuscreener/runs/{id}/tracker — every tracker row of this screening run.
 *  - POST /api/v1/skuscreener/runs/{id}/tracker — D1/D2: create one row (`before_*` only).
 *    `after_*`/verdict are filled in later via `.../tracker/{productCode}/after`.
 */
import { skuscreener } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { trackerRowToWire } from '@/lib/wire';

interface CreateTrackerWire {
  client_id?: string;
  product_code?: string | null;
  product_name?: string;
  change_date?: string;
  initial_route?: string;
  change_type?: string;
  before?: { views: number; clicks: number; ctr: number; cr: number; orders: number };
  notes?: string | null;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await skuscreener.listTrackerRows(db(), actor, id);
    return json({ data: rows.map(trackerRowToWire) });
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<CreateTrackerWire>(request);
    const d = await skuscreener.createTrackerRow(db(), actor, {
      screeningId: id,
      clientId: b.client_id ?? '',
      productCode: b.product_code ?? null,
      productName: b.product_name ?? '',
      changeDate: b.change_date ?? '',
      initialRoute: b.initial_route ?? '',
      changeType: (b.change_type ?? '') as skuscreener.CreateTrackerInput['changeType'],
      before: b.before ?? { views: 0, clicks: 0, ctr: 0, cr: 0, orders: 0 },
      notes: b.notes ?? null,
    });
    return json(trackerRowToWire(d), 201);
  });
}
