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
import { confirmIsian, getBaseline, submitBaseline } from './riset-awal';
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
// A Shopee-only client for the RAB-07 anti-deadlock case (no analysis engine).
const CLI_SHOPEE = 'CLI-ZZI-0003';
// A client WITH a positive Target GMV, used only by the B1-5/B6-3 authority test
// (QA 2026-08-20) — target_gmv > 0 is what makes B6-3 auto-fill from client data.
const CLI_TARGET = 'CLI-ZZI-0004';
const ALL_CLI = [CLI, CLI_RESUME, CLI_SHOPEE, CLI_TARGET];
const created: string[] = [];

afterAll(async () => {
  if (!sql) return;
  // interview_flag is append-only (trg_flag_frozen blocks UPDATE/DELETE), and it
  // is ON DELETE CASCADE from interview — so deleting a flagged interview needs
  // the freeze lifted for teardown only (resolvePrasyarat leaves a completion flag).
  await sql`alter table interview_flag disable trigger trg_flag_frozen`;
  try {
    // Delete by client_id (not just tracked ids) so the teardown is self-healing.
    // Interview deletion cascades to interview_riset_awal → riset_awal_analisa /
    // interview_riset_awal_isian, which must go before client_platforms (analisa
    // FKs a platform row with no cascade of its own).
    await sql`delete from interview where client_id in ${sql(ALL_CLI)}`;
  } finally {
    await sql`alter table interview_flag enable trigger trg_flag_frozen`;
  }
  await sql`delete from client_platforms where client_id in ${sql(ALL_CLI)}`;
  await sql`delete from clients where id in ${sql(ALL_CLI)}`;
  await sql.end();
});

/**
 * seedManualBaseline records a MANUAL baseline for every active platform of the
 * client (creating a Shopee platform if the client has none), leaving the
 * auto-filled isian UNCONFIRMED. Manual works for any marketplace, so a
 * Shopee-only client is served without a TikTok analysis (anti-deadlock, RAB-07).
 */
