/**
 * B4 — tes mesin aturan AM Co-Pilot yang dipindah ke server.
 *
 * Dua hal yang dijaga paling ketat, karena keduanya keputusan yang dibaca
 * manusia dan dipakai menaikkan tier klien:
 *
 *  1. `verdict` HARUS memisahkan **TIDAK DIKERJAKAN** dari **GAGAL**. Menukar
 *     dua itu berarti melaporkan taktik yang tak pernah dijalankan sebagai
 *     taktik yang terbukti gagal — dan itu menghapus satu-satunya sinyal yang
 *     membedakan masalah tim dari masalah strategi.
 *  2. `skor` tidak boleh mengembalikan 0% MELESET saat pembaginya nol/absen.
 *     Floor yang belum diisi bukan toko yang meleset (aturan rumah #7).
 */
import { describe, expect, it } from 'vitest';
import {
  ANGLE_MAKS,
  ATURAN_TERKUNCI,
  COPILOT_CONFIG_V1,
  KATALOG,
  PILAR_KE_JENIS,
  bacaMetrik,
  bulat,
  peringkatAngleVideo,
  saranD5,
  skalaAmbisi,
  skor,
  susunUsulan,
  verdict,
} from './copilot';

// ── verdict ─────────────────────────────────────────────────────────────────

const AKSI_NAIK = { mingguJalan: 4, rencana: 10, realisasi: 10, arah: 'naik' as const };

describe('verdict — memisahkan kegagalan eksekusi dari kegagalan taktik', () => {
  it('eksekusi di bawah separuh rencana ⇒ TIDAK DIKERJAKAN, bukan GAGAL', () => {
    const v = verdict({ ...AKSI_NAIK, realisasi: 4, sebelum: 100, sekarang: 100, target: 130 });
    expect(v.verdict).toBe('TIDAK DIKERJAKAN');
    expect(v.alasan).toContain('kegagalan eksekusi');
  });

  it('eksekusi persis di ambang (50%) TIDAK dihitung sebagai tidak dikerjakan', () => {
    const v = verdict({ ...AKSI_NAIK, realisasi: 5, sebelum: 100, sekarang: 100, target: 130 });
    expect(v.verdict).not.toBe('TIDAK DIKERJAKAN');
  });

  it('rencana 0 tapi ada realisasi ⇒ dianggap dikerjakan penuh (bukan dibagi nol)', () => {
    const v = verdict({ ...AKSI_NAIK, rencana: 0, realisasi: 3, sebelum: 100, sekarang: 200, target: 130 });
    expect(v.verdict).toBe('BERHASIL');
  });

  it('belum 2 minggu ⇒ JALAN, apa pun angkanya', () => {
    const v = verdict({ ...AKSI_NAIK, mingguJalan: 1, sebelum: 100, sekarang: 10, target: 130 });
    expect(v.verdict).toBe('JALAN');
    expect(v.alasan).toContain('dinilai setelah 2 minggu');
  });

  it('angka jembatan belum lengkap ⇒ BELUM CUKUP DATA, bukan GAGAL', () => {
    expect(verdict({ ...AKSI_NAIK, sebelum: null, sekarang: 120, target: 130 }).verdict).toBe('BELUM CUKUP DATA');
    expect(verdict({ ...AKSI_NAIK, sebelum: 100, sekarang: null, target: 130 }).verdict).toBe('BELUM CUKUP DATA');
  });

  it('melewati target ⇒ BERHASIL (arah naik dan arah turun)', () => {
    expect(verdict({ ...AKSI_NAIK, sebelum: 100, sekarang: 140, target: 130 }).verdict).toBe('BERHASIL');
    expect(
      verdict({ ...AKSI_NAIK, arah: 'turun', sebelum: 100, sekarang: 60, target: 70 }).verdict,
    ).toBe('BERHASIL');
  });

  it('bergerak ≥15% ke arah benar tapi belum sampai target ⇒ BERHASIL SEBAGIAN', () => {
    const v = verdict({ ...AKSI_NAIK, sebelum: 100, sekarang: 118, target: 130 });
    expect(v.verdict).toBe('BERHASIL SEBAGIAN');
  });

  it('tidak bergerak / bergerak mundur ⇒ GAGAL', () => {
    expect(verdict({ ...AKSI_NAIK, sebelum: 100, sekarang: 100, target: 130 }).verdict).toBe('GAGAL');
    expect(verdict({ ...AKSI_NAIK, sebelum: 100, sekarang: 80, target: 130 }).verdict).toBe('GAGAL');
    expect(verdict({ ...AKSI_NAIK, sebelum: 100, sekarang: 103, target: 130 }).verdict).toBe('GAGAL');
  });

  it('gerakan antara 5% dan 15% ⇒ BELUM CUKUP DATA (belum meyakinkan)', () => {
    expect(verdict({ ...AKSI_NAIK, sebelum: 100, sekarang: 110, target: 130 }).verdict).toBe('BELUM CUKUP DATA');
  });

  it('ambang datang dari config — mengubahnya tidak menulis ulang penilaian lama', () => {
    const longgar = { ...COPILOT_CONFIG_V1, gerakBerhasilSebagianPersen: 5 };
    const input = { ...AKSI_NAIK, sebelum: 100, sekarang: 110, target: 130 };
    expect(verdict(input).verdict).toBe('BELUM CUKUP DATA');
    expect(verdict(input, longgar).verdict).toBe('BERHASIL SEBAGIAN');
  });
});

