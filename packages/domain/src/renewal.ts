/**
 * Kinerja Sales — R-03: Renewal / Cross-Sell from the Client Record.
 *
 * Deviasi PRD M0 §6 disetujui pemilik (`docs/DECISIONS.md` 2026-08-30, arah
 * a): `sales.close()` selalu mencetak `CLI-` baru; ini adalah pintu KEDUA
 * yang menutup kontrak (`CTR-`)/service (`SVC-`)/transaksi (`TRX-`) baru
 * pada klien yang SUDAH ADA — nol `CLI-` baru, nol `LEAD-`/`PRSP-` palsu
 * (`RENCANA_KINERJA_SALES.md` §4).
 *
 * KENAPA MESIN STATUS SENDIRI (`contract_renewal`), BUKAN MENUMPANG
 * `prospect_attempt`. Renewal tidak pernah punya Lead/Prospect, padahal
 * setiap fungsi negosiasi di `sales.ts` (`submitNegotiation`/
 * `decideNegotiation`/dst) memuat `attempt_id` di jantungnya — memaksakan
 * alur itu ke entitas tanpa attempt berarti menulis ulang mesin closing yang
 * sudah lama stabil & teruji. Mesin baru mereplikasi HANYA sub-alur
 * negosiasi (Draft→Negotiation→Closed|Cancelled), dengan label status YANG
 * SAMA PERSIS (STATUS_NEG_* dari `sales.ts`, diimpor bukan didefinisikan
 * ulang) supaya tidak ada kosakata kedua.
 *
 * APA YANG DIPAKAI ULANG DARI `sales.ts` (bukan ditulis ulang):
 *   - `resolveProposalLine` — penentuan harga MSL / validasi harga custom.
 *   - `validateParties`/`validateShape`/`validateScheduleTotal` — aturan
 *     alokasi Σ=100% dan bentuk skema pembayaran, byte-identik.
 *   - Label status negosiasi (`STATUS_NEG_*`), `DECISION_*`, `PAYMENT_SCHEME_*`.
 *   - Tabel `negotiation_proposals`/`negotiation_proposal_lines` (ditambat via
 *     `renewal_id`, bukan `attempt_id` — migrasi 20260901090000).
 *
 * KEPUTUSAN PEMILIK 2026-08-30 yang membentuk modul ini:
 *   - Kredit alokasi mengikuti sales yang MEMPROSES closing (bukan otomatis
 *     sales pemilik lama) — makanya `client_sales_allocations` sekarang per
 *     TRANSAKSI (migrasi 20260901080000), bukan per klien.
 *   - Aturan komisi renewal SAMA dengan penjualan baru — `closeRenewal` tidak
 *     punya cabang komisi terpisah sama sekali.
 *   - Strategi kontrak baru TETAP manual oleh AM — modul ini TIDAK membuat
 *     baris `strategi` apa pun.
 *   - Cross-sell SELALU kontrak baru terpisah (nol tempel ke kontrak aktif).
 */

