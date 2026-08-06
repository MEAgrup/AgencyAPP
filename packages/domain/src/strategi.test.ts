/**
 * Module 6A — Strategi tests (backlog A-03 / A-04).
 *
 * The assertions are organised around the PRD's rules rather than around the
 * functions, because the rules are what a reader will want to check:
 *
 *   Rule 1  a Strategi exists only for a plan-gated Service
 *   Rule 2  exactly one `Aktif` per Service
 *   Rule 4  `Belum Aktif` skips the baseline but not the launch plan
 *   Rule 5  blank is invalid, `0` is valid
 *   Rule 5a a window below three months needs a written reason
 *   Rule 7  stretch >= floor, enforced at the DB level
 *   Rule 8  every monthly stretch figure carries an assumption
 *   Rule 9  the out-of-scope record cannot be empty
 *   Rule 12 approval is two-outcome and lead-only; a return keeps the version
 *   Rule 13 a revision is a new row; version n stays Aktif until n+1 is approved
 *   Rule 17 the cycle start date freezes once Plan period 1 closes
 *
 * Everything DB-backed is skipped without DATABASE_URL, matching the house
 * pattern. `audit_log` and `strategi_version` are append-only, so fixtures use
 * ids unique per RUN — a fixed id would make "exactly these events" assertions
 * depend on run history (the trap HANDOFF_M6ABC_SESI1 §5 warns about).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ident, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ConflictError, ForbiddenError, ValidationError } from './account';
import {
  MSG_ASSUMPTION_TARGET_UNKNOWN,
  MSG_CYCLE_LOCKED,
  MSG_NOT_PLAN_GATED,
  MSG_OUT_OF_SCOPE_REQUIRED,
  MSG_REVIEW_NOTES_REQUIRED,
  MSG_REVISION_INCOMPLETE,
  MSG_STRATEGI_EXISTS,
  MSG_TARGET_WITHOUT_ASSUMPTION,
  STRATEGI_AKTIF,
  STRATEGI_DIAJUKAN,
  STRATEGI_DIARSIPKAN,
  STRATEGI_DRAFT,
  STRATEGI_DRAFT_REVISI,
  STRATEGI_KEDALUWARSA,
  approveStrategi,
  canApproveStrategi,
  canReadStrategi,
  canWriteStrategi,
  checkCompleteness,
  createStrategi,
  expireStrategi,
  getStrategi,
  listStrategiForService,
  openRevision,
  returnStrategi,
  saveAssumptions,
  saveBaseline,
  saveChannels,
  savePillars,
  saveResources,
  saveRisks,
  saveTargets,
  submitStrategi,
  targetKey,
  updateHeader,
  type ChannelInput,
} from './strategi';

const am = (id = 'ZZ-AM') => ({
  employeeId: id,
  role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const otherAm = () => am('ZZ-AM2');
const spv = () => ({
  employeeId: 'ZZ-SPV',
  role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const creativeLead = () => ({
  employeeId: 'ZZ-CRV',
  role: permission.makeRole({ division: 'Creative', level: 'lead' }),
});
const director = () => ({
  employeeId: 'ZZ-DIR',
  role: permission.makeRole({ division: 'Account', level: 'staff', director: true }),
});
const od = () => ({
  employeeId: 'ZZ-OD',
  role: permission.makeRole({ division: 'Account', level: 'staff', od: true }),
});

describe('permission predicates (§7)', () => {
  it('lets only the owning AM and a Director author', () => {
    expect(canWriteStrategi(am(), 'ZZ-AM')).toBe(true);
    expect(canWriteStrategi(otherAm(), 'ZZ-AM')).toBe(false);
    expect(canWriteStrategi(spv(), 'ZZ-AM')).toBe(false);
    expect(canWriteStrategi(director(), 'ZZ-AM')).toBe(true);
    // An unassigned Service has no owner — nobody inherits it by default.
    expect(canWriteStrategi(am(), null)).toBe(false);
  });

  it('keeps approval with the Account lead, never the author', () => {
    expect(canApproveStrategi(spv())).toBe(true);
    expect(canApproveStrategi(am())).toBe(false);
    expect(canApproveStrategi(creativeLead())).toBe(false);
    // Rule 12 is "SPV / Head of Account"; a Director carries lead authority
    // everywhere in CDPS, same as `account.canApproveStrategy`.
    expect(canApproveStrategi(director())).toBe(true);
  });

  it('opens reading to the SPV and the read-all roles without opening writing', () => {
    expect(canReadStrategi(spv(), 'ZZ-AM')).toBe(true);
    expect(canReadStrategi(od(), 'ZZ-AM')).toBe(true);
    expect(canReadStrategi(otherAm(), 'ZZ-AM')).toBe(false);
    expect(canWriteStrategi(od(), 'ZZ-AM')).toBe(false);
  });
});

describe('targetKey', () => {
  it('is the shape D-9 mappings are stored in', () => {
    expect(targetKey('gmv', 'Shopee', 3)).toBe('gmv:Shopee:3');
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  // `strategi_version` is append-only, and a cascading DELETE still fires the
  // row trigger — so a Strategi with history cannot be deleted at all, which is
  // correct for production and awkward here. TRUNCATE bypasses row triggers
  // (the `client_health_snapshots` precedent in health.test.ts); the table is
  // M6A-only, so nothing else depends on its contents.
  await sql`truncate strategi_version`;
  await sql`delete from strategi where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

/** Seeds a released client + one plan-gated Service owned by ZZ-AM. */
async function seedService(tier = 'plan_wajib'): Promise<string> {
  seq += 1;
  const clientId = `ZZ-CLI-${RUN}-${seq}`;
  const serviceId = `ZZ-SVC-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZ-SALES', 'ZZ-SALES', 'ZZ-AM', now(), 'ZZ-AM')`;
  const msv = await sql<{ service_id: string; version_no: number }[]>`
    select service_id, version_no from master_service_versions
     where name = 'Ads Management' order by version_no desc limit 1`;
  await sql`
    insert into services
      (id, client_id, master_service_id, master_version_no, name, standard_price,
       commission_rule, status, requires_strategy_plan, plan_tier, created_by)
    values (${serviceId}, ${clientId}, ${msv[0].service_id}, ${msv[0].version_no},
            'Full Store Management', '40000000.00', '10%', '[Awaiting Onboarding]',
            ${tier === 'plan_wajib'}, ${tier}, 'ZZ-AM')`;
  return serviceId;
}

