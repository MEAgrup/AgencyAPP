// B4 — usulan AM Co-Pilot (server) → baris Section E siap simpan.
//
// Yang berubah dari sebelumnya: rantai `export JSON → buka /tools/am-copilot →
// centang → tempel JSON` (tiga salin-tempel manual, handoff Gelombang B §4.2)
// diganti satu panggilan `GET /strategi/{id}/copilot`. Yang TIDAK berubah:
// bentuk baris yang disimpan dan jalur simpannya — keduanya tetap
// `CockpitPillarBody` + `saveStrategiPillars` + `mergeCockpitPillars`, karena
// itu identitas baris yang sudah terbukti (`(jenis, channel, aksi)`) dan
// memakai identitas kedua akan menduplikasi pilar yang sama saat AM pernah
// memakai kedua jalur.
//
// `CockpitImportPanel` dan tombol "Salin/Unduh JSON" TETAP dirender: tool HTML
// masih jalur mundur yang sah kalau server belum punya payload analisa.

import { COCKPIT_SCHEMA_COPILOT, type CockpitPillarBody } from '@/lib/strategi-cockpit-import';
import type { StrategiCopilotAksi, StrategiCopilotChannel, StrategiCopilotUsulan } from '@/lib/strategi';

/** Kunci pilihan satu aksi: unik lintas channel (aksi yang sama bisa muncul di dua platform). */
export function kunciAksi(channel: StrategiCopilotChannel, aksi: StrategiCopilotAksi): string {
  return `${channel.client_platform_id}:${aksi.kode}`;
}

/** Label channel yang disimpan di baris pilar — sama dengan yang AM baca di Section B. */
export function labelChannel(c: StrategiCopilotChannel): string {
  const label = c.channel === 'Lainnya' && c.channel_lain ? c.channel_lain : c.channel;
  // `strategi_pillar.channel` adalah varchar(32); nama channel lain yang panjang
  // dipotong di sini, bukan ditolak DB dengan galat yang tak menyebut sebabnya.
  return label.slice(0, 32);
}

/** Semua kunci aksi dalam sebuah usulan — dipakai sebagai pilihan awal (semua tercentang). */
export function semuaKunci(u: StrategiCopilotUsulan): string[] {
  return u.channels.flatMap((c) => c.pilar.flatMap((p) => p.aksi.map((a) => kunciAksi(c, a))));
}

/**
 * Baris pilar dari aksi yang AM centang.
 *
 * ⚠️ `peran` SELALU null. Label pengelompokan pilar ("Pilar 1 — VIDEO") masuk
 * `detail.pilar`, BUKAN `peran`: `ck_strpil_peran` adalah enum peran SKU tertutup
 * ('hero'/'pendamping'/'bundling'/'baru'/'dimatikan'), dan menaruh label di sana
 * membuat INSERT `savePillars` melempar galat Postgres yang tak terpetakan —
 * yang sampai ke AM sebagai "internal server error". Bug ini sudah pernah
 * terjadi (`DECISIONS.md`:500); jangan diulang.
 *
 * `aksi` dirakit `"{kode} {nama}"` — identik dengan `buildCockpitPillars`, supaya
 * `mergeCockpitPillars` mengenali baris dari kedua jalur sebagai baris yang SAMA
 * dan memutakhirkannya di tempat, bukan menambah duplikat.
 */
export function buildCopilotPillars(
  u: StrategiCopilotUsulan,
  dipilih: ReadonlySet<string>,
): CockpitPillarBody[] {
  const out: CockpitPillarBody[] = [];
  let urutan = 1;
  for (const c of u.channels) {
    for (const p of c.pilar) {
      for (const a of p.aksi) {
        if (!dipilih.has(kunciAksi(c, a))) continue;
        out.push({
          jenis: a.jenis,
          channel: labelChannel(c),
          urutan: urutan++,
          sku: null,
          peran: null,
          aksi: `${a.kode} ${a.nama}`,
          target: a.target,
          harga_normal: null,
          harga_promo: null,
          floor_price: null,
          vendor_id: null,
          slot_jam: null,
          tarif: null,
          target_gmv_per_jam: null,
          detail: {
            sumber: COCKPIT_SCHEMA_COPILOT,
            kode_aksi: a.kode,
            field_id_bukti: a.field_id_bukti,
            pilar: p.label,
            jembatan: a.jembatan,
            unit: a.unit,
            arah: a.arah,
            minggu_terlihat: a.minggu_terlihat,
            alasan: a.alasan,
            // E-6 pilar konten: angle video yang SUDAH perform, dibawa apa adanya
            // dari payload baseline supaya `planRowToBriefInput` bisa
            // meneruskannya ke `instructions` brief Creative — itulah "lanjutan
            // brief ke creative" yang pemilik minta (2026-09-06).
            angle_video: a.angle.map((g) => g.ringkas),
            periode_referensi: c.periode_referensi,
            benchmark_versi: c.benchmark_versi,
          },
        });
      }
    }
  }
  return out;
}