import { ident, money, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import { effectiveAt } from './msl';
import {
  ClosingResult,
  CustomTermRequiresNegotiationError,
  ForbiddenError,
  IncompleteError,
  NotClosableError,
  NotFoundError,
  ProposalLine,
  DECISION_APPROVE,
  DECISION_REJECT,
  DECISION_REVISE,
  STATUS_NEG_APPROVED,
  STATUS_NEG_AUTO_APPROVE,
  STATUS_NEG_PENDING,
  STATUS_NEG_REJECTED,
  STATUS_NEG_REVISION,
  MAX_SERVICES,
  SALES_DIVISION,
  TooManyServicesError,
  hasCustomLine,
  resolveProposalLine,
  validateParties,
  validateScheduleTotal,
  validateShape,
  type Actor,
  type ClosingInput,
} from './sales';

export type { ClosingInput, ClosingResult, ProposalLine } from './sales';

/** contract_renewal machine (migration 20260901090000). */
export const RENEWAL_MACHINE = 'contract_renewal';
export const ENTITY_RENEWAL = 'contract_renewal';

export const STATUS_DRAFT = 'Draft';
export const STATUS_CLOSED = 'Closed';
export const STATUS_CANCELLED = 'Cancelled';

export const JENIS_PERPANJANGAN = 'perpanjangan';
export const JENIS_CROSS_SELL = 'cross_sell';

// ---------------------------------------------------------------------------
// BI messages.
// ---------------------------------------------------------------------------

export const MSG_FORBIDDEN = '[anda tidak memiliki akses ke data ini]';
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
export const MSG_RENEWAL_NOT_FOUND = '[permintaan perpanjangan/cross-sell tidak ditemukan]';
export const MSG_CONTRACT_MISMATCH = '[kontrak yang dipilih bukan milik klien ini]';

export { ForbiddenError, IncompleteError, NotFoundError, NotClosableError, TooManyServicesError, CustomTermRequiresNegotiationError };

/** The contract named as `contractSebelumnyaId` does not belong to this client (→ 409). */
export class ContractMismatchError extends Error {
  constructor() {
    super(MSG_CONTRACT_MISMATCH);
    this.name = 'RenewalContractMismatchError';
  }
}

// ---------------------------------------------------------------------------
// Permission — mirrors sales.canWriteAttempt, keyed on the CLIENT's own
// Sales PIC (there is no attempt to own here).
// ---------------------------------------------------------------------------

/** canManageRenewal: Director everywhere; Sales Lead division-wide; the client's own Sales PIC. */
export function canManageRenewal(actor: Actor, salesPicId: string | null): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.role.division !== SALES_DIVISION) {
    return false;
  }
  if (actor.role.level === permission.LevelLead) {
    return true;
  }
  return actor.role.level === permission.LevelStaff && salesPicId !== null && actor.employeeId === salesPicId;
}

/** canReadRenewal: the write set, plus every read-all role (OD/Director) — mirrors contract.ts's canReadContract. */
export function canReadRenewal(actor: Actor, salesPicId: string | null): boolean {
  return canManageRenewal(actor, salesPicId) || permission.canReadAll(actor);
}

interface RenewalInfo {
  id: string;
  clientId: string;
  jenis: string;
  contractSebelumnyaId: string | null;
  status: string;
  salesPicId: string | null;
}

