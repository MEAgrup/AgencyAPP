/**
 * Tests for M15 Team Portal (portal.ts).
 *
 * - Unit: the SLA-risk card ordering and the management band/trend/dragging derivations
 *   are exercised through the DB integration paths below (the module is pure
 *   read/delegation, so there is little to unit-test in isolation).
 * - Integration (skipped unless DATABASE_URL is set): the staff landing (open-task
 *   SLA-risk sort, Done excluded, running score present + computed-on-read + never
 *   stored, no-profile → null score), the team portal (block-approval queue two
 *   sources + scoping + aggregate, staff/cross-division gate), and the management
 *   dashboard (band sort, trend direction, dragging component, band/AM filters,
 *   Director/OD-only gate incl. layered roles).
 *
 * The external Client Portal (M15-C2) is out of scope here (a separate blocked track).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ROLE_ADS } from './performance';
import {
  ForbiddenError,
  managementDashboard,
  staffLanding,
  teamPortal,
  TREND_DOWN,
  TREND_FLAT,
  TREND_UP,
  type Actor,
} from './portal';
import {
  approveBlockRequest,
  pendingBlockRequests,
  rejectAssetBlockRequest,
  submitAssetBlockRequest,
  submitBlockRequest,
} from './task';

// ---------------------------------------------------------------------------
// Actors.
// ---------------------------------------------------------------------------

const adsStaff = (id: string): Actor => ({ employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const adsLead = (id = 'ZZ-ADSLEAD'): Actor => ({ employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const creativeStaff = (id: string): Actor => ({ employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });
const creativeLead = (id = 'ZZ-CRELEAD'): Actor => ({ employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
const director = (id = 'ZZ-DIR'): Actor => ({ employeeId: id, divisi: 'Management', role: permission.makeRole({ director: true }) });
const odActor = (id = 'ZZ-OD'): Actor => ({ employeeId: id, divisi: 'Management', role: permission.makeRole({ od: true }) });

// ---------------------------------------------------------------------------
// Integration.
// ---------------------------------------------------------------------------

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

// Fixed clock: WIB 2026-07-17. Current (running) month = July 2026.
const nowJul = new Date('2026-07-17T05:00:00Z');

async function insEmployee(id: string, divisi: string, jabatan: string): Promise<void> {
  await sql`insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${id + '@mea.id'}, ${divisi}, ${jabatan}, true, 'ZZ-TEST') on conflict (employee_id) do nothing`;
}
async function insRoleMapping(divisi: string, jabatan: string, division: string, level: string): Promise<void> {
  await sql`insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${division}, ${level}, 'ZZ-TEST') on conflict (divisi, jabatan) do nothing`;
}
async function insClient(id: string, amId: string): Promise<void> {
  await sql`insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '0.00', '0.00', '0.00', 'ZZ-BUDI', 'ZZ-BUDI', now(), ${amId}, 'ZZ-TEST')`;
}
async function insService(id: string, clientId: string): Promise<void> {
  await sql`insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${id}, ${clientId}, 'MSV-X', 1, 'Full Mgmt', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
}
async function insBrief(id: string, svcId: string, division: string, pic: string, status: string, due: string | null): Promise<void> {
  await sql`insert into briefs (id, service_id, title, status, assigned_division, assigned_pic, due_date, sla_target_hours, created_by)
    values (${id}, ${svcId}, 'B', ${status}, ${division}, ${pic}, ${due}, 10, 'ZZ-TEST')`;
}
async function insAsset(id: string, briefId: string, pic: string, status: string): Promise<void> {
  await sql`insert into assets (id, brief_id, asset_type, sequence_no, status, assigned_pic, sla_target_hours, created_by)
    values (${id}, ${briefId}, 'Product Video', 1, ${status}, ${pic}, 10, 'ZZ-TEST')`;
}
async function insCHR(id: string, clientId: string, periodStart: string, final: number, band: string, componentsJson: string): Promise<void> {
  const end = periodStart.slice(0, 8) + '28';
  await sql`insert into client_health_snapshots (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state, components_json, computed_by)
    values (${id}, ${clientId}, ${periodStart}, ${end}, ${final}, ${band}, true, ${componentsJson}::jsonb, 'system')`;
}
const statusOf = async (table: 'briefs' | 'assets', id: string): Promise<string> =>
  (await sql<{ status: string }[]>`select status from ${sql(table)} where id = ${id}`)[0].status;
const snapshotCount = async (): Promise<number> =>
  Number((await sql<{ n: string }[]>`select count(*) as n from performance_snapshots`)[0].n);

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  // append-only tables (no-delete triggers): TRUNCATE. Both are read by M13/M14/M15.
  await sql`truncate table client_health_snapshots`;
  await sql`truncate table performance_snapshots`;
  await sql`delete from asset_block_requests where created_by like 'ZZ-%'`;
  await sql`delete from brief_block_requests where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from employees where created_by like 'ZZ-%'`;
  await sql`delete from role_mappings where created_by like 'ZZ-%'`;
});

describeDb('staff landing (Rule 9)', () => {
  it('open tasks sort SLA-risk first (Done excluded); running score present, computed-on-read, not stored', async () => {
    const adi = 'ZZ-ADS-ADI';
    await insEmployee(adi, 'Ads', 'ZZ-Ads-Spec');
    await insRoleMapping('Ads', 'ZZ-Ads-Spec', 'Ads', 'staff');
    await insClient('ZZ-CLI-1', 'ZZ-AM');
    await insService('ZZ-SVC-1', 'ZZ-CLI-1');
    await insBrief('ZZ-BRF-SOON', 'ZZ-SVC-1', 'Ads', adi, '[In Progress]', '2026-08-01');
    await insBrief('ZZ-BRF-OVERDUE', 'ZZ-SVC-1', 'Ads', adi, '[In Progress]', '2020-01-01');
    await insBrief('ZZ-BRF-NODUE', 'ZZ-SVC-1', 'Ads', adi, '[In Progress]', null);
    await insBrief('ZZ-BRF-DONE', 'ZZ-SVC-1', 'Ads', adi, '[Approved]', '2026-08-05'); // must be excluded

    const before = await snapshotCount();
    const land = await staffLanding(sql, adsStaff(adi), nowJul);

    expect(land.openTasks).toHaveLength(3); // Done excluded
    expect(land.openTasks.map((c) => c.id)).toEqual(['ZZ-BRF-OVERDUE', 'ZZ-BRF-SOON', 'ZZ-BRF-NODUE']);

    expect(land.runningScore).not.toBeNull();
    expect(land.runningScore!.preview).toBe(true);
    expect(land.runningScore!.roleType).toBe(ROLE_ADS);
    expect(land.runningScore!.components.length).toBeGreaterThan(0); // full breakdown (Rule 9)

    expect(await snapshotCount()).toBe(before); // running score never stored
  });

  it('a staffer with no KPI Profile (Sales) still gets a landing — just a null score', async () => {
    const sari = 'ZZ-SAL-SARI';
    await insEmployee(sari, 'Sales', 'ZZ-Sales-Exec');
    await insRoleMapping('Sales', 'ZZ-Sales-Exec', 'Sales', 'staff');
    const sales: Actor = { employeeId: sari, divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }) };
    const land = await staffLanding(sql, sales, nowJul);
    expect(land.runningScore).toBeNull();
    expect(land.trend).toEqual([]);
  });
});

describeDb('team portal (Rule 10)', () => {
  it('block-approval queue: two sources + scoping + aggregate + approve/reject delegation', async () => {
    await insClient('ZZ-CLI-1', 'ZZ-AM');
    await insService('ZZ-SVC-1', 'ZZ-CLI-1');
    await insBrief('ZZ-BRF-ADS', 'ZZ-SVC-1', 'Ads', 'ZZ-ADS', '[In Progress]', '2026-08-01');
    await insBrief('ZZ-BRF-CRE', 'ZZ-SVC-1', 'Creative', 'ZZ-CRE', '[In Progress]', '2026-08-01');
    await insAsset('ZZ-AST-1', 'ZZ-BRF-CRE', 'ZZ-CRE', '[In Progress]');

    const briefReq = await submitBlockRequest(sql, adsStaff('ZZ-ADS'), 'ZZ-BRF-ADS', 'menunggu aset klien');
    const assetReq = await submitAssetBlockRequest(sql, creativeStaff('ZZ-CRE'), 'ZZ-AST-1', 'menunggu revisi brief');

    // Director sees BOTH sources; each lead sees only their division's; a staffer sees none.
    const dq = await pendingBlockRequests(sql, director());
    expect(new Set(dq.map((r) => r.source))).toEqual(new Set(['brief', 'asset']));
    expect(dq).toHaveLength(2);
    const al = await pendingBlockRequests(sql, adsLead());
    expect(al).toHaveLength(1);
    expect(al[0].source).toBe('brief');
    expect(al[0].entityId).toBe('ZZ-BRF-ADS');
    const cl = await pendingBlockRequests(sql, creativeLead());
    expect(cl).toHaveLength(1);
    expect(cl[0].source).toBe('asset');
    expect(await pendingBlockRequests(sql, adsStaff('ZZ-ADS'))).toHaveLength(0);

    // The full Team Portal aggregate surfaces the queue + rollup + client shortcuts.
    const team = await teamPortal(sql, adsLead(), '', '');
    expect(team.blockQueue).toHaveLength(1);
    expect(team.blockQueue[0].entityId).toBe('ZZ-BRF-ADS');
    expect(team.clients).toHaveLength(1);
    expect(team.clients[0].clientId).toBe('ZZ-CLI-1');
    expect(team.division).toBe('Ads');

    // Approve end-to-end: delegate to M12 → engine drives [In Progress] → [Blocked].
    await approveBlockRequest(sql, adsLead(), 'ZZ-BRF-ADS', briefReq.id);
    expect(await statusOf('briefs', 'ZZ-BRF-ADS')).toBe('[Blocked]');
    expect(await pendingBlockRequests(sql, adsLead())).toHaveLength(0);

    // Reject the asset request: asset stays in its prior status, request closed.
    await rejectAssetBlockRequest(sql, creativeLead(), 'ZZ-AST-1', assetReq.id);
    expect(await statusOf('assets', 'ZZ-AST-1')).toBe('[In Progress]');
    expect(await pendingBlockRequests(sql, creativeLead())).toHaveLength(0);
  });

  it('gate: staff denied; a lead cannot view another division\'s team', async () => {
    await expect(teamPortal(sql, adsStaff('ZZ-ADS'), '', '')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teamPortal(sql, adsLead(), 'Creative', '')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('management dashboard (Rule 11)', () => {
  it('band sort, trend direction, dragging component, and filters', async () => {
    await insClient('ZZ-CLI-A', 'ZZ-AM1');
    await insClient('ZZ-CLI-B', 'ZZ-AM2');
    await insClient('ZZ-CLI-C', 'ZZ-AM1');
    // CLI-A: At Risk, dropped 70 → 50 → down; roas is the dragging (40) sub-score.
    await insCHR('ZZ-CHR-A1', 'ZZ-CLI-A', '2026-05-01', 70, 'Watch', '[]');
    await insCHR('ZZ-CHR-A2', 'ZZ-CLI-A', '2026-06-01', 50, 'At Risk',
      '[{"name":"gmv_growth","included":true,"capped":80},{"name":"roas_attainment","included":true,"capped":40},{"name":"complaints","included":false}]');
    // CLI-B: Healthy, rose 85 → 90 → up.
    await insCHR('ZZ-CHR-B1', 'ZZ-CLI-B', '2026-05-01', 85, 'Healthy', '[]');
    await insCHR('ZZ-CHR-B2', 'ZZ-CLI-B', '2026-06-01', 90, 'Healthy', '[{"name":"gmv_growth","included":true,"capped":90}]');
    // CLI-C: Watch, single snapshot → flat.
    await insCHR('ZZ-CHR-C1', 'ZZ-CLI-C', '2026-06-01', 65, 'Watch', '[{"name":"payment_timeliness","included":true,"capped":60}]');

    const dash = await managementDashboard(sql, director(), '', '', '', '');
    expect(dash.rows).toHaveLength(3);
    // Default sort: At Risk first, then Watch, then Healthy.
    expect(dash.rows.map((r) => r.clientId)).toEqual(['ZZ-CLI-A', 'ZZ-CLI-C', 'ZZ-CLI-B']);
    const a = dash.rows[0];
    expect(a.band).toBe('At Risk');
    expect(a.trendDirection).toBe(TREND_DOWN);
    expect(a.draggingComponent).toBe('roas_attainment');
    expect(a.draggingCapped).toBe(40);
    expect(a.snapshotId).not.toBe('');
    expect(a.boardRef).toBe('/api/v1/board?client=ZZ-CLI-A'); // M15-G2 Board drill-through
    expect(dash.rows[2].trendDirection).toBe(TREND_UP); // CLI-B
    expect(dash.rows[1].trendDirection).toBe(TREND_FLAT); // CLI-C single snapshot

    // Filter by band → only At Risk.
    const only = await managementDashboard(sql, director(), 'At Risk', '', '', '');
    expect(only.rows).toHaveLength(1);
    expect(only.rows[0].clientId).toBe('ZZ-CLI-A');
    // Filter by AM → CLI-A + CLI-C.
    const byAM = await managementDashboard(sql, director(), '', 'ZZ-AM1', '', '');
    expect(byAM.rows).toHaveLength(2);
  });

  it('M15-G1: filters by division mix — only Clients whose work touches that division', async () => {
    await insClient('ZZ-CLI-A', 'ZZ-AM1');
    await insClient('ZZ-CLI-B', 'ZZ-AM2');
    await insCHR('ZZ-CHR-A1', 'ZZ-CLI-A', '2026-06-01', 60, 'Watch', '[]');
    await insCHR('ZZ-CHR-B1', 'ZZ-CLI-B', '2026-06-01', 60, 'Watch', '[]');
    // CLI-A has a Creative brief; CLI-B has an Ads brief.
    await insService('ZZ-SVC-A', 'ZZ-CLI-A');
    await insService('ZZ-SVC-B', 'ZZ-CLI-B');
    await insBrief('ZZ-BRF-A', 'ZZ-SVC-A', 'Creative', 'ZZ-PIC', '[In Progress]', null);
    await insBrief('ZZ-BRF-B', 'ZZ-SVC-B', 'Ads', 'ZZ-PIC', '[In Progress]', null);

    const creative = await managementDashboard(sql, director(), '', '', 'Creative', '');
    expect(creative.filterDivision).toBe('Creative');
    expect(creative.rows.map((r) => r.clientId)).toEqual(['ZZ-CLI-A']);
    const ads = await managementDashboard(sql, director(), '', '', 'Ads', '');
    expect(ads.rows.map((r) => r.clientId)).toEqual(['ZZ-CLI-B']);
    // No filter → both Clients (whole client base).
    expect((await managementDashboard(sql, director(), '', '', '', '')).rows).toHaveLength(2);
  });

  it('gate: Director + OD only (incl. layered OD); staff and plain lead denied', async () => {
    await insClient('ZZ-CLI-A', 'ZZ-AM');
    await insCHR('ZZ-CHR-A1', 'ZZ-CLI-A', '2026-06-01', 55, 'At Risk', '[]');

    for (const a of [director(), odActor()]) {
      await expect(managementDashboard(sql, a, '', '', '', '')).resolves.toBeDefined();
    }
    const layeredOD: Actor = { employeeId: 'ZZ-OKFA', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) };
    await expect(managementDashboard(sql, layeredOD, '', '', '', '')).resolves.toBeDefined();

    await expect(managementDashboard(sql, adsStaff('ZZ-ADS'), '', '', '', '')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(managementDashboard(sql, adsLead(), '', '', '', '')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
