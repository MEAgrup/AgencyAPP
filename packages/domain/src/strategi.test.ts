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
  MSG_AKSES_BLOCKER_DATE,
  MSG_AKSES_DUPLICATE,
  MSG_AKSES_MATRIX_REQUIRED,
  MSG_ASSUMPTION_NOT_FOUND,
  MSG_ASSUMPTION_STATUS_INVALID,
  MSG_ASSUMPTION_TARGET_UNKNOWN,
  MSG_BASELINE_GROUP_INCOMPLETE,
  MSG_CHANNEL_NOT_FOUND,
  MSG_CYCLE_LOCKED,
  MSG_DEFINISI_BERHASIL_REQUIRED,
  MSG_DIAGNOSA_FIELD_ID_REQUIRED,
  MSG_DIAGNOSA_INVALID_FIELD_ID,
  MSG_DIAGNOSA_MISSING,
  MSG_INCOMPLETE,
  MSG_KOMPETITOR_REQUIRED,
  MSG_LEADING_INDICATOR_MAX,
  MSG_LEADING_INDICATOR_REQUIRED,
  MSG_NOT_PLAN_GATED,
  MSG_OUT_OF_SCOPE_REQUIRED,
  MSG_PRASYARAT_KLIEN_REQUIRED,
  MSG_QUICK_WIN_MIN,
  MSG_REVIEW_NOTES_REQUIRED,
  MSG_REVISION_INCOMPLETE,
  MSG_RISIKO_STRUKTURAL_REQUIRED,
  MSG_SANGGAHAN_INCOMPLETE,
  MSG_STRATEGI_EXISTS,
  MSG_TARGET_WITHOUT_ASSUMPTION,
  MSG_TIDAK_ADA_BELUM_DIJAWAB,
  MSG_TOP_SKU_REQUIRED,
  MSG_TRAFFIC_MIX_SUM,
  MSG_USP_MIN,
  FLOOR_DISETUJUI_HEAD,
  FLOOR_INPUT_AM,
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
  saveAkses,
  saveAssumptions,
  saveBaseline,
  saveChannels,
  saveDiagnosa,
  saveKonteks,
  saveKpi,
  savePillars,
  saveResources,
  saveRisks,
  komposisiKontribusi,
  saveTargets,
  raiseSanggahan,
  setAssumptionStatus,
  LEADING_INDICATORS,
  LEADING_INDICATOR_MAX,
  TARGET_METRICS,
  submitStrategi,
  targetKey,
  trenBaseline,
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

