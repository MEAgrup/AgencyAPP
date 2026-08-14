/**
 * Tests for M14 Team Performance (performance.ts).
 *
 * - Unit: the pure KPI-Profile scoring core (§4 worked example, OA-1 Speed
 *   transform, OA-2 cap, Rule-6 redistribution, modifier clamp both directions,
 *   0..100 bounding, all-excluded → "—", the diagnostic unweighted row).
 * - Integration (skipped unless DATABASE_URL is set): the §4 Kenny end-to-end
 *   snapshot (profile 86.4 / modifier +2 / final 88.4), the PerformancePublished
 *   fire-once emission + idempotency, storage immutability, the AM CHR-average
 *   profile with redistribution, the placeholder-target flag, visibility (Rule 7)
 *   + scan gate, the team rollup (Rule 5 simple average), and the config Σ=100
 *   validation + Director-only gate.
 *
 * Isolation note (parallel test files share the DB): the monthly sweep scores
 * ALL role-mapped active staff, so assertions are made per-STAFF (the specific
 * snapshot / notification for our unique fixtures), never on the global
 * snapshotsMade tally. performance_snapshots + client_health_snapshots are
 * append-only (no-delete triggers) so cleanup TRUNCATEs them.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  boundFinal,
  clampModifier,
  COMP_CHR_AVERAGE,
  COMP_CREATOR_COUNT,
  COMP_GMV_IMPACT,
  COMP_OPTIMIZATION_ACTIVITY,
  COMP_ROAS_ATTAINMENT,
  COMP_SOURCING_TURNAROUND,
  COMP_SPEED_SCORE,
  COMP_WEEKLY_NOTE_COMPLIANCE,
  COMP_WEEKLY_RECAP_DISCIPLINE,
  ForbiddenError,
  getSnapshot,
  NotFoundError,
  ROLE_ADS,
  ROLE_AM,
  runScan,
  runSnapshotJob,
  scoreDisplay,
  scoreProfile,
  setTarget,
  setWeights,
  teamRollup,
  transformSpeed,
  ValidationError,
  type Actor,
  type Component,
} from './performance';

// ---------------------------------------------------------------------------
// Actors.
// ---------------------------------------------------------------------------

const adsStaff = (id: string): Actor => ({ employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const adsLead = (id = 'ZZ-ALEAD'): Actor => ({ employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const director = (id = 'ZZ-DIR'): Actor => ({ employeeId: id, divisi: 'Management', role: permission.makeRole({ director: true }) });
const odActor = (id = 'ZZ-OD'): Actor => ({ employeeId: id, divisi: 'Management', role: permission.makeRole({ od: true }) });

// ---------------------------------------------------------------------------
// Unit — the pure scoring core (mirrors profile_test.go).
// ---------------------------------------------------------------------------

/** The seeded §2 Rule 2 Ads weights. */
const adsWeights: Record<string, number> = {
  speed_score: 25, roas_attainment: 30, gmv_impact: 25, optimization_activity: 20,
};

const compByName = (comps: Component[], name: string): Component | undefined => comps.find((c) => c.name === name);

