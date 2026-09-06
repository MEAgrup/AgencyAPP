/**
 * Tes aturan sisi-klien picker klien Ads (SCR-UI-1).
 *
 * Yang load-bearing adalah opsi bayangan. Tanpa itu, tautan
 * `/ads/scanner?client=CLI-…` yang menunjuk klien di luar scope (belum punya
 * brief Ads) membuat `<select>` jatuh diam-diam ke opsi pertama — halamannya
 * menampilkan scan klien LAIN sementara ID yang benar masih ada di tautan yang
 * barusan diklik. Itu kelas kesalahan yang tidak akan pernah dilaporkan sebagai
 * bug picker; ia dilaporkan sebagai "angkanya salah".
 */
import { describe, expect, it } from 'vitest';
import { adsClientLabel, butuhOpsiBayangan, opsiPicker, type AdsClientRow } from './ads-client-picker';

const c = (id: string, toko: string): AdsClientRow => ({ id, toko });
const DAFTAR = [c('CLI-202609-0001', 'Toko Satu'), c('CLI-202609-0002', 'Toko Dua')];

describe('adsClientLabel', () => {
  it('menaruh nama toko dulu, ID di dalam kurung', () => {
    expect(adsClientLabel(c('CLI-202609-0001', 'Toko Satu'))).toBe('Toko Satu (CLI-202609-0001)');
  });
});

describe('butuhOpsiBayangan', () => {
  it('false saat belum ada yang dipilih', () => {
    expect(butuhOpsiBayangan('', DAFTAR)).toBe(false);
  });

  it('false saat pilihan ADA di daftar', () => {
    expect(butuhOpsiBayangan('CLI-202609-0002', DAFTAR)).toBe(false);
  });

  it('true saat pilihan TIDAK ada di daftar — kasus ?client= di luar scope', () => {
    expect(butuhOpsiBayangan('CLI-202609-9999', DAFTAR)).toBe(true);
  });

  it('true saat daftarnya masih kosong (belum selesai dimuat)', () => {
    // Kalau ini false, ada jendela di mana `value` sudah terisi dari URL tapi
    // belum punya opsi — dan `<select>` mereset ke '' tepat di jendela itu.
    expect(butuhOpsiBayangan('CLI-202609-0001', [])).toBe(true);
  });
});

describe('opsiPicker', () => {
  it('selalu punya opsi kosong lebih dulu, dan labelnya menyebut sedang memuat', () => {
    expect(opsiPicker('', [], { loading: true })[0]).toEqual({ value: '', label: 'Memuat klien…' });
    expect(opsiPicker('', DAFTAR, { loading: false })[0]).toEqual({ value: '', label: '— pilih klien —' });
  });

  it('setiap klien di daftar punya opsinya', () => {
    const o = opsiPicker('', DAFTAR, { loading: false });
    expect(o.map((x) => x.value)).toEqual(['', 'CLI-202609-0001', 'CLI-202609-0002']);
  });

  it('nilai yang aktif SELALU punya opsi yang cocok — ini inti berkas ini', () => {
    for (const value of ['', 'CLI-202609-0001', 'CLI-202609-9999']) {
      for (const daftar of [[], DAFTAR]) {
        const o = opsiPicker(value, daftar, { loading: false });
        expect(o.some((x) => x.value === value), `value ${value || '(kosong)'} tanpa opsi`).toBe(true);
      }
    }
  });

  it('opsi bayangan menyebut alasannya, bukan cuma ID-nya', () => {
    // AM yang melihatnya harus paham kenapa kliennya tidak ada di daftar,
    // bukan mengira picker-nya rusak.
    const o = opsiPicker('CLI-202609-9999', DAFTAR, { loading: false });
    expect(o[1]).toEqual({ value: 'CLI-202609-9999', label: 'CLI-202609-9999 (di luar daftar klien Ads)' });
  });

  it('nol opsi bayangan saat pilihannya memang ada — tidak ada duplikat', () => {
    const o = opsiPicker('CLI-202609-0001', DAFTAR, { loading: false });
    expect(o.filter((x) => x.value === 'CLI-202609-0001')).toHaveLength(1);
  });
});
