/**
 * Tests for the prospect activity log (ACT-, keputusan pemilik 2026-08-06).
 *
 * The pure gates (`isKnownType` / `isAllowedStage`) run everywhere; the write
 * door + rollups need a DB and skip unless DATABASE_URL is set, exactly like
 * `leads_reads.test.ts`. Rows here use their OWN actor prefix `ZACT-` rather than
 * the shared `ZZ-`: vitest runs suites in PARALLEL against one database, and a
 * sibling suite's `delete from prospect_attempts where created_by like 'ZZ-%'`
 * would hit an attempt this suite still has an (undeletable) activity row on —
 * an FK violation in a test that has nothing to do with activities.
 *
 * What is asserted deliberately:
 *   - the STAGE gate (this is the rule the owner asked for — effort is logged
 *     from Qualified onward, never before and never after closing);
 *   - the mandatory ringkasan (a log entry without an outcome summary is the one
 *     thing that would make the whole feature worthless);
 *   - IMMUTABILITY at the DB level, not merely "the API has no edit route" —
 *     house rule #3 is only real if the trigger refuses;
 *   - the rollup being RECOMPUTED (house rule #4), including per-type counts.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { permission } from '@cdps/core';
import {
  ACTIVITY_TYPES,
  ForbiddenError,
  IncompleteError,
  MSG_ACTIVITY_STAGE,
  NotFoundError,
  StageError,
  effortByAttempt,
  effortCounts,
  isAllowedStage,
  isKnownType,
  listByAttempt,
  listByLead,
  log,
  type Actor,
} from './activity';
import { register } from './leads';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const budi = (): Actor => ({
  employeeId: 'ZACT-BUDI',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const andi = (): Actor => ({
  employeeId: 'ZACT-ANDI',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

let phoneSeq = 0;
const uniquePhone = (): string => `0817${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(3, '0')}`;

afterAll(async () => {
  if (sql) await sql.end();
});

/**
 * Cleanup has to STEP AROUND the immutability trigger, and that is the point:
 * `prospect_activities` genuinely refuses DELETE, so a test fixture cannot tidy
 * up the way it can for a mutable table. The rows also carry FKs to leads and
 * attempts, so leaving them behind would block this suite's own teardown —
 * hence disable → delete → re-enable, run as the owning (superuser) test role.
 */
async function purgeActivities(): Promise<void> {
  await sql`alter table prospect_activities disable trigger prospect_activities_no_delete`;
  try {
    await sql`delete from prospect_activities where created_by like 'ZACT-%'`;
  } finally {
    await sql`alter table prospect_activities enable trigger prospect_activities_no_delete`;
  }
}

afterEach(async () => {
  if (!sql) return;
  await purgeActivities();
  await sql`delete from prospect_attempts where created_by like 'ZACT-%'`;
  await sql`delete from leads where created_by like 'ZACT-%'`;
});

/**
 * Registers a lead and forces its attempt to `status`. The status is written
 * directly (not through the engine) ON PURPOSE: this suite is about the activity
 * log, and driving a real attempt from New Lead to Qualified would drag in the
 * whole Qualified Lead Form + MSL pricing path, testing that instead of this.
 */
async function attemptAt(status: string): Promise<{ attemptId: string; leadId: string }> {
  const { lead, attempt } = await register(sql, budi(), {
    leadName: 'Aktivitas Co', phoneNumber: uniquePhone(), source: 'Scouting',
  });
  await sql`update prospect_attempts set status = ${status} where id = ${attempt.id}`;
  return { attemptId: attempt.id, leadId: lead.id };
}

