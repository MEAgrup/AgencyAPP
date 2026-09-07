/**
 * Tes mesin Showcase (Gelombang C). Yang diuji bukan "fungsinya jalan"
 * melainkan empat hal yang kalau salah baru ketahuan sesudah angka klien
 * terlanjur ada di materi pitch:
 *
 *   1. ambangnya persis batas SEHAT mesin laporan — bukan angka kedua;
 *   2. `skor = null` bukan `0` — laporan tak lengkap ≠ klien buruk;
 *   3. setiap yang tersisih membawa SEBAB yang tepat, bukan sekadar absen;
 *   4. urutannya deterministik — materi pitch yang di-export dua kali sama.
 */
import { describe, it, expect } from 'vitest';
import {
  AMBANG_MIN_PERIODE,
  AMBANG_SKOR_MIN,
  AMBANG_KALIMAT,
  ALASAN_KALIMAT,
  pilihKlienShowcase,
  renderPitchDoc,
  type KlienLaporan,
  type LaporanRingkas,
} from './showcase';
import { labelSkor } from './report/skor';

let seq = 0;
function lap(p: Partial<LaporanRingkas> & { skor: number | null }): LaporanRingkas {
  seq += 1;
  return {
    id: seq,
    periodeMulai: '2026-01-01',
    periodeAkhir: `2026-0${seq % 9 || 1}-28`,
    periodeTipe: 'bulanan',
    platform: 'TikTok Shop',
    skorLabel: p.skor === null ? null : p.skor >= 8 ? 'SEHAT' : p.skor >= 6 ? 'PERLU PERHATIAN' : 'KRITIS',
    gmvRunrateBulanan: 100_000_000,
    ...p,
  };
}

function klien(over: Partial<KlienLaporan>): KlienLaporan {
  return { clientId: 'CLI-202601-0001', toko: 'Klien', kategori: null, berizin: false, laporan: [], ...over };
}

/** Tiga laporan bulanan berurutan dengan skor & GMV yang ditentukan. */
function tigaPeriode(skor: number[], gmv: number[]): LaporanRingkas[] {
  return skor.map((s, i) =>
    lap({
      id: 100 + i,
      skor: s,
      gmvRunrateBulanan: gmv[i],
      periodeMulai: `2026-0${i + 1}-01`,
      periodeAkhir: `2026-0${i + 1}-28`,
    }),
  );
}

describe('ambang Showcase (C-4)', () => {
  it('AMBANG_SKOR_MIN adalah batas bawah pita SEHAT mesin laporan — dibaca dari mesinnya', () => {
    // Dipanggil lewat `labelSkor`, fungsi yang SAMA yang menstempel
    // `client_reports.skor_label`. Kalau pita itu dikalibrasi ulang suatu hari,
    // tes ini yang memerah lebih dulu — bukan seorang Sales yang menemukan
    // klien berlabel PERLU PERHATIAN di dalam materi pitch.
    expect(labelSkor(AMBANG_SKOR_MIN)).toBe('SEHAT');
    expect(labelSkor(AMBANG_SKOR_MIN - 0.1)).not.toBe('SEHAT');
  });

  it('kalimat ambang menyebut kedua angkanya, supaya halaman tak perlu mengarang', () => {
    expect(AMBANG_KALIMAT).toContain('8,0');
    expect(AMBANG_KALIMAT).toContain(String(AMBANG_MIN_PERIODE));
  });
});

describe('pilihKlienShowcase — yang lolos', () => {
  it('tiga periode ber-skor dengan skor terakhir di ambang ⇒ lolos', () => {
    const h = pilihKlienShowcase([
      klien({ laporan: tigaPeriode([8.2, 8.4, 8.0], [100, 120, 150]) }),
    ]);
    expect(h.klien).toHaveLength(1);
    expect(h.tersisih).toHaveLength(0);
    expect(h.klien[0].periodeDinilai).toBe(3);
    expect(h.klien[0].skorTerakhir).toBe(8.0);
  });

  it('tren dihitung dari laporan ber-skor PERTAMA ke TERAKHIR, bukan dua yang kebetulan berdekatan', () => {
    const h = pilihKlienShowcase([
      klien({ laporan: tigaPeriode([8.0, 9.0, 8.5], [100, 500, 200]) }),
    ]);
    const k = h.klien[0];
    expect(k.trenSkor).toEqual({ awal: 8.0, akhir: 8.5, delta: (8.5 - 8.0) / 8.0 });
    expect(k.trenGmv).toEqual({ awal: 100, akhir: 200, delta: 1 });
  });

  it('GMV awal nol ⇒ delta null, bukan Infinity (aturan rumah #7)', () => {
    const h = pilihKlienShowcase([
      klien({ laporan: tigaPeriode([8.1, 8.2, 8.3], [0, 50, 200]) }),
    ]);
    expect(h.klien[0].trenGmv.delta).toBeNull();
    expect(h.klien[0].trenGmv.akhir).toBe(200);
  });

  it('laporan datang tak berurutan ⇒ tetap diurut periode, bukan urutan array', () => {
    const rows = tigaPeriode([8.9, 8.1, 8.5], [100, 200, 300]);
    const h = pilihKlienShowcase([klien({ laporan: [rows[2], rows[0], rows[1]] })]);
    // periode 1 = skor 8.9, periode 3 = skor 8.5 ⇒ tren turun walau array-nya acak
    expect(h.klien[0].trenSkor).toEqual({ awal: 8.9, akhir: 8.5, delta: (8.5 - 8.9) / 8.9 });
    expect(h.klien[0].periodeAkhir).toBe('2026-03-28');
  });

  it('platform dikumpulkan unik dan terurut, bukan diulang per laporan', () => {
    const rows = tigaPeriode([8.1, 8.2, 8.3], [10, 20, 30]);
    rows[0].platform = 'Shopee';
    rows[1].platform = 'TikTok Shop';
    rows[2].platform = 'Shopee';
    const h = pilihKlienShowcase([klien({ laporan: rows })]);
    expect(h.klien[0].platform).toEqual(['Shopee', 'TikTok Shop']);
  });
});