// ── skor ────────────────────────────────────────────────────────────────────

describe('skor — run-rate GMV vs floor kontrak', () => {
  it('memproyeksikan run-rate dari hari berjalan ke hari dalam bulan', () => {
    // 15 hari, 50jt ⇒ run-rate 50/15×31 = 103,33jt di Agustus (31 hari).
    const s = skor({ gmvBulanBerjalan: 50_000_000, floor: 100_000_000, tanggalData: '2026-08-15' });
    expect(s.hariBerjalan).toBe(15);
    expect(s.hariDalamBulan).toBe(31);
    expect(Math.round(s.runRate!)).toBe(103_333_333);
    expect(s.status).toBe('AMAN');
  });

  it('≥95% AMAN · 75–94% TIPIS · <75% MELESET', () => {
    const f = (gmv: number) =>
      skor({ gmvBulanBerjalan: gmv, floor: 100_000_000, tanggalData: '2026-06-30' }).status;
    expect(f(95_000_000)).toBe('AMAN');
    expect(f(80_000_000)).toBe('TIPIS');
    expect(f(74_000_000)).toBe('MELESET');
  });

  it('floor 0 / absen ⇒ BELUM DAPAT DINILAI, bukan 0% MELESET', () => {
    expect(skor({ gmvBulanBerjalan: 50_000_000, floor: 0, tanggalData: '2026-08-15' }).status).toBe(
      'BELUM DAPAT DINILAI',
    );
    expect(skor({ gmvBulanBerjalan: 50_000_000, floor: null, tanggalData: '2026-08-15' }).persenFloor).toBeNull();
  });

  it('tanggal absen / tak valid ⇒ tidak ada run-rate', () => {
    expect(skor({ gmvBulanBerjalan: 5, floor: 10, tanggalData: null }).runRate).toBeNull();
    expect(skor({ gmvBulanBerjalan: 5, floor: 10, tanggalData: 'bukan-tanggal' }).runRate).toBeNull();
  });

  it('tahun kabisat dihitung benar (Februari 2028 = 29 hari)', () => {
    expect(skor({ gmvBulanBerjalan: 1, floor: 1, tanggalData: '2028-02-10' }).hariDalamBulan).toBe(29);
  });
});

// ── angle video ─────────────────────────────────────────────────────────────

const VIDEO = [
  { judul: 'B unboxing', akun: 'toko.a', gmv: 5_000_000, gpm: 80_000, vv: 60_000, tuntas: 0.3, ctr: 0.02 },
  { judul: 'A tutorial', akun: 'toko.a', gmv: 9_000_000, gpm: 120_000, vv: 75_000, tuntas: 0.42, ctr: 0.051 },
  { judul: 'C review', akun: 'kreator.z', gmv: 1_000_000, gpm: 20_000, vv: 50_000, tuntas: 0.1, ctr: 0.01 },
];

