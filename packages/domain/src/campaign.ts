/**
 * Campaign domain service (M3). Ported from Go's `internal/module3_campaign/*`.
 *
 * Introduces the acquisition Campaign (CMP-) — MEA's OWN lead-gen / acquisition
 * effort (M3 §1/§2), the first-class "thread" that later ties Leads → Clients →
 * execution. It is DISTINCT from Module 8's Ad Campaign (ADC-), the client-facing
 * paid-media record (M3-OA-1) — hence a separate namespace, table (`campaigns` vs
 * `ad_campaigns`), machine (`campaign` vs `ad_campaign`), and URL space
 * (`/api/v1/marketing/campaigns` vs the frozen `/api/v1/campaigns`).
 *
 * This module owns:
 *   - Cluster 1 (identity + lifecycle + ownership): create (born 'Draft', owner =
 *     creating actor, CMP- minted after validation), the `campaign` machine
 *     (Draft → Active ⇄ Paused → Closed → Archived; reaching Closed stamps end_date =
 *     today WIB as a data-column effect §6.3), reassign (Marketing lead/head or
 *     Director, audited), and the §5-scoped Get/List.
 *   - Cluster 2 (read-only rollups): the Campaign as a linkage HUB — leads generated,
 *     real leads (≥ Qualified, from the immutable audit log), clients won, total value
 *     won (IDR). All DERIVED on read from the linkage columns other modules stamp
 *     (`leads.origin_campaign_id`, `clients.origin_campaign_id`); never stored.
 *
 * House rules honoured (mirroring the Go source):
 *   - CMP- id minted (ident.identNext) ONLY after mandatory-field validation (rule 1);
 *   - status written ONLY through the transition engine (rule 2) — end_date is a data
 *     column effect of the Closed transition, not a status;
 *   - every create/transition/reassign appends an immutable before→after audit row
 *     (rule 3); ownership history lives in the audit log (no cancel/delete path);
 *   - the four rollups are DERIVED on read, always recomputable (rules 3/4);
 *   - money renders "Rp. X.XXX.XXX,00", div-by-zero N/A (rule 7).
 *
 * Module 3 emits NO notification event (the catalog is FROZEN).
 *
 * Reference: backend/internal/module3_campaign/{campaign,lifecycle,read,rollup}.go.
 */

