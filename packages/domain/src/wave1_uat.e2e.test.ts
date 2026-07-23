/**
 * Wave 1 EXIT — automated end-to-end UAT harness (agent dry-run).
 *
 * Drives ONE real deal through the entire money-path (M1 → M0 → M4 → M5) against a
 * migrated Postgres, mirroring docs/handoff/WAVE1_EXIT_UAT_RUNBOOK.md step-by-step.
 * Each step records actor / action / verified-outcome (status, verbatim BI, audit).
 * It is NOT a substitute for the human pilot gate (real Sales+Finance on a deployed
 * UI, manual commission spot-check, go/no-go) — it proves the code paths the pilots
 * will exercise, so any defect surfaces before they sit down.
 *
 * Gated behind UAT=1 (and DATABASE_URL) so the default `npm test` / CI suite skips
 * it: it drives the GLOBAL reminder scan + notifications, which would perturb
 * finance.test.ts's global idempotency assertions if run in the same process.
 * Namespaces ids with `ZZ-` and cleans up.
 *
 * Run on demand:  UAT=1 DATABASE_URL=... npm run uat:wave1   (in packages/domain)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { leads } from './index.js';
import {
  close, getClient, markContacted, previewQuote, submitNegotiation, submitQualifiedForm,
  decideNegotiation, DECISION_APPROVE, PAYMENT_SCHEME_TERMIN, validateParties, AllocationTotalError,
  type Actor,
} from './sales.js';
import {
  verifyPayment, attachContract, getPaymentStatus, commissionAchievement, scanReminders,
  reminderDashboard, changeScheme,
  OverVerificationError, ContractRequiredError, ScheduleTotalError, SchemeLockedError,
  PAYMENT_SEBAGIAN, PAYMENT_LUNAS, INST_JATUH_TEMPO, INST_TERVERIFIKASI,
  MSG_OVER_VERIFICATION, MSG_CONTRACT_REQUIRED, MSG_SCHEDULE_TOTAL,
} from './finance.js';
import {
  updateClient, addPlatform, updatePlatform, voidService,
  ForbiddenError as ClientForbidden, LockedFieldError, SERVICE_VOIDED,
  MSG_FIELD_ROLE_DENIED, MSG_FIELD_LOCKED,
} from './client.js';

const URL = process.env.DATABASE_URL;
const RUN = !!URL && process.env.UAT === '1';
const describeDb = describe.skipIf(!RUN);
let sql: Sql;
if (RUN) sql = createClient(URL!);

// --- Actors (one account per pilot role) --------------------------------------
const budi = (): Actor => ({ employeeId: 'ZZ-BUDI', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
const andi = (): Actor => ({ employeeId: 'ZZ-ANDI', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
const salesLead = (): Actor => ({ employeeId: 'ZZ-SLEAD', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'lead' }) });
const finance = (): Actor => ({ employeeId: 'ZZ-FIN', divisi: 'Finance', role: permission.makeRole({ division: 'Finance', level: 'staff' }) });
const financeLead = (): Actor => ({ employeeId: 'ZZ-FINSPV', divisi: 'Finance', role: permission.makeRole({ division: 'Finance', level: 'lead' }) });
const accountLead = (): Actor => ({ employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });

const rp = (s: string): bigint => money.parse(s);
const fmt = (s: string): string => money.format(money.parse(s));

// --- Step recorder (never throws mid-run; asserts zero failures at the end) ----
type Row = { step: string; actor: string; ok: boolean; detail: string };
const rows: Row[] = [];
function pass(step: string, actor: string, detail: string) { rows.push({ step, actor, ok: true, detail }); }
function fail(step: string, actor: string, detail: string) { rows.push({ step, actor, ok: false, detail }); }
async function expectThrow(step: string, actor: string, want: string, fn: () => Promise<unknown>) {
  try { await fn(); fail(step, actor, `expected error containing "${want}" but call succeeded`); }
  catch (e) { const m = (e as Error).message ?? String(e); m.includes(want) ? pass(step, actor, `blocked: ${m}`) : fail(step, actor, `wrong error: ${m}`); }
}

async function seedService(id: string, price: string): Promise<string> {
  await sql`insert into master_services (id, created_by) values (${id}, 'ZZ-ADMIN')`;
  await sql`insert into master_service_versions
    (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${id}, 1, ${'Svc ' + id}, ${price}, '10% of standard price', true, '2020-01-01', 'flat', 'ZZ-ADMIN')`;
  return id;
}

async function cleanup() {
  if (!sql) return;
  // NB: notifications + audit_log are append-only (house rule #3/#8) — never
  // deletable. This harness therefore MUST run against a fresh/dedicated migrated
  // DB (the runbook prescribes this); it is env-gated (UAT=1) out of the default
  // suite so it never pollutes finance.test's global reminder-count assertions.
  await sql`delete from transaction_issue_approvals where created_by like 'ZZ-%'`.catch(() => {});
  await sql`delete from payment_verifications where created_by like 'ZZ-%'`.catch(() => {});
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
  await sql`delete from prospect_attempt_nq_reasons where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
}

let seq = 0;
const phone = (): string => `0813${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;

describeDb('Wave 1 exit — end-to-end money-path UAT', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    if (sql) await sql.end();
  });

  it('drives one deal register → closing → verification → commission, per the runbook', async () => {
    // === Setup: MSL (M0 §4 worked example — 3 services @10% → 21.900.000 / komisi 2.190.000)
    const s1 = await seedService('SVC-ZZ-UAT1', '9000000.00');
    const s2 = await seedService('SVC-ZZ-UAT2', '6000000.00');
    const s3 = await seedService('SVC-ZZ-UAT3', '6900000.00');

    // === B1 — register the deal lead (Sales Staff)
    const dealPhone = phone();
    const reg = await leads.register(sql, budi(), { leadName: 'Alpha Digital UAT', phoneNumber: dealPhone });
    /^LEAD-\d{6}-\d{4}$/.test(reg.lead.id) && reg.attempt.status === 'New Lead'
      ? pass('B1 register lead', 'Sales Budi', `${reg.lead.id} + ${reg.attempt.id} (New Lead)`)
      : fail('B1 register lead', 'Sales Budi', JSON.stringify(reg));
    await expectThrow('B1 duplicate register blocked', 'Sales Budi', '', () =>
      leads.register(sql, budi(), { leadName: 'dup', phoneNumber: dealPhone }));

    // === B2 — Marketing-pool claim (separate pooled lead)
    const pooledReg = await leads.register(sql, andi(), { leadName: 'Pooled Co', phoneNumber: phone() });
    await sql`update prospect_attempts set status = 'Not Qualified' where id = ${pooledReg.attempt.id}`;
    await sql`update leads set record_status = '[Pool]' where id = ${pooledReg.lead.id}`;
    const claimed = await leads.claim(sql, budi(), pooledReg.lead.id);
    const claimAudit = await sql<{ n: number }[]>`select count(*)::int n from audit_log where entity_id = ${pooledReg.lead.id} and action = 'claim'`;
    claimed.attempt.status === 'New Lead' && claimAudit[0].n === 1
      ? pass('B2 claim pool lead', 'Sales Budi', `${claimed.attempt.id} New Lead, audit claim x${claimAudit[0].n}`)
      : fail('B2 claim pool lead', 'Sales Budi', JSON.stringify(claimed));

    // === B3 — New Lead → Contacted; non-owner denied
    await markContacted(sql, budi(), reg.attempt.id);
    const st = (await sql<{ status: string }[]>`select status from prospect_attempts where id = ${reg.attempt.id}`)[0].status;
    st === 'Contacted' ? pass('B3 New Lead → Contacted', 'Sales Budi', st) : fail('B3', 'Sales Budi', st);
    await expectThrow('B3 non-owner transition denied', 'Sales Andi', '', () => markContacted(sql, andi(), reg.attempt.id));

    // === B4 — Qualified Form (3 services)
    await submitQualifiedForm(sql, budi(), reg.attempt.id, {
      namaPic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta', linkToko: 'https://shopee/alpha',
      kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
      services: [{ masterServiceId: s1, quantity: 1 }, { masterServiceId: s2, quantity: 1 }, { masterServiceId: s3, quantity: 1 }],
    });
    const qst = (await sql<{ status: string }[]>`select status from prospect_attempts where id = ${reg.attempt.id}`)[0].status;
    qst === 'Qualified' ? pass('B4 Qualified Form', 'Sales Budi', qst) : fail('B4', 'Sales Budi', qst);

    // === B5 — commission cross-check vs MSL (auto-calc = MSL preview)
    const q = await previewQuote(sql, [{ masterServiceId: s1, quantity: 1 }, { masterServiceId: s2, quantity: 1 }, { masterServiceId: s3, quantity: 1 }]);
    q.estimasiNilaiIdr === 'Rp. 21.900.000,00' && q.totalKomisiIdr === 'Rp. 2.190.000,00'
      ? pass('B5 commission cross-check vs MSL', 'Sales Head', `Estimasi ${q.estimasiNilaiIdr}, Komisi ${q.totalKomisiIdr}`)
      : fail('B5 commission cross-check vs MSL', 'Sales Head', `${q.estimasiNilaiIdr} / ${q.totalKomisiIdr}`);

    // === B6 — custom negotiation → SPV approval (separate attempt)
    const negReg = await leads.register(sql, budi(), { leadName: 'Nego Co', phoneNumber: phone() });
    await markContacted(sql, budi(), negReg.attempt.id);
    await submitQualifiedForm(sql, budi(), negReg.attempt.id, {
      namaPic: 'x', toko: 'Nego Co', kota: 'JKT', linkToko: 'https://x', kategori: 'x', platform: 'Shopee',
      gmvBaseline: '1000000', targetGmv: '2000000', services: [{ masterServiceId: s1, quantity: 1 }],
    });
    await submitNegotiation(sql, budi(), negReg.attempt.id, [{ masterServiceId: s1, proposedPrice: '8000000', commissionRule: '10% of standard price', paymentTerms: 'Termin 2x' }], false);
    const pend = (await sql<{ status: string }[]>`select status from prospect_attempts where id = ${negReg.attempt.id}`)[0].status;
    await decideNegotiation(sql, salesLead(), negReg.attempt.id, DECISION_APPROVE);
    const appr = (await sql<{ status: string }[]>`select status from prospect_attempts where id = ${negReg.attempt.id}`)[0].status;
    pend === 'Negotiation - Pending Approval' && appr === 'Negotiation - Approved'
      ? pass('B6 custom nego + SPV approval', 'Sales Budi + Sales Lead', `${pend} → ${appr}`)
      : fail('B6', 'Sales', `${pend} → ${appr}`);

    // === B7 — close (Termin): atomic CLI/TRX/SVC/INST; Σ≠100% blocked
    await submitNegotiation(sql, budi(), reg.attempt.id, [], true); // standard terms → auto approved
    try { validateParties({ primarySalespersonId: 'ZZ-BUDI', allocations: [{ salespersonId: 'ZZ-BUDI', basisPoints: 6000 }, { salespersonId: 'ZZ-ANDI', basisPoints: 3000 }], commissionPaymentPicId: 'ZZ-ANDI' }); fail('B7 Σ≠100% blocked', 'Sales Budi', 'not blocked'); }
    catch (e) { pass('B7 Σ≠100% blocked', 'Sales Budi', e instanceof AllocationTotalError ? '[total alokasi sales harus 100%]' : (e as Error).message); }
    const closed = await close(sql, budi(), reg.attempt.id, {
      parties: { primarySalespersonId: 'ZZ-BUDI', allocations: [{ salespersonId: 'ZZ-BUDI', basisPoints: 10000 }] },
      paymentScheme: PAYMENT_SCHEME_TERMIN,
      installments: [{ amount: '10000000', dueDate: '2026-07-01' }, { amount: '11900000', dueDate: '2026-12-01' }],
    });
    const clientId = closed.clientId, trxId = closed.transactionId;
    /^CLI-\d{6}-\d{4}$/.test(clientId) && /^TRX-\d{6}-\d{4}$/.test(trxId)
      ? pass('B7 closing atomic', 'Sales Budi', `${clientId} / ${trxId} / 2 INST`)
      : fail('B7 closing atomic', 'Sales Budi', JSON.stringify(closed));

    // === C1 — Client Record provenance (pre-verification)
    const rec = await getClient(sql, clientId);
    rec.toko === 'Alpha Digital' && rec.services.length === 3 && rec.transaction?.paymentStatus === '[Menunggu Verifikasi]'
      && rec.transaction?.installments.length === 2 && rec.allocations[0].basisPoints === 10000
      ? pass('C1 client provenance', 'all roles (read)', `toko, Σ=10000, 3 SVC, TRX [Menunggu Verifikasi], 2 INST`)
      : fail('C1 client provenance', 'read', JSON.stringify({ toko: rec.toko, svc: rec.services.length, ps: rec.transaction?.paymentStatus }));

    // === C2 — lock matrix
    await updateClient(sql, accountLead(), clientId, { toko: 'Alpha Digital (edited)' });
    const edited = (await sql<{ toko: string }[]>`select toko from clients where id = ${clientId}`)[0].toko;
    const auditEdit = await sql<{ n: number }[]>`select count(*)::int n from audit_log where entity_id = ${clientId} and action = 'client_field_edited'`;
    edited === 'Alpha Digital (edited)' && auditEdit[0].n >= 1
      ? pass('C2 lock matrix edit (Account Lead)', 'Account Lead', `toko edited, audit x${auditEdit[0].n}`)
      : fail('C2 lock matrix edit', 'Account Lead', `${edited} / audit ${auditEdit[0].n}`);
    await expectThrow('C2 role-denied field', 'Sales Budi', MSG_FIELD_ROLE_DENIED, () => updateClient(sql, budi(), clientId, { gmvBaseline: '999' }));
    await expectThrow('C2 locked/system field', 'Account Lead', MSG_FIELD_LOCKED, () => updateClient(sql, accountLead(), clientId, { transactionId: 'x' } as never));

    // === C3 — platform add + deactivate
    const pid = await addPlatform(sql, accountLead(), clientId, { platform: 'TikTok', storeLink: 'https://tt/alpha' });
    await updatePlatform(sql, accountLead(), clientId, pid, { active: false });
    const plats = await sql<{ platform: string; active: boolean }[]>`select platform, active from client_platforms where client_id = ${clientId} order by id`;
    plats.length === 2 && plats.some((p) => p.platform === 'TikTok' && p.active === false) && plats.some((p) => p.platform === 'Shopee')
      ? pass('C3 platform add/deactivate', 'Account Lead', `Shopee kept, TikTok active=false (no DELETE)`)
      : fail('C3 platform', 'Account Lead', JSON.stringify(plats));

    // === C4a — changeScheme wrong total (pre-verification guard)
    await expectThrow('C4 schedule-total guard', 'Finance SPV', MSG_SCHEDULE_TOTAL, () =>
      changeScheme(sql, financeLead(), trxId, PAYMENT_SCHEME_TERMIN, 'coba', [{ amount: '1', dueDate: '2026-08-01' }]));

    const p0 = await getPaymentStatus(sql, trxId);
    money.parse(p0.amountVerified) === 0n && money.parse(p0.amountOutstanding) === rp('21900000')
      ? pass('C4 initial payment status', 'Finance', `Verified ${fmt(p0.amountVerified)}, Outstanding ${fmt(p0.amountOutstanding)}`)
      : fail('C4 initial payment status', 'Finance', `${p0.amountVerified}/${p0.amountOutstanding}`);

    const inst = (await sql<{ id: string; installment_no: number }[]>`select id, installment_no from installments where transaction_id = ${trxId} order by installment_no`);
    const inst1 = inst[0].id, inst2 = inst[1].id;

    // === C9a — reminder scan while INST#1 is overdue + unverified
    const now = new Date('2026-07-23T00:00:00Z');
    await scanReminders(sql, now);
    const i1 = (await sql<{ status: string; jatuh_tempo: boolean }[]>`select status, jatuh_tempo from installments where id = ${inst1}`)[0];
    const dash = await reminderDashboard(sql, now);
    const over = dash.overdue.find((r) => r.installmentId === inst1);
    const labelOk = !!over && /^\[jatuh tempo \d+ hari, segera tindak lanjuti\]$/.test(over.label);
    i1.status === INST_JATUH_TEMPO && i1.jatuh_tempo === true && labelOk
      ? pass('C9 reminder → Jatuh Tempo', 'Finance/System', `${i1.status}, label "${over!.label}"`)
      : fail('C9 reminder', 'Finance', JSON.stringify({ st: i1.status, jt: i1.jatuh_tempo, label: over?.label }));

    // === C7 — over-verification blocked (no written trace)
    await expectThrow('C7 over-verification blocked', 'Finance', MSG_OVER_VERIFICATION, () =>
      verifyPayment(sql, finance(), { transactionId: trxId, installmentId: inst1, amount: '999999999', receivedDate: '2026-07-23' }));

    // === C5 — verify #1: INST [Terverifikasi], TRX [Terverifikasi - Sebagian], routing gate releases to Account
    const v1 = await verifyPayment(sql, finance(), { transactionId: trxId, installmentId: inst1, amount: '10000000', receivedDate: '2026-07-23', proofOfPayment: 'https://drive/proof1' });
    const rel1 = await sql<{ released_to_account_at: Date | null }[]>`select released_to_account_at from transactions where id = ${trxId}`;
    v1.paymentStatus === PAYMENT_SEBAGIAN && v1.releasedToAccount === true && rel1[0].released_to_account_at !== null
      ? pass('C5 verify #1 + routing gate', 'Finance', `TRX ${v1.paymentStatus}, released_to_account=true, Verified ${fmt(v1.amountVerified)}`)
      : fail('C5 verify #1', 'Finance', JSON.stringify(v1));

    // === C6 — verify #2 does not re-trigger release (timestamp stable). Demonstrated via C8 sequencing.
    // === C4b — changeScheme now locked (payment exists) → SchemeLockedError ([transisi status tidak diizinkan])
    await expectThrow('C4 scheme locked post-verify', 'Finance SPV', '[transisi status tidak diizinkan]', () =>
      changeScheme(sql, financeLead(), trxId, PAYMENT_SCHEME_TERMIN, 'x', [{ amount: '21900000', dueDate: '2026-08-01' }]));

    // === C8 — contract gate before final verify, then [Lunas]
    await expectThrow('C8 contract gate before Lunas', 'Finance', MSG_CONTRACT_REQUIRED, () =>
      verifyPayment(sql, finance(), { transactionId: trxId, installmentId: inst2, amount: '11900000', receivedDate: '2026-07-23' }));
    await attachContract(sql, finance(), trxId, 'https://drive/contract-alpha');
    const v2 = await verifyPayment(sql, finance(), { transactionId: trxId, installmentId: inst2, amount: '11900000', receivedDate: '2026-07-23' });
    const relStable = (await sql<{ released_to_account_at: Date | null }[]>`select released_to_account_at from transactions where id = ${trxId}`)[0].released_to_account_at;
    v2.paymentStatus === PAYMENT_LUNAS && relStable?.getTime() === rel1[0].released_to_account_at?.getTime()
      ? pass('C8 contract gate → [Lunas]', 'Finance', `TRX ${v2.paymentStatus}; release timestamp stable`)
      : fail('C8', 'Finance', JSON.stringify({ ps: v2.paymentStatus }));
    const i2 = (await sql<{ status: string }[]>`select status from installments where id = ${inst2}`)[0].status;
    i2 === INST_TERVERIFIKASI ? pass('C8 all INST verified', 'Finance', i2) : fail('C8 INST', 'Finance', i2);

    const pf = await getPaymentStatus(sql, trxId);
    money.parse(pf.amountVerified) === rp('21900000') && money.parse(pf.amountOutstanding) === 0n
      ? pass('C8 final payment status', 'Finance', `Verified ${fmt(pf.amountVerified)}, Outstanding ${fmt(pf.amountOutstanding)}`)
      : fail('C8 final payment status', 'Finance', `${pf.amountVerified}/${pf.amountOutstanding}`);

    // === D1 — commission achievement (pro-rata to Amount Verified; fully verified → full commission)
    const c1 = await commissionAchievement(sql, trxId);
    money.parse(c1.totalDealCommission) === rp('2190000') && money.parse(c1.recognizedCommission) === rp('2190000')
      && c1.shares.length === 1 && money.parse(c1.shares[0].recognizedCommission) === rp('2190000')
      ? pass('D1 commission achievement', 'Sales Head/Finance', `total ${fmt(c1.totalDealCommission)}, recognized ${fmt(c1.recognizedCommission)}, Budi ${fmt(c1.shares[0].recognizedCommission)}`)
      : fail('D1 commission', 'Finance', JSON.stringify(c1));

    // === D2 — void one service → commission excludes it (total immutable)
    const voidSvc = (await sql<{ id: string }[]>`select id from services where client_id = ${clientId} and standard_price = '9000000.00' limit 1`)[0].id;
    const vr = await voidService(sql, accountLead(), voidSvc, 'klien membatalkan satu layanan');
    const svcStatus = (await sql<{ status: string }[]>`select status from services where id = ${voidSvc}`)[0].status;
    const c2 = await commissionAchievement(sql, trxId);
    const trxTotal = (await sql<{ total_agreed_value: string }[]>`select total_agreed_value from transactions where id = ${trxId}`)[0].total_agreed_value;
    svcStatus === SERVICE_VOIDED && money.parse(c2.totalDealCommission) === rp('1290000') && money.parse(trxTotal) === rp('21900000')
      ? pass('D2 void service excludes commission', 'Account Lead', `SVC ${svcStatus}; commission ${fmt(c1.totalDealCommission)} → ${fmt(c2.totalDealCommission)}; TRX total immutable ${fmt(trxTotal)}`)
      : fail('D2 void', 'Account Lead', JSON.stringify({ svcStatus, before: c1.totalDealCommission, after: c2.totalDealCommission, trxTotal }));
    void vr;

    // === D3 — audit log immutable (no UPDATE / DELETE path)
    await expectThrow('D3 audit UPDATE blocked', 'Dev/OD', '', () => sql`update audit_log set action = 'tampered' where entity_id = ${clientId}` as unknown as Promise<unknown>);
    await expectThrow('D3 audit DELETE blocked', 'Dev/OD', '', () => sql`delete from audit_log where entity_id = ${clientId}` as unknown as Promise<unknown>);

    // === D4 — recompute from log = displayed
    const rc = await getPaymentStatus(sql, trxId);
    const rcC = await commissionAchievement(sql, trxId);
    rc.amountVerified === pf.amountVerified && rcC.recognizedCommission === c2.recognizedCommission
      ? pass('D4 recompute from log', 'Dev', `Verified & commission recompute = displayed (derived, house rule #4)`)
      : fail('D4 recompute', 'Dev', 'mismatch');

    // ---- Report ----
    const width = Math.max(...rows.map((r) => r.step.length));
    const lines = rows.map((r) => `${r.ok ? '✅' : '❌'} ${r.step.padEnd(width)}  [${r.actor}]  ${r.detail}`);
    const nFail = rows.filter((r) => !r.ok).length;
    // eslint-disable-next-line no-console
    console.log('\n================ WAVE 1 EXIT — AUTOMATED UAT RESULT ================\n' + lines.join('\n') +
      `\n\n${rows.length - nFail}/${rows.length} steps passed.\n===================================================================\n`);

    expect(nFail, `${nFail} UAT step(s) failed`).toBe(0);
  });
});
