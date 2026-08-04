/**
 * Origin Campaign linkage at the SALES registration door (M1 §4 + §9.3 field
 * spec, owner decision 2026-08-04).
 *
 * What these tests pin down is the defect they were written for: `campaign_id`
 * travelled from the form to the route and was DROPPED there, so every
 * Sales-registered lead had `origin_campaign_id = NULL` and M2 attributed its
 * leads/CPL/ROAS to nothing. A test per side passed the whole time — the route
 * answered 201 and the domain never had a parameter to forget.
 *
 * So the assertions are about the STORED row and the audit log, not about the
 * function's return value, plus the two properties a "just reuse the import door"
 * refactor would destroy:
 *   - registration NEVER auto-activates a campaign (the import door does);
 *   - origin_campaign_id is first-touch-immutable; only last-touch moves.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { bi, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { campaignRollup } from './campaign';
import {
  type Actor,
  CAMPAIGN_REQUIRED_SOURCES,
  campaignRequiredForSource,
  IncompleteError,
  MSG_CAMPAIGN_NOT_FOUND,
  NotFoundError,
  register,
} from './leads';

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const andi = (): Actor => ({
  employeeId: 'ZZ-ANDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const director = (): Actor => ({
  employeeId: 'ZZ-DIR', divisi: 'Management',
  role: permission.makeRole({ director: true }),
});

// ---------------------------------------------------------------------------
// Unit — the §9.3 conditional-mandatory predicate and the gate it drives. Both
// reject before any DB access, so they run without a database.
// ---------------------------------------------------------------------------
describe('campaignRequiredForSource (M1 §9.3)', () => {
  it('is true for exactly the four Marketing-channel sources', () => {
    expect(CAMPAIGN_REQUIRED_SOURCES).toEqual(['Leads - Iklan', 'Broadcast', 'Event', 'Kulwa']);
    for (const s of CAMPAIGN_REQUIRED_SOURCES) {
      expect(campaignRequiredForSource(s)).toBe(true);
    }
  });

  it('is false for the scouted / self-sourced list', () => {
    for (const s of ['Scouting', 'Leads - Socmed', 'Website', 'Referral (Affiliasi)', 'Database', 'Others', '']) {
      expect(campaignRequiredForSource(s)).toBe(false);
    }
  });

  it('tolerates surrounding whitespace but never partial matches', () => {
    expect(campaignRequiredForSource('  Event  ')).toBe(true);
    // Near-misses must NOT trip the gate: a typo'd source is a different source.
    expect(campaignRequiredForSource('Leads-Iklan')).toBe(false);
    expect(campaignRequiredForSource('Events')).toBe(false);
  });
});

describe('registration gate without a DB (M1 §9.3)', () => {
  const noSql = null as unknown as Sql;

  it('refuses an ad-sourced lead with neither a campaign nor the outside declaration', async () => {
    await expect(
      register(noSql, budi(), { leadName: 'Iklan Lead', phoneNumber: '08123', source: 'Leads - Iklan' }),
    ).rejects.toThrow(bi.INCOMPLETE_DATA);
  });

  it('refuses it for every one of the four sources, not just the first', async () => {
    for (const source of CAMPAIGN_REQUIRED_SOURCES) {
      await expect(
        register(noSql, budi(), { leadName: 'X', phoneNumber: '08123', source }),
      ).rejects.toBeInstanceOf(IncompleteError);
    }
  });

  it('treats an all-whitespace campaign id as absent (not as a link)', async () => {
    await expect(
      register(noSql, budi(), { leadName: 'X', phoneNumber: '08123', source: 'Event', campaignId: '   ' }),
    ).rejects.toBeInstanceOf(IncompleteError);
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

let phoneSeq = 0;
const uniquePhone = (): string => `0814${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(3, '0')}`;

const ACTIVE = 'CMP-ZZCP-0001';
const PAUSED = 'CMP-ZZCP-0002';
const CLOSED = 'CMP-ZZCP-0003';
const DRAFT = 'CMP-ZZCP-0004';
const ARCHIVED = 'CMP-ZZCP-0005';

/** Seeds one fixture campaign per status (created_by ZZ- so afterEach reaps them). */
async function seedCampaigns(): Promise<void> {
  await sql`
    insert into campaigns (id, name, channel, is_online, start_date, owner_employee_id, status, created_by)
    values
      (${ACTIVE}, 'Promo Skilskul Agustus', 'TikTok Ads', true, current_date, 'ZZ-MKT', 'Active', 'ZZ-MKT'),
      (${PAUSED}, 'Broadcast Ramadan', 'Broadcast', true, current_date, 'ZZ-MKT', 'Paused', 'ZZ-MKT'),
      (${CLOSED}, 'Event Expo Juni', 'Event', false, current_date, 'ZZ-MKT', 'Closed', 'ZZ-MKT'),
      (${DRAFT}, 'Kulwa Belum Jalan', 'Kulwa', true, current_date, 'ZZ-MKT', 'Draft', 'ZZ-MKT'),
      (${ARCHIVED}, 'Broadcast Tahun Lalu', 'Broadcast', true, current_date, 'ZZ-MKT', 'Archived', 'ZZ-MKT')
    on conflict (id) do nothing`;
}

