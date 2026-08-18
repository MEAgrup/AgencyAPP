/**
 * D-05 — the M6D close gate (narrative-required) + the `wrr_catatan_divisi`
 * append-only guard, under the real DB path. Complements `recap.test.ts` (D-02
 * machine edges) and `recap.reals.test.ts` (D-03 auto-block).
 *
 * §4 Rule 8 / RM-D: closing a recap (`Terbuka → Ditutup`, the AM edge) requires
 * RM-D1 «Yang Bergerak» + RM-D3 «Fokus Minggu Depan», and RM-D2 «Yang Tertahan»
 * when a Brief was blocked that week. RM-D6 / Rule 10: the division-note thread is
 * append-only. Rule 7: a filed `Sengketa Angka` never blocks the close.
 *
 * The close is driven through `sm_transition` (the real write path — the trigger
 * fires on its UPDATE), so a blocked close throws and a clean one returns ok.
 *
 *   1. no narrative → close blocked;
 *   2. RM-D1 only (RM-D3 missing) → blocked;
 *   3. RM-D1 + RM-D3, no blocker → close succeeds;
 *   4. a blocker exists but RM-D2 missing → blocked;
 *   5. a blocker exists and RM-D2 present → succeeds;
 *   6. force-close (`Terbuka → Ditutup Otomatis`) is NOT gated (Rule 8);
 *   7. a filed Sengketa Angka does not block the close and never mutates the auto
 *      value (Rule 7);
 *   8. `wrr_catatan_divisi` is append-only: UPDATE + DELETE refused, INSERT ok.
 *
 * Skipped unless DATABASE_URL is set. Rows are namespaced `ZZC-`; the append-only
 * thread is TRUNCATEd in afterEach (a cascading DELETE would fire its own guard —
 * same precedent as `strategi_version` in strategi.test.ts). "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const OWNER_AM = 'ZZC-AM';
const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

/** Seed a client + one `Terbuka` recap; returns the recap id. */
async function seedOpenRecap(): Promise<string> {
  seq += 1;
  const clientId = `ZZC-CLI-${RUN}-${seq}`;
  const id = `ZZC-WRR-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZC-SALES', 'ZZC-SALES', ${OWNER_AM}, now(), ${OWNER_AM})`;
  await sql`
    insert into weekly_result_recap
      (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
    values (${id}, ${clientId}, null, 2026, ${33 + seq}, '2026-08-10', '2026-08-16', 'Terbuka', 'SYSTEM')`;
  return id;
}

/** Write the RM-D narrative (what the AM does before close). Owner connection. */
async function seedNarasi(
  recapId: string,
  n: { bergerak?: string; tertahan?: string; fokus?: string },
): Promise<void> {
  await sql`
    insert into wrr_catatan (recap_id, yang_bergerak, yang_tertahan, fokus_minggu_depan, created_by)
    values (${recapId}, ${n.bergerak ?? null}, ${n.tertahan ?? null}, ${n.fokus ?? null}, ${OWNER_AM})`;
}

/** A division production row with `blocked` briefs this week (RM-D2 trigger). */
async function seedBlocker(recapId: string): Promise<void> {
  await sql`
    insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
    values (${recapId}, 'Creative', 4,
            '{"video":4,"brief":{"submitted":2,"approved":4,"revision":0,"blocked":1}}'::jsonb, 'SYSTEM')`;
}

/** Drive a status move through sm_transition (the real close path). */
function smTransition(id: string, to: string, actor = OWNER_AM) {
  return sql<{ r: { ok: boolean; to?: string; code?: string } }[]>`
    select sm_transition('weekly_result_recap','weekly_result_recap','weekly_result_recap',
                         'id','status', ${id}, ${to}, ${actor}, false, false) as r`;
}

afterEach(async () => {
  if (!sql) return;
  await sql`truncate wrr_catatan_divisi`; // append-only — bypass its no-delete guard
  await sql`delete from weekly_result_recap where created_by in ('SYSTEM') and client_id like 'ZZC-CLI-%'`;
  await sql`delete from clients where id like 'ZZC-CLI-%'`;
});

afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('M6D close gate — narrative required (D-05)', () => {
  it('blocks Terbuka → Ditutup when no narrative exists', async () => {
    const id = await seedOpenRecap();
    await expect(smTransition(id, 'Ditutup')).rejects.toThrow(/narasi mingguan wajib/);
    const rows = await sql<{ status: string }[]>`
      select status from weekly_result_recap where id = ${id}`;
    expect(rows[0].status).toBe('Terbuka'); // move rolled back
  });

  it('blocks close when RM-D1 is present but RM-D3 is missing', async () => {
    const id = await seedOpenRecap();
    await seedNarasi(id, { bergerak: 'ROAS bertahan 4,6' }); // no fokus
    await expect(smTransition(id, 'Ditutup')).rejects.toThrow(/narasi mingguan wajib/);
  });

  it('allows close when RM-D1 + RM-D3 are present and there is no blocker', async () => {
    const id = await seedOpenRecap();
    await seedNarasi(id, { bergerak: 'ROAS bertahan 4,6', fokus: 'kejar sisa 11 video' });
    const res = await smTransition(id, 'Ditutup');
    expect(res[0].r.ok).toBe(true);
    expect(res[0].r.to).toBe('Ditutup');
  });

  it('blocks close when a Brief was blocked this week but RM-D2 is empty', async () => {
    const id = await seedOpenRecap();
    await seedNarasi(id, { bergerak: 'ROAS bertahan 4,6', fokus: 'kejar sisa 11 video' });
    await seedBlocker(id);
    await expect(smTransition(id, 'Ditutup')).rejects.toThrow(/Yang Tertahan.*wajib/);
  });

  it('allows close when a blocker exists and RM-D2 is filled', async () => {
    const id = await seedOpenRecap();
    await seedNarasi(id, {
      bergerak: 'ROAS bertahan 4,6',
      tertahan: '1 Brief Creative [Blocked] nunggu foto produk klien',
      fokus: 'follow up foto produk',
    });
    await seedBlocker(id);
    const res = await smTransition(id, 'Ditutup');
    expect(res[0].r.ok).toBe(true);
  });

  it('does NOT gate the system force-close (Terbuka → Ditutup Otomatis)', async () => {
    const id = await seedOpenRecap(); // no narrative at all
    const res = await smTransition(id, 'Ditutup Otomatis', 'SYSTEM');
    expect(res[0].r.ok).toBe(true);
    expect(res[0].r.to).toBe('Ditutup Otomatis');
  });

  it('lets a filed Sengketa Angka pass the close and never mutates the auto value (Rule 7)', async () => {
    const id = await seedOpenRecap();
    await seedNarasi(id, { bergerak: 'ROAS bertahan 4,6', fokus: 'kejar sisa video' });
    // An auto figure the AM disputes but cannot rewrite (system-written row).
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, sengketa, created_by)
              values (${id}, 'roas_ads', 'otomatis', 4.6, 'angka tak cocok dashboard iklan', 'SYSTEM')`;
    const res = await smTransition(id, 'Ditutup');
    expect(res[0].r.ok).toBe(true);
    const rows = await sql<{ nilai: string; sengketa: string | null }[]>`
      select nilai, sengketa from wrr_metrik where recap_id = ${id} and metrik = 'roas_ads'`;
    expect(Number(rows[0].nilai)).toBe(4.6); // dispute never mutates the figure
    expect(rows[0].sengketa).toContain('tak cocok');
  });

  it('re-aggregates the non-disputed auto figures at close (freeze-as-of-close)', async () => {
    const id = await seedOpenRecap();
    await seedNarasi(id, { bergerak: 'ROAS bertahan 4,6', fokus: 'kejar sisa video' });
    // A stale auto figure left over from the empty week-open aggregate: no
    // dispute, so close must REFRESH it from the (here productionless) window → 0.
    // This is the other half of Rule 7: only a filed Sengketa freezes a figure.
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${id}, 'gmv_interim', 'otomatis', 999000000, 'SYSTEM')`;
    const res = await smTransition(id, 'Ditutup');
    expect(res[0].r.ok).toBe(true);
    const rows = await sql<{ nilai: string }[]>`
      select nilai from wrr_metrik where recap_id = ${id} and metrik = 'gmv_interim'`;
    expect(Number(rows[0].nilai)).toBe(0); // refreshed from the real window, not frozen stale
  });
});

describeDb('M6D wrr_catatan_divisi is append-only (D-05 / RM-D6)', () => {
  it('accepts an INSERT but refuses UPDATE and DELETE', async () => {
    const id = await seedOpenRecap();
    await sql`insert into wrr_catatan_divisi (recap_id, divisi, catatan, created_by)
              values (${id}, 'Creative', 'Minggu ini 4 video approved.', 'ZZC-CRE')`;
    await expect(
      sql`update wrr_catatan_divisi set catatan = 'diubah' where recap_id = ${id}`,
    ).rejects.toThrow(/append-only|immutable/i);
    await expect(
      sql`delete from wrr_catatan_divisi where recap_id = ${id}`,
    ).rejects.toThrow(/append-only|immutable/i);
    const rows = await sql<{ catatan: string }[]>`
      select catatan from wrr_catatan_divisi where recap_id = ${id}`;
    expect(rows[0].catatan).toContain('4 video approved');
  });
});
