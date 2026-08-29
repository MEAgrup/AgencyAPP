/**
 * Tests for M16 lead-time computation (leadtime.ts) — the working-day
 * arithmetic and the checkpoint-boundary folding, isolated from the full
 * Brief/pipeline machinery (covered end-to-end in stage.test.ts).
 *
 * Integration only (skipped unless DATABASE_URL is set): `working_days_between`
 * lives in Postgres (`hari_libur` table) and is deliberately NOT reimplemented
 * in TS (LT-23 instruction) — a real DB is the only honest oracle for it.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { computeStageLeadTime, type StageDef } from './leadtime';
import type { Transition } from './task';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from hari_libur where keterangan like 'ZZ-%'`;
});

const d = (s: string): Date => new Date(`${s}T00:00:00Z`);
const ev = (to: string, at: string): Transition => ({ to, at: d(at) });

const oneStageDef = (target: number | null): StageDef[] => [
  { stageCode: 'A', label: 'A', urutan: 1, sumber: 'stage', statusDipetakan: null, gatePihak: null, targetHariKerja: target },
  { stageCode: 'B', label: 'B', urutan: 2, sumber: 'stage', statusDipetakan: null, gatePihak: null, targetHariKerja: null },
];

describeDb('computeStageLeadTime — hari kerja (PRD §2 Rule 6, Uji wajib #4)', () => {
  it('a Friday start with a 1hk target lands Monday — weekends are not counted', async () => {
    // Brief lahir Jumat (masuk tahap A = briefCreatedAt); keluar tahap A Senin
    // (transisi ke B) — persis 1 hari kerja (Jumat→Senin, Sabtu/Minggu bukan
    // hari kerja).
    const briefCreatedAt = d('2026-08-28'); // Jumat
    const stageEvents: Transition[] = [ev('B', '2026-08-31')]; // Senin
    const summary = await computeStageLeadTime(sql, oneStageDef(1), stageEvents, [], new Map(), briefCreatedAt, null);
    const a = summary.stages.find((s) => s.stageCode === 'A')!;
    expect(a.hariKerja).toBe(1);
    expect(a.status).toBe('tepat_waktu');
  });

  it('inserting a national holiday between the two dates shifts the due date (Lebaran case)', async () => {
    await sql`insert into hari_libur (tanggal, keterangan, created_by) values ('2026-08-31', 'ZZ-libur-uji', 'ZZ-TEST')`;
    const briefCreatedAt = d('2026-08-28'); // Jumat
    const stageEvents: Transition[] = [ev('B', '2026-09-01')]; // Selasa (Senin libur)
    const summary = await computeStageLeadTime(sql, oneStageDef(1), stageEvents, [], new Map(), briefCreatedAt, null);
    const a = summary.stages.find((s) => s.stageCode === 'A')!;
    // Tanpa libur: Jumat→Selasa = 2 hari kerja (Senin+Selasa). Dengan Senin
    // libur: hanya Selasa = 1 hari kerja — target 1hk tetap tepat_waktu, BUKAN
    // 2 hari kerja seperti tanpa libur (buktinya libur benar-benar dihitung).
    expect(a.hariKerja).toBe(1);
  });

  it('brief_stage_sla override wins over the pipeline default (Rule 7)', async () => {
    const briefCreatedAt = d('2026-08-24'); // Senin
    const stageEvents: Transition[] = [ev('B', '2026-08-27')]; // Kamis = 3 hari kerja
    const overrides = new Map([['A', 5]]);
    const summary = await computeStageLeadTime(sql, oneStageDef(1), stageEvents, [], overrides, briefCreatedAt, null);
    const a = summary.stages.find((s) => s.stageCode === 'A')!;
    expect(a.targetHariKerja).toBe(5); // override, bukan default (1)
    expect(a.status).toBe('tepat_waktu'); // 3 hk <= override 5
  });

  it('no target anywhere ⇒ tidak_berlaku (N/A), never defaulted (Rule 8)', async () => {
    const briefCreatedAt = d('2026-08-24');
    const stageEvents: Transition[] = [ev('B', '2026-08-27')];
    const summary = await computeStageLeadTime(sql, oneStageDef(null), stageEvents, [], new Map(), briefCreatedAt, null);
    const a = summary.stages.find((s) => s.stageCode === 'A')!;
    expect(a.targetHariKerja).toBeNull();
    expect(a.status).toBe('tidak_berlaku');
  });

  it("gate_pihak='KLIEN' is recorded but excluded from totalHariKerja (Rule 9)", async () => {
    const defs: StageDef[] = [
      { stageCode: 'A', label: 'A', urutan: 1, sumber: 'stage', statusDipetakan: null, gatePihak: null, targetHariKerja: 1 },
      { stageCode: 'Gate', label: 'Gate', urutan: 2, sumber: 'stage', statusDipetakan: null, gatePihak: 'KLIEN', targetHariKerja: 1 },
      { stageCode: 'C', label: 'C', urutan: 3, sumber: 'stage', statusDipetakan: null, gatePihak: null, targetHariKerja: 1 },
    ];
    const briefCreatedAt = d('2026-08-24'); // Senin
    const stageEvents: Transition[] = [
      ev('Gate', '2026-08-25'), // A: Senin→Selasa = 1hk
      ev('C', '2026-08-31'), // Gate: Selasa→Senin (lewat akhir pekan) = 4hk menunggu klien
      ev('ZZZ', '2026-09-01'), // C: Senin→Selasa = 1hk (state penutup di luar defs, murni penanda waktu keluar)
    ];
    const summary = await computeStageLeadTime(sql, defs, stageEvents, [], new Map(), briefCreatedAt, null);
    const gate = summary.stages.find((s) => s.stageCode === 'Gate')!;
    const a = summary.stages.find((s) => s.stageCode === 'A')!;
    const c = summary.stages.find((s) => s.stageCode === 'C')!;
    expect(a.hariKerja).toBe(1);
    expect(gate.hariKerja).toBe(4); // dicatat...
    expect(gate.status).toBe('tidak_berlaku'); // ...tapi tidak dihakimi tepat_waktu/terlambat
    expect(c.hariKerja).toBe(1);
    // ...dan TIDAK PERNAH masuk totalHariKerja: total = A + C saja (2), bukan
    // A + Gate + C (6) — buktinya Gate benar-benar dikeluarkan, bukan cuma
    // ditandai.
    expect(summary.totalHariKerja).toBe(2);
  });

  it('tahapAktif is the checkpoint currently open (masukPada set, keluarPada null)', async () => {
    const briefCreatedAt = d('2026-08-24');
    const stageEvents: Transition[] = []; // never left stage A
    const summary = await computeStageLeadTime(sql, oneStageDef(1), stageEvents, [], new Map(), briefCreatedAt, null);
    expect(summary.tahapAktif).toBe('A');
  });

  it('the intake range (briefCreatedAt → reviewedAt) is always populated, independent of the pipeline', async () => {
    const briefCreatedAt = d('2026-08-24'); // Senin
    const reviewedAt = d('2026-08-25'); // Selasa — 1 hari kerja
    const summary = await computeStageLeadTime(sql, [], [], [], new Map(), briefCreatedAt, reviewedAt);
    expect(summary.stages).toEqual([]);
    expect(summary.intake.hariKerja).toBe(1);
    expect(summary.intake.keluarPada).toEqual(reviewedAt);
  });
});
