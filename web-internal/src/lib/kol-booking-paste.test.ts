/**
 * P9 / RC-8 — tempel/unggah Excel ke grid "Buat Booking Baru" KOL.
 *
 * Fixture-nya persis contoh dari tim KOL: dua baris valid, satu tanpa nama,
 * satu ber-rate negatif (rate 0 = barter, SAH sejak DECISIONS 2026-10-23). Nomor baris di error adalah nomor baris DATA (1 = baris
 * pertama sesudah header), supaya cocok dengan yang dilihat staff.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  BATCH_MAX,
  BOOKING_COLUMNS,
  BOOKING_TEMPLATE_CSV,
  normalizeRate,
  parseBookingRows,
  readBookingFile,
  validateRow,
} from './kol-booking-paste';

const TSV = [
  'Nama Creator\tHandle\tNiche\tAgreed Rate\tQty Video\tQty Live',
  'Sari Beauty\t@saribeauty\tBeauty\tRp 1.500.000\t2\t0',
  'Dimas Gadget\t@dimasgadget\tTech\t750000\t1\t1',
  '\t@tanpanama\tFood\t500000\t1\t0',
  'Rina Hijab\t@rinahijab\tFashion\t-500000\t1\t0',
].join('\n');

const EXPECTED_ROWS = [
  { creator_name: 'Sari Beauty', creator_handle: '@saribeauty', niche: 'Beauty', agreed_rate: '1500000', qty_video: '2', qty_live: '0' },
  { creator_name: 'Dimas Gadget', creator_handle: '@dimasgadget', niche: 'Tech', agreed_rate: '750000', qty_video: '1', qty_live: '1' },
];

const EXPECTED_ERRORS = [
  { baris: 3, pesan: '[nama creator wajib diisi]' },
  { baris: 4, pesan: '[agreed rate wajib diisi & tidak boleh negatif]' },
];

function errorsOf(r: { errors: { baris: number; pesan: string }[] }) {
  return r.errors.map(({ baris, pesan }) => ({ baris, pesan }));
}

describe('parseBookingRows — tempelan TSV dari Excel/Sheets', () => {
  it('fixture tim KOL → 2 baris valid + error baris 3 (nama) dan 4 (rate)', () => {
    const r = parseBookingRows(TSV);
    expect(r.rows).toEqual(EXPECTED_ROWS);
    expect(errorsOf(r)).toEqual(EXPECTED_ERRORS);
  });

  it('baris gagal tetap membawa isinya supaya bisa diperbaiki di grid', () => {
    const r = parseBookingRows(TSV);
    expect(r.errors[0].row?.creator_handle).toBe('@tanpanama');
    expect(r.errors[1].row?.creator_name).toBe('Rina Hijab');
  });

  it('pesan error identik dengan pra-cek submit (validateRow), bukan salinan', () => {
    for (const e of parseBookingRows(TSV).errors) {
      expect(validateRow(e.row!)).toBe(e.pesan);
    }
  });

  it('header acak urutan & beda huruf/spasi → kolom terpetakan benar', () => {
    const text = [
      'QTY LIVE\tagreed rate (Rp)\tnama creator *\tniche\tqty_video\thandle',
      '3\t1.000.000\tAyu\tFood\t4\t@ayu',
    ].join('\n');
    expect(parseBookingRows(text)).toEqual({
      rows: [{ creator_name: 'Ayu', creator_handle: '@ayu', niche: 'Food', agreed_rate: '1000000', qty_video: '4', qty_live: '3' }],
      errors: [],
    });
  });

  it('kolom header yang tidak dikenal diabaikan; kolom yang absen jadi kosong', () => {
    const text = 'Catatan\tNama Creator\tAgreed Rate\nabaikan\tBudi\t500000';
    expect(parseBookingRows(text).rows).toEqual([
      { creator_name: 'Budi', creator_handle: '', niche: '', agreed_rate: '500000', qty_video: '', qty_live: '' },
    ]);
  });

  it('tanpa header → urutan kolom template', () => {
    const noHeader = TSV.split('\n').slice(1).join('\n');
    const r = parseBookingRows(noHeader);
    expect(r.rows).toEqual(EXPECTED_ROWS);
    expect(errorsOf(r)).toEqual(EXPECTED_ERRORS);
  });

  it('baris kosong dilewati tanpa error', () => {
    const r = parseBookingRows(`${TSV}\n\n\t\t\t\t\t\n`);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(2);
  });

  it('qty bukan bilangan bulat → pesan qty baku', () => {
    const r = parseBookingRows('Andi\t@andi\tTech\t100000\t1,5\t0');
    expect(errorsOf(r)).toEqual([{ baris: 1, pesan: '[jumlah video/live harus bilangan bulat tidak negatif]' }]);
  });
});

describe('normalizeRate → string desimal money.parse', () => {
  it.each([
    ['Rp 1.500.000', '1500000'],
    ['Rp1.500.000', '1500000'],
    ['1.500.000', '1500000'],
    ['1500000', '1500000'],
    ['IDR 2.000.000', '2000000'],
    ['1.500.000,00', '1500000'],
    ['1.500.000,50', '1500000.5'],
    ['1,500,000.00', '1500000'],
    ['Rp 1,500,000', '1500000'],
    ['750.000', '750000'],
    ['1500000.25', '1500000.25'],
    ['', ''],
  ])('%s → %s', (input, out) => {
    expect(normalizeRate(input)).toBe(out);
  });

  it('teks tak dikenali dikembalikan apa adanya (ditolak validateRow)', () => {
    expect(normalizeRate('nego')).toBe('nego');
    expect(normalizeRate('-500000')).toBe('-500000');
    expect(normalizeRate('1.234,567')).toBe('1.234,567');
  });
});

describe('CSV & .xlsx → hasil sama dengan TSV', () => {
  const CSV = [
    'Nama Creator,Handle,Niche,Agreed Rate,Qty Video,Qty Live',
    'Sari Beauty,@saribeauty,Beauty,"Rp 1.500.000",2,0',
    'Dimas Gadget,@dimasgadget,Tech,750000,1,1',
    ',@tanpanama,Food,500000,1,0',
    'Rina Hijab,@rinahijab,Fashion,-500000,1,0',
  ].join('\r\n');

  it('CSV koma (dengan sel ber-kutip)', () => {
    expect(parseBookingRows(CSV)).toEqual(parseBookingRows(TSV));
  });

  it('CSV titik-koma (Excel berlokal Indonesia) + BOM', () => {
    const semi = '﻿' + TSV.replace(/\t/g, ';');
    expect(parseBookingRows(semi)).toEqual(parseBookingRows(TSV));
  });

  it('berkas .csv lewat readBookingFile', async () => {
    const file = new File([CSV], 'booking.csv', { type: 'text/csv' });
    expect(await readBookingFile(file)).toEqual(parseBookingRows(TSV));
  });

  it('berkas .xlsx (sheet pertama; rate numerik & teks)', async () => {
    const aoa = TSV.split('\n').map((l) => l.split('\t'));
    aoa[2][3] = 750000 as unknown as string; // sel angka asli, bukan teks
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Booking');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['abaikan sheet kedua']]), 'Lain');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = new File([buf], 'booking.xlsx');
    expect(await readBookingFile(file)).toEqual(parseBookingRows(TSV));
  });
});

describe('batas baris', () => {
  it('BATCH_MAX = 50 (keputusan 2026-10-20)', () => {
    expect(BATCH_MAX).toBe(50);
  });

  it('60 baris → 50 diterima + satu error "melebihi batas"', () => {
    const lines = ['Nama Creator\tAgreed Rate'];
    for (let i = 1; i <= 60; i++) lines.push(`Creator ${i}\t100000`);
    const r = parseBookingRows(lines.join('\n'));
    expect(r.rows).toHaveLength(50);
    expect(r.rows[49].creator_name).toBe('Creator 50');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].baris).toBe(51);
    expect(r.errors[0].pesan).toContain('melebihi batas 50');
    expect(r.errors[0].pesan).toContain('10 baris');
  });

  it('kapasitas sisa grid dihormati (baris tidak valid ikut memakan kapasitas)', () => {
    const r = parseBookingRows(TSV, 3);
    expect(r.rows).toHaveLength(2);
    expect(errorsOf(r)).toEqual([
      EXPECTED_ERRORS[0],
      { baris: 4, pesan: expect.stringContaining('melebihi batas') },
    ]);
  });
});

describe('template', () => {
  it('header template = header yang dikenali parser', () => {
    expect(BOOKING_TEMPLATE_CSV.trim()).toBe(BOOKING_COLUMNS.join(','));
    expect(parseBookingRows(BOOKING_TEMPLATE_CSV)).toEqual({ rows: [], errors: [] });
  });
});

describe('Agreed Rate 0 = creator barter (feedback KOL 2026-10-23)', () => {
  const base = { creator_name: 'X', creator_handle: '', niche: '', qty_video: '', qty_live: '' };
  const NEG = '[agreed rate wajib diisi & tidak boleh negatif]';

  it('validateRow menerima 0; tetap menolak kosong, negatif, dan teks', () => {
    expect(validateRow({ ...base, agreed_rate: '0' })).toBeNull();
    expect(validateRow({ ...base, agreed_rate: '' })).toBe(NEG);
    expect(validateRow({ ...base, agreed_rate: '  ' })).toBe(NEG);
    expect(validateRow({ ...base, agreed_rate: '-1' })).toBe(NEG);
    expect(validateRow({ ...base, agreed_rate: 'abc' })).toBe(NEG);
  });

  it.each([['0'], ['Rp 0'], ['0,00'], ['Rp. 0,00']])('rate %s → "0"', (input) => {
    expect(normalizeRate(input)).toBe('0');
  });

  it('CSV contoh dari tim KOL (BRF-202609-0025) → 2 baris valid', () => {
    const csv = [
      'Nama Creator,Handle,Niche,Agreed Rate,Qty Video,Qty Live',
      'triscalufi_r,fatiya,fashion hijab,10000,5,0',
      'antiinovita18,fatiya,fashion hijab,0,5,0',
    ].join('\r\n');
    expect(parseBookingRows(csv)).toEqual({
      rows: [
        { creator_name: 'triscalufi_r', creator_handle: 'fatiya', niche: 'fashion hijab', agreed_rate: '10000', qty_video: '5', qty_live: '0' },
        { creator_name: 'antiinovita18', creator_handle: 'fatiya', niche: 'fashion hijab', agreed_rate: '0', qty_video: '5', qty_live: '0' },
      ],
      errors: [],
    });
  });
});
