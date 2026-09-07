/**
 * Tes mesin accrual (Gelombang D). DITULIS SEBELUM `accrual.ts` ada — kalau
 * urutannya dibalik, yang diuji hanyalah apa yang kebetulan sudah dilakukan
 * kodenya, dan tiga dari empat gerbang uang di bawah tidak akan pernah punya
 * cabang merah.
 *
 * Angka-angka di sini bukan karangan. Cabangnya diturunkan dari katalog live
 * per 2026-09-07 (aturan kerja #2 — "cabang tes jangan ditebak"):
 *
 *   GMV MAX MEA PRO           6 bulan, qty_menambah='durasi'  -> beli 2 = 12 bulan
 *   Store Management (Paket)  1 bulan, qty_menambah='durasi'  -> beli 3 = 3 bulan
 *   Nano KOL                  NULL,    qty_menambah='volume'  -> beli 10 = 10 KOL
 *   Jasa Pengajuan Shopee Mall NULL                           -> saat_selesai
 *   Komisi                    NULL                            -> bulan_berikutnya
 *
 * Yang dijaga:
 *
 *   1. **Aturan uang tidak boleh kehilangan satu rupiah pun.** Satu invariant
 *      berlaku untuk SETIAP bentuk masukan, tanpa kecuali: `nilaiBruto = diakui
 *      + hangus + belumDiakui`. Kalau suatu hari sebuah cabang baru lupa
 *      mengarahkan sisanya ke salah satu dari tiga ember itu, tes ini merah.
 *   2. **D-1 HANGUS** — void di tengah periode diakui hanya untuk hari yang
 *      sudah jalan; sisanya tidak pernah diakui, dan tidak juga menggantung
 *      sebagai "belum".
 *   3. **D-2 HOLD MENJEDA** — hari hold tidak mengakui apa pun DAN menggeser
 *      garis finish sepanjang hold itu. Termasuk hold bersarang/berulang, yang
 *      `HANDOFF_GELOMBANG_D_20260907.md` §9 sebut belum pernah dipikirkan.
 *   4. **Batas periode kalender-aware** — mulai tanggal 31 memakai
 *      `tz.addMonthsToDate`, bukan +30 hari. Selisih beberapa hari per periode
 *      bukan detail pembulatan begitu D-3 mengunci buku PER BULAN.
 */
import { describe, expect, it } from 'vitest';
import * as money from './money';
import * as accrual from './accrual';

const rp = (s: string): money.Money => money.parse(s);

/** Σ baris jadwal, untuk mengadu total terhadap `diakui`. */
const sumBaris = (j: accrual.Jadwal): money.Money =>
  j.baris.reduce((a, b) => a + b.nilai, 0n);

/** Peta bulan -> nilai DECIMAL, bentuk yang paling mudah dibaca di ekspektasi. */
const peta = (j: accrual.Jadwal): Record<string, string> =>
  Object.fromEntries(j.baris.map((b) => [b.bulan, money.decimal(b.nilai)]));

/**
 * Invariant tunggal yang berlaku untuk SEMUA hasil, dipanggil di setiap tes.
 * Ia sengaja juga mengadu `diakui` terhadap Σ baris: dua angka yang menjawab
 * pertanyaan yang sama harus selalu sama, dan kalau salah satu dihitung ulang
 * dengan cara yang berbeda, di sinilah ia ketahuan.
 */
function invariant(j: accrual.Jadwal, nilaiBruto: money.Money): void {
  expect(money.decimal(j.diakui + j.hangus + j.belumDiakui)).toBe(money.decimal(nilaiBruto));
  expect(money.decimal(sumBaris(j))).toBe(money.decimal(j.diakui));
  // Tidak ada ember yang boleh negatif — sebuah pembagian yang salah arah
  // paling sering muncul sebagai `hangus` negatif yang saling menghapus.
  expect(j.diakui >= 0n).toBe(true);
  expect(j.hangus >= 0n).toBe(true);
  expect(j.belumDiakui >= 0n).toBe(true);
  // `alasanKosong` HANYA boleh terisi saat memang tidak ada baris (aturan rumah
  // #4: ketiadaan wajib mengatakan sebabnya — dan sebab tanpa ketiadaan adalah
  // kebalikannya, sebuah alasan yang membingungkan pembacanya).
  expect(j.alasanKosong !== null).toBe(j.baris.length === 0);
}