async function seedManualBaseline(a: Actor, interviewId: string, clientId: string): Promise<void> {
  const plats = await sql<{ id: number }[]>`
    select id from client_platforms where client_id = ${clientId} and active = true order by id`;
  let ids = plats.map((p) => Number(p.id));
  if (ids.length === 0) {
    const ins = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, active, created_by)
      values (${clientId}, 'Shopee', true, ${a.employeeId}) returning id`;
    ids = [Number(ins[0].id)];
  }
  for (const pid of ids) {
    const has = await sql`select 1 from riset_awal_analisa where interview_id = ${interviewId} and client_platform_id = ${pid}`;
    if (has.length === 0) {
      await submitBaseline(sql, a, interviewId, {
        clientPlatformId: pid,
        manual: { gmvBulan: 5_000_000, order: 120, aov: 41_666, skuTotal: 15, belanjaIklan: 500_000, roas: 3.2 },
      });
    }
  }
}

/**
 * completeRisetAwal makes an interview satisfy the RAB-07 start gate: it seeds a
 * manual baseline for every active platform, confirms the auto-filled isian, and —
 * when `submit` is set — submits the riset awal step. Split from the timeline tests
 * so those can drive their own `submitRisetAwal` for the SLA anchor.
 */
async function completeRisetAwal(
  a: Actor,
  interviewId: string,
  clientId: string,
  opts: { submit?: boolean } = {},
): Promise<void> {
  await seedManualBaseline(a, interviewId, clientId);
  const view = await getBaseline(sql, a, interviewId);
  await confirmIsian(
    sql,
    a,
    interviewId,
    view.isian.map((f) => ({
      section: f.section,
      fieldKey: f.fieldKey,
      nilaiTeks: f.nilaiTeks,
      nilaiAngka: f.nilaiAngka,
      nilaiUang: f.nilaiUang,
      dikonfirmasi: true,
    })),
  );
  if (opts.submit) await interview.submitRisetAwal(sql, a, interviewId);
}

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
    // A scheduled one SHOULD appear. Scheduling now requires riset awal complete
    // (RAB-07), so finish it first.
    const sched = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(sched.interview.id);
    await completeRisetAwal(OWNER, sched.interview.id, CLI, { submit: true });
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
    // Moving off Belum Dijadwalkan now needs riset awal complete (RAB-07).
    await completeRisetAwal(OWNER, id, CLI, { submit: true });
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

    // Starting the meeting still needs riset awal complete first (RAB-07), but no
    // jadwal — the direct-start path stays available once the prerequisite is met.
    await completeRisetAwal(OWNER, detail.interview.id, CLI, { submit: true });
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

// ===========================================================================
// Timeline SLA tiga langkah (keputusan pemilik 2026-08-13)
// ===========================================================================
//
// The owner's numbers: Riset Awal 2–3, Interview Meeting 1–2, Brand Strategy 5–7
// WORKING days. What matters here is that the anchors are the ones the owner
// named, that a step nobody has reached is `belum_mulai` rather than on time, and
// that the anchors cannot be nudged afterwards.

dDb('timeline kelola klien (langkah 1–3)', () => {
  it('reports three steps with the owner thresholds, all unstarted on a fresh session', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);

    const t = await interview.getKelolaKlienTimeline(sql, OWNER, detail.interview.id);
    expect(t.langkah.map((s) => [s.langkah, s.nama, s.targetHari, s.batasHari])).toEqual([
      [1, 'Riset Awal', 2, 3],
      [2, 'Interview Meeting', 1, 2],
      [3, 'Brand Strategy', 5, 7],
    ]);
    // Step 1's clock is already running (it started with the session); 2 and 3
    // have not been reached, so they are `belum_mulai` — not a passing grade.
    expect(t.langkah[0].status).toBe(iv.SLA_STATUS.TepatWaktu);
    expect(t.langkah[0].selesai).toBe(false);
    expect(t.langkah[1].status).toBe(iv.SLA_STATUS.BelumMulai);
    expect(t.langkah[1].hariKerja).toBeNull();
    expect(t.langkah[2].status).toBe(iv.SLA_STATUS.BelumMulai);
  });

  it('walks the anchors: riset awal submit starts step 2, starting the interview closes it', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    // Baseline + confirm so the start gate (RAB-07) passes; the test drives the
    // riset awal timing submit itself, since that is the SLA anchor under test.
    await completeRisetAwal(OWNER, id, CLI);
    await interview.submitRisetAwal(sql, OWNER, id);
    const afterRiset = await interview.getKelolaKlienTimeline(sql, OWNER, id);
    expect(afterRiset.langkah[0].selesai).toBe(true);
    // Step 2's clock now runs from the riset awal submit — the owner's anchor.
    expect(afterRiset.langkah[1].mulaiPada).toBe(afterRiset.langkah[0].selesaiPada);
    expect(afterRiset.langkah[1].selesai).toBe(false);

    // "Meeting didapatkan" — here via the start-without-a-schedule path, which is
    // still a secured meeting and must not be counted as a missed one.
    await interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.SedangBerlangsung);
    const afterStart = await interview.getKelolaKlienTimeline(sql, OWNER, id);
    expect(afterStart.langkah[1].selesai).toBe(true);
    expect(afterStart.langkah[1].selesaiPada).not.toBeNull();
    expect(afterStart.langkah[1].status).toBe(iv.SLA_STATUS.TepatWaktu);
    // Step 3 still has not started: the interview is not finished.
    expect(afterStart.langkah[2].status).toBe(iv.SLA_STATUS.BelumMulai);
  });

  it('starts step 3 when the interview completes, and its anchors are frozen', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    await completeRisetAwal(OWNER, id, CLI); // RAB-07 gate before the meeting can start
    await interview.submitRisetAwal(sql, OWNER, id);
    await interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.SedangBerlangsung);
    await interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.DraftIsian);
    await interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.Diajukan);
    await interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.Selesai);

    const t = await interview.getKelolaKlienTimeline(sql, OWNER, id);
    expect(t.langkah[2].mulaiPada).not.toBeNull(); // interview selesai_pada
    expect(t.langkah[2].selesai).toBe(false); // no strategy submitted yet
    expect(t.langkah[2].status).toBe(iv.SLA_STATUS.TepatWaktu); // day 0 of 5–7

    // Both anchors are frozen at the DB, so a later edit cannot make a late
    // session look punctual.
    await expect(
      sql`update interview set selesai_pada = now() - interval '9 days' where id = ${id}`,
    ).rejects.toThrow(/selesai_pada beku/);
    await expect(
      sql`update interview set meeting_diamankan_pada = now() where id = ${id}`,
    ).rejects.toThrow(/meeting_diamankan_pada beku/);
  });

  it('counts WORKING days: a registered national holiday does not count against the AM', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    // Backdate the start anchor by raw SQL BEFORE it is frozen (a fresh row has
    // no submit anchor, and `dimulai_pada` is immutable — so this fixture is set
    // up by re-inserting rather than updating).
    await sql`delete from interview_riset_awal where interview_id = ${id}`;
    await sql`
      insert into interview_riset_awal (interview_id, dimulai_pada, dimulai_oleh)
      values (${id}, now() - interval '7 days', ${OWNER.employeeId})`;

    const before = await interview.getKelolaKlienTimeline(sql, OWNER, id);
    const hariKerjaAwal = before.langkah[0].hariKerja!;
    expect(hariKerjaAwal).toBeGreaterThan(0);

    // Register every one of the last 7 calendar days as a holiday: the elapsed
    // working-day count must collapse to zero.
    await sql`
      insert into hari_libur (tanggal, keterangan, created_by)
      select d::date, 'CI libur', 'CI'
        from generate_series(current_date - interval '8 days', current_date, interval '1 day') g(d)
      on conflict (tanggal) do nothing`;
    try {
      const after = await interview.getKelolaKlienTimeline(sql, OWNER, id);
      expect(after.langkah[0].hariKerja).toBe(0);
      expect(after.langkah[0].status).toBe(iv.SLA_STATUS.TepatWaktu);
    } finally {
      await sql`delete from hari_libur where created_by = 'CI'`;
    }
    // Calendar restored ⇒ the original count is back. The holiday table is the
    // only thing that moved, never the anchors.
    const restored = await interview.getKelolaKlienTimeline(sql, OWNER, id);
    expect(restored.langkah[0].hariKerja).toBe(hariKerjaAwal);
  });

  it('flags a genuinely overdue step as terlambat while it is still running', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    // 20 calendar days back is at least 3 working days under any calendar, so the
    // 2–3 day step is past its limit — without the AM ever submitting.
    await sql`delete from interview_riset_awal where interview_id = ${id}`;
    await sql`
      insert into interview_riset_awal (interview_id, dimulai_pada, dimulai_oleh)
      values (${id}, now() - interval '20 days', ${OWNER.employeeId})`;

    const t = await interview.getKelolaKlienTimeline(sql, OWNER, id);
    expect(t.langkah[0].selesai).toBe(false);
    expect(t.langkah[0].hariKerja).toBeGreaterThan(3);
    expect(t.langkah[0].status).toBe(iv.SLA_STATUS.Terlambat);
  });

  it('marks a BACKFILLED riset awal tidak_berlaku — shown, never judged', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    // Re-create the row the way migration 20260812100000 §4 backfills a session
    // that predates the step: long-running AND retroaktif.
    await sql`delete from interview_riset_awal where interview_id = ${id}`;
    await sql`
      insert into interview_riset_awal (interview_id, dimulai_pada, dimulai_oleh, retroaktif)
      values (${id}, now() - interval '30 days', ${OWNER.employeeId}, true)`;

    const t = await interview.getKelolaKlienTimeline(sql, OWNER, id);
    // Without the retroaktif marker this would read `terlambat` — a deadline the
    // AM was never given.
    expect(t.langkah[0].status).toBe(iv.SLA_STATUS.TidakBerlaku);
    expect(t.langkah[0].hariKerja).toBeNull();

    const d = await interview.getInterview(sql, OWNER, id);
    expect(d.risetAwal?.retroaktif).toBe(true);
  });

  it('is Account-scope: Sales and a non-owner AM cannot read how fast the AM worked', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI, salesClosingId: 'EMP-0006' });
    created.push(detail.interview.id);
    for (const denied of [SALES, NONOWNER, OTHER]) {
      await expect(interview.getKelolaKlienTimeline(sql, denied, detail.interview.id)).rejects.toThrow(/akses/);
    }
    // OD reads everything; the Account lead too.
    expect((await interview.getKelolaKlienTimeline(sql, OD, detail.interview.id)).langkah).toHaveLength(3);
    expect((await interview.getKelolaKlienTimeline(sql, ACC_LEAD, detail.interview.id)).langkah).toHaveLength(3);
  });
});

// ===========================================================================
// RAB-06 — riset awal scored inputs are server-authoritative
// ===========================================================================
//
// B2-9 (AOV) and B2-3 (SKU siap) enter the Blok C score. Once the AM confirms the
// riset-awal isian for them, the CONFIRMED number — not the value posted to
// /score — is what scores. This closes the provenance leak: a hand-posted AOV/SKU
// cannot move the verdict away from the baseline the AM signed off on. The core
// scorer and SCORED_FIELD_KEYS are untouched; only the SOURCE of two inputs moves.

/** A clean, deal-breaker-free scoring body with AOV/SKU parameterised. */
function baseScoreInput(o: { aov: bigint; skuSiap: number }): iv.KualifikasiInput {
  return {
    marginBersih: 40,
    marginBersihSumber: iv.SUMBER_ANGKA.KlienHitung,
    aov: o.aov,
    ruangHarga: iv.RUANG_HARGA.MasihAdaRuang,
    modelBisnis: iv.MODEL_BISNIS.DistributorResmi,
    kesanggupanLonjakan: iv.KESANGGUPAN_LONJAKAN.Sanggup,
    siklusBeliUlang: iv.SIKLUS_BELI_ULANG.HabisPakai,
    pembedaProduk: iv.PEMBEDA_PRODUK.PembedaJelas,
    skuSiap: o.skuSiap,
    penangananChat: iv.PENANGANAN_CHAT.TimKhusus,
    kecepatanApproval: iv.KECEPATAN_APPROVAL.SatuOrangJelas,
    kesiapanAkses: iv.KESIAPAN_AKSES.Penuh,
    omzet: 100_000_000n,
    targetOmzet: 150_000_000n,
    dayaTahanBudget: iv.DAYA_TAHAN_BUDGET.Enam,
  };
}

dDb('RAB-06 — riset awal scored inputs are server-authoritative', () => {
  const mkInterview = async (): Promise<string> => {
    const d = await interview.createInterview(sql, OWNER, { clientId: CLI, salesClosingId: 'EMP-0006' });
    created.push(d.interview.id);
    return d.interview.id;
  };

  it('confirmed B2-9/B2-3 override a divergent score body (the provenance leak is closed)', async () => {
    // I1 — baseline auto-fills B2-9/B2-3; confirm them to STRONG values.
    const i1 = await mkInterview();
    await seedManualBaseline(OWNER, i1, CLI);
    await confirmIsian(sql, OWNER, i1, [
      { section: 'B2', fieldKey: 'B2-9', nilaiUang: '20000000', dikonfirmasi: true }, // Rp200k → top AOV band
      { section: 'B2', fieldKey: 'B2-3', nilaiAngka: 40, dikonfirmasi: true }, // 40 SKU → top band
    ]);
    // Score I1 with a body carrying WEAK aov/sku — the merge must ignore them.
    const k1 = await interview.scoreInterview(sql, OWNER, i1, baseScoreInput({ aov: 1n, skuSiap: 0 }));

    // I2 — no isian; body carries the SAME strong values as I1's confirmed isian.
    const i2 = await mkInterview();
    const k2 = await interview.scoreInterview(sql, OWNER, i2, baseScoreInput({ aov: 20_000_000n, skuSiap: 40 }));

    // I3 — no isian; body carries the WEAK values.
    const i3 = await mkInterview();
    const k3 = await interview.scoreInterview(sql, OWNER, i3, baseScoreInput({ aov: 1n, skuSiap: 0 }));

    // I1 scored on the CONFIRMED strong values, not the weak body → identical to I2.
    expect(k1.skorKualifikasi).toBe(k2.skorKualifikasi);
    expect(k1.skorPerBlok).toEqual(k2.skorPerBlok);
    expect(k1.verdictKualifikasi).toBe(k2.verdictKualifikasi);
    // …and genuinely different from the weak-body result, proving the body was ignored.
    expect(k1.skorKualifikasi).not.toBe(k3.skorKualifikasi);
  });

  it('an UNCONFIRMED proposal never overrides the body — only a confirmed one wins', async () => {
    // I4 — baseline auto-fills B2-9/B2-3 but they stay UNCONFIRMED (no confirmIsian).
    const i4 = await mkInterview();
    await seedManualBaseline(OWNER, i4, CLI);
    const k4 = await interview.scoreInterview(sql, OWNER, i4, baseScoreInput({ aov: 20_000_000n, skuSiap: 40 }));

    // I5 — no isian at all; same strong body.
    const i5 = await mkInterview();
    const k5 = await interview.scoreInterview(sql, OWNER, i5, baseScoreInput({ aov: 20_000_000n, skuSiap: 40 }));

    // Unconfirmed proposals do not touch the score, so I4 == I5 (body authoritative).
    // This is also the "no riset awal ⇒ fixture unchanged" guarantee (Alpha Digital).
    expect(k4.skorKualifikasi).toBe(k5.skorKualifikasi);
    expect(k4.skorPerBlok).toEqual(k5.skorPerBlok);
    expect(k4.verdictKualifikasi).toBe(k5.verdictKualifikasi);
  });

  it('confirmed B1-5/B6-3 (omzet + target 3 bulan) drive C-E1, overriding a divergent body (QA 2026-08-20)', async () => {
    // A client whose Target GMV is Rp100jt/bln → B6-3 auto-fills to Rp300jt (× 3).
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
      values (${CLI_TARGET}, 'PIC', 'Toko', 'Jakarta', 'https://t.example', 'Fashion', 0, 100000000,
              'EMP-0006', 'EMP-0006', 'EMP-0001', 'EMP-0001')
      on conflict (id) do update set target_gmv = excluded.target_gmv`;
    const d = await interview.createInterview(sql, OWNER, { clientId: CLI_TARGET, salesClosingId: 'EMP-0006' });
    created.push(d.interview.id);
    const id = d.interview.id;

    // seedManualBaseline (gmvBulan Rp5jt) proposes B1-5 = Rp15jt; the client's Target
    // GMV proposes B6-3 = Rp300jt. Confirm BOTH to those baseline values.
    await seedManualBaseline(OWNER, id, CLI_TARGET);
    const view = await getBaseline(sql, OWNER, id);
    const b15 = view.isian.find((f) => f.fieldKey === 'B1-5')!;
    const b63 = view.isian.find((f) => f.fieldKey === 'B6-3')!;
    expect(b15.nilaiUang).toBe('1500000000'); // Rp15jt (5jt × 3)
    expect(b63.sumber).toBe('sales');
    expect(b63.nilaiUang).toBe('30000000000'); // Rp300jt (100jt × 3)
    await confirmIsian(sql, OWNER, id, [
      { section: 'B2', fieldKey: 'B2-9', nilaiUang: '20000000', dikonfirmasi: true },
      { section: 'B2', fieldKey: 'B2-3', nilaiAngka: 40, dikonfirmasi: true },
      { section: 'B1', fieldKey: 'B1-5', nilaiUang: '1500000000', dikonfirmasi: true },
      { section: 'B6', fieldKey: 'B6-3', nilaiUang: '30000000000', dikonfirmasi: true },
    ]);

    // Score with a body carrying a DIFFERENT, harmless-looking ratio (100jt→150jt =
    // 1.5×). The confirmed baseline is 300jt / 15jt = 20× — far past the >5× deal-
    // breaker line. If the body won, the verdict would not be tidak_siap; the merge
    // makes the confirmed numbers win, so rasio_target_terlalu_tinggi fires.
    const k = await interview.scoreInterview(sql, OWNER, id, baseScoreInput({ aov: 20_000_000n, skuSiap: 40 }));
    expect(k.rasioTarget).toBe(20);
    expect(k.verdictKualifikasi).toBe('tidak_siap');
    expect(Array.isArray(k.hambatanMendasar)).toBe(true);
    expect((k.hambatanMendasar as Array<{ kode: string }>).some((h) => h.kode === 'rasio_target_terlalu_tinggi')).toBe(true);
  });
});

