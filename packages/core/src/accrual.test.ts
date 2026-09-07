/**
 * Tes mesin accrual Gelombang D.
 *
 * Cabangnya diturunkan dari DATA NYATA, bukan ditebak (aturan kerja #2):
 * layanan, durasi, dan qty_menambah di bawah adalah baris katalog live per
 * 2026-09-07 — `GMV MAX MEA PRO` (6 bulan, qty=durasi), `Nano KOL` (NULL,
 * volume), `Store Management (Paket)` (1 bulan, qty=durasi), `Komisi` (NULL,
 * bulan_berikutnya), `Jasa Pengajuan Shopee Mall` (NULL, saat_selesai).
 *
 * Dua di antaranya — `Komisi` dan `Jasa Pengajuan Shopee Mall` — sengaja diuji
 * BERDAMPINGAN, karena keduanya `durasi_bulan = NULL` dan justru itulah alasan
 * kolom `pengakuan` ada: satu nilai kosong yang membawa dua arti. Kalau mesin
 * ini pernah memakai `durasi_bulan` untuk memutuskan kapan mengakui, tes itulah
 * yang memerah.
 */

import { describe, expect, it } from 'vitest';
import * as accrual from './accrual';
import * as money from './money';

const rp = (s: string): money.Money => money.parse(s);

/** Σ seluruh baris yang diakui + yang hangus harus selalu sama dengan bruto. */
function utuh(hasil: accrual.AccrualSchedule, bruto: money.Money): void {
  expect(hasil.totalDiakui + hasil.totalHangus).toBe(bruto);
}

describe('totalBulan', () => {
  it("qty_menambah='durasi' mengalikan: GMV MAX MEA PRO 6 bulan, beli 2 = 12 bulan", () => {
    expect(accrual.totalBulan(6, 2, 'durasi')).toBe(12);
  });

  it("qty_menambah='volume' TIDAK mengalikan: Store Management 1 bulan beli 3 tetap durasinya sendiri", () => {
    expect(accrual.totalBulan(1, 3, 'volume')).toBe(1);
  });

  it('durasi_bulan NULL berarti tidak punya periode sama sekali — Nano KOL beli 10 bukan 10 bulan', () => {
    expect(accrual.totalBulan(null, 10, 'volume')).toBeNull();
    expect(accrual.totalBulan(null, 10, 'durasi')).toBeNull();
  });

  it('menolak qty dan durasi yang tidak berarti', () => {
    expect(() => accrual.totalBulan(6, 0, 'durasi')).toThrow(accrual.AccrualInputError);
    expect(() => accrual.totalBulan(6, 1.5, 'durasi')).toThrow(accrual.AccrualInputError);
    expect(() => accrual.totalBulan(0, 1, 'durasi')).toThrow(accrual.AccrualInputError);
  });
});

describe('bagiRata — Σ bagian harus PERSIS sama dengan total', () => {
  it('Rp 10.000.000 dibagi 6 tidak boleh menciptakan atau menghilangkan rupiah', () => {
    const total = rp('10000000.00');
    const bagian = accrual.bagiRata(total, 6);
    expect(bagian).toHaveLength(6);
    expect(bagian.reduce((a, b) => a + b, 0n)).toBe(total);
    // Inilah yang membedakannya dari 6x money.proRata: pembulatan per bagian
    // menghasilkan 6 x Rp 1.666.667 = Rp 10.000.002.
    expect(money.proRata(total, 1n, 6n) * 6n).not.toBe(total);
  });

  it('bertahan untuk pembagian yang tidak bulat di banyak panjang periode', () => {
    for (const n of [1, 2, 3, 5, 6, 7, 11, 12, 24]) {
      for (const t of ['1.00', '0.01', '999999.99', '33333333.33']) {
        const total = rp(t);
        expect(accrual.bagiRata(total, n).reduce((a, b) => a + b, 0n)).toBe(total);
      }
    }
  });

  it('Rp 0 menghasilkan bagian nol, bukan daftar kosong', () => {
    expect(accrual.bagiRata(0n, 3)).toEqual([0n, 0n, 0n]);
  });
});

