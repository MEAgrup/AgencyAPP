/**
 * Saklar Progres Layanan: default MATI. Hanya `'1'`/`'true'` yang menyalakan —
 * nilai lain yang "kelihatan seperti nyala" pun tetap mati, supaya salah ketik
 * env di Vercel tidak diam-diam memunculkan lagi tampilan yang ditangguhkan.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { progresAktif } from './fitur';

const KUNCI = 'NEXT_PUBLIC_PORTAL_PROGRES_AKTIF';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('progresAktif', () => {
  it('mati bila env tidak di-set', () => {
    vi.stubEnv(KUNCI, undefined);
    expect(progresAktif()).toBe(false);
  });

  it.each(['', '0', 'false', 'FALSE', 'no', 'off', 'ya'])('mati untuk %j', (nilai) => {
    vi.stubEnv(KUNCI, nilai);
    expect(progresAktif()).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', ' true '])('nyala untuk %j', (nilai) => {
    vi.stubEnv(KUNCI, nilai);
    expect(progresAktif()).toBe(true);
  });
});
