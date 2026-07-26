/**
 * Tests for M13 Client Health (health.ts).
 *
 * - Unit: the pure scoring core (§4 worked example, capping, all-excluded,
 *   band boundaries) and the permission predicates — no DB.
 * - Integration (skipped unless DATABASE_URL is set): the monthly sweep +
 *   immutable snapshot + live preview + trend + band-drop emission + the ROAS
 *   Inclusion Toggle, against a migrated Postgres. Each test namespaces its ids
 *   with `ZZ-` and afterEach cleans the rows it made.
 *
 * NOTE: like finance.scanReminders, `runSnapshotJob` sweeps EVERY client, and the
 * CHR snapshots it writes are immutable (no DELETE path — only TRUNCATE bypasses
 * the trigger). So afterEach TRUNCATEs client_health_snapshots before deleting the
 * ZZ- clients. The count-based assertions (`snapshotsMade` / `bandDropsFlagged`)
 * assume a fresh DB; where a shared DB could add rows, the assertions instead pin
 * the specific seeded client.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  BAND_AT_RISK,
  BAND_HEALTHY,
  BAND_WATCH,
  bandFor,
  canRunScan,
  canScope,
  canToggleROAS,
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
  trend,
  type Actor,
  type Candidate,
  type Component,
} from './health';

// ---------------------------------------------------------------------------
// Actor helpers.
// ---------------------------------------------------------------------------
const amActor = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ director: true }) });
const odActor = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ od: true }) });
const creativeStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Creative', level: 'staff' }) });

const find = (comps: Component[], name: string): Component =>
  comps.find((c) => c.name === name) ?? ({} as Component);

const cand = (name: string, included: boolean, raw = 0, reason = ''): Candidate => ({ name, included, raw, reason });

// ---------------------------------------------------------------------------
// Unit: pure scoring core (health.go).
// ---------------------------------------------------------------------------
describe('score (pure core)', () => {
  // §4 worked example EXACTLY: Satisfaction excluded, its 10% redistributed across
  // the other six (÷0.9), final ≈ 74.6 → Watch.
  it('reproduces the Alpha Digital §4 worked example (≈74.6, Watch)', () => {
    const cands: Candidate[] = [
      cand(COMP_GMV_GROWTH, true, 40),
      cand(COMP_ROAS_ATTAINMENT, true, 84),
      cand(COMP_TASK_COMPLETION, true, 90),
      cand(COMP_REVISION_BURDEN, true, 76),
      cand(COMP_COMPLAINTS, true, 95),
      cand(COMP_SATISFACTION, false, 0, 'placeholder'),
      cand(COMP_PAYMENT_TIMELINESS, true, 100),
    ];
    const res = score(cands);
    expect(res.finalScore).not.toBeNull();
    // 6710/90 = 74.5555… (PRD "≈ 74.6"), rounded to 3 dp like the core.
    const want = Math.round((6710 / 90) * 1000) / 1000;
    expect(Math.abs((res.finalScore as number) - want)).toBeLessThan(0.001);
    expect(res.band).toBe(BAND_WATCH);
    // Redistribution ÷0.9: GMV/ROAS 27.78, the four 10%-ers 11.11.
    expect(Math.abs(find(res.components, COMP_GMV_GROWTH).effectiveWeight - (25 * 100) / 90)).toBeLessThan(0.001);
    expect(Math.abs(find(res.components, COMP_PAYMENT_TIMELINESS).effectiveWeight - (10 * 100) / 90)).toBeLessThan(0.001);
    // Satisfaction stays excluded with zero effective weight and null sub-scores.
    const sat = find(res.components, COMP_SATISFACTION);
    expect(sat.included).toBe(false);
    expect(sat.effectiveWeight).toBe(0);
    expect(sat.raw).toBeNull();
    expect(sat.capped).toBeNull();
    // Effective weights of included components sum to 100 (Rule 4 re-normalisation).
    const sumEff = res.components.reduce((s, c) => s + c.effectiveWeight, 0);
    expect(Math.abs(sumEff - 100)).toBeLessThan(0.001);
  });

  // An over-performing raw (>100) and a negative raw are both clamped into [0,100]
  // for the composite, while the raw uncapped value is preserved (Rule 5/6).
  it('clamps both ends for the composite but preserves the raw', () => {
    const res = score([cand(COMP_ROAS_ATTAINMENT, true, 250), cand(COMP_GMV_GROWTH, true, -30)]);
    expect(res.finalScore).not.toBeNull();
    const roas = find(res.components, COMP_ROAS_ATTAINMENT);
    expect(roas.raw).toBe(250);
    expect(roas.capped).toBe(100);
    const gmv = find(res.components, COMP_GMV_GROWTH);
    expect(gmv.raw).toBe(-30);
    expect(gmv.capped).toBe(0);
  });

  // All excluded is NOT an error — finalScore null, no band (renders "—").
  it('returns null score / no band when every component is excluded', () => {
    const res = score([cand(COMP_GMV_GROWTH, false, 0, 'grace'), cand(COMP_SATISFACTION, false, 0, 'placeholder')]);
    expect(res.finalScore).toBeNull();
    expect(res.band).toBe('');
    expect(res.components.every((c) => !c.included)).toBe(true);
  });
});

describe('bandFor (Rule 7 boundaries)', () => {
  it('assigns bands at the exact boundaries', () => {
    expect(bandFor(100)).toBe(BAND_HEALTHY);
    expect(bandFor(80)).toBe(BAND_HEALTHY);
    expect(bandFor(79.999)).toBe(BAND_WATCH);
    expect(bandFor(60)).toBe(BAND_WATCH);
    expect(bandFor(59.999)).toBe(BAND_AT_RISK);
    expect(bandFor(0)).toBe(BAND_AT_RISK);
  });
});

// ---------------------------------------------------------------------------
// Unit: permission predicates (service.go).
// ---------------------------------------------------------------------------
describe('permission predicates', () => {
  it('canView: owning AM / Account lead / OD / Director; others denied', () => {
    expect(canView(amActor('AM1'), 'AM1')).toBe(true); // owner
    expect(canView(amActor('AM2'), 'AM1')).toBe(false); // non-owner AM
    expect(canView(accountLead('L'), 'AM1')).toBe(true); // division-wide
    expect(canView(odActor('O'), 'AM1')).toBe(true);
    expect(canView(director('D'), 'AM1')).toBe(true);
    expect(canView(creativeStaff('C'), 'AM1')).toBe(false);
  });
  it('canScope: Account / OD / Director only', () => {
    expect(canScope(amActor('A'))).toBe(true);
    expect(canScope(odActor('O'))).toBe(true);
    expect(canScope(director('D'))).toBe(true);
    expect(canScope(creativeStaff('C'))).toBe(false);
  });
  it('canRunScan: Account (any level) or Director; not OD', () => {
    expect(canRunScan(amActor('A'))).toBe(true);
    expect(canRunScan(accountLead('L'))).toBe(true);
    expect(canRunScan(director('D'))).toBe(true);
    expect(canRunScan(odActor('O'))).toBe(false);
    expect(canRunScan(creativeStaff('C'))).toBe(false);
  });
  it('canToggleROAS: AM/SPV Account or Director; OD read-only', () => {
    expect(canToggleROAS(amActor('A'))).toBe(true);
    expect(canToggleROAS(accountLead('L'))).toBe(true);
    expect(canToggleROAS(director('D'))).toBe(true);
    expect(canToggleROAS(odActor('O'))).toBe(false);
    expect(canToggleROAS(creativeStaff('C'))).toBe(false);
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

// Fixed clock: WIB 2026-07-17 12:00 → most-recently CLOSED month = June 2026.
const nowJul = new Date('2026-07-17T05:00:00Z');
const junePeriod = '202606';

let seq = 0;
const uid = (p: string): string => `${p}-ZZ-${Date.now() % 100000}-${seq++}`;

// ---- fixture inserters ----
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
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
      quantity_target, priority, recurring, created_by)
    values (${id}, ${svcId}, 'B', '[In Progress]', ${division}, 'Campaign', 1, 'High', false, 'ZZ-TEST')`;
}
async function insAudit(entityType: string, entityId: string, action: string, at: Date): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
    values (${entityType}, ${entityId}, 'system', ${action}, 'system', ${at})`;
}
/**
 * insTask inserts an asset in [Approved] with an SLA, then writes its immutable
 * transition log: [In Progress]@start, `revisions` × [Revision Requested], and
 * [Approved]@(start+turnaround h). Speed Score = turnaround/sla × 100.
 */
