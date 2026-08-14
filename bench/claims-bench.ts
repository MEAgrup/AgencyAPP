/**
 * P-1: measure the fixed per-read overhead of the RLS claim envelope
 * (withClaims) — sequential SET statements vs pipelined.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const CLAIMS = JSON.stringify({
  app_metadata: { employee_id: 'EMP-0002', division: 'Account', level: 'staff', od: false, director: false },
});
const ROLE = 'authenticated';
const N = 300;

async function sequential(): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('request.jwt.claims', ${CLAIMS}, true)`;
    await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
    await tx`select 1`;
  });
}

async function pipelined(): Promise<void> {
  await sql.begin(async (tx) => {
    const a = tx`SELECT set_config('request.jwt.claims', ${CLAIMS}, true)`;
    const b = tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
    await Promise.all([a, b]);
    await tx`select 1`;
  });
}

async function time(name: string, fn: () => Promise<void>): Promise<void> {
  for (let i = 0; i < 30; i++) await fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${name.padEnd(14)} ${(ms / N).toFixed(3)} ms/read`);
}

async function main() {
  await time('sequential', sequential);
  await time('pipelined', pipelined);
  await time('sequential', sequential);
  await time('pipelined', pipelined);
  await sql.end();
}
main();
