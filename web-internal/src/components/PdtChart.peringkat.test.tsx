import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GrafikPeringkat } from '@/components/PdtChart';

const rp = (v: number | null): string => (v == null ? '—' : `Rp. ${v.toLocaleString('id-ID')}`);

describe('GrafikPeringkat', () => {
  it('menggambar batang sebanding nilai TERBESAR di daftar', () => {
    const html = renderToStaticMarkup(
      <GrafikPeringkat judul="uji" format={rp} baris={[
        { label: 'A', nilai: 1000 },
        { label: 'B', nilai: 250 },
      ]} />,
    );
    expect(html).toContain('width:100%');
    expect(html).toContain('width:25%');
  });

  it('baris bernilai null TETAP tampil tanpa batang — Top 10 tidak diam-diam jadi sembilan', () => {
    const html = renderToStaticMarkup(
      <GrafikPeringkat judul="uji" format={rp} baris={[{ label: 'A', nilai: 100 }, { label: 'Tanpa data', nilai: null }]} />,
    );
    expect(html).toContain('Tanpa data');
    expect(html).toContain('—');
  });

  it('daftar kosong ⇒ keadaan kosong, bukan kanvas hampa', () => {
    expect(renderToStaticMarkup(<GrafikPeringkat judul="uji" format={rp} baris={[]} />)).toContain('Belum ada baris');
  });

  it('seluruh nilai 0 ⇒ nol batang (bukan pembagian oleh nol)', () => {
    const html = renderToStaticMarkup(
      <GrafikPeringkat judul="uji" format={rp} baris={[{ label: 'A', nilai: 0 }, { label: 'B', nilai: 0 }]} />,
    );
    expect(html).not.toContain('width:');
  });
});
