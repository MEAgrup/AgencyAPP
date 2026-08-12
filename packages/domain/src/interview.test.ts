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
  // interview_flag is append-only (trg_flag_frozen blocks UPDATE/DELETE), and it
  // is ON DELETE CASCADE from interview — so deleting a flagged interview needs
  // the freeze lifted for teardown only (resolvePrasyarat leaves a completion flag).
  await sql`alter table interview_flag disable trigger trg_flag_frozen`;
  try {
    // Delete by client_id (not just tracked ids) so the teardown is self-healing.
    await sql`delete from interview where client_id = ${CLI}`;
  } finally {
    await sql`alter table interview_flag enable trigger trg_flag_frozen`;
  }
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

  it('rejects an out-of-set schedule format with a BI message (not a 500), and accepts a valid one', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;
    const when = '2026-08-20T04:00:00.000Z';

    // A free-typed value like "online" trips ck_jadwal_format at the DB; the
    // domain guard turns that into a ValidationError (→400) BEFORE the insert.
    await expect(
      interview.scheduleInterview(sql, OWNER, id, { tanggalWaktu: when, format: 'online' }),
    ).rejects.toThrow(interview.MSG_INVALID_FORMAT);
    // A non-positive duration is likewise a 400, not a 500 (ck_jadwal_durasi).
    await expect(
      interview.scheduleInterview(sql, OWNER, id, { tanggalWaktu: when, durasiMenit: 0 }),
    ).rejects.toThrow(interview.MSG_INVALID_DURASI);
    // Neither rejected attempt moved the state.
    const still = await interview.getInterview(sql, OWNER, id);
    expect(still.interview.status).toBe(iv.INTERVIEW_STATES.BelumDijadwalkan);
    expect(still.jadwal).toBeNull();

    // A valid schedule persists and moves the interview to Terjadwal (format is
    // no longer collected by the UI, but the guard/column still accept a value).
    const ok = await interview.scheduleInterview(sql, OWNER, id, {
      tanggalWaktu: when,
      durasiMenit: 40,
      lokasiLink: 'https://meet.example/abc',
    });
    expect(ok.interview.status).toBe(iv.INTERVIEW_STATES.Terjadwal);
    expect(ok.jadwal?.lokasiLink).toBe('https://meet.example/abc');
    expect(ok.jadwal?.durasiMenit).toBe(40);
  });

  it('starts an interview directly (Belum Dijadwalkan → Sedang Berlangsung) with no schedule', async () => {
    // Client schedules shift unpredictably, so the AM must be able to start the
    // interview without first locking a jadwal (edges added 20260812000000).
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    expect(detail.interview.status).toBe(iv.INTERVIEW_STATES.BelumDijadwalkan);

    const started = await interview.transitionInterview(
      sql,
      OWNER,
      detail.interview.id,
      iv.INTERVIEW_STATES.SedangBerlangsung,
    );
    expect(started.interview.status).toBe(iv.INTERVIEW_STATES.SedangBerlangsung);
    expect(started.jadwal).toBeNull(); // never scheduled

    // Blok B answers are now editable (the point of starting early).
    const saved = await interview.saveAnswers(sql, OWNER, detail.interview.id, [
      { section: 'B2', fieldKey: 'B2-7', nilaiAngka: 40, sumberAngka: iv.SUMBER_ANGKA.KlienHitung },
    ]);
    expect(saved.answers.some((a) => a.fieldKey === 'B2-7')).toBe(true);
  });

  it('resolvePrasyarat flips prasyarat to selesai (AM only; Sales/non-owner forbidden)', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI, salesClosingId: 'EMP-0006' });
    created.push(detail.interview.id);
    // A bersyarat-scoring input (55..74, no deal-breaker): total 70. prasyarat starts 'jalan'.
    const input: iv.KualifikasiInput = {
      marginBersih: 40,
      marginBersihSumber: iv.SUMBER_ANGKA.KlienHitung,
      aov: 20_000_000n,
      ruangHarga: iv.RUANG_HARGA.TidakAda,
      modelBisnis: iv.MODEL_BISNIS.DistributorResmi,
      kesanggupanLonjakan: iv.KESANGGUPAN_LONJAKAN.Sanggup,
      siklusBeliUlang: iv.SIKLUS_BELI_ULANG.HabisPakai,
      pembedaProduk: iv.PEMBEDA_PRODUK.ProdukUmum,
      skuSiap: 40,
      penangananChat: iv.PENANGANAN_CHAT.TimKhusus,
      kecepatanApproval: iv.KECEPATAN_APPROVAL.BelumJelas,
      kesiapanAkses: iv.KESIAPAN_AKSES.Belum,
      omzet: 100_000_000n,
      targetOmzet: 200_000_000n,
      dayaTahanBudget: iv.DAYA_TAHAN_BUDGET.Enam,
    };
    const k = await interview.scoreInterview(sql, OWNER, detail.interview.id, input, { prasyaratStatus: 'jalan' });
    expect(k.verdictKualifikasi).toBe('bersyarat');
    expect(k.prasyaratStatus).toBe('jalan');

    // Sales and a non-owner Account staff cannot resolve it (write gate).
    await expect(interview.resolvePrasyarat(sql, SALES, detail.interview.id)).rejects.toThrow(/akses/);
    await expect(interview.resolvePrasyarat(sql, NONOWNER, detail.interview.id)).rejects.toThrow(/akses/);

    // The AM resolves it; the verdict surface now reports selesai, and the
    // immutable completion flag was appended (the duration anchor).
    const v = await interview.resolvePrasyarat(sql, OWNER, detail.interview.id);
    expect(v?.prasyaratStatus).toBe('selesai');
    const flags = await sql<{ n: number }[]>`
      select count(*)::int as n from interview_flag
       where interview_id = ${detail.interview.id} and kode = 'prasyarat_selesai'`;
    expect(flags[0].n).toBe(1);

    // Idempotent: resolving again appends no second completion flag.
    await interview.resolvePrasyarat(sql, OWNER, detail.interview.id);
    const flags2 = await sql<{ n: number }[]>`
      select count(*)::int as n from interview_flag
       where interview_id = ${detail.interview.id} and kode = 'prasyarat_selesai'`;
    expect(flags2[0].n).toBe(1);
  });
});