describe('per_periode — batas periode kalender-aware', () => {
  const dasar = {
    nilaiBruto: rp('60000000.00'),
    pengakuan: accrual.PENGAKUAN_PER_PERIODE,
    durasiBulan: 6,
    qty: 1,
    qtyMenambah: 'durasi' as const,
  };

  it('GMV MAX MEA PRO 6 bulan mulai 15 Jan jatuh di enam bulan berturut-turut', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalMulai: '2026-01-15' });
    expect(h.perBulan.map((b) => b.bulan)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
    expect(h.perBulan.every((b) => b.jumlah === rp('10000000.00'))).toBe(true);
    expect(h.totalDiakui).toBe(dasar.nilaiBruto);
    expect(h.alasanKosong).toBeNull();
    utuh(h, dasar.nilaiBruto);
  });

  it('mulai 31 Januari: batas periode pertama 28 Februari, BUKAN 2 Maret', () => {
    // Ini pagar terhadap "+30 hari". Dengan +30 hari batasnya 2 Maret dan
    // seluruh skedul melenceng makin jauh tiap periode — dan D-3 menutup buku
    // PER BULAN, jadi melencengnya berakhir di bulan yang salah.
    const h = accrual.hitungSkedul({ ...dasar, durasiBulan: 3, tanggalMulai: '2026-01-31' });
    expect(h.baris[0].akhir).toBe('2026-02-28');
    expect(h.baris[1].mulai).toBe('2026-02-28');
    expect(h.baris[1].akhir).toBe('2026-03-31');
    expect(h.baris.map((b) => b.bulan)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('tahun kabisat: mulai 31 Januari 2028 meng-clamp ke 29 Februari', () => {
    const h = accrual.hitungSkedul({ ...dasar, durasiBulan: 2, tanggalMulai: '2028-01-31' });
    expect(h.baris[0].akhir).toBe('2028-02-29');
  });

  it("qty_menambah='durasi' beli 2 memanjangkan jadi 12 bulan", () => {
    const h = accrual.hitungSkedul({ ...dasar, qty: 2, tanggalMulai: '2026-01-01' });
    expect(h.baris).toHaveLength(12);
    expect(h.perBulan).toHaveLength(12);
    utuh(h, dasar.nilaiBruto);
  });

  it("qty_menambah='volume' beli 2 TIDAK memanjangkan — nilainya cuma disebar 6 bulan", () => {
    const h = accrual.hitungSkedul({ ...dasar, qty: 2, qtyMenambah: 'volume', tanggalMulai: '2026-01-01' });
    expect(h.baris).toHaveLength(6);
  });

  it('menolak per_periode tanpa durasi — tidak ada yang bisa disebar', () => {
    expect(() => accrual.hitungSkedul({ ...dasar, durasiBulan: null, tanggalMulai: '2026-01-01' }))
      .toThrow(accrual.AccrualInputError);
  });

  it('tanpa tanggal mulai: kosong DENGAN sebabnya, bukan diam', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalMulai: null });
    expect(h.baris).toEqual([]);
    expect(h.alasanKosong).toBe('[layanan belum punya tanggal mulai, pengakuan pendapatan belum bisa dijadwalkan]');
  });

  it('nilai Rp 0 menghasilkan skedul berisi nol, BUKAN skedul kosong', () => {
    const h = accrual.hitungSkedul({ ...dasar, nilaiBruto: 0n, tanggalMulai: '2026-01-01' });
    expect(h.baris).toHaveLength(6);
    expect(h.totalDiakui).toBe(0n);
    expect(h.alasanKosong).toBeNull();
  });
});

