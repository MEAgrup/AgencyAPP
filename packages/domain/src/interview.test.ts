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
// A second fixture client, used ONLY by the resume test: `openKelolaKlien`
// deliberately returns the client's open session, so a test about "the next click
// opens a fresh one" cannot share a client with tests that leave sessions open.
const CLI_RESUME = 'CLI-ZZI-0002';
const created: string[] = [];

afterAll(async () => {
  if (!sql) return;
  // interview_flag is append-only (trg_flag_frozen blocks UPDATE/DELETE), and it
  // is ON DELETE CASCADE from interview — so deleting a flagged interview needs
  // the freeze lifted for teardown only (resolvePrasyarat leaves a completion flag).
  await sql`alter table interview_flag disable trigger trg_flag_frozen`;
  try {
    // Delete by client_id (not just tracked ids) so the teardown is self-healing.
    await sql`delete from interview where client_id in (${CLI}, ${CLI_RESUME})`;
  } finally {
    await sql`alter table interview_flag enable trigger trg_flag_frozen`;
  }
  await sql`delete from clients where id in (${CLI}, ${CLI_RESUME})`;
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

  it('logs only scheduled/progressed interviews (blank Belum Dijadwalkan hidden); Account-scope; missing client 404', async () => {
    // A freshly created interview is 'Belum Dijadwalkan' — a blank attempt — and
    // must NOT clutter the log.
    const blank = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(blank.interview.id);
    // A scheduled one SHOULD appear.
    const sched = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(sched.interview.id);
    await interview.scheduleInterview(sql, OWNER, sched.interview.id, {
      tanggalWaktu: '2026-08-20T04:00:00.000Z',
      durasiMenit: 30,
    });

    const rows = await interview.listInterviewsByClient(sql, OWNER, CLI);
    expect(rows.some((r) => r.id === sched.interview.id)).toBe(true);
    expect(rows.some((r) => r.id === blank.interview.id)).toBe(false);
    expect(rows.every((r) => r.status !== iv.INTERVIEW_STATES.BelumDijadwalkan)).toBe(true);
    // Newest first (created_at desc).
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt >= rows[i].createdAt).toBe(true);
    }

    // The log is Account-scope: Sales and a non-owner Account staff are denied.
    await expect(interview.listInterviewsByClient(sql, SALES, CLI)).rejects.toThrow(/akses/);
    await expect(interview.listInterviewsByClient(sql, NONOWNER, CLI)).rejects.toThrow(/akses/);

    // A client that does not exist is a 404, not an empty list.
    await expect(interview.listInterviewsByClient(sql, OWNER, 'CLI-ZZI-9999')).rejects.toThrow(interview.MSG_NOT_FOUND);
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

// ===========================================================================
// Riset Awal — langkah 1 "Kelola Klien" (owner QA 2026-08-12)
// ===========================================================================
//
// The step exists to be MEASURED, so the tests are about the measurement being
// hard to fake: the clock starts with the session (not with a button), the
// anchors cannot be rewritten, the finish line cannot move, and the duration is
// derived — reproducible from the audit log alone.

dDb('riset awal (langkah 1)', () => {
  it('starts with the session: opening Kelola Klien anchors it, duration is null until submit', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);

    const ra = detail.risetAwal;
    expect(ra).not.toBeNull();
    expect(ra!.status).toBe(iv.RISET_AWAL_STATES.Berjalan);
    expect(ra!.dimulaiOleh).toBe(OWNER.employeeId);
    expect(ra!.disubmitPada).toBeNull();
    // Unfinished work has NO duration — not zero, which would flatter the metric.
    expect(ra!.durasiMenit).toBeNull();
    // The start anchor is the session's own creation instant, not a later click.
    expect(Math.abs(Date.parse(ra!.dimulaiPada) - Date.parse(detail.interview.createdAt))).toBeLessThan(2000);
  });

  it('submit closes the measurement and derives the duration from the two anchors', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    const done = await interview.submitRisetAwal(sql, OWNER, id);
    expect(done.status).toBe(iv.RISET_AWAL_STATES.Selesai);
    expect(done.disubmitPada).not.toBeNull();
    expect(done.disubmitOleh).toBe(OWNER.employeeId);
    expect(done.durasiMenit).toBe(iv.durasiRisetAwalMenit(done.dimulaiPada, done.disubmitPada));
    expect(done.durasiMenit).toBeGreaterThanOrEqual(0);

    // The same figure is served by the detail read — one derivation, not two.
    const reread = await interview.getInterview(sql, OWNER, id);
    expect(reread.risetAwal?.durasiMenit).toBe(done.durasiMenit);
    expect(reread.risetAwal?.disubmitPada).toBe(done.disubmitPada);
  });

  it('is recomputable from the audit log alone (house rule #4)', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;
    const done = await interview.submitRisetAwal(sql, OWNER, id);

    const rows = await sql<{ action: string; created_at: Date }[]>`
      select action, created_at from audit_log
       where entity_type = 'riset_awal' and entity_id = ${id}
       order by created_at asc, id asc`;
    const mulai = rows.find((r) => r.action === 'mulai');
    const submit = rows.find((r) => r.action === `transition:Berjalan->${iv.RISET_AWAL_STATES.Selesai}`);
    expect(mulai).toBeDefined();
    expect(submit).toBeDefined();
    // Throw the stored anchors away and rebuild the number from the log.
    expect(iv.durasiRisetAwalMenit(mulai!.created_at, submit!.created_at)).toBe(done.durasiMenit);
  });

  it('refuses a second submit — the finish line does not move', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;
    const first = await interview.submitRisetAwal(sql, OWNER, id);

    await expect(interview.submitRisetAwal(sql, OWNER, id)).rejects.toThrow(
      interview.MSG_RISET_AWAL_SUDAH_SUBMIT,
    );
    // The rejected attempt changed nothing.
    const after = await interview.getInterview(sql, OWNER, id);
    expect(after.risetAwal?.disubmitPada).toBe(first.disubmitPada);
  });

  it('write gate: assigned AM, Account lead and Director may submit; non-owner/Sales/OD may not', async () => {
    const mine = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(mine.interview.id);
    for (const denied of [NONOWNER, SALES, OD, OTHER]) {
      await expect(interview.submitRisetAwal(sql, denied, mine.interview.id)).rejects.toThrow(/akses/);
    }
    // Still running — no rejected caller left a mark.
    const untouched = await interview.getInterview(sql, OWNER, mine.interview.id);
    expect(untouched.risetAwal?.status).toBe(iv.RISET_AWAL_STATES.Berjalan);

    // The Account lead acts for the AM; a Director may too (separate sessions,
    // since submit is once-only).
    const byLead = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(byLead.interview.id);
    expect((await interview.submitRisetAwal(sql, ACC_LEAD, byLead.interview.id)).disubmitOleh).toBe(
      ACC_LEAD.employeeId,
    );

    const byDirector = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(byDirector.interview.id);
    expect((await interview.submitRisetAwal(sql, DIRECTOR, byDirector.interview.id)).status).toBe(
      iv.RISET_AWAL_STATES.Selesai,
    );
  });

  it('anchors are immutable at the DB, even on a direct service-role UPDATE', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    // Moving the start would silently shorten every duration derived from it.
    await expect(
      sql`update interview_riset_awal set dimulai_pada = now() - interval '5 days' where interview_id = ${id}`,
    ).rejects.toThrow(/dimulai_pada beku/);

    await interview.submitRisetAwal(sql, OWNER, id);

    await expect(
      sql`update interview_riset_awal set disubmit_pada = now() + interval '2 days' where interview_id = ${id}`,
    ).rejects.toThrow(/disubmit_pada beku/);
    // Selesai is terminal: it cannot be walked back to restart the clock.
    await expect(
      sql`update interview_riset_awal set status = 'Berjalan' where interview_id = ${id}`,
    ).rejects.toThrow(/terminal/);
  });

  it('a submitted riset awal makes the session visible in the log, with its duration', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    // Still blank + running: hidden, exactly as before this step existed.
    const before = await interview.listInterviewsByClient(sql, OWNER, CLI);
    expect(before.some((r) => r.id === id)).toBe(false);

    const done = await interview.submitRisetAwal(sql, OWNER, id);
    const after = await interview.listInterviewsByClient(sql, OWNER, CLI);
    const row = after.find((r) => r.id === id);
    // Submitting IS saved work, so the session now appears even though the
    // interview itself has not been scheduled yet.
    expect(row).toBeDefined();
    expect(row!.status).toBe(iv.INTERVIEW_STATES.BelumDijadwalkan);
    expect(row!.risetAwalStatus).toBe(iv.RISET_AWAL_STATES.Selesai);
    expect(row!.risetAwalDurasiMenit).toBe(done.durasiMenit);
  });

  it('openKelolaKlien resumes the open session instead of restarting the clock', async () => {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
      values (${CLI_RESUME}, 'PIC', 'Toko 2', 'Jakarta', 'https://t2.example', 'Fashion', 0, 0,
              'EMP-0006', 'EMP-0006', 'EMP-0001', 'EMP-0001')
      on conflict (id) do nothing`;

    const first = await interview.openKelolaKlien(sql, OWNER, { clientId: CLI_RESUME, serviceId: null });
    created.push(first.interview.id);

    // Clicking "Kelola Klien" again lands on the SAME session with the SAME start
    // anchor — otherwise the AM who comes back after two days of research would
    // have their work recorded as having taken seconds.
    const again = await interview.openKelolaKlien(sql, OWNER, { clientId: CLI_RESUME, serviceId: null });
    expect(again.interview.id).toBe(first.interview.id);
    expect(again.risetAwal?.dimulaiPada).toBe(first.risetAwal?.dimulaiPada);

    // Once the session is closed out, the next click opens a fresh one.
    await interview.transitionInterview(sql, ACC_LEAD, first.interview.id, iv.INTERVIEW_STATES.Dibatalkan, {
      alasanPembatalan: 'klien menunda',
    });
    const fresh = await interview.openKelolaKlien(sql, OWNER, { clientId: CLI_RESUME, serviceId: null });
    created.push(fresh.interview.id);
    expect(fresh.interview.id).not.toBe(first.interview.id);
    expect(fresh.risetAwal?.status).toBe(iv.RISET_AWAL_STATES.Berjalan);

    // Same write gate as createInterview.
    await expect(interview.openKelolaKlien(sql, NONOWNER, { clientId: CLI_RESUME })).rejects.toThrow(/akses/);
  });
});
