/**
 * Tests for M9 KOL (kol.ts).
 *
 * - Unit: the §10.1/§3 predicates + the pure computeBookingMetrics core (§7
 *   sub-turnarounds, the §11-mapped overall Speed Score, [Dropped] exclusion).
 * - Integration (skipped unless DATABASE_URL is set): the full native lifecycle
 *   driving the Brief roll-up, the QC-fail revision cap + escalate/drop, coordinator
 *   assignment + SLA/hours, the Creator Payment Request (Finance-side), Attributed
 *   GMV, and the compiled Creator List.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  assignCoordinator,
  book,
  bookingMetrics,
  canDrop,
  canExecute,
  canFinance,
  canSeeBooking,
  computeBookingMetrics,
  ConflictError,
  continueFromEscalation,
  createBooking,
  createPaymentRequest,
  drop,
  escalate,
  failQC,
  ForbiddenError,
  generateCreatorList,
  getBooking,
  getCreatorList,
  listBriefBookings,
  logHours,
  markPaid,
  NotFoundError,
  passQC,
  receiveByFinance,
  recordAttributedGmv,
  reject,
  resubmit,
  sendToQCReview,
  setSlaTarget,
  startContent,
  submitContent,
  ValidationError,
  type Actor,
  type BookingInput,
} from './kol';

const kolStaff = (id = 'ZZ-COORD'): Actor => ({ employeeId: id, divisi: 'KOL', role: permission.makeRole({ division: 'KOL', level: 'staff' }) });
const kolLead = (id = 'ZZ-KLEAD'): Actor => ({ employeeId: id, divisi: 'KOL', role: permission.makeRole({ division: 'KOL', level: 'lead' }) });
const am = (id = 'ZZ-SINTA'): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (): Actor => ({ employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const finance = (): Actor => ({ employeeId: 'ZZ-FIN', divisi: 'Finance', role: permission.makeRole({ division: 'Finance', level: 'staff' }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit.
// ---------------------------------------------------------------------------
const t = (h: number): Date => new Date(Date.UTC(2026, 6, 1, h, 0, 0));

describe('kol predicates', () => {
  it('canExecute: KOL staff/lead or the assigned Coordinator; AM/Finance denied', () => {
    expect(canExecute(kolStaff(), { division: 'KOL', coordinator: '' })).toBe(true);
    expect(canExecute(director(), { division: 'KOL', coordinator: '' })).toBe(true);
    expect(canExecute(am(), { division: 'KOL', coordinator: '' })).toBe(false);
    expect(canExecute(kolStaff('ZZ-OTHER'), { division: 'KOL', coordinator: 'ZZ-COORD' })).toBe(false);
    expect(canExecute(kolLead(), { division: 'KOL', coordinator: 'ZZ-COORD' })).toBe(true);
  });
  it('canDrop: KOL lead, Account lead, or Director', () => {
    expect(canDrop(kolLead())).toBe(true);
    expect(canDrop(accountLead())).toBe(true);
    expect(canDrop(director())).toBe(true);
    expect(canDrop(kolStaff())).toBe(false);
  });
  it('canFinance: Finance or Director', () => {
    expect(canFinance(finance())).toBe(true);
    expect(canFinance(director())).toBe(true);
    expect(canFinance(kolLead())).toBe(false);
  });
  it('canSeeBooking: OD/Director/Account-lead/owner-AM/KOL-division', () => {
    expect(canSeeBooking(am(), 'ZZ-SINTA', 'KOL')).toBe(true);
    expect(canSeeBooking(kolStaff(), 'ZZ-SINTA', 'KOL')).toBe(true);
    expect(canSeeBooking(finance(), 'ZZ-SINTA', 'KOL')).toBe(false);
  });
});

describe('computeBookingMetrics (§7 / §11)', () => {
  it('derives sourcing + delivery turnaround and the §11-mapped overall speed score', () => {
    const evs = [
      { to: '[Booked]', at: t(2) }, { to: '[Content In Progress]', at: t(3) },
      { to: '[Content Submitted]', at: t(6) }, { to: '[QC Review]', at: t(7) }, { to: '[QC Passed]', at: t(10) },
    ];
    const m = computeBookingMetrics('BKG-1', '[QC Passed]', t(0), 10, evs);
    expect(m.sourcingTurnaroundHours).toBe(2); // created→booked
    expect(m.deliveryTurnaroundHours).toBe(4); // booked→submitted
    expect(m.overallTurnaroundHours).toBe(10); // created([In Progress]) → [QC Passed]([Approved])
    expect(m.speedScorePct).toBe(100);
    expect(m.speedScoreDisplay).toBe('100.00%');
    expect(m.excludedFromSpeedScore).toBe(false);
  });
  it('a [Dropped] Booking is excluded from Speed Score entirely (§11)', () => {
    const m = computeBookingMetrics('BKG-1', '[Dropped]', t(0), 10, [{ to: '[Booked]', at: t(2) }, { to: '[Dropped]', at: t(5) }]);
    expect(m.excludedFromSpeedScore).toBe(true);
    expect(m.speedScoreDisplay).toBe('N/A');
    expect(m.sourcingTurnaroundHours).toBe(2); // sub-turnarounds still render
  });
  it('counts QC-fail revisions', () => {
    const evs = [{ to: '[QC Review]', at: t(1) }, { to: '[QC Failed - Revision Requested]', at: t(2) }];
    expect(computeBookingMetrics('BKG-1', '[QC Failed - Revision Requested]', t(0), null, evs).revisionCount).toBe(1);
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
    values (${id}, ${clientId}, 'MSV-X', 1, 'Svc', '10000000.00', 'rule', '[Briefed]', false, 'ZZ-TEST')`;
}
async function insertBrief(id: string, svcId: string, qty: number): Promise<void> {
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
      quantity_target, priority, recurring, created_by)
    values (${id}, ${svcId}, 'Brief', '[To Do]', 'KOL', 'KOL Content', ${qty}, 'High', false, 'ZZ-TEST')`;
}
async function registerCoord(id: string): Promise<void> {
  await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@mea.id'}, 'KOL', 'ZZ-KOL-JAB', true, 'ZZ-TEST') on conflict (employee_id) do nothing`;
  await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('KOL', 'ZZ-KOL-JAB', 'KOL', 'staff', 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;
}
/** A released client + [Briefed] service + a KOL Brief of the given quantity. */
async function kolBrief(qty = 1): Promise<{ briefId: string; svcId: string }> {
  const clientId = uid('CLI');
  const svcId = uid('SVC');
  const briefId = uid('BRF');
  await insertClient(clientId, 'ZZ-SINTA');
  await insertService(svcId, clientId);
  await insertBrief(briefId, svcId, qty);
  await registerCoord('ZZ-COORD'); // the self-claiming staff used across tests
  return { briefId, svcId };
}
const goodInput = (): BookingInput => ({
  creatorName: 'Creator A', platform: 'TikTok', sourcePool: 'MCN MEA Roster', agreedRate: '1500000',
});
const bkgStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from creator_bookings where id = ${id}`)[0].status;
const briefStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from briefs where id = ${id}`)[0].status;

