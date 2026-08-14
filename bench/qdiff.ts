import postgres from 'postgres';
import { previewCurrent } from '../packages/domain/src/performance';
import { permission } from '@cdps/core';
const seen: string[] = [];
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, debug: (_c, q) => { seen.push(q.replace(/\s+/g,' ').slice(0,110)); } });
const director = { employeeId: 'ZZ-DBG', divisi: 'Management', role: permission.makeRole({ director: true }) };
const now = new Date('2026-06-17T05:00:00Z');
async function run(staff: string, label: string) {
  seen.length = 0;
  await previewCurrent(sql, director, staff, now);
  console.log(`--- ${label} (${seen.length})`);
  seen.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}
async function main() {
  await run(process.argv[2], 'A');
  await run(process.argv[3], 'B');
  await sql.end();
}
main();
