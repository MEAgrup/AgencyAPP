/**
 * Tests for M13 Client Health (health.ts). Ported from Go's
 * backend/internal/module13_health/{health,snapshot_db}_test.go.
 *
 * - Unit: the pure scoring core (§4 Alpha Digital worked example, capping,
 *   all-excluded, band boundaries) — no DB.
 * - Integration (skipped unless DATABASE_URL is set): the Alpha Digital end-to-end
 *   snapshot, idempotent sweep, immutability, band-drop fire-once emission, grace
 *   period, div-zero exclusion, ROAS toggle, and the §Rule 11 visibility + scan gate.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { notification, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  BAND_AT_RISK,
  BAND_HEALTHY,
  BAND_WATCH,
  bandFor,
  canView,
  COMP_COMPLAINTS,
  COMP_GMV_GROWTH,
  COMP_PAYMENT_TIMELINESS,
  COMP_REVISION_BURDEN,
  COMP_ROAS_ATTAINMENT,
  COMP_SATISFACTION,
  COMP_TASK_COMPLETION,
  ForbiddenError,
  getRoasToggle,
  getSnapshot,
  NotFoundError,
  preview,
  runScan,
  runSnapshotJob,
  ScanForbiddenError,
  score,
  setRoasToggle,
  type Actor,
  type Component,
} from './health';

// ---- actors ----
const amActor = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ director: true }) });
const odActor = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ od: true }) });
const creativeStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Creative', level: 'staff' }) });

const cand = (name: string, included: boolean, raw = 0, reason = '') => ({ name, included, raw, reason });
const find = (comps: Component[], name: string): Component => comps.find((c) => c.name === name) as Component;

// ===========================================================================
// Unit — pure scoring core.
// ===========================================================================

describe('score (pure §2 Rules 3–7)', () => {
  it('Alpha Digital worked example (§4): Satisfaction excluded, 10% redistributed ÷0.9, ≈74.6 Watch', () => {
    const { components, finalScore, band, scoreOk } = score([
      cand(COMP_GMV_GROWTH, true, 40),
      cand(COMP_ROAS_ATTAINMENT, true, 84),
      cand(COMP_TASK_COMPLETION, true, 90),
      cand(COMP_REVISION_BURDEN, true, 76),
      cand(COMP_COMPLAINTS, true, 95),
      cand(COMP_SATISFACTION, false, 0, 'placeholder'),
      cand(COMP_PAYMENT_TIMELINESS, true, 100),
    ]);
    expect(scoreOk).toBe(true);
    const want = Math.round((6710 / 90) * 1000) / 1000;
    expect(Math.abs((finalScore as number) - want)).toBeLessThan(0.001);
    expect(band).toBe(BAND_WATCH);
    expect(Math.abs(find(components, COMP_GMV_GROWTH).effectiveWeight - (25 * 100) / 90)).toBeLessThan(0.001);
    expect(Math.abs(find(components, COMP_PAYMENT_TIMELINESS).effectiveWeight - (10 * 100) / 90)).toBeLessThan(0.001);
    const sat = find(components, COMP_SATISFACTION);
    expect(sat.included).toBe(false);
    expect(sat.effectiveWeight).toBe(0);
    expect(sat.raw).toBeNull();
    expect(Math.abs(components.reduce((s, c) => s + c.effectiveWeight, 0) - 100)).toBeLessThan(0.001);
  });

  it('capping clamps both ends while preserving raw (Rule 5/6)', () => {
    const { components } = score([cand(COMP_ROAS_ATTAINMENT, true, 250), cand(COMP_GMV_GROWTH, true, -30)]);
    const roas = find(components, COMP_ROAS_ATTAINMENT);
    expect(roas.raw).toBe(250);
    expect(roas.capped).toBe(100);
    const gmv = find(components, COMP_GMV_GROWTH);
    expect(gmv.raw).toBe(-30);
    expect(gmv.capped).toBe(0);
  });

  it('all-excluded is not an error (scoreOk=false, null score)', () => {
    const { finalScore, band, scoreOk } = score([cand(COMP_GMV_GROWTH, false, 0, 'grace'), cand(COMP_SATISFACTION, false, 0, 'placeholder')]);
    expect(scoreOk).toBe(false);
    expect(finalScore).toBeNull();
    expect(band).toBe('');
  });

  it('bandFor boundaries (Rule 7)', () => {
    expect(bandFor(100)).toBe(BAND_HEALTHY);
    expect(bandFor(80)).toBe(BAND_HEALTHY);
    expect(bandFor(79.999)).toBe(BAND_WATCH);
    expect(bandFor(60)).toBe(BAND_WATCH);
    expect(bandFor(59.999)).toBe(BAND_AT_RISK);
    expect(bandFor(0)).toBe(BAND_AT_RISK);
  });
});

describe('canView (§Rule 11)', () => {
  it('AM own-only, lead/OD/Director broad, other division denied', () => {
    expect(canView(amActor('AM'), 'AM')).toBe(true);
    expect(canView(amActor('OTHER'), 'AM')).toBe(false);
    expect(canView(accountLead('L'), 'AM')).toBe(true);
    expect(canView(odActor('O'), 'AM')).toBe(true);
    expect(canView(director('D'), 'AM')).toBe(true);
    expect(canView(creativeStaff('C'), 'AM')).toBe(false);
  });
});

// ===========================================================================
// Integration.
// ===========================================================================

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

// Fixed clock: WIB 2026-07-17 12:00 → most-recently CLOSED month = June 2026.
const nowJul = new Date(Date.UTC(2026, 6, 17, 5, 0, 0));
const JUNE = '202606';

let seq = 0;
const uid = (p: string): string => `${p}-ZZ-${Date.now() % 100000}-${seq++}`;

async function insClient(id: string, amId: string, baseline: string, target: string, total: string, createdAt: Date): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_at, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', ${baseline}, ${target}, ${total},
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${amId}, ${createdAt}, 'ZZ-TEST')`;
}
async function insService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Full Mgmt', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
}
async function insBrief(id: string, svcId: string, division: string): Promise<void> {
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type, quantity_target, priority, recurring, created_by)
    values (${id}, ${svcId}, 'B', '[In Progress]', ${division}, 'D', 1, 'High', false, 'ZZ-TEST')`;
}
async function insAudit(entityType: string, entityId: string, action: string, at: Date): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
    values (${entityType}, ${entityId}, 'system', ${action}, 'ZZ-TEST', ${at})`;
}
/** insTask: an asset in [Approved] with an SLA + its transition log (speed = turnaround/sla × 100). */
async function insTask(id: string, briefId: string, seqNo: number, sla: number, turnaroundH: number, revisions: number, start: Date): Promise<void> {
  await sql`
    insert into assets (id, brief_id, asset_type, sequence_no, status, sla_target_hours, created_by)
    values (${id}, ${briefId}, 'Video', ${seqNo}, '[Approved]', ${sla}, 'ZZ-TEST')`;
  await insAudit('asset', id, 'transition:[To Do]->[In Progress]', start);
  for (let i = 0; i < revisions; i++) {
    await insAudit('asset', id, 'transition:[In Review]->[Revision Requested]', new Date(start.getTime() + (i + 1) * 60_000));
  }
  await insAudit('asset', id, 'transition:[In Review]->[Approved]', new Date(start.getTime() + turnaroundH * 3600_000));
}
async function insAdCampaign(id: string, briefId: string, clientId: string, status: string, targetKpi: string): Promise<void> {
  await sql`
    insert into ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
    values (${id}, ${briefId}, ${clientId}, 'Shopee Ads', 'Conversion', '100000000.00', '2026-06-01', '2026-12-31', ${targetKpi}, ${status}, 'ZZ-TEST')`;
}
async function insMetricEntry(id: string, campaignId: string, periodStart: string, spend: string, gmv: string): Promise<void> {
  await sql`
    insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_by)
    values (${id}, ${campaignId}, ${periodStart}, ${periodStart}, ${spend}, ${gmv}, 'Manual', 'system', 'ZZ-TEST')`;
}
async function insTransaction(id: string, clientId: string): Promise<void> {
  await sql`
    insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
    values (${id}, ${clientId}, 'Termin', '10000000.00', '[Terverifikasi]', 'ZZ-TEST')`;
}
async function insInstallment(id: string, trxId: string, no: number, dueDate: string, overdue: boolean): Promise<void> {
  await sql`
    insert into installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
    values (${id}, ${trxId}, ${no}, '5000000.00', ${dueDate}, '[Terverifikasi]', 'ZZ-TEST')`;
  if (overdue) {
    await insAudit('installment', id, 'transition:[Belum Jatuh Tempo]->[Jatuh Tempo]', new Date(Date.UTC(2026, 5, 16)));
  }
}
async function insComplaint(id: string, clientId: string, severity: string, at: Date): Promise<void> {
  await sql`
    insert into complaints (id, client_id, source, description, severity, status, created_at, created_by)
    values (${id}, ${clientId}, 'WhatsApp (AM-logged)', 'x', ${severity}, '[Open]', ${at}, 'ZZ-TEST')`;
}