describe('pure gates', () => {
  it('accepts exactly the closed taxonomy', () => {
    for (const t of ACTIVITY_TYPES) {
      expect(isKnownType(t)).toBe(true);
    }
    expect(isKnownType('Telepon')).toBe(false);
    expect(isKnownType('')).toBe(false);
  });

  it('allows Qualified and the negotiation states, and nothing before or after', () => {
    expect(isAllowedStage('Qualified')).toBe(true);
    expect(isAllowedStage('Negotiation - Pending Approval')).toBe(true);
    expect(isAllowedStage('Negotiation - Approved')).toBe(true);
    expect(isAllowedStage('Negotiation - Auto Approved')).toBe(true);
    // Sebelum Qualified: effort pra-Qualified sudah diringkas transisi Contacted.
    expect(isAllowedStage('New Lead')).toBe(false);
    expect(isAllowedStage('Contacted')).toBe(false);
    // Terminal: prospek selesai, dan menambah effort akan mengubah metrik
    // "effort sampai closing" yang seharusnya sudah final.
    expect(isAllowedStage('Closed-Success')).toBe(false);
    expect(isAllowedStage('Closed-Lost')).toBe(false);
    expect(isAllowedStage('Not Qualified')).toBe(false);
    expect(isAllowedStage('[Closed - Kalah Kompetisi]')).toBe(false);
  });
});

