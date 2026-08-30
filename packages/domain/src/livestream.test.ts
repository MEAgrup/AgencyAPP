/**
 * Tests for M10 Live Stream — the Live Stream Session (LSS-) vendor tracker.
 *
 * - Unit: the §6.1 permission predicates (canManageSession / canSeeSession) — the
 *   only gate reachable without a DB, since the Session gates run after the parent
 *   Brief lock (faithful to the Go ordering).
 * - Integration (skipped unless DATABASE_URL is set): the full AM-owned lifecycle
 *   against a migrated Postgres over a Live Stream Brief born [Dispatched to
 *   Vendor] — create → confirm → results → reconcile with the off-machine Brief
 *   roll-up, the discrepancy branch + SPV-Account notification, Brief reopen, the
 *   read gate, and the mandatory-field / void / wrong-division guards. Ids
 *   namespaced `ZZ-`; afterEach deletes what it made.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { leads, sales } from './index';
import {
  BRIEF_APPROVED,
  BRIEF_VENDOR_DISPATCHED,
  ConflictError,
  ForbiddenError,
  IncompleteError,
  LIVE_STREAM_DIVISION,
  LSS_COMPLETED,
  LSS_CONFIRMED,
  LSS_DISCREPANCY,
  LSS_RECONCILED,
  LSS_REQUESTED,
  NotFoundError,
  PLATFORM_TIKTOK,
  ValidationError,
  canManageSession,
  canSeeSession,
  canVendorWriteSession,
  confirmByVendor,
  createSession,
  flagDiscrepancy,
  getSession,
  listBriefSessions,
  listVendorSessions,
  logResults,
  reconcile,
  reopenBrief,
  type Actor,
} from './livestream';

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const am = (): Actor => ({
  employeeId: 'ZZ-AM', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const otherAm = (): Actor => ({
  employeeId: 'ZZ-AM2', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const accountLead = (): Actor => ({
  employeeId: 'ZZ-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const kolLead = (): Actor => ({
  employeeId: 'ZZ-KLEAD', divisi: 'KOL', role: permission.makeRole({ division: 'KOL', level: 'lead' }),
});
const od = (): Actor => ({ employeeId: 'ZZ-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });
/** LT-61: a vendor Actor — employeeId = vendorId, Role all-empty. */
const vendorActor = (vendorId: string): Actor => ({ employeeId: vendorId, vendorId, role: permission.makeRole({}) });

