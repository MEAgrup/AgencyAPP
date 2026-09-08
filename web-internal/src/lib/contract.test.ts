import { describe, expect, it } from 'vitest';
import {
  AMBANG_SEGERA_HARI,
  contractWindow,
  hariIniWIB,
  labelJenisKontrak,
  selisihHari,
} from './contract';

describe('selisihHari', () => {
  it('menghitung hari kalender, bukan selisih jam', () => {
    expect(selisihHari('2026-09-08', '2026-09-09')).toBe(1);
    expect(selisihHari('2026-09-08', '2026-09-08')).toBe(0);
    expect(selisihHari('2026-09-09', '2026-09-08')).toBe(-1);
  });

  it('menyeberangi batas bulan dan tahun', () => {
    expect(selisihHari('2026-01-31', '2026-02-01')).toBe(1);
    expect(selisihHari('2026-12-31', '2027-01-01')).toBe(1);
    expect(selisihHari('2026-09-08', '2027-09-08')).toBe(365);
  });

  it('benar melewati 29 Februari tahun kabisat', () => {
    expect(selisihHari('2028-02-28', '2028-03-01')).toBe(2);
    expect(selisihHari('2027-02-28', '2027-03-01')).toBe(1);
  });

  it('menerima timestamp penuh dan hanya membaca tanggalnya', () => {
    expect(selisihHari('2026-09-08T23:59:59.000Z', '2026-09-09T00:00:00.000Z')).toBe(1);
  });
});

describe('contractWindow', () => {
  const MULAI = '2026-01-01';

  it('berjalan bila sisanya lebih dari ambang', () => {
    const w = contractWindow(MULAI, '2026-12-31', '2026-09-08');
    expect(w.state).toBe('berjalan');
    expect(w.hariTersisa).toBe(114);
  });

  it('segera bila sisanya tepat di ambang atau kurang', () => {
    expect(contractWindow(MULAI, '2026-10-08', '2026-09-08').state).toBe('segera');
    expect(contractWindow(MULAI, '2026-09-09', '2026-09-08').state).toBe('segera');
    // Batasnya inklusif — persis AMBANG hari lagi masih "segera".
    const batas = contractWindow(MULAI, '2026-10-08', '2026-09-08');
    expect(batas.hariTersisa).toBe(AMBANG_SEGERA_HARI);
  });

  it('HARI TERAKHIR kontrak masih terhitung berjalan, bukan berakhir', () => {
    // `ck_contracts_jendela` menuntut akhir > mulai, jadi jendelanya inklusif
    // di kedua ujung. Kontrak yang berakhir hari ini belum lewat.
    const w = contractWindow(MULAI, '2026-09-08', '2026-09-08');
    expect(w.hariTersisa).toBe(0);
    expect(w.state).toBe('segera');
  });

  it('berakhir bila tanggal akhirnya sudah lewat, dengan sisa negatif', () => {
    const w = contractWindow(MULAI, '2026-09-07', '2026-09-08');
    expect(w.state).toBe('berakhir');
    expect(w.hariTersisa).toBe(-1);
  });

  it('belum_mulai untuk kontrak yang tanggal mulainya di depan', () => {
    // Renewal yang dieksekusi lebih awal: jendelanya belum dibuka.
    const w = contractWindow('2026-10-01', '2027-09-30', '2026-09-08');
    expect(w.state).toBe('belum_mulai');
  });

  it('kontrak yang mulai HARI INI sudah berjalan, bukan belum_mulai', () => {
    expect(contractWindow('2026-09-08', '2027-09-07', '2026-09-08').state).toBe('berjalan');
  });
});

describe('hariIniWIB', () => {
  it('memakai tanggal WIB, bukan UTC — beda hari di malam hari', () => {
    // 2026-09-08T18:00Z = 2026-09-09 01:00 WIB ⇒ sudah tanggal 9 di Jakarta.
    expect(hariIniWIB(new Date('2026-09-08T18:00:00.000Z'))).toBe('2026-09-09');
    expect(hariIniWIB(new Date('2026-09-08T16:59:00.000Z'))).toBe('2026-09-08');
  });
});

describe('labelJenisKontrak', () => {
  it('memberi label yang dibaca manusia untuk ketiga jenis R-01', () => {
    expect(labelJenisKontrak('baru')).toBe('Baru');
    expect(labelJenisKontrak('perpanjangan')).toBe('Perpanjangan');
    expect(labelJenisKontrak('cross_sell')).toBe('Cross Sell');
  });

  it('mengembalikan nilai mentah untuk jenis yang belum dikenal, bukan melempar', () => {
    // Jenis baru bisa lahir di DB sebelum FE tahu namanya; melabelinya salah
    // lebih buruk daripada menampilkan nilai apa adanya.
    expect(labelJenisKontrak('bayar_komisi')).toBe('bayar_komisi');
  });
});
