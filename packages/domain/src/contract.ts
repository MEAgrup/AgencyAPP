/**
 * O57 / backlog B-00 — the `CTR-` Contract entity.
 *
 * A Contract in CDPS is **the agreement one client signed, and the set of
 * Services it covers** (owner decision 2026-08-07, DECISIONS O57 option (a)).
 * A client who buys Store Management + GMV Max + Nano KOL in one twelve-month
 * agreement gets ONE Strategi, not three — which is what makes M6A readable as
 * written: Rule 2 ("exactly one active Strategi per Contract"), D-1 ("Auto from
 * Contract") and §7 ("n PLAN rows where n = contract months").
 *
 * **What this module is deliberately not.** There is no money here. The agreed
 * value, the instalments and the payment gate are `transactions` (M0 §5 / M5)
 * and stay there; duplicating a rupiah figure onto the contract would create a
 * second answer to "how much did they agree to pay". A Contract carries the
 * *window* — duration and dates — because that is the field M6B's period
 * generator consumes and the field nothing else owned.
 *
 * **No state machine, on purpose.** No PRD gives a contract a lifecycle;
 * Strategi (#15) and Plan (#16) are the entities with status. Registering an
 * empty machine now would mean inventing state names, which house rule #2
 * forbids — a status that is not in `docs/STATE_MACHINES.md` does not exist.
 *
 * **Who may write.** The owning AM of the client, an Account lead / Head of
 * Account, or a Director. Reads are wider than writes and follow the client's
 * own scope (RLS `contracts_select`): Sales closed the agreement and Finance
 * bills its instalments, so both need to see the window. The narrow gate is on
 * the Strategi that hangs off it, not on the agreement itself.
 */

import { ident, permission } from '@cdps/core';
import {
  executors,
  withTransaction,
  type Queryable,
  type Sql,
  type TransactionSql,
} from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';

const ENTITY_CONTRACT = 'contract';

// --- BI messages (CLAUDE.md #5). M6A gives no error strings for an entity it
// assumed already existed, so these follow the house convention and the M6C /
// vendor precedent. ---

/** The contract id does not resolve. */
export const MSG_CONTRACT_NOT_FOUND = '[kontrak tidak ditemukan]';
/** Actor is neither the owning AM, an Account lead, nor a Director. */
export const MSG_CONTRACT_FORBIDDEN = '[anda tidak memiliki akses untuk mengelola kontrak ini]';
/** Mandatory fields missing — the house default. */
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
/** The client id does not resolve. */
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
/** The service id does not resolve. */
export const MSG_SERVICE_NOT_FOUND = '[layanan tidak ditemukan]';
/** Service and contract belong to different clients. */
export const MSG_CLIENT_MISMATCH = '[layanan dan kontrak bukan milik klien yang sama]';
/**
 * The service already hangs under a different agreement. Moving it silently
 * would move the Strategi that covers it too, so it is a refusal, not a nudge.
 */
export const MSG_SERVICE_ALREADY_CONTRACTED =
  '[layanan ini sudah berada di kontrak lain, lepaskan dulu dari kontrak tersebut]';
/**
 * The window cannot change once a Strategi hangs off it: M6B derives every Plan
 * period boundary from it, and moving the boundary retroactively would make
 * realisation history compare different ranges (the same reason Rule 17 freezes
 * `tanggal_mulai_siklus`).
 */
export const MSG_WINDOW_LOCKED =
  '[jendela kontrak tidak dapat diubah setelah Strategi dibuat untuk kontrak ini]';
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** Classification set by R-01 (Kinerja Sales) — fixed once, at creation. */
export const JENIS_BARU = 'baru';
export const JENIS_PERPANJANGAN = 'perpanjangan';
export const JENIS_CROSS_SELL = 'cross_sell';