// ---------------------------------------------------------------------------
// Unit: §6.1 permission predicates (no DB).
// ---------------------------------------------------------------------------
describe('§6.1 permission predicates', () => {
  it('canManageSession: owning AM or Director only', () => {
    expect(canManageSession(am(), 'ZZ-AM')).toBe(true); // owning AM
    expect(canManageSession(director(), 'ZZ-AM')).toBe(true); // Director everywhere
    expect(canManageSession(otherAm(), 'ZZ-AM')).toBe(false); // a different AM
    expect(canManageSession(accountLead(), 'ZZ-AM')).toBe(false); // lead reads, not writes
    expect(canManageSession(od(), 'ZZ-AM')).toBe(false); // OD is read-only
    expect(canManageSession(am(), null)).toBe(false); // no owner resolved
  });

  it('canSeeSession: OD/Director everywhere, Account lead division-wide, owning AM, LT-61 assigned vendor', () => {
    expect(canSeeSession(od(), 'ZZ-AM')).toBe(true);
    expect(canSeeSession(director(), 'ZZ-AM')).toBe(true);
    expect(canSeeSession(accountLead(), 'ZZ-AM')).toBe(true); // division-wide
    expect(canSeeSession(am(), 'ZZ-AM')).toBe(true); // owning AM
    expect(canSeeSession(otherAm(), 'ZZ-AM')).toBe(false); // a different AM, not the owner
    expect(canSeeSession(kolLead(), 'ZZ-AM')).toBe(false); // another division's lead
    expect(canSeeSession(budi(), 'ZZ-AM')).toBe(false); // sales staff
    expect(canSeeSession(vendorActor('VND-1'), 'ZZ-AM', 'VND-1')).toBe(true); // LT-61: assigned vendor
    expect(canSeeSession(vendorActor('VND-2'), 'ZZ-AM', 'VND-1')).toBe(false); // a different vendor
    expect(canSeeSession(vendorActor('VND-1'), 'ZZ-AM', null)).toBe(false); // no vendor resolved on this Session
  });

  it('canVendorWriteSession (LT-61): additive, never true for an employee Actor', () => {
    expect(canVendorWriteSession(vendorActor('VND-1'), 'VND-1')).toBe(true);
    expect(canVendorWriteSession(vendorActor('VND-2'), 'VND-1')).toBe(false);
    expect(canVendorWriteSession(vendorActor('VND-1'), null)).toBe(false);
    expect(canVendorWriteSession(director(), 'VND-1')).toBe(false); // no vendorId on an employee Actor
    expect(canVendorWriteSession(am(), 'VND-1')).toBe(false);
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
const uniquePhone = (): string => `0817${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;
const uniqueSvc = (): string => `SVC-ZZ-M10-${seq++}`;

/** Close a deal (Budi solo, Lunas) and return the born client id. */
async function closedClient(): Promise<string> {
  const svc = uniqueSvc();
  await sql`insert into master_services (id, created_by) values (${svc}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, created_by)
    values (${svc}, 1, ${'Svc ' + svc}, '9000000.00', '10% of standard price', true, '2020-01-01', 'flat', 'ZZ-ADMIN')`;
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
    paymentScheme: sales.PAYMENT_SCHEME_LUNAS,
  });
  return res.clientId;
}

/**
 * Seed a Live Stream Brief on the client's service (assigns ZZ-AM as the owning
 * AM). The Brief is off-machine — inserted directly at `status`. Returns brief id.
 */
async function seedLsBrief(
  clientId: string,
  status: string = BRIEF_VENDOR_DISPATCHED,
  division: string = LIVE_STREAM_DIVISION,
): Promise<string> {
  await sql`update clients set assigned_am_id = 'ZZ-AM' where id = ${clientId}`;
  const svc = (await sql<{ id: string }[]>`select id from services where client_id = ${clientId} limit 1`)[0].id;
  // Globally unique (audit_log is append-only + never cleaned, so a seq-only id
  // would collide with a prior run's residue on entity_id assertions).
  const id = `BRF-ZZ${String(Date.now()).slice(-9)}${seq++}`;
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, created_by)
    values (${id}, ${svc}, 'Live Stream Brief', ${status}, ${division}, 'ZZ-ADMIN')`;
  return id;
}

/** A dispatched Live Stream Brief on a fresh closed client. */
async function dispatchedBrief(): Promise<string> {
  return seedLsBrief(await closedClient());
}

/** Same as `dispatchedBrief`, but also returns the client id (LT-61 vendor fixtures need it). */
async function dispatchedBriefWithClient(): Promise<{ briefId: string; clientId: string }> {
  const clientId = await closedClient();
  const briefId = await seedLsBrief(clientId);
  return { briefId, clientId };
}

/**
 * seedLiveVendor (LT-61) gives `clientId` an Aktif Strategi with a `live` pillar
 * assigned to a fresh `vendors` row, and returns that vendor's id —
 * `createSession`'s `resolveLiveVendorId` reads exactly this shape. Off-machine
 * inserts (same precedent as `seedLsBrief`): a real Strategi engine flow is not
 * needed to prove the LT-61 wiring reads the right column.
 */
async function seedLiveVendor(clientId: string): Promise<string> {
  const vendorId = `ZZ-VND-${String(Date.now()).slice(-9)}${seq++}`;
  await sql`
    insert into vendors (id, nama_vendor, jenis_layanan, pic_nama, pic_kontak, skema_biaya, tarif, created_by)
    values (${vendorId}, 'Vendor Live ZZ', 'live_stream', 'PIC Vendor', '0800000000', 'per_sesi', '1000000.00', 'ZZ-ADMIN')`;
  // strategi is keyed by (contract_id, client_id) since O57 (service_id/durasi/
  // jendela moved to `contracts`) — a bare Strategi fixture needs one first.
  const contractId = `ZZ-CTR-${String(Date.now()).slice(-9)}${seq++}`;
  await sql`
    insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, created_by)
    values (${contractId}, ${clientId}, 6, '2026-01-01', '2026-07-01', 'ZZ-ADMIN')`;
  const strategiId = `ZZ-STRG-${String(Date.now()).slice(-9)}${seq++}`;
  await sql`
    insert into strategi (id, contract_id, client_id, status, created_by)
    values (${strategiId}, ${contractId}, ${clientId}, 'Aktif', 'ZZ-ADMIN')`;
  await sql`
    insert into strategi_pillar (strategi_id, jenis, vendor_id, created_by)
    values (${strategiId}, 'live', ${vendorId}, 'ZZ-ADMIN')`;
  return vendorId;
}

const goodRequest = {
  platform: PLATFORM_TIKTOK,
  requestedDatetime: '2026-08-01 15:00:00',
  targetDurationHours: '2',
  productsTalent: 'Skincare bundle',
};

const goodResult = {
  actualDatetime: '2026-08-01 15:05:00',
  actualDurationHours: '2.5',
  viewersPeak: 1200,
  viewersAvg: 800,
  ordersGenerated: 150,
  gmv: '5000000',
  vendorReportLink: 'https://vendor.example/report/1',
};

/** Drive a Session from birth to [Completed] and return its id. */
async function completedSession(briefId: string): Promise<string> {
  const s = await createSession(sql, am(), briefId, goodRequest);
  await confirmByVendor(sql, am(), s.id);
  await logResults(sql, am(), s.id, goodResult);
  return s.id;
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from live_stream_sessions where created_by like 'ZZ-%'`;
  // notifications + audit_log are append-only (house rule #8) — no DELETE path;
  // ZZ- rows are harmless residue (same as the demo/finance integration tests).
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  // LT-61 fixtures: strategi_pillar cascades off strategi (fk ON DELETE CASCADE).
  await sql`delete from strategi where created_by like 'ZZ-%'`;
  await sql`delete from vendors where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from client_sales_allocations where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposal_lines where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposals where created_by like 'ZZ-%'`;
  await sql`delete from qualified_form_services where created_by like 'ZZ-%'`;
  await sql`delete from qualified_forms where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
  await sql`delete from employees where employee_id like 'ZZ-%'`;
});

describeDb('createSession (M10 §3)', () => {
  it('owning AM creates a request, born [Requested] with the Vendor-Reported badge', async () => {
    const brief = await dispatchedBrief();
    const s = await createSession(sql, am(), brief, goodRequest);
    expect(s.id).toMatch(/^LSS-\d{6}-\d{4}$/);
    expect(s.status).toBe(LSS_REQUESTED);
    expect(s.platform).toBe(PLATFORM_TIKTOK);
    expect(s.targetDurationHours).toBe(2);
    expect(s.dataConfidenceTier).toBe('Vendor-Reported');
    expect(s.gmv).toBeNull();

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${s.id} and action = 'create'`;
    expect(audit[0].n).toBe(1);
  });

  it('Director may also create; a different AM / OD / Sales staff may not', async () => {
    const brief = await dispatchedBrief();
    const s = await createSession(sql, director(), brief, goodRequest);
    expect(s.status).toBe(LSS_REQUESTED);

    await expect(createSession(sql, otherAm(), brief, goodRequest)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSession(sql, od(), brief, goodRequest)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSession(sql, budi(), brief, goodRequest)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('validates the §6.3 mandatory fields BEFORE minting an id', async () => {
    const brief = await dispatchedBrief();
    await expect(createSession(sql, am(), brief, { ...goodRequest, platform: '' })).rejects.toBeInstanceOf(IncompleteError);
    await expect(createSession(sql, am(), brief, { ...goodRequest, platform: 'Lazada Live' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSession(sql, am(), brief, { ...goodRequest, targetDurationHours: '0' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSession(sql, am(), brief, { ...goodRequest, requestedDatetime: 'not-a-date' })).rejects.toBeInstanceOf(ValidationError);

    // No LSS- id was consumed by any of the rejected attempts.
    const n = await sql<{ n: number }[]>`select count(*)::int as n from live_stream_sessions where brief_id = ${brief}`;
    expect(n[0].n).toBe(0);
  });

  it('404s on an unknown Brief; 409s on a non-Live-Stream / voided / closed Brief', async () => {
    await expect(createSession(sql, am(), 'BRF-000000-0000', goodRequest)).rejects.toBeInstanceOf(NotFoundError);

    const kolBrief = await seedLsBrief(await closedClient(), BRIEF_VENDOR_DISPATCHED, 'KOL');
    await expect(createSession(sql, am(), kolBrief, goodRequest)).rejects.toBeInstanceOf(ConflictError);

    const voided = await seedLsBrief(await closedClient(), '[Cancelled — Service Voided]');
    await expect(createSession(sql, am(), voided, goodRequest)).rejects.toBeInstanceOf(ConflictError);

    const approved = await seedLsBrief(await closedClient(), BRIEF_APPROVED);
    await expect(createSession(sql, am(), approved, goodRequest)).rejects.toBeInstanceOf(ConflictError);
  });
});

describeDb('lifecycle: confirm → results → reconcile (M10 §4)', () => {
  it('the happy path completes and the vendor-reported GMV renders at full value', async () => {
    const brief = await dispatchedBrief();
    const s = await createSession(sql, am(), brief, goodRequest);

    const c = await confirmByVendor(sql, am(), s.id);
    expect(c.ok).toBe(true);

    const r = await logResults(sql, am(), s.id, goodResult);
    expect(r.ok).toBe(true);

    const view = await getSession(sql, am(), s.id);
    expect(view.status).toBe(LSS_COMPLETED);
    expect(view.gmv).toBe('5000000.00');
    expect(view.gmvDisplay).toBe('Rp. 5.000.000,00'); // full value, only badged (M10-OA-5)
    expect(view.ordersGenerated).toBe(150);
    expect(view.actualDurationHours).toBe(2.5);
    expect(view.vendorReportLink).toBe('https://vendor.example/report/1');
  });

  it('[Completed] requires the Vendor Report Link + the result fields (§6.3)', async () => {
    const brief = await dispatchedBrief();
    const s = await createSession(sql, am(), brief, goodRequest);
    await confirmByVendor(sql, am(), s.id);

    await expect(logResults(sql, am(), s.id, { ...goodResult, vendorReportLink: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(logResults(sql, am(), s.id, { ...goodResult, ordersGenerated: null })).rejects.toBeInstanceOf(IncompleteError);
    await expect(logResults(sql, am(), s.id, { ...goodResult, gmv: 'abc' })).rejects.toBeInstanceOf(ValidationError);

    const view = await getSession(sql, am(), s.id);
    expect(view.status).toBe(LSS_CONFIRMED); // no partial move
  });

  it('reconcile closes the Session and rolls the off-machine Brief up to [Approved]', async () => {
    const brief = await dispatchedBrief();
    const id = await completedSession(brief);

    const rec = await reconcile(sql, am(), id);
    expect(rec.ok).toBe(true);

    const view = await getSession(sql, am(), id);
    expect(view.status).toBe(LSS_RECONCILED);

    const b = await sql<{ status: string }[]>`select status from briefs where id = ${brief}`;
    expect(b[0].status).toBe(BRIEF_APPROVED);
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${brief} and action = 'ls_brief_reconciled'`;
    expect(audit[0].n).toBe(1);
  });

  it('the Brief stays [Dispatched to Vendor] until EVERY Session reconciles', async () => {
    const brief = await dispatchedBrief();
    const a = await completedSession(brief);
    const b = await completedSession(brief);

    await reconcile(sql, am(), a);
    let brow = await sql<{ status: string }[]>`select status from briefs where id = ${brief}`;
    expect(brow[0].status).toBe(BRIEF_VENDOR_DISPATCHED); // one still open

    await reconcile(sql, am(), b);
    brow = await sql<{ status: string }[]>`select status from briefs where id = ${brief}`;
    expect(brow[0].status).toBe(BRIEF_APPROVED); // now all reconciled
  });

  it('an out-of-order transition is a 409 conflict (pinned source states)', async () => {
    const brief = await dispatchedBrief();
    const s = await createSession(sql, am(), brief, goodRequest);
    // Cannot reconcile straight from [Requested].
    await expect(reconcile(sql, am(), s.id)).rejects.toBeInstanceOf(ConflictError);
    // Cannot log results before the vendor confirms.
    await expect(logResults(sql, am(), s.id, goodResult)).rejects.toBeInstanceOf(ConflictError);
  });

  it('a non-owner cannot drive the lifecycle', async () => {
    const brief = await dispatchedBrief();
    const s = await createSession(sql, am(), brief, goodRequest);
    await expect(confirmByVendor(sql, otherAm(), s.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(confirmByVendor(sql, accountLead(), s.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('discrepancy branch (M10 §4 Rule 3 / M10-OA-3)', () => {
  it('flags with mandatory notes, notifies the SPV-Account lead, then still reconciles', async () => {
    // Seed an active Account lead so notify_emit resolves a recipient.
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-ALEAD', 'Account Lead', 'zz-alead@example.com', 'Account', 'Account Lead', true, 'ZZ-ADMIN')`;

    const brief = await dispatchedBrief();
    const id = await completedSession(brief);

    await expect(flagDiscrepancy(sql, am(), id, '   ')).rejects.toBeInstanceOf(ValidationError);

    const flagged = await flagDiscrepancy(sql, am(), id, 'GMV vendor 20% di bawah target');
    expect(flagged.ok).toBe(true);
    expect((await getSession(sql, am(), id)).status).toBe(LSS_DISCREPANCY);

    const notif = await sql<{ recipient_employee_id: string; event_type: string }[]>`
      select recipient_employee_id, event_type from notifications where entity_id = ${id}`;
    expect(notif).toHaveLength(1);
    expect(notif[0].recipient_employee_id).toBe('ZZ-ALEAD');
    expect(notif[0].event_type).toBe('m10.session.discrepancy_flagged');

    // Non-blocking (§4 Rule 4): a flagged Session can still be reconciled.
    const rec = await reconcile(sql, am(), id);
    expect(rec.ok).toBe(true);
    expect((await getSession(sql, am(), id)).status).toBe(LSS_RECONCILED);
  });

  it('discrepancy is only reachable from [Completed]', async () => {
    const brief = await dispatchedBrief();
    const s = await createSession(sql, am(), brief, goodRequest);
    await expect(flagDiscrepancy(sql, am(), s.id, 'notes')).rejects.toBeInstanceOf(ConflictError);
  });
});

describeDb('reopen Brief (M10-OA-4 / DECISIONS O27)', () => {
  it('reopens an [Approved] Brief to add more Sessions; only from [Approved]', async () => {
    const brief = await dispatchedBrief();
    const id = await completedSession(brief);
    await reconcile(sql, am(), id);
    expect((await sql<{ status: string }[]>`select status from briefs where id = ${brief}`)[0].status).toBe(BRIEF_APPROVED);

    await reopenBrief(sql, am(), brief);
    expect((await sql<{ status: string }[]>`select status from briefs where id = ${brief}`)[0].status).toBe(BRIEF_VENDOR_DISPATCHED);
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${brief} and action = 'ls_brief_reopened'`;
    expect(audit[0].n).toBe(1);

    // A dispatched Brief cannot be reopened again.
    await expect(reopenBrief(sql, am(), brief)).rejects.toBeInstanceOf(ConflictError);
  });

  it('only the owning AM or Director may reopen', async () => {
    const brief = await dispatchedBrief();
    const id = await completedSession(brief);
    await reconcile(sql, am(), id);
    await expect(reopenBrief(sql, otherAm(), brief)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reopenBrief(sql, accountLead(), brief)).rejects.toBeInstanceOf(ForbiddenError);
    await reopenBrief(sql, director(), brief); // Director may
  });
});

describeDb('reads (§6.1)', () => {
  it('getSession honors the read gate; listBriefSessions returns the fan-out', async () => {
    const brief = await dispatchedBrief();
    const s1 = await createSession(sql, am(), brief, goodRequest);
    const s2 = await createSession(sql, am(), brief, goodRequest);

    // Owning AM, Account lead, OD, Director may read; a different AM / other-division lead may not.
    expect((await getSession(sql, am(), s1.id)).id).toBe(s1.id);
    expect((await getSession(sql, accountLead(), s1.id)).id).toBe(s1.id);
    expect((await getSession(sql, od(), s1.id)).id).toBe(s1.id);
    await expect(getSession(sql, otherAm(), s1.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSession(sql, kolLead(), s1.id)).rejects.toBeInstanceOf(ForbiddenError);

    const list = await listBriefSessions(sql, am(), brief);
    expect(list.map((x) => x.id)).toEqual([s1.id, s2.id].sort());

    await expect(getSession(sql, am(), 'LSS-000000-0000')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('LT-61: vendor self-service (create / confirm / results — never reconcile)', () => {
  it('createSession stamps vendor_id from the client Aktif Strategi live pillar, or null when unresolved', async () => {
    const { briefId, clientId } = await dispatchedBriefWithClient();
    const vendorId = await seedLiveVendor(clientId);

    const withVendor = await createSession(sql, am(), briefId, goodRequest);
    expect(withVendor.vendorId).toBe(vendorId);

    // A different client with no Aktif Strategi live pillar: vendor_id stays
    // null — the pre-LT-61 path (AM-only) keeps working exactly as before.
    const bare = await dispatchedBrief();
    const noVendor = await createSession(sql, am(), bare, goodRequest);
    expect(noVendor.vendorId).toBeNull();
  });

  it('the assigned vendor may create its own request once it has a Session-worthy Brief', async () => {
    const { briefId, clientId } = await dispatchedBriefWithClient();
    const vendorId = await seedLiveVendor(clientId);

    const s = await createSession(sql, vendorActor(vendorId), briefId, goodRequest);
    expect(s.vendorId).toBe(vendorId);
    expect(s.status).toBe(LSS_REQUESTED);

    // A DIFFERENT vendor (not assigned to this client) may not.
    await expect(createSession(sql, vendorActor('ZZ-VND-OTHER'), briefId, goodRequest)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('the assigned vendor may confirm its own schedule and log its own results — additive to the AM path', async () => {
    const { briefId, clientId } = await dispatchedBriefWithClient();
    const vendorId = await seedLiveVendor(clientId);
    const va = vendorActor(vendorId);

    const s = await createSession(sql, am(), briefId, goodRequest); // AM still may create, unchanged
    expect(s.vendorId).toBe(vendorId);

    const c = await confirmByVendor(sql, va, s.id);
    expect(c.ok).toBe(true);

    const r = await logResults(sql, va, s.id, goodResult);
    expect(r.ok).toBe(true);

    const view = await getSession(sql, am(), s.id);
    expect(view.status).toBe(LSS_COMPLETED);
    expect(view.gmv).toBe('5000000.00');
  });

  it('a vendor NOT assigned to this Session is forbidden on confirm/results, even with a valid vendor Actor', async () => {
    const { briefId, clientId } = await dispatchedBriefWithClient();
    await seedLiveVendor(clientId);
    const s = await createSession(sql, am(), briefId, goodRequest);

    const stranger = vendorActor('ZZ-VND-STRANGER');
    await expect(confirmByVendor(sql, stranger, s.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logResults(sql, stranger, s.id, goodResult)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('the assigned vendor is FORBIDDEN from reconcile/flagDiscrepancy — those stay AM/Director-only by construction', async () => {
    const { briefId, clientId } = await dispatchedBriefWithClient();
    const vendorId = await seedLiveVendor(clientId);
    const va = vendorActor(vendorId);

    const s = await createSession(sql, am(), briefId, goodRequest);
    await confirmByVendor(sql, va, s.id);
    await logResults(sql, va, s.id, goodResult);

    await expect(reconcile(sql, va, s.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(flagDiscrepancy(sql, va, s.id, 'selisih GMV')).rejects.toBeInstanceOf(ForbiddenError);

    // The AM path still closes it out normally.
    const rec = await reconcile(sql, am(), s.id);
    expect(rec.ok).toBe(true);
  });

  it('getSession / listBriefSessions / listVendorSessions honor the vendor read scope', async () => {
    const { briefId, clientId } = await dispatchedBriefWithClient();
    const vendorId = await seedLiveVendor(clientId);
    const va = vendorActor(vendorId);
    const s = await createSession(sql, am(), briefId, goodRequest);

    expect((await getSession(sql, va, s.id)).id).toBe(s.id);
    await expect(getSession(sql, vendorActor('ZZ-VND-OTHER'), s.id)).rejects.toBeInstanceOf(ForbiddenError);

    const list = await listBriefSessions(sql, va, briefId);
    expect(list.map((x) => x.id)).toEqual([s.id]);
    await expect(listBriefSessions(sql, vendorActor('ZZ-VND-OTHER'), briefId)).rejects.toBeInstanceOf(ForbiddenError);

    const mine = await listVendorSessions(sql, va);
    expect(mine.map((x) => x.id)).toEqual([s.id]);
    expect(await listVendorSessions(sql, vendorActor('ZZ-VND-OTHER'))).toEqual([]);
    expect(await listVendorSessions(sql, am())).toEqual([]); // an employee Actor is never a vendor
  });
});
