/**
 * Tests for M11 board.ts — the cross-Brief Dependency (DEP-), the Blocking gate +
 * DependencySatisfied emission (integrated through account.approveBrief), and the
 * Client Board / My Tasks read-models.
 *
 * - Unit: derivedStatus / canCreateDependency / the Universal Column mappers.
 * - Integration (skipped unless DATABASE_URL is set): create validation (same-Client,
 *   duplicate pair, cycle, type/self/entity, permission, immutable audit), derived
 *   status transitions, the gate + fire-once emission, the implicit-M8 non-row, and
 *   the two board read-models.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission, statemachine } from '@cdps/core';
import { createClient, executors, type Sql } from '@cdps/db';
import { account } from '.';
import {
  canCreateDependency,
  ConflictError,
  createDependency,
  clientBoard,
  briefTaskUniversal,
  derivedStatus,
  ForbiddenError,
  getDependency,
  kolUniversal,
  listDependencies,
  lsBriefUniversal,
  lsUniversal,
  myTasks,
  onBriefReachedTerminal,
  STATUS_BLOCKING,
  STATUS_PENDING,
  STATUS_SATISFIED,
  TYPE_BLOCKING,
  TYPE_INFORMATIONAL,
  UC_AWAITING_REV,
  UC_BLOCKED_REV,
  UC_DONE,
  UC_IN_PROGRESS,
  UC_TODO,
  ValidationError,
  type Actor,
} from './board';

const director = (id = 'ZZ-DIR'): Actor => ({ employeeId: id, divisi: 'Management', role: permission.makeRole({ director: true }) });
const accountLead = (id = 'ZZ-ALEAD'): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const accountStaff = (id: string): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const divStaff = (division: string, id: string): Actor => ({ employeeId: id, divisi: division, role: permission.makeRole({ division, level: 'staff' }) });
const od = (id = 'ZZ-OD'): Actor => ({ employeeId: id, divisi: 'Management', role: permission.makeRole({ od: true }) });

// ---------------------------------------------------------------------------
// Unit predicates (no DB).
// ---------------------------------------------------------------------------
describe('board predicates', () => {
  it('derivedStatus: Pending (not started) / Blocking (started + Blocking) / Satisfied (terminal)', () => {
    expect(derivedStatus('[To Do]', TYPE_BLOCKING)).toBe(STATUS_PENDING);
    expect(derivedStatus('[In Progress]', TYPE_BLOCKING)).toBe(STATUS_BLOCKING);
    expect(derivedStatus('[Approved]', TYPE_BLOCKING)).toBe(STATUS_SATISFIED);
    // Informational never shows Blocking even mid-flight.
    expect(derivedStatus('[In Progress]', TYPE_INFORMATIONAL)).toBe(STATUS_PENDING);
    expect(derivedStatus('[Approved]', TYPE_INFORMATIONAL)).toBe(STATUS_SATISFIED);
  });
  it('canCreateDependency: Director / Account lead / owning AM; not other AM, div staff, OD', () => {
    expect(canCreateDependency(director(), 'ZZ-OWNER')).toBe(true);
    expect(canCreateDependency(accountLead(), 'ZZ-OWNER')).toBe(true);
    expect(canCreateDependency(accountStaff('ZZ-OWNER'), 'ZZ-OWNER')).toBe(true); // owning AM
    expect(canCreateDependency(accountStaff('ZZ-OTHER'), 'ZZ-OWNER')).toBe(false);
    expect(canCreateDependency(divStaff('Creative', 'ZZ-C'), 'ZZ-OWNER')).toBe(false);
    expect(canCreateDependency(od(), 'ZZ-OWNER')).toBe(false);
  });
  it('briefTaskUniversal maps the §7 machine to Universal Columns', () => {
    expect(briefTaskUniversal('[To Do]')).toBe(UC_TODO);
    expect(briefTaskUniversal('[In Progress]')).toBe(UC_IN_PROGRESS);
    expect(briefTaskUniversal('[Submitted]')).toBe(UC_AWAITING_REV);
    expect(briefTaskUniversal('[In Review]')).toBe(UC_AWAITING_REV);
    expect(briefTaskUniversal('[Revision Requested]')).toBe(UC_BLOCKED_REV);
    expect(briefTaskUniversal('[Blocked]')).toBe(UC_BLOCKED_REV);
    expect(briefTaskUniversal('[Approved]')).toBe(UC_DONE);
  });
  it('kolUniversal rolls up worst-case; [Dropped] excluded', () => {
    expect(kolUniversal(['[Content In Progress]'])).toBe(UC_IN_PROGRESS);
    expect(kolUniversal(['[Content Submitted]'])).toBe(UC_AWAITING_REV);
    expect(kolUniversal(['[QC Passed]', '[QC Passed]'])).toBe(UC_DONE);
    expect(kolUniversal(['[QC Passed]', '[Escalated - Creator Unresponsive]'])).toBe(UC_BLOCKED_REV);
    expect(kolUniversal(['[QC Passed]', '[QC Failed - Revision Requested]'])).toBe(UC_BLOCKED_REV);
    expect(kolUniversal(['[Dropped]'])).toBe(UC_TODO); // no active work
  });
  it('lsUniversal + lsBriefUniversal roll up Live Stream sessions worst-case', () => {
    expect(lsUniversal('[Requested]')).toBe(UC_TODO);
    expect(lsUniversal('[Reconciled]')).toBe(UC_DONE);
    expect(lsUniversal('[Discrepancy Flagged]')).toBe(UC_BLOCKED_REV);
    expect(lsBriefUniversal(['[Reconciled]', '[Completed]'])).toBe(UC_AWAITING_REV); // worst-case
    expect(lsBriefUniversal(['[Reconciled]', '[Discrepancy Flagged]'])).toBe(UC_BLOCKED_REV);
    expect(lsBriefUniversal([])).toBe(UC_TODO);
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

async function insertClient(id: string, amId: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${amId === '' ? null : amId}, 'ZZ-TEST')`;
}
async function insertService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Svc', '0.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
}
async function insertBrief(id: string, svcId: string, division: string, pic: string, status: string): Promise<void> {
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, assigned_pic, deliverable_type,
      quantity_target, due_date, priority, recurring, created_by)
    values (${id}, ${svcId}, 'Brief', ${status}, ${division}, ${pic === '' ? null : pic}, 'Deliverable',
      1, '2026-08-30', 'High', false, 'ZZ-TEST')`;
}
async function insertAsset(id: string, briefId: string, seq: number, pic: string, status: string): Promise<void> {
  await sql`
    insert into assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
    values (${id}, ${briefId}, 'Video', ${seq}, ${pic === '' ? null : pic}, ${status}, 'ZZ-TEST')`;
}
async function insertBooking(id: string, briefId: string, coordinator: string, status: string): Promise<void> {
  await sql`
    insert into creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate,
      status, assigned_coordinator, created_by)
    values (${id}, ${briefId}, 'Creator', 'TikTok', 'Ad-hoc New', '0.00', ${status},
      ${coordinator === '' ? null : coordinator}, 'ZZ-TEST')`;
}
const setBriefStatus = async (id: string, status: string): Promise<void> => {
  await sql`update briefs set status = ${status} where id = ${id}`;
};
const briefStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from briefs where id = ${id}`)[0].status;
const depNotifCount = async (recipient: string): Promise<number> =>
  Number(
    (
      await sql<{ n: string }[]>`
        select count(*)::int as n from notifications
        where recipient_employee_id = ${recipient} and event_type = 'm11.dependency.satisfied'`
    )[0].n,
  );

/** driveBrief moves a Brief through the brief_task engine directly (test setup only). */
async function driveBrief(briefId: string, to: string, actor: Actor): Promise<void> {
  const res = await statemachine.transition(executors(sql).sm, {
    machine: 'brief_task', entityType: 'brief', table: 'briefs', entityId: briefId, to, actor,
  });
  if (!res.ok) {
    throw new Error(`drive ${briefId} -> ${to}: ${res.message}`);
  }
}