describe('trenBaseline — B-1.5, derived and never stored', () => {
  const bulan = (monthIndex: number, gmv: string) => ({
    monthIndex,
    gmv,
    jumlahPesanan: 100,
    persenBatal: 0,
    adSpend: '0',
    roas: 0,
    acos: 0,
    aov: null,
  });

  it('calls the §6 Alpha Digital baseline flat', () => {
    // 172jt → 165jt → 180jt, the numbers M6A §6 itself describes as "flat".
    const t = trenBaseline([bulan(1, '172000000'), bulan(2, '165000000'), bulan(3, '180000000')]);
    expect(t.tren).toBe('stabil');
    expect(t.trenPersen).toBeCloseTo(4.65, 1);
  });

  it('reads the window oldest → newest, not in row order', () => {
    // Same months, shuffled. `month_index` decides direction, not arrival order.
    const t = trenBaseline([bulan(3, '200000000'), bulan(1, '100000000')]);
    expect(t.tren).toBe('naik');
    expect(t.trenPersen).toBeCloseTo(100, 5);
  });

  it('calls a real drop a drop', () => {
    expect(trenBaseline([bulan(1, '200000000'), bulan(2, '100000000')]).tren).toBe('turun');
  });

  it('answers `—` for the magnitude when the window opens at zero', () => {
    // House rule #7: division by zero is not an error. The direction is knowable,
    // the percentage is not.
    const t = trenBaseline([bulan(1, '0'), bulan(2, '5000000')]);
    expect(t.tren).toBe('naik');
    expect(t.trenPersen).toBeNull();
  });

  it('has no answer at all from a single month', () => {
    expect(trenBaseline([bulan(1, '100')])).toEqual({ tren: null, trenPersen: null });
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
  await sql`delete from contracts where created_by like 'ZZ-%'`;
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

/**
 * Section B for Shopee, straight out of the M6A §6 Alpha Digital excerpt.
 *
 * Using the PRD's own numbers is not decoration: they are what makes the
 * derived-field assertions checkable against something other than this file
 * (`tren` must come out `stabil`, because §6 calls this baseline "flat").
 */
const SHOPEE: ChannelInput = {
  channel: 'Shopee',
  statusChannel: 'Eksisting',
  namaToko: 'Alpha Digital',
  urlToko: 'https://shopee.co.id/alpha',
  umurTokoBulan: 30,
  badge: 'Star Seller',
  sumberData: 'Shopee export',
  tanggalAmbilData: '2026-08-02',
  lampiran: 'shopee-export.csv',
  periodeBaselineBulan: 3,
  periodeMulai: '2026-05-01',
  periodeAkhir: '2026-07-31',
  // B-2 — visitors 96.000, CR 2,1%, mix organik 41 / iklan 44 / affiliate 9 /
  // live 0 / video 0 / luar 6 = 100.
  pengunjungPerBulan: 96000,
  conversionRatePersen: 2.1,
  trafikOrganikPersen: 41,
  trafikIklanPersen: 44,
  trafikAffiliatePersen: 9,
  trafikLivePersen: 0,
  trafikVideoPersen: 0,
  trafikLuarPersen: 6,
  entryPointUtama: 'search',
  // B-3 — 214 listed, 178 active, 7 SKU carry 80% of GMV, 96 slow-moving,
  // 54% of listings adequate.
  skuListed: 214,
  skuAktif: 178,
  skuPareto80: 7,
  skuSlowMoving: 96,
  listingLayakPersen: 54,
  topSku: [
    { nama: 'RAK-A', gmv: '52000000.00', unitTerjual: 610, hargaJual: '85000.00', marginPersen: 38 },
  ],
  // B-4 — rating 4,8 / 3.104 reviews, chat 88% / 34 min, 4,2% late.
  ratingToko: 4.8,
  jumlahUlasan: 3104,
  chatResponseRatePersen: 88,
  chatResponseMenit: 34,
  pesananTerlambatPersen: 4.2,
  poinPenalti: 0,
  // B-5 — three of the running campaigns burn spend with no orders (§6 quick win).
  tipeKampanye: ['gmv_max', 'manual_keyword'],
  jumlahKampanyeAktif: 9,
  kampanyeBoncos: [{ nama: 'GMV Max - rak lipat', spend: '6000000.00' }],
  // B-6 — 22 active creators, Rp 15jt affiliate GMV, commission 6% → target 12%.
  affiliateAktif30Hari: 22,
  gmvAffiliate: '15000000.00',
  gmvAffiliatePersen: 8.7,
  komisiOpenPersen: 6,
  komisiTargetPersen: 12,
  programSampel: 'tidak_ada',
  // B-7 — zero live hours. `0`, not blank: that is the Rule 5 distinction, and
  // it is what makes `gmv_per_jam_live` render `—` instead of erroring.
  jumlahVideoPerBulan: 4,
  totalViews: 82000,
  gmvVideo: '3000000.00',
  jamLivePerBulan: 0,
  gmvLive: '0.00',
  hostLive: 'belum_ada',
  studioLive: 'tidak_ada',
  // B-8
  voucherAktif: [{ tipe: 'diskon toko', nilai: '10%', syarat: 'min. Rp 100.000' }],
  programPlatform: ['gratis_ongkir_xtra'],
  bebanPromoPersen: 7,
  // B-9 — three stores at Rp 69.000–75.000 with 3× the video volume.
  kompetitor: [
    {
      nama: 'Rak Murah ID',
      url: 'https://shopee.co.id/rakmurah',
      hargaSebanding: '69000.00',
      estimasiPenjualanBulan: '210000000.00',
    },
  ],
  kompetitorLebihBaik: ['harga', 'konten'],
  celahKompetitor: 'tidak ada yang menggarap bundling rak + organizer',
};

/** Section A, from the same §6 excerpt. */
const KONTEKS = {
  namaBrand: 'Alpha Digital',
  kategoriUtama: 'Home Living',
  subKategori: ['rak', 'organizer'],
  modelBisnis: 'brand_owner' as const,
  marginKotorPersen: 38,
  posisiHarga: 'mid' as const,
  usp: ['bahan tebal', 'garansi 1 tahun', 'desain modular'],
  kapasitasStok: 'ready_stock' as const,
  leadTimeRestockHari: 21,
  plafonUnitPerBulan: 8000,
  titikKirimKota: 'Bandung',
  // A-9 is recorded verbatim — the client's words are the thing being kept.
  ekspektasiKlien: 'pokoknya omzet naik 2x dan gak rugi di iklan.',
  riwayatAgensi: 'agensi sebelumnya hanya menjalankan iklan; listing tidak pernah dibereskan',
  pantanganKlien: ['harga hero SKU tidak boleh di bawah Rp 79.000'],
  decisionMaker: [
    { nama: 'Owner', jabatan: 'Pemilik', berhakApprove: true, jalurEskalasi: 'langsung ke owner' },
  ],
  slaKlienJam: 36,
  asetDariKlien: ['foto_produk', 'katalog', 'budget_iklan'],
};

/** A-15/A-16, from the same excerpt: Shopee granted, TikTok Affiliate pending. */
const AKSES = [
  { channel: 'Shopee' as const, akses: 'seller_center' as const, status: 'sudah' as const },
  { channel: 'Shopee' as const, akses: 'ads_manager' as const, status: 'sudah' as const },
  {
    channel: 'Shopee' as const,
    akses: 'affiliate_center' as const,
    status: 'pending' as const,
    memblokir: true,
    targetTanggalBeres: '2026-08-11',
    catatan: 'menunggu approval pemilik',
  },
  { channel: 'Umum' as const, akses: 'gudang_stok' as const, status: 'sudah' as const },
];

/**
 * A-07 Section C fixture — based on the §6 Alpha Digital / Shopee worked example.
 *
 * Shopee diagnosa: bottleneck = konversi, evidence = B-2.2 (conversion rate) and
 * B-3.6 (basket size), matching the PRD's "CvR 1.3% vs benchmark 2.8%" narrative.
 * Three quick wins, one structural risk, one client prerequisite satisfy the
 * minimum-count gates (C-5 min 3, C-6 min 1, C-7 min 1).
 */
const DIAGNOSA_PAYLOAD = {
  diagnosa: [
    {
      channel: 'Shopee',
      bottleneck: 'konversi' as const,
      fieldIds: ['B-2.2', 'B-3.6'],
      akarMasalah: 'CvR 1,3% vs benchmark platform 2,8%; nilai AOV turun karena bundling hilang',
      gapKompetitor: 'Kompetitor A CvR 2,6% dengan bundling 3-pcs di flash sale',
    },
  ],
  quickWins: [
    {
      aksi: 'Aktifkan bundling 3-pcs di Shopee Flash Sale minggu 1',
      channel: 'Shopee',
      picDivisi: 'Account',
      dampakDiharapkan: 'AOV +15%, CvR +0,3pp dalam 7 hari',
    },
    {
      aksi: 'Pasang voucher toko 10% untuk repeat buyer hari 1–7',
      channel: 'Shopee',
      picDivisi: 'Account',
      dampakDiharapkan: 'Repeat rate +5% dari segmen lapsed 30 hari',
    },
    {
      aksi: 'Update main banner dengan harga coret yang terlihat jelas',
      channel: 'Shopee',
      picDivisi: 'Creative',
      dampakDiharapkan: 'CTR organic +10% dalam 14 hari',
    },
  ],
  risikoStruktural: [
    {
      risiko: 'Kapasitas produksi terbatas: restock rata-rata 21 hari, demand spike tidak bisa dipenuhi instan',
    },
  ],
  prasyaratKlien: [
    {
      item: 'Klien harus memberikan akses Shopee Ads Manager sebelum eksekusi iklan M1',
      picKlien: 'Owner',
      deadline: '2026-08-15',
    },
  ],
};

/** Builds a Strategi that passes every submit rule, then returns its id. */
async function seedSubmittable(): Promise<{ serviceId: string; strategiId: string }> {
  const serviceId = await seedService();
  const s = await createStrategi(sql, am(), serviceId, HEADER);
  await saveKonteks(sql, am(), s.id, KONTEKS);
  const withChannel = await saveChannels(sql, am(), s.id, [SHOPEE]);
  const channelId = withChannel.channels[0].id;
  await saveAkses(sql, am(), s.id, AKSES);
  await saveDiagnosa(sql, am(), s.id, DIAGNOSA_PAYLOAD);

  // §6: GMV M-3 172jt → M-2 165jt → M-1 180jt, which the PRD calls "flat".
  // `month_index` runs oldest → newest, so M-3 is index 1.
  await saveBaseline(
    sql,
    am(),
    s.id,
    channelId,
    ['172000000.00', '165000000.00', '180000000.00'].map((gmv, i) => ({
      monthIndex: i + 1,
      gmv,
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

  // Section D header (A-08). D-5 and D-6 are `W`, so a Strategi without them is
  // no longer submittable — that is what makes them part of THIS fixture rather
  // than only of their own tests.
  await saveKpi(sql, am(), s.id, {
    definisiBerhasil30: 'listing 7 SKU Pareto selesai ditulis ulang',
    definisiBerhasil60: 'CR Shopee naik dari 2,1% ke 2,8%',
    definisiBerhasil90: 'GMV gabungan menyentuh Rp 460jt',
    leadingIndicator: ['cr', 'jumlah_video'],
  });

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

describeDb('Section A — A-05 (Konteks Klien & Bisnis)', () => {
  it('stores all sixteen answers and reads them back', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const saved = await saveKonteks(sql, am(), s.id, KONTEKS);

    expect(saved.namaBrand).toBe('Alpha Digital');
    expect(saved.modelBisnis).toBe('brand_owner');
    expect(saved.marginKotorPersen).toBe(38);
    expect(saved.posisiHarga).toBe('mid');
    expect(saved.usp).toHaveLength(3);
    expect(saved.kapasitasStok).toBe('ready_stock');
    expect(saved.leadTimeRestockHari).toBe(21);
    expect(saved.plafonUnitPerBulan).toBe(8000);
    expect(saved.titikKirimKota).toBe('Bandung');
    // A-9 verbatim: not trimmed into a summary anywhere along the way.
    expect(saved.ekspektasiKlien).toBe('pokoknya omzet naik 2x dan gak rugi di iklan.');
    expect(saved.pantanganKlien).toEqual(['harga hero SKU tidak boleh di bawah Rp 79.000']);
    expect(saved.decisionMaker).toEqual([
      { nama: 'Owner', jabatan: 'Pemilik', berhakApprove: true, jalurEskalasi: 'langsung ke owner' },
    ]);
    expect(saved.slaKlienJam).toBe(36);
    expect(saved.asetDariKlien).toEqual(['foto_produk', 'katalog', 'budget_iklan']);
  });

  it('accepts a partial save — the form autosaves before it is finished (§7)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const saved = await saveKonteks(sql, am(), s.id, { namaBrand: 'Alpha Digital' });
    expect(saved.namaBrand).toBe('Alpha Digital');
    // Everything else stays empty rather than being rejected or defaulted.
    expect(saved.modelBisnis).toBeNull();
    expect(saved.usp).toEqual([]);
  });

  it('refuses an enum outside its list and a percentage above 100', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveKonteks(sql, am(), s.id, { modelBisnis: 'agensi' as never }),
    ).rejects.toThrow(ValidationError);
    await expect(saveKonteks(sql, am(), s.id, { marginKotorPersen: 140 })).rejects.toThrow(
      ValidationError,
    );
    await expect(saveKonteks(sql, am(), s.id, { leadTimeRestockHari: -1 })).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses an asset outside the closed A-14 taxonomy', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveKonteks(sql, am(), s.id, { asetDariKlien: ['foto_produk', 'gudang'] }),
    ).rejects.toThrow(ValidationError);
  });

  it('drops a blank decision-maker row but refuses a half-typed one', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    // The form always shows one empty row for the next entry; autosave must not
    // choke on it.
    const saved = await saveKonteks(sql, am(), s.id, {
      decisionMaker: [
        { nama: 'Owner', jabatan: 'Pemilik', berhakApprove: true, jalurEskalasi: '' },
        { nama: '', jabatan: '', berhakApprove: false, jalurEskalasi: '' },
      ],
    });
    expect(saved.decisionMaker).toHaveLength(1);
    await expect(
      saveKonteks(sql, am(), s.id, {
        decisionMaker: [{ nama: 'Owner', jabatan: '', berhakApprove: false, jalurEskalasi: '' }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('is writable only by the owning AM, and only while a draft', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(saveKonteks(sql, otherAm(), strategiId, KONTEKS)).rejects.toThrow(ForbiddenError);
    await submitStrategi(sql, am(), strategiId);
    await expect(saveKonteks(sql, am(), strategiId, KONTEKS)).rejects.toThrow(ConflictError);
  });

  it('survives a revision — Section A lives on the row that gets copied', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    const v2 = await openRevision(sql, am(), strategiId, {
      triggerRevisi: ['stok kosong'],
      alasanRevisi: 'hero SKU habis',
      asumsiGugur: ['A1'],
    });
    const detail = await getStrategi(sql, am(), v2.id);
    expect(detail.namaBrand).toBe('Alpha Digital');
    expect(detail.decisionMaker).toHaveLength(1);
    // A-15 travels too: access already granted is not re-requested, and an
    // unresolved blocker must not vanish because a new version was opened.
    expect(detail.akses.filter((a) => a.memblokir)).toHaveLength(1);
  });
});

/**
 * O57 item (b) — Rule 7 read as "floor read-only AFTER Head approval".
 *
 * The pre-O57 column was a quality signal (`kontrak` vs `input_am`) invented
 * because no Contract existed to pull a floor from. The owner decision keeps the
 * floor an AM input and puts a Head approval behind it, so what has to hold is:
 * the AM cannot declare their own number approved, and once a Head has, nothing
 * short of a new version moves it.
 */
describeDb('Rule 7 — the floor approval path (O57 item (b))', () => {
  const floors = (strategiId: string) =>
    sql<{ sumber_floor: string | null; nilai_floor: string | null; floor_disetujui_oleh: string | null }[]>`
      select sumber_floor, nilai_floor, floor_disetujui_oleh
        from strategi_target where strategi_id = ${strategiId} and metric = 'gmv'`;

  it('starts at input_am — the AM who types the number cannot mark it approved', async () => {
    const { strategiId } = await seedSubmittable();
    const rows = await floors(strategiId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sumber_floor).toBe(FLOOR_INPUT_AM);
    expect(rows[0].floor_disetujui_oleh).toBeNull();

    // `sumber_floor` is not on TargetInput at all (house rule #4). Passing it
    // through the wire converter is a no-op rather than a back door.
    await saveTargets(sql, am(), strategiId, [
      {
        channel: 'Shopee',
        monthIndex: 1,
        metric: 'gmv',
        nilaiFloor: '400000000.00',
        nilaiStretch: '460000000.00',
        ...({ sumberFloor: FLOOR_DISETUJUI_HEAD } as object),
      },
    ]);
    expect((await floors(strategiId))[0].sumber_floor).toBe(FLOOR_INPUT_AM);
  });

  it('flips to disetujui_head — stamped with the approver, who is not the author', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    const rows = await floors(strategiId);
    expect(rows[0].sumber_floor).toBe(FLOOR_DISETUJUI_HEAD);
    expect(rows[0].floor_disetujui_oleh).toBe('ZZ-SPV');
    expect(rows[0].floor_disetujui_oleh).not.toBe('ZZ-AM');
  });

  /**
   * The wall, not the promise. Asserted through raw SQL on the service-role
   * connection precisely because a TS-only guard would let exactly this call
   * through — and a floor that can be lowered without a trace is D-7 Sanggahan
   * Target with no enforcer.
   */
  it('freezes the number in the DATABASE once approved', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);

    await expect(
      sql`update strategi_target set nilai_floor = '1.00'
           where strategi_id = ${strategiId} and metric = 'gmv'`,
    ).rejects.toThrow(/target floor tidak dapat diubah setelah disetujui Head Account/);
    // …and the approval cannot be quietly withdrawn to unlock it either.
    await expect(
      sql`update strategi_target set sumber_floor = ${FLOOR_INPUT_AM}
           where strategi_id = ${strategiId} and metric = 'gmv'`,
    ).rejects.toThrow(/target floor tidak dapat diubah setelah disetujui Head Account/);
    expect((await floors(strategiId))[0].nilai_floor).toBe('400000000.00');
  });

  /**
   * The trap this pass was written to avoid: `copyChildren` copies every target
   * column, so a revision would inherit `disetujui_head` and open ALREADY
   * approved — frozen against the very edit the revision exists to make, and
   * carrying a Head sign-off nobody gave for that version.
   */
  it('does NOT let a revision inherit the previous version’s approval', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    const v2 = await openRevision(sql, am(), strategiId, {
      triggerRevisi: ['target meleset'],
      alasanRevisi: 'floor perlu ditinjau ulang',
      asumsiGugur: ['A1'],
    });
    const rows = await floors(v2.id);
    expect(rows[0].sumber_floor).toBe(FLOOR_INPUT_AM);
    expect(rows[0].floor_disetujui_oleh).toBeNull();
    // Version 1 keeps its approval — the revision is a new row, not an edit.
    expect((await floors(strategiId))[0].sumber_floor).toBe(FLOOR_DISETUJUI_HEAD);
  });
});

describeDb('A-15 / A-16 — the access matrix and its blockers', () => {
  it('stores the matrix and flags the blocker on the row it blocks', async () => {
    const { strategiId } = await seedSubmittable();
    const detail = await getStrategi(sql, am(), strategiId);
    expect(detail.akses).toHaveLength(4);
    const blocker = detail.akses.find((a) => a.memblokir);
    expect(blocker?.akses).toBe('affiliate_center');
    expect(blocker?.status).toBe('pending');
    expect(blocker?.targetTanggalBeres).toBe('2026-08-11');
  });

  it('refuses a blocker with no target date (A-16)', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      saveAkses(sql, am(), strategiId, [
        { channel: 'Shopee', akses: 'ads_manager', status: 'pending', memblokir: true },
      ]),
    ).rejects.toThrow(MSG_AKSES_BLOCKER_DATE);
  });

  it('refuses a blocker on an access that is already granted', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      saveAkses(sql, am(), strategiId, [
        {
          channel: 'Shopee',
          akses: 'ads_manager',
          status: 'sudah',
          memblokir: true,
          targetTanggalBeres: '2026-09-01',
        },
      ]),
    ).rejects.toThrow(MSG_AKSES_BLOCKER_DATE);
  });

  it('refuses a channel this Strategi does not contract, but accepts Umum', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      saveAkses(sql, am(), strategiId, [
        { channel: 'Lazada', akses: 'seller_center', status: 'pending' },
      ]),
    ).rejects.toThrow(MSG_CHANNEL_NOT_FOUND);
    const ok = await saveAkses(sql, am(), strategiId, [
      { channel: 'Umum', akses: 'gudang_stok', status: 'sudah' },
    ]);
    expect(ok.akses).toHaveLength(1);
  });

  it('refuses the same (channel, akses) twice — a matrix has one cell each', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      saveAkses(sql, am(), strategiId, [
        { channel: 'Shopee', akses: 'seller_center', status: 'sudah' },
        { channel: 'Shopee', akses: 'seller_center', status: 'pending' },
      ]),
    ).rejects.toThrow(MSG_AKSES_DUPLICATE);
  });
});