describe('pilihKlienShowcase — yang tersisih membawa SEBABNYA', () => {
  it('nol laporan ⇒ belum_ada_laporan (bukan skor_kurang)', () => {
    const h = pilihKlienShowcase([klien({ laporan: [] })]);
    expect(h.klien).toHaveLength(0);
    expect(h.tersisih[0].alasan).toBe('belum_ada_laporan');
    expect(h.tersisih[0].skorTerakhir).toBeNull();
  });

  it('laporan ada tapi semua skornya null ⇒ laporan_belum_berskor, BUKAN skor 0', () => {
    const h = pilihKlienShowcase([
      klien({ laporan: [lap({ skor: null }), lap({ skor: null }), lap({ skor: null })] }),
    ]);
    expect(h.tersisih[0].alasan).toBe('laporan_belum_berskor');
    expect(h.tersisih[0].periodeBerskor).toBe(0);
    expect(h.tersisih[0].skorTerakhir).toBeNull();
  });

  it('laporan tanpa skor TIDAK ikut memenuhi kuota periode', () => {
    // Dua ber-skor bagus + dua tanpa skor = 4 laporan, tapi hanya 2 yang menghitung.
    const h = pilihKlienShowcase([
      klien({
        laporan: [
          lap({ skor: 9.0, periodeAkhir: '2026-01-28' }),
          lap({ skor: null, periodeAkhir: '2026-02-28' }),
          lap({ skor: null, periodeAkhir: '2026-03-28' }),
          lap({ skor: 9.5, periodeAkhir: '2026-04-28' }),
        ],
      }),
    ]);
    expect(h.klien).toHaveLength(0);
    expect(h.tersisih[0].alasan).toBe('periode_kurang');
    expect(h.tersisih[0].periodeBerskor).toBe(2);
  });

  it('skor tinggi tapi baru dua periode ⇒ periode_kurang', () => {
    const h = pilihKlienShowcase([
      klien({ laporan: [lap({ skor: 9.9, periodeAkhir: '2026-01-28' }), lap({ skor: 9.8, periodeAkhir: '2026-02-28' })] }),
    ]);
    expect(h.tersisih[0].alasan).toBe('periode_kurang');
    expect(h.tersisih[0].skorTerakhir).toBe(9.8);
  });

  it('cukup periode tapi skor terakhir di bawah ambang ⇒ skor_kurang', () => {
    const h = pilihKlienShowcase([klien({ laporan: tigaPeriode([9.0, 9.0, 7.9], [10, 20, 30]) })]);
    expect(h.tersisih[0].alasan).toBe('skor_kurang');
    expect(h.tersisih[0].skorTerakhir).toBe(7.9);
  });

  it('yang dinilai adalah skor TERAKHIR, bukan yang terbaik — klien yang jatuh tidak dipamerkan', () => {
    const h = pilihKlienShowcase([klien({ laporan: tigaPeriode([9.8, 9.5, 6.0], [500, 400, 100]) })]);
    expect(h.klien).toHaveLength(0);
    expect(h.tersisih[0].alasan).toBe('skor_kurang');
  });

  it('setiap alasan punya kalimat Bahasa Indonesia yang halaman bisa tampilkan apa adanya', () => {
    for (const a of ['belum_ada_laporan', 'laporan_belum_berskor', 'periode_kurang', 'skor_kurang'] as const) {
      expect(ALASAN_KALIMAT[a].length).toBeGreaterThan(0);
      expect(ALASAN_KALIMAT[a]).not.toMatch(/undefined|NaN/);
    }
    expect(ALASAN_KALIMAT.skor_kurang).toContain('8,0');
    expect(ALASAN_KALIMAT.periode_kurang).toContain('3');
  });
});