describe('pure scoring core', () => {
  it('§4 Kenny worked example: profile 86.4, modifier +2, final 88.4', () => {
    const cands = [
      { name: COMP_SPEED_SCORE, included: true, raw: transformSpeed(95), reason: '', diagnostic: false },
      { name: COMP_ROAS_ATTAINMENT, included: true, raw: 88, reason: '', diagnostic: false },
      { name: COMP_GMV_IMPACT, included: true, raw: 80, reason: '', diagnostic: false },
      { name: COMP_OPTIMIZATION_ACTIVITY, included: true, raw: 75, reason: '', diagnostic: false },
    ];
    const { comps, profile, profileOk } = scoreProfile(adsWeights, cands);
    expect(profileOk).toBe(true);
    expect(profile).toBeCloseTo(86.4, 3);
    // No redistribution when all present — effective weights equal base.
    for (const c of comps) {
      expect(c.effectiveWeight).toBeCloseTo(c.baseWeight, 3);
    }
    const modValue = clampModifier(84);
    expect(modValue).toBeCloseTo(2, 3);
    const final = boundFinal(profile, { present: true, value: modValue, sourceComponent: 'roas_attainment', sourceClients: [], rawAverage: 84 });
    expect(final).toBeCloseTo(88.4, 3);
  });

  it('OA-1 Speed transform: 100 at/under SLA, 200−x above, floored 0', () => {
    const cases: [number, number][] = [
      [50, 100], [100, 100], [100.01, 99.99], [120, 80], [150, 50], [200, 0], [250, 0],
    ];
    for (const [input, want] of cases) {
      expect(transformSpeed(input)).toBeCloseTo(want, 3);
    }
  });

  it('OA-2 cap: raw-value normalization capped at 100, raw preserved', () => {
    const { comps, profile, profileOk } = scoreProfile({ speed_score: 100 }, [
      { name: COMP_SPEED_SCORE, included: true, raw: 150, reason: '', diagnostic: false },
    ]);
    expect(profileOk).toBe(true);
    expect(profile).toBeCloseTo(100, 3);
    expect(comps[0].capped).toBe(100);
    expect(comps[0].raw).toBe(150); // uncapped raw preserved
  });

  it('Rule 6 redistribution: a missing component spreads its weight over the rest', () => {
    const cands = [
      { name: COMP_SPEED_SCORE, included: true, raw: 100, reason: '', diagnostic: false },
      { name: COMP_ROAS_ATTAINMENT, included: true, raw: 90, reason: '', diagnostic: false },
      { name: COMP_GMV_IMPACT, included: false, raw: 0, reason: 'no data', diagnostic: false },
      { name: COMP_OPTIMIZATION_ACTIVITY, included: true, raw: 60, reason: '', diagnostic: false },
    ];
    const { comps, profile } = scoreProfile(adsWeights, cands);
    const eff = Object.fromEntries(comps.map((c) => [c.name, c.effectiveWeight]));
    expect(eff[COMP_SPEED_SCORE]).toBeCloseTo(100 / 3, 3);
    expect(eff[COMP_ROAS_ATTAINMENT]).toBeCloseTo(40, 3);
    expect(eff[COMP_OPTIMIZATION_ACTIVITY]).toBeCloseTo(80 / 3, 3);
    expect(eff[COMP_GMV_IMPACT]).toBeCloseTo(0, 3);
    // Weighted = (100×25 + 90×30 + 60×20)/75 = 85.333.
    expect(profile).toBeCloseTo(6400 / 75, 3);
  });

  it('modifier clamp both directions (±10)', () => {
    expect(clampModifier(80)).toBeCloseTo(0, 3);
    expect(clampModifier(84)).toBeCloseTo(2, 3);
    expect(clampModifier(100)).toBeCloseTo(10, 3);
    expect(clampModifier(120)).toBeCloseTo(10, 3);
    expect(clampModifier(60)).toBeCloseTo(-10, 3);
    expect(clampModifier(40)).toBeCloseTo(-10, 3);
    expect(clampModifier(70)).toBeCloseTo(-5, 3);
  });

  it('final bounded 0..100 (Rule 4); all-excluded → null → "—"', () => {
    expect(boundFinal(98, { present: false, value: 10, sourceComponent: '', sourceClients: [], rawAverage: null })).toBeCloseTo(100, 3);
    expect(boundFinal(3, { present: false, value: -10, sourceComponent: '', sourceClients: [], rawAverage: null })).toBeCloseTo(0, 3);
    expect(boundFinal(null, { present: false, value: 0, sourceComponent: '', sourceClients: [], rawAverage: null })).toBeNull();
    expect(scoreDisplay(null)).toBe('—');
  });

  it('all-excluded → profileOk false', () => {
    const cands = [COMP_SPEED_SCORE, COMP_ROAS_ATTAINMENT, COMP_GMV_IMPACT, COMP_OPTIMIZATION_ACTIVITY].map((name) => ({
      name, included: false, raw: 0, reason: 'x', diagnostic: false,
    }));
    expect(scoreProfile(adsWeights, cands).profileOk).toBe(false);
  });

  it('AM profile: avg CHR 50% weight dominates', () => {
    const w = { chr_average: 50, complaint_resolution_speed: 25, revision_escalation_rate: 25 };
    const { profile, profileOk } = scoreProfile(w, [
      { name: COMP_CHR_AVERAGE, included: true, raw: 84, reason: '', diagnostic: false },
      { name: 'complaint_resolution_speed', included: true, raw: 100, reason: '', diagnostic: false },
      { name: 'revision_escalation_rate', included: true, raw: 80, reason: '', diagnostic: false },
    ]);
    expect(profileOk).toBe(true);
    expect(profile).toBeCloseTo(87, 3); // 0.5×84 + 0.25×100 + 0.25×80
  });

  it('diagnostic component reported, unweighted', () => {
    const { comps, profile, profileOk } = scoreProfile({ creator_count: 100 }, [
      { name: COMP_CREATOR_COUNT, included: true, raw: 50, reason: '', diagnostic: false },
      { name: COMP_SOURCING_TURNAROUND, included: true, raw: 12.5, reason: '', diagnostic: true },
    ]);
    expect(profileOk).toBe(true);
    expect(profile).toBeCloseTo(50, 3); // diagnostic ignored
    const diag = compByName(comps, COMP_SOURCING_TURNAROUND)!;
    expect(diag.diagnostic).toBe(true);
    expect(diag.effectiveWeight).toBe(0);
    expect(diag.raw).toBe(12.5);
    expect(diag.capped).toBeNull(); // no sub-score
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

// Fixed clock: WIB 2026-07-17 → most-recently CLOSED month = June 2026.
const nowJul = new Date('2026-07-17T05:00:00Z');
const JUNE = '202606';

let seq = 0;
const uid = (p: string): string => `${p}-ZZ-${Date.now() % 100000}-${seq++}`;

async function insEmployee(id: string, divisi: string, jabatan: string): Promise<void> {
  await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@mea.id'}, ${divisi}, ${jabatan}, true, 'ZZ-TEST') on conflict (employee_id) do nothing`;
}
async function insRoleMapping(divisi: string, jabatan: string, division: string, level: string): Promise<void> {
  await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${division}, ${level}, 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;
}
async function insClient(id: string, amId: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${amId}, 'ZZ-TEST')`;
}
async function insService(id: string, clientId: string): Promise<void> {
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Full Mgmt', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
}
async function insAudit(entityType: string, entityId: string, action: string, at: Date): Promise<void> {
  await sql`insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
    values (${entityType}, ${entityId}, 'system', ${action}, 'system', ${at})`;
}
/** An Ads Brief-as-task assigned to pic, [Approved] within SLA in June. */
async function insAdsBrief(id: string, svcId: string, pic: string, sla: number, turnaroundH: number): Promise<void> {
  await sql`insert into briefs (id, service_id, title, status, assigned_division, assigned_pic, sla_target_hours, created_by)
    values (${id}, ${svcId}, 'B', '[Approved]', 'Ads', ${pic}, ${sla}, 'ZZ-TEST')`;
  const start = new Date('2026-06-10T00:00:00Z');
  await insAudit('brief', id, 'transition:[To Do]->[In Progress]', start);
  await insAudit('brief', id, 'transition:[In Review]->[Approved]', new Date(start.getTime() + turnaroundH * 3_600_000));
}
async function insAdCampaign(id: string, briefId: string, clientId: string, targetKpi: string): Promise<void> {
  await sql`insert into ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, status, created_by)
    values (${id}, ${briefId}, ${clientId}, 'Shopee Ads', 'Conversion', '100000000.00', '2026-06-01', '2026-12-31', ${targetKpi}, '[Active]', 'ZZ-TEST')`;
}
async function insMetricEntry(id: string, campaignId: string, periodStart: string, spend: string, gmv: string): Promise<void> {
  await sql`insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_by)
    values (${id}, ${campaignId}, ${periodStart}, ${periodStart}, ${spend}, ${gmv}, 'Manual', 'system', 'ZZ-TEST')`;
}
async function insOptimization(id: string, campaignId: string, actor: string, at: Date): Promise<void> {
  await sql`insert into optimization_logs (id, campaign_id, change_type, before_value, after_value, reason, actor, created_at, created_by)
    values (${id}, ${campaignId}, 'Budget', 'a', 'b', 'r', ${actor}, ${at}, 'ZZ-TEST')`;
}
async function insCHRSnapshot(id: string, clientId: string, final: number, componentsJson: string): Promise<void> {
  await sql`insert into client_health_snapshots (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
    values (${id}, ${clientId}, '2026-06-01', '2026-06-30', ${final}, 'Watch', true, ${componentsJson}::jsonb, 'system')`;
}
async function setTargetRow(roleType: string, comp: string, periodStart: string, target: number, placeholder: boolean): Promise<void> {
  await sql`insert into perf_period_targets (role_type, component, period_start, target_value, is_placeholder, updated_by)
    values (${roleType}, ${comp}, ${periodStart}, ${target}, ${placeholder}, 'ZZ-TEST')
    on conflict (role_type, component, period_start) do update set target_value = excluded.target_value, is_placeholder = excluded.is_placeholder, updated_by = 'ZZ-TEST'`;
}
/**
 * A WRR recap for a client in a given June week. `status`/`pernah` are set directly
 * (the D-14 discipline signal reads them; the machine is exercised elsewhere).
 * minggu_mulai (the ISO-week Monday) is what places the recap in a snapshot month.
 */
async function insRecap(
  id: string, clientId: string, isoWeek: number, mingguMulai: string, mingguAkhir: string,
  status: string, pernah: boolean,
): Promise<void> {
  await sql`insert into weekly_result_recap
      (id, client_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, pernah_ditutup_otomatis, created_by)
    values (${id}, ${clientId}, 2026, ${isoWeek}, ${mingguMulai}, ${mingguAkhir}, ${status}, ${pernah}, 'ZZ-TEST')`;
}
/** A wrr_divisi production row = the division TOUCHED the client that week (owes a note). */
async function insWrrDivisi(recapId: string, divisi: string): Promise<void> {
  await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, created_by)
    values (${recapId}, ${divisi}, 1, 'ZZ-TEST')`;
}
/** A wrr_catatan_divisi row = the division FILED its mandatory weekly note (RM-8). */
async function insWrrCatatan(recapId: string, divisi: string): Promise<void> {
  await sql`insert into wrr_catatan_divisi (recap_id, divisi, catatan, created_by)
    values (${recapId}, ${divisi}, 'catatan mingguan', 'ZZ-TEST')`;
}

/** Builds the §4 Kenny worked example under a unique staff id; returns that id + its client. */
async function kennyFixture(): Promise<{ kenny: string; client: string }> {
  const kenny = uid('EMP-KENNY');
  const client = uid('CLI-K');
  const svc = uid('SVC-K');
  const brief = uid('BRF-K');
  const camp = uid('ADC-K');
  await insEmployee(kenny, 'Ads', 'ZZ-Ads-Spec');
  await insRoleMapping('Ads', 'ZZ-Ads-Spec', 'Ads', 'staff');
  await insEmployee('ZZ-AM-K', 'Account', 'ZZ-AM-Jab');
  await insClient(client, 'ZZ-AM-K');
  await insService(svc, client);
  // Speed: Ads brief approved within SLA (5h / 10h = 50% → transform 100).
  await insAdsBrief(brief, svc, kenny, 10, 5);
  // ROAS: target 5, period ROAS 4.4 (spend 100M, gmv 440M) → 88. gmvSum = 440M.
  await insAdCampaign(camp, brief, client, 'ROAS 5');
  await insMetricEntry(uid('MTR-K'), camp, '2026-06-05', '100000000.00', '440000000.00');
  // Optimization: 15 logs in June, actor Kenny.
  for (let i = 0; i < 15; i++) {
    await insOptimization(uid('OPT-K'), camp, kenny, new Date('2026-06-12T00:00:00Z'));
  }
  // June-specific NON-placeholder targets tuned to the §4 illustrative sub-scores:
  //   GMV Impact = 440M / 550M × 100 = 80; Optimization = 15 / 20 × 100 = 75.
  await setTargetRow(ROLE_ADS, COMP_GMV_IMPACT, '2026-06-01', 550000000, false);
  await setTargetRow(ROLE_ADS, COMP_OPTIMIZATION_ACTIVITY, '2026-06-01', 20, false);
  // Modifier source: client June CHR snapshot with ROAS Attainment sub-score 84.
  await insCHRSnapshot(uid('CHR'), client, 84, '[{"name":"roas_attainment","included":true,"capped":84}]');
  return { kenny, client };
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  // performance_snapshots + client_health_snapshots are append-only (no-delete
  // triggers): TRUNCATE bypasses the row triggers. They are M14-only tables so no
  // other test file depends on their contents.
  await sql`truncate table performance_snapshots`;
  await sql`truncate table client_health_snapshots`;
  await sql`delete from optimization_logs where created_by like 'ZZ-%'`;
  await sql`delete from metric_entries where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaigns where created_by like 'ZZ-%'`;
  await sql`delete from creator_bookings where created_by like 'ZZ-%'`;
  await sql`delete from complaints where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  // WRR (D-14 recap-discipline / note-compliance signals). wrr_catatan_divisi is
  // append-only (no-delete trigger) → TRUNCATE bypasses the row guard (same as the
  // recap suites); then delete children + parent (recaps FK clients, so precede it).
  await sql`truncate wrr_catatan_divisi`;
  await sql`delete from wrr_divisi where created_by like 'ZZ-%'`;
  await sql`delete from weekly_result_recap where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
  await sql`delete from perf_period_targets where updated_by like 'ZZ-%'`;
});

describeDb('§4 worked example end to end', () => {
  it('Kenny June snapshot: profile 86.4, modifier +2, final 88.4, full breakdown', async () => {
    const { kenny } = await kennyFixture();
    await runSnapshotJob(sql, nowJul);

    const snap = await getSnapshot(sql, director(), kenny, JUNE);
    expect(snap.roleType).toBe(ROLE_ADS);
    expect(snap.profileScore).toBeCloseTo(86.4, 2);
    expect(snap.modifier.present).toBe(true);
    expect(snap.modifier.value).toBeCloseTo(2, 3);
    expect(snap.finalScore).toBeCloseTo(88.4, 2);
    // Full breakdown mandatory (Rule 8): every weighted sub-score present.
    const wants: Record<string, number> = { speed_score: 100, roas_attainment: 88, gmv_impact: 80, optimization_activity: 75 };
    for (const [name, want] of Object.entries(wants)) {
      const c = compByName(snap.components, name)!;
      expect(c.included).toBe(true);
      expect(c.raw).toBeCloseTo(want, 2);
    }
    // Modifier source client recorded (§5.1).
    expect(snap.modifier.sourceClients).toHaveLength(1);
    // Real (non-placeholder) targets used → flag false.
    expect(snap.targetsPlaceholder).toBe(false);
  });
});

describeDb('emission fire-once (Flow 6) + idempotency', () => {
  it('emits PerformancePublished once per staff; re-run is a no-op', async () => {
    const { kenny } = await kennyFixture();
    await runSnapshotJob(sql, nowJul);

    const noteCount = async (): Promise<number> =>
      Number(
        (await sql<{ n: string }[]>`
          select count(*) as n from notifications
           where recipient_employee_id = ${kenny} and event_type = 'm14.performance.published'`)[0].n,
      );
    const snapCount = async (): Promise<number> =>
      Number((await sql<{ n: string }[]>`select count(*) as n from performance_snapshots where staff_id = ${kenny}`)[0].n);

    expect(await noteCount()).toBe(1);
    expect(await snapCount()).toBe(1);

    // Re-run: idempotent for Kenny — no new snapshot, no new emission.
    await runSnapshotJob(sql, nowJul);
    expect(await noteCount()).toBe(1);
    expect(await snapCount()).toBe(1);
  });
});

describeDb('storage immutability (house rule 3 / §5.4 triggers)', () => {
  it('UPDATE and DELETE on a snapshot are blocked', async () => {
    const { kenny } = await kennyFixture();
    await runSnapshotJob(sql, nowJul);
    const id = (await sql<{ id: string }[]>`select id from performance_snapshots where staff_id = ${kenny}`)[0].id;
    await expect(sql`update performance_snapshots set final_score = 1 where id = ${id}`).rejects.toThrow();
    await expect(sql`delete from performance_snapshots where id = ${id}`).rejects.toThrow();
  });
});

describeDb('AM profile (avg CHR 50%) + redistribution', () => {
  it('missing complaint/revision components redistribute → profile = avg CHR; AM has no modifier', async () => {
    const am = uid('EMP-AMS');
    const c1 = uid('CLI-A1');
    const c2 = uid('CLI-A2');
    await insEmployee(am, 'Account', 'ZZ-AM-Jab');
    await insRoleMapping('Account', 'ZZ-AM-Jab', 'Account', 'staff');
    await insClient(c1, am);
    await insClient(c2, am);
    await insCHRSnapshot(uid('CHR'), c1, 80, '[]');
    await insCHRSnapshot(uid('CHR'), c2, 90, '[]');

    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director(), am, JUNE);
    const chr = compByName(snap.components, COMP_CHR_AVERAGE)!;
    expect(chr.included).toBe(true);
    expect(chr.raw).toBeCloseTo(85, 2); // (80+90)/2
    expect(chr.effectiveWeight).toBeCloseTo(100, 2); // redistributed to 100
    expect(snap.profileScore).toBeCloseTo(85, 2);
    expect(snap.modifier.present).toBe(false); // AM: no Client-Outcome Modifier (Rule 3)
    expect(snap.finalScore).toBeCloseTo(85, 2);
  });
});

