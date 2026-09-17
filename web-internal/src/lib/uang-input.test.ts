/**
 * QA pemilik 2026-09-17 — Master Service List: "ketika memasukan harga dan
 * tertekan enter. muncul warning data tidak lengkap. angka harga harus
 * diketikan melalui panah ^ atau yg bawah ... kalau di angka 1 juta lebih akan
 * sangat bermasalah".
 *
 * Yang diuji di sini adalah kedua separuh keluhan itu: Enter tidak boleh
 * menyimpan, dan angka juta harus bisa DIBACA sambil diketik.
 */
import { describe, expect, it } from 'vitest';
import {
  enterHarusDitahan,
  formatUangInput,
  jumlahDigit,
  normalisasiUang,
  posisiKaretUang,
} from './uang-input';

describe('formatUangInput', () => {
  it('memisah ribuan — inti keluhan: 21000000 dan 2100000 tak terbedakan tanpa titik', () => {
    expect(formatUangInput('21000000')).toBe('21.000.000');
    expect(formatUangInput('2100000')).toBe('2.100.000');
    expect(formatUangInput('8000000')).toBe('8.000.000');
    expect(formatUangInput('800')).toBe('800');
  });

  it('idempoten — dipanggil ulang atas hasilnya sendiri pada setiap ketukan', () => {
    expect(formatUangInput(formatUangInput('8000000'))).toBe('8.000.000');
    expect(formatUangInput(formatUangInput('8000000.00'))).toBe('8.000.000,00');
  });

  it('mengikuti pengetikan digit demi digit tanpa pernah salah kelompok', () => {
    // Persis yang terjadi di kotak: nilai lama + satu digit di ujung.
    let box = '';
    for (const d of '8000000') {
      box = formatUangInput(box + d);
    }
    expect(box).toBe('8.000.000');
  });

  it('membaca DECIMAL dari server ("8000000.00") sebagai delapan juta, bukan delapan ratus juta', () => {
    expect(formatUangInput('8000000.00')).toBe('8.000.000,00');
    expect(formatUangInput('10200000.00')).toBe('10.200.000,00');
  });

  it('titik yang diikuti tiga digit selalu pemisah ribuan', () => {
    expect(formatUangInput('1.500')).toBe('1.500');
    expect(formatUangInput('1.500.000')).toBe('1.500.000');
  });

  it('mempertahankan koma yang baru diketik — kalau ditelan, desimal tak akan pernah bisa diketik', () => {
    expect(formatUangInput('8000000,')).toBe('8.000.000,');
    expect(formatUangInput('8000000,5')).toBe('8.000.000,5');
    expect(formatUangInput('8000000,50')).toBe('8.000.000,50');
  });

  it('membuang huruf dan simbol — kotak ini hanya bisa berisi angka', () => {
    expect(formatUangInput('Rp 8.000.000')).toBe('8.000.000');
    expect(formatUangInput('abc')).toBe('');
    expect(formatUangInput('8juta')).toBe('8');
  });

  it('kosong tetap kosong — "belum diisi" bukan "nol rupiah"', () => {
    expect(formatUangInput('')).toBe('');
    expect(formatUangInput('   ')).toBe('');
    // Nol yang benar-benar diketik tetap nol.
    expect(formatUangInput('0')).toBe('0');
  });

  it('membuang nol di depan yang lahir dari mengetik di awal angka', () => {
    expect(formatUangInput('08')).toBe('8');
    expect(formatUangInput('0008000000')).toBe('8.000.000');
  });
});

describe('normalisasiUang', () => {
  it('mengembalikan bentuk kawat DECIMAL yang dimengerti server', () => {
    expect(normalisasiUang('8.000.000')).toBe('8000000');
    expect(normalisasiUang('1.500.000,50')).toBe('1500000.50');
    expect(normalisasiUang('21.000.000')).toBe('21000000');
  });

  it('adalah kebalikan TEPAT dari formatUangInput — nilai DB kembali utuh', () => {
    for (const dari of ['1500000', '8000000.00', '36000000.00', '0', '2700000']) {
      expect(normalisasiUang(formatUangInput(dari))).toBe(dari);
    }
  });

  it('kosong tetap kosong — gerbang wajib di server yang berhak menolak, bukan form ini', () => {
    expect(normalisasiUang('')).toBe('');
    expect(normalisasiUang('   ')).toBe('');
    // Koma tanpa angka juga belum berisi apa-apa.
    expect(normalisasiUang(',')).toBe('');
  });

  it('tidak mengubah nol yang disengaja menjadi kosong', () => {
    expect(normalisasiUang('0')).toBe('0');
  });
});

describe('posisiKaretUang', () => {
  it('mengembalikan karet ke digit yang sama setelah titik disisipkan', () => {
    // "800.0000" (8 digit, karet di ujung) → "8.000.000": karet tetap di ujung.
    expect(posisiKaretUang('8.000.000', 7)).toBe(9);
    // Karet setelah digit ke-1 dari "8.000.000" ada tepat sesudah "8".
    expect(posisiKaretUang('8.000.000', 1)).toBe(1);
    // Setelah digit ke-2 — yaitu sesudah titik pertama.
    expect(posisiKaretUang('8.000.000', 2)).toBe(3);
  });

  it('karet di awal tetap di awal', () => {
    expect(posisiKaretUang('8.000.000', 0)).toBe(0);
  });

  it('digit lebih banyak daripada yang ada berarti ujung teks', () => {
    expect(posisiKaretUang('8.000.000', 99)).toBe(9);
  });
});

describe('jumlahDigit', () => {
  it('menghitung digit, bukan karakter — satuan posisi karet', () => {
    expect(jumlahDigit('8.000.000')).toBe(7);
    expect(jumlahDigit('')).toBe(0);
    expect(jumlahDigit('1.500.000,50')).toBe(9);
  });
});

describe('enterHarusDitahan', () => {
  it('menahan Enter di dalam field — ini cacat yang dilaporkan pemilik', () => {
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'input', type: 'date' })).toBe(true);
    // Tanpa atribut type, HTML menganggapnya text.
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT' })).toBe(true);
  });

  it('TIDAK menahan Enter di tombol — di situ Enter berarti "klik tombol ini"', () => {
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'BUTTON' })).toBe(false);
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', type: 'submit' })).toBe(false);
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', type: 'button' })).toBe(false);
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', type: 'reset' })).toBe(false);
  });

  it('TIDAK menahan Enter di textarea — di situ Enter adalah baris baru', () => {
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'TEXTAREA' })).toBe(false);
  });

  it('TIDAK menahan Enter di select — browser memakainya untuk memilih opsi', () => {
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'SELECT' })).toBe(false);
  });

  it('melewatkan Ctrl/Cmd+Enter — idiom "kirim" yang disengaja, bukan kecelakaan mengetik', () => {
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', ctrlKey: true })).toBe(false);
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', metaKey: true })).toBe(false);
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', shiftKey: true })).toBe(false);
    expect(enterHarusDitahan({ key: 'Enter', tagName: 'INPUT', altKey: true })).toBe(false);
  });

  it('tidak menyentuh tombol lain', () => {
    expect(enterHarusDitahan({ key: 'Tab', tagName: 'INPUT' })).toBe(false);
    expect(enterHarusDitahan({ key: 'a', tagName: 'INPUT' })).toBe(false);
    expect(enterHarusDitahan({ key: 'Escape', tagName: 'INPUT' })).toBe(false);
  });
});
