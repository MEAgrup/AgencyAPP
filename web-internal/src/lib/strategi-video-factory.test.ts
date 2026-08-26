import { describe, it, expect } from 'vitest';
import {
  parseVideoFactoryPayload,
  applyVideoFactoryPrefill,
  VIDEO_FACTORY_SCHEMA,
  type VideoFactoryPayload,
} from './strategi-video-factory';
import { blankChannel, type ChannelDraft } from '@/components/strategi/SectionB';

function payload(channel: Record<string, unknown>): VideoFactoryPayload {
  return { schema: VIDEO_FACTORY_SCHEMA, channel: { channel: 'TikTok Shop', ...channel } } as VideoFactoryPayload;
}

describe('parseVideoFactoryPayload', () => {
  it('menerima payload cdps.section_b.v1 yang sah', () => {
    const text = JSON.stringify({ schema: VIDEO_FACTORY_SCHEMA, channel: { channel: 'TikTok Shop', sku_listed: 120 } });
    const r = parseVideoFactoryPayload(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.channel.sku_listed).toBe(120);
  });

  it('menolak teks kosong dengan pesan BI dalam kurung siku', () => {
    const r = parseVideoFactoryPayload('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^\[.*\]$/);
  });

  it('menolak JSON yang bukan payload Section B (mis. baseline export lama)', () => {
    const r = parseVideoFactoryPayload(JSON.stringify({ schema: 'cdps.baseline.v1', section_b: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/versi tidak cocok/);
  });

  it('menolak teks non-JSON (mis. hasil "Copy baseline (teks)")', () => {
    const r = parseVideoFactoryPayload('BASELINE CHANNEL — CDPS SECTION B\nChannel: TikTok Shop');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/format tidak dikenali/);
  });

  it('menolak payload tanpa blok channel', () => {
    const r = parseVideoFactoryPayload(JSON.stringify({ schema: VIDEO_FACTORY_SCHEMA }));
    expect(r.ok).toBe(false);
  });
});

describe('applyVideoFactoryPrefill', () => {
  it('membuat channel TikTok Shop bila belum ada, dan menandainya created', () => {
    const { channels, summary } = applyVideoFactoryPrefill([], payload({ sku_listed: 100, rating_toko: 4.8 }));
    expect(channels).toHaveLength(1);
    expect(channels[0].channel).toBe('TikTok Shop');
    expect(channels[0].sku_listed).toBe('100');
    expect(channels[0].rating_toko).toBe('4.8');
    expect(summary.channelCreated).toBe(true);
    expect(summary.fieldsFilled).toBeGreaterThan(0);
  });

  it('mengisi channel TikTok Shop yang sudah ada tanpa menambah channel', () => {
    const existing = blankChannel('TikTok Shop');
    const { channels, summary } = applyVideoFactoryPrefill([existing], payload({ pengunjung_per_bulan: 5000 }));
    expect(channels).toHaveLength(1);
    expect(channels[0].pengunjung_per_bulan).toBe('5000');
    expect(summary.channelCreated).toBe(false);
  });

  it('TIDAK menimpa field yang sudah diisi AM (saran, bukan paksa)', () => {
    const existing: ChannelDraft = { ...blankChannel('TikTok Shop'), nama_toko: 'Toko Punya AM', sku_listed: '999' };
    const { channels, summary } = applyVideoFactoryPrefill(
      [existing],
      payload({ nama_toko: 'Toko dari Tool', sku_listed: 100, sku_aktif: 80 }),
    );
    expect(channels[0].nama_toko).toBe('Toko Punya AM'); // dipertahankan
    expect(channels[0].sku_listed).toBe('999'); // dipertahankan
    expect(channels[0].sku_aktif).toBe('80'); // yang kosong terisi
    expect(summary.fieldsSkipped).toBeGreaterThanOrEqual(2);
  });

  it('memetakan nilai persen apa adanya (0..100), bukan pecahan', () => {
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({ conversion_rate_persen: 3.2, chat_response_rate_persen: 98, pesanan_terlambat_persen: 1.5 }),
    );
    expect(channels[0].conversion_rate_persen).toBe('3.2');
    expect(channels[0].chat_response_rate_persen).toBe('98');
    expect(channels[0].pesanan_terlambat_persen).toBe('1.5');
  });

  it('memetakan uang sebagai string rupiah major polos (siap money.parse)', () => {
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({ gmv_affiliate: '9000000', gmv_video: '12500000', top_sku: [{ nama: 'Serum A', gmv: '5000000' }] }),
    );
    expect(channels[0].gmv_affiliate).toBe('9000000');
    expect(channels[0].gmv_video).toBe('12500000');
    expect(channels[0].top_sku[0]).toEqual({
      nama: 'Serum A',
      gmv: '5000000',
      unit_terjual: '',
      harga_jual: '',
      margin_persen: '',
    });
  });

  it('mengisi list (top_sku/top_kreator/top_keyword/stok kritis) hanya bila list tujuan kosong', () => {
    const withSku: ChannelDraft = {
      ...blankChannel('TikTok Shop'),
      top_sku: [{ nama: 'SKU lama AM', gmv: '1', unit_terjual: '', harga_jual: '', margin_persen: '' }],
    };
    const { channels } = applyVideoFactoryPrefill(
      [withSku],
      payload({
        top_sku: [{ nama: 'SKU tool', gmv: '2' }],
        top_kreator: [{ nama: '@kreator', gmv: '3' }],
        top_keyword: [{ keyword: 'serum wajah' }],
        sku_stok_kritis: ['SKU tipis'],
      }),
    );
    expect(channels[0].top_sku).toHaveLength(1); // list AM dipertahankan
    expect(channels[0].top_sku[0].nama).toBe('SKU lama AM');
    expect(channels[0].top_kreator).toEqual([{ nama: '@kreator', gmv: '3' }]);
    expect(channels[0].top_keyword).toEqual([{ keyword: 'serum wajah', jumlah_order: '' }]);
    expect(channels[0].sku_stok_kritis).toEqual(['SKU tipis']);
  });

  it('top_kreator: nama = NAMA KREATOR, gmv = RUPIAH (bukan tertukar)', () => {
    // Regresi bug v4: nilai GMV sempat masuk ke kolom nama kreator, dan
    // hitungan (jumlah video) masuk ke kolom GMV. Payload v5 harus tepat.
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({
        top_kreator: [
          { nama: 'EVEBAG INDONESIA', gmv: '8455428' },
          { nama: 'Robi Bois', gmv: '6882640' },
        ],
      }),
    );
    expect(channels[0].top_kreator).toEqual([
      { nama: 'EVEBAG INDONESIA', gmv: '8455428' },
      { nama: 'Robi Bois', gmv: '6882640' },
    ]);
    // nama tidak boleh berupa string rupiah, gmv tidak boleh nama
    expect(channels[0].top_kreator[0].nama).not.toMatch(/^Rp|^\d+$/);
    expect(channels[0].top_kreator[0].gmv).toMatch(/^\d+$/);
  });

  it('top_sku membawa unit_terjual + harga_jual dari payload v5', () => {
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({ top_sku: [{ nama: 'EVEBAG BM720', gmv: '26424580', unit_terjual: '91', harga_jual: '290380' }] }),
    );
    expect(channels[0].top_sku[0]).toEqual({
      nama: 'EVEBAG BM720',
      gmv: '26424580',
      unit_terjual: '91',
      harga_jual: '290380',
      margin_persen: '',
    });
  });

  it('B-5.3 tipe_kampanye diisi sebagai key bila kosong, tak ditimpa, dan dilewati bila "tidak ada"', () => {
    // kosong → terisi
    const a = applyVideoFactoryPrefill([], payload({ tipe_kampanye: ['video_ads', 'live_ads'] }));
    expect(a.channels[0].tipe_kampanye).toEqual(['video_ads', 'live_ads']);
    // sudah ada isi AM → dipertahankan
    const existing: ChannelDraft = { ...blankChannel('TikTok Shop'), tipe_kampanye: ['gmv_max'] };
    const b = applyVideoFactoryPrefill([existing], payload({ tipe_kampanye: ['video_ads'] }));
    expect(b.channels[0].tipe_kampanye).toEqual(['gmv_max']);
    // ditandai "tidak ada kampanye" → jangan diisi
    const none: ChannelDraft = { ...blankChannel('TikTok Shop'), tipe_kampanye_tidak_ada: true };
    const c = applyVideoFactoryPrefill([none], payload({ tipe_kampanye: ['video_ads'] }));
    expect(c.channels[0].tipe_kampanye).toEqual([]);
  });

  it('B-2.3 komposisi trafik dipetakan apa adanya (boleh tumpang-tindih, kartu→luar)', () => {
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({
        trafik_organik_persen: 31.11,
        trafik_iklan_persen: 128.97,
        trafik_affiliate_persen: 46.73,
        trafik_live_persen: 4.14,
        trafik_video_persen: 34,
        trafik_luar_persen: 15.13,
      }),
    );
    expect(channels[0].trafik_organik_persen).toBe('31.11');
    expect(channels[0].trafik_iklan_persen).toBe('128.97'); // overlay >100% tidak dipangkas
    expect(channels[0].trafik_affiliate_persen).toBe('46.73');
    expect(channels[0].trafik_video_persen).toBe('34');
    expect(channels[0].trafik_luar_persen).toBe('15.13'); // bucket "Kartu Produk"
  });

  it('B-7 jam_live_per_bulan dipetakan; nama host TIDAK masuk enum host_live', () => {
    // host_live di CDPS adalah ENUM (internal_klien/vendor/tim_mea/belum_ada).
    // Payload lama keliru mengirim NAMA host di sini; kalau dipetakan, validasi
    // bentuk Section B menolaknya dan MENGGAGALKAN seluruh simpan (bug QA
    // 2026-08-22, klien EVEBAG). Nama host free-text harus diabaikan di sini.
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({ jam_live_per_bulan: 50.8, host_live: 'EVEBAG INDONESIA, Robi Bois' }),
    );
    expect(channels[0].jam_live_per_bulan).toBe('50.8');
    expect(channels[0].host_live).toBe(''); // free-text names dropped, not enum
  });

  it('B-7 host_live diisi bila payload mengirim KEY enum yang sah', () => {
    const { channels } = applyVideoFactoryPrefill([], payload({ host_live: 'vendor' }));
    expect(channels[0].host_live).toBe('vendor');
  });

  it('B-7 nama host disimpan sebagai catatan bebas (studio_catatan), bukan enum', () => {
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({ studio_catatan: 'Host live: EVEBAG INDONESIA, Robi Bois' }),
    );
    expect(channels[0].studio_catatan).toBe('Host live: EVEBAG INDONESIA, Robi Bois');
    expect(channels[0].host_live).toBe('');
  });

  // Regresi bug lanjutan STRG-202608-0001 (owner report 2026-08-26): AM
  // tempel ulang payload Video Factory ("AM Baseline") ke Section B, tapi
  // kolom Baseline di D-2 tetap kosong. Root cause SEBENARNYA: payload tool
  // tidak pernah membawa baris B-1 (gmv/jumlah_pesanan per bulan) sama
  // sekali — `applyVideoFactoryPrefill` tidak punya apa pun untuk ditulis ke
  // `ChannelDraft.baseline`, terlepas dari perbaikan filter `.every`→`.some`
  // di Section B (itu memperbaiki bug lain: bulan yang SUDAH terkirim
  // sebagian tapi dibuang saat simpan — bukan bulan yang tidak pernah
  // terkirim). Tool sekarang menyertakan `baseline` (rata-rata GMV/pesanan
  // per bulan jendela); adapter ini harus menuliskannya ke `next.baseline`.
  it('B-1 baseline bulanan: payload `baseline` (rata-rata GMV/pesanan per bulan) mengisi ChannelDraft.baseline yang masih kosong', () => {
    const { channels, summary } = applyVideoFactoryPrefill(
      [],
      payload({
        periode_baseline_bulan: 3,
        baseline: [
          { month_index: 1, gmv: '20000000', jumlah_pesanan: 1000 },
          { month_index: 2, gmv: '20000000', jumlah_pesanan: 1000 },
          { month_index: 3, gmv: '20000000', jumlah_pesanan: 1000 },
        ],
      }),
    );
    expect(channels[0].baseline).toEqual([
      { month_index: 1, gmv: '20000000', jumlah_pesanan: '1000', persen_batal: '', ad_spend: '', roas: '', acos: '' },
      { month_index: 2, gmv: '20000000', jumlah_pesanan: '1000', persen_batal: '', ad_spend: '', roas: '', acos: '' },
      { month_index: 3, gmv: '20000000', jumlah_pesanan: '1000', persen_batal: '', ad_spend: '', roas: '', acos: '' },
    ]);
    expect(summary.fieldsFilled).toBeGreaterThanOrEqual(6); // 3 bulan × (gmv + jumlah_pesanan)
  });

  it('B-1 baseline bulanan: tidak menimpa bulan yang sudah diketik AM (per FIELD, bukan per baris)', () => {
    const existing: ChannelDraft = {
      ...blankChannel('TikTok Shop'),
      baseline: [
        {
          month_index: 1,
          gmv: '99000000', // AM sudah ketik — harus dipertahankan
          jumlah_pesanan: '',
          persen_batal: '',
          ad_spend: '',
          roas: '',
          acos: '',
        },
      ],
    };
    const { channels } = applyVideoFactoryPrefill(
      [existing],
      payload({ baseline: [{ month_index: 1, gmv: '1', jumlah_pesanan: 500 }] }),
    );
    const m1 = channels[0].baseline.find((m) => m.month_index === 1)!;
    expect(m1.gmv).toBe('99000000'); // dipertahankan
    expect(m1.jumlah_pesanan).toBe('500'); // yang kosong terisi
  });

  it('membiarkan channel lain (mis. Shopee) tak tersentuh', () => {
    const shopee = { ...blankChannel('Shopee'), nama_toko: 'Toko Shopee' };
    const { channels } = applyVideoFactoryPrefill([shopee], payload({ sku_listed: 50 }));
    expect(channels).toHaveLength(2);
    expect(channels[0].channel).toBe('Shopee');
    expect(channels[0].nama_toko).toBe('Toko Shopee');
    expect(channels[1].channel).toBe('TikTok Shop');
    expect(channels[1].sku_listed).toBe('50');
  });
});
