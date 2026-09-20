import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blankChannel } from './SectionB';
import { mergeBaselinePrefill } from '@/lib/strategi-baseline-inherit';
import type { StrategiBaselinePrefill } from '@/lib/strategi';

// Regresi laporan pemilik 2026-09-20 (STRG-202609-0008 / CLI-202609-0020,
// Shopee): batch PDT #5 `verified`, fakta lengkap di DB (1.504 baris
// `pdt_sku_master`, 997 `pdt_fact_creator_period`, 14 `pdt_fact_ads`, 7
// `pdt_fact_content`), Interview `Selesai` 17:23:31 — dan channel yang
// disimpan 17:29:04 tetap null di SELURUH field B-3/B-5/B-6/B-7. Gerbangnya
// sudah terbuka; yang putus adalah kabelnya.
//
// Sebabnya: halaman Strategi menjalankan `mergeBaselinePrefill` TEPAT SEKALI,
// saat `getBaselinePrefill` resolve di dalam `load()`, atas daftar channel yang
// ADA pada detik itu. Strategi baru tidak punya satu pun (`createStrategi`
// tidak menyemai channel), jadi merge itu berjalan atas array KOSONG. Channel
// yang AM tambahkan sesudahnya lahir dari `blankChannel()` — dan tidak pernah
// disentuh prefill lagi. Seluruh angka PDT yang sudah dihitung server dibuang
// diam-diam, lalu AM bertemu delapan baris `[data baseline channel belum
// lengkap]` di gerbang submit.
//
// Ini kelas O43 yang sama seperti yang CLAUDE.md peringatkan: dua paruh yang
// dua-duanya benar, kontraknya tidak tersambung. Tidak ada tes lama yang merah
// karena keduanya memang benar SENDIRI-SENDIRI — jadi sambungannya yang
// di-assert di sini.

const SRC = readFileSync(join(__dirname, 'SectionB.tsx'), 'utf8');

function prefillShopee(): StrategiBaselinePrefill {
  return {
    interview_id: 'ITV-202609-0013',
    channels: [
      {
        client_platform_id: 56,
        platform: 'shopee',
        channel: 'Shopee',
        channel_lain: null,
        metode_baseline: 'analisa_penuh',
        kondisi_toko: 'fondasi_perlu_dibenahi',
        skor: 57,
        periode_baseline_bulan: 1,
        cakupan_riwayat: 'kurang',
        alasan_periode_pendek_wajib: true,
        sumber_data: 'fim_motor.shopee-shop-stats.20260701-20260731.xlsx',
        // Jalur PDT: `riset_awal_sumber_berkas.tanggal_ambil` null, jadi angka
        // ini datang dari tanggal unggah batch acuan (perbaikan sisi domain).
        tanggal_ambil_data: '2026-09-20',
        lampiran: null,
        roas: 3.2,
        ad_spend: '1284330288',
        aov: '119762',
        baseline_bulan: [{ month_index: 1, label: 'Jul 2026', gmv: '1515002476', jumlah_pesanan: 12801 }],
        gmv_mix: null,
        payload_schema: 'cdps.baseline.shopee.v1',
        payload_terbaca: true,
        periode_referensi: 'Jul 2026',
        periode_referensi_pdt_saran: '2026-07-01',
        periode_referensi_pdt_opsi: ['2026-07-01'],
        refund_rate_persen: null,
        chat_response_rate_persen: 97.5,
        chat_response_menit: 79,
        poin_penalti: null,
        pengunjung_per_bulan: 361197,
        conversion_rate_persen: 2.32,
        trafik_organik_persen: null,
        trafik_iklan_persen: null,
        trafik_affiliate_persen: null,
        trafik_live_persen: null,
        trafik_video_persen: null,
        trafik_luar_persen: null,
        sku_listed: 1504,
        sku_aktif: 1182,
        sku_pareto_80: 143,
        sku_slow_moving: 604,
        top_sku: [],
        jumlah_kampanye_aktif: 14,
        tipe_kampanye: [],
        affiliate_aktif_30hari: 997,
        gmv_affiliate: '266083989',
        gmv_affiliate_persen: 17.56,
        top_kreator: [],
        sampel_terkirim: null,
        jumlah_video_per_bulan: 6,
        total_views: 9946,
        gmv_video: '408440',
        jam_live_per_bulan: 3,
        gmv_live: '2726560',
      },
    ],
  };
}

