/**
 * Team Portal domain service (M15 — the INTERNAL half). Ported from Go's
 * `internal/module15_portal/*`.
 *
 * M15 introduces NO new entity and NO state machine (§3 Rule 8): it is a pure
 * READ-MODEL / delegation layer that aggregates what Modules 11 (My Tasks / Client
 * Board), 12 (block-request queue), 13 (Client Health snapshots) and 14 (Performance
 * Score) already produce, into three role-based landing surfaces:
 *
 *   - staffLanding (Rule 9): the actor's own open tasks (M11 My Tasks, SLA-risk
 *     first) + a RUNNING current-month Performance Score with breakdown and trend
 *     (M14). The running score is computed-on-read and NEVER stored (delegates to
 *     performance.previewCurrent).
 *   - teamPortal (Rule 10, SPV/Lead + Director): the lead's division Performance
 *     rollup (M14), a Client Board shortcut list (M11) for the team's Clients, and
 *     the Block-request approval QUEUE (M12 §5.3a). Approve/reject stay on the
 *     existing M12 endpoints — this module reimplements nothing.
 *   - managementDashboard (Rule 11 / §6.3, Director/OD only): every Client's latest
 *     Health band (M13) with trend direction and the dragging (lowest) sub-component,
 *     filterable/sortable by band (At Risk first) and AM. Read-only; drill-through by
 *     reference id.
 *
 * No status is ever written here, no ID minted, no notification emitted — the whole
 * module is reads plus delegation to the owning modules. The external Client Portal
 * (M15-C2) is a separate blocked track and lives nowhere in this file.
 *
 * Reference: archive/backend-go/internal/module15_portal/portal.go.
 */

import { permission } from '@cdps/core';
import { type Queryable } from '@cdps/db';
import * as board from './board';
import * as health from './health';
import * as performance from './performance';
import * as task from './task';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** The CDPS division whose lead oversees the whole client book. */
export const ACCOUNT_DIVISION = 'Account';

/** Trend-direction values for the Management Dashboard (data enums, not user-facing). */
export const TREND_UP = 'up';
export const TREND_DOWN = 'down';
export const TREND_FLAT = 'flat';

/** The actor may not see this portal surface. Reuses the shared house BI string (Rule 8 — no new BI). */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';

/** The actor's role may not view the requested portal surface (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_FORBIDDEN) {
    super(message);
    this.name = 'PortalForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Staff landing (Rule 9 / §4).
// ---------------------------------------------------------------------------

/** The default staff home base (Rule 9): open tasks (SLA-risk first) + running score + trend. */
export interface StaffLanding {
  employeeId: string;
  openTasks: board.Card[];
  runningScore: performance.Snapshot | null; // null when the actor has no KPI Profile role
  trend: performance.Snapshot[];
}

/**
 * staffLanding builds the landing page for the actor's OWN data (Role Matrix: Staff =
 * own). Open tasks come from M11 My Tasks (own scope), filtered to not-Done and sorted
 * SLA-risk first (overdue first, then nearest due date, then no-due-date last). The
 * running score is the M14 current-month preview (computed-on-read, never stored); a
 * role without a KPI Profile (Sales/Finance/Marketing, or a lead) simply has a null
 * runningScore — not an error.
 */
export async function staffLanding(sql: Queryable, actor: Actor, now: Date): Promise<StaffLanding> {
  const out: StaffLanding = { employeeId: actor.employeeId, openTasks: [], runningScore: null, trend: [] };

  const cards = await board.myTasks(sql, actor, '');
  const open = cards.filter((c) => c.universalColumn !== board.UC_DONE); // "open" = not yet Done
  sortBySLARisk(open);
  out.openTasks = open;

  // Running current-month Performance Score (never stored). A missing KPI Profile →
  // performance.NotFoundError → leave runningScore null (not an error).
  try {
    out.runningScore = await performance.previewCurrent(sql, actor, actor.employeeId, now);
  } catch (err) {
    if (!(err instanceof performance.NotFoundError)) {
      throw err;
    }
  }

  // Prior-month trend (stored snapshots only). No snapshots → empty slice.
  try {
    out.trend = await performance.trend(sql, actor, actor.employeeId);
  } catch (err) {
    if (!(err instanceof performance.NotFoundError)) {
      throw err;
    }
  }
  return out;
}