// ---------------------------------------------------------------------------
// durasiTotalBulan — formulanya hidup di kode, bukan hanya di handoff
// ---------------------------------------------------------------------------
describe('durasiTotalBulan', () => {
  it('qty MENGALIKAN durasi saat qty_menambah=durasi (GMV MAX MEA PRO beli 2 = 12 bulan)', () => {
    expect(accrual.durasiTotalBulan(6, 'durasi', 2)).toBe(12);
    expect(accrual.durasiTotalBulan(1, 'durasi', 3)).toBe(3); // Store Management
  });

  it('qty TIDAK mengubah durasi saat qty_menambah=volume (Nano KOL beli 10 tetap sekali jalan)', () => {
    expect(accrual.durasiTotalBulan(null, 'volume', 10)).toBeNull();
    expect(accrual.durasiTotalBulan(1, 'volume', 10)).toBe(1);
  });

  it('durasi NULL tetap NULL — layanan sekali jadi tidak punya periode, apa pun qty-nya', () => {
    expect(accrual.durasiTotalBulan(null, 'volume', 1)).toBeNull();
  });

  it('menolak qty yang bukan bilangan bulat positif — nol periode bukan durasi', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() => accrual.durasiTotalBulan(6, 'durasi', bad)).toThrow(accrual.AccrualInputError);
    }
  });

  it('menolak durasi=NULL berpasangan dengan qty_menambah=durasi — qty mengalikan ketiadaan', () => {
    // Kombinasi yang sama ditolak DB (`ck_msv_qty_durasi_butuh_durasi_bulan`).
    // Ia diadu di sini juga karena mesin ini juga dipanggil dari jalur yang
    // tidak lewat tabel itu (perhitungan pratayang, tes, impor).
    expect(() => accrual.durasiTotalBulan(null, 'durasi', 2)).toThrow(accrual.AccrualInputError);
  });
});