describe('D-1 HANGUS — void di tengah periode', () => {
  const dasar = {
    nilaiBruto: rp('60000000.00'),
    pengakuan: accrual.PENGAKUAN_PER_PERIODE,
    durasiBulan: 6,
    qty: 1,
    qtyMenambah: 'durasi' as const,
    tanggalMulai: '2026-01-01',
  };

  it('void di tengah irisan ke-3: dua irisan pertama utuh, irisan ke-3 pro-rate hari, sisanya nol', () => {
    // Irisan ke-3 = 1 Mar - 1 Apr (31 hari). Void 16 Mar ⇒ 15 hari jalan.
    const h = accrual.hitungSkedul({ ...dasar, tanggalVoid: '2026-03-16' });
    expect(h.baris[0].jumlah).toBe(rp('10000000.00'));
    expect(h.baris[1].jumlah).toBe(rp('10000000.00'));
    expect(h.baris[2].jumlah).toBe((rp('10000000.00') * 15n) / 31n);
    expect(h.baris[3].jumlah).toBe(0n);
    expect(h.baris[4].jumlah).toBe(0n);
    expect(h.baris[5].jumlah).toBe(0n);
    utuh(h, dasar.nilaiBruto);
  });

  it('void TIDAK menjangkau ke belakang — syarat D-3, bulan tertutup tidak bisa diedit', () => {
    // Bulan Januari & Februari sudah bisa ditutup dengan Rp 10 juta masing-masing
    // sebelum void terjadi; sesudah void angkanya harus tetap persis sama.
    const sebelum = accrual.hitungSkedul(dasar);
    const sesudah = accrual.hitungSkedul({ ...dasar, tanggalVoid: '2026-05-10' });
    for (const bulan of ['2026-01', '2026-02', '2026-03', '2026-04']) {
      expect(sesudah.perBulan.find((b) => b.bulan === bulan)?.jumlah)
        .toBe(sebelum.perBulan.find((b) => b.bulan === bulan)?.jumlah);
    }
  });

  it('yang hangus dilaporkan, tidak lenyap: diakui + hangus = bruto', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalVoid: '2026-03-16' });
    expect(h.totalHangus).toBeGreaterThan(0n);
    utuh(h, dasar.nilaiBruto);
  });

  it('pro-rate dibulatkan KE BAWAH — tidak pernah mengakui hari yang tidak dijalani', () => {
    // 1 hari dari 31 atas Rp 1.000.000 tidak jatuh di kelipatan sen mana pun.
    // Dibandingkan langsung dengan pecahan eksaknya lewat perkalian silang,
    // supaya yang diuji adalah ARAH pembulatannya, bukan sebuah angka yang
    // kebetulan cocok: yang diakui tidak boleh melebihi jatah hari yang
    // benar-benar dijalani, dan satu sen lebih sudah melebihinya.
    const jatah = rp('1000000.00');
    const h = accrual.hitungSkedul({ ...dasar, nilaiBruto: jatah, durasiBulan: 1, tanggalVoid: '2026-01-02' });
    const diakui = h.baris[0].jumlah;
    expect(diakui * 31n).toBeLessThanOrEqual(jatah * 1n);
    expect((diakui + 1n) * 31n).toBeGreaterThan(jatah * 1n);
    utuh(h, jatah);
  });

  it('void di hari mulai: nol diakui, SELURUHNYA hangus, dan sebabnya dikatakan', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalVoid: '2026-01-01' });
    expect(h.totalDiakui).toBe(0n);
    expect(h.totalHangus).toBe(dasar.nilaiBruto);
    expect(h.alasanKosong).toBe('[layanan di-void sebelum berjalan, tidak ada pendapatan yang diakui]');
  });

  it('void sesudah periode habis tidak menghanguskan apa pun', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalVoid: '2027-01-01' });
    expect(h.totalDiakui).toBe(dasar.nilaiBruto);
    expect(h.totalHangus).toBe(0n);
  });
});

