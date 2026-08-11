/**
 * Integration tests for the Interview persistence executors against a real
 * Postgres with the CDPS migrations applied (same harness as
 * `integration.test.ts`: skipped unless DATABASE_URL is set, everything runs in
 * a transaction that is ROLLED BACK so no ITV sequence number is consumed and no
 * rows persist).
 *
 * What these prove is the seam between the pure core scorer and the DB's own
 * guards — that the executor writes rows the DB accepts, AND that the DB rejects
 * the rows the executor is built never to write (deal-breaker + wrong verdict,
 * a blank scored field, a baseless estimate, a shrunk sanggahan, a verdict
 * changed by a note). The scorer's band arithmetic is unit-tested in
 * `@cdps/core`; here we only assert the persisted verdict/basis, not every point.
 *
 * Run: DATABASE_URL=postgres://... npm test -w @cdps/db
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

/** Run fn inside a transaction, then force a ROLLBACK (nothing persists). */
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

const AT = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01 → WIB period 202608
const AM = 'EMP-0001'; // seeded employee, used as the assigned AM + actor

/** Insert a minimal client owned by `AM` and return its id. */
async function seedClient(tx: TransactionSql): Promise<string> {
  const id = 'CLI-INT-' + Math.random().toString(36).slice(2, 8);
  await tx`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
    values
      (${id}, 'PIC', 'Toko', 'Jakarta', 'https://toko.example', 'Fashion', 0, 0,
       ${AM}, ${AM}, ${AM}, ${AM})`;
  return id;
}

/** A clean, deal-breaker-free input that scores 100 → growth_ready. */
function inputGrowthReady(): iv.KualifikasiInput {
  return {
    marginBersih: 40,
    marginBersihSumber: iv.SUMBER_ANGKA.KlienHitung,
    aov: 20_000_000n, // ≥ Rp150k band → 8
    aovSumber: iv.SUMBER_ANGKA.KlienHitung,
    ruangHarga: iv.RUANG_HARGA.MasihAdaRuang,
    modelBisnis: iv.MODEL_BISNIS.Produsen,
    kesanggupanLonjakan: iv.KESANGGUPAN_LONJAKAN.Sanggup,
    siklusBeliUlang: iv.SIKLUS_BELI_ULANG.HabisPakai,
    pembedaProduk: iv.PEMBEDA_PRODUK.PembedaJelas,
    skuSiap: 40,
    skuSiapSumber: iv.SUMBER_ANGKA.KlienHitung,
    penangananChat: iv.PENANGANAN_CHAT.TimKhusus,
    kecepatanApproval: iv.KECEPATAN_APPROVAL.SatuOrangJelas,
    kesiapanAkses: iv.KESIAPAN_AKSES.Penuh,
    omzet: 100_000_000n,
    omzetSumber: iv.SUMBER_ANGKA.KlienHitung,
    targetOmzet: 200_000_000n, // ratio 2 → 7
    targetOmzetSumber: iv.SUMBER_ANGKA.KlienHitung,
    dayaTahanBudget: iv.DAYA_TAHAN_BUDGET.Enam,
  };
}

d('createInterview', () => {
  it('mints a house-format ITV id and inserts a versi-1 row at the initial state', async () => {
    const { id, row } = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      const row = (
        await tx<{ status: string; versi_no: number; interview_induk_id: string | null }[]>`
          select status, versi_no, interview_induk_id from interview where id = ${id}`
      )[0];
      return { id, row };
    });
    expect(id).toMatch(/^ITV-202608-\d{4}$/);
    expect(row.status).toBe(iv.INTERVIEW_STATES.BelumDijadwalkan);
    expect(row.versi_no).toBe(1);
    expect(row.interview_induk_id).toBeNull();
  });

  it('records a re-interview (versi n+1) with induk + previous lineage', async () => {
    const rows = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const v1 = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      const v2 = await itv.createInterview(tx, {
        clientId,
        amPengisiId: AM,
        createdBy: AM,
        at: AT,
        lineage: { versiNo: 2, indukId: v1, sebelumnyaId: v1 },
      });
      return tx<{ versi_no: number; interview_induk_id: string | null }[]>`
        select versi_no, interview_induk_id from interview where id = ${v2}`;
    });
    expect(rows[0].versi_no).toBe(2);
    expect(rows[0].interview_induk_id).not.toBeNull();
  });
});

