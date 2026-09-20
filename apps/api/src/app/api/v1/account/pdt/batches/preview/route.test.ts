/**
 * POST /api/v1/account/pdt/batches/preview (G1-09 + G1-09-BODY-BESAR) — route
 * wiring: auth, `client_platform_id`/`storage_path`, unduh dari Storage
 * (service-role, `unduhPdtRawObjek`), pagar paket (Rule 42), dan bentuk wire
 * (snake_case, `null` eksplisit). Cakupan per-baris/identitas/periode yang
 * lebih dalam ada di `packages/domain/src/pdt.test.ts` (`previewUploadBatch`
 * langsung) — di sini cukup bukti bahwa route SUNGGUHAN menyambungkannya
 * (bukan lagi hanya dipanggil dari tes, PDT_BACKLOG.md G1-09).
 *
 * Sejak G1-09-BODY-BESAR (`docs/DECISIONS.md` 2026-09-13) body TIDAK LAGI
 * bytes ZIP mentah — route mengunduh ZIP dari bucket `pdt-raw` SENDIRI lewat
 * `unduhPdtRawObjek` (`@/lib/pdt-storage`). Di sini `globalThis.fetch`
 * DISUNTIK (disimpan/dipulihkan tiap tes) untuk mensimulasikan respons
 * Storage tanpa jaringan/kredensial sungguhan — pola sama
 * `pdt-storage.test.ts` (`fetchImpl`), hanya saja route.ts sendiri tidak
 * menerima parameter DI (kontrak Next.js `POST(request)` tetap), jadi seam-
 * nya di `fetch` global, bukan argumen fungsi.
 *
 * Permission/400 (client_platform_id/storage_path hilang, pagar paket
 * menolak) berjalan TANPA `DATABASE_URL` (pola sama `leads/export/route.test.ts`)
 * — keduanya gagal sebelum database tersentuh sama sekali kecuali disebut
 * lain. Jalur 200/403/404 butuh Postgres nyata (di-skip tanpa `DATABASE_URL`).
 */
import { createHmac } from 'node:crypto';
import { ZipFile } from 'yazl';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createClient, type Sql } from '@cdps/db';
import { POST } from './route';

const SECRET = 'test-jwt-secret-pdt-preview';
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

