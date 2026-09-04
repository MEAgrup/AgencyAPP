/**
 * L3 (Revisi Sales/Creative/Performa) — `leads_unrespon_tick` (daily lead-aging
 * sweep) via its TS wrapper `sales.runUnresponTick`.
 *
 * The clock anchor is entirely synthetic here: every fixture inserts its own
 * `leads` + `prospect_attempts` row and, where it needs to simulate "the last
 * status change happened N days ago", a raw `audit_log` row shaped exactly
 * like the one `sm_transition` writes (`action = 'transition:<from>-><to>'`)
 * with a backdated `created_at`. That is the ONLY thing the job reads to
 * compute age (docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md L1.3) —
 * no `unrespon_at` column exists to fake instead.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { runUnresponTick } from './sales';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

// Anchor "now" at a normal WIB daytime hour so every relative offset below
// lands unambiguously on the day arithmetic implies — the boundary test at
// the bottom is the one exception, which picks p_now deliberately inside the
// WIB/UTC divergence window (00:00-06:59 WIB).
const NOW = new Date('2026-09-10T05:00:00Z'); // 2026-09-10 12:00 WIB

// Random per PROCESS, not just per test — `audit_log`/`notifications` are
// append-only (house rule #3/#8), so a fixed id (e.g. `PA-999999-0001`) would
// let an earlier, aborted run's leftover rows silently corrupt this run's
// MAX(created_at) anchor computation, or double-count notification
// recipients. A run-unique prefix means every run's rows are strangers to
// every other run's.
const RUN_ID = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
let seq = 0;
/** Fresh id per fixture row, unique to this process, namespaced for cleanup. */
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-Z${RUN_ID}${String(seq).padStart(3, '0')}`;
}

const createdLeadIds: string[] = [];
const createdAttemptIds: string[] = [];

/** A throwaway lead + attempt, status set directly (bypassing the machine). */
async function mkAttempt(status: string, ownerId = 'ZZ-UNRESPON-OWNER'): Promise<string> {
  const leadId = nextId('LD');
  const attemptId = nextId('PA');
  await sql`
    insert into leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
    values (${leadId}, 'ZZ Unrespon Test', '0800', '0800', 'Manual', 'Sales', 'active', ${ownerId})`;
  await sql`
    insert into prospect_attempts (id, lead_id, owner_employee_id, status, created_by)
    values (${attemptId}, ${leadId}, ${ownerId}, ${status}, ${ownerId})`;
  createdLeadIds.push(leadId);
  createdAttemptIds.push(attemptId);
  return attemptId;
}

/** A synthetic `sm_transition`-shaped audit row, backdated. */
async function mkTransitionAudit(attemptId: string, from: string, to: string, at: Date): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_at, created_by)
    values ('prospect_attempt', ${attemptId}, 'SISTEM', ${`transition:${from}->${to}`},
            ${JSON.stringify({ status: from })}, ${JSON.stringify({ status: to })}, ${at}, 'SISTEM')`;
}

async function statusOf(attemptId: string): Promise<string> {
  const rows = await sql<{ status: string }[]>`select status from prospect_attempts where id = ${attemptId}`;
  return rows[0].status;
}

async function nqReasons(attemptId: string): Promise<{ reason: string; created_by: string }[]> {
  return sql<{ reason: string; created_by: string }[]>`
    select reason, created_by from prospect_attempt_nq_reasons where attempt_id = ${attemptId}`;
}

async function notifRecipients(attemptId: string, event: string): Promise<string[]> {
  const rows = await sql<{ recipient_employee_id: string }[]>`
    select recipient_employee_id from notifications
     where entity_id = ${attemptId} and event_type = ${event}
     order by recipient_employee_id`;
  return rows.map((r) => r.recipient_employee_id);
}

