import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CATATAN_SKOR_AKHIR, CatatanSkorAkhir, NamaKaryawan } from '@/components/PerformaTim';

// Feedback OD 2026-10-22: Ringkasan Tim / Portal Tim menampilkan `Nama (ID)`, bukan ID saja.
describe('NamaKaryawan', () => {
  it('merender Nama (ID) — ID tetap terlihat', () => {
    const html = renderToStaticMarkup(<NamaKaryawan nama="Siti Rahma" id="2609010726" />);
    expect(html).toContain('Siti Rahma');
    expect(html).toContain('(2609010726)');
  });

  it('nama jatuh ke ID (karyawan tak ditemukan) ⇒ ID sekali saja, bukan "ID (ID)"', () => {
    expect(renderToStaticMarkup(<NamaKaryawan nama="2609010726" id="2609010726" />)).toBe('2609010726');
    expect(renderToStaticMarkup(<NamaKaryawan nama="" id="2609010726" />)).toBe('2609010726');
  });

  it('AM kosong ⇒ —', () => {
    expect(renderToStaticMarkup(<NamaKaryawan nama="" id="" />)).toBe('—');
  });
});

describe('CatatanSkorAkhir', () => {
  it('menjelaskan Skor Akhir dan menegaskan tidak terkait OKR', () => {
    const html = renderToStaticMarkup(<CatatanSkorAkhir />);
    expect(html).toContain('class="muted"');
    expect(html).toContain('Skor Akhir = skor KPI bulanan M14 (0–100)');
    expect(html).toContain('±10, khusus Creative/Ads/KOL');
    expect(html).toContain('tidak terkait OKR');
    expect(CATATAN_SKOR_AKHIR).toContain('bobotnya dibagi ulang');
  });
});
