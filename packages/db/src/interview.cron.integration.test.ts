/**
 * Integration tests for the Interview cron logic (langkah 5) — the pure SQL
 * functions `interview_reminder_tick` / `interview_daily_tick` and the
 * schedule-reset trigger, against a real Postgres with the CDPS migrations
 * applied. Same harness as the other integration suites: skipped unless
 * DATABASE_URL is set, every case runs in a transaction that is ROLLED BACK.
 *
 * "Now" is a parameter to both tick functions, so these tests turn the calendar
 * forward by hand and prove the invariants the spec cares about: a reminder
 * REPLACES rather than stacks (idempotent by the per-day marker), overdue nudges
 * stop at 7 and escalate once, the Butuh-Data nudge honours a 3-day spacing and a
 * cap of 5, SLA flags fire once and skip Retroaktif, and a reschedule resets the
 * reminder markers. pg_cron itself is never involved here (it is absent on plain
 * Postgres); only the logic it would trigger is exercised.
 */
import { interview as iv } from '@cdps/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Sql, type TransactionSql } from './client';
import * as itv from './interview';

const URL = process.env.DATABASE_URL;
const d = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

async function inRollback<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  class Rollback extends Error {}
  let captured: T;
  try {
    await sql.begin(async (tx) => {
      captured = await fn(tx as TransactionSql);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return captured!;
}

const AM = 'EMP-0001';
const AT = new Date(Date.UTC(2026, 7, 1)); // ITV mint instant
/** A WIB midday instant for the given YYYY-MM-DD, so wib_date() == that date. */
const day = (iso: string) => new Date(`${iso}T05:00:00Z`);

async function seedClient(tx: TransactionSql): Promise<string> {
  const id = 'CLI-INT-' + Math.random().toString(36).slice(2, 8);
  await tx`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
    values
      (${id}, 'PIC', 'Toko', 'Jakarta', 'https://toko.example', 'Fashion', 0, 0, ${AM}, ${AM}, ${AM}, ${AM})`;
  return id;
}

/** Create an interview, force its status (fixture only), and give it a jadwal. */
async function seedInterview(
  tx: TransactionSql,
  opts: { status: string; tanggalWaktu?: Date | null; retroaktif?: boolean; createdAt?: string },
): Promise<string> {
  const clientId = await seedClient(tx);
  const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT, retroaktif: opts.retroaktif });
  await tx`update interview set status = ${opts.status} where id = ${id}`;
  if (opts.createdAt) await tx`update interview set created_at = ${opts.createdAt}::timestamptz where id = ${id}`;
  await tx`
    insert into interview_jadwal (interview_id, tanggal_waktu, updated_at)
    values (${id}, ${opts.tanggalWaktu ?? null}, now())`;
  return id;
}

function countEvent(tx: TransactionSql, id: string, event: string): Promise<number> {
  return tx<{ n: number }[]>`
    select count(*)::int as n from notifications where entity_id = ${id} and event_type = ${event}`.then((r) => r[0].n);
}

d('interview_reminder_tick', () => {
  it('sends the H-day reminder to the AM once and is idempotent on re-run', async () => {
    const out = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Terjadwal', tanggalWaktu: day('2026-08-11') });
      const first = (await tx<{ n: number }[]>`select interview_reminder_tick('h_day', ${day('2026-08-11')}) as n`)[0].n;
      const again = (await tx<{ n: number }[]>`select interview_reminder_tick('h_day', ${day('2026-08-11')}) as n`)[0].n;
      const marker = (await tx<{ p: string | null }[]>`select pengingat_hday_pada as p from interview_jadwal where interview_id = ${id}`)[0].p;
      return { first, again, notifs: await countEvent(tx, id, 'interview_pengingat'), marker };
    });
    expect(out.first).toBe(1);
    expect(out.again).toBe(0); // marker prevents a second send the same day
    expect(out.notifs).toBe(1);
    expect(out.marker).not.toBeNull();
  });

  it('sends the H-1 reminder for a meeting scheduled tomorrow', async () => {
    const out = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Terjadwal', tanggalWaktu: day('2026-08-12') });
      const sent = (await tx<{ n: number }[]>`select interview_reminder_tick('h_1', ${day('2026-08-11')}) as n`)[0].n;
      return { sent, notifs: await countEvent(tx, id, 'interview_pengingat') };
    });
    expect(out.sent).toBe(1);
    expect(out.notifs).toBe(1);
  });
});

