/**
 * Integration tests for the M1 Leads FE read models (poolBoard / leadsDatabase /
 * leadDetailView), skipped unless DATABASE_URL is set. Each test registers real
 * leads (minting LEAD-/PRSP- through the engine) and asserts the read-model
 * projections — contest counts, the M1-OA-7 stale flag, campaign ids, filters.
 * Rows created here are cleaned up by created_by like 'ZZ-%'.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { page, permission } from '@cdps/core';
import {
  canReadPool,
  claim,
  leadDetailView,
  leadListScope,
  leadsDatabase,
  NotFoundError,
  parseMineMode,
  poolBoard,
  register,
  type Actor,
} from './leads';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const andi = (): Actor => ({
  employeeId: 'ZZ-ANDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

let phoneSeq = 0;
const uniquePhone = (): string => `0813${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(3, '0')}`;

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from prospect_attempt_nq_reasons where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
});

/** Registers a lead, flips it to [Pool] (Marketing-style, no live attempt). */
async function poolLead(name: string): Promise<string> {
  const { lead } = await register(sql, budi(), { leadName: name, phoneNumber: uniquePhone(), source: 'Scouting' });
  await sql`update prospect_attempts set status = 'Closed-Lost' where lead_id = ${lead.id}`;
  await sql`update leads set record_status = '[Pool]' where id = ${lead.id}`;
  return lead.id;
}

describeDb('poolBoard', () => {
  it('lists [Pool] leads with contest counts, stale=false when fresh, and my_open_attempt', async () => {
    const id = await poolLead('Pool Alpha');
    // Andi claims it → one open attempt, and it is Andi's.
    await claim(sql, andi(), id);

    const forAndi = (await poolBoard(sql, 'ZZ-ANDI')).rows;
    const rowA = forAndi.find((r) => r.id === id);
    expect(rowA).toBeDefined();
    expect(rowA!.openAttemptCount).toBe(1);
    expect(rowA!.myOpenAttempt).toBe(true);
    expect(rowA!.stale).toBe(false); // just created

    // Same board from Budi's view: the open attempt is not his.
    const forBudi = (await poolBoard(sql, 'ZZ-BUDI')).rows;
    expect(forBudi.find((r) => r.id === id)!.myOpenAttempt).toBe(false);
  });

  it('flags a [Pool] lead older than 24h as stale', async () => {
    const id = await poolLead('Pool Stale');
    await sql`update leads set created_at = now() - interval '25 hours' where id = ${id}`;
    const rows = (await poolBoard(sql, 'ZZ-BUDI')).rows;
    expect(rows.find((r) => r.id === id)!.stale).toBe(true);
  });

  // Filter pencarian pool (QA pemilik 2026-08-06). Pool tumbuh terus, jadi tanpa
  // pencarian satu-satunya cara menemukan lead adalah menggulir seluruh papan.
  it('filters by name/phone substring and by exact source', async () => {
    const { lead } = await register(sql, budi(), {
      leadName: 'Kolam Kwitang', phoneNumber: uniquePhone(), source: 'Event',
      // M1 §9.3: Event WAJIB membawa Origin Campaign; deklarasi "di luar
      // campaign" adalah satu-satunya cara memenuhinya tanpa link.
      outsideCampaign: true,
    });
    await sql`update prospect_attempts set status = 'Closed-Lost' where lead_id = ${lead.id}`;
    await sql`update leads set record_status = '[Pool]' where id = ${lead.id}`;

    const byName = (await poolBoard(sql, 'ZZ-BUDI', { q: 'Kwitang' })).rows;
    expect(byName.some((r) => r.id === lead.id)).toBe(true);

    const byMiss = (await poolBoard(sql, 'ZZ-BUDI', { q: 'tidak-ada-xyz' })).rows;
    expect(byMiss.some((r) => r.id === lead.id)).toBe(false);

    const bySource = (await poolBoard(sql, 'ZZ-BUDI', { source: 'Event' })).rows;
    expect(bySource.some((r) => r.id === lead.id)).toBe(true);

    const byOtherSource = (await poolBoard(sql, 'ZZ-BUDI', { source: 'Scouting' })).rows;
    expect(byOtherSource.some((r) => r.id === lead.id)).toBe(false);
  });
});