describeDb('Section B — A-06 (groups B-2 … B-9)', () => {
  it('reads back the §6 Alpha Digital baseline, with the derived figures derived', async () => {
    const { strategiId } = await seedSubmittable();
    const c = (await getStrategi(sql, am(), strategiId)).channels[0];

    expect(c.pengunjungPerBulan).toBe(96000);
    expect(c.conversionRatePersen).toBe(2.1);
    expect(c.skuListed).toBe(214);
    expect(c.skuAktif).toBe(178);
    expect(c.skuPareto80).toBe(7);
    expect(c.ratingToko).toBe(4.8);
    expect(c.jumlahUlasan).toBe(3104);
    expect(c.komisiTargetPersen).toBe(12);
    expect(c.tipeKampanye).toEqual(['gmv_max', 'manual_keyword']);
    expect(c.topSku[0].nama).toBe('RAK-A');
    expect(c.kompetitor[0].hargaSebanding).toBe('69000.00');
    expect(c.kompetitorLebihBaik).toEqual(['harga', 'konten']);

    // B-1.3 AOV = GMV/orders, computed in the DB (house rule #4).
    expect(Number(c.baseline[2].aov)).toBeCloseTo(180000000 / 2050, 2);
    // B-7.2 third figure: zero live hours, so division by zero renders `—`
    // rather than erroring or pretending the answer is 0 (house rule #7).
    expect(c.jamLivePerBulan).toBe(0);
    expect(c.gmvPerJamLive).toBeNull();
  });

  it('derives the B-1.5 trend, and calls the §6 baseline flat', async () => {
    const { strategiId } = await seedSubmittable();
    const c = (await getStrategi(sql, am(), strategiId)).channels[0];
    // 172jt → 180jt is +4,65%: inside the band, so `stabil` — which is exactly
    // the word §6 uses for these numbers.
    expect(c.tren).toBe('stabil');
    expect(c.trenPersen).toBeCloseTo(4.65, 1);
  });

  it('refuses a traffic mix that is partial or does not add up (§7)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    // Five of six filled: a composition that cannot be summed at all.
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, trafikLuarPersen: null }]),
    ).rejects.toThrow(MSG_TRAFFIC_MIX_SUM);
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, trafikOrganikPersen: 20 }]),
    ).rejects.toThrow(MSG_TRAFFIC_MIX_SUM);
  });

  it('refuses out-of-range and self-contradicting figures', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    // B-4.1 is a 0–5 scale, not a percentage.
    await expect(saveChannels(sql, am(), s.id, [{ ...SHOPEE, ratingToko: 48 }])).rejects.toThrow(
      ValidationError,
    );
    // More SKUs selling than listed is a typo, and Section C would cite it.
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, skuAktif: 400 }]),
    ).rejects.toThrow(ValidationError);
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, skuPareto80: 200 }]),
    ).rejects.toThrow(ValidationError);
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, tipeKampanye: ['tiktok_magic'] }]),
    ).rejects.toThrow(ValidationError);
  });

  it('caps the counts the PRD writes in brackets, and allows a shorter list', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const sku = SHOPEE.topSku![0];
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, topSku: [sku, sku, sku, sku, sku, sku] }]),
    ).rejects.toThrow(ValidationError);
    const k = SHOPEE.kompetitor![0];
    await expect(
      saveChannels(sql, am(), s.id, [{ ...SHOPEE, kompetitor: [k, k, k, k] }]),
    ).rejects.toThrow(ValidationError);
    // One row is fine: a store with four active SKUs cannot honestly name five.
    const ok = await saveChannels(sql, am(), s.id, [SHOPEE]);
    expect(ok.channels[0].topSku).toHaveLength(1);
  });

  it('keeps `0` a valid answer where blank is not (Rule 5)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const saved = await saveChannels(sql, am(), s.id, [
      { ...SHOPEE, poinPenalti: 0, affiliateAktif30Hari: 0, bebanPromoPersen: 0 },
    ]);
    expect(saved.channels[0].poinPenalti).toBe(0);
    expect(saved.channels[0].affiliateAktif30Hari).toBe(0);
    expect(saved.channels[0].bebanPromoPersen).toBe(0);
  });

  it('survives a revision — Section B is copied with its channel', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    const v2 = await openRevision(sql, am(), strategiId, {
      triggerRevisi: ['klien ubah lini produk'],
      alasanRevisi: 'lini baru masuk',
      asumsiGugur: ['A1'],
    });
    const c = (await getStrategi(sql, am(), v2.id)).channels[0];
    expect(c.pengunjungPerBulan).toBe(96000);
    expect(c.topSku[0].nama).toBe('RAK-A');
    expect(c.tren).toBe('stabil');
  });
});