import { bi, money, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/**
 * The CDPS division that owns Campaigns (M3 §5 / §6.1). Matches leads' Marketing
 * mapping (the same HRIS MARKETING → Marketing role).
 */
export const MARKETING_DIVISION = 'Marketing';

/**
 * The Sales division label — needed by the intake-picker gate only
 * (canPickCampaign). Declared locally rather than imported from `leads`, which
 * already imports MARKETING_DIVISION from here: the house pattern is one local
 * constant per module (client/finance/leads/msl/sales each carry their own), and
 * a back-import would make the two modules mutually dependent for one string.
 */
export const SALES_DIVISION = 'Sales';

/**
 * Campaign statuses — the `campaign` machine (STATE_MACHINES §3 / config.go
 * MCampaign). The engine stores these labels WITHOUT brackets (initial 'Draft',
 * terminal 'Archived'), so the module mirrors them verbatim.
 */
export const STATUS_DRAFT = 'Draft';
export const STATUS_ACTIVE = 'Active';
export const STATUS_PAUSED = 'Paused';
export const STATUS_CLOSED = 'Closed';
export const STATUS_ARCHIVED = 'Archived';

const MACHINE_CAMPAIGN = 'campaign';

// ---------------------------------------------------------------------------
// Verbatim BI messages (M3). Each mirrors a Go sentinel 1:1. No NEW BI strings —
// reuse of the generic house strings (W1-09 precedent).
// ---------------------------------------------------------------------------

/** A mandatory field is missing — §3 Rule 2 / house default. */
export const MSG_INCOMPLETE = bi.INCOMPLETE_DATA;
/** The Campaign (or a valid reassignment target) does not exist. */
export const MSG_NOT_FOUND = '[data tidak ditemukan]';
/** Actor may not view/manage/reassign this Campaign. */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';

// ---------------------------------------------------------------------------
// Errors — mapped in apps/api http.ts: validation → 400, forbidden → 403,
// not-found → 404. A blocked lifecycle edge is surfaced as a TransitionResult
// (transitionResponse → 409), not an exception.
// ---------------------------------------------------------------------------

/** Bad/missing input (→ 400): incomplete create, empty reassignment target. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignValidationError';
  }
}
/** The actor's role may not perform the requested read/action (→ 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignForbiddenError';
  }
}
/** The Campaign / reassignment target does not exist (→ 404). */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'CampaignNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/**
 * A Campaign (CMP-) — its §6.3 identity/lifecycle/ownership projection. Budget/
 * metrics (Module 2) and the leads/clients rollups (see Rollup) are separate.
 */
export interface Campaign {
  id: string;
  name: string;
  channel: string;
  online: boolean;
  offline: boolean;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // null until [Closed] (§6.3)
  owner: string;
  status: string;
  createdBy: string;
  createdAt: Date;
}

/**
 * The caller-supplied §6.3 mandatory fields. Owner (= creating actor) and Status
 * (born 'Draft') are NOT here. Channel is free-text (M3-OA-2); Online/Offline is
 * the multi-select checklist (at least one true).
 */
export interface CampaignInput {
  name: string;
  channel: string;
  online?: boolean;
  offline?: boolean;
  startDate: string; // YYYY-MM-DD
}

/**
 * One entry of the intake picker (see listSelectableCampaigns). Deliberately a
 * NARROWER projection than Campaign: identity + the two things that disambiguate
 * two similarly-named campaigns (channel, start date) + the status the UI must be
 * able to flag + the DERIVED lead funnel — and nothing about ownership or money.
 *
 * The three counts are the M2 §4 / M1 §8 numbers verbatim, computed in
 * `private.campaign_selectable()` (migration 20260805022807). They are here
 * because the picker is the only campaign surface Sales has (owner decision
 * 2026-08-04): the salesperson who chooses a campaign is the one whose choice
 * fills these numbers, so they see the effect of that choice. Read-only by
 * construction — nothing types into them (house rule 4 / M2 §3 rule 6).
 */
export interface SelectableCampaign {
  id: string;
  name: string;
  channel: string;
  /** Any campaign status, verbatim — the UI marks Paused/Closed/Archived/Draft. */
  status: string;
  startDate: string; // YYYY-MM-DD
  /** Lead-by-Dashboard: leads whose Origin Campaign is this one (M2 §4 r1). */
  leadByDashboard: number;
  /** Lead-Real-by-Sales: of those, the ones that reached Qualified (M2 §4 r2). */
  leadRealBySales: number;
  /** Of those, the ones an attempt drove to Not Qualified (M1 §8 example, "18 ditandai"). */
  leadNotQualified: number;
}

/** The Campaign's read-only funnel (M3 §4 Rule 4 / §6.3). */
export interface Rollup {
  campaignId: string;
  leadsGenerated: number;
  realLeads: number;
  clientsWon: number;
  /** Canonical DECIMAL string (recomputable) + house-formatted IDR display (rule 7). */
  totalValueWon: string;
  totalValueWonIdr: string;
}

/**
 * One Service of a won client, as the Campaign's client-list drill-down surfaces it
 * (M3 §4 Rule 4 "each client's current service status, read from Account"). Name +
 * status are read verbatim from the Account `services` row; the id lets the UI open
 * the Service hub (Flow 2 "jump to its Client record / service progress").
 */
export interface CampaignClientService {
  serviceId: string;
  name: string;
  status: string;
}

/**
 * One won client of a Campaign (§4 Rule 4 / Flow 2). Origin-Campaign lineage
 * (first-touch, permanent) — the SAME basis as `Rollup.clientsWon`, so the list and
 * the count always reconcile. Each carries its Account service statuses so the
 * Marketing→Sales→Account→execution trace is followable from the campaign view;
 * a client with no Service rows yet lists an empty `services`.
 */
export interface CampaignClient {
  clientId: string;
  /** Store name (the "Sini Store" of the §4 example). */
  toko: string;
  namaPic: string;
  services: CampaignClientService[];
}

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Authorization predicates (M3 §5 / §6.1).
// ---------------------------------------------------------------------------

/**
 * §6.1 create gate: Marketing staff/lead, or Director (Director may own). OD read-only.
 *
 * M3-G4 (logged, DECISIONS 2026-08-19): §6.1's Roles table lists "Create" only under
 * Marketing Staff, so a Marketing Lead creating a campaign is a deliberate broadening,
 * NOT restricted. Rationale: the same Lead already manages every campaign division-wide
 * (canManageCampaign — transition, reassign, and now updateCampaign), so barring only
 * create would be an internally inconsistent authority model; and it matches the Go
 * oracle (module3_campaign) while that remains the parity source (avoids an O43 break).
 * A newly created campaign is owned by the creating Lead — reassignable as usual.
 */
export function canCreate(a: Actor): boolean {
  if (a.role.director) {
    return true;
  }
  return a.role.division === MARKETING_DIVISION && (a.role.level === permission.LevelStaff || a.role.level === permission.LevelLead);
}

/**
 * §6.1 lifecycle-write gate: the owning Marketing staff (own only), any Marketing
 * lead/head (division-wide), or a Director. OD read-only; other divisions denied.
 */
export function canManageCampaign(a: Actor, owner: string): boolean {
  if (a.role.director) {
    return true;
  }
  if (a.role.division !== MARKETING_DIVISION) {
    return false;
  }
  if (a.role.level === permission.LevelLead) {
    return true;
  }
  return a.role.level === permission.LevelStaff && a.employeeId === owner;
}

/** §5 Rule 3 / M3-OA-6 reassign gate: ONLY a Marketing lead/head or a Director. */
export function canReassign(a: Actor): boolean {
  return permission.isLead(a, MARKETING_DIVISION);
}

/**
 * Intake-picker read gate — the ONE read that is deliberately not owner-scoped.
 *
 * A salesperson registering a lead must be able to say WHICH campaign it came
 * from (Origin Campaign, M1 §9.3), and they own no campaign at all — so the §5
 * gate above (which is right for the Marketing workspace) would hand every Sales
 * actor an empty list. The two intake doors are Sales (M1 §4 single registration)
 * and Marketing (M1 §3 import), plus the layered oversight roles that read
 * everywhere; any other division has no lead-intake surface and no business
 * enumerating campaigns.
 *
 * What this opens is a NAME LIST of Active/Paused campaigns
 * (`SelectableCampaign`), not the Campaign record: no owner, no end date, no
 * budget, no rollup. See migration 20260805022245 for the SQL half.
 */
export function canPickCampaign(a: Actor): boolean {
  if (permission.canReadAll(a)) {
    return true; // OD (read-only everywhere) + Director
  }
  return a.role.division === SALES_DIVISION || a.role.division === MARKETING_DIVISION;
}

/** §5 read gate: OD/Director (everywhere), Marketing lead/head (division-wide), owning staff. */
export function canViewCampaign(a: Actor, owner: string): boolean {
  if (permission.canReadDivision(a, MARKETING_DIVISION)) {
    return true; // Marketing lead, OD, Director
  }
  return a.role.division === MARKETING_DIVISION && a.employeeId === owner;
}

// ---------------------------------------------------------------------------
// Create (§3 Flow 1-2).
// ---------------------------------------------------------------------------

/**
 * createCampaign creates a Campaign in 'Draft'. Mandatory: Name, Channel,
 * Online/Offline (≥1), Start Date (§3 Rule 2). Owner = the creating actor. Only a
 * Marketing staff/lead or Director may create (§6.1); the CMP- id is minted only
 * after validation passes (house rule 1), so an incomplete create consumes no id.
 */
export async function createCampaign(sql: Sql, actor: Actor, input: CampaignInput): Promise<Campaign> {
  if (!canCreate(actor)) {
    throw new ForbiddenError(MSG_FORBIDDEN);
  }
  const name = (input.name ?? '').trim();
  const channel = (input.channel ?? '').trim();
  const startStr = (input.startDate ?? '').trim();
  const online = input.online === true;
  const offline = input.offline === true;
  if (name === '' || channel === '' || startStr === '' || !(online || offline)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!RE_DATE.test(startStr) || Number.isNaN(Date.parse(`${startStr}T00:00:00Z`))) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const id = await ex.ident.identNext('CMP', now);
    await tx`
      insert into campaigns
        (id, name, channel, is_online, is_offline, start_date, owner_employee_id, status, created_by)
      values (${id}, ${name}, ${channel}, ${online}, ${offline}, ${startStr}, ${actor.employeeId},
        ${STATUS_DRAFT}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'campaign', entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null,
      afterJson: {
        status: STATUS_DRAFT, name, channel, is_online: online, is_offline: offline,
        start_date: startStr, owner_employee_id: actor.employeeId,
      },
      createdBy: actor.employeeId,
    });
    return {
      id, name, channel, online, offline, startDate: startStr, endDate: null,
      owner: actor.employeeId, status: STATUS_DRAFT, createdBy: actor.employeeId, createdAt: now,
    };
  });
}

/**
 * updateCampaign edits a Campaign's §6.3 mandatory fields — Name, Channel,
 * Online/Offline (≥1), Start Date — the "edit own campaigns" half of §6.1 that had no
 * TS (nor Go) home before (M3-G1's sibling gap M3-G2). Owner and Status are NOT here:
 * ownership moves only through reassignCampaign, status only through the engine
 * (transitionCampaign); End Date is a Closed data-column effect, never hand-edited.
 *
 * Gate: canManageCampaign (owning staff, any Marketing lead/head division-wide, or a
 * Director) — the SAME authority that drives the lifecycle, since an edit is a manage
 * action of the same weight. Validation mirrors createCampaign exactly (all four
 * mandatory, valid date), rejected BEFORE any write. The before→after change is one
 * immutable audit row (house rule 3); the auto rollups are untouched (still derived).
 */
export async function updateCampaign(sql: Sql, actor: Actor, campaignId: string, input: CampaignInput): Promise<Campaign> {
  const name = (input.name ?? '').trim();
  const channel = (input.channel ?? '').trim();
  const startStr = (input.startDate ?? '').trim();
  const online = input.online === true;
  const offline = input.offline === true;
  if (name === '' || channel === '' || startStr === '' || !(online || offline)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!RE_DATE.test(startStr) || Number.isNaN(Date.parse(`${startStr}T00:00:00Z`))) {
    throw new ValidationError(MSG_INCOMPLETE);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<CampaignRow[]>`${selectCampaign(tx)} where id = ${campaignId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    const cur = rowToCampaign(rows[0]);
    if (!canManageCampaign(actor, cur.owner)) {
      throw new ForbiddenError(MSG_FORBIDDEN);
    }
    await tx`
      update campaigns
         set name = ${name}, channel = ${channel}, is_online = ${online}, is_offline = ${offline}, start_date = ${startStr}
       where id = ${campaignId}`;
    await ex.audit.insertAudit({
      entityType: 'campaign', entityId: campaignId, actorEmployeeId: actor.employeeId, action: 'edit',
      beforeJson: { name: cur.name, channel: cur.channel, is_online: cur.online, is_offline: cur.offline, start_date: cur.startDate },
      afterJson: { name, channel, is_online: online, is_offline: offline, start_date: startStr },
      createdBy: actor.employeeId,
    });
    return { ...cur, name, channel, online, offline, startDate: startStr };
  });
}