/**
 * sortBySLARisk orders cards "nearest SLA-risk first" using the fields the M11
 * read-model exposes (overdue, dueDate): overdue cards first (earliest due first),
 * then cards with an upcoming due date (earliest first), then cards with no due date.
 * Stable, so same-key cards keep My Tasks' id order.
 */
function sortBySLARisk(cards: board.Card[]): void {
  const group = (c: board.Card): number => {
    if (c.overdue) {
      return 0;
    }
    return c.dueDate !== '' ? 1 : 2;
  };
  // Decorate-sort-undecorate for a stable sort keyed on (group, dueDate) with the
  // original index as the final tiebreak (Array.prototype.sort is not guaranteed
  // stable across the same key otherwise for older engines).
  cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ga = group(a.c);
      const gb = group(b.c);
      if (ga !== gb) {
        return ga - gb;
      }
      if (a.c.dueDate !== b.c.dueDate) {
        return a.c.dueDate < b.c.dueDate ? -1 : 1; // "YYYY-MM-DD" sorts lexicographically
      }
      return a.i - b.i;
    })
    .forEach((x, idx) => {
      cards[idx] = x.c;
    });
}

// ---------------------------------------------------------------------------
// Team Portal (Rule 10 / §6.2).
// ---------------------------------------------------------------------------

/**
 * One Client-Board drill-through row on the Team Portal (Rule 10). A reference only
 * (client id + a board deep-link hint), not a copy of the board's cards.
 */
export interface ClientShortcut {
  clientId: string;
  clientName: string;
  assignedAm: string;
  boardRef: string; // deep-link hint into the Client Board (M11)
}

/** The SPV/Lead landing (Rule 10): division Performance rollup, Client-Board shortcuts, block queue. */
export interface TeamPortal {
  division: string;
  rollup: performance.TeamRollup;
  clients: ClientShortcut[];
  blockQueue: task.PendingBlockRequest[];
}

/**
 * teamPortal builds the lead landing for a division (Rule 10). division defaults to
 * the actor's own; a Director may pass any division. Only a lead of that division (or
 * a Director) may view it. periodId (optional) selects the rollup month; empty = latest.
 */
export async function teamPortal(sql: Queryable, actor: Actor, divisionArg: string, periodId: string): Promise<TeamPortal> {
  const division = divisionArg === '' ? actor.role.division : divisionArg;
  if (division === '' || !permission.isLead(actor, division)) {
    throw new ForbiddenError();
  }

  const rollup = await performance.teamRollup(sql, actor, division, periodId);
  const clients = await teamClients(sql, division);
  // Block-approval queue: pending requests the actor may action (M12 scopes it to the
  // lead's division / Director). Reuses the M12 read-model; approve/reject stay on M12.
  const blockQueue = await task.pendingBlockRequests(sql, actor);
  return { division, rollup, clients, blockQueue };
}

/**
 * teamClients lists the Clients whose board the lead should be able to jump to. An
 * Account lead / Director oversees the whole client book; any other division lead sees
 * the Clients with at least one Brief in that division. Reference rows only.
 */
async function teamClients(sql: Queryable, division: string): Promise<ClientShortcut[]> {
  const rows =
    division === ACCOUNT_DIVISION
      ? await sql<{ id: string; toko: string; assigned_am_id: string | null }[]>`
          select id, toko, coalesce(assigned_am_id, '') as assigned_am_id from clients order by id`
      : await sql<{ id: string; toko: string; assigned_am_id: string | null }[]>`
          select distinct c.id, c.toko, coalesce(c.assigned_am_id, '') as assigned_am_id
            from clients c
            join services sv on sv.client_id = c.id
            join briefs b on b.service_id = sv.id
           where b.assigned_division = ${division}
           order by c.id`;
  return rows.map((r) => ({
    clientId: r.id,
    clientName: r.toko,
    assignedAm: r.assigned_am_id ?? '',
    boardRef: `/api/v1/board?client=${r.id}`,
  }));
}

// ---------------------------------------------------------------------------
// Management Dashboard (Rule 11 / §6.3).
// ---------------------------------------------------------------------------

