/**
 * B4 — usulan Co-Pilot server → baris Section E.
 *
 * Satu invarian di sini pernah benar-benar menggigit produksi dan wajib dipaku:
 * label pengelompokan pilar masuk `detail`, BUKAN `peran`. `ck_strpil_peran`
 * adalah enum peran SKU tertutup, jadi `peran: 'Pilar 1 — VIDEO'` membuat INSERT
 * `savePillars` melempar galat Postgres tak terpetakan yang sampai ke AM sebagai
 * "internal server error" (`DECISIONS.md`:500).
 */
import { describe, expect, it } from 'vitest';
import { COCKPIT_SCHEMA_COPILOT, mergeCockpitPillars } from './strategi-cockpit-import';
import { buildCopilotPillars, kunciAksi, labelChannel, semuaKunci } from './strategi-copilot';
import type { StrategiCopilotUsulan } from './strategi';

function aksi(kode: string, jenis: string, nama: string, over = {}) {
  return {
    kode,
    pilar: 'VIDEO',
    divisi: 'Creative',
    jenis,
    nama,
    deskripsi: 'd',
    jembatan: 'Median VV video toko',
    unit: 'VV',
    arah: 'naik',
    minggu_terlihat: 3,
    field_id_bukti: 'B-7.1',
    quick_win: false,
    nilai_sekarang: 10,
    target_hitung: 12.5,
    aturan_terkunci: null,
    alasan: 'videoSalesToko 10,00 di bawah 25,00 (benchmark vidSalesToko)',
    target: 'jembatan Median VV video toko: 10,0 VV → 12,5 VV dalam 3 minggu',
    angle: [] as { judul: string; ringkas: string }[],
    catatan: null,
    ...over,
  } as StrategiCopilotUsulan['channels'][number]['pilar'][number]['aksi'][number];
}

function usulan(): StrategiCopilotUsulan {
  return {
    interview_id: 'ITV-202608-0001',
    channels: [
      {
        client_platform_id: 7,
        platform: 'TikTok Shop',
        channel: 'TikTok Shop',
        channel_lain: null,
        metode_baseline: 'analisa_penuh',
        payload_schema: 'cdps.baseline.tiktok.v1',
        payload_terbaca: true,
        periode_referensi: 'Agu 2026',
        benchmark_versi: 1,
        catatan: [],
        pilar: [
          {
            urutan: 1,
            pilar: 'VIDEO',
            label: 'Pilar 1 — VIDEO',
            jenis: 'konten',
            divisi: 'Creative',
            skor_baseline: 21,
            aksi: [
              aksi('V1', 'konten', 'Hook baru / 3 hook baku'),
              aksi('V3', 'konten', 'Replika video menjual', {
                angle: [
                  { judul: 'A tutorial', akun: 'toko.a', gmv: 9e6, gpm: 12e4, vv: 75e3, tuntas: 0.42, ctr: 0.051, ringkas: 'A tutorial — GPM Rp. 120.000,00' },
                ],
              }),
            ],
          },
          {
            urutan: 2,
            pilar: 'ADS',
            label: 'Pilar 2 — ADS',
            jenis: 'iklan',
            divisi: 'Ads',
            skor_baseline: 38,
            aksi: [aksi('D3', 'iklan', 'Rombak struktur kampanye')],
          },
        ],
      },
    ],
  };
}