async function insTask(id: string, briefId: string, seqNo: number, sla: number, turnaroundH: number, revisions: number, start: Date): Promise<void> {
  await sql`
    insert into assets (id, brief_id, asset_type, sequence_no, status, sla_target_hours, created_by)
    values (${id}, ${briefId}, 'Video', ${seqNo}, '[Approved]', ${sla}, 'ZZ-TEST')`;
  await insAudit('asset', id, 'transition:[To Do]->[In Progress]', start);
  for (let i = 0; i < revisions; i++) {
    await insAudit('asset', id, 'transition:[In Review]->[Revision Requested]', new Date(start.getTime() + (i + 1) * 60_000));
  }
  await insAudit('asset', id, 'transition:[In Review]->[Approved]', new Date(start.getTime() + turnaroundH * 3_600_000));
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
    await insAudit('installment', id, 'transition:[Belum Jatuh Tempo]->[Jatuh Tempo]', new Date('2026-06-16T00:00:00Z'));
  }
}
async function insComplaint(id: string, clientId: string, severity: string, at: Date): Promise<void> {
  await sql`
    insert into complaints (id, client_id, source, description, severity, status, created_at, created_by)
    values (${id}, ${clientId}, 'WhatsApp (AM-logged)', 'x', ${severity}, '[Open]', ${at}, 'ZZ-TEST')`;
}

