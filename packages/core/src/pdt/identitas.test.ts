import { describe, expect, it } from 'vitest';
import {
  bangunIdentitasSumberShopee,
  ekstrakPeriodeKolomTiktok,
  ekstrakPeriodePreambleTiktok,
  ekstrakPreambleShopee,
  kolomTerbanyak,
  parseRentangTanggal,
  parseRentangTanggalTiktok,
  parseTanggalId,
  parseTanggalIdStrip,
  parseTanggalIdWaktu,
  parseTanggalIso,
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

describe('parseTanggalIdWaktu (B1-BATAL-TIKTOK — kolom Created Time tt_orders)', () => {
  it('mem-parse bentuk PERSIS ekspor asli: "DD/MM/YYYY HH:MM:SS" + tab di belakang', () => {
    expect(parseTanggalIdWaktu('31/07/2026 20:29:25\t')).toBe('2026-07-31');
    expect(parseTanggalIdWaktu('01/07/2026 00:00:01')).toBe('2026-07-01');
  });

  it('menerima tanggal polos tanpa jam — berperilaku persis parseTanggalId', () => {
    expect(parseTanggalIdWaktu('01/07/2026')).toBe('2026-07-01');
  });

  it('validasi kalender TIDAK dilonggarkan oleh adanya jam', () => {
    expect(parseTanggalIdWaktu('31/02/2026 08:00:00')).toBeNull();
    expect(parseTanggalIdWaktu('13/13/2026 08:00:00')).toBeNull();
  });

  it('menolak sel kosong dan penanda "-" (G1-03: absen bukan tanggal)', () => {
    expect(parseTanggalIdWaktu('')).toBeNull();
    expect(parseTanggalIdWaktu('   ')).toBeNull();
    expect(parseTanggalIdWaktu('-')).toBeNull();
  });

  it('TIDAK menggeser hari — jam malam tetap di tanggal yang sama (nol konversi zona waktu)', () => {
    expect(parseTanggalIdWaktu('31/07/2026 23:59:59')).toBe('2026-07-31');
  });
});

describe('parseTanggalIdStrip (sesi 34 lanjutan — kolom Tanggal harian shopee_shop_stats, DASH bukan slash)', () => {
  it('mem-parse DD-MM-YYYY', () => {
    expect(parseTanggalIdStrip('01-07-2026')).toBe('2026-07-01');
    expect(parseTanggalIdStrip('31-12-2026')).toBe('2026-12-31');
  });

  it('menolak kalender tidak valid', () => {
    expect(parseTanggalIdStrip('31-02-2026')).toBeNull();
    expect(parseTanggalIdStrip('00-01-2026')).toBeNull();
    expect(parseTanggalIdStrip('13-13-2026')).toBeNull();
  });

  it('menolak bentuk SLASH (bukan format ini — beda modul, beda kolom)', () => {
    expect(parseTanggalIdStrip('01/07/2026')).toBeNull();
  });

  it('menolak bentuk yang bukan tanggal', () => {
    expect(parseTanggalIdStrip('bukan tanggal')).toBeNull();
    expect(parseTanggalIdStrip('')).toBeNull();
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

describe('parseTanggalIso', () => {
  it('mem-parse YYYY-MM-DD', () => {
    expect(parseTanggalIso('2026-07-01')).toBe('2026-07-01');
    expect(parseTanggalIso('2026-12-31')).toBe('2026-12-31');
  });

  it('menolak kalender tidak valid / bentuk salah', () => {
    expect(parseTanggalIso('2026-02-31')).toBeNull();
    expect(parseTanggalIso('2026-13-01')).toBeNull();
    expect(parseTanggalIso('01/07/2026')).toBeNull();
  });
});

describe('parseRentangTanggalTiktok — dua bentuk TERVERIFIKASI sample asli (docs/DECISIONS.md G1-06-PERIODE-TIKTOK)', () => {
  it('DD/MM/YYYY–DD/MM/YYYY dengan EN DASH (Shop Analytics/product_list_20260701, "Tanggal analisis")', () => {
    expect(parseRentangTanggalTiktok('01/07/2026–31/07/2026')).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('DD/MM/YYYY-DD/MM/YYYY dengan hyphen ASCII tetap diterima', () => {
    expect(parseRentangTanggalTiktok('01/07/2026-31/07/2026')).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('YYYY-MM-DD ~ YYYY-MM-DD dengan tilde (Live Analysis/Video Performance List, "Date Range"/"[Rentang Tanggal]")', () => {
    expect(parseRentangTanggalTiktok('2026-07-01 ~ 2026-07-31')).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('YYYY-MM-DD-YYYY-MM-DD dengan hyphen, TANPA tilde (kolom `Date` tt_affiliate_video, M9-OA-4)', () => {
    expect(parseRentangTanggalTiktok('2026-08-01-2026-08-31')).toEqual({ mulai: '2026-08-01', selesai: '2026-08-31' });
  });

  it('null bila salah satu sisi rusak atau bentuk tidak dikenal', () => {
    expect(parseRentangTanggalTiktok('01/07/2026–bukan tanggal')).toBeNull();
    expect(parseRentangTanggalTiktok('2026-07-01')).toBeNull();
    expect(parseRentangTanggalTiktok('bukan rentang sama sekali')).toBeNull();
    expect(parseRentangTanggalTiktok('Summary')).toBeNull();
    expect(parseRentangTanggalTiktok('2026-08-01-2026-08')).toBeNull();
  });
});

describe('ekstrakPeriodeKolomTiktok — cadangan ber-nama untuk berkas TANPA preamble (M9-OA-4)', () => {
  const HEADER = ['Date', 'Video ID'];

  it('membaca rentang dari kolom data ketika preamble memang tidak ada', () => {
    const aoa = [HEADER, ['2026-08-01-2026-08-31', 'VID-1'], ['2026-08-01-2026-08-31', 'VID-2']];
    expect(ekstrakPeriodeKolomTiktok(aoa, 1, 'Date')).toEqual({ mulai: '2026-08-01', selesai: '2026-08-31' });
  });

  it('baris "Summary" tidak bisa menang — sel yang bukan rentang tidak ikut dihitung sama sekali', () => {
    const aoa = [HEADER, ['Summary', '-'], ['2026-08-01-2026-08-31', 'VID-1'], ['2026-08-01-2026-08-31', 'VID-2']];
    expect(ekstrakPeriodeKolomTiktok(aoa, 1, 'Date')).toEqual({ mulai: '2026-08-01', selesai: '2026-08-31' });
  });

  it('SATU baris data saja tetap menang atas "Summary" (seri 1-1 — beda dari kolomTerbanyak Rule 3)', () => {
    const aoa = [HEADER, ['Summary', '-'], ['2026-08-01-2026-08-31', 'VID-1']];
    expect(ekstrakPeriodeKolomTiktok(aoa, 1, 'Date')).toEqual({ mulai: '2026-08-01', selesai: '2026-08-31' });
  });

  it('dua rentang berbeda ⇒ yang paling sering menang', () => {
    const aoa = [
      HEADER,
      ['2026-07-01-2026-07-31', 'VID-1'],
      ['2026-08-01-2026-08-31', 'VID-2'],
      ['2026-08-01-2026-08-31', 'VID-3'],
    ];
    expect(ekstrakPeriodeKolomTiktok(aoa, 1, 'Date')).toEqual({ mulai: '2026-08-01', selesai: '2026-08-31' });
  });

  it('null bila kolomnya tidak ada, nol baris data, atau nilai terbanyaknya bukan rentang', () => {
    expect(ekstrakPeriodeKolomTiktok([HEADER, ['2026-08-01-2026-08-31', 'VID-1']], 1, 'Periode')).toBeNull();
    expect(ekstrakPeriodeKolomTiktok([HEADER], 1, 'Date')).toBeNull();
    expect(ekstrakPeriodeKolomTiktok([HEADER, ['Summary', '-']], 1, 'Date')).toBeNull();
  });
});

describe('ekstrakPeriodePreambleTiktok — DITUTUP via sample asli "Tiktok - Avitaskin.zip" (docs/DECISIONS.md G1-06-PERIODE-TIKTOK)', () => {
  it('preamble berlabel "Tanggal analisis:" (Shop Analytics/product_list_20260701, en dash)', () => {
    const aoa = [['Tanggal analisis: 01/07/2026–31/07/2026'], ['Ringkasan data'], ['GMV', 'Pesanan'], ['26560049', '143']];
    expect(ekstrakPeriodePreambleTiktok(aoa, 3)).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('preamble berlabel "Date Range:" dengan newline literal di sel (Live Analysis)', () => {
    const aoa = [['Date Range: 2026-07-01 ~ 2026-07-31\n'], [], ['ID Kreator', 'Waktu Live'], ['CR-1', '2026/07/15/ 11:00']];
    expect(ekstrakPeriodePreambleTiktok(aoa, 3)).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('preamble berlabel "[Rentang Tanggal]:" berkurung siku (Video Performance List)', () => {
    const aoa = [['[Rentang Tanggal]: 2026-07-01 ~ 2026-07-31\n'], [], ['ID Kreator', 'ID Video'], ['CR-1', 'VID-1']];
    expect(ekstrakPeriodePreambleTiktok(aoa, 3)).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('preamble TANPA label — seluruh sel adalah rentangnya sendiri (product_list.xlsx)', () => {
    const aoa = [['2026-07-01 ~ 2026-07-31'], [], ['ID', 'Produk'], ['123', 'Nama Produk']];
    expect(ekstrakPeriodePreambleTiktok(aoa, 3)).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('null bila nol baris preamble menghasilkan rentang — berkas mewarisi periode batch (Rule 5)', () => {
    const aoa = [['Sesuatu yang lain'], [], ['ID Kreator', 'ID Video'], ['CR-001', 'VID-1']];
    expect(ekstrakPeriodePreambleTiktok(aoa, 3)).toBeNull();
  });

  it('baris preamble DIPADATKAN ke lebar sheet (sel ke-2+ string kosong, bukan array satu-elemen) — bentuk NYATA XLSX.utils.sheet_to_json(header:1,defval:""), bukan cuma bentuk ideal', () => {
    // Bentuk asli sample DAN round-trip XLSX.write/read SUNGGUHAN sama-sama memadatkan baris
    // pendek ke lebar kolom sheet — regresi bug nyata (route.test.ts "ZIP TikTok sungguhan"
    // sempat gagal 400 "tidak ada berkas ... periode terbaca" sebelum diperbaiki).
    const aoa = [
      ['Tanggal analisis: 01/07/2026-31/07/2026', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['ID Kreator', 'ID Video', '', '', '', '', '', '', '', '', '', '', ''],
      ['CR-001', 'VID-1', '', '', '', '', '', '', '', '', '', '', ''],
    ];
    expect(ekstrakPeriodePreambleTiktok(aoa, 3)).toEqual({ mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('baris dengan sel KEDUA berisi (bukan padding kosong) BUKAN preamble label — dilewati, bukan dipaksa parse', () => {
    const aoa = [['Tanggal analisis: 01/07/2026-31/07/2026', 'kolom lain berisi'], [], ['ID Kreator', 'ID Video'], ['CR-001', 'VID-1']];
    expect(ekstrakPeriodePreambleTiktok(aoa, 3)).toBeNull();
  });

  it('null bila barisHeader di baris pertama — nol baris preamble untuk dipindai', () => {
    const aoa = [['ID Kreator', 'ID Video'], ['CR-001', 'VID-1']];
    expect(ekstrakPeriodePreambleTiktok(aoa, 1)).toBeNull();
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
