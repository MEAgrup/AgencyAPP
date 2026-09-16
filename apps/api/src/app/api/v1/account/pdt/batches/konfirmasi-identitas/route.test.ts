/**
 * POST /api/v1/account/pdt/batches/konfirmasi-identitas
 * (G1-09-KONFIRMASI-IDENTITAS) — route wiring: auth, `batch_id`,
 * `pdt.konfirmasiIdentitasBatch` (mengikat identitas, gerbang
 * `canUploadBatch`), lalu reparse LANGSUNG (unduh Storage, G1-04/05,
 * `pdt.reparsePdtBatch`). Cakupan permission/guard yang lebih dalam ada di
 * `packages/domain/src/pdt.test.ts` (`konfirmasiIdentitasBatch` langsung) —
 * di sini cukup bukti bahwa route SUNGGUHAN menyambungkan seluruhnya
 * (termasuk reparse-setelah-konfirmasi), pola sama `batches/route.test.ts`.
 *
 * `globalThis.fetch` DISUNTIK (pola sama `batches/route.test.ts`) — dipakai
 * DUA kali dalam satu skenario sukses: sekali oleh route commit (`POST
 * /pdt/batches`, diimpor langsung dan dipanggil dulu untuk membentuk batch
 * `identitas_belum_terikat` sungguhan), sekali lagi oleh route ini sendiri
 * saat reparse mengunduh balik ZIP yang SAMA dari path final.
 */
import { createHmac } from 'node:crypto';
import { ZipFile } from 'yazl';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { POST } from './route';
import { POST as COMMIT } from '../route';

const SECRET = 'test-jwt-secret-pdt-konfirmasi-identitas';
const prevSecret = process.env.SUPABASE_JWT_SECRET;
const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const prevServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const prevFetch = globalThis.fetch;

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

function req(token: string, body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/v1/account/pdt/batches/konfirmasi-identitas', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function reqCommit(token: string, body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/v1/account/pdt/batches', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const STORAGE_PATH = '_staging/CLI-PDTKI/1/abc.zip';

/** GET (unduh, dipakai KEDUA route ini) → `buf` yang SAMA setiap kali; POST (unggah) → selalu 200 OK. Pola sama `batches/route.test.ts`. */
function stubStorage(buf: Buffer): void {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(null, { status: 200 });
    return new Response(buf as unknown as BodyInit, { status: 200 });
  }) as typeof fetch;
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

/** tt_video — sama fixture `batches/route.test.ts` (Rentang Tanggal preamble, header baris 3). */
function ttVideoXlsxAoa(idKreator: string, rentang: string): unknown[][] {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
  return [
    [`Rentang Tanggal: ${rentang}`], [],
    header,
    [idKreator, 'V1', '01/07/2026', 'Produk A', '100', '10', '2', '5', 'Kreator A', 'info', '1000', '50000'],
  ];
}

async function ttVideoZip(idKreator: string): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(ttVideoXlsxAoa(idKreator, '01/07/2026 - 31/07/2026'));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return zipkan([{ nama: 'tt_video.xlsx', isi: xlsxBuf }]);
}

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = prevSecret;
  if (prevSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
  if (prevServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceRoleKey;
});
afterEach(() => { globalThis.fetch = prevFetch; });

const owner = sign({ employeeId: 'ZZ-PDTKI-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTKI-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('POST /pdt/batches/konfirmasi-identitas — gagal sebelum DB tersentuh', () => {
  it('batch_id hilang ⇒ 400', async () => {
    const res = await POST(req(owner, {}));
    expect(res.status).toBe(400);
  });

  it('batch_id bukan integer positif ⇒ 400', async () => {
    const res = await POST(req(owner, { batch_id: -1 }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — pola fixture sama
// `batches/route.test.ts`, prefix 'ZZ-PDTKI-'/'CLI-PDTKI-'.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const nextClientId = (): string => `CLI-PDTKI-${Date.now() % 100000}-${seq++}`;

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
  return Number(rows[0].id);
}

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values ('ZZ-PDTKI-AM', 'AM Uji Konfirmasi Identitas', 'zz-pdtki-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = 'ZZ-PDTKI-AM'`;
  await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_file where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-PDTKI-%')`;
  await sql`delete from pdt_fact_content where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-PDTKI-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-PDTKI-%'`;
  await sql`delete from client_platforms where client_id like 'CLI-PDTKI-%'`;
  await sql`delete from clients where id like 'CLI-PDTKI-%'`;
});

describeDb('POST /pdt/batches/konfirmasi-identitas — real DB', () => {
  it('404 pada batch_id yang tidak ada', async () => {
    const res = await POST(req(owner, { batch_id: 999999999 }));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKI-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    stubStorage(await ttVideoZip('kreator-a'));
    const resCommit = await COMMIT(reqCommit(owner, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
    const bodyCommit = await resCommit.json();
    expect(bodyCommit.status).toBe('identitas_belum_terikat');

    const res = await POST(req(otherAm, { batch_id: bodyCommit.batch_id }));
    expect(res.status).toBe(403);
  });

  it('400 saat batch bukan identitas_belum_terikat (mis. sudah verified)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKI-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    await sql`update client_platforms set akun_konten_toko = '["kreator-a"]'::jsonb where id = ${cpId}`;
    stubStorage(await ttVideoZip('kreator-a'));
    const resCommit = await COMMIT(reqCommit(owner, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
    const bodyCommit = await resCommit.json();
    expect(bodyCommit.status).toBe('parsing'); // identitas cocok — bukan identitas_belum_terikat

    const res = await POST(req(owner, { batch_id: bodyCommit.batch_id }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[batch ini tidak sedang menunggu konfirmasi identitas]');
  });

  it('200: mengikat akun_konten_toko + reparse langsung ⇒ status_setelah_reparse terisi, batch pindah dari identitas_belum_terikat', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTKI-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const zipBuf = await ttVideoZip('kreator-a');
    stubStorage(zipBuf);

    const resCommit = await COMMIT(reqCommit(owner, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
    const bodyCommit = await resCommit.json();
    expect(bodyCommit.status).toBe('identitas_belum_terikat');
    expect(bodyCommit.identitas).toMatchObject({ status: 'usulkan_ikat', usulan: 'kreator-a' });

    // Route ini mengunduh balik ZIP yang SAMA dari path FINAL (bukan staging) untuk reparse —
    // stub tetap membalas buffer yang sama pada GET apa pun, pola sama batches/route.test.ts.
    stubStorage(zipBuf);
    const res = await POST(req(owner, { batch_id: bodyCommit.batch_id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      batch_id: bodyCommit.batch_id,
      client_platform_id: cpId,
      platform: 'tiktok',
      nilai_diikat: 'kreator-a',
      status_setelah_reparse: 'parsing', // sama seperti commit dengan akun_konten_toko sudah cocok (lihat batches/route.test.ts)
    });

    const cp = await sql<{ akun_konten_toko: string[] }[]>`select akun_konten_toko from client_platforms where id = ${cpId}`;
    expect(cp[0].akun_konten_toko).toEqual(['kreator-a']);

    const batchRow = await sql<{ status: string }[]>`select status from pdt_upload_batch where id = ${bodyCommit.batch_id}`;
    expect(batchRow[0].status).toBe('parsing');

    const audit = await sql<{ n: string }[]>`
      select count(*) as n from audit_log
       where entity_type = 'client_platforms' and entity_id = ${String(cpId)}
         and action = 'pdt_identitas_dikonfirmasi'`;
    expect(Number(audit[0].n)).toBe(1);
  });
});