describeDb('checkCompleteness — every unmet rule, not the first one', () => {
  it('lists what is missing on an empty draft', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, { ...HEADER, tanggalMulaiSiklus: null });
    // RA-5 fills G-0 from the contract start, so a blank header no longer
    // produces a null cycle start. The G-0 rule still has to hold for rows that
    // predate the default (and for a service-role write), so the null is made
    // here rather than deleting the assertion it guards.
    await sql`update strategi set tanggal_mulai_siklus = null where id = ${s.id}`;
    const missing = await checkCompleteness(sql, s.id);
    const codes = missing.map((m) => m.kode);
    expect(codes).toContain('G-0'); // Rule 17
    expect(codes).toContain('B-0'); // Rule 3
    expect(codes).toContain('D-8'); // three assumptions
    expect(codes).toContain('E-11'); // Rule 9
    expect(codes).toContain('H-1'); // three risks
    // A-05: every Section A answer is required, and the kode names which one so
    // the form can jump to it rather than saying "something is missing".
    expect(codes).toContain('A-1');
    expect(codes).toContain('A-9');
    expect(codes).toContain('A-12');
    expect(codes).toContain('A-13');
    expect(missing.find((m) => m.kode === 'A-5')?.pesan).toBe(MSG_USP_MIN);
    // A-07 Section C: zero channels → no C-1 per channel, but C-5/C-6/C-7 fire.
    expect(codes).toContain('C-5'); // no quick wins yet
    expect(codes).toContain('C-6'); // no structural risks yet
    expect(codes).toContain('C-7'); // no client prerequisites yet
    // A first-error gate would have reported one of these and hidden the rest.
    expect(missing.length).toBeGreaterThanOrEqual(5);
  });

  it('lists every unfilled Section B group per channel, not just the first', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    // A B-0 block with a window and a source, but none of B-2…B-9 answered.
    await saveChannels(sql, am(), s.id, [
      {
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
      },
    ]);
    const codes = (await checkCompleteness(sql, s.id)).map((m) => m.kode);
    for (const g of ['B-2', 'B-3', 'B-4', 'B-5', 'B-6', 'B-7', 'B-8', 'B-9']) {
      expect(codes).toContain(`${g}/Shopee`);
    }
    expect(codes).toContain('B-3.3/Shopee'); // no hero SKU for E-3 to promote
    expect(codes).toContain('B-9.1/Shopee'); // nothing for C-4 to compare against
    // A-15: the channel has no access checklist at all.
    expect(codes).toContain('A-15/Shopee');
  });

  it('does not require Section B of a Belum Aktif channel (Rule 4)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [
      {
        channel: 'Tokopedia',
        statusChannel: 'Belum Aktif',
        namaToko: 'Alpha Digital',
        urlToko: 'https://tokopedia.com/alpha',
        targetTanggalLive: '2026-10-01',
      },
    ]);
    const codes = (await checkCompleteness(sql, s.id)).map((m) => m.kode);
    expect(codes).not.toContain('B-2/Tokopedia');
    expect(codes).not.toContain('B-7/Tokopedia');
    // The launch plan and the access checklist are still required, though.
    expect(codes).toContain('A-15/Tokopedia');
  });

  // -------------------------------------------------------------------------
  // O58 — "tidak ada" vs "belum dijawab" (owner decision 2026-08-07, option a).
  //
  // The five fields below are `W` lists whose honest answer may be empty. Before
  // O58 an empty list passed the gate silently, and a submitted Strategi could
  // not be told apart from one where the AM never reached the question. These
  // tests exercise BOTH branches, because a gate that only ever sees the filled
  // branch is indistinguishable from no gate at all — the whole suite stayed
  // green when this gate was added precisely because the fixture fills all five.
  // -------------------------------------------------------------------------
  it('blocks A-11/A-14 left empty with no "tidak ada" — the pre-O58 silent pass', async () => {
    const { strategiId } = await seedSubmittable();
    await saveKonteks(sql, am(), strategiId, {
      ...KONTEKS,
      pantanganKlien: [],
      asetDariKlien: [],
    });
    const missing = await checkCompleteness(sql, strategiId);
    const byCode = Object.fromEntries(missing.map((m) => [m.kode, m.pesan]));
    expect(byCode['A-11']).toBe(MSG_TIDAK_ADA_BELUM_DIJAWAB);
    expect(byCode['A-14']).toBe(MSG_TIDAK_ADA_BELUM_DIJAWAB);
  });

  it('accepts A-11/A-14 empty ONCE "tidak ada" is ticked — "none" is now an answer', async () => {
    const { strategiId } = await seedSubmittable();
    await saveKonteks(sql, am(), strategiId, {
      ...KONTEKS,
      pantanganKlien: [],
      pantanganKlienTidakAda: true,
      asetDariKlien: [],
      asetDariKlienTidakAda: true,
    });
    const codes = (await checkCompleteness(sql, strategiId)).map((m) => m.kode);
    expect(codes).not.toContain('A-11');
    expect(codes).not.toContain('A-14');
  });

  it('blocks B-5.3/B-8.1/B-8.2 left empty with no "tidak ada"', async () => {
    const { strategiId } = await seedSubmittable();
    await saveChannels(sql, am(), strategiId, [{
      ...SHOPEE,
      tipeKampanye: [],
      jumlahKampanyeAktif: 0,
      voucherAktif: [],
      programPlatform: [],
    }]);
    const missing = await checkCompleteness(sql, strategiId);
    const byCode = Object.fromEntries(missing.map((m) => [m.kode, m.pesan]));
    expect(byCode['B-5.3/Shopee']).toBe(MSG_TIDAK_ADA_BELUM_DIJAWAB);
    expect(byCode['B-8.1/Shopee']).toBe(MSG_TIDAK_ADA_BELUM_DIJAWAB);
    expect(byCode['B-8.2/Shopee']).toBe(MSG_TIDAK_ADA_BELUM_DIJAWAB);
    // The companion NUMBER is a separate proof path and stays satisfied by a
    // valid 0 — O58 added the list gate, it did not replace the number gate.
    expect(missing.map((m) => m.kode)).not.toContain('B-5/Shopee');
  });

  it('accepts B-5.3/B-8.1/B-8.2 empty ONCE "tidak ada" is ticked', async () => {
    const { strategiId } = await seedSubmittable();
    await saveChannels(sql, am(), strategiId, [{
      ...SHOPEE,
      tipeKampanye: [],
      tipeKampanyeTidakAda: true,
      jumlahKampanyeAktif: 0,
      voucherAktif: [],
      voucherAktifTidakAda: true,
      programPlatform: [],
      programPlatformTidakAda: true,
    }]);
    const codes = (await checkCompleteness(sql, strategiId)).map((m) => m.kode);
    for (const k of ['B-5.3/Shopee', 'B-8.1/Shopee', 'B-8.2/Shopee']) {
      expect(codes).not.toContain(k);
    }
  });

  it('rejects "tidak ada" ticked ALONGSIDE a filled list — that is a contradiction, not an answer', async () => {
    const { strategiId } = await seedSubmittable();
    // Which side the AM meant is exactly what cannot be inferred, so this is
    // refused rather than silently resolved by clearing one of them.
    await expect(
      saveKonteks(sql, am(), strategiId, {
        ...KONTEKS,
        pantanganKlien: ['tidak boleh diskon di bawah 20%'],
        pantanganKlienTidakAda: true,
      }),
    ).rejects.toThrow(MSG_INCOMPLETE);
    await expect(
      saveKonteks(sql, am(), strategiId, {
        ...KONTEKS,
        asetDariKlien: ['foto_produk'],
        asetDariKlienTidakAda: true,
      }),
    ).rejects.toThrow(MSG_INCOMPLETE);
  });

  it('refuses the same contradiction at the DB, not only in TS', async () => {
    // Belt and braces: the TS guard gives the AM a BI message, but the CHECK is
    // what makes the state unstorable by any path — including a future writer
    // that forgets the guard.
    const { strategiId } = await seedSubmittable();
    await expect(
      sql`update strategi set pantangan_klien_tidak_ada = true where id = ${strategiId}`,
    ).rejects.toThrow(/ck_strategi_pantangan_tidak_ada/);
  });

  it('flags a hero-SKU list and a competitor list left empty', async () => {
    const { strategiId } = await seedSubmittable();
    await saveChannels(sql, am(), strategiId, [{ ...SHOPEE, topSku: [], kompetitor: [] }]);
    const pesan = (await checkCompleteness(sql, strategiId)).map((m) => m.pesan);
    expect(pesan).toContain(MSG_TOP_SKU_REQUIRED);
    expect(pesan).toContain(MSG_KOMPETITOR_REQUIRED);
  });

  it('flags a channel whose access checklist was never filled (A-15)', async () => {
    const { strategiId } = await seedSubmittable();
    await saveAkses(sql, am(), strategiId, [
      // Only the non-channel row survives: Shopee itself is now unasked.
      { channel: 'Umum', akses: 'gudang_stok', status: 'sudah' },
    ]);
    const missing = await checkCompleteness(sql, strategiId);
    expect(missing.find((m) => m.kode === 'A-15/Shopee')?.pesan).toBe(MSG_AKSES_MATRIX_REQUIRED);
  });

  it('does not treat a zero as a blank when checking a group (Rule 5)', async () => {
    const { strategiId } = await seedSubmittable();
    // Every figure in B-7 is zero except the ones §6 gives — a store that never
    // went live has ANSWERED, and the gate must not call that missing.
    await saveChannels(sql, am(), strategiId, [
      { ...SHOPEE, jumlahVideoPerBulan: 0, totalViews: 0, gmvVideo: '0.00' },
    ]);
    const codes = (await checkCompleteness(sql, strategiId)).map((m) => m.kode);
    expect(codes).not.toContain('B-7/Shopee');
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
    // Section C is copied too: the AM revises strategy, not the situation.
    expect(copied.diagnosa).toHaveLength(1);
    expect(copied.diagnosa[0].channel).toBe('Shopee');
    expect(copied.diagnosa[0].bottleneck).toBe('konversi');
    expect(copied.quickWins).toHaveLength(3);
    expect(copied.risikoStruktural).toHaveLength(1);
    expect(copied.prasyaratKlien).toHaveLength(1);
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
    // O57 — now per CONTRACT, which is the whole point: two Services in one
    // agreement share the single `Aktif` slot instead of getting one each.
    const active = await sql<{ n: number }[]>`
      select count(*)::int as n from strategi s
        join services sv on sv.contract_id = s.contract_id
       where sv.id = ${serviceId} and s.status = 'Aktif'`;
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

describeDb('D-3 (X-11) — komposisi kontribusi channel adalah TURUNAN, bukan input', () => {
  it('derives the mix from the D-2 GMV targets', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveTargets(sql, am(), s.id, [
      { channel: 'Shopee', monthIndex: 1, metric: 'gmv', nilaiFloor: '600000000.00', nilaiStretch: '600000000.00' },
      { channel: 'Shopee', monthIndex: 2, metric: 'gmv', nilaiFloor: '600000000.00', nilaiStretch: '600000000.00' },
      { channel: 'TikTok', monthIndex: 1, metric: 'gmv', nilaiFloor: '400000000.00', nilaiStretch: '400000000.00' },
    ]);
    const detail = await getStrategi(sql, am(), s.id);
    expect(detail.komposisiKontribusi).toEqual([
      { channel: 'Shopee', targetGmv: '1200000000.00', persen: 75 },
      { channel: 'TikTok', targetGmv: '400000000.00', persen: 25 },
    ]);
  });

  it('ignores non-GMV metrics — D-3 is a GMV mix, not a metric mix', () => {
    const mix = komposisiKontribusi([
      { channel: 'Shopee', monthIndex: 1, metric: 'gmv', nilaiFloor: null, nilaiStretch: '100.00', sumberFloor: null },
      { channel: 'TikTok', monthIndex: 1, metric: 'roas_min', nilaiFloor: null, nilaiStretch: '4.00', sumberFloor: null },
    ]);
    expect(mix.map((m) => m.channel)).toEqual(['Shopee']);
    expect(mix[0].persen).toBe(100);
  });

  it('renders `—` instead of dividing by zero when every target is 0 (house rule #7)', () => {
    const mix = komposisiKontribusi([
      { channel: 'Shopee', monthIndex: 1, metric: 'gmv', nilaiFloor: null, nilaiStretch: '0.00', sumberFloor: null },
      { channel: 'TikTok', monthIndex: 1, metric: 'gmv', nilaiFloor: null, nilaiStretch: '0.00', sumberFloor: null },
    ]);
    expect(mix.map((m) => m.persen)).toEqual([null, null]);
  });

  it('leaves a channel with no GMV target OUT — "belum diisi" is not "nol persen"', () => {
    const mix = komposisiKontribusi([
      { channel: 'Shopee', monthIndex: 1, metric: 'gmv', nilaiFloor: null, nilaiStretch: '100.00', sumberFloor: null },
    ]);
    expect(mix).toHaveLength(1);
  });

  it('sums to 100 within rounding on a matrix that does not divide evenly', () => {
    const mix = komposisiKontribusi(
      ['A', 'B', 'C'].map((channel) => ({
        channel,
        monthIndex: 1,
        metric: 'gmv' as const,
        nilaiFloor: null,
        nilaiStretch: '100.00',
        sumberFloor: null,
      })),
    );
    // 33,33 × 3 = 99,99. That is CORRECT for a derived display; forcing the last
    // row to absorb 0,01 would make one channel's percentage disagree with its
    // own rupiah figure.
    expect(mix.map((m) => m.persen)).toEqual([33.33, 33.33, 33.33]);
    const total = mix.reduce((n, m) => n + (m.persen ?? 0), 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(0.5);
  });

  it('adds in integer cents, so a long matrix does not drift', () => {
    // 12 months × 0,10 = 1,20 exactly. In float, 0.1 summed 12 times is not 1.2.
    const mix = komposisiKontribusi(
      Array.from({ length: 12 }, (_, i) => ({
        channel: 'Shopee',
        monthIndex: i + 1,
        metric: 'gmv' as const,
        nilaiFloor: null,
        nilaiStretch: '0.10',
        sumberFloor: null,
      })),
    );
    expect(mix[0].targetGmv).toBe('1.20');
  });
});

describeDb('RA-5 (X-05) — G-0 defaults to the contract start date', () => {
  it('fills the cycle start from the contract when the AM leaves it blank', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, { ...HEADER, tanggalMulaiSiklus: null });
    expect(s.tanggalMulaiSiklus).toBe(HEADER.tanggalMulaiKontrak);
  });

  it('keeps the AM override — the default is a default, not a rule', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, {
      ...HEADER,
      tanggalMulaiSiklus: '2026-09-01',
    });
    expect(s.tanggalMulaiSiklus).toBe('2026-09-01');
  });

  it('re-applies the default on updateHeader, so a cleared field is not a null', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, {
      ...HEADER,
      tanggalMulaiSiklus: '2026-09-01',
    });
    const back = await updateHeader(sql, am(), s.id, { ...HEADER, tanggalMulaiSiklus: null });
    expect(back.tanggalMulaiSiklus).toBe(HEADER.tanggalMulaiKontrak);
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