// ---------------------------------------------------------------------------
// Lifecycle (§3) — every move through the engine; Closed stamps end_date (§6.3).
// ---------------------------------------------------------------------------

/**
 * transitionCampaign drives a Campaign to `to` through the engine (§3 Rule 3/4).
 * Authority (§6.1) is checked in code BEFORE the engine runs, so a denied actor
 * changes nothing (ForbiddenError). A rejected edge is returned as a
 * TransitionResult ({ok:false}) — the route renders it 409 via transitionResponse;
 * nothing is committed on a blocked edge. Reaching 'Closed' stamps end_date = today
 * (WIB) as an audited data-column effect (§6.3), atomically with the transition.
 */
export async function transitionCampaign(
  sql: Sql,
  actor: Actor,
  campaignId: string,
  to: string,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const row = await lockCampaign(tx, campaignId);
    if (!canManageCampaign(actor, row.owner)) {
      throw new ForbiddenError(MSG_FORBIDDEN);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_CAMPAIGN, entityType: 'campaign', table: 'campaigns', entityId: campaignId, to, actor,
    });
    if (!res.ok) {
      return res; // blocked/role-denied edge — nothing written; route → 409/403
    }
    // §6.3: reaching 'Closed' sets end_date = today (WIB). Data-column effect, audited.
    if (to === STATUS_CLOSED) {
      const end = tz.dateString(new Date());
      await tx`update campaigns set end_date = ${end} where id = ${campaignId}`;
      await ex.audit.insertAudit({
        entityType: 'campaign', entityId: campaignId, actorEmployeeId: actor.employeeId, action: 'set_end_date',
        beforeJson: { end_date: null }, afterJson: { end_date: end }, createdBy: actor.employeeId,
      });
    }
    return res;
  });
}

