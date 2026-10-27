/**
 * WEBSITE-LEAD (docs/DECISIONS.md 2026-10-27): payload v1 (murni) dan intake
 * (integrasi, butuh DATABASE_URL). Lead website dibuat oleh aktor SYSTEM; baris
 * uji dikenali dari site `zz-test.meagency.co.id` dan dibersihkan di afterEach
 * (inbox imutabel, jadi trigger-nya dimatikan sesaat khusus untuk pembersihan).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { bi, permission } from '@cdps/core';
import { leadDetailView, leadsDatabase, poolBoard, register, type Actor } from './leads';
import {
  ORIGIN_DIVISION_WEBSITE,
  SCHEMA_V1,
  SOURCE_WEBSITE,
  ValidationError,
  intake,
  parsePayloadV1,
} from './website-lead';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
const SITE = 'zz-test.meagency.co.id';

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let phoneSeq = 0;
const uniquePhone = (): string => `0857${String(Date.now()).slice(-6)}${String(phoneSeq++).padStart(3, '0')}`;

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SCHEMA_V1,
    kanal: 'website',
    idempotency_key: randomUUID(),
    site: SITE,
    submitted_at: '2026-10-27T09:15:00+07:00',
    nama: 'Rina Uji',
    whatsapp: uniquePhone(),
    link_toko: 'shopee.co.id/rina-uji',
    omzet: '250jt-1m',
    layanan: 'Iklan Shopee dan TikTok Shop',
    sumber_form: 'layanan-performance-ads',
    halaman_asal: '/jasa-performance-ads/',
    utm: { source: 'instagram', medium: null, campaign: '' },
    persetujuan_dihubungi: true,
    ...over,
  };
}

async function send(b: Record<string, unknown>, headerKey?: string) {
  const raw = JSON.stringify(b);
  return intake(sql, raw, headerKey ?? String(b.idempotency_key));
}

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', divisi: 'Sales',
  role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});

function claimsOf(division: string, level: string, employeeId: string): string {
  return JSON.stringify({ app_metadata: { employee_id: employeeId, division, level, od: false, director: false } });
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  const ids = await sql<{ lead_id: string }[]>`select lead_id from website_lead_inbox where site = ${SITE}`;
  await sql`alter table website_lead_inbox disable trigger trg_website_lead_inbox_immutable`;
  await sql`delete from website_lead_inbox where site = ${SITE}`;
  await sql`alter table website_lead_inbox enable trigger trg_website_lead_inbox_immutable`;
  const leadIds = ids.map((r) => r.lead_id);
  if (leadIds.length > 0) {
    await sql`delete from prospect_attempts where lead_id = any(${leadIds}) and created_by like 'ZZ-%'`;
    await sql`delete from leads where id = any(${leadIds}) and created_by = 'SYSTEM'`;
  }
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
});

describe('parsePayloadV1', () => {
  it('menerima payload kontrak v1 dan merapikan UTM kosong jadi null', () => {
    const p = parsePayloadV1(body({ whatsapp: '081234567890' }));
    expect(p.whatsapp).toBe('081234567890');
    expect(p.utm).toEqual({ source: 'instagram', medium: null, campaign: null });
    expect(p.sumberForm).toBe('layanan-performance-ads');
  });

  it.each([
    ['schema lain', { schema: 'mea.website_lead.v2' }],
    ['kanal lain', { kanal: 'whatsapp' }],
    ['tanpa persetujuan', { persetujuan_dihubungi: false }],
    ['key bukan UUID', { idempotency_key: 'abc' }],
    ['nama kosong', { nama: '  ' }],
    ['nomor bukan 08…', { whatsapp: '6281234567890' }],
    ['omzet di luar daftar', { omzet: '5m' }],
    ['halaman asal bukan path', { halaman_asal: 'https://x.test/' }],
    ['utm bukan objek', { utm: 'instagram' }],
    ['sumber form kosong', { sumber_form: '' }],
  ])('menolak %s dengan pesan BI bawaan', (_label, over) => {
    expect(() => parsePayloadV1(body(over))).toThrow(ValidationError);
    expect(() => parsePayloadV1(body(over))).toThrow(bi.INCOMPLETE_DATA);
  });
});

describeDb('intake', () => {
  it('lead baru masuk [Pool] dengan source Website, divisi SEO Website, aktor SYSTEM, tanpa campaign', async () => {
    const b = body();
    const res = await send(b);
    expect(res).toMatchObject({ status: 'dibuat', replay: false });
    const [lead] = await sql<{
      record_status: string; source: string; origin_division: string;
      origin_campaign_id: string | null; created_by: string; lead_name: string;
    }[]>`select record_status, source, origin_division, origin_campaign_id, created_by, lead_name
          from leads where id = ${res.leadId}`;
    expect(lead).toEqual({
      record_status: '[Pool]', source: SOURCE_WEBSITE, origin_division: ORIGIN_DIVISION_WEBSITE,
      origin_campaign_id: null, created_by: 'SYSTEM', lead_name: 'Rina Uji',
    });
    const [inbox] = await sql<{ hasil: string; utm_source: string | null; utm_campaign: string | null; payload: unknown }[]>`
      select hasil, utm_source, utm_campaign, payload from website_lead_inbox where idempotency_key = ${String(b.idempotency_key)}`;
    expect(inbox.hasil).toBe('dibuat');
    expect(inbox.utm_source).toBe('instagram');
    expect(inbox.utm_campaign).toBeNull();
    expect(inbox.payload).toEqual(b);
    const audit = await sql`select 1 from audit_log where entity_type = 'lead' and entity_id = ${res.leadId} and action = 'create'`;
    expect(audit.length).toBe(1);
  });

  it('kunci yang sama dikirim ulang mengembalikan hasil pertama tanpa baris baru', async () => {
    const b = body();
    const first = await send(b);
    const second = await send(b);
    expect(second).toEqual({ status: 'dibuat', leadId: first.leadId, replay: true });
    const n = await sql`select 1 from website_lead_inbox where idempotency_key = ${String(b.idempotency_key)}`;
    expect(n.length).toBe(1);
  });

  it('menolak bila key di header berbeda dengan key di body, dan body yang bukan JSON', async () => {
    await expect(send(body(), randomUUID())).rejects.toThrow(ValidationError);
    await expect(intake(sql, '{bukan json', randomUUID())).rejects.toThrow(ValidationError);
  });

  it('nomor yang sedang diproses sales: duplikat, nol lead baru, manual review, pemilik attempt diberi tahu', async () => {
    const phone = uniquePhone();
    const { lead } = await register(sql, budi(), { leadName: 'Sudah Ada', phoneNumber: phone, source: 'Scouting' });
    const before = await sql`select count(*)::int as n from leads`;
    const res = await send(body({ whatsapp: phone }));
    expect(res).toEqual({ status: 'duplikat', leadId: lead.id, replay: false });
    const after = await sql`select count(*)::int as n from leads`;
    expect(after[0].n).toBe(before[0].n);
    const [row] = await sql<{ manual_review_flag: boolean }[]>`select manual_review_flag from leads where id = ${lead.id}`;
    expect(row.manual_review_flag).toBe(true);
    const audit = await sql`select 1 from audit_log where entity_id = ${lead.id} and action = 'website_lead_duplikat'`;
    expect(audit.length).toBe(1);
    const notif = await sql`
      select 1 from notifications
       where event_type = 'm1.lead.website_masuk' and entity_id = ${lead.id} and recipient_employee_id = 'ZZ-BUDI'`;
    expect(notif.length).toBe(1);
  });

  it('nomor di record terminal dibuka ulang ke [Pool]', async () => {
    const phone = uniquePhone();
    const { lead } = await register(sql, budi(), { leadName: 'Pernah NQ', phoneNumber: phone, source: 'Scouting' });
    await sql`update prospect_attempts set status = 'Not Qualified' where lead_id = ${lead.id}`;
    await sql`update leads set record_status = '[Not Qualified]' where id = ${lead.id}`;
    const res = await send(body({ whatsapp: phone }));
    expect(res).toEqual({ status: 'dibuat', leadId: lead.id, replay: false });
    const [row] = await sql<{ record_status: string }[]>`select record_status from leads where id = ${lead.id}`;
    expect(row.record_status).toBe('[Pool]');
    const [inbox] = await sql<{ hasil: string }[]>`select hasil from website_lead_inbox where lead_id = ${lead.id}`;
    expect(inbox.hasil).toBe('dibuka_ulang');
  });

  it('tanda terima imutabel: UPDATE dan DELETE ditolak', async () => {
    const b = body();
    await send(b);
    const key = String(b.idempotency_key);
    await expect(sql`update website_lead_inbox set hasil = 'duplikat' where idempotency_key = ${key}`).rejects.toThrow();
    await expect(sql`delete from website_lead_inbox where idempotency_key = ${key}`).rejects.toThrow();
  });

  it('RLS: Sales melihat lead Pool website beserta tanda terimanya; Marketing tidak', async () => {
    const res = await send(body());
    const seen = await withClaims(sql, claimsOf('Sales', 'staff', 'ZZ-SALES-X'), async (tx) => ({
      lead: (await tx`select 1 from leads where id = ${res.leadId}`).length,
      inbox: (await tx`select 1 from website_lead_inbox where lead_id = ${res.leadId}`).length,
    }));
    expect(seen).toEqual({ lead: 1, inbox: 1 });
    const mkt = await withClaims(sql, claimsOf('Marketing', 'lead', 'ZZ-MKT-X'), async (tx) => ({
      lead: (await tx`select 1 from leads where id = ${res.leadId}`).length,
      inbox: (await tx`select 1 from website_lead_inbox where lead_id = ${res.leadId}`).length,
    }));
    expect(mkt).toEqual({ lead: 0, inbox: 0 });
  });

  it('read model: badge dan filter di Pool + Leads Database, blok asal website di detail', async () => {
    const res = await send(body({ nama: 'Website Kwitang' }));
    const pool = (await poolBoard(sql, 'ZZ-BUDI', { q: 'Website Kwitang' })).rows;
    expect(pool.map((r) => [r.id, r.websiteLead])).toEqual([[res.leadId, true]]);
    const onlyWeb = (await poolBoard(sql, 'ZZ-BUDI', { website: true })).rows.map((r) => r.id);
    expect(onlyWeb).toContain(res.leadId);
    const db = (await leadsDatabase(sql, { q: 'Website Kwitang', website: true })).rows;
    expect(db.map((r) => [r.id, r.websiteLead])).toEqual([[res.leadId, true]]);
    const detail = await leadDetailView(sql, res.leadId);
    expect(detail.website).toMatchObject({
      site: SITE, sumberForm: 'layanan-performance-ads', halamanAsal: '/jasa-performance-ads/',
      utmSource: 'instagram', utmMedium: null, linkToko: 'shopee.co.id/rina-uji',
      omzet: '250jt-1m', layanan: 'Iklan Shopee dan TikTok Shop', hasil: 'dibuat', kiriman: 1,
    });
  });

  it('lead non-website: tanpa badge dan tanpa blok website', async () => {
    const { lead } = await register(sql, budi(), { leadName: 'Scout Biasa', phoneNumber: uniquePhone(), source: 'Scouting' });
    const rows = (await leadsDatabase(sql, { q: 'Scout Biasa' })).rows;
    expect(rows[0].websiteLead).toBe(false);
    expect((await leadsDatabase(sql, { q: 'Scout Biasa', website: true })).rows).toEqual([]);
    expect((await leadDetailView(sql, lead.id)).website).toBeNull();
  });
});
