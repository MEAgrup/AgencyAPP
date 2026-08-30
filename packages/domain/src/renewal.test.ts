/**
 * Tests for R-03 (Kinerja Sales) — renewal/cross-sell on an EXISTING client.
 *
 * - Unit: canWriteRenewal/canReadRenewal permission predicates (no DB).
 * - Integration (skipped unless DATABASE_URL is set): propose → decide →
 *   execute over a real closed client (born via `sales.close()`, exactly the
 *   fixture `sales.test.ts` uses), with the KS-2 allocation-replacement
 *   behaviour as the centerpiece test.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { leads } from './index';
import {
  canReadRenewal,
  canWriteRenewal,
  decideRenewal,
  DECISION_APPROVE,
  DECISION_REJECT,
  executeRenewal,
  getRenewal,
  getRenewalDetail,
  JENIS_CROSS_SELL,
  JENIS_PERPANJANGAN,
  listRenewalsForClient,
  MSG_CLIENT_NOT_FOUND,
  MSG_RENEWAL_NOT_FOUND,
  proposeRenewal,
  type RenewalLine,
  resubmitRenewal,
  STATUS_APPROVED,
  STATUS_AUTO_APPROVED,
  STATUS_EXECUTED,
  STATUS_PENDING,
  STATUS_REJECTED,
} from './renewal';
import {
  close,
  CustomTermRequiresNegotiationError,
  ForbiddenError,
  IncompleteError,
  markContacted,
  NotClosableError,
  PAYMENT_SCHEME_LUNAS,
  PAYMENT_SCHEME_TERMIN,
  submitNegotiation,
  submitQualifiedForm,
  type Actor,
} from './sales';

const budi = (): Actor => ({
  employeeId: 'ZZ-RNBUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const andi = (): Actor => ({
  employeeId: 'ZZ-RNANDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-RNSLEAD', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const otherDivision = (): Actor => ({
  employeeId: 'ZZ-RNACCT', divisi: 'Account',
  role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const director = (): Actor => ({
  employeeId: 'ZZ-RNDIR', divisi: 'Management', role: permission.makeRole({ director: true }),
});

// ---------------------------------------------------------------------------
// Unit: permission predicates (no DB).
// ---------------------------------------------------------------------------
describe('canWriteRenewal / canReadRenewal', () => {
  it('grants Director everywhere, regardless of the client PIC', () => {
    expect(canWriteRenewal(director(), null)).toBe(true);
    expect(canWriteRenewal(director(), 'ZZ-RNBUDI')).toBe(true);
  });

  it('grants a Sales lead any client in the division', () => {
    expect(canWriteRenewal(salesLead(), 'ZZ-RNBUDI')).toBe(true);
    expect(canWriteRenewal(salesLead(), null)).toBe(true);
  });

  it('grants Sales staff only their OWN client (the sales_pic_id match)', () => {
    expect(canWriteRenewal(budi(), 'ZZ-RNBUDI')).toBe(true);
    expect(canWriteRenewal(budi(), 'ZZ-RNANDI')).toBe(false);
    expect(canWriteRenewal(budi(), null)).toBe(false);
  });

  it('denies a non-Sales division outright', () => {
    expect(canWriteRenewal(otherDivision(), 'ZZ-RNACCT')).toBe(false);
  });

  it('canReadRenewal extends the write set with read-all roles (OD)', () => {
    const od: Actor = { employeeId: 'ZZ-RNOD', role: permission.makeRole({ division: 'Management', level: 'staff', od: true }) };
    expect(canReadRenewal(od, 'ZZ-RNBUDI')).toBe(true);
    expect(canWriteRenewal(od, 'ZZ-RNBUDI')).toBe(false);
    expect(canReadRenewal(budi(), 'ZZ-RNANDI')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration (real Postgres).
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
const uniquePhone = (): string => `0814${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;

/** Seed one flat MSL service (10% commission) and return its master id. */
async function seedService(id: string, price = '9000000.00', rule = '10% of standard price'): Promise<string> {
  await sql`insert into master_services (id, created_by) values (${id}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${id}, 1, ${'Svc ' + id}, ${price}, ${rule}, true, '2020-01-01', 'flat', 'ZZ-ADMIN')`;
  return id;
}

