import { describe, expect, it } from 'vitest';
import { klasifikasikanKuadranSkuTiktok, KLIK_MIN_UJI, type PdtBenchmarkKuadranTiktok } from './kuadran';

const BENCH: PdtBenchmarkKuadranTiktok = {
  quad_klik: { good: 150, warn: 25 },
  quad_cvr: { good: 0.015, warn: 0.005 },
};

describe('klasifikasikanKuadranSkuTiktok', () => {
  it('klik tinggi + cvr tinggi ⇒ bintang', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: 0.02, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('klik rendah (tapi ≥ ambang uji) + cvr tinggi ⇒ hidden_gem', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 50, ctor: 0.02, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'hidden_gem' }]);
  });

  it('klik tinggi + cvr rendah ⇒ bocor_traffic', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: 0.005, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bocor_traffic' }]);
  });

  it('klik rendah + cvr rendah (tapi lolos ambang uji) ⇒ evaluasi', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 50, ctor: 0.005, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'evaluasi' }]);
  });

  it(`klik di bawah KLIK_MIN_UJI (${KLIK_MIN_UJI}) ⇒ tidur, walau cvr tinggi`, () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: KLIK_MIN_UJI - 1, ctor: 0.9, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'tidur' }]);
  });

  it('klik nol ⇒ tidak_tayang (BUKAN tidur — beda alasan: nol tayang vs sample kecil)', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 0, ctor: null, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'tidak_tayang' }]);
  });

  it('klik null diperlakukan sama dengan nol ⇒ tidak_tayang', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: null, ctor: 0.9, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'tidak_tayang' }]);
  });

  it('klik lolos ambang tapi cvr TIDAK terbaca (ctor null DAN pesananSku null) ⇒ tidur', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: null, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'tidur' }]);
  });

  it('ctor null ⇒ fallback pesananSku/klik (cermin kuadranProduk mesin lama)', () => {
    // 20 pesanan / 200 klik = 0.10 ≥ quad_cvr.good (0.015) ⇒ cvr tinggi
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: null, pesananSku: 20 }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('ctor TERISI menang atas pesananSku (bukan dijumlah/dirata-rata)', () => {
    // pesananSku/klik akan tinggi (20/200=0.1), tapi ctor eksplisit rendah (0.001) ⇒ cvr TIDAK tinggi;
    // klik tinggi (200≥150) tapi cvr rendah ⇒ bocor_traffic, BUKAN bintang (yang akan terjadi bila
    // pesananSku/klik dipakai alih-alih ctor eksplisit).
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: 0.001, pesananSku: 20 }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bocor_traffic' }]);
  });

  it('ambang PERSIS good (>=, bukan >) ⇒ tinggi', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 150, ctor: 0.015, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('beberapa baris sekaligus, satu bench dipakai untuk semua — urutan output = urutan input', () => {
    const hasil = klasifikasikanKuadranSkuTiktok(
      [
        { id: 1, klik: 200, ctor: 0.02, pesananSku: null },
        { id: 2, klik: 0, ctor: null, pesananSku: null },
        { id: 3, klik: 5, ctor: 0.9, pesananSku: null },
      ],
      BENCH,
    );
    expect(hasil).toEqual([
      { id: 1, kuadran: 'bintang' },
      { id: 2, kuadran: 'tidak_tayang' },
      { id: 3, kuadran: 'tidur' },
    ]);
  });
});
