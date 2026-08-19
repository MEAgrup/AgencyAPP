/**
 * Mesin Laporan Klien (C1 bagian 2) — the domain layer: detect → score → store,
 * and the single thing that makes C1 real: writing `clients.total_sales` in the
 * 30-day run-rate unit the Health Score reads.
 *
 * Writes run as the owning superuser `sql` (RLS bypassed) — the API's db()
 * service-role path (DECISIONS O37): the TS canWrite* gate is the primary wall,
 * the DB freeze/UNIQUE the second. Pure gate tests need no DB.
 *
 * The fixtures mirror the real export shape (date-range meta row, a "Semua"
 * filter row, the header row, a "Total nilai" summary row, daily rows) with the
 * exports' exact column strings — the same shape report.test.ts uses, but passed
 * as raw AoA so the SERVER does the readSheet/detect/score (as in production).
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZR-`. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  canReadReport,
  canWriteReport,
  createReport,
  getReport,
  listReports,
  MSG_SUDAH_ADA,
  renderReport,
} from './report';
import { ConflictError, ForbiddenError } from './account';

// ---------------------------------------------------------------------------
// Pure gate unit tests (no DB)
// ---------------------------------------------------------------------------
const am = (id = 'ZZR-AM') => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = () => ({ employeeId: 'ZZR-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const creativeLead = () => ({ employeeId: 'ZZR-CRE', role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
const director = () => ({ employeeId: 'ZZR-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = () => ({ employeeId: 'ZZR-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });

describe('canWriteReport', () => {
  it('the owning AM writes their own client report', () => {
    expect(canWriteReport(am('ZZR-AM'), 'ZZR-AM')).toBe(true);
  });
  it('an Account lead / Director may write any client report', () => {
    expect(canWriteReport(accountLead(), 'ZZR-AM')).toBe(true);
    expect(canWriteReport(director(), 'ZZR-AM')).toBe(true);
  });
  it('OD is read-only — no write, even though it reads everywhere', () => {
    expect(canWriteReport(od(), 'ZZR-AM')).toBe(false);
  });
  it('a stray AM / other-division lead cannot write', () => {
    expect(canWriteReport(am('ZZR-OTHER'), 'ZZR-AM')).toBe(false);
    expect(canWriteReport(creativeLead(), 'ZZR-AM')).toBe(false);
  });
});

describe('canReadReport', () => {
  it('owner AM / Account lead / OD / Director read', () => {
    expect(canReadReport(am('ZZR-AM'), 'ZZR-AM')).toBe(true);
    expect(canReadReport(accountLead(), 'ZZR-AM')).toBe(true);
    expect(canReadReport(od(), 'ZZR-AM')).toBe(true);
    expect(canReadReport(director(), 'ZZR-AM')).toBe(true);
  });
  it('a stray AM / other-division lead cannot read', () => {
    expect(canReadReport(am('ZZR-OTHER'), 'ZZR-AM')).toBe(false);
    expect(canReadReport(creativeLead(), 'ZZR-AM')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Export fixtures (raw AoA — the server parses/scores)
// ---------------------------------------------------------------------------
const META_BULAN = 'Ringkasan Toko 2026-08-01 ~ 2026-08-31';
const META_MINGGU = 'Ringkasan Toko 2026-08-04 ~ 2026-08-10'; // 7 days

const sheetAoa = (header: unknown[], rows: unknown[][], meta: string): unknown[][] =>
  [[meta], ['Semua', 'Semua', 'Semua'], header, ...rows];

const SHOP_TT_HEADER = [
  '', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
  'AOV', 'Pembeli', 'Produk terjual', 'Impresi produk', 'Klik produk',
  'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi', 'GMV dari video akun tertaut',
];
const shopTtAoa = (meta = META_BULAN): unknown[][] => sheetAoa(SHOP_TT_HEADER, [
  ['Total nilai penjualan', 'Rp100.000.000', 'Rp10.000.000', '50.000', 'Rp5.000.000', '1.000', '2,00%',
    'Rp100.000', '900', '1.200', '500.000', '20.000', 'Rp8.000.000', 'Rp15.000.000', 'Rp12.000.000'],
  ['Perubahan persentase', '5,00%', '', '-3,00%', '', '2,00%', '', '', '', '', '', '', '', '', ''],
  ['01/08/2026', 'Rp3.000.000', '', '', '', '30', '', '', '', '', '', '', '', '', ''],
  ['02/08/2026', 'Rp4.000.000', '', '', '', '40', '', '', '', '', '', '', '', '', ''],
], meta);

const SHA = 'a'.repeat(64);
const fileFrom = (filename: string, aoa: unknown[][]) => ({ filename, aoa, sha256: SHA, ukuranBytes: 4096 });

// ---------------------------------------------------------------------------
// DB integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER = 'ZZR-AM';
const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

const actorAm = { employeeId: OWNER, role: permission.makeRole({ division: 'Account', level: 'staff' }) };
const actorStray = { employeeId: 'ZZR-OTHER', role: permission.makeRole({ division: 'Account', level: 'staff' }) };
const actorOd = { employeeId: 'ZZR-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) };

async function seedClient(): Promise<string> {
  seq += 1;
  const client = `ZZR-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${client}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZR-SALES', 'ZZR-SALES', ${OWNER}, now(), ${OWNER})`;
  return client;
}
async function seedPlatform(client: string, platform = 'TikTok Shop'): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${client}, ${platform}, 'https://tiktok.com/@alpha', true, ${OWNER}) returning id`;
  return Number(rows[0].id);
}
async function totalSalesOf(client: string): Promise<number> {
  const r = await sql<{ total_sales: string }[]>`select total_sales from clients where id = ${client}`;
  return Number(r[0].total_sales);
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from client_reports where client_id like 'ZZR-CLI-%'`; // berkas CASCADE
  await sql`delete from client_platforms where client_id like 'ZZR-CLI-%'`;
  await sql`delete from clients where id like 'ZZR-CLI-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

describeDb('createReport — score, store, and write total_sales', () => {
  it('a monthly report passes GMV through as the total_sales unit', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    expect(d.skor).not.toBeNull();
    expect(d.gmvNet).toBeGreaterThan(0);
    expect(d.periodeMulai).toBe('2026-08-01');
    expect(d.periodeAkhir).toBe('2026-08-31');
    expect(d.hariPeriode).toBe(31);
    expect(d.rentangDariBerkas).toBe(true);
    // Monthly: run-rate == net GMV (no scaling).
    expect(d.gmvRunrateBulanan).toBeCloseTo(d.gmvNet, 2);
    // clients.total_sales is written from the report — the gap C1 closes.
    expect(await totalSalesOf(client)).toBeCloseTo(d.gmvRunrateBulanan, 2);
  });

  it('a WEEKLY report writes the 30-day RUN-RATE, not the raw weekly GMV (trap #1)', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'mingguan', files: [fileFrom('toko.xlsx', shopTtAoa(META_MINGGU))],
    });
    expect(d.hariPeriode).toBe(7);
    // A weekly upload must NOT drop total_sales ~4x: the run-rate scales the
    // week up to a month (×30/7 ≈ 4.29). total_sales reads the run-rate.
    expect(d.gmvRunrateBulanan).toBeGreaterThan(d.gmvNet * 4);
    expect(d.gmvRunrateBulanan).toBeCloseTo((d.gmvNet * 30) / 7, 0);
    expect(await totalSalesOf(client)).toBeCloseTo(d.gmvRunrateBulanan, 2);
  });

  it('total_sales = Σ latest run-rate across a client\'s active platforms', async () => {
    const client = await seedClient();
    const a = await seedPlatform(client, 'TikTok Shop');
    const b = await seedPlatform(client, 'TikTok Shop 2');
    const da = await createReport(sql, actorAm, client, {
      clientPlatformId: a, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    const db = await createReport(sql, actorAm, client, {
      clientPlatformId: b, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    expect(await totalSalesOf(client)).toBeCloseTo(da.gmvRunrateBulanan + db.gmvRunrateBulanan, 2);
  });

  it('re-uploading the same toko × tipe × range is a ConflictError, never a silent overwrite', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    await expect(createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    })).rejects.toThrow(ConflictError);
    await expect(createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    })).rejects.toThrow(MSG_SUDAH_ADA);
  });

  it('refuses a report for a client the actor does not own', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await expect(createReport(sql, actorStray, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    })).rejects.toThrow(ForbiddenError);
  });

  it('rejects a missing store-analytics file with the exact BI message', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    // A product-analytics file detects unambiguously (prod_tt) — so we reach the
    // "toko wajib" gate rather than the own-vs-affiliate ambiguity guard.
    const prodOnly = sheetAoa(
      ['Nama', 'ID Produk', 'GMV', 'Klik produk', 'Impresi produk', 'CTOR (pesanan SKU)', 'Pesanan SKU', 'Produk terjual'],
      [['Produk Bintang', 'P1', 'Rp40.000.000', '900', '20.000', '3,00%', '27', '30']], META_BULAN,
    );
    await expect(createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('produk.xlsx', prodOnly)],
    })).rejects.toThrow(/Analitik Toko TikTok wajib/);
  });

  it('the stored report row is immutable (payload/GMV cannot be re-typed)', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    await expect(sql`update client_reports set gmv_net = 1 where id = ${d.id}`).rejects.toThrow(/immutable/);
  });
});

describeDb('reads — listReports / getReport / renderReport', () => {
  it('lists a client\'s reports newest-first and reads one back for OD', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    const list = await listReports(sql, actorOd, client);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(d.id);
    const full = await getReport(sql, actorOd, d.id);
    expect(full.berkas.length).toBeGreaterThan(0);
    expect(full.payload).not.toBeNull();
  });

  it('a stray AM is refused on read', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    await expect(listReports(sql, actorStray, client)).rejects.toThrow(ForbiddenError);
    await expect(getReport(sql, actorStray, d.id)).rejects.toThrow(ForbiddenError);
  });

  it('client HTML OMITS the internal remarks that internal HTML carries', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    const klien = await renderReport(sql, actorAm, d.id, 'klien');
    const internal = await renderReport(sql, actorAm, d.id, 'internal');
    expect(klien).toContain('<!DOCTYPE html>');
    // The internal page is marked as such in its title; the client page is not.
    expect(internal).toContain('Internal');
    expect(klien).not.toContain(' — Internal');
    // Internal-only score-note blocks are BUILT for internal, never for klien.
    expect(internal.length).toBeGreaterThan(klien.length);
  });
});