describeDb('log', () => {
  it('records an activity on a Qualified attempt and returns it', async () => {
    const { attemptId, leadId } = await attemptAt('Qualified');
    const a = await log(sql, budi(), attemptId, {
      activityType: 'Visit', summary: 'Visit ke gudang, minta penawaran ulang',
    });
    expect(a.id.startsWith('ACT-')).toBe(true);
    expect(a.attemptId).toBe(attemptId);
    expect(a.leadId).toBe(leadId);
    expect(a.activityType).toBe('Visit');

    const rows = await listByAttempt(sql, attemptId);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe('Visit ke gudang, minta penawaran ulang');
  });

  it('allows MANY activities on one attempt (1 klien bisa lebih dari 1x)', async () => {
    const { attemptId } = await attemptAt('Qualified');
    await log(sql, budi(), attemptId, { activityType: 'Follow Up', summary: 'chat pertama' });
    await log(sql, budi(), attemptId, { activityType: 'Jadwal Meeting', summary: 'set meeting Kamis' });
    await log(sql, budi(), attemptId, { activityType: 'Visit', summary: 'visit 1' });
    await log(sql, budi(), attemptId, { activityType: 'Visit', summary: 'visit 2' });

    const effort = await effortByAttempt(sql, attemptId);
    expect(effort.total).toBe(4);
    expect(effort.byType['Visit']).toBe(2);
    expect(effort.byType['Follow Up']).toBe(1);
    expect(effort.lastActivityAt).not.toBeNull();
  });

  it('refuses an attempt that has not reached Qualified, with the verbatim BI message', async () => {
    const { attemptId } = await attemptAt('Contacted');
    await expect(
      log(sql, budi(), attemptId, { activityType: 'Visit', summary: 'terlalu dini' }),
    ).rejects.toBeInstanceOf(StageError);
    await expect(
      log(sql, budi(), attemptId, { activityType: 'Visit', summary: 'terlalu dini' }),
    ).rejects.toThrow(MSG_ACTIVITY_STAGE);
    expect(await listByAttempt(sql, attemptId)).toHaveLength(0);
  });

  it('refuses a closed attempt (effort-to-closing is settled)', async () => {
    const { attemptId } = await attemptAt('Closed-Success');
    await expect(
      log(sql, budi(), attemptId, { activityType: 'Follow Up', summary: 'terlambat' }),
    ).rejects.toBeInstanceOf(StageError);
  });

  it('refuses a missing ringkasan and an unknown activity type', async () => {
    const { attemptId } = await attemptAt('Qualified');
    await expect(
      log(sql, budi(), attemptId, { activityType: 'Visit', summary: '   ' }),
    ).rejects.toBeInstanceOf(IncompleteError);
    await expect(
      log(sql, budi(), attemptId, { activityType: 'Telepon', summary: 'ada isinya' }),
    ).rejects.toBeInstanceOf(IncompleteError);
    expect(await listByAttempt(sql, attemptId)).toHaveLength(0);
  });

  it('refuses an unparseable occurred_at rather than silently defaulting to now', async () => {
    const { attemptId } = await attemptAt('Qualified');
    await expect(
      log(sql, budi(), attemptId, { activityType: 'Visit', summary: 'x', occurredAt: 'kemarin' }),
    ).rejects.toBeInstanceOf(IncompleteError);
  });

  it('refuses another salesperson writing on an attempt that is not theirs', async () => {
    const { attemptId } = await attemptAt('Qualified');
    await expect(
      log(sql, andi(), attemptId, { activityType: 'Visit', summary: 'bukan punya saya' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('admits the Sales Lead (division-wide write authority)', async () => {
    const { attemptId } = await attemptAt('Qualified');
    const spv: Actor = {
      employeeId: 'ZACT-SPV', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
    };
    const a = await log(sql, spv, attemptId, { activityType: 'Online Meeting', summary: 'ikut zoom' });
    expect(a.createdBy).toBe('ZACT-SPV');
  });

  it('404s on an unknown attempt', async () => {
    await expect(
      log(sql, budi(), 'PRSP-000000-0000', { activityType: 'Visit', summary: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('burns no ACT sequence number when the gate refuses', async () => {
    const { attemptId } = await attemptAt('Contacted');
    const before = await sql<{ next_n: number }[]>`
      select next_n from id_sequences where prefix = 'ACT' order by period desc limit 1`;
    await expect(
      log(sql, budi(), attemptId, { activityType: 'Visit', summary: 'ditolak' }),
    ).rejects.toBeInstanceOf(StageError);
    const after = await sql<{ next_n: number }[]>`
      select next_n from id_sequences where prefix = 'ACT' order by period desc limit 1`;
    expect(after[0]?.next_n ?? 0).toBe(before[0]?.next_n ?? 0);
  });
});

describeDb('immutability (house rule #3)', () => {
  it('refuses UPDATE and DELETE at the trigger, not merely in the API surface', async () => {
    const { attemptId } = await attemptAt('Qualified');
    const a = await log(sql, budi(), attemptId, { activityType: 'Visit', summary: 'asli' });
    await expect(
      sql`update prospect_activities set summary = 'diubah' where id = ${a.id}`,
    ).rejects.toThrow();
    await expect(sql`delete from prospect_activities where id = ${a.id}`).rejects.toThrow();
    const rows = await listByAttempt(sql, attemptId);
    expect(rows[0].summary).toBe('asli');
    // (afterEach purges through the same trigger-bypass door.)
  });
});

describeDb('reads', () => {
  it('listByLead spans every attempt on the lead (contested effort)', async () => {
    const { lead, attempt } = await register(sql, budi(), {
      leadName: 'Kontes Co', phoneNumber: uniquePhone(), source: 'Scouting',
    });
    const second = await register(sql, andi(), {
      leadName: 'Kontes Co', phoneNumber: lead.phoneNumber, source: 'Scouting',
    });
    expect(second.lead.id).toBe(lead.id); // co-pursuit joined the same record
    await sql`update prospect_attempts set status = 'Qualified' where lead_id = ${lead.id}`;

    await log(sql, budi(), attempt.id, { activityType: 'Visit', summary: 'budi visit' });
    await log(sql, andi(), second.attempt.id, { activityType: 'Follow Up', summary: 'andi chat' });

    const all = await listByLead(sql, lead.id);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((a) => a.attemptId))).toEqual(new Set([attempt.id, second.attempt.id]));
  });

  it('effortCounts rolls up many attempts in one query, omitting the empty ones', async () => {
    const a1 = await attemptAt('Qualified');
    const a2 = await attemptAt('Qualified');
    await log(sql, budi(), a1.attemptId, { activityType: 'Visit', summary: 'satu' });
    await log(sql, budi(), a1.attemptId, { activityType: 'Visit', summary: 'dua' });

    const counts = await effortCounts(sql, [a1.attemptId, a2.attemptId]);
    expect(counts[a1.attemptId]).toBe(2);
    expect(counts[a2.attemptId]).toBeUndefined(); // no activity → absent, read as 0
    expect(await effortCounts(sql, [])).toEqual({});
  });

  it('effortByAttempt returns a zeroed rollup for an attempt with no activity', async () => {
    const { attemptId } = await attemptAt('Qualified');
    const effort = await effortByAttempt(sql, attemptId);
    expect(effort).toEqual({ attemptId, total: 0, byType: {}, lastActivityAt: null });
  });
});
