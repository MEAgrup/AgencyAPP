/**
 * G1-02 — gerbang dual-home PDT: `pdt` (TS, `@cdps/core`) ≡ seed
 * `pdt_parser_modul`/`pdt_kolom_alias` (migrasi
 * `20261012010000_g1_02_seed_pdt_parser_modul.sql`).
 *
 * KENAPA ADA. `PDT_MODULES`/`PDT_KOLOM_ALIAS` (`packages/core/src/pdt/modules.ts`)
 * adalah "sumber yang dites"; migrasi menyalinnya literal ke SQL (pola sama
 * dengan `ADSSCANNER_BENCH_V1` ↔ `adsscanner_benchmark`, lihat
 * `packages/core/src/adsscanner/tiktok/bench.ts`). Dua salinan yang tidak
 * dipaksa identik hanyalah komentar — di sini divergensinya berbentuk sangat
 * spesifik: kalau TS punya tanda tangan yang DB tidak, `detectPdtModule` di
 * server memakai sinyal yang sudah basi begitu sesi lain menyeed ulang; kalau
 * DB punya baris yang TS tidak tahu, dropdown modul (Rule G1-09) menampilkan
 * modul yang tak satu pun kode di repo ini tahu cara mendeteksinya.
 *
 * Pola dan alasan lokasinya sama dengan `storeops.registry.test.ts`/
 * `dailyops.registry.test.ts`: butuh KEDUA belahan (konstanta TS `core` +
 * koneksi Postgres `db`), dan `core` sengaja tidak punya dependency `postgres`.
 *
 * Di-skip tanpa `DATABASE_URL`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { pdt } from '@cdps/core';
import { createClient, type Sql } from './client';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql | undefined;
function db(): Sql {
  sql ??= createClient(URL as string);
  return sql;
}

afterAll(async () => {
  await sql?.end();
});

describe('PDT modules (TS) — invariant', () => {
  it('nol kode ganda', () => {
    const kodes = pdt.PDT_MODULES.map((m) => m.kode);
    expect(new Set(kodes).size).toBe(kodes.length);
  });

  it('setiap modul punya tanda tangan non-kosong (must/mustNot/anyOf) — bukan objek jsonb kosong', () => {
    for (const m of pdt.PDT_MODULES) {
      const sig = m.tandaTanganKolom;
      const punyaIsi = (sig.must?.length ?? 0) > 0 || (sig.mustNot?.length ?? 0) > 0 || (sig.anyOf?.length ?? 0) > 0;
      expect(punyaIsi, `${m.kode} tanda tangannya kosong`).toBe(true);
    }
  });

  it('setiap alias menunjuk ke modul yang benar-benar ada di PDT_MODULES', () => {
    const kodes = new Set(pdt.PDT_MODULES.map((m) => m.kode));
    for (const a of pdt.PDT_KOLOM_ALIAS) expect(kodes.has(a.modulKode), `${a.modulKode} tidak terdaftar`).toBe(true);
  });
});

describeDb('PDT modules — TS ≡ pdt_parser_modul', () => {
  it('himpunan kode TS ≡ himpunan kode DB', async () => {
    const rows = await db()<{ kode: string }[]>`select kode from pdt_parser_modul order by kode`;
    expect(rows.map((r) => r.kode)).toEqual([...pdt.PDT_MODULES].map((m) => m.kode).sort());
  });

  it('platform, nama_tampilan, baris_header_hint, wajib, versi cocok per baris', async () => {
    const rows = await db()<
      { kode: string; platform: string; nama_tampilan: string; baris_header_hint: number; wajib: boolean; versi: number }[]
    >`select kode, platform, nama_tampilan, baris_header_hint, wajib, versi from pdt_parser_modul`;
    const byKode = new Map(rows.map((r) => [r.kode, r]));
    for (const m of pdt.PDT_MODULES) {
      const r = byKode.get(m.kode);
      expect(r, `${m.kode} tidak ada di DB`).toBeDefined();
      expect(r!.platform, m.kode).toBe(m.platform);
      expect(r!.nama_tampilan, m.kode).toBe(m.namaTampilan);
      expect(r!.baris_header_hint, m.kode).toBe(m.barisHeaderHint);
      expect(r!.wajib, m.kode).toBe(m.wajib);
      expect(r!.versi, m.kode).toBe(1);
    }
  });

  it('tanda_tangan_kolom (jsonb) ≡ PdtSignature TS, set-equal per array', async () => {
    const rows = await db()<{ kode: string; tanda_tangan_kolom: pdt.PdtSignature }[]>`
      select kode, tanda_tangan_kolom from pdt_parser_modul`;
    const byKode = new Map(rows.map((r) => [r.kode, r.tanda_tangan_kolom]));
    for (const m of pdt.PDT_MODULES) {
      const db_ = byKode.get(m.kode)!;
      expect([...(db_.must ?? [])].sort(), `${m.kode}.must`).toEqual([...(m.tandaTanganKolom.must ?? [])].sort());
      expect([...(db_.mustNot ?? [])].sort(), `${m.kode}.mustNot`).toEqual([...(m.tandaTanganKolom.mustNot ?? [])].sort());
      const dbAnyOf = (db_.anyOf ?? []).map((g) => [...(g.must ?? [])].sort().join('|') + '::' + [...(g.mustNot ?? [])].sort().join('|'));
      const tsAnyOf = (m.tandaTanganKolom.anyOf ?? []).map(
        (g) => [...(g.must ?? [])].sort().join('|') + '::' + [...(g.mustNot ?? [])].sort().join('|'),
      );
      expect(dbAnyOf.sort(), `${m.kode}.anyOf`).toEqual(tsAnyOf.sort());
    }
  });

  it('kolom_dipanen (text[]) ≡ kolomDipanen TS, set-equal', async () => {
    const rows = await db()<{ kode: string; kolom_dipanen: string[] }[]>`select kode, kolom_dipanen from pdt_parser_modul`;
    const byKode = new Map(rows.map((r) => [r.kode, r.kolom_dipanen]));
    for (const m of pdt.PDT_MODULES) {
      expect([...byKode.get(m.kode)!].sort(), m.kode).toEqual([...m.kolomDipanen].sort());
    }
  });

  it('kolom_opsional (text[]) ≡ kolomOpsional TS, set-equal (G1-08-SEBAGIAN)', async () => {
    const rows = await db()<{ kode: string; kolom_opsional: string[] }[]>`select kode, kolom_opsional from pdt_parser_modul`;
    const byKode = new Map(rows.map((r) => [r.kode, r.kolom_opsional]));
    for (const m of pdt.PDT_MODULES) {
      expect([...byKode.get(m.kode)!].sort(), m.kode).toEqual([...(m.kolomOpsional ?? [])].sort());
    }
  });
});

describe('PDT modules (TS) — kolomOpsional invariant (G1-08-SEBAGIAN)', () => {
  it('kolomOpsional (bila ada) SELALU subset kolomDipanen — nol kolom opsional yang tidak dipanen', () => {
    for (const m of pdt.PDT_MODULES) {
      const dipanen = new Set(m.kolomDipanen);
      for (const k of m.kolomOpsional ?? []) {
        expect(dipanen.has(k), `${m.kode}.kolomOpsional punya '${k}' yang tidak ada di kolomDipanen`).toBe(true);
      }
    }
  });

  it('kolomOpsional TIDAK PERNAH sama dengan seluruh kolomDipanen — selalu ada setidaknya satu kolom wajib', () => {
    for (const m of pdt.PDT_MODULES) {
      const opsional = m.kolomOpsional ?? [];
      if (opsional.length === 0) continue; // modul tanpa kolomOpsional (termasuk shopee_video, kolomDipanen-nya sendiri kosong) — tidak relevan
      expect(opsional.length, `${m.kode} — seluruh kolomDipanen jadi opsional, nol kolom wajib tersisa`).toBeLessThan(m.kolomDipanen.length);
    }
  });
});

describeDb('PDT alias — TS ≡ pdt_kolom_alias', () => {
  it('himpunan (modul_kode, kolom_kanonik, alias) TS ≡ DB', async () => {
    const rows = await db()<{ modul_kode: string; kolom_kanonik: string; alias: string }[]>`
      select modul_kode, kolom_kanonik, alias from pdt_kolom_alias`;
    const key = (m: string, k: string, a: string): string => `${m}::${k}::${a}`;
    const diDb = rows.map((r) => key(r.modul_kode, r.kolom_kanonik, r.alias)).sort();
    const diTs = pdt.PDT_KOLOM_ALIAS.map((a) => key(a.modulKode, a.kolomKanonik, a.alias)).sort();
    expect(diDb).toEqual(diTs);
  });
});