/** alphaDigital builds the full PRD §4 worked example for one client (June 2026). */
async function alphaDigital(clientId: string, amId: string): Promise<void> {
  await insClient(clientId, amId, '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
  const svcId = uid('SVC');
  await insService(svcId, clientId);
  const crBrief = uid('BRF');
  await insBrief(crBrief, svcId, 'Creative');
  const start = new Date(Date.UTC(2026, 5, 10));
  const revs = [2, 2, 1, 1, 1, 1, 1, 1, 1, 1]; // Σ=12 → avg 1.2 → Revision Burden 76
  for (let i = 0; i < 10; i++) {
    const turn = i === 9 ? 20.0 : 5.0; // 9 within SLA (50%), 1 over (200%) → Task Completion 90
    await insTask(uid('AST'), crBrief, i + 1, 10, turn, revs[i], start);
  }
  const adBrief = uid('BRF');
  await insBrief(adBrief, svcId, 'Ads');
  const adc = uid('ADC');
  await insAdCampaign(adc, adBrief, clientId, '[Active]', 'ROAS 5'); // target 5.0x
  await insMetricEntry(uid('MTR'), adc, '2026-06-05', '100000000.00', '420000000.00'); // actual 4.2x → 84
  const trx = uid('TRX');
  await insTransaction(trx, clientId);
  await insInstallment(uid('INST'), trx, 1, '2026-06-15', false); // on time → 100
  await insComplaint(uid('CPL'), clientId, 'Low', new Date(Date.UTC(2026, 5, 12))); // 1 Low → 95
}

const compByName = (comps: Component[], name: string): Component => comps.find((c) => c.name === name) as Component;

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  // client_health_snapshots is append-only (no-delete trigger) and clients carry a hard
  // FK from it, so a full teardown would be impossible under normal rules — leaving
  // snapshotted clients behind would then break OTHER test files' broad client cleanup.
  // The test DB connects as the `postgres` superuser, so scope a transaction to
  // session_replication_role='replica' (disables user triggers + FK checks) to remove
  // this test's rows cleanly. audit_log / notifications are left (harmless, unique ids).
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from client_health_snapshots where client_id in (select id from clients where created_by = 'ZZ-TEST')`;
    await tx`delete from metric_entries where created_by = 'ZZ-TEST'`;
    await tx`delete from ad_campaigns where created_by = 'ZZ-TEST'`;
    await tx`delete from installments where created_by = 'ZZ-TEST'`;
    await tx`delete from transactions where created_by = 'ZZ-TEST'`;
    await tx`delete from complaints where created_by = 'ZZ-TEST'`;
    await tx`delete from assets where created_by = 'ZZ-TEST'`;
    await tx`delete from briefs where created_by = 'ZZ-TEST'`;
    await tx`delete from services where created_by = 'ZZ-TEST'`;
    await tx`delete from clients where created_by = 'ZZ-TEST'`;
    await tx`delete from employees where created_by = 'ZZ-TEST'`;
    await tx`delete from role_mappings where created_by = 'ZZ-TEST'`;
  });
});

describeDb('Alpha Digital end-to-end snapshot (§4)', () => {
  it('scores June to ≈74.56 Watch with the recomputed sub-scores', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');
    const res = await runSnapshotJob(sql, nowJul);
    expect(res.period).toBe(JUNE);
    expect(res.snapshotsMade).toBeGreaterThanOrEqual(1);

    const snap = await getSnapshot(sql, director('D'), cli, JUNE);
    expect(snap.finalHealthScore).not.toBeNull();
    expect(Math.abs((snap.finalHealthScore as number) - Math.round((6710 / 90) * 1000) / 1000)).toBeLessThan(0.01);
    expect(snap.band).toBe(BAND_WATCH);
    expect(snap.roasToggleState).toBe(true);
    const checks: Record<string, number> = {
      [COMP_GMV_GROWTH]: 40, [COMP_ROAS_ATTAINMENT]: 84, [COMP_TASK_COMPLETION]: 90,
      [COMP_REVISION_BURDEN]: 76, [COMP_COMPLAINTS]: 95, [COMP_PAYMENT_TIMELINESS]: 100,
    };
    for (const [name, want] of Object.entries(checks)) {
      const c = compByName(snap.components, name);
      expect(c.included).toBe(true);
      expect(Math.abs((c.raw as number) - want)).toBeLessThan(0.001);
    }
    expect(compByName(snap.components, COMP_SATISFACTION).included).toBe(false);
  });
});

describeDb('sweep idempotency', () => {
  it('a second sweep makes no new snapshot; exactly one row', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');
    await runSnapshotJob(sql, nowJul);
    const res2 = await runSnapshotJob(sql, nowJul);
    // res2 may make snapshots for OTHER leftover clients, but not for ours.
    const n = Number((await sql<{ n: string }[]>`select count(*) as n from client_health_snapshots where client_id = ${cli}`)[0].n);
    expect(n).toBe(1);
    expect(res2.snapshotsMade).toBe(0);
  });
});

describeDb('snapshot immutability (house rule 3)', () => {
  it('UPDATE and DELETE on a snapshot are blocked by the trigger', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');
    await runSnapshotJob(sql, nowJul);
    const id = (await sql<{ id: string }[]>`select id from client_health_snapshots where client_id = ${cli}`)[0].id;
    await expect(sql`update client_health_snapshots set band='Healthy' where id=${id}`).rejects.toThrow();
    await expect(sql`delete from client_health_snapshots where id=${id}`).rejects.toThrow();
  });
});

describeDb('band drop emission (Rule 12), fire-once', () => {
  it('a strictly lower band than the previous snapshot flags once to the Account SPV', async () => {
    const cli = uid('CLI');
    const spv = uid('EMP-SPV');
    await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${spv}, 'Spv', ${spv + '@x'}, 'Account', 'ZZ-SPV', true, 'ZZ-TEST')`;
    await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('Account', 'ZZ-SPV', 'Account', 'lead', 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;
    await alphaDigital(cli, 'ZZ-AM'); // June → Watch
    // Pre-existing MAY snapshot in a healthier band → June is a drop.
    await sql`insert into client_health_snapshots
      (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
      values (${uid('CHR')}, ${cli}, '2026-05-01', '2026-05-31', 90, 'Healthy', true, '[]', 'system')`;

    const res = await runSnapshotJob(sql, nowJul);
    expect(res.bandDropsFlagged).toBeGreaterThanOrEqual(1);
    const drops1 = await countDrops(spv);
    expect(drops1).toBe(1);
    // Re-run: no new snapshot for our client ⇒ no new emission.
    await runSnapshotJob(sql, nowJul);
    expect(await countDrops(spv)).toBe(1);
  });
});

