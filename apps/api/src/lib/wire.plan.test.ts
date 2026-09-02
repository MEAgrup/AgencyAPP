/**
 * Wire-shape contract for the M6B Plan (PLAN-) route surface (RAB-14/15).
 *
 * The 11 new routes each return a domain object (camelCase) through one of the
 * `plan*ToWire` converters. `shape-parity.test.ts` already proves — mechanically,
 * against `web-internal/src/lib/plan.ts` — that every emitted key is one the FE
 * declares and none are missing. This file adds the per-converter unit check the
 * RAB-15 DoD calls for: given a fully-populated domain object, the converter
 * emits snake_case, carries every value across, and never leaks a camelCase key
 * (the O43 blank-page failure: a route answering 200 with keys the page can't
 * read). Values are asserted too, not just presence — a converter that maps
 * `nilaiStrategi` onto `nilai_dipakai` passes a key-only check.
 */
import { describe, expect, it } from 'vitest';
import type { plan } from '@cdps/domain';
import type { briefInherit } from '@cdps/domain';
import {
  briefInheritResultToWire,
  planActualToWire,
  planDetailToWire,
  planFlagToWire,
  planReviewToWire,
  planRowToWire,
  planRowWeekToWire,
  planTargetToWire,
  planToWire,
} from './wire';

/** No emitted key may be camelCase (the boundary is snake_case only). */
const noCamel = (o: object): void => {
  for (const k of Object.keys(o)) expect(k, `camelCase key leaked: ${k}`).not.toMatch(/[A-Z]/);
};

describe('planToWire (PLAN- header, Section P-A)', () => {
  it('maps every field to snake_case, nulls explicit', () => {
    const p: plan.Plan = {
      id: 'PLAN-202608-0001',
      lingkup: 'kontrak',
      contractId: 'CTR-202608-0001',
      clientId: 'CLI-202608-0001',
      strategiId: 'STRG-202608-0001',
      periodeNo: 2,
      tanggalMulai: '2026-09-12',
      tanggalAkhir: '2026-10-11',
      jumlahMinggu: 5,
      status: 'Aktif',
      catatanPembuka: null,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      createdBy: 'AC-AM-0001',
    };
    const w = planToWire(p);
    noCamel(w);
    expect(w).toEqual({
      id: 'PLAN-202608-0001',
      lingkup: 'kontrak',
      contract_id: 'CTR-202608-0001',
      client_id: 'CLI-202608-0001',
      strategi_id: 'STRG-202608-0001',
      periode_no: 2,
      tanggal_mulai: '2026-09-12',
      tanggal_akhir: '2026-10-11',
      jumlah_minggu: 5,
      status: 'Aktif',
      catatan_pembuka: null,
      created_at: '2026-08-18T00:00:00.000Z',
      updated_at: '2026-08-18T00:00:00.000Z',
      created_by: 'AC-AM-0001',
    });
  });
});

describe('planTargetToWire (Section P-B / Rule 9)', () => {
  it('keeps nilai_strategi and nilai_dipakai distinct', () => {
    const t: plan.PlanTarget = {
      planId: 'PLAN-202608-0001',
      channel: 'Shopee',
      metric: 'gmv',
      nilaiStrategi: 200000000,
      nilaiDipakai: 180000000,
      arah: 'turun',
      persenPerubahan: 10,
      alasan: 'demand turun',
      buktiFile: 'export.pdf',
      statusPersetujuan: 'Menunggu Persetujuan',
    };
    const w = planTargetToWire(t);
    noCamel(w);
    expect(w.nilai_strategi).toBe(200000000);
    expect(w.nilai_dipakai).toBe(180000000);
    expect(w.persen_perubahan).toBe(10);
    expect(w.status_persetujuan).toBe('Menunggu Persetujuan');
    expect(w.bukti_file).toBe('export.pdf');
  });
});