/** The lead's two campaign columns, as stored. */
async function linkOf(leadId: string): Promise<{ origin: string | null; lastTouch: string | null }> {
  const rows = await sql<{ origin_campaign_id: string | null; last_touch_campaign_id: string | null }[]>`
    select origin_campaign_id, last_touch_campaign_id from leads where id = ${leadId}`;
  return { origin: rows[0].origin_campaign_id, lastTouch: rows[0].last_touch_campaign_id };
}

/** The `create` audit row's after-image for a lead. */
async function createAudit(leadId: string): Promise<Record<string, unknown>> {
  const rows = await sql<{ after_json: Record<string, unknown> }[]>`
    select after_json from audit_log
     where entity_type = 'lead' and entity_id = ${leadId} and action = 'create'`;
  return rows[0].after_json;
}

/** Current LEAD sequence counter for this WIB period ('0' when untouched). */
async function leadSeq(): Promise<string> {
  const period = await sql<{ period: string }[]>`
    select to_char(now() at time zone 'Asia/Jakarta', 'YYYYMM') as period`;
  const rows = await sql<{ next_n: string }[]>`
    select next_n::text from id_sequences where prefix = 'LEAD' and period = ${period[0].period}`;
  return rows[0]?.next_n ?? '0';
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from prospect_attempt_nq_reasons where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from campaigns where created_by like 'ZZ-%'`;
});

describeDb('register — campaign link is STORED (the O43-shaped bug)', () => {
  it('stamps origin AND last-touch on a fresh lead, and audits the link', async () => {
    await seedCampaigns();
    const { lead } = await register(sql, budi(), {
      leadName: 'Toko Iklan', phoneNumber: uniquePhone(), source: 'Leads - Iklan', campaignId: ACTIVE,
    });

    // The assertion the old code could not have passed: the column, not the reply.
    expect(await linkOf(lead.id)).toEqual({ origin: ACTIVE, lastTouch: ACTIVE });
    const after = await createAudit(lead.id);
    expect(after.origin_campaign_id).toBe(ACTIVE);
    expect(after.outside_campaign).toBe(false);
  });

  it('feeds the M3 rollup — the reason the link exists at all', async () => {
    await seedCampaigns();
    const before = await campaignRollup(sql, director(), ACTIVE);
    await register(sql, budi(), {
      leadName: 'Lead Terhitung', phoneNumber: uniquePhone(), source: 'Leads - Iklan', campaignId: ACTIVE,
    });
    const after = await campaignRollup(sql, director(), ACTIVE);
    expect(after.leadsGenerated).toBe(before.leadsGenerated + 1);
  });

  it('accepts a PAUSED campaign and leaves its status alone (unlike the import door)', async () => {
    await seedCampaigns();
    const { lead } = await register(sql, budi(), {
      leadName: 'Lead Telat', phoneNumber: uniquePhone(), source: 'Broadcast', campaignId: PAUSED,
    });
    expect((await linkOf(lead.id)).origin).toBe(PAUSED);

    // resolveCampaignForIntake (import) would have driven this to Active. A
    // salesperson picking a campaign is not a decision to relaunch it.
    const status = await sql<{ status: string }[]>`select status from campaigns where id = ${PAUSED}`;
    expect(status[0].status).toBe('Paused');
    const moved = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_id = ${PAUSED} and action in ('campaign_auto_activated', 'transition:Paused->Active')`;
    expect(moved[0].n).toBe(0);
  });
});

describeDb('register — the "outside any campaign" declaration', () => {
  it('satisfies the §9.3 gate for an ad source, storing NO link but recording why', async () => {
    const { lead } = await register(sql, budi(), {
      leadName: 'Lead Mandiri', phoneNumber: uniquePhone(), source: 'Event', outsideCampaign: true,
    });
    expect(await linkOf(lead.id)).toEqual({ origin: null, lastTouch: null });
    // The declaration is what separates "outside a campaign" from "field skipped",
    // so it has to survive in the immutable log (house rule 3).
    expect((await createAudit(lead.id)).outside_campaign).toBe(true);
  });

  it('leaves a non-required source registrable with nothing picked at all', async () => {
    const { lead } = await register(sql, budi(), {
      leadName: 'Lead Scouting', phoneNumber: uniquePhone(), source: 'Scouting',
    });
    expect(await linkOf(lead.id)).toEqual({ origin: null, lastTouch: null });
    expect((await createAudit(lead.id)).outside_campaign).toBe(false);
  });

  it('lets an explicit pick win when both arrive (the flag describes an empty link)', async () => {
    await seedCampaigns();
    const { lead } = await register(sql, budi(), {
      leadName: 'Lead Kontradiksi', phoneNumber: uniquePhone(), source: 'Kulwa',
      campaignId: ACTIVE, outsideCampaign: true,
    });
    expect((await linkOf(lead.id)).origin).toBe(ACTIVE);
    expect((await createAudit(lead.id)).outside_campaign).toBe(false);
  });
});

