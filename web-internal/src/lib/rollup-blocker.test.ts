/**
 * Tes kalimat diagnosis rollup (B-1a, `creative.pesanBlocker`).
 *
 * Yang diuji BUKAN kata-katanya, melainkan bahwa keenam sebab menghasilkan
 * kalimat yang BERBEDA dan menyebut akibatnya. Keluhan Account #3 & #4 bukan
 * "angkanya salah" — ia "statusnya tidak berubah dan tidak ada yang bilang
 * kenapa". Kalimat yang sama untuk dua sebab berbeda mengulangi persis
 * kesalahan itu, dan tidak akan pernah terlihat sebagai bug.
 */
import { describe, expect, it } from 'vitest';
import { pesanBlocker, type BriefRollupDiagnosis, type RollupBlocker } from './creative';

const d = (over: Partial<BriefRollupDiagnosis>): BriefRollupDiagnosis => ({
  brief_id: 'BRF-202609-0001',
  status: '[In Progress]',
  created: 3,
  target: 12,
  done: 3,
  blocker: 'unit_belum_lengkap',
  rollup_target: '[In Progress]',
  ...over,
});

const SEMUA: RollupBlocker[] = [
  'selesai', 'nol_unit', 'unit_belum_lengkap', 'di_luar_rantai',
  'menunggu_dependency', 'menunggu_pekerjaan',
];

describe('pesanBlocker', () => {
  it('null HANYA untuk `selesai` — supaya tidak ada kotak penjelasan kosong', () => {
    for (const blocker of SEMUA) {
      const pesan = pesanBlocker(d({ blocker }));
      expect(pesan === null, `blocker=${blocker}`).toBe(blocker === 'selesai');
    }
  });

  it('setiap sebab punya kalimat yang berbeda — nol tabrakan', () => {
    const pesan = SEMUA.filter((b) => b !== 'selesai').map((blocker) => pesanBlocker(d({ blocker })));
    expect(new Set(pesan).size).toBe(pesan.length);
  });

  it('kasus keluhan aslinya menyebut sisa, yang selesai, DAN akibatnya', () => {
    const pesan = pesanBlocker(d({ blocker: 'unit_belum_lengkap', created: 3, target: 12, done: 3 }), 'Aset');
    expect(pesan).toContain('12 Aset');
    expect(pesan).toContain('9 lagi'); // 12 - 3
    expect(pesan).toContain('3 dari 3'); // done dari created
    // Kalimat akibat inilah yang membuat orang berhenti menunggu status berubah.
    expect(pesan).toMatch(/tidak menggerakkan statusnya/);
  });

  it('`di_luar_rantai` mengatakan rollup-nya BERHENTI PERMANEN, bukan cuma "belum"', () => {
    // Ini sebab yang paling wajib bersuara: tidak ada peristiwa Aset yang bisa
    // memperbaikinya, jadi menunggu adalah tindakan yang salah.
    const pesan = pesanBlocker(d({ blocker: 'di_luar_rantai', status: '[Dispatched to Vendor]' }));
    expect(pesan).toMatch(/PERMANEN/);
    expect(pesan).toContain('[Dispatched to Vendor]');
  });

  it('`menunggu_dependency` mengatakan ia akan sembuh SENDIRI — beda tindakan', () => {
    const pesan = pesanBlocker(d({ blocker: 'menunggu_dependency', created: 12, done: 12 }));
    expect(pesan).toMatch(/menutup sendiri/);
  });

  it('satuan bisa diganti, dan dipakai di setiap kalimat yang menyebut unit', () => {
    for (const blocker of SEMUA.filter((b) => b !== 'selesai')) {
      const pesan = pesanBlocker(d({ blocker }), 'creator');
      expect(pesan, `blocker=${blocker}`).toContain('creator');
    }
  });

  it('sisa tidak pernah negatif walau `created` melewati `target`', () => {
    // Bisa terjadi kalau target diturunkan setelah unitnya dibuat; "−3 lagi
    // belum ada" adalah kalimat yang membuat orang berhenti percaya angkanya.
    const pesan = pesanBlocker(d({ blocker: 'unit_belum_lengkap', created: 15, target: 12 }));
    expect(pesan).not.toMatch(/-\d+ lagi/);
    expect(pesan).toContain('0 lagi');
  });
});
