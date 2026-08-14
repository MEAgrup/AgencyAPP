/**
 * Tests for M13 health.ts — the pure weighted scoring core (PRD §4 Alpha Digital
 * worked example, capping, redistribution, band boundaries) and the DB-backed
 * snapshot sweep / preview / ROAS toggle / visibility gates.
 *
 * Isolation notes: client_health_snapshots is append-only (no DELETE trigger), so
 * cleanup TRUNCATEs it (TRUNCATE bypasses row triggers) — only M13 uses that table.
 * audit_log is append-only too, so every test uses a UNIQUE client id and the
 * global RunSnapshotJob is asserted per-client, never on the global count.
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
  canToggleRoas,
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
  portfolio,
  preview,
  runScan,
  runSnapshotJob,
  score,
  setRoasToggle,
  type Actor,
  type Candidate,
  type Component,
} from './health';

const amActor = (id: string): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (id = 'ZZ-LEAD'): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = (id = 'ZZ-DIR'): Actor => ({ employeeId: id, divisi: 'Management', role: permission.makeRole({ director: true }) });
const od = (id = 'ZZ-OD'): Actor => ({ employeeId: id, divisi: 'Management', role: permission.makeRole({ od: true }) });
const creativeStaff = (id = 'ZZ-C'): Actor => ({ employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });

const find = (comps: Component[], name: string): Component | undefined => comps.find((c) => c.name === name);

// ---------------------------------------------------------------------------
// Pure scoring core (no DB).
// ---------------------------------------------------------------------------
describe('health scoring core', () => {
  it('Alpha Digital worked example (§4): Satisfaction excluded, ÷0.9 redistribution, ≈74.56 → Watch', () => {
    const cands: Candidate[] = [
      { name: COMP_GMV_GROWTH, included: true, raw: 40 },
      { name: COMP_ROAS_ATTAINMENT, included: true, raw: 84 },
      { name: COMP_TASK_COMPLETION, included: true, raw: 90 },
      { name: COMP_REVISION_BURDEN, included: true, raw: 76 },
      { name: COMP_COMPLAINTS, included: true, raw: 95 },
      { name: COMP_SATISFACTION, included: false, raw: 0 },
      { name: COMP_PAYMENT_TIMELINESS, included: true, raw: 100 },
    ];
    const r = score(cands);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.finalScore - 6710 / 90)).toBeLessThan(0.001);
    expect(r.band).toBe(BAND_WATCH);
    expect(Math.abs(find(r.components, COMP_GMV_GROWTH)!.effectiveWeight - (25 * 100) / 90)).toBeLessThan(0.001);
    expect(Math.abs(find(r.components, COMP_PAYMENT_TIMELINESS)!.effectiveWeight - (10 * 100) / 90)).toBeLessThan(0.001);
    const sat = find(r.components, COMP_SATISFACTION)!;
    expect(sat.included).toBe(false);
    expect(sat.effectiveWeight).toBe(0);
    expect(sat.raw).toBeNull();
    expect(sat.capped).toBeNull();
    const sumEff = r.components.reduce((a, c) => a + c.effectiveWeight, 0);
    expect(Math.abs(sumEff - 100)).toBeLessThan(0.001);
  });

  it('caps raw into [0,100] for the composite while preserving the uncapped raw (Rule 5/6)', () => {
    const r = score([
      { name: COMP_ROAS_ATTAINMENT, included: true, raw: 250 },
      { name: COMP_GMV_GROWTH, included: true, raw: -30 },
    ]);
    expect(r.ok).toBe(true);
    const roas = find(r.components, COMP_ROAS_ATTAINMENT)!;
    expect(roas.raw).toBe(250);
    expect(roas.capped).toBe(100);
    const gmv = find(r.components, COMP_GMV_GROWTH)!;
    expect(gmv.raw).toBe(-30);
    expect(gmv.capped).toBe(0);
  });

  it('all-excluded is not an error (ok=false, no band)', () => {
    const r = score([
      { name: COMP_GMV_GROWTH, included: false, raw: 0, reason: 'grace' },
      { name: COMP_SATISFACTION, included: false, raw: 0, reason: 'placeholder' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.components.every((c) => !c.included)).toBe(true);
  });

  it('bandFor covers the Rule 7 boundaries', () => {
    expect(bandFor(100)).toBe(BAND_HEALTHY);
    expect(bandFor(80)).toBe(BAND_HEALTHY);
    expect(bandFor(79.999)).toBe(BAND_WATCH);
    expect(bandFor(60)).toBe(BAND_WATCH);
    expect(bandFor(59.999)).toBe(BAND_AT_RISK);
    expect(bandFor(0)).toBe(BAND_AT_RISK);
  });

  it('permission gates (§Rule 11 / scan / toggle)', () => {
    expect(canView(amActor('A'), 'A')).toBe(true); // own client
    expect(canView(amActor('A'), 'OTHER')).toBe(false);
    expect(canView(accountLead(), 'A')).toBe(true);
    expect(canView(od(), 'A')).toBe(true);
    expect(canView(director(), 'A')).toBe(true);
    expect(canView(creativeStaff(), 'A')).toBe(false);
    expect(canRunScan(accountLead())).toBe(true);
    expect(canRunScan(director())).toBe(true);
    expect(canRunScan(od())).toBe(false); // read-only
    expect(canRunScan(creativeStaff())).toBe(false);
    expect(canToggleRoas(amActor('A'))).toBe(true);
    expect(canToggleRoas(director())).toBe(true);
    expect(canToggleRoas(od())).toBe(false);
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
const uniq = (): string => `${Date.now() % 1000000}-${seq++}`;
// Fixed clock: WIB 2026-07-17 12:00 → most-recently CLOSED month = June 2026.
const nowJul = new Date(Date.UTC(2026, 6, 17, 5, 0, 0));
const junePeriod = '202606';

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
    insert into briefs (id, service_id, title, status, assigned_division, created_by)
    values (${id}, ${svcId}, 'B', '[In Progress]', ${division}, 'ZZ-TEST')`;
}
async function insAudit(entityType: string, entityId: string, action: string, at: Date): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
    values (${entityType}, ${entityId}, 'system', ${action}, 'system', ${at})`;
}
async function insTask(id: string, briefId: string, seq0: number, sla: number, turnaroundH: number, revisions: number, start: Date): Promise<void> {
  await sql`
    insert into assets (id, brief_id, asset_type, sequence_no, status, sla_target_hours, created_by)
    values (${id}, ${briefId}, 'Video', ${seq0}, '[Approved]', ${sla}, 'ZZ-TEST')`;
  await insAudit('asset', id, 'transition:[To Do]->[In Progress]', start);
  for (let i = 0; i < revisions; i++) {
    await insAudit('asset', id, 'transition:[In Review]->[Revision Requested]', new Date(start.getTime() + (i + 1) * 60_000));
  }
  await insAudit('asset', id, 'transition:[In Review]->[Approved]', new Date(start.getTime() + turnaroundH * 3_600_000));
}
async function insAdCampaign(id: string, briefId: string, clientId: string, status: string, targetKPI: string): Promise<void> {
  await sql`
    insert into ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
    values (${id}, ${briefId}, ${clientId}, 'Shopee Ads', 'Conversion', '100000000.00', '2026-06-01', '2026-12-31', ${targetKPI}, ${status}, 'ZZ-TEST')`;
}
async function insMetricEntry(id: string, campaignId: string, periodStart: string, spend: string, gmv: string): Promise<void> {
  await sql`
    insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_by)
    values (${id}, ${campaignId}, ${periodStart}::date, ${periodStart}::date, ${spend}, ${gmv}, 'Manual', 'system', 'ZZ-TEST')`;
}
async function insTransaction(id: string, clientId: string): Promise<void> {
  await sql`
    insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
    values (${id}, ${clientId}, 'Termin', '10000000.00', '[Terverifikasi]', 'ZZ-TEST')`;
}
async function insInstallment(id: string, trxId: string, no: number, dueDate: string, overdue: boolean): Promise<void> {
  await sql`
    insert into installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
    values (${id}, ${trxId}, ${no}, '5000000.00', ${dueDate}::date, '[Terverifikasi]', 'ZZ-TEST')`;
  if (overdue) {
    await insAudit('installment', id, 'transition:[Belum Jatuh Tempo]->[Jatuh Tempo]', new Date(Date.UTC(2026, 5, 16)));
  }
}
async function insComplaint(id: string, clientId: string, severity: string, at: Date): Promise<void> {
  await sql`
    insert into complaints (id, client_id, source, description, severity, status, created_at, created_by)
    values (${id}, ${clientId}, 'WhatsApp (AM-logged)', 'x', ${severity}, '[Open]', ${at}, 'ZZ-TEST')`;
}
async function registerLead(id: string, division: string): Promise<void> {
  const jab = `ZZ-${division}-lead-${id}`;
  await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@x'}, ${division}, ${jab}, true, 'ZZ-TEST') on conflict (employee_id) do nothing`;
  await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${division}, ${jab}, ${division}, 'lead', 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;
}

/** Builds the full §4 Alpha Digital worked example for one client (June 2026). Returns the client id. */
async function alphaDigital(amId: string): Promise<string> {
  const u = uniq();
  const cid = `CLI-A-${u}`;
  const svcId = `SVC-${u}`;
  // GMV: 50M → 80M → 62M ⇒ raw 40. Onboarded April (no grace for June).
  await insClient(cid, amId, '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
  await insService(svcId, cid);
  // Creative brief + 10 tasks: 9 within SLA (speed 50%), 1 over (200%) ⇒ Task 90; revisions Σ12 ⇒ avg 1.2 ⇒ Burden 76.
  const crBrief = `BRF-CR-${u}`;
  await insBrief(crBrief, svcId, 'Creative');
  const start = new Date(Date.UTC(2026, 5, 10));
  const revs = [2, 2, 1, 1, 1, 1, 1, 1, 1, 1];
  for (let i = 0; i < 10; i++) {
    await insTask(`AST-${u}-${i}`, crBrief, i + 1, 10, i === 9 ? 20 : 5, revs[i], start);
  }
  // ROAS: active campaign, target 5x, actual 4.2x (spend 100M, gmv 420M) ⇒ 84.
  const adBrief = `BRF-AD-${u}`;
  await insBrief(adBrief, svcId, 'Ads');
  const adc = `ADC-${u}`;
  await insAdCampaign(adc, adBrief, cid, '[Active]', 'ROAS 5');
  await insMetricEntry(`MTR-${u}`, adc, '2026-06-05', '100000000.00', '420000000.00');
  // Payment: 1 installment due in June, on time ⇒ 100.
  const trx = `TRX-${u}`;
  await insTransaction(trx, cid);
  await insInstallment(`INST-${u}`, trx, 1, '2026-06-15', false);
  // Complaints: 1 Low in June ⇒ 95.
  await insComplaint(`CPL-${u}`, cid, 'Low', new Date(Date.UTC(2026, 5, 12)));
  return cid;
}

const snapCount = async (clientId: string): Promise<number> =>
  Number((await sql<{ n: string }[]>`select count(*)::int as n from client_health_snapshots where client_id = ${clientId}`)[0].n);

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`truncate client_health_snapshots`; // append-only; TRUNCATE bypasses the no-DELETE trigger. M13-only table.
  await sql`delete from weekly_result_recap where created_by like 'ZZ-%'`; // D-12 portfolio fixtures (FK → clients)
  await sql`delete from complaints where created_by like 'ZZ-%'`;
  await sql`delete from metric_entries where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaigns where created_by like 'ZZ-%'`;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

describeDb('snapshot sweep — Alpha Digital end to end', () => {
  it('scores the worked example ≈74.56 / Watch with recomputed sub-scores', async () => {
    const cid = await alphaDigital('ZZ-AM');
    const res = await runSnapshotJob(sql, nowJul);
    expect(res.period).toBe(junePeriod);
    expect(res.snapshotsMade).toBeGreaterThanOrEqual(1);

    const snap = await getSnapshot(sql, director(), cid, junePeriod);
    expect(snap.finalHealthScore).not.toBeNull();
    expect(Math.abs(snap.finalHealthScore! - 6710 / 90)).toBeLessThan(0.01);
    expect(snap.band).toBe(BAND_WATCH);
    expect(snap.roasToggleState).toBe(true);
    const checks: Record<string, number> = {
      [COMP_GMV_GROWTH]: 40, [COMP_ROAS_ATTAINMENT]: 84, [COMP_TASK_COMPLETION]: 90,
      [COMP_REVISION_BURDEN]: 76, [COMP_COMPLAINTS]: 95, [COMP_PAYMENT_TIMELINESS]: 100,
    };
    for (const [name, want] of Object.entries(checks)) {
      const c = find(snap.components, name)!;
      expect(c.included).toBe(true);
      expect(Math.abs((c.raw ?? NaN) - want)).toBeLessThan(0.001);
    }
    expect(find(snap.components, COMP_SATISFACTION)!.included).toBe(false);
  });

  it('is idempotent: a second sweep makes no new snapshot for the client', async () => {
    const cid = await alphaDigital('ZZ-AM');
    await runSnapshotJob(sql, nowJul);
    await runSnapshotJob(sql, nowJul);
    expect(await snapCount(cid)).toBe(1);
  });

  it('snapshots are immutable (no UPDATE / no DELETE)', async () => {
    const cid = await alphaDigital('ZZ-AM');
    await runSnapshotJob(sql, nowJul);
    const id = (await sql<{ id: string }[]>`select id from client_health_snapshots where client_id = ${cid}`)[0].id;
    await expect(sql`update client_health_snapshots set band='Healthy' where id=${id}`).rejects.toBeDefined();
    await expect(sql`delete from client_health_snapshots where id=${id}`).rejects.toBeDefined();
  });
});

describeDb('band drop (Rule 12) + grace + div-zero', () => {
  it('a strictly lower band than the prior snapshot flags the Account SPV once', async () => {
    const spv = `ZZ-SPV-${uniq()}`;
    await registerLead(spv, 'Account');
    const cid = await alphaDigital('ZZ-AM'); // June → Watch
    // Pre-existing MAY snapshot in a healthier band → June is a drop.
    await sql`
      insert into client_health_snapshots (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
      values (${`CHR-202605-${uniq()}`.slice(0, 24)}, ${cid}, '2026-05-01'::date, '2026-05-31'::date, 90, 'Healthy', true, '[]'::jsonb, 'system')`;

    await runSnapshotJob(sql, nowJul);
    const drops = async (): Promise<number> =>
      Number((await sql<{ n: string }[]>`
        select count(*)::int as n from notifications
        where recipient_employee_id = ${spv} and event_type = 'm13.client.band_drop'`)[0].n);
    expect(await drops()).toBe(1);
    // Re-run: no new snapshot ⇒ no new emission (fire-once by construction).
    await runSnapshotJob(sql, nowJul);
    expect(await drops()).toBe(1);
  });

  it('grace period (Rule 8) excludes GMV in the first full month', async () => {
    const cid = `CLI-NEW-${uniq()}`;
    // Onboarded mid-June ⇒ first full month is July ⇒ GMV excluded for June.
    await insClient(cid, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 5, 15)));
    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director(), cid, junePeriod);
    expect(find(snap.components, COMP_GMV_GROWTH)!.included).toBe(false);
  });

  it('div-zero (Target==Baseline) excludes GMV, never errors; only Complaints ⇒ 100 / Healthy', async () => {
    const cid = `CLI-FLAT-${uniq()}`;
    await insClient(cid, 'ZZ-AM', '50000000.00', '50000000.00', '60000000.00', new Date(Date.UTC(2026, 3, 1)));
    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director(), cid, junePeriod);
    expect(find(snap.components, COMP_GMV_GROWTH)!.included).toBe(false);
    expect(snap.finalHealthScore).toBe(100);
    expect(snap.band).toBe(BAND_HEALTHY);
  });
});