const HEADER = {
  durasiKontrakBulan: 6,
  tanggalMulaiKontrak: '2026-08-12',
  tanggalAkhirKontrak: '2027-02-11',
  tanggalMulaiSiklus: '2026-08-12',
};

const SHOPEE: ChannelInput = {
  channel: 'Shopee',
  statusChannel: 'Eksisting',
  namaToko: 'Alpha Digital',
  urlToko: 'https://shopee.co.id/alpha',
  sumberData: 'Shopee export',
  tanggalAmbilData: '2026-08-02',
  lampiran: 'shopee-export.csv',
  periodeBaselineBulan: 3,
  periodeMulai: '2026-05-01',
  periodeAkhir: '2026-07-31',
};

/** Builds a Strategi that passes every submit rule, then returns its id. */
async function seedSubmittable(): Promise<{ serviceId: string; strategiId: string }> {
  const serviceId = await seedService();
  const s = await createStrategi(sql, am(), serviceId, HEADER);
  const withChannel = await saveChannels(sql, am(), s.id, [SHOPEE]);
  const channelId = withChannel.channels[0].id;

  await saveBaseline(
    sql,
    am(),
    s.id,
    channelId,
    [1, 2, 3].map((i) => ({
      monthIndex: i,
      gmv: '180000000.00',
      jumlahPesanan: 2050,
      persenBatal: 4.2,
      adSpend: '41000000.00',
      roas: 4.1,
      acos: 24,
    })),
  );

  await saveTargets(sql, am(), s.id, [
    {
      channel: 'Shopee',
      monthIndex: 1,
      metric: 'gmv',
      nilaiFloor: '400000000.00',
      nilaiStretch: '460000000.00',
      sumberFloor: 'input_am',
    },
  ]);

  await saveAssumptions(
    sql,
    am(),
    s.id,
    ['A1', 'A2', 'A3'].map((kode, i) => ({
      kode,
      asumsi: `budget cair tanggal 1 (${kode})`,
      pemilik: 'Klien',
      caraVerifikasi: 'mutasi rekening',
      targetTerkait: i === 0 ? [targetKey('gmv', 'Shopee', 1)] : [],
    })),
  );

  await savePillars(sql, am(), s.id, [
    { jenis: 'tidak_dikerjakan', aksi: 'tanpa reshoot foto di M1' },
    { jenis: 'harga', sku: 'RAK-A', floorPrice: '79000.00', hargaPromo: '85000.00' },
  ]);

  await saveRisks(
    sql,
    am(),
    s.id,
    ['restock 21 hari', 'approval klien 36 jam', 'kategori jenuh'].map((risiko) => ({
      risiko,
      dampak: 'sedang' as const,
      kemungkinan: 'tinggi' as const,
      mitigasi: 'buffer stok',
      pic: 'ZZ-AM',
    })),
  );

  return { serviceId, strategiId: s.id };
}

