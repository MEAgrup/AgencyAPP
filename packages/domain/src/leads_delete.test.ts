/**
 * Tests for the M1 Head-gated lead delete door (owner decision 2026-07-29,
 * `docs/DECISIONS.md` — this is a logged PRD deviation, M1 has no delete door).
 *
 * - Unit: the two pure gates — `decideDeleteRequest` (what may be requested) and
 *   `canRequestDelete` (who may request it). Both decide BEFORE any DB access.
 * - Integration (skipped unless DATABASE_URL is set): the request → ACC vertical
 *   against a migrated Postgres, including the two claims that are easy to
 *   assert wrongly:
 *     · the Head gate lives in **SQL** (`require_lead` on every inbound edge), so
 *       a staff actor is refused by `sm_transition` itself and not merely by the
 *       TypeScript check in `approveDelete`;
 *     · a `[Deleted]` lead's row is never removed — the audit trail and the
 *       `PRSP-` children survive, and only `matchByPhone` steps over it.
 *
 * Namespaces actor ids with `ZZ-` and phones with a per-run suffix; afterEach
 * deletes the rows it made, children first for the FKs. audit_log /
 * notifications are append-only and left as harmless residue (house rule #3 —
 * there is deliberately no delete path for them to clean).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bi, permission, statemachine } from '@cdps/core';
import { createClient, executors, type Sql } from '@cdps/db';
import {
  type Actor,
  BlockedError,
  DELETE_APPROVED,
  DELETE_PENDING,
  DELETE_REJECTED,
  ForbiddenError,
  IncompleteError,
  LEAD_MACHINE,
  MSG_DELETE_ALREADY_PENDING,
  MSG_DELETE_ALREADY_RESOLVED,
  MSG_DELETE_CLIENT_BLOCKED,
  MSG_LEAD_DELETED,
  NotFoundError,
  RECORD_DELETED,
  approveDelete,
  canRequestDelete,
  decideDeleteRequest,
  deleteRequestQueue,
  get,
  leadsDatabase,
  matchByPhone,
  normalizePhone,
  register,
  rejectDelete,
  requestDelete,
} from './leads';

// Sales staff — the requester side of the door.
const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
// Another Sales staff, unconnected to the lead unless they claim it.
const andi = (): Actor => ({
  employeeId: 'ZZ-ANDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
// Sales Head — may ACC leads whose ORIGIN division is Sales.
const sitiHead = (): Actor => ({
  employeeId: 'ZZ-SITI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
// Marketing Head — may NOT ACC a Sales-origin lead.
const rinaHead = (): Actor => ({
  employeeId: 'ZZ-RINA', divisi: 'Marketing',
  role: permission.makeRole({ division: 'Marketing', level: 'lead' }),
});
// Director — Head authority everywhere.
const dirut = (): Actor => ({
  employeeId: 'ZZ-DIRUT', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'lead', director: true }),
});
// Read-only OD — never writes, whatever else is true.
const odOnly = (): Actor => ({
  employeeId: 'ZZ-OD', divisi: '',
  role: permission.makeRole({ division: '', level: 'staff', od: true }),
});

// ---------------------------------------------------------------------------
// Unit: decideDeleteRequest — WHAT may be requested.
// ---------------------------------------------------------------------------
describe('decideDeleteRequest', () => {
  it('an ordinary open lead may be requested', () => {
    const d = decideDeleteRequest({ recordStatus: 'active', winningAttemptId: null }, false);
    expect(d.outcome).toBe('request');
    expect(d.message).toBe('');
  });

  it('every non-terminal record status may be requested', () => {
    for (const rs of ['active', '[Pool]', '[Rejected]', '[Not Qualified]']) {
      expect(decideDeleteRequest({ recordStatus: rs }, false).outcome).toBe('request');
    }
  });

  it('a client ([Closed-Success]) is never deletable', () => {
    const d = decideDeleteRequest({ recordStatus: '[Closed-Success]', winningAttemptId: null }, false);
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_DELETE_CLIENT_BLOCKED);
  });

  it('a resolved winner is never deletable even if the status says otherwise', () => {
    // The money descendants hang off the winning attempt, so the attempt — not
    // the label — is what makes a lead undeletable.
    const d = decideDeleteRequest({ recordStatus: 'active', winningAttemptId: 'PRSP-202607-0001' }, false);
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_DELETE_CLIENT_BLOCKED);
  });

  it('an already-deleted record cannot be deleted twice', () => {
    const d = decideDeleteRequest({ recordStatus: RECORD_DELETED }, false);
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_LEAD_DELETED);
  });

  it('a second request while one is pending is refused', () => {
    const d = decideDeleteRequest({ recordStatus: 'active' }, true);
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_DELETE_ALREADY_PENDING);
  });

  it('the client block outranks a pending request (order matters)', () => {
    // A lead that became a client while a request sat pending must report the
    // client reason, not "already pending" — the latter reads as retryable.
    const d = decideDeleteRequest({ recordStatus: '[Closed-Success]' }, true);
    expect(d.message).toBe(MSG_DELETE_CLIENT_BLOCKED);
  });
});

// ---------------------------------------------------------------------------
// Unit: canRequestDelete — WHO may request it.
// ---------------------------------------------------------------------------
describe('canRequestDelete', () => {
  const salesLead = { createdBy: 'ZZ-BUDI', originDivision: 'Sales' };

  it('the creator may request', () => {
    expect(canRequestDelete(budi(), salesLead, false)).toBe(true);
  });

  it('a holder of an attempt on the lead may request', () => {
    expect(canRequestDelete(andi(), salesLead, true)).toBe(true);
  });

  it('an unconnected staff member may NOT request', () => {
    expect(canRequestDelete(andi(), salesLead, false)).toBe(false);
  });

  it('the Head of the origin division may request', () => {
    expect(canRequestDelete(sitiHead(), salesLead, false)).toBe(true);
  });

  it('a Head of a DIFFERENT division may not', () => {
    expect(canRequestDelete(rinaHead(), salesLead, false)).toBe(false);
  });

  it('Director may request anywhere', () => {
    expect(canRequestDelete(dirut(), { createdBy: 'ZZ-X', originDivision: 'Marketing' }, false)).toBe(true);
  });

  it('read-only OD may never request, even on a lead it created', () => {
    expect(canRequestDelete(odOnly(), { createdBy: 'ZZ-OD', originDivision: '' }, true)).toBe(false);
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

let phoneSeq = 0;
const uniquePhone = (): string => `0813${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(3, '0')}`;

afterAll(async () => {
  if (sql) await sql.end();
});

beforeEach(async () => {
  if (!sql) return;
  await sql`delete from lead_delete_requests where created_by like 'ZZ-%'`;
});

afterEach(async () => {
  if (!sql) return;
  // lead_delete_requests + prospect_attempts FK -> leads, so children first.
  await sql`delete from lead_delete_requests where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempt_nq_reasons where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
});

/** Register a plain Sales-origin lead owned by Budi; return its ids. */
async function seedLead(name = 'Hapus Coba'): Promise<{ leadId: string; attemptId: string; phone: string }> {
  const phone = uniquePhone();
  const { lead, attempt } = await register(sql, budi(), {
    leadName: name, phoneNumber: phone, source: 'Scouting',
  });
  return { leadId: lead.id, attemptId: attempt.id, phone };
}

