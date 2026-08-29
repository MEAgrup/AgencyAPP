/**
 * M16 — gerbang registry divisi: `DIVISIONS` (TS) ≡ `division_registry` (DB).
 *
 * KENAPA ADA. Sebelum M16, daftar divisi ditulis ulang di delapan tempat, dan
 * melewatkan satu menghasilkan divisi yang bisa menerima Brief tapi tidak
 * muncul di rekap — atau sebaliknya. M16 menjadikannya satu registry, tapi
 * registry yang hidup di dua tempat (konstanta TS + tabel DB) hanya berguna
 * kalau ada yang memaksa keduanya identik. Ini berkas itu.
 *
 * Polanya sengaja meniru `ident.registry.test.ts` (prefix `PREFIXES` ↔
 * `entity_prefix`), termasuk alasannya tinggal di `@cdps/db`: ia butuh KEDUA
 * belahan — registry TS (core) dan koneksi Postgres (db). `core` memang tidak
 * punya dependency `postgres`/`@types/node`.
 *
 * Perbandingannya SET-EQUAL pada seluruh flag, bukan sekadar hitungan baris.
 * Hitungan bisa cocok sementara dua kesalahan saling menutupi — persis blind
 * spot yang dicatat `notif_catalog.reals.test.ts` untuk katalog notifikasi.
 *
 * Di-skip tanpa `DATABASE_URL` (konvensi sama dengan suite *.reals / RLS).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { division } from '@cdps/core';
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

/** Bentuk kanonik satu baris registry, dipakai kedua sisi supaya bisa dibanding. */
interface Row {
  code: string;
  nama: string;
  aktif: boolean;
  brief_assignable: boolean;
  dispatch_target: boolean;
  punya_kuota_satuan: boolean;
  vendor_managed: boolean;
  urutan: number;
}

function fromTs(): Row[] {
  return division.DIVISIONS.map((d) => ({
    code: d.code,
    nama: d.nama,
    aktif: d.aktif,
    brief_assignable: d.briefAssignable,
    dispatch_target: d.dispatchTarget,
    punya_kuota_satuan: d.punyaKuotaSatuan,
    vendor_managed: d.vendorManaged,
    urutan: d.urutan,
  })).sort((a, b) => a.code.localeCompare(b.code));
}

describe('M16 registry divisi — invariant TS', () => {
  it('kode dan nama unik', () => {
    const codes = division.DIVISIONS.map((d) => d.code);
    const namas = division.DIVISIONS.map((d) => d.nama);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(namas).size).toBe(namas.length);
  });

  it('urutan unik (menentukan urutan tampil picker)', () => {
    const urutan = division.DIVISIONS.map((d) => d.urutan);
    expect(new Set(urutan).size).toBe(urutan.length);
  });

  it('tujuan dispatch Strategi selalu bisa menerima Brief', () => {
    // Kalau tidak, AM bisa memilih divisi di STRG I-2 yang lalu menolak
    // Brief-nya. Dicerminkan CHECK `ck_division_dispatch_implies_assignable`.
    const rusak = division.DIVISIONS.filter((d) => d.dispatchTarget && !d.briefAssignable);
    expect(rusak.map((d) => d.code)).toEqual([]);
  });

  // Pasangan `punya_kuota_satuan` ↔ `TASK_CATALOG` diperiksa di
  // packages/domain/src/division.test.ts — bukan di sini: `@cdps/domain`
  // bergantung pada `@cdps/db`, jadi mengimpornya dari berkas ini akan
  // menciptakan siklus.

  it('daftar turunan hanya berisi divisi aktif', () => {
    const aktif = new Set(division.DIVISIONS.filter((d) => d.aktif).map((d) => d.nama));
    for (const nama of [
      ...division.briefAssignableNames(),
      ...division.dispatchNames(),
      ...division.kuotaSatuanNames(),
    ]) {
      expect(aktif.has(nama)).toBe(true);
    }
  });
});

describeDb('M16 registry divisi — TS ≡ DB', () => {
  it('division_registry set-equal dengan DIVISIONS pada SELURUH flag', async () => {
    const rows = await db()<Row[]>`
      select code, nama, aktif, brief_assignable, dispatch_target,
             punya_kuota_satuan, vendor_managed, urutan
        from division_registry
       order by code asc`;
    const dbRows = rows.map((r) => ({ ...r, urutan: Number(r.urutan) }));
    expect(dbRows).toEqual(fromTs());
  });
});