/** One Client's line on the Management Dashboard: latest Health band, trend, dragging component + drill-through ids. */
export interface MgmtRow {
  clientId: string;
  clientName: string;
  assignedAm: string;
  /** Deep-link hint into the Client Board (M11) — §6.3 "drill-through into the relevant
   *  Client Board" (M15-G2). Always present (a board exists per client), mirroring
   *  ClientShortcut.boardRef; snapshotId is the sibling M13 drill-through. */
  boardRef: string;
  snapshotId: string; // "" when the Client has no snapshot yet
  period: string; // "YYYY-MM-DD" of the latest snapshot; "" when none
  scoreDisplay: string;
  band: string; // "" when no snapshot
  trendDirection: string; // up | down | flat
  draggingComponent: string; // lowest included capped sub-score; "" when none
  draggingCapped: number | null;
}

/** The portfolio-wide health scan (Rule 11). */
export interface ManagementDashboard {
  filterBand: string;
  filterAm: string;
  /** Division-mix filter (§6.3 "by division mix"); "" = whole client base (M15-G1). */
  filterDivision: string;
  sort: string;
  rows: MgmtRow[];
}

/**
 * managementDashboard builds the Director/OD portfolio view (Rule 11 / §6.3 —
 * "management-level roles" = Director + OD). Read-only. filterBand / filterAm narrow
 * the rows; sortBy "am" groups by AM (then band), anything else defaults to band with
 * At Risk first.
 */
export async function managementDashboard(
  sql: Queryable,
  actor: Actor,
  filterBand: string,
  filterAm: string,
  filterDivision: string,
  sortBy: string,
): Promise<ManagementDashboard> {
  if (!(actor.role.director || actor.role.od)) {
    throw new ForbiddenError();
  }
  const out: ManagementDashboard = { filterBand, filterAm, filterDivision, sort: sortBy, rows: [] };

  const clients = await sql<{ id: string; toko: string; assigned_am_id: string | null }[]>`
    select id, toko, coalesce(assigned_am_id, '') as assigned_am_id from clients order by id`;

  // M15-G1: division-mix filter. When set, restrict to Clients whose execution work
  // touches that division (≥1 Brief assigned there) — the SAME division scope as
  // teamClients, so the two portal surfaces agree on what "in a division" means.
  const divisionSet = filterDivision === '' ? null : await clientIdsInDivision(sql, filterDivision);

  for (const c of clients) {
    if (divisionSet !== null && !divisionSet.has(c.id)) {
      continue;
    }
    const am = c.assigned_am_id ?? '';
    if (filterAm !== '' && am !== filterAm) {
      continue;
    }
    const row = await mgmtRowFor(sql, c.id, c.toko, am);
    if (filterBand !== '' && row.band !== filterBand) {
      continue;
    }
    out.rows.push(row);
  }
  sortMgmtRows(out.rows, sortBy);
  return out;
}

/**
 * clientIdsInDivision returns the Clients whose work touches `division`, mirroring
 * teamClients' scope: an Account filter spans the whole client book (every released
 * Client has an AM); any other division = Clients with ≥1 Brief assigned there.
 */
async function clientIdsInDivision(sql: Queryable, division: string): Promise<Set<string>> {
  const rows =
    division === ACCOUNT_DIVISION
      ? await sql<{ id: string }[]>`select id from clients`
      : await sql<{ id: string }[]>`
          select distinct c.id
            from clients c
            join services sv on sv.client_id = c.id
            join briefs b on b.service_id = sv.id
           where b.assigned_division = ${division}`;
  return new Set(rows.map((r) => r.id));
}

/**
 * mgmtRowFor loads one Client's latest + previous snapshot and derives the band, trend
 * direction and dragging component. A Client with no snapshot yet is rendered with an
 * empty band / "—" score (house rule 7) and flat trend.
 */
async function mgmtRowFor(sql: Queryable, clientId: string, name: string, am: string): Promise<MgmtRow> {
  const row: MgmtRow = {
    clientId, clientName: name, assignedAm: am, boardRef: `/api/v1/board?client=${clientId}`,
    snapshotId: '', period: '', scoreDisplay: '—',
    band: '', trendDirection: TREND_FLAT, draggingComponent: '', draggingCapped: null,
  };

  const latest = await sql<
    { id: string; period_start: string | Date; final_health_score: string | null; band: string; components_json: unknown }[]
  >`
    select id, period_start, final_health_score, band, components_json
      from client_health_snapshots where client_id = ${clientId} order by period_start desc limit 1`;
  if (latest.length === 0) {
    return row; // no snapshot yet
  }
  const l = latest[0];
  row.snapshotId = l.id;
  row.period = dateStr(l.period_start);
  row.band = l.band;
  const score = l.final_health_score === null ? null : Number(l.final_health_score);
  if (score !== null) {
    row.scoreDisplay = score.toFixed(2);
  }

  // Previous snapshot for trend direction.
  const prev = await sql<{ final_health_score: string | null; band: string }[]>`
    select final_health_score, band from client_health_snapshots
     where client_id = ${clientId} and period_start < ${l.period_start} order by period_start desc limit 1`;
  if (prev.length > 0) {
    const prevScore = prev[0].final_health_score === null ? null : Number(prev[0].final_health_score);
    row.trendDirection = trendDirection(score, prevScore, l.band, prev[0].band);
  }

  // Dragging component = the lowest included, capped sub-score (§6.3).
  const dragging = draggingComponent(l.components_json);
  row.draggingComponent = dragging.name;
  row.draggingCapped = dragging.capped;
  return row;
}

