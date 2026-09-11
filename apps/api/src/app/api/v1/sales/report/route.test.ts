/**
 * Laporan Penjualan (pemilik 2026-09-10, Bagian 3) — `GET /sales/report` dan
 * `GET /sales/report/export`.
 *
 * Matriks izin berjalan TANPA `DATABASE_URL`: gerbang `canViewSalesReport`
 * diperiksa sebelum `readAsActor` menyentuh basis data, jadi penolakannya
 * tidak butuh Postgres. Kasus 200 butuh Postgres sungguhan (dilewati tanpa
 * `DATABASE_URL`, konvensi yang sama dengan suite RLS di `packages/domain`).
 *
 * Yang dijaga di sini dan tidak bisa dijaga di lapisan domain:
 *
 *  1. **Finance 200 di sini, 403 di `/sales/performance`.** Dua rute, dua
 *     gerbang — kalau keduanya menyatu, Finance mulai melihat kolom corong
 *     yang RLS-nya potong jadi nol dan halaman itu berbohong dengan tenang.
 *  2. **Berkas ekspor = tabel yang sedang dilihat.** Gerbang dan filter yang
 *     sama, dibaca lewat `readAsActor` yang sama.
 *  3. **Baris TOTAL ada DI DALAM berkasnya**, dengan angka server — bukan
 *     hasil menjumlahkan kolom di atasnya.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { GET as GET_REPORT } from './route';
import { GET as GET_EXPORT, renderSalesReportCsv } from './export/route';
import { GET as GET_PERF } from '../performance/route';

const SECRET = 'test-jwt-secret-sales-report';
const prevSecret = process.env.SUPABASE_JWT_SECRET;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(c: { employeeId: string; division: string; level: string; od?: boolean; director?: boolean }): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: {
      employee_id: c.employeeId, division: c.division, level: c.level,
      od: c.od ?? false, director: c.director ?? false,
    },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function req(path: string, token: string, qs = ''): Request {
  return new Request(`http://localhost/api/v1${path}${qs}`, { headers: { authorization: `Bearer ${token}` } });
}

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = prevSecret;
});

const financeStaff = sign({ employeeId: 'ZZ-RPT-FIN', division: 'Finance', level: 'staff' });
const financeLead = sign({ employeeId: 'ZZ-RPT-FINL', division: 'Finance', level: 'lead' });
const creativeLead = sign({ employeeId: 'ZZ-RPT-CRE', division: 'Creative', level: 'lead' });
const marketing = sign({ employeeId: 'ZZ-RPT-MKT', division: 'Marketing', level: 'staff' });

describe('GET /sales/report — matriks izin (tanpa DB)', () => {
  it('divisi yang tidak diminta pemilik -> 403', async () => {
    expect((await GET_REPORT(req('/sales/report', creativeLead))).status).toBe(403);
    expect((await GET_REPORT(req('/sales/report', marketing))).status).toBe(403);
  });

  it('tanpa token -> 401, bukan 403 (bentuk kegagalan yang berbeda)', async () => {
    expect((await GET_REPORT(new Request('http://localhost/api/v1/sales/report'))).status).toBe(401);
    expect((await GET_EXPORT(new Request('http://localhost/api/v1/sales/report/export'))).status).toBe(401);
  });

  it('ekspor memakai gerbang yang SAMA — tidak ada pintu belakang lewat berkas', async () => {
    expect((await GET_EXPORT(req('/sales/report/export', creativeLead))).status).toBe(403);
    expect((await GET_EXPORT(req('/sales/report/export', marketing))).status).toBe(403);
  });
});

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const SLS = 'ZZRPT-SLS';
const CLI = 'CLI-ZZRPT-1';
const CTR = 'CTR-ZZRPT-1';
const TRX = 'TRX-ZZRPT-1';
const SVC = 'SVC-ZZRPT-1';

describeDb('GET /sales/report + /export — DB sungguhan', () => {
  beforeAll(async () => {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${SLS}, 'ZZRPT Sales', 'zzrpt@example.test', 'SALES', 'SALES JASA', true, 'SYSTEM')
      on conflict (employee_id) do nothing`;
    await sql`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('SALES', 'SALES JASA', 'Sales', 'staff', 'SYSTEM')
      on conflict (divisi, jabatan) do nothing`;
    await sql`
      insert into clients (id, nama_pic, toko, kota, kategori, link_toko, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, transaction_id, created_at, created_by)
      values (${CLI}, 'PIC', 'ZZRPT; Toko', 'Jakarta', 'Fashion', 'https://x.example', '0.00', '0.00',
              ${SLS}, ${SLS}, ${TRX}, '2026-06-10 02:00:00+00', ${SLS})
      on conflict (id) do nothing`;
    await sql`
      insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, jenis, created_at, created_by)
      values (${CTR}, ${CLI}, 3, '2026-06-10', '2026-09-10', 'baru', '2026-06-10 02:00:00+00', ${SLS})
      on conflict (id) do nothing`;
    await sql`
      insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_at, created_by)
      values (${TRX}, ${CLI}, '[Lunas]', '5000000.00', '[Menunggu Verifikasi]', '2026-06-10 02:00:00+00', ${SLS})
      on conflict (id) do nothing`;
    await sql`
      insert into services (id, client_id, contract_id, master_service_id, master_version_no, name,
                            standard_price, commission_rule, status, created_by)
      values (${SVC}, ${CLI}, ${CTR}, 'MSV-ZZRPT', 1, 'ZZRPT; Layanan', '5000000.00',
              '10% of standard price', '[Ongoing]', ${SLS})
      on conflict (id) do nothing`;
    await sql`
      insert into client_sales_allocations (client_id, salesperson_id, basis_points, created_by)
      values (${CLI}, ${SLS}, 10000, ${SLS})
      on conflict (client_id, salesperson_id) do nothing`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from client_sales_allocations where client_id = ${CLI}`;
    await sql`delete from services where id = ${SVC}`;
    await sql`delete from transactions where id = ${TRX}`;
    await sql`delete from contracts where id = ${CTR}`;
    await sql`delete from clients where id = ${CLI}`;
    await sql`delete from role_mappings where divisi = 'SALES' and jabatan = 'SALES JASA'`;
    await sql`delete from employees where employee_id = ${SLS}`;
    await sql.end();
  });

  it('Finance 200 di laporan, 403 di /sales/performance — dua gerbang, sengaja', async () => {
    const res = await GET_REPORT(req('/sales/report', financeStaff, '?from=2026-06&to=2026-06'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { rows: { salesperson_id: string; total_deal: number; omzet_idr: string }[]; total: { total_deal: number; omzet: string }; services: { master_service_id: string }[] } };
    const row = body.data.rows.find((r) => r.salesperson_id === SLS);
    expect(row).toBeDefined();
    expect(row!.total_deal).toBe(1);
    expect(row!.omzet_idr).toBe('Rp. 5.000.000,00');
    expect(body.data.services.some((s) => s.master_service_id === 'MSV-ZZRPT')).toBe(true);

    // Corong prospek tetap tertutup untuk Finance — inilah kenapa laporannya
    // punya gerbang sendiri, bukan pelebaran `canViewSalesPerf`.
    expect((await GET_PERF(req('/sales/performance', financeStaff))).status).toBe(403);
    expect((await GET_PERF(req('/sales/performance', financeLead))).status).toBe(403);
  });

  it('ekspor: 200 text/csv ber-BOM, `;` sebagai pemisah, dan baris TOTAL ada di dalamnya', async () => {
    const res = await GET_EXPORT(req('/sales/report/export', financeLead, '?from=2026-06&to=2026-06'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="laporan-penjualan-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    // BOM diperiksa pada BYTE mentah: `.text()` membuangnya diam-diam, jadi
    // pemeriksaan lewat string akan lolos walau rute-nya lupa memasangnya.
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const lines = (await res.text()).split('\r\n');
    expect(lines[0]).toBe('Laporan Penjualan — per Sales');
    expect(lines[1]).toBe('salesperson_id;nama;level_sales;total_deal;klien_baru;klien_perpanjangan;klien_cross_sell;klien_count;omzet;komisi_kontrak;komisi_diakui');
    expect(lines.some((l) => l.startsWith(`${SLS};`))).toBe(true);
    const total = lines.find((l) => l.startsWith('TOTAL;'));
    expect(total).toBeDefined();
    expect(total).toContain('5000000.00');
    expect(lines).toContain('Rekap Layanan Terjual');
    // `;` di dalam nama layanan memaksa pengutipan — bukti `lib/csv.ts` benar
    // terpasang, bukan sekadar ada di repo.
    expect(lines.some((l) => l.includes('"ZZRPT; Layanan"'))).toBe(true);
  });

  it('berkas dan layar memakai filter yang sama — periode di luar jangkauan mengosongkan keduanya', async () => {
    const res = await GET_REPORT(req('/sales/report', financeStaff, '?from=2026-01&to=2026-01'));
    const body = await res.json() as { data: { total: { total_deal: number; omzet: string }; services: unknown[] } };
    expect(body.data.total.total_deal).toBe(0);
    expect(body.data.total.omzet).toBe('0.00');
    expect(body.data.services).toEqual([]);

    const csv = await (await GET_EXPORT(req('/sales/report/export', financeStaff, '?from=2026-01&to=2026-01'))).text();
    expect(csv).not.toContain('MSV-ZZRPT');
  });
});

describe('renderSalesReportCsv — baris TOTAL tidak pernah dihitung dari kolom di atasnya', () => {
  it('memakai angka server apa adanya, walau berbeda dari Σ kolom', async () => {
    // Sengaja tidak konsisten: dua orang masing-masing `total_deal: 1`, tapi
    // server melaporkan `total.total_deal: 1` karena deal-nya SATU, dijual
    // berdua. Kalau suatu hari penulis CSV mulai menjumlahkan kolom, angka di
    // berkas berubah jadi 2 dan tes ini yang memerah lebih dulu.
    const csv = renderSalesReportCsv({
      rows: [
        { salespersonId: 'A', nama: 'Aa', levelSales: 'Junior', totalDeal: 1, klienBaru: '0.60', klienPerpanjangan: '0.00', klienCrossSell: '0.00', klienCount: '0.60', omzet: '600.00', omzetIdr: 'Rp. 600,00', komisiKontrak: '0.00', komisiKontrakIdr: 'Rp. 0,00', komisiDiakui: '0.00', komisiDiakuiIdr: 'Rp. 0,00' },
        { salespersonId: 'B', nama: 'Bb', levelSales: 'Head', totalDeal: 1, klienBaru: '0.40', klienPerpanjangan: '0.00', klienCrossSell: '0.00', klienCount: '0.40', omzet: '400.00', omzetIdr: 'Rp. 400,00', komisiKontrak: '0.00', komisiKontrakIdr: 'Rp. 0,00', komisiDiakui: '0.00', komisiDiakuiIdr: 'Rp. 0,00' },
      ],
      total: {
        salespersonCount: 2, totalDeal: 1, klienCount: 1,
        omzet: '1000.00', omzetIdr: 'Rp. 1.000,00',
        komisiKontrak: '0.00', komisiKontrakIdr: 'Rp. 0,00',
        komisiDiakui: '0.00', komisiDiakuiIdr: 'Rp. 0,00',
      },
      services: [{ masterServiceId: 'MS-1', nama: 'Satu', jumlah: 1, nilai: '1000.00', nilaiIdr: 'Rp. 1.000,00' }],
    });
    const total = csv.split('\r\n').find((l) => l.startsWith('TOTAL;'))!;
    expect(total).toBe('TOTAL;2 sales;;1;;;;1;1000.00;0.00;0.00');
  });
});
