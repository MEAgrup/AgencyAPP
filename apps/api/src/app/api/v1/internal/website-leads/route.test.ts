/**
 * `/internal/website-leads` (WEBSITE-LEAD, docs/DECISIONS.md 2026-10-27).
 *
 * Gerbang tanda tangan diuji tanpa DB (ditolak sebelum handler menyentuh
 * database). Vektor tetap diambil dari kontrak pengirim
 * (`docs/WEBSITE_LEAD_CONTRACT.md` bagian 5, repo `wp-meagency`), jadi kedua
 * sisi terbukti menghitung tanda tangan yang sama. Alur penuh (201 → kirim ulang
 * 200) butuh DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { sign, websiteLeadSignatureOk } from '@/lib/website-lead-auth';
import { POST } from './route';

const URL = 'http://localhost/api/v1/internal/website-leads';
const prev = process.env.WEBSITE_LEAD_SECRET;
const prevBridge = process.env.BRIDGE_INGEST_SECRET;

// Kontrak bagian 5: secret contoh, timestamp, body 478 byte, tanda tangan.
const VECTOR_SECRET = 'contoh-rahasia-jangan-dipakai';
const VECTOR_TS = '1761360900';
const VECTOR_BODY = '{"schema":"mea.website_lead.v1","kanal":"website","idempotency_key":"3f0c8a52-6c1e-4d8a-9b2f-0c4e2a7d9e11","site":"meagency.co.id","submitted_at":"2026-10-19T09:15:00+07:00","nama":"Rina Kusuma","whatsapp":"081234567890","link_toko":"shopee.co.id/namatoko","omzet":"250jt-1m","layanan":"Iklan Shopee dan TikTok Shop","sumber_form":"layanan-performance-ads","halaman_asal":"/jasa-performance-ads/","utm":{"source":null,"medium":null,"campaign":null},"persetujuan_dihubungi":true}';
const VECTOR_SIG = 'sha256=613ec03b112cb1e062b9f8eff5d1a7a4f4fb178bdb8a65e14f6cb60095b0c78d';

function post(headers: Record<string, string>, body: string): Request {
  return new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body });
}

beforeEach(() => {
  delete process.env.WEBSITE_LEAD_SECRET;
  delete process.env.BRIDGE_INGEST_SECRET;
});
afterEach(() => {
  if (prev === undefined) delete process.env.WEBSITE_LEAD_SECRET;
  else process.env.WEBSITE_LEAD_SECRET = prev;
  if (prevBridge === undefined) delete process.env.BRIDGE_INGEST_SECRET;
  else process.env.BRIDGE_INGEST_SECRET = prevBridge;
});

describe('tanda tangan kontrak v1', () => {
  it('menghasilkan tanda tangan yang sama dengan vektor kontrak (dicek openssl di sisi pengirim)', () => {
    expect(Buffer.byteLength(VECTOR_BODY, 'utf8')).toBe(478);
    expect(sign(VECTOR_SECRET, VECTOR_TS, VECTOR_BODY)).toBe(VECTOR_SIG);
  });

  it('menerima vektor kontrak di dalam jendela 300 detik, menolak di luarnya', () => {
    process.env.WEBSITE_LEAD_SECRET = VECTOR_SECRET;
    const req = post({ 'x-mea-timestamp': VECTOR_TS, 'x-mea-signature': VECTOR_SIG }, VECTOR_BODY);
    expect(websiteLeadSignatureOk(req, VECTOR_BODY, Number(VECTOR_TS) + 300)).toBe(true);
    expect(websiteLeadSignatureOk(req, VECTOR_BODY, Number(VECTOR_TS) - 300)).toBe(true);
    expect(websiteLeadSignatureOk(req, VECTOR_BODY, Number(VECTOR_TS) + 301)).toBe(false);
  });

  it('body berubah satu byte → ditolak', () => {
    process.env.WEBSITE_LEAD_SECRET = VECTOR_SECRET;
    const req = post({ 'x-mea-timestamp': VECTOR_TS, 'x-mea-signature': VECTOR_SIG }, VECTOR_BODY + ' ');
    expect(websiteLeadSignatureOk(req, VECTOR_BODY + ' ', Number(VECTOR_TS))).toBe(false);
  });
});

describe('POST /internal/website-leads — gerbang', () => {
  it('menolak bila secret belum dikonfigurasi (tertutup bawaan)', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await POST(post({ 'x-mea-timestamp': ts, 'x-mea-signature': sign('apa-saja', ts, VECTOR_BODY) }, VECTOR_BODY));
    expect(res.status).toBe(401);
  });

  it('menolak tanda tangan salah, tanpa header, dan timestamp kedaluwarsa', async () => {
    process.env.WEBSITE_LEAD_SECRET = 's3cr3t-website';
    const now = String(Math.floor(Date.now() / 1000));
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect((await POST(post({ 'x-mea-timestamp': now, 'x-mea-signature': sign('lain', now, VECTOR_BODY) }, VECTOR_BODY))).status).toBe(401);
    expect((await POST(post({}, VECTOR_BODY))).status).toBe(401);
    expect((await POST(post({ 'x-mea-timestamp': old, 'x-mea-signature': sign('s3cr3t-website', old, VECTOR_BODY) }, VECTOR_BODY))).status).toBe(401);
  });

  it('BRIDGE_INGEST_SECRET tidak membuka gerbang ini — kredensial terpisah', async () => {
    process.env.WEBSITE_LEAD_SECRET = 's3cr3t-website';
    process.env.BRIDGE_INGEST_SECRET = 's3cr3t-bridge';
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await POST(post({ 'x-mea-timestamp': ts, 'x-mea-signature': sign('s3cr3t-bridge', ts, VECTOR_BODY) }, VECTOR_BODY));
    expect(res.status).toBe(401);
  });
});

const DB = process.env.DATABASE_URL;
const SITE = 'zz-route.meagency.co.id';
let sql: Sql | undefined;
if (DB) sql = createClient(DB);

afterAll(async () => {
  if (!sql) return;
  const ids = await sql<{ lead_id: string }[]>`select lead_id from website_lead_inbox where site = ${SITE}`;
  await sql`alter table website_lead_inbox disable trigger trg_website_lead_inbox_immutable`;
  await sql`delete from website_lead_inbox where site = ${SITE}`;
  await sql`alter table website_lead_inbox enable trigger trg_website_lead_inbox_immutable`;
  const leadIds = ids.map((r) => r.lead_id);
  if (leadIds.length > 0) await sql`delete from leads where id = any(${leadIds}) and created_by = 'SYSTEM'`;
  await sql.end();
});

describe.skipIf(!DB)('POST /internal/website-leads — alur penuh', () => {
  it('201 dibuat, lalu kirim ulang dengan kunci sama 200 dengan lead yang sama; payload salah 400', async () => {
    process.env.WEBSITE_LEAD_SECRET = 's3cr3t-website';
    const key = randomUUID();
    const body = JSON.stringify({
      schema: 'mea.website_lead.v1', kanal: 'website', idempotency_key: key, site: SITE,
      submitted_at: '2026-10-27T10:00:00+07:00', nama: 'Uji Route',
      whatsapp: `0858${String(Date.now()).slice(-8)}`, link_toko: '', omzet: '<100jt', layanan: '',
      sumber_form: 'home', halaman_asal: '/', utm: { source: null, medium: null, campaign: null },
      persetujuan_dihubungi: true,
    });
    const signed = (b: string, k: string) => {
      const ts = String(Math.floor(Date.now() / 1000));
      return post({ 'x-mea-timestamp': ts, 'x-mea-signature': sign('s3cr3t-website', ts, b), 'x-mea-idempotency-key': k }, b);
    };

    const first = await POST(signed(body, key));
    expect(first.status).toBe(201);
    const a = await first.json() as { status: string; lead_id: string };
    expect(a.status).toBe('dibuat');
    expect(a.lead_id).toMatch(/^LEAD-\d{6}-\d{4,}$/);

    const again = await POST(signed(body, key));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: 'dibuat', lead_id: a.lead_id });

    const bad = body.replace('"<100jt"', '"5m"').replace(key, randomUUID());
    const badKey = (JSON.parse(bad) as { idempotency_key: string }).idempotency_key;
    const res = await POST(signed(bad, badKey));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]' });
  });
});
