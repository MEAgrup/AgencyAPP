/**
 * B2 — registry UI Riset Awal untuk dua mesin.
 *
 * Yang dipaku di sini adalah hal yang gagal DIAM-DIAM kalau salah: pemilih mesin
 * yang tak cocok dengan `mesinForPlatform` di domain (AM melihat dropdown TikTok
 * untuk toko Shopee, memilih `vid_toko`, dan server menolak nilai itu), dan
 * daftar slot yang meleset dari 17 modul yang server kenali.
 */
import { describe, expect, it } from 'vitest';
import { mesinPlatform, TIPE_OVERRIDE_OPTIONS, TIPE_OVERRIDE_SHOPEE } from './riset-awal';

describe('mesinPlatform — cermin mesinForPlatform (domain)', () => {
  it('Shopee memilih mesin Shopee, apa pun kapitalisasi/spasinya', () => {
    expect(mesinPlatform('Shopee')).toBe('shopee');
    expect(mesinPlatform('shopee')).toBe('shopee');
    expect(mesinPlatform('  Shopee  ')).toBe('shopee');
  });

  it('TikTok Shop tetap mesin TikTok', () => {
    expect(mesinPlatform('TikTok Shop')).toBe('tiktok');
  });

  it('platform lain jatuh ke TikTok — komponen hanya memanggilnya untuk baris analisa_penuh', () => {
    // `metode` datang dari server; fungsi ini tidak pernah dipakai untuk
    // memutuskan APAKAH sebuah platform bermesin, hanya mesin yang mana.
    expect(mesinPlatform('Lazada')).toBe('tiktok');
  });
});

describe('daftar tipe berkas', () => {
  it('Shopee menawarkan 17 slot + opsi otomatis', () => {
    expect(TIPE_OVERRIDE_SHOPEE).toHaveLength(18);
    expect(TIPE_OVERRIDE_SHOPEE[0].value).toBe('');
  });

  it('nilai Shopee TEPAT 17 modul yang server kenali — nilai asing ditolak server', () => {
    const modules = TIPE_OVERRIDE_SHOPEE.map((o) => o.value).filter((v) => v !== '');
    expect([...modules].sort()).toEqual([
      'ads_banner', 'ads_live', 'ads_produk', 'ads_toko',
      'aff_creator', 'aff_product',
      'bisnis_home', 'bisnis_kesehatan', 'bisnis_live', 'bisnis_produk', 'bisnis_video',
      'layanan_broadcast', 'layanan_chat', 'meta',
      'promo_diskon', 'promo_flashsale', 'promo_voucher',
    ]);
  });

  it('dua daftar tidak beririsan — tipe TikTok tak pernah dikirim untuk toko Shopee', () => {
    const tt = new Set(TIPE_OVERRIDE_OPTIONS.map((o) => o.value).filter(Boolean));
    const sh = TIPE_OVERRIDE_SHOPEE.map((o) => o.value).filter(Boolean);
    expect(sh.filter((v) => tt.has(v))).toEqual([]);
  });

  it('Bisnis — Home ditandai wajib, karena hanya itu yang menggerbang submit', () => {
    expect(TIPE_OVERRIDE_SHOPEE.find((o) => o.value === 'bisnis_home')?.label).toContain('wajib');
  });
});