describeDb('grace period (Rule 8)', () => {
  it('a client onboarded mid-June excludes GMV for June', async () => {
    const cli = uid('CLI');
    await insClient(cli, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 5, 15)));
    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director('D'), cli, JUNE);
    expect(compByName(snap.components, COMP_GMV_GROWTH).included).toBe(false);
  });
});

describeDb('div-zero excludes, never errors (house rule 7)', () => {
  it('Target==Baseline + no other data → only Complaints (100) → Healthy', async () => {
    const cli = uid('CLI');
    await insClient(cli, 'ZZ-AM', '50000000.00', '50000000.00', '60000000.00', new Date(Date.UTC(2026, 3, 1)));
    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director('D'), cli, JUNE);
    expect(compByName(snap.components, COMP_GMV_GROWTH).included).toBe(false);
    expect(snap.finalHealthScore).toBe(100);
    expect(snap.band).toBe(BAND_HEALTHY);
  });
});

describeDb('ROAS toggle (Rule 13 / §5.4)', () => {
  it('default follows active Ads; AM OFF override excludes ROAS + audits', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');
    const def = await getRoasToggle(sql, amActor('ZZ-AM'), cli);
    expect(def.effective).toBe(true);
    expect(def.override).toBeNull();

    const off = await setRoasToggle(sql, amActor('ZZ-AM'), cli, false);
    expect(off.override).toBe(false);
    expect(off.effective).toBe(false);

    const prev = await preview(sql, amActor('ZZ-AM'), cli, nowJul);
    expect(compByName(prev.components, COMP_ROAS_ATTAINMENT).included).toBe(false);
    const n = Number(
      (await sql<{ n: string }[]>`select count(*) as n from audit_log where entity_type='client' and entity_id=${cli} and action='roas_health_toggle_set'`)[0].n,
    );
    expect(n).toBe(1);
  });

  it('no Ads service is structurally N/A even with an explicit ON override', async () => {
    const cli = uid('CLI');
    await insClient(cli, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
    const tg = await setRoasToggle(sql, accountLead('ZZ-LEAD'), cli, true);
    expect(tg.effective).toBe(false);
  });
});

