import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hargaRataRata } from './SectionB';

// Ketokan pemilik 2026-09-20 (`docs/DECISIONS.md`, B33-HARGA-JUAL opsi (a)):
// harga jual B-3.3 dibaca sebagai harga RATA-RATA REALISASI = GMV ÷ unit
// terjual. Begitu ia terhitung, ia tidak boleh lagi diketik — house rule #4,
// perjalanan yang SAMA dengan B-3.6 (`listingLayakDerived`).
//
// Yang di-assert di sini bukan cuma rumusnya, tapi juga bahwa kolomnya benar-
// benar sudah read-only di form. Rumus yang benar di sebelah input yang masih
// bisa diketik berarti angka AM dan angka server bisa berbeda sampai simpan
// berikutnya — persis jenis ketidakcocokan yang aturan #4 ada untuk mencegah.

const SRC = readFileSync(join(__dirname, 'SectionB.tsx'), 'utf8');

describe('B-3.3 harga jual — turunan read-only, bukan input', () => {
  it('GMV ÷ unit terjual, diformat rupiah rumah', () => {
    expect(hargaRataRata('8000000', '80')).toBe('Rp. 100.000,00');
    // Cermin fixture domain (52jt ÷ 610): pembulatan ke rupiah penuh.
    expect(hargaRataRata('52000000.00', '610')).toBe('Rp. 85.246,00');
  });

  it('penyebut nol atau kosong ⇒ null (layar menampilkan `—`, bukan Rp. 0,00)', () => {
    expect(hargaRataRata('8000000', '0')).toBeNull();
    expect(hargaRataRata('8000000', '')).toBeNull();
    expect(hargaRataRata('', '80')).toBeNull();
    expect(hargaRataRata('8000000', '   ')).toBeNull();
    expect(hargaRataRata('abc', '80')).toBeNull();
  });

  it('GMV nol tetap dihitung — SKU nol omzet itu fakta, bukan data hilang', () => {
    expect(hargaRataRata('0', '80')).toBe('Rp. 0,00');
  });

  it('input harga jual sudah readOnly dan tidak lagi punya onChange', () => {
    const i = SRC.indexOf('>Harga jual<');
    expect(i, 'label "Harga jual" tidak ditemukan').toBeGreaterThan(-1);
    // Potong sampai field berikutnya (Margin %) supaya scan-nya tidak melebar.
    const blok = SRC.slice(i, SRC.indexOf('>Margin %<', i));
    expect(blok).toContain('readOnly');
    expect(blok).toContain('hargaRataRata(row.gmv, row.unit_terjual)');
    expect(blok, 'harga jual masih bisa diketik AM').not.toContain('set({ harga_jual:');
  });
});
