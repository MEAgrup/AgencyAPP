import { describe, expect, it } from 'vitest';
import { mergeBaselinePrefill } from './strategi-baseline-inherit';
import type { ChannelDraft } from '@/components/strategi/SectionB';
import type { StrategiBaselinePrefill } from '@/lib/strategi';

// A ChannelDraft has ~70 fields; only the sourced ones matter here, so build a
// blank and override. Keeps the test about the seeding rule, not the shape.
function blank(channel: string): ChannelDraft {
  return {
    channel,
    channel_lain: '',
    status_channel: 'Eksisting',
    nama_toko: '',
    url_toko: '',
    umur_toko_bulan: '',
    badge: '',
    target_tanggal_live: '',
    prasyarat_pembukaan: [],
    sumber_data: '',
    tanggal_ambil_data: '',
    lampiran: '',
    periode_baseline_bulan: '',
    periode_mulai: '',
    periode_akhir: '',
    alasan_periode_pendek: '',
    catatan_periode_pendek: '',
    prioritas: '',
    prioritas_alasan: '',
    baseline: [],
    pengunjung_per_bulan: '',
    conversion_rate_persen: '',
    trafik_organik_persen: '',
    trafik_iklan_persen: '',
    trafik_affiliate_persen: '',
    trafik_live_persen: '',
    trafik_video_persen: '',
    trafik_luar_persen: '',
    entry_point_utama: '',
    entry_point_catatan: '',
    sku_listed: '',
    sku_aktif: '',
    sku_pareto_80: '',
    top_sku: [],
    sku_slow_moving: '',
    sku_stok_kritis: [],
    listing_layak_persen: '',
    rating_toko: '',
    jumlah_ulasan: '',
    chat_response_rate_persen: '',
    chat_response_menit: '',
    pesanan_terlambat_persen: '',
    poin_penalti: '',
    catatan_penalti: '',
    tema_keluhan: [],
    tipe_kampanye: [],
    tipe_kampanye_tidak_ada: false,
    jumlah_kampanye_aktif: '',
    top_keyword: [],
    kampanye_boncos: [],
    affiliate_aktif_30hari: '',
    gmv_affiliate: '',
    gmv_affiliate_persen: '',
    komisi_open_persen: '',
    komisi_target_persen: '',
    top_kreator: [],
    program_sampel: '',
    program_sampel_catatan: '',
    jumlah_video_per_bulan: '',
    total_views: '',
    gmv_video: '',
    jam_live_per_bulan: '',
    gmv_live: '',
    host_live: '',
    studio_live: '',
    studio_catatan: '',
    voucher_aktif: [],
    voucher_aktif_tidak_ada: false,
    program_platform: [],
    program_platform_tidak_ada: false,
    beban_promo_persen: '',
    kompetitor: [],
    kompetitor_lebih_baik: [],
    kompetitor_catatan: '',
    celah_kompetitor: '',
  };
}

function prefill(over: Partial<StrategiBaselinePrefill['channels'][number]>): StrategiBaselinePrefill {
  return {
    interview_id: 'ITV-202608-0001',
    channels: [
      {
        client_platform_id: 1,
        platform: 'tiktok_shop',
        channel: 'TikTok Shop',
        channel_lain: null,
        metode_baseline: 'analisa_penuh',
        kondisi_toko: 'mesin_sebagian',
        skor: 61,
        periode_baseline_bulan: 3,
        cakupan_riwayat: 'cukup',
        alasan_periode_pendek_wajib: false,
        sumber_data: 'TikTok Seller Center export',
        tanggal_ambil_data: '2026-08-02',
        lampiran: 'ra/tiktok.xlsx',
        roas: 4.1,
        ad_spend: '41000000',
        aov: '87800',
        // 1-based, exactly as the server emits (getBaselinePrefill: `i + 1`) and
        // as the DB stores it (`ck_strbl_month` BETWEEN 1 AND 6). Month 1 = oldest.
        baseline_bulan: [
          { month_index: 1, label: 'M-1', gmv: '172000000', jumlah_pesanan: 1900 },
          { month_index: 2, label: 'M-2', gmv: '165000000', jumlah_pesanan: 1820 },
          { month_index: 3, label: 'M-3', gmv: '180000000', jumlah_pesanan: 2050 },
        ],
        gmv_mix: null,
        ...over,
      },
    ],
  };
}

describe('mergeBaselinePrefill (RAB-19 warisi yang bersumber saja)', () => {
  it('seeds empty provenance, window, and per-month GMV + orders from Riset Awal', () => {
    const [ch] = mergeBaselinePrefill([blank('TikTok Shop')], prefill({}));
    expect(ch.sumber_data).toBe('TikTok Seller Center export');
    expect(ch.tanggal_ambil_data).toBe('2026-08-02');
    expect(ch.lampiran).toBe('ra/tiktok.xlsx');
    expect(ch.periode_baseline_bulan).toBe('3');
    expect(ch.baseline).toHaveLength(3);
    // month_index is 1-based end to end (DB CHECK BETWEEN 1 AND 6). A 0-based
    // value here would be rejected on save with `[data tidak lengkap …]`.
    expect(ch.baseline.map((m) => m.month_index)).toEqual([1, 2, 3]);
    expect(ch.baseline[2]).toMatchObject({ gmv: '180000000', jumlah_pesanan: '2050' });
    // The non-sourced per-month cells stay blank — Riset Awal has no per-month
    // figure for them; the AM fills these.
    expect(ch.baseline[0].persen_batal).toBe('');
    expect(ch.baseline[0].ad_spend).toBe('');
    expect(ch.baseline[0].roas).toBe('');
  });

  it('never clobbers a value the AM already entered', () => {
    const edited = {
      ...blank('TikTok Shop'),
      sumber_data: 'ketikan AM',
      periode_baseline_bulan: '2',
      baseline: [{ month_index: 1, gmv: '99', jumlah_pesanan: '9', persen_batal: '', ad_spend: '', roas: '', acos: '' }],
    };
    const [ch] = mergeBaselinePrefill([edited], prefill({}));
    expect(ch.sumber_data).toBe('ketikan AM');
    expect(ch.periode_baseline_bulan).toBe('2'); // AM's window kept → 2 months
    expect(ch.baseline).toHaveLength(2);
    expect(ch.baseline[0].gmv).toBe('99'); // kept
    expect(ch.baseline[1].gmv).toBe('165000000'); // empty slot seeded
  });

  it('leaves a channel with no matching suggestion untouched', () => {
    const [ch] = mergeBaselinePrefill([blank('Shopee')], prefill({}));
    expect(ch.sumber_data).toBe('');
    expect(ch.baseline).toHaveLength(0);
  });

  it('matches a "Lainnya" channel by channel_lain', () => {
    const other = { ...blank('Lainnya'), channel_lain: 'Blibli' };
    const p = prefill({ channel: 'Lainnya', channel_lain: 'Blibli' });
    const [ch] = mergeBaselinePrefill([other], p);
    expect(ch.periode_baseline_bulan).toBe('3');
  });
});