// ===========================================================================
// RAB-07 — riset awal is a prerequisite for starting the interview
// ===========================================================================
//
// The gate is per-PLATFORM: every active client_platforms row needs a baseline
// (analisa OR manual), every auto-filled isian must be confirmed, and riset awal
// must be submitted. The critical case is anti-deadlock — a Shopee-only client
// (Shopee has no analysis engine) must be able to finish via a MANUAL baseline and
// start the interview; at seed Shopee outnumbers TikTok 156×:16×.

dDb('RAB-07 — prerequisite gate (interview needs riset awal)', () => {
  it('anti-deadlock: a Shopee-only client finishes manual riset awal and starts the interview', async () => {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                           sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
      values (${CLI_SHOPEE}, 'PIC', 'Toko Shopee', 'Jakarta', 'https://s.example', 'Fashion', 0, 0,
              'EMP-0006', 'EMP-0006', 'EMP-0001', 'EMP-0001')
      on conflict (id) do nothing`;
    const sh = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, store_link, active, created_by)
      values (${CLI_SHOPEE}, 'Shopee', 'https://s.example', true, 'EMP-0001') returning id`;
    const shopeeId = Number(sh[0].id);

    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI_SHOPEE, salesClosingId: 'EMP-0006' });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    // Before riset awal: the meeting cannot start (direct start OR schedule).
    await expect(
      interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.SedangBerlangsung),
    ).rejects.toThrow(interview.MSG_RISET_AWAL_BELUM_LENGKAP);
    await expect(
      interview.scheduleInterview(sql, OWNER, id, { tanggalWaktu: '2026-08-20T04:00:00.000Z', durasiMenit: 30 }),
    ).rejects.toThrow(interview.MSG_RISET_AWAL_BELUM_LENGKAP);
    // The blocked attempts moved nothing.
    expect((await interview.getInterview(sql, OWNER, id)).interview.status).toBe(iv.INTERVIEW_STATES.BelumDijadwalkan);

    // Manual baseline (Shopee has no engine) → belum_dapat_diukur, no score.
    await submitBaseline(sql, OWNER, id, {
      clientPlatformId: shopeeId,
      manual: { gmvBulan: 5_000_000, order: 120, aov: 41_666, skuTotal: 15, belanjaIklan: 500_000, roas: 3.2 },
    });

    // Confirmed-but-not-submitted is still not enough: riset awal must be submitted.
    const view = await getBaseline(sql, OWNER, id);
    await confirmIsian(
      sql,
      OWNER,
      id,
      view.isian.map((f) => ({ section: f.section, fieldKey: f.fieldKey, nilaiTeks: f.nilaiTeks, nilaiAngka: f.nilaiAngka, nilaiUang: f.nilaiUang, dikonfirmasi: true })),
    );
    await expect(
      interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.SedangBerlangsung),
    ).rejects.toThrow(interview.MSG_RISET_AWAL_BELUM_LENGKAP);

    // Submit riset awal → the gate now passes and the interview can start.
    await interview.submitRisetAwal(sql, OWNER, id);
    const started = await interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.SedangBerlangsung);
    expect(started.interview.status).toBe(iv.INTERVIEW_STATES.SedangBerlangsung);
  });

  it('an unconfirmed isian blocks the start even after riset awal is submitted', async () => {
    const detail = await interview.createInterview(sql, OWNER, { clientId: CLI_SHOPEE, salesClosingId: 'EMP-0006' });
    created.push(detail.interview.id);
    const id = detail.interview.id;

    await seedManualBaseline(OWNER, id, CLI_SHOPEE); // proposals left UNCONFIRMED
    await interview.submitRisetAwal(sql, OWNER, id);
    // Baseline present + submitted, but a number the AM never confirmed still blocks.
    await expect(
      interview.transitionInterview(sql, OWNER, id, iv.INTERVIEW_STATES.SedangBerlangsung),
    ).rejects.toThrow(interview.MSG_RISET_AWAL_BELUM_LENGKAP);
  });
});
