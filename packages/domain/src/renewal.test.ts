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
import { money, page, permission } from '@cdps/core';
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
  JENIS_BAYAR_KOMISI,
  JENIS_CROSS_SELL,
  JENIS_PERPANJANGAN,
  listRenewals,
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

/**
 * Layanan Komisi seperti di katalog live: passthrough, harga standar Rp 0,
 * `durasi_bulan` NULL, dan `pengakuan = 'bulan_berikutnya'` (D-KOM). Nilainya
 * diisi Sales per transaksi — itu sebabnya harga standarnya nol.
 */
async function seedKomisiService(id: string): Promise<string> {
  await sql`insert into master_services (id, created_by) values (${id}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from,
       pricing_mode, durasi_bulan, qty_menambah, pengakuan, created_by)
    values (${id}, 1, 'Komisi', '0.00', 'flat Rp 0', true, '2020-01-01',
            'passthrough', NULL, 'volume', 'bulan_berikutnya', 'ZZ-ADMIN')`;
  return id;
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

  it('listRenewals pages by keyset across clients, and is unbounded when unasked (P2 §6)', async () => {
    const svc = await seedService('SVC-ZZ-RN-PAGE');
    const clientId = await closedClient(budi(), svc);
    const a = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [customLine(svc)], false);
    await decideRenewal(sql, salesLead(), a.id, DECISION_REJECT, 'x');
    const b = await proposeRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, [standardLine(svc)], true);

    const unbounded = await listRenewals(sql);
    expect(unbounded.nextCursor).toBeNull();
    const allIds = unbounded.rows.map((r) => r.id);
    expect(allIds).toEqual(expect.arrayContaining([a.id, b.id]));

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
      const p: page.Page<{ id: string }> = await listRenewals(sql, {
        page: { limit: 1, cursor: cursor === null ? null : page.decodeCursor(cursor) },
      });
      seen.push(...p.rows.map((r) => r.id));
      if (p.nextCursor === null) break;
      cursor = p.nextCursor;
    }
    expect(seen).toEqual(allIds);
    expect(new Set(seen).size).toBe(seen.length);
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