// ---------------------------------------------------------------------------
// per_periode — jalur utama
// ---------------------------------------------------------------------------
describe('pengakuan per_periode', () => {
  it('menyebar rata per HARI dan menutup persis di nilai bruto (1 bulan penuh, Januari)', () => {
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
    });
    invariant(j, nilai);
    // [1 Jan, 1 Feb) = 31 hari, semuanya di Januari.
    expect(peta(j)).toEqual({ '2026-01': '31000000.00' });
    expect(j.periode).toEqual({
      mulai: '2026-01-01', akhirEksklusif: '2026-02-01',
      hariTotal: 31, hariAktif: 31, hariHold: 0,
    });
  });

  it('membelah satu periode yang menyeberang bulan MENURUT HARI — D-3 mengunci per bulan kalender', () => {
    // Store Management (Paket) 1 bulan, mulai pertengahan bulan: [15 Mar, 15
    // Apr) = 31 hari, 17 di Maret + 14 di April. Menaruh seluruhnya di Maret
    // (bulan mulainya) akan melaporkan pendapatan April di bulan yang sudah
    // ditutup — dan D-3 membuat bulan tertutup tidak bisa diperbaiki lagi.
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-03-15', durasiBulanTotal: 1,
    });
    invariant(j, nilai);
    expect(peta(j)).toEqual({ '2026-03': '17000000.00', '2026-04': '14000000.00' });
  });

  it('memakai bulan KALENDER, bukan 30 hari: mulai 31 Januari, 1 bulan, berakhir 28 Februari', () => {
    // `tz.addMonthsToDate` meng-clamp ke akhir bulan. [31 Jan, 28 Feb) = 28
    // hari — satu di Januari, 27 di Februari. Kalau mesin ini memakai +30 hari,
    // akhirnya jatuh 2 Maret dan Februari kelebihan akui.
    const nilai = rp('28000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-31', durasiBulanTotal: 1,
    });
    invariant(j, nilai);
    expect(j.periode!.akhirEksklusif).toBe('2026-02-28');
    expect(j.periode!.hariTotal).toBe(28);
    expect(peta(j)).toEqual({ '2026-01': '1000000.00', '2026-02': '27000000.00' });
  });

  it('12 bulan (GMV MAX MEA PRO beli 2) mengakui 12 bulan kalender dan tidak sepeser pun lebih', () => {
    const nilai = rp('120000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: accrual.durasiTotalBulan(6, 'durasi', 2)!,
    });
    invariant(j, nilai);
    expect(j.diakui).toBe(nilai);
    expect(j.baris).toHaveLength(12);
    expect(j.baris[0].bulan).toBe('2026-01');
    expect(j.baris[11].bulan).toBe('2026-12');
    expect(j.periode!.akhirEksklusif).toBe('2027-01-01');
  });

  it('BULAN TERAKHIR menyerap sisa pembulatan — Σ selalu persis nilai bruto', () => {
    // 10.000.000 / 31 hari tidak habis dibagi. Setiap bulan dibulatkan ke
    // rupiah penuh; kalau tidak ada satu titik yang menyerap sisanya, Σ akan
    // meleset beberapa rupiah dan itu bertahan selamanya di buku.
    const nilai = rp('10000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-03-15', durasiBulanTotal: 1,
    });
    invariant(j, nilai);
    expect(j.diakui).toBe(nilai);
  });

  it('nilai ber-SEN tetap tertutup persis — sennya jatuh di bulan terakhir, bukan hilang', () => {
    const nilai = rp('1000000.55');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-03-15', durasiBulanTotal: 1,
    });
    invariant(j, nilai);
    expect(money.decimal(j.diakui)).toBe('1000000.55');
  });

  it('tanpa tanggal mulai: nol diakui, seluruhnya BELUM, dan alasannya disebut', () => {
    const nilai = rp('12000000');
    const j = accrual.jadwalkan({ nilaiBruto: nilai, pengakuan: 'per_periode', durasiBulanTotal: 6 });
    invariant(j, nilai);
    expect(j.baris).toEqual([]);
    expect(j.alasanKosong).toBe('belum_mulai_jalan');
    expect(j.belumDiakui).toBe(nilai);
    expect(accrual.ALASAN_KALIMAT.belum_mulai_jalan).toMatch(/belum/i);
  });

  it('per_periode tanpa durasi adalah masukan tak sah, bukan jadwal kosong', () => {
    // Kombinasi ini ditolak DB (`ck_msv_pengakuan_periode_butuh_durasi_bulan`).
    // "Diakui rata sepanjang durasi" tidak punya arti tanpa durasi — itu bukan
    // "belum diisi", jadi mesin ini MELEDAK alih-alih mengarang jadwal.
    expect(() => accrual.jadwalkan({
      nilaiBruto: rp('1000000'), pengakuan: 'per_periode', tanggalMulai: '2026-01-01',
    })).toThrow(accrual.AccrualInputError);
  });
});

// ---------------------------------------------------------------------------
// D-1 HANGUS
// ---------------------------------------------------------------------------
describe('D-1 hangus (void di tengah periode)', () => {
  it('mengakui HANYA hari yang sudah jalan; sisanya hangus, tidak menggantung sebagai belum', () => {
    // [1 Jan, 1 Feb) = 31 hari; void 11 Januari ⇒ 10 hari sudah jalan (1..10),
    // 11 Januari adalah hari pertama yang TIDAK diakui.
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1, tanggalVoid: '2026-01-11',
    });
    invariant(j, nilai);
    expect(peta(j)).toEqual({ '2026-01': '10000000.00' });
    expect(money.decimal(j.hangus)).toBe('21000000.00');
    expect(j.belumDiakui).toBe(0n);
    expect(j.periode!.hariAktif).toBe(10);
  });

  it('memotong bulan-bulan SESUDAH void seluruhnya — bukan mengakuinya nol', () => {
    // Sebuah baris ber-nilai 0 di bulan berikutnya akan terbaca di laporan
    // sebagai "bulan ini memang tidak menghasilkan", padahal yang benar adalah
    // "layanan ini sudah tidak ada". Dua hal yang berbeda.
    const nilai = rp('60000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 6, tanggalVoid: '2026-02-01',
    });
    invariant(j, nilai);
    expect(j.baris.map((b) => b.bulan)).toEqual(['2026-01']);
  });

  it('void PADA hari mulai mengakui nol dan menghanguskan semuanya', () => {
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1, tanggalVoid: '2026-01-01',
    });
    invariant(j, nilai);
    expect(j.diakui).toBe(0n);
    expect(j.hangus).toBe(nilai);
    expect(j.alasanKosong).toBe('void_sebelum_mulai');
  });

  it('void SESUDAH periode selesai tidak menghanguskan apa pun — tidak ada sisa untuk dihanguskan', () => {
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1, tanggalVoid: '2026-06-01',
    });
    invariant(j, nilai);
    expect(j.diakui).toBe(nilai);
    expect(j.hangus).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// D-2 HOLD MENJEDA