describe('pilihKlienShowcase — izin (C-3) TIDAK disaring di sini', () => {
  it('klien tanpa izin tetap lolos ambang; `berizin` diteruskan apa adanya', () => {
    // Penyaringnya domain, per pemirsa: Account harus melihat kliennya sendiri
    // supaya tahu izin mana yang perlu diminta; Sales hanya yang berizin.
    const h = pilihKlienShowcase([klien({ berizin: false, laporan: tigaPeriode([8.5, 8.6, 8.7], [10, 20, 30]) })]);
    expect(h.klien).toHaveLength(1);
    expect(h.klien[0].berizin).toBe(false);
  });
});

describe('urutan hasil deterministik', () => {
  it('skor turun, lalu GMV turun, lalu clientId naik', () => {
    const h = pilihKlienShowcase([
      klien({ clientId: 'CLI-B', toko: 'B', laporan: tigaPeriode([8.1, 8.1, 8.5], [10, 20, 300]) }),
      klien({ clientId: 'CLI-A', toko: 'A', laporan: tigaPeriode([8.1, 8.1, 8.5], [10, 20, 300]) }),
      klien({ clientId: 'CLI-C', toko: 'C', laporan: tigaPeriode([8.1, 8.1, 9.0], [10, 20, 100]) }),
      klien({ clientId: 'CLI-D', toko: 'D', laporan: tigaPeriode([8.1, 8.1, 8.5], [10, 20, 900]) }),
    ]);
    expect(h.klien.map((k) => k.clientId)).toEqual(['CLI-C', 'CLI-D', 'CLI-A', 'CLI-B']);
  });

  it('dipanggil dua kali atas masukan yang sama ⇒ hasil byte-identik (materi pitch tak boleh berubah)', () => {
    const masukan = [
      klien({ clientId: 'CLI-X', laporan: tigaPeriode([8.2, 8.2, 8.2], [10, 20, 30]) }),
      klien({ clientId: 'CLI-Y', laporan: tigaPeriode([8.2, 8.2, 8.2], [10, 20, 30]) }),
    ];
    expect(JSON.stringify(pilihKlienShowcase(masukan))).toBe(JSON.stringify(pilihKlienShowcase(masukan)));
  });

  it('ambang ikut dibawa di hasil, supaya halaman tak menyimpan salinan angkanya sendiri', () => {
    const h = pilihKlienShowcase([]);
    expect(h.ambang).toEqual({
      skorMin: AMBANG_SKOR_MIN,
      minPeriode: AMBANG_MIN_PERIODE,
      kalimat: AMBANG_KALIMAT,
      sumber: expect.stringContaining('C-4'),
    });
  });
});

describe('renderPitchDoc — dokumen yang meninggalkan gedung', () => {
  const opts = { dibuatOleh: 'Rani (AM)', dibuatPada: '2026-09-07' };
  const contoh = (over: Partial<KlienLaporan> = {}) =>
    pilihKlienShowcase([klien({ toko: 'Toko Alpha', kategori: 'Home Living', laporan: tigaPeriode([8.1, 8.4, 8.8], [100_000_000, 150_000_000, 240_000_000]), ...over })]).klien;

  it('merender klien yang diberikan, dengan format IDR rumah (aturan rumah #7)', () => {
    const html = renderPitchDoc(contoh(), opts);
    expect(html).toContain('Toko Alpha');
    expect(html).toContain('Rp. 240.000.000,00');
    expect(html).toContain('Rp. 100.000.000,00');
    expect(html).toContain('+140%');
    expect(html).toContain('Rani (AM)');
    expect(html).toContain('2026-09-07');
  });

  it('nol klien ⇒ dokumen tetap sah dan MENGATAKAN sebabnya, bukan tabel kosong', () => {
    const html = renderPitchDoc([], opts);
    expect(html).toContain('Belum ada klien yang memenuhi ambang');
    expect(html).toContain(AMBANG_KALIMAT);
    expect(html).not.toContain('<tbody>');
  });

  it('mandiri: nol aset eksternal — tak ada yang diminta dari jaringan saat calon klien membukanya', () => {
    const html = renderPitchDoc(contoh(), opts);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });

  it('nama toko ber-HTML di-escape, tidak diteruskan sebagai markup', () => {
    const html = renderPitchDoc(contoh({ toko: 'Toko <script>x</script> & Co' }), opts);
    expect(html).toContain('Toko &lt;script&gt;x&lt;/script&gt; &amp; Co');
    expect(html).not.toContain('<script>x</script>');
  });

  it('menyebut sendiri bahwa isinya hanya klien ber-izin — dokumen ini dibaca orang luar', () => {
    expect(renderPitchDoc(contoh(), opts)).toContain('telah memberikan izin');
  });

  it('GMV awal nol ⇒ `—`, bukan Infinity atau NaN di dokumen yang dikirim keluar', () => {
    const k = pilihKlienShowcase([klien({ laporan: tigaPeriode([8.1, 8.2, 8.3], [0, 50_000_000, 90_000_000]) })]).klien;
    const html = renderPitchDoc(k, opts);
    expect(html).toContain('—');
    expect(html).not.toMatch(/Infinity|NaN/);
  });
});
