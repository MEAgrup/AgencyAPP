import { describe, expect, it } from 'vitest';
import type { AdsBrief, CampaignListRow } from '@/lib/ads';
import {
  aksiKampanye,
  cocokCari,
  daftarAdvertiser,
  kelompokBriefPerKlien,
  klienSaya,
  saringKampanye,
} from '@/lib/ads-queue';

const brief = (o: Partial<AdsBrief>): AdsBrief => ({
  id: 'BRF-1', service_id: 'SVC-1', assigned_division: 'Ads', assigned_pic: '', client_id: 'CLI-1',
  client_nama: 'Toko A', assigned_pic_nama: '', deliverable_type: 'Campaign', due_date: '', priority: 'High',
  title: 'Brief', status: '[To Do]', created_by: 'AM', created_at: '', intake_state: 'menunggu', ...o,
});
const kampanye = (o: Partial<CampaignListRow>): CampaignListRow => ({
  id: 'ADC-1', brief_id: 'BRF-1', client_id: 'CLI-1', client_nama: 'Bu Rina', client_toko: 'Toko A',
  platform: 'Shopee Ads', tipe_iklan: 'GMV Max Product', objective: 'Sales', budget: 500000,
  budget_display: 'Rp. 500.000,00', start_date: '2026-10-01', end_date: '', status: '[Active]',
  iklan_mulai: '', iklan_selesai: '', hari_iklan_berjalan: null, hari_iklan_aktif: null,
  estimasi_budget_terpakai: null, estimasi_budget_terpakai_display: '—', created_by: 'ADV-1',
  created_by_nama: 'Kenny', created_at: '2026-10-01T00:00:00Z', ...o,
});

describe('ADS-REVISI-UI R6/R7 — antrean per klien + cari', () => {
  it('cocokCari: kosong cocok semua, case-insensitive, substring', () => {
    expect(cocokCari('', 'apa saja')).toBe(true);
    expect(cocokCari('  batik ', 'Toko BATIK Rina')).toBe(true);
    expect(cocokCari('pigeon', 'Toko A', null, undefined)).toBe(false);
  });

  it('klienSaya: klien ber-PIC saya atau yang kampanyenya saya buat', () => {
    const briefs = [brief({ client_id: 'CLI-1', assigned_pic: 'ADV-1' }), brief({ client_id: 'CLI-2', assigned_pic: 'ADV-2' }), brief({ client_id: 'CLI-3' })];
    const camps = [kampanye({ client_id: 'CLI-4', created_by: 'ADV-1' })];
    expect([...klienSaya(briefs, camps, 'ADV-1')].sort()).toEqual(['CLI-1', 'CLI-4']);
    expect(klienSaya(briefs, camps, '').size).toBe(0);
  });

  it('kelompokBriefPerKlien: per klien urut nama, disaring cari + klien saya', () => {
    const briefs = [
      brief({ id: 'B1', client_id: 'CLI-2', client_nama: 'Zeta Store' }),
      brief({ id: 'B2', client_id: 'CLI-1', client_nama: 'Alpha Shop' }),
      brief({ id: 'B3', client_id: 'CLI-2', client_nama: 'Zeta Store' }),
    ];
    const semua = kelompokBriefPerKlien(briefs, { cari: '', hanyaKlien: null });
    expect(semua.map((g) => [g.clientNama, g.briefs.map((b) => b.id)])).toEqual([
      ['Alpha Shop', ['B2']],
      ['Zeta Store', ['B1', 'B3']],
    ]);
    expect(kelompokBriefPerKlien(briefs, { cari: 'zeta', hanyaKlien: null }).map((g) => g.clientId)).toEqual(['CLI-2']);
    expect(kelompokBriefPerKlien(briefs, { cari: '', hanyaKlien: new Set(['CLI-1']) }).map((g) => g.clientId)).toEqual(['CLI-1']);
  });
});

describe('ADS-REVISI-UI R4 — daftar kampanye', () => {
  it('saringKampanye: advertiser + cari nama klien / toko / ID', () => {
    const rows = [kampanye({ id: 'ADC-1' }), kampanye({ id: 'ADC-2', created_by: 'ADV-2', client_nama: 'Pak Budi', client_toko: 'Gold Pigeon' })];
    expect(saringKampanye(rows, { cari: '', advertiser: 'ADV-2' }).map((c) => c.id)).toEqual(['ADC-2']);
    expect(saringKampanye(rows, { cari: 'rina', advertiser: '' }).map((c) => c.id)).toEqual(['ADC-1']);
    expect(saringKampanye(rows, { cari: 'pigeon', advertiser: '' }).map((c) => c.id)).toEqual(['ADC-2']);
    expect(saringKampanye(rows, { cari: 'adc-2', advertiser: '' }).map((c) => c.id)).toEqual(['ADC-2']);
  });

  it('daftarAdvertiser: unik, urut nama, jatuh ke id bila nama kosong', () => {
    const rows = [kampanye({ created_by: 'B', created_by_nama: 'Zaki' }), kampanye({ created_by: 'A', created_by_nama: '' }), kampanye({ created_by: 'B', created_by_nama: 'Zaki' })];
    expect(daftarAdvertiser(rows)).toEqual([{ id: 'A', nama: 'A' }, { id: 'B', nama: 'Zaki' }]);
  });

  it('aksiKampanye: Jeda/Matikan saat aktif, Lanjutkan/Matikan saat dijeda, nol aksi lain', () => {
    expect(aksiKampanye('[Active]')).toEqual(['pause', 'end']);
    expect(aksiKampanye('[Paused]')).toEqual(['resume', 'end']);
    expect(aksiKampanye('[Setting]')).toEqual([]);
    expect(aksiKampanye('[Ended]')).toEqual([]);
  });
});
