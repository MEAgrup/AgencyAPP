/**
 * Tests for R-03 (Kinerja Sales — Renewal/Cross-Sell from the Client Record).
 *
 * Own actor/id namespace `ZRNW-` (not the shared `ZZ-`) — vitest runs files
 * serially against one DB (`fileParallelism: false`), but a distinct prefix
 * still keeps this suite's cleanup independent of any other file's fixtures.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { commissionAchievement } from './finance';
import { register } from './leads';
import {
  close,
  DECISION_APPROVE,
  markContacted,
  PAYMENT_SCHEME_LUNAS,
  submitNegotiation,
  submitQualifiedForm,
  type Actor,
} from './sales';
import { createContract } from './contract';
import { bySalesperson } from './salesperf';
import {
  acceptRenewalCounter,
  canManageRenewal,
  cancelRenewal,
  closeRenewal,
  createRenewal,
  ContractMismatchError,
  decideRenewal,
  ForbiddenError,
  getRenewal,
  IncompleteError,
  JENIS_CROSS_SELL,
  JENIS_PERPANJANGAN,
  listRenewalsForClient,
  NotClosableError,
  NotFoundError,
  STATUS_CANCELLED,
  STATUS_CLOSED,
  STATUS_DRAFT,
  submitRenewalNegotiation,
} from './renewal';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const budi = (): Actor => ({
  employeeId: 'ZRNW-BUDI', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const andi = (): Actor => ({
  employeeId: 'ZRNW-ANDI', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZRNW-SLEAD', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const accountLead = (): Actor => ({
  employeeId: 'ZRNW-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }),
});

describe('canManageRenewal', () => {
  it('grants the client\'s own Sales PIC, Sales lead, and Director; denies a different Sales staff and other divisions', () => {
    expect(canManageRenewal(budi(), 'ZRNW-BUDI')).toBe(true);
    expect(canManageRenewal(andi(), 'ZRNW-BUDI')).toBe(false);
    expect(canManageRenewal(salesLead(), 'ZRNW-BUDI')).toBe(true);
    expect(canManageRenewal({ employeeId: 'ZRNW-DIR', role: permission.makeRole({ director: true }) }, 'ZRNW-BUDI')).toBe(true);
    expect(canManageRenewal(accountLead(), 'ZRNW-BUDI')).toBe(false);
  });
});

let seq = 0;
const uniquePhone = (): string => `0814${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;

async function seedService(id: string, price = '9000000.00', rule = '10% of standard price'): Promise<string> {
  await sql`insert into master_services (id, created_by) values (${id}, 'ZRNW-ADMIN') on conflict (id) do nothing`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${id}, 1, ${'Svc ' + id}, ${price}, ${rule}, true, '2020-01-01', 'flat', 'ZRNW-ADMIN')
    on conflict do nothing`;
  return id;
}

/** A client closed once (the original deal), owned by ZRNW-BUDI. */
async function closedClient(svc: string): Promise<{ clientId: string; transactionId: string }> {
  const { attempt } = await register(sql, budi(), { leadName: 'ZRNW Alpha', phoneNumber: uniquePhone(), source: 'Scouting' });
  await markContacted(sql, budi(), attempt.id);
  await submitQualifiedForm(sql, budi(), attempt.id, {
    namaPic: 'Ibu ZRNW', toko: 'ZRNW Toko', kota: 'Jakarta', linkToko: 'https://shopee/zrnw',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [{ masterServiceId: svc, quantity: 1 }],
  });
  await submitNegotiation(sql, budi(), attempt.id, [], true);
  const res = await close(sql, budi(), attempt.id, {
    parties: { primarySalespersonId: 'ZRNW-BUDI', allocations: [{ salespersonId: 'ZRNW-BUDI', basisPoints: 10000 }] },
    paymentScheme: PAYMENT_SCHEME_LUNAS,
  });
  return { clientId: res.clientId, transactionId: res.transactionId };
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from negotiation_proposal_lines where created_by like 'ZRNW-%'`;
  await sql`delete from negotiation_proposals where created_by like 'ZRNW-%'`;
  await sql`delete from contract_renewals where created_by like 'ZRNW-%'`;
  await sql`delete from installments where created_by like 'ZRNW-%'`;
  await sql`delete from client_sales_allocations where created_by like 'ZRNW-%'`;
  await sql`delete from services where created_by like 'ZRNW-%'`;
  await sql`delete from contracts where created_by like 'ZRNW-%'`;
  await sql`delete from transactions where created_by like 'ZRNW-%'`;
  await sql`delete from client_platforms where created_by like 'ZRNW-%'`;
  await sql`delete from clients where created_by like 'ZRNW-%'`;
  await sql`delete from qualified_form_services where created_by like 'ZRNW-%'`;
  await sql`delete from qualified_forms where created_by like 'ZRNW-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZRNW-%'`;
  await sql`delete from leads where created_by like 'ZRNW-%'`;
  await sql`delete from master_service_versions where created_by like 'ZRNW-ADMIN'`;
  await sql`delete from master_services where created_by like 'ZRNW-ADMIN'`;
});

describeDb('createRenewal', () => {
  it('opens a Draft cross-sell request with no chain link', async () => {
    const svc = await seedService('SVC-ZRNW-CS1');
    const { clientId } = await closedClient(svc);
    const r = await createRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, null);
    expect(r.status).toBe(STATUS_DRAFT);
    expect(r.jenis).toBe(JENIS_CROSS_SELL);
    expect(r.contractSebelumnyaId).toBeNull();
  });

  it('opens a Draft perpanjangan request chained to an existing contract of the SAME client', async () => {
    const svc = await seedService('SVC-ZRNW-PP1');
    const { clientId } = await closedClient(svc);
    const ctr = await createContract(sql, accountLead(), clientId, {
      durasiBulan: 12, tanggalMulai: '2026-01-01', tanggalAkhir: '2026-12-31',
    });
    const r = await createRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, ctr.id);
    expect(r.jenis).toBe(JENIS_PERPANJANGAN);
    expect(r.contractSebelumnyaId).toBe(ctr.id);
  });

  it('rejects a contract that belongs to a DIFFERENT client, and a missing contractSebelumnyaId for perpanjangan', async () => {
    const svc1 = await seedService('SVC-ZRNW-MIS1');
    const svc2 = await seedService('SVC-ZRNW-MIS2');
    const { clientId: clientA } = await closedClient(svc1);
    const { clientId: clientB } = await closedClient(svc2);
    const ctrOfB = await createContract(sql, accountLead(), clientB, {
      durasiBulan: 12, tanggalMulai: '2026-01-01', tanggalAkhir: '2026-12-31',
    });
    await expect(createRenewal(sql, budi(), clientA, JENIS_PERPANJANGAN, ctrOfB.id)).rejects.toBeInstanceOf(ContractMismatchError);
    await expect(createRenewal(sql, budi(), clientA, JENIS_PERPANJANGAN, null)).rejects.toBeInstanceOf(IncompleteError);
  });

  it('denies a Sales staff who is not this client\'s own PIC', async () => {
    const svc = await seedService('SVC-ZRNW-DENY1');
    const { clientId } = await closedClient(svc);
    await expect(createRenewal(sql, andi(), clientId, JENIS_CROSS_SELL, null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404s on an unknown client', async () => {
    await expect(createRenewal(sql, budi(), 'CLI-000000-0000', JENIS_CROSS_SELL, null)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('negotiation + close', () => {
  it('no-negotiation (standard terms) auto-approves and closes straight into a new CTR-/SVC-/TRX- on the SAME client', async () => {
    const svc = await seedService('SVC-ZRNW-CLOSE1', '9000000.00', '10% of standard price');
    const { clientId, transactionId: originalTrx } = await closedClient(svc);
    const r = await createRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, null);

    const svc2 = await seedService('SVC-ZRNW-CLOSE1B', '5000000.00', '10% of standard price');
    const submitted = await submitRenewalNegotiation(sql, budi(), r.id, [{ masterServiceId: svc2 }], true);
    expect(submitted.ok).toBe(true);

    const res = await closeRenewal(sql, budi(), r.id, {
      parties: { primarySalespersonId: 'ZRNW-BUDI', allocations: [{ salespersonId: 'ZRNW-BUDI', basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
      contractDurasiBulan: 12, contractTanggalMulai: '2026-01-01', contractTanggalAkhir: '2026-12-31',
    });
    expect(res.clientId).toBe(clientId); // SAME client — no CLI- born
    expect(res.transactionId).not.toBe(originalTrx);

    const ctr = await sql<{ jenis: string; client_id: string }[]>`
      select jenis, client_id from contracts where transaction_id = ${res.transactionId}`;
    expect(ctr[0].jenis).toBe(JENIS_CROSS_SELL);
    expect(ctr[0].client_id).toBe(clientId);

    const svcRows = await sql<{ standard_price: string }[]>`select standard_price from services where transaction_id = ${res.transactionId}`;
    expect(svcRows).toHaveLength(1);
    expect(money.parse(svcRows[0].standard_price)).toBe(money.parse('5000000'));

    const renewalRow = await getRenewal(sql, budi(), r.id);
    expect(renewalRow.status).toBe(STATUS_CLOSED);

    // The original transaction's own commission is UNCHANGED by the renewal
    // closing — R-03's whole point: two closings on one client must not
    // contaminate each other's money.
    const originalCommission = await commissionAchievement(sql, originalTrx);
    expect(money.parse(originalCommission.totalDealCommission)).toBe(money.parse('900000')); // 10% of 9,000,000
    const newCommission = await commissionAchievement(sql, res.transactionId);
    expect(money.parse(newCommission.totalDealCommission)).toBe(money.parse('500000')); // 10% of 5,000,000
  });

  it('a custom-priced line requires Superior approval before closing; a non-superior cannot decide', async () => {
    const svc = await seedService('SVC-ZRNW-CUSTOM1');
    const { clientId } = await closedClient(svc);
    const r = await createRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, null);

    const svc2 = await seedService('SVC-ZRNW-CUSTOM1B', '5000000.00');
    const submitted = await submitRenewalNegotiation(
      sql, budi(), r.id,
      [{ masterServiceId: svc2, proposedPrice: '4500000', commissionRule: '10% of standard price' }],
      false,
    );
    expect(submitted.ok).toBe(true);
    expect((await getRenewal(sql, budi(), r.id)).status).toBe('Negotiation - Pending Approval');

    const denied = await decideRenewal(sql, budi(), r.id, DECISION_APPROVE);
    expect(denied.ok).toBe(false);

    const approved = await decideRenewal(sql, salesLead(), r.id, DECISION_APPROVE);
    expect(approved.ok).toBe(true);
    expect((await getRenewal(sql, budi(), r.id)).status).toBe('Negotiation - Approved');

    const res = await closeRenewal(sql, budi(), r.id, {
      parties: { primarySalespersonId: 'ZRNW-BUDI', allocations: [{ salespersonId: 'ZRNW-BUDI', basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
      contractDurasiBulan: 6, contractTanggalMulai: '2026-02-01', contractTanggalAkhir: '2026-07-31',
    });
    const svcRows = await sql<{ standard_price: string }[]>`select standard_price from services where transaction_id = ${res.transactionId}`;
    expect(money.parse(svcRows[0].standard_price)).toBe(money.parse('4500000'));
  });

  it('a Revision Required round trip: superior revises, salesperson accepts the counter, then closes', async () => {
    const svc = await seedService('SVC-ZRNW-REV1');
    const { clientId } = await closedClient(svc);
    const r = await createRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, null);
    const svc2 = await seedService('SVC-ZRNW-REV1B', '5000000.00');
    await submitRenewalNegotiation(sql, budi(), r.id, [{ masterServiceId: svc2, proposedPrice: '4500000', commissionRule: '10% of standard price' }], false);

    const revised = await decideRenewal(sql, salesLead(), r.id, 'revise', 'harga terlalu rendah');
    expect(revised.ok).toBe(true);
    expect((await getRenewal(sql, budi(), r.id)).status).toBe('Negotiation - Revision Required');

    const accepted = await acceptRenewalCounter(sql, budi(), r.id);
    expect(accepted.ok).toBe(true);
    expect((await getRenewal(sql, budi(), r.id)).status).toBe('Negotiation - Approved');
  });

  it('refuses to close a Draft/Pending renewal (only Approved/Auto-Approved may close)', async () => {
    const svc = await seedService('SVC-ZRNW-NOTCLOSE1');
    const { clientId } = await closedClient(svc);
    const r = await createRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, null);
    await expect(closeRenewal(sql, budi(), r.id, {
      parties: { primarySalespersonId: 'ZRNW-BUDI', allocations: [{ salespersonId: 'ZRNW-BUDI', basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
      contractDurasiBulan: 12, contractTanggalMulai: '2026-01-01', contractTanggalAkhir: '2026-12-31',
    })).rejects.toBeInstanceOf(NotClosableError);
  });

  it('cancelRenewal abandons a Draft request', async () => {
    const svc = await seedService('SVC-ZRNW-CANCEL1');
    const { clientId } = await closedClient(svc);
    const r = await createRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, null);
    const cancelled = await cancelRenewal(sql, budi(), r.id);
    expect(cancelled.ok).toBe(true);
    expect((await getRenewal(sql, budi(), r.id)).status).toBe(STATUS_CANCELLED);
  });

  it('listRenewalsForClient returns every request on a client, newest first', async () => {
    const svc = await seedService('SVC-ZRNW-LIST1');
    const { clientId } = await closedClient(svc);
    await createRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, null);
    await createRenewal(sql, budi(), clientId, JENIS_CROSS_SELL, null);
    const list = await listRenewalsForClient(sql, budi(), clientId);
    expect(list).toHaveLength(2);
  });
});

describeDb('salesperf.ts R-02 integration', () => {
  it('classifies the renewal closing as perpanjangan while the original stays baru, both weighted correctly', async () => {
    // salesperf.ts's roster is real employees/role_mappings — the in-memory
    // Actor fixtures above are enough for gate checks, but bySalesperson
    // needs actual rows to resolve ZRNW-BUDI/ZRNW-ANDI as Sales staff.
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by) values
        ('ZRNW-BUDI', 'ZRNW Budi', 'zrnw.budi@example.test', 'Sales', 'Sales Executive', true, 'SYSTEM'),
        ('ZRNW-ANDI', 'ZRNW Andi', 'zrnw.andi@example.test', 'Sales', 'Sales Executive', true, 'SYSTEM')
      on conflict (employee_id) do nothing`;

    const svc = await seedService('SVC-ZRNW-SP1');
    const { clientId } = await closedClient(svc);
    const ctr = await createContract(sql, accountLead(), clientId, {
      durasiBulan: 12, tanggalMulai: '2025-01-01', tanggalAkhir: '2025-12-31',
    });
    const r = await createRenewal(sql, budi(), clientId, JENIS_PERPANJANGAN, ctr.id);
    const svc2 = await seedService('SVC-ZRNW-SP1B', '3000000.00');
    // The Sales LEAD processes this renewal (blanket access, canManageRenewal)
    // and names Andi — not Budi, the client's own PIC — as the closing
    // salesperson: allocation credit follows whoever the CLOSING FORM names,
    // not automatically the client's PIC (owner decision 2026-08-30).
    await submitRenewalNegotiation(sql, salesLead(), r.id, [{ masterServiceId: svc2 }], true);
    await closeRenewal(sql, salesLead(), r.id, {
      parties: { primarySalespersonId: 'ZRNW-ANDI', allocations: [{ salespersonId: 'ZRNW-ANDI', basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_LUNAS,
      contractDurasiBulan: 12, contractTanggalMulai: '2026-01-01', contractTanggalAkhir: '2026-12-31',
    });

    const budiRows = await bySalesperson(sql, salesLead(), { period: null, salespersonId: 'ZRNW-BUDI', source: null, campaignId: null });
    expect(budiRows[0].klienBaru).toBe('1.0000');
    expect(budiRows[0].klienPerpanjangan).toBe('0.0000');
    expect(budiRows[0].omzet).toBe(money.parse('9000000')); // only the original closing

    const andiRows = await bySalesperson(sql, salesLead(), { period: null, salespersonId: 'ZRNW-ANDI', source: null, campaignId: null });
    expect(andiRows[0].klienBaru).toBe('0.0000');
    expect(andiRows[0].klienPerpanjangan).toBe('1.0000');
    expect(andiRows[0].omzet).toBe(money.parse('3000000')); // only the renewal closing
  });
});
