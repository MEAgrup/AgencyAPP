/**
 * Money-math tests for the `/persetujuan` price comparison (CLAUDE.md DoD:
 * "Tests first for state machines and money math"). Nothing here decides
 * anything — but it is the number an approver reads before saying yes, so a
 * wrong sign or a silently-halved total is a real defect.
 */
import { describe, expect, it } from 'vitest';
import {
  buildComparison,
  deltaLabel,
  formatDeltaPercent,
  priceDelta,
  type CatalogEntry,
  type ProposedLine,
} from './persetujuan';

const CATALOG: CatalogEntry[] = [
  { id: 'MSVC-0001', name: 'Pendampingan Establish TikTok', standard_price: '9000000.00' },
  { id: 'MSVC-0002', name: 'Jasa Buka Toko Online Basic', standard_price: '6000000.00' },
  { id: 'MSVC-0003', name: 'Jasa Live Streaming Basic', standard_price: '6900000.00' },
];

describe('priceDelta', () => {
  it('membaca DECIMAL string dari backend dan menghitung diskon', () => {
    const d = priceDelta('9000000.00', '7200000.00');
    expect(d.standard).toBe(9000000);
    expect(d.proposed).toBe(7200000);
    expect(d.delta).toBe(-1800000);
    expect(d.percent).toBeCloseTo(-20);
    expect(d.direction).toBe('diskon');
    expect(deltaLabel(d)).toBe('Diskon');
  });

  it('markup positif', () => {
    const d = priceDelta(6000000, 6600000);
    expect(d.delta).toBe(600000);
    expect(d.percent).toBeCloseTo(10);
    expect(d.direction).toBe('markup');
  });

  it('harga sama = tidak ada negosiasi harga', () => {
    const d = priceDelta('6900000.00', '6900000.00');
    expect(d.delta).toBe(0);
    expect(d.direction).toBe('sama');
    expect(formatDeltaPercent(d)).toBe('0%');
  });

  it('harga standar tidak diketahui ⇒ unknown, bukan 0', () => {
    const d = priceDelta(null, '5000000.00');
    expect(d.standard).toBeNull();
    expect(d.delta).toBeNull();
    expect(d.percent).toBeNull();
    expect(d.direction).toBe('unknown');
    expect(formatDeltaPercent(d)).toBe('—');
    expect(deltaLabel(d)).toBe('—');
  });

  it('harga standar 0 ⇒ persen "—", tidak Infinity (house convention #7)', () => {
    const d = priceDelta('0', '1000000');
    expect(d.delta).toBe(1000000);
    expect(d.percent).toBeNull();
    expect(formatDeltaPercent(d)).toBe('—');
  });

  it('string kosong diperlakukan sebagai tidak diketahui', () => {
    expect(priceDelta('', '100').direction).toBe('unknown');
    expect(priceDelta('100', '').direction).toBe('unknown');
  });
});

describe('formatDeltaPercent', () => {
  it('memberi tanda dan koma desimal ala id-ID', () => {
    expect(formatDeltaPercent(priceDelta(8000000, 7000000))).toBe('-12,5%');
    expect(formatDeltaPercent(priceDelta(8000000, 9000000))).toBe('+12,5%');
  });

  it('dibulatkan ke satu desimal', () => {
    expect(formatDeltaPercent(priceDelta(3, 2))).toBe('-33,3%');
  });
});

describe('buildComparison', () => {
  const lines: ProposedLine[] = [
    { masterServiceId: 'MSVC-0001', proposedPrice: '7200000.00', commissionRule: '5%', paymentTerms: 'Cicilan 3x' },
    { masterServiceId: 'MSVC-0002', proposedPrice: '6000000.00', commissionRule: '5%' },
  ];

  it('mengambil nama + harga standar dari katalog saat proposal tidak membawanya', () => {
    const c = buildComparison(lines, CATALOG);
    expect(c.lines[0].name).toBe('Pendampingan Establish TikTok');
    expect(c.lines[0].delta.standard).toBe(9000000);
    expect(c.lines[0].delta.direction).toBe('diskon');
    expect(c.lines[1].delta.direction).toBe('sama');
    expect(c.lines[0].paymentTerms).toBe('Cicilan 3x');
    expect(c.lines[1].paymentTerms).toBe('');
  });

  it('menjumlahkan kedua sisi dan selisihnya', () => {
    const c = buildComparison(lines, CATALOG);
    expect(c.totalStandard).toBe(15000000);
    expect(c.totalProposed).toBe(13200000);
    expect(c.totalDelta).toBe(-1800000);
    expect(c.totalPercent).toBeCloseTo(-12);
  });

  it('snapshot proposal MENANG atas katalog hidup', () => {
    // MSL hari ini 9.000.000, tapi penawaran ini dibuat saat harganya 8.000.000.
    // Pembanding yang benar adalah yang berlaku saat itu — kalau katalog menang,
    // diskon 10% tampil sebagai 20%.
    const c = buildComparison(
      [{ masterServiceId: 'MSVC-0001', standardPrice: '8000000.00', proposedPrice: '7200000.00' }],
      CATALOG,
    );
    expect(c.lines[0].delta.standard).toBe(8000000);
    expect(c.lines[0].delta.percent).toBeCloseTo(-10);
  });

  it('satu baris tanpa harga standar membuat TOTAL standar null, bukan separuh', () => {
    const c = buildComparison(
      [
        { masterServiceId: 'MSVC-0001', proposedPrice: '7200000.00' },
        { masterServiceId: 'TIDAK-ADA', proposedPrice: '1000000.00' },
      ],
      CATALOG,
    );
    expect(c.totalStandard).toBeNull();
    expect(c.totalProposed).toBe(8200000);
    expect(c.totalDelta).toBeNull();
    expect(c.totalPercent).toBeNull();
  });

  it('jasa di luar katalog jatuh ke ID-nya, tidak jadi baris kosong', () => {
    const c = buildComparison([{ masterServiceId: 'MSVC-9999', proposedPrice: '1' }], []);
    expect(c.lines[0].name).toBe('MSVC-9999');
    expect(c.lines[0].delta.direction).toBe('unknown');
  });

  it('daftar kosong = total nol, bukan null', () => {
    const c = buildComparison([], CATALOG);
    expect(c.lines).toEqual([]);
    expect(c.totalStandard).toBe(0);
    expect(c.totalProposed).toBe(0);
  });
});
