/**
 * Wire mappers — translate the camelCase domain read-models (@cdps/domain) into
 * the snake_case JSON shapes web-internal consumes (its lib/types.ts mirror the
 * legacy Go structs). Response mapping is the API route's job: the domain layer
 * stays camelCase, the route is the boundary. Request bodies are mapped the
 * other way inline in each route (`toInput`).
 */
import type { client, finance, leads, msl, notifications, sales } from '@cdps/domain';

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

// ---------------------------------------------------------------------------
// M5 Finance
// ---------------------------------------------------------------------------

export interface InstallmentWire {
  id: string;
  installment_no: number;
  amount: string;
  due_date: string | null;
  status: string;
  jatuh_tempo: boolean;
  verified_date: string | null;
  verified_by: string;
  proof_of_payment: string;
}

export function installmentToWire(i: finance.InstallmentRow): InstallmentWire {
  return {
    id: i.id,
    installment_no: i.installmentNo,
    amount: i.amount,
    due_date: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
    status: i.status,
    jatuh_tempo: i.jatuhTempo,
    verified_date: i.verifiedDate ? i.verifiedDate.toISOString().slice(0, 10) : null,
    verified_by: i.verifiedBy ?? '',
    proof_of_payment: i.proofOfPayment ?? '',
  };
}

export interface TransactionWire {
  id: string;
  client_id: string;
  payment_intent_scheme: string;
  total_agreed_value: string;
  amount_verified: string;
  amount_outstanding: string;
  payment_status: string;
  bermasalah: boolean;
  contract_attachment: string;
  released_to_account_at: string | null;
  installments: InstallmentWire[];
}

/** Maps a TransactionView (or PaymentStatusView) to the FE Transaction wire shape. */
export function transactionToWire(v: finance.TransactionView): TransactionWire {
  return {
    id: v.id,
    client_id: v.clientId,
    payment_intent_scheme: v.scheme,
    total_agreed_value: v.totalAgreedValue,
    amount_verified: v.amountVerified,
    amount_outstanding: v.amountOutstanding,
    payment_status: v.paymentStatus,
    bermasalah: v.bermasalah,
    contract_attachment: v.contractAttachment ?? '',
    released_to_account_at: v.releasedToAccountAt ? v.releasedToAccountAt.toISOString() : null,
    installments: v.installments.map(installmentToWire),
  };
}

export interface BermasalahVoteWire {
  division: string;
  decision: string;
  note: string;
  actor: string;
  created_at: string;
}

export interface BermasalahStatusWire {
  transaction_id: string;
  flagged: boolean;
  finance_vote: string | undefined;
  account_vote: string | undefined;
  director_vote: string | undefined;
  escalated: boolean;
  votes: BermasalahVoteWire[];
}

export function bermasalahStatusToWire(v: finance.BermasalahStatusView): BermasalahStatusWire {
  const latest = new Map<string, string>();
  for (const vote of v.votes) {
    latest.set(vote.division, vote.decision);
  }
  return {
    transaction_id: v.transactionId,
    flagged: v.flagged,
    finance_vote: latest.get('Finance'),
    account_vote: latest.get('Account'),
    director_vote: latest.get('Management'),
    escalated: false,
    votes: v.votes.map((vote) => ({
      division: vote.division,
      decision: vote.decision,
      note: vote.note ?? '',
      actor: vote.actor,
      created_at: vote.createdAt.toISOString(),
    })),
  };
}

export interface ReminderRowWire {
  client_id: string;
  toko: string;
  transaction_id: string;
  installment_id: string;
  installment_no: number;
  amount: string;
  due_date: string;
  status: string;
  days_overdue: number;
  label: string | undefined;
}

export function reminderRowToWire(r: finance.ReminderRow): ReminderRowWire {
  return {
    client_id: r.clientId,
    toko: r.toko,
    transaction_id: r.transactionId,
    installment_id: r.installmentId,
    installment_no: r.installmentNo,
    amount: r.amount,
    due_date: r.dueDate.toISOString().slice(0, 10),
    status: r.status,
    days_overdue: r.daysOverdue,
    label: r.label || undefined,
  };
}

export interface OutstandingRowWire {
  client_id: string;
  toko: string;
  transaction_id: string;
  amount_outstanding: string;
}

export function outstandingRowToWire(r: finance.OutstandingRow): OutstandingRowWire {
  return {
    client_id: r.clientId,
    toko: r.toko,
    transaction_id: r.transactionId,
    amount_outstanding: r.amountOutstanding,
  };
}