d('upsertAnswer', () => {
  it('writes then replaces an answer for the same (section, field)', async () => {
    const value = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      await itv.upsertAnswer(tx, { interviewId: id, section: 'B2', fieldKey: 'B2-7', nilaiAngka: 30, updatedBy: AM });
      await itv.upsertAnswer(tx, { interviewId: id, section: 'B2', fieldKey: 'B2-7', nilaiAngka: 40, updatedBy: AM });
      return tx<{ nilai_angka: string }[]>`
        select nilai_angka from interview_answer where interview_id = ${id} and field_key = 'B2-7'`;
    });
    expect(Number(value[0].nilai_angka)).toBe(40);
  });

  it('stores money answers as exact minor units (bigint column)', async () => {
    const uang = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      await itv.upsertAnswer(tx, { interviewId: id, section: 'B2', fieldKey: 'B2-9', nilaiUang: 15_000_000n, updatedBy: AM });
      return tx<{ nilai_uang: string }[]>`
        select nilai_uang from interview_answer where interview_id = ${id} and field_key = 'B2-9'`;
    });
    expect(uang[0].nilai_uang).toBe('15000000');
  });

  it('is rejected by the DB when a scored field is submitted blank (ck_answer_scored_not_blank)', async () => {
    await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      await expect(
        tx.savepoint((sp) =>
          itv.upsertAnswer(sp as TransactionSql, { interviewId: id, section: 'B2', fieldKey: 'B2-7', wajibKosong: true, updatedBy: AM }),
        ),
      ).rejects.toThrow(/ck_answer_scored_not_blank/);
      // A non-scored field MAY be blank.
      await itv.upsertAnswer(tx, { interviewId: id, section: 'B0', fieldKey: 'B0-1', wajibKosong: true, updatedBy: AM });
      return null;
    });
  });

  it('is rejected by the DB when an estimate carries no written basis (ck_answer_estimasi_basis)', async () => {
    await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      await expect(
        tx.savepoint((sp) =>
          itv.upsertAnswer(sp as TransactionSql, {
            interviewId: id,
            section: 'B2',
            fieldKey: 'B2-7',
            nilaiAngka: 30,
            sumberAngka: iv.SUMBER_ANGKA.EstimasiAm,
            updatedBy: AM,
          }),
        ),
      ).rejects.toThrow(/ck_answer_estimasi_basis/);
      // With a basis, the estimate is accepted.
      await itv.upsertAnswer(tx, {
        interviewId: id,
        section: 'B2',
        fieldKey: 'B2-7',
        nilaiAngka: 30,
        sumberAngka: iv.SUMBER_ANGKA.EstimasiAm,
        dasarEstimasi: 'rata-rata kategori sejenis',
        updatedBy: AM,
      });
      return null;
    });
  });
});

d('persistKualifikasi', () => {
  it('scores on the active config, stores config_snapshot, and lands growth_ready', async () => {
    const { hasil, row } = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      const { hasil } = await itv.persistKualifikasi(tx, { interviewId: id, input: inputGrowthReady(), dihitungOleh: AM });
      const row = (
        await tx<{ skor_kualifikasi: number; verdict_kualifikasi: string; config_snapshot: { skorGrowthReady: number } }[]>`
          select skor_kualifikasi, verdict_kualifikasi, config_snapshot from interview_kualifikasi where interview_id = ${id}`
      )[0];
      return { hasil, row };
    });
    expect(hasil.verdict).toBe(iv.VERDICT.GrowthReady);
    expect(row.skor_kualifikasi).toBe(hasil.skorTotal);
    expect(row.verdict_kualifikasi).toBe('growth_ready');
    // config_snapshot round-trips the calibration used (I15).
    expect(row.config_snapshot.skorGrowthReady).toBe(75);
  });

  it('persists a deal-breaker input as tidak_siap (I14 precedence, accepted by ck_kualifikasi_dealbreaker)', async () => {
    const { hasil, row } = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      const input = { ...inputGrowthReady(), modelBisnis: iv.MODEL_BISNIS.Dropship };
      const { hasil } = await itv.persistKualifikasi(tx, { interviewId: id, input, dihitungOleh: AM });
      const row = (
        await tx<{ verdict_kualifikasi: string; hambatan_mendasar: unknown[] }[]>`
          select verdict_kualifikasi, hambatan_mendasar from interview_kualifikasi where interview_id = ${id}`
      )[0];
      return { hasil, row };
    });
    expect(hasil.verdict).toBe(iv.VERDICT.TidakSiap);
    expect(row.verdict_kualifikasi).toBe('tidak_siap');
    expect(row.hambatan_mendasar.length).toBeGreaterThan(0);
  });

  it('records a reproducible derived margin when net is derived from gross (I21)', async () => {
    const row = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      const input: iv.KualifikasiInput = {
        ...inputGrowthReady(),
        marginBersih: null,
        marginBersihSumber: null,
        marginKotor: 50,
        komisiPlatformPersen: 6,
        ongkirPersen: 3,
      };
      await itv.persistKualifikasi(tx, { interviewId: id, input, dihitungOleh: AM });
      return (
        await tx<{ margin_bersih_basis: string; margin_derivasi_input: unknown; margin_kotor: string | null }[]>`
          select margin_bersih_basis, margin_derivasi_input, margin_kotor from interview_kualifikasi where interview_id = ${id}`
      )[0];
    });
    expect(row.margin_bersih_basis).toBe('diturunkan_dari_kotor');
    expect(row.margin_derivasi_input).not.toBeNull();
    expect(row.margin_kotor).not.toBeNull();
  });

  it('recompute overwrites the verdict without a sanggahan (allowed by the trigger)', async () => {
    const verdicts = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      const before = (await itv.persistKualifikasi(tx, { interviewId: id, input: inputGrowthReady(), dihitungOleh: AM })).hasil.verdict;
      // Correct the input downward and recompute — the verdict may move because a
      // recompute touches no note, so the append-only guard's "note must not move
      // the verdict" branch never fires.
      const worse = { ...inputGrowthReady(), modelBisnis: iv.MODEL_BISNIS.Dropship };
      const after = (await itv.persistKualifikasi(tx, { interviewId: id, input: worse, dihitungOleh: AM })).hasil.verdict;
      return { before, after };
    });
    expect(verdicts.before).toBe(iv.VERDICT.GrowthReady);
    expect(verdicts.after).toBe(iv.VERDICT.TidakSiap);
  });
});

