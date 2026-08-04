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
import { leads, sales } from './index';
import {
  approveSchemeChange,
  attachContract,
  cancelSchemeChange,
  canApproveSchemeChange,
  canManageScheme,
  canVerifyPayment,
  canVoteBermasalah,
  CHANGE_APPROVED,
  CHANGE_CANCELLED,
  CHANGE_PENDING,
  CHANGE_REJECTED,
  ChangeDecidedError,
  ChangePendingError,
  commissionAchievement,
  ContractRequiredError,
  flagBermasalah,
  ForbiddenError,
  getPaymentStatus,
  IncompleteError,
  INST_TERVERIFIKASI,
  NotFoundError,
  overdueLabel,
  OutstandingTotalError,
  OverVerificationError,
  rejectSchemeChange,
  reminderDashboard,
  requestSchemeChange,
  resolveBermasalah,
  ScheduleTotalError,
  schemeChangeRequests,
  scanReminders,
  SchemeLockedError,
  type Actor,
  verifyPayment,
} from './finance';

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
const accountLead = (): Actor => ({
  employeeId: 'ZZ-ACCLEAD', divisi: 'Account',
  role: permission.makeRole({ division: 'Account', level: 'lead' }),
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

describe('canManageScheme / canApproveSchemeChange / canVoteBermasalah', () => {
  it('FILING a scheme change needs SPV/Head Finance or Director (not staff)', () => {
    expect(canManageScheme(financeLead())).toBe(true);
    expect(canManageScheme(director())).toBe(true);
    expect(canManageScheme(financeStaff())).toBe(false);
    expect(canManageScheme(budi())).toBe(false);
  });

  it('ACTIONING one is Director-only — that is the whole point of M5-OA-7', () => {
    expect(canApproveSchemeChange(director())).toBe(true);
    // SPV Finance may file but may not approve: if this ever returns true the
    // Director gate the owner asked for has silently stopped existing.
    expect(canApproveSchemeChange(financeLead())).toBe(false);
    expect(canApproveSchemeChange(financeStaff())).toBe(false);
    expect(canApproveSchemeChange(accountLead())).toBe(false);
  });

  it('bermasalah vote needs SPV Finance / SPV Account / Director', () => {
    expect(canVoteBermasalah(financeLead())).toBe(true);
    expect(canVoteBermasalah(accountLead())).toBe(true);
    expect(canVoteBermasalah(director())).toBe(true);
    expect(canVoteBermasalah(financeStaff())).toBe(false); // staff, not SPV
    expect(canVoteBermasalah(budi())).toBe(false);
  });
});

describe('overdueLabel', () => {
  it('renders the §6 flow-2 BI prompt with the day count', () => {
    expect(overdueLabel(3)).toBe('[jatuh tempo 3 hari, segera tindak lanjuti]');
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
  await sql`delete from transaction_issue_approvals where created_by like 'ZZ-%'`;
  await sql`delete from transaction_change_requests where created_by like 'ZZ-%'`;
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

  it('accepts the contract link IN the verification, satisfying the [Lunas] gate', async () => {
    // The finance page now carries the contract field inside the verification
    // form, so the submit that trips the §7 Rule 2 gate is the one that can
    // satisfy it — no separate action, one DB transaction.
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const res = await verifyPayment(sql, financeStaff(), {
      transactionId, amount: '9000000', receivedDate: '2026-06-03',
      contractAttachment: 'https://drive/contract-inline.pdf',
    });
    expect(res.paymentStatus).toBe('[Lunas]');

    const row = await sql<{ contract_attachment: string | null }[]>`
      select contract_attachment from transactions where id = ${transactionId}`;
    expect(row[0].contract_attachment).toBe('https://drive/contract-inline.pdf');
    const audits = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'transaction' and entity_id = ${transactionId}`)
      .map((r) => r.action);
    expect(audits).toContain('contract_attached'); // §7 Rule 4: every attach is logged
  });

  it('rolls the contract link back with the verification it came with', async () => {
    // Atomicity is the reason this lives in the domain instead of two FE calls: an
    // over-verification must not leave the paperwork behind as a side effect.
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await expect(verifyPayment(sql, financeStaff(), {
      transactionId, amount: '9000001', receivedDate: '2026-06-03',
      contractAttachment: 'https://drive/should-not-persist.pdf',
    })).rejects.toBeInstanceOf(OverVerificationError);

    const row = await sql<{ contract_attachment: string | null }[]>`
      select contract_attachment from transactions where id = ${transactionId}`;
    expect(row[0].contract_attachment).toBeNull();
  });

  it('a partial payment leaves the transaction open with the shortfall derived', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_SEBAGIAN);
    const res = await verifyPayment(sql, financeStaff(), {
      transactionId, amount: '4000000', receivedDate: '2026-06-03',
    });
    expect(res.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    expect(money.parse(res.amountOutstanding)).toBe(money.parse('5000000'));
    expect(res.releasedToAccount).toBe(true); // §5: first money in still routes
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

  /**
   * A short payment against an installment used to mark it [Terverifikasi] in
   * full: the row left the schedule and the reminder dashboard while its money was
   * still missing, and only the transaction-level Amount Outstanding remembered.
   * That is the same disappearing-shortfall defect as the finance queue one, one
   * level down.
   */
  it('a short payment leaves its installment OPEN until the amount is covered', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, schedule);
    const res = await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: installmentIds[0], amount: '1000000', receivedDate: '2026-06-15',
    });
    expect(res.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    expect(money.parse(res.amountVerified)).toBe(money.parse('1000000'));

    const inst = await sql<{ status: string; verified_date: Date | null; verified_by: string | null }[]>`
      select status, verified_date, verified_by from installments where id = ${installmentIds[0]}`;
    expect(inst[0].status).toBe('[Belum Jatuh Tempo]');
    expect(inst[0].verified_date).toBeNull();
    expect(inst[0].verified_by).toBeNull();

    // Derived per-installment progress: Rp 1jt of Rp 3jt received.
    const view = await getPaymentStatus(sql, transactionId);
    expect(money.parse(view.installments[0].amountVerified)).toBe(money.parse('1000000'));

    // The remainder of the SAME installment settles it.
    await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: installmentIds[0], amount: '2000000', receivedDate: '2026-06-20',
    });
    const settled = await sql<{ status: string; verified_by: string | null }[]>`
      select status, verified_by from installments where id = ${installmentIds[0]}`;
    expect(settled[0].status).toBe('[Terverifikasi]');
    expect(settled[0].verified_by).toBe('ZZ-FIN');
  });

  it('keeps a short-paid overdue installment on the reminder dashboard', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, schedule);
    await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: installmentIds[0], amount: '1000000', receivedDate: '2026-06-15',
    });
    // Clock past installment 1's due date: it must still be chase-able.
    const dash = await reminderDashboard(sql, new Date('2026-06-20T05:00:00.000Z'));
    expect(dash.overdue.map((r) => r.installmentId)).toContain(installmentIds[0]);
  });

  it('a short payment does NOT let the transaction reach [Lunas]', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, schedule);
    await attachContract(sql, financeLead(), transactionId, 'https://drive/c.pdf');
    await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[0], amount: '3000000', receivedDate: '2026-06-15' });
    await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[1], amount: '3000000', receivedDate: '2026-07-15' });
    // Last installment short by Rp 1jt → still [Terverifikasi - Sebagian] (§4 Rule 3).
    const r3 = await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[2], amount: '2000000', receivedDate: '2026-08-15' });
    expect(r3.paymentStatus).toBe('[Terverifikasi - Sebagian]');
    expect(money.parse(r3.amountOutstanding)).toBe(money.parse('1000000'));

    const r4 = await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[2], amount: '1000000', receivedDate: '2026-08-20' });
    expect(r4.paymentStatus).toBe('[Lunas]');
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

describeDb('scanReminders + reminderDashboard (M5 §6 / §7)', () => {
  /**
   * Counts notifications for one recipient+event, scoped to the entities THIS
   * test created. Notifications can never be deleted (house rule #8), so
   * afterEach cannot clean them and an unscoped count keeps growing every time
   * the suite is re-run against the same database — the same reason audit
   * assertions must be pinned to their own entity_id. CI provisions a fresh DB
   * per run and never saw it; a local re-run failed with "expected 5 to be 2".
   */
  const notifCount = async (recipient: string, event: string, entityIds: string[]): Promise<number> =>
    (await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
      where recipient_employee_id = ${recipient} and event_type = ${event}
        and entity_id = any(${entityIds})`)[0].n;

  it('marks overdue installments [Jatuh Tempo], notifies once, and is idempotent', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '3000000', dueDate: '2026-06-01' },
      { amount: '3000000', dueDate: '2026-06-02' },
      { amount: '3000000', dueDate: '2026-09-01' },
    ]);
    const scanAt = new Date('2026-06-15T03:00:00Z');
    const s1 = await scanReminders(sql, scanAt);
    expect(s1.markedOverdue).toBe(2);
    expect(s1.overdueNotified).toBe(2);

    const inst = await sql<{ status: string; jatuh_tempo: boolean }[]>`
      select status, jatuh_tempo from installments where id = ${installmentIds[0]}`;
    expect(inst[0].status).toBe('[Jatuh Tempo]');
    expect(inst[0].jatuh_tempo).toBe(true);
    expect(await notifCount('ZZ-BUDI', 'm0m5.installment.due', installmentIds)).toBe(2); // Sales PIC notified

    // Re-running the scan is a no-op (fire-once + already transitioned).
    const s2 = await scanReminders(sql, scanAt);
    expect(s2.markedOverdue).toBe(0);
    expect(s2.overdueNotified).toBe(0);
    expect(await notifCount('ZZ-BUDI', 'm0m5.installment.due', installmentIds)).toBe(2);
    void transactionId;
  });

  it('fires an upcoming (H-3) reminder once, without changing status', async () => {
    const { installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '9000000', dueDate: '2026-06-17' },
    ]);
    const s = await scanReminders(sql, new Date('2026-06-15T03:00:00Z'));
    expect(s.upcomingNotified).toBe(1);
    expect(s.markedOverdue).toBe(0);
    const inst = await sql<{ status: string }[]>`select status from installments where id = ${installmentIds[0]}`;
    expect(inst[0].status).toBe('[Belum Jatuh Tempo]'); // upcoming, not overdue
  });

  it('raises the soft 7-day contract flag once and notifies Finance', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '3000000', dueDate: '2026-09-01' },
      { amount: '6000000', dueDate: '2026-10-01' },
    ]);
    // First verification routes to Account; back-date the release so it is > 7 days old.
    await verifyPayment(sql, financeStaff(), { transactionId, installmentId: installmentIds[0], amount: '3000000', receivedDate: '2026-06-15' });
    await sql`update transactions set released_to_account_at = '2026-06-01' where id = ${transactionId}`;

    const s = await scanReminders(sql, new Date('2026-06-15T03:00:00Z'));
    expect(s.contractFlagged).toBe(1);
    const trx = await sql<{ contract_overdue_flagged_at: Date | null }[]>`
      select contract_overdue_flagged_at from transactions where id = ${transactionId}`;
    expect(trx[0].contract_overdue_flagged_at).not.toBeNull();

    const again = await scanReminders(sql, new Date('2026-06-16T03:00:00Z'));
    expect(again.contractFlagged).toBe(0); // fire-once
  });

  it('reminderDashboard lists overdue-first with a day label + open-ended remainders', async () => {
    await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '3000000', dueDate: '2026-06-01' },
      { amount: '3000000', dueDate: '2026-06-10' },
      { amount: '3000000', dueDate: '2026-12-01' },
    ]);
    const dash = await reminderDashboard(sql, new Date('2026-06-15T03:00:00Z'));
    const mine = dash.overdue.filter((r) => r.toko === 'Alpha Digital');
    expect(mine.length).toBe(2);
    expect(mine[0].daysOverdue).toBeGreaterThanOrEqual(mine[1].daysOverdue); // most overdue first
    expect(mine[0].label).toContain('segera tindak lanjuti');

    // A Bayar Sebagian remainder shows on the no-due list, not the overdue list.
    const partial = await closedDeal(sales.PAYMENT_SCHEME_SEBAGIAN);
    await verifyPayment(sql, financeStaff(), { transactionId: partial.transactionId, amount: '4000000', receivedDate: '2026-06-15' });
    const dash2 = await reminderDashboard(sql, new Date('2026-06-15T03:00:00Z'));
    const open = dash2.outstandingNoDueDate.find((r) => r.transactionId === partial.transactionId);
    expect(open).toBeDefined();
    expect(money.parse(open!.amountOutstanding)).toBe(money.parse('5000000'));
  });
});