d('interview_daily_tick — overdue + escalation', () => {
  it('nudges the AM daily up to 7 times, then escalates once; re-run same day is a no-op', async () => {
    const out = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Terjadwal', tanggalWaktu: day('2026-08-01') });
      // Seven working-through days after the missed date: each a fresh AM nudge.
      const days = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
      for (const iso of days) await tx`select interview_daily_tick(${day(iso)})`;
      const amNudges = await countEvent(tx, id, 'interview_terlewat');
      const beforeEsc = (await tx<{ e: boolean; c: number }[]>`
        select overdue_escalated as e, overdue_emitted as c from interview_jadwal where interview_id = ${id}`)[0];
      // Day 8: escalation to SPV.
      await tx`select interview_daily_tick(${day('2026-08-09')})`;
      const afterEsc = (await tx<{ e: boolean }[]>`select overdue_escalated as e from interview_jadwal where interview_id = ${id}`)[0];
      // Re-running the same day does nothing more.
      const rerun = (await tx<{ n: number }[]>`select interview_daily_tick(${day('2026-08-09')}) as n`)[0].n;
      // A further day past escalation: nothing left to do.
      const later = (await tx<{ n: number }[]>`select interview_daily_tick(${day('2026-08-10')}) as n`)[0].n;
      return { amNudges, beforeEsc, escalated: afterEsc.e, rerun, later };
    });
    expect(out.amNudges).toBe(7); // exactly 7 AM nudges, no more
    expect(out.beforeEsc.c).toBe(7);
    expect(out.beforeEsc.e).toBe(false);
    expect(out.escalated).toBe(true);
    expect(out.rerun).toBe(0);
    expect(out.later).toBe(0);
  });
});

d('interview_daily_tick — Butuh Data Klien nudge', () => {
  it('nudges every 3 days, at most 5 times', async () => {
    const out = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Butuh Data Klien', tanggalWaktu: null });
      // Every third day → 5 nudges; a 6th window adds nothing (cap reached).
      const days = ['2026-08-01', '2026-08-04', '2026-08-07', '2026-08-10', '2026-08-13', '2026-08-16'];
      for (const iso of days) await tx`select interview_daily_tick(${day(iso)})`;
      // A too-soon call between windows does not nudge.
      const tooSoon = (await tx<{ n: number }[]>`select interview_daily_tick(${day('2026-08-17')}) as n`)[0].n;
      return { nudges: await countEvent(tx, id, 'interview_butuh_data_klien'), tooSoon };
    });
    expect(out.nudges).toBe(5);
    expect(out.tooSoon).toBe(0);
  });

  it('does not nudge twice within a 3-day window', async () => {
    const nudges = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Butuh Data Klien', tanggalWaktu: null });
      await tx`select interview_daily_tick(${day('2026-08-01')})`;
      await tx`select interview_daily_tick(${day('2026-08-02')})`; // 1 day later — too soon
      await tx`select interview_daily_tick(${day('2026-08-03')})`; // 2 days later — too soon
      return countEvent(tx, id, 'interview_butuh_data_klien');
    });
    expect(nudges).toBe(1);
  });
});

/**
 * SLA flags — the three-step Kelola Klien timeline (owner decision 2026-08-13):
 * Riset Awal 2–3, Interview Meeting 1–2, Brand Strategy 5–7 WORKING days.
 *
 * These REPLACED the two older flags (`sla_belum_dijadwalkan` >3 hk,
 * `sla_belum_selesai` >7 hk, both anchored on the interview's creation): the
 * owner chose one set of numbers over two overlapping ones, so the old codes must
 * no longer be raised at all.
 */