// ---------------------------------------------------------------------------
describe('D-2 hold menjeda pengakuan', () => {
  it('hari hold mengakui nol DAN menggeser garis finish sepanjang hold itu', () => {
    // [1 Jan, …) 31 hari aktif, hold [11 Jan, 21 Jan) = 10 hari.
    // Hari aktif: 1..10 (10 hari Januari) + 21..31 (11 hari Januari) = 21 di
    // Januari, sisa 10 hari jatuh di Februari ⇒ finish 11 Februari.
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-11', selesai: '2026-01-21' }],
    });
    invariant(j, nilai);
    expect(j.periode).toEqual({
      mulai: '2026-01-01', akhirEksklusif: '2026-02-11',
      hariTotal: 31, hariAktif: 31, hariHold: 10,
    });
    expect(peta(j)).toEqual({ '2026-01': '21000000.00', '2026-02': '10000000.00' });
  });

  it('hold BERSARANG dan BERULANG dihitung sebagai gabungan, bukan dijumlah dua kali', () => {
    // §9 handoff menyebut ini belum pernah dipikirkan. Yang benar adalah UNION
    // hari: [11,21) dengan [13,16) di dalamnya tetap 10 hari hold, bukan 13.
    const nilai = rp('31000000');
    const bersarang = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-11', selesai: '2026-01-21' }, { mulai: '2026-01-13', selesai: '2026-01-16' }],
    });
    invariant(bersarang, nilai);
    expect(bersarang.periode!.hariHold).toBe(10);
    expect(bersarang.periode!.akhirEksklusif).toBe('2026-02-11');

    // Dua hold terpisah menjumlah: [11,16) 5 hari + [20,23) 3 hari = 8.
    const berulang = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-11', selesai: '2026-01-16' }, { mulai: '2026-01-20', selesai: '2026-01-23' }],
    });
    invariant(berulang, nilai);
    expect(berulang.periode!.hariHold).toBe(8);
    // 31 hari aktif + 8 hari hold = hari ke-39 sejak 1 Jan, jadi hari aktif
    // terakhir 8 Feb dan batas eksklusifnya 9 Feb.
    expect(berulang.periode!.akhirEksklusif).toBe('2026-02-09');
  });

  it('hold yang TUMPANG-TINDIH SEPARUH juga gabungan: [11,21) + [15,25) = 14 hari, bukan 20', () => {
    // Cabang ketiga di samping bersarang dan berulang. Ia ada karena inilah
    // bentuk yang paling mungkin muncul dari data nyata: satu hold diinput,
    // lalu diperpanjang dengan baris kedua yang mulai sebelum yang pertama
    // selesai.
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-11', selesai: '2026-01-21' }, { mulai: '2026-01-15', selesai: '2026-01-25' }],
    });
    invariant(j, nilai);
    expect(j.periode!.hariHold).toBe(14);
    // 31 hari aktif + 14 hari hold = hari ke-45 sejak 1 Jan ⇒ batas 15 Feb.
    expect(j.periode!.akhirEksklusif).toBe('2026-02-15');
  });

  it('urutan hold di masukan tidak mengubah hasil — laporan yang sama dua kali', () => {
    const nilai = rp('31000000');
    const holds = [{ mulai: '2026-01-20', selesai: '2026-01-23' }, { mulai: '2026-01-11', selesai: '2026-01-16' }];
    const a = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode', tanggalMulai: '2026-01-01', durasiBulanTotal: 1, holds,
    });
    const b = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode', tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [...holds].reverse(),
    });
    expect(peta(a)).toEqual(peta(b));
    expect(a.periode).toEqual(b.periode);
  });

  it('hold yang MASIH BERJALAN memotong jadwal dan MENGATAKANNYA — sisanya belum, bukan hangus', () => {
    // D-2: skedul bergeser dan dihitung ulang saat hold selesai. Selama hold
    // belum selesai, tidak ada yang bisa tahu bulan mana yang akan dipakai
    // sisanya, jadi mesin berhenti di situ dan menandai jadwalnya terpotong.
    // Menebak tanggal selesai hold berarti menaruh angka karangan di laporan.
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-11', selesai: null }],
    });
    invariant(j, nilai);
    expect(j.terpotongHold).toBe(true);
    expect(j.periode!.akhirEksklusif).toBeNull();
    expect(peta(j)).toEqual({ '2026-01': '10000000.00' });
    expect(money.decimal(j.belumDiakui)).toBe('21000000.00');
    expect(j.hangus).toBe(0n);
  });

  it('hold yang sudah berjalan SEJAK hari mulai: nol baris, dan sebabnya bukan "belum mulai"', () => {
    // Bedanya penting bagi yang membacanya: "belum mulai jalan" ditindaklanjuti
    // dengan mengisi tanggal mulai, "hold sejak awal" dengan menutup hold-nya.
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-01', selesai: null }],
    });
    invariant(j, nilai);
    expect(j.alasanKosong).toBe('hold_sejak_awal');
    expect(j.terpotongHold).toBe(true);
    expect(j.belumDiakui).toBe(nilai);
    expect(j.hangus).toBe(0n);
  });

  it('jadwal tanpa hold berjalan TIDAK ditandai terpotong', () => {
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode', tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-11', selesai: '2026-01-21' }],
    });
    expect(j.terpotongHold).toBe(false);
  });

  it('hold SEBELUM tanggal mulai tidak menggeser apa pun', () => {
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2025-12-01', selesai: '2025-12-20' }],
    });
    invariant(j, nilai);
    expect(j.periode!.hariHold).toBe(0);
    expect(j.periode!.akhirEksklusif).toBe('2026-02-01');
  });

  it('void yang jatuh DI DALAM hold mengakui hanya hari aktif sebelum hold', () => {
    const nilai = rp('31000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-11', selesai: '2026-01-21' }], tanggalVoid: '2026-01-15',
    });
    invariant(j, nilai);
    expect(j.periode!.hariAktif).toBe(10);
    expect(peta(j)).toEqual({ '2026-01': '10000000.00' });
    expect(money.decimal(j.hangus)).toBe('21000000.00');
    // Sebuah void mengakhiri layanan: tidak ada lagi yang menunggu hold selesai.
    expect(j.terpotongHold).toBe(false);
  });

  it('menolak hold yang selesainya mendahului mulainya', () => {
    expect(() => accrual.jadwalkan({
      nilaiBruto: rp('31000000'), pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 1,
      holds: [{ mulai: '2026-01-21', selesai: '2026-01-11' }],
    })).toThrow(accrual.AccrualInputError);
  });
});

