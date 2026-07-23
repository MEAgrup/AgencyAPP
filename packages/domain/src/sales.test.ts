/**
 * Tests for the M0 sales Qualified-stage service.
 *
 * - Unit: the MSL v2 pricing calculator (all four modes + PPN), the commission
 *   rule grammar, and buildQuote (auto-calc + the 1..5 cap) — all pure money math.
 * - Integration (skipped unless DATABASE_URL is set): the MSL read + attempt
 *   progression + Qualified Form persistence against a migrated Postgres. Each
 *   test namespaces its ids with `ZZ-` and afterEach deletes the rows it made.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { leads } from './index.js';
import {
  acceptCounter,
  buildQuote,
  computeSubtotal,
  type Actor,
  CustomTermRequiresNegotiationError,
  DECISION_APPROVE,
  DECISION_REJECT,
  DECISION_REVISE,
  decideNegotiation,
  ForbiddenError,
  IncompleteError,
  markContacted,
  MSG_MAX_SERVICES,
  parseCommissionRule,
  previewQuote,
  type PriceParams,
  PRICING_BATCH_CEILING,
  PRICING_FLAT,
  PRICING_MIN_FLOOR,
  PRICING_PASSTHROUGH,
  type ProposalLine,
  resubmitNegotiation,
  type ServiceLine,
  setNotQualified,
  submitNegotiation,
  submitQualifiedForm,
  TooManyServicesError,
} from './sales.js';

const rp = (s: string): money.Money => money.parse(s);

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const andi = (): Actor => ({
  employeeId: 'ZZ-ANDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-SLEAD', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});

// ---------------------------------------------------------------------------
// Unit: pricing calculator.
// ---------------------------------------------------------------------------
describe('computeSubtotal', () => {
  const base = (over: Partial<PriceParams>): PriceParams => ({
    mode: PRICING_FLAT, unitPrice: rp('100000'), quantity: 1n, minQty: 0n,
    inputAmount: 0n, applyPPN: false, ...over,
  });

  it('flat: qty × unit_price', () => {
    expect(computeSubtotal(base({ quantity: 3n }))).toBe(rp('300000'));
  });

  it('min_floor: max(qty, min_qty) × unit_price', () => {
    expect(computeSubtotal(base({ mode: PRICING_MIN_FLOOR, quantity: 2n, minQty: 5n }))).toBe(rp('500000'));
    expect(computeSubtotal(base({ mode: PRICING_MIN_FLOOR, quantity: 7n, minQty: 5n }))).toBe(rp('700000'));
  });

  it('batch_ceiling: ceil(qty / min_qty) × min_qty × unit_price', () => {
    // qty 11, batch 5 -> 3 batches -> 15 units -> 1,500,000
    expect(computeSubtotal(base({ mode: PRICING_BATCH_CEILING, quantity: 11n, minQty: 5n }))).toBe(rp('1500000'));
  });

  it('passthrough: input_amount (unit price ignored)', () => {
    expect(computeSubtotal(base({ mode: PRICING_PASSTHROUGH, inputAmount: rp('777000') }))).toBe(rp('777000'));
  });

  it('apply_ppn adds 11% (half-up)', () => {
    // 1,000,000 + 11% = 1,110,000
    expect(computeSubtotal(base({ quantity: 10n, applyPPN: true }))).toBe(rp('1110000'));
  });

  it('rejects qty < 1, missing min_qty, non-positive passthrough, bad mode', () => {
    expect(() => computeSubtotal(base({ quantity: 0n }))).toThrow(IncompleteError);
    expect(() => computeSubtotal(base({ mode: PRICING_MIN_FLOOR, quantity: 2n, minQty: 0n }))).toThrow(IncompleteError);
    expect(() => computeSubtotal(base({ mode: PRICING_PASSTHROUGH, inputAmount: 0n }))).toThrow(IncompleteError);
    expect(() => computeSubtotal(base({ mode: 'weird' }))).toThrow(IncompleteError);
  });
});

// ---------------------------------------------------------------------------
// Unit: commission rule grammar.
// ---------------------------------------------------------------------------
describe('parseCommissionRule', () => {
  it('parses a percentage rule and computes on the deal value', () => {
    const r = parseCommissionRule('10% of standard price');
    expect(r.isFlat).toBe(false);
    expect(money.percentOf(rp('9000000'), r.pctNum, r.pctScale)).toBe(rp('900000'));
  });

  it('parses a fractional percentage (4.5%)', () => {
    const r = parseCommissionRule('4.5% of standard price');
    expect(r.pctNum).toBe(45n);
    expect(r.pctScale).toBe(1);
  });

  it('parses a flat rule with thousands separators', () => {
    const r = parseCommissionRule('flat Rp 500.000');
    expect(r.isFlat).toBe(true);
    expect(r.flat).toBe(rp('500000'));
  });

  it('rejects an unrecognized rule', () => {
    expect(() => parseCommissionRule('half of the deal')).toThrow(/unrecognized/);
  });
});

// ---------------------------------------------------------------------------
// Unit: buildQuote (auto-calc + caps).
// ---------------------------------------------------------------------------
describe('buildQuote', () => {
  const line = (id: string, price: string, rule: string): ServiceLine => ({
    serviceId: id, versionNo: 1, name: id, standardPrice: rp(price), unit: '',
    mode: PRICING_FLAT, quantity: 1n, minQty: 0n, inputAmount: 0n, applyPPN: false,
    rule: parseCommissionRule(rule),
  });

  it('sums Estimasi Nilai + Komisi across lines (M0 §4 example)', () => {
    const q = buildQuote([
      line('SVC-1', '9000000', '10% of standard price'),
      line('SVC-2', '6000000', '10% of standard price'),
      line('SVC-3', '6900000', '10% of standard price'),
    ]);
    expect(q.estimasiNilaiIdr).toBe('Rp. 21.900.000,00');
    expect(q.totalKomisiIdr).toBe('Rp. 2.190.000,00');
    expect(q.lines).toHaveLength(3);
  });

  it('rejects an empty selection and enforces the 1..5 cap (verbatim BI)', () => {
    expect(() => buildQuote([])).toThrow(IncompleteError);
    const six = Array.from({ length: 6 }, (_, i) => line(`SVC-${i}`, '100000', 'flat Rp 10.000'));
    expect(() => buildQuote(six)).toThrow(TooManyServicesError);
    expect(() => buildQuote(six)).toThrow(MSG_MAX_SERVICES);
  });
});

// ---------------------------------------------------------------------------
// Unit: negotiation input gates (no DB).
// ---------------------------------------------------------------------------
describe('negotiation gates (no DB)', () => {
  const noSql = null as unknown as Sql;

  it('submitNegotiation rejects no-nego carrying custom lines', async () => {
    const lines: ProposalLine[] = [{ masterServiceId: 'SVC-1', proposedPrice: '1', commissionRule: 'flat Rp 1' }];
    await expect(submitNegotiation(noSql, budi(), 'PRSP-x', lines, true))
      .rejects.toBeInstanceOf(CustomTermRequiresNegotiationError);
  });

  it('submitNegotiation rejects a custom submission with no lines', async () => {
    await expect(submitNegotiation(noSql, budi(), 'PRSP-x', [], false)).rejects.toBeInstanceOf(IncompleteError);
  });

  it('decideNegotiation rejects an unknown decision and a note-less revise/reject', async () => {
    await expect(decideNegotiation(noSql, salesLead(), 'PRSP-x', 'maybe')).rejects.toBeInstanceOf(IncompleteError);
    await expect(decideNegotiation(noSql, salesLead(), 'PRSP-x', DECISION_REVISE, '')).rejects.toBeInstanceOf(IncompleteError);
    await expect(decideNegotiation(noSql, salesLead(), 'PRSP-x', DECISION_REJECT, '  ')).rejects.toBeInstanceOf(IncompleteError);
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
const uniquePhone = (): string => `0813${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;

/** Seed one flat MSL service (10% commission) and return its master id. */
async function seedService(id: string, price = '9000000.00', rule = '10% of standard price'): Promise<string> {
  await sql`insert into master_services (id, created_by) values (${id}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${id}, 1, ${'Svc ' + id}, ${price}, ${rule}, true, '2020-01-01', 'flat', 'ZZ-ADMIN')`;
  return id;
}

