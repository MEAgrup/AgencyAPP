/**
 * Tes aturan sisi-klien picker aset kreatif (B-5 / K-3).
 *
 * Yang load-bearing adalah opsi bayangan. Tanpa itu, sebuah kampanye yang sudah
 * menautkan `AST-…` di luar daftar yang ditawarkan (dipilih lewat kolom teks
 * lama, atau di luar penyempitan `source_brief`) membuat `<select>` jatuh
 * diam-diam ke opsi pertama. Di form Creative Swap konsekuensinya adalah
 * MENUKAR ASET YANG SALAH — kelas kesalahan yang tidak akan pernah dilaporkan
 * sebagai bug picker; ia dilaporkan sebagai "kok asetnya ketuker".
 */
import { describe, expect, it } from 'vitest';
import {
  assetLabel,
  butuhOpsiBayangan,
  opsiPickerAset,
  pesanKosongAset,
  type AssetPickerRow,
} from './asset-picker';

const a = (id: string, seq: number, tipe = 'Product Video', judul = 'Brief Juli'): AssetPickerRow => ({
  id, brief_id: 'BRF-202607-0001', brief_title: judul, asset_type: tipe, sequence_no: seq,
});
const DAFTAR = [a('AST-202607-0001', 1), a('AST-202607-0002', 2)];

describe('assetLabel', () => {
  it('mendahulukan jenis + nomor urut dan judul Brief, ID di dalam kurung', () => {
    expect(assetLabel(a('AST-202607-0003', 3))).toBe('Product Video #3 — Brief Juli (AST-202607-0003)');
  });
});

describe('butuhOpsiBayangan', () => {
  it('false saat belum ada yang dipilih', () => {
    expect(butuhOpsiBayangan('', DAFTAR)).toBe(false);
  });

  it('false saat pilihan ADA di daftar', () => {
    expect(butuhOpsiBayangan('AST-202607-0002', DAFTAR)).toBe(false);
  });

  it('true saat pilihan TIDAK ada di daftar — aset lama / di luar source_brief', () => {
    expect(butuhOpsiBayangan('AST-202601-9999', DAFTAR)).toBe(true);
  });

  it('true saat daftarnya masih kosong (belum selesai dimuat)', () => {
    // Kalau ini false, ada jendela di mana `value` sudah terisi dari kampanye
    // tapi belum punya opsi — dan `<select>` mereset ke '' tepat di jendela itu.
    expect(butuhOpsiBayangan('AST-202607-0001', [])).toBe(true);
  });
});

describe('opsiPickerAset', () => {
  it('selalu punya opsi untuk `value` yang aktif — invarian picker ini', () => {
    // Diturunkan dari keluaran fungsinya, bukan dari indeks yang ditebak: sebuah
    // `expect(opsi[1])` telanjang tetap hijau kalau urutannya berubah.
    for (const value of ['', 'AST-202607-0001', 'AST-202601-9999']) {
      const opsi = opsiPickerAset(value, DAFTAR, { loading: false });
      expect(opsi.some((o) => o.value === value), `value=${value || '(kosong)'}`).toBe(true);
    }
  });

  it('menandai aset di luar daftar apa adanya, tanpa menyembunyikannya', () => {
    const opsi = opsiPickerAset('AST-202601-9999', DAFTAR, { loading: false });
    const bayangan = opsi.find((o) => o.value === 'AST-202601-9999');
    expect(bayangan?.label).toBe('AST-202601-9999 (di luar daftar aset yang ditawarkan)');
    // Dan ia TIDAK menggantikan satu pun opsi asli.
    expect(opsi.filter((o) => o.value !== '').length).toBe(DAFTAR.length + 1);
  });

  it('opsi pertama mengatakan sedang memuat, supaya kosong-sementara tidak terbaca kosong-permanen', () => {
    expect(opsiPickerAset('', [], { loading: true })[0].label).toBe('Memuat aset…');
    expect(opsiPickerAset('', [], { loading: false })[0].label).toBe('— pilih aset [Approved] —');
  });

  it('urutan opsi mengikuti urutan daftar dari server (approval terbaru dulu)', () => {
    // Picker tidak boleh mengurut ulang: urutannya sudah keputusan server
    // (`listApprovedAssetsForClient` — approved_at desc), dan aturan urut kedua
    // di sini akan bisa berbeda dari yang di DB.
    expect(opsiPickerAset('', DAFTAR, { loading: false }).slice(1).map((o) => o.value))
      .toEqual(['AST-202607-0001', 'AST-202607-0002']);
  });
});

describe('pesanKosongAset', () => {
  it('menyebut SEBAB kosongnya, bukan hanya bahwa ia kosong', () => {
    expect(pesanKosongAset({ adaKlien: false, adaSourceBrief: false })).toMatch(/klien kampanye belum diketahui/i);
    expect(pesanKosongAset({ adaKlien: true, adaSourceBrief: true })).toMatch(/Brief Creative sumber/);
    expect(pesanKosongAset({ adaKlien: true, adaSourceBrief: false })).toMatch(/untuk klien ini/);
  });

  it('ketiga sebabnya menghasilkan tiga pesan yang berbeda', () => {
    const pesan = new Set([
      pesanKosongAset({ adaKlien: false, adaSourceBrief: false }),
      pesanKosongAset({ adaKlien: true, adaSourceBrief: true }),
      pesanKosongAset({ adaKlien: true, adaSourceBrief: false }),
    ]);
    expect(pesan.size).toBe(3);
  });
});