describeDb('createStrategi — Rule 1', () => {
  it('mints a house-shaped STRG- id in Draft and opens the version ledger', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);

    expect(ident.parse(s.id)?.prefix).toBe('STRG');
    expect(s.status).toBe(STRATEGI_DRAFT);
    expect(s.versiNo).toBe(1);
    expect(s.strategiIndukId).toBeNull();

    const detail = await getStrategi(sql, am(), s.id);
    expect(detail.riwayat.map((e) => e.peristiwa)).toEqual(['dibuat']);
  });

  it('refuses a Service that is not plan-gated', async () => {
    const serviceId = await seedService('tanpa_plan');
    await expect(createStrategi(sql, am(), serviceId, HEADER)).rejects.toThrow(MSG_NOT_PLAN_GATED);
  });

  it('refuses an AM who does not own the client', async () => {
    const serviceId = await seedService();
    await expect(createStrategi(sql, otherAm(), serviceId, HEADER)).rejects.toThrow(ForbiddenError);
  });

  it('refuses a second in-flight Strategi for the same Service', async () => {
    const serviceId = await seedService();
    await createStrategi(sql, am(), serviceId, HEADER);
    await expect(createStrategi(sql, am(), serviceId, HEADER)).rejects.toThrow(MSG_STRATEGI_EXISTS);
  });

  it('refuses a contract window that ends before it starts', async () => {
    const serviceId = await seedService();
    await expect(
      createStrategi(sql, am(), serviceId, { ...HEADER, tanggalAkhirKontrak: '2026-08-01' }),
    ).rejects.toThrow(ValidationError);
  });
});

