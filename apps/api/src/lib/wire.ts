/**
 * Wire mappers — translate the camelCase domain read-models (@cdps/domain) into
 * the snake_case JSON shapes web-internal consumes (its lib/types.ts mirror the
 * legacy Go structs). Response mapping is the API route's job: the domain layer
 * stays camelCase, the route is the boundary. Request bodies are mapped the
 * other way inline in each route (`toInput`).
 */
import type { leads, msl } from '@cdps/domain';

/** MasterService as web-internal's `MasterService` type expects it. */
export interface MasterServiceWire {
  id: string;
  name: string;
  standard_price: string;
  commission_rule: string;
  category: string;
  unit: string;
  min_qty: string;
  pricing_mode: string;
  apply_ppn: boolean;
  frequency: string;
  price_note: string;
  description: string;
  active: boolean;
  requires_strategy_plan: boolean;
  version_no: number;
  effective_from: string;
}

/** Maps a domain ServiceView (camelCase) to the MasterService wire shape. */
export function masterServiceToWire(v: msl.ServiceView): MasterServiceWire {
  return {
    id: v.id,
    name: v.name,
    standard_price: v.standardPrice,
    commission_rule: v.commissionRule,
    category: v.category,
    unit: v.unit,
    min_qty: v.minQty,
    pricing_mode: v.pricingMode,
    apply_ppn: v.applyPPN,
    frequency: v.frequency,
    price_note: v.priceNote,
    description: v.description,
    active: v.active,
    requires_strategy_plan: v.requiresStrategyPlan,
    version_no: v.versionNo,
    effective_from: v.effectiveFrom,
  };
}

// --- M1 Leads (contract HANDOFF_SESSION_20260719_FE_M0M1 §1/§3/§4/§5) ---

/** module1_leads.Lead subset returned by register/claim (web-internal LeadStub). */
export interface LeadStubWire {
  id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  record_status: string;
}

export function leadStubToWire(l: leads.Lead): LeadStubWire {
  return {
    id: l.id,
    lead_name: l.leadName,
    phone_number: l.phoneNumber,
    source: l.source,
    record_status: l.recordStatus,
  };
}

/** module1_leads.Attempt subset returned by register/claim (web-internal AttemptStub). */
export interface AttemptStubWire {
  id: string;
  lead_id: string;
  owner_employee_id: string;
  status: string;
}

export function attemptStubToWire(a: leads.Attempt): AttemptStubWire {
  return {
    id: a.id,
    lead_id: a.leadId,
    owner_employee_id: a.owner,
    status: a.status,
  };
}

/** Sales Pool board row (web-internal PoolRow). */
export interface PoolRowWire {
  id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  origin_campaign_id: string | null;
  created_at: string;
  stale: boolean;
  open_attempt_count: number;
  my_open_attempt: boolean;
}

export function poolRowToWire(r: leads.PoolBoardRow): PoolRowWire {
  return {
    id: r.id,
    lead_name: r.leadName,
    phone_number: r.phoneNumber,
    source: r.source,
    origin_campaign_id: r.originCampaignId,
    created_at: r.createdAt.toISOString(),
    stale: r.stale,
    open_attempt_count: r.openAttemptCount,
    my_open_attempt: r.myOpenAttempt,
  };
}

/** Leads Database row (web-internal LeadRow). */
export interface LeadRowWire {
  id: string;
  lead_name: string;
  phone_number: string;
  email: string | null;
  source: string;
  origin_division: string;
  origin_campaign_id: string | null;
  last_touch_campaign_id: string | null;
  record_status: string;
  winning_attempt_id: string | null;
  created_at: string;
  open_attempt_count: number;
}

export function leadRowToWire(r: leads.LeadsDbRow): LeadRowWire {
  return {
    id: r.id,
    lead_name: r.leadName,
    phone_number: r.phoneNumber,
    email: r.email,
    source: r.source,
    origin_division: r.originDivision,
    origin_campaign_id: r.originCampaignId,
    last_touch_campaign_id: r.lastTouchCampaignId,
    record_status: r.recordStatus,
    winning_attempt_id: r.winningAttemptId,
    created_at: r.createdAt.toISOString(),
    open_attempt_count: r.openAttemptCount,
  };
}

/** Lead detail (web-internal LeadDetail): lead core + attempt contest. */
export interface LeadDetailWire {
  lead: Omit<LeadRowWire, 'open_attempt_count'>;
  attempts: {
    id: string;
    owner_employee_id: string;
    owner_nama: string;
    status: string;
    claimed_at: string;
  }[];
}

export function leadDetailToWire(d: leads.LeadDetailView): LeadDetailWire {
  const l = d.lead;
  return {
    lead: {
      id: l.id,
      lead_name: l.leadName,
      phone_number: l.phoneNumber,
      email: l.email,
      source: l.source,
      origin_division: l.originDivision,
      origin_campaign_id: l.originCampaignId,
      last_touch_campaign_id: l.lastTouchCampaignId,
      record_status: l.recordStatus,
      winning_attempt_id: l.winningAttemptId,
      created_at: l.createdAt.toISOString(),
    },
    attempts: d.attempts.map((a) => ({
      id: a.id,
      owner_employee_id: a.ownerEmployeeId,
      owner_nama: a.ownerNama,
      status: a.status,
      claimed_at: a.claimedAt.toISOString(),
    })),
  };
}