describe('channel yang ditambahkan SESUDAH halaman termuat tetap tersemai', () => {
  it('blankChannel + prefill ⇒ seluruh field PDT mendarat (bukan null)', () => {
    const [ch] = mergeBaselinePrefill([blankChannel('Shopee')], prefillShopee());
    // B-0.6 — inilah baris error PERTAMA yang pemilik laporkan.
    expect(ch.sumber_data).not.toBe('');
    expect(ch.tanggal_ambil_data).toBe('2026-09-20');
    expect(ch.periode_baseline_bulan).toBe('1');
    // B-3 / B-5 / B-6 / B-7 — tujuh baris error sisanya.
    expect(ch.sku_listed).toBe('1504');
    expect(ch.sku_aktif).toBe('1182');
    expect(ch.sku_pareto_80).toBe('143');
    expect(ch.sku_slow_moving).toBe('604');
    expect(ch.jumlah_kampanye_aktif).toBe('14');
    expect(ch.affiliate_aktif_30hari).toBe('997');
    expect(ch.gmv_affiliate).toBe('266083989');
    expect(ch.gmv_affiliate_persen).toBe('17.56');
    expect(ch.jumlah_video_per_bulan).toBe('6');
    expect(ch.total_views).toBe('9946');
    expect(ch.gmv_video).toBe('408440');
    expect(ch.jam_live_per_bulan).toBe('3');
    expect(ch.gmv_live).toBe('2726560');
    // B-4.2 dari `pdt_fact_layanan_chat` (Shopee-only).
    expect(ch.chat_response_rate_persen).toBe('97.5');
    expect(ch.chat_response_menit).toBe('79');
  });

  it('field yang memang tidak punya export tetap kosong — melipat bukan mengarang', () => {
    const [ch] = mergeBaselinePrefill([blankChannel('Shopee')], prefillShopee());
    // `shopee_kesehatan` hanya memanen Poin Penalti/Deskripsi/Durasi; rating,
    // jumlah ulasan dan % pesanan terlambat tidak ada kolomnya di export mana
    // pun. B-8.3 PRD-nya "beban promo terhadap MARGIN" — `pdt_fact_promo` cuma
    // membawa penjualan lewat promo, bukan biaya, jadi menurunkannya dari situ
    // berarti memasang label yang salah pada angka yang lain.
    expect(ch.rating_toko).toBe('');
    expect(ch.jumlah_ulasan).toBe('');
    expect(ch.pesanan_terlambat_persen).toBe('');
    expect(ch.beban_promo_persen).toBe('');
    expect(ch.host_live).toBe('');
    expect(ch.komisi_open_persen).toBe('');
  });

  it('tanpa prefill, channel baru tetap lahir kosong dan tidak meledak', () => {
    const baru = blankChannel('Shopee');
    expect(
      mergeBaselinePrefill([baru], { interview_id: 'ITV-202609-0013', channels: [] })[0],
    ).toEqual(baru);
  });

  it('addChannel menyemai lewat mergeBaselinePrefill, bukan mendorong blankChannel mentah', () => {
    const i = SRC.indexOf('const addChannel = () => {');
    expect(i, 'addChannel tidak ditemukan').toBeGreaterThan(-1);
    const body = SRC.slice(i, SRC.indexOf('const removeChannel', i));
    expect(body).toContain('mergeBaselinePrefill');
    expect(body).toContain('baselinePrefill');
    // Baris inilah bug-nya: channel baru masuk daftar tanpa lewat prefill.
    expect(body, 'blankChannel mentah masih didorong langsung ke onChange').not.toMatch(
      /onChange\(\[\.\.\.channels,\s*blankChannel\(/,
    );
  });

  it('mergeBaselinePrefill benar-benar diimpor SectionB (bukan cuma disebut di komentar)', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*\bmergeBaselinePrefill\b[^}]*\}\s*from\s*'@\/lib\/strategi-baseline-inherit'/,
    );
  });
});