/** Drives a booking through to [QC Passed]. */
async function toQcPassed(briefId: string): Promise<string> {
  const b = await createBooking(sql, kolStaff('ZZ-COORD'), briefId, goodInput());
  const c = kolStaff('ZZ-COORD');
  await book(sql, c, b.id);
  await startContent(sql, c, b.id);
  await submitContent(sql, c, b.id, 'https://tiktok/x');
  await sendToQCReview(sql, c, b.id);
  await passQC(sql, c, b.id);
  return b.id;
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from creator_payment_requests where created_by like 'ZZ-%'`;
  await sql`delete from creator_lists where created_by like 'ZZ-%'`;
  await sql`delete from creator_bookings where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

describeDb('createBooking (§4)', () => {
  it('KOL staff self-claims: coordinator defaults to them, born [Sourcing]', async () => {
    const { briefId } = await kolBrief();
    const b = await createBooking(sql, kolStaff('ZZ-COORD'), briefId, goodInput());
    expect(b.status).toBe('[Sourcing]');
    expect(b.assignedCoordinator).toBe('ZZ-COORD');
    expect(b.agreedRate).toBe(1500000);
    expect(b.agreedRateDisplay).toBe('Rp. 1.500.000,00');
    expect(b.id).toMatch(/^BKG-\d{6}-\d{4}$/);
  });
  it('gates: non-KOL brief, invalid source pool, permission', async () => {
    const { briefId } = await kolBrief();
    await expect(createBooking(sql, am(), briefId, goodInput())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createBooking(sql, kolStaff(), briefId, { ...goodInput(), sourcePool: 'Random' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createBooking(sql, kolStaff(), 'BRF-GHOST-0', goodInput())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('native lifecycle drives the Brief roll-up (§2)', () => {
  it('book → … → passQC walks the Brief [To Do]→…→[Approved] and the Service to [In Execution]', async () => {
    const { briefId, svcId } = await kolBrief(1);
    const b = await createBooking(sql, kolStaff('ZZ-COORD'), briefId, goodInput());
    const c = kolStaff('ZZ-COORD');
    await book(sql, c, b.id); // first booking leaves [Sourcing] → Brief [In Progress]
    expect(await briefStatus(briefId)).toBe('[In Progress]');
    expect((await sql<{ status: string }[]>`select status from services where id = ${svcId}`)[0].status).toBe('[In Execution]');
    await startContent(sql, c, b.id);
    await expect(submitContent(sql, c, b.id, '  ')).rejects.toBeInstanceOf(ValidationError); // link mandatory
    await submitContent(sql, c, b.id, 'https://tiktok/x');
    expect(await briefStatus(briefId)).toBe('[Submitted]');
    await sendToQCReview(sql, c, b.id);
    expect(await briefStatus(briefId)).toBe('[In Review]');
    await passQC(sql, c, b.id);
    expect(await bkgStatus(b.id)).toBe('[QC Passed]');
    expect(await briefStatus(briefId)).toBe('[Approved]'); // all bookings resolved
  });

  it('QC fail respects the 1-revision cap then forces escalation; escalate needs KOL lead', async () => {
    const { briefId } = await kolBrief(1);
    const b = await createBooking(sql, kolStaff('ZZ-COORD'), briefId, goodInput());
    const c = kolStaff('ZZ-COORD');
    await book(sql, c, b.id);
    await startContent(sql, c, b.id);
    await submitContent(sql, c, b.id, 'https://x');
    await sendToQCReview(sql, c, b.id);
    await expect(failQC(sql, c, b.id, '  ')).rejects.toBeInstanceOf(ValidationError); // notes mandatory
    await failQC(sql, c, b.id, 'audio buruk'); // revision #1
    expect(await bkgStatus(b.id)).toBe('[QC Failed - Revision Requested]');
    await resubmit(sql, c, b.id, 'https://x2');
    await sendToQCReview(sql, c, b.id);
    // Cap reached: a 2nd fail is blocked, only escalation remains.
    await expect(failQC(sql, c, b.id, 'masih buruk')).rejects.toBeInstanceOf(ConflictError);
    await expect(escalate(sql, c, b.id, 'kreator hilang')).rejects.toBeInstanceOf(ForbiddenError); // staff cannot escalate
    await escalate(sql, kolLead(), b.id, 'kreator hilang');
    expect(await bkgStatus(b.id)).toBe('[Escalated - Creator Unresponsive]');
    // Continue from escalation (AM proxy) keeps the existing content link.
    await continueFromEscalation(sql, am(), b.id, '');
    expect(await bkgStatus(b.id)).toBe('[Content Submitted]');
  });

  it('drop is KOL-lead/Account-lead/Director only, reason mandatory', async () => {
    const { briefId } = await kolBrief(1);
    const b = await createBooking(sql, kolStaff('ZZ-COORD'), briefId, goodInput());
    await book(sql, kolStaff('ZZ-COORD'), b.id);
    await expect(drop(sql, kolStaff('ZZ-COORD'), b.id, 'x')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(drop(sql, kolLead(), b.id, '  ')).rejects.toBeInstanceOf(ValidationError);
    await drop(sql, kolLead(), b.id, 'kreator batal');
    expect(await bkgStatus(b.id)).toBe('[Dropped]');
  });
});

describeDb('coordinator / SLA / hours (§3 / §7)', () => {
  it('KOL lead assigns/reassigns (reason on reassign); sets SLA; coordinator logs hours', async () => {
    const { briefId } = await kolBrief();
    const b = await createBooking(sql, kolLead(), briefId, { ...goodInput() }); // lead creates unassigned
    await registerCoord('ZZ-COORD');
    await registerCoord('ZZ-COORD2');
    await expect(assignCoordinator(sql, kolStaff(), b.id, 'ZZ-COORD', '')).rejects.toBeInstanceOf(ForbiddenError);
    await assignCoordinator(sql, kolLead(), b.id, 'ZZ-COORD', '');
    // Reassign requires a reason.
    await expect(assignCoordinator(sql, kolLead(), b.id, 'ZZ-COORD2', '')).rejects.toBeInstanceOf(ValidationError);
    await assignCoordinator(sql, kolLead(), b.id, 'ZZ-COORD2', 'cuti');
    await expect(setSlaTarget(sql, kolStaff(), b.id, 24)).rejects.toBeInstanceOf(ForbiddenError);
    await setSlaTarget(sql, kolLead(), b.id, 48);
    await logHours(sql, kolStaff('ZZ-COORD2'), b.id, 5); // the assigned coordinator
    expect((await getBooking(sql, kolLead(), b.id)).hoursLogged).toBe(5);
  });
});

describeDb('payment request (§8) + attributed GMV + creator list (§6)', () => {
  it('CPR only after [QC Passed], amount must match rate, Finance receives/pays', async () => {
    const { briefId } = await kolBrief();
    const id = await toQcPassed(briefId);
    await expect(createPaymentRequest(sql, kolStaff('ZZ-COORD'), id, '999', 'BCA 123')).rejects.toBeInstanceOf(ValidationError); // mismatch
    await expect(createPaymentRequest(sql, kolStaff('ZZ-COORD'), id, '1500000', '  ')).rejects.toBeInstanceOf(ValidationError); // details required
    const cpr = await createPaymentRequest(sql, kolStaff('ZZ-COORD'), id, '1500000', 'BCA 123');
    expect(cpr.status).toBe('[Requested]');
    expect(cpr.amountDisplay).toBe('Rp. 1.500.000,00');
    // A second active request is blocked.
    await expect(createPaymentRequest(sql, kolStaff('ZZ-COORD'), id, '1500000', 'BCA 123')).rejects.toBeInstanceOf(ConflictError);
    // Finance-side lifecycle; a non-Finance actor is denied.
    await expect(receiveByFinance(sql, kolStaff('ZZ-COORD'), cpr.id)).rejects.toBeInstanceOf(ForbiddenError);
    await receiveByFinance(sql, finance(), cpr.id);
    expect((await markPaid(sql, finance(), cpr.id)).ok).toBe(true);
    // The Booking reflects [Paid].
    expect((await getBooking(sql, kolStaff('ZZ-COORD'), id)).paymentStatus).toBe('[Paid]');
  });

  it('reject needs a reason and sends it back to KOL', async () => {
    const { briefId } = await kolBrief();
    const id = await toQcPassed(briefId);
    const cpr = await createPaymentRequest(sql, kolStaff('ZZ-COORD'), id, '1500000', 'BCA 123');
    await receiveByFinance(sql, finance(), cpr.id);
    await expect(reject(sql, finance(), cpr.id, '  ')).rejects.toBeInstanceOf(ValidationError);
    await reject(sql, finance(), cpr.id, 'detail rekening salah');
    expect((await getBooking(sql, kolStaff('ZZ-COORD'), id)).paymentStatus).toBe('[Rejected]');
  });

  it('attributed GMV only after [QC Passed]; creator list snapshots eligible bookings', async () => {
    const { briefId } = await kolBrief(1);
    const id = await toQcPassed(briefId);
    const { value, display } = await recordAttributedGmv(sql, kolStaff('ZZ-COORD'), id, '5000000');
    expect(value).toBe(5000000);
    expect(display).toBe('Rp. 5.000.000,00');
    expect((await getBooking(sql, kolStaff('ZZ-COORD'), id)).attributedGmv).toBe(5000000);
    // Creator List: link required; snapshots the [QC Passed] booking.
    await expect(generateCreatorList(sql, kolStaff('ZZ-COORD'), briefId, '  ')).rejects.toBeInstanceOf(ValidationError);
    const cl = await generateCreatorList(sql, kolStaff('ZZ-COORD'), briefId, 'https://drive/list');
    expect(cl.includedBookings).toEqual([id]);
    expect((await getCreatorList(sql, am(), briefId)).eligibleBookings).toEqual([id]);
    // A Booking metrics read + listBriefBookings behind the read gate.
    expect((await bookingMetrics(sql, kolStaff('ZZ-COORD'), id)).status).toBe('[QC Passed]');
    expect((await listBriefBookings(sql, accountLead(), briefId)).length).toBe(1);
    await expect(getBooking(sql, finance(), id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
