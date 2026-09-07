import { describe, expect, it } from 'vitest';
import { SELALU_MANUAL, mergeBaselinePrefill, ringkasBaseline } from './strategi-baseline-inherit';
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
        // B3 — defaults are the HONEST empty payload: schema known, nothing
        // measured. Each test opts in to the figures it is about, so a test that
        // does not mention a field proves that field stays manual.
        payload_schema: 'cdps.baseline.tiktok.v1',
        payload_terbaca: true,
        periode_referensi: null,
        refund_rate_persen: null,
        chat_response_rate_persen: null,
        chat_response_menit: null,
        poin_penalti: null,
        pengunjung_per_bulan: null,
        conversion_rate_persen: null,
        trafik_organik_persen: null,
        trafik_iklan_persen: null,
        trafik_affiliate_persen: null,
        trafik_live_persen: null,
        trafik_video_persen: null,
        trafik_luar_persen: null,
        sku_listed: null,
        sku_aktif: null,
        sku_pareto_80: null,
        sku_slow_moving: null,
        top_sku: [],
        jumlah_kampanye_aktif: null,
        tipe_kampanye: [],
        affiliate_aktif_30hari: null,
        gmv_affiliate: null,
        gmv_affiliate_persen: null,
        top_kreator: [],
        sampel_terkirim: null,
        jumlah_video_per_bulan: null,
        total_views: null,
        gmv_video: null,
        jam_live_per_bulan: null,
        gmv_live: null,
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
    // B-0.6 lampiran is NO LONGER inherited from the export filename (owner QA
    // 2026-08-24): it autofills from the client's Link Toko, server-side. The
    // merge leaves it blank so that default can take effect.
    expect(ch.lampiran).toBe('');
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


// ---------------------------------------------------------------------------
// B3 — the ~15 Section B figures the payload already carried (§4.4)
// ---------------------------------------------------------------------------

/** The figures a full analysis payload proposes, as the server emits them. */
const TERUKUR = {
  periode_referensi: 'Agu 2026',
  refund_rate_persen: 4.12,
  pengunjung_per_bulan: 520_000,
  conversion_rate_persen: 5.37,
  trafik_iklan_persen: 28.81,
  trafik_live_persen: 20,
  trafik_video_persen: 50,
  trafik_luar_persen: 30,
  sku_listed: 120,
  sku_aktif: 44,
  top_sku: [{ nama: 'Serum A', gmv: '25000000', klik: 3400, ctor_persen: 8.1 }],
  affiliate_aktif_30hari: 37,
  gmv_affiliate: '15000000',
  gmv_affiliate_persen: 15,
  top_kreator: [{ nama: 'kreator.satu', gmv: '8000000' }],
  sampel_terkirim: 60,
  jumlah_video_per_bulan: 119,
  total_views: 3_000_000,
  gmv_video: '27000000',
  jam_live_per_bulan: 62.5,
  gmv_live: '0',
};