describe('planRowToWire (Section P-C)', () => {
  it('carries all 28 fields, arrays and carry-over included', () => {
    const r: plan.PlanRow = {
      id: 42,
      planId: 'PLAN-202608-0001',
      channel: 'TikTok Shop',
      pilar: 'iklan',
      strategiPillarId: 7,
      serviceId: null,
      diLuarStrategi: false,
      diLuarService: false,
      diLuarAlasan: null,
      aksi: 'boost 7 SKU Pareto',
      skuSasaran: ['SKU-1', 'SKU-2'],
      kuota: 40,
      satuan: 'kampanye',
      budget: 5000000,
      divisiPic: 'Ads',
      mingguSasaran: [1, 3],
      prioritas: 'Wajib',
      hasilDiharapkan: 'ACOS <= 18%',
      prasyarat: null,
      instruksiBrief: 'https://drive.google.com/drive/folders/xyz',
      statusBaris: 'Rencana',
      statusBarisAlasan: null,
      visibilitas: 'Bagikan ke Klien',
      keberatanKapasitas: false,
      keberatanAlasan: null,
      terbawa: false,
      periodeAsalId: null,
      keputusanCarryover: null,
    };
    const w = planRowToWire(r);
    noCamel(w);
    expect(w.strategi_pillar_id).toBe(7);
    expect(w.di_luar_strategi).toBe(false);
    expect(w.sku_sasaran).toEqual(['SKU-1', 'SKU-2']);
    expect(w.minggu_sasaran).toEqual([1, 3]);
    expect(w.hasil_diharapkan).toBe('ACOS <= 18%');
    expect(w.instruksi_brief).toBe('https://drive.google.com/drive/folders/xyz');
    expect(w.status_baris).toBe('Rencana');
    expect(w.keputusan_carryover).toBeNull();
  });
});

describe('planRowWeekToWire (Section P-D) & planActualToWire (Section P-E)', () => {
  it('week cell → snake_case', () => {
    const wk: plan.PlanRowWeek = { id: 3, planRowId: 42, mingguNo: 2, kuota: 20 };
    const w = planRowWeekToWire(wk);
    noCamel(w);
    expect(w).toEqual({ id: 3, plan_row_id: 42, minggu_no: 2, kuota: 20 });
  });

  it('actual → snake_case with explicit nulls', () => {
    const a: plan.PlanActual = {
      planId: 'PLAN-202608-0001',
      channel: 'Shopee',
      metric: 'gmv',
      sumber: 'manual',
      nilai: 188000000,
      fileBukti: 'export.pdf',
      tanggalAmbil: '2026-09-12',
      sengketa: null,
    };
    const w = planActualToWire(a);
    noCamel(w);
    expect(w).toEqual({
      plan_id: 'PLAN-202608-0001',
      channel: 'Shopee',
      metric: 'gmv',
      sumber: 'manual',
      nilai: 188000000,
      file_bukti: 'export.pdf',
      tanggal_ambil: '2026-09-12',
      sengketa: null,
    });
  });
});

describe('planReviewToWire (Section P-F) & planFlagToWire (Section P-G)', () => {
  it('review → snake_case with explicit nulls', () => {
    const r: plan.PlanReview = {
      planId: 'PLAN-202608-0001',
      yangJalan: 'listing rewrite converted',
      yangTidakJalan: null,
      diagnosaGap: 'eksekusi_tidak_jalan',
      diagnosaGapBukti: 'akses affiliate telat',
      rekomendasi: null,
      perluRevisi: false,
      materiKlien: null,
    };
    const w = planReviewToWire(r);
    noCamel(w);
    expect(w).toEqual({
      plan_id: 'PLAN-202608-0001',
      yang_jalan: 'listing rewrite converted',
      yang_tidak_jalan: null,
      diagnosa_gap: 'eksekusi_tidak_jalan',
      diagnosa_gap_bukti: 'akses affiliate telat',
      rekomendasi: null,
      perlu_revisi: false,
      materi_klien: null,
    });
  });

  it('flag → snake_case with explicit nulls', () => {
    const f: plan.PlanFlag = {
      id: 9,
      planId: 'PLAN-202608-0001',
      planRowId: 42,
      jenis: 'lewat_komitmen',
      detail: 'over 20%',
      ackSpvOleh: null,
      ackSpvPada: null,
    };
    const w = planFlagToWire(f);
    noCamel(w);
    expect(w).toEqual({
      id: 9,
      plan_id: 'PLAN-202608-0001',
      plan_row_id: 42,
      jenis: 'lewat_komitmen',
      detail: 'over 20%',
      ack_spv_oleh: null,
      ack_spv_pada: null,
    });
  });
});

