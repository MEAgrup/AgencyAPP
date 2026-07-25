/**
 * Tests for M11 PM/Kanban (dependency.ts). Ported from Go's
 * backend/internal/module11_board/board_test.go.
 *
 * - Unit: the pure §5.2 Universal Column mappings, the §5.1 derived-status rule,
 *   the §6.1 create-authority predicate, and the §12 gate-message template.
 * - Integration (skipped unless DATABASE_URL is set): CreateDependency validation
 *   (same-Client, duplicate pair, cycle, type/self/entity, permission, immutable
 *   audit), the derived status over a Source's lifecycle, the Blocking-gate +
 *   DependencySatisfied emission wired into account.approveBrief, the implicit-M8
 *   guardrail-is-not-a-row invariant, My Tasks, and the Client Board.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { notification, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { approveBrief } from './account';
import { approveAsset } from './creative';
import {
  ACCOUNT_DIVISION,
  BlockedError,
  briefTaskUniversal,
  canCreateDependency,
  clientBoard,
  createDependency,
  derivedStatus,
  ForbiddenError,
  gateMessage,
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
  UC_AWAITING_REVIEW,
  UC_BLOCKED_REVISION,
  UC_DONE,
  UC_IN_PROGRESS,
  UC_TODO,
  ValidationError,
  type Actor,
  type DependencyInput,
} from './dependency';

// ---- actors ---------------------------------------------------------------

const director = (id = 'ZZ-DIR'): Actor => ({ employeeId: id, role: permission.makeRole({ director: true }) });
const accountLead = (id = 'ZZ-ALEAD'): Actor => ({ employeeId: id, role: permission.makeRole({ division: ACCOUNT_DIVISION, level: 'lead' }) });
const accountStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: ACCOUNT_DIVISION, level: 'staff' }) });
const divStaff = (division: string, id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division, level: 'staff' }) });
const odActor = (id = 'ZZ-OD'): Actor => ({ employeeId: id, role: permission.makeRole({ od: true }) });

// ===========================================================================
// Unit — pure functions (no DB).
// ===========================================================================

describe('derivedStatus (§5.1)', () => {
  it('Source terminal → Satisfied, regardless of type', () => {
    expect(derivedStatus('[Approved]', TYPE_BLOCKING)).toBe(STATUS_SATISFIED);
    expect(derivedStatus('[Approved]', TYPE_INFORMATIONAL)).toBe(STATUS_SATISFIED);
  });
  it('Blocking + Source started (not [To Do]) → Blocking', () => {
    expect(derivedStatus('[In Progress]', TYPE_BLOCKING)).toBe(STATUS_BLOCKING);
    expect(derivedStatus('[In Review]', TYPE_BLOCKING)).toBe(STATUS_BLOCKING);
  });
  it('not started, or Informational → Pending', () => {
    expect(derivedStatus('[To Do]', TYPE_BLOCKING)).toBe(STATUS_PENDING);
    expect(derivedStatus('[In Progress]', TYPE_INFORMATIONAL)).toBe(STATUS_PENDING);
    expect(derivedStatus('[To Do]', TYPE_INFORMATIONAL)).toBe(STATUS_PENDING);
  });
});

describe('Universal Column mapping (§5.2)', () => {
  it('briefTaskUniversal maps the §7 brief_task machine', () => {
    expect(briefTaskUniversal('[To Do]')).toBe(UC_TODO);
    expect(briefTaskUniversal('[In Progress]')).toBe(UC_IN_PROGRESS);
    expect(briefTaskUniversal('[Submitted]')).toBe(UC_AWAITING_REVIEW);
    expect(briefTaskUniversal('[In Review]')).toBe(UC_AWAITING_REVIEW);
    expect(briefTaskUniversal('[Revision Requested]')).toBe(UC_BLOCKED_REVISION);
    expect(briefTaskUniversal('[Blocked]')).toBe(UC_BLOCKED_REVISION);
    expect(briefTaskUniversal('[Approved]')).toBe(UC_DONE);
  });
  it('kolUniversal rolls up bookings worst-case (§2 Rule 3), excluding [Dropped]', () => {
    expect(kolUniversal([])).toBe(UC_TODO);
    expect(kolUniversal(['[Dropped]'])).toBe(UC_TODO);
    expect(kolUniversal(['[QC Passed]', '[QC Passed]'])).toBe(UC_DONE);
    expect(kolUniversal(['[QC Passed]', '[Escalated - Creator Unresponsive]'])).toBe(UC_BLOCKED_REVISION);
    expect(kolUniversal(['[QC Passed]', '[QC Failed - Revision Requested]'])).toBe(UC_BLOCKED_REVISION);
    expect(kolUniversal(['[Sourcing]', '[QC Passed]'])).toBe(UC_IN_PROGRESS);
    expect(kolUniversal(['[Content Submitted]', '[QC Passed]'])).toBe(UC_AWAITING_REVIEW);
    // [Dropped] excluded: an all-Dropped brief is To Do; a Passed + Dropped is Done.
    expect(kolUniversal(['[QC Passed]', '[Dropped]'])).toBe(UC_DONE);
  });
  it('lsUniversal + lsBriefUniversal roll up Sessions worst-case', () => {
    expect(lsUniversal('[Requested]')).toBe(UC_TODO);
    expect(lsUniversal('[Reconciled]')).toBe(UC_DONE);
    expect(lsUniversal('[Discrepancy Flagged]')).toBe(UC_BLOCKED_REVISION);
    expect(lsBriefUniversal([])).toBe(UC_TODO);
    expect(lsBriefUniversal(['[Reconciled]', '[Reconciled]'])).toBe(UC_DONE);
    expect(lsBriefUniversal(['[Reconciled]', '[Requested]'])).toBe(UC_TODO);
    // All done but one flagged → Blocked/Revision (non-blocking flag still shown).
    expect(lsBriefUniversal(['[Reconciled]', '[Discrepancy Flagged]'])).toBe(UC_BLOCKED_REVISION);
  });
});

describe('canCreateDependency (§6.1)', () => {
  it('Director, Account lead, and the owning AM are allowed; others denied', () => {
    expect(canCreateDependency(director(), 'ZZ-OWNER')).toBe(true);
    expect(canCreateDependency(accountLead(), 'ZZ-OWNER')).toBe(true);
    expect(canCreateDependency(accountStaff('ZZ-OWNER'), 'ZZ-OWNER')).toBe(true);
    expect(canCreateDependency(accountStaff('ZZ-OTHER'), 'ZZ-OWNER')).toBe(false);
    expect(canCreateDependency(divStaff('Creative', 'ZZ-C'), 'ZZ-OWNER')).toBe(false);
    expect(canCreateDependency(odActor(), 'ZZ-OWNER')).toBe(false);
    // An owning-AM match with no owner recorded is still denied.
    expect(canCreateDependency(accountStaff('ZZ-OWNER'), '')).toBe(false);
  });
});

describe('gateMessage (STATE_MACHINES §12)', () => {
  it('fills the target status and the source id list', () => {
    expect(gateMessage('[Approved]', ['BRF-SRC'])).toBe(
      'Brief ini belum bisa lanjut ke [Approved] karena menunggu BRF-SRC selesai Approved.',
    );
    expect(gateMessage('[Approved]', ['BRF-A', 'BRF-B'])).toContain('BRF-A, BRF-B');
  });
});

// ===========================================================================
// Integration — needs a Postgres with all migrations applied.
// ===========================================================================

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
const uid = (p: string): string => `${p}-ZZ-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, amId: string | null): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${amId}, 'ZZ-TEST')`;
}
async function insertService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Svc', '0.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
}
async function insertBrief(id: string, svcId: string, division: string, pic: string | null, status: string): Promise<void> {
  await sql`
    insert into briefs (id, service_id, assigned_division, assigned_pic, deliverable_type,
      quantity_target, due_date, priority, title, status, recurring, created_by)
    values (${id}, ${svcId}, ${division}, ${pic}, 'Deliverable', 1, '2026-08-30', 'High', 'Brief', ${status}, false, 'ZZ-TEST')`;
}
async function insertAsset(id: string, briefId: string, seqNo: number, pic: string | null, status: string): Promise<void> {
  await sql`
    insert into assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
    values (${id}, ${briefId}, 'Video', ${seqNo}, ${pic}, ${status}, 'ZZ-TEST')`;
}
async function insertBooking(id: string, briefId: string, coordinator: string | null, status: string): Promise<void> {
  await sql`
    insert into creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate,
      status, assigned_coordinator, created_by)
    values (${id}, ${briefId}, 'Creator', 'TikTok', 'Ad-hoc New', '0.00', ${status}, ${coordinator}, 'ZZ-TEST')`;
}
const briefStatus = async (id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from briefs where id = ${id}`)[0].status;
const setBriefStatus = async (id: string, status: string): Promise<void> => {
  await sql`update briefs set status = ${status} where id = ${id}`;
};
const depInput = (src: string, tgt: string, type = TYPE_BLOCKING): DependencyInput => ({ sourceId: src, targetId: tgt, type });
const notifCount = async (recipient: string): Promise<number> =>
  Number(
    (
      await sql<{ n: string }[]>`
        select count(*) as n from notifications
         where recipient_employee_id = ${recipient} and event_type = ${notification.EVENTS.DependencySatisfied}`
    )[0].n,
  );

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from dependencies where created_by like 'ZZ-%'`;
  await sql`delete from creator_bookings where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

describeDb('createDependency validation', () => {
  it('same-Client only: cross-Client rejected, same-Client cross-Service accepted (§2 Rule 4)', async () => {
    const cliA = uid('CLI');
    const cliB = uid('CLI');
    const svcA1 = uid('SVC');
    const svcA2 = uid('SVC');
    const svcB1 = uid('SVC');
    await insertClient(cliA, 'ZZ-AM');
    await insertClient(cliB, 'ZZ-AM');
    await insertService(svcA1, cliA);
    await insertService(svcA2, cliA);
    await insertService(svcB1, cliB);
    const a1 = uid('BRF');
    const a2 = uid('BRF');
    const b1 = uid('BRF');
    await insertBrief(a1, svcA1, 'Creative', 'ZZ-C', '[To Do]');
    await insertBrief(a2, svcA2, 'Ads', 'ZZ-AD', '[To Do]');
    await insertBrief(b1, svcB1, 'Ads', 'ZZ-AD', '[To Do]');

    await expect(createDependency(sql, director(), depInput(a1, b1))).rejects.toThrow(ValidationError);
    const dep = await createDependency(sql, director(), depInput(a1, a2));
    expect(dep.id).toMatch(/^DEP-\d{6}-\d{4}$/);
    expect(dep.clientId).toBe(cliA);
    expect(dep.status).toBe(STATUS_PENDING);
  });

  it('duplicate ordered pair rejected (§5.1)', async () => {
    const { b1, b2 } = await seedPair();
    await createDependency(sql, director(), depInput(b1, b2));
    await expect(createDependency(sql, director(), depInput(b1, b2))).rejects.toThrow(/sudah ada/);
  });

  it('cycles rejected: direct 2-cycle and 3-chain (§2 Rule 6)', async () => {
    const cli = uid('CLI');
    const svc = uid('SVC');
    await insertClient(cli, 'ZZ-AM');
    await insertService(svc, cli);
    const b1 = uid('BRF');
    const b2 = uid('BRF');
    const b3 = uid('BRF');
    for (const b of [b1, b2, b3]) {
      await insertBrief(b, svc, 'Creative', 'ZZ-C', '[To Do]');
    }
    await createDependency(sql, director(), depInput(b1, b2)); // A->B
    await expect(createDependency(sql, director(), depInput(b2, b1))).rejects.toThrow(/siklus/); // B->A
    await createDependency(sql, director(), depInput(b2, b3)); // B->C
    await expect(createDependency(sql, director(), depInput(b3, b1))).rejects.toThrow(/siklus/); // C->A closes loop
  });

  it('invalid type, self-reference, and non-Brief entity each rejected', async () => {
    const { b1, b2 } = await seedPair();
    await expect(createDependency(sql, director(), { sourceId: b1, targetId: b2, type: 'Blokir' })).rejects.toThrow(/tipe dependency/);
    await expect(createDependency(sql, director(), { sourceId: b1, targetId: b1, type: TYPE_BLOCKING })).rejects.toThrow(/Brief yang sama/);
    await expect(
      createDependency(sql, director(), { sourceId: b1, targetId: b2, type: TYPE_BLOCKING, sourceType: 'asset' }),
    ).rejects.toThrow(/antar Brief/);
  });

  it('only the owning AM, Account lead/SPV, or Director may declare a Dependency (§6.1)', async () => {
    const cli = uid('CLI');
    const svc = uid('SVC');
    await insertClient(cli, 'ZZ-OWNER');
    await insertService(svc, cli);
    const b1 = uid('BRF');
    const b2 = uid('BRF');
    await insertBrief(b1, svc, 'Creative', 'ZZ-C', '[To Do]');
    await insertBrief(b2, svc, 'Ads', 'ZZ-AD', '[To Do]');

    const cases: { actor: Actor; allow: boolean }[] = [
      { actor: accountStaff('ZZ-OWNER'), allow: true },
      { actor: accountLead(), allow: true },
      { actor: director(), allow: true },
      { actor: accountStaff('ZZ-OTHER'), allow: false },
      { actor: divStaff('Creative', 'ZZ-C'), allow: false },
      { actor: odActor(), allow: false },
    ];
    for (const c of cases) {
      await sql`delete from dependencies where created_by like 'ZZ-%'`; // fresh pair each subcase
      if (c.allow) {
        await expect(createDependency(sql, c.actor, depInput(b1, b2))).resolves.toBeTruthy();
      } else {
        await expect(createDependency(sql, c.actor, depInput(b1, b2))).rejects.toThrow(ForbiddenError);
      }
    }
  });

  it('create appends an immutable audit row; no update path (house rule 3)', async () => {
    const { b1, b2 } = await seedPair();
    const dep = await createDependency(sql, director(), depInput(b1, b2));
    const n = Number(
      (
        await sql<{ n: string }[]>`
          select count(*) as n from audit_log
           where entity_type = 'dependency' and entity_id = ${dep.id} and action = 'create'`
      )[0].n,
    );
    expect(n).toBe(1);
    // The append-only trigger forbids UPDATE of an audit row.
    await expect(sql`update audit_log set action = 'x' where entity_id = ${dep.id}`).rejects.toThrow();
  });
});

describeDb('derived status over the Source lifecycle (§5.1)', () => {
  it('Pending → Blocking → Satisfied; Informational never Blocking', async () => {
    const cli = uid('CLI');
    const svc = uid('SVC');
    await insertClient(cli, 'ZZ-AM');
    await insertService(svc, cli);
    const src = uid('BRF');
    const tgt = uid('BRF');
    await insertBrief(src, svc, 'Creative', 'ZZ-C', '[To Do]');
    await insertBrief(tgt, svc, 'Ads', 'ZZ-AD', '[To Do]');
    const dep = await createDependency(sql, director(), depInput(src, tgt));

    const check = async (want: string): Promise<void> => {
      expect((await getDependency(sql, director(), dep.id)).status).toBe(want);
    };
    await check(STATUS_PENDING);
    await setBriefStatus(src, '[In Progress]');
    await check(STATUS_BLOCKING);
    await setBriefStatus(src, '[Approved]');
    await check(STATUS_SATISFIED);

    const src2 = uid('BRF');
    const tgt2 = uid('BRF');
    await insertBrief(src2, svc, 'Creative', 'ZZ-C', '[In Progress]');
    await insertBrief(tgt2, svc, 'Ads', 'ZZ-AD', '[To Do]');
    const info = await createDependency(sql, director(), depInput(src2, tgt2, TYPE_INFORMATIONAL));
    expect(info.status).toBe(STATUS_PENDING);
  });
});

describeDb('Blocking gate + DependencySatisfied emission (via account.approveBrief)', () => {
  it('blocks the Target approval until the Source is terminal, then fires once and unblocks', async () => {
    const cli = uid('CLI');
    const svc = uid('SVC');
    await insertClient(cli, 'ZZ-AM');
    await insertService(svc, cli);
    const src = uid('BRF');
    const tgt = uid('BRF');
    const tgtPic = uid('EMP-TGT');
    // Source + Target are Ads Brief-as-tasks (single-unit, driven via the engine).
    await insertBrief(src, svc, 'Ads', uid('EMP-SRC'), '[To Do]');
    await insertBrief(tgt, svc, 'Ads', tgtPic, '[To Do]');
    const dep = await createDependency(sql, director(), depInput(src, tgt));

    // Park both at [In Review] (setup shortcut, as the Go test's setBriefStatus does):
    // the gate/emission under test both live on the AM's [In Review] → [Approved] edge,
    // and the division-side submit path (M8 campaign guard) is out of scope here.
    for (const b of [src, tgt]) {
      await setBriefStatus(b, '[In Review]');
    }

    // Gate: approving the Target is rejected with the §12 template message.
    await expect(approveBrief(sql, director(), tgt)).rejects.toThrow(BlockedError);
    try {
      await approveBrief(sql, director(), tgt);
    } catch (e) {
      expect((e as BlockedError).message).toBe(
        `Brief ini belum bisa lanjut ke [Approved] karena menunggu ${src} selesai Approved.`,
      );
    }

    // Approve the Source → Satisfied → DependencySatisfied fires to the Target PIC.
    await approveBrief(sql, director(), src);
    expect((await getDependency(sql, director(), dep.id)).status).toBe(STATUS_SATISFIED);
    expect(await notifCount(tgtPic)).toBe(1);

    // Fire-once: a re-run of the emission hook adds no second notification.
    await sql.begin(async (tx) => {
      await onBriefReachedTerminal(tx as unknown as Sql, director(), src);
    });
    expect(await notifCount(tgtPic)).toBe(1);

    // Now the Target's approval proceeds.
    await approveBrief(sql, director(), tgt);
    expect(await briefStatus(tgt)).toBe('[Approved]');
  });

  it('roll-up path defers silently: the Asset move commits, the Target Brief stays [In Review] (W3-M11-C1)', async () => {
    const cli = uid('CLI');
    const svc = uid('SVC');
    await insertClient(cli, 'ZZ-AM');
    await insertService(svc, cli);
    const src = uid('BRF');
    const tgt = uid('BRF'); // Creative Brief (Asset roll-up target)
    const tgtPic = uid('EMP-TGT');
    await insertBrief(src, svc, 'KOL', null, '[In Progress]'); // Source not terminal
    await insertBrief(tgt, svc, 'Creative', tgtPic, '[In Review]'); // parked mid-review
    const asset = uid('AST');
    await insertAsset(asset, tgt, 1, tgtPic, '[In Review]');
    const dep = await createDependency(sql, director(), depInput(src, tgt));

    // Approving the last Asset drives it → [Approved]; the roll-up would take the
    // Brief → [Approved] but the Blocking gate defers: no throw, Asset commits.
    await approveAsset(sql, director(), asset);
    expect(
      (await sql<{ status: string }[]>`select status from assets where id = ${asset}`)[0].status,
    ).toBe('[Approved]');
    expect(await briefStatus(tgt)).toBe('[In Review]'); // deferred, not [Approved]
    expect((await getDependency(sql, director(), dep.id)).status).toBe(STATUS_BLOCKING);
    expect(await notifCount(tgtPic)).toBe(0); // nothing fired — Brief not terminal yet

    // Satisfy the Source, then the AM's explicit approveBrief completes the Target.
    await setBriefStatus(src, '[Approved]');
    await approveBrief(sql, director(), tgt);
    expect(await briefStatus(tgt)).toBe('[Approved]');
  });
});

describeDb('implicit M8 dependency is never a row (§2 Rule 9 / §6.4)', () => {
  it('the built-in Asset→Launch guardrail does not appear as a DEP row', async () => {
    const cli = uid('CLI');
    const svc = uid('SVC');
    await insertClient(cli, 'ZZ-AM');
    await insertService(svc, cli);
    const crea = uid('BRF');
    const ads = uid('BRF');
    await insertBrief(crea, svc, 'Creative', 'ZZ-C', '[In Progress]');
    await insertBrief(ads, svc, 'Ads', 'ZZ-AD', '[In Progress]');
    const deps = await listDependencies(sql, director(), '', ads);
    expect(deps).toHaveLength(0);
  });
});

describeDb('My Tasks (§5.4)', () => {
  it('lists the actor own units across modules; excludes others; staff cannot read another', async () => {
    const cli = uid('CLI');
    const svc = uid('SVC');
    await insertClient(cli, 'ZZ-AM');
    await insertService(svc, cli);
    const me = uid('EMP-ME');
    const other = uid('EMP-OTHER');
    const adsBrief = uid('BRF');
    const creaBrief = uid('BRF');
    const kolBrief = uid('BRF');
    const otherBrief = uid('BRF');
    const asset = uid('AST');
    const booking = uid('BKG');
    await insertBrief(adsBrief, svc, 'Ads', me, '[In Progress]');
    await insertBrief(creaBrief, svc, 'Creative', other, '[In Progress]');
    await insertAsset(asset, creaBrief, 1, me, '[Submitted]');
    await insertBrief(kolBrief, svc, 'KOL', null, '[To Do]');
    await insertBooking(booking, kolBrief, me, '[Content In Progress]');
    await insertBrief(otherBrief, svc, 'Ads', other, '[In Progress]');

    const cards = await myTasks(sql, divStaff('Ads', me), '');
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.size).toBe(3);
    expect(byId.get(adsBrief)?.universalColumn).toBe(UC_IN_PROGRESS);
    expect(byId.get(asset)?.universalColumn).toBe(UC_AWAITING_REVIEW);
    expect(byId.get(booking)?.universalColumn).toBe(UC_IN_PROGRESS);
    expect(byId.has(otherBrief)).toBe(false);

    await expect(myTasks(sql, divStaff('Ads', me), other)).rejects.toThrow(ForbiddenError);
    const dir = await myTasks(sql, director(), other);
    expect(dir.length).toBeGreaterThan(0);
  });
});

describeDb('Client Board (§5.3)', () => {
  it('lists all Briefs with Universal Columns + Dependency badge; non-PIC staff denied', async () => {
    const cli = uid('CLI');
    const svc = uid('SVC');
    await insertClient(cli, 'ZZ-AM');
    await insertService(svc, cli);
    const crea = uid('BRF');
    const ads = uid('BRF');
    const src = uid('BRF');
    await insertBrief(crea, svc, 'Creative', 'ZZ-C', '[Approved]');
    await insertBrief(ads, svc, 'Ads', 'ZZ-AD', '[In Progress]');
    await insertBrief(src, svc, 'KOL', null, '[In Progress]');
    // Unsatisfied Blocking dep on the Ads target → badge.
    await createDependency(sql, director(), depInput(src, ads));

    const cards = await clientBoard(sql, accountLead(), cli);
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.get(crea)?.universalColumn).toBe(UC_DONE);
    expect(byId.get(ads)?.universalColumn).toBe(UC_IN_PROGRESS);
    expect(byId.get(ads)?.dependencyBadge).toBe('Menunggu Dependency');

    await expect(clientBoard(sql, divStaff('Ads', uid('EMP-NOBODY')), cli)).rejects.toThrow(ForbiddenError);
  });
});

/** seedPair creates one client + service + two Briefs for the simple validation tests. */
async function seedPair(): Promise<{ b1: string; b2: string }> {
  const cli = uid('CLI');
  const svc = uid('SVC');
  await insertClient(cli, 'ZZ-AM');
  await insertService(svc, cli);
  const b1 = uid('BRF');
  const b2 = uid('BRF');
  await insertBrief(b1, svc, 'Creative', 'ZZ-C', '[To Do]');
  await insertBrief(b2, svc, 'Ads', 'ZZ-AD', '[To Do]');
  return { b1, b2 };
}