describeDb('D-14 Weekly-Recap Discipline (AM, M6D RM-9 / §9)', () => {
  it('counts the permanent force-close flag, not the final status: 2 of 4 clean → 50', async () => {
    const am = uid('EMP-AMD');
    await insEmployee(am, 'Account', 'ZZ-AM-Jab');
    await insRoleMapping('Account', 'ZZ-AM-Jab', 'Account', 'staff');
    const clients = [uid('CLI-D1'), uid('CLI-D2'), uid('CLI-D3'), uid('CLI-D4')];
    for (const c of clients) {
      await insClient(c, am);
      await insCHRSnapshot(uid('CHR'), c, 80, '[]'); // keep the AM profile valid
    }
    // Two clean (AM-closed on time, never force-closed).
    await insRecap(uid('WRR'), clients[0], 23, '2026-06-01', '2026-06-07', 'Ditutup', false);
    await insRecap(uid('WRR'), clients[1], 23, '2026-06-01', '2026-06-07', 'Ditutup', false);
    // Force-closed (still `Ditutup Otomatis`).
    await insRecap(uid('WRR'), clients[2], 23, '2026-06-01', '2026-06-07', 'Ditutup Otomatis', true);
    // Head-reopened then AM-closed: final `Ditutup` but flag stays true → counts AGAINST.
    await insRecap(uid('WRR'), clients[3], 23, '2026-06-01', '2026-06-07', 'Ditutup', true);

    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director(), am, JUNE);
    expect(snap.roleType).toBe(ROLE_AM);
    const disc = compByName(snap.components, COMP_WEEKLY_RECAP_DISCIPLINE)!;
    expect(disc.included).toBe(true);
    expect(disc.raw).toBeCloseTo(50, 3); // 2 clean / 4 recaps × 100
  });

  it('no recaps in the period → excluded + weight redistributed (Rule 6), never scored 0', async () => {
    const am = uid('EMP-AMN');
    await insEmployee(am, 'Account', 'ZZ-AM-Jab');
    await insRoleMapping('Account', 'ZZ-AM-Jab', 'Account', 'staff');
    const c = uid('CLI-N1');
    await insClient(c, am);
    await insCHRSnapshot(uid('CHR'), c, 80, '[]');

    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director(), am, JUNE);
    const disc = compByName(snap.components, COMP_WEEKLY_RECAP_DISCIPLINE)!;
    expect(disc.included).toBe(false);
    expect(disc.raw).toBeNull();
    // Redistribution restores the pre-D-14 result: CHR alone → profile = avg CHR.
    expect(snap.profileScore).toBeCloseTo(80, 2);
  });
});