export interface ScanResultWire {
  overdue_flagged: number;
  h3_reminders_sent: number;
  contract_flags_raised: number;
}

export function scanSummaryToWire(s: finance.ScanSummary): ScanResultWire {
  return {
    overdue_flagged: s.markedOverdue,
    h3_reminders_sent: s.upcomingNotified,
    contract_flags_raised: s.contractFlagged,
  };
}

// ---------------------------------------------------------------------------
// M4 Clients
// ---------------------------------------------------------------------------

export interface ClientWire {
  id: string;
  nama_pic: string;
  toko: string;
  kota: string;
  link_toko: string;
  kategori: string;
  gmv_baseline: string;
  target_gmv: string;
  total_sales: string;
  marketing_budget: string | null;
  origin_campaign_id: string;
  sales_pic_id: string;
  commission_payment_pic_id: string;
  transaction_id: string;
  payment_intent: string;
  released_to_account_at: string | null;
  platforms: { platform: string; store_link?: string; managed_since: string | null; active: boolean }[];
  sales_allocation: { salesperson_id: string; basis_points: number }[];
  services: { id: string; master_service_id: string; name: string; standard_price: string; status: string }[];
}

export function clientListRowToWire(r: client.ClientListRow): ClientWire {
  return {
    id: r.id,
    nama_pic: r.namaPic,
    toko: r.toko,
    kota: r.kota,
    link_toko: '',
    kategori: r.kategori,
    gmv_baseline: '',
    target_gmv: '',
    total_sales: '',
    marketing_budget: null,
    origin_campaign_id: '',
    sales_pic_id: r.salesPicId,
    commission_payment_pic_id: '',
    transaction_id: '',
    payment_intent: r.paymentIntent ?? '',
    released_to_account_at: r.releasedToAccountAt ? r.releasedToAccountAt.toISOString() : null,
    platforms: [],
    sales_allocation: [],
    services: [],
  };
}

export function clientDetailToWire(d: sales.ClientDetail): ClientWire {
  return {
    id: d.id,
    nama_pic: d.namaPic,
    toko: d.toko,
    kota: d.kota,
    link_toko: d.linkToko,
    kategori: d.kategori,
    gmv_baseline: d.gmvBaseline,
    target_gmv: d.targetGmv,
    total_sales: d.transaction?.totalAgreedValue ?? '',
    marketing_budget: d.marketingBudget,
    origin_campaign_id: d.originCampaignId ?? '',
    sales_pic_id: d.salesPicId,
    commission_payment_pic_id: d.commissionPaymentPicId,
    transaction_id: d.transaction?.id ?? '',
    payment_intent: d.paymentIntent ?? '',
    released_to_account_at: d.releasedToAccountAt ? d.releasedToAccountAt.toISOString() : null,
    platforms: d.platforms.map((p) => ({
      platform: p.platform,
      store_link: p.storeLink ?? undefined,
      managed_since: p.managedSince ? p.managedSince.toISOString().slice(0, 10) : null,
      active: p.active,
    })),
    sales_allocation: d.allocations.map((a) => ({
      salesperson_id: a.salespersonId,
      basis_points: a.basisPoints,
    })),
    services: d.services.map((s) => ({
      id: s.id,
      master_service_id: s.masterServiceId,
      name: s.name,
      standard_price: s.standardPrice,
      status: s.status,
    })),
  };
}

// ---------------------------------------------------------------------------
// M0 Sales / Attempts
// ---------------------------------------------------------------------------

export interface AttemptRowWire {
  id: string;
  lead_id: string;
  lead_name: string;
  phone_number: string;
  source: string;
  owner_employee_id: string;
  owner_nama: string;
  status: string;
  claimed_at: string;
  created_at: string;
}

export function attemptRowToWire(r: sales.AttemptListRow): AttemptRowWire {
  return {
    id: r.id,
    lead_id: r.leadId,
    lead_name: r.leadName,
    phone_number: r.phoneNumber,
    source: r.source,
    owner_employee_id: r.ownerEmployeeId,
    owner_nama: r.ownerNama,
    status: r.status,
    claimed_at: r.claimedAt.toISOString(),
    created_at: r.createdAt.toISOString(),
  };
}