describe('D-2 hold MENJEDA — skedul bergeser, tidak dipadatkan', () => {
  const dasar = {
    nilaiBruto: rp('30000000.00'),
    pengakuan: accrual.PENGAKUAN_PER_PERIODE,
    durasiBulan: 3,
    qty: 1,
    qtyMenambah: 'durasi' as const,
    tanggalMulai: '2026-01-01',
  };

  it('hold 10 hari mendorong SELURUH batas sesudahnya maju 10 hari', () => {
    const h = accrual.hitungSkedul({ ...dasar, holds: [{ mulai: '2026-01-10', selesai: '2026-01-20' }] });
    expect(h.baris[0].akhir).toBe('2026-02-11'); // 1 Feb + 10 hari
    expect(h.baris[1].akhir).toBe('2026-03-11');
    expect(h.baris[2].akhir).toBe('2026-04-11');
  });

  it('hold TIDAK mengubah berapa yang diakui — hanya kapan', () => {
    const tanpa = accrual.hitungSkedul(dasar);
    const dengan = accrual.hitungSkedul({ ...dasar, holds: [{ mulai: '2026-01-10', selesai: '2026-02-20' }] });
    expect(dengan.totalDiakui).toBe(tanpa.totalDiakui);
    expect(dengan.totalDiakui).toBe(dasar.nilaiBruto);
  });

  it('hold yang BELUM selesai belum menggeser apa pun — pola ads.computeTotalHariHold', () => {
    const h = accrual.hitungSkedul({ ...dasar, holds: [{ mulai: '2026-01-10', selesai: null }] });
    expect(h.baris[0].akhir).toBe('2026-02-01');
  });

  it('hold BERTINDIHAN tidak dihitung dua kali', () => {
    const tindih = accrual.hitungSkedul({
      ...dasar,
      holds: [{ mulai: '2026-01-05', selesai: '2026-01-15' }, { mulai: '2026-01-10', selesai: '2026-01-20' }],
    });
    // Gabungannya 5-20 Jan = 15 hari. Menjumlahkan mentah memberi 10+10 = 20.
    expect(tindih.baris[0].akhir).toBe('2026-02-16');
  });

  it('hold BERSARANG tidak menambah apa pun di atas hold pembungkusnya', () => {
    const h = accrual.hitungSkedul({
      ...dasar,
      holds: [{ mulai: '2026-01-05', selesai: '2026-01-25' }, { mulai: '2026-01-10', selesai: '2026-01-15' }],
    });
    expect(h.baris[0].akhir).toBe('2026-02-21'); // 1 Feb + 20 hari
  });

  it('hold BERULANG menumpuk pergeserannya', () => {
    const h = accrual.hitungSkedul({
      ...dasar,
      holds: [{ mulai: '2026-01-05', selesai: '2026-01-10' }, { mulai: '2026-02-20', selesai: '2026-02-25' }],
    });
    expect(h.baris[0].akhir).toBe('2026-02-06'); // 1 Feb + 5
    expect(h.baris[1].akhir).toBe('2026-03-11'); // 1 Mar + 5 + 5
  });

  it('hold yang jatuh SESUDAH sebuah batas tidak menggeser batas itu ke belakang', () => {
    const h = accrual.hitungSkedul({ ...dasar, holds: [{ mulai: '2026-03-05', selesai: '2026-03-10' }] });
    expect(h.baris[0].akhir).toBe('2026-02-01');
    expect(h.baris[1].akhir).toBe('2026-03-01');
    expect(h.baris[2].akhir).toBe('2026-04-06');
  });

  it('DUA irisan bisa jatuh di bulan kalender yang sama — dijumlahkan, bukan ditimpa', () => {
    // Mulai 1 Jan, hold 30 hari (2 Jan - 1 Feb) menghabiskan hampir seluruh
    // periode pertama. Batas bergeser ke 3 Maret dan 31 Maret — jarak antar
    // batas paling pendek yang mungkin (Feb, 28 hari) bertemu bulan terpanjang,
    // sehingga irisan ke-2 DAN ke-3 sama-sama MULAI di Maret. Kalau baris kedua
    // menimpa yang pertama alih-alih menambahinya, satu bulan penuh pendapatan
    // lenyap tanpa jejak — dan D-3 membekukan `perBulan` apa adanya.
    const h = accrual.hitungSkedul({
      nilaiBruto: rp('30000000.00'),
      pengakuan: accrual.PENGAKUAN_PER_PERIODE,
      durasiBulan: 3, qty: 1, qtyMenambah: 'durasi',
      tanggalMulai: '2026-01-01',
      holds: [{ mulai: '2026-01-02', selesai: '2026-02-01' }],
    });
    expect(h.baris.map((b) => b.mulai)).toEqual(['2026-01-01', '2026-03-03', '2026-03-31']);
    const maret = h.baris.filter((b) => b.bulan === '2026-03');
    expect(maret.length).toBeGreaterThan(1);
    expect(h.perBulan.find((b) => b.bulan === '2026-03')?.jumlah)
      .toBe(maret.reduce((a, b) => a + b.jumlah, 0n));
    expect(h.totalDiakui).toBe(rp('30000000.00'));
  });

  it('hari hold BUKAN "hari yang sudah jalan" saat void memotong irisan', () => {
    // Irisan 1 = 1 Jan, hold 5-15 Jan (10 hari), void 21 Jan.
    // Hari kalender berlalu 20; yang benar-benar jalan 20 - 10 = 10.
    const h = accrual.hitungSkedul({
      ...dasar,
      holds: [{ mulai: '2026-01-05', selesai: '2026-01-15' }],
      tanggalVoid: '2026-01-21',
    });
    const jatah = rp('10000000.00');
    expect(h.baris[0].jumlah).toBe((jatah * 10n) / 31n);
    utuh(h, dasar.nilaiBruto);
  });
});

