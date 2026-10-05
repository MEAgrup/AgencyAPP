/**
 * ADS-REVISI-UI (tim Advertiser, 2026-10-05) — docs/plan/PLAN_REVISI_UI_ADS_20261005.md.
 *
 * - R1 Budget Harian → Hari Iklan Aktif + Estimasi Budget Terpakai (turunan, recompute-from-log).
 * - R2 Tanggal Selesai opsional.
 * - R3 Target KPI diwarisi dari brief (Strategy STR- / baris Plan M6B).
 * - R4 Daftar kampanye `listCampaigns` (staff = milik sendiri; Lead Ads division-wide lewat RLS).
 * - R5 Aset kreatif opsional (submit brief + Mulai Iklan).
 *
 * Unit selalu jalan; integrasi dilewati kalau `DATABASE_URL` tidak diset.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission } from '@cdps/core';
import { createClient, withClaims, type Sql } from '@cdps/db';
import {
  ConflictError,
  ForbiddenError,
  MSG_LAUNCH_ASSETS_NOT_APPROVED,
  createCampaign,
  estimasiBudget,
  formatKpiWarisan,
  getCampaign,
  gmvTargetBelowStandard,
  hitungHariJeda,
  launchCampaign,
  linkAsset,
  listCampaigns,
  parseGmvTarget,
  parseRoasTarget,
  pauseCampaign,
  targetKpiBrief,
  ValidationError,
  type Actor,
  type CampaignInput,
} from './ads';
import { submitTask } from './task';

const adsStaff = (id = 'ZZ-ADV'): Actor => ({ employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const adsLead = (id = 'ZZ-ADSLEAD'): Actor => ({ employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const am = (id = 'ZZ-SINTA'): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const creativeStaff = (): Actor => ({ employeeId: 'ZZ-C', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });

const t = (iso: string, action: string) => ({ action, createdAt: new Date(iso) });
// 12:00 WIB = 05:00Z — jauh dari batas hari supaya tz tidak menggeser tanggal.
const wib = (ymd: string) => `${ymd}T05:00:00Z`;

// ---------------------------------------------------------------------------
// Unit.
// ---------------------------------------------------------------------------
describe('R1 hitungHariJeda / estimasiBudget (pure, recompute-from-log)', () => {
  it('jeda yang sudah dilanjutkan dihitung resume − pause (hari resume = hari tayang)', () => {
    const log = [
      t(wib('2026-10-01'), 'transition:[Setting]->[Active]'),
      t(wib('2026-10-03'), 'transition:[Active]->[Paused]'),
      t(wib('2026-10-05'), 'transition:[Paused]->[Active]'),
    ];
    expect(hitungHariJeda(log, '2026-10-06')).toBe(2); // 3 & 4 Okt
  });

  it('jeda yang masih berlangsung dihitung sampai batas, inklusif', () => {
    const log = [t(wib('2026-10-01'), 'transition:[Setting]->[Active]'), t(wib('2026-10-03'), 'transition:[Active]->[Paused]')];
    expect(hitungHariJeda(log, '2026-10-06')).toBe(4); // 3,4,5,6 Okt
  });

  it('jeda yang ditutup [Ended] dihitung sampai tanggal selesai iklan', () => {
    const log = [
      t(wib('2026-10-01'), 'transition:[Setting]->[Active]'),
      t(wib('2026-10-03'), 'transition:[Active]->[Paused]'),
      t(wib('2026-10-08'), 'transition:[Paused]->[Ended]'),
    ];
    expect(hitungHariJeda(log, '2026-10-06')).toBe(4);
  });

  it('beberapa jeda dijumlahkan; nol jeda = 0', () => {
    expect(hitungHariJeda([], '2026-10-06')).toBe(0);
    const log = [
      t(wib('2026-10-01'), 'transition:[Setting]->[Active]'),
      t(wib('2026-10-02'), 'transition:[Active]->[Paused]'),
      t(wib('2026-10-03'), 'transition:[Paused]->[Active]'),
      t(wib('2026-10-05'), 'transition:[Active]->[Paused]'),
      t(wib('2026-10-07'), 'transition:[Paused]->[Active]'),
    ];
    expect(hitungHariJeda(log, '2026-10-10')).toBe(3);
  });

  it('Estimasi Budget Terpakai = Budget Harian × (hari berjalan − hari jeda); "—" sebelum mulai', () => {
    const harian = money.parse('500000');
    const now = new Date(wib('2026-10-06'));
    const log = [
      t(wib('2026-10-01'), 'transition:[Setting]->[Active]'),
      t(wib('2026-10-03'), 'transition:[Active]->[Paused]'),
      t(wib('2026-10-05'), 'transition:[Paused]->[Active]'),
    ];
    const e = estimasiBudget(harian, { iklanSelesai: '', hariIklanBerjalan: 6 }, log, now);
    expect(e.hariIklanAktif).toBe(4);
    expect(e.estimasiBudgetTerpakai).toBe(2_000_000);
    expect(e.estimasiBudgetTerpakaiDisplay).toBe('Rp. 2.000.000,00');
    expect(estimasiBudget(harian, { iklanSelesai: '', hariIklanBerjalan: null }, [], now)).toEqual({
      hariIklanAktif: null, estimasiBudgetTerpakai: null, estimasiBudgetTerpakaiDisplay: '—',
    });
  });
});

describe('R3 formatKpiWarisan + parser berjangkar kata kunci', () => {
  const kosong = { targetGmv: null, targetRoas: null, targetCtr: null, targetCvr: null, catatanKpi: null, hasilDiharapkan: null };

  it('poin terstruktur Strategi menang, urutan tetap GMV/ROAS/CTR/CVR', () => {
    expect(formatKpiWarisan({ ...kosong, targetGmv: '20000000.00', targetRoas: '4.00', targetCtr: '1.500', catatanKpi: 'abaikan' }))
      .toEqual({ teks: 'GMV ≥ Rp 20.000.000 / ROAS ≥ 4x / CTR ≥ 1.5%', sumber: 'strategi' });
  });

  it('catatan Strategi bila tanpa poin terstruktur; lalu Hasil Diharapkan baris Plan; lalu kosong', () => {
    expect(formatKpiWarisan({ ...kosong, catatanKpi: ' ROAS 5x ' })).toEqual({ teks: 'ROAS 5x', sumber: 'strategi' });
    expect(formatKpiWarisan({ ...kosong, hasilDiharapkan: 'ROAS ≥ 6x' })).toEqual({ teks: 'ROAS ≥ 6x', sumber: 'plan' });
    expect(formatKpiWarisan(kosong)).toEqual({ teks: '', sumber: '' });
  });

  it('KPI gabungan terbaca per kata kunci, dan bentuk lama tetap terbaca', () => {
    const gabungan = 'GMV ≥ Rp 20.000.000 / ROAS ≥ 4x / CTR ≥ 1.5%';
    expect(parseRoasTarget(gabungan)).toBe(4);
    expect(parseGmvTarget(gabungan)).toBe(2_000_000_000n);
    expect(parseRoasTarget('4x ROAS')).toBe(4); // fallback seluruh string
    expect(parseGmvTarget('Rp 20.000.000 GMV')).toBe(2_000_000_000n);
    expect(gmvTargetBelowStandard(gabungan, money.parse('10000000'))).toBe(false); // 20jt ≥ 12jt
  });
});

// ---------------------------------------------------------------------------
// Integration.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const uid = (p: string): string => `${p}-ZZR-${Date.now() % 100000}-${seq++}`;

async function adsBrief(opts: { amId?: string; toko?: string } = {}): Promise<{ clientId: string; svcId: string; briefId: string }> {
  const clientId = uid('CLI');
  const svcId = uid('SVC');
  const briefId = uid('BRF');
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${clientId}, 'Bu Rina', ${opts.toko ?? clientId}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${opts.amId ?? 'ZZ-SINTA'}, 'ZZ-TEST')`;
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${svcId}, ${clientId}, 'MSV-X', 1, 'Svc', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
      quantity_target, priority, recurring, created_by)
    values (${briefId}, ${svcId}, 'Brief', '[In Progress]', 'Ads', 'Campaign', 1, 'High', false, 'ZZ-TEST')`;
  return { clientId, svcId, briefId };
}

const input = (o: Partial<CampaignInput> = {}): CampaignInput => ({
  platform: 'Shopee Ads', objective: 'Sales', budget: '500000', startDate: '2026-07-01',
  targetKpi: 'ROAS ≥ 4x', tipeIklan: 'GMV Max Product', ...o,
});

const klaim = (employeeId: string, division: string, level: string): string =>
  JSON.stringify({ app_metadata: { employee_id: employeeId, division, level, od: false, director: false } });

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from ad_campaign_assets where created_by like 'ZZ-%'`;
  await sql`delete from ad_campaigns where created_by like 'ZZ-%'`;
  await sql`delete from assets where created_by like 'ZZ-%'`;
  await sql`update briefs set strategy_id = null where created_by like 'ZZ-%'`;
  await sql`delete from strategy_plans where created_by like 'ZZ-%'`;
  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

describeDb('R2 — Tanggal Selesai opsional', () => {
  it('kampanye lahir tanpa end_date (NULL di DB, `\'\'` di domain); end < start tetap ditolak', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, input());
    expect(c.endDate).toBe('');
    const row = await sql<{ end_date: Date | null }[]>`select end_date from ad_campaigns where id = ${c.id}`;
    expect(row[0].end_date).toBeNull();
    expect((await getCampaign(sql, adsStaff(), c.id)).endDate).toBe('');
    const b = await createCampaign(sql, adsStaff(), briefId, input({ endDate: '2026-08-31' }));
    expect(b.endDate).toBe('2026-08-31');
    await expect(createCampaign(sql, adsStaff(), briefId, input({ endDate: '2026-06-01' }))).rejects.toBeInstanceOf(ValidationError);
  });
});

describeDb('R3 — Target KPI diwarisi dari brief', () => {
  it('KPI Strategi menimpa input Advertiser, dan lolos gerbang GMV karena milik AM', async () => {
    const { svcId, briefId } = await adsBrief();
    const strId = uid('STR');
    await sql`
      insert into strategy_plans (id, service_id, objective, target_kpi, divisions_involved, planned_brief_outline,
        timeline_start, timeline_end, status, created_by, target_gmv, target_roas)
      values (${strId}, ${svcId}, 'Naik', '', 'Ads', 'outline', '2026-07-01', '2026-09-30', '[Approved]', 'ZZ-SINTA',
        '8000000.00', '4.00')`;
    await sql`update briefs set strategy_id = ${strId} where id = ${briefId}`;

    expect(await targetKpiBrief(sql, adsStaff(), briefId)).toEqual({ targetKpi: 'GMV ≥ Rp 8.000.000 / ROAS ≥ 4x', sumber: 'strategi' });
    // GMV 8jt < lantai 12jt — Advertiser sendiri akan diblok, tetapi target ini dari AM.
    const c = await createCampaign(sql, adsStaff(), briefId, input({ targetKpi: '' }));
    expect(c.targetKpi).toBe('GMV ≥ Rp 8.000.000 / ROAS ≥ 4x');
    const d = await createCampaign(sql, adsStaff(), briefId, input({ targetKpi: 'ROAS ≥ 1x' }));
    expect(d.targetKpi).toBe('GMV ≥ Rp 8.000.000 / ROAS ≥ 4x'); // input diabaikan
  });

  it('tanpa KPI di brief, input manual wajib (fallback)', async () => {
    const { briefId } = await adsBrief();
    expect(await targetKpiBrief(sql, adsStaff(), briefId)).toEqual({ targetKpi: '', sumber: '' });
    await expect(createCampaign(sql, adsStaff(), briefId, input({ targetKpi: '' }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('targetKpiBrief digerbang: divisi lain ditolak', async () => {
    const { briefId } = await adsBrief();
    await expect(targetKpiBrief(sql, creativeStaff(), briefId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('R5 — aset kreatif opsional', () => {
  it('brief Ads bisa submit dengan kampanye TANPA aset; Mulai Iklan juga', async () => {
    const { briefId } = await adsBrief();
    await sql`update briefs set assigned_pic = 'ZZ-ADV' where id = ${briefId}`;
    await expect(submitTask(sql, adsStaff(), briefId)).rejects.toBeInstanceOf(ConflictError); // nol kampanye
    const c = await createCampaign(sql, adsStaff(), briefId, input());
    expect((await submitTask(sql, adsStaff(), briefId)).ok).toBe(true);
    await sql`update briefs set status = '[Approved]' where id = ${briefId}`;
    expect((await launchCampaign(sql, adsStaff(), c.id)).ok).toBe(true);
  });

  it('aset yang DITAUTKAN tetap harus [Approved] untuk Mulai Iklan', async () => {
    const { clientId, briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, input());
    const svc = uid('SVC');
    const cr = uid('BRF');
    const ast = uid('AST');
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
        standard_price, commission_rule, status, requires_strategy_plan, created_by)
      values (${svc}, ${clientId}, 'MSV-X', 1, 'Svc', '10000000.00', 'rule', '[In Execution]', false, 'ZZ-TEST')`;
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
        quantity_target, priority, recurring, created_by)
      values (${cr}, ${svc}, 'Brief', '[In Review]', 'Creative', 'Video', 1, 'High', false, 'ZZ-TEST')`;
    await sql`insert into assets (id, brief_id, asset_type, sequence_no, status, created_by)
      values (${ast}, ${cr}, 'Video', 1, '[Approved]', 'ZZ-TEST')`;
    await linkAsset(sql, adsStaff(), c.id, ast);
    await sql`update assets set status = '[Revision Requested]' where id = ${ast}`;
    await sql`update briefs set status = '[Approved]' where id = ${briefId}`;
    await expect(launchCampaign(sql, adsStaff(), c.id)).rejects.toThrow(MSG_LAUNCH_ASSETS_NOT_APPROVED);
  });
});

describeDb('R1 + R4 — estimasi budget & daftar kampanye', () => {
  const limaHariLalu = (): string => {
    const d = new Date(Date.now() - 5 * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
  };

  it('getCampaign: jeda yang masih berlangsung mengurangi hari aktif; AM melihat angka yang sama di bawah RLS', async () => {
    const { briefId } = await adsBrief();
    const c = await createCampaign(sql, adsStaff(), briefId, input());
    await sql`update briefs set status = '[Approved]' where id = ${briefId}`;
    await launchCampaign(sql, adsStaff(), c.id, { tanggal: limaHariLalu() });
    await pauseCampaign(sql, adsStaff(), c.id); // jeda mulai hari ini
    const got = await getCampaign(sql, adsStaff(), c.id);
    expect(got.hariIklanBerjalan).toBe(6);
    expect(got.hariIklanAktif).toBe(5);
    expect(got.estimasiBudgetTerpakaiDisplay).toBe('Rp. 2.500.000,00');
    // AM pemilik tidak melihat baris audit pause milik Advertiser (audit_log_select
    // per-aktor) — fungsi SECURITY DEFINER memberinya angka yang sama.
    const viaAm = await withClaims(sql, klaim('ZZ-SINTA', 'Account', 'staff'), (tx) => getCampaign(tx, am(), c.id));
    expect(viaAm.hariIklanAktif).toBe(5);
  });

  it('listCampaigns: staff = milik sendiri, Lead Ads = divisi (arm RLS baru), divisi lain = nol; cari nama klien/toko', async () => {
    const a = await adsBrief({ toko: 'Toko Batik Rina' });
    const b = await adsBrief({ toko: 'Gold Pigeon Store' });
    const milikAdv = await createCampaign(sql, adsStaff('ZZ-ADV'), a.briefId, input());
    const milikAdv2 = await createCampaign(sql, adsStaff('ZZ-ADV2'), b.briefId, input());

    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).filter((id) => id === milikAdv.id || id === milikAdv2.id).sort();

    const staff = await withClaims(sql, klaim('ZZ-ADV', 'Ads', 'staff'), (tx) => listCampaigns(tx, adsStaff('ZZ-ADV')));
    expect(ids(staff)).toEqual([milikAdv.id]);
    // Staff tidak bisa membuka milik orang lain lewat filter advertiser.
    const intip = await withClaims(sql, klaim('ZZ-ADV', 'Ads', 'staff'), (tx) =>
      listCampaigns(tx, adsStaff('ZZ-ADV'), { advertiser: 'ZZ-ADV2' }));
    expect(ids(intip)).toEqual([milikAdv.id]);

    const lead = await withClaims(sql, klaim('ZZ-ADSLEAD', 'Ads', 'lead'), (tx) => listCampaigns(tx, adsLead()));
    expect(ids(lead)).toEqual([milikAdv.id, milikAdv2.id].sort());
    const leadFilter = await withClaims(sql, klaim('ZZ-ADSLEAD', 'Ads', 'lead'), (tx) =>
      listCampaigns(tx, adsLead(), { advertiser: 'ZZ-ADV2' }));
    expect(ids(leadFilter)).toEqual([milikAdv2.id]);

    const creative = await withClaims(sql, klaim('ZZ-C', 'Creative', 'staff'), (tx) => listCampaigns(tx, creativeStaff()));
    expect(ids(creative)).toEqual([]);

    const cari = await withClaims(sql, klaim('ZZ-ADSLEAD', 'Ads', 'lead'), (tx) => listCampaigns(tx, adsLead(), { q: 'pigeon' }));
    expect(ids(cari)).toEqual([milikAdv2.id]);

    const row = lead.find((r) => r.id === milikAdv.id)!;
    expect(row.clientNama).toBe('Bu Rina');
    expect(row.clientToko).toBe('Toko Batik Rina');
    expect(row.budgetDisplay).toBe('Rp. 500.000,00');
    expect(row.estimasiBudgetTerpakaiDisplay).toBe('—'); // belum pernah Mulai Iklan
    expect(row.endDate).toBe('');
  });
});