describeDb('leadsDatabase', () => {
  it('projects the row (campaign ids, open_attempt_count) and honors status + q filters', async () => {
    const { lead } = await register(sql, budi(), {
      leadName: 'Zensu Digital', phoneNumber: uniquePhone(), email: 'z@x.co', source: 'Scouting',
    });

    const all = (await leadsDatabase(sql, {})).rows;
    const row = all.find((r) => r.id === lead.id);
    expect(row).toBeDefined();
    expect(row!.recordStatus).toBe('active');
    expect(row!.openAttemptCount).toBe(1); // the registrant's live attempt
    expect(row!.originCampaignId).toBeNull();
    expect(row!.lastTouchCampaignId).toBeNull();

    // q filter matches on name…
    const byName = (await leadsDatabase(sql, { q: 'Zensu' })).rows;
    expect(byName.some((r) => r.id === lead.id)).toBe(true);
    // …and excludes non-matches.
    const byOther = (await leadsDatabase(sql, { q: 'no-such-lead-xyz' })).rows;
    expect(byOther.some((r) => r.id === lead.id)).toBe(false);
    // status filter excludes an 'active' lead when asking for [Pool].
    const pool = (await leadsDatabase(sql, { status: '[Pool]' })).rows;
    expect(pool.some((r) => r.id === lead.id)).toBe(false);
  });

  // Filter source + "hanya lead saya" (QA pemilik 2026-08-06): "lead ini datang
  // dari aktivitas mana" dan "mana yang saya daftarkan sendiri".
  it('filters by exact source', async () => {
    const { lead } = await register(sql, budi(), {
      leadName: 'Sumber Event', phoneNumber: uniquePhone(), source: 'Event', outsideCampaign: true,
    });
    expect((await leadsDatabase(sql, { source: 'Event' })).rows.some((r) => r.id === lead.id)).toBe(true);
    expect((await leadsDatabase(sql, { source: 'Website' })).rows.some((r) => r.id === lead.id)).toBe(false);
  });

  it('mine narrows to leads the actor registered or holds an attempt on', async () => {
    const { lead } = await register(sql, budi(), {
      leadName: 'Milik Budi', phoneNumber: uniquePhone(), source: 'Scouting',
    });
    expect((await leadsDatabase(sql, { mineEmployeeId: 'ZZ-BUDI' })).rows.some((r) => r.id === lead.id)).toBe(true);
    expect((await leadsDatabase(sql, { mineEmployeeId: 'ZZ-ANDI' })).rows.some((r) => r.id === lead.id)).toBe(false);

    // Andi joins the same lead (co-pursuit, dedup v2) → it becomes his too.
    await register(sql, andi(), {
      leadName: 'Milik Budi', phoneNumber: lead.phoneNumber, source: 'Scouting',
    });
    expect((await leadsDatabase(sql, { mineEmployeeId: 'ZZ-ANDI' })).rows.some((r) => r.id === lead.id)).toBe(true);
  });

  // Papan "Lead Saya" (keputusan pemilik 2026-08-06). Yang diuji di sini adalah
  // hal yang membuat tab-nya berguna: lead yang DIDAFTARKAN dibedakan dari lead
  // orang lain yang sekadar DIKERJAKAN. Kalau kedua mode mengembalikan himpunan
  // yang sama, tab-nya cuma salinan Database dengan judul berbeda.
  it('mineMode separates registered from claimed, and flags the role per row', async () => {
    const { lead } = await register(sql, budi(), {
      leadName: 'Punya Budi', phoneNumber: uniquePhone(), source: 'Scouting',
    });
    // Andi co-pursues: he holds an attempt, but did NOT create the record.
    await register(sql, andi(), {
      leadName: 'Punya Budi', phoneNumber: lead.phoneNumber, source: 'Scouting',
    });

    const budiRegistered = (await leadsDatabase(sql, {
      mineEmployeeId: 'ZZ-BUDI', mineMode: 'registered',
    })).rows;
    expect(budiRegistered.some((r) => r.id === lead.id)).toBe(true);

    const andiRegistered = (await leadsDatabase(sql, {
      mineEmployeeId: 'ZZ-ANDI', mineMode: 'registered',
    })).rows;
    expect(andiRegistered.some((r) => r.id === lead.id)).toBe(false);

    const andiClaimed = (await leadsDatabase(sql, {
      mineEmployeeId: 'ZZ-ANDI', mineMode: 'claimed',
    })).rows;
    const andiRow = andiClaimed.find((r) => r.id === lead.id);
    expect(andiRow).toBeDefined();
    expect(andiRow!.registeredByMe).toBe(false);
    expect(andiRow!.claimedByMe).toBe(true);

    // Budi is both: he registered it AND holds the first attempt on it.
    const budiAny = (await leadsDatabase(sql, { mineEmployeeId: 'ZZ-BUDI', mineMode: 'any' })).rows;
    const budiRow = budiAny.find((r) => r.id === lead.id);
    expect(budiRow!.registeredByMe).toBe(true);
    expect(budiRow!.claimedByMe).toBe(true);

    // Without a mine filter the flags are false — they describe the CALLER, and
    // an unfiltered read has no caller to describe.
    const unfiltered = (await leadsDatabase(sql, {})).rows;
    const plain = unfiltered.find((r) => r.id === lead.id);
    expect(plain!.registeredByMe).toBe(false);
    expect(plain!.claimedByMe).toBe(false);
  });
});