describeDb('Section B — Rules 4, 5 and 5a', () => {
  it('accepts a Belum Aktif channel with a launch date and no baseline (Rule 4)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const saved = await saveChannels(sql, am(), s.id, [
      {
        channel: 'Tokopedia',
        statusChannel: 'Belum Aktif',
        namaToko: 'Alpha Digital',
        urlToko: 'https://tokopedia.com/alpha',
        targetTanggalLive: '2026-10-01',
        prasyaratPembukaan: ['dokumen NIB', 'katalog'],
      },
    ]);
    expect(saved.channels[0].periodeBaselineBulan).toBeNull();
    expect(saved.channels[0].prasyaratPembukaan).toEqual(['dokumen NIB', 'katalog']);
  });

  it('refuses a Belum Aktif channel with no launch date (Rule 4)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveChannels(sql, am(), s.id, [
        {
          channel: 'Tokopedia',
          statusChannel: 'Belum Aktif',
          namaToko: 'Alpha',
          urlToko: 'https://tokopedia.com/alpha',
        },
      ]),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses an Eksisting channel with no source attachment (Rule 5)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, lampiran: null }]),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a window under three months without a reason (Rule 5a)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, periodeBaselineBulan: 1 }]),
    ).rejects.toThrow(ValidationError);
    const ok = await saveChannels(sql, am(), s.id, [
      { ...SHOPEE, periodeBaselineBulan: 1, alasanPeriodePendek: 'toko baru' },
    ]);
    expect(ok.channels[0].periodeBaselineBulan).toBe(1);
  });

  it('lets the DB refuse a short window with no reason, bypassing the domain', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      sql`insert into strategi_channel
            (strategi_id, channel, status_channel, nama_toko, url_toko, sumber_data,
             tanggal_ambil_data, lampiran, periode_baseline_bulan, periode_mulai,
             periode_akhir, created_by)
          values (${s.id}, 'Shopee', 'Eksisting', 'A', 'u', 'export', '2026-08-02', 'f.csv',
                  1, '2026-07-01', '2026-07-31', 'ZZ-AM')`,
    ).rejects.toThrow();
  });

  it('stores 0 and rejects blank in the baseline (Rule 5)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const withChannel = await saveChannels(sql, am(), s.id, [SHOPEE]);
    const channelId = withChannel.channels[0].id;

    const zeroed = await saveBaseline(sql, am(), s.id, channelId, [
      {
        monthIndex: 1,
        gmv: '0',
        jumlahPesanan: 0,
        persenBatal: 0,
        adSpend: '0',
        roas: 0,
        acos: 0,
      },
    ]);
    expect(zeroed.channels[0].baseline[0].gmv).toBe('0.00');
    // B-1.3 AOV is auto and divides by zero here — null, rendered `—`, never an
    // error (house rule #7).
    expect(zeroed.channels[0].baseline[0].aov).toBeNull();

    await expect(
      saveBaseline(sql, am(), s.id, channelId, [
        {
          monthIndex: 2,
          gmv: null,
          jumlahPesanan: 10,
          persenBatal: 0,
          adSpend: '0',
          roas: 0,
          acos: 0,
        },
      ]),
    ).rejects.toThrow(ValidationError);
  });

  it('computes AOV from GMV and orders without anyone typing it', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const withChannel = await saveChannels(sql, am(), s.id, [SHOPEE]);
    const saved = await saveBaseline(sql, am(), s.id, withChannel.channels[0].id, [
      {
        monthIndex: 1,
        gmv: '180000000.00',
        jumlahPesanan: 2000,
        persenBatal: 4,
        adSpend: '41000000.00',
        roas: 4.1,
        acos: 24,
      },
    ]);
    expect(saved.channels[0].baseline[0].aov).toBe('90000.00');
  });

  it('refuses a baseline row for a channel of another Strategi', async () => {
    const a = await seedSubmittable();
    const otherService = await seedService();
    const other = await createStrategi(sql, am(), otherService, HEADER);
    const foreign = (await getStrategi(sql, am(), a.strategiId)).channels[0].id;
    await expect(
      saveBaseline(sql, am(), other.id, foreign, [
        {
          monthIndex: 1,
          gmv: '0',
          jumlahPesanan: 0,
          persenBatal: 0,
          adSpend: '0',
          roas: 0,
          acos: 0,
        },
      ]),
    ).rejects.toThrow();
  });
});