async function transitionAuditCount(attemptId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from audit_log
     where entity_type = 'prospect_attempt' and entity_id = ${attemptId} and action like 'transition:%'`;
  return rows[0].n;
}

function daysBefore(base: Date, n: number): Date {
  return new Date(base.getTime() - n * 24 * 60 * 60 * 1000);
}

describeDb('sales.runUnresponTick (L3)', () => {
  afterEach(async () => {
    // ZZ-prefixed rows only — never touches the Alpha Digital fixture.
    if (createdAttemptIds.length > 0) {
      // `audit_log` and `notifications` are append-only (house rule #3/#8,
      // triggers audit_log_no_delete / notifications_no_delete) — their rows
      // outlive the fixture as harmless orphans, same as they would for any
      // entity that gets hard-deleted.
      await sql`delete from prospect_attempt_nq_reasons where attempt_id = any(${createdAttemptIds})`;
      await sql`delete from prospect_attempts where id = any(${createdAttemptIds})`;
      createdAttemptIds.length = 0;
    }
    if (createdLeadIds.length > 0) {
      await sql`delete from leads where id = any(${createdLeadIds})`;
      createdLeadIds.length = 0;
    }
  });

  it('3-day threshold: 2 days silent, 3 days flips — from BOTH New Lead and Contacted', async () => {
    const day2New = await mkAttempt('New Lead');
    await mkTransitionAudit(day2New, 'Pending Validation', 'New Lead', daysBefore(NOW, 2));
    const day3New = await mkAttempt('New Lead');
    await mkTransitionAudit(day3New, 'Pending Validation', 'New Lead', daysBefore(NOW, 3));
    const day3Contacted = await mkAttempt('Contacted');
    await mkTransitionAudit(day3Contacted, 'New Lead', 'Contacted', daysBefore(NOW, 3));

    const res = await runUnresponTick(sql, NOW);
    expect(res.unrespon).toBe(2);

    expect(await statusOf(day2New)).toBe('New Lead'); // 2 days: untouched
    expect(await statusOf(day3New)).toBe('[Unrespon]');
    expect(await statusOf(day3Contacted)).toBe('[Unrespon]');

    // The transition is real — a new audit row, actor SISTEM (job SQL convention).
    const [row] = await sql<{ actor_employee_id: string; action: string }[]>`
      select actor_employee_id, action from audit_log
       where entity_id = ${day3New} and action = 'transition:New Lead->[Unrespon]'`;
    expect(row.actor_employee_id).toBe('SISTEM');

    // And it is announced — event m1.attempt.unrespon to the owner, nobody else.
    expect(await notifRecipients(day3New, 'm1.attempt.unrespon')).toEqual(['ZZ-UNRESPON-OWNER']);
  });

  it('14-day threshold on [Unrespon]: 13 days silent, 14 days auto-NQ with the [Tidak ada respon] reason', async () => {
    const day13 = await mkAttempt('[Unrespon]');
    await mkTransitionAudit(day13, 'Contacted', '[Unrespon]', daysBefore(NOW, 13));
    const day14 = await mkAttempt('[Unrespon]');
    await mkTransitionAudit(day14, 'Contacted', '[Unrespon]', daysBefore(NOW, 14));

    const res = await runUnresponTick(sql, NOW);
    expect(res.autoNotQualified).toBe(1);

    expect(await statusOf(day13)).toBe('[Unrespon]'); // 13 days: untouched
    expect(await nqReasons(day13)).toEqual([]);

    expect(await statusOf(day14)).toBe('Not Qualified');
    expect(await nqReasons(day14)).toEqual([{ reason: '[Tidak ada respon]', created_by: 'SISTEM' }]);
    expect(await notifRecipients(day14, 'm1.attempt.auto_not_qualified')).toEqual(['ZZ-UNRESPON-OWNER']);
  });

  it('is idempotent: a second run on the same day finds nothing new', async () => {
    const toUnrespon = await mkAttempt('New Lead');
    await mkTransitionAudit(toUnrespon, 'Pending Validation', 'New Lead', daysBefore(NOW, 3));
    const toNq = await mkAttempt('[Unrespon]');
    await mkTransitionAudit(toNq, 'Contacted', '[Unrespon]', daysBefore(NOW, 14));

    const first = await runUnresponTick(sql, NOW);
    expect(first.unrespon).toBeGreaterThanOrEqual(1);
    expect(first.autoNotQualified).toBeGreaterThanOrEqual(1);

    const auditBefore = await transitionAuditCount(toUnrespon) + await transitionAuditCount(toNq);
    const notifBefore =
      (await notifRecipients(toUnrespon, 'm1.attempt.unrespon')).length +
      (await notifRecipients(toNq, 'm1.attempt.auto_not_qualified')).length;
    const nqBefore = (await nqReasons(toNq)).length;

    const second = await runUnresponTick(sql, NOW);
    expect(second).toEqual({ unrespon: 0, autoNotQualified: 0 });

    expect(await transitionAuditCount(toUnrespon) + await transitionAuditCount(toNq)).toBe(auditBefore);
    expect(
      (await notifRecipients(toUnrespon, 'm1.attempt.unrespon')).length +
      (await notifRecipients(toNq, 'm1.attempt.auto_not_qualified')).length,
    ).toBe(notifBefore);
    expect((await nqReasons(toNq)).length).toBe(nqBefore);
  });

  it("resets the clock when a sales person revives it — the SECOND [Unrespon] audit row is the anchor", async () => {
    const attemptId = await mkAttempt('[Unrespon]');
    // First aging: 20 days ago — long past the 14-day mark on its own.
    await mkTransitionAudit(attemptId, 'Contacted', '[Unrespon]', daysBefore(NOW, 20));
    // Sales revives it (a real action, mirrors the [Unrespon] -> Contacted door).
    await mkTransitionAudit(attemptId, '[Unrespon]', 'Contacted', daysBefore(NOW, 18));
    // It goes quiet again and ages a SECOND time, only 13 days ago.
    await mkTransitionAudit(attemptId, 'Contacted', '[Unrespon]', daysBefore(NOW, 13));

    const res = await runUnresponTick(sql, NOW);
    expect(res.autoNotQualified).toBe(0);
    expect(await statusOf(attemptId)).toBe('[Unrespon]'); // still — anchored to the 13-day-old row, not the 20-day-old one
  });

  it('uses WIB civil days, not the UTC calendar day (00:00-06:59 WIB divergence window)', async () => {
    // Anchor at a clean WIB daytime hour: 2026-09-01 10:00 WIB (03:00Z) — WIB
    // date and UTC date agree here, so this is an unambiguous "day 0".
    const attemptId = await mkAttempt('New Lead');
    await mkTransitionAudit(attemptId, 'Pending Validation', 'New Lead', new Date('2026-09-01T03:00:00Z'));

    // p_now = 2026-09-04 05:00 WIB = 2026-09-03 22:00Z: WIB civil date is
    // already the 4th (3 full WIB days after the 1st -> the 3-day mark is
    // met), but the RAW UTC date is still the 3rd (only 2 UTC days after the
    // 1st). A wib_date()-correct job ages this row HERE; a job that used the
    // raw UTC date (session `current_date` / `::date` with no offset) would
    // not — this is exactly the divergence class caught in interview.test.ts
    // (working_days_between vs current_date, 17:00-23:59 UTC).
    const pNow = new Date('2026-09-03T22:00:00Z');
    const res = await runUnresponTick(sql, pNow);
    expect(res.unrespon).toBe(1);
    expect(await statusOf(attemptId)).toBe('[Unrespon]');
  });
});