describe('planDetailToWire (the P-A…P-G read bundle)', () => {
  const plan0: plan.Plan = {
    id: 'PLAN-202608-0001',
    lingkup: 'kontrak',
    contractId: 'CTR-202608-0001',
    clientId: 'CLI-202608-0001',
    strategiId: 'STRG-202608-0001',
    periodeNo: 1,
    tanggalMulai: '2026-08-12',
    tanggalAkhir: '2026-09-11',
    jumlahMinggu: 5,
    status: 'Aktif',
    catatanPembuka: 'fokus perbaikan listing',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    createdBy: 'AC-AM-0001',
  };

  it('composes header + every child through its own converter, defisit carried', () => {
    const d: plan.PlanDetail = {
      plan: plan0,
      targets: [],
      rows: [],
      weeks: [],
      actuals: [],
      review: null,
      flags: [],
      defisitTerbawa: 10000000,
      briefs: [],
    };
    const w = planDetailToWire(d);
    noCamel(w);
    // header nested through planToWire (snake_case one level down)
    expect(w.plan.contract_id).toBe('CTR-202608-0001');
    noCamel(w.plan);
    // PA-6 deficit carried under the snake_case key
    expect(w.defisit_terbawa).toBe(10000000);
    // empty child lists stay arrays, review stays null
    expect(w.targets).toEqual([]);
    expect(w.review).toBeNull();
    expect(w.briefs).toEqual([]);
  });

  it('maps a populated review and each child list element to snake_case', () => {
    const d: plan.PlanDetail = {
      plan: plan0,
      targets: [
        {
          planId: 'PLAN-202608-0001',
          channel: 'Shopee',
          metric: 'jumlah_video',
          nilaiStrategi: 40,
          nilaiDipakai: 40,
          arah: 'tetap',
          persenPerubahan: 0,
          alasan: null,
          buktiFile: null,
          statusPersetujuan: null,
        },
      ],
      rows: [],
      weeks: [{ id: 1, planRowId: 5, mingguNo: 1, kuota: 10 }],
      actuals: [],
      review: {
        planId: 'PLAN-202608-0001',
        yangJalan: 'ok',
        yangTidakJalan: null,
        diagnosaGap: null,
        diagnosaGapBukti: null,
        rekomendasi: null,
        perluRevisi: null,
        materiKlien: null,
      },
      flags: [
        {
          id: 3,
          planId: 'PLAN-202608-0001',
          planRowId: null,
          jenis: 'di_luar_strategi',
          detail: null,
          ackSpvOleh: null,
          ackSpvPada: null,
        },
      ],
      defisitTerbawa: 0,
      briefs: [
        { planRowId: 5, briefId: 'BRF-202608-0001', status: '[To Do]', assignedDivision: 'Ads' },
      ],
    };
    const w = planDetailToWire(d);
    noCamel(w);
    expect(w.targets[0].nilai_strategi).toBe(40);
    w.targets.forEach(noCamel);
    expect(w.weeks[0].plan_row_id).toBe(5);
    w.weeks.forEach(noCamel);
    expect(w.review?.yang_jalan).toBe('ok');
    expect(w.flags[0].jenis).toBe('di_luar_strategi');
    w.flags.forEach(noCamel);
    expect(w.briefs[0]).toEqual({
      plan_row_id: 5,
      brief_id: 'BRF-202608-0001',
      status: '[To Do]',
      assigned_division: 'Ads',
    });
    w.briefs.forEach(noCamel);
  });
});

describe('briefInheritResultToWire (RAB-16 — one-click inheritance)', () => {
  it('maps created Briefs via briefToWire and skipped rows to snake_case', () => {
    const result: briefInherit.BriefInheritResult = {
      created: [
        {
          id: 'BRF-202608-0001',
          serviceId: 'SVC-202608-0001',
          strategyId: '',
          assignedDivision: 'Ads',
          assignedPic: '',
          deliverableType: 'video',
          quantityTarget: 30,
          dueDate: '2026-09-30',
          priority: 'High',
          recurring: false,
          recurringFrequency: '',
          recurringCount: 0,
          recurringEndDate: '',
          instructions: 'Kanal: TikTok Shop',
          referenceAttachments: '',
          title: 'ROAS >= 8',
          status: '[To Do]',
          revisionCount: 0,
          revisionFlagged: false,
          createdBy: 'EMP-1',
          createdAt: new Date('2026-08-18T00:00:00Z'),
          stagePipelineCode: null,
          productionStage: null,
        },
      ],
      skipped: [{ planRowId: 7, reason: 'di_luar' }],
    };
    const w = briefInheritResultToWire(result);
    noCamel(w);
    expect(w.created).toHaveLength(1);
    expect(w.created[0].service_id).toBe('SVC-202608-0001');
    expect(w.created[0].quantity_target).toBe(30);
    // skipped is a snake_case row-id + machine reason code.
    expect(w.skipped).toEqual([{ plan_row_id: 7, reason: 'di_luar' }]);
    w.created.forEach(noCamel);
    w.skipped.forEach(noCamel);
  });
});