function req(token: string, body: { client_platform_id?: unknown; storage_path?: unknown }): Request {
  return new Request('http://localhost/api/v1/account/pdt/batches/preview', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Objek staging bertuah — dipakai apa adanya oleh seluruh tes di berkas ini kecuali disebut lain (isi buffernya yang membedakan skenario). */
const STORAGE_PATH = '_staging/CLI-PDTRT/1/abc.zip';

/** Menyuntik `globalThis.fetch` supaya `unduhPdtRawObjek` (dipanggil route) mengembalikan `buf` tanpa jaringan sungguhan. */
function stubStorageDownload(buf: Buffer | null, status = 200): void {
  globalThis.fetch = (async () => new Response((buf ?? undefined) as unknown as BodyInit, { status })) as typeof fetch;
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
beforeEach(() => { stubStorageDownload(Buffer.from('')); });
afterEach(() => { globalThis.fetch = prevFetch; });

const owner = sign({ employeeId: 'ZZ-PDTRT-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTRT-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('POST /pdt/batches/preview — gagal sebelum Storage/DB tersentuh', () => {
  it('client_platform_id hilang ⇒ 400', async () => {
    const res = await POST(req(owner, { storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
  });

  it('client_platform_id bukan integer positif ⇒ 400', async () => {
    const res = await POST(req(owner, { client_platform_id: 'abc', storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
  });

  it('storage_path hilang ⇒ 400', async () => {
    const res = await POST(req(owner, { client_platform_id: 1 }));
    expect(res.status).toBe(400);
  });
});

describe('POST /pdt/batches/preview — gagal setelah unduh Storage (G1-09-BODY-BESAR)', () => {
  it('objek Storage tidak ditemukan (path kedaluwarsa/salah) ⇒ 400 BI, bukan 500', async () => {
    stubStorageDownload(null, 404);
    const res = await POST(req(owner, { client_platform_id: 1, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[berkas yang diunggah tidak ditemukan di penyimpanan sementara, unggah ulang]');
  });

  it('badan objek bukan ZIP sama sekali (berkas salah/rusak) ⇒ 400, bukan 500', async () => {
    stubStorageDownload(Buffer.from('bukan zip sama sekali'));
    const res = await POST(req(owner, { client_platform_id: 1, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('[berkas yang diunggah bukan paket ZIP yang valid]');
  });

  it('paket ZIP > 40 entri ⇒ 400 dengan pesan Rule 42 (pagar, sebelum satu entri pun dibaca)', async () => {
    const entries = Array.from({ length: 41 }, (_, i) => ({ nama: `f${i}.xlsx`, isi: Buffer.from('x') }));
    stubStorageDownload(await zipkan(entries));
    const res = await POST(req(owner, { client_platform_id: 1, storage_path: STORAGE_PATH }));
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
  // Prefix client_id ('CLI-PDTRT-'), BUKAN created_by ('ZZ-TEST' generik) —
  // apps/api/route.test.ts lain (mis. upload-url/route.test.ts) memakai
  // literal created_by yang SAMA dan berjalan BERSAMAAN (vitest paralel
  // antar-berkas), jadi cleanup ber-created_by bisa menghapus baris berkas
  // lain yang sedang dipakai (FK violation) — lihat komentar sama di sana.
  await sql`delete from client_platforms where client_id like 'CLI-PDTRT-%'`;
  await sql`delete from clients where id like 'CLI-PDTRT-%'`;
});

describeDb('POST /pdt/batches/preview — real DB', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    stubStorageDownload(await zipkan([]));
    const res = await POST(req(owner, { client_platform_id: 999999999, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRT-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    stubStorageDownload(await zipkan([]));
    const res = await POST(req(otherAm, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(403);
  });

  /** Sepuluh kolom WAJIB `shopee_parent_sku` + lima kolom opsional B33-PARENT-SKU. */
  const HEADER_PARENT_SKU_LENGKAP = [
    'Kode Produk', 'Kode Variasi', 'SKU Induk',
    'Total Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)',
    'Jumlah Produk Dilihat', 'Produk Diklik', 'Tingkat Konversi (Pesanan yang Dibuat)',
    'repeat order', 'Pengunjung Produk (Kunjungan)',
    'Produk', 'Produk (Pesanan Dibuat)', 'Produk (Pesanan Siap Dikirim)',
    'Pesanan Dibuat', 'Pesanan Siap Dikirim',
  ];
  const BARIS_PARENT_LENGKAP = [
    'P1', 'V1', 'SKU1', '100000', '90000', '500', '50', '10%', '2', '400',
    'Produk Satu', '12', '11', '9', '8',
  ];

  it('200: ZIP sungguhan ⇒ tabel hasil deteksi wire snake_case, kunci eksplisit', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRT-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    // Header LENGKAP (termasuk lima kolom B33-PARENT-SKU) — tes ini menguji
    // BENTUK wire, jadi berkasnya harus utuh supaya `status`/`pesan` tidak
    // ikut menguji kebijakan kolom. Kebijakannya diuji tes berikutnya.
    const aoa = [HEADER_PARENT_SKU_LENGKAP, BARIS_PARENT_LENGKAP];
    stubStorageDownload(await zipkan([{ nama: 'parent_sku.xlsx', isi: xlsxDariAoa(aoa) }]));

    const res = await POST(req(owner, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
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

  // B33-PARENT-SKU: kelima kolom baru OPSIONAL, bukan wajib. Ekspor lama yang
  // tidak membawanya TETAP dipakai — turun ke `sebagian` dengan pesan yang
  // menyebut kolomnya, bukan `gagal` yang membuang berkasnya dan ikut
  // menggagalkan pasangan rekonsiliasi Shopee seluruh batch.
  it("200: parent SKU tanpa lima kolom B33 ⇒ `sebagian` yang menyebut kolomnya, BUKAN `gagal`", async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTRT-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const lama = HEADER_PARENT_SKU_LENGKAP.slice(0, 10);
    const aoa = [lama, BARIS_PARENT_LENGKAP.slice(0, 10)];
    stubStorageDownload(await zipkan([{ nama: 'parent_sku.xlsx', isi: xlsxDariAoa(aoa) }]));

    const res = await POST(req(owner, { client_platform_id: cpId, storage_path: STORAGE_PATH }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.berkas[0]).toMatchObject({ modul_kode: 'shopee_parent_sku', status: 'sebagian' });
    expect(body.berkas[0].pesan).toContain("'Produk (Pesanan Siap Dikirim)'");
    expect(body.berkas[0].status).not.toBe('gagal');
  });
});