/**
 * trendDirection compares the latest and previous snapshot. Numeric scores are the
 * primary signal; when either is absent it falls back to band rank; ties are flat.
 */
function trendDirection(cur: number | null, prev: number | null, curBand: string, prevBand: string): string {
  if (cur !== null && prev !== null) {
    if (cur > prev) {
      return TREND_UP;
    }
    if (cur < prev) {
      return TREND_DOWN;
    }
    return TREND_FLAT;
  }
  const rc = bandRank(curBand);
  const rp = bandRank(prevBand);
  if (rc > rp) {
    return TREND_UP;
  }
  if (rc < rp) {
    return TREND_DOWN;
  }
  return TREND_FLAT;
}

/**
 * draggingComponent returns the name and capped value of the lowest INCLUDED sub-score
 * in a Health snapshot's components_json (§6.3). Excluded components are ignored;
 * ""/null when nothing is included.
 */
function draggingComponent(compJson: unknown): { name: string; capped: number | null } {
  const comps = parseJsonb<health.Component[]>(compJson);
  if (comps === null) {
    return { name: '', capped: null };
  }
  let name = '';
  let lowest: number | null = null;
  for (const c of comps) {
    if (!c.included || c.capped === null || c.capped === undefined) {
      continue;
    }
    if (lowest === null || c.capped < lowest) {
      lowest = c.capped;
      name = c.name;
    }
  }
  return { name, capped: lowest };
}

/** bandRank orders the health bands for trend (At Risk lowest); unknown/empty ranks below At Risk. */
function bandRank(band: string): number {
  switch (band) {
    case health.BAND_HEALTHY:
      return 3;
    case health.BAND_WATCH:
      return 2;
    case health.BAND_AT_RISK:
      return 1;
    default:
      return 0;
  }
}

/** bandSortKey orders rows so At Risk surfaces FIRST (Rule 11 default), then Watch, then Healthy, then no-snapshot. */
function bandSortKey(band: string): number {
  switch (band) {
    case health.BAND_AT_RISK:
      return 0;
    case health.BAND_WATCH:
      return 1;
    case health.BAND_HEALTHY:
      return 2;
    default:
      return 3; // no snapshot / unknown — last
  }
}

/**
 * sortMgmtRows applies the dashboard ordering: by AM (then band) when sortBy=="am",
 * otherwise band with At Risk first (the default, Rule 11). Client id is the final
 * tiebreak, keeping the sort deterministic.
 */
function sortMgmtRows(rows: MgmtRow[], sortBy: string): void {
  rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (sortBy === 'am' && a.r.assignedAm !== b.r.assignedAm) {
        return a.r.assignedAm < b.r.assignedAm ? -1 : 1;
      }
      const ka = bandSortKey(a.r.band);
      const kb = bandSortKey(b.r.band);
      if (ka !== kb) {
        return ka - kb;
      }
      if (a.r.clientId !== b.r.clientId) {
        return a.r.clientId < b.r.clientId ? -1 : 1;
      }
      return a.i - b.i;
    })
    .forEach((x, idx) => {
      rows[idx] = x.r;
    });
}

// ---------------------------------------------------------------------------
// Small shared helpers.
// ---------------------------------------------------------------------------

/** dateStr renders a `date` column value as "YYYY-MM-DD" (matches the other modules; no WIB offset). */
function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/**
 * parseJsonb tolerates postgres.js returning a jsonb column either already parsed
 * (object) or as a raw string (this setup returns the latter). Returns null on
 * empty/unparseable input.
 */
function parseJsonb<T>(v: unknown): T | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === 'string') {
    if (v === '') {
      return null;
    }
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}
