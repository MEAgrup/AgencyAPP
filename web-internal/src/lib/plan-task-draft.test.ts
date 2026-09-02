/**
 * Aturan "detail task sesuai satuannya" (permintaan pemilik 2026-09-02). Tiga
 * hal yang diuji di sini adalah tiga cara paling mudah untuk merusak fitur ini
 * tanpa ada yang sadar: satuan yang tertinggal saat divisi diganti, satuan yang
 * tertinggal saat "Lainnya" dipilih, dan Rupiah Ads yang tak sampai ke kuota.
 */
import { describe, expect, it } from 'vitest';
import {
  isMoneyJenis,
  jenisDefaults,
  kuotaBudget,
  taskDefaultsFor,
} from './plan-task-draft';
import { JENIS_LAINNYA, jenisBySatuan } from './plantask';

describe('taskDefaultsFor — draft mengikuti pilihan divisi', () => {
  it('memberi deliverable pertama divisi itu beserta satuannya', () => {
    expect(taskDefaultsFor('Creative')).toEqual({ jenis_task: 'video_seller', satuan: 'video' });
    expect(taskDefaultsFor('Ads')).toEqual({ jenis_task: 'ads_spent', satuan: 'Rp' });
    expect(taskDefaultsFor('Store Operation')).toEqual({
      jenis_task: 'banding_pelanggaran',
      satuan: 'kasus',
    });
  });

  it('divisi tanpa katalog (Account/Ops) jatuh ke jalur teks bebas', () => {
    expect(taskDefaultsFor('Ops')).toEqual({ jenis_task: JENIS_LAINNYA, satuan: '' });
    expect(taskDefaultsFor('Account')).toEqual({ jenis_task: JENIS_LAINNYA, satuan: '' });
  });

  it('divisi tak dikenal tidak melempar — hanya jatuh ke teks bebas', () => {
    expect(taskDefaultsFor('Divisi Karangan')).toEqual({ jenis_task: JENIS_LAINNYA, satuan: '' });
  });

  it('SETIAP divisi operasional menghasilkan satuan yang bisa dipulihkan lagi', () => {
    // Menutup regresi paling halus: default yang satuannya tak bisa dibaca
    // balik oleh `jenisBySatuan` akan membuat kolom "Jenis task" di tabel P-C
    // kosong untuk baris yang baru dibuat.
    for (const divisi of ['Creative', 'Ads', 'KOL', 'Live Stream', 'AI Optimizer', 'Store Operation']) {
      const d = taskDefaultsFor(divisi);
      expect(jenisBySatuan(divisi, d.satuan)?.jenis, divisi).toBe(d.jenis_task);
    }
  });
});

describe('jenisDefaults — satuan mengikuti jenis, bukan sebaliknya', () => {
  it('memilih jenis katalog menimpa satuan yang sudah ada', () => {
    expect(jenisDefaults('KOL', 'live_stream_creator')).toEqual({
      jenis_task: 'live_stream_creator',
      satuan: 'sesi',
    });
    expect(jenisDefaults('Live Stream', 'jam_live').satuan).toBe('jam live');
  });

  it('"Lainnya" MENGOSONGKAN satuan — tak mewarisi satuan jenis sebelumnya', () => {
    // Kalau satuan lama tertinggal, `jenisBySatuan` akan memulihkan jenis yang
    // justru baru dibatalkan AM, dan tabel P-C menampilkan label yang salah.
    expect(jenisDefaults('Creative', JENIS_LAINNYA)).toEqual({
      jenis_task: JENIS_LAINNYA,
      satuan: '',
    });
  });

  it('jenis milik divisi LAIN diperlakukan sebagai tak dikenal (satuan kosong)', () => {
    // Ganti divisi Creative→KOL tanpa mereset jenis akan sampai ke sini; hasil
    // yang benar adalah satuan kosong, bukan satuan Creative di baris KOL.
    expect(jenisDefaults('KOL', 'video_seller')).toEqual({
      jenis_task: 'video_seller',
      satuan: '',
    });
  });
});

describe('isMoneyJenis', () => {
  it('hanya Ads spent yang Rupiah', () => {
    expect(isMoneyJenis('Ads', 'ads_spent')).toBe(true);
    expect(isMoneyJenis('Creative', 'video_seller')).toBe(false);
    expect(isMoneyJenis('Ops', JENIS_LAINNYA)).toBe(false);
  });
});

describe('kuotaBudget — PC-6 kuota + PC-7 budget', () => {
  it('jenis hitungan: kuota dari input, budget opsional dan terpisah', () => {
    expect(kuotaBudget('Creative', 'video_seller', '40', '')).toEqual({ kuota: 40, budget: null });
    expect(kuotaBudget('Creative', 'video_seller', '40', '2500000')).toEqual({
      kuota: 40,
      budget: 2500000,
    });
  });

  it('jenis money: SATU angka mengisi kuota DAN budget', () => {
    expect(kuotaBudget('Ads', 'ads_spent', '15000000', '')).toEqual({
      kuota: 15000000,
      budget: 15000000,
    });
  });

  it('jenis money: kuota TIDAK boleh 0 saat Rupiah diisi (baris kuota-nol tak bisa dibrief)', () => {
    // `brief-inherit.ts` melewati baris `kuota_nol`. Menaruh Rupiah hanya di
    // budget akan membuat setiap baris Ads gagal jadi Brief — sunyi.
    const { kuota } = kuotaBudget('Ads', 'ads_spent', '15000000', '');
    expect(kuota).toBeGreaterThan(0);
  });

  it('jenis money mengabaikan input budget manual — angkanya satu, bukan dua', () => {
    expect(kuotaBudget('Ads', 'ads_spent', '15000000', '999')).toEqual({
      kuota: 15000000,
      budget: 15000000,
    });
  });

  it('input kosong ⇒ kuota 0, budget null (bukan NaN)', () => {
    expect(kuotaBudget('Creative', 'video_seller', '', '')).toEqual({ kuota: 0, budget: null });
    expect(kuotaBudget('Ads', 'ads_spent', '', '')).toEqual({ kuota: 0, budget: 0 });
    expect(kuotaBudget('Creative', 'video_seller', '  ', '  ')).toEqual({ kuota: 0, budget: null });
  });
});
