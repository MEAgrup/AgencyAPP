/**
 * /api/v1/master-services — list the MSL effective today (GET) and create a new
 * master service with version 1 (POST). Ports Go's handleListMasterServices /
 * handleCreateMasterService.
 *
 * The Sales-owned write gate + all validation live in the domain layer; this
 * shell resolves the actor and maps the snake_case wire body.
 */
import { msl } from '@cdps/domain';
import { tz } from '@cdps/core';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { masterServiceToWire } from '@/lib/wire';

interface ServiceBody {
  name?: string;
  standard_price?: string;
  commission_rule?: string;
  category?: string;
  unit?: string;
  min_qty?: string;
  pricing_mode?: string;
  apply_ppn?: boolean;
  frequency?: string;
  price_note?: string;
  description?: string;
  active?: boolean;
  requires_strategy_plan?: boolean;
  plan_tier?: string;
  /** M16 LT-42 / M17 §5.4 — hari kalender. Absent/undefined = tidak berlaku. */
  durasi_jasa?: number;
  effective_from?: string;
}

function toInput(b: ServiceBody): msl.ServiceInput {
  return {
    name: b.name ?? '',
    standardPrice: b.standard_price ?? '',
    commissionRule: b.commission_rule ?? '',
    category: b.category,
    unit: b.unit,
    minQty: b.min_qty,
    pricingMode: b.pricing_mode,
    applyPPN: b.apply_ppn,
    frequency: b.frequency,
    priceNote: b.price_note,
    description: b.description,
    active: b.active,
    requiresStrategyPlan: b.requires_strategy_plan,
    planTier: b.plan_tier as msl.ServiceInput['planTier'],
    durasiJasa: b.durasi_jasa,
    effectiveFrom: b.effective_from ?? '',
  };
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    // web-internal passes ?effective_at=YYYY-MM-DD (defaults to today) so the
    // Sales calculator can preview the MSL as of any date; fall back to today
    // when absent/malformed.
    const at = new URL(request.url).searchParams.get('effective_at');
    const date = at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : tz.dateString(new Date());
    const services = await readAsActor(actor, (sql) => msl.listEffectiveAt(sql, date));
    return json({ data: services.map(masterServiceToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<ServiceBody>(request);
    const id = await msl.createService(db(), actor, toInput(body));
    return json({ id }, 201);
  });
}