describeDb('[Bermasalah] flag + joint resolution (M5-OA-5)', () => {
  async function flaggedLunas(): Promise<string> {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await attachContract(sql, financeStaff(), transactionId, 'https://drive/c.pdf');
    await verifyPayment(sql, financeStaff(), { transactionId, amount: '9000000', receivedDate: '2026-06-03' });
    await flagBermasalah(sql, financeStaff(), transactionId, 'pembayaran di-reverse bank');
    return transactionId;
  }

  it('requires a reason and Finance authority to flag', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await expect(flagBermasalah(sql, financeStaff(), transactionId, '  ')).rejects.toBeInstanceOf(IncompleteError);
    await expect(flagBermasalah(sql, budi(), transactionId, 'x')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('resolves only when BOTH SPV divisions approve', async () => {
    const transactionId = await flaggedLunas();
    await expect(resolveBermasalah(sql, financeStaff(), transactionId, 'approve')).rejects.toBeInstanceOf(ForbiddenError);

    const r1 = await resolveBermasalah(sql, financeLead(), transactionId, 'approve');
    expect(r1.resolved).toBe(false);
    const r2 = await resolveBermasalah(sql, accountLead(), transactionId, 'approve');
    expect(r2.resolved).toBe(true);

    const trx = await sql<{ bermasalah: boolean }[]>`select bermasalah from transactions where id = ${transactionId}`;
    expect(trx[0].bermasalah).toBe(false);
  });

  it('a Director approval resolves unilaterally', async () => {
    const transactionId = await flaggedLunas();
    const r = await resolveBermasalah(sql, director(), transactionId, 'approve');
    expect(r.resolved).toBe(true);
  });

  it('rejects a vote on a transaction that is not flagged', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await expect(resolveBermasalah(sql, financeLead(), transactionId, 'approve')).rejects.toBeInstanceOf(IncompleteError);
  });
});

// ---------------------------------------------------------------------------
// Transaction change: filed by SPV/Head Finance, actioned by the Director
// (M5-OA-7, owner decision 2026-08-04 — see docs/DECISIONS.md).
//
// Two rules under test here were DELIBERATELY REVERSED from the old
// `changeScheme`: (a) SPV Finance no longer applies a change by itself, and
// (b) a verified payment no longer freezes the scheme. Both directions are
// asserted, so a regression to the old behaviour fails loudly rather than
// quietly re-locking the door the owner asked to open.
// ---------------------------------------------------------------------------
describeDb('scheme change: file → Director ACC (M5-OA-7)', () => {
  it('a Finance SPV filing waits for the Director — the transaction does not move', async () => {
    const { transactionId, clientId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_TERMIN,
      reason: 'klien minta cicilan',
      schedule: [
        { amount: '3000000', dueDate: '2026-08-01' },
        { amount: '3000000', dueDate: '2026-09-01' },
        { amount: '3000000', dueDate: '2026-10-01' },
      ],
    });
    expect(req.id).toMatch(/^TCR-\d{6}-\d{4}$/);
    expect(req.status).toBe(CHANGE_PENDING);

    const trx = await sql<{ payment_intent_scheme: string }[]>`
      select payment_intent_scheme from transactions where id = ${transactionId}`;
    expect(trx[0].payment_intent_scheme).toBe(sales.PAYMENT_SCHEME_LUNAS);
    const insts = await sql<{ n: number }[]>`
      select count(*)::int as n from installments where transaction_id = ${transactionId}`;
    expect(insts[0].n).toBe(0);
    const client = await sql<{ payment_intent: string }[]>`select payment_intent from clients where id = ${clientId}`;
    expect(client[0].payment_intent).toBe(sales.PAYMENT_SCHEME_LUNAS);
  });

  it('the Director ACC is what applies it (scheme + schedule + client intent)', async () => {
    const { transactionId, clientId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_TERMIN,
      reason: 'klien minta cicilan',
      schedule: [
        { amount: '4000000', dueDate: '2026-08-01' },
        { amount: '5000000', dueDate: '2026-09-01' },
      ],
    });
    const approved = await approveSchemeChange(sql, director(), req.id, 'disetujui');
    expect(approved.status).toBe(CHANGE_APPROVED);
    expect(approved.resolvedBy).toBe('ZZ-DIR');

    const trx = await sql<{ payment_intent_scheme: string }[]>`
      select payment_intent_scheme from transactions where id = ${transactionId}`;
    expect(trx[0].payment_intent_scheme).toBe(sales.PAYMENT_SCHEME_TERMIN);
    const insts = await sql<{ installment_no: number; amount: string }[]>`
      select installment_no, amount from installments where transaction_id = ${transactionId} order by installment_no`;
    expect(insts.map((i) => i.installment_no)).toEqual([1, 2]);
    const client = await sql<{ payment_intent: string }[]>`select payment_intent from clients where id = ${clientId}`;
    expect(client[0].payment_intent).toBe(sales.PAYMENT_SCHEME_TERMIN);
  });

  it('a Director filing applies on the spot (they are the approving authority)', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const req = await requestSchemeChange(sql, director(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'klien bayar sebagian dulu',
    });
    expect(req.status).toBe(CHANGE_APPROVED);
    const trx = await sql<{ payment_intent_scheme: string }[]>`
      select payment_intent_scheme from transactions where id = ${transactionId}`;
    expect(trx[0].payment_intent_scheme).toBe(sales.PAYMENT_SCHEME_SEBAGIAN);
  });

  // THE REVISED RULE. The old implementation threw SchemeLockedError here.
  it('WORKS MID-FLIGHT: verified money no longer freezes the scheme', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '4500000', dueDate: '2026-08-01' },
      { amount: '4500000', dueDate: '2026-09-01' },
    ]);
    await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: installmentIds[0], amount: '4500000', receivedDate: '2026-08-01',
    });
    // Outstanding is now Rp 4.500.000 — the replacement schedule reconciles
    // against THAT, not against the Rp 9.000.000 agreed total.
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_TERMIN, reason: 'klien pindah ke 3x cicilan sisa',
      schedule: [
        { amount: '1500000', dueDate: '2026-10-01' },
        { amount: '1500000', dueDate: '2026-11-01' },
        { amount: '1500000', dueDate: '2026-12-01' },
      ],
    });
    await approveSchemeChange(sql, director(), req.id);

    const insts = await sql<{ id: string; installment_no: number; amount: string; status: string }[]>`
      select id, installment_no, amount, status from installments
      where transaction_id = ${transactionId} order by installment_no`;
    // The VERIFIED installment survives untouched, keeps its number, and the
    // new rows continue the numbering (house rule #3 — no rewriting history).
    expect(insts).toHaveLength(4);
    expect(insts[0].id).toBe(installmentIds[0]);
    expect(insts[0].status).toBe(INST_TERVERIFIKASI);
    expect(insts.map((i) => i.installment_no)).toEqual([1, 3, 4, 5]);
    // Σ over the whole schedule is still the agreed total.
    const total = insts.reduce((acc, i) => acc + money.parse(i.amount), 0n);
    expect(money.decimal(total)).toBe('9000000.00');

    const view = await getPaymentStatus(sql, transactionId);
    expect(view.amountVerified).toBe('4500000.00');
    expect(view.amountOutstanding).toBe('4500000.00');
  });

  it('rejects a schedule that does not sum to Amount Outstanding', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '4500000', dueDate: '2026-08-01' },
      { amount: '4500000', dueDate: '2026-09-01' },
    ]);
    // Before any money: the outstanding IS the agreed total, so the mismatch is
    // reported against the total (existing verbatim string).
    await expect(requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_TERMIN, reason: 'x',
      schedule: [{ amount: '3000000', dueDate: '2026-08-01' }],
    })).rejects.toBeInstanceOf(ScheduleTotalError);

    await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: installmentIds[0], amount: '4500000', receivedDate: '2026-08-01',
    });
    // After money in, sending Finance to compare against the total would send
    // them to the wrong number — the message names the shortfall instead.
    await expect(requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_TERMIN, reason: 'x',
      schedule: [{ amount: '9000000', dueDate: '2026-10-01' }],
    })).rejects.toBeInstanceOf(OutstandingTotalError);
  });

  it('refuses a settled transaction — there is nothing left to reschedule', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await attachContract(sql, financeStaff(), transactionId, 'https://drive/contract.pdf');
    await verifyPayment(sql, financeStaff(), { transactionId, amount: '9000000', receivedDate: '2026-08-01' });
    await expect(requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_TERMIN, reason: 'x',
      schedule: [{ amount: '9000000', dueDate: '2026-10-01' }],
    })).rejects.toBeInstanceOf(SchemeLockedError);
  });

  it('allows only one pending filing per transaction', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'pertama',
    });
    await expect(requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'kedua',
    })).rejects.toBeInstanceOf(ChangePendingError);
  });

  it('a rejected filing leaves the transaction alone and cannot be decided twice', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'klien minta',
    });
    const rejected = await rejectSchemeChange(sql, director(), req.id, 'belum disetujui manajemen');
    expect(rejected.status).toBe(CHANGE_REJECTED);
    expect(rejected.decisionNote).toBe('belum disetujui manajemen');
    const trx = await sql<{ payment_intent_scheme: string }[]>`
      select payment_intent_scheme from transactions where id = ${transactionId}`;
    expect(trx[0].payment_intent_scheme).toBe(sales.PAYMENT_SCHEME_LUNAS);
    await expect(approveSchemeChange(sql, director(), req.id)).rejects.toBeInstanceOf(ChangeDecidedError);
  });

  it('only the requester (or a Director) may cancel a pending filing', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'klien minta',
    });
    const otherSpv: Actor = {
      employeeId: 'ZZ-FINLEAD2', divisi: 'Finance',
      role: permission.makeRole({ division: 'Finance', level: 'lead' }),
    };
    await expect(cancelSchemeChange(sql, otherSpv, req.id)).rejects.toBeInstanceOf(ForbiddenError);
    const cancelled = await cancelSchemeChange(sql, financeLead(), req.id);
    expect(cancelled.status).toBe(CHANGE_CANCELLED);
    // Cancelling frees the slot — the point of allowing it at all.
    const again = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'revisi',
    });
    expect(again.status).toBe(CHANGE_PENDING);
  });

  it('SPV Finance cannot approve, and Finance staff cannot even file', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    await expect(requestSchemeChange(sql, financeStaff(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'x',
    })).rejects.toBeInstanceOf(ForbiddenError);
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'x',
    });
    await expect(approveSchemeChange(sql, financeLead(), req.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rejectSchemeChange(sql, financeLead(), req.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('re-validates at ACC time: a payment landing while it waits blocks a stale filing', async () => {
    const { transactionId, installmentIds } = await closedDeal(sales.PAYMENT_SCHEME_TERMIN, [
      { amount: '4500000', dueDate: '2026-08-01' },
      { amount: '4500000', dueDate: '2026-09-01' },
    ]);
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_TERMIN, reason: 'jadwal ulang',
      schedule: [{ amount: '9000000', dueDate: '2026-10-01' }],
    });
    // Money arrives while the Director has not ruled yet: the filed schedule no
    // longer equals Amount Outstanding, so applying it would silently break
    // Σ schedule = Total Agreed Value.
    await verifyPayment(sql, financeStaff(), {
      transactionId, installmentId: installmentIds[0], amount: '4500000', receivedDate: '2026-08-01',
    });
    await expect(approveSchemeChange(sql, director(), req.id)).rejects.toBeInstanceOf(OutstandingTotalError);
    const still = await schemeChangeRequests(sql, { transactionId, status: '' });
    expect(still[0].status).toBe(CHANGE_PENDING); // left pending, not consumed
  });

  it('lists filings for the detail page and the Director ACC queue', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_SEBAGIAN, reason: 'klien minta',
    });
    const forTrx = await schemeChangeRequests(sql, { transactionId, status: '' });
    expect(forTrx).toHaveLength(1);
    expect(forTrx[0].id).toBe(req.id);
    expect(forTrx[0].toko).toBe('Alpha Digital');
    expect(forTrx[0].fromScheme).toBe(sales.PAYMENT_SCHEME_LUNAS);
    expect(forTrx[0].toScheme).toBe(sales.PAYMENT_SCHEME_SEBAGIAN);
    const queue = await schemeChangeRequests(sql); // default: pending only
    expect(queue.some((r) => r.id === req.id)).toBe(true);
  });

  it('audits the filing, the verdict and the application (house rule #3)', async () => {
    const { transactionId } = await closedDeal(sales.PAYMENT_SCHEME_LUNAS);
    const req = await requestSchemeChange(sql, financeLead(), transactionId, {
      newScheme: sales.PAYMENT_SCHEME_TERMIN, reason: 'klien minta cicilan',
      schedule: [{ amount: '9000000', dueDate: '2026-10-01' }],
    });
    await approveSchemeChange(sql, director(), req.id);
    const actions = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${transactionId} order by id`;
    const seen = actions.map((a) => a.action);
    expect(seen).toContain('scheme_change_requested');
    expect(seen).toContain('scheme_change_approved');
    expect(seen).toContain('scheme_changed');
  });
});
