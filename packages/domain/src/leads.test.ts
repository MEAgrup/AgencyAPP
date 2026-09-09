/**
 * Tests for the M1 leads registration door.
 *
 * - Unit: phone normalization + the pure dedup decision table + the
 *   mandatory-field gate (all reject/decide BEFORE any DB access).
 * - Integration (skipped unless DATABASE_URL is set): the full ident / sm /
 *   audit / notify vertical against a migrated Postgres. Each test namespaces
 *   its actor ids with `ZZ-` and its phones with a per-run suffix, and afterEach
 *   deletes the rows it made (children first for the FKs). audit_log /
 *   notifications are append-only and left as harmless residue.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bi, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  type Actor,
  BlockedError,
  CHANNEL_IMPORT,
  CHANNEL_SINGLE_REG,
  ATTEMPT_CLOSED_BERSAMA,
  ATTEMPT_CLOSED_KALAH,
  claim,
  isTerminalAttemptStatus,
  resolveWin,
  decide,
  decideClaim,
  type ExistingLead,
  get,
  IncompleteError,
  list,
  MSG_ALREADY_CLIENT,
  MSG_ALREADY_OWN_ATTEMPT,
  MSG_DUPLICATE_POOL,
  MSG_LEAD_CO_WORKED,
  MSG_MAX_REGISTER_BATCH,
  NotFoundError,
  normalizePhone,
  register,
  registerBatch,
  TooManyProspectsError,
} from './leads';

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const andi = (): Actor => ({
  employeeId: 'ZZ-ANDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

// ---------------------------------------------------------------------------
// Unit: phone normalization.
// ---------------------------------------------------------------------------
describe('normalizePhone', () => {
  it('collapses country-code / leading-zero / separator variants to one key', () => {
    expect(normalizePhone('+62 812-3456')).toBe('8123456');
    expect(normalizePhone('0812 3456')).toBe('8123456');
    expect(normalizePhone('812.3456')).toBe('8123456');
    expect(normalizePhone('(0812)3456')).toBe('8123456');
  });
  it('returns "" for empty / digit-less input', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('abc-def')).toBe('');
  });
  it('keeps a bare number with no country code / leading zero', () => {
    expect(normalizePhone('8123456')).toBe('8123456');
  });
});

// ---------------------------------------------------------------------------
// Unit: pure dedup decision table.
// ---------------------------------------------------------------------------
describe('decide', () => {
  const withAttempt = (owner: string, status = 'New Lead', recordStatus = 'active'): ExistingLead => ({
    id: 'LEAD-x', recordStatus,
    openAttempts: [{ attemptId: `PRSP-${owner}`, ownerEmployeeId: owner, ownerName: owner }],
  });

  it('no match -> create', () => {
    expect(decide(CHANNEL_SINGLE_REG, null, 'ZZ-BUDI').outcome).toBe('create');
  });

  it('a won lead blocks on every door', () => {
    const m: ExistingLead = { id: 'LEAD-x', recordStatus: '[Closed-Success]', openAttempts: [] };
    const d = decide(CHANNEL_SINGLE_REG, m, 'ZZ-BUDI');
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_ALREADY_CLIENT);
  });

  it('single-reg on a lead the actor already holds -> block', () => {
    const d = decide(CHANNEL_SINGLE_REG, withAttempt('ZZ-BUDI'), 'ZZ-BUDI');
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_ALREADY_OWN_ATTEMPT);
  });

  it('single-reg on a lead another sales holds -> join (co-pursuit, notify co-owner)', () => {
    const d = decide(CHANNEL_SINGLE_REG, withAttempt('ZZ-ANDI'), 'ZZ-BUDI');
    expect(d.outcome).toBe('join');
    expect(d.coOwners).toEqual(['ZZ-ANDI']);
  });

  it('import on a held lead blocks (interpolating the owner name)', () => {
    const d = decide(CHANNEL_IMPORT, withAttempt('ZZ-ANDI'), '');
    expect(d.outcome).toBe('block');
    expect(d.message).toContain('(ZZ-ANDI)');
  });

  it('a Pool record with no open attempt blocks a fresh single-reg', () => {
    const m: ExistingLead = { id: 'LEAD-x', recordStatus: '[Pool]', openAttempts: [] };
    const d = decide(CHANNEL_SINGLE_REG, m, 'ZZ-BUDI');
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_DUPLICATE_POOL);
  });

  it('a terminal (Rejected / Not Qualified) record with no open attempt -> reopen', () => {
    for (const rs of ['[Rejected]', '[Not Qualified]']) {
      const m: ExistingLead = { id: 'LEAD-x', recordStatus: rs, openAttempts: [] };
      const d = decide(CHANNEL_SINGLE_REG, m, 'ZZ-BUDI');
      expect(d.outcome).toBe('reopen');
      expect(d.reopenLeadId).toBe('LEAD-x');
    }
  });

  it('an active record with nobody holding it -> single-reg joins (no co-owner)', () => {
    const m: ExistingLead = { id: 'LEAD-x', recordStatus: 'active', openAttempts: [] };
    const d = decide(CHANNEL_SINGLE_REG, m, 'ZZ-BUDI');
    expect(d.outcome).toBe('join');
    expect(d.coOwners).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit: pure pool-claim decision table (M1 §6).
// ---------------------------------------------------------------------------
describe('decideClaim', () => {
  const pool = (owners: string[] = []): ExistingLead => ({
    id: 'LEAD-x', recordStatus: '[Pool]',
    openAttempts: owners.map((o) => ({ attemptId: `PRSP-${o}`, ownerEmployeeId: o, ownerName: o })),
  });

  it('a [Pool] lead with no held attempt -> claim', () => {
    expect(decideClaim(pool(), 'ZZ-BUDI').outcome).toBe('claim');
  });

  it('a [Pool] lead another sales already contests -> still claim (competition by design)', () => {
    // openAttempts only ever holds NON-terminal attempts (matchByLeadId filters
    // terminal ones out), so a competing open attempt by another sales is fine.
    const d = decideClaim(pool(['ZZ-ANDI']), 'ZZ-BUDI');
    expect(d.outcome).toBe('claim');
  });

  it('the same sales cannot double-claim a lead they already hold open -> block', () => {
    const d = decideClaim(pool(['ZZ-BUDI']), 'ZZ-BUDI');
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_ALREADY_OWN_ATTEMPT);
  });

  it('a won lead is already a client -> block', () => {
    const m: ExistingLead = { id: 'LEAD-x', recordStatus: '[Closed-Success]', openAttempts: [] };
    const d = decideClaim(m, 'ZZ-BUDI');
    expect(d.outcome).toBe('block');
    expect(d.message).toBe(MSG_ALREADY_CLIENT);
  });

  it('a [Rejected] / [Not Qualified] lead -> reclaim (reopen to [Pool] first)', () => {
    for (const rs of ['[Rejected]', '[Not Qualified]']) {
      const m: ExistingLead = { id: 'LEAD-x', recordStatus: rs, openAttempts: [] };
      expect(decideClaim(m, 'ZZ-BUDI').outcome).toBe('reclaim');
    }
  });

  it('a scouted-exclusive (active) lead is not claimable via the Pool flow -> block', () => {
    const m: ExistingLead = {
      id: 'LEAD-x', recordStatus: 'active',
      openAttempts: [{ attemptId: 'PRSP-ANDI', ownerEmployeeId: 'ZZ-ANDI', ownerName: 'Andi' }],
    };
    const d = decideClaim(m, 'ZZ-BUDI');
    expect(d.outcome).toBe('block');
    expect(d.message).toContain('(Andi)');
  });
});

// ---------------------------------------------------------------------------
// Unit: mandatory-field gate (no DB).
// ---------------------------------------------------------------------------
describe('mandatory-field gate (no DB)', () => {
  const noSql = null as unknown as Sql;

  it('register rejects a missing lead name with the exact BI message', async () => {
    await expect(register(noSql, budi(), { leadName: '  ', phoneNumber: '0812' }))
      .rejects.toThrow(bi.INCOMPLETE_DATA);
  });
  it('register rejects a missing phone with the exact BI message', async () => {
    await expect(register(noSql, budi(), { leadName: 'ABC Media', phoneNumber: '' }))
      .rejects.toBeInstanceOf(IncompleteError);
  });

  it('registerBatch rejects an empty list and > 5 prospects (verbatim BI), touching no DB', async () => {
    await expect(registerBatch(noSql, budi(), { source: 'Scouting', prospects: [] }))
      .rejects.toBeInstanceOf(IncompleteError);
    const six = Array.from({ length: 6 }, (_, i) => ({ leadName: `L${i}`, phoneNumber: `081200000${i}` }));
    await expect(registerBatch(noSql, budi(), { source: 'Scouting', prospects: six }))
      .rejects.toBeInstanceOf(TooManyProspectsError);
    await expect(registerBatch(noSql, budi(), { source: 'Scouting', prospects: six }))
      .rejects.toThrow(MSG_MAX_REGISTER_BATCH);
  });

  it('registerBatch applies the §9.3 campaign gate to the SHARED Source before any row runs', async () => {
    // 'Broadcast' is in CAMPAIGN_REQUIRED_SOURCES: with no campaign and no
    // "di luar campaign" declaration the whole submission is refused — noSql
    // proves nothing was attempted per row.
    await expect(registerBatch(noSql, budi(), {
      source: 'Broadcast',
      prospects: [{ leadName: 'ABC Media', phoneNumber: '08120001' }],
    })).rejects.toBeInstanceOf(IncompleteError);
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

// Per-run phone suffix so parallel/interleaved runs never collide on phone_norm.
let phoneSeq = 0;
const uniquePhone = (): string => `0812${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(3, '0')}`;

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  // prospect_attempts / nq_reasons FK -> leads, so delete children first.
  await sql`delete from prospect_attempt_nq_reasons where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
});

describeDb('register — create', () => {
  it('mints LEAD- + PRSP-, starts active / New Lead, audits both', async () => {
    const phone = uniquePhone();
    const { lead, attempt, notice } = await register(sql, budi(), {
      leadName: 'ABC Media', phoneNumber: phone, email: 'abc@example.com', source: 'Scouting',
    });
    expect(lead.id).toMatch(/^LEAD-\d{6}-\d{4}$/);
    expect(attempt.id).toMatch(/^PRSP-\d{6}-\d{4}$/);
    expect(lead.recordStatus).toBe('active');
    expect(attempt.status).toBe('New Lead');
    expect(attempt.owner).toBe('ZZ-BUDI');
    expect(notice).toBe('');

    const detail = await get(sql, lead.id);
    expect(detail.leadName).toBe('ABC Media');
    expect(detail.attempts).toHaveLength(1);

    const audits = await sql<{ action: string }[]>`
      select action from audit_log
      where (entity_id = ${lead.id} or entity_id = ${attempt.id}) and action = 'create'`;
    expect(audits).toHaveLength(2);
  });

  it('appears in list newest-first', async () => {
    const a = await register(sql, budi(), { leadName: 'First', phoneNumber: uniquePhone() });
    const b = await register(sql, budi(), { leadName: 'Second', phoneNumber: uniquePhone() });
    const ids = (await list(sql)).map((l) => l.id);
    expect(ids.indexOf(b.lead.id)).toBeLessThan(ids.indexOf(a.lead.id));
  });
});

describeDb('register — dedup v2', () => {
  it('a second sales on the same phone joins as a co-pursuit and notifies the first', async () => {
    const phone = uniquePhone();
    const first = await register(sql, budi(), { leadName: 'Unicorn Digital', phoneNumber: phone });
    const second = await register(sql, andi(), { leadName: 'Unicorn Digital', phoneNumber: phone });

    // Same lead, a NEW attempt, no record_status change, co-pursuit notice.
    expect(second.lead.id).toBe(first.lead.id);
    expect(second.attempt.id).not.toBe(first.attempt.id);
    expect(second.lead.recordStatus).toBe('active');
    expect(second.notice).toBe(MSG_LEAD_CO_WORKED);

    const detail = await get(sql, first.lead.id);
    expect(detail.attempts.map((a) => a.ownerEmployeeId).sort()).toEqual(['ZZ-ANDI', 'ZZ-BUDI']);

    // The first owner (Budi) was notified of the co-pursuit.
    const notif = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
      where recipient_employee_id = 'ZZ-BUDI' and entity_id = ${first.lead.id}
        and event_type = 'm1.lead.co_pursuit'`;
    expect(notif[0].n).toBe(1);
  });

  it('the same sales cannot open a second attempt on a lead they hold', async () => {
    const phone = uniquePhone();
    await register(sql, budi(), { leadName: 'ABC', phoneNumber: phone });
    await expect(register(sql, budi(), { leadName: 'ABC', phoneNumber: phone }))
      .rejects.toBeInstanceOf(BlockedError);
    await expect(register(sql, budi(), { leadName: 'ABC', phoneNumber: phone }))
      .rejects.toThrow(MSG_ALREADY_OWN_ATTEMPT);

    // Still exactly one attempt, and the block was audited on the lead.
    const attempts = await sql<{ n: number }[]>`
      select count(*)::int as n from prospect_attempts where owner_employee_id = 'ZZ-BUDI'
        and lead_id in (select id from leads where phone_norm = ${normalizePhone(phone)})`;
    expect(attempts[0].n).toBe(1);
    const blocked = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where action = 'dedup_blocked'
        and entity_id in (select id from leads where phone_norm = ${normalizePhone(phone)})`;
    expect(blocked[0].n).toBe(2);
  });
});

/**
 * Seed a marketing-style [Pool] lead with no open attempt, return its id.
 * Di lingkup modul karena DUA blok memakainya (klaim Pool dan FS-3 prospek
 * bersama) — menyalinnya berarti dua definisi "lead Pool" yang bisa menyimpang.
 */