describe('saat_selesai — Jasa Pengajuan Shopee Mall / Nano KOL', () => {
  const dasar = {
    nilaiBruto: rp('5000000.00'),
    pengakuan: accrual.PENGAKUAN_SAAT_SELESAI,
    durasiBulan: null,
    qty: 1,
    qtyMenambah: 'volume' as const,
  };

  it('diakui PENUH di bulan selesainya, bukan disebar', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalSelesai: '2026-04-18' });
    expect(h.perBulan).toEqual([{ bulan: '2026-04', jumlah: rp('5000000.00') }]);
    expect(h.totalHangus).toBe(0n);
  });

  it('Nano KOL beli 10 tetap satu pengakuan — qty adalah jumlah KOL, bukan bulan', () => {
    const h = accrual.hitungSkedul({ ...dasar, qty: 10, tanggalSelesai: '2026-04-18' });
    expect(h.baris).toHaveLength(1);
    expect(h.perBulan).toHaveLength(1);
  });

  it('belum selesai: kosong DENGAN sebabnya', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalSelesai: null });
    expect(h.baris).toEqual([]);
    expect(h.alasanKosong).toBe('[layanan belum selesai, pendapatannya diakui saat selesai]');
    expect(h.totalHangus).toBe(0n);
  });

  it('di-void sebelum selesai: nol diakui, seluruhnya hangus', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalSelesai: null, tanggalVoid: '2026-03-01' });
    expect(h.totalDiakui).toBe(0n);
    expect(h.totalHangus).toBe(dasar.nilaiBruto);
    expect(h.alasanKosong).toBe('[layanan di-void sebelum selesai, tidak ada pendapatan yang diakui]');
  });

  it('di-void SESUDAH selesai tidak membatalkan yang sudah diakui', () => {
    const h = accrual.hitungSkedul({ ...dasar, tanggalSelesai: '2026-04-18', tanggalVoid: '2026-05-01' });
    expect(h.totalDiakui).toBe(dasar.nilaiBruto);
    expect(h.totalHangus).toBe(0n);
  });
});

describe('bulan_berikutnya — Komisi', () => {
  const dasar = {
    nilaiBruto: rp('2500000.00'),
    pengakuan: accrual.PENGAKUAN_BULAN_BERIKUTNYA,
    durasiBulan: null,
    qty: 1,
    qtyMenambah: 'volume' as const,
  };

  it('penjualan Januari diakui Februari — bukan Januari', () => {
    const h = accrual.hitungSkedul({ ...dasar, bulanPenjualan: '2026-01' });
    expect(h.perBulan).toEqual([{ bulan: '2026-02', jumlah: rp('2500000.00') }]);
  });

  it('Desember menyeberang tahun ke Januari berikutnya', () => {
    const h = accrual.hitungSkedul({ ...dasar, bulanPenjualan: '2026-12' });
    expect(h.perBulan[0].bulan).toBe('2027-01');
  });

  it('Januari dan Februari TIDAK mendarat di bulan yang sama — pagar clamp akhir bulan', () => {
    const jan = accrual.hitungSkedul({ ...dasar, bulanPenjualan: '2026-01' });
    const feb = accrual.hitungSkedul({ ...dasar, bulanPenjualan: '2026-02' });
    expect(jan.perBulan[0].bulan).toBe('2026-02');
    expect(feb.perBulan[0].bulan).toBe('2026-03');
  });

  it('belum ada bulan penjualan: kosong DENGAN sebabnya', () => {
    const h = accrual.hitungSkedul({ ...dasar, bulanPenjualan: null });
    expect(h.alasanKosong).toBe('[bulan penjualan belum diisi, komisi belum bisa dijadwalkan]');
  });

  it('di-void sebelum bulan pengakuannya: seluruhnya hangus', () => {
    const h = accrual.hitungSkedul({ ...dasar, bulanPenjualan: '2026-01', tanggalVoid: '2026-01-20' });
    expect(h.totalDiakui).toBe(0n);
    expect(h.totalHangus).toBe(dasar.nilaiBruto);
  });

  it('di-void sesudah bulan pengakuannya tiba: tetap diakui', () => {
    const h = accrual.hitungSkedul({ ...dasar, bulanPenjualan: '2026-01', tanggalVoid: '2026-02-10' });
    expect(h.totalDiakui).toBe(dasar.nilaiBruto);
  });

  it('menolak bulan penjualan yang bukan YYYY-MM', () => {
    expect(() => accrual.hitungSkedul({ ...dasar, bulanPenjualan: '2026-13' })).toThrow(accrual.AccrualInputError);
    expect(() => accrual.hitungSkedul({ ...dasar, bulanPenjualan: '2026-01-15' })).toThrow(accrual.AccrualInputError);
  });
});