// ---------------------------------------------------------------------------
// Reassign ownership (§5 Rule 1/3 / M3-OA-6).
// ---------------------------------------------------------------------------

/**
 * reassignCampaign hands ownership to another active Marketing staff. ONLY a
 * Marketing lead/head or a Director may do this — staff (even the current owner)
 * cannot. The pointer write + its immutable before→after audit row commit together;
 * prior owners stay in the audit log.
 */
export async function reassignCampaign(sql: Sql, actor: Actor, campaignId: string, newOwnerId: string): Promise<Campaign> {
  if (!canReassign(actor)) {
    throw new ForbiddenError(MSG_FORBIDDEN);
  }
  const newOwner = (newOwnerId ?? '').trim();
  if (newOwner === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  await withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const row = await lockCampaign(tx, campaignId);
    await validateOwnerCandidate(tx, newOwner);
    await tx`update campaigns set owner_employee_id = ${newOwner} where id = ${campaignId}`;
    await ex.audit.insertAudit({
      entityType: 'campaign', entityId: campaignId, actorEmployeeId: actor.employeeId, action: 'owner_reassigned',
      beforeJson: { owner_employee_id: row.owner },
      afterJson: { owner_employee_id: newOwner, reassigned_by: actor.employeeId },
      createdBy: actor.employeeId,
    });
  });
  return getCampaign(sql, actor, campaignId);
}

