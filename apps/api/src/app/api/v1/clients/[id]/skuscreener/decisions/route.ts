/**
 * MEA SKU Screener — Modul C Decision Log (SC-08).
 *
 *  - GET  /api/v1/clients/{id}/skuscreener/decisions — the client's decision
 *    log, newest first.
 *  - POST /api/v1/clients/{id}/skuscreener/decisions — append one decision
 *    (R13, append-only — there is no PATCH/DELETE route for this entity).
 */
import { skuscreener } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { decisionLogEntryToWire } from '@/lib/wire';

interface LogDecisionWire {
  screening_id?: string | null;
  advertiser_id?: string | null;
  platform?: string;
  object_type?: string;
  object_name?: string;
  momen?: string;
  sop_stage?: string;
  decision?: string;
  metric_key?: string;
  metric_value?: number;
  metric_target?: number;
  spend_7d?: number | null;
  gmv_7d?: number | null;
  verdict?: string | null;
  reviews_decision_id?: string | null;
  data_pendukung?: { klik: number; konversi: number; hari_jalan: number } | null;
  notes?: string | null;
}

function toInput(clientId: string, b: LogDecisionWire): skuscreener.LogDecisionInput {
  return {
    clientId,
    screeningId: b.screening_id ?? null,
    advertiserId: b.advertiser_id ?? null,
    platform: b.platform ?? '',
    objectType: b.object_type ?? '',
    objectName: b.object_name ?? '',
    momen: b.momen ?? '',
    sopStage: b.sop_stage ?? '',
    decision: b.decision ?? '',
    metricKey: b.metric_key ?? '',
    metricValue: Number(b.metric_value ?? NaN),
    metricTarget: Number(b.metric_target ?? NaN),
    spend7d: b.spend_7d ?? null,
    gmv7d: b.gmv_7d ?? null,
    verdict: b.verdict ?? null,
    reviewsDecisionId: b.reviews_decision_id ?? null,
    dataPendukung: b.data_pendukung
      ? { klik: b.data_pendukung.klik, konversi: b.data_pendukung.konversi, hariJalan: b.data_pendukung.hari_jalan }
      : null,
    notes: b.notes ?? null,
  };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await skuscreener.listDecisions(db(), actor, id);
    return json({ data: rows.map(decisionLogEntryToWire) });
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<LogDecisionWire>(request);
    const d = await skuscreener.logDecision(db(), actor, toInput(id, b));
    return json(decisionLogEntryToWire(d), 201);
  });
}