describe('mergeBaselinePrefill — B3 (Section B terisi dari satu upload)', () => {
  it('seeds B-2 / B-3 / B-6 / B-7 into the empty draft', () => {
    const [ch] = mergeBaselinePrefill([blank('TikTok Shop')], prefill(TERUKUR));
    expect(ch.pengunjung_per_bulan).toBe('520000');
    expect(ch.conversion_rate_persen).toBe('5.37');
    expect(ch.trafik_video_persen).toBe('50');
    expect(ch.trafik_live_persen).toBe('20');
    expect(ch.trafik_luar_persen).toBe('30');
    expect(ch.trafik_iklan_persen).toBe('28.81');
    expect(ch.sku_listed).toBe('120');
    expect(ch.sku_aktif).toBe('44');
    expect(ch.affiliate_aktif_30hari).toBe('37');
    expect(ch.gmv_affiliate).toBe('15000000');
    expect(ch.gmv_affiliate_persen).toBe('15');
    expect(ch.jumlah_video_per_bulan).toBe('119');
    expect(ch.total_views).toBe('3000000');
    expect(ch.gmv_video).toBe('27000000');
    expect(ch.jam_live_per_bulan).toBe('62.5');
    expect(ch.gmv_live).toBe('0');
  });

  it('B-2.3: organik and affiliate stay EMPTY — a residual would be invented', () => {
    const [ch] = mergeBaselinePrefill([blank('TikTok Shop')], prefill(TERUKUR));
    expect(ch.trafik_organik_persen).toBe('');
    expect(ch.trafik_affiliate_persen).toBe('');
  });

  it('B-3.3 hero SKU: name + GMV seeded, unit/harga/margin left blank', () => {
    const [ch] = mergeBaselinePrefill([blank('TikTok Shop')], prefill(TERUKUR));
    expect(ch.top_sku).toEqual([
      { nama: 'Serum A', gmv: '25000000', unit_terjual: '', harga_jual: '', margin_persen: '' },
    ]);
  });

  it('never clobbers a figure the AM already typed', () => {
    const typed: ChannelDraft = {
      ...blank('TikTok Shop'),
      pengunjung_per_bulan: '999',
      sku_listed: '7',
      gmv_live: '123',
      top_sku: [{ nama: 'punya AM', gmv: '1', unit_terjual: '2', harga_jual: '3', margin_persen: '4' }],
      top_kreator: [{ nama: 'punya AM', gmv: '5' }],
      tipe_kampanye: ['auto'],
      program_sampel_catatan: 'catatan AM',
    };
    const [ch] = mergeBaselinePrefill([typed], prefill({ ...TERUKUR, tipe_kampanye: ['video_ads'] }));
    expect(ch.pengunjung_per_bulan).toBe('999');
    expect(ch.sku_listed).toBe('7');
    expect(ch.gmv_live).toBe('123');
    expect(ch.top_sku).toHaveLength(1);
    expect(ch.top_sku[0].nama).toBe('punya AM');
    expect(ch.top_kreator[0].nama).toBe('punya AM');
    expect(ch.tipe_kampanye).toEqual(['auto']);
    expect(ch.program_sampel_catatan).toBe('catatan AM');
    // …while an untouched field still gets seeded in the same pass.
    expect(ch.sku_aktif).toBe('44');
  });

  it('a field the payload has no source for stays empty, never 0', () => {
    const [ch] = mergeBaselinePrefill([blank('TikTok Shop')], prefill(TERUKUR));
    // B1 (parallel) adds these to the payload; until then they are the AM's.
    expect(ch.sku_pareto_80).toBe('');
    expect(ch.sku_slow_moving).toBe('');
    expect(ch.jumlah_kampanye_aktif).toBe('');
    expect(ch.tipe_kampanye).toEqual([]);
    // B-4 has no export on TikTok at all — permanently manual (owner 2026-09-06).
    expect(ch.rating_toko).toBe('');
    expect(ch.chat_response_rate_persen).toBe('');
    expect(ch.poin_penalti).toBe('');
    // B-8 / B-9 / host / studio: no source either.
    expect(ch.beban_promo_persen).toBe('');
    expect(ch.host_live).toBe('');
  });

  it('B-6.5 offers the sample COUNT as a note; who pays stays manual', () => {
    const [ch] = mergeBaselinePrefill([blank('TikTok Shop')], prefill(TERUKUR));
    expect(ch.program_sampel_catatan).toBe('60 sampel terkirim (dari Riset Awal)');
    expect(ch.program_sampel).toBe('');
  });

  it('B-1.4 % batal lands ONLY on the month matching the payload period', () => {
    const [ch] = mergeBaselinePrefill(
      [blank('TikTok Shop')],
      prefill({
        ...TERUKUR,
        baseline_bulan: [
          { month_index: 1, label: 'Jul 2026', gmv: '90000000', jumlah_pesanan: 900 },
          { month_index: 2, label: 'Agu 2026', gmv: '100000000', jumlah_pesanan: 1000 },
        ],
        periode_baseline_bulan: 2,
      }),
    );
    expect(ch.baseline[0].persen_batal).toBe('');
    expect(ch.baseline[1].persen_batal).toBe('4.12');
    // The aggregate is never spread onto months the export did not describe.
    expect(ch.baseline.filter((m) => m.persen_batal !== '')).toHaveLength(1);
  });

  it('B-1.4 stays empty when no month label matches the payload period', () => {
    const [ch] = mergeBaselinePrefill(
      [blank('TikTok Shop')],
      prefill({ ...TERUKUR, periode_referensi: 'Des 2026' }),
    );
    expect(ch.baseline.every((m) => m.persen_batal === '')).toBe(true);
  });

  it('tipe kampanye seeds only into an empty list', () => {
    const [ch] = mergeBaselinePrefill(
      [blank('TikTok Shop')],
      prefill({ tipe_kampanye: ['video_ads', 'gmv_max'] }),
    );
    expect(ch.tipe_kampanye).toEqual(['video_ads', 'gmv_max']);
  });

  it('a legacy / manual payload seeds nothing beyond the four old fields', () => {
    const [ch] = mergeBaselinePrefill(
      [blank('TikTok Shop')],
      prefill({ payload_terbaca: false, payload_schema: null }),
    );
    expect(ch.periode_baseline_bulan).toBe('3'); // B-0.7 still inherited
    expect(ch.pengunjung_per_bulan).toBe('');
    expect(ch.sku_listed).toBe('');
    expect(ch.top_sku).toEqual([]);
  });

  it('is idempotent — merging twice changes nothing', () => {
    const once = mergeBaselinePrefill([blank('TikTok Shop')], prefill(TERUKUR));
    const twice = mergeBaselinePrefill(once, prefill(TERUKUR));
    expect(twice).toEqual(once);
  });
});

