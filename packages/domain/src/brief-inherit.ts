/**
 * brief-inherit — RAB-16 "satu klik, warisi semua" (keputusan pemilik 3,
 * HANDOFF_M6ABC_SESI31 §1). When a Plan period is active, every Section P-C work
 * row (`plan_row`) descends into ONE Brief for its divisi PIC. The AM fills only
 * jatuh tempo (due date) + prioritas; everything else is inherited from the row.
 *
 * WHY A SEPARATE MODULE, and how it relates to the two Brief origins
 * ---------------------------------------------------------------------------
 * The projection `plan_row → Brief` lives in ONE place — `planRowToBriefInput`
 * below — so the map cannot drift across pages/routes (the O43 class). The row
 * INSERT itself is delegated to `account.insertBrief`, the single Brief-birth
 * primitive, so an inherited Brief and a manual Brief are born identically.
 *
 * A Brief has two mutually-exclusive origins (see migration 20260818000000):
 *   - manual (jalur STR-, RAB-17 tetap dilayani): carries `strategy_id`, no link;
 *   - inherited (M6B): carries `plan_row_id`, `strategy_id` NULL.
 * This module writes only the second kind. It deliberately does NOT reuse
 * `account.createBrief` (whose gate resolves an STR- `strategy_plans` row): the
 * Plan world is `strategi` (STRG-) + `plan`, which never writes `strategy_plans`.
 * The gate here is simpler and native to M6B — the period being `Aktif` is itself
 * the proof that its Strategi was approved and its rows were planned.
 *
 * SERVICE RESOLUTION (which Service each Brief lands on)
 * ---------------------------------------------------------------------------
 * PC-3 gives a row exactly one origin, and a Brief needs a Service (FK NOT NULL):
 *   - `service_id` (Plan Satuan / an explicitly-tied row) → that Service. Always
 *     unambiguous — the row names it.
 *   - `strategi_pillar_id` (Full-Management) → the Strategi is per-CONTRACT
 *     (`strategi.contract_id`), not per-service, and a contract may carry several
 *     services, so a pillar names no single Service. We brief onto the contract's
 *     Service only when it has EXACTLY ONE; a contract with several services is
 *     `service_ambigu` (skipped, not guessed) — the AM ties those rows to a
 *     service explicitly. Open question logged in docs/DECISIONS.md 2026-08-18.
 *   - `di_luar_strategi` / `di_luar_service` → no Service anchor: SKIPPED
 *     (`di_luar`). Auto-briefing off-strategy work would invent a target the row
 *     explicitly says it does not have.
 */
import { bi } from '@cdps/core';
import { withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ALLOWED_DIVISIONS,
  ALLOWED_PRIORITIES,
  ConflictError,
  ForbiddenError,
  MSG_INVALID_PRIORITY,
  NotFoundError,
  ValidationError,
  advanceServiceToBriefed,
  insertBrief,
  isServiceBriefable,
  type Actor,
  type Brief,
  type BriefInput,
} from './account';
import {
  PLAN_AKTIF,
  canWritePlan,
  listPlanRows,
  loadPlanForUpdate,
  ownerAmOfClient,
  type PlanRow,
  MSG_PLAN_FORBIDDEN,
} from './plan';

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A Plan period must be `Aktif` before its rows can be inherited into Briefs. */
export const MSG_INHERIT_PLAN_NOT_ACTIVE =
  '[brief hanya dapat diwarisi dari periode Plan yang sudah aktif]';

/** The AM supplies these two operational fields per row; the rest is inherited. */
export interface BriefInheritFill {
  planRowId: number;
  dueDate: string; // YYYY-MM-DD
  priority: string; // Low | Medium | High
}

/**
 * Why a `plan_row` was NOT turned into a Brief. Machine codes (snake_case), for
 * the UI to render its own friendly text — a skip is an annotation, not a
 * validation error, so it is not a BI `[...]` string.
 */
