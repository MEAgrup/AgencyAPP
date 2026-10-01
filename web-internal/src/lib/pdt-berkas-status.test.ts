/**
 * Status per berkas di layar "Hasil Deteksi" (`/account/pdt/upload`).
 *
 * Regresi: `sebagian` (kolom wajib lengkap, kolom opsional hilang — berkas
 * TETAP dipakai) dulu tidak punya label, jadi tampil mentah "sebagian" dengan
 * badge MERAH yang sama dengan "Gagal". AM mengira berkasnya ditolak.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/lib/clients', () => ({ getClient: vi.fn() }));

const { PDT_BERKAS_STATUS_LABEL, pdtBerkasBadgeClass, pdtBerkasStatusLabel } = await import('./pdt');

describe('status berkas PDT', () => {
  it('sebagian punya label sendiri dan berwarna kuning, bukan merah seperti Gagal', () => {
    expect(pdtBerkasStatusLabel('sebagian')).toBe('Sebagian (tetap dipakai)');
    expect(pdtBerkasBadgeClass('sebagian')).toBe('badge-amber');
    expect(pdtBerkasBadgeClass('gagal')).toBe('badge-red');
  });

  it('kelima status domain (PdtPreviewBerkasStatus) semuanya berlabel — tidak ada yang tampil mentah', () => {
    for (const s of ['ok', 'sebagian', 'perlu_pilih_modul', 'gagal', 'ditolak_pagar']) {
      expect(PDT_BERKAS_STATUS_LABEL[s], s).toBeTruthy();
    }
  });

  it('warna: OK hijau, perlu tindakan kuning, ditolak merah', () => {
    expect(pdtBerkasBadgeClass('ok')).toBe('badge-green');
    expect(pdtBerkasBadgeClass('perlu_pilih_modul')).toBe('badge-amber');
    expect(pdtBerkasBadgeClass('ditolak_pagar')).toBe('badge-red');
  });

  it('status tak dikenal tetap tampil (teks mentah) dan merah — tidak pernah kosong', () => {
    expect(pdtBerkasStatusLabel('baru_x')).toBe('baru_x');
    expect(pdtBerkasBadgeClass('baru_x')).toBe('badge-red');
  });
});
