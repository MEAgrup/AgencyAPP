/**
 * Tests for M16 §5.5 Permintaan (`REQ-`, req.ts).
 *
 * - Unit: the §5.5 authorization predicates.
 * - Integration (skipped unless DATABASE_URL is set): create (jenis routing,
 *   due_date = +1 hari kerja, CPA↔CPR linkage), the [Diajukan]→[Diproses]→
 *   [Selesai] / →[Ditolak] machine, and keterlambatan derived at read time.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  canCreate,
  canProcess,
  canView,
  completePermintaan,
  ConflictError,
  createPermintaan,
  ForbiddenError,
  getPermintaan,
  JENIS_CONTRACT_CREATOR,
  JENIS_CREATOR_PAYMENT_APPROVAL,
  JENIS_TOPUP_SALDO,
  listPermintaanForClient,
  listPermintaanQueue,
  MSG_CPA_REQUIRES_CPR,
  MSG_INVALID_JENIS,
  NotFoundError,
  processPermintaan,
  rejectPermintaan,
  STATUS_DIAJUKAN,
  STATUS_DIPROSES,
  STATUS_DITOLAK,
  STATUS_SELESAI,
  ValidationError,
  type Actor,
} from './req';

const adsStaff = (id = 'ZZ-ADV'): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const kolStaff = (id = 'ZZ-KOL'): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'KOL', level: 'staff' }) });
const am = (id = 'ZZ-SINTA'): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (id = 'ZZ-ALEAD'): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const financeStaff = (id = 'ZZ-FIN'): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Finance', level: 'staff' }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit.
// ---------------------------------------------------------------------------
describe('permintaan predicates (§5.5)', () => {
  it('canCreate: the jenis-owning division (Ads for Top-up Saldo, KOL for the rest) or Director', () => {
    expect(canCreate(adsStaff(), JENIS_TOPUP_SALDO)).toBe(true);
    expect(canCreate(kolStaff(), JENIS_TOPUP_SALDO)).toBe(false);
    expect(canCreate(kolStaff(), JENIS_CONTRACT_CREATOR)).toBe(true);
    expect(canCreate(kolStaff(), JENIS_CREATOR_PAYMENT_APPROVAL)).toBe(true);
    expect(canCreate(adsStaff(), JENIS_CONTRACT_CREATOR)).toBe(false);
    expect(canCreate(director(), JENIS_TOPUP_SALDO)).toBe(true);
  });
  it('canView: read-all, lead of either division, or one of the two named parties', () => {
    expect(canView(director(), 'Ads', 'Account', 'ZZ-ADV', 'ZZ-SINTA')).toBe(true);
    expect(canView(accountLead(), 'Ads', 'Account', 'ZZ-ADV', 'ZZ-SINTA')).toBe(true);
    expect(canView(adsStaff('ZZ-ADV'), 'Ads', 'Account', 'ZZ-ADV', 'ZZ-SINTA')).toBe(true);
    expect(canView(am('ZZ-SINTA'), 'Ads', 'Account', 'ZZ-ADV', 'ZZ-SINTA')).toBe(true);
    expect(canView(kolStaff(), 'Ads', 'Account', 'ZZ-ADV', 'ZZ-SINTA')).toBe(false);
  });
  it('canProcess: the named tujuan employee, anyone in the tujuan division, or Director', () => {
    expect(canProcess(am('ZZ-SINTA'), 'Account', 'ZZ-SINTA')).toBe(true); // named AM
    expect(canProcess(am('ZZ-OTHER'), 'Account', 'ZZ-SINTA')).toBe(true); // any Account staff (same division)
    expect(canProcess(financeStaff(), 'Finance', null)).toBe(true); // Finance queue, no named employee
    expect(canProcess(kolStaff(), 'Finance', null)).toBe(false);
    expect(canProcess(director(), 'Finance', null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
const uid = (p: string): string => `${p}-ZZ-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, amId: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${amId}, 'ZZ-TEST')`;
}
async function insertService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Svc', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
}
async function insertBrief(id: string, svcId: string, division: string): Promise<void> {
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
      quantity_target, priority, recurring, created_by)
    values (${id}, ${svcId}, 'Brief', '[In Progress]', ${division}, 'Campaign', 1, 'High', false, 'ZZ-TEST')`;
}
/** A released client + Brief in `division`. Returns ids. */
async function clientBrief(division: string, amId = 'ZZ-SINTA'): Promise<{ clientId: string; briefId: string }> {
  const clientId = uid('CLI');
  const svcId = uid('SVC');
  const briefId = uid('BRF');
  await insertClient(clientId, amId);
  await insertService(svcId, clientId);
  await insertBrief(briefId, svcId, division);
  return { clientId, briefId };
}
/** A real CPR- row (with its parent booking), for the Creator Payment Approval linkage. */
async function insertCpr(clientId: string): Promise<string> {
  const svcId = uid('SVC');
  const briefId = uid('BRF');
  const bookingId = uid('BKG');
  const cprId = uid('CPR');
  await insertService(svcId, clientId);
  await insertBrief(briefId, svcId, 'KOL');
  await sql`
    insert into creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate, status, created_by)
    values (${bookingId}, ${briefId}, 'Creator X', 'TikTok', 'MCN MEA Roster', '1000000.00', '[QC Passed]', 'ZZ-TEST')`;
  await sql`
    insert into creator_payment_requests (id, booking_id, amount, payment_details, status, requested_by, created_by)
    values (${cprId}, ${bookingId}, '1000000.00', 'Bank X 1234', '[Requested]', 'ZZ-TEST', 'ZZ-TEST')`;
  return cprId;
}