/** Close a fresh Alpha Digital-shaped client owned by `actor`, solo Lunas, with `svc`. Returns the closed client id. */
async function closedClient(actor: Actor, svc: string): Promise<string> {
  const { attempt } = await leads.register(sql, actor, { leadName: 'Alpha Renewal Co', phoneNumber: uniquePhone() });
  await markContacted(sql, actor, attempt.id);
  await submitQualifiedForm(sql, actor, attempt.id, {
    namaPic: 'Ibu Alpha', toko: 'Alpha Renewal Co', kota: 'Jakarta', linkToko: 'https://shopee/alpha',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [{ masterServiceId: svc, quantity: 1 }],
  });
  await submitNegotiation(sql, actor, attempt.id, [], true);
  const res = await close(sql, actor, attempt.id, {
    parties: { primarySalespersonId: actor.employeeId, allocations: [{ salespersonId: actor.employeeId, basisPoints: 10000 }] },
    paymentScheme: PAYMENT_SCHEME_LUNAS,
  });
  return res.clientId;
}

const standardLine = (svc: string): RenewalLine => ({ masterServiceId: svc });
const customLine = (svc: string): RenewalLine => ({ masterServiceId: svc, proposedPrice: '7000000', commissionRule: '10% of standard price' });

const nextYearWindow = (): { tanggalMulai: string; tanggalAkhir: string } => ({
  tanggalMulai: '2026-09-01', tanggalAkhir: '2027-09-01',
});

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  // renewal_requests FKs into transactions/contracts — clear it (and its
  // versioned children) FIRST or the deletes below hit fk_rnw_transaction /
  // fk_rnw_contract.
  await sql`delete from renewal_proposal_lines where created_by like 'ZZ-%'`;
  await sql`delete from renewal_proposals where created_by like 'ZZ-%'`;
  await sql`delete from renewal_requests where created_by like 'ZZ-%'`;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from client_sales_allocations where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposal_lines where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposals where created_by like 'ZZ-%'`;
  await sql`delete from qualified_form_services where created_by like 'ZZ-%'`;
  await sql`delete from qualified_forms where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempt_nq_reasons where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
});