describe('peringkatAngleVideo — jangkar GPM, penguat tuntas + CTR', () => {
  it('mengurutkan dari yang paling menjual per 1.000 views', () => {
    const a = peringkatAngleVideo(VIDEO);
    expect(a.map((x) => x.judul)).toEqual(['A tutorial', 'B unboxing', 'C review']);
  });

  it('video tanpa GPM dibuang — tanpa jangkar tidak ada dasar memeringkat', () => {
    const a = peringkatAngleVideo([...VIDEO, { judul: 'D tanpa gpm', gmv: 99_000_000, vv: 1 }]);
    expect(a.map((x) => x.judul)).not.toContain('D tanpa gpm');
  });

  it('seri diputus GMV desc lalu judul asc — urutannya total dan stabil', () => {
    const seri = [
      { judul: 'Zeta', gpm: 100, gmv: 10, tuntas: 0, ctr: 0 },
      { judul: 'Alfa', gpm: 100, gmv: 10, tuntas: 0, ctr: 0 },
      { judul: 'Mega', gpm: 100, gmv: 50, tuntas: 0, ctr: 0 },
    ];
    expect(peringkatAngleVideo(seri).map((x) => x.judul)).toEqual(['Mega', 'Alfa', 'Zeta']);
  });

  it(`maksimal ${ANGLE_MAKS} angle`, () => {
    const banyak = Array.from({ length: 10 }, (_, i) => ({ judul: `V${i}`, gpm: 100 - i, gmv: 1 }));
    expect(peringkatAngleVideo(banyak)).toHaveLength(ANGLE_MAKS);
  });

  it('ringkasan disusun dari angka asli lewat template tetap ⇒ byte-identik', () => {
    const sekali = peringkatAngleVideo(VIDEO);
    const dua = peringkatAngleVideo(VIDEO);
    expect(dua).toEqual(sekali);
    expect(sekali[0].ringkas).toBe(
      'A tutorial — GPM Rp. 120.000,00 · tuntas 42,0% · CTR 5,1% · GMV Rp. 9.000.000,00 · 75.000 views (akun toko.a)',
    );
  });

  it('bukan array / kosong ⇒ daftar kosong, bukan lemparan', () => {
    expect(peringkatAngleVideo(undefined)).toEqual([]);
    expect(peringkatAngleVideo('x')).toEqual([]);
    expect(peringkatAngleVideo([])).toEqual([]);
  });

  it('nilai penguat yang absen tidak menghukum video itu', () => {
    const a = peringkatAngleVideo([
      { judul: 'Tanpa penguat', gpm: 200, gmv: 1 },
      { judul: 'Dengan penguat', gpm: 100, gmv: 1, tuntas: 0.5, ctr: 0.1 },
    ]);
    expect(a[0].judul).toBe('Tanpa penguat');
    expect(a[0].tuntas).toBeNull();
  });
});

// ── katalog ─────────────────────────────────────────────────────────────────

describe('KATALOG — 4 pilar × 20 aksi', () => {
  it('membawa 20 aksi dengan kode unik', () => {
    expect(KATALOG).toHaveLength(20);
    expect(new Set(KATALOG.map((a) => a.kode)).size).toBe(20);
  });

  it('setiap pilar memetakan ke satu `strategi_pillar.jenis` yang sah', () => {
    expect(PILAR_KE_JENIS).toEqual({ VIDEO: 'konten', LIVE: 'live', AFFILIATE: 'affiliate', ADS: 'iklan' });
    for (const a of KATALOG) expect(PILAR_KE_JENIS[a.pilar]).toBeTruthy();
  });

  it('aturan MEA terkunci dikutip apa adanya (D1 15%, A3 30%)', () => {
    expect(ATURAN_TERKUNCI.D1.nilai).toBe(15);
    expect(ATURAN_TERKUNCI.A3.nilai).toBe(30);
  });

  it('skala ambisi naik bersama lama aksi terlihat hasilnya', () => {
    expect([1, 2, 3, 4, 6].map(skalaAmbisi)).toEqual([15, 15, 25, 30, 40]);
  });

  it('bulat() memakai tangga pembulatan tool', () => {
    expect(bulat(1_234_567)).toBe(1_200_000);
    expect(bulat(12_345)).toBe(12_000);
    expect(bulat(1_234)).toBe(1_250);
    expect(bulat(123)).toBe(120);
    expect(bulat(12.4)).toBe(12);
    expect(bulat(1.23)).toBe(1.2);
    expect(bulat(null)).toBeNull();
  });
});

// ── susunUsulan ─────────────────────────────────────────────────────────────

/** Benchmark v1 yang engine baseline catat di payload. */
const BENCH = {
  cr: 2, refund: 5, vidPostToko: 20, vidSalesToko: 25, vidSalesAff: 20, gpmToko: 30_000,
  liveSesi: 12, liveJam: 40, liveGmvJam: 1_000_000, liveCtor: 3, krSales: 30, krKonsen: 40,
  skuSales: 40, roas: 4, adsDep: 30, spikeFlag: 2,
};

