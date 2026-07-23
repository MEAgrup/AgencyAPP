/**
 * Tests for the M5 Admin & Finance verification vertical.
 *
 * - Unit: the write-permission matrix (canVerifyPayment) and the input gates
 *   that reject before any DB access.
 * - Integration (skipped unless DATABASE_URL is set): the full verify / rollup /
 *   routing-gate / contract-gate vertical + the derived Amount Verified and
 *   commission-achievement read-models against a migrated Postgres. Each test
 *   namespaces its ids with `ZZ-` and afterEach deletes the rows it made.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { leads, sales } from './index.js';
import {
  attachContract,
  canVerifyPayment,
  commissionAchievement,
  ContractRequiredError,
  ForbiddenError,
  getPaymentStatus,
  IncompleteError,
  NotFoundError,
  OverVerificationError,
  type Actor,
  verifyPayment,
} from './finance.js';

const financeStaff = (): Actor => ({
  employeeId: 'ZZ-FIN', divisi: 'Finance',
  role: permission.makeRole({ division: 'Finance', level: 'staff' }),
});
const financeLead = (): Actor => ({
  employeeId: 'ZZ-FINLEAD', divisi: 'Finance',
  role: permission.makeRole({ division: 'Finance', level: 'lead' }),
});
const director = (): Actor => ({
  employeeId: 'ZZ-DIR', divisi: 'Management',
  role: permission.makeRole({ director: true }),
});
const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

// ---------------------------------------------------------------------------
// Unit: write-permission matrix (M5 §8.1).
// ---------------------------------------------------------------------------
describe('canVerifyPayment', () => {
  it('allows Admin & Finance (staff + lead) and Director', () => {
    expect(canVerifyPayment(financeStaff())).toBe(true);
    expect(canVerifyPayment(financeLead())).toBe(true);
    expect(canVerifyPayment(director())).toBe(true);
  });

  it('denies Sales, and read-only OD', () => {
    expect(canVerifyPayment(budi())).toBe(false);
    const od: Actor = { employeeId: 'ZZ-OD', divisi: 'Management', role: permission.makeRole({ od: true }) };
    expect(canVerifyPayment(od)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit: input gates (no DB).
// ---------------------------------------------------------------------------
describe('verify input gates (no DB)', () => {
  const noSql = null as unknown as Sql;

  it('a non-Finance actor is forbidden before any DB access', async () => {
    await expect(verifyPayment(noSql, budi(), { transactionId: 'TRX-x', amount: '100', receivedDate: '2026-06-01' }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a non-positive / unparseable amount is incomplete', async () => {
    await expect(verifyPayment(noSql, financeStaff(), { transactionId: 'TRX-x', amount: '0', receivedDate: '2026-06-01' }))
      .rejects.toBeInstanceOf(IncompleteError);
    await expect(verifyPayment(noSql, financeStaff(), { transactionId: 'TRX-x', amount: 'abc', receivedDate: '2026-06-01' }))
      .rejects.toBeInstanceOf(IncompleteError);
  });

  it('a missing received date is incomplete', async () => {
    await expect(verifyPayment(noSql, financeStaff(), { transactionId: 'TRX-x', amount: '100', receivedDate: '' }))
      .rejects.toBeInstanceOf(IncompleteError);
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
const uniqueSvc = (): string => `SVC-ZZ-FIN-${seq++}`;

/** Seed a flat MSL service (10% commission, Rp 9.000.000). */
async function seedService(id: string): Promise<string> {
  await sql`insert into master_services (id, created_by) values (${id}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${id}, 1, ${'Svc ' + id}, '9000000.00', '10% of standard price', true, '2020-01-01', 'flat', 'ZZ-ADMIN')`;
  return id;
}