/** alphaDigital builds the full §4 worked example for one client (June 2026). */
async function alphaDigital(clientId: string, amId: string): Promise<void> {
  // GMV: 50M → 80M → 62M ⇒ raw 40. Onboarded April (no grace for June).
  await insClient(clientId, amId, '50000000.00', '80000000.00', '62000000.00', new Date('2026-04-01T00:00:00Z'));
  const svcId = uid('SVC');
  await insService(svcId, clientId);

  // Creative brief + 10 tasks: 9 within SLA (speed 50%), 1 over (speed 200%) ⇒
  // Task Completion 90; revisions summing to 12 ⇒ avg 1.2 ⇒ Revision Burden 76.
  const crBrief = uid('BRF-CR');
  await insBrief(crBrief, svcId, 'Creative');
  const start = new Date('2026-06-10T00:00:00Z');
  const revs = [2, 2, 1, 1, 1, 1, 1, 1, 1, 1]; // Σ = 12
  for (let i = 0; i < 10; i++) {
    const turn = i === 9 ? 20.0 : 5.0; // over SLA (200%) for the last; within (50%) otherwise
    await insTask(`${clientId}-AST-${i}`, crBrief, i + 1, 10, turn, revs[i], start);
  }

  // ROAS: active campaign, target 5.0x, actual 4.2x (spend 100M, gmv 420M) ⇒ 84.
  const adBrief = uid('BRF-AD');
  await insBrief(adBrief, svcId, 'Ads');
  const adc = `${clientId}-ADC`;
  await insAdCampaign(adc, adBrief, clientId, '[Active]', 'ROAS 5');
  await insMetricEntry(`${clientId}-MTR`, adc, '2026-06-05', '100000000.00', '420000000.00');

  // Payment: 1 installment due in June, on time ⇒ 100.
  const trx = `${clientId}-TRX`;
  await insTransaction(trx, clientId);
  await insInstallment(`${clientId}-INST`, trx, 1, '2026-06-15', false);

  // Complaints: 1 Low logged in June ⇒ 95.
  await insComplaint(`${clientId}-CPL`, clientId, 'Low', new Date('2026-06-12T00:00:00Z'));
}

const compByName = (comps: Component[], name: string): Component => comps.find((c) => c.name === name) ?? ({} as Component);

const snapCountFor = async (clientId: string): Promise<number> =>
  (await sql<{ n: number }[]>`select count(*)::int as n from client_health_snapshots where client_id = ${clientId}`)[0].n;

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  // CHR snapshots are immutable (no DELETE path); TRUNCATE bypasses the trigger and
  // frees the client FK so the ZZ- clients can be removed. audit_log / notifications
  // are append-only — never cleaned; assertions filter by the per-test entity id.
  await sql`truncate table client_health_snapshots`;
  await sql`update clients set roas_health_included_override = null where created_by like 'ZZ-%'`;
  await sql`delete from metric_entries where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaigns where created_by like 'ZZ-%'`;
  await sql`delete from complaints where created_by like 'ZZ-%'`;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

