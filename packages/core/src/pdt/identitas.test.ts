import { describe, expect, it } from 'vitest';
import {
  bangunIdentitasSumberShopee,
  ekstrakPeriodeKolomTiktok,
  ekstrakPreambleShopee,
  kolomTerbanyak,
  parseRentangTanggal,
  parseTanggalId,
  resolvePeriodeBatch,
  validasiIdentitasShopee,
  validasiIdentitasTiktok,
} from './identitas';

describe('parseTanggalId', () => {
  it('mem-parse DD/MM/YYYY', () => {
    expect(parseTanggalId('01/07/2026')).toBe('2026-07-01');
    expect(parseTanggalId('31/12/2026')).toBe('2026-12-31');
  });

  it('menolak kalender tidak valid', () => {
    expect(parseTanggalId('31/02/2026')).toBeNull();
    expect(parseTanggalId('00/01/2026')).toBeNull();
    expect(parseTanggalId('13/13/2026')).toBeNull();
  });

  it('menolak bentuk yang bukan tanggal', () => {
    expect(parseTanggalId('bukan tanggal')).toBeNull();
    expect(parseTanggalId('')).toBeNull();
  });
});

describe('parseRentangTanggal', () => {
  it('mem-parse rentang "DD/MM/YYYY - DD/MM/YYYY"', () => {
    expect(parseRentangTanggal('01/07/2026 - 31/07/2026')).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('null bila salah satu sisi rusak', () => {
    expect(parseRentangTanggal('01/07/2026 - bukan tanggal')).toBeNull();
    expect(parseRentangTanggal('01/07/2026')).toBeNull();
  });
});

describe('ekstrakPreambleShopee — bentuk satu-sel "Label: value" (fixture G1-02/G1-05)', () => {
  const aoa = [
    ['ID Toko: 938284780'],
    ['Periode: 01/07/2026 - 31/07/2026'],
    [],
    [],
    [],
    [],
    [],
    ['Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya'],
    ['SKU-A', '50000', '2000', '80', '5000000'],
  ];

  it('membaca ID Toko dan Periode dari preamble', () => {
    expect(ekstrakPreambleShopee(aoa, 8)).toEqual({
      idToko: '938284780',
      username: null,
      namaToko: null,
      periode: { mulai: '2026-07-01', selesai: '2026-07-31' },
    });
  });
});

describe('ekstrakPreambleShopee — bentuk satu-sel DIPADATKAN ke lebar sheet penuh (G1-09: bentuk NYATA XLSX.utils.sheet_to_json({defval:\'\'}), bukan literal panjang 1)', () => {
  // Ditemukan menulis route commit G1-09 sungguhan: sheet_to_json memadatkan SETIAP baris ke
  // lebar sheet (kolom terlebar — baris header), jadi baris preamble "satu sel" TIDAK PERNAH
  // benar-benar panjang 1 pada berkas XLSX asli. row.length === 1 (perilaku LAMA) gagal total di
  // sini; deteksi sekarang dari sel KEDUA kosong (isBlank(row[1])).
  const aoa = [
    ['ID Toko: 938284780', '', '', '', ''],
    ['Username: tokoku', '', '', '', ''],
    ['Nama Toko: Toko Saya', '', '', '', ''],
    ['Periode: 01/07/2026 - 31/07/2026', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya'],
    ['SKU-A', '50000', '2000', '80', '5000000'],
  ];

  it('membaca keempat field preamble walau tiap baris dipadatkan ke 5 kolom', () => {
    expect(ekstrakPreambleShopee(aoa, 8)).toEqual({
      idToko: '938284780',
      username: 'tokoku',
      namaToko: 'Toko Saya',
      periode: { mulai: '2026-07-01', selesai: '2026-07-31' },
    });
  });
});

describe('ekstrakPreambleShopee — bentuk dua-sel ["Label", "value"] (pola report/shopee lama)', () => {
  const aoa = [
    ['ID Toko', 'SHOP-1'],
    ['Username', 'ezzystore'],
    ['Nama Toko', 'Ezzy Store'],
    ['Periode', '01/08/2026 - 31/08/2026'],
    [],
    [],
    [],
    ['Kode Produk', 'Dilihat'],
    ['SKU-A', '100'],
  ];

  it('membaca keempat field preamble', () => {
    expect(ekstrakPreambleShopee(aoa, 8)).toEqual({
      idToko: 'SHOP-1',
      username: 'ezzystore',
      namaToko: 'Ezzy Store',
      periode: { mulai: '2026-08-01', selesai: '2026-08-31' },
    });
  });

  it('tetap terbaca walau dipadatkan ke lebar sheet penuh (sel kedua TERISI, bukan blank — beda dari bentuk satu-sel)', () => {
    const dipadatkan = aoa.map((row) => [...row, '', '', '']);
    expect(ekstrakPreambleShopee(dipadatkan, 8)).toEqual({
      idToko: 'SHOP-1',
      username: 'ezzystore',
      namaToko: 'Ezzy Store',
      periode: { mulai: '2026-08-01', selesai: '2026-08-31' },
    });
  });
});

describe('ekstrakPreambleShopee — preamble kosong/tidak lengkap', () => {
  it('idToko/periode null bila baris preamble tidak ada', () => {
    const aoa = [[], [], [], [], [], [], [], ['Kode Produk', 'Dilihat'], ['SKU-A', '1']];
    expect(ekstrakPreambleShopee(aoa, 8)).toEqual({ idToko: null, username: null, namaToko: null, periode: null });
  });
});

describe('kolomTerbanyak (Rule 4 — ID Kreator terbanyak TikTok)', () => {
  // tt_video: barisHeaderHint 3 (Rule 7 — dua baris apa pun sebelum header, header di baris 3).
  const aoa = [
    ['(baris penanda 1)'],
    ['(baris penanda 2)'],
    ['ID Kreator', 'ID Video', 'Nama Kreator'],
    ['CR-001', 'VID-1', 'Andi'],
    ['CR-001', 'VID-2', 'Andi'],
    ['CR-002', 'VID-3', 'Budi'],
  ];

  it('mengembalikan nilai terbanyak + jumlah', () => {
    expect(kolomTerbanyak(aoa, 3, 'ID Kreator')).toEqual({ nilai: 'CR-001', jumlah: 2, totalBaris: 3 });
  });

  it('null bila kolom tidak ditemukan', () => {
    expect(kolomTerbanyak(aoa, 3, 'Kolom Tidak Ada')).toBeNull();
  });

  it('null bila tidak ada baris data terisi', () => {
    expect(kolomTerbanyak([['ID Kreator']], 1, 'ID Kreator')).toBeNull();
  });
});

describe('ekstrakPeriodeKolomTiktok — kandidat kolom UNVERIFIED (docs/DECISIONS.md G1-06-PERIODE-TIKTOK)', () => {
  it('membaca rentang bila salah satu kandidat kolom ada', () => {
    const aoa = [
      ['ID Kreator', 'Date Range'],
      ['CR-001', '01/07/2026 - 31/07/2026'],
    ];
    expect(ekstrakPeriodeKolomTiktok(aoa, 1)).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('null bila tidak satu pun kandidat cocok — berkas mewarisi periode batch (Rule 5)', () => {
    const aoa = [
      ['ID Kreator', 'ID Video'],
      ['CR-001', 'VID-1'],
    ];
    expect(ekstrakPeriodeKolomTiktok(aoa, 1)).toBeNull();
  });
});

describe('validasiIdentitasShopee (Rule 2)', () => {
  const preamble = { idToko: 'SHOP-1', username: 'ezzystore', namaToko: 'Ezzy Store', periode: null };

  it('cocok bila ID Toko == shop_id tersimpan', () => {
    expect(validasiIdentitasShopee(preamble, 'SHOP-1')).toEqual({ status: 'cocok' });
  });

  it('usulkan_ikat bila shop_id masih kosong (F-4, Q-1 opsi A)', () => {
    expect(validasiIdentitasShopee(preamble, null)).toEqual({ status: 'usulkan_ikat', usulan: 'SHOP-1' });
  });

  it('tolak + menyebut KEDUA nilai bila tidak cocok', () => {
    const verdict = validasiIdentitasShopee(preamble, 'SHOP-9');
    expect(verdict.status).toBe('tolak');
    expect((verdict as { pesan: string }).pesan).toContain('SHOP-1');
    expect((verdict as { pesan: string }).pesan).toContain('SHOP-9');
  });

  it('tolak bila ID Toko tidak ditemukan di preamble', () => {
    const verdict = validasiIdentitasShopee({ idToko: null, username: null, namaToko: null, periode: null }, 'SHOP-1');
    expect(verdict.status).toBe('tolak');
  });
});

describe('validasiIdentitasTiktok (Rule 3-4)', () => {
  it('cocok bila ID Kreator ada di akun_konten_toko', () => {
    expect(validasiIdentitasTiktok('CR-001', ['CR-001', 'CR-002'])).toEqual({ status: 'cocok' });
  });

  it('usulkan_ikat bila akun_konten_toko masih kosong', () => {
    expect(validasiIdentitasTiktok('CR-001', null)).toEqual({ status: 'usulkan_ikat', usulan: 'CR-001' });
    expect(validasiIdentitasTiktok('CR-001', [])).toEqual({ status: 'usulkan_ikat', usulan: 'CR-001' });
  });

  it('tolak + menyebut KEDUA nilai bila tidak terdaftar', () => {
    const verdict = validasiIdentitasTiktok('CR-999', ['CR-001', 'CR-002']);
    expect(verdict.status).toBe('tolak');
    expect((verdict as { pesan: string }).pesan).toContain('CR-999');
    expect((verdict as { pesan: string }).pesan).toContain('CR-001');
  });
});

describe('resolvePeriodeBatch (Rule 5 + toleransi bulan-sama sesi 2)', () => {
  it('rentang berbeda DI DALAM bulan yang sama diterima, hasil = rentang terluas', () => {
    const hasil = resolvePeriodeBatch([
      { nama: 'a.xlsx', periode: { mulai: '2026-07-01', selesai: '2026-07-31' } },
      { nama: 'b.xlsx', periode: { mulai: '2026-07-01', selesai: '2026-07-28' } },
    ]);
    expect(hasil).toEqual({ status: 'ok', mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('berkas tanpa periode tidak menjatuhkan batch — diabaikan, bukan ditolak (mewarisi)', () => {
    const hasil = resolvePeriodeBatch([
      { nama: 'a.xlsx', periode: { mulai: '2026-07-01', selesai: '2026-07-31' } },
      { nama: 'tanpa-tanggal.xlsx', periode: null },
    ]);
    expect(hasil).toEqual({ status: 'ok', mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('bulan kalender berbeda ⇒ ditolak, pesan menyebut nama berkas + bulannya', () => {
    const hasil = resolvePeriodeBatch([
      { nama: 'juli.xlsx', periode: { mulai: '2026-07-01', selesai: '2026-07-31' } },
      { nama: 'agustus.xlsx', periode: { mulai: '2026-08-01', selesai: '2026-08-31' } },
    ]);
    expect(hasil.status).toBe('tolak');
    const pesan = (hasil as { pesan: string }).pesan;
    expect(pesan).toContain('juli.xlsx');
    expect(pesan).toContain('agustus.xlsx');
  });

  it('ditolak bila TIDAK ADA satu pun berkas membawa periode', () => {
    expect(resolvePeriodeBatch([{ nama: 'a.xlsx', periode: null }])).toEqual({
      status: 'tolak',
      pesan: '[tidak ada berkas dalam batch yang membawa periode terbaca]',
    });
  });
});

describe('bangunIdentitasSumberShopee', () => {
  it('membentuk shape pdt_upload_batch.identitas_sumber persis komentar migrasi G1-01', () => {
    expect(bangunIdentitasSumberShopee({ idToko: 'SHOP-1', username: 'ezzystore', namaToko: 'Ezzy Store', periode: null })).toEqual({
      shop_id: 'SHOP-1',
      username: 'ezzystore',
      nama_toko: 'Ezzy Store',
    });
  });
});