describeDb('D-14 Weekly-Note Compliance (division, M6D RM-8 / §9)', () => {
  it('division-wide over touched clients: 2 of 3 filed → 66.67', async () => {
    const ed = uid('EMP-CRE');
    await insEmployee(ed, 'Creative', 'ZZ-Cre-Jab');
    await insRoleMapping('Creative', 'ZZ-Cre-Jab', 'Creative', 'staff');
    await insEmployee('ZZ-AM-NC', 'Account', 'ZZ-AM-Jab');
    const clients = [uid('CLI-C1'), uid('CLI-C2'), uid('CLI-C3')];
    const recaps: string[] = [];
    for (const c of clients) {
      await insClient(c, 'ZZ-AM-NC');
      const r = uid('WRR');
      recaps.push(r);
      await insRecap(r, c, 24, '2026-06-08', '2026-06-14', 'Ditutup', false);
      await insWrrDivisi(r, 'Creative'); // Creative touched all three (all owe a note)
    }
    await insWrrCatatan(recaps[0], 'Creative'); // filed
    await insWrrCatatan(recaps[1], 'Creative'); // filed; recaps[2] left unfiled

    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director(), ed, JUNE);
    expect(snap.roleType).toBe('Creative');
    const nc = compByName(snap.components, COMP_WEEKLY_NOTE_COMPLIANCE)!;
    expect(nc.included).toBe(true);
    expect(nc.raw).toBeCloseTo((2 / 3) * 100, 3);
  });

  it('a division that touched no client that period → excluded + redistributed', async () => {
    const koko = uid('EMP-KOLN');
    await insEmployee(koko, 'KOL', 'ZZ-Kol-Jab');
    await insRoleMapping('KOL', 'ZZ-Kol-Jab', 'KOL', 'staff');

    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director(), koko, JUNE);
    const nc = compByName(snap.components, COMP_WEEKLY_NOTE_COMPLIANCE)!;
    expect(nc.included).toBe(false);
    expect(nc.raw).toBeNull();
  });
});