async function insEmployee(id: string, divisi: string, jabatan: string): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${`${id}@zzt.test`}, ${divisi}, ${jabatan}, true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
}

beforeAll(async () => {
  if (!sql) return;
  await insEmployee('ZZ-ADV', 'Ads', 'Ads Specialist');
  await insEmployee('ZZ-KOL', 'KOL', 'KOL Coordinator');
  await insEmployee('ZZ-SINTA', 'Account', 'Account Manager');
});

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from permintaan where created_by like 'ZZ-%'`;
  await sql`delete from creator_payment_requests where created_by like 'ZZ-%'`;
  await sql`delete from creator_bookings where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

describeDb('createPermintaan (§5.5)', () => {
  it('Top-up Saldo routes to Finance (LT-11, no named employee), due in 1 hari kerja', async () => {
    const { clientId, briefId } = await clientBrief('Ads');
    const p = await createPermintaan(sql, adsStaff(), {
      jenis: JENIS_TOPUP_SALDO, judul: 'Top-up saldo Rp 5jt', briefId,
    });
    expect(p.id).toMatch(/^REQ-\d{6}-\d{4}$/);
    expect(p.status).toBe(STATUS_DIAJUKAN);
    expect(p.clientId).toBe(clientId);
    expect(p.tujuanDivisi).toBe('Finance');
    expect(p.tujuanEmployeeId).toBeNull();
    expect(p.dueDate > p.createdAt.toISOString().slice(0, 10)).toBe(true); // strictly forward
    expect(p.terlambatBerjalan).toBe(false);
  });

  it('Contract Creator routes to the client\'s owning AM (LT-11 — the only jenis that does)', async () => {
    const { clientId, briefId } = await clientBrief('KOL');
    const p = await createPermintaan(sql, kolStaff(), {
      jenis: JENIS_CONTRACT_CREATOR, judul: 'Kontrak creator baru', briefId,
    });
    expect(p.clientId).toBe(clientId);
    expect(p.tujuanDivisi).toBe('Account');
    expect(p.tujuanEmployeeId).toBe('ZZ-SINTA'); // the client's assigned_am_id
  });

  it('rejects an unknown jenis and a missing mandatory field', async () => {
    const { briefId } = await clientBrief('Ads');
    await expect(createPermintaan(sql, adsStaff(), { jenis: 'Bikin Iklan', judul: 'x', briefId }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createPermintaan(sql, adsStaff(), { jenis: JENIS_TOPUP_SALDO, judul: '', briefId }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects the wrong creating division (KOL cannot submit Top-up Saldo)', async () => {
    const { briefId } = await clientBrief('KOL');
    await expect(createPermintaan(sql, kolStaff(), { jenis: JENIS_TOPUP_SALDO, judul: 'x', briefId }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('requires a Brief or a Service parent', async () => {
    await expect(createPermintaan(sql, adsStaff(), { jenis: JENIS_TOPUP_SALDO, judul: 'x' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('Creator Payment Approval MUST carry a real cpr_id, and routes to Finance (no named employee)', async () => {
    const { clientId, briefId } = await clientBrief('KOL');
    const cprId = await insertCpr(clientId);
    await expect(createPermintaan(sql, kolStaff(), { jenis: JENIS_CREATOR_PAYMENT_APPROVAL, judul: 'Bayar creator', briefId }))
      .rejects.toBeInstanceOf(ValidationError); // no cprId
    await expect(createPermintaan(sql, kolStaff(), { jenis: JENIS_CREATOR_PAYMENT_APPROVAL, judul: 'Bayar creator', briefId, cprId: 'CPR-GHOST-0' }))
      .rejects.toBeInstanceOf(NotFoundError);
    const p = await createPermintaan(sql, kolStaff(), {
      jenis: JENIS_CREATOR_PAYMENT_APPROVAL, judul: 'Bayar creator', briefId, cprId,
    });
    expect(p.cprId).toBe(cprId);
    expect(p.tujuanDivisi).toBe('Finance');
    expect(p.tujuanEmployeeId).toBeNull();
  });

  it('a non-CPA jenis must NOT carry a cpr_id', async () => {
    const { clientId, briefId } = await clientBrief('KOL');
    const cprId = await insertCpr(clientId);
    await expect(createPermintaan(sql, kolStaff(), { jenis: JENIS_CONTRACT_CREATOR, judul: 'x', briefId, cprId }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describeDb('lifecycle (§5.5 / STATE_MACHINES §19)', () => {
  it('drives [Diajukan] -> [Diproses] -> [Selesai], and rejects an out-of-order transition', async () => {
    const { briefId } = await clientBrief('KOL');
    const p = await createPermintaan(sql, kolStaff(), { jenis: JENIS_CONTRACT_CREATOR, judul: 'x', briefId });
    // Only the resolved tujuan (or Director) may process.
    await expect(processPermintaan(sql, kolStaff(), p.id)).rejects.toBeInstanceOf(ForbiddenError);
    const processed = await processPermintaan(sql, am(), p.id);
    expect(processed.status).toBe(STATUS_DIPROSES);
    expect(processed.diprosesPada).not.toBeNull();
    // [Diajukan] is gone — cannot process twice.
    await expect(processPermintaan(sql, am(), p.id)).rejects.toBeInstanceOf(ConflictError);
    const done = await completePermintaan(sql, am(), p.id, 'Sudah ditransfer');
    expect(done.status).toBe(STATUS_SELESAI);
    expect(done.selesaiPada).not.toBeNull();
    expect(done.catatanProses).toBe('Sudah ditransfer');
  });

  it('rejects with a mandatory reason, from either open state', async () => {
    const { briefId } = await clientBrief('KOL');
    const p = await createPermintaan(sql, kolStaff(), { jenis: JENIS_CONTRACT_CREATOR, judul: 'x', briefId });
    await expect(rejectPermintaan(sql, am(), p.id, '')).rejects.toBeInstanceOf(ValidationError);
    const rejected = await rejectPermintaan(sql, am(), p.id, 'Saldo klien masih cukup');
    expect(rejected.status).toBe(STATUS_DITOLAK);
    expect(rejected.alasanDitolak).toBe('Saldo klien masih cukup');
    // Terminal — cannot process a rejected request.
    await expect(processPermintaan(sql, am(), p.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describeDb('keterlambatan derived at read time (§5.5)', () => {
  it('flags terlambat_berjalan once due_date has passed, and never for a [Ditolak] request', async () => {
    const { briefId } = await clientBrief('KOL');
    const p = await createPermintaan(sql, kolStaff(), { jenis: JENIS_CONTRACT_CREATOR, judul: 'x', briefId });
    // due_date is frozen — simulate "today is past due" by reading with a future `now`.
    const future = new Date(Date.parse(`${p.dueDate}T00:00:00Z`) + 3 * 86400000);
    const late = await getPermintaan(sql, am(), p.id, future);
    expect(late.terlambatBerjalan).toBe(true);
    expect(late.hariTerlambat).toBeGreaterThan(0);

    const rejected = await rejectPermintaan(sql, am(), p.id, 'batal');
    const lateRejected = await getPermintaan(sql, am(), rejected.id, future);
    expect(lateRejected.terlambatBerjalan).toBe(false);
    expect(lateRejected.hariTerlambat).toBe(0);
  });

  it('due_date is frozen — cannot be shifted after creation', async () => {
    const { briefId } = await clientBrief('KOL');
    const p = await createPermintaan(sql, kolStaff(), { jenis: JENIS_CONTRACT_CREATOR, judul: 'x', briefId });
    await expect(sql`update permintaan set due_date = due_date + 10 where id = ${p.id}`)
      .rejects.toThrow(/due_date beku/);
  });
});

describeDb('reads (§5.5)', () => {
  it('listPermintaanForClient / listPermintaanQueue view-gate correctly', async () => {
    const { clientId, briefId } = await clientBrief('KOL');
    await createPermintaan(sql, kolStaff(), { jenis: JENIS_CONTRACT_CREATOR, judul: 'x', briefId });
    const forClient = await listPermintaanForClient(sql, am(), clientId);
    expect(forClient.length).toBe(1);
    const forOutsider = await listPermintaanForClient(sql, adsStaff(), clientId);
    expect(forOutsider.length).toBe(0); // view-gated out per row

    const queue = await listPermintaanQueue(sql, am(), 'Account');
    expect(queue.some((r) => r.clientId === clientId)).toBe(true);
    await expect(listPermintaanQueue(sql, adsStaff(), 'Account')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