async function loadRenewal(tx: Queryable, renewalId: string, forUpdate: boolean): Promise<RenewalInfo> {
  type Row = { id: string; client_id: string; jenis: string; contract_sebelumnya_id: string | null; status: string; sales_pic_id: string | null };
  const rows = forUpdate
    ? await tx<Row[]>`
        select r.id, r.client_id, r.jenis, r.contract_sebelumnya_id, r.status, c.sales_pic_id
        from contract_renewals r join clients c on c.id = r.client_id
        where r.id = ${renewalId} for update`
    : await tx<Row[]>`
        select r.id, r.client_id, r.jenis, r.contract_sebelumnya_id, r.status, c.sales_pic_id
        from contract_renewals r join clients c on c.id = r.client_id
        where r.id = ${renewalId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_RENEWAL_NOT_FOUND);
  }
  const r = rows[0];
  return {
    id: r.id, clientId: r.client_id, jenis: r.jenis, contractSebelumnyaId: r.contract_sebelumnya_id,
    status: r.status, salesPicId: r.sales_pic_id,
  };
}

/** transition drives the contract_renewal machine within tx (status path only). */
async function renewalTransition(
  sm: statemachine.SmExecutor,
  renewalId: string,
  to: string,
  actor: Actor,
): Promise<statemachine.TransitionResult> {
  return statemachine.transition(sm, {
    machine: RENEWAL_MACHINE, entityType: ENTITY_RENEWAL, table: 'contract_renewals',
    entityId: renewalId, to, actor,
  });
}

// ---------------------------------------------------------------------------
// Create.
// ---------------------------------------------------------------------------

export interface Renewal {
  id: string;
  clientId: string;
  jenis: string;
  contractSebelumnyaId: string | null;
  status: string;
  createdAt: Date;
  createdBy: string;
}

/**
 * createRenewal opens a Draft renewal/cross-sell request on an existing
 * client (M0 §6 deviasi, R-03). `jenis='perpanjangan'` requires
 * `contractSebelumnyaId` naming a Contract of the SAME client (renewal
 * chain); `jenis='cross_sell'` always starts a standalone contract (owner
 * decision 2026-08-30) and takes no chain link.
 */
export async function createRenewal(
  sql: Sql,
  actor: Actor,
  clientId: string,
  jenis: string,
  contractSebelumnyaId: string | null,
  now: Date = new Date(),
): Promise<Renewal> {
  if (jenis !== JENIS_PERPANJANGAN && jenis !== JENIS_CROSS_SELL) {
    throw new IncompleteError();
  }
  if (jenis === JENIS_PERPANJANGAN && (contractSebelumnyaId ?? '').trim() === '') {
    throw new IncompleteError();
  }
  const chainId = jenis === JENIS_PERPANJANGAN ? contractSebelumnyaId : null;

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const clientRows = await tx<{ sales_pic_id: string | null }[]>`
      select sales_pic_id from clients where id = ${clientId} for update`;
    if (clientRows.length === 0) {
      throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
    }
    if (!canManageRenewal(actor, clientRows[0].sales_pic_id)) {
      throw new ForbiddenError();
    }
    if (chainId !== null) {
      const ctRows = await tx<{ client_id: string }[]>`select client_id from contracts where id = ${chainId}`;
      if (ctRows.length === 0) {
        throw new NotFoundError(MSG_RENEWAL_NOT_FOUND);
      }
      if (ctRows[0].client_id !== clientId) {
        throw new ContractMismatchError();
      }
    }

    const id = await ident.nextId(ex.ident, 'RNW', now);
    await tx`
      insert into contract_renewals (id, client_id, jenis, contract_sebelumnya_id, status, created_by)
      values (${id}, ${clientId}, ${jenis}, ${chainId}, ${STATUS_DRAFT}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: ENTITY_RENEWAL, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'create', beforeJson: null,
      afterJson: { client_id: clientId, jenis, contract_sebelumnya_id: chainId },
      createdBy: actor.employeeId,
    });
    return { id, clientId, jenis, contractSebelumnyaId: chainId, status: STATUS_DRAFT, createdAt: now, createdBy: actor.employeeId };
  });
}

// ---------------------------------------------------------------------------
// Negotiation — mirrors sales.ts's submitNegotiation/resubmitNegotiation/
// decideNegotiation/acceptCounter, anchored to renewal_id instead of
// attempt_id, on the contract_renewal machine instead of prospect_attempt.
// ---------------------------------------------------------------------------

/**
 * writeRenewalProposal appends a new immutable proposal version + its lines,
 * pricing every STANDARD line from the MSL (via `sales.resolveProposalLine`
 * — the SAME resolver a normal closing uses) and passing a CUSTOM line
 * through as negotiated. The 1..MAX_SERVICES cap and no-duplicate-service
 * rule mirror `sales.ts::writeProposal` exactly.
 */
