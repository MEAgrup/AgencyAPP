/**
 * `isForbidden` — pembeda antara "panel ini bukan hak Anda" dan "ada yang rusak".
 *
 * KENAPA BERKAS INI ADA. Client Record dulu merender TIGA pita galat MERAH
 * untuk Sales staff yang justru PEMILIK klien itu (Unified Board, Laporan,
 * Upcoming Milestones — ketiganya milik Account/AM), sehingga layar yang sehat
 * tampak rusak. Director dan OD tidak pernah melihatnya karena keduanya lolos
 * `jwt_can_read_all()`. Ditemukan UAT peramban 2026-09-10
 * (`UAT_SALES_BROWSER_20260910.md` §3, `OBS-1-PITA-GALAT`).
 *
 * ⚠️ Batas yang dijaga tes ini: HANYA 403. Sebuah 500 atau kegagalan jaringan
 * TETAP harus terlihat — menyembunyikan panel karena server sedang rusak
 * mengubah kerusakan menjadi "datanya memang tidak ada", persis kelas cacat
 * yang paling mahal di repo ini.
 */
import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage, isForbidden } from './api';

describe('isForbidden', () => {
  it('true HANYA untuk ApiError 403', () => {
    expect(isForbidden(new ApiError('[anda tidak memiliki akses ke data ini]', 403))).toBe(true);
  });

  it('false untuk status lain — kerusakan tetap harus terlihat', () => {
    for (const status of [0, 400, 401, 404, 409, 422, 500, 502, 503]) {
      expect(isForbidden(new ApiError('[galat]', status))).toBe(false);
    }
  });

  it('false untuk Error biasa dan nilai non-Error', () => {
    expect(isForbidden(new Error('boom'))).toBe(false);
    expect(isForbidden('403')).toBe(false);
    expect(isForbidden({ status: 403 })).toBe(false);
    expect(isForbidden(null)).toBe(false);
    expect(isForbidden(undefined)).toBe(false);
  });

  it('tidak mengubah pesan BI yang dibawa ApiError', () => {
    // Pesan `[...]`-nya tetap utuh untuk jalur AKSI, yang memang harus
    // menampilkannya (aturan rumah #5).
    const err = new ApiError('[anda tidak memiliki akses untuk melakukan transisi ini]', 403);
    expect(errorMessage(err)).toBe('[anda tidak memiliki akses untuk melakukan transisi ini]');
  });
});