async function seedPoolLead(): Promise<string> {
  const first = await register(sql, budi(), { leadName: 'Sini Store', phoneNumber: uniquePhone() });
  // Terminate Budi's registration attempt and flip the record to [Pool] so it
  // looks like a Marketing pool lead nobody is actively holding.
  await sql`update prospect_attempts set status = 'Not Qualified' where id = ${first.attempt.id}`;
  await sql`update leads set record_status = '[Pool]' where id = ${first.lead.id}`;
  return first.lead.id;
}

describeDb('claim — pool (M1 §6)', () => {
  it('claims a [Pool] lead: new PRSP at New Lead, claim audited on the lead', async () => {
    const leadId = await seedPoolLead();
    const res = await claim(sql, andi(), leadId);

    expect(res.lead.recordStatus).toBe('[Pool]');
    expect(res.attempt.id).toMatch(/^PRSP-\d{6}-\d{4}$/);
    expect(res.attempt.status).toBe('New Lead');
    expect(res.attempt.owner).toBe('ZZ-ANDI');

    const audited = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${leadId} and action = 'claim'`;
    expect(audited[0].n).toBe(1);
  });

  it('two salespeople may contest the same [Pool] lead (by design)', async () => {
    const leadId = await seedPoolLead();
    const a = await claim(sql, andi(), leadId);
    const b = await claim(sql, budi(), leadId); // Budi's original attempt is terminal → allowed
    expect(b.attempt.id).not.toBe(a.attempt.id);

    const detail = await get(sql, leadId);
    const open = detail.attempts.filter((x) => x.status === 'New Lead').map((x) => x.ownerEmployeeId).sort();
    expect(open).toEqual(['ZZ-ANDI', 'ZZ-BUDI']);
  });

  it('the same sales cannot double-claim a lead they already hold', async () => {
    const leadId = await seedPoolLead();
    await claim(sql, andi(), leadId);
    await expect(claim(sql, andi(), leadId)).rejects.toThrow(MSG_ALREADY_OWN_ATTEMPT);
    await expect(claim(sql, andi(), leadId)).rejects.toBeInstanceOf(BlockedError);
  });

  it('re-claims a [Rejected] lead by reopening it to [Pool] first', async () => {
    const first = await register(sql, budi(), { leadName: 'Lulu Lala', phoneNumber: uniquePhone() });
    await sql`update prospect_attempts set status = 'Not Qualified' where id = ${first.attempt.id}`;
    await sql`update leads set record_status = '[Rejected]' where id = ${first.lead.id}`;

    const res = await claim(sql, andi(), first.lead.id);
    expect(res.lead.recordStatus).toBe('[Pool]');

    const trans = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_id = ${first.lead.id} and action like 'transition:%'`;
    expect(trans[0].n).toBe(1); // [Rejected] -> [Pool]
  });

  it('a won lead blocks the claim (already a client)', async () => {
    const leadId = await seedPoolLead();
    await sql`update leads set record_status = '[Closed-Success]' where id = ${leadId}`;
    await expect(claim(sql, andi(), leadId)).rejects.toThrow(MSG_ALREADY_CLIENT);
  });

  it('a scouted active lead is not claimable via the Pool flow', async () => {
    const first = await register(sql, budi(), { leadName: 'ABC Media', phoneNumber: uniquePhone() });
    await expect(claim(sql, andi(), first.lead.id)).rejects.toBeInstanceOf(BlockedError);
  });

  it('an unknown lead 404s (NotFoundError)', async () => {
    await expect(claim(sql, andi(), 'LEAD-000000-0000')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describeDb('register — reopen', () => {
  it('re-registering a Rejected lead reopens it to active and attaches an attempt', async () => {
    const phone = uniquePhone();
    const first = await register(sql, budi(), { leadName: 'Unicorn', phoneNumber: phone });

    // Andi's attempt goes terminal AND the record is set Rejected (nobody holding
    // an open attempt), so a fresh registration reopens rather than joins.
    await sql`update prospect_attempts set status = 'Not Qualified' where lead_id = ${first.lead.id}`;
    // Drive the lead_record via the engine path is what register uses; here we
    // seed the terminal record_status directly for the test precondition.
    await sql`update leads set record_status = '[Rejected]' where id = ${first.lead.id}`;

    const reopened = await register(sql, andi(), { leadName: 'Unicorn', phoneNumber: phone });
    expect(reopened.lead.id).toBe(first.lead.id);
    expect(reopened.lead.recordStatus).toBe('active');
    expect(reopened.notice).toBe('');

    // The reopen went through the state machine ([Rejected] -> [Pool] -> active),
    // so both transitions are on the audit log.
    const trans = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_id = ${first.lead.id} and action like 'transition:%'`;
    expect(trans[0].n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Batch registration (QA revisi 2026-08-07): one Source, up to 5 prospects.
// ---------------------------------------------------------------------------
describeDb('registerBatch', () => {
  it('registers five prospects under one Source, each with its own LEAD + PRSP', async () => {
    const phones = Array.from({ length: 5 }, () => uniquePhone());
    const report = await registerBatch(sql, budi(), {
      source: 'Scouting',
      outsideCampaign: true,
      prospects: phones.map((phoneNumber, i) => ({
        leadName: `Prospek ${i + 1}`, phoneNumber, email: `p${i + 1}@example.com`,
      })),
    });

    expect(report.registered).toBe(5);
    expect(report.rejected).toBe(0);
    expect(report.rejections).toEqual([]);
    expect(report.summary).toBe('[5 lead berhasil didaftarkan, 0 ditolak]');
    // Distinct ids per row — one click, five real leads (not one lead five times).
    const leadIds = new Set(report.rows.map((r) => r.leadId));
    const attemptIds = new Set(report.rows.map((r) => r.attemptId));
    expect(leadIds.size).toBe(5);
    expect(attemptIds.size).toBe(5);
    for (const r of report.rows) {
      expect(r.registered).toBe(true);
      expect(r.leadId).toMatch(/^LEAD-\d{6}-\d{4}$/);
      expect(r.attemptId).toMatch(/^PRSP-\d{6}-\d{4}$/);
      expect(r.reason).toBe('');
    }
    // The shared Source landed on every row.
    const sources = await sql<{ source: string }[]>`
      select source from leads where id = any(${[...leadIds]})`;
    expect(sources.map((s) => s.source)).toEqual(['Scouting', 'Scouting', 'Scouting', 'Scouting', 'Scouting']);
  });

  it('rejects only the offending row: the other rows stay committed (one tx per row)', async () => {
    // Row 2 duplicates a phone Budi already holds an open attempt on, so `decide`
    // refuses it. Rows 1 and 3 must still exist afterwards — the whole point of
    // not wrapping the batch in a single transaction.
    const taken = uniquePhone();
    await register(sql, budi(), { leadName: 'Sudah Ada', phoneNumber: taken });
    const fresh = [uniquePhone(), uniquePhone()];

    const report = await registerBatch(sql, budi(), {
      source: 'Scouting',
      outsideCampaign: true,
      prospects: [
        { leadName: 'Baru A', phoneNumber: fresh[0] },
        { leadName: 'Duplikat', phoneNumber: taken },
        { leadName: 'Baru B', phoneNumber: fresh[1] },
      ],
    });

    expect(report.registered).toBe(2);
    expect(report.rejected).toBe(1);
    expect(report.rows[1].registered).toBe(false);
    expect(report.rows[1].reason).toBe(MSG_ALREADY_OWN_ATTEMPT);
    expect(report.rows[1].rowNumber).toBe(2);
    expect(report.rejections).toHaveLength(1);
    // Rows 1 and 3 are really in the database.
    const kept = await sql<{ n: number }[]>`
      select count(*)::int as n from leads where id = any(${[report.rows[0].leadId, report.rows[2].leadId]})`;
    expect(kept[0].n).toBe(2);
  });

  it('rejects an incomplete row with the house BI message, keeping the rest', async () => {
    const report = await registerBatch(sql, budi(), {
      source: 'Scouting',
      outsideCampaign: true,
      prospects: [
        { leadName: 'Lengkap', phoneNumber: uniquePhone() },
        { leadName: '   ', phoneNumber: uniquePhone() }, // no name
        { leadName: 'Tanpa Telepon', phoneNumber: '' },
      ],
    });
    expect(report.registered).toBe(1);
    expect(report.rejected).toBe(2);
    expect(report.rows[1].reason).toBe(bi.INCOMPLETE_DATA);
    expect(report.rows[2].reason).toBe(bi.INCOMPLETE_DATA);
  });

  it('a second row on the SAME phone is refused (the batch does not double-open an attempt)', async () => {
    const dup = uniquePhone();
    const report = await registerBatch(sql, budi(), {
      source: 'Scouting',
      outsideCampaign: true,
      prospects: [
        { leadName: 'Sama A', phoneNumber: dup },
        { leadName: 'Sama B', phoneNumber: dup },
      ],
    });
    expect(report.registered).toBe(1);
    expect(report.rows[1].reason).toBe(MSG_ALREADY_OWN_ATTEMPT);
    const attempts = await sql<{ n: number }[]>`
      select count(*)::int as n from prospect_attempts where lead_id = ${report.rows[0].leadId}`;
    expect(attempts[0].n).toBe(1);
  });

  it('refuses the whole batch when the picked campaign does not exist (nothing registered)', async () => {
    const phones = [uniquePhone(), uniquePhone()];
    await expect(registerBatch(sql, budi(), {
      source: 'Leads - Iklan',
      campaignId: 'CMP-000000-0000',
      prospects: phones.map((phoneNumber, i) => ({ leadName: `X${i}`, phoneNumber })),
    })).rejects.toBeInstanceOf(NotFoundError);
    const made = await sql<{ n: number }[]>`
      select count(*)::int as n from leads where phone_norm = any(${phones.map(normalizePhone)})`;
    expect(made[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FS-3 — PROSPEK BERSAMA (feedback tim Sales 2026-09-08 #3).
// ---------------------------------------------------------------------------
describeDb('prospek bersama (FS-3)', () => {
  it('attempt kedua MENAUTKAN dirinya ke attempt yang sudah ada', async () => {
    const phone = uniquePhone();
    const a = await register(sql, budi(), { leadName: 'Toko Bersama', phoneNumber: phone });
    const b = await register(sql, andi(), { leadName: 'Toko Bersama', phoneNumber: phone });

    const rows = await sql<{ id: string; bersama_dengan_attempt_id: string | null }[]>`
      select id, bersama_dengan_attempt_id from prospect_attempts where lead_id = ${a.lead.id}
       order by created_at, id`;
    const byId = new Map(rows.map((r) => [r.id, r.bersama_dengan_attempt_id]));

    // Yang datang belakangan menunjuk yang sudah ada — arah tautannya searah
    // dengan ceritanya: sales A lebih dulu, sales B menyusul.
    expect(byId.get(b.attempt.id)).toBe(a.attempt.id);
    expect(byId.get(a.attempt.id)).toBeNull();
  });

  it('KLAIM lead Pool TIDAK menautkan — itu kontes, bukan prospek bersama', async () => {
    // Pagar yang menjaga arti kolomnya. Dua sales yang mengklaim lead Pool
    // memang sedang berkompetisi (M1 §6), dan menutup salah satunya sebagai
    // "prospek bersama" akan menghapus metrik contested-win-rate.
    const leadId = await seedPoolLead();
    const c1 = await claim(sql, budi(), leadId);
    const c2 = await claim(sql, andi(), leadId);
    // `seedPoolLead` menyisakan satu attempt Not Qualified dari pendaftaran
    // awalnya, jadi yang diperiksa adalah kedua KLAIM-nya, bukan jumlah baris.
    const rows = await sql<{ id: string; bersama_dengan_attempt_id: string | null }[]>`
      select id, bersama_dengan_attempt_id from prospect_attempts
       where id in (${c1.attempt.id}, ${c2.attempt.id})`;
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.bersama_dengan_attempt_id).toBeNull();
    }
  });

  /**
   * Inti FS-1, dan alasan state terminalnya dipisah.
   *
   * `salesperf` menghitung contested-win-rate dari attempt yang KALAH. Sales
   * yang memegang 50% komisi tapi tercatat "kalah kompetisi" adalah dua
   * pernyataan yang saling meniadakan pada orang yang sama — dan yang salah
   * tidak pernah melempar galat, ia cuma menurunkan angka kinerja seseorang
   * diam-diam di dashboard.
   */
  it('sales B (pemegang tautan) menang → sales A ditutup Prospek Bersama, bukan Kalah', async () => {
    const phone = uniquePhone();
    const a = await register(sql, budi(), { leadName: 'Toko Menang', phoneNumber: phone });
    const b = await register(sql, andi(), { leadName: 'Toko Menang', phoneNumber: phone });

    // Sales B (yang menyusul) menutup deal-nya.
    await resolveWin(sql, a.lead.id, b.attempt.id, andi().employeeId);

    const rows = await sql<{ id: string; status: string }[]>`
      select id, status from prospect_attempts where lead_id = ${a.lead.id}`;
    const status = new Map(rows.map((r) => [r.id, r.status]));
    expect(status.get(a.attempt.id)).toBe(ATTEMPT_CLOSED_BERSAMA);
    expect(status.get(a.attempt.id)).not.toBe(ATTEMPT_CLOSED_KALAH);
  });

  it('sales A (yang ditunjuk) menang → sales B juga tidak dihukum — arah sebaliknya', async () => {
    // Penunjuknya HANYA ada di baris B, jadi kedua arah butuh lengan yang
    // berbeda: saat B menang yang cocok `winnerBersama === o.id`, saat A menang
    // yang cocok `o.bersama_dengan_attempt_id === winningAttemptId`. Kedua
    // lengan itu divalidasi-mutasi terpisah — mencabut salah satunya
    // memerahkan tes yang berbeda, jadi tidak satu pun di antaranya hiasan.
    const phone = uniquePhone();
    const a = await register(sql, budi(), { leadName: 'Toko Dua Arah', phoneNumber: phone });
    const b = await register(sql, andi(), { leadName: 'Toko Dua Arah', phoneNumber: phone });

    await resolveWin(sql, a.lead.id, a.attempt.id, budi().employeeId);

    const rows = await sql<{ id: string; status: string }[]>`
      select id, status from prospect_attempts where lead_id = ${a.lead.id}`;
    const status = new Map(rows.map((r) => [r.id, r.status]));
    expect(status.get(b.attempt.id)).toBe(ATTEMPT_CLOSED_BERSAMA);
  });

  it('kontes lead Pool TETAP ditutup sebagai Kalah Kompetisi', async () => {
    // Pagar arah sebaliknya: cabang FS-3 tidak boleh mematikan perilaku lama.
    const leadId = await seedPoolLead();
    const c1 = await claim(sql, budi(), leadId);
    const c2 = await claim(sql, andi(), leadId);

    await resolveWin(sql, leadId, c1.attempt.id, budi().employeeId);

    const rows = await sql<{ id: string; status: string }[]>`
      select id, status from prospect_attempts where id = ${c2.attempt.id}`;
    expect(rows[0].status).toBe(ATTEMPT_CLOSED_KALAH);
  });

  it('audit memisahkan `prospek_bersama` dari `losers`', async () => {
    // Riwayatnya harus bisa menjawab "siapa yang kalah" dan "siapa yang
    // berbagi" tanpa menebak dari status.
    const phone = uniquePhone();
    const a = await register(sql, budi(), { leadName: 'Toko Audit', phoneNumber: phone });
    const b = await register(sql, andi(), { leadName: 'Toko Audit', phoneNumber: phone });
    await resolveWin(sql, a.lead.id, b.attempt.id, andi().employeeId);

    const rows = await sql<{ after_json: { losers: string[]; prospek_bersama: string[]; note: string } }[]>`
      select after_json from audit_log
       where entity_type = 'lead' and entity_id = ${a.lead.id} and action = 'win_resolved'`;
    expect(rows.length).toBe(1);
    expect(rows[0].after_json.prospek_bersama).toEqual([a.attempt.id]);
    expect(rows[0].after_json.losers).toEqual([]);
    expect(rows[0].after_json.note).toContain('prospek dikerjakan bersama');
  });

  it('[Closed - Prospek Bersama] TERMINAL — nomor yang sama bisa didaftarkan lagi', async () => {
    // Kalau state ini tidak terdaftar terminal, attempt yang sudah ditutup
    // masih terbaca "terbuka" dan pendaftaran berikutnya akan menautkan diri
    // padanya — rantai prospek bersama yang tidak pernah putus.
    const phone = uniquePhone();
    const a = await register(sql, budi(), { leadName: 'Toko Terminal', phoneNumber: phone });
    const b = await register(sql, andi(), { leadName: 'Toko Terminal', phoneNumber: phone });
    await resolveWin(sql, a.lead.id, b.attempt.id, andi().employeeId);

    const match = await sql<{ status: string }[]>`
      select status from prospect_attempts where id = ${a.attempt.id}`;
    expect(isTerminalAttemptStatus(match[0].status)).toBe(true);
  });
});