/** Toko lemah di semua pilar — hampir setiap pemicu menyala. */
const PAYLOAD_LEMAH = {
  schema: 'cdps.baseline.tiktok.v1',
  klien: { periode_referensi: 'Agu 2026' },
  benchmark_versi: 1,
  benchmark_dipakai: BENCH,
  toko: { konversi: 0.009 },
  produk: { rate: 0.2 },
  iklan: { roas: 2.1, setara_persen_gmv: 0.42 },
  afiliasi: { kreator_total: 90, kreator_posting: 37, rate_dari_posting: 0.12, top5_share: 0.65, sampel_terkirim: 0 },
  video: {
    toko: { diposting_periode: 8, rate: 0.1, gpm_median: 11_000 },
    afiliasi: { rate: 0.05 },
    top_video: VIDEO,
  },
  live: { toko: { sesi: 3, jam: 9, gmv_per_jam: 250_000, ctor_median: 0.011 } },
  skor: { pilar: { gmv: 55, video: 21, live: 12, aff: 44, prod: 38 } },
};

describe('susunUsulan — Section E disusun di server, tanpa export/tempel', () => {
  const u = susunUsulan(PAYLOAD_LEMAH);

  it('membaca schema, periode, dan versi benchmark payload', () => {
    expect(u.schema).toBe('cdps.baseline.tiktok.v1');
    expect(u.periodeReferensi).toBe('Agu 2026');
    expect(u.benchmarkVersi).toBe(1);
    expect(u.payloadTerbaca).toBe(true);
  });

  it('mengusulkan aksi hanya saat pemicunya menyala', () => {
    const kode = u.pilar.flatMap((p) => p.aksi.map((a) => a.kode));
    // Menyala: semua metrik toko ini di bawah benchmark.
    for (const k of ['V1', 'V2', 'V4', 'V5', 'V6', 'L1', 'L2', 'L3', 'L4', 'A1', 'A2', 'A3', 'A4', 'A5', 'D1', 'D2', 'D3', 'D4']) {
      expect(kode).toContain(k);
    }
    // D5 hanya menyala saat ROAS SUDAH di atas benchmark — di sini tidak.
    expect(kode).not.toContain('D5');
  });

  it('mengurutkan pilar dari skor baseline terlemah', () => {
    expect(u.pilar.map((p) => p.pilar)).toEqual(['LIVE', 'VIDEO', 'ADS', 'AFFILIATE']);
    expect(u.pilar.map((p) => p.urutan)).toEqual([1, 2, 3, 4]);
    expect(u.pilar[0].label).toBe('Pilar 1 — LIVE');
  });

  it('alasan tiap aksi menyebut angka asli dan ambangnya', () => {
    const v2 = u.pilar.flatMap((p) => p.aksi).find((a) => a.kode === 'V2')!;
    expect(v2.alasan).toContain('videoPostToko');
    expect(v2.alasan).toContain('di bawah');
    expect(v2.alasan).toContain('benchmark vidPostToko');
  });

  it('target dihitung dari angka sekarang, diskalakan ke lama aksi', () => {
    const l1 = u.pilar.flatMap((p) => p.aksi).find((a) => a.kode === 'L1')!;
    expect(l1.nilaiSekarang).toBe(9);
    // 4 minggu ⇒ ambisi 30% ⇒ 11,7 ⇒ bulat() → 12
    expect(l1.targetHitung).toBe(12);
    expect(l1.target).toContain('dalam 4 minggu');
  });

  it('aksi tanpa angka jembatan di payload mengatakannya, bukan menargetkan 0', () => {
    const d1 = u.pilar.flatMap((p) => p.aksi).find((a) => a.kode === 'D1')!;
    expect(d1.nilaiSekarang).toBeNull();
    expect(d1.targetHitung).toBeNull();
    expect(d1.target).toContain('belum ada di payload');
  });

  it('standar MEA terkunci ditawarkan berdampingan, dan dilaporkan bila sudah terlampaui', () => {
    const a3 = u.pilar.flatMap((p) => p.aksi).find((a) => a.kode === 'A3')!;
    expect(a3.aturanTerkunci!.nilai).toBe(30);
    // konsentrasi 65% masih di atas 30% ⇒ belum terlampaui (arah turun).
    expect(a3.aturanTerkunci!.sudahTerlampaui).toBe(false);
  });

  it('V3 membawa angle video yang sudah terbukti menjual', () => {
    const v3 = u.pilar.flatMap((p) => p.aksi).find((a) => a.kode === 'V3')!;
    expect(v3.angle).toHaveLength(3);
    expect(v3.angle[0].judul).toBe('A tutorial');
    expect(v3.catatan).toBeNull();
  });

  it('deterministik — dua kali susun dari payload sama ⇒ identik', () => {
    expect(susunUsulan(PAYLOAD_LEMAH)).toEqual(u);
  });
});