async function writeRenewalProposal(
  tx: TransactionSql,
  ex: ReturnType<typeof executors>,
  actor: Actor,
  renewalId: string,
  lines: ProposalLine[],
  now: Date,
): Promise<void> {
  if (lines.length === 0 || lines.length > MAX_SERVICES) {
    throw lines.length > MAX_SERVICES ? new TooManyServicesError() : new IncompleteError();
  }
  const seen = new Set<string>();
  for (const l of lines) {
    const id = (l.masterServiceId ?? '').trim();
    if (id === '' || seen.has(id)) {
      throw new IncompleteError();
    }
    seen.add(id);
  }
  const resolved: { line: ProposalLine; price: string; rule: string }[] = [];
  for (const l of lines) {
    const { price, rule } = await resolveProposalLine(tx, l, now);
    resolved.push({ line: l, price, rule });
  }

  const verRows = await tx<{ max: number | null }[]>`
    select max(version_no) as max from negotiation_proposals where renewal_id = ${renewalId}`;
  const version = Number(verRows[0]?.max ?? 0) + 1;

  const proposalId = await ex.ident.identNext('NEG', now);
  await tx`
    insert into negotiation_proposals (id, renewal_id, version_no, proposed_by, created_by)
    values (${proposalId}, ${renewalId}, ${version}, ${actor.employeeId}, ${actor.employeeId})`;
  for (const { line: l, price, rule } of resolved) {
    await tx`
      insert into negotiation_proposal_lines
        (proposal_id, master_service_id, proposed_price, commission_rule, payment_terms, created_by)
      values (${proposalId}, ${l.masterServiceId}, ${price}, ${rule}, ${l.paymentTerms ?? null}, ${actor.employeeId})`;
  }
  await ex.audit.insertAudit({
    entityType: ENTITY_RENEWAL, entityId: renewalId, actorEmployeeId: actor.employeeId,
    action: 'negotiation_version', beforeJson: null,
    afterJson: { proposal_id: proposalId, version_no: version, lines: lines.length, services: resolved.map((r) => r.line.masterServiceId) },
    createdBy: actor.employeeId,
  });
}

/**
 * submitRenewalNegotiation opens negotiation on a Draft renewal.
 * `noNego=true` (every line standard) goes straight to Negotiation - Auto
 * Approved; any custom line routes to Negotiation - Pending Approval
 * (superior decision) — identical branch to `sales.submitNegotiation`.
 */
export async function submitRenewalNegotiation(
  sql: Sql,
  actor: Actor,
  renewalId: string,
  lines: ProposalLine[],
  noNego: boolean,
  now: Date = new Date(),
): Promise<statemachine.TransitionResult> {
  if (lines.length === 0) {
    throw new IncompleteError();
  }
  if (noNego && hasCustomLine(lines)) {
    // Mirrors sales.ts: a "no negotiation" submission may not smuggle custom terms.
    throw new CustomTermRequiresNegotiationError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await loadRenewal(tx, renewalId, true);
    if (!canManageRenewal(actor, r.salesPicId)) {
      throw new ForbiddenError();
    }
    if (r.status !== STATUS_DRAFT) {
      throw new NotClosableError();
    }
    const to = noNego ? STATUS_NEG_AUTO_APPROVE : STATUS_NEG_PENDING;
    const result = await renewalTransition(ex.sm, renewalId, to, actor);
    if (!result.ok) {
      return result;
    }
    await writeRenewalProposal(tx, ex, actor, renewalId, lines, now);
    return result;
  });
}

/** resubmitRenewalNegotiation sends a fresh version after Revision Required or Rejected. */
export async function resubmitRenewalNegotiation(
  sql: Sql,
  actor: Actor,
  renewalId: string,
  lines: ProposalLine[],
  now: Date = new Date(),
): Promise<statemachine.TransitionResult> {
  if (lines.length === 0) {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await loadRenewal(tx, renewalId, true);
    if (!canManageRenewal(actor, r.salesPicId)) {
      throw new ForbiddenError();
    }
    const result = await renewalTransition(ex.sm, renewalId, STATUS_NEG_PENDING, actor);
    if (!result.ok) {
      return result;
    }
    await writeRenewalProposal(tx, ex, actor, renewalId, lines, now);
    return result;
  });
}

/** decideRenewal is the superior's call on a Pending Approval renewal (engine enforces Lead/Director). */
export async function decideRenewal(
  sql: Sql,
  actor: Actor,
  renewalId: string,
  decision: string,
  note = '',
): Promise<statemachine.TransitionResult> {
  let to: string;
  switch (decision) {
    case DECISION_APPROVE:
      to = STATUS_NEG_APPROVED;
      break;
    case DECISION_REVISE:
      to = STATUS_NEG_REVISION;
      break;
    case DECISION_REJECT:
      to = STATUS_NEG_REJECTED;
      break;
    default:
      throw new IncompleteError();
  }
  if ((decision === DECISION_REVISE || decision === DECISION_REJECT) && note.trim() === '') {
    throw new IncompleteError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await loadRenewal(tx, renewalId, true);
    if (!canManageRenewal(actor, r.salesPicId)) {
      throw new ForbiddenError();
    }
    const result = await renewalTransition(ex.sm, renewalId, to, actor);
    if (!result.ok) {
      return result;
    }
    await tx`
      update negotiation_proposals set decision_note = ${note}
      where id = (select id from negotiation_proposals where renewal_id = ${renewalId} and decision_note is null
                  order by version_no desc limit 1)`;
    return result;
  });
}

