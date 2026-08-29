/**
 * M16/M17 — uji lintas-stream wajib (docs/handoff/PARALEL_M16_DUA_AKUN.md §5),
 * dijalankan sebagai bagian dari langkah penggabungan Akun B. Tidak duplikat
 * cakupan `stage.test.ts` (Akun A) / `recap.aggregate.test.ts` (Akun B) — ini
 * SATU jalur yang menyentuh KEDUA stream sekaligus: Brief AI Optimizer
 * berjalan lewat pipeline tahapan (mesin Akun A, `stage.ts`/`stage_pipeline`
 * seed) sampai deliverable-nya (Asset `asset_type='Optimasi SKU'`) terhitung
 * di Rekap Hasil Mingguan (fungsi agregat Akun B, `wrr_aggregate`).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { insertBrief } from './account';
import { advanceStage, reviewBrief } from './stage';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const director = () => ({ employeeId: 'ZZX-DIR', role: permission.makeRole({ director: true }) });

let seq = 0;
const uid = (p: string) => `${p}-ZZX-${Date.now() % 100000}-${seq++}`;

async function insEmployee(id: string): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${`${id}@zzx.test`}, 'Management', 'Director', true, 'ZZX-TEST')
    on conflict (employee_id) do nothing`;
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from assets where created_by like 'ZZX-%'`;
  await sql`delete from brief_review where actor_employee_id like 'ZZX-%'`;
  await sql`delete from wrr_divisi where recap_id like '%ZZX%'`;
  await sql`delete from weekly_result_recap where id like '%ZZX%'`;
  await sql`delete from briefs where created_by like 'ZZX-%'`;
  await sql`delete from services where created_by like 'ZZX-%'`;
  await sql`delete from clients where created_by like 'ZZX-%'`;
  await sql`delete from employees where employee_id like 'ZZX-%'`;
});

describeDb('Uji lintas-stream #4 — pipeline AI Optimizer (Akun A) ↔ asset_type + wrr_aggregate (Akun B)', () => {
  it('a Brief AI Optimizer (Optimasi SKU) drives the REAL stage pipeline to its terminal, and its approved Asset counts in Rekap Hasil Mingguan', async () => {
    await insEmployee('ZZX-DIR');
    const clientId = uid('CLI');
    const serviceId = uid('SVC');
    const now = new Date('2026-08-26T05:00:00Z'); // a weekday inside a WIB week
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
        total_sales, sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
      values (${clientId}, 'PIC', ${clientId}, 'Bandung', 'link', 'Fashion', '0', '0', '0',
        'ZZX-BUDI', 'ZZX-BUDI', 'ZZX-AM', now(), 'ZZX-TEST')`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
        standard_price, commission_rule, status, requires_strategy_plan, created_by)
      values (${serviceId}, ${clientId}, 'MSV-X', 1, 'Optimasi SKU', '5000000.00', 'rule', '[In Execution]', false, 'ZZX-TEST')`;

    // 1) Birth: account.insertBrief resolves the (division, deliverable_type)
    //    pipeline PURELY from data (stage.resolvePipeline) — this is the exact
    //    cross-stream seam: Akun A's stage_pipeline/stage_definition rows for
    //    AI_OPT_SKU must exist for this to set a real production_stage.
    const brief = await insertBrief(sql, director(), {
      serviceId, strategyId: null, planRowId: null, now,
      input: {
        title: 'Optimasi 7 SKU Pareto', assignedDivision: 'AI Optimizer', deliverableType: 'Optimasi SKU',
        quantityTarget: 7, dueDate: '2026-09-15', priority: 'High',
      },
    });
    expect(brief.stagePipelineCode).toBe('AI_OPT_SKU');
    expect(brief.productionStage).toBe('Cek Brief AM');

    // 2) Cek Brief AM (Akun A stage.ts) — Terima & proses. This ALREADY drives
    //    the machine one edge forward, to 'Ambil SKU' (reviewBrief's own
    //    nextStageAfterIntake) — advanceStage picks up from there.
    await reviewBrief(sql, director(), brief.id, { keputusan: 'Diterima' });

    // 3) Advance through the REAL pipeline to its terminal ('Terapkan').
    for (const to of ['Riset', 'Perbaikan', 'QC', 'Approve', 'Terapkan']) {
      const res = await advanceStage(sql, director(), brief.id, to);
      expect(res.ok).toBe(true);
    }
    const stageRow = await sql<{ production_stage: string }[]>`
      select production_stage from briefs where id = ${brief.id}`;
    expect(stageRow[0].production_stage).toBe('Terapkan');

    // 4) The deliverable (M7 Asset, asset_type='Optimasi SKU' — LT-52's new
    //    value) reaches [Approved] this week — independent of the tahapan
    //    machine (house rule #2: production_stage and status never share a
    //    column).
    const assetId = uid('AST');
    await sql`insert into assets (id, brief_id, asset_type, sequence_no, status, created_by)
              values (${assetId}, ${brief.id}, 'Optimasi SKU', 1, '[Approved]', 'ZZX-TEST')`;
    await sql`insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_by, created_at)
              values ('asset', ${assetId}, 'ZZX-TEST', 'transition:[In Review]->[Approved]', 'ZZX-TEST', ${now})`;

    // 5) Rekap Hasil Mingguan (Akun B, wrr_aggregate) counts it under the
    //    'AI Optimizer' division row — the actual merge point of both streams.
    const recapId = uid('WRR');
    await sql`insert into weekly_result_recap (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
              values (${recapId}, ${clientId}, null, 2026, 35, '2026-08-24', '2026-08-30', 'Terbuka', 'SYSTEM')`;
    await sql`select wrr_aggregate(${recapId})`;
    const rows = await sql<{ divisi: string; jumlah_produksi: number; rincian: Record<string, unknown> }[]>`
      select divisi, jumlah_produksi, rincian from wrr_divisi where recap_id = ${recapId}`;
    const aiOpt = rows.find((r) => r.divisi === 'AI Optimizer');
    expect(aiOpt).toBeDefined();
    expect(aiOpt!.jumlah_produksi).toBe(1);
    expect((aiOpt!.rincian as { sku_dioptimasi: number }).sku_dioptimasi).toBe(1);
  });
});