// ---------------------------------------------------------------------------
// FS-4 — jenis `bayar_komisi`: TAGIHAN, bukan kesepakatan baru.
// ---------------------------------------------------------------------------
describeDb('bayar_komisi (FS-4)', () => {
  /**
   * Inti FS-4, dan alasan jenis ini punya cabangnya sendiri.
   *
   * `executeRenewal` untuk perpanjangan/cross-sell MENGGANTI SELURUH alokasi
   * komisi klien (KS-2) dan memindahkan `clients.sales_pic_id`. Komisi ditagih
   * SETIAP BULAN — memakai jalur itu apa adanya berarti kepemilikan klien
   * berpindah tiap bulan, diam-diam, ke siapa pun yang menekan tombol tagih.
   *
   * Dua assertion ini yang menahannya, dan keduanya membandingkan keadaan
   * SEBELUM dengan SESUDAH, bukan sekadar "ada barisnya".
   */
  it('TIDAK mencetak CTR- dan TIDAK menyentuh alokasi komisi klien', async () => {
    const komisi = await seedKomisiService('MSV-ZZ-RNKOM1');
    const svc = await seedService('MSV-ZZ-RNKOM1B');
    const clientId = await closedClient(budi(), svc);

    const allocSebelum = await sql`
      select salesperson_id, basis_points from client_sales_allocations
       where client_id = ${clientId} order by salesperson_id`;
    const picSebelum = await sql`
      select sales_pic_id, commission_payment_pic_id from clients where id = ${clientId}`;
    const kontrakSebelum = await sql`select id from contracts where client_id = ${clientId}`;

    const rn = await proposeRenewal(
      sql, budi(), clientId, JENIS_BAYAR_KOMISI,
      [{ masterServiceId: komisi, amount: '2500000' }], true,
    );
    expect(rn.status).toBe(STATUS_AUTO_APPROVED);

    const res = await executeRenewal(sql, budi(), rn.id, {
      parties: { primarySalespersonId: '', allocations: [] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });

    // 1) Nol kontrak baru — jumlahnya sama persis dengan sebelumnya.
    expect(res.contractId).toBeNull();
    const kontrakSesudah = await sql`select id from contracts where client_id = ${clientId}`;
    expect(kontrakSesudah.length).toBe(kontrakSebelum.length);

    // 2) Alokasi & PIC tidak bergerak sedikit pun.
    const allocSesudah = await sql`
      select salesperson_id, basis_points from client_sales_allocations
       where client_id = ${clientId} order by salesperson_id`;
    expect(allocSesudah).toEqual(allocSebelum);
    const picSesudah = await sql`
      select sales_pic_id, commission_payment_pic_id from clients where id = ${clientId}`;
    expect(picSesudah).toEqual(picSebelum);

    // 3) Yang MEMANG lahir: satu SVC- (tanpa kontrak) + satu TRX- senilai
    //    angka yang diketik Sales.
    expect(res.transactionId).toMatch(/^TRX-/);
    const trx = await sql`
      select total_agreed_value::text as total from transactions where id = ${res.transactionId}`;
    expect(money.parse(trx[0].total)).toBe(money.parse('2500000'));
    const svcRows = await sql`
      select id, contract_id from services
       where client_id = ${clientId} and master_service_id = ${komisi}`;
    expect(svcRows.length).toBe(1);
    expect(svcRows[0].contract_id).toBeNull();
  });

  it('menolak layanan yang pengakuan-nya BUKAN bulan_berikutnya', async () => {
    // Digerbangi lewat penanda katalog, bukan nama "Komisi": nama bisa
    // disunting Sales Head lewat form MSL kapan saja.
    const biasa = await seedService('MSV-ZZ-RNKOM2');
    const clientId = await closedClient(budi(), biasa);
    await expect(
      proposeRenewal(sql, budi(), clientId, JENIS_BAYAR_KOMISI, [standardLine(biasa)], true),
    ).rejects.toBeInstanceOf(IncompleteError);
  });

  it('menolak lebih dari satu baris — "pilihan jasa hanya 1 yaitu komisi"', async () => {
    const komisi = await seedKomisiService('MSV-ZZ-RNKOM3');
    const svc = await seedService('MSV-ZZ-RNKOM3B');
    const clientId = await closedClient(budi(), svc);
    await expect(
      proposeRenewal(sql, budi(), clientId, JENIS_BAYAR_KOMISI,
        [{ masterServiceId: komisi, amount: '1000000' }, standardLine(svc)], true),
    ).rejects.toBeInstanceOf(IncompleteError);
  });

  it('gerbang yang sama berlaku saat RESUBMIT, bukan hanya saat mengajukan', async () => {
    // Pintu kedua ke aturan yang sama selalu jadi yang terlupa.
    const komisi = await seedKomisiService('MSV-ZZ-RNKOM4');
    const biasa = await seedService('MSV-ZZ-RNKOM4B');
    const clientId = await closedClient(budi(), biasa);

    const rn = await proposeRenewal(
      sql, budi(), clientId, JENIS_BAYAR_KOMISI,
      [{ masterServiceId: komisi, amount: '900000', proposedPrice: '900000', commissionRule: 'flat Rp 0' }],
      false,
    );
    await decideRenewal(sql, salesLead(), rn.id, DECISION_REJECT, 'angkanya salah');

    await expect(
      resubmitRenewal(sql, budi(), rn.id, [standardLine(biasa)]),
    ).rejects.toBeInstanceOf(IncompleteError);
  });

  /**
   * Pagar untuk harga yang dibayar FS-4: `ExecuteRenewalInput.durasiBulan`/
   * `tanggalMulai`/`tanggalAkhir` dilonggarkan jadi opsional, karena
   * `bayar_komisi` tidak punya jendela untuk diisi dan jenisnya baru diketahui
   * saat baris `RNW-` dibaca di dalam transaksi.
   *
   * Konsekuensinya: `tsc` tidak lagi menahan pemanggil perpanjangan yang lupa
   * mengisinya. Yang menahan sekarang adalah runtime — dan tanpa tes ini,
   * pelonggaran tipe tadi mencabut satu-satunya penjaga yang ada.
   */
  it('perpanjangan MENOLAK jendela yang hilang atau tidak masuk akal', async () => {
    const svc = await seedService('MSV-ZZ-RNKOM6');
    const clientId = await closedClient(budi(), svc);
    const parties = {
      primarySalespersonId: budi().employeeId,
      allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }],
    };

    const rn1 = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    // Jendela HILANG sama sekali.
    await expect(executeRenewal(sql, budi(), rn1.id, {
      parties, paymentScheme: PAYMENT_SCHEME_LUNAS,
    })).rejects.toBeInstanceOf(IncompleteError);

    // Akhir mendahului mulai.
    await expect(executeRenewal(sql, budi(), rn1.id, {
      durasiBulan: 12, tanggalMulai: '2027-09-01', tanggalAkhir: '2026-09-01',
      parties, paymentScheme: PAYMENT_SCHEME_LUNAS,
    })).rejects.toBeInstanceOf(IncompleteError);

    // Durasi di luar 1..36.
    await expect(executeRenewal(sql, budi(), rn1.id, {
      durasiBulan: 0, ...nextYearWindow(),
      parties, paymentScheme: PAYMENT_SCHEME_LUNAS,
    })).rejects.toBeInstanceOf(IncompleteError);
    await expect(executeRenewal(sql, budi(), rn1.id, {
      durasiBulan: 37, ...nextYearWindow(),
      parties, paymentScheme: PAYMENT_SCHEME_LUNAS,
    })).rejects.toBeInstanceOf(IncompleteError);

    // Dan sesudah semua penolakan itu, TIDAK ada kontrak yang terlanjur lahir.
    const kontrak = await sql`select id from contracts where client_id = ${clientId}`;
    expect(kontrak.length).toBe(0);
  });

  it('perpanjangan TETAP mencetak CTR- dan TETAP mengganti alokasi (KS-2 utuh)', async () => {
    // Pagar arah sebaliknya: cabang FS-4 tidak boleh diam-diam mematikan
    // perilaku jenis lain.
    const svc = await seedService('MSV-ZZ-RNKOM5');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    const res = await executeRenewal(sql, budi(), rn.id, {
      ...nextYearWindow(),
      durasiBulan: 12,
      parties: { primarySalespersonId: andi().employeeId, allocations: [{ salespersonId: andi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });
    expect(res.contractId).toMatch(/^CTR-/);
    const alloc = await sql`
      select salesperson_id from client_sales_allocations where client_id = ${clientId}`;
    expect(alloc.map((r) => r.salesperson_id)).toEqual([andi().employeeId]);
  });
});

/**
 * FS-6b — tenor pilihan klien pada perpanjangan / cross-sell.
 *
 * Bentuknya sengaja identik dengan jalur closing (`sales.test.ts` blok yang
 * sama): satu aturan tenor, bukan dua. Yang dijaga di sini adalah sambungannya
 * — `renewal_proposal_lines.durasi_bulan` → `services.durasi_bulan` — karena
 * `executeRenewal` melahirkan `SVC-` lewat jalurnya SENDIRI, bukan lewat
 * `sales.close()`. Kalau tenor berhenti di baris proposal, layanan hasil
 * perpanjangan diakui sepanjang opsi TERPENDEK katalog, persis cacat yang
 * FS-6b ada untuk menutup — dan hanya di jalur ini.
 */
describeDb('FS-6b — tenor pada perpanjangan', () => {
  async function seedTenorService(id: string): Promise<string> {
    await sql`insert into master_services (id, created_by) values (${id}, 'ZZ-ADMIN')`;
    const ver = await sql<{ id: string }[]>`
      insert into master_service_versions
        (service_id, version_no, name, standard_price, commission_rule, active, effective_from,
         pricing_mode, durasi_bulan, pengakuan, created_by)
      values (${id}, 1, ${'Svc ' + id}, '10200000.00', '10% of standard price', true, '2020-01-01',
              'flat', 3, 'per_periode', 'ZZ-ADMIN')
      returning id`;
    for (const [bulan, harga] of [[3, '10200000.00'], [12, '36000000.00']] as [number, string][]) {
      await sql`insert into master_service_duration_options (version_id, durasi_bulan, harga, created_by)
                values (${ver[0].id}, ${bulan}, ${harga}, 'ZZ-ADMIN')`;
    }
    return id;
  }

  it('menyimpan tenor di baris proposal DAN di layanan yang lahir dari eksekusinya', async () => {
    const svc = await seedTenorService('MSV-ZZ-RNTENOR');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN,
      [{ masterServiceId: svc, durasiBulan: 12 }], true);

    const line = await sql<{ proposed_price: string; durasi_bulan: number | null }[]>`
      select l.proposed_price, l.durasi_bulan from renewal_proposal_lines l
        join renewal_proposals p on p.id = l.proposal_id
       where p.renewal_request_id = ${rn.id}`;
    // Harga paket 12 bulan, bukan harga versinya (= opsi 3 bulan).
    expect(line[0].proposed_price).toBe('36000000.00');
    expect(line[0].durasi_bulan).toBe(12);

    const res = await executeRenewal(sql, budi(), rn.id, {
      ...nextYearWindow(), durasiBulan: 12,
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });

    const svcRows = await sql<{ durasi_bulan: number | null; standard_price: string }[]>`
      select durasi_bulan, standard_price from services where contract_id = ${res.contractId}`;
    expect(svcRows).toHaveLength(1);
    expect(svcRows[0].durasi_bulan).toBe(12);
    expect(svcRows[0].standard_price).toBe('36000000.00');
  });

  it('tanpa tenor: baris dan layanan tetap NULL — perpanjangan lama tidak berubah artinya', async () => {
    const svc = await seedTenorService('MSV-ZZ-RNTENOR-NULL');
    const clientId = await closedClient(budi(), svc);
    const rn = await proposeRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, [standardLine(svc)], true);
    const res = await executeRenewal(sql, budi(), rn.id, {
      ...nextYearWindow(), durasiBulan: 12,
      parties: { primarySalespersonId: budi().employeeId, allocations: [{ salespersonId: budi().employeeId, basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
    });
    const svcRows = await sql<{ durasi_bulan: number | null; standard_price: string }[]>`
      select durasi_bulan, standard_price from services where contract_id = ${res.contractId}`;
    expect(svcRows[0].durasi_bulan).toBeNull();
    expect(svcRows[0].standard_price).toBe('10200000.00');
  });
});