/** acceptRenewalCounter: the salesperson accepts the superior's counter (Revision Required → Approved). */
export async function acceptRenewalCounter(sql: Sql, actor: Actor, renewalId: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await loadRenewal(tx, renewalId, true);
    if (!canManageRenewal(actor, r.salesPicId)) {
      throw new ForbiddenError();
    }
    return renewalTransition(ex.sm, renewalId, STATUS_NEG_APPROVED, actor);
  });
}

/** cancelRenewal abandons a not-yet-closed renewal (Draft/Pending/Revision/Rejected → Cancelled). */
export async function cancelRenewal(sql: Sql, actor: Actor, renewalId: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await loadRenewal(tx, renewalId, true);
    if (!canManageRenewal(actor, r.salesPicId)) {
      throw new ForbiddenError();
    }
    return renewalTransition(ex.sm, renewalId, STATUS_CANCELLED, actor);
  });
}

// ---------------------------------------------------------------------------
// Close — mirrors sales.ts::close, minus everything attempt/lead-specific:
// no CLI-, no client_platforms, no attempt transition, no win resolution.
// Money mechanics (allocation Σ=100%, payment scheme/schedule shape) are
// byte-identical (sales.validateParties/validateShape/validateScheduleTotal).
// ---------------------------------------------------------------------------

interface RenewalApprovedLine {
  masterServiceId: string;
  proposedPrice: string;
  commissionRule: string;
  name: string;
  versionNo: number;
  requiresStrategyPlan: boolean;
  planTier: string;
}

/**
 * loadApprovedRenewalLines is the renewal analogue of `sales.ts`'s private
 * `loadApprovedLines` — simpler, because a renewal has no Qualified Form
 * snapshot to reconcile against: EVERY line is enriched straight from the
 * MSL version effective when the winning proposal was written.
 */
async function loadApprovedRenewalLines(tx: Queryable, renewalId: string): Promise<RenewalApprovedLine[]> {
  const rows = await tx<{ master_service_id: string; proposed_price: string; commission_rule: string; created_at: Date }[]>`
    select npl.master_service_id, npl.proposed_price, npl.commission_rule, np.created_at
    from negotiation_proposal_lines npl
    join negotiation_proposals np on np.id = npl.proposal_id
    where np.renewal_id = ${renewalId}
      and np.version_no = (select max(version_no) from negotiation_proposals where renewal_id = ${renewalId})
    order by npl.id`;
  const out: RenewalApprovedLine[] = [];
  for (const r of rows) {
    const view = await effectiveAt(tx, r.master_service_id, r.created_at.toISOString().slice(0, 10));
    out.push({
      masterServiceId: r.master_service_id, proposedPrice: r.proposed_price, commissionRule: r.commission_rule,
      name: view.name, versionNo: view.versionNo, requiresStrategyPlan: view.requiresStrategyPlan, planTier: view.planTier,
    });
  }
  return out;
}

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Closing Form payload PLUS the new Contract's own window — a renewal
 * always births a fresh `contracts` row (R-01/§4), so unlike a normal
 * closing (whose Contract, if any, is a SEPARATE Account-side step) this
 * form must also collect what `contract.ts::ContractInput` collects.
 * Validated the same way (`ck_contracts_durasi`/`ck_contracts_jendela`
 * mirrored in TS): 1..36 months, end date strictly after start.
 */
export interface RenewalClosingInput extends ClosingInput {
  contractDurasiBulan: number;
  contractTanggalMulai: string; // YYYY-MM-DD
  contractTanggalAkhir: string; // YYYY-MM-DD
}