// ---------------------------------------------------------------------------
// saat_selesai
// ---------------------------------------------------------------------------
describe('pengakuan saat_selesai', () => {
  it('mengakui PENUH di bulan kalender saat layanan selesai (Jasa Pengajuan Shopee Mall)', () => {
    const nilai = rp('5000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'saat_selesai', tanggalSelesai: '2026-04-18',
    });
    invariant(j, nilai);
    expect(peta(j)).toEqual({ '2026-04': '5000000.00' });
    expect(j.periode).toBeNull();
  });

  it('belum selesai: nol diakui, seluruhnya BELUM, dan sebabnya disebut', () => {
    const nilai = rp('5000000');
    const j = accrual.jadwalkan({ nilaiBruto: nilai, pengakuan: 'saat_selesai' });
    invariant(j, nilai);
    expect(j.alasanKosong).toBe('belum_selesai');
    expect(j.belumDiakui).toBe(nilai);
    expect(j.hangus).toBe(0n);
  });

  it('di-void sebelum selesai: HANGUS seluruhnya — tidak ada hari yang bisa dipro-rata', () => {
    // D-1 memberi hak akui atas "hari yang sudah jalan"; layanan sekali-jadi
    // tidak punya hari yang berjalan, seluruh hak akuinya lahir saat selesai.
    // Void sebelum itu ⇒ nol, bukan separuh.
    const nilai = rp('5000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'saat_selesai', tanggalVoid: '2026-04-10',
    });
    invariant(j, nilai);
    expect(j.diakui).toBe(0n);
    expect(j.hangus).toBe(nilai);
    expect(j.alasanKosong).toBe('void_sebelum_selesai');
  });

  it('di-void SESUDAH selesai tidak menarik kembali pengakuannya', () => {
    const nilai = rp('5000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'saat_selesai',
      tanggalSelesai: '2026-04-18', tanggalVoid: '2026-05-02',
    });
    invariant(j, nilai);
    expect(peta(j)).toEqual({ '2026-04': '5000000.00' });
    expect(j.hangus).toBe(0n);
  });

  it('void PADA hari selesai menghanguskan — hari void adalah hari pertama yang tidak diakui', () => {
    const nilai = rp('5000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'saat_selesai',
      tanggalSelesai: '2026-04-18', tanggalVoid: '2026-04-18',
    });
    invariant(j, nilai);
    expect(j.hangus).toBe(nilai);
    expect(j.alasanKosong).toBe('void_sebelum_selesai');
  });

  it('mengabaikan durasi dan hold — keduanya tidak punya arti untuk layanan sekali jadi', () => {
    const nilai = rp('5000000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'saat_selesai', tanggalSelesai: '2026-04-18',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 6,
      holds: [{ mulai: '2026-02-01', selesai: null }],
    });
    invariant(j, nilai);
    expect(peta(j)).toEqual({ '2026-04': '5000000.00' });
    expect(j.terpotongHold).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bulan_berikutnya (Komisi)
// ---------------------------------------------------------------------------
describe('pengakuan bulan_berikutnya', () => {
  it('mengakui penuh SATU BULAN kalender sesudah bulan penjualannya', () => {
    const nilai = rp('2500000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'bulan_berikutnya', tanggalPenjualan: '2026-04-18',
    });
    invariant(j, nilai);
    expect(peta(j)).toEqual({ '2026-05': '2500000.00' });
  });

  it('menyeberang tahun dengan benar: penjualan Desember diakui Januari berikutnya', () => {
    const nilai = rp('2500000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'bulan_berikutnya', tanggalPenjualan: '2026-12-31',
    });
    invariant(j, nilai);
    expect(peta(j)).toEqual({ '2027-01': '2500000.00' });
  });

  it('tanpa tanggal penjualan: nol, seluruhnya BELUM, sebabnya disebut', () => {
    const nilai = rp('2500000');
    const j = accrual.jadwalkan({ nilaiBruto: nilai, pengakuan: 'bulan_berikutnya' });
    invariant(j, nilai);
    expect(j.alasanKosong).toBe('belum_ada_penjualan');
    expect(j.belumDiakui).toBe(nilai);
  });

  it('di-void sebelum bulan pengakuannya tiba: hangus', () => {
    const nilai = rp('2500000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'bulan_berikutnya',
      tanggalPenjualan: '2026-04-18', tanggalVoid: '2026-04-30',
    });
    invariant(j, nilai);
    expect(j.hangus).toBe(nilai);
    expect(j.alasanKosong).toBe('void_sebelum_diakui');
  });

  it('di-void SESUDAH bulan pengakuannya dimulai tidak menariknya kembali', () => {
    const nilai = rp('2500000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'bulan_berikutnya',
      tanggalPenjualan: '2026-04-18', tanggalVoid: '2026-05-02',
    });
    invariant(j, nilai);
    expect(peta(j)).toEqual({ '2026-05': '2500000.00' });
    expect(j.hangus).toBe(0n);
  });

  it('void PADA hari pertama bulan pengakuan menghanguskan — satu aturan untuk ketiga pengakuan', () => {
    // Aturan tunggalnya: sesuatu diakui kalau titik pengakuannya jatuh SEBELUM
    // tanggal void, karena tanggal void adalah hari PERTAMA yang tidak diakui.
    // Sama seperti hari ke-11 tidak diakui saat void 11 Januari, dan layanan
    // sekali-jadi tidak diakui saat void pada hari selesainya.
    const nilai = rp('2500000');
    const j = accrual.jadwalkan({
      nilaiBruto: nilai, pengakuan: 'bulan_berikutnya',
      tanggalPenjualan: '2026-04-18', tanggalVoid: '2026-05-01',
    });
    invariant(j, nilai);
    expect(j.hangus).toBe(nilai);
    expect(j.alasanKosong).toBe('void_sebelum_diakui');
  });
});