describe('parseMineMode', () => {
  it('maps the closed set and widens anything unrecognised to any', () => {
    expect(parseMineMode('registered')).toBe('registered');
    expect(parseMineMode('claimed')).toBe('claimed');
    expect(parseMineMode('any')).toBe('any');
    // '1' is what the first cut of the FE sent; it must keep meaning "either".
    expect(parseMineMode('1')).toBe('any');
    expect(parseMineMode('')).toBe('any');
    expect(parseMineMode(null)).toBe('any');
    expect(parseMineMode(undefined)).toBe('any');
  });
});

describeDb('leadDetailView', () => {
  it('returns the lead core + its attempt contest, oldest first', async () => {
    const { lead } = await register(sql, budi(), {
      leadName: 'Detail Co', phoneNumber: uniquePhone(), source: 'Scouting',
    });
    const detail = await leadDetailView(sql, lead.id);
    expect(detail.lead.id).toBe(lead.id);
    expect(detail.lead.recordStatus).toBe('active');
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0].ownerEmployeeId).toBe('ZZ-BUDI');
    expect(detail.attempts[0].status).toBe('New Lead');
  });

  it('throws NotFoundError for an unknown lead', async () => {
    await expect(leadDetailView(sql, 'LEAD-000000-0000')).rejects.toBeInstanceOf(NotFoundError);
  });
});

/**
 * O37 endpoint gates (pure — no DB). These decide whether an actor may reach the
 * Pool board / Leads Database at all; ROW visibility for those who may is the
 * leads_select RLS policy's job (supabase/tests/rls_checks.sql §10-13).
 * Ported from Go `module1_leads/reads.go`.
 */
describe('read-scope gates (O37)', () => {
  const role = (division: string, level: string, extra: Partial<permission.Role> = {}): Actor => ({
    employeeId: 'ZZ-GATE',
    role: permission.makeRole({ division, level, ...extra }),
  });

  describe('canReadPool', () => {
    it('admits Sales at any level', () => {
      expect(canReadPool(role('Sales', 'staff'))).toBe(true);
      expect(canReadPool(role('Sales', 'lead'))).toBe(true);
    });

    it('admits the read-everywhere layered roles', () => {
      expect(canReadPool(role('', '', { od: true }))).toBe(true);
      expect(canReadPool(role('', '', { director: true }))).toBe(true);
    });

    it('refuses every other division — including a Marketing lead', () => {
      expect(canReadPool(role('Marketing', 'lead'))).toBe(false);
      expect(canReadPool(role('Creative', 'staff'))).toBe(false);
      expect(canReadPool(role('', ''))).toBe(false);
    });
  });

  describe('leadListScope', () => {
    it('gives Director and OD the unnarrowed list', () => {
      expect(leadListScope(role('', '', { director: true }))).toEqual({ marketingStaffScope: false });
      expect(leadListScope(role('', '', { od: true }))).toEqual({ marketingStaffScope: false });
    });

    it('narrows Marketing staff to their own leads, but not a Marketing lead', () => {
      expect(leadListScope(role('Marketing', 'staff'))).toEqual({ marketingStaffScope: true });
      expect(leadListScope(role('Marketing', 'lead'))).toEqual({ marketingStaffScope: false });
    });

    // Diubah 2026-08-06 (QA pemilik): Sales staff DULU ditolak di sini, yang
    // membuat lead yang ia daftarkan sendiri tidak bisa dilihat di mana pun —
    // lead scouted lahir `active` sehingga tidak pernah muncul di Pool. Yang
    // membatasi barisnya tetap RLS `leads_select`, bukan gate endpoint ini.
    it('admits Sales at every level (rows still narrowed by RLS)', () => {
      expect(leadListScope(role('Sales', 'lead'))).toEqual({ marketingStaffScope: false });
      expect(leadListScope(role('Sales', 'staff'))).toEqual({ marketingStaffScope: false });
    });

    it('denies an unrelated or unmapped division', () => {
      expect(leadListScope(role('Creative', 'lead'))).toBeNull();
      expect(leadListScope(role('', ''))).toBeNull();
    });
  });
});