describeDb('register — campaign gate is re-checked server-side', () => {
  it('404s an unknown campaign and burns no LEAD id', async () => {
    const seqBefore = await leadSeq();
    await expect(
      register(sql, budi(), {
        leadName: 'Lead Hantu', phoneNumber: uniquePhone(), source: 'Leads - Iklan',
        campaignId: 'CMP-209901-9999',
      }),
    ).rejects.toThrow(MSG_CAMPAIGN_NOT_FOUND);
    await expect(
      register(sql, budi(), { leadName: 'Lead Hantu', phoneNumber: uniquePhone(), campaignId: 'CMP-209901-9999' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await leadSeq()).toBe(seqBefore);
  });

  it('accepts a CLOSED / ARCHIVED / DRAFT campaign — status is not a gate here', async () => {
    await seedCampaigns();
    // Owner decision 2026-08-04: refusing a status does not protect the data, it
    // destroys it. The lead gets registered either way (Sales will not drop a real
    // lead over a campaign status) and would land with NO campaign — which reads
    // as "this campaign produced nothing" instead of "this lead arrived late".
    for (const [label, id] of [['Tutup', CLOSED], ['Arsip', ARCHIVED], ['Draf', DRAFT]] as const) {
      const { lead } = await register(sql, budi(), {
        leadName: `Lead ${label}`, phoneNumber: uniquePhone(), source: 'Event', campaignId: id,
      });
      expect((await linkOf(lead.id)).origin).toBe(id);
    }

    // …and NONE of them moved: registration has no lifecycle side effect at all,
    // unlike the import door (resolveCampaignForIntake auto-activates Draft/Paused).
    const statuses = await sql<{ id: string; status: string }[]>`
      select id, status from campaigns where id in (${CLOSED}, ${ARCHIVED}, ${DRAFT}) order by id`;
    expect(statuses.map((r) => r.status)).toEqual(['Closed', 'Draft', 'Archived']);
    const moved = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_id in (${CLOSED}, ${ARCHIVED}, ${DRAFT})
         and (action = 'campaign_auto_activated' or action like 'transition:%')`;
    expect(moved[0].n).toBe(0);
  });

  it('burns no id when the §9.3 gate rejects (validation before ident, house rule 1)', async () => {
    const seqBefore = await leadSeq();
    await expect(
      register(sql, budi(), { leadName: 'Tanpa Campaign', phoneNumber: uniquePhone(), source: 'Broadcast' }),
    ).rejects.toBeInstanceOf(IncompleteError);
    expect(await leadSeq()).toBe(seqBefore);
  });
});

describeDb('register — origin is first-touch-immutable, last-touch moves (M1 §5/§9.3)', () => {
  it('keeps origin and moves last-touch when a second campaign REOPENS a lead', async () => {
    await seedCampaigns();
    const phone = uniquePhone();
    const first = await register(sql, budi(), {
      leadName: 'Unicorn Digital', phoneNumber: phone, source: 'Leads - Iklan', campaignId: ACTIVE,
    });
    // Precondition for the reopen branch: terminal record, no open attempt.
    await sql`update prospect_attempts set status = 'Not Qualified' where lead_id = ${first.lead.id}`;
    await sql`update leads set record_status = '[Rejected]' where id = ${first.lead.id}`;

    const again = await register(sql, andi(), {
      leadName: 'Unicorn Digital', phoneNumber: phone, source: 'Broadcast', campaignId: PAUSED,
    });
    expect(again.lead.id).toBe(first.lead.id);
    expect(await linkOf(first.lead.id)).toEqual({ origin: ACTIVE, lastTouch: PAUSED });

    const trail = (await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'lead' and entity_id = ${first.lead.id}`)
      .map((r) => r.action);
    expect(trail).toContain('last_touch_updated');
  });

  it('moves last-touch when a co-pursuit JOIN arrives from another campaign', async () => {
    await seedCampaigns();
    const phone = uniquePhone();
    const first = await register(sql, budi(), {
      leadName: 'Alpha Digital', phoneNumber: phone, source: 'Leads - Iklan', campaignId: ACTIVE,
    });
    const joined = await register(sql, andi(), {
      leadName: 'Alpha Digital', phoneNumber: phone, source: 'Broadcast', campaignId: PAUSED,
    });
    expect(joined.lead.id).toBe(first.lead.id);
    expect(await linkOf(first.lead.id)).toEqual({ origin: ACTIVE, lastTouch: PAUSED });
  });

  it('leaves both columns untouched when the joining salesperson picked no campaign', async () => {
    await seedCampaigns();
    const phone = uniquePhone();
    const first = await register(sql, budi(), {
      leadName: 'Sini Store', phoneNumber: phone, source: 'Leads - Iklan', campaignId: ACTIVE,
    });
    await register(sql, andi(), {
      leadName: 'Sini Store', phoneNumber: phone, source: 'Scouting', outsideCampaign: true,
    });
    // A salesperson who scouted the same lead does not erase the attribution.
    expect(await linkOf(first.lead.id)).toEqual({ origin: ACTIVE, lastTouch: ACTIVE });
  });
});