// ---- worked example end to end ----
describeDb('runSnapshotJob — §4 worked example end to end', () => {
  it('scores June 2026 ≈ 74.56 / Watch with the recomputed sub-scores', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');

    const res = await runSnapshotJob(sql, nowJul);
    expect(res.period).toBe(junePeriod);
    expect(res.snapshotsMade).toBeGreaterThanOrEqual(1);

    const snap = await getSnapshot(sql, director('D'), cli, junePeriod);
    expect(snap.finalHealthScore).not.toBeNull();
    expect(Math.abs((snap.finalHealthScore as number) - 6710 / 90)).toBeLessThan(0.01);
    expect(snap.band).toBe(BAND_WATCH);
    expect(snap.roasToggleState).toBe(true); // active Ads, no override
    expect(snap.id).toMatch(/^CHR-202606-\d{4}$/);

    // Spot-check the recomputed sub-scores (raw uncapped preserved, Rule 6).
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

    // Trend lists the stored snapshot (Rule 9).
    const t = await trend(sql, director('D'), cli);
    expect(t.length).toBe(1);
    expect(t[0].band).toBe(BAND_WATCH);
  });

  it('is idempotent — a second sweep makes no new snapshot for the client', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');
    await runSnapshotJob(sql, nowJul);
    const res = await runSnapshotJob(sql, nowJul);
    expect(res.snapshotsMade).toBe(0); // every client already snapshotted
    expect(await snapCountFor(cli)).toBe(1);
  });

  it('blocks UPDATE and DELETE on a stored snapshot (immutability trigger)', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');
    await runSnapshotJob(sql, nowJul);
    const [{ id }] = await sql<{ id: string }[]>`select id from client_health_snapshots where client_id = ${cli}`;
    await expect(sql`update client_health_snapshots set band = 'Healthy' where id = ${id}`).rejects.toThrow();
    await expect(sql`delete from client_health_snapshots where id = ${id}`).rejects.toThrow();
  });
});