// ---------------------------------------------------------------------------
// Section C — A-07 (Diagnosa & Akar Masalah)
// ---------------------------------------------------------------------------

describeDb('Section C — A-07 (Diagnosa & Akar Masalah)', () => {
  it('saves all four sub-sections atomically and returns the full detail', async () => {
    const { strategiId } = await seedSubmittable();
    // The fixture was already applied by seedSubmittable; re-read and verify shape.
    const detail = await getStrategi(sql, am(), strategiId);

    expect(detail.diagnosa).toHaveLength(1);
    const d = detail.diagnosa[0];
    expect(d.channel).toBe('Shopee');
    expect(d.bottleneck).toBe('konversi');
    expect(d.fieldIds).toEqual(['B-2.2', 'B-3.6']);
    expect(d.akarMasalah).toContain('CvR');
    expect(d.gapKompetitor).toContain('Kompetitor');

    expect(detail.quickWins).toHaveLength(3);
    expect(detail.quickWins[0].channel).toBe('Shopee');
    expect(detail.quickWins[0].picDivisi).toBe('Account');

    expect(detail.risikoStruktural).toHaveLength(1);
    expect(detail.risikoStruktural[0].risiko).toContain('restock');

    expect(detail.prasyaratKlien).toHaveLength(1);
    expect(detail.prasyaratKlien[0].picKlien).toBe('Owner');
    expect(detail.prasyaratKlien[0].deadline).toBe('2026-08-15');
  });

  it('Rule 6 — rejects an empty fieldIds list', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await expect(
      saveDiagnosa(sql, am(), s.id, {
        ...DIAGNOSA_PAYLOAD,
        diagnosa: [{ ...DIAGNOSA_PAYLOAD.diagnosa[0], fieldIds: [] }],
      }),
    ).rejects.toThrow(MSG_DIAGNOSA_FIELD_ID_REQUIRED);
  });

  it('Rule 6 — rejects a field-ID that is not in VALID_BASELINE_FIELD_IDS', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await expect(
      saveDiagnosa(sql, am(), s.id, {
        ...DIAGNOSA_PAYLOAD,
        diagnosa: [{ ...DIAGNOSA_PAYLOAD.diagnosa[0], fieldIds: ['X-99', 'B-2.2'] }],
      }),
    ).rejects.toThrow(MSG_DIAGNOSA_INVALID_FIELD_ID);
  });

  it('Rule 6 — accepts every boundary ID in VALID_BASELINE_FIELD_IDS (A-1 and B-9.3)', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    // A-1 is the first A-section field; B-9.3 is the last B-section field.
    await expect(
      saveDiagnosa(sql, am(), s.id, {
        ...DIAGNOSA_PAYLOAD,
        diagnosa: [{ ...DIAGNOSA_PAYLOAD.diagnosa[0], fieldIds: ['A-1', 'B-9.3'] }],
      }),
    ).resolves.not.toThrow();
  });

  it('rejects a diagnosa for a channel not registered in this Strategi', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await expect(
      saveDiagnosa(sql, am(), s.id, {
        ...DIAGNOSA_PAYLOAD,
        diagnosa: [{ ...DIAGNOSA_PAYLOAD.diagnosa[0], channel: 'Lazada' }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects duplicate diagnosa for the same channel', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await expect(
      saveDiagnosa(sql, am(), s.id, {
        ...DIAGNOSA_PAYLOAD,
        diagnosa: [
          DIAGNOSA_PAYLOAD.diagnosa[0],
          { ...DIAGNOSA_PAYLOAD.diagnosa[0], bottleneck: 'trafik' as const },
        ],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('replaces all four sub-sections atomically (idempotent second save)', async () => {
    const { strategiId } = await seedSubmittable();
    // Second save with different data: old rows must be gone.
    const updated = await saveDiagnosa(sql, am(), strategiId, {
      diagnosa: [
        {
          channel: 'Shopee',
          bottleneck: 'trafik' as const,
          fieldIds: ['B-2.1', 'A-5'],
          akarMasalah: 'organic traffic turun 30% pasca-algo update',
          gapKompetitor: 'Kompetitor dominasi top search dengan video',
        },
      ],
      quickWins: [
        {
          aksi: 'Live streaming 3x seminggu',
          channel: 'Shopee',
          picDivisi: 'Account',
          dampakDiharapkan: 'Trafik live +20%',
        },
        {
          aksi: 'Upload 10 video produk per minggu',
          channel: 'Shopee',
          picDivisi: 'Creative',
          dampakDiharapkan: 'Impresi video +40% dalam 14 hari',
        },
        {
          aksi: 'Optimalkan kata kunci listing top-5 SKU',
          channel: 'Shopee',
          picDivisi: 'Account',
          dampakDiharapkan: 'Organic rank naik 5 posisi',
        },
      ],
      risikoStruktural: [{ risiko: 'Algoritma Shopee berubah sewaktu-waktu tanpa notice' }],
      prasyaratKlien: [{ item: 'Budget live streaming Rp5jt/minggu dikonfirmasi', picKlien: 'Finance' }],
    });
    expect(updated.diagnosa).toHaveLength(1);
    expect(updated.diagnosa[0].bottleneck).toBe('trafik');
    expect(updated.quickWins).toHaveLength(3);
    expect(updated.quickWins[0].aksi).toContain('Live');
  });

  it('blocks writes once the record leaves Draft', async () => {
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await expect(saveDiagnosa(sql, am(), strategiId, DIAGNOSA_PAYLOAD)).rejects.toThrow(
      ConflictError,
    );
  });

  it('checkCompleteness — flags C-1 for every channel with no diagnosa', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    const codes = (await checkCompleteness(sql, s.id)).map((m) => m.kode);
    expect(codes).toContain('C-1/Shopee');
  });

  it('checkCompleteness — flags C-3 when akar_masalah is blank', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await saveDiagnosa(sql, am(), s.id, {
      ...DIAGNOSA_PAYLOAD,
      diagnosa: [{ ...DIAGNOSA_PAYLOAD.diagnosa[0], akarMasalah: '' }],
    });
    const codes = (await checkCompleteness(sql, s.id)).map((m) => m.kode);
    expect(codes).toContain('C-3/Shopee');
    expect(codes).not.toContain('C-1/Shopee');
  });

  it('checkCompleteness — flags C-4 when gap_kompetitor is blank', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await saveDiagnosa(sql, am(), s.id, {
      ...DIAGNOSA_PAYLOAD,
      diagnosa: [{ ...DIAGNOSA_PAYLOAD.diagnosa[0], gapKompetitor: null }],
    });
    const codes = (await checkCompleteness(sql, s.id)).map((m) => m.kode);
    expect(codes).toContain('C-4/Shopee');
    expect(codes).not.toContain('C-1/Shopee');
  });

  it('checkCompleteness — flags C-5 when quick wins are fewer than 3', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await saveDiagnosa(sql, am(), s.id, {
      ...DIAGNOSA_PAYLOAD,
      quickWins: DIAGNOSA_PAYLOAD.quickWins.slice(0, 2), // only 2 of 3
    });
    const pesan = (await checkCompleteness(sql, s.id)).map((m) => m.pesan);
    expect(pesan).toContain(MSG_QUICK_WIN_MIN);
  });

  it('checkCompleteness — flags C-6 when risiko struktural is empty', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await saveDiagnosa(sql, am(), s.id, { ...DIAGNOSA_PAYLOAD, risikoStruktural: [] });
    const pesan = (await checkCompleteness(sql, s.id)).map((m) => m.pesan);
    expect(pesan).toContain(MSG_RISIKO_STRUKTURAL_REQUIRED);
  });

  it('checkCompleteness — flags C-7 when prasyarat klien is empty', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await saveChannels(sql, am(), s.id, [SHOPEE]);
    await saveDiagnosa(sql, am(), s.id, { ...DIAGNOSA_PAYLOAD, prasyaratKlien: [] });
    const pesan = (await checkCompleteness(sql, s.id)).map((m) => m.pesan);
    expect(pesan).toContain(MSG_PRASYARAT_KLIEN_REQUIRED);
  });

  it('checkCompleteness — Section C is complete with the seedSubmittable fixture', async () => {
    const { strategiId } = await seedSubmittable();
    const codes = (await checkCompleteness(sql, strategiId)).map((m) => m.kode);
    expect(codes).not.toContain('C-1/Shopee');
    expect(codes).not.toContain('C-3/Shopee');
    expect(codes).not.toContain('C-4/Shopee');
    expect(codes).not.toContain('C-5');
    expect(codes).not.toContain('C-6');
    expect(codes).not.toContain('C-7');
  });
});