d('interview_daily_tick — SLA flags (timeline tiga langkah)', () => {
  it('flags a riset awal left running past its limit, once, skipping Retroaktif', async () => {
    const out = await inRollback(async (tx) => {
      // Riset awal opened 2026-07-20 (Mon); by 2026-07-31 that is 9 working days,
      // far past the 3-day limit.
      const id = await seedInterview(tx, { status: 'Belum Dijadwalkan', tanggalWaktu: null });
      const retro = await seedInterview(tx, { status: 'Belum Dijadwalkan', tanggalWaktu: null, retroaktif: true });
      for (const target of [id, retro]) {
        await tx`
          insert into interview_riset_awal (interview_id, dimulai_pada, dimulai_oleh)
          values (${target}, '2026-07-20'::timestamptz, ${AM})
          on conflict (interview_id) do update set dimulai_pada = excluded.dimulai_pada`;
      }
      await tx`select interview_daily_tick(${day('2026-07-31')})`;
      await tx`select interview_daily_tick(${day('2026-07-31')})`; // re-run stays once
      const flags = await tx<{ kode: string; detail: Record<string, unknown> }[]>`
        select kode, detail from interview_flag where interview_id = ${id} order by kode`;
      const retroFlags = (await tx<{ n: number }[]>`select count(*)::int as n from interview_flag where interview_id = ${retro}`)[0].n;
      return { flags, retroFlags };
    });
    expect(out.flags.map((f) => f.kode)).toEqual(['sla_riset_awal_terlambat']);
    expect(out.flags[0].detail.batas).toBe(3);
    expect(Number(out.flags[0].detail.hari_kerja)).toBeGreaterThan(3);
    expect(out.retroFlags).toBe(0); // Retroaktif is excluded from SLA (I19)
  });

  it('flags a meeting never secured after riset awal was submitted', async () => {
    const kodes = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Belum Dijadwalkan', tanggalWaktu: null });
      // Riset awal DONE on 2026-07-20 — so step 2's clock starts there and step 1
      // must not be flagged.
      await tx`
        insert into interview_riset_awal (interview_id, status, dimulai_pada, disubmit_pada, dimulai_oleh, disubmit_oleh)
        values (${id}, 'Selesai', '2026-07-20'::timestamptz, '2026-07-20'::timestamptz, ${AM}, ${AM})
        on conflict (interview_id) do update set
          status = 'Selesai', disubmit_pada = excluded.disubmit_pada, disubmit_oleh = excluded.disubmit_oleh`;
      await tx`select interview_daily_tick(${day('2026-07-31')})`;
      return (await tx<{ kode: string }[]>`select kode from interview_flag where interview_id = ${id} order by kode`)
        .map((f) => f.kode);
    });
    expect(kodes).toEqual(['sla_meeting_terlambat']);
  });

  it('flags a finished interview whose brand strategy was never submitted', async () => {
    const out = await inRollback(async (tx) => {
      // Seeded NOT-yet-finished: forcing the status to Selesai first would make
      // the trigger stamp `selesai_pada = now()`, and that anchor is then frozen
      // — the fixture would be fighting the very guarantee under test. So status
      // and both anchors move in ONE statement, while they are still null.
      const id = await seedInterview(tx, { status: 'Belum Dijadwalkan', tanggalWaktu: null });
      await tx`
        insert into interview_riset_awal (interview_id, status, dimulai_pada, disubmit_pada, dimulai_oleh, disubmit_oleh)
        values (${id}, 'Selesai', '2026-07-20'::timestamptz, '2026-07-20'::timestamptz, ${AM}, ${AM})
        on conflict (interview_id) do update set status = 'Selesai', disubmit_pada = excluded.disubmit_pada`;
      await tx`
        update interview
           set status = 'Selesai',
               meeting_diamankan_pada = '2026-07-20'::timestamptz,
               selesai_pada = '2026-07-20'::timestamptz
         where id = ${id}`;
      await tx`select interview_daily_tick(${day('2026-07-31')})`;
      const flags = await tx<{ kode: string; detail: Record<string, unknown> }[]>`
        select kode, detail from interview_flag where interview_id = ${id} order by kode`;
      return flags;
    });
    expect(out.map((f) => f.kode)).toEqual(['sla_strategi_terlambat']);
    expect(out[0].detail.batas).toBe(7);
  });

  it('never raises the two REPLACED flag codes any more', async () => {
    const kodes = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Belum Dijadwalkan', tanggalWaktu: null });
      await tx`
        insert into interview_riset_awal (interview_id, dimulai_pada, dimulai_oleh)
        values (${id}, '2026-07-20'::timestamptz, ${AM})
        on conflict (interview_id) do update set dimulai_pada = excluded.dimulai_pada`;
      await tx`select interview_daily_tick(${day('2026-07-31')})`;
      return (await tx<{ kode: string }[]>`select kode from interview_flag where interview_id = ${id}`)
        .map((f) => f.kode);
    });
    expect(kodes).not.toContain('sla_belum_dijadwalkan');
    expect(kodes).not.toContain('sla_belum_selesai');
  });

  it('never flags a BACKFILLED (retroaktif) riset awal — no deadline existed then', async () => {
    const kodes = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Belum Dijadwalkan', tanggalWaktu: null });
      // Exactly what migration 20260812100000 §4 writes for a session that already
      // existed when the step was introduced.
      await tx`
        insert into interview_riset_awal (interview_id, dimulai_pada, dimulai_oleh, retroaktif)
        values (${id}, '2026-07-20'::timestamptz, ${AM}, true)
        on conflict (interview_id) do update set
          dimulai_pada = excluded.dimulai_pada, retroaktif = true`;
      await tx`select interview_daily_tick(${day('2026-07-31')})`;
      return (await tx<{ kode: string }[]>`select kode from interview_flag where interview_id = ${id}`)
        .map((f) => f.kode);
    });
    // 9 working days past a 3-day limit, and still silent: the AM was never asked
    // to do this step while they were working on that session.
    expect(kodes).toEqual([]);
  });

  it('counts WORKING days: a registered holiday can keep a step inside its limit', async () => {
    const kodes = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Belum Dijadwalkan', tanggalWaktu: null });
      // Mon 2026-07-27 → Fri 2026-07-31 is 4 working days: past the 3-day limit.
      await tx`
        insert into interview_riset_awal (interview_id, dimulai_pada, dimulai_oleh)
        values (${id}, '2026-07-27'::timestamptz, ${AM})
        on conflict (interview_id) do update set dimulai_pada = excluded.dimulai_pada`;
      // Declaring two of those days national holidays brings it back to 2.
      await tx`
        insert into hari_libur (tanggal, keterangan, created_by) values
          ('2026-07-29', 'uji', 'CI'), ('2026-07-30', 'uji', 'CI')`;
      await tx`select interview_daily_tick(${day('2026-07-31')})`;
      return (await tx<{ kode: string }[]>`select kode from interview_flag where interview_id = ${id}`)
        .map((f) => f.kode);
    });
    expect(kodes).toEqual([]); // no flag — the holidays were not working days
  });
});