describe('D-KOM — pengakuan TIDAK boleh diturunkan dari durasi_bulan', () => {
  it('Komisi dan Jasa Pengajuan Shopee Mall punya durasi_bulan yang sama, hasil yang berbeda', () => {
    // Inilah alasan kolom `pengakuan` ada. Dua baris katalog live yang
    // `durasi_bulan`-nya sama-sama NULL, dan artinya berbeda. Kalau mesin ini
    // pernah kembali menebak dari `durasi_bulan`, tes ini yang memerah.
    const bersama = { nilaiBruto: rp('1000000.00'), durasiBulan: null, qty: 1, qtyMenambah: 'volume' as const };
    const shopeeMall = accrual.hitungSkedul({
      ...bersama, pengakuan: accrual.PENGAKUAN_SAAT_SELESAI,
      tanggalSelesai: '2026-01-20', bulanPenjualan: '2026-01',
    });
    const komisi = accrual.hitungSkedul({
      ...bersama, pengakuan: accrual.PENGAKUAN_BULAN_BERIKUTNYA,
      tanggalSelesai: '2026-01-20', bulanPenjualan: '2026-01',
    });
    expect(shopeeMall.perBulan[0].bulan).toBe('2026-01');
    expect(komisi.perBulan[0].bulan).toBe('2026-02');
  });

  it('menolak penanda pengakuan yang tidak dikenal, tidak diam-diam memilih satu', () => {
    expect(() => accrual.hitungSkedul({
      nilaiBruto: rp('1.00'), pengakuan: 'entah' as accrual.Pengakuan,
      durasiBulan: null, qty: 1, qtyMenambah: 'volume',
    })).toThrow(accrual.AccrualInputError);
  });
});

describe('D-4 — mesin TIDAK menyentuh PPN', () => {
  it('yang keluar adalah bruto yang masuk, tidak ditambah dan tidak dikurangi 11%', () => {
    const bruto = rp('10000000.00');
    const h = accrual.hitungSkedul({
      nilaiBruto: bruto, pengakuan: accrual.PENGAKUAN_PER_PERIODE,
      durasiBulan: 1, qty: 1, qtyMenambah: 'durasi', tanggalMulai: '2026-01-01',
    });
    expect(h.totalDiakui).toBe(bruto);
  });

  it('menolak nilai negatif', () => {
    expect(() => accrual.hitungSkedul({
      nilaiBruto: -1n, pengakuan: accrual.PENGAKUAN_SAAT_SELESAI,
      durasiBulan: null, qty: 1, qtyMenambah: 'volume', tanggalSelesai: '2026-01-01',
    })).toThrow(accrual.AccrualInputError);
  });
});

describe('bisa dihitung ulang — syarat D-3 dan aturan rumah #4', () => {
  it('input yang sama memberi hasil yang sama, tanpa bergantung pada jam', () => {
    const inp: accrual.AccrualInput = {
      nilaiBruto: rp('77777777.77'),
      pengakuan: accrual.PENGAKUAN_PER_PERIODE,
      durasiBulan: 6, qty: 2, qtyMenambah: 'durasi',
      tanggalMulai: '2026-01-31',
      holds: [{ mulai: '2026-03-01', selesai: '2026-03-20' }, { mulai: '2026-07-04', selesai: '2026-07-09' }],
      tanggalVoid: '2026-11-13',
    };
    const a = accrual.hitungSkedul(inp);
    const b = accrual.hitungSkedul(inp);
    expect(b).toEqual(a);
    utuh(a, inp.nilaiBruto);
  });
});