function validateContractWindow(input: RenewalClosingInput): void {
  const mulai = (input.contractTanggalMulai ?? '').trim();
  const akhir = (input.contractTanggalAkhir ?? '').trim();
  if (!RE_DATE.test(mulai) || !RE_DATE.test(akhir) || akhir <= mulai) {
    throw new IncompleteError();
  }
  const durasi = Number(input.contractDurasiBulan);
  if (!Number.isInteger(durasi) || durasi < 1 || durasi > 36) {
    throw new IncompleteError();
  }
}

/**
 * closeRenewal births Contract (CTR-) + Services (SVC-) + Transaction (TRX-)
 * + Installments on the SAME client — no `CLI-`, no `client_platforms`, no
 * attempt/lead machinery (there is none). Only an Approved/Auto-Approved
 * renewal may close (M0 §6 rule 1, mirrored). The commission rule is
 * IDENTICAL to a fresh closing (owner decision 2026-08-30) — nothing here
 * computes commission differently; `finance.commissionAchievement` reads
 * whatever Services/allocation this closing wrote, same as always.
 */
export async function closeRenewal(
  sql: Sql,
  actor: Actor,
  renewalId: string,
  input: RenewalClosingInput,
  now: Date = new Date(),
): Promise<ClosingResult> {
  validateShape(input);
  validateContractWindow(input);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await loadRenewal(tx, renewalId, true);
    if (!canManageRenewal(actor, r.salesPicId)) {
      throw new ForbiddenError();
    }
    if (r.status !== STATUS_NEG_APPROVED && r.status !== STATUS_NEG_AUTO_APPROVE) {
      throw new NotClosableError();
    }

    const lines = await loadApprovedRenewalLines(tx, renewalId);
    if (lines.length === 0) {
      throw new IncompleteError();
    }
    let total = 0n;
    for (const l of lines) {
      total += money.parse(l.proposedPrice);
    }
    validateScheduleTotal(input, total);

    // Same allocation rules as a fresh closing (Σ=100%, ≤5 people, PIC
    // required when split) — `resolvePIC` is NOT called here: unlike
    // `close()`, a renewal never re-stamps `clients.sales_pic_id`/
    // `commission_payment_pic_id` (those are the CLIENT's identity fields,
    // locked to Account Lead/OD correction per PERMISSIONS.md M4 — a renewal
    // is not that correction door). The Commission & Payment PIC still lives
    // per-transaction, same as ever, via `client_sales_allocations`.
    validateParties(input.parties);

    // 1) Contract (CTR-) — jenis/contract_sebelumnya_id fixed at createRenewal;
    //    window is what THIS closing form collected (validateContractWindow).
    const ctrId = await ex.ident.identNext('CTR', now);
    await tx`
      insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, jenis, contract_sebelumnya_id, transaction_id, created_by)
      values (${ctrId}, ${r.clientId}, ${input.contractDurasiBulan}, ${input.contractTanggalMulai}, ${input.contractTanggalAkhir},
              ${r.jenis}, ${r.contractSebelumnyaId}, ${null}, ${actor.employeeId})`;

    // 2) Transaction (TRX-) — minted BEFORE Services/allocation so both carry
    //    transaction_id (R-03, migrations 20260901080000/100000).
    const trxId = await ex.ident.identNext('TRX', now);
    await tx`
      insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
      values (${trxId}, ${r.clientId}, ${input.paymentScheme}, ${money.decimal(total)}, '[Menunggu Verifikasi]', ${actor.employeeId})`;
    await tx`update contracts set transaction_id = ${trxId} where id = ${ctrId}`;

    // 3) Sales allocation — credited to whoever is CLOSING this renewal
    //    (owner decision 2026-08-30: "yang memproses", not the original PIC).
    for (const al of input.parties.allocations) {
      await tx`
        insert into client_sales_allocations (client_id, transaction_id, salesperson_id, basis_points, created_by)
        values (${r.clientId}, ${trxId}, ${al.salespersonId}, ${al.basisPoints}, ${actor.employeeId})`;
    }

    // 4) Services (SVC- per line), tied to THIS contract + THIS transaction.
    for (const l of lines) {
      const svcId = await ex.ident.identNext('SVC', now);
      await tx`
        insert into services
          (id, client_id, contract_id, transaction_id, master_service_id, master_version_no, name, standard_price,
           commission_rule, status, requires_strategy_plan, plan_tier, created_by)
        values
          (${svcId}, ${r.clientId}, ${ctrId}, ${trxId}, ${l.masterServiceId}, ${l.versionNo}, ${l.name}, ${l.proposedPrice},
           ${l.commissionRule}, '[Awaiting Onboarding]', ${l.requiresStrategyPlan}, ${l.planTier}, ${actor.employeeId})`;
    }

    // 5) Installments (INST-) for scheduled schemes.
    const installments = input.installments ?? [];
    for (let i = 0; i < installments.length; i++) {
      const instId = await ex.ident.identNext('INST', now);
      await tx`
        insert into installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
        values (${instId}, ${trxId}, ${i + 1}, ${money.decimal(money.parse(installments[i].amount))},
                ${installments[i].dueDate}, '[Belum Jatuh Tempo]', ${actor.employeeId})`;
    }

    // 6) Close the renewal request itself.
    const result = await renewalTransition(ex.sm, renewalId, STATUS_CLOSED, actor);
    if (!result.ok) {
      throw new NotClosableError();
    }

    // Same action/entity_type as sales.close() ('client'/'closing') — this is
    // what lets salesperf.ts's loadClientRows find EITHER closing's own
    // timestamp (matched by after_json->>'transaction_id', not just entity_id,
    // since a client can now carry more than one 'closing' audit row).
    await ex.audit.insertAudit({
      entityType: 'client', entityId: r.clientId, actorEmployeeId: actor.employeeId,
      action: 'closing', beforeJson: null,
      afterJson: {
        transaction_id: trxId, renewal_id: renewalId, contract_id: ctrId, jenis: r.jenis,
        total_agreed_value: money.decimal(total), payment_scheme: input.paymentScheme,
      },
      createdBy: actor.employeeId,
    });

    return { clientId: r.clientId, transactionId: trxId };
  });
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/** listRenewalsForClient returns every renewal/cross-sell request on one client, newest first. Gated (canReadRenewal). */
export async function listRenewalsForClient(sql: Queryable, actor: Actor, clientId: string): Promise<Renewal[]> {
  const clientRows = await sql<{ sales_pic_id: string | null }[]>`select sales_pic_id from clients where id = ${clientId}`;
  if (clientRows.length === 0) {
    throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  }
  if (!canReadRenewal(actor, clientRows[0].sales_pic_id)) {
    throw new ForbiddenError();
  }
  const rows = await sql<{ id: string; client_id: string; jenis: string; contract_sebelumnya_id: string | null; status: string; created_at: Date; created_by: string }[]>`
    select id, client_id, jenis, contract_sebelumnya_id, status, created_at, created_by
    from contract_renewals where client_id = ${clientId} order by created_at desc`;
  return rows.map((r) => ({
    id: r.id, clientId: r.client_id, jenis: r.jenis, contractSebelumnyaId: r.contract_sebelumnya_id,
    status: r.status, createdAt: r.created_at, createdBy: r.created_by,
  }));
}

/** getRenewal returns one renewal request. Gated (canReadRenewal). */
export async function getRenewal(sql: Queryable, actor: Actor, renewalId: string): Promise<Renewal> {
  const r = await loadRenewal(sql, renewalId, false);
  if (!canReadRenewal(actor, r.salesPicId)) {
    throw new ForbiddenError();
  }
  const rows = await sql<{ created_at: Date; created_by: string }[]>`
    select created_at, created_by from contract_renewals where id = ${renewalId}`;
  return {
    id: r.id, clientId: r.clientId, jenis: r.jenis, contractSebelumnyaId: r.contractSebelumnyaId,
    status: r.status, createdAt: rows[0].created_at, createdBy: rows[0].created_by,
  };
}