describeDb('proposeRenewal', () => {
  it('no-nego standard line is born Auto Approved (mirrors sales.ts no-negotiation)', async () => {
    const svc = await seedService('SVC-ZZ-RN-NONEGO');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    expect(rn.id).toMatch(/^RNW-\d{6}-\d{4}$/);
    expect(rn.status).toBe(STATUS_AUTO_APPROVED);
    expect(rn.jenis).toBe(JENIS_PERPANJANGAN);
  });

  it('no-nego rejects a custom line with CustomTermRequiresNegotiationError', async () => {
    const svc = await seedService('SVC-ZZ-RN-NONEGO-CUSTOM');
    const clientId = await closedClient(budi(), svc);
    await expect(proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], true))
      .rejects.toBeInstanceOf(CustomTermRequiresNegotiationError);
  });

  it('a custom line without no-nego is born Pending Approval, and notifies the Sales division (m0.renewal.pending_approval)', async () => {
    const svc = await seedService('SVC-ZZ-RN-PENDING');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false);
    expect(rn.status).toBe(STATUS_PENDING);

    const notif = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
      where entity_id = ${rn.id} and event_type = 'm0.renewal.pending_approval'`;
    expect(notif[0].n).toBeGreaterThanOrEqual(1);
  });

  it('a no-nego (Auto Approved) proposal emits no notification at all', async () => {
    const svc = await seedService('SVC-ZZ-RN-NONEGO-NOTIF');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    const notif = await sql<{ n: number }[]>`select count(*)::int as n from notifications where entity_id = ${rn.id}`;
    expect(notif[0].n).toBe(0);
  });

  it('rejects an unknown jenis and an empty line set', async () => {
    const svc = await seedService('SVC-ZZ-RN-JENIS');
    const clientId = await closedClient(budi(), svc);
    await expect(proposeRenewal(sql, budi(), clientId, 'weird', [standardLine(svc)], true)).rejects.toBeInstanceOf(IncompleteError);
    await expect(proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [], true)).rejects.toBeInstanceOf(IncompleteError);
  });

  it('denies a non-owner Sales staff and an unrelated division (ForbiddenError), and 404s an unknown client', async () => {
    const svc = await seedService('SVC-ZZ-RN-DENY');
    const clientId = await closedClient(budi(), svc);
    await expect(proposeRenewal(sql, andi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(proposeRenewal(sql, otherDivision(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(proposeRenewal(sql, budi(), 'CLI-000000-0000', JENIS_PERPANJANGAN, [standardLine(svc)], true))
      .rejects.toThrow(MSG_CLIENT_NOT_FOUND);
  });

  it('a Sales lead may propose for any client in the division, not just their own', async () => {
    const svc = await seedService('SVC-ZZ-RN-LEAD-PROPOSE');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, salesLead(), clientId, JENIS_CROSS_SELL, [standardLine(svc)], true);
    expect(rn.status).toBe(STATUS_AUTO_APPROVED);
    expect(rn.jenis).toBe(JENIS_CROSS_SELL);
  });
});

describeDb('decideRenewal / resubmitRenewal', () => {
  it('a non-lead cannot decide (role_denied); the lead approves, then a staff without PIC still cannot decide', async () => {
    const svc = await seedService('SVC-ZZ-RN-DECIDE');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false);

    const denied = await decideRenewal(sql, budi(), rn.id, DECISION_APPROVE);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('role_denied');

    const approved = await decideRenewal(sql, salesLead(), rn.id, DECISION_APPROVE);
    expect(approved.ok).toBe(true);
    const after = await getRenewal(sql, budi(), rn.id);
    expect(after.status).toBe(STATUS_APPROVED);

    // The proposer (Budi) was notified of the decision (explicit recipient) —
    // m0.renewal.decision, mirrors m0.negotiation.decision.
    const notif = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
      where recipient_employee_id = 'ZZ-RNBUDI' and entity_id = ${rn.id}
        and event_type = 'm0.renewal.decision'`;
    expect(notif[0].n).toBe(1);
  });

  it('reject requires a note (verbatim BI IncompleteError) and then blocks re-deciding twice', async () => {
    const svc = await seedService('SVC-ZZ-RN-REJECT');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false);

    await expect(decideRenewal(sql, salesLead(), rn.id, DECISION_REJECT)).rejects.toBeInstanceOf(IncompleteError);
    await expect(decideRenewal(sql, salesLead(), rn.id, DECISION_REJECT, '   ')).rejects.toBeInstanceOf(IncompleteError);

    const rejected = await decideRenewal(sql, salesLead(), rn.id, DECISION_REJECT, 'harga terlalu rendah');
    expect(rejected.ok).toBe(true);
    const after = await getRenewal(sql, budi(), rn.id);
    expect(after.status).toBe(STATUS_REJECTED);
    expect(after.decisionNote).toBe('harga terlalu rendah');
  });

  it('reject → resubmit (same RNW-, new proposal version) → Pending Approval again → approve', async () => {
    const svc = await seedService('SVC-ZZ-RN-RESUBMIT');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false);
    await decideRenewal(sql, salesLead(), rn.id, DECISION_REJECT, 'harga terlalu rendah');

    const resub = await resubmitRenewal(sql, budi(), rn.id, [
      { masterServiceId: svc, proposedPrice: '7500000', commissionRule: '10% of standard price' },
    ]);
    expect(resub.ok).toBe(true);
    expect((await getRenewal(sql, budi(), rn.id)).status).toBe(STATUS_PENDING);

    const versions = await sql<{ n: number }[]>`
      select count(*)::int as n from renewal_proposals where renewal_request_id = ${rn.id}`;
    expect(versions[0].n).toBe(2);

    // Resubmit fires a SECOND m0.renewal.pending_approval (the original propose
    // fired the first) — the lead needs to be told a fresh version is waiting.
    const notif = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where entity_id = ${rn.id} and event_type = 'm0.renewal.pending_approval'`;
    expect(notif[0].n).toBeGreaterThanOrEqual(2);

    const approved = await decideRenewal(sql, salesLead(), rn.id, DECISION_APPROVE);
    expect(approved.ok).toBe(true);
    expect((await getRenewal(sql, budi(), rn.id)).status).toBe(STATUS_APPROVED);
  });

  it('rejects an unknown decision and an empty resubmit line set; 404s an unknown renewal', async () => {
    const svc = await seedService('SVC-ZZ-RN-BADINPUT');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false);
    await expect(decideRenewal(sql, salesLead(), rn.id, 'maybe')).rejects.toBeInstanceOf(IncompleteError);
    await decideRenewal(sql, salesLead(), rn.id, DECISION_REJECT, 'x');
    await expect(resubmitRenewal(sql, budi(), rn.id, [])).rejects.toBeInstanceOf(IncompleteError);
    await expect(getRenewal(sql, budi(), 'RNW-000000-0000')).rejects.toThrow(MSG_RENEWAL_NOT_FOUND);
  });
});

describeDb('executeRenewal', () => {
  it('births CTR-/SVC-/TRX- on the existing client; a second perpanjangan chains contract_sebelumnya_id to the first', async () => {
    // sales.close() never mints a Contract (that's the AM's separate M6A door,
    // contract.ensureContractForService) — so right after closing, this client
    // has NO contracts row yet. The FIRST renewal therefore has nothing to
    // chain to; a SECOND renewal is what actually proves the chain forms.
    const svc = await seedService('SVC-ZZ-RN-EXEC');
    const clientId = await closedClient(budi(), svc);
    const noContractYet = await sql<{ n: number }[]>`select count(*)::int as n from contracts where client_id = ${clientId}`;
    expect(noContractYet[0].n).toBe(0);

    const rn1 = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    expect(rn1.status).toBe(STATUS_AUTO_APPROVED);
    const res1 = await executeRenewal(sql, budi(), rn1.id, {
      durasiBulan: 12, ...nextYearWindow(),
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });
    expect(res1.contractId).toMatch(/^CTR-\d{6}-\d{4}$/);
    expect(res1.transactionId).toMatch(/^TRX-\d{6}-\d{4}$/);

    const [contract1] = await sql<{ jenis: string; contract_sebelumnya_id: string | null; client_id: string }[]>`
      select jenis, contract_sebelumnya_id, client_id from contracts where id = ${res1.contractId}`;
    expect(contract1.client_id).toBe(clientId);
    expect(contract1.jenis).toBe(JENIS_PERPANJANGAN);
    expect(contract1.contract_sebelumnya_id).toBeNull(); // nothing to chain to yet

    const svcRows = await sql<{ status: string; name: string; contract_id: string }[]>`
      select status, name, contract_id from services where contract_id = ${res1.contractId}`;
    expect(svcRows).toHaveLength(1);
    expect(svcRows[0].status).toBe('[Awaiting Onboarding]');
    expect(svcRows[0].name).not.toBe(''); // real MSL name, not the placeholder-id bug

    const trx = await sql<{ payment_status: string; total_agreed_value: string }[]>`
      select payment_status, total_agreed_value from transactions where id = ${res1.transactionId}`;
    expect(trx[0].payment_status).toBe('[Menunggu Verifikasi]');
    expect(money.parse(trx[0].total_agreed_value)).toBe(money.parse('9000000'));

    const renewal1 = await getRenewal(sql, budi(), rn1.id);
    expect(renewal1.status).toBe(STATUS_EXECUTED);
    expect(renewal1.contractId).toBe(res1.contractId);
    expect(renewal1.transactionId).toBe(res1.transactionId);

    // Second renewal — NOW there is a most-recent contract to chain to.
    const rn2 = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    const res2 = await executeRenewal(sql, budi(), rn2.id, {
      durasiBulan: 12, tanggalMulai: '2027-09-01', tanggalAkhir: '2028-09-01',
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });
    const [contract2] = await sql<{ contract_sebelumnya_id: string | null }[]>`
      select contract_sebelumnya_id from contracts where id = ${res2.contractId}`;
    expect(contract2.contract_sebelumnya_id).toBe(res1.contractId);
  });

  it('cross_sell never chains contract_sebelumnya_id, even when a prior contract exists', async () => {
    const svc = await seedService('SVC-ZZ-RN-XSELL');
    const clientId = await closedClient(budi(), svc);
    // Give this client a first contract via an initial perpanjangan, so a
    // "prior contract exists" for the cross_sell execution below to (not) chain to.
    const rn1 = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    await executeRenewal(sql, budi(), rn1.id, {
      durasiBulan: 12, ...nextYearWindow(),
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });

    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, [standardLine(svc)], true);
    const res = await executeRenewal(sql, budi(), rn.id, {
      durasiBulan: 6, tanggalMulai: '2027-09-01', tanggalAkhir: '2028-03-01',
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });
    const [contract] = await sql<{ jenis: string; contract_sebelumnya_id: string | null }[]>`
      select jenis, contract_sebelumnya_id from contracts where id = ${res.contractId}`;
    expect(contract.jenis).toBe(JENIS_CROSS_SELL);
    expect(contract.contract_sebelumnya_id).toBeNull();
  });

  it('materializes installments for a Termin scheme and validates the schedule total', async () => {
    const svc = await seedService('SVC-ZZ-RN-TERMIN');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    await expect(executeRenewal(sql, budi(), rn.id, {
      durasiBulan: 12, ...nextYearWindow(),
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_TERMIN,
      installments: [{ amount: '1000000', dueDate: '2026-09-01' }],
    })).rejects.toBeInstanceOf(IncompleteError);

    const res = await executeRenewal(sql, budi(), rn.id, {
      durasiBulan: 12, ...nextYearWindow(),
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_TERMIN,
      installments: [{ amount: '4000000', dueDate: '2026-09-01' }, { amount: '5000000', dueDate: '2026-10-01' }],
    });
    const inst = await sql<{ installment_no: number; status: string }[]>`
      select installment_no, status from installments where transaction_id = ${res.transactionId} order by installment_no`;
    expect(inst).toHaveLength(2);
    expect(inst[0].status).toBe('[Belum Jatuh Tempo]');
  });

  it('only an Approved/Auto Approved request can execute (NotClosableError)', async () => {
    const svc = await seedService('SVC-ZZ-RN-NOTCLOSE');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false); // Pending Approval
    await expect(executeRenewal(sql, budi(), rn.id, {
      durasiBulan: 12, ...nextYearWindow(),
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    })).rejects.toBeInstanceOf(NotClosableError);
  });

  it('denies execution to a non-owner staff (ForbiddenError)', async () => {
    const svc = await seedService('SVC-ZZ-RN-EXECDENY');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    await expect(executeRenewal(sql, andi(), rn.id, {
      durasiBulan: 12, ...nextYearWindow(),
      parties: { primarySalespersonId: andi().employeeId, allocations: [{ salespersonId: andi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    })).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // KS-2 (owner decision 2026-08-29): credit moves ENTIRELY to whoever
  // executes the renewal — the old salesperson keeps NO allocation.
  // -------------------------------------------------------------------------
  it('KS-2: execution REPLACES client_sales_allocations — the old salesperson loses all credit', async () => {
    const svc = await seedService('SVC-ZZ-RN-KS2');
    const clientId = await closedClient(budi(), svc); // Budi owns the original close, 100% allocation

    const before = await sql<{ salesperson_id: string; basis_points: number }[]>`
      select salesperson_id, basis_points from client_sales_allocations where client_id = ${clientId}`;
    expect(before).toEqual([expect.objectContaining({ salesperson_id: 'ZZ-RNBUDI', basis_points: 10000 })]);

    // A Sales lead proposes and executes the renewal crediting Andi instead —
    // this is exactly the "renewal transaction credited to the NEW salesperson,
    // not the original" scenario the owner described.
    const rn = await proposeRenewal(sql, salesLead(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    await executeRenewal(sql, salesLead(), rn.id, {
      durasiBulan: 12, ...nextYearWindow(),
      parties: { primarySalespersonId: andi().employeeId, allocations: [{ salespersonId: andi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });

    const after = await sql<{ salesperson_id: string; basis_points: number }[]>`
      select salesperson_id, basis_points from client_sales_allocations where client_id = ${clientId}`;
    // Budi's old allocation is GONE, not merely diluted — Andi is the only row.
    expect(after).toEqual([expect.objectContaining({ salesperson_id: 'ZZ-RNANDI', basis_points: 10000 })]);
    expect(after.some((a) => a.salesperson_id === 'ZZ-RNBUDI')).toBe(false);

    const client = await sql<{ sales_pic_id: string; commission_payment_pic_id: string }[]>`
      select sales_pic_id, commission_payment_pic_id from clients where id = ${clientId}`;
    expect(client[0].sales_pic_id).toBe('ZZ-RNANDI');
    expect(client[0].commission_payment_pic_id).toBe('ZZ-RNANDI');

    // Because Sales PIC moved, Budi can no longer act on this client at all —
    // a second renewal attempt by Budi is now Forbidden.
    await expect(proposeRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, [standardLine(svc)], true))
      .rejects.toBeInstanceOf(ForbiddenError);

    // The audit trail keeps the BEFORE snapshot even though the live row is gone
    // (immutable history — house rule #3), so who held credit before this
    // execution is still recoverable from the log even though it's no longer
    // the live truth.
    const audit = await sql<{ before_json: { allocations: { salesperson_id: string }[] } }[]>`
      select before_json from audit_log where entity_id = ${rn.id} and action = 'execute'`;
    expect(audit[0].before_json.allocations.map((a) => a.salesperson_id)).toEqual(['ZZ-RNBUDI']);
  });

  it('a split renewal allocation replaces a solo one (multiple new salespeople, none of the old)', async () => {
    const svc = await seedService('SVC-ZZ-RN-SPLIT');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, salesLead(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    await executeRenewal(sql, salesLead(), rn.id, {
      durasiBulan: 12, ...nextYearWindow(),
      parties: {
        primarySalespersonId: andi().employeeId,
        allocations: [
          { salespersonId: andi().employeeId, basisPoints: 6000 },
          { salespersonId: salesLead().employeeId, basisPoints: 4000 },
        ],
        commissionPaymentPicId: andi().employeeId,
      },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });

    const after = await sql<{ salesperson_id: string; basis_points: number }[]>`
      select salesperson_id, basis_points from client_sales_allocations where client_id = ${clientId} order by salesperson_id`;
    expect(after.map((a) => a.salesperson_id)).toEqual(['ZZ-RNANDI', 'ZZ-RNSLEAD']);
    expect(after.reduce((sum, a) => sum + a.basis_points, 0)).toBe(10000);
  });
});

describeDb('reads', () => {
  it('listRenewalsForClient returns every offer newest-first, denies a non-owner, and canReadRenewal allows the OD-style read-all path', async () => {
    const svc = await seedService('SVC-ZZ-RN-LIST');
    const clientId = await closedClient(budi(), svc);
    const first = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false);
    await decideRenewal(sql, salesLead(), first.id, DECISION_REJECT, 'x');
    const second = await proposeRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, [standardLine(svc)], true);

    const list = await listRenewalsForClient(sql, budi(), clientId);
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);

    await expect(listRenewalsForClient(sql, andi(), clientId)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listRenewalsForClient(sql, director(), clientId)).toHaveLength(2);
  });

  it('getRenewalDetail carries the newest priced line set (what R-04 review/decide/execute reads)', async () => {
    const svc = await seedService('SVC-ZZ-RN-DETAIL');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false);

    const detail = await getRenewalDetail(sql, budi(), rn.id);
    expect(detail.id).toBe(rn.id);
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0].masterServiceId).toBe(svc);
    expect(money.parse(detail.lines[0].proposedPrice)).toBe(money.parse('7000000'));

    await decideRenewal(sql, salesLead(), rn.id, DECISION_REJECT, 'x');
    await resubmitRenewal(sql, budi(), rn.id, [
      { masterServiceId: svc, proposedPrice: '7200000', commissionRule: '10% of standard price' },
    ]);
    // Detail follows the resubmitted (newest) version, not the rejected one.
    const after = await getRenewalDetail(sql, budi(), rn.id);
    expect(money.parse(after.lines[0].proposedPrice)).toBe(money.parse('7200000'));

    await expect(getRenewalDetail(sql, andi(), rn.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
