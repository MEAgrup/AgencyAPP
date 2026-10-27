import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatTanggalClosing, lamaMenungguLabel, TanggalClosing } from '@/components/clients/TanggalClosing';

// Feedback Zahrah & OD 27-10-2026 — kolom Tanggal Closing di Direktori Klien.
describe('TanggalClosing', () => {
  it('memformat tanggal kalender WIB, bukan UTC', () => {
    // 23.30 WIB 1 Okt = 16.30 UTC 1 Okt; 00.30 WIB 1 Okt = 17.30 UTC 30 Sep.
    expect(formatTanggalClosing('2026-10-01T16:30:00.000Z')).toBe('01 Okt 2026');
    expect(formatTanggalClosing('2026-09-30T17:30:00.000Z')).toBe('01 Okt 2026');
  });

  it('Menunggu Finance: tanggal + lama menunggu', () => {
    const html = renderToStaticMarkup(
      <TanggalClosing c={{ tanggal_closing: '2026-10-01T03:00:00.000Z', lama_menunggu_hari: 26 }} />,
    );
    expect(html).toContain('01 Okt 2026');
    expect(html).toContain('Menunggu 26 hari');
  });

  it('sudah dirilis: tanggal saja, tanpa badge menunggu', () => {
    const html = renderToStaticMarkup(
      <TanggalClosing c={{ tanggal_closing: '2026-10-01T03:00:00.000Z', lama_menunggu_hari: null }} />,
    );
    expect(html).toContain('01 Okt 2026');
    expect(html).not.toContain('Menunggu');
  });

  it('bukan hasil closing CDPS ⇒ —', () => {
    expect(renderToStaticMarkup(<TanggalClosing c={{ tanggal_closing: null, lama_menunggu_hari: null }} />))
      .toContain('—');
  });

  it('closing hari ini', () => {
    expect(lamaMenungguLabel(0)).toBe('Menunggu sejak hari ini');
  });
});