describe('buildCopilotPillars', () => {
  it('⚠️ label pilar masuk detail, dan `peran` SELALU null (ck_strpil_peran)', () => {
    const rows = buildCopilotPillars(usulan(), new Set(semuaKunci(usulan())));
    expect(rows.every((r) => r.peran === null)).toBe(true);
    expect(rows[0].detail.pilar).toBe('Pilar 1 — VIDEO');
    // Tidak ada nilai enum peran SKU yang bocor ke kolom peran.
    for (const r of rows) {
      expect(['hero', 'pendamping', 'bundling', 'baru', 'dimatikan']).not.toContain(r.peran);
    }
  });

  it('hanya membuat baris untuk aksi yang dicentang', () => {
    const u = usulan();
    const pilih = new Set([kunciAksi(u.channels[0], u.channels[0].pilar[0].aksi[0])]);
    const rows = buildCopilotPillars(u, pilih);
    expect(rows).toHaveLength(1);
    expect(rows[0].aksi).toBe('V1 Hook baru / 3 hook baku');
  });

  it('tidak ada yang dicentang ⇒ tidak ada baris (bukan menyimpan semuanya)', () => {
    expect(buildCopilotPillars(usulan(), new Set())).toEqual([]);
  });

  it('jenis tiap baris diambil dari aksinya, dan `urutan` berurutan dari 1', () => {
    const u = usulan();
    const rows = buildCopilotPillars(u, new Set(semuaKunci(u)));
    expect(rows.map((r) => r.jenis)).toEqual(['konten', 'konten', 'iklan']);
    expect(rows.map((r) => r.urutan)).toEqual([1, 2, 3]);
  });

  it('identitas baris `{kode} {nama}` sama dengan jalur Cockpit ⇒ merge memutakhirkan, bukan menduplikasi', () => {
    const u = usulan();
    const rows = buildCopilotPillars(u, new Set(semuaKunci(u)));
    // Baris yang "sudah tersimpan" dari jalur tempel-JSON, identitas sama.
    const existing = [
      {
        id: 1,
        jenis: 'konten',
        channel: 'TikTok Shop',
        urutan: 1,
        sku: null,
        peran: null,
        aksi: 'V1 Hook baru / 3 hook baku',
        target: 'target lama',
        harga_normal: null,
        harga_promo: null,
        floor_price: null,
        vendor_id: null,
        slot_jam: null,
        tarif: null,
        target_gmv_per_jam: null,
        detail: {},
      },
      // Pilar di luar jangkauan Co-Pilot HARUS bertahan.
      {
        id: 2,
        jenis: 'tidak_dikerjakan',
        channel: null,
        urutan: 2,
        sku: null,
        peran: null,
        aksi: 'Bukan bagian kontrak',
        target: '',
        harga_normal: null,
        harga_promo: null,
        floor_price: null,
        vendor_id: null,
        slot_jam: null,
        tarif: null,
        target_gmv_per_jam: null,
        detail: {},
      },
    ] as unknown as Parameters<typeof mergeCockpitPillars>[0];
    const merged = mergeCockpitPillars(existing, rows);
    expect(merged.filter((p) => p.aksi === 'V1 Hook baru / 3 hook baku')).toHaveLength(1);
    expect(merged.some((p) => p.jenis === 'tidak_dikerjakan')).toBe(true);
    expect(merged.find((p) => p.aksi === 'V1 Hook baru / 3 hook baku')!.target).toContain('3 minggu');
  });

  it('detail mencatat provenance, bukti, dan angle video untuk brief Creative', () => {
    const u = usulan();
    const rows = buildCopilotPillars(u, new Set(semuaKunci(u)));
    const v3 = rows.find((r) => r.aksi.startsWith('V3'))!;
    expect(v3.detail.sumber).toBe(COCKPIT_SCHEMA_COPILOT);
    expect(v3.detail.kode_aksi).toBe('V3');
    expect(v3.detail.field_id_bukti).toBe('B-7.1');
    expect(v3.detail.angle_video).toEqual(['A tutorial — GPM Rp. 120.000,00']);
    expect(v3.detail.periode_referensi).toBe('Agu 2026');
    expect(v3.detail.benchmark_versi).toBe(1);
    // Aksi tanpa angle membawa daftar KOSONG, bukan kunci yang hilang.
    const v1 = rows.find((r) => r.aksi.startsWith('V1'))!;
    expect(v1.detail.angle_video).toEqual([]);
  });

  it('tidak pernah mengisi kolom yang bukan miliknya (vendor/harga/slot)', () => {
    const u = usulan();
    for (const r of buildCopilotPillars(u, new Set(semuaKunci(u)))) {
      expect(r.vendor_id).toBeNull();
      expect(r.slot_jam).toBeNull();
      expect(r.harga_normal).toBeNull();
      expect(r.floor_price).toBeNull();
      expect(r.sku).toBeNull();
    }
  });
});

describe('labelChannel / kunciAksi', () => {
  it('memakai channel_lain untuk channel "Lainnya"', () => {
    const c = { ...usulan().channels[0], channel: 'Lainnya', channel_lain: 'Blibli' };
    expect(labelChannel(c)).toBe('Blibli');
  });

  it('memotong nama channel di 32 karakter — batas kolom, bukan galat DB', () => {
    const c = { ...usulan().channels[0], channel: 'Lainnya', channel_lain: 'X'.repeat(50) };
    expect(labelChannel(c)).toHaveLength(32);
  });

  it('kunci aksi unik lintas platform — aksi yang sama di dua channel tidak bertabrakan', () => {
    const u = usulan();
    const a = u.channels[0].pilar[0].aksi[0];
    const lain = { ...u.channels[0], client_platform_id: 9 };
    expect(kunciAksi(u.channels[0], a)).not.toBe(kunciAksi(lain, a));
  });
});