/** Close a deal (Budi solo) under `scheme`, returning the birthed ids. */
async function closedDeal(
  scheme: string,
  installments?: { amount: string; dueDate: string }[],
): Promise<{ transactionId: string; clientId: string; installmentIds: string[] }> {
  const svc = await seedService(uniqueSvc());
  const { attempt } = await leads.register(sql, budi(), { leadName: 'Alpha Digital', phoneNumber: uniquePhone() });
  await sales.markContacted(sql, budi(), attempt.id);
  await sales.submitQualifiedForm(sql, budi(), attempt.id, {
    namaPic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta', linkToko: 'https://shopee/alpha',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [{ masterServiceId: svc, quantity: 1 }],
  });
  await sales.submitNegotiation(sql, budi(), attempt.id, [], true);
  const res = await sales.close(sql, budi(), attempt.id, {
    parties: { primarySalespersonId: 'ZZ-BUDI', allocations: [{ salespersonId: 'ZZ-BUDI', basisPoints: 10000 }] },
    paymentScheme: scheme,
    installments,
  });
  const insts = await sql<{ id: string }[]>`
    select id from installments where transaction_id = ${res.transactionId} order by installment_no`;
  return { transactionId: res.transactionId, clientId: res.clientId, installmentIds: insts.map((i) => i.id) };
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from payment_verifications where created_by like 'ZZ-%'`;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from client_sales_allocations where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposal_lines where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposals where created_by like 'ZZ-%'`;
  await sql`delete from qualified_form_services where created_by like 'ZZ-%'`;
  await sql`delete from qualified_forms where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
});

describeDb('verifyPayment — Lunas', () => {
  it('full verification (with contract) reaches [Lunas] and releases to Account', async () => {
    const { transactionId, clientId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await attachContract(sql, financeStaff(), transactionId, 'https://drive/contract.pdf');

    const res = await verifyPayment(sql, financeStaff(), {
      transactionId, amount: '9000000', receivedDate: '2026-06-03', proofOfPayment: 'https://drive/proof1.pdf',
    });
    expect(res.paymentStatus).toBe('[Lunas]');
    expect(money.parse(res.amountVerified)).toBe(money.parse('9000000'));
    expect(money.parse(res.amountOutstanding)).toBe(0n);
    expect(res.releasedToAccount).toBe(true);

    const client = await sql<{ released_to_account_at: Date | null }[]>`
      select released_to_account_at from clients where id = ${clientId}`;
    expect(client[0].released_to_account_at).not.toBeNull();
  });

  it('blocks full verification when no contract is attached (§7 Rule 2)', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await expect(verifyPayment(sql, financeStaff(), { transactionId, amount: '9000000', receivedDate: '2026-06-03' }))
      .rejects.toBeInstanceOf(ContractRequiredError);
  });

  it('blocks a verification exceeding the agreed total (§3 Rule 4)', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await attachContract(sql, financeStaff(), transactionId, 'https://drive/c.pdf');
    await expect(verifyPayment(sql, financeStaff(), { transactionId, amount: '9000001', receivedDate: '2026-06-03' }))
      .rejects.toBeInstanceOf(OverVerificationError);
  });

  it('a Sales actor cannot verify (§8.1)', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await expect(verifyPayment(sql, budi(), { transactionId, amount: '9000000', receivedDate: '2026-06-03' }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('verifyPayment — Termin', () => {
  const schedule = [
    { amount: '3000000', dueDate: '2026-06-15' },
    { amount: '3000000', dueDate: '2026-07-15' },
    { amount: '3000000', dueDate: '2026-08-15' },
  ];

  it('first installment → [Terverifikasi - Sebagian], releases, installment verified', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, schedule);
    const res = await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: installmentIds[0], amount: '3000000', receivedDate: '2026-06-15',
    });
    expect(res.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    expect(money.parse(res.amountOutstanding)).toBe(money.parse('6000000'));
    expect(res.releasedToAccount).toBe(true);

    const inst = await sql<{ status: string; verified_by: string | null }[]>`
      select status, verified_by from installments where id = ${installmentIds[0]}`;
    expect(inst[0].status).toBe('[Terverifikasi]');
    expect(inst[0].verified_by).toBe('ZZ-FIN');
  });

  it('reaches [Lunas] only when every installment is verified (with contract)', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, schedule);
    await attachContract(sql, financeLead(), transactionId, 'https://drive/c.pdf');
    const r1 = await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[0], amount: '3000000', receivedDate: '2026-06-15' });
    const r2 = await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[1], amount: '3000000', receivedDate: '2026-07-15' });
    expect(r1.releasedToAccount).toBe(true);
    expect(r2.releasedToAccount).toBe(false); // only the FIRST verification routes
    expect(r2.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    const r3 = await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[2], amount: '3000000', receivedDate: '2026-08-15' });
    expect(r3.paymentStatus).toBe('[Lunas]');
    expect(money.parse(r3.amountOutstanding)).toBe(0n);
  });

  it('rejects a verification without an installment for a scheduled scheme', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, schedule);
    await expect(verifyPayment(sql, financeStaff(), { transactionId, amount: '3000000', receivedDate: '2026-06-15' }))
      .rejects.toBeInstanceOf(IncompleteError);
  });

  it('cannot re-verify an already-verified installment', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, schedule);
    await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[0], amount: '3000000', receivedDate: '2026-06-15' });
    await expect(verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[0], amount: '3000000', receivedDate: '2026-06-16' }))
      .rejects.toBeInstanceOf(IncompleteError);
  });
});

describeDb('read models', () => {
  it('getPaymentStatus derives Amount Verified / Outstanding from the log', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '4000000', dueDate: '2026-06-15' },
      { amount: '5000000', dueDate: '2026-07-15' },
    ]);
    await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[0], amount: '4000000', receivedDate: '2026-06-15' });

    const view = await getPaymentStatus(sql, transactionId);
    expect(view.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    expect(money.parse(view.amountVerified)).toBe(money.parse('4000000'));
    expect(money.parse(view.amountOutstanding)).toBe(money.parse('5000000'));
    expect(view.installments).toHaveLength(2);
    expect(view.verifications).toHaveLength(1);
  });

  it('commissionAchievement recognizes commission pro-rata to Amount Verified', async () => {
    // Total deal Rp 9.000.000, commission 10% = Rp 900.000. Verify 1/3.
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '3000000', dueDate: '2026-06-15' },
      { amount: '3000000', dueDate: '2026-07-15' },
      { amount: '3000000', dueDate: '2026-08-15' },
    ]);

    // Before any verification: recognized commission is zero.
    const before = await commissionAchievement(sql, transactionId);
    expect(money.parse(before.totalDealCommission)).toBe(money.parse('900000'));
    expect(money.parse(before.recognizedCommission)).toBe(0n);

    await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[0], amount: '3000000', receivedDate: '2026-06-15' });
    const after = await commissionAchievement(sql, transactionId);
    expect(money.parse(after.amountVerified)).toBe(money.parse('3000000'));
    expect(money.parse(after.recognizedCommission)).toBe(money.parse('300000')); // 1/3 of 900.000
    expect(after.shares).toHaveLength(1);
    expect(after.shares[0].salespersonId).toBe('ZZ-BUDI');
    expect(money.parse(after.shares[0].recognizedCommission)).toBe(money.parse('300000')); // 100% allocation
  });

  it('getPaymentStatus 404s on an unknown transaction', async () => {
    await expect(getPaymentStatus(sql, 'TRX-000000-0000')).rejects.toBeInstanceOf(NotFoundError);
  });
});
