import { describe, expect, it } from 'vitest';
import {
  batchMingguanHanyaHarian,
  batchPenentuKirim,
  rentangPeriodeLaporan,
  seninDari,
  seninMingguLalu,
  type PdtBatchRingkas,
} from './pdt';

// PDT-MINGGUAN (2026-10-01) — helper murni pemilih minggu & gerbang batch.
describe('PDT-MINGGUAN — pemilih minggu', () => {
  it('seninDari menormalkan hari apa pun ke Senin minggu itu (Minggu ikut minggu sebelumnya)', () => {
    expect(seninDari('2026-07-06')).toBe('2026-07-06'); // Senin
    expect(seninDari('2026-07-09')).toBe('2026-07-06'); // Kamis
    expect(seninDari('2026-07-12')).toBe('2026-07-06'); // Minggu
    expect(seninDari('2026-07-01')).toBe('2026-06-29'); // lintas bulan
  });

  it('default = Senin minggu penuh terakhir', () => {
    expect(seninMingguLalu('2026-10-01')).toBe('2026-09-21');
  });

  it('rentang laporan: mingguan 7 hari, bulanan sampai akhir bulan', () => {
    expect(rentangPeriodeLaporan('mingguan', '2026-06-29')).toEqual({ mulai: '2026-06-29', selesai: '2026-07-05' });
    expect(rentangPeriodeLaporan('bulanan', '2026-02-01')).toEqual({ mulai: '2026-02-01', selesai: '2026-02-28' });
  });

  it('batch ≤10 hari yang tidak mulai tanggal 1 = hanya data harian', () => {
    expect(batchMingguanHanyaHarian('2026-07-06', '2026-07-12')).toBe(true);
    expect(batchMingguanHanyaHarian('2026-07-01', '2026-07-07')).toBe(false);
    expect(batchMingguanHanyaHarian('2026-07-05', '2026-07-31')).toBe(false);
  });
});

describe('PDT-MINGGUAN — batchPenentuKirim memakai rentang minggu', () => {
  const b = (id: number, mulai: string, selesai: string, status: string): PdtBatchRingkas =>
    ({ id, periode_mulai: mulai, periode_selesai: selesai, status, dibuat_pada: `2026-07-${String(id).padStart(2, '0')}T00:00:00Z` }) as PdtBatchRingkas;

  it('batch ditolak di minggu lain tidak menentukan minggu ini', () => {
    const batches = [b(1, '2026-07-01', '2026-07-31', 'verified'), b(2, '2026-07-20', '2026-07-26', 'ditolak')];
    expect(batchPenentuKirim(batches, '2026-07-06', '2026-07-12')?.id).toBe(1);
    expect(batchPenentuKirim(batches, '2026-07-20', '2026-07-26')?.id).toBe(2);
    expect(batchPenentuKirim(batches, '2026-07-01')?.id).toBe(2); // bulanan: tetap perilaku lama
  });
});