// ---------------------------------------------------------------------------
// Kosakata + gerbang masukan
// ---------------------------------------------------------------------------
describe('kosakata pengakuan', () => {
  it('tiga nilai, persis yang ditegakkan CHECK `ck_msv_pengakuan`', () => {
    expect([...accrual.PENGAKUAN_SEMUA]).toEqual(['per_periode', 'saat_selesai', 'bulan_berikutnya']);
  });

  it('setiap nilai punya kalimat Bahasa Indonesia untuk dipakai halaman apa adanya', () => {
    for (const p of accrual.PENGAKUAN_SEMUA) {
      expect(accrual.PENGAKUAN_KALIMAT[p].length).toBeGreaterThan(10);
    }
  });

  it('setiap alasan kosong punya kalimatnya — sebuah kode tanpa kalimat adalah halaman kosong yang bisu', () => {
    for (const a of accrual.ALASAN_SEMUA) {
      expect(accrual.ALASAN_KALIMAT[a].length).toBeGreaterThan(10);
    }
  });

  it('memisahkan alasan "belum diketahui" dari alasan "sudah diputus hangus"', () => {
    expect(accrual.belumDiketahui('belum_selesai')).toBe(true);
    expect(accrual.belumDiketahui('belum_mulai_jalan')).toBe(true);
    expect(accrual.belumDiketahui('belum_ada_penjualan')).toBe(true);
    expect(accrual.belumDiketahui('hold_sejak_awal')).toBe(true);
    expect(accrual.belumDiketahui('void_sebelum_mulai')).toBe(false);
    expect(accrual.belumDiketahui('void_sebelum_selesai')).toBe(false);
    expect(accrual.belumDiketahui('void_sebelum_diakui')).toBe(false);
  });

  it('menolak pengakuan di luar kosakata — bukan mendiamkannya jadi jadwal kosong', () => {
    expect(() => accrual.jadwalkan({
      nilaiBruto: rp('1000000'), pengakuan: 'bulanan' as never,
    })).toThrow(accrual.AccrualInputError);
  });

  it('menolak nilai bruto negatif — accrual tidak mengenal pendapatan minus', () => {
    expect(() => accrual.jadwalkan({
      nilaiBruto: rp('-1000000'), pengakuan: 'saat_selesai', tanggalSelesai: '2026-04-01',
    })).toThrow(accrual.AccrualInputError);
  });

  it('menolak tanggal yang bukan YYYY-MM-DD', () => {
    expect(() => accrual.jadwalkan({
      nilaiBruto: rp('1000000'), pengakuan: 'saat_selesai', tanggalSelesai: '18-04-2026',
    })).toThrow(accrual.AccrualInputError);
  });

  it('menolak durasi total yang bukan bilangan bulat positif', () => {
    for (const bad of [0, -3, 2.5]) {
      expect(() => accrual.jadwalkan({
        nilaiBruto: rp('1000000'), pengakuan: 'per_periode',
        tanggalMulai: '2026-01-01', durasiBulanTotal: bad,
      })).toThrow(accrual.AccrualInputError);
    }
  });

  it('nilai bruto nol tetap menghasilkan jadwal yang runtut, bukan galat', () => {
    // Terjadi nyata: `Komisi` yang belum diisi Sales bernilai 0 sampai angkanya
    // diketahui bulan depan. Nol adalah nilai yang sah, bukan data rusak.
    const j = accrual.jadwalkan({
      nilaiBruto: 0n, pengakuan: 'bulan_berikutnya', tanggalPenjualan: '2026-04-18',
    });
    invariant(j, 0n);
    expect(peta(j)).toEqual({ '2026-05': '0.00' });
  });
});