export type BriefInheritSkipReason =
  | 'di_luar' // di_luar_strategi / di_luar_service — no Service anchor
  | 'service_ambigu' // pillar-origin, but the contract carries several services
  | 'tanpa_jadwal' // AM supplied no due date + priority for this row
  | 'sudah_diwarisi' // this row already produced a Brief (idempotent)
  | 'service_tidak_ditemukan' // resolved Service id does not exist
  | 'service_tidak_briefable' // Service terminal ([Done]/[Voided])
  | 'divisi_pic_tidak_valid' // divisi_pic not one of the four executing divisions
  | 'kuota_nol'; // PC-6 quota is 0 — nothing to brief

export interface BriefInheritSkip {
  planRowId: number;
  reason: BriefInheritSkipReason;
}

export interface BriefInheritResult {
  created: Brief[];
  skipped: BriefInheritSkip[];
}

/**
 * planRowToBriefInput is THE single projection of a `plan_row` onto a Brief. Only
 * `dueDate` + `priority` come from the AM (`fill`); everything else is inherited.
 *
 * Field map (backlog §4 RAB-16 — klien, service, divisi PIC, kanal, pilar, kuota,
 * satuan, hasil diharapkan, baseline, lampiran sumber):
 *   assignedDivision ← divisiPic                       (PC-8 → Brief target divisi)
 *   quantityTarget   ← kuota                           (PC-6; rounded to a count)
 *   deliverableType  ← satuan | aksi | pilar           (PC-6 unit; non-empty)
 *   title            ← hasilDiharapkan | "<pilar> — <channel>"   (PC-11)
 *   instructions     ← kanal / pilar / aksi / prasyarat trace
 * klien + service are the Brief's parent Service (resolved by the caller); the
 * baseline / lampiran sumber four-level trace lives durably in `briefs.plan_row_id`
 * (§8), so the wire projection stays lossy-by-design while the row is the truth.
 */
export function planRowToBriefInput(row: PlanRow, fill: BriefInheritFill): BriefInput {
  const satuan = (row.satuan ?? '').trim();
  const aksi = (row.aksi ?? '').trim();
  const hasil = (row.hasilDiharapkan ?? '').trim();
  const deliverableType = satuan || aksi || row.pilar;
  const title = hasil || `${row.pilar} — ${row.channel}`;
  const instructions = [
    `Kanal: ${row.channel}`,
    `Pilar: ${row.pilar}`,
    aksi ? `Aksi: ${aksi}` : '',
    row.prasyarat ? `Prasyarat: ${(row.prasyarat ?? '').trim()}` : '',
  ]
    .filter((s) => s !== '')
    .join('\n');
  return {
    title,
    assignedDivision: row.divisiPic,
    deliverableType,
    quantityTarget: Math.round(row.kuota),
    dueDate: fill.dueDate,
    priority: fill.priority,
    instructions,
  };
}

/**
 * Resolve the Service a Full-Management (pillar-origin) row briefs onto. The
 * Strategi is per-contract, so the anchor is the contract's Service — but only
 * when the contract carries exactly one. Returns { ambiguous: true } when it
 * carries several (the caller then skips the row rather than pick).
 */
async function contractSoleService(
  tx: Queryable,
  contractId: string,
  clientId: string,
): Promise<{ serviceId: string | null; ambiguous: boolean }> {
  const rows = await tx<{ id: string }[]>`
    select id from services where contract_id = ${contractId} and client_id = ${clientId} order by id asc`;
  if (rows.length === 1) return { serviceId: rows[0].id, ambiguous: false };
  return { serviceId: null, ambiguous: rows.length > 1 };
}

/**
 * inheritBriefsFromPlan is the one-click write path (RAB-16). It creates a Brief
 * for every eligible `plan_row` of an `Aktif` period, in a single transaction, and
 * reports every row it skipped and why. AM/lead/Director write scope (`canWritePlan`);
 * the AM-supplied `fills` (due date + priority) are validated BEFORE any id is
 * minted (house rule 1). Idempotent: a row that already produced a Brief is
 * skipped (`sudah_diwarisi`), and the DB `uq_briefs_plan_row` index is the backstop
 * if two callers race. The first Brief on a Service advances it to [Briefed].
 */
