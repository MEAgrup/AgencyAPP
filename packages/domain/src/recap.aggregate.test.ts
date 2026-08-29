/**
 * D-03 part A — `wrr_aggregate(recap_id)` under the REAL schema.
 *
 * Seeds one client with all four divisions engaged, drives "reached status X
 * this week" through `audit_log` transition rows (the only source of a
 * per-status timestamp — house rule #2/#3), plus the append-only Ads logs, then
 * asserts the aggregator fills the read-only auto figures exactly per §4/§9:
 *
 *   RM-C  gmv_interim = Σ GMV Ads + GMV Live + affiliate ; ad_spend ; roas_ads
 *         (= GMV Ads ÷ spend) ; total_view (= Σ M10 viewers) ; and (T-3) the
 *         blended ctr/cvr/cpc/cpm from Σ raw clicks/impressions/conversions,
 *         `—` (NULL) when the denominator is 0/absent.
 *   RM-B  one production row per engaged division with the headline count +
 *         a rincian breakdown + brief movement.
 *
 * Also asserts the two invariants the aggregator must hold: it is idempotent
 * (re-running converges — house #4), and it never clobbers an AM `sengketa` note
 * (RM-B6/RM-C) on re-run.
 *
 * Runs system-side (no withClaims): the aggregator writes auto rows, which the
 * D-03 belt triggers permit only for a NULL JWT actor. Skipped unless
 * DATABASE_URL is set. IDs are per-run unique (the append-only `audit_log` rows
 * it seeds cannot be deleted); the entity rows are removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

// Per-run-unique namespace so re-runs never collide on the append-only audit_log
// rows (which cannot be deleted — forbid_mutation blocks DELETE).
const RUN = Date.now().toString(36).slice(-6);
const OWNER = `ZZG-${RUN}-O`;
const AM = `ZZG-${RUN}-AM`;
const CLI = `ZZG-CLI-${RUN}`;
const SVC = `ZZG-SVC-${RUN}`;
const RECAP = `ZZG-WRR-${RUN}`;
const BRF = { creative: `ZZG-BC-${RUN}`, ads: `ZZG-BA-${RUN}`, kol: `ZZG-BK-${RUN}`, live: `ZZG-BL-${RUN}` };
const AST = { video: `ZZG-AV-${RUN}`, gambar: `ZZG-AG-${RUN}` };
const BKG = `ZZG-BKG-${RUN}`;
const LSS = `ZZG-LSS-${RUN}`;
const ADC = `ZZG-ADC-${RUN}`;

// A weekday instant inside the recap's WIB week (24–30 Aug 2026): 05:00Z → 12:00 WIB, 26 Aug.
const IN_WEEK = '2026-08-26T05:00:00Z';

async function audit(entityType: string, entityId: string, to: string): Promise<void> {
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
    values (${entityType}, ${entityId}, ${OWNER}, ${'transition:[x]->' + to}, ${OWNER}, ${IN_WEEK})`;
}

async function seed(): Promise<void> {
  await sql`
    insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                         sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${CLI}, 'Aggregate Fixture', 'Rani', 'Bandung', 'Home Living', 'https://shopee/zzg',
            '0', '0', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})
    on conflict (id) do nothing`;
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name, standard_price,
                          commission_rule, status, created_by)
    values (${SVC}, ${CLI}, 'MSV-ZZG', 1, 'Full Management', '0', 'rule', 'Ongoing', ${OWNER})
    on conflict (id) do nothing`;
  // One brief per division so each is "engaged".
  await sql`insert into briefs (id, service_id, title, status, assigned_division, created_by)
            values (${BRF.creative}, ${SVC}, 'creative brief', '[Draft]', 'Creative', ${OWNER})
            on conflict (id) do nothing`;
  await sql`insert into briefs (id, service_id, title, status, assigned_division, created_by)
            values (${BRF.ads}, ${SVC}, 'ads brief', '[Draft]', 'Ads', ${OWNER})
            on conflict (id) do nothing`;
  await sql`insert into briefs (id, service_id, title, status, assigned_division, created_by)
            values (${BRF.kol}, ${SVC}, 'kol brief', '[Draft]', 'KOL', ${OWNER})
            on conflict (id) do nothing`;
  await sql`insert into briefs (id, service_id, title, status, assigned_division, created_by)
            values (${BRF.live}, ${SVC}, 'live brief', '[Draft]', 'Live Stream', ${OWNER})
            on conflict (id) do nothing`;

  // Creative: two assets reaching [Approved] this week — 1 Video (headline), 1 Gambar.
  await sql`insert into assets (id, brief_id, asset_type, sequence_no, created_by)
            values (${AST.video}, ${BRF.creative}, 'Video', 1, ${OWNER}) on conflict (id) do nothing`;
  await sql`insert into assets (id, brief_id, asset_type, sequence_no, created_by)
            values (${AST.gambar}, ${BRF.creative}, 'Gambar', 2, ${OWNER}) on conflict (id) do nothing`;
  await audit('asset', AST.video, '[Approved]');
  await audit('asset', AST.gambar, '[Approved]');
  // Creative brief movement: one [Submitted].
  await audit('brief', BRF.creative, '[Submitted]');

  // KOL: one booking [QC Passed] with affiliate GMV 2jt + one [Content Submitted].
  await sql`insert into creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate, attributed_gmv, created_by)
            values (${BKG}, ${BRF.kol}, 'Creator A', 'TikTok', 'Internal', '0', '2000000', ${OWNER})
            on conflict (id) do nothing`;
  await audit('creator_booking', BKG, '[QC Passed]');
  await audit('creator_booking', BKG, '[Content Submitted]');

  // Live: one session [Reconciled], GMV 11jt, 20k viewers, 5.5 hours.
  await sql`insert into live_stream_sessions
              (id, brief_id, platform, requested_datetime, target_duration_hours,
               actual_duration_hours, viewers_peak, gmv, created_by)
            values (${LSS}, ${BRF.live}, 'TikTok', ${IN_WEEK}, '6', '5.5', 20000, '11000000', ${OWNER})
            on conflict (id) do nothing`;
  await audit('live_stream_session', LSS, '[Reconciled]');

  // Ads: one campaign (direct client link) + one metric entry (period ends in week)
  // spend 6.1jt, GMV 28jt + one optimization action.
  await sql`insert into ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, created_by)
            values (${ADC}, ${BRF.ads}, ${CLI}, 'TikTok', 'Sales', '10000000', '2026-08-01', '2026-09-01', 'ROAS', ${OWNER})
            on conflict (id) do nothing`;
  // T-3: raw platform counts on the entry so the blended CTR/CVR/CPC/CPM compute.
  //   clicks 1000, impressions 50000, conversions 100.
  await sql`insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv,
              clicks, impressions, conversions, entry_method, entered_by, created_by)
            values (${`ZZG-MTR-${RUN}`}, ${ADC}, '2026-08-24', '2026-08-30', '6100000', '28000000',
              1000, 50000, 100, 'Manual', ${OWNER}, ${OWNER})
            on conflict (id) do nothing`;
  await sql`insert into optimization_logs (id, campaign_id, change_type, before_value, after_value, reason, actor, created_by, created_at)
            values (${`ZZG-OPT-${RUN}`}, ${ADC}, 'Budget', '1', '2', 'scale', ${OWNER}, ${OWNER}, ${IN_WEEK})
            on conflict (id) do nothing`;

  // The recap for this client + WIB week 24–30 Aug 2026.
  await sql`insert into weekly_result_recap
              (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
            values (${RECAP}, ${CLI}, null, 2026, 35, '2026-08-24', '2026-08-30', 'Terbuka', 'SYSTEM')
            on conflict (id) do nothing`;
}

async function metrik(): Promise<Record<string, { nilai: string | null; sumber: string }>> {
  const rows = await sql<{ metrik: string; nilai: string | null; sumber: string }[]>`
    select metrik, nilai, sumber from wrr_metrik where recap_id = ${RECAP}`;
  return Object.fromEntries(rows.map((r) => [r.metrik, { nilai: r.nilai, sumber: r.sumber }]));
}
async function divisi(): Promise<Record<string, { jumlah_produksi: number; rincian: Record<string, unknown> }>> {
  const rows = await sql<{ divisi: string; jumlah_produksi: number; rincian: Record<string, unknown> }[]>`
    select divisi, jumlah_produksi, rincian from wrr_divisi where recap_id = ${RECAP}`;
  return Object.fromEntries(rows.map((r) => [r.divisi, { jumlah_produksi: r.jumlah_produksi, rincian: r.rincian }]));
}

beforeAll(async () => {
  if (!sql) return;
  await seed();
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from metric_entries where campaign_id = ${ADC}`;
  await sql`delete from optimization_logs where campaign_id = ${ADC}`;
  await sql`delete from ad_campaigns where id = ${ADC}`;
  await sql`delete from assets where brief_id = ${BRF.creative}`;
  await sql`delete from creator_bookings where id = ${BKG}`;
  await sql`delete from live_stream_sessions where id = ${LSS}`;
  await sql`delete from wrr_metrik where recap_id = ${RECAP}`;
  await sql`delete from wrr_divisi where recap_id = ${RECAP}`;
  await sql`delete from weekly_result_recap where id = ${RECAP}`;
  await sql`delete from briefs where service_id = ${SVC}`;
  await sql`delete from services where id = ${SVC}`;
  await sql`delete from clients where id = ${CLI}`;
  await sql.end();
});

describeDb('wrr_aggregate — auto figures from M7/M8/M9/M10 (D-03)', () => {
  it('fills the consolidated otomatis metrics per §4/§9', async () => {
    await sql`select wrr_aggregate(${RECAP})`;
    const m = await metrik();
    // gmv_interim = Ads 28jt + Live 11jt + affiliate 2jt = 41jt (matches PRD §7 example).
    expect(Number(m.gmv_interim.nilai)).toBe(41000000);
    expect(m.gmv_interim.sumber).toBe('otomatis');
    expect(Number(m.ad_spend.nilai)).toBe(6100000);
    // roas_ads = 28jt / 6.1jt = 4.59 (rounded 2dp).
    expect(Number(m.roas_ads.nilai)).toBeCloseTo(4.59, 2);
    // total_view = Σ M10 viewers.
    expect(Number(m.total_view.nilai)).toBe(20000);
    // T-3: blended CTR/CVR/CPC/CPM from Σ raw counts (clicks 1000, impr 50000, conv 100).
    //   CTR = 1000/50000×100 = 2.00 ; CVR = 100/1000×100 = 10.00
    //   CPC = 6.1jt/1000 = 6100.00 ; CPM = 6.1jt/50000×1000 = 122000.00
    expect(Number(m.ctr.nilai)).toBeCloseTo(2.0, 2);
    expect(m.ctr.sumber).toBe('otomatis');
    expect(Number(m.cvr.nilai)).toBeCloseTo(10.0, 2);
    expect(Number(m.cpc.nilai)).toBeCloseTo(6100, 2);
    expect(Number(m.cpm.nilai)).toBeCloseTo(122000, 2);
    // T-4b: CPL blended = Σspend/Σconversions = 6.1jt/100 = 61000.00.
    expect(Number(m.cpl.nilai)).toBeCloseTo(61000, 2);
  });

  it('renders ROAS as `—` (NULL) on zero spend, never a divide error (house #7)', async () => {
    // A separate recap+client with a campaign but a zero-spend metric entry.
    const C2 = `ZZG-CLI2-${RUN}`, S2 = `ZZG-SVC2-${RUN}`, B2 = `ZZG-BA2-${RUN}`;
    const A2 = `ZZG-ADC2-${RUN}`, R2 = `ZZG-WRR2-${RUN}`;
    await sql`insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
              values (${C2}, 'Zero Spend', 'R', 'B', 'K', 'https://s/zzg2', '0','0', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})`;
    await sql`insert into services (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, created_by)
              values (${S2}, ${C2}, 'MSV-ZZG', 1, 's', '0', 'r', 'Ongoing', ${OWNER})`;
    await sql`insert into briefs (id, service_id, title, status, assigned_division, created_by)
              values (${B2}, ${S2}, 'ads', '[Draft]', 'Ads', ${OWNER})`;
    await sql`insert into ad_campaigns (id, brief_id, client_id, platform, objective, budget, start_date, end_date, target_kpi, created_by)
              values (${A2}, ${B2}, ${C2}, 'TikTok', 'Sales', '1', '2026-08-01', '2026-09-01', 'ROAS', ${OWNER})`;
    await sql`insert into metric_entries (id, campaign_id, period_start, period_end, spend, gmv, entry_method, entered_by, created_by)
              values (${`ZZG-MTR2-${RUN}`}, ${A2}, '2026-08-24', '2026-08-30', '0', '0', 'Manual', ${OWNER}, ${OWNER})`;
    await sql`insert into weekly_result_recap (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
              values (${R2}, ${C2}, null, 2026, 35, '2026-08-24', '2026-08-30', 'Terbuka', 'SYSTEM')`;
    await sql`select wrr_aggregate(${R2})`;
    const rows = await sql<{ nilai: string | null; sumber: string }[]>`
      select nilai, sumber from wrr_metrik where recap_id = ${R2} and metrik = 'roas_ads'`;
    expect(rows[0].nilai).toBeNull();
    expect(rows[0].sumber).toBe('otomatis');
    // T-3: no clicks/impressions/conversions on the entry ⇒ CTR/CVR/CPC/CPM = `—`
    // (NULL otomatis), never a divide error (house #7).
    const ratios = await sql<{ metrik: string; nilai: string | null }[]>`
      select metrik, nilai from wrr_metrik where recap_id = ${R2} and metrik in ('ctr','cvr','cpc','cpm','cpl')`;
    expect(ratios).toHaveLength(5);
    for (const r of ratios) expect(r.nilai).toBeNull();
    await sql`delete from metric_entries where campaign_id = ${A2}`;
    await sql`delete from ad_campaigns where id = ${A2}`;
    await sql`delete from wrr_metrik where recap_id = ${R2}`;
    await sql`delete from wrr_divisi where recap_id = ${R2}`;
    await sql`delete from weekly_result_recap where id = ${R2}`;
    await sql`delete from briefs where service_id = ${S2}`;
    await sql`delete from services where id = ${S2}`;
    await sql`delete from clients where id = ${C2}`;
  });

  it('fills one production row per engaged division with headline + breakdown', async () => {
    await sql`select wrr_aggregate(${RECAP})`;
    const d = await divisi();
    // Creative headline = # video = 1; breakdown carries both types + brief movement.
    expect(d.Creative.jumlah_produksi).toBe(1);
    expect((d.Creative.rincian as { video: number }).video).toBe(1);
    expect((d.Creative.rincian as { gambar: number }).gambar).toBe(1);
    expect((d.Creative.rincian as { brief: { submitted: number } }).brief.submitted).toBe(1);
    // KOL headline = # creator = 1; konten submitted = 1.
    expect(d.KOL.jumlah_produksi).toBe(1);
    expect((d.KOL.rincian as { konten_submitted: number }).konten_submitted).toBe(1);
    // Live headline = # live = 1; durasi 5.5 jam.
    expect(d['Live Stream'].jumlah_produksi).toBe(1);
    expect(Number((d['Live Stream'].rincian as { durasi_jam: number }).durasi_jam)).toBe(5.5);
    // Ads headline = # campaigns with a metric entry = 1; 1 optimization action.
    expect(d.Ads.jumlah_produksi).toBe(1);
    expect((d.Ads.rincian as { optimasi: number }).optimasi).toBe(1);
  });

  it('is idempotent and never clobbers a Sengketa note on re-run', async () => {
    await sql`select wrr_aggregate(${RECAP})`;
    // AM disputes the auto GMV (system connection stands in for the note here).
    await sql`update wrr_metrik set sengketa = 'GMV Ads belum termasuk retur'
              where recap_id = ${RECAP} and metrik = 'gmv_interim'`;
    await sql`update wrr_divisi set sengketa = 'harusnya 2 video'
              where recap_id = ${RECAP} and divisi = 'Creative'`;
    // Re-aggregate: values converge, dispute survives.
    await sql`select wrr_aggregate(${RECAP})`;
    const gmv = await sql<{ nilai: string; sengketa: string | null }[]>`
      select nilai, sengketa from wrr_metrik where recap_id = ${RECAP} and metrik = 'gmv_interim'`;
    expect(Number(gmv[0].nilai)).toBe(41000000);
    expect(gmv[0].sengketa).toContain('retur');
    const cre = await sql<{ jumlah_produksi: number; sengketa: string | null }[]>`
      select jumlah_produksi, sengketa from wrr_divisi where recap_id = ${RECAP} and divisi = 'Creative'`;
    expect(cre[0].jumlah_produksi).toBe(1);
    expect(cre[0].sengketa).toContain('2 video');
  });

  // M17 §5.2/§5.3 (LT-52/LT-55) — AI Optimizer's own division row + the
  // asset_type extension (`AI Video` / `Optimasi SKU`) on the SAME CTE the
  // Creative row above reads (`ca`, assets reaching [Approved] this week) —
  // confirms the extension doesn't leak into Creative's own counts either.
  it('AI Optimizer: SKU dioptimasi + AI video selesai count separately from Creative (M17 LT-52/LT-55)', async () => {
    const C3 = `ZZG-CLI3-${RUN}`, S3 = `ZZG-SVC3-${RUN}`, B3 = `ZZG-BAI-${RUN}`;
    const A1 = `ZZG-AAI1-${RUN}`, A2v = `ZZG-AAI2-${RUN}`, R3 = `ZZG-WRR3-${RUN}`;
    await sql`insert into clients (id, toko, nama_pic, kota, kategori, link_toko, gmv_baseline, target_gmv,
                sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
              values (${C3}, 'AI Opt Fixture', 'R', 'B', 'K', 'https://s/zzg3', '0', '0', ${OWNER}, ${OWNER}, ${AM}, now(), ${OWNER})`;
    await sql`insert into services (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, created_by)
              values (${S3}, ${C3}, 'MSV-ZZG', 1, 's', '0', 'r', 'Ongoing', ${OWNER})`;
    await sql`insert into briefs (id, service_id, title, status, assigned_division, created_by)
              values (${B3}, ${S3}, 'ai optimizer brief', '[Draft]', 'AI Optimizer', ${OWNER})`;
    // One Optimasi SKU asset + one AI Video asset, both reaching [Approved] this week.
    await sql`insert into assets (id, brief_id, asset_type, sequence_no, created_by)
              values (${A1}, ${B3}, 'Optimasi SKU', 1, ${OWNER})`;
    await sql`insert into assets (id, brief_id, asset_type, sequence_no, created_by)
              values (${A2v}, ${B3}, 'AI Video', 2, ${OWNER})`;
    await audit('asset', A1, '[Approved]');
    await audit('asset', A2v, '[Approved]');
    await sql`insert into weekly_result_recap (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
              values (${R3}, ${C3}, null, 2026, 35, '2026-08-24', '2026-08-30', 'Terbuka', 'SYSTEM')`;

    await sql`select wrr_aggregate(${R3})`;
    const rows = await sql<{ divisi: string; jumlah_produksi: number; rincian: Record<string, unknown> }[]>`
      select divisi, jumlah_produksi, rincian from wrr_divisi where recap_id = ${R3}`;
    const aiOpt = rows.find((r) => r.divisi === 'AI Optimizer');
    expect(aiOpt).toBeDefined();
    expect(aiOpt!.jumlah_produksi).toBe(2); // 1 SKU + 1 AI Video
    expect((aiOpt!.rincian as { sku_dioptimasi: number }).sku_dioptimasi).toBe(1);
    expect((aiOpt!.rincian as { ai_video_selesai: number }).ai_video_selesai).toBe(1);
    // No Creative row for a client that never had a Creative-division brief —
    // and the two new asset_type values must not leak into ANY Creative rincian.
    expect(rows.find((r) => r.divisi === 'Creative')).toBeUndefined();

    await sql`delete from assets where brief_id = ${B3}`;
    await sql`delete from wrr_divisi where recap_id = ${R3}`;
    await sql`delete from weekly_result_recap where id = ${R3}`;
    await sql`delete from briefs where service_id = ${S3}`;
    await sql`delete from services where id = ${S3}`;
    await sql`delete from clients where id = ${C3}`;
  });
});