describeDb('requestDelete — AJUKAN', () => {
  it('mints LDR-, stays pending, audits on the lead, and does NOT move the lead', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, '  lead uji coba  ');

    expect(req.id).toMatch(/^LDR-\d{6}-\d{4}$/);
    expect(req.status).toBe(DELETE_PENDING);
    expect(req.reason).toBe('lead uji coba'); // trimmed
    expect(req.requestedBy).toBe('ZZ-BUDI');
    expect(req.resolvedBy).toBe('');
    expect(req.resolvedAt).toBeNull();

    // The lead itself is untouched — AJUKAN is not a status change.
    const detail = await get(sql, leadId);
    expect(detail.recordStatus).toBe('active');

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_id = ${leadId} and action = 'delete_requested'`;
    expect(audit[0].n).toBe(1);
  });

  it('notifies the Heads of the lead origin division so the ACC queue is not polled', async () => {
    const { leadId } = await seedLead();
    await requestDelete(sql, budi(), leadId, 'duplikat');
    const notif = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
      where entity_id = ${leadId} and event_type = 'm1.lead.delete_requested'`;
    expect(notif[0].n).toBeGreaterThan(0);
  });

  it('an empty / whitespace-only reason is refused BEFORE an id is minted', async () => {
    const { leadId } = await seedLead();
    for (const reason of ['', '   ']) {
      await expect(requestDelete(sql, budi(), leadId, reason)).rejects.toBeInstanceOf(IncompleteError);
    }
    await expect(requestDelete(sql, budi(), leadId, '')).rejects.toThrow(bi.INCOMPLETE_DATA);

    // House rule #1: no LDR- id burned on a request that never validated.
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from lead_delete_requests where lead_id = ${leadId}`;
    expect(rows[0].n).toBe(0);
  });

  it('an unconnected staff member is refused (403), and no request row appears', async () => {
    const { leadId } = await seedLead();
    await expect(requestDelete(sql, andi(), leadId, 'bukan lead saya')).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from lead_delete_requests where lead_id = ${leadId}`;
    expect(rows[0].n).toBe(0);
  });

  it('read-only OD is refused', async () => {
    const { leadId } = await seedLead();
    await expect(requestDelete(sql, odOnly(), leadId, 'coba')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('an unknown lead is 404', async () => {
    await expect(requestDelete(sql, budi(), 'LEAD-209901-9999', 'coba')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a second pending request is blocked, and the refusal is AUDITED', async () => {
    const { leadId } = await seedLead();
    await requestDelete(sql, budi(), leadId, 'pertama');
    await expect(requestDelete(sql, budi(), leadId, 'kedua')).rejects.toThrow(MSG_DELETE_ALREADY_PENDING);

    // Still exactly one queue row (the uq_ldr_one_pending contract), and the
    // block committed its audit row rather than rolling back with the throw.
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from lead_delete_requests where lead_id = ${leadId}`;
    expect(rows[0].n).toBe(1);
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_id = ${leadId} and action = 'delete_request_blocked'`;
    expect(audit[0].n).toBe(1);
  });

  it('uq_ldr_one_pending forbids a second pending row at the INDEX, not just in code', async () => {
    const { leadId } = await seedLead();
    const first = await requestDelete(sql, budi(), leadId, 'pertama');
    // Bypass the domain entirely — this is what a racing pair of transactions
    // would attempt after both passed the application-level count check.
    await expect(sql`
      insert into lead_delete_requests (id, lead_id, reason, status, requested_by, created_by)
      values ('LDR-209901-9999', ${leadId}, 'balapan', 'pending', 'ZZ-BUDI', 'ZZ-BUDI')`,
    ).rejects.toThrow(/uq_ldr_one_pending/);

    // A REJECTED row does not occupy the slot — the index is partial.
    await rejectDelete(sql, sitiHead(), first.id, 'tidak perlu');
    const second = await requestDelete(sql, budi(), leadId, 'kedua, setelah ditolak');
    expect(second.status).toBe(DELETE_PENDING);
  });

  it('a lead that is already a client cannot be requested by anyone, Director included', async () => {
    const { leadId, attemptId } = await seedLead();
    await sql`
      update leads set record_status = '[Closed-Success]', winning_attempt_id = ${attemptId}
      where id = ${leadId}`;
    await expect(requestDelete(sql, budi(), leadId, 'coba')).rejects.toThrow(MSG_DELETE_CLIENT_BLOCKED);
    await expect(requestDelete(sql, dirut(), leadId, 'coba')).rejects.toThrow(MSG_DELETE_CLIENT_BLOCKED);
  });
});

describeDb('approveDelete — ACC Head', () => {
  it('drives the lead to [Deleted], resolves the request, audits, and notifies the requester', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'lead uji coba');
    const { request, transition } = await approveDelete(sql, sitiHead(), req.id, '  disetujui  ');

    expect(transition?.ok).toBe(true);
    expect(request.status).toBe(DELETE_APPROVED);
    expect(request.resolvedBy).toBe('ZZ-SITI');
    expect(request.resolvedAt).not.toBeNull();
    expect(request.decisionNote).toBe('disetujui'); // trimmed

    const detail = await get(sql, leadId);
    expect(detail.recordStatus).toBe(RECORD_DELETED);

    // The status write went through the transition engine, so there is a
    // transition audit row on top of the approval one (house rules #2 + #3).
    // sm_transition names the EDGE it traversed, so this also pins down which
    // one was used — a raw update would leave no such row at all.
    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${leadId} order by id`;
    expect(audit.map((a) => a.action)).toContain('delete_request_approved');
    expect(audit.map((a) => a.action)).toContain(`transition:active->${RECORD_DELETED}`);

    const notif = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
      where entity_id = ${leadId} and event_type = 'm1.lead.delete_decided'
        and recipient_employee_id = 'ZZ-BUDI'`;
    expect(notif[0].n).toBe(1);
  });

  it('the lead ROW and its PRSP children survive — nothing is destroyed', async () => {
    const { leadId, attemptId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await approveDelete(sql, sitiHead(), req.id);

    const lead = await sql<{ id: string; record_status: string }[]>`
      select id, record_status from leads where id = ${leadId}`;
    expect(lead).toHaveLength(1);
    expect(lead[0].record_status).toBe(RECORD_DELETED);

    const attempt = await sql<{ n: number }[]>`
      select count(*)::int as n from prospect_attempts where id = ${attemptId}`;
    expect(attempt[0].n).toBe(1);
  });

  it('Director may ACC a lead outside their own division', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    const { transition } = await approveDelete(sql, dirut(), req.id);
    expect(transition?.ok).toBe(true);
    expect((await get(sql, leadId)).recordStatus).toBe(RECORD_DELETED);
  });

  it('a Head of a DIFFERENT division is refused, and the request stays pending', async () => {
    const { leadId } = await seedLead(); // origin_division = Sales
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await expect(approveDelete(sql, rinaHead(), req.id)).rejects.toBeInstanceOf(ForbiddenError);

    const rows = await sql<{ status: string }[]>`
      select status from lead_delete_requests where id = ${req.id}`;
    expect(rows[0].status).toBe(DELETE_PENDING);
    expect((await get(sql, leadId)).recordStatus).toBe('active');
  });

  it('the requesting staff member cannot ACC their own request', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await expect(approveDelete(sql, budi(), req.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await get(sql, leadId)).recordStatus).toBe('active');
  });

  it('a request already decided answers [permintaan hapus sudah diputuskan]', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await approveDelete(sql, sitiHead(), req.id);
    await expect(approveDelete(sql, sitiHead(), req.id)).rejects.toThrow(MSG_DELETE_ALREADY_RESOLVED);
    await expect(rejectDelete(sql, sitiHead(), req.id)).rejects.toThrow(MSG_DELETE_ALREADY_RESOLVED);
    void leadId;
  });

  it('an unknown request id is 404', async () => {
    await expect(approveDelete(sql, sitiHead(), 'LDR-209901-9999')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// The gate is in SQL, not only in TypeScript.
//
// `approveDelete` checks `permission.isLead` and throws before it ever reaches
// the engine, so the tests above prove the TS half only. The claim that matters
// for the owner decision is stronger: every inbound edge to `[Deleted]` carries
// `require_lead = true`, so a staff actor is refused by `sm_transition` ITSELF.
// That is what stops a direct service-role call from routing around the ACC.
// These tests therefore call the engine directly, bypassing the domain.
// ---------------------------------------------------------------------------
describeDb('[Deleted] edges — sm_transition refuses staff on its own', () => {
  it('staff calling sm_transition directly is refused with role_denied', async () => {
    const { leadId } = await seedLead();
    const result = await statemachine.transition(executors(sql).sm, {
      machine: LEAD_MACHINE, entityType: 'lead', table: 'leads',
      statusColumn: 'record_status', entityId: leadId, to: RECORD_DELETED,
      actor: budi(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('role_denied');
      expect(result.message).toBe(bi.TRANSITION_ROLE_DENIED);
    }
    // And the lead did not move.
    expect((await get(sql, leadId)).recordStatus).toBe('active');
  });

  it('a Head calling the same transition is allowed', async () => {
    const { leadId } = await seedLead();
    const result = await statemachine.transition(executors(sql).sm, {
      machine: LEAD_MACHINE, entityType: 'lead', table: 'leads',
      statusColumn: 'record_status', entityId: leadId, to: RECORD_DELETED,
      actor: sitiHead(),
    });
    expect(result.ok).toBe(true);
    expect((await get(sql, leadId)).recordStatus).toBe(RECORD_DELETED);
  });

  it('[Deleted] is TERMINAL — there is no edge back out, for anyone', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await approveDelete(sql, sitiHead(), req.id);

    // Even a Director cannot un-delete: restore is a different design and needs
    // its own decision (DECISIONS.md 2026-07-29).
    for (const to of ['active', '[Pool]', '[Rejected]']) {
      const result = await statemachine.transition(executors(sql).sm, {
        machine: LEAD_MACHINE, entityType: 'lead', table: 'leads',
        statusColumn: 'record_status', entityId: leadId, to, actor: dirut(),
      });
      expect(result.ok).toBe(false);
    }
    expect((await get(sql, leadId)).recordStatus).toBe(RECORD_DELETED);
  });

  it('[Closed-Success] has no edge to [Deleted] even for a Director', async () => {
    const { leadId, attemptId } = await seedLead();
    await sql`
      update leads set record_status = '[Closed-Success]', winning_attempt_id = ${attemptId}
      where id = ${leadId}`;
    const result = await statemachine.transition(executors(sql).sm, {
      machine: LEAD_MACHINE, entityType: 'lead', table: 'leads',
      statusColumn: 'record_status', entityId: leadId, to: RECORD_DELETED,
      actor: dirut(),
    });
    expect(result.ok).toBe(false);
    expect((await get(sql, leadId)).recordStatus).toBe('[Closed-Success]');
  });
});

describeDb('rejectDelete — Head menolak', () => {
  it('resolves the request and leaves the lead exactly as it was', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    const { request } = await rejectDelete(sql, sitiHead(), req.id, 'masih dipakai');

    expect(request.status).toBe(DELETE_REJECTED);
    expect(request.resolvedBy).toBe('ZZ-SITI');
    expect(request.decisionNote).toBe('masih dipakai');
    expect((await get(sql, leadId)).recordStatus).toBe('active');

    // No transition audit row at all: nothing about the lead's status moved.
    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${leadId}`;
    expect(audit.map((a) => a.action)).toContain('delete_request_rejected');
    expect(audit.filter((a) => a.action.startsWith('transition:'))).toEqual([]);
  });

  it('notifies the requester through the same event both verdicts use', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await rejectDelete(sql, sitiHead(), req.id);
    const notif = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
      where entity_id = ${leadId} and event_type = 'm1.lead.delete_decided'
        and recipient_employee_id = 'ZZ-BUDI'`;
    expect(notif[0].n).toBe(1);
  });

  it('a Head of a different division cannot reject either', async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await expect(rejectDelete(sql, rinaHead(), req.id)).rejects.toBeInstanceOf(ForbiddenError);
    void leadId;
  });
});

// ---------------------------------------------------------------------------
// The consequences of `[Deleted]` on the surrounding reads — the part of this
// feature most likely to break something else, because a terminal state has no
// legal next step.
// ---------------------------------------------------------------------------
describeDb('[Deleted] consequences on reads', () => {
  it('matchByPhone STEPS OVER a deleted row so intake keeps a legal move', async () => {
    const { leadId, phone } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await approveDelete(sql, sitiHead(), req.id);

    // Without the exclusion, intake would match a lead that has no outbound
    // edge at all, and registering that phone again would be impossible.
    expect(await matchByPhone(sql, normalizePhone(phone))).toBeNull();

    // So the same number registers cleanly as a NEW lead.
    const again = await register(sql, budi(), { leadName: 'Datang Lagi', phoneNumber: phone });
    expect(again.lead.id).not.toBe(leadId);
    expect(again.lead.recordStatus).toBe('active');
  });

  it('leadsDatabase hides deleted rows by default but returns them when asked', async () => {
    const { leadId } = await seedLead('Sembunyi Coba');
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await approveDelete(sql, sitiHead(), req.id);

    const unfiltered = await leadsDatabase(sql, {});
    expect(unfiltered.map((r) => r.id)).not.toContain(leadId);

    const asked = await leadsDatabase(sql, { status: RECORD_DELETED });
    expect(asked.map((r) => r.id)).toContain(leadId);

    // And it is never unreachable: by-id still resolves.
    expect((await get(sql, leadId)).id).toBe(leadId);
  });
});

describeDb('deleteRequestQueue — antrian ACC', () => {
  it('defaults to pending only, newest first', async () => {
    const a = await seedLead('Antri A');
    const b = await seedLead('Antri B');
    const reqA = await requestDelete(sql, budi(), a.leadId, 'A');
    const reqB = await requestDelete(sql, budi(), b.leadId, 'B');
    await rejectDelete(sql, sitiHead(), reqA.id);

    const pending = await deleteRequestQueue(sql);
    const ids = pending.map((r) => r.id);
    expect(ids).toContain(reqB.id);
    expect(ids).not.toContain(reqA.id); // decided, so out of the actionable set
  });

  it("status:'' returns every status; an explicit status filters to it", async () => {
    const { leadId } = await seedLead();
    const req = await requestDelete(sql, budi(), leadId, 'coba');
    await rejectDelete(sql, sitiHead(), req.id, 'tidak');

    const all = await deleteRequestQueue(sql, { status: '' });
    expect(all.map((r) => r.id)).toContain(req.id);

    const rejected = await deleteRequestQueue(sql, { status: DELETE_REJECTED });
    expect(rejected.map((r) => r.id)).toContain(req.id);

    const approved = await deleteRequestQueue(sql, { status: DELETE_APPROVED });
    expect(approved.map((r) => r.id)).not.toContain(req.id);
  });

  it('joins the lead and carries the origin division the Head gate is judged on', async () => {
    const { leadId } = await seedLead('Gabung Coba');
    const req = await requestDelete(sql, budi(), leadId, 'alasannya');

    const rows = await deleteRequestQueue(sql, { leadId, status: '' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(req.id);
    expect(rows[0].leadName).toBe('Gabung Coba');
    expect(rows[0].originDivision).toBe('Sales');
    expect(rows[0].recordStatus).toBe('active');
    expect(rows[0].reason).toBe('alasannya');
    // No employees row for ZZ-BUDI, so the join falls back to the id rather
    // than dropping the row (coalesce, not an inner join).
    expect(rows[0].requestedByNama).toBe('ZZ-BUDI');
    expect(rows[0].resolvedByNama).toBe('');
  });

  it('scopes to one lead when leadId is given', async () => {
    const a = await seedLead('Satu');
    const b = await seedLead('Dua');
    const reqA = await requestDelete(sql, budi(), a.leadId, 'A');
    await requestDelete(sql, budi(), b.leadId, 'B');

    const rows = await deleteRequestQueue(sql, { leadId: a.leadId, status: '' });
    expect(rows.map((r) => r.id)).toEqual([reqA.id]);
  });
});