export interface AttemptFullDetailWire {
  attempt: AttemptRowWire;
  lead: {
    id: string; lead_name: string; phone_number: string; email: string | null; source: string;
    record_status: string; origin_campaign_id: string | null; last_touch_campaign_id: string | null;
    winning_attempt_id: string | null;
  };
  qualified_form: {
    nama_pic: string; toko: string; kota: string; link_toko: string; kategori: string;
    platform: string; store_link: string | null; gmv_baseline: string; target_gmv: string;
    marketing_budget: string | null;
    services: {
      master_service_id: string; master_version_no: number; name: string; quantity: string;
      unit: string | null; pricing_mode: string; standard_price: string;
      input_amount: string | null; subtotal: string; commission_rule: string;
    }[];
  } | null;
  proposals: {
    id: string; version_no: number; proposed_by: string; proposed_by_nama: string;
    decision_note: string | null; created_at: string;
    lines: { master_service_id: string; name: string; proposed_price: string; commission_rule: string; payment_terms: string | null }[];
  }[];
  nq_reasons: string[];
  allowed_transitions: string[];
}

export function attemptFullDetailToWire(d: sales.AttemptFullDetail): AttemptFullDetailWire {
  return {
    attempt: attemptRowToWire(d.attempt),
    lead: {
      id: d.lead.id,
      lead_name: d.lead.leadName,
      phone_number: d.lead.phoneNumber,
      email: d.lead.email,
      source: d.lead.source,
      record_status: d.lead.recordStatus,
      origin_campaign_id: d.lead.originCampaignId,
      last_touch_campaign_id: d.lead.lastTouchCampaignId,
      winning_attempt_id: d.lead.winningAttemptId,
    },
    qualified_form: d.qualifiedForm ? {
      nama_pic: d.qualifiedForm.namaPic,
      toko: d.qualifiedForm.toko,
      kota: d.qualifiedForm.kota,
      link_toko: d.qualifiedForm.linkToko,
      kategori: d.qualifiedForm.kategori,
      platform: d.qualifiedForm.platform,
      store_link: d.qualifiedForm.storeLink,
      gmv_baseline: d.qualifiedForm.gmvBaseline,
      target_gmv: d.qualifiedForm.targetGmv,
      marketing_budget: d.qualifiedForm.marketingBudget,
      services: d.qualifiedForm.services.map((s) => ({
        master_service_id: s.masterServiceId,
        master_version_no: s.masterVersionNo,
        name: s.name,
        quantity: s.quantity,
        unit: s.unit,
        pricing_mode: s.pricingMode,
        standard_price: s.standardPrice,
        input_amount: s.inputAmount,
        subtotal: s.subtotal,
        commission_rule: s.commissionRule,
      })),
    } : null,
    proposals: d.proposals.map((p) => ({
      id: p.id,
      version_no: p.versionNo,
      proposed_by: p.proposedBy,
      proposed_by_nama: p.proposedByNama,
      decision_note: p.decisionNote,
      created_at: p.createdAt.toISOString(),
      lines: p.lines.map((l) => ({
        master_service_id: l.masterServiceId,
        name: l.name,
        proposed_price: l.proposedPrice,
        commission_rule: l.commissionRule,
        payment_terms: l.paymentTerms,
      })),
    })),
    nq_reasons: d.nqReasons,
    allowed_transitions: [],
  };
}

export interface QuoteWire {
  lines: {
    service_id: string; name: string; quantity: number; unit: string;
    standard_price_idr: string; komisi_idr: string; subtotal_idr: string;
  }[];
  estimasi_nilai_idr: string;
  total_komisi_idr: string;
}

export function quoteToWire(q: sales.Quote): QuoteWire {
  return {
    lines: q.lines.map((l) => ({
      service_id: l.serviceId,
      name: l.name,
      quantity: Number(l.quantity),
      unit: l.unit,
      standard_price_idr: l.standardPriceIdr,
      komisi_idr: l.komisiIdr,
      subtotal_idr: l.subtotalIdr,
    })),
    estimasi_nilai_idr: q.estimasiNilaiIdr,
    total_komisi_idr: q.totalKomisiIdr,
  };
}

// --- Notifications (house convention #8) — web-internal NotificationItem. ---

export interface NotificationItemWire {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  deep_link: string;
  actor: string;
  created_at: string;
  read_at: string | null;
}

export function notificationRowToWire(n: notifications.NotificationRow): NotificationItemWire {
  return {
    id: n.id,
    event_type: n.eventType,
    entity_type: n.entityType,
    entity_id: n.entityId,
    deep_link: n.deepLink,
    actor: n.actor,
    created_at: n.createdAt.toISOString(),
    read_at: n.readAt ? n.readAt.toISOString() : null,
  };
}