// ---- band drop emission (Rule 12), fire-once ----
describeDb('band drop (Rule 12)', () => {
  it('emits EvClientBandDrop once when the band drops below the previous snapshot', async () => {
    // Account SPV (lead) so leadsOfDivision("Account") resolves a recipient.
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZZ-SPV', 'Spv', 'zz-spv@x', 'Account', 'ZZ-SPV', true, 'ZZ-TEST')
      on conflict (employee_id) do nothing`;
    await sql`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('Account', 'ZZ-SPV', 'Account', 'lead', 'ZZ-TEST')
      on conflict (divisi, jabatan) do nothing`;

    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM'); // June → Watch
    // Pre-existing MAY snapshot in a healthier band → June is a drop.
    await sql`
      insert into client_health_snapshots (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
      values (${uid('CHR')}, ${cli}, '2026-05-01', '2026-05-31', 90, 'Healthy', true, '[]'::jsonb, 'system')`;

    const res = await runSnapshotJob(sql, nowJul);
    expect(res.bandDropsFlagged).toBe(1);

    // Count the band-drop notifications routed to ZZ-SPV for THIS client's June
    // snapshot specifically — notifications are append-only (never cleaned), so a
    // recipient-wide count would accumulate across re-runs on a shared dev DB.
    const [{ id: snapId }] = await sql<{ id: string }[]>`
      select id from client_health_snapshots
       where client_id = ${cli} and to_char(period_start, 'YYYYMM') = ${junePeriod}`;
    const notifCount = async (): Promise<number> =>
      (await sql<{ n: number }[]>`
        select count(*)::int as n from notifications
        where recipient_employee_id = 'ZZ-SPV' and event_type = 'm13.client.band_drop' and entity_id = ${snapId}`)[0].n;
    expect(await notifCount()).toBe(1);

    // Re-run: no new snapshot ⇒ no new emission (fire-once by construction).
    await runSnapshotJob(sql, nowJul);
    expect(await notifCount()).toBe(1);
  });
});

// ---- grace period (Rule 8) / div-zero → excluded, never an error ----
describeDb('exclusion paths', () => {
  it('excludes GMV during the new-client grace month (Rule 8)', async () => {
    // Onboarded mid-June ⇒ first full month is July ⇒ GMV excluded for June.
    const cli = uid('CLI');
    await insClient(cli, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date('2026-06-15T00:00:00Z'));
    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director('D'), cli, junePeriod);
    expect(compByName(snap.components, COMP_GMV_GROWTH).included).toBe(false);
  });

  it('excludes (not errors) when Target==Baseline; only Complaints available ⇒ 100/Healthy', async () => {
    const cli = uid('CLI');
    await insClient(cli, 'ZZ-AM', '50000000.00', '50000000.00', '60000000.00', new Date('2026-04-01T00:00:00Z'));
    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director('D'), cli, junePeriod);
    expect(compByName(snap.components, COMP_GMV_GROWTH).included).toBe(false);
    expect(snap.finalHealthScore).toBe(100);
    expect(snap.band).toBe(BAND_HEALTHY);
  });
});

// ---- ROAS toggle (Rule 13 / §5.4) ----
describeDb('ROAS Inclusion Toggle (Rule 13)', () => {
  it('default follows the active-Ads signal; an OFF override excludes ROAS + audits', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');

    // Default: active Ads ⇒ effective true, no override.
    const tg0 = await getRoasToggle(sql, amActor('ZZ-AM'), cli);
    expect(tg0.effective).toBe(true);
    expect(tg0.override).toBeNull();

    // AM toggles OFF.
    const tg1 = await setRoasToggle(sql, amActor('ZZ-AM'), cli, false);
    expect(tg1.override).toBe(false);
    expect(tg1.effective).toBe(false);

    // Preview now excludes ROAS and redistributes.
    const prev = await preview(sql, amActor('ZZ-AM'), cli, nowJul);
    expect(compByName(prev.components, COMP_ROAS_ATTAINMENT).included).toBe(false);
    expect(prev.preview).toBe(true);

    // Audit row recorded.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_type = 'client' and entity_id = ${cli} and action = 'roas_health_toggle_set'`;
    expect(n).toBe(1);
  });

  it('a client with no Ads service is structurally N/A even with an ON override', async () => {
    const cli = uid('CLI');
    await insClient(cli, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date('2026-04-01T00:00:00Z'));
    const tg = await setRoasToggle(sql, accountLead('ZZ-LEAD'), cli, true);
    expect(tg.effective).toBe(false); // structural N/A (Rule 13)
  });
});

// ---- visibility (Rule 11) + scan gate ----
describeDb('visibility (Rule 11) + scan gate', () => {
  it('gates get by owner/division/OD/Director and rejects non-Account; gates the sweep', async () => {
    const cli = uid('CLI');
    await alphaDigital(cli, 'ZZ-AM');
    await runSnapshotJob(sql, nowJul);

    // Owning AM sees it; a different AM gets NotFound (own-book only).
    await expect(getSnapshot(sql, amActor('ZZ-AM'), cli, junePeriod)).resolves.toBeDefined();
    await expect(getSnapshot(sql, amActor('ZZ-OTHER'), cli, junePeriod)).rejects.toBeInstanceOf(NotFoundError);
    // Account lead / OD / Director all see it.
    for (const a of [accountLead('L'), odActor('O'), director('D')]) {
      await expect(getSnapshot(sql, a, cli, junePeriod)).resolves.toBeDefined();
    }
    // A non-Account execution staffer has no scope.
    await expect(getSnapshot(sql, creativeStaff('C'), cli, junePeriod)).rejects.toBeInstanceOf(ForbiddenError);

    // Scan gate: Account/Director may run; OD (read-only) and other divisions may not.
    await expect(runScan(sql, accountLead('L'), nowJul)).resolves.toBeDefined();
    await expect(runScan(sql, director('D'), nowJul)).resolves.toBeDefined();
    await expect(runScan(sql, odActor('O'), nowJul)).rejects.toBeInstanceOf(ScanForbiddenError);
    await expect(runScan(sql, creativeStaff('C'), nowJul)).rejects.toBeInstanceOf(ScanForbiddenError);
  });
});