describe('ringkasBaseline — "yang manual tetap terlihat manual"', () => {
  it('splits what the upload answered from what is still the AM\'s', () => {
    const r = ringkasBaseline(prefill(TERUKUR).channels[0]);
    expect(r.payloadLama).toBe(false);
    expect(r.otomatis).toContain('Pengunjung per bulan (B-2.1)');
    expect(r.otomatis).toContain('Top SKU (B-3.3)');
    expect(r.belumTersedia).toContain('SKU penyumbang 80% GMV (B-3.2)');
    expect(r.belumTersedia).toContain('Tipe kampanye (B-5.3)');
    // 24 field bersumber saat B3 mendarat, + 3 kolom B-4 yang export Shopee
    // membawanya (keputusan pemilik 2026-09-06) = 27.
    expect(r.otomatis.length + r.belumTersedia.length).toBe(27);
  });

  it('marks a legacy / manual payload as such rather than as 21 empty fields', () => {
    const r = ringkasBaseline(prefill({ payload_terbaca: false }).channels[0]);
    expect(r.payloadLama).toBe(true);
  });

  it('no suggestion at all ⇒ everything manual', () => {
    const r = ringkasBaseline(null);
    expect(r.payloadLama).toBe(true);
    expect(r.otomatis).toEqual([]);
  });

  it('names the permanently-manual groups so the AM stops waiting for them', () => {
    expect(SELALU_MANUAL.join(' ')).toContain('B-4');
    expect(SELALU_MANUAL.join(' ')).toContain('B-9');
  });
});

// ---------------------------------------------------------------------------
// B-4 — Shopee terisi otomatis, TikTok tetap manual (keputusan pemilik 2026-09-06)
// ---------------------------------------------------------------------------

describe('mergeBaselinePrefill — B-4 kesehatan toko', () => {
  const SHOPEE_B4 = {
    channel: 'Shopee',
    chat_response_rate_persen: 95,
    chat_response_menit: 13,
    poin_penalti: 1,
  };

  it('mengisi tiga kolom B-4 saat payload Shopee membawanya', () => {
    const [ch] = mergeBaselinePrefill([blank('Shopee')], prefill(SHOPEE_B4));
    expect(ch.chat_response_rate_persen).toBe('95');
    expect(ch.chat_response_menit).toBe('13');
    expect(ch.poin_penalti).toBe('1');
  });

  it('rating, jumlah ulasan dan % pesanan terlambat TETAP manual — tak ada export-nya', () => {
    const [ch] = mergeBaselinePrefill([blank('Shopee')], prefill(SHOPEE_B4));
    expect(ch.rating_toko).toBe('');
    expect(ch.jumlah_ulasan).toBe('');
    expect(ch.pesanan_terlambat_persen).toBe('');
  });

  it('TikTok: ketiganya null di wire ⇒ kolomnya tetap kosong dan tetap menggerbang', () => {
    const [ch] = mergeBaselinePrefill([blank('TikTok Shop')], prefill({}));
    expect(ch.chat_response_rate_persen).toBe('');
    expect(ch.chat_response_menit).toBe('');
    expect(ch.poin_penalti).toBe('');
  });

  it('poin penalti 0 tetap ditulis — toko bersih adalah TEMUAN, bukan kolom kosong', () => {
    const [ch] = mergeBaselinePrefill([blank('Shopee')], prefill({ channel: 'Shopee', poin_penalti: 0 }));
    expect(ch.poin_penalti).toBe('0');
  });

  it('tidak menimpa angka B-4 yang AM sudah ketik', () => {
    const typed = { ...blank('Shopee'), poin_penalti: '9', chat_response_menit: '2' };
    const [ch] = mergeBaselinePrefill([typed], prefill(SHOPEE_B4));
    expect(ch.poin_penalti).toBe('9');
    expect(ch.chat_response_menit).toBe('2');
    expect(ch.chat_response_rate_persen).toBe('95');
  });

  it('ringkasan menghitung ketiganya sebagai field bersumber', () => {
    const r = ringkasBaseline(prefill(SHOPEE_B4).channels[0]);
    expect(r.otomatis).toContain('Chat response rate % (B-4.2)');
    expect(r.otomatis).toContain('Poin penalti (B-4.4)');
    expect(r.otomatis.length + r.belumTersedia.length).toBe(27);
    // Yang benar-benar tidak punya export di platform mana pun tetap disebut.
    expect(SELALU_MANUAL.join(' ')).toContain('B-4.1/B-4.3');
  });
});