d('interview_daily_tick — prasyarat bersyarat overdue', () => {
  it('flags a bersyarat interview whose prasyarat is unfinished once it is >= 7 days overdue', async () => {
    const out = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Selesai', tanggalWaktu: null });
      // A bersyarat-scoring input (55..74, no deal-breaker): total 70.
      const input: iv.KualifikasiInput = {
        marginBersih: 40,
        marginBersihSumber: iv.SUMBER_ANGKA.KlienHitung,
        aov: 20_000_000n,
        ruangHarga: iv.RUANG_HARGA.TidakAda, // 0 (was 10)
        modelBisnis: iv.MODEL_BISNIS.DistributorResmi, // 5 (was 10)
        kesanggupanLonjakan: iv.KESANGGUPAN_LONJAKAN.Sanggup,
        siklusBeliUlang: iv.SIKLUS_BELI_ULANG.HabisPakai,
        pembedaProduk: iv.PEMBEDA_PRODUK.ProdukUmum, // 1 (was 7)
        skuSiap: 40,
        penangananChat: iv.PENANGANAN_CHAT.TimKhusus,
        kecepatanApproval: iv.KECEPATAN_APPROVAL.BelumJelas, // 0 (was 5)
        kesiapanAkses: iv.KESIAPAN_AKSES.Belum, // 0 (was 4)
        omzet: 100_000_000n,
        targetOmzet: 200_000_000n,
        dayaTahanBudget: iv.DAYA_TAHAN_BUDGET.Enam,
      };
      const { hasil } = await itv.persistKualifikasi(tx, { interviewId: id, input, dihitungOleh: AM });
      // Pin dihitung_pada so the day arithmetic is deterministic (no wall clock).
      await tx`update interview_kualifikasi set dihitung_pada = '2026-07-25'::timestamptz where interview_id = ${id}`;
      // 2026-08-05 is 11 days later → >= 7, so it flags.
      await tx`select interview_daily_tick(${day('2026-08-05')})`;
      await tx`select interview_daily_tick(${day('2026-08-05')})`; // re-run stays once
      const flags = (await tx<{ n: number }[]>`
        select count(*)::int as n from interview_flag where interview_id = ${id} and kode = 'prasyarat_bersyarat_terlambat'`)[0].n;
      return { verdict: hasil.verdict, flags };
    });
    expect(out.verdict).toBe(iv.VERDICT.Bersyarat);
    expect(out.flags).toBe(1);
  });

  it('still flags past 60 days — the flag persists (no upper window; owner 2026-08-11)', async () => {
    const out = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Selesai', tanggalWaktu: null });
      // A bersyarat-scoring input (55..74, no deal-breaker): total 70.
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
      await itv.persistKualifikasi(tx, { interviewId: id, input, dihitungOleh: AM });
      await tx`update interview_kualifikasi set dihitung_pada = '2026-05-01'::timestamptz where interview_id = ${id}`;
      // 2026-08-05 is ~96 days later → old code (<= 60) would NOT flag; new code does.
      await tx`select interview_daily_tick(${day('2026-08-05')})`;
      await tx`select interview_daily_tick(${day('2026-08-05')})`; // re-run stays once
      const flags = (await tx<{ n: number }[]>`
        select count(*)::int as n from interview_flag where interview_id = ${id} and kode = 'prasyarat_bersyarat_terlambat'`)[0].n;
      return { flags };
    });
    expect(out.flags).toBe(1);
  });

  it('does not flag while still inside the 0–6 day grace window', async () => {
    const out = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Selesai', tanggalWaktu: null });
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
      await itv.persistKualifikasi(tx, { interviewId: id, input, dihitungOleh: AM });
      await tx`update interview_kualifikasi set dihitung_pada = '2026-08-01'::timestamptz where interview_id = ${id}`;
      // 2026-08-05 is 4 days later → still inside 0–6 grace, no flag.
      await tx`select interview_daily_tick(${day('2026-08-05')})`;
      const flags = (await tx<{ n: number }[]>`
        select count(*)::int as n from interview_flag where interview_id = ${id} and kode = 'prasyarat_bersyarat_terlambat'`)[0].n;
      return { flags };
    });
    expect(out.flags).toBe(0);
  });
});