/** Register a lead and advance its attempt to Contacted, returning attempt id. */
async function contactedAttempt(actor: Actor): Promise<string> {
  const { attempt } = await leads.register(sql, actor, { leadName: 'Alpha Digital', phoneNumber: uniquePhone() });
  await markContacted(sql, actor, attempt.id);
  return attempt.id;
}

/** Reach a Qualified attempt for `actor` with one seeded flat service. */
async function qualifiedAttempt(actor: Actor, svc: string): Promise<string> {
  const attemptId = await contactedAttempt(actor);
  await submitQualifiedForm(sql, actor, attemptId, {
    namaPic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta', linkToko: 'https://shopee/alpha',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [{ masterServiceId: svc, quantity: 1 }],
  });
  return attemptId;
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
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

describeDb('previewQuote', () => {
  it('quotes an MSL selection without persisting', async () => {
    const svc = await seedService('SVC-ZZ-PREVIEW');
    const q = await previewQuote(sql, [{ masterServiceId: svc, quantity: 1 }]);
    expect(q.estimasiNilaiIdr).toBe('Rp. 9.000.000,00');
    expect(q.totalKomisiIdr).toBe('Rp. 900.000,00');
    const forms = await sql<{ n: number }[]>`select count(*)::int as n from qualified_forms`;
    expect(forms[0].n).toBe(0);
  });
});

describeDb('markContacted', () => {
  it('advances New Lead -> Contacted for the owner', async () => {
    const { attempt } = await leads.register(sql, budi(), { leadName: 'ABC', phoneNumber: uniquePhone() });
    const res = await markContacted(sql, budi(), attempt.id);
    expect(res.ok).toBe(true);
    const row = await sql<{ status: string }[]>`select status from prospect_attempts where id = ${attempt.id}`;
    expect(row[0].status).toBe('Contacted');
  });

  it('denies a non-owner staff (ForbiddenError)', async () => {
    const { attempt } = await leads.register(sql, budi(), { leadName: 'ABC', phoneNumber: uniquePhone() });
    await expect(markContacted(sql, andi(), attempt.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('submitQualifiedForm', () => {
  it('pins MSL lines, persists the form + subtotal, and moves to Qualified', async () => {
    const svc = await seedService('SVC-ZZ-QF');
    const attemptId = await contactedAttempt(budi());
    const res = await submitQualifiedForm(sql, budi(), attemptId, {
      namaPic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta', linkToko: 'https://shopee/alpha',
      kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
      services: [{ masterServiceId: svc, quantity: 1 }],
    });
    expect(res.ok).toBe(true);

    const attempt = await sql<{ status: string }[]>`select status from prospect_attempts where id = ${attemptId}`;
    expect(attempt[0].status).toBe('Qualified');

    const form = await sql<{ toko: string }[]>`select toko from qualified_forms where attempt_id = ${attemptId}`;
    expect(form[0].toko).toBe('Alpha Digital');

    const svcRow = await sql<{ subtotal: string; commission_rule: string; master_version_no: number }[]>`
      select subtotal, commission_rule, master_version_no from qualified_form_services where attempt_id = ${attemptId}`;
    expect(svcRow[0].master_version_no).toBe(1);
    // Subtotal pinned as the recomputable deal value (Rp. 9.000.000,00).
    expect(money.parse(svcRow[0].subtotal)).toBe(rp('9000000'));

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_id = ${attemptId} and action = 'qualified_form_submit'`;
    expect(audit[0].n).toBe(1);
  });

  it('rejects > 5 services (verbatim BI) without persisting', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await seedService(`SVC-ZZ-CAP-${i}`));
    const attemptId = await contactedAttempt(budi());
    await expect(
      submitQualifiedForm(sql, budi(), attemptId, {
        namaPic: 'x', toko: 'x', kota: 'x', linkToko: 'x', kategori: 'x', platform: 'x',
        gmvBaseline: '1', targetGmv: '1', services: ids.map((id) => ({ masterServiceId: id, quantity: 1 })),
      }),
    ).rejects.toThrow(MSG_MAX_SERVICES);
    // Status unchanged; nothing persisted.
    const attempt = await sql<{ status: string }[]>`select status from prospect_attempts where id = ${attemptId}`;
    expect(attempt[0].status).toBe('Contacted');
    const form = await sql<{ n: number }[]>`select count(*)::int as n from qualified_forms where attempt_id = ${attemptId}`;
    expect(form[0].n).toBe(0);
  });

  it('rejects an incomplete client draft with the exact BI message', async () => {
    const svc = await seedService('SVC-ZZ-INC');
    const attemptId = await contactedAttempt(budi());
    await expect(
      submitQualifiedForm(sql, budi(), attemptId, {
        namaPic: '', toko: 'Alpha', kota: 'JKT', linkToko: 'x', kategori: 'x', platform: 'Shopee',
        gmvBaseline: '1', targetGmv: '1', services: [{ masterServiceId: svc, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(IncompleteError);
  });
});

describeDb('setNotQualified', () => {
  it('closes a Contacted attempt with a taxonomy reason', async () => {
    const attemptId = await contactedAttempt(budi());
    const res = await setNotQualified(sql, budi(), attemptId, ['[Tidak ada budget]']);
    expect(res.ok).toBe(true);
    const attempt = await sql<{ status: string }[]>`select status from prospect_attempts where id = ${attemptId}`;
    expect(attempt[0].status).toBe('Not Qualified');
    const reasons = await sql<{ reason: string }[]>`select reason from prospect_attempt_nq_reasons where attempt_id = ${attemptId}`;
    expect(reasons[0].reason).toBe('[Tidak ada budget]');
  });

  it('requires free text for [Lainnya ...] and stores it inline', async () => {
    const attemptId = await contactedAttempt(budi());
    await expect(setNotQualified(sql, budi(), attemptId, ['[Lainnya ...]'], '   '))
      .rejects.toBeInstanceOf(IncompleteError);
    const res = await setNotQualified(sql, budi(), attemptId, ['[Lainnya ...]'], 'pindah kota');
    expect(res.ok).toBe(true);
    const reasons = await sql<{ reason: string }[]>`select reason from prospect_attempt_nq_reasons where attempt_id = ${attemptId}`;
    expect(reasons[0].reason).toBe('[Lainnya ...] pindah kota');
  });
});

describeDb('negotiation', () => {
  const status = async (attemptId: string): Promise<string> =>
    (await sql<{ status: string }[]>`select status from prospect_attempts where id = ${attemptId}`)[0].status;

  it('no-negotiation takes standard terms to Auto Approved (proposal from qualified subtotal)', async () => {
    const svc = await seedService('SVC-ZZ-NONEGO');
    const attemptId = await qualifiedAttempt(budi(), svc);
    const res = await submitNegotiation(sql, budi(), attemptId, [], true);
    expect(res.ok).toBe(true);
    expect(await status(attemptId)).toBe('Negotiation - Auto Approved');

    const prop = await sql<{ id: string; version_no: number }[]>`
      select id, version_no from negotiation_proposals where attempt_id = ${attemptId}`;
    expect(prop[0].version_no).toBe(1);
    const line = await sql<{ proposed_price: string }[]>`
      select proposed_price from negotiation_proposal_lines where proposal_id = ${prop[0].id}`;
    // Standard proposed price = the pinned deal value (Rp. 9.000.000,00).
    expect(money.parse(line[0].proposed_price)).toBe(money.parse('9000000'));
  });

  it('custom negotiation routes to Pending Approval, then a superior approves', async () => {
    const svc = await seedService('SVC-ZZ-NEGO');
    const attemptId = await qualifiedAttempt(budi(), svc);
    const lines: ProposalLine[] = [{ masterServiceId: svc, proposedPrice: '8000000', commissionRule: '10% of standard price', paymentTerms: 'Termin 3x' }];
    const submitted = await submitNegotiation(sql, budi(), attemptId, lines, false);
    expect(submitted.ok).toBe(true);
    expect(await status(attemptId)).toBe('Negotiation - Pending Approval');

    const decided = await decideNegotiation(sql, salesLead(), attemptId, DECISION_APPROVE);
    expect(decided.ok).toBe(true);
    expect(await status(attemptId)).toBe('Negotiation - Approved');

    // The owner (Budi) was notified of the decision (explicit recipient).
    const notif = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
      where recipient_employee_id = 'ZZ-BUDI' and entity_id = ${attemptId}
        and event_type = 'm0.negotiation.decision'`;
    expect(notif[0].n).toBe(1);
  });

  it('a non-superior cannot decide (role_denied, nothing written)', async () => {
    const svc = await seedService('SVC-ZZ-NEGODENY');
    const attemptId = await qualifiedAttempt(budi(), svc);
    await submitNegotiation(sql, budi(), attemptId, [
      { masterServiceId: svc, proposedPrice: '8000000', commissionRule: '10% of standard price' },
    ], false);
    const denied = await decideNegotiation(sql, budi(), attemptId, DECISION_APPROVE);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('role_denied');
    expect(await status(attemptId)).toBe('Negotiation - Pending Approval');
  });

  it('revise → salesperson resubmits a new version → Pending Approval again', async () => {
    const svc = await seedService('SVC-ZZ-REVISE');
    const attemptId = await qualifiedAttempt(budi(), svc);
    await submitNegotiation(sql, budi(), attemptId, [
      { masterServiceId: svc, proposedPrice: '8000000', commissionRule: '10% of standard price' },
    ], false);
    const revised = await decideNegotiation(sql, salesLead(), attemptId, DECISION_REVISE, 'harga terlalu rendah');
    expect(revised.ok).toBe(true);
    expect(await status(attemptId)).toBe('Negotiation - Revision Required');

    const resub = await resubmitNegotiation(sql, budi(), attemptId, [
      { masterServiceId: svc, proposedPrice: '8500000', commissionRule: '10% of standard price' },
    ]);
    expect(resub.ok).toBe(true);
    expect(await status(attemptId)).toBe('Negotiation - Pending Approval');
    const versions = await sql<{ n: number }[]>`
      select count(*)::int as n from negotiation_proposals where attempt_id = ${attemptId}`;
    expect(versions[0].n).toBe(2);
  });

  it('revise → salesperson accepts the counter → Approved', async () => {
    const svc = await seedService('SVC-ZZ-ACCEPT');
    const attemptId = await qualifiedAttempt(budi(), svc);
    await submitNegotiation(sql, budi(), attemptId, [
      { masterServiceId: svc, proposedPrice: '8000000', commissionRule: '10% of standard price' },
    ], false);
    await decideNegotiation(sql, salesLead(), attemptId, DECISION_REVISE, 'counter: 8.5jt');
    const accepted = await acceptCounter(sql, budi(), attemptId);
    expect(accepted.ok).toBe(true);
    expect(await status(attemptId)).toBe('Negotiation - Approved');
  });
});