describeDb('Section D — Rules 7 and 8', () => {
  it('refuses a stretch below the contract floor (Rule 7)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveTargets(sql, am(), s.id, [
        {
          channel: 'Shopee',
          monthIndex: 1,
          metric: 'gmv',
          nilaiFloor: '400000000.00',
          nilaiStretch: '350000000.00',
        },
      ]),
    ).rejects.toThrow(ValidationError);
  });

  it('lets the DB refuse it too — the CHECK is the wall (Rule 7)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      sql`insert into strategi_target
            (strategi_id, channel, month_index, metric, nilai_floor, nilai_stretch,
             sumber_floor, created_by)
          values (${s.id}, 'Shopee', 1, 'gmv', 400000000, 350000000, 'input_am', 'ZZ-AM')`,
    ).rejects.toThrow();
  });

  it('records the floor provenance so a self-set floor is distinguishable (O57)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const saved = await saveTargets(sql, am(), s.id, [
      {
        channel: 'Shopee',
        monthIndex: 1,
        metric: 'gmv',
        nilaiFloor: '400000000.00',
        nilaiStretch: '460000000.00',
      },
    ]);
    expect(saved.targets[0].sumberFloor).toBe('input_am');
  });

  it('refuses an assumption pointing at a target that does not exist (D-9)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveAssumptions(sql, am(), s.id, [
        {
          kode: 'A1',
          asumsi: 'x',
          pemilik: 'Klien',
          caraVerifikasi: 'y',
          targetTerkait: [targetKey('gmv', 'Shopee', 9)],
        },
      ]),
    ).rejects.toThrow(MSG_ASSUMPTION_TARGET_UNKNOWN);
  });
});

describeDb('Section E — Rules 11 and 18', () => {
  it('refuses a vendor on a non-live pillar (Rule 18)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      savePillars(sql, am(), s.id, [{ jenis: 'konten', vendorId: 'VND-202608-0001' }]),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a floor price with no SKU to attach it to (E-4)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      savePillars(sql, am(), s.id, [{ jenis: 'harga', floorPrice: '79000.00' }]),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a promo price below the strategy’s own floor (Rule 11)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      savePillars(sql, am(), s.id, [
        { jenis: 'harga', sku: 'RAK-A', floorPrice: '79000.00', hargaPromo: '69000.00' },
      ]),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a vendor on a non-live_vendor resource row (Rule 18, Section F)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveResources(sql, am(), s.id, [{ jenis: 'divisi', divisi: 'Creative', vendorId: 'VND-1' }]),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses an ad budget with no funding source (F-1)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveResources(sql, am(), s.id, [{ jenis: 'budget_iklan', nilai: '45000000.00' }]),
    ).rejects.toThrow(ValidationError);
  });
});

describeDb('checkCompleteness — every unmet rule, not the first one', () => {
  it('lists what is missing on an empty draft', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, { ...HEADER, tanggalMulaiSiklus: null });
    const missing = await checkCompleteness(sql, s.id);
    const codes = missing.map((m) => m.kode);
    expect(codes).toContain('G-0'); // Rule 17
    expect(codes).toContain('B-0'); // Rule 3
    expect(codes).toContain('D-8'); // three assumptions
    expect(codes).toContain('E-11'); // Rule 9
    expect(codes).toContain('H-1'); // three risks
    // A first-error gate would have reported one of these and hidden four.
    expect(missing.length).toBeGreaterThanOrEqual(5);
  });

  it('flags a GMV target no assumption points at (Rule 8)', async () => {
    const { strategiId } = await seedSubmittable();
    await saveAssumptions(
      sql,
      am(),
      strategiId,
      ['A1', 'A2', 'A3'].map((kode) => ({
        kode,
        asumsi: 'x',
        pemilik: 'Klien',
        caraVerifikasi: 'y',
        targetTerkait: [],
      })),
    );
    const missing = await checkCompleteness(sql, strategiId);
    expect(missing.map((m) => m.pesan)).toContain(MSG_TARGET_WITHOUT_ASSUMPTION);
  });

  it('flags an empty out-of-scope record (Rule 9)', async () => {
    const { strategiId } = await seedSubmittable();
    await savePillars(sql, am(), strategiId, [{ jenis: 'konten', aksi: '40 video' }]);
    const missing = await checkCompleteness(sql, strategiId);
    expect(missing.map((m) => m.pesan)).toContain(MSG_OUT_OF_SCOPE_REQUIRED);
  });

  it('flags a baseline shorter than the declared window (Rule 5)', async () => {
    const { strategiId } = await seedSubmittable();
    const channelId = (await getStrategi(sql, am(), strategiId)).channels[0].id;
    await saveBaseline(sql, am(), strategiId, channelId, [
      {
        monthIndex: 1,
        gmv: '1',
        jumlahPesanan: 1,
        persenBatal: 0,
        adSpend: '0',
        roas: 0,
        acos: 0,
      },
    ]);
    const missing = await checkCompleteness(sql, strategiId);
    expect(missing.map((m) => m.kode)).toContain('B-1/Shopee');
  });

  it('returns nothing for a complete draft', async () => {
    const { strategiId } = await seedSubmittable();
    expect(await checkCompleteness(sql, strategiId)).toEqual([]);
  });
});

describeDb('lifecycle — machine #15', () => {
  it('blocks submit while anything is missing, and moves once it is not', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(submitStrategi(sql, am(), s.id)).rejects.toThrow(ValidationError);
    expect((await getStrategi(sql, am(), s.id)).status).toBe(STRATEGI_DRAFT);

    const { strategiId } = await seedSubmittable();
    const submitted = await submitStrategi(sql, am(), strategiId);
    expect(submitted.status).toBe(STRATEGI_DIAJUKAN);
    expect(submitted.diajukanPada).not.toBeNull();
  });

  it('refuses approval from the AM and accepts it from the SPV (Rule 12)', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await expect(approveStrategi(sql, am(), strategiId)).rejects.toThrow(ForbiddenError);

    const approved = await approveStrategi(sql, spv(), strategiId);
    expect(approved.status).toBe(STRATEGI_AKTIF);
    expect(approved.disetujuiOleh).toBe('ZZ-SPV');
  });

  it('requires a written note to return, and keeps version 1 in Draft (Rule 12)', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await expect(returnStrategi(sql, spv(), strategiId, '   ')).rejects.toThrow(
      MSG_REVIEW_NOTES_REQUIRED,
    );

    const returned = await returnStrategi(sql, spv(), strategiId, 'baseline TikTok belum ada');
    expect(returned.status).toBe(STRATEGI_DRAFT);
    expect(returned.versiNo).toBe(1);
    expect(returned.catatanReviewer).toBe('baseline TikTok belum ada');
  });

  it('records every event in the append-only version ledger', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await returnStrategi(sql, spv(), strategiId, 'kurang bukti');
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);

    const detail = await getStrategi(sql, am(), strategiId);
    expect(detail.riwayat.map((e) => e.peristiwa)).toEqual([
      'dibuat',
      'diajukan',
      'dikembalikan',
      'diajukan',
      'disetujui',
    ]);
    // Two submissions of the SAME version — the reason the ledger is per event
    // and not per version (Rule 12 "keeps its version number").
    expect(detail.riwayat.every((e) => e.versiNo === 1)).toBe(true);
  });

  it('refuses to mutate a version-ledger row (house rule #3)', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      sql`update strategi_version set catatan = 'diubah' where strategi_id = ${strategiId}`,
    ).rejects.toThrow();
    await expect(
      sql`delete from strategi_version where strategi_id = ${strategiId} and peristiwa = 'dibuat'`,
    ).rejects.toThrow();
  });

  it('refuses content edits once the record leaves Draft', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await expect(saveRisks(sql, am(), strategiId, [])).rejects.toThrow(ConflictError);
  });

  it('expires an active Strategi (Rule 14)', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    const expired = await expireStrategi(sql, am(), strategiId);
    expect(expired.status).toBe(STRATEGI_KEDALUWARSA);
  });
});

describeDb('Rule 13 — a revision is a new row, and n stays Aktif', () => {
  it('refuses a revision without trigger, reason and broken assumptions', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    await expect(
      openRevision(sql, am(), strategiId, {
        triggerRevisi: [],
        alasanRevisi: 'pokoknya berubah',
        asumsiGugur: ['A1'],
      }),
    ).rejects.toThrow(MSG_REVISION_INCOMPLETE);
  });

  it('refuses to revise anything that is not Aktif', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      openRevision(sql, am(), strategiId, {
        triggerRevisi: ['stok kosong'],
        alasanRevisi: 'x',
        asumsiGugur: ['A1'],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('opens version 2, copies the content, and leaves version 1 Aktif', async () => {
    const { serviceId, strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);

    const v2 = await openRevision(sql, am(), strategiId, {
      triggerRevisi: ['budget iklan dipotong'],
      alasanRevisi: 'klien memotong budget 40%',
      asumsiGugur: ['A1'],
    });
    expect(v2.versiNo).toBe(2);
    expect(v2.status).toBe(STRATEGI_DRAFT_REVISI);
    expect(v2.strategiIndukId).toBe(strategiId);
    expect(v2.versiSebelumnyaId).toBe(strategiId);

    // The whole point of Rule 13: the contract is never left without an
    // authoritative strategy while the revision is being written.
    const versions = await listStrategiForService(sql, am(), serviceId);
    expect(versions.map((v) => [v.versiNo, v.status])).toEqual([
      [2, STRATEGI_DRAFT_REVISI],
      [1, STRATEGI_AKTIF],
    ]);

    const copied = await getStrategi(sql, am(), v2.id);
    expect(copied.channels).toHaveLength(1);
    expect(copied.channels[0].baseline).toHaveLength(3);
    expect(copied.targets).toHaveLength(1);
    expect(copied.assumptions.map((a) => a.kode)).toEqual(['A1', 'A2', 'A3']);
    expect(copied.risks).toHaveLength(3);
    expect(copied.riwayat[0].peristiwa).toBe('revisi_dibuka');
    expect(copied.riwayat[0].triggerRevisi).toEqual(['budget iklan dipotong']);
    expect(copied.riwayat[0].asumsiGugur).toEqual(['A1']);
  });

  it('returns a revision to Draft Revisi, not to Draft (Rule 12)', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    const v2 = await openRevision(sql, am(), strategiId, {
      triggerRevisi: ['stok kosong'],
      alasanRevisi: 'restock meleset',
      asumsiGugur: ['A2'],
    });
    await submitStrategi(sql, am(), v2.id);
    const returned = await returnStrategi(sql, spv(), v2.id, 'angka belum diperbarui');
    expect(returned.status).toBe(STRATEGI_DRAFT_REVISI);
    expect(returned.versiNo).toBe(2);
  });

  it('archives version 1 only when version 2 is approved (Rules 2 and 13)', async () => {
    const { serviceId, strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    const v2 = await openRevision(sql, am(), strategiId, {
      triggerRevisi: ['klien ubah lini produk'],
      alasanRevisi: 'produk baru masuk',
      asumsiGugur: ['A3'],
    });
    await submitStrategi(sql, am(), v2.id);
    await approveStrategi(sql, spv(), v2.id);

    const versions = await listStrategiForService(sql, am(), serviceId);
    expect(versions.map((v) => [v.versiNo, v.status])).toEqual([
      [2, STRATEGI_AKTIF],
      [1, STRATEGI_DIARSIPKAN],
    ]);
    // Rule 2, at the storage level: the partial unique index cannot hold two.
    const active = await sql<{ n: number }[]>`
      select count(*)::int as n from strategi
       where service_id = ${serviceId} and status = 'Aktif'`;
    expect(active[0].n).toBe(1);
  });

  it('refuses a second parallel revision', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    const rev = {
      triggerRevisi: ['ganti PIC klien'],
      alasanRevisi: 'PIC baru',
      asumsiGugur: ['A1'],
    };
    await openRevision(sql, am(), strategiId, rev);
    await expect(openRevision(sql, am(), strategiId, rev)).rejects.toThrow(MSG_STRATEGI_EXISTS);
  });
});

describeDb('Rule 17 — the cycle start freezes once Plan period 1 closes', () => {
  it('lets the AM move it while the cycle is unlocked', async () => {
    const { strategiId } = await seedSubmittable();
    const moved = await updateHeader(sql, am(), strategiId, {
      ...HEADER,
      tanggalMulaiSiklus: '2026-08-15',
    });
    expect(moved.tanggalMulaiSiklus).toBe('2026-08-15');
  });

  it('refuses to move it after the lock, in the domain and in the DB', async () => {
    const { strategiId } = await seedSubmittable();
    // M6B sets this when period 1 closes; until then this is how the lock is
    // reachable in a test.
    await sql`update strategi set siklus_terkunci = true where id = ${strategiId}`;

    await expect(
      updateHeader(sql, am(), strategiId, { ...HEADER, tanggalMulaiSiklus: '2026-09-01' }),
    ).rejects.toThrow(MSG_CYCLE_LOCKED);

    await expect(
      sql`update strategi set tanggal_mulai_siklus = '2026-09-01' where id = ${strategiId}`,
    ).rejects.toThrow();
    await expect(
      sql`update strategi set siklus_terkunci = false where id = ${strategiId}`,
    ).rejects.toThrow();
  });
});

describeDb('reads', () => {
  it('refuses a foreign AM and allows the SPV', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(getStrategi(sql, otherAm(), strategiId)).rejects.toThrow(ForbiddenError);
    expect((await getStrategi(sql, spv(), strategiId)).id).toBe(strategiId);
    expect((await getStrategi(sql, od(), strategiId)).id).toBe(strategiId);
  });
});