/** A client + service + two Briefs (BD-BRF-1, BD-BRF-2) for the simple validation tests. */
async function seedPair(): Promise<void> {
  await insertClient('BD-CLI-1', 'ZZ-AM');
  await insertService('BD-SVC-1', 'BD-CLI-1');
  await insertBrief('BD-BRF-1', 'BD-SVC-1', 'Creative', 'ZZ-C', '[To Do]');
  await insertBrief('BD-BRF-2', 'BD-SVC-1', 'Ads', 'ZZ-AD', '[To Do]');
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from dependencies`; // board owns this table exclusively in tests
  // notifications are never deletable (house rule #8 BEFORE DELETE trigger); the
  // emission test uses a unique recipient per run so counts never accumulate.
  await sql`delete from creator_bookings where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

describeDb('createDependency validations (§5.1 / §2)', () => {
  it('same-Client only: cross-Client rejected, same-Client (cross-Service) accepted', async () => {
    await insertClient('BD-CLI-A', 'ZZ-AM');
    await insertClient('BD-CLI-B', 'ZZ-AM');
    await insertService('BD-SVC-A1', 'BD-CLI-A');
    await insertService('BD-SVC-A2', 'BD-CLI-A');
    await insertService('BD-SVC-B1', 'BD-CLI-B');
    await insertBrief('BD-A1', 'BD-SVC-A1', 'Creative', 'ZZ-C', '[To Do]');
    await insertBrief('BD-A2', 'BD-SVC-A2', 'Ads', 'ZZ-AD', '[To Do]');
    await insertBrief('BD-B1', 'BD-SVC-B1', 'Ads', 'ZZ-AD', '[To Do]');

    await expect(
      createDependency(sql, director(), { sourceId: 'BD-A1', targetId: 'BD-B1', type: TYPE_BLOCKING }),
    ).rejects.toBeInstanceOf(ConflictError); // cross-Client
    const dep = await createDependency(sql, director(), { sourceId: 'BD-A1', targetId: 'BD-A2', type: TYPE_BLOCKING });
    expect(dep.id).toMatch(/^DEP-\d{6}-\d{4}$/);
    expect(dep.clientId).toBe('BD-CLI-A');
    expect(dep.status).toBe(STATUS_PENDING);
  });

  it('one active Dependency per ordered pair (duplicate rejected)', async () => {
    await seedPair();
    const input = { sourceId: 'BD-BRF-1', targetId: 'BD-BRF-2', type: TYPE_BLOCKING };
    await createDependency(sql, director(), input);
    await expect(createDependency(sql, director(), input)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a direct 2-cycle and a 3-chain cycle (§2 Rule 6)', async () => {
    await insertClient('BD-CLI-1', 'ZZ-AM');
    await insertService('BD-SVC-1', 'BD-CLI-1');
    for (const b of ['BD-BRF-1', 'BD-BRF-2', 'BD-BRF-3']) {
      await insertBrief(b, 'BD-SVC-1', 'Creative', 'ZZ-C', '[To Do]');
    }
    const mk = (src: string, tgt: string) => createDependency(sql, director(), { sourceId: src, targetId: tgt, type: TYPE_BLOCKING });
    await mk('BD-BRF-1', 'BD-BRF-2');
    await expect(mk('BD-BRF-2', 'BD-BRF-1')).rejects.toBeInstanceOf(ConflictError); // 2-cycle
    await mk('BD-BRF-2', 'BD-BRF-3');
    await expect(mk('BD-BRF-3', 'BD-BRF-1')).rejects.toBeInstanceOf(ConflictError); // 3-chain
  });

  it('rejects invalid type, self-reference, and a non-Brief entity', async () => {
    await seedPair();
    await expect(createDependency(sql, director(), { sourceId: 'BD-BRF-1', targetId: 'BD-BRF-2', type: 'Blokir' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createDependency(sql, director(), { sourceId: 'BD-BRF-1', targetId: 'BD-BRF-1', type: TYPE_BLOCKING })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createDependency(sql, director(), { sourceId: 'BD-BRF-1', targetId: 'BD-BRF-2', type: TYPE_BLOCKING, sourceType: 'asset' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('only owning AM / Account lead / Director may declare (§6.1)', async () => {
    await insertClient('BD-CLI-1', 'ZZ-OWNER');
    await insertService('BD-SVC-1', 'BD-CLI-1');
    await insertBrief('BD-BRF-1', 'BD-SVC-1', 'Creative', 'ZZ-C', '[To Do]');
    await insertBrief('BD-BRF-2', 'BD-SVC-1', 'Ads', 'ZZ-AD', '[To Do]');
    const input = { sourceId: 'BD-BRF-1', targetId: 'BD-BRF-2', type: TYPE_BLOCKING };
    for (const actor of [accountStaff('ZZ-OWNER'), accountLead(), director()]) {
      await sql`delete from dependencies`;
      await expect(createDependency(sql, actor, input)).resolves.toBeDefined();
    }
    await sql`delete from dependencies`;
    for (const actor of [accountStaff('ZZ-OTHER'), divStaff('Creative', 'ZZ-C'), od()]) {
      await expect(createDependency(sql, actor, input)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('appends an immutable create audit row (house rule 3); no mutation path', async () => {
    await seedPair();
    const dep = await createDependency(sql, director(), { sourceId: 'BD-BRF-1', targetId: 'BD-BRF-2', type: TYPE_BLOCKING });
    const n = Number(
      (await sql<{ n: string }[]>`
        select count(*)::int as n from audit_log where entity_type='dependency' and entity_id=${dep.id} and action='create'`)[0].n,
    );
    expect(n).toBe(1);
    // The append-only trigger forbids UPDATE of an audit row.
    await expect(sql`update audit_log set action='x' where entity_type='dependency' and entity_id=${dep.id}`).rejects.toBeDefined();
  });
});

describeDb('derived status transitions', () => {
  it('Pending → Blocking → Satisfied as the Source advances; Informational stays Pending', async () => {
    await insertClient('BD-CLI-1', 'ZZ-AM');
    await insertService('BD-SVC-1', 'BD-CLI-1');
    await insertBrief('BD-SRC', 'BD-SVC-1', 'Creative', 'ZZ-C', '[To Do]');
    await insertBrief('BD-TGT', 'BD-SVC-1', 'Ads', 'ZZ-AD', '[To Do]');
    const dep = await createDependency(sql, director(), { sourceId: 'BD-SRC', targetId: 'BD-TGT', type: TYPE_BLOCKING });

    const check = async (want: string) => {
      const got = await getDependency(sql, director(), dep.id);
      expect(got.status).toBe(want);
    };
    await check(STATUS_PENDING);
    await setBriefStatus('BD-SRC', '[In Progress]');
    await check(STATUS_BLOCKING);
    await setBriefStatus('BD-SRC', '[Approved]');
    await check(STATUS_SATISFIED);

    await insertBrief('BD-SRC2', 'BD-SVC-1', 'Creative', 'ZZ-C', '[In Progress]');
    await insertBrief('BD-TGT2', 'BD-SVC-1', 'Ads', 'ZZ-AD', '[To Do]');
    const info = await createDependency(sql, director(), { sourceId: 'BD-SRC2', targetId: 'BD-TGT2', type: TYPE_INFORMATIONAL });
    expect(info.status).toBe(STATUS_PENDING);
  });
});

describeDb('Blocking gate + fire-once emission (through account.approveBrief)', () => {
  it('gates the Target final edge while the Source is unfinished; approving the Source satisfies + notifies once', async () => {
    const tgtPic = `ZZ-TGT-${Date.now()}`; // unique per run — notifications are never deletable
    await insertClient('BD-CLI-1', 'ZZ-AM');
    await insertService('BD-SVC-1', 'BD-CLI-1');
    await insertBrief('BD-SRC', 'BD-SVC-1', 'Ads', 'ZZ-SRC-PIC', '[To Do]');
    await insertBrief('BD-TGT', 'BD-SVC-1', 'Ads', tgtPic, '[To Do]');
    const dep = await createDependency(sql, director(), { sourceId: 'BD-SRC', targetId: 'BD-TGT', type: TYPE_BLOCKING });

    // Both to [In Review] (working is NOT gated — only the final [Approved] edge, §2 Rule 7).
    for (const b of ['BD-SRC', 'BD-TGT']) {
      await driveBrief(b, '[In Progress]', divStaff('Ads', 'ZZ-X'));
      await driveBrief(b, '[Submitted]', divStaff('Ads', 'ZZ-X'));
      await driveBrief(b, '[In Review]', divStaff('Ads', 'ZZ-X'));
    }

    // Gate: approving the Target is rejected with the §12 template message.
    let msg = '';
    try {
      await account.approveBrief(sql, director(), 'BD-TGT');
      throw new Error('expected gate to block');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      msg = (e as Error).message;
    }
    expect(msg.startsWith('Brief ini belum bisa lanjut ke [Approved] karena menunggu ')).toBe(true);
    expect(msg).toContain('BD-SRC');
    expect(msg.endsWith('selesai Approved.')).toBe(true);

    // Approve the Source → Satisfied → EvDependencySatisfied fires once to the Target PIC.
    await account.approveBrief(sql, director(), 'BD-SRC');
    expect((await getDependency(sql, director(), dep.id)).status).toBe(STATUS_SATISFIED);
    expect(await depNotifCount(tgtPic)).toBe(1);

    // Fire-once: a re-run of the emission hook adds no second notification.
    await sql.begin(async (tx) => {
      await onBriefReachedTerminal(tx, director(), 'BD-SRC');
    });
    expect(await depNotifCount(tgtPic)).toBe(1);

    // Now the Target's approval proceeds.
    await account.approveBrief(sql, director(), 'BD-TGT');
    expect(await briefStatus('BD-TGT')).toBe('[Approved]');
  });
});

describeDb('implicit M8 dependency is never a row', () => {
  it('the built-in Asset→Launch guardrail is not a declared DEP row', async () => {
    await insertClient('BD-CLI-1', 'ZZ-AM');
    await insertService('BD-SVC-1', 'BD-CLI-1');
    await insertBrief('BD-CREA', 'BD-SVC-1', 'Creative', 'ZZ-C', '[In Progress]');
    await insertBrief('BD-ADS', 'BD-SVC-1', 'Ads', 'ZZ-AD', '[In Progress]');
    const deps = await listDependencies(sql, director(), '', 'BD-ADS');
    expect(deps.length).toBe(0);
  });
});

describeDb('My Tasks (§5.4)', () => {
  it('lists own units across modules with correct columns; excludes others; staff cannot read another', async () => {
    await insertClient('BD-CLI-1', 'ZZ-AM');
    await insertService('BD-SVC-1', 'BD-CLI-1');
    await insertBrief('BD-ADS', 'BD-SVC-1', 'Ads', 'ZZ-ME', '[In Progress]'); // Ads brief-as-task
    await insertBrief('BD-CREA', 'BD-SVC-1', 'Creative', 'ZZ-OTHER', '[In Progress]');
    await insertAsset('BD-AST-1', 'BD-CREA', 1, 'ZZ-ME', '[Submitted]'); // my Asset
    await insertBrief('BD-KOL', 'BD-SVC-1', 'KOL', '', '[To Do]');
    await insertBooking('BD-BKG-1', 'BD-KOL', 'ZZ-ME', '[Content In Progress]'); // my Booking
    await insertBrief('BD-OTHER', 'BD-SVC-1', 'Ads', 'ZZ-OTHER', '[In Progress]'); // someone else's

    const cards = await myTasks(sql, divStaff('Ads', 'ZZ-ME'), '');
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.size).toBe(3);
    expect(byId.get('BD-ADS')?.universalColumn).toBe(UC_IN_PROGRESS);
    expect(byId.get('BD-AST-1')?.universalColumn).toBe(UC_AWAITING_REV);
    expect(byId.get('BD-BKG-1')?.universalColumn).toBe(UC_IN_PROGRESS);
    expect(byId.has('BD-OTHER')).toBe(false);

    // A staff member cannot read another employee's tasks; a Director may.
    await expect(myTasks(sql, divStaff('Ads', 'ZZ-ME'), 'ZZ-OTHER')).rejects.toBeInstanceOf(ForbiddenError);
    const other = await myTasks(sql, director(), 'ZZ-OTHER');
    expect(other.length).toBeGreaterThan(0);
  });
});

describeDb('Client Board (§5.3)', () => {
  it('lists all Briefs with Universal Columns + Dependency badge; non-PIC staff denied', async () => {
    await insertClient('BD-CLI-1', 'ZZ-AM');
    await insertService('BD-SVC-1', 'BD-CLI-1');
    await insertBrief('BD-CREA', 'BD-SVC-1', 'Creative', 'ZZ-C', '[Approved]');
    await insertBrief('BD-ADS', 'BD-SVC-1', 'Ads', 'ZZ-AD', '[In Progress]');
    await insertBrief('BD-SRC', 'BD-SVC-1', 'KOL', '', '[In Progress]'); // unfinished Blocking source
    await createDependency(sql, director(), { sourceId: 'BD-SRC', targetId: 'BD-ADS', type: TYPE_BLOCKING });

    const cards = await clientBoard(sql, accountLead(), 'BD-CLI-1');
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.get('BD-CREA')?.universalColumn).toBe(UC_DONE);
    expect(byId.get('BD-ADS')?.universalColumn).toBe(UC_IN_PROGRESS);
    expect(byId.get('BD-ADS')?.dependencyBadge).toBe('Menunggu Dependency');

    // A staff member who is NOT PIC of any unit of this Client cannot read it.
    await expect(clientBoard(sql, divStaff('Ads', 'ZZ-NOBODY'), 'BD-CLI-1')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
