/**
 * Modul Interview domain tests — the pure permission truth table (no DB) plus an
 * end-to-end create → answers → score integration (DB), proving the shell wires
 * the ONE core scorer through to a persisted verdict and the advisory
 * `kualifikasi_tidak_siap` ping.
 *
 * The 7-role read-scope parity (TS predicate == RLS) lives in
 * `interview.rls.test.ts`; this file covers the write path and the predicates
 * themselves.
 */
import { interview as iv, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { afterAll, describe, expect, it } from 'vitest';
import * as interview from './interview';
import type { Actor } from './account';

const actor = (employeeId: string, division: string, level: string, extra: { od?: boolean; director?: boolean } = {}): Actor => ({
  employeeId,
  divisi: division,
  role: permission.makeRole({ division, level, od: extra.od, director: extra.director }),
});

const OWNER = actor('EMP-0001', 'Account', 'staff');
const NONOWNER = actor('EMP-0002', 'Account', 'staff');
const ACC_LEAD = actor('EMP-0003', 'Account', 'lead');
const OD = actor('EMP-0004', '', 'staff', { od: true });
const DIRECTOR = actor('EMP-0005', '', 'staff', { director: true });
const SALES = actor('EMP-0006', 'Sales', 'staff');
const SALES_LEAD = actor('EMP-0007', 'Sales', 'lead');
const OTHER = actor('EMP-0008', 'Creative', 'staff');

describe('interview permission predicates', () => {
  const ownerAm = 'EMP-0001';
  const salesClosing = 'EMP-0006';

  it('canWriteInterview: assigned AM, Account lead, Director — not OD/Sales/other', () => {
    expect(interview.canWriteInterview(OWNER, ownerAm)).toBe(true);
    expect(interview.canWriteInterview(ACC_LEAD, ownerAm)).toBe(true);
    expect(interview.canWriteInterview(DIRECTOR, ownerAm)).toBe(true);
    expect(interview.canWriteInterview(NONOWNER, ownerAm)).toBe(false);
    expect(interview.canWriteInterview(OD, ownerAm)).toBe(false); // OD is read-only
    expect(interview.canWriteInterview(SALES, ownerAm)).toBe(false);
    expect(interview.canWriteInterview(OTHER, ownerAm)).toBe(false);
  });

  it('canReadInterview (full): Account scope + read-all; never Sales/other', () => {
    for (const a of [OWNER, ACC_LEAD, OD, DIRECTOR]) expect(interview.canReadInterview(a, ownerAm)).toBe(true);
    for (const a of [NONOWNER, SALES, SALES_LEAD, OTHER]) expect(interview.canReadInterview(a, ownerAm)).toBe(false);
  });

  it('canReadVerdict: full-read set PLUS Sales lead and the closing salesperson', () => {
    for (const a of [OWNER, ACC_LEAD, OD, DIRECTOR, SALES_LEAD]) expect(interview.canReadVerdict(a, ownerAm, salesClosing)).toBe(true);
    expect(interview.canReadVerdict(SALES, ownerAm, salesClosing)).toBe(true); // is the closing sales
    expect(interview.canReadVerdict(SALES, ownerAm, 'EMP-9999')).toBe(false); // different closing sales
    expect(interview.canReadVerdict(NONOWNER, ownerAm, salesClosing)).toBe(false);
    expect(interview.canReadVerdict(OTHER, ownerAm, salesClosing)).toBe(false);
  });
});

// --- Integration: create → answers → score → verdict ------------------------

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const CLI = 'CLI-ZZI-0001';
const created: string[] = [];

afterAll(async () => {
  if (!sql) return;
  for (const id of created) await sql`delete from interview where id = ${id}`;
  await sql`delete from clients where id = ${CLI}`;
  await sql.end();
});

dDb('interview write path (integration)', () => {
  it('creates, saves answers, scores tidak_siap on a deal-breaker, and exposes the verdict', async () => {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
      values (${CLI}, 'PIC', 'Toko', 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
              'EMP-0006', 'EMP-0006', 'EMP-0001', 'EMP-0001')
      on conflict (id) do nothing`;

    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI, salesClosingId: 'EMP-0006' });
    created.push(detail.interview.id);
    expect(detail.interview.id).toMatch(/^ITV-\d{6}-\d{4}$/);
    expect(detail.interview.status).toBe(iv.INTERVIEW_STATES.BelumDijadwalkan);

    await interview.saveAnswers(sql, OWNER, detail.interview.id, [
      { section: 'B2', fieldKey: 'B2-7', nilaiAngka: 40, sumberAngka: iv.SUMBER_ANGKA.KlienHitung },
    ]);

    // Dropship → deal-breaker → tidak_siap.
    const input: iv.KualifikasiInput = {
      marginBersih: 40,
      marginBersihSumber: iv.SUMBER_ANGKA.KlienHitung,
      aov: 20_000_000n,
      ruangHarga: iv.RUANG_HARGA.MasihAdaRuang,
      modelBisnis: iv.MODEL_BISNIS.Dropship,
      kesanggupanLonjakan: iv.KESANGGUPAN_LONJAKAN.Sanggup,
      siklusBeliUlang: iv.SIKLUS_BELI_ULANG.HabisPakai,
      pembedaProduk: iv.PEMBEDA_PRODUK.PembedaJelas,
      skuSiap: 40,
      penangananChat: iv.PENANGANAN_CHAT.TimKhusus,
      kecepatanApproval: iv.KECEPATAN_APPROVAL.SatuOrangJelas,
      kesiapanAkses: iv.KESIAPAN_AKSES.Penuh,
      omzet: 100_000_000n,
      targetOmzet: 200_000_000n,
      dayaTahanBudget: iv.DAYA_TAHAN_BUDGET.Enam,
    };
    const k = await interview.scoreInterview(sql, OWNER, detail.interview.id, input);
    expect(k.verdictKualifikasi).toBe('tidak_siap');

    // The AM (owner) sees the verdict; a non-owner Account staff is forbidden.
    const v = await interview.getInterviewVerdict(sql, OWNER, detail.interview.id);
    expect(v?.verdict).toBe('tidak_siap');
    await expect(interview.getInterviewVerdict(sql, NONOWNER, detail.interview.id)).rejects.toThrow(/akses/);
  });

  it('refuses a non-owner Account staff from opening an interview', async () => {
    await expect(interview.createInterview(sql, NONOWNER, { clientId: CLI })).rejects.toThrow(/akses/);
  });
});
