/**
 * IV-LABEL-AKSI — tombol "Alur status" interview, ketokan pemilik 2026-09-20:
 * label kata kerja, dan dua langkah terakhir jalur utama digabung jadi satu
 * tombol "Selesaikan".
 */
import { describe, expect, it } from 'vitest';
import { interviewAksi } from './interview';

const label = (status: string, canLead: boolean) =>
  interviewAksi(status, canLead).map((a) => a.label);

describe('interviewAksi', () => {
  it('Sedang Berlangsung → "Simpan" (bukan "Draft Isian")', () => {
    expect(label('Sedang Berlangsung', false)).toContain('Simpan');
    expect(label('Sedang Berlangsung', false)).not.toContain('Draft Isian');
  });

  it('Draft Isian → "Selesaikan", menggantikan "Ajukan"', () => {
    const l = label('Draft Isian', false);
    expect(l).toContain('Selesaikan');
    expect(l).not.toContain('Ajukan');
    expect(l).not.toContain('Diajukan');
  });

  it('"Selesaikan" dari Draft Isian menjalankan DUA transisi berurutan', () => {
    const aksi = interviewAksi('Draft Isian', false).find((a) => a.label === 'Selesaikan');
    expect(aksi?.rantai).toEqual(['Diajukan', 'Selesai']);
  });

  it('Diajukan → "Selesaikan" satu langkah saja', () => {
    const aksi = interviewAksi('Diajukan', false).find((a) => a.label === 'Selesaikan');
    expect(aksi?.rantai).toEqual(['Selesai']);
  });

  it('jalur pengecualian tetap ada, berlabel kata kerja', () => {
    expect(label('Draft Isian', false)).toContain('Tandai butuh data klien');
    expect(label('Draft Isian', true)).toContain('Batalkan');
  });

  it('aksi khusus lead hanya muncul untuk lead', () => {
    expect(label('Diajukan', false)).not.toContain('Kembalikan ke AM');
    expect(label('Diajukan', true)).toContain('Kembalikan ke AM');
  });

  it('menandai jalur utama vs pengecualian', () => {
    const aksi = interviewAksi('Draft Isian', true);
    expect(aksi.find((a) => a.label === 'Selesaikan')?.utama).toBe(true);
    expect(aksi.find((a) => a.label === 'Tandai butuh data klien')?.utama).toBe(false);
    expect(aksi.find((a) => a.label === 'Batalkan')?.utama).toBe(false);
  });

  it('membawa serta requireReason milik transisi aslinya', () => {
    const batal = interviewAksi('Draft Isian', true).find((a) => a.label === 'Batalkan');
    expect(batal?.requireReason).toBe(true);
    const selesai = interviewAksi('Draft Isian', true).find((a) => a.label === 'Selesaikan');
    expect(selesai?.requireReason).toBe(false);
  });

  it('memberi tooltip HANYA pada tombol rantai ganda', () => {
    const aksi = interviewAksi('Draft Isian', false);
    expect(aksi.find((a) => a.label === 'Selesaikan')?.judul).not.toBeNull();
    expect(aksi.find((a) => a.label === 'Tandai butuh data klien')?.judul).toBeNull();
  });

  it('setiap aksi punya rantai tidak kosong', () => {
    for (const status of ['Sedang Berlangsung', 'Draft Isian', 'Diajukan', 'Dikembalikan']) {
      for (const a of interviewAksi(status, true)) {
        expect(a.rantai.length).toBeGreaterThan(0);
      }
    }
  });

  it('status terminal tidak menawarkan aksi', () => {
    expect(interviewAksi('Selesai', true)).toEqual([]);
    expect(interviewAksi('Dibatalkan', true)).toEqual([]);
  });
});
