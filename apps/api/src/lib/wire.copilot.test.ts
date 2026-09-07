/**
 * Nested-key wire contract for the two B-wave response bodies whose payload is
 * three levels deep: `GET /strategi/{id}/copilot` (channel → pilar → aksi →
 * angle) and the B3 half of `GET /strategi/{id}/baseline-prefill`.
 *
 * ## The hole this fills
 *
 * `shape-parity.test.ts` proves the wire interface and the FE interface declare
 * the same KEYS. It reads types, not the converter, so it cannot see a converter
 * that declares `nilai_sekarang` and then never assigns it, or one that assigns
 * `a.nilai` (undefined) instead of `a.nilaiSekarang`. Both mistakes ship a body
 * whose key is present in the type and MISSING at runtime — the O43 class, where
 * the page blanks a figure the server actually had, and CI stays green.
 *
 * The risk is concentrated here because these two bodies are almost entirely
 * nullable numbers: an omitted key and a `null` render the same "—" to a human
 * reading the page, so the defect is invisible until someone asks why the AM is
 * re-typing a number that was on screen last week.
 *
 * ## What is asserted
 *
 * 1. Every declared key is PRESENT on the emitted object, at every level, even
 *    when the domain value is null (`Object.keys`, not truthiness).
 * 2. A null domain field emits an explicit `null`, never `undefined`.
 * 3. The nested arrays keep their order and their per-row keys.
 */
import { describe, expect, it } from 'vitest';
import type { strategi } from '@cdps/domain';
import { strategiCopilotUsulanToWire } from './wire';

const ANGLE = {
  judul: 'A tutorial',
  akun: 'toko.a',
  gmv: 9_000_000,
  gpm: 120_000,
  vv: 75_000,
  tuntas: 0.42,
  ctr: 0.051,
  ringkas: 'A tutorial — GPM Rp. 120.000,00',
};

/** One fully-populated aksi and one all-null aksi — the two shapes that matter. */
function usulan(): strategi.StrategiCopilotUsulan {
  return {
    interviewId: 'ITV-202608-0001',
    channels: [
      {
        clientPlatformId: 7,
        platform: 'TikTok Shop',
        channel: 'TikTok Shop',
        channelLain: null,
        metodeBaseline: 'analisa_penuh',
        usulan: {
          schema: 'cdps.baseline.tiktok.v1',
          periodeReferensi: 'Agu 2026',
          benchmarkVersi: 1,
          payloadTerbaca: true,
          catatan: ['satu catatan'],
          pilar: [
            {
              urutan: 1,
              pilar: 'VIDEO',
              label: 'Pilar 1 — VIDEO',
              jenis: 'konten',
              divisi: 'Creative',
              skorBaseline: 21,
              aksi: [
                {
                  kode: 'V3',
                  pilar: 'VIDEO',
                  divisi: 'Creative',
                  jenis: 'konten',
                  nama: 'Replika video menjual',
                  deskripsi: 'Brief dari Papan Video Factory, angle terbukti',
                  jembatan: 'Hit rate video baru',
                  unit: '%',
                  arah: 'naik',
                  mingguTerlihat: 3,
                  fieldIdBukti: 'B-7.1',
                  quickWin: false,
                  nilaiSekarang: 10,
                  targetHitung: 12.5,
                  aturanTerkunci: { nilai: 15, label: 'Aturan K2', sudahTerlampaui: false },
                  alasan: 'tiga video terbukti menjual',
                  target: 'jembatan Hit rate video baru: 10,0% → 12,5% dalam 3 minggu',
                  angle: [ANGLE],
                  catatan: null,
                },
                {
                  kode: 'D1',
                  pilar: 'ADS',
                  divisi: 'Ads',
                  jenis: 'iklan',
                  nama: 'Seleksi kreatif pakai CTR klik produk',
                  deskripsi: 'Aturan terkunci K2',
                  jembatan: '% spend kreatif 0 order',
                  unit: '%',
                  arah: 'turun',
                  mingguTerlihat: 2,
                  fieldIdBukti: 'B-5.5',
                  quickWin: true,
                  nilaiSekarang: null,
                  targetHitung: null,
                  aturanTerkunci: null,
                  alasan: 'roas di bawah benchmark',
                  target: 'angka sekarang belum ada di payload',
                  angle: [],
                  catatan: 'tanpa blok angle',
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

const KUNCI_AKSI = [
  'kode', 'pilar', 'divisi', 'jenis', 'nama', 'deskripsi', 'jembatan', 'unit', 'arah',
  'minggu_terlihat', 'field_id_bukti', 'quick_win', 'nilai_sekarang', 'target_hitung',
  'aturan_terkunci', 'alasan', 'target', 'angle', 'catatan',
];

describe('strategiCopilotUsulanToWire — nested keys survive the boundary', () => {
  const w = strategiCopilotUsulanToWire(usulan());
  const ch = w.channels[0];
  const pl = ch.pilar[0];

  it('channel level carries every declared key, snake_case', () => {
    expect(Object.keys(ch).sort()).toEqual(
      [
        'benchmark_versi', 'catatan', 'channel', 'channel_lain', 'client_platform_id',
        'metode_baseline', 'payload_schema', 'payload_terbaca', 'periode_referensi',
        'pilar', 'platform',
      ].sort(),
    );
  });

  it('pilar level carries urutan/label/jenis/divisi/skor', () => {
    expect(Object.keys(pl).sort()).toEqual(
      ['aksi', 'divisi', 'jenis', 'label', 'pilar', 'skor_baseline', 'urutan'].sort(),
    );
    expect(pl.label).toBe('Pilar 1 — VIDEO');
    expect(pl.skor_baseline).toBe(21);
  });

  it('every aksi carries all 19 keys — a missing key is worse than a null (O43)', () => {
    for (const a of pl.aksi) expect(Object.keys(a).sort()).toEqual([...KUNCI_AKSI].sort());
  });

  it('null domain fields emit an EXPLICIT null, never undefined', () => {
    const d1 = pl.aksi[1];
    expect(d1.nilai_sekarang).toBeNull();
    expect(d1.target_hitung).toBeNull();
    expect(d1.aturan_terkunci).toBeNull();
    expect('nilai_sekarang' in d1).toBe(true);
    expect(d1.nilai_sekarang).not.toBeUndefined();
  });

  it('aturan_terkunci flattens sudahTerlampaui to snake_case', () => {
    expect(pl.aksi[0].aturan_terkunci).toEqual({
      nilai: 15,
      label: 'Aturan K2',
      sudah_terlampaui: false,
    });
  });

  it('angle rows keep every key and their order', () => {
    expect(pl.aksi[0].angle).toEqual([ANGLE]);
    expect(pl.aksi[1].angle).toEqual([]);
  });

  it('arrays are copied, not shared — a later mutation cannot reach the domain object', () => {
    const u = usulan();
    const out = strategiCopilotUsulanToWire(u);
    out.channels[0].catatan.push('ditambah di wire');
    expect(u.channels[0].usulan.catatan).toEqual(['satu catatan']);
  });
});