// ---------------------------------------------------------------------------
// Reads (§5).
// ---------------------------------------------------------------------------

/**
 * getCampaign returns one Campaign if the actor may view it (§5 read gate). A
 * missing row is NotFoundError; an existing row the actor cannot see is ForbiddenError.
 */
export async function getCampaign(sql: Queryable, actor: Actor, campaignId: string): Promise<Campaign> {
  const rows = await sql<CampaignRow[]>`${selectCampaign(sql)} where id = ${campaignId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const c = rowToCampaign(rows[0]);
  if (!canViewCampaign(actor, c.owner)) {
    throw new ForbiddenError(MSG_FORBIDDEN);
  }
  return c;
}

/**
 * listCampaigns returns the Campaigns visible to the actor (§5): a Marketing
 * lead/head, OD or Director sees ALL; a Marketing staff sees only OWN campaigns;
 * any other division is denied (ForbiddenError). Newest first.
 */
export async function listCampaigns(sql: Queryable, actor: Actor): Promise<Campaign[]> {
  const seeAll = permission.canReadDivision(actor, MARKETING_DIVISION); // Marketing lead, OD, Director
  const ownOnly = !seeAll && actor.role.division === MARKETING_DIVISION;
  if (!seeAll && !ownOnly) {
    throw new ForbiddenError(MSG_FORBIDDEN);
  }
  const rows = ownOnly
    ? await sql<CampaignRow[]>`${selectCampaign(sql)} where owner_employee_id = ${actor.employeeId} order by created_at desc, id desc`
    : await sql<CampaignRow[]>`${selectCampaign(sql)} order by created_at desc, id desc`;
  return rows.map(rowToCampaign);
}

/**
 * listSelectableCampaigns returns EVERY campaign a lead may be attributed to —
 * all statuses — each with its derived lead funnel. Ordered by "can it produce
 * leads now" (Active, Paused → Closed, Archived → Draft), then by name.
 *
 * Not a variant of listCampaigns — a DIFFERENT question with a different scope:
 *   - listCampaigns answers "which campaigns are MINE to manage" (§5 owner
 *     scope, full Campaign record, Marketing-only);
 *   - this answers "which campaigns can a lead be attributed to, and what have
 *     they produced so far", which is by definition not owner-scoped (a
 *     salesperson owns none).
 *
 * Why ALL statuses (owner decision 2026-08-04, deviation from §5 rule 4/§6.1
 * logged in DECISIONS.md): every M2 performance number starts at the campaign a
 * salesperson picks during lead registration. A campaign missing from that list
 * is not merely "unpicked" — it is permanently zero, and a zero that means "the
 * lead had nowhere to go" is indistinguishable from a campaign that truly failed.
 * Draft is included for the same reason and is SAFE here precisely because this
 * door never auto-activates a campaign (unlike leads.resolveCampaignForIntake):
 * picking a Draft campaign attributes the lead without launching it.
 *
 * The rows come from `private.campaign_selectable()` (SECURITY DEFINER,
 * migrations 20260805022245 + 20260805022807), so this works under `readAsActor`
 * where the `campaigns` table itself stays owner-scoped. That indirection is the
 * whole point: the picker gets its answer without widening the table's RLS.
 */
export async function listSelectableCampaigns(sql: Queryable, actor: Actor): Promise<SelectableCampaign[]> {
  if (!canPickCampaign(actor)) {
    throw new ForbiddenError(MSG_FORBIDDEN);
  }
  const rows = await sql<SelectableRow[]>`
    select id, name, channel, status, start_date,
           lead_by_dashboard, lead_real_by_sales, lead_not_qualified
      from private.campaign_selectable()`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    channel: r.channel,
    status: r.status,
    startDate: dateStr(r.start_date),
    leadByDashboard: Number(r.lead_by_dashboard),
    leadRealBySales: Number(r.lead_real_by_sales),
    leadNotQualified: Number(r.lead_not_qualified),
  }));
}

/**
 * campaignRollup returns the derived funnel for a Campaign the actor may view (§5
 * read gate, reused from getCampaign). NotFoundError / ForbiddenError propagate.
 *   - leadsGenerated = COUNT leads whose origin campaign is this one.
 *   - realLeads      = COUNT DISTINCT of those leads with an attempt that REACHED
 *                      ≥ Qualified (the transition INTO Qualified in the audit log).
 *   - clientsWon     = COUNT clients whose origin campaign is this one (first-touch).
 *   - totalValueWon  = SUM of those clients' Transaction total_agreed_value.
 * The 3-month late-conversion window (M3-OA-4) is NOT applied here (M2 cluster).
 */
export async function campaignRollup(sql: Queryable, actor: Actor, campaignId: string): Promise<Rollup> {
  await getCampaign(sql, actor, campaignId); // §5 visibility gate (never a leaked count)

  const leads = await sql<{ n: string }[]>`
    select count(*) as n from leads where origin_campaign_id = ${campaignId}`;
  const real = await sql<{ n: string }[]>`
    select count(distinct l.id) as n
      from leads l
      join prospect_attempts pa on pa.lead_id = l.id
      join audit_log al on al.entity_type = 'prospect_attempt'
                       and al.entity_id = pa.id
                       and al.action = 'transition:Contacted->Qualified'
     where l.origin_campaign_id = ${campaignId}`;
  const clients = await sql<{ n: string }[]>`
    select count(*) as n from clients where origin_campaign_id = ${campaignId}`;
  const total = await sql<{ sum: string }[]>`
    select coalesce(sum(t.total_agreed_value), 0) as sum
      from clients c
      join transactions t on t.id = c.transaction_id
     where c.origin_campaign_id = ${campaignId}`;

  const m = money.parse(total[0].sum);
  return {
    campaignId,
    leadsGenerated: Number(leads[0].n),
    realLeads: Number(real[0].n),
    clientsWon: Number(clients[0].n),
    totalValueWon: money.decimal(m),
    totalValueWonIdr: money.format(m),
  };
}

/**
 * campaignClients returns the won-client list for a Campaign the actor may view (§4
 * Rule 4 / Flow 2), each client with its current Account service status. Same §5
 * read gate as campaignRollup (reused via getCampaign); NotFound/Forbidden propagate.
 *
 * The clients are exactly those whose Origin Campaign is this one (first-touch,
 * `clients.origin_campaign_id` — the same set `Rollup.clientsWon` counts, so list and
 * count reconcile by construction, §4 Rule 5). Service status is read from Account's
 * `services` (name + status, verbatim); a client with no Service row yet lists an
 * empty `services` array (LEFT JOIN — a won client whose services Finance has not
 * released is still on the campaign's list, just with nothing to execute yet).
 *
 * Read-only and fully derived (house rule 4) — nothing here is stored on the Campaign.
 * Ordered oldest client first (created_at, id), services by id, for a stable render.
 */
export async function campaignClients(sql: Queryable, actor: Actor, campaignId: string): Promise<CampaignClient[]> {
  await getCampaign(sql, actor, campaignId); // §5 visibility gate (never a leaked list)

  const rows = await sql<CampaignClientRow[]>`
    select c.id as client_id, c.toko, c.nama_pic,
           sv.id as service_id, sv.name as service_name, sv.status as service_status
      from clients c
      left join services sv on sv.client_id = c.id
     where c.origin_campaign_id = ${campaignId}
     order by c.created_at asc, c.id asc, sv.id asc`;

  const byClient = new Map<string, CampaignClient>();
  for (const r of rows) {
    let client = byClient.get(r.client_id);
    if (client === undefined) {
      client = { clientId: r.client_id, toko: r.toko, namaPic: r.nama_pic, services: [] };
      byClient.set(r.client_id, client);
    }
    // LEFT JOIN: a client with no Service yields one row whose service columns are NULL.
    if (r.service_id !== null) {
      client.services.push({ serviceId: r.service_id, name: r.service_name ?? '', status: r.service_status ?? '' });
    }
  }
  return [...byClient.values()];
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

interface CampaignRow {
  id: string;
  name: string;
  channel: string;
  is_online: boolean;
  is_offline: boolean;
  start_date: string | Date;
  end_date: string | Date | null;
  owner_employee_id: string;
  status: string;
  created_by: string;
  created_at: Date;
}

/**
 * One row of `private.campaign_selectable()` (see listSelectableCampaigns). The
 * counts arrive as postgres `bigint`, which node-postgres hands over as STRINGS —
 * hence the `string | number` and the explicit Number() at the call site. Reading
 * them as-is would put "12" on the wire where the FE renders a number.
 */
interface SelectableRow {
  id: string;
  name: string;
  channel: string;
  status: string;
  start_date: string | Date;
  lead_by_dashboard: string | number;
  lead_real_by_sales: string | number;
  lead_not_qualified: string | number;
}

/**
 * One row of the campaignClients join (see campaignClients). The client columns
 * repeat per Service (or once with NULL service columns when the LEFT JOIN finds no
 * Service yet); the caller groups them back by `client_id`.
 */
interface CampaignClientRow {
  client_id: string;
  toko: string;
  nama_pic: string;
  service_id: string | null;
  service_name: string | null;
  service_status: string | null;
}

/** selectCampaign is the shared Campaign column list (nested sql fragment). */
function selectCampaign(sql: Queryable) {
  return sql`select id, name, channel, is_online, is_offline, start_date, end_date,
    owner_employee_id, status, created_by, created_at from campaigns`;
}

function rowToCampaign(r: CampaignRow): Campaign {
  return {
    id: r.id, name: r.name, channel: r.channel, online: r.is_online, offline: r.is_offline,
    startDate: dateStr(r.start_date), endDate: r.end_date === null ? null : dateStr(r.end_date),
    owner: r.owner_employee_id, status: r.status, createdBy: r.created_by, createdAt: r.created_at,
  };
}

/** lockCampaign row-locks a Campaign and reads owner + status. A missing row is NotFoundError. */
async function lockCampaign(tx: Queryable, id: string): Promise<{ owner: string; status: string }> {
  const rows = await tx<{ owner_employee_id: string; status: string }[]>`
    select owner_employee_id, status from campaigns where id = ${id} for update`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  return { owner: rows[0].owner_employee_id, status: rows[0].status };
}

/**
 * validateOwnerCandidate enforces that a reassignment target is an ACTIVE employee
 * whose resolved CDPS division is Marketing and whose level is staff (§5 Rule 1
 * "another Marketing Staff"). Mirrors the divisi+jabatan → division join used by
 * auth.resolveActor. A candidate that does not resolve is NotFoundError.
 */
async function validateOwnerCandidate(tx: Queryable, ownerId: string): Promise<void> {
  const rows = await tx<{ status_aktif: number | boolean; division: string | null; level: string | null }[]>`
    select e.status_aktif, rm.division, rm.level
      from employees e
      left join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${ownerId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  const active = r.status_aktif === true || r.status_aktif === 1;
  if (!active || r.division !== MARKETING_DIVISION || r.level !== permission.LevelStaff) {
    throw new NotFoundError();
  }
}

/** dateStr normalizes a postgres `date` value (string or Date) to YYYY-MM-DD. */
function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
