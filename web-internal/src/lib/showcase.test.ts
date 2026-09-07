/**
 * Gerbang UI Showcase (Gelombang C) — aturan rumah #6, dengan Sales disebut
 * EKSPLISIT.
 *
 * Yang diuji di sini adalah CERMIN dari gerbang server, bukan gerbang itu
 * sendiri: server tetap otoritasnya. Yang membuat cermin ini layak diuji adalah
 * arah kegagalannya — cermin yang terlalu longgar hanya memunculkan tombol yang
 * lalu ditolak server dengan pesan BI (jelek, tapi aman), sementara cermin yang
 * salah ke arah lain (memperlihatkan aksi izin kepada Sales) adalah janji yang
 * tidak akan ditepati dan menyesatkan orang yang mengandalkannya.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from './types';
import { canKelolaIzinPitchUi, canReadShowcaseUi, melihatSebagaiSalesUi, urlMateriPitch } from './showcase';

const role = (division: string, level: string, extra: Partial<Role> = {}): Role => ({
  division, level, od: false, director: false, ...extra,
});

describe('canReadShowcaseUi — C-1', () => {
  it('Sales staff & lead: ya (pengecualian pertama Role Matrix Fase 0 §4)', () => {
    expect(canReadShowcaseUi(role('Sales', 'staff'))).toBe(true);
    expect(canReadShowcaseUi(role('Sales', 'lead'))).toBe(true);
  });
  it('Account, OD, Director: ya', () => {
    expect(canReadShowcaseUi(role('Account', 'staff'))).toBe(true);
    expect(canReadShowcaseUi(role('Account', 'lead'))).toBe(true);
    expect(canReadShowcaseUi(role('Sales', 'staff', { od: true }))).toBe(true);
    expect(canReadShowcaseUi(role('Creative', 'staff', { director: true }))).toBe(true);
  });
  it('divisi lain: tidak', () => {
    for (const d of ['Creative', 'Ads', 'KOL', 'Live Stream', 'Finance', 'Marketing']) {
      expect(canReadShowcaseUi(role(d, 'staff')), d).toBe(false);
      expect(canReadShowcaseUi(role(d, 'lead')), d).toBe(false);
    }
  });
  it('belum login: tidak', () => {
    expect(canReadShowcaseUi(null)).toBe(false);
  });
});

describe('melihatSebagaiSalesUi', () => {
  it('Sales biasa: ya', () => {
    expect(melihatSebagaiSalesUi(role('Sales', 'staff'))).toBe(true);
    expect(melihatSebagaiSalesUi(role('Sales', 'lead'))).toBe(true);
  });
  it('Director/OD yang kebetulan terpetakan ke divisi Sales: TIDAK — haknya dari peran berlapis', () => {
    expect(melihatSebagaiSalesUi(role('Sales', 'staff', { director: true }))).toBe(false);
    expect(melihatSebagaiSalesUi(role('Sales', 'staff', { od: true }))).toBe(false);
  });
  it('Account: tidak', () => {
    expect(melihatSebagaiSalesUi(role('Account', 'staff'))).toBe(false);
  });
});

describe('canKelolaIzinPitchUi — akses Sales READ-ONLY (pagar (a))', () => {
  it('Sales tidak pernah melihat aksi izin, walau halamannya terbuka untuknya', () => {
    expect(canReadShowcaseUi(role('Sales', 'staff'))).toBe(true);
    expect(canKelolaIzinPitchUi(role('Sales', 'staff'), 'EMP-1', 'EMP-1')).toBe(false);
    expect(canKelolaIzinPitchUi(role('Sales', 'lead'), 'EMP-1', 'EMP-1')).toBe(false);
  });
  it('AM pemilik klien: ya; AM lain: tidak', () => {
    expect(canKelolaIzinPitchUi(role('Account', 'staff'), 'EMP-1', 'EMP-1')).toBe(true);
    expect(canKelolaIzinPitchUi(role('Account', 'staff'), 'EMP-2', 'EMP-1')).toBe(false);
  });
  it('Account lead & Director: ya, atas klien siapa pun', () => {
    expect(canKelolaIzinPitchUi(role('Account', 'lead'), 'EMP-9', 'EMP-1')).toBe(true);
    expect(canKelolaIzinPitchUi(role('Creative', 'staff', { director: true }), 'EMP-9', 'EMP-1')).toBe(true);
  });
  it('akun OD murni (bukan AM pemilik) membaca halaman tapi tidak mencentang izin', () => {
    // Catatan yang penting supaya tes ini tidak salah dibaca: lingkupnya SAMA
    // PERSIS dengan `report.canWriteReport` — sebuah akun ber-lapis OD yang
    // kebetulan JUGA AM pemilik klien tetap boleh menulis, karena wewenangnya
    // datang dari scope divisinya, bukan dari lapis OD-nya (lihat
    // `permission.canWrite`). Yang ditolak adalah OD yang bukan pemiliknya.
    const odMurni = role('Account', 'staff', { od: true });
    expect(canReadShowcaseUi(odMurni)).toBe(true);
    expect(canKelolaIzinPitchUi(odMurni, 'EMP-OD', 'EMP-1')).toBe(false);
    expect(canKelolaIzinPitchUi(odMurni, 'EMP-1', 'EMP-1')).toBe(true);
  });
});

describe('urlMateriPitch', () => {
  it('tanpa argumen membuka di tab; `download` memberi berkas', () => {
    expect(urlMateriPitch()).toBe('/api/v1/showcase/pitch');
    expect(urlMateriPitch(true)).toBe('/api/v1/showcase/pitch?download=1');
  });
});