describeDb('placeholder target flagged', () => {
  it('a KOL creator_count using the seeded placeholder target flags targets_placeholder', async () => {
    const koko = uid('EMP-KOL');
    const client = uid('CLI-KOL');
    const svc = uid('SVC-KOL');
    const brief = uid('BRF-KOL');
    const bkg = uid('BKG-KOL');
    await insEmployee(koko, 'KOL', 'ZZ-KOL-Jab');
    await insRoleMapping('KOL', 'ZZ-KOL-Jab', 'KOL', 'staff');
    await insEmployee('ZZ-AM-KOL', 'Account', 'ZZ-AM-Jab');
    await insClient(client, 'ZZ-AM-KOL');
    await insService(svc, client);
    await sql`insert into briefs (id, service_id, title, status, assigned_division, created_by)
      values (${brief}, ${svc}, 'B', '[In Progress]', 'KOL', 'ZZ-TEST')`;
    await sql`insert into creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate, status, sla_target_hours, assigned_coordinator, created_at, created_by)
      values (${bkg}, ${brief}, 'C', 'TikTok', 'MCN MEA Roster', '1000000.00', '[QC Passed]', 100, ${koko}, '2026-06-01T00:00:00Z', 'ZZ-TEST')`;
    await insAudit('creator_booking', bkg, 'transition:[QC Review]->[QC Passed]', new Date('2026-06-05T00:00:00Z'));

    await runSnapshotJob(sql, nowJul);
    const snap = await getSnapshot(sql, director(), koko, JUNE);
    expect(snap.targetsPlaceholder).toBe(true); // creator_count used the seeded placeholder target
    const cc = compByName(snap.components, COMP_CREATOR_COUNT)!;
    expect(cc.included).toBe(true);
    expect(cc.raw).toBeCloseTo(10, 2); // 1/10 × 100
    const st = compByName(snap.components, COMP_SOURCING_TURNAROUND)!;
    expect(st.diagnostic).toBe(true);
  });
});

