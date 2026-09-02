/**
 * Invariant katalog jenis task P-C. Dua di antaranya bukan kerapian kosmetik —
 * keduanya adalah alasan `plan_row` TIDAK punya kolom `jenis_task` dan alasan
 * laporan per `jenis` boleh dipercaya. Kalau salah satu gagal, tambahkan
 * kolomnya atau perbaiki katalognya; jangan longgarkan tesnya.
 */
import { describe, it, expect } from 'vitest';
import * as plantask from './plantask';
import * as division from './division';

describe('PLAN_TASK_CATALOG', () => {
  it('setiap divisi berkatalog terdaftar di registry dan boleh menerima Brief (PC-8)', () => {
    const assignable = new Set(division.briefAssignableNames());
    for (const nama of Object.keys(plantask.PLAN_TASK_CATALOG)) {
      expect(division.byNama(nama), `${nama} tak ada di division_registry`).toBeDefined();
      expect(assignable.has(nama), `${nama} tak boleh jadi PIC baris Plan`).toBe(true);
    }
  });

  it('mencakup keenam divisi operasional yang pemilik sebut (2026-09-02)', () => {
    // Daftar pemilik verbatim: ads, creative, kol, live stream, ai optimizer,
    // store operation. Persis `dispatchNames()` — kalau divisi operasional
    // ditambah nanti, tes ini menuntut katalognya ikut diisi.
    for (const nama of division.dispatchNames()) {
      expect(plantask.punyaKatalog(nama), `${nama} belum punya jenis task`).toBe(true);
    }
  });

  it('Account/Ops SENGAJA tanpa katalog (satuan teks bebas lewat "Lainnya")', () => {
    expect(plantask.jenisFor('Account')).toEqual([]);
    expect(plantask.jenisFor('Ops')).toEqual([]);
    expect(plantask.punyaKatalog('Ops')).toBe(false);
  });

  it('`jenis` unik SECARA GLOBAL — laporan per jenis tak mencampur dua tim', () => {
    const semua = Object.values(plantask.PLAN_TASK_CATALOG).flatMap((v) => v.map((j) => j.jenis));
    expect(new Set(semua).size).toBe(semua.length);
  });

  it('`satuan` unik di dalam satu divisi — invariant "tak perlu kolom jenis_task"', () => {
    for (const [nama, list] of Object.entries(plantask.PLAN_TASK_CATALOG)) {
      const satuan = list.map((j) => j.satuan.toLowerCase());
      expect(new Set(satuan).size, `satuan bertabrakan di divisi ${nama}`).toBe(satuan.length);
    }
  });

  it('setiap satuan masuk plan_row.satuan varchar(32) dan tiap label terisi', () => {
    for (const list of Object.values(plantask.PLAN_TASK_CATALOG)) {
      for (const j of list) {
        expect(j.satuan.trim()).not.toBe('');
        expect(j.satuan.length).toBeLessThanOrEqual(32);
        expect(j.label.trim()).not.toBe('');
        expect(j.jenis).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });

  it('hanya Ads yang bersatuan Rupiah (money) — sisanya hitungan', () => {
    const money = Object.entries(plantask.PLAN_TASK_CATALOG)
      .filter(([, list]) => list.some((j) => j.money === true))
      .map(([nama]) => nama);
    expect(money).toEqual(['Ads']);
  });
});

describe('jenisBySatuan — jalur baca balik (tanpa kolom jenis_task)', () => {
  it('memulihkan jenis dari (divisi, satuan) yang tersimpan di baris', () => {
    expect(plantask.jenisBySatuan('Creative', 'video')?.jenis).toBe('video_seller');
    expect(plantask.jenisBySatuan('KOL', 'video')?.jenis).toBe('video_creator');
    expect(plantask.jenisBySatuan('AI Optimizer', 'video')?.jenis).toBe('ai_video');
    expect(plantask.jenisBySatuan('Store Operation', 'promo')?.jenis).toBe('setup_promo_toko');
    expect(plantask.jenisBySatuan('Live Stream', 'jam live')?.jenis).toBe('jam_live');
  });

  it('satuan yang sama di divisi berbeda memulihkan jenis yang BERBEDA', () => {
    // Ini yang membuat pasangan (divisi, satuan) cukup: "video" sendirian ambigu.
    const a = plantask.jenisBySatuan('Creative', 'video')?.jenis;
    const b = plantask.jenisBySatuan('KOL', 'video')?.jenis;
    expect(a).not.toBe(b);
  });

  it('toleran huruf besar/kecil dan spasi tepi (satuan lama diisi manual)', () => {
    expect(plantask.jenisBySatuan('Creative', '  SKU ')?.jenis).toBe('sku_optimize');
  });

  it('undefined untuk satuan bebas ("Lainnya") atau divisi tanpa katalog', () => {
    expect(plantask.jenisBySatuan('Creative', 'listing')).toBeUndefined();
    expect(plantask.jenisBySatuan('Ops', 'video')).toBeUndefined();
  });
});

describe('picGroups — dua grup picker PC-8', () => {
  it('grup pertama = divisi operasional, kedua = Account/Ops', () => {
    const g = plantask.picGroups();
    expect(g.map((x) => x.label)).toEqual(['Divisi Operasional', 'Internal']);
    expect(g[0].divisi).toEqual([
      'Creative', 'Ads', 'KOL', 'Live Stream', 'AI Optimizer', 'Store Operation',
    ]);
    expect(g[1].divisi).toEqual(['Account', 'Ops']);
  });

  it('gabungan kedua grup = tepat BRIEF_ASSIGNABLE (tak ada divisi yang hilang dari picker)', () => {
    const flat = plantask.picGroups().flatMap((g) => g.divisi);
    expect(flat.slice().sort()).toEqual(division.briefAssignableNames().slice().sort());
    expect(new Set(flat).size).toBe(flat.length);
  });
});