export interface Contract {
  id: string;
  clientId: string;
  durasiBulan: number;
  tanggalMulai: string;
  tanggalAkhir: string;
  catatan: string | null;
  /**
   * R-01 (Kinerja Sales) — baru | perpanjangan | cross_sell. Set once at
   * creation (DB default 'baru'); NOT a status, never re-derived. Contracts
   * created through THIS module (Account's own door) are always 'baru' — a
   * 'perpanjangan'/'cross_sell' contract is born exclusively through the
   * Client Record renewal door (`renewal.ts::closeRenewal`, R-03).
   */
  jenis: string;
  /** Renewal chain link — non-null only when jenis = 'perpanjangan'. */
  contractSebelumnyaId: string | null;
  /**
   * The closing (TRX-) that birthed this contract, when it came through the
   * R-03 renewal door — null for a contract created via Account's own
   * `createContract`/`ensureContractForService` (not tied to one closing).
   */
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

/** The window an AM declares. `catatan` is free text, never a status. */
export interface ContractInput {
  durasiBulan: number;
  tanggalMulai: string;
  tanggalAkhir: string;
  catatan?: string | null;
}

interface ContractRow {
  id: string;
  client_id: string;
  durasi_bulan: number;
  tanggal_mulai: string | Date;
  tanggal_akhir: string | Date;
  catatan: string | null;
  jenis: string;
  contract_sebelumnya_id: string | null;
  transaction_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  created_by: string;
}

const iso = (v: string | Date): string =>
  v instanceof Date ? v.toISOString() : String(v);
const isoDate = (v: string | Date): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

function rowToContract(r: ContractRow): Contract {
  return {
    id: r.id,
    clientId: r.client_id,
    durasiBulan: Number(r.durasi_bulan),
    tanggalMulai: isoDate(r.tanggal_mulai),
    tanggalAkhir: isoDate(r.tanggal_akhir),
    catatan: r.catatan,
    jenis: r.jenis,
    contractSebelumnyaId: r.contract_sebelumnya_id,
    transactionId: r.transaction_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    createdBy: r.created_by,
  };
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

/** canWriteContract: the owning AM, an Account lead/Head, or a Director. */
export function canWriteContract(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/** canReadContract: the write set, plus every read-all role (OD / Director). */
export function canReadContract(actor: Actor, ownerAm: string | null): boolean {
  return canWriteContract(actor, ownerAm) || permission.canReadAll(actor);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * normalizeInput mirrors the CHECKs on `contracts` — the DB is the wall, this is
 * the Bahasa Indonesia message. D2's 3/6/12 months is a MENU in the PRD, not a
 * validation rule, so it is not enforced here either; what is enforced is that
 * the duration is sane and the window is consistent with it.
 */
function normalizeInput(input: ContractInput): Required<ContractInput> {
  const mulai = (input.tanggalMulai ?? '').trim();
  const akhir = (input.tanggalAkhir ?? '').trim();
  if (!RE_DATE.test(mulai) || !RE_DATE.test(akhir) || akhir <= mulai) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const durasi = Number(input.durasiBulan);
  if (!Number.isInteger(durasi) || durasi < 1 || durasi > 36) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const catatan = (input.catatan ?? '')?.toString().trim() ?? '';
  return {
    durasiBulan: durasi,
    tanggalMulai: mulai,
    tanggalAkhir: akhir,
    catatan: catatan === '' ? null : catatan,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function ownerAmOfClient(sql: Queryable, clientId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  return rows[0].assigned_am_id;
}

/** ownerAmOfContract resolves the AM who owns the client behind a Contract. */
export async function ownerAmOfContract(
  sql: Queryable,
  contractId: string,
): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select c.assigned_am_id from contracts ct join clients c on c.id = ct.client_id
     where ct.id = ${contractId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CONTRACT_NOT_FOUND);
  return rows[0].assigned_am_id;
}

async function loadContractRow(sql: Queryable, id: string, forUpdate = false): Promise<Contract> {
  const rows = forUpdate
    ? await sql<ContractRow[]>`select * from contracts where id = ${id} for update`
    : await sql<ContractRow[]>`select * from contracts where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CONTRACT_NOT_FOUND);
  return rowToContract(rows[0]);
}

/** getContract loads one agreement. */
export async function getContract(sql: Queryable, actor: Actor, id: string): Promise<Contract> {
  const row = await loadContractRow(sql, id);
  const ownerAm = await ownerAmOfClient(sql, row.clientId);
  if (!canReadContract(actor, ownerAm)) {
    throw new ForbiddenError(MSG_CONTRACT_FORBIDDEN);
  }
  return row;
}

/** listContractsForClient returns every agreement of one client, newest first. */
export async function listContractsForClient(
  sql: Queryable,
  actor: Actor,
  clientId: string,
): Promise<Contract[]> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  if (!canReadContract(actor, ownerAm)) {
    throw new ForbiddenError(MSG_CONTRACT_FORBIDDEN);
  }
  const rows = await sql<ContractRow[]>`
    select * from contracts where client_id = ${clientId}
     order by tanggal_mulai desc, id desc`;
  return rows.map(rowToContract);
}

/** listServicesOfContract returns the Service ids the agreement covers. */
export async function listServicesOfContract(
  sql: Queryable,
  contractId: string,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from services where contract_id = ${contractId} order by id`;
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** createContract opens an agreement for a client. */
export async function createContract(
  sql: Sql,
  actor: Actor,
  clientId: string,
  input: ContractInput,
): Promise<Contract> {
  const head = normalizeInput(input);
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const ownerAm = await ownerAmOfClient(tx, clientId);
    if (!canWriteContract(actor, ownerAm)) {
      throw new ForbiddenError(MSG_CONTRACT_FORBIDDEN);
    }
    const id = await ident.nextId(ex.ident, 'CTR', now);
    await tx`
      insert into contracts
        (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, catatan, created_by)
      values
        (${id}, ${clientId}, ${head.durasiBulan}, ${head.tanggalMulai},
         ${head.tanggalAkhir}, ${head.catatan}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: ENTITY_CONTRACT,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: {
        client_id: clientId,
        durasi_bulan: head.durasiBulan,
        tanggal_mulai: head.tanggalMulai,
        tanggal_akhir: head.tanggalAkhir,
      },
      createdBy: actor.employeeId,
    });
    return loadContractRow(tx, id);
  });
}

/**
 * updateContract edits the window while nothing depends on it yet.
 *
 * Once a Strategi hangs off the agreement the window is frozen: M6B derives
 * every period boundary from `durasi_bulan` + `tanggal_mulai`, so moving them
 * afterwards silently re-cuts periods that already have realisation rows
 * attached. `catatan` stays editable — it is free text nothing computes from.
 */
export async function updateContract(
  sql: Sql,
  actor: Actor,
  id: string,
  input: ContractInput,
): Promise<Contract> {
  const head = normalizeInput(input);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const before = await loadContractRow(tx, id, true);
    const ownerAm = await ownerAmOfClient(tx, before.clientId);
    if (!canWriteContract(actor, ownerAm)) {
      throw new ForbiddenError(MSG_CONTRACT_FORBIDDEN);
    }
    const windowChanged =
      head.durasiBulan !== before.durasiBulan ||
      head.tanggalMulai !== before.tanggalMulai ||
      head.tanggalAkhir !== before.tanggalAkhir;
    if (windowChanged && (await hasStrategi(tx, id))) {
      throw new ConflictError(MSG_WINDOW_LOCKED);
    }
    await tx`
      update contracts
         set durasi_bulan = ${head.durasiBulan},
             tanggal_mulai = ${head.tanggalMulai},
             tanggal_akhir = ${head.tanggalAkhir},
             catatan = ${head.catatan}
       where id = ${id}`;
    await ex.audit.insertAudit({
      entityType: ENTITY_CONTRACT,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'update',
      beforeJson: {
        durasi_bulan: before.durasiBulan,
        tanggal_mulai: before.tanggalMulai,
        tanggal_akhir: before.tanggalAkhir,
        catatan: before.catatan,
      },
      afterJson: {
        durasi_bulan: head.durasiBulan,
        tanggal_mulai: head.tanggalMulai,
        tanggal_akhir: head.tanggalAkhir,
        catatan: head.catatan,
      },
      createdBy: actor.employeeId,
    });
    return loadContractRow(tx, id);
  });
}

/** hasStrategi reports whether any Strategi version hangs off the agreement. */
export async function hasStrategi(sql: Queryable, contractId: string): Promise<boolean> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi where contract_id = ${contractId}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * attachService puts a Service under an agreement — the operation that makes a
 * Contract more than a renamed Service.
 *
 * Detaching is `detachService`, and neither is a silent move: a Service already
 * under another agreement is refused rather than transferred, because the
 * Strategi covering the old agreement was written for a set of Services that
 * would change underneath it.
 */
export async function attachService(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  contractId: string,
): Promise<Contract> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const contract = await loadContractRow(tx, contractId, true);
    const ownerAm = await ownerAmOfClient(tx, contract.clientId);
    if (!canWriteContract(actor, ownerAm)) {
      throw new ForbiddenError(MSG_CONTRACT_FORBIDDEN);
    }
    const svc = await sql<{ client_id: string; contract_id: string | null }[]>`
      select client_id, contract_id from services where id = ${serviceId} for update`;
    if (svc.length === 0) throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
    if (svc[0].client_id !== contract.clientId) {
      throw new ValidationError(MSG_CLIENT_MISMATCH);
    }
    if (svc[0].contract_id !== null && svc[0].contract_id !== contractId) {
      throw new ConflictError(MSG_SERVICE_ALREADY_CONTRACTED);
    }
    await tx`update services set contract_id = ${contractId} where id = ${serviceId}`;
    await ex.audit.insertAudit({
      entityType: ENTITY_CONTRACT,
      entityId: contractId,
      actorEmployeeId: actor.employeeId,
      action: 'attach_service',
      beforeJson: { service_id: serviceId, contract_id: svc[0].contract_id },
      afterJson: { service_id: serviceId, contract_id: contractId },
      createdBy: actor.employeeId,
    });
    return loadContractRow(tx, contractId);
  });
}

/**
 * detachService removes a Service from its agreement.
 *
 * Refused while a Strategi exists for that agreement: the Strategi was approved
 * over a specific set of Services, and shrinking the set afterwards would leave
 * Section E/F commitments pointing at work no longer in scope.
 */
export async function detachService(sql: Sql, actor: Actor, serviceId: string): Promise<void> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await tx<{ client_id: string; contract_id: string | null }[]>`
      select client_id, contract_id from services where id = ${serviceId} for update`;
    if (svc.length === 0) throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
    const contractId = svc[0].contract_id;
    if (contractId === null) return;
    const ownerAm = await ownerAmOfClient(tx, svc[0].client_id);
    if (!canWriteContract(actor, ownerAm)) {
      throw new ForbiddenError(MSG_CONTRACT_FORBIDDEN);
    }
    if (await hasStrategi(tx, contractId)) {
      throw new ConflictError(MSG_WINDOW_LOCKED);
    }
    await tx`update services set contract_id = null where id = ${serviceId}`;
    await ex.audit.insertAudit({
      entityType: ENTITY_CONTRACT,
      entityId: contractId,
      actorEmployeeId: actor.employeeId,
      action: 'detach_service',
      beforeJson: { service_id: serviceId, contract_id: contractId },
      afterJson: { service_id: serviceId, contract_id: null },
      createdBy: actor.employeeId,
    });
  });
}

/**
 * ensureContractForService resolves the agreement covering a Service, creating a
 * 1:1 one if the Service has none.
 *
 * This is the seam that keeps `POST /services/{id}/strategi` working unchanged.
 * An AM who has not grouped Services yet still gets a Contract — the same shape
 * the old AM-declared window produced — and an AM who has grouped them gets the
 * agreement, with the supplied window checked against it rather than quietly
 * ignored.
 */
export async function ensureContractForService(
  tx: TransactionSql,
  actor: Actor,
  serviceId: string,
  clientId: string,
  existingContractId: string | null,
  input: ContractInput,
): Promise<string> {
  const sql = tx;
  if (existingContractId !== null) {
    const current = await loadContractRow(sql, existingContractId);
    const head = normalizeInput(input);
    if (
      head.durasiBulan !== current.durasiBulan ||
      head.tanggalMulai !== current.tanggalMulai ||
      head.tanggalAkhir !== current.tanggalAkhir
    ) {
      throw new ConflictError(MSG_WINDOW_MISMATCH);
    }
    return existingContractId;
  }
  const head = normalizeInput(input);
  const ex = executors(sql);
  const id = await ident.nextId(ex.ident, 'CTR', new Date());
  await sql`
    insert into contracts
      (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, catatan, created_by)
    values
      (${id}, ${clientId}, ${head.durasiBulan}, ${head.tanggalMulai},
       ${head.tanggalAkhir}, ${head.catatan}, ${actor.employeeId})`;
  await sql`update services set contract_id = ${id} where id = ${serviceId}`;
  await ex.audit.insertAudit({
    entityType: ENTITY_CONTRACT,
    entityId: id,
    actorEmployeeId: actor.employeeId,
    action: 'create',
    beforeJson: null,
    afterJson: {
      client_id: clientId,
      service_id: serviceId,
      durasi_bulan: head.durasiBulan,
      tanggal_mulai: head.tanggalMulai,
      tanggal_akhir: head.tanggalAkhir,
    },
    createdBy: actor.employeeId,
  });
  return id;
}

/**
 * The window sent with a Strategi does not match the agreement already covering
 * the Service. Silently preferring one of the two is exactly the ambiguity O57
 * exists to remove, so it is a refusal that names the authority.
 */
export const MSG_WINDOW_MISMATCH =
  '[jendela kontrak berbeda dengan kontrak yang menaungi layanan ini]';