// ---------------------------------------------------------------------------
// Determinisme + total lintas cabang
// ---------------------------------------------------------------------------
describe('invariant lintas cabang', () => {
  it('nilaiBruto = diakui + hangus + belumDiakui untuk SETIAP kombinasi yang masuk akal', () => {
    const nilai = rp('37000000');
    const kasus: accrual.LayananTerbeli[] = [
      { nilaiBruto: nilai, pengakuan: 'per_periode', tanggalMulai: '2026-01-31', durasiBulanTotal: 3 },
      { nilaiBruto: nilai, pengakuan: 'per_periode', tanggalMulai: '2026-02-28', durasiBulanTotal: 12 },
      { nilaiBruto: nilai, pengakuan: 'per_periode', tanggalMulai: '2026-01-01', durasiBulanTotal: 6, tanggalVoid: '2026-03-17' },
      { nilaiBruto: nilai, pengakuan: 'per_periode', tanggalMulai: '2026-01-01', durasiBulanTotal: 6, holds: [{ mulai: '2026-02-01', selesai: '2026-03-01' }] },
      { nilaiBruto: nilai, pengakuan: 'per_periode', tanggalMulai: '2026-01-01', durasiBulanTotal: 6, holds: [{ mulai: '2026-02-01', selesai: null }] },
      { nilaiBruto: nilai, pengakuan: 'per_periode', durasiBulanTotal: 6 },
      { nilaiBruto: nilai, pengakuan: 'saat_selesai' },
      { nilaiBruto: nilai, pengakuan: 'saat_selesai', tanggalSelesai: '2026-07-01' },
      { nilaiBruto: nilai, pengakuan: 'saat_selesai', tanggalVoid: '2026-07-01' },
      { nilaiBruto: nilai, pengakuan: 'bulan_berikutnya' },
      { nilaiBruto: nilai, pengakuan: 'bulan_berikutnya', tanggalPenjualan: '2026-11-30' },
      { nilaiBruto: nilai, pengakuan: 'bulan_berikutnya', tanggalPenjualan: '2026-11-30', tanggalVoid: '2026-12-01' },
    ];
    for (const k of kasus) {
      invariant(accrual.jadwalkan(k), nilai);
    }
  });

  it('bulan-bulan terurut naik dan tidak pernah berulang — satu bulan satu baris', () => {
    // D-3 mengunci PER BULAN; dua baris untuk bulan yang sama berarti angka
    // yang dibekukan tergantung pada baris mana yang dibaca lebih dulu.
    const j = accrual.jadwalkan({
      nilaiBruto: rp('37000000'), pengakuan: 'per_periode',
      tanggalMulai: '2026-01-15', durasiBulanTotal: 12,
      holds: [{ mulai: '2026-03-01', selesai: '2026-04-01' }],
    });
    const bulan = j.baris.map((b) => b.bulan);
    expect(bulan).toEqual([...bulan].sort());
    expect(new Set(bulan).size).toBe(bulan.length);
  });

  it('dipanggil dua kali dengan masukan yang sama memberi hasil yang identik', () => {
    const inp: accrual.LayananTerbeli = {
      nilaiBruto: rp('37000000'), pengakuan: 'per_periode',
      tanggalMulai: '2026-01-31', durasiBulanTotal: 6,
      holds: [{ mulai: '2026-03-10', selesai: '2026-03-20' }],
    };
    expect(peta(accrual.jadwalkan(inp))).toEqual(peta(accrual.jadwalkan(inp)));
  });

  it('tidak mengubah masukannya — `holds` yang dikirim pemanggil tetap apa adanya', () => {
    // Mesin ini mengurutkan hold secara internal; kalau ia mengurut di tempat,
    // pemanggil yang menyimpan array itu untuk keperluan lain akan menemukannya
    // berubah tanpa sebab yang kelihatan.
    const holds = [{ mulai: '2026-03-10', selesai: '2026-03-20' }, { mulai: '2026-02-01', selesai: '2026-02-05' }];
    const salinan = JSON.parse(JSON.stringify(holds));
    accrual.jadwalkan({
      nilaiBruto: rp('37000000'), pengakuan: 'per_periode',
      tanggalMulai: '2026-01-01', durasiBulanTotal: 6, holds,
    });
    expect(holds).toEqual(salinan);
  });
});