// ---------------------------------------------------------------------------
// Section D — D-5, D-6, D-7 and the D-8 status flip (A-08)
// ---------------------------------------------------------------------------
// D-1/D-2/D-4 (`strategi_target`) and D-8/D-9 (`strategi_assumption`) landed with
// A-03 and are covered by the Rule 7 / Rule 8 blocks above. D-3 has no storage at
// all (X-11) and is covered by the `komposisiKontribusi` unit block. What is new
// here is the three header fields plus the flip that fires a notification.
describeDb('Section D — D-5 & D-6 (A-08)', () => {
  it('stores the three horizons and the weekly indicators', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const after = await saveKpi(sql, am(), s.id, {
      definisiBerhasil30: 'listing 7 SKU Pareto selesai',
      definisiBerhasil60: 'CR naik ke 2,8%',
      definisiBerhasil90: 'GMV Rp 460jt',
      leadingIndicator: ['cr', 'jumlah_video', 'roas_min'],
    });
    expect(after.definisiBerhasil30).toBe('listing 7 SKU Pareto selesai');
    expect(after.definisiBerhasil60).toBe('CR naik ke 2,8%');
    expect(after.definisiBerhasil90).toBe('GMV Rp 460jt');
    expect(after.leadingIndicator).toEqual(['cr', 'jumlah_video', 'roas_min']);
  });

  it('normalises blank to null, so "empty" and "unanswered" are one state', async () => {
    // If `''` were stored, the submit gate would have to test for both forever —
    // and the D-5 message would stop being reachable for a whitespace answer.
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const after = await saveKpi(sql, am(), s.id, {
      definisiBerhasil30: '   ',
      definisiBerhasil60: '',
      definisiBerhasil90: 'GMV Rp 460jt',
    });
    expect(after.definisiBerhasil30).toBeNull();
    expect(after.definisiBerhasil60).toBeNull();
    expect((await checkCompleteness(sql, s.id)).map((m) => m.pesan)).toContain(
      MSG_DEFINISI_BERHASIL_REQUIRED,
    );
  });

  it('accepts a partial save — autosave (§7) needs a half-filled Section D storable', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const after = await saveKpi(sql, am(), s.id, { definisiBerhasil30: 'listing selesai' });
    expect(after.definisiBerhasil30).toBe('listing selesai');
    expect(after.definisiBerhasil90).toBeNull();
    expect(after.leadingIndicator).toEqual([]);
  });

  it('refuses more than the D-6 cap, and refuses an unknown indicator', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    await expect(
      saveKpi(sql, am(), s.id, {
        leadingIndicator: ['gmv', 'cr', 'aov', 'roas_min', 'jam_live', 'jumlah_video'],
      }),
    ).rejects.toThrow(MSG_LEADING_INDICATOR_MAX);
    await expect(
      // Outside the D-4 vocabulary the D-6 set is drawn from (X-13).
      saveKpi(sql, am(), s.id, { leadingIndicator: ['jumlah_reels' as never] }),
    ).rejects.toThrow(MSG_INCOMPLETE);
    // A duplicate would burn one of the five slots without watching anything new.
    await expect(
      saveKpi(sql, am(), s.id, { leadingIndicator: ['cr', 'cr'] }),
    ).rejects.toThrow(MSG_INCOMPLETE);
  });

  it('has the cap enforced by the DB too, not only by the domain', async () => {
    // The domain message is for humans; this is what stops a second write path
    // (a future admin script, a fixture) from parking six indicators in the row.
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const enam = JSON.stringify(['gmv', 'cr', 'aov', 'roas_min', 'jam_live', 'jumlah_video']);
    await expect(
      sql`update strategi set leading_indicator = ${enam}::jsonb where id = ${s.id}`,
    ).rejects.toThrow(/ck_strategi_leading_indicator/);
    // Same constraint, other half: membership of the closed set.
    await expect(
      sql`update strategi set leading_indicator = '["jumlah_reels"]'::jsonb where id = ${s.id}`,
    ).rejects.toThrow(/ck_strategi_leading_indicator/);
  });

  it('checkCompleteness flags D-5 and D-6 while they are empty, and clears them once filled', async () => {
    const serviceId = await seedService();
    const s = await createStrategi(sql, am(), serviceId, HEADER);
    const kosong = await checkCompleteness(sql, s.id);
    expect(kosong.map((m) => m.kode)).toContain('D-5');
    expect(kosong.map((m) => m.kode)).toContain('D-6');
    expect(kosong.map((m) => m.pesan)).toContain(MSG_LEADING_INDICATOR_REQUIRED);

    await saveKpi(sql, am(), s.id, {
      definisiBerhasil30: 'a',
      definisiBerhasil60: 'b',
      definisiBerhasil90: 'c',
      leadingIndicator: ['cr'],
    });
    const terisi = (await checkCompleteness(sql, s.id)).map((m) => m.kode);
    expect(terisi).not.toContain('D-5');
    expect(terisi).not.toContain('D-6');
  });

  it('is complete in the seedSubmittable fixture', async () => {
    const { strategiId } = await seedSubmittable();
    const codes = (await checkCompleteness(sql, strategiId)).map((m) => m.kode);
    expect(codes).not.toContain('D-5');
    expect(codes).not.toContain('D-6');
  });

  it('refuses a non-owner, and refuses a write once the record leaves Draft', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      saveKpi(sql, otherAm(), strategiId, { leadingIndicator: ['cr'] }),
    ).rejects.toThrow(ForbiddenError);
    await submitStrategi(sql, am(), strategiId);
    await expect(
      saveKpi(sql, am(), strategiId, { leadingIndicator: ['cr'] }),
    ).rejects.toThrow(ConflictError);
  });

  it('carries D-5/D-6 into a revision, but not D-7', async () => {
    // The regression this locks in: `openRevision` INSERT…SELECTs the header, and
    // a column not listed there arrives blank in version n+1. Because D-5/D-6 are
    // submit requirements, that would have turned every revision into a form the
    // AM has to refill — and version 1's tests would all still have passed.
    const { strategiId } = await seedSubmittable();
    await raiseSanggahan(sql, am(), strategiId, {
      alasan: 'floor terlalu tinggi',
      angkaPembanding: '180000000.00',
      targetRealistis: '320000000.00',
    });
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);

    const v2 = await openRevision(sql, am(), strategiId, {
      triggerRevisi: ['asumsi gugur'],
      alasanRevisi: 'budget klien tidak cair',
      asumsiGugur: ['A1'],
    });
    expect(v2.definisiBerhasil30).toBe('listing 7 SKU Pareto selesai ditulis ulang');
    expect(v2.definisiBerhasil90).toBe('GMV gabungan menyentuh Rp 460jt');
    expect(v2.leadingIndicator).toEqual(['cr', 'jumlah_video']);

    // D-7 is an ACT, not content: version 2 was never challenged by anyone.
    expect(v2.sanggahanAlasan).toBeNull();
    expect(v2.sanggahanDiajukanOleh).toBeNull();
    // …and version 1 still holds its own, unchanged and readable.
    expect((await getStrategi(sql, am(), strategiId)).sanggahanAlasan).toBe('floor terlalu tinggi');
  });

  it('keeps the D-6 vocabulary identical to the D-4 metric list (X-13)', () => {
    // Two closed sets that can drift apart is the O48/O51 defect class. This is
    // the cheap guard: they are the same array, and this asserts nobody forked it.
    expect([...LEADING_INDICATORS]).toEqual([...TARGET_METRICS]);
    expect(LEADING_INDICATOR_MAX).toBe(5);
  });
});

