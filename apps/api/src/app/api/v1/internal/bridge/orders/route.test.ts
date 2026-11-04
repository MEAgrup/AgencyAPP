/**
 * `POST /internal/bridge/orders` — ingest Bridge MSDPS→CDPS Fase 1.
 *
 * Sejak MSDPS 0377 (2026-11-04) order dikirim OTOMATIS begitu pembayaran
 * pertama terverifikasi (DP pun cukup), dan setiap `lines[].catatan` diakhiri
 * ringkasan pembayaran. Kontrak v1 tidak berubah. Tes ini mem-POST fixture
 * bersama (`docs/fixtures/bridge_order_v1.json`) dengan catatan berformat baru
 * lewat handler route yang sebenarnya — MSDPS menandai order 'dead' sesudah 5x
 * gagal, jadi penolakan di sini berarti order hilang.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { POST } from './route';

const ENDPOINT = 'http://localhost/api/v1/internal/bridge/orders';
const SECRET = 's3cr3t-bridge-route-test';
const prev = process.env.BRIDGE_INGEST_SECRET;
const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../../../../../docs/fixtures/bridge_order_v1.json', import.meta.url)), 'utf8'),
) as Record<string, unknown> & { lines: { catatan: string | null }[] };

const NOTE_DP = '[Pembayaran klien saat diteruskan: DP 30% — Rp 4.500.000 dari Rp 15.000.000]';
const NOTE_LUNAS = '[Pembayaran klien: LUNAS 100% — Rp 15.000.000]';

function post(body: unknown, key: string, secret = SECRET): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}`, 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

/** Fixture v1 apa adanya, hanya deal_code/external_id unik + catatan ditempeli ringkasan seperti MSDPS. */
function fixtureWithNote(note: string, tag: string, catatanAsli?: (c: string | null) => string | null) {
  const suffix = `${Date.now() % 10000000}${tag}`;
  const f = structuredClone(FIXTURE) as typeof FIXTURE & { merchant: Record<string, unknown> };
  f.deal_code = `ZBR-ROUTE-${suffix}`;
  f.merchant.external_id = `ZBR-ROUTE-SHOP-${suffix}`;
  f.lines = f.lines.map((l) => {
    const asli = catatanAsli ? catatanAsli(l.catatan) : l.catatan;
    return { ...l, catatan: asli ? `${asli} ${note}` : note };
  });
  return f;
}

beforeEach(() => {
  process.env.BRIDGE_INGEST_SECRET = SECRET;
});
afterEach(() => {
  if (prev === undefined) delete process.env.BRIDGE_INGEST_SECRET;
  else process.env.BRIDGE_INGEST_SECRET = prev;
});

describe('POST /internal/bridge/orders — gerbang', () => {
  it('menolak secret salah sebelum menyentuh DB', async () => {
    const res = await POST(post(fixtureWithNote(NOTE_DP, 'x'), 'k:1', 'salah'));
    expect(res.status).toBe(401);
  });
});

const DB = process.env.DATABASE_URL;
let sql: Sql | undefined;
if (DB) sql = createClient(DB);

afterAll(async () => {
  if (!sql) return;
  await sql`delete from external_orders where external_deal_code like 'ZBR-ROUTE-%'`;
  await sql.end();
});

describe.skipIf(!DB)('POST /internal/bridge/orders — catatan berformat MSDPS 0377', () => {
  it('fixture v1 + ringkasan DP diterima 200 [Masuk], payload tersimpan byte-sama, kunci sama → ord_code sama', async () => {
    const body = fixtureWithNote(NOTE_DP, 'dp');
    const key = `${body.deal_code as string}:1`;
    const res = await POST(post(body, key));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ord_code: string; status: string };
    expect(out.status).toBe('[Masuk]');
    expect(out.ord_code).toMatch(/^ORD-\d{6}-\d{4,}$/);

    const rows = await sql!<{ payload: typeof body }[]>`select payload from external_orders where id = ${out.ord_code}`;
    expect(rows[0].payload).toEqual(body);
    expect(rows[0].payload.lines[0].catatan).toBe(`Strategi + brief bulanan, paket 6 bulan ${NOTE_DP}`);

    const again = await POST(post(body, key));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(out);
  });

  it('ringkasan LUNAS pada baris tanpa catatan asli, dan catatan asli 500 karakter + ringkasan, sama-sama diterima', async () => {
    const lunas = fixtureWithNote(NOTE_LUNAS, 'ln', () => null);
    const r1 = await POST(post(lunas, `${lunas.deal_code as string}:1`));
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { status: string }).status).toBe('[Masuk]');

    const panjang = fixtureWithNote(NOTE_DP, 'pj', () => 'x, y — z % [w] '.repeat(40).slice(0, 500));
    const r2 = await POST(post(panjang, `${panjang.deal_code as string}:1`));
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { status: string }).status).toBe('[Masuk]');
  });
});