/**
 * Keyset pagination (P2 §6). The behaviour that matters is not "a limit is
 * applied" but that walking the pages sees every row exactly once — no
 * duplicate, no skipped row — including when two leads share a `created_at`,
 * and that an ABSENT page request is still unbounded (the CSV export reads
 * through this same function and must get everything).
 */
describeDb('leadsDatabase — keyset pagination (P2 §6)', () => {
  async function seedLeads(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const { lead } = await register(sql, budi(), {
        leadName: `Halaman ${i}`, phoneNumber: uniquePhone(), source: 'Scouting',
      });
      ids.push(lead.id);
    }
    return ids;
  }

  /** Walk every page, following nextCursor until it runs out. */
  async function walkAll(limit: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const p: page.Page<{ id: string }> = await leadsDatabase(sql, {
        page: { limit, cursor: cursor === null ? null : page.decodeCursor(cursor) },
      });
      seen.push(...p.rows.map((r) => r.id));
      if (p.nextCursor === null) return seen;
      cursor = p.nextCursor;
    }
    throw new Error('pagination did not terminate — nextCursor never went null');
  }

  it('walks every row exactly once across pages, in the same order as the unbounded read', async () => {
    await seedLeads(5);
    const unbounded = (await leadsDatabase(sql, {})).rows.map((r) => r.id);
    const walked = await walkAll(2);
    expect(walked).toEqual(unbounded); // same rows, same order, no dupes, no gaps
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('an ABSENT page request stays unbounded — the CSV export path must not truncate', async () => {
    await seedLeads(3);
    const p = await leadsDatabase(sql, {});
    expect(p.rows.length).toBeGreaterThanOrEqual(3);
    expect(p.nextCursor).toBeNull(); // nothing left to fetch: it already returned everything
  });

  it('reports the last page by a null cursor, and never re-serves the cursor row', async () => {
    const ids = await seedLeads(3);
    const first = await leadsDatabase(sql, { page: { limit: 2, cursor: null } });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await leadsDatabase(sql, {
      page: { limit: 2, cursor: page.decodeCursor(first.nextCursor!) },
    });
    expect(second.nextCursor).toBeNull(); // 3 rows, page size 2 → page 2 is the last
    const overlap = second.rows.filter((r) => first.rows.some((f) => f.id === r.id));
    expect(overlap).toEqual([]);
    expect([...first.rows, ...second.rows].map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it('breaks a created_at tie by id, so tied rows are neither duplicated nor skipped', async () => {
    const ids = await seedLeads(3);
    // Force an exact tie on the primary sort key — the case a naive
    // `created_at < cursor` (without the id tiebreak) silently drops.
    const tie = new Date('2026-03-03T03:03:03.000Z');
    await sql`update leads set created_at = ${tie} where id = any(${ids})`;

    const walked = await walkAll(1);
    const walkedTied = walked.filter((id) => ids.includes(id));
    expect(walkedTied.sort()).toEqual([...ids].sort()); // all three, exactly once each
  });

  it('composes with the server-side filters rather than paging the unfiltered table', async () => {
    await seedLeads(2);
    const { lead } = await register(sql, budi(), {
      leadName: 'Cari Saya', phoneNumber: uniquePhone(), source: 'Event', outsideCampaign: true,
    });
    const p = await leadsDatabase(sql, { q: 'Cari Saya', page: { limit: 10, cursor: null } });
    expect(p.rows.map((r) => r.id)).toEqual([lead.id]);
    expect(p.nextCursor).toBeNull();
  });
});

describeDb('poolBoard — keyset pagination (P2 §6)', () => {
  it('walks every pool lead exactly once and matches the unbounded read', async () => {
    for (let i = 0; i < 4; i++) await poolLead(`Pool Page ${i}`);
    const unbounded = (await poolBoard(sql, 'ZZ-BUDI')).rows.map((r) => r.id);
    expect(unbounded.length).toBeGreaterThanOrEqual(4);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const p: page.Page<{ id: string }> = await poolBoard(sql, 'ZZ-BUDI', {
        page: { limit: 2, cursor: cursor === null ? null : page.decodeCursor(cursor) },
      });
      seen.push(...p.rows.map((r) => r.id));
      if (p.nextCursor === null) break;
      cursor = p.nextCursor;
    }
    expect(seen).toEqual(unbounded);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('an absent page request stays unbounded', async () => {
    for (let i = 0; i < 3; i++) await poolLead(`Pool Unbounded ${i}`);
    const p = await poolBoard(sql, 'ZZ-BUDI');
    expect(p.rows.length).toBeGreaterThanOrEqual(3);
    expect(p.nextCursor).toBeNull();
  });
});