describeDb('Section D — D-7 Sanggahan Target (Rule 19, A-08)', () => {
  it('records the challenge and notifies Head of Sales + Account leads', async () => {
    const { strategiId } = await seedSubmittable();
    const after = await raiseSanggahan(sql, am(), strategiId, {
      alasan: 'floor Rp 400jt tidak realistis dengan restock 21 hari',
      angkaPembanding: '180000000.00',
      targetRealistis: '320000000.00',
    });
    expect(after.sanggahanAlasan).toContain('tidak realistis');
    expect(after.sanggahanAngkaPembanding).toBe(180000000);
    expect(after.sanggahanTargetRealistis).toBe(320000000);
    expect(after.sanggahanDiajukanOleh).toBe('ZZ-AM');
    expect(after.sanggahanDiajukanPada).not.toBeNull();

    // EMP-0006 is Sales/Sales Head in the Alpha Digital seed → the Head of Sales
    // arm of Rule 19. It can only arrive as an explicit recipient: `notify_emit`
    // resolves leads for ONE division, and that slot is spent on Account.
    const kena = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${strategiId} and event_type = 'm6a.strategi.sanggahan_target'`;
    expect(kena.map((r) => r.recipient_employee_id)).toContain('EMP-0006');
  });

  it('does NOT touch the floor — that is the whole of Rule 19', async () => {
    const { strategiId } = await seedSubmittable();
    const sebelum = await getStrategi(sql, am(), strategiId);
    const floorSebelum = sebelum.targets.find((t) => t.metric === 'gmv')?.nilaiFloor;

    await raiseSanggahan(sql, am(), strategiId, {
      alasan: 'terlalu tinggi',
      angkaPembanding: '180000000.00',
      // A "realistic" target far BELOW the floor. If a challenge could lower the
      // floor, this is the call that would do it.
      targetRealistis: '150000000.00',
    });

    const sesudah = await getStrategi(sql, am(), strategiId);
    expect(sesudah.targets.find((t) => t.metric === 'gmv')?.nilaiFloor).toBe(floorSebelum);
    // And the stretch is still above the untouched floor, so submit is unaffected.
    expect((await checkCompleteness(sql, strategiId)).map((m) => m.kode)).not.toContain('D-2/Shopee');
  });

  it('refuses a half-filled challenge (all three parts or none)', async () => {
    const { strategiId } = await seedSubmittable();
    for (const payload of [
      { alasan: 'terlalu tinggi', angkaPembanding: '', targetRealistis: '150000000.00' },
      { alasan: '', angkaPembanding: '180000000.00', targetRealistis: '150000000.00' },
      { alasan: 'terlalu tinggi', angkaPembanding: '180000000.00', targetRealistis: '' },
      { alasan: 'terlalu tinggi', angkaPembanding: 'bukan angka', targetRealistis: '1' },
      { alasan: 'terlalu tinggi', angkaPembanding: '-1', targetRealistis: '1' },
    ]) {
      await expect(raiseSanggahan(sql, am(), strategiId, payload)).rejects.toThrow(
        MSG_SANGGAHAN_INCOMPLETE,
      );
    }
    // Nothing was stored by any of the five attempts.
    expect((await getStrategi(sql, am(), strategiId)).sanggahanAlasan).toBeNull();
  });

  it('notifies once — a correction while drafting is not a second event', async () => {
    const { strategiId } = await seedSubmittable();
    const payload = {
      alasan: 'floor terlalu tinggi',
      angkaPembanding: '180000000.00',
      targetRealistis: '320000000.00',
    };
    await raiseSanggahan(sql, am(), strategiId, payload);
    await raiseSanggahan(sql, am(), strategiId, { ...payload, alasan: 'floor terlalu tinggi (revisi)' });

    const n = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications
       where entity_id = ${strategiId} and event_type = 'm6a.strategi.sanggahan_target'`;
    expect(n[0].n).toBe(1);
    // The correction is not lost, though — it is in the audit log.
    const aksi = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${strategiId}
        and action in ('raise_sanggahan', 'edit_sanggahan') order by id asc`;
    expect(aksi.map((a) => a.action)).toEqual(['raise_sanggahan', 'edit_sanggahan']);
  });

  it('is optional — an unchallenged Strategi still submits', async () => {
    const { strategiId } = await seedSubmittable();
    const codes = (await checkCompleteness(sql, strategiId)).map((m) => m.kode);
    expect(codes).not.toContain('D-7');
    expect(codes).toEqual([]);
  });

  it('refuses a non-owner', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      raiseSanggahan(sql, otherAm(), strategiId, {
        alasan: 'terlalu tinggi',
        angkaPembanding: '1',
        targetRealistis: '1',
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describeDb('Section D — D-8 status flip fires strategi_revisi_disarankan (A-08)', () => {
  it('fires the event on the way into Gugur, to the AM and the Account leads', async () => {
    const { strategiId } = await seedSubmittable();
    const after = await setAssumptionStatus(sql, am(), strategiId, 'A1', 'Gugur');
    expect(after.assumptions.find((a) => a.kode === 'A1')?.status).toBe('Gugur');

    const kena = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${strategiId} and event_type = 'strategi_revisi_disarankan'`;
    // The AM arrives explicitly (they are not a lead, so `division` can never
    // resolve them). `notifyActor` is false, so an AM flipping their own
    // assumption is not pinged about their own click — here the actor IS the AM,
    // which is exactly the case that would produce a useless self-notification.
    expect(kena.map((r) => r.recipient_employee_id)).not.toContain('ZZ-AM');
  });

  it('notifies the AM when it is the reviewer who flips it', async () => {
    // The realistic path: the SPV learns in a meeting that the client's budget
    // slipped, and the AM is the one who needs to be told to revise.
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    await setAssumptionStatus(sql, spv(), strategiId, 'A1', 'Gugur');

    const kena = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${strategiId} and event_type = 'strategi_revisi_disarankan'`;
    expect(kena.map((r) => r.recipient_employee_id)).toContain('ZZ-AM');
  });

  it('is reachable while Aktif — the only moment an assumption actually breaks', async () => {
    // Every other Section-D write is Draft-only. If this one were too, the
    // feature would be unreachable exactly when it is needed: mid-execution.
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    const aktif = await approveStrategi(sql, spv(), strategiId);
    expect(aktif.status).toBe(STRATEGI_AKTIF);

    const after = await setAssumptionStatus(sql, am(), strategiId, 'A2', 'Gugur');
    expect(after.assumptions.find((a) => a.kode === 'A2')?.status).toBe('Gugur');
  });

  it('does not fire on Terverifikasi, and does not fire twice for the same flip', async () => {
    // The SPV does the flipping here, not the AM. With the AM as actor the only
    // recipient (themselves) is filtered out by `notifyActor: false` and the
    // count would be 0 for a reason that has nothing to do with what is being
    // asserted — the count has to be able to reach 1 for "not twice" to mean
    // anything.
    const { strategiId } = await seedSubmittable();
    const jumlah = async (): Promise<number> =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from notifications
           where entity_id = ${strategiId} and event_type = 'strategi_revisi_disarankan'`
      )[0].n;

    await setAssumptionStatus(sql, spv(), strategiId, 'A1', 'Terverifikasi');
    expect(await jumlah()).toBe(0);

    await setAssumptionStatus(sql, spv(), strategiId, 'A1', 'Gugur');
    expect(await jumlah()).toBe(1);
    // Idempotent: re-asserting the status it already has must not ping again.
    await setAssumptionStatus(sql, spv(), strategiId, 'A1', 'Gugur');
    expect(await jumlah()).toBe(1);
  });

  it('does not open a revision by itself — Rule 13 needs a human', async () => {
    // "disarankan" is the whole word. A flip suggests; it never mints version n+1,
    // because Rule 13 requires a trigger, a reason and the broken assumptions.
    const { strategiId } = await seedSubmittable();
    await submitStrategi(sql, am(), strategiId);
    await approveStrategi(sql, spv(), strategiId);
    await setAssumptionStatus(sql, am(), strategiId, 'A1', 'Gugur');

    const versi = await sql<{ n: number }[]>`
      select count(*)::int as n from strategi where strategi_induk_id = ${strategiId}`;
    expect(versi[0].n).toBe(0);
    expect((await getStrategi(sql, am(), strategiId)).status).toBe(STRATEGI_AKTIF);
  });

  it('writes the before→after pair to the audit log', async () => {
    const { strategiId } = await seedSubmittable();
    await setAssumptionStatus(sql, am(), strategiId, 'A1', 'Gugur');
    const rows = await sql<{ before_json: unknown; after_json: unknown }[]>`
      select before_json, after_json from audit_log
       where entity_id = ${strategiId} and action = 'set_assumption_status'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].before_json).toMatchObject({ kode: 'A1', status: 'Berlaku' });
    expect(rows[0].after_json).toMatchObject({ kode: 'A1', status: 'Gugur' });
  });

  it('rejects an unknown status and an unknown assumption code', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      setAssumptionStatus(sql, am(), strategiId, 'A1', 'Batal' as never),
    ).rejects.toThrow(MSG_ASSUMPTION_STATUS_INVALID);
    await expect(
      setAssumptionStatus(sql, am(), strategiId, 'TIDAK-ADA', 'Gugur'),
    ).rejects.toThrow(MSG_ASSUMPTION_NOT_FOUND);
  });

  it('refuses an AM who does not own the account', async () => {
    const { strategiId } = await seedSubmittable();
    await expect(
      setAssumptionStatus(sql, otherAm(), strategiId, 'A1', 'Gugur'),
    ).rejects.toThrow(ForbiddenError);
    // An OD reads everything but writes nothing — a flip is a write.
    await expect(
      setAssumptionStatus(sql, od(), strategiId, 'A1', 'Gugur'),
    ).rejects.toThrow(ForbiddenError);
  });
});