d('interview_daily_tick — prasyarat hanging escalation (N=2, re-armable)', () => {
  // Insert a bersyarat qualification + the overdue flag directly (fixture): the
  // escalation only reads verdict/prasyarat_status + the flag, so this is enough.
  async function seedBersyaratOverdue(tx: TransactionSql, id: string): Promise<void> {
    await tx`
      insert into interview_kualifikasi
        (interview_id, skor_kualifikasi, skor_per_blok, verdict_kualifikasi,
         margin_bersih_basis, kualitas_data, config_snapshot, dihitung_oleh, prasyarat_status, dihitung_pada)
      values (${id}, 70, '{}'::jsonb, 'bersyarat', 'bersih_klien', 'terverifikasi', '{}'::jsonb, ${AM}, 'jalan', '2026-05-01'::timestamptz)`;
    await tx`insert into interview_flag (interview_id, kode) values (${id}, 'prasyarat_bersyarat_terlambat')`;
  }
  const EVENT = 'kualifikasi_prasyarat_menggantung';
  const escCount = (tx: TransactionSql) =>
    tx<{ n: number }[]>`select count(*)::int as n from notifications where event_type = ${EVENT}`.then((r) => r[0].n);
  const armed = (tx: TransactionSql) =>
    tx<{ e: boolean }[]>`select ter_eskalasi as e from interview_prasyarat_eskalasi where am_pengisi_id = ${AM}`.then(
      (r) => r[0]?.e ?? null,
    );

  it('escalates once at >= 2, holds on a same-day re-run, and re-arms when it drops below 2', async () => {
    const out = await inRollback(async (tx) => {
      // Ensure a lead recipient exists so the emit resolves someone.
      await tx`insert into employees (employee_id, nama, email, divisi, jabatan)
               values ('EMP-ESK-LEAD', 'Lead', 'lead@esk.example', 'Account', 'ESKLEAD') on conflict do nothing`;
      await tx`insert into role_mappings (divisi, jabatan, division, level, created_by)
               values ('Account', 'ESKLEAD', 'Account', 'lead', ${AM}) on conflict do nothing`;

      const a = await seedInterview(tx, { status: 'Selesai', tanggalWaktu: null });
      await seedBersyaratOverdue(tx, a);
      // One hanging prerequisite → no escalation yet.
      await tx`select interview_daily_tick(${day('2026-08-05')})`;
      const afterOne = { notif: await escCount(tx), armed: await armed(tx) };

      // A second one under the same AM → escalate exactly once.
      const b = await seedInterview(tx, { status: 'Selesai', tanggalWaktu: null });
      await seedBersyaratOverdue(tx, b);
      await tx`select interview_daily_tick(${day('2026-08-06')})`;
      const afterTwo = await escCount(tx);
      await tx`select interview_daily_tick(${day('2026-08-06')})`; // same day re-run: no new episode
      const afterRerun = await escCount(tx);
      const armedAfterTwo = await armed(tx);

      // Resolve one prerequisite → count drops to 1 → re-arm (no new notif).
      await itv.markPrasyaratSelesai(tx, { interviewId: a, oleh: AM });
      await tx`select interview_daily_tick(${day('2026-08-07')})`;
      const afterResolve = { notif: await escCount(tx), armed: await armed(tx) };

      return { afterOne, afterTwo, afterRerun, armedAfterTwo, afterResolve };
    });
    expect(out.afterOne.notif).toBe(0); // one hanging: nothing
    expect(out.afterOne.armed).toBeNull(); // no state row created for a sub-threshold AM
    expect(out.afterTwo).toBeGreaterThanOrEqual(1); // escalated to the Account lead(s)
    expect(out.afterRerun).toBe(out.afterTwo); // same-day re-run adds nothing
    expect(out.armedAfterTwo).toBe(true);
    expect(out.afterResolve.notif).toBe(out.afterTwo); // re-arm sends no new notification
    expect(out.afterResolve.armed).toBe(false); // episode closed
  });
});

