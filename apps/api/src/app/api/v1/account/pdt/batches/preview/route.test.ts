/**
 * POST /api/v1/account/pdt/batches/preview (G1-09) — route wiring: auth,
 * `client_platform_id`, pagar paket (Rule 42), dan bentuk wire (snake_case,
 * `null` eksplisit). Cakupan per-baris/identitas/periode yang lebih dalam ada
 * di `packages/domain/src/pdt.test.ts` (`previewUploadBatch` langsung) — di
 * sini cukup bukti bahwa route SUNGGUHAN menyambungkannya (bukan lagi hanya
 * dipanggil dari tes, PDT_BACKLOG.md G1-09).
 *
 * Permission/400 (client_platform_id hilang, pagar paket menolak) berjalan
 * TANPA `DATABASE_URL` (pola sama `leads/export/route.test.ts`) — keduanya
 * gagal sebelum database tersentuh sama sekali kecuali disebut lain. Jalur
 * 200/403/404 butuh Postgres nyata (di-skip tanpa `DATABASE_URL`).
 */
import { createHmac } from 'node:crypto';
import { ZipFile } from 'yazl';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createClient, type Sql } from '@cdps/db';
import { POST } from './route';

const SECRET = 'test-jwt-secret-pdt-preview';
const prevSecret = process.env.SUPABASE_JWT_SECRET;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

interface Claims { employeeId: string; division: string; level: string; od: boolean; director: boolean }

function sign(c: Claims): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: { employee_id: c.employeeId, division: c.division, level: c.level, od: c.od, director: c.director },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function req(token: string, qs: string, body: Buffer): Request {
  return new Request(`http://localhost/api/v1/account/pdt/batches/preview${qs}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
    body: body as unknown as BodyInit,
  });
}

function zipkan(entries: { nama: string; isi: Buffer }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const e of entries) zip.addBuffer(e.isi, e.nama, { compress: true });
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

function xlsxDariAoa(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

beforeAll(() => { process.env.SUPABASE_JWT_SECRET = SECRET; });
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = prevSecret;
});

const owner = sign({ employeeId: 'ZZ-PDTRT-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTRT-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('POST /pdt/batches/preview — gagal sebelum DB tersentuh', () => {
  it('client_platform_id hilang ⇒ 400', async () => {
    const res = await POST(req(owner, '', Buffer.from('')));
    expect(res.status).toBe(400);
  });

  it('client_platform_id bukan integer positif ⇒ 400', async () => {
    const res = await POST(req(owner, '?client_platform_id=abc', Buffer.from('')));
    expect(res.status).toBe(400);
  });

  it('badan request bukan ZIP sama sekali (berkas salah/rusak) ⇒ 400, bukan 500', async () => {
    const res = await POST(req(owner, '?client_platform_id=1', Buffer.from('bukan zip sama sekali')));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[berkas yang diunggah bukan paket ZIP yang valid]');
  });

  it('paket ZIP > 40 entri ⇒ 400 dengan pesan Rule 42 (pagar, sebelum satu entri pun dibaca)', async () => {
    const entries = Array.from({ length: 41 }, (_, i) => ({ nama: `f${i}.xlsx`, isi: Buffer.from('x') }));
    const buf = await zipkan(entries);
    const res = await POST(req(owner, '?client_platform_id=1', buf));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[paket ZIP berisi lebih dari 40 entri]');
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — pola fixture sama
// dengan packages/domain/src/pdt.test.ts, prefix 'ZZ-PDTRT-'.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const nextClientId = (): string => `CLI-PDTRT-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, assignedAm: string | null): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${assignedAm}, 'ZZ-TEST')`;
}

async function insertClientPlatform(clientId: string, platform: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    insert into client_platforms (client_id, platform, active, created_by)
    values (${clientId}, ${platform}, true, 'ZZ-TEST') returning id`;
  return Number(rows[0].id); // bigint identity ⇒ postgres.js decodes as string
}

afterAll(async () => { if (sql) await sql.end(); });
afterEach(async () => {
  if (!sql) return;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

describeDb('POST /pdt/batches/preview — real DB', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    const res = await POST(req(owner, '?client_platform_id=999999999', await zipkan([])));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRT-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const res = await POST(req(otherAm, `?client_platform_id=${cpId}`, await zipkan([])));
    expect(res.status).toBe(403);
  });

  it('200: ZIP sungguhan ⇒ tabel hasil deteksi wire snake_case, kunci eksplisit', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRT-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const header = [
      'Kode Produk', 'Kode Variasi', 'SKU Induk',
      'Total Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)',
      'Jumlah Produk Dilihat', 'Produk Diklik', 'Tingkat Konversi (Pesanan yang Dibuat)',
      'repeat order', 'Pengunjung Produk (Kunjungan)',
    ];
    const aoa = [header, ['P1', 'V1', 'SKU1', '100000', '90000', '500', '50', '10%', '2', '400']];
    const buf = await zipkan([{ nama: 'parent_sku.xlsx', isi: xlsxDariAoa(aoa) }]);

    const res = await POST(req(owner, `?client_platform_id=${cpId}`, buf));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      client_platform_id: cpId,
      platform: 'shopee',
      identitas: { status: 'tidak_dapat_divalidasi' },
      // shopee_parent_sku tidak membawa preamble/tanggal (Rule 5 — berkas ini
      // akan MEWARISI periode batch, bukan sumbernya) — satu-satunya berkas
      // 'ok' di batch ini tidak membawa periode terbaca sama sekali ⇒ tolak.
      periode: { status: 'tolak' },
    });
    expect(body.berkas).toHaveLength(1);
    expect(body.berkas[0]).toMatchObject({ nama: 'parent_sku.xlsx', modul_kode: 'shopee_parent_sku', status: 'ok', pesan: null });
    expect(body.module_options.some((m: { kode: string }) => m.kode === 'shopee_parent_sku')).toBe(true);
  });
});
