/**
 * P-1 benchmark harness (throwaway, local DB only).
 * Counts round-trips (postgres.js `debug` hook) + wall time per hot read.
 */
import postgres from 'postgres';
import * as health from '../packages/domain/src/health';
import * as performance from '../packages/domain/src/performance';

const URL = process.env.DATABASE_URL!;
let queries = 0;
const sql = postgres(URL, {
  prepare: false,
  debug: () => {
    queries++;
  },
});

const director = {
  employeeId: 'EMP-0008',
  role: { division: 'Management', level: '', od: false, director: true },
};
const NOW = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01 → closed month = July 2026

async function bench(name: string, fn: () => Promise<unknown>, runs = 3): Promise<void> {
  await fn(); // warm
  const times: number[] = [];
  let q = 0;
  for (let i = 0; i < runs; i++) {
    queries = 0;
    const t0 = Date.now();
    await fn();
    times.push(Date.now() - t0);
    q = queries;
  }
  times.sort((a, b) => a - b);
  console.log(
    `${name.padEnd(38)} queries=${String(q).padStart(5)}  median=${String(times[Math.floor(runs / 2)]).padStart(6)}ms`,
  );
}

async function main() {
  await bench('health.portfolio', () => health.portfolio(sql, director));
  await bench('health.preview (1 client)', () => health.preview(sql, director, 'CLI-202607-0001', NOW));
  await bench('perf.previewCurrent AM   (EMP-0002)', () => performance.previewCurrent(sql, director, 'EMP-0002', NOW));
  await bench('perf.previewCurrent Creative(EMP-0003)', () => performance.previewCurrent(sql, director, 'EMP-0003', NOW));
  await bench('perf.previewCurrent Ads  (EMP-0004)', () => performance.previewCurrent(sql, director, 'EMP-0004', NOW));
  await bench('perf.previewCurrent KOL  (EMP-0005)', () => performance.previewCurrent(sql, director, 'EMP-0005', NOW));
  await bench('perf.teamRollup Creative', () => performance.teamRollup(sql, director, 'Creative', ''), 1);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