d('interview_jadwal reschedule reset', () => {
  it('resets the reminder markers when tanggal_waktu changes, and leaves them when it does not', async () => {
    const out = await inRollback(async (tx) => {
      const id = await seedInterview(tx, { status: 'Terjadwal', tanggalWaktu: day('2026-08-11') });
      await tx`select interview_reminder_tick('h_day', ${day('2026-08-11')})`; // sets pengingat_hday_pada
      await tx`update interview_jadwal set overdue_emitted = 3, overdue_escalated = true where interview_id = ${id}`;
      // Reschedule → markers reset.
      await tx`update interview_jadwal set tanggal_waktu = ${day('2026-08-20')} where interview_id = ${id}`;
      const afterMove = (await tx<{ h: string | null; oe: number; esc: boolean }[]>`
        select pengingat_hday_pada as h, overdue_emitted as oe, overdue_escalated as esc from interview_jadwal where interview_id = ${id}`)[0];
      // A non-schedule edit leaves markers intact.
      await tx`select interview_reminder_tick('h_day', ${day('2026-08-20')})`; // re-set marker for new date
      await tx`update interview_jadwal set catatan_persiapan = 'x' where interview_id = ${id}`;
      const afterNote = (await tx<{ h: string | null }[]>`select pengingat_hday_pada as h from interview_jadwal where interview_id = ${id}`)[0];
      return { afterMove, afterNoteMarker: afterNote.h };
    });
    expect(out.afterMove.h).toBeNull();
    expect(out.afterMove.oe).toBe(0);
    expect(out.afterMove.esc).toBe(false);
    expect(out.afterNoteMarker).not.toBeNull(); // untouched by a non-schedule edit
  });
});