describeDb('ROAS Inclusion Toggle (Rule 13 / §5.4)', () => {
  it('default active-Ads ⇒ effective true; AM toggles OFF ⇒ excluded + audited', async () => {
    const cid = await alphaDigital('ZZ-AM');
    let tg = await getRoasToggle(sql, amActor('ZZ-AM'), cid);
    expect(tg.effective).toBe(true);
    expect(tg.override).toBeNull();

    tg = await setRoasToggle(sql, amActor('ZZ-AM'), cid, false);
    expect(tg.override).toBe(false);
    expect(tg.effective).toBe(false);

    const prev = await preview(sql, amActor('ZZ-AM'), cid, nowJul);
    expect(find(prev.components, COMP_ROAS_ATTAINMENT)!.included).toBe(false);

    const n = Number(
      (await sql<{ n: string }[]>`
        select count(*)::int as n from audit_log
        where entity_type='client' and entity_id=${cid} and action='roas_health_toggle_set'`)[0].n,
    );
    expect(n).toBe(1);
  });

  it('no Ads service ⇒ structurally N/A even with an explicit ON override', async () => {
    const cid = `CLI-NOADS-${uniq()}`;
    await insClient(cid, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
    const tg = await setRoasToggle(sql, accountLead(), cid, true);
    expect(tg.effective).toBe(false);
  });
});

describeDb('visibility (Rule 11) + scan gate', () => {
  it('owning AM sees; other AM 404; lead/OD/Director see; creative forbidden; scan gate', async () => {
    const cid = await alphaDigital('ZZ-AM');
    await runSnapshotJob(sql, nowJul);

    await expect(getSnapshot(sql, amActor('ZZ-AM'), cid, junePeriod)).resolves.toBeDefined();
    await expect(getSnapshot(sql, amActor('ZZ-OTHER'), cid, junePeriod)).rejects.toBeInstanceOf(NotFoundError);
    for (const a of [accountLead(), od(), director()]) {
      await expect(getSnapshot(sql, a, cid, junePeriod)).resolves.toBeDefined();
    }
    await expect(getSnapshot(sql, creativeStaff(), cid, junePeriod)).rejects.toBeInstanceOf(ForbiddenError);

    await expect(runScan(sql, accountLead(), nowJul)).resolves.toBeDefined();
    await expect(runScan(sql, director(), nowJul)).resolves.toBeDefined();
    await expect(runScan(sql, od(), nowJul)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runScan(sql, creativeStaff(), nowJul)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// D-12 portfolio landing — one row per ACTIVE client, canScope+canView gated.
async function insRecap(id: string, clientId: string, isoWeek: number, status: string, autoFlag = false): Promise<void> {
  const mon = new Date(Date.UTC(2026, 0, 5) + (isoWeek - 1) * 7 * 86_400_000); // Mon 2026-01-05 + weeks
  const monday = mon.toISOString().slice(0, 10);
  const sunday = new Date(mon.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  await sql`
    insert into weekly_result_recap (id, client_id, iso_year, iso_week, minggu_mulai, minggu_akhir,
      status, pernah_ditutup_otomatis, created_by)
    values (${id}, ${clientId}, 2026, ${isoWeek}, ${monday}::date, ${sunday}::date, ${status}, ${autoFlag}, 'ZZ-TEST')`;
}

describeDb('portfolio landing (D-12)', () => {
  it('lists only active clients, with band, open-complaint count and last closed-recap week', async () => {
    const active = `CLI-ACT-${uniq()}`;
    const inactive = `CLI-INACT-${uniq()}`;
    await insClient(active, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
    await insService(`SVC-A-${uniq()}`, active); // [In Execution] ⇒ active
    // inactive: only a Done service ⇒ excluded by RM-2.
    await insClient(inactive, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
    const svcDone = `SVC-D-${uniq()}`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
        standard_price, commission_rule, status, requires_strategy_plan, created_by)
      values (${svcDone}, ${inactive}, 'MSV-X', 1, 'Full Mgmt', '10000000.00', 'rule', 'Done', false, 'ZZ-TEST')`;

    await insComplaint(`CPL-O-${uniq()}`, active, 'High', new Date(Date.UTC(2026, 7, 1))); // [Open]
    await insRecap(`WRR-C-${uniq()}`.slice(0, 24), active, 30, 'Ditutup');
    await insRecap(`WRR-O-${uniq()}`.slice(0, 24), active, 31, 'Terbuka'); // newer, not closed
    await runSnapshotJob(sql, nowJul); // gives `active` a June snapshot/band

    const rows = await portfolio(sql, director());
    const a = rows.find((r) => r.clientId === active);
    expect(a).toBeDefined();
    expect(rows.find((r) => r.clientId === inactive)).toBeUndefined(); // RM-2 excludes all-Done
    expect(a!.band).not.toBe(''); // snapshot exists
    expect(a!.openComplaints).toBe(1);
    expect(a!.lastClosedRecapWeek).toBe('2026-W30'); // the Ditutup week, not the Terbuka one
  });

  it('T-2 (RM-2): all-hold client STAYS in the report, flagged onHold; a mixed client is not flagged', async () => {
    const insSvcStatus = async (id: string, clientId: string, status: string): Promise<void> => {
      await sql`insert into services (id, client_id, master_service_id, master_version_no, name,
          standard_price, commission_rule, status, requires_strategy_plan, created_by)
        values (${id}, ${clientId}, 'MSV-X', 1, 'Full Mgmt', '10000000.00', 'rule', ${status}, false, 'ZZ-TEST')`;
    };
    // held: its only service is On Hold ⇒ still active (On Hold is non-terminal), flagged.
    const held = `CLI-HELD-${uniq()}`;
    await insClient(held, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
    await insSvcStatus(`SVC-H-${uniq()}`, held, '[On Hold]');
    // mixed: one live + one held ⇒ NOT all-hold.
    const mixed = `CLI-MIX-${uniq()}`;
    await insClient(mixed, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
    await insService(`SVC-MX1-${uniq()}`, mixed); // [In Execution]
    await insSvcStatus(`SVC-MX2-${uniq()}`, mixed, '[On Hold]');

    const rows = await portfolio(sql, director());
    const h = rows.find((r) => r.clientId === held);
    expect(h).toBeDefined(); // owner decision 2026-08-14: kept in Health report, not skipped
    expect(h!.onHold).toBe(true);
    const m = rows.find((r) => r.clientId === mixed);
    expect(m).toBeDefined();
    expect(m!.onHold).toBe(false); // has a live non-held service
  });

  it('canScope gate: Account staff sees only own clients; creative forbidden', async () => {
    const mine = `CLI-MINE-${uniq()}`;
    const theirs = `CLI-THEIRS-${uniq()}`;
    await insClient(mine, 'ZZ-AM', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
    await insService(`SVC-M-${uniq()}`, mine);
    await insClient(theirs, 'ZZ-OTHER', '50000000.00', '80000000.00', '62000000.00', new Date(Date.UTC(2026, 3, 1)));
    await insService(`SVC-T-${uniq()}`, theirs);

    const staffRows = await portfolio(sql, amActor('ZZ-AM'));
    expect(staffRows.some((r) => r.clientId === mine)).toBe(true);
    expect(staffRows.some((r) => r.clientId === theirs)).toBe(false); // canView: staff sees own AM only
    // Account lead sees both.
    const leadRows = await portfolio(sql, accountLead());
    expect(leadRows.some((r) => r.clientId === mine)).toBe(true);
    expect(leadRows.some((r) => r.clientId === theirs)).toBe(true);
    // Non-Account has no scope.
    await expect(portfolio(sql, creativeStaff())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
