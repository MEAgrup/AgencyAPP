/**
 * Tests for the Marketing bulk-import door (M1 §3) and the cross-module audit
 * trail read — both ported to close O41.
 *
 * The properties worth protecting here are the ones a naive "reuse register()"
 * refactor would quietly destroy: one transaction PER ROW, no attempt spawned,
 * and dedup that blocks on ANY open attempt rather than joining as a co-pursuit.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { auditTrail } from './audit';
import { campaign } from './index';
import {
  bulkImport,
  bulkSummary,
  canBulkImport,
  deriveSource,
  ForbiddenError,
  MSG_CAMPAIGN_NOT_ACTIVE,
  MSG_CAMPAIGN_NOT_FOUND,
  MSG_ROW_INCOMPLETE,
  RECORD_POOL,
  register,
  type Actor,
} from './leads';

const marketingStaff = (): Actor => ({
  employeeId: 'ZZ-MKT', divisi: 'Marketing',
  role: permission.makeRole({ division: 'Marketing', level: 'staff' }),
});
const marketingLead = (): Actor => ({
  employeeId: 'ZZ-MKTLEAD', divisi: 'Marketing',
  role: permission.makeRole({ division: 'Marketing', level: 'lead' }),
});
const director = (): Actor => ({
  employeeId: 'ZZ-DIR', divisi: 'Management',
  role: permission.makeRole({ director: true }),
});
const od = (): Actor => ({
  employeeId: 'ZZ-OD', divisi: 'Management',
  role: permission.makeRole({ od: true }),
});
const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

// ---------------------------------------------------------------------------
// Unit.
// ---------------------------------------------------------------------------
describe('canBulkImport (M1 §9.1)', () => {
  it('allows Marketing staff/lead and Director', () => {
    expect(canBulkImport(marketingStaff())).toBe(true);
    expect(canBulkImport(marketingLead())).toBe(true);
    expect(canBulkImport(director())).toBe(true);
  });

  it('denies Sales and a read-only OD account', () => {
    expect(canBulkImport(budi())).toBe(false);
    expect(canBulkImport(od())).toBe(false);
  });
});

describe('bulkSummary', () => {
  it('renders the byte-exact §3 Flow-7 line', () => {
    expect(bulkSummary(46, 4)).toBe('[46 lead berhasil diimport, 4 ditolak (duplikat/data tidak lengkap)]');
    expect(bulkSummary(0, 0)).toBe('[0 lead berhasil diimport, 0 ditolak (duplikat/data tidak lengkap)]');
  });
});

describe('deriveSource', () => {
  it('maps the PRD-confirmed channel and falls through otherwise (M3-OA-2)', () => {
    expect(deriveSource('TikTok Ads')).toBe('Leads - Iklan');
    // Free-text taxonomy: an unmapped channel is stored verbatim, never dropped.
    expect(deriveSource('Shopee Live')).toBe('Shopee Live');
    expect(deriveSource('')).toBe('');
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
const uniquePhone = (): string => `0817${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from campaigns where created_by like 'ZZ-%'`;
});

describeDb('bulkImport — rows', () => {
  it('creates leads in [Pool], owned by Marketing, with NO attempt spawned', async () => {
    const phone = uniquePhone();
    const report = await bulkImport(sql, marketingStaff(), '', [
      { leadName: 'Toko Satu', phoneNumber: phone, source: 'Leads - Organik' },
    ]);

    expect(report.imported).toBe(1);
    expect(report.rejected).toBe(0);
    expect(report.rows[0].leadId).toMatch(/^LEAD-/);

    const rows = await sql<{ record_status: string; origin_division: string; source: string }[]>`
      select record_status, origin_division, source from leads where id = ${report.rows[0].leadId}`;
    expect(rows[0].record_status).toBe(RECORD_POOL);
    expect(rows[0].origin_division).toBe('Marketing');
    expect(rows[0].source).toBe('Leads - Organik');

    // The Marketing door hands leads over; it never prospects them.
    const attempts = await sql<{ id: string }[]>`
      select id from prospect_attempts where lead_id = ${report.rows[0].leadId}`;
    expect(attempts).toHaveLength(0);
  });

  it('rejects an incomplete row without burning a LEAD id', async () => {
    const period = await sql<{ period: string }[]>`
      select to_char(now() at time zone 'Asia/Jakarta', 'YYYYMM') as period`;
    const seqBefore = await sql<{ next_n: string }[]>`
      select next_n::text from id_sequences where prefix = 'LEAD' and period = ${period[0].period}`;

    const report = await bulkImport(sql, marketingStaff(), '', [
      { leadName: '', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
      { leadName: 'Tanpa Telepon', phoneNumber: '', source: 'Leads - Organik' },
      { leadName: 'Tanpa Source', phoneNumber: uniquePhone(), source: '' },
    ]);

    expect(report.imported).toBe(0);
    expect(report.rejected).toBe(3);
    expect(report.rows.every((r) => r.reason === MSG_ROW_INCOMPLETE)).toBe(true);

    const seqAfter = await sql<{ next_n: string }[]>`
      select next_n::text from id_sequences where prefix = 'LEAD' and period = ${period[0].period}`;
    expect(seqAfter[0]?.next_n ?? '0').toBe(seqBefore[0]?.next_n ?? '0');
  });

  it('blocks a duplicate of an actively-worked lead and leaves it untouched', async () => {
    const phone = uniquePhone();
    const { lead } = await register(sql, budi(), { leadName: 'Sudah Digarap', phoneNumber: phone });

    const report = await bulkImport(sql, marketingStaff(), '', [
      { leadName: 'Sudah Digarap', phoneNumber: phone, source: 'Leads - Iklan' },
    ]);
    expect(report.imported).toBe(0);
    expect(report.rejected).toBe(1);
    expect(report.rows[0].reason).not.toBe('');

    // The existing record keeps its status, division and source.
    const after = await sql<{ record_status: string; origin_division: string }[]>`
      select record_status, origin_division from leads where id = ${lead.id}`;
    expect(after[0].record_status).toBe('active');
    expect(after[0].origin_division).toBe('Sales');

    // …but the attribution attempt IS on the record (M1-OA-6: logged, not counted).
    const actions = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'lead' and entity_id = ${lead.id}`)
      .map((r) => r.action);
    expect(actions).toContain('dedup_blocked');

    // Import never joins as a co-pursuit — no second attempt appeared.
    const attempts = await sql<{ id: string }[]>`select id from prospect_attempts where lead_id = ${lead.id}`;
    expect(attempts).toHaveLength(1);
  });

  it('keeps good rows committed when a bad row sits between them (§3 rule 5)', async () => {
    const report = await bulkImport(sql, marketingStaff(), '', [
      { leadName: 'Baik A', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
      { leadName: '', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
      { leadName: 'Baik B', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
    ]);

    expect(report.imported).toBe(2);
    expect(report.rejected).toBe(1);
    // Report reconciles — the property Go's comment calls out explicitly.
    expect(report.imported + report.rejected).toBe(report.rows.length);
    expect(report.rejections).toHaveLength(1);
    expect(report.rejections[0].rowNumber).toBe(2);
    expect(report.summary).toBe('[2 lead berhasil diimport, 1 ditolak (duplikat/data tidak lengkap)]');

    // Rows 1 and 3 are on disk even though row 2 failed — each row commits alone.
    const ids = report.rows.filter((r) => r.imported).map((r) => r.leadId);
    const saved = await sql<{ id: string; lead_name: string }[]>`
      select id, lead_name from leads where id in ${sql(ids)} order by id`;
    expect(saved.map((r) => r.lead_name)).toEqual(['Baik A', 'Baik B']);
  });

  it('refuses the whole request for an actor who may not import', async () => {
    await expect(bulkImport(sql, budi(), '', [
      { leadName: 'X', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
    ])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bulkImport(sql, od(), '', [
      { leadName: 'X', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
    ])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reports zero counts for an empty file rather than failing', async () => {
    const report = await bulkImport(sql, marketingStaff(), '', []);
    expect(report).toMatchObject({ imported: 0, rejected: 0, rows: [], rejections: [] });
  });
});

describeDb('bulkImport — campaign gate (O13)', () => {
  it('auto-activates a Draft campaign and derives Source from its Channel', async () => {
    const camp = await campaign.createCampaign(sql, marketingStaff(), {
      name: 'ZZ Campaign TikTok', channel: 'TikTok Ads', online: true, startDate: '2026-07-01',
    });
    expect(camp.status).toBe('Draft');

    const report = await bulkImport(sql, marketingStaff(), camp.id, [
      // No row source on purpose: the campaign must supply it.
      { leadName: 'Dari Iklan', phoneNumber: uniquePhone() },
    ]);
    expect(report.imported).toBe(1);

    const lead = await sql<{ source: string; origin_campaign_id: string | null; last_touch_campaign_id: string | null }[]>`
      select source, origin_campaign_id, last_touch_campaign_id from leads where id = ${report.rows[0].leadId}`;
    expect(lead[0].source).toBe('Leads - Iklan');
    expect(lead[0].origin_campaign_id).toBe(camp.id);
    expect(lead[0].last_touch_campaign_id).toBe(camp.id);

    // Status moved through the engine, and the auto-activation is named in audit.
    const after = await sql<{ status: string }[]>`select status from campaigns where id = ${camp.id}`;
    expect(after[0].status).toBe('Active');
    const actions = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'campaign' and entity_id = ${camp.id}`)
      .map((r) => r.action);
    expect(actions).toContain('campaign_auto_activated');
  });

  it('rejects every row when the campaign does not exist', async () => {
    const report = await bulkImport(sql, marketingStaff(), 'CMP-000000-9999', [
      { leadName: 'A', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
    ]);
    expect(report.imported).toBe(0);
    expect(report.rows[0].reason).toBe(MSG_CAMPAIGN_NOT_FOUND);
    // Gate runs BEFORE any lead write — nothing was left behind.
    const leftover = await sql<{ id: string }[]>`select id from leads where created_by = 'ZZ-MKT'`;
    expect(leftover).toHaveLength(0);
  });

  it('rejects rows for a Closed campaign — no legal edge back to Active', async () => {
    const camp = await campaign.createCampaign(sql, marketingStaff(), {
      name: 'ZZ Campaign Tutup', channel: 'TikTok Ads', online: true, startDate: '2026-07-01',
    });
    await campaign.transitionCampaign(sql, marketingStaff(), camp.id, 'Active');
    await campaign.transitionCampaign(sql, marketingStaff(), camp.id, 'Closed');

    const report = await bulkImport(sql, marketingStaff(), camp.id, [
      { leadName: 'A', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
    ]);
    expect(report.imported).toBe(0);
    expect(report.rows[0].reason).toBe(MSG_CAMPAIGN_NOT_ACTIVE);
  });
});

describeDb('auditTrail', () => {
  it('returns an entity history newest-first and honours the entity filter', async () => {
    const report = await bulkImport(sql, marketingStaff(), '', [
      { leadName: 'Riwayat', phoneNumber: uniquePhone(), source: 'Leads - Organik' },
    ]);
    const leadId = report.rows[0].leadId;

    const entries = await auditTrail(sql, { entityType: 'lead', entityId: leadId });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.entityType === 'lead' && e.entityId === leadId)).toBe(true);
    expect(entries[0].action).toBe('create');
    expect(entries[0].actorEmployeeId).toBe('ZZ-MKT');
    expect(entries[0].afterJson).toMatchObject({ channel: 'bulk_import' });
  });

  it('filters by type alone, and returns [] for an entity with no history', async () => {
    const byType = await auditTrail(sql, { entityType: 'lead' });
    expect(byType.every((e) => e.entityType === 'lead')).toBe(true);
    expect(await auditTrail(sql, { entityType: 'lead', entityId: 'LEAD-000000-0000' })).toEqual([]);
  });
});