describeDb('visibility (Rule 7) + scan gate', () => {
  it('own/lead/OD/Director see; other staff + cross-division lead do not; scan is Director-only', async () => {
    const { kenny } = await kennyFixture();
    await runSnapshotJob(sql, nowJul);

    // Kenny sees his own.
    await expect(getSnapshot(sql, adsStaff(kenny), kenny, JUNE)).resolves.toBeDefined();
    // A different Ads staffer cannot see Kenny's (own-only).
    await expect(getSnapshot(sql, adsStaff('ZZ-OTHER'), kenny, JUNE)).rejects.toBeInstanceOf(NotFoundError);
    // Ads lead (division-wide), OD, Director all see it.
    for (const a of [adsLead(), odActor(), director()]) {
      await expect(getSnapshot(sql, a, kenny, JUNE)).resolves.toBeDefined();
    }
    // A Creative lead may NOT see an Ads staffer (cross-division).
    const creativeLead: Actor = { employeeId: 'ZZ-CL', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }) };
    await expect(getSnapshot(sql, creativeLead, kenny, JUNE)).rejects.toBeInstanceOf(NotFoundError);

    // Scan gate: Director only.
    await expect(runScan(sql, director(), nowJul)).resolves.toBeDefined();
    await expect(runScan(sql, adsLead(), nowJul)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runScan(sql, odActor(), nowJul)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('team rollup (Rule 5 simple average, derived on read)', () => {
  it('averages members\' finals; a cross-division lead is denied', async () => {
    const k1 = uid('EMP-K1');
    const k2 = uid('EMP-K2');
    await insEmployee(k1, 'Ads', 'ZZ-Ads-Spec');
    await insEmployee(k2, 'Ads', 'ZZ-Ads-Spec');
    await insRoleMapping('Ads', 'ZZ-Ads-Spec', 'Ads', 'staff');
    // Direct snapshot inserts (final 90 and 70 → avg 80).
    for (const [id, staff, final] of [['PERF-202606-9001', k1, 90], ['PERF-202606-9002', k2, 70]] as const) {
      await sql`insert into performance_snapshots (id, staff_id, role_type, period_start, period_end, profile_score, modifier_value, final_score, components_json, computed_by)
        values (${id}, ${staff}, 'Ads', '2026-06-01', '2026-06-30', ${final}, 0, ${final}, '{"components":[]}'::jsonb, 'system')`;
    }
    const roll = await teamRollup(sql, director(), 'Ads', JUNE);
    // Other parallel-test Ads staff may also carry June snapshots; assert OUR two are present and the average includes them.
    const mine = roll.members.filter((m) => m.staffId === k1 || m.staffId === k2);
    expect(mine).toHaveLength(2);
    expect(roll.teamAverage).not.toBeNull();

    const creativeLead: Actor = { employeeId: 'ZZ-CL', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }) };
    await expect(teamRollup(sql, creativeLead, 'Ads', JUNE)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('config: Σ≠100 rejected; gate Director-only', () => {
  it('validates weight sum and role type, gates on Director, audits the change', async () => {
    const bad = { speed_score: 30, roas_attainment: 30, gmv_impact: 25, optimization_activity: 20 }; // 105
    await expect(setWeights(sql, director(), ROLE_ADS, bad)).rejects.toBeInstanceOf(ValidationError);
    const good = { speed_score: 25, roas_attainment: 30, gmv_impact: 25, optimization_activity: 20 };
    await expect(setWeights(sql, director(), ROLE_ADS, good)).resolves.toBeUndefined();
    await expect(setWeights(sql, adsLead(), ROLE_ADS, good)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setWeights(sql, director(), 'Sales', good)).rejects.toBeInstanceOf(ValidationError);
    const n = Number(
      (await sql<{ n: string }[]>`select count(*) as n from audit_log where entity_type = 'perf_kpi_weights' and action = 'weights_set'`)[0].n,
    );
    expect(n).toBeGreaterThanOrEqual(1);
    // Setting via setTarget path is also Director-gated + audited.
    await expect(setTarget(sql, adsLead(), { roleType: ROLE_ADS, component: COMP_GMV_IMPACT, periodStart: '', targetValue: 1, isPlaceholder: false }))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(setTarget(sql, director(), { roleType: ROLE_ADS, component: COMP_GMV_IMPACT, periodStart: '2026-06-01', targetValue: 999, isPlaceholder: false }))
      .resolves.toBeUndefined();
  });
});