describe('susunUsulan — apa yang TIDAK bisa diusulkan, dikatakan', () => {
  it('payload manual / lama ⇒ nol usulan + kalimat jujur', () => {
    const u = susunUsulan({ schema: 'cdps.baseline.manual.v1', manual: { gmv_bulan: 5_000_000 } });
    expect(u.payloadTerbaca).toBe(false);
    expect(u.pilar).toEqual([]);
    expect(u.catatan.join(' ')).toContain('tidak memuat blok analisa');
  });

  it('payload tanpa benchmark ⇒ aksi berambang benchmark tidak diusulkan, dan itu dikatakan', () => {
    const { benchmark_dipakai: _lepas, ...tanpaBench } = PAYLOAD_LEMAH;
    const u = susunUsulan(tanpaBench);
    const kode = u.pilar.flatMap((p) => p.aksi.map((a) => a.kode));
    expect(kode).not.toContain('V1');
    // A2/A4 ambangnya bukan benchmark (kreator belum posting > 0, sampel = 0).
    expect(kode).toContain('A2');
    expect(kode).toContain('A4');
    expect(u.catatan.join(' ')).toContain('tidak mencatat benchmark');
    expect(u.catatan.join(' ')).toContain('bukan berarti tokonya sehat');
  });

  it('metrik yang absen tidak menyalakan pemicu (absen ≠ nol)', () => {
    const u = susunUsulan({ benchmark_dipakai: BENCH, toko: {}, video: { toko: {} } });
    // Tanpa angka, tidak ada aksi VIDEO yang diusulkan — bukan "0 < benchmark".
    expect(u.pilar.flatMap((p) => p.aksi.map((a) => a.kode))).toEqual([]);
  });

  it('payload tanpa top_video ⇒ pilar konten tetap disusun, TANPA blok angle, dan mengatakannya', () => {
    const tanpaAngle = {
      ...PAYLOAD_LEMAH,
      video: { toko: PAYLOAD_LEMAH.video.toko, afiliasi: PAYLOAD_LEMAH.video.afiliasi },
    };
    const u = susunUsulan(tanpaAngle);
    const konten = u.pilar.find((p) => p.pilar === 'VIDEO')!;
    expect(konten.aksi.length).toBeGreaterThan(0);
    expect(konten.aksi.map((a) => a.kode)).not.toContain('V3');
    expect(u.catatan.join(' ')).toContain('tanpa blok angle video');
  });

  it('toko sehat di iklan ⇒ D5 (naikkan mode) yang diusulkan, bukan D1–D3', () => {
    const sehat = {
      benchmark_dipakai: BENCH,
      iklan: { roas: 6.2, setara_persen_gmv: 0.11 },
      skor: { pilar: { prod: 80 } },
    };
    const kode = susunUsulan(sehat).pilar.flatMap((p) => p.aksi.map((a) => a.kode));
    expect(kode).toEqual(['D5']);
  });
});

describe('bacaMetrik', () => {
  it('membaca pecahan payload jadi persen, sesuai satuan benchmark', () => {
    const m = bacaMetrik(PAYLOAD_LEMAH);
    expect(m.crToko).toBeCloseTo(0.9, 6);
    expect(m.krKonsen).toBeCloseTo(65, 6);
    expect(m.kreatorBelumPosting).toBe(53);
  });

  it('blok absen ⇒ semua metriknya null', () => {
    const m = bacaMetrik({});
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });
});

describe('saranD5', () => {
  it('menyusun horizon 30/60/90 dari jembatan aksi terpilih', () => {
    const s = saranD5({ kodeAksi: ['L4', 'D3'], channel: 'TikTok Shop', floor: 100_000_000, stretch: 150_000_000 });
    expect(s.h30).toContain('Quick win jalan: Flash deal terjadwal');
    expect(s.h60).toContain('GMV TikTok Shop mendekati floor Rp. 100.000.000,00');
    expect(s.h90).toContain('stretch Rp. 150.000.000,00');
  });

  it('tanpa aksi / tanpa floor tetap kalimat yang sah', () => {
    const s = saranD5({ kodeAksi: [], channel: 'Shopee', floor: null, stretch: null });
    expect(s.h30).toContain('baseline stabil');
    expect(s.h60).toContain('floor kontrak');
    expect(s.h90).toContain('target D-2');
  });
});