describeDb('visibility (Rule 11) + scan gate', () => {
  it('own-book AM sees it; other AM NotFound; lead/OD/Director see it; non-Account Forbidden; scan gated', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');
    await runSnapshotJob(sql, nowJul);

    await expect(getSnapshot(sql, amActor('ZZ-AM'), cli, JUNE)).resolves.toBeTruthy();
    await expect(getSnapshot(sql, amActor('ZZ-OTHER'), cli, JUNE)).rejects.toThrow(NotFoundError);
    await expect(getSnapshot(sql, accountLead('L'), cli, JUNE)).resolves.toBeTruthy();
    await expect(getSnapshot(sql, odActor('O'), cli, JUNE)).resolves.toBeTruthy();
    await expect(getSnapshot(sql, director('D'), cli, JUNE)).resolves.toBeTruthy();
    await expect(getSnapshot(sql, creativeStaff('C'), cli, JUNE)).rejects.toThrow(ForbiddenError);

    await expect(runScan(sql, accountLead('L'), nowJul)).resolves.toBeTruthy();
    await expect(runScan(sql, director('D'), nowJul)).resolves.toBeTruthy();
    await expect(runScan(sql, odActor('O'), nowJul)).rejects.toThrow(ScanForbiddenError);
    await expect(runScan(sql, creativeStaff('C'), nowJul)).rejects.toThrow(ScanForbiddenError);
  });
});

/** countDrops counts EvClientBandDrop notifications for a recipient. */
async function countDrops(recipient: string): Promise<number> {
  return Number(
    (
      await sql<{ n: string }[]>`
        select count(*) as n from notifications
         where recipient_employee_id = ${recipient} and event_type = ${notification.EVENTS.ClientBandDrop}`
    )[0].n,
  );
}
