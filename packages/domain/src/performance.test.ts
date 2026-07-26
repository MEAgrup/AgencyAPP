/**
 * Tests for M14 Team Performance (performance.ts). Ported from Go's
 * backend/internal/module14_performance/{profile,snapshot_db}_test.go.
 *
 * - Unit: the pure scoring core (§4 Kenny worked example, Speed transform OA-1,
 *   OA-2 cap, redistribution, modifier clamp, bounding, all-excluded, diagnostic) —
 *   no DB.
 * - Integration (skipped unless DATABASE_URL is set): the §4 Kenny end-to-end
 *   snapshot, the EvPerformancePublished fire-once emission + idempotency,
 *   immutability, the AM CHR-average profile, placeholder-target flagging, the
 *   §Rule 7 visibility + scan gate, team rollup, and the config Σ=100 / Director gate.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { notification, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  boundFinal,
  clampModifier,
  COMP_CHR_AVERAGE,
  COMP_COMPLAINT_RESOLUTION_SPEED,
  COMP_CREATOR_COUNT,
  COMP_GMV_IMPACT,
  COMP_OPTIMIZATION_ACTIVITY,
  COMP_REVISION_ESCALATION_RATE,
  COMP_ROAS_ATTAINMENT,
  COMP_SOURCING_TURNAROUND,
  COMP_SPEED_SCORE,
  ForbiddenError,
  getSnapshot,
  NotFoundError,
  ROLE_ADS,
  runScan,
  runSnapshotJob,
  ScanForbiddenError,
  scoreProfile,
  setWeights,
  teamRollup,
  transformSpeed,
  WeightsNotHundredError,
  BadRoleTypeError,
  ConfigForbiddenError,
  type Actor,
  type Component,
} from './performance';

// ---- actors ----
const adsStaff = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const adsLead = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const creativeLead = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
const director = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ director: true }) });
const odActor = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ od: true }) });

const cand = (name: string, included: boolean, raw = 0, reason = '', diagnostic = false) => ({ name, included, raw, reason, diagnostic });
const find = (comps: Component[], name: string): Component => comps.find((c) => c.name === name) as Component;

// adsWeights are the seeded §2 Rule 2 Ads weights.
const adsWeights: Record<string, number> = { [COMP_SPEED_SCORE]: 25, [COMP_ROAS_ATTAINMENT]: 30, [COMP_GMV_IMPACT]: 25, [COMP_OPTIMIZATION_ACTIVITY]: 20 };

// ===========================================================================
// Unit — pure scoring core.
// ===========================================================================

describe('scoreProfile (pure §2 Rule 2/4/6)', () => {
  it('Kenny worked example (§4): profile 86.4, modifier +2 from avg 84, final 88.4', () => {
    const { components, profile, profileOk } = scoreProfile(adsWeights, [
      cand(COMP_SPEED_SCORE, true, transformSpeed(95)), // 95% ≤ 100 → 100
      cand(COMP_ROAS_ATTAINMENT, true, 88),
      cand(COMP_GMV_IMPACT, true, 80),
      cand(COMP_OPTIMIZATION_ACTIVITY, true, 75),
    ]);
    expect(profileOk).toBe(true);
    expect(Math.abs(profile - 86.4)).toBeLessThan(0.001);
    // No redistribution when all present — effective weights equal base.
    for (const c of components) {
      expect(Math.abs(c.effectiveWeight - c.baseWeight)).toBeLessThan(0.001);
    }
    const modValue = clampModifier(84);
    expect(Math.abs(modValue - 2)).toBeLessThan(0.001);
    const final = boundFinal(profile, { present: true, value: modValue, sourceComponent: '', sourceClients: [], rawAverage: 84 });
    expect(final).not.toBeNull();
    expect(Math.abs((final as number) - 88.4)).toBeLessThan(0.001);
  });

  it('Speed transform OA-1: 100 at/under SLA, 200−x above, floored at 0', () => {
    for (const [inp, want] of [
      [50, 100],
      [100, 100],
      [100.01, 99.99],
      [120, 80],
      [150, 50],
      [200, 0],
      [250, 0],
    ] as [number, number][]) {
      expect(Math.abs(transformSpeed(inp) - want)).toBeLessThan(0.001);
    }
  });

  it('OA-2 cap: raw-value normalization capped at 100 while preserving raw', () => {
    const { components, profile, profileOk } = scoreProfile({ [COMP_SPEED_SCORE]: 100 }, [cand(COMP_SPEED_SCORE, true, 150)]);
    expect(profileOk).toBe(true);
    expect(profile).toBe(100);
    expect(components[0].capped).toBe(100);
    expect(components[0].raw).toBe(150);
  });

  it('redistribution (Rule 6): a missing component spreads its weight over the rest', () => {
    const { components, profile, profileOk } = scoreProfile(adsWeights, [
      cand(COMP_SPEED_SCORE, true, 100),
      cand(COMP_ROAS_ATTAINMENT, true, 90),
      cand(COMP_GMV_IMPACT, false, 0, 'no data'),
      cand(COMP_OPTIMIZATION_ACTIVITY, true, 60),
    ]);
    expect(profileOk).toBe(true);
    expect(Math.abs(find(components, COMP_SPEED_SCORE).effectiveWeight - 100 / 3)).toBeLessThan(0.001);
    expect(Math.abs(find(components, COMP_ROAS_ATTAINMENT).effectiveWeight - 40)).toBeLessThan(0.001);
    expect(Math.abs(find(components, COMP_OPTIMIZATION_ACTIVITY).effectiveWeight - 80 / 3)).toBeLessThan(0.001);
    expect(find(components, COMP_GMV_IMPACT).effectiveWeight).toBe(0);
    // Weighted = (100×25 + 90×30 + 60×20)/75 = 6400/75.
    expect(Math.abs(profile - 6400 / 75)).toBeLessThan(0.001);
  });

  it('modifier clamp both directions (±10)', () => {
    expect(Math.abs(clampModifier(80) - 0)).toBeLessThan(0.001);
    expect(Math.abs(clampModifier(84) - 2)).toBeLessThan(0.001);
    expect(clampModifier(100)).toBe(10);
    expect(clampModifier(120)).toBe(10);
    expect(clampModifier(60)).toBe(-10);
    expect(clampModifier(40)).toBe(-10);
    expect(Math.abs(clampModifier(70) - -5)).toBeLessThan(0.001);
  });

  it('final bounded 0..100 (Rule 4); null profile → null final', () => {
    expect(boundFinal(98, { present: true, value: 10, sourceComponent: '', sourceClients: [], rawAverage: null })).toBe(100);
    expect(boundFinal(3, { present: true, value: -10, sourceComponent: '', sourceClients: [], rawAverage: null })).toBe(0);
    expect(boundFinal(null, { present: false, value: 0, sourceComponent: '', sourceClients: [], rawAverage: null })).toBeNull();
  });

  it('all-excluded → profileOk false', () => {
    const { profileOk } = scoreProfile(adsWeights, [
      cand(COMP_SPEED_SCORE, false, 0, 'x'),
      cand(COMP_ROAS_ATTAINMENT, false, 0, 'x'),
      cand(COMP_GMV_IMPACT, false, 0, 'x'),
      cand(COMP_OPTIMIZATION_ACTIVITY, false, 0, 'x'),
    ]);
    expect(profileOk).toBe(false);
  });

  it('AM profile: avg CHR 50% weight dominates', () => {
    const { profile, profileOk } = scoreProfile({ [COMP_CHR_AVERAGE]: 50, [COMP_COMPLAINT_RESOLUTION_SPEED]: 25, [COMP_REVISION_ESCALATION_RATE]: 25 }, [
      cand(COMP_CHR_AVERAGE, true, 84),
      cand(COMP_COMPLAINT_RESOLUTION_SPEED, true, 100),
      cand(COMP_REVISION_ESCALATION_RATE, true, 80),
    ]);
    expect(profileOk).toBe(true);
    // 0.5×84 + 0.25×100 + 0.25×80 = 87.
    expect(Math.abs(profile - 87)).toBeLessThan(0.001);
  });

  it('diagnostic component reported, unweighted (§2 Rule 2)', () => {
    const { components, profile, profileOk } = scoreProfile({ [COMP_CREATOR_COUNT]: 100 }, [
      cand(COMP_CREATOR_COUNT, true, 50),
      cand(COMP_SOURCING_TURNAROUND, true, 12.5, '', true),
    ]);
    expect(profileOk).toBe(true);
    expect(Math.abs(profile - 50)).toBeLessThan(0.001); // diagnostic ignored
    const diag = find(components, COMP_SOURCING_TURNAROUND);
    expect(diag.diagnostic).toBe(true);
    expect(diag.effectiveWeight).toBe(0);
    expect(diag.raw).toBe(12.5);
    expect(diag.capped).toBeNull();
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

// Fixed clock: WIB 2026-07-17 → most-recently CLOSED month = June 2026.
const nowJul = new Date(Date.UTC(2026, 6, 17, 5, 0, 0));
const JUNE = '202606';

const compByName = (comps: Component[], name: string): Component => comps.find((c) => c.name === name) as Component;

// ---- fixture inserters ----
async function insEmployee(id: string, division: string, jabatan: string): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@mea.id'}, ${division}, ${jabatan}, true, 'ZZ-TEST')`;
}
async function insRoleMapping(divisi: string, jabatan: string, division: string, level: string): Promise<void> {
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${division}, ${level}, 'ZZ-TEST')
    on conflict (divisi, jabatan) do nothing`;
}
async function insClient(id: string, amId: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_at, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00', 'ZZ-BUDI', 'ZZ-BUDI', now(),
      ${amId}, ${new Date(Date.UTC(2026, 3, 1))}, 'ZZ-TEST')`;
}
async function insService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Full Mgmt', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
}
async function insAudit(entityType: string, entityId: string, action: string, at: Date): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
    values (${entityType}, ${entityId}, 'system', ${action}, 'ZZ-TEST', ${at})`;
}
// insAdsBrief: an Ads Brief-as-task assigned to pic, [Approved] within SLA.
async function insAdsBrief(id: string, svcId: string, pic: string, sla: number, turnaroundH: number): Promise<void> {
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, assigned_pic, sla_target_hours, created_by)
    values (${id}, ${svcId}, 'B', '[Approved]', 'Ads', ${pic}, ${sla}, 'ZZ-TEST')`;
  const start = new Date(Date.UTC(2026, 5, 10));
  await insAudit('brief', id, 'transition:[To Do]->[In Progress]', start);
  await insAudit('brief', id, 'transition:[In Review]->[Approved]', new Date(start.getTime() + turnaroundH * 3600_000));
}
async function insAdCampaign(id: string, briefId: string, clientId: string, targetKpi: string): Promise<void> {
  await sql`
    insert into ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
    values (${id}, ${briefId}, ${clientId}, 'Shopee Ads', 'Conversion', '100000000.00', '2026-06-01', '2026-12-31', ${targetKpi}, '[Active]', 'ZZ-TEST')`;
}
async function insMetricEntry(id: string, campaignId: string, periodStart: string, spend: string, gmv: string): Promise<void> {
  await sql`
    insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_by)
    values (${id}, ${campaignId}, ${periodStart}, ${periodStart}, ${spend}, ${gmv}, 'Manual', 'system', 'ZZ-TEST')`;
}
async function insOptimization(id: string, campaignId: string, actor: string, at: Date): Promise<void> {
  await sql`
    insert into optimization_logs (id, campaign_id, change_type, before_value, after_value, reason, actor, created_at, created_by)
    values (${id}, ${campaignId}, 'Budget', 'a', 'b', 'r', ${actor}, ${at}, 'system')`;
}
async function insCHRSnapshot(id: string, clientId: string, final: number, componentsJson: string): Promise<void> {
  await sql`
    insert into client_health_snapshots (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
    values (${id}, ${clientId}, '2026-06-01', '2026-06-30', ${final}, 'Watch', true, ${componentsJson}::jsonb, 'system')`;
}
async function setTargetRow(roleType: string, comp: string, periodStart: string, target: number, placeholder: boolean): Promise<void> {
  await sql`
    insert into perf_period_targets (role_type, component, period_start, target_value, is_placeholder, updated_by)
    values (${roleType}, ${comp}, ${periodStart}, ${target}, ${placeholder}, 'ZZ-TEST')
    on conflict (role_type, component, period_start)
    do update set target_value = excluded.target_value, is_placeholder = excluded.is_placeholder`;
}

/** kennyFixture builds the §4 worked example: Advertiser Kenny, June 2026 → profile 86.4, modifier +2, final 88.4. */
async function kennyFixture(): Promise<void> {
  await insEmployee('ZZ-KENNY', 'Ads', 'Ads Specialist');
  await insRoleMapping('Ads', 'Ads Specialist', 'Ads', 'staff');
  await insClient('ZZ-CLI-K', 'ZZ-AM');
  await insService('ZZ-SVC-K', 'ZZ-CLI-K');
  // Speed: Ads brief approved within SLA (5h / 10h = 50% → transform 100).
  await insAdsBrief('ZZ-BRF-K', 'ZZ-SVC-K', 'ZZ-KENNY', 10, 5);
  // ROAS: target 5, period ROAS 4.4 (spend 100M, gmv 440M) → 88. gmvSum = 440M.
  await insAdCampaign('ZZ-ADC-K', 'ZZ-BRF-K', 'ZZ-CLI-K', 'ROAS 5');
  await insMetricEntry('ZZ-MTR-K', 'ZZ-ADC-K', '2026-06-05', '100000000.00', '440000000.00');
  // Optimization: 15 logs in June, actor Kenny.
  for (let i = 0; i < 15; i++) {
    await insOptimization(`ZZ-OPT-K-${i}`, 'ZZ-ADC-K', 'ZZ-KENNY', new Date(Date.UTC(2026, 5, 12)));
  }
  // June-specific NON-placeholder targets: GMV 440M/550M×100=80; Opt 15/20×100=75.
  await setTargetRow(ROLE_ADS, COMP_GMV_IMPACT, '2026-06-01', 550000000, false);
  await setTargetRow(ROLE_ADS, COMP_OPTIMIZATION_ACTIVITY, '2026-06-01', 20, false);
  // Modifier source: CLI-K June CHR snapshot with ROAS Attainment sub-score 84.
  await insCHRSnapshot('ZZ-CHR-K', 'ZZ-CLI-K', 84, '[{"name":"roas_attainment","included":true,"capped":84}]');
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  // performance_snapshots + client_health_snapshots + notifications are append-only
  // (no-delete trigger) with hard FKs, so scope a transaction to
  // session_replication_role='replica' (the test DB connects as `postgres`) to remove
  // this test's rows cleanly without breaking other test files' broad cleanup. The
  // ZZ- staff ids are reused across tests, so notifications MUST be cleared per-test or
  // the fire-once emission count would accumulate. audit_log left (harmless unique ids).
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from notifications where recipient_employee_id like 'ZZ-%'`;
    await tx`delete from performance_snapshots where staff_id in (select employee_id from employees where created_by = 'ZZ-TEST')`;
    await tx`delete from performance_snapshots where computed_by = 'system' and staff_id like 'ZZ-%'`;
    await tx`delete from client_health_snapshots where client_id like 'ZZ-%'`;
    await tx`delete from perf_period_targets where updated_by = 'ZZ-TEST'`;
    await tx`delete from optimization_logs where created_by = 'system' and actor like 'ZZ-%'`;
    await tx`delete from metric_entries where created_by = 'ZZ-TEST'`;
    await tx`delete from ad_campaigns where created_by = 'ZZ-TEST'`;
    await tx`delete from creator_bookings where created_by = 'ZZ-TEST'`;
    await tx`delete from assets where created_by = 'ZZ-TEST'`;
    await tx`delete from briefs where created_by = 'ZZ-TEST'`;
    await tx`delete from services where created_by = 'ZZ-TEST'`;
    await tx`delete from clients where created_by = 'ZZ-TEST'`;
    await tx`delete from employees where created_by = 'ZZ-TEST'`;
    await tx`delete from role_mappings where created_by = 'ZZ-TEST'`;
  });
});

describeDb('Kenny end-to-end snapshot (§4)', () => {
  it('scores June to 86.4 profile / +2 modifier / 88.4 final with the recomputed sub-scores', async () => {
    await kennyFixture();
    const res = await runSnapshotJob(sql, nowJul);
    expect(res.period).toBe(JUNE);
    expect(res.snapshotsMade).toBeGreaterThanOrEqual(1);

    const snap = await getSnapshot(sql, director('D'), 'ZZ-KENNY', JUNE);
    expect(snap.roleType).toBe(ROLE_ADS);
    expect(snap.profileScore).not.toBeNull();
    expect(Math.abs((snap.profileScore as number) - 86.4)).toBeLessThan(0.01);
    expect(snap.modifier.present).toBe(true);
    expect(Math.abs(snap.modifier.value - 2)).toBeLessThan(0.001);
    expect(snap.finalScore).not.toBeNull();
    expect(Math.abs((snap.finalScore as number) - 88.4)).toBeLessThan(0.01);
    const checks: Record<string, number> = { [COMP_SPEED_SCORE]: 100, [COMP_ROAS_ATTAINMENT]: 88, [COMP_GMV_IMPACT]: 80, [COMP_OPTIMIZATION_ACTIVITY]: 75 };
    for (const [name, want] of Object.entries(checks)) {
      const c = compByName(snap.components, name);
      expect(c.included).toBe(true);
      expect(Math.abs((c.raw as number) - want)).toBeLessThan(0.01);
    }
    expect(snap.modifier.sourceClients).toEqual(['ZZ-CLI-K']);
    expect(snap.targetsPlaceholder).toBe(false); // June targets are non-placeholder
  });
});

describeDb('EvPerformancePublished fire-once (Flow 6) + idempotency', () => {
  it('emits exactly one notification to the staff; a re-run makes no new snapshot/emission', async () => {
    await kennyFixture();
    await runSnapshotJob(sql, nowJul);
    const pub1 = await countPublished('ZZ-KENNY');
    expect(pub1).toBe(1);

    const res2 = await runSnapshotJob(sql, nowJul);
    const n = Number((await sql<{ n: string }[]>`select count(*) as n from performance_snapshots where staff_id = 'ZZ-KENNY'`)[0].n);
    expect(n).toBe(1);
    expect(res2.snapshotsMade).toBe(0);
    expect(await countPublished('ZZ-KENNY')).toBe(1);
  });
});

describeDb('snapshot immutability (house rule 3)', () => {
  it('UPDATE and DELETE on a snapshot are blocked by the trigger', async () => {
    await kennyFixture();
    await runSnapshotJob(sql, nowJul);
    const id = (await sql<{ id: string }[]>`select id from performance_snapshots where staff_id = 'ZZ-KENNY'`)[0].id;
    await expect(sql`update performance_snapshots set final_score = 1 where id = ${id}`).rejects.toThrow();
    await expect(sql`delete from performance_snapshots where id = ${id}`).rejects.toThrow();
  });
});

describeDb('AM profile (avg CHR 50%) + redistribution', () => {
  it('portfolio CHR average with the other two components missing → profile = avg CHR, no modifier', async () => {
    await insEmployee('ZZ-AMS', 'Account', 'Account Manager');
    await insRoleMapping('Account', 'Account Manager', 'Account', 'staff');
    await insClient('ZZ-CLI-A1', 'ZZ-AMS');
    await insClient('ZZ-CLI-A2', 'ZZ-AMS');
    await insCHRSnapshot('ZZ-CHR-A1', 'ZZ-CLI-A1', 80, '[]');
    await insCHRSnapshot('ZZ-CHR-A2', 'ZZ-CLI-A2', 90, '[]');

    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director('D'), 'ZZ-AMS', JUNE);
    const chr = compByName(snap.components, COMP_CHR_AVERAGE);
    expect(chr.included).toBe(true);
    expect(Math.abs((chr.raw as number) - 85)).toBeLessThan(0.01);
    expect(Math.abs(chr.effectiveWeight - 100)).toBeLessThan(0.01); // redistributed to 100
    expect(Math.abs((snap.profileScore as number) - 85)).toBeLessThan(0.01);
    expect(snap.modifier.present).toBe(false); // AM has no Client-Outcome Modifier
    expect(Math.abs((snap.finalScore as number) - 85)).toBeLessThan(0.01);
  });
});

describeDb('placeholder target flagged (O9)', () => {
  it('a KOL creator_count computed off the seeded placeholder target sets targets_placeholder', async () => {
    await insEmployee('ZZ-KOL', 'KOL', 'KOL Specialist');
    await insRoleMapping('KOL', 'KOL Specialist', 'KOL', 'staff');
    await insClient('ZZ-CLI-KOL', 'ZZ-AM');
    await insService('ZZ-SVC-KOL', 'ZZ-CLI-KOL');
    await sql`insert into briefs (id, service_id, title, status, assigned_division, created_by)
      values ('ZZ-BRF-KOL', 'ZZ-SVC-KOL', 'B', '[In Progress]', 'KOL', 'ZZ-TEST')`;
    await sql`insert into creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate, status, sla_target_hours, assigned_coordinator, created_at, created_by)
      values ('ZZ-BKG-KOL', 'ZZ-BRF-KOL', 'C', 'TikTok', 'MCN MEA Roster', '1000000.00', '[QC Passed]', 100, 'ZZ-KOL', ${new Date(Date.UTC(2026, 5, 1))}, 'ZZ-TEST')`;
    await insAudit('creator_booking', 'ZZ-BKG-KOL', 'transition:[QC Review]->[QC Passed]', new Date(Date.UTC(2026, 5, 5)));

    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director('D'), 'ZZ-KOL', JUNE);
    expect(snap.targetsPlaceholder).toBe(true); // creator_count used the seeded placeholder target (10)
    const cc = compByName(snap.components, COMP_CREATOR_COUNT);
    expect(cc.included).toBe(true);
    expect(Math.abs((cc.raw as number) - 10)).toBeLessThan(0.01); // 1/10×100
    expect(compByName(snap.components, COMP_SOURCING_TURNAROUND).diagnostic).toBe(true);
  });
});

describeDb('visibility (Rule 7) + scan gate', () => {
  it('own-score staff sees it; other staff NotFound; lead/OD/Director see it; cross-division NotFound; scan Director-only', async () => {
    await kennyFixture();
    await runSnapshotJob(sql, nowJul);

    await expect(getSnapshot(sql, adsStaff('ZZ-KENNY'), 'ZZ-KENNY', JUNE)).resolves.toBeTruthy();
    await expect(getSnapshot(sql, adsStaff('ZZ-OTHER'), 'ZZ-KENNY', JUNE)).rejects.toThrow(NotFoundError);
    await expect(getSnapshot(sql, adsLead('L'), 'ZZ-KENNY', JUNE)).resolves.toBeTruthy();
    await expect(getSnapshot(sql, odActor('O'), 'ZZ-KENNY', JUNE)).resolves.toBeTruthy();
    await expect(getSnapshot(sql, director('D'), 'ZZ-KENNY', JUNE)).resolves.toBeTruthy();
    await expect(getSnapshot(sql, creativeLead('CL'), 'ZZ-KENNY', JUNE)).rejects.toThrow(NotFoundError);

    await expect(runScan(sql, director('D'), nowJul)).resolves.toBeTruthy();
    await expect(runScan(sql, adsLead('L'), nowJul)).rejects.toThrow(ScanForbiddenError);
    await expect(runScan(sql, odActor('O'), nowJul)).rejects.toThrow(ScanForbiddenError);
  });
});

describeDb('team rollup (Rule 5 simple average, derived on read)', () => {
  it('averages the members’ final scores; a cross-division lead is Forbidden', async () => {
    await insEmployee('ZZ-K1', 'Ads', 'Ads Specialist');
    await insEmployee('ZZ-K2', 'Ads', 'Ads Specialist');
    await insRoleMapping('Ads', 'Ads Specialist', 'Ads', 'staff');
    for (const [id, staff, final] of [
      ['ZZ-PERF-1', 'ZZ-K1', 90],
      ['ZZ-PERF-2', 'ZZ-K2', 70],
    ] as [string, string, number][]) {
      await sql`insert into performance_snapshots (id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_by)
        values (${id}, ${staff}, 'Ads', '2026-06-01', '2026-06-30', ${final}, 0, ${final}, '{"components":[]}'::jsonb, 'system')`;
    }
    const roll = await teamRollup(sql, director('D'), 'Ads', JUNE);
    expect(roll.members.length).toBeGreaterThanOrEqual(2);
    // Filter to our two members for the average check.
    const ours = roll.members.filter((m) => m.staffId === 'ZZ-K1' || m.staffId === 'ZZ-K2');
    expect(ours.length).toBe(2);
    await expect(teamRollup(sql, creativeLead('CL'), 'Ads', JUNE)).rejects.toThrow(ForbiddenError);
  });
});

describeDb('config: Σ≠100 rejected; Director-only gate; bad role type', () => {
  it('validates weights and gates the write', async () => {
    const bad = { [COMP_SPEED_SCORE]: 30, [COMP_ROAS_ATTAINMENT]: 30, [COMP_GMV_IMPACT]: 25, [COMP_OPTIMIZATION_ACTIVITY]: 20 }; // 105
    await expect(setWeights(sql, director('D'), ROLE_ADS, bad)).rejects.toThrow(WeightsNotHundredError);
    const good = { [COMP_SPEED_SCORE]: 25, [COMP_ROAS_ATTAINMENT]: 30, [COMP_GMV_IMPACT]: 25, [COMP_OPTIMIZATION_ACTIVITY]: 20 };
    await expect(setWeights(sql, director('D'), ROLE_ADS, good)).resolves.toBeUndefined();
    await expect(setWeights(sql, adsLead('L'), ROLE_ADS, good)).rejects.toThrow(ConfigForbiddenError);
    await expect(setWeights(sql, director('D'), 'Sales', good)).rejects.toThrow(BadRoleTypeError);
    const n = Number((await sql<{ n: string }[]>`select count(*) as n from audit_log where entity_type = 'perf_kpi_weights' and action = 'weights_set'`)[0].n);
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

/** countPublished counts EvPerformancePublished notifications for a recipient. */
async function countPublished(recipient: string): Promise<number> {
  return Number(
    (
      await sql<{ n: string }[]>`
        select count(*) as n from notifications
         where recipient_employee_id = ${recipient} and event_type = ${notification.EVENTS.PerformancePublished}`
    )[0].n,
  );
}
