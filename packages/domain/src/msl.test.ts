/**
 * Tests for the Master Service List admin + read.
 *
 * - Unit: the edit-permission matrix (pure predicate).
 * - Integration (skipped unless DATABASE_URL is set): create → immutable version
 *   chain → effective read against a migrated Postgres. Each test namespaces its
 *   actor ids with `ZZ-` and afterEach deletes the rows it made.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission, tz } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { BadCommissionRuleError } from './commission_rule';
import {
  type Actor,
  canEditMasterServices,
  createService,
  effectiveAt,
  ForbiddenError,
  IncompleteError,
  listEffectiveAt,
  listVersions,
  MSG_MASTER_SERVICE_DENIED,
  reconcileTier,
  ServiceNotFoundError,
  updateService,
} from './msl';

const salesLead = (): Actor => ({
  employeeId: 'ZZ-SLEAD', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const salesStaff = (): Actor => ({
  employeeId: 'ZZ-SSTAFF', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const director = (): Actor => ({
  employeeId: 'ZZ-DIR', role: permission.makeRole({ division: 'OD', level: 'lead', director: true }),
});

// ---------------------------------------------------------------------------
// Unit: edit-permission matrix.
// ---------------------------------------------------------------------------
describe('canEditMasterServices', () => {
  it('allows Sales Lead and Director; denies Sales staff and other divisions', () => {
    expect(canEditMasterServices(salesLead())).toBe(true);
    expect(canEditMasterServices(director())).toBe(true);
    expect(canEditMasterServices(salesStaff())).toBe(false);
    expect(canEditMasterServices({
      employeeId: 'ZZ-CLEAD', role: permission.makeRole({ division: 'Creative', level: 'lead' }),
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit: tier ↔ boolean reconciliation (O54).
//
// These assertions are the TS half of a frozen invariant: `reconcileTier` must
// stay identical to the DB trigger `normalize_plan_tier` (migration
// 20260806061000). Each case below is the same case the trigger branches on.
// ---------------------------------------------------------------------------
describe('reconcileTier', () => {
  it('forces the boolean false for ditentukan_am — the catalog never gates the middle tier', () => {
    // Even a caller that insists on true gets false: for this tier the effective
    // gate comes from `service_plan_gate`, and a true boolean here would make
    // the catalog decide something it is not allowed to decide.
    expect(reconcileTier('ditentukan_am', true)).toEqual({
      planTier: 'ditentukan_am', requiresStrategyPlan: false,
    });
    expect(reconcileTier('ditentukan_am', false)).toEqual({
      planTier: 'ditentukan_am', requiresStrategyPlan: false,
    });
  });

  it('forces the boolean true for plan_wajib', () => {
    expect(reconcileTier('plan_wajib', false)).toEqual({
      planTier: 'plan_wajib', requiresStrategyPlan: true,
    });
  });

  it('promotes a pre-M6C caller that only spoke through the boolean', () => {
    // No tier given + boolean true = a seeder/fixture written before the column
    // existed. It means plan_wajib, and must not be read as tanpa_plan.
    expect(reconcileTier(undefined, true)).toEqual({
      planTier: 'plan_wajib', requiresStrategyPlan: true,
    });
    expect(reconcileTier(undefined, false)).toEqual({
      planTier: 'tanpa_plan', requiresStrategyPlan: false,
    });
  });

  it('lets the boolean win over an explicit tanpa_plan — mirroring the trigger', () => {
    // Deliberately NOT "tanpa_plan wins". The trigger's ELSIF chain reaches the
    // boolean branch here, and TS diverging from it is exactly the drift the
    // migration calls a frozen invariant.
    expect(reconcileTier('tanpa_plan', true)).toEqual({
      planTier: 'plan_wajib', requiresStrategyPlan: true,
    });
    expect(reconcileTier('tanpa_plan', false)).toEqual({
      planTier: 'tanpa_plan', requiresStrategyPlan: false,
    });
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

const TODAY = tz.dateString(new Date());

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
});

describeDb('createService', () => {
  it('mints an MSV id + version 1, audits, and is effective-readable', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa Live Streaming Basic', standardPrice: '6900000',
      commissionRule: '10% of standard price', effectiveFrom: '2020-01-01',
      category: 'Live', unit: 'sesi', pricingMode: 'flat', active: true,
    });
    expect(id).toMatch(/^MSV-\d{6}-\d{4}$/);

    const v = await effectiveAt(sql, id, TODAY);
    expect(v.name).toBe('Jasa Live Streaming Basic');
    expect(money.parse(v.standardPrice)).toBe(money.parse('6900000'));
    expect(v.versionNo).toBe(1);

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where entity_id = ${id} and entity_type = 'master_service' and action = 'create'`;
    expect(audit[0].n).toBe(1);
  });

  it('denies a Sales staff with the verbatim BI message', async () => {
    await expect(createService(sql, salesStaff(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
    })).rejects.toThrow(MSG_MASTER_SERVICE_DENIED);
    await expect(createService(sql, salesStaff(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
    })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects incomplete / bad-mode input with the house BI message', async () => {
    // Missing commission_rule.
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: '', effectiveFrom: '2020-01-01',
    })).rejects.toBeInstanceOf(IncompleteError);
    // min_floor without a whole positive min_qty.
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
      pricingMode: 'min_floor', minQty: '2.5',
    })).rejects.toBeInstanceOf(IncompleteError);
    // An unknown tier is rejected, not silently coerced to the default — a typo
    // that quietly became `tanpa_plan` would remove the Strategi path with
    // nobody told (O54).
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
      planTier: 'wajib' as never,
    })).rejects.toBeInstanceOf(IncompleteError);
  });

  it('rejects a commission_rule the calculator cannot read (O73)', async () => {
    // The defect this test exists for: before O73 the MSL form accepted ANY
    // non-empty string, so 56 of 96 catalog versions in production were saved
    // with rules like "0" or free Indonesian prose. Nothing complained here —
    // the bill arrived later, as `module0_sales: unrecognized commission_rule`
    // in front of a salesperson whose Qualified Lead Form was filled correctly.
    // Reject at the keyboard of the person who can fix it.
    for (const bad of [
      '0',
      'komisi berdasarkan spend budget perhitungan dari omzet iklan',
      '1%-2% dari all omzet bisnis tiktok',
      '10 % of standard price',
    ]) {
      await expect(createService(sql, salesLead(), {
        name: 'x', standardPrice: '1000', commissionRule: bad, effectiveFrom: '2020-01-01',
      })).rejects.toBeInstanceOf(BadCommissionRuleError);
    }
  });

  it('refuses a bad commission_rule in the DB too, not only in TS (O73)', async () => {
    // The TS gate above is the one that produces a usable BI message, but it is
    // not the enforcer: CLAUDE.md puts the rule in the DB so psql, a seed
    // script, or a future client cannot route around it. If this INSERT ever
    // succeeds, `ck_msv_commission_rule_grammar` has been dropped and the
    // production data can rot again exactly the way it did.
    // Made through the domain first so the row has a real parent — the point is
    // the CHECK, not a foreign key firing before it.
    const id = await createService(sql, salesLead(), {
      name: 'ZZ Probe Grammar', standardPrice: '1000',
      commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
    });
    await expect(sql`
      insert into master_service_versions
        (service_id, version_no, name, standard_price, commission_rule, effective_from, created_by)
      values (${id}, 2, 'ZZ Probe Grammar', 1000, '0', DATE '2020-01-02', 'ZZ-o73')
    `).rejects.toThrow(/ck_msv_commission_rule_grammar/);
  });

  it('accepts a version whose rule is zero commission, written canonically (O73)', async () => {
    // "This service earns no commission" is a legitimate, common catalog entry
    // (37 rows had it before O73 and 44 more meant it). The gate must not make
    // it unsayable — only unsayable as a bare "0".
    const id = await createService(sql, salesLead(), {
      name: 'ZZ Jasa Tanpa Komisi', standardPrice: '12000000',
      commissionRule: '0% of standard price', effectiveFrom: '2020-01-01',
    });
    const v = await effectiveAt(sql, id, TODAY);
    expect(v.commissionRule).toBe('0% of standard price');
  });

  it('persists the tier the Sales Head chose, and the DB agrees with TS (O54)', async () => {
    // The point of this test is NOT that a string round-trips. It is that the
    // value TS computed survives `normalize_plan_tier` unchanged: if the trigger
    // and `reconcileTier` ever disagree, the row comes back with a different
    // tier than the one the Sales Head picked — or is rejected outright by
    // `ck_msv_tier_matches_flag`. Reading it back is what catches that.
    for (const tier of ['plan_wajib', 'ditentukan_am', 'tanpa_plan'] as const) {
      const id = await createService(sql, salesLead(), {
        name: `Jasa Tier ${tier}`, standardPrice: '1000000',
        commissionRule: '0% of standard price', effectiveFrom: '2020-01-01',
        planTier: tier, active: true,
      });
      const v = await effectiveAt(sql, id, TODAY);
      expect(v.planTier).toBe(tier);
      expect(v.requiresStrategyPlan).toBe(tier === 'plan_wajib');
    }
  });

  it('reads a pre-M6C caller that only set the boolean as plan_wajib', async () => {
    // Every seeder and fixture written before the tier column exists takes this
    // path. It must keep meaning what it meant.
    const id = await createService(sql, salesLead(), {
      name: 'Jasa Legacy Boolean', standardPrice: '1000000',
      commissionRule: '0% of standard price', effectiveFrom: '2020-01-01',
      requiresStrategyPlan: true, active: true,
    });
    const v = await effectiveAt(sql, id, TODAY);
    expect(v.planTier).toBe('plan_wajib');
    expect(v.requiresStrategyPlan).toBe(true);
  });
});

describeDb('updateService', () => {
  it('appends an immutable version 2 (old version still effective before its cutover)', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa A', standardPrice: '5000000', commissionRule: '10% of standard price',
      effectiveFrom: '2020-01-01', active: true,
    });
    const next = await updateService(sql, salesLead(), id, {
      name: 'Jasa A (naik harga)', standardPrice: '6000000', commissionRule: '10% of standard price',
      effectiveFrom: '2020-06-01', active: true,
    });
    expect(next).toBe(2);

    // Version chain has both, newest first; nothing was mutated in place.
    const chain = await listVersions(sql, id);
    expect(chain.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(money.parse(chain[1].standardPrice)).toBe(money.parse('5000000'));

    // Effective before the v2 cutover resolves v1; today resolves v2.
    const before = await effectiveAt(sql, id, '2020-03-01');
    expect(before.versionNo).toBe(1);
    const now = await effectiveAt(sql, id, TODAY);
    expect(now.versionNo).toBe(2);
  });

  it('throws ServiceNotFoundError for an unknown service id', async () => {
    await expect(updateService(sql, salesLead(), 'MSV-209901-9999', {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01',
    })).rejects.toBeInstanceOf(ServiceNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// durasi_bulan + qty_menambah — what the accrual engine of Gelombang D reads.
//
// The duration went untested until 2026-09-07, and the gap hid a real defect:
// the MSL admin form neither showed it nor sent it, so every "Ubah" on a service
// that HAD a duration wrote a new version with NULL. These tests pin the two
// halves of that: the value survives an edit that carries it, and both shapes of
// emptiness (undefined and null) mean the same NULL — which here reads "layanan
// sekali jadi, tidak punya periode", not "belum diisi".
// ---------------------------------------------------------------------------
describeDb('durasi_bulan', () => {
  it('persists on create and reads back as the same whole number of MONTHS', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa berdurasi', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, durasiBulan: 6, pengakuan: 'per_periode',
    });
    expect((await effectiveAt(sql, id, TODAY)).durasiBulan).toBe(6);
  });

  it('SURVIVES an update that carries it forward — the version 2 that wiped it was the bug', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'AI Video', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, durasiBulan: 1, pengakuan: 'per_periode',
    });
    await updateService(sql, salesLead(), id, {
      name: 'AI Video (harga naik)', standardPrice: '1200000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-06-01', active: true, durasiBulan: 1, pengakuan: 'per_periode',
    });
    const v2 = await effectiveAt(sql, id, TODAY);
    expect(v2.versionNo).toBe(2);
    expect(v2.durasiBulan).toBe(1);
  });

  it('an update that omits it CLEARS it — full-replace semantics, stated so no caller is surprised', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa berdurasi 2', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, durasiBulan: 6, pengakuan: 'per_periode',
    });
    await updateService(sql, salesLead(), id, {
      name: 'Jasa berdurasi 2', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-06-01', active: true,
    });
    expect((await effectiveAt(sql, id, TODAY)).durasiBulan).toBeNull();
    // …and version 1 still carries it: history is append-only, never rewritten.
    const chain = await listVersions(sql, id);
    expect(chain.find((v) => v.versionNo === 1)!.durasiBulan).toBe(6);
  });

  it('treats an explicit null exactly like an omitted key — a form payload always has the key', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa tanpa durasi', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, durasiBulan: null,
    });
    expect((await effectiveAt(sql, id, TODAY)).durasiBulan).toBeNull();
  });

  it('rejects a value that is not a duration — 0, negative, and fractional', async () => {
    for (const bad of [0, -1, 1.5]) {
      await expect(createService(sql, salesLead(), {
        name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100',
        effectiveFrom: '2020-01-01', durasiBulan: bad,
      })).rejects.toBeInstanceOf(IncompleteError);
    }
  });

  it('defaults qty_menambah to volume — the safe side, not the one that spreads revenue for years', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Nano KOL', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true,
    });
    expect((await effectiveAt(sql, id, TODAY)).qtyMenambah).toBe('volume');
  });

  it('persists qty_menambah = durasi when the service really is sold by the period', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'GMV Max', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, durasiBulan: 1, qtyMenambah: 'durasi',
      pengakuan: 'per_periode',
    });
    expect((await effectiveAt(sql, id, TODAY)).qtyMenambah).toBe('durasi');
  });

  it('REFUSES qty_menambah = durasi without a durasiBulan — qty would multiply nothing', async () => {
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', qtyMenambah: 'durasi',
    })).rejects.toBeInstanceOf(IncompleteError);
  });

  it('the DB refuses that combination too, not only TS — the CHECK is the real gate', async () => {
    // msl.ts is not the only writer of this table (seeds, migrations, a future
    // import), so the invariant has to hold at the row, not just at the route.
    const msvId = 'MSV-209912-9001';
    await sql`insert into master_services (id, created_by) values (${msvId}, 'ZZ-SLEAD')`;
    await expect(sql`
      insert into master_service_versions
        (service_id, version_no, name, standard_price, commission_rule, pricing_mode,
         durasi_bulan, qty_menambah, effective_from, created_by)
      values (${msvId}, 1, 'x', '1000', 'flat Rp 100', 'flat', null, 'durasi', '2020-01-01', 'ZZ-SLEAD')`,
    ).rejects.toThrow(/ck_msv_qty_durasi_butuh_durasi_bulan/);
  });

  it('rejects a qty_menambah that is neither durasi nor volume', async () => {
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', durasiBulan: 1, pengakuan: 'per_periode',
      qtyMenambah: 'bulanan' as never,
    })).rejects.toBeInstanceOf(IncompleteError);
  });
});

// ---------------------------------------------------------------------------
// pengakuan (D-KOM, diketok 2026-09-07 opsi a) — KAPAN pendapatan diakui.
//
// Kolom ini ada justru karena ia TIDAK bisa diturunkan dari `durasi_bulan`:
// `Komisi` dan `Jasa Pengajuan Shopee Mall` sama-sama `durasi_bulan = NULL`
// dengan arti yang berbeda. Tes di bawah memakai dua nama itu apa adanya supaya
// yang diuji adalah kasus nyata yang melahirkan kolomnya, bukan contoh karangan.
// ---------------------------------------------------------------------------
describeDb('pengakuan', () => {
  it('tanpa durasi, boleh dihilangkan dan berarti saat_selesai — satu arti, bukan tebakan', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Jasa Pengajuan Shopee Mall', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true,
    });
    expect((await effectiveAt(sql, id, TODAY)).pengakuan).toBe('saat_selesai');
  });

  it('MENOLAK layanan berdurasi yang tidak menyebut pengakuannya', async () => {
    // Layanan berdurasi bisa sah `per_periode` maupun `saat_selesai`, dan
    // menebak salah satunya diam-diam menempatkan pendapatan di bulan yang
    // salah selama berbulan-bulan. Hari ini 42 dari 42 layanan berdurasi memang
    // `per_periode` — tapi itu keadaan data, bukan aturan, dan menjadikannya
    // default berarti menurunkan `pengakuan` dari `durasi_bulan` lagi.
    await expect(createService(sql, salesLead(), {
      name: 'GMV MAX MEA PRO', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, durasiBulan: 6,
    })).rejects.toBeInstanceOf(IncompleteError);
  });

  it('Komisi menyimpan bulan_berikutnya WALAU durasinya null — arti kedua di nilai kosong yang sama', async () => {
    const komisi = await createService(sql, salesLead(), {
      name: 'Komisi', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, pengakuan: 'bulan_berikutnya',
    });
    const mall = await createService(sql, salesLead(), {
      name: 'Jasa Pengajuan Shopee Mall (2)', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, pengakuan: 'saat_selesai',
    });
    const a = await effectiveAt(sql, komisi, TODAY);
    const b = await effectiveAt(sql, mall, TODAY);
    expect(a.durasiBulan).toBeNull();
    expect(b.durasiBulan).toBeNull();
    expect(a.pengakuan).toBe('bulan_berikutnya');
    expect(b.pengakuan).toBe('saat_selesai');
  });

  it('MENOLAK per_periode tanpa durasi — tidak ada periode untuk disebari', async () => {
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', pengakuan: 'per_periode',
    })).rejects.toBeInstanceOf(IncompleteError);
  });

  it('DB juga menolak kombinasi itu, bukan hanya TS — CHECK-nya gerbang yang sebenarnya', async () => {
    // Sama alasannya dengan `ck_msv_qty_durasi_butuh_durasi_bulan`: msl.ts bukan
    // satu-satunya penulis tabel ini.
    const msvId = 'MSV-209912-9002';
    await sql`insert into master_services (id, created_by) values (${msvId}, 'ZZ-SLEAD')`;
    await expect(sql`
      insert into master_service_versions
        (service_id, version_no, name, standard_price, commission_rule, pricing_mode,
         durasi_bulan, pengakuan, effective_from, created_by)
      values (${msvId}, 1, 'x', '1000', 'flat Rp 100', 'flat', null, 'per_periode', '2020-01-01', 'ZZ-SLEAD')`,
    ).rejects.toThrow(/ck_msv_per_periode_butuh_durasi_bulan/);
  });

  it('DB menolak nilai pengakuan yang tidak ada dalam kosakata', async () => {
    const msvId = 'MSV-209912-9003';
    await sql`insert into master_services (id, created_by) values (${msvId}, 'ZZ-SLEAD')`;
    await expect(sql`
      insert into master_service_versions
        (service_id, version_no, name, standard_price, commission_rule, pricing_mode,
         durasi_bulan, pengakuan, effective_from, created_by)
      values (${msvId}, 1, 'x', '1000', 'flat Rp 100', 'flat', null, 'kapan_kapan', '2020-01-01', 'ZZ-SLEAD')`,
    ).rejects.toThrow(/ck_msv_pengakuan/);
  });

  it('menolak nilai pengakuan yang tidak dikenal di TS juga', async () => {
    await expect(createService(sql, salesLead(), {
      name: 'x', standardPrice: '1000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', pengakuan: 'kapan_kapan' as never,
    })).rejects.toBeInstanceOf(IncompleteError);
  });

  it('ikut terbawa ke versi berikutnya, dan versi lama tetap membawa nilainya sendiri', async () => {
    const id = await createService(sql, salesLead(), {
      name: 'Store Management (Paket)', standardPrice: '1000000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-01-01', active: true, durasiBulan: 1, qtyMenambah: 'durasi',
      pengakuan: 'per_periode',
    });
    await updateService(sql, salesLead(), id, {
      name: 'Store Management (Paket)', standardPrice: '1200000', commissionRule: 'flat Rp 100',
      effectiveFrom: '2020-06-01', active: true, pengakuan: 'saat_selesai',
    });
    expect((await effectiveAt(sql, id, TODAY)).pengakuan).toBe('saat_selesai');
    const chain = await listVersions(sql, id);
    expect(chain.find((v) => v.versionNo === 1)!.pengakuan).toBe('per_periode');
  });
});

describeDb('listEffectiveAt', () => {
  it('returns the newest-effective version per service', async () => {
    const a = await createService(sql, salesLead(), {
      name: 'Svc A', standardPrice: '1000000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01', active: true,
    });
    await updateService(sql, salesLead(), a, {
      name: 'Svc A v2', standardPrice: '2000000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-02-01', active: true,
    });
    const b = await createService(sql, salesLead(), {
      name: 'Svc B', standardPrice: '3000000', commissionRule: 'flat Rp 100', effectiveFrom: '2020-01-01', active: true,
    });

    const list = await listEffectiveAt(sql, TODAY);
    const mine = list.filter((v) => v.id === a || v.id === b);
    const byId = Object.fromEntries(mine.map((v) => [v.id, v]));
    expect(byId[a].versionNo).toBe(2);
    expect(byId[a].name).toBe('Svc A v2');
    expect(byId[b].versionNo).toBe(1);
  });
});
