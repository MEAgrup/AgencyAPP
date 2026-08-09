import { describe, expect, it } from 'vitest';
import {
  STRATEGI_SECTIONS,
  channelOf,
  fieldIdOf,
  groupKekurangan,
  isEditable,
  sectionLabel,
  sectionOf,
} from './strategi-sections';

describe('sectionOf', () => {
  it('reads the section letter off a plain field ID', () => {
    expect(sectionOf('A-5')).toBe('A');
    expect(sectionOf('D-6')).toBe('D');
    expect(sectionOf('J-2')).toBe('J');
  });

  it('reads it off a per-channel kode, including channels with spaces', () => {
    expect(sectionOf('B-1/Shopee')).toBe('B');
    expect(sectionOf('E-2/TikTok Shop')).toBe('E');
    expect(sectionOf('C-3/Shopee')).toBe('C');
  });

  it('does not file a kode under a section just because it starts with the letter', () => {
    // Without the `-` check, this would land in A and the AM would be sent to a
    // section that has nothing to fix.
    expect(sectionOf('AKSES-3')).toBe('lain');
    expect(sectionOf('A')).toBe('lain');
    expect(sectionOf('')).toBe('lain');
  });

  it('files `Rule 8` under D, where the D-9 checkbox that fixes it lives', () => {
    // `checkCompleteness` emits this kode with no field ID. In `lain` the page
    // tells the AM to report it to the systems team — for a gap they fix by
    // ticking a box two cards up.
    expect(sectionOf('Rule 8')).toBe('D');
  });

  it('sends an unknown section letter to `lain` rather than dropping it', () => {
    // The whole point: a gap nobody can classify still has to be counted, or the
    // submit button lies while the server refuses the submit.
    expect(sectionOf('Z-9')).toBe('lain');
  });
});

describe('channelOf / fieldIdOf', () => {
  it('splits on the first slash — channel names have spaces but never slashes', () => {
    expect(channelOf('B-1/TikTok Shop')).toBe('TikTok Shop');
    expect(fieldIdOf('B-1/TikTok Shop')).toBe('B-1');
  });

  it('returns null / the kode itself when there is no channel', () => {
    expect(channelOf('D-5')).toBeNull();
    expect(fieldIdOf('D-5')).toBe('D-5');
  });

  it('treats a trailing slash as no channel', () => {
    expect(channelOf('B-1/')).toBeNull();
  });
});

describe('groupKekurangan', () => {
  it('gives every section a bucket so the nav does not reflow as gaps close', () => {
    const g = groupKekurangan([]);
    expect(g.size).toBe(STRATEGI_SECTIONS.length);
    for (const s of STRATEGI_SECTIONS) expect(g.get(s.key)).toEqual([]);
    // `lain` is absent when empty — an always-visible "lain: 0" trains people to
    // ignore the one row that matters when it is not 0.
    expect(g.has('lain')).toBe(false);
  });

  it('buckets by section and keeps per-channel gaps separate', () => {
    const g = groupKekurangan([
      { kode: 'A-5', pesan: '[minimal tiga USP produk wajib diisi]' },
      { kode: 'B-1/Shopee', pesan: '[data baseline belum lengkap]' },
      { kode: 'B-1/TikTok Shop', pesan: '[data baseline belum lengkap]' },
      { kode: 'G-1', pesan: '[minimal 2 fase kerja wajib diisi]' },
    ]);
    expect(g.get('A')).toHaveLength(1);
    expect(g.get('B')).toHaveLength(2);
    expect(g.get('G')).toHaveLength(1);
    expect(g.get('D')).toEqual([]);
  });

  it('counts every item, including ones it cannot classify', () => {
    const items = [
      { kode: 'A-5', pesan: 'x' },
      { kode: 'Z-9', pesan: 'y' },
      { kode: 'entah', pesan: 'z' },
    ];
    const g = groupKekurangan(items);
    const total = [...g.values()].reduce((n, v) => n + v.length, 0);
    expect(total).toBe(items.length);
    expect(g.get('lain')).toHaveLength(2);
  });
});

describe('sectionLabel', () => {
  it('numbers the ten sections and names the fallback', () => {
    expect(sectionLabel('D')).toBe('D. Target & KPI');
    expect(sectionLabel('lain')).toBe('Lainnya (tidak dikenali)');
  });
});

describe('isEditable', () => {
  it('opens Sections A→I in both draft states and nowhere else', () => {
    expect(isEditable('Draft')).toBe(true);
    expect(isEditable('Draft Revisi')).toBe(true);
    for (const s of ['Diajukan', 'Aktif', 'Kedaluwarsa', 'Diarsipkan']) {
      expect(isEditable(s)).toBe(false);
    }
  });
});
