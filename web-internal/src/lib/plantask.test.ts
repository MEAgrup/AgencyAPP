/**
 * Invariant cermin frontend katalog jenis task. Tidak bisa membandingkan dengan
 * `packages/core/src/plantask.ts` (web-internal tak punya dependency ke
 * `@cdps/*` — lihat header `plantask.ts`), jadi yang dijaga di sini adalah
 * invariant STRUKTURAL yang sama, plus dua fakta yang dipakai form:
 * satuan unik per divisi (jalur baca balik) dan PIC_GROUPS lengkap.
 */
import { describe, expect, it } from 'vitest';
import {
  PIC_GROUPS,
  PLAN_TASK_CATALOG,
  findJenis,
  jenisBySatuan,
  jenisFor,
} from './plantask';
import { DIVISI_KERJA, DISPATCH_DIVISIONS } from './divisions';

describe('PLAN_TASK_CATALOG (cermin FE)', () => {
  it('keenam divisi operasional punya jenis task', () => {
    for (const nama of DISPATCH_DIVISIONS) {
      expect(jenisFor(nama).length, `${nama} belum punya jenis task`).toBeGreaterThan(0);
    }
  });

  it('setiap divisi berkatalog boleh menerima Brief (PC-8)', () => {
    const kerja = new Set<string>(DIVISI_KERJA);
    for (const nama of Object.keys(PLAN_TASK_CATALOG)) expect(kerja.has(nama)).toBe(true);
  });

  it('Account/Ops sengaja tanpa katalog — satuan bebas lewat "Lainnya"', () => {
    expect(jenisFor('Account')).toEqual([]);
    expect(jenisFor('Ops')).toEqual([]);
  });

  it('`jenis` unik global; `satuan` unik per divisi dan ≤32 char (varchar(32))', () => {
    const semua = Object.values(PLAN_TASK_CATALOG).flatMap((l) => l.map((j) => j.jenis));
    expect(new Set(semua).size).toBe(semua.length);
    for (const [nama, list] of Object.entries(PLAN_TASK_CATALOG)) {
      const satuan = list.map((j) => j.satuan.toLowerCase());
      expect(new Set(satuan).size, `satuan bertabrakan di ${nama}`).toBe(satuan.length);
      for (const j of list) expect(j.satuan.length).toBeLessThanOrEqual(32);
    }
  });

  it('hanya Ads yang money — form lain merender input hitungan', () => {
    const money = Object.entries(PLAN_TASK_CATALOG)
      .filter(([, l]) => l.some((j) => j.money))
      .map(([n]) => n);
    expect(money).toEqual(['Ads']);
  });
});

describe('jalur baca balik (tanpa kolom plan_row.jenis_task)', () => {
  it('(divisi, satuan) memulihkan jenis yang tepat, termasuk "video" yang ambigu', () => {
    expect(jenisBySatuan('Creative', 'video')?.jenis).toBe('video_seller');
    expect(jenisBySatuan('KOL', 'video')?.jenis).toBe('video_creator');
    expect(jenisBySatuan('AI Optimizer', 'video')?.jenis).toBe('ai_video');
    expect(jenisBySatuan('Live Stream', 'jam live')?.jenis).toBe('jam_live');
    expect(jenisBySatuan('Store Operation', 'kasus')?.jenis).toBe('banding_pelanggaran');
  });

  it('satuan bebas / kosong / divisi tanpa katalog ⇒ undefined', () => {
    expect(jenisBySatuan('Creative', 'listing')).toBeUndefined();
    expect(jenisBySatuan('Creative', '')).toBeUndefined();
    expect(jenisBySatuan('Ops', 'video')).toBeUndefined();
  });

  it('findJenis mencari per kunci di dalam divisinya saja', () => {
    expect(findJenis('Ads', 'ads_spent')?.money).toBe(true);
    // `video_seller` milik Creative — tak boleh bocor ke KOL.
    expect(findJenis('KOL', 'video_seller')).toBeUndefined();
  });
});

describe('PIC_GROUPS', () => {
  it('gabungan kedua grup = tepat DIVISI_KERJA (tak ada divisi hilang dari picker)', () => {
    const flat = PIC_GROUPS.flatMap((g) => g.divisi);
    expect(flat.slice().sort()).toEqual([...DIVISI_KERJA].sort());
    expect(new Set(flat).size).toBe(flat.length);
  });

  it('grup operasional = DISPATCH_DIVISIONS, urut registry', () => {
    expect(PIC_GROUPS[0].divisi).toEqual([...DISPATCH_DIVISIONS]);
    expect(PIC_GROUPS[1].divisi).toEqual(['Account', 'Ops']);
  });

  it('AI Optimizer & Store Operation ADA di picker (bug yang dilaporkan pemilik)', () => {
    // Regresi yang dilaporkan 2026-09-02: keduanya hidup penuh server-side
    // (division_registry, createPlanRow) tapi `DIVISI_PIC` di halaman Plan
    // masih daftar enam item hardcode, jadi AM tak bisa memilihnya.
    expect(PIC_GROUPS[0].divisi).toContain('AI Optimizer');
    expect(PIC_GROUPS[0].divisi).toContain('Store Operation');
  });
});
