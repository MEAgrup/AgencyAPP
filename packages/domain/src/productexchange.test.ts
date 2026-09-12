/**
 * Tests for PX-M2a (Product Exchange — Shop ID Gate & Eligibility Policy).
 *
 * - Unit: the two permission predicates, 5-role convention (staff / lead / OD /
 *   Director / staff+OD layered), matching `showcase.test.ts` /
 *   `packages/core/src/permission.test.ts`.
 * - Integration (skipped unless DATABASE_URL is set): `px_eligibility_policy`
 *   append-only behavior (UPDATE/DELETE rejected by trigger, active version =
 *   highest `aktif`, a new version never mutates an older one) and
 *   `isiShopId`'s ownership gate. Ids namespaced `ZPX-`; afterEach deletes what
 *   it made.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import type { Actor } from './account';
import {
  activeEligibilityPolicy,
  canIsiShopId,
  canKelolaPolicy,
  createEligibilityPolicy,
  ForbiddenError,
  isiShopId,
  listEligibilityPolicy,
  NotFoundError,
  ValidationError,
} from './productexchange';

// ---------------------------------------------------------------------------
// Aktor
// ---------------------------------------------------------------------------
const OWNER = 'ZPX-AM';
const am = (id = OWNER): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const otherAm = (): Actor => ({ employeeId: 'ZPX-AM-LAIN', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (): Actor => ({ employeeId: 'ZPX-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = (): Actor => ({ employeeId: 'ZPX-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = (): Actor => ({ employeeId: 'ZPX-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
const staffOd = (): Actor => ({ employeeId: 'ZPX-SOD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
const sales = (): Actor => ({ employeeId: 'ZPX-SALES', role: permission.makeRole({ division: 'Sales', level: 'staff' }) });

// ---------------------------------------------------------------------------
// Permission predicates — murni, 5 kasus peran
// ---------------------------------------------------------------------------
describe('canKelolaPolicy — Director SAJA (preseden adsscanner_benchmark)', () => {
  it('staff (bukan pemilik apa pun) ditolak', () => {
    expect(canKelolaPolicy(am())).toBe(false);
  });
  it('lead Account ditolak — BUKAN pola OD-baca/Director-tulis biasa', () => {
    expect(canKelolaPolicy(accountLead())).toBe(false);
  });
  it('OD murni ditolak — kalibrasi ini menggerakkan gerbang uang M3', () => {
    expect(canKelolaPolicy(od())).toBe(false);
  });
  it('Director diterima', () => {
    expect(canKelolaPolicy(director())).toBe(true);
  });
  it('staff+OD berlapis TIDAK mendapat hak dari OD-nya', () => {
    expect(canKelolaPolicy(staffOd())).toBe(false);
  });
});

describe('canIsiShopId — lead Account (Director terbawa) ATAU AM pemilik klien', () => {
  it('staff BUKAN pemilik ditolak', () => {
    expect(canIsiShopId(otherAm(), OWNER)).toBe(false);
  });
  it('lead Account diterima untuk klien siapa pun', () => {
    expect(canIsiShopId(accountLead(), OWNER)).toBe(true);
    expect(canIsiShopId(accountLead(), 'siapa-pun-yang-lain')).toBe(true);
  });
  it('OD murni ditolak — bukan pemilik dan bukan lead', () => {
    expect(canIsiShopId(od(), OWNER)).toBe(false);
  });
  it('Director diterima (permission.isLead membawa Director)', () => {
    expect(canIsiShopId(director(), OWNER)).toBe(true);
  });
  it('staff+OD berlapis diterima HANYA kalau ia pemiliknya sendiri', () => {
    const pemilikOd: Actor = { employeeId: 'ZPX-SOD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) };
    expect(canIsiShopId(pemilikOd, 'ZPX-SOD')).toBe(true);
    expect(canIsiShopId(pemilikOd, OWNER)).toBe(false);
  });
  it('AM pemilik klien sendiri diterima', () => {
    expect(canIsiShopId(am(), OWNER)).toBe(true);
  });
  it('client tanpa AM (ownerAm null) hanya lolos lewat lead/Director', () => {
    expect(canIsiShopId(am(), null)).toBe(false);
    expect(canIsiShopId(accountLead(), null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

async function seedClient(opts: { am?: string | null } = {}): Promise<{ clientId: string; platformId: number }> {
  seq += 1;
  const id = `ZPX-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${id}, 'Rani', ${'Toko ' + id}, 'Bandung', 'https://shopee.co.id/x',
            'Home Living', 0, 0, 0, 'ZPX-SALES', 'ZPX-SALES',
            ${opts.am === undefined ? OWNER : opts.am}, now(), ${OWNER})`;
  const rows = await sql<{ id: string }[]>`
    insert into client_platforms (client_id, platform, active, created_by)
    values (${id}, 'TikTok Shop', true, ${OWNER}) returning id`;
  return { clientId: id, platformId: Number(rows[0].id) };
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from client_platforms where client_id like 'ZPX-CLI-%'`;
  await sql`delete from clients where id like 'ZPX-CLI-%'`;
  // px_eligibility_policy versions created by tests below (versi > 1 — versi 1
  // is the migration seed and must survive every run). Trigger disabled as
  // owner superuser and restored in `finally` — a failed cleanup must never
  // leave the table writable for the next test, same pattern as showcase.test.ts.
  await sql`alter table px_eligibility_policy disable trigger trg_px_eligibility_policy_frozen`;
  try {
    await sql`delete from px_eligibility_policy where versi > 1`;
  } finally {
    await sql`alter table px_eligibility_policy enable trigger trg_px_eligibility_policy_frozen`;
  }
});
afterAll(async () => { if (sql) await sql.end(); });

const NILAI_V1 = {
  sales_threshold_idr: 200_000_000,
  threshold_basis: 'per_sku',
  threshold_window_days: 30,
  commission_floor_pct: null,
  require_stock_in: true,
  platforms: ['tiktok'],
};

describeDb('px_eligibility_policy — append-only, versi aktif = versi tertinggi aktif', () => {
  it('seed versi 1 sudah ada dan Director bisa membacanya', async () => {
    const rows = await listEligibilityPolicy(sql, director());
    const v1 = rows.find((r) => r.versi === 1);
    expect(v1).toBeDefined();
    expect(v1?.nilai.salesThresholdIdr).toBe(200_000_000);
    expect(v1?.nilai.commissionFloorPct).toBeNull();
  });

  it('non-Director (termasuk OD murni dan lead Account) ditolak baca maupun tulis', async () => {
    await expect(listEligibilityPolicy(sql, od())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listEligibilityPolicy(sql, accountLead())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createEligibilityPolicy(sql, accountLead(), { nilai: NILAI_V1, catatan: 'coba' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('catatan kosong ditolak; bentuk nilai yang salah ditolak', async () => {
    await expect(createEligibilityPolicy(sql, director(), { nilai: NILAI_V1, catatan: '  ' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createEligibilityPolicy(sql, director(), { nilai: { foo: 'bar' }, catatan: 'x' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createEligibilityPolicy(sql, director(), { nilai: null, catatan: 'x' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('Director membuat versi 2: versi 1 TIDAK berubah, versi aktif berpindah ke 2', async () => {
    const before = (await listEligibilityPolicy(sql, director())).find((r) => r.versi === 1);
    const v2 = await createEligibilityPolicy(sql, director(), {
      nilai: { ...NILAI_V1, sales_threshold_idr: 250_000_000 },
      catatan: 'Kalibrasi ulang ambang, ZPX test',
    });
    expect(v2.versi).toBe(2);
    expect(v2.nilai.salesThresholdIdr).toBe(250_000_000);

    const after = (await listEligibilityPolicy(sql, director())).find((r) => r.versi === 1);
    expect(after).toEqual(before); // versi 1 sama sekali tidak tersentuh

    const aktif = await activeEligibilityPolicy(sql);
    expect(aktif?.versi).toBe(2);
  });

  it('versi baru bisa lahir NON-aktif (draft/rollback) tanpa mengganggu versi aktif', async () => {
    await createEligibilityPolicy(sql, director(), { nilai: NILAI_V1, catatan: 'draft, ZPX test', aktif: false });
    const aktif = await activeEligibilityPolicy(sql);
    expect(aktif?.versi).toBe(1); // versi 1 tetap tertinggi yang aktif
  });

  it('UPDATE dan DELETE langsung ditolak trigger (append-only)', async () => {
    await expect(sql`update px_eligibility_policy set catatan = 'x' where versi = 1`)
      .rejects.toThrow(/append-only/);
    await expect(sql`delete from px_eligibility_policy where versi = 1`)
      .rejects.toThrow(/append-only/);
  });
});

describeDb('isiShopId — AM pemilik ATAU lead Account, TERPISAH dari canEditProfile', () => {
  it('AM pemilik klien mengisi Shop ID, diaudit', async () => {
    const { clientId, platformId } = await seedClient();
    const stored = await isiShopId(sql, am(), clientId, platformId, 'SHOP-123');
    expect(stored).toBe('SHOP-123');
    const row = await sql<{ shop_id: string | null }[]>`select shop_id from client_platforms where id = ${platformId}`;
    expect(row[0].shop_id).toBe('SHOP-123');
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_type = 'client_platform' and entity_id = ${String(platformId)} and action = 'shop_id_diisi'`;
    expect(audit[0].n).toBe(1);
  });

  it('AM LAIN (bukan pemilik) ditolak, walau ia AM sungguhan', async () => {
    const { clientId, platformId } = await seedClient();
    await expect(isiShopId(sql, otherAm(), clientId, platformId, 'SHOP-X')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lead Account mengisi Shop ID untuk klien siapa pun', async () => {
    const { clientId, platformId } = await seedClient();
    const stored = await isiShopId(sql, accountLead(), clientId, platformId, 'SHOP-999');
    expect(stored).toBe('SHOP-999');
  });

  it('mengosongkan (string kosong) mengembalikan null — status sah "belum ikut"', async () => {
    const { clientId, platformId } = await seedClient();
    await isiShopId(sql, am(), clientId, platformId, 'SHOP-123');
    const cleared = await isiShopId(sql, am(), clientId, platformId, '');
    expect(cleared).toBeNull();
  });

  it('klien yang tidak ada → 404', async () => {
    await expect(isiShopId(sql, director(), 'ZPX-CLI-TAK-ADA', 1, 'X')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('toko yang tidak ada / bukan milik klien → 404', async () => {
    const { clientId } = await seedClient();
    await expect(isiShopId(sql, director(), clientId, 999999999, 'X')).rejects.toBeInstanceOf(NotFoundError);
  });
});