d('catatan_sanggahan append-only guard', () => {
  it('appends notes, but rejects a shrink and rejects a verdict change smuggled in with a note', async () => {
    await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      await itv.persistKualifikasi(tx, { interviewId: id, input: inputGrowthReady(), dihitungOleh: AM });

      await itv.appendSanggahan(tx, id, { oleh: AM, catatan: 'klien tidak setuju band margin' });
      const len1 = (
        await tx<{ n: number }[]>`
          select jsonb_array_length(catatan_sanggahan)::int as n from interview_kualifikasi where interview_id = ${id}`
      )[0].n;
      expect(len1).toBe(1);

      // Shrinking the array is refused.
      await expect(
        tx.savepoint(
          (sp) => sp`update interview_kualifikasi set catatan_sanggahan = '[]'::jsonb where interview_id = ${id}`,
        ),
      ).rejects.toThrow(/append-only/);

      // Adding a note AND changing the verdict in the same UPDATE is refused —
      // the only way to move a verdict is a re-input + recompute.
      await expect(
        tx.savepoint(
          (sp) => sp`
            update interview_kualifikasi
               set catatan_sanggahan = catatan_sanggahan || jsonb_build_array('{"x":1}'::jsonb),
                   verdict_kualifikasi = 'bersyarat'
             where interview_id = ${id}`,
        ),
      ).rejects.toThrow(/sanggahan tidak boleh mengubah/);
      return null;
    });
  });
});

d('deal-breaker CHECK backstop', () => {
  it('rejects a raw row with a non-empty hambatan but verdict != tidak_siap (ck_kualifikasi_dealbreaker)', async () => {
    await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      await expect(
        tx.savepoint(
          (sp) => sp`
            insert into interview_kualifikasi
              (interview_id, skor_kualifikasi, skor_per_blok, verdict_kualifikasi, hambatan_mendasar,
               margin_bersih_basis, kualitas_data, config_snapshot, dihitung_oleh)
            values
              (${id}, 90, '{"A":30,"B":20,"C":20,"D":15,"E":15}'::jsonb, 'growth_ready',
               '[{"kode":"dropship","nilai":"dropship"}]'::jsonb, 'bersih_klien', 'terverifikasi',
               '{}'::jsonb, ${AM})`,
        ),
      ).rejects.toThrow(/ck_kualifikasi_dealbreaker/);
      return null;
    });
  });
});

d('interview_version immutability', () => {
  it('appends a version snapshot and rejects UPDATE/DELETE on it (frozen history)', async () => {
    await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      await itv.snapshotVersion(tx, { interviewId: id, versiNo: 1, snapshot: { note: 'v1' }, dibuatOleh: AM });
      await expect(
        tx.savepoint((sp) => sp`update interview_version set dibuat_oleh = 'X' where interview_id = ${id}`),
      ).rejects.toThrow(/immutable/);
      await expect(
        tx.savepoint((sp) => sp`delete from interview_version where interview_id = ${id}`),
      ).rejects.toThrow(/immutable/);
      return null;
    });
  });
});

d('interview_flag + interview_outcome', () => {
  it('appends a flag (SYSTEM default author) and records an outcome', async () => {
    const { flag, outcome } = await inRollback(async (tx) => {
      const clientId = await seedClient(tx);
      const id = await itv.createInterview(tx, { clientId, amPengisiId: AM, createdBy: AM, at: AT });
      await itv.insertFlag(tx, { interviewId: id, kode: 'margin_zona_abu_abu', detail: { pp: 2 } });
      await itv.recordOutcome(tx, { interviewId: id, hasil: 'perpanjang', bulanBertahan: 12, dicatatOleh: AM });
      const flag = (
        await tx<{ kode: string; created_by: string }[]>`select kode, created_by from interview_flag where interview_id = ${id}`
      )[0];
      const outcome = (
        await tx<{ hasil: string }[]>`select hasil from interview_outcome where interview_id = ${id}`
      )[0];
      return { flag, outcome };
    });
    expect(flag.kode).toBe('margin_zona_abu_abu');
    expect(flag.created_by).toBe('SYSTEM');
    expect(outcome.hasil).toBe('perpanjang');
  });
});