export async function inheritBriefsFromPlan(
  sql: Sql,
  actor: Actor,
  planId: string,
  fills: BriefInheritFill[],
): Promise<BriefInheritResult> {
  const now = new Date();

  // Validate the AM's fills up-front (before any insert). One bad due date or
  // priority aborts the whole click — the AM fixes their one form and retries.
  const fillMap = new Map<number, BriefInheritFill>();
  for (const f of fills) {
    const dueDate = (f.dueDate ?? '').trim();
    const priority = (f.priority ?? '').trim();
    if (!RE_DATE.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (!ALLOWED_PRIORITIES.has(priority)) {
      throw new ValidationError(MSG_INVALID_PRIORITY);
    }
    fillMap.set(f.planRowId, { planRowId: f.planRowId, dueDate, priority });
  }

  return withTransaction(sql, async (tx: TransactionSql) => {
    const plan = await loadPlanForUpdate(tx, planId);
    const ownerAm = await ownerAmOfClient(tx, plan.clientId);
    if (!canWritePlan(actor, ownerAm)) {
      throw new ForbiddenError(MSG_PLAN_FORBIDDEN);
    }
    if (plan.status !== PLAN_AKTIF) {
      throw new ConflictError(MSG_INHERIT_PLAN_NOT_ACTIVE);
    }

    const rows = await listPlanRows(tx, planId);
    const rowIds = rows.map((r) => r.id);
    const linked = rowIds.length
      ? await tx<{ plan_row_id: number }[]>`
          select plan_row_id from briefs where plan_row_id = any(${rowIds})`
      : [];
    const already = new Set(linked.map((l) => Number(l.plan_row_id)));

    // Full-Management (pillar-origin) rows share one anchor: the contract's Service.
    const contractSvc = plan.contractId
      ? await contractSoleService(tx, plan.contractId, plan.clientId)
      : { serviceId: null, ambiguous: false };

    const created: Brief[] = [];
    const skipped: BriefInheritSkip[] = [];
    const briefedServices = new Set<string>();

    for (const row of rows) {
      const skip = (reason: BriefInheritSkipReason): void => {
        skipped.push({ planRowId: row.id, reason });
      };

      const fill = fillMap.get(row.id);
      if (!fill) {
        skip('tanpa_jadwal');
        continue;
      }
      if (already.has(row.id)) {
        skip('sudah_diwarisi');
        continue;
      }
      // PC-3 origin → Service. di_luar_* rows have no Service anchor; a pillar
      // row leans on the contract's sole Service (or is skipped if ambiguous).
      let serviceId: string;
      if (row.serviceId) {
        serviceId = row.serviceId;
      } else if (row.strategiPillarId !== null) {
        if (contractSvc.ambiguous) {
          skip('service_ambigu');
          continue;
        }
        if (contractSvc.serviceId === null) {
          skip('service_tidak_ditemukan');
          continue;
        }
        serviceId = contractSvc.serviceId;
      } else {
        skip('di_luar');
        continue;
      }
      if (!ALLOWED_DIVISIONS.includes(row.divisiPic as (typeof ALLOWED_DIVISIONS)[number])) {
        skip('divisi_pic_tidak_valid');
        continue;
      }
      if (!(row.kuota > 0)) {
        skip('kuota_nol');
        continue;
      }
      const svc = await tx<{ status: string }[]>`
        select status from services where id = ${serviceId} for update`;
      if (svc.length === 0) {
        skip('service_tidak_ditemukan');
        continue;
      }
      if (!isServiceBriefable(svc[0].status)) {
        skip('service_tidak_briefable');
        continue;
      }

      const input = planRowToBriefInput(row, fill);
      const brief = await insertBrief(tx, actor, {
        serviceId,
        strategyId: null,
        planRowId: row.id,
        input,
        now,
      });
      created.push(brief);
      // First Brief on a Service advances it to [Briefed] (§5 Flow 2). Once per
      // Service per click — the helper is idempotent, but skipping repeats a lock.
      if (!briefedServices.has(serviceId)) {
        await advanceServiceToBriefed(tx, actor, serviceId);
        briefedServices.add(serviceId);
      }
    }

    return { created, skipped };
  });
}
