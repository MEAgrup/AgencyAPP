// ADS-REVISI-UI (tim Advertiser, 2026-10-05) — pengelompokan & penyaringan
// halaman /ads: antrean Brief Ads PER KLIEN (R6), pencarian nama klien (R7),
// dan aksi Jeda/Lanjutkan/Matikan di daftar kampanye (R4).
//
// Dependency-free ON PURPOSE (preseden ads-brief-gate.ts): yang diimpor dari
// lib/ads hanya tipe, jadi modul ini bisa diuji vitest tanpa lib/api.
//
// "Klien saya" adalah KENYAMANAN UI, bukan batas akses: RLS `briefs_select`
// sengaja division-wide (B-1/B-4) — brief Ads lahir tanpa PIC (A-5), dan staff
// harus tetap bisa membuka brief klien yang belum dipegang siapa pun. Filter ini
// hanya memisahkan antrean supaya tidak tercampur dengan klien advertiser lain.

import type { AdsBrief, CampaignListRow } from '@/lib/ads';

/** Normalisasi untuk pencarian: huruf kecil, spasi dirapatkan. */
function norm(v: string): string {
  return v.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True bila `term` (kosong = cocok semua) muncul di salah satu field. */
export function cocokCari(term: string, ...fields: (string | null | undefined)[]): boolean {
  const t = norm(term);
  if (t === '') return true;
  return fields.some((f) => norm(f ?? '').includes(t));
}

/**
 * Klien yang "dihandle" seorang advertiser: klien yang salah satu brief Ads-nya
 * ber-PIC dia, atau yang kampanyenya dia buat.
 */
export function klienSaya(
  briefs: readonly AdsBrief[],
  campaigns: readonly CampaignListRow[],
  employeeId: string,
): Set<string> {
  const out = new Set<string>();
  if (employeeId === '') return out;
  for (const b of briefs) {
    if (b.assigned_pic === employeeId && b.client_id) out.add(b.client_id);
  }
  for (const c of campaigns) {
    if (c.created_by === employeeId && c.client_id) out.add(c.client_id);
  }
  return out;
}

export interface KelompokKlien {
  clientId: string;
  /** Nama toko (brief.client_nama) — '' bila tak diketahui. */
  clientNama: string;
  briefs: AdsBrief[];
}

/**
 * Saring antrean (cari + "klien saya") lalu kelompokkan per klien, urut nama
 * klien; brief di dalam tiap kelompok tetap urutan server (tertua dulu).
 * `hanyaKlien` null = semua klien.
 */
export function kelompokBriefPerKlien(
  briefs: readonly AdsBrief[],
  opts: { cari: string; hanyaKlien: ReadonlySet<string> | null },
): KelompokKlien[] {
  const map = new Map<string, KelompokKlien>();
  for (const b of briefs) {
    if (opts.hanyaKlien && !opts.hanyaKlien.has(b.client_id)) continue;
    if (!cocokCari(opts.cari, b.client_nama, b.client_id, b.title, b.id)) continue;
    const key = b.client_id || '';
    const g = map.get(key) ?? { clientId: key, clientNama: b.client_nama || '', briefs: [] };
    g.briefs.push(b);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) =>
    (a.clientNama || a.clientId || '~').localeCompare(b.clientNama || b.clientId || '~', 'id'),
  );
}

/** Saring daftar kampanye: cari (nama klien / toko / ID) + advertiser (kosong = semua). */
export function saringKampanye(
  campaigns: readonly CampaignListRow[],
  opts: { cari: string; advertiser: string },
): CampaignListRow[] {
  return campaigns.filter(
    (c) =>
      (opts.advertiser === '' || c.created_by === opts.advertiser) &&
      cocokCari(opts.cari, c.client_nama, c.client_toko, c.client_id, c.id),
  );
}

/** Daftar advertiser unik (pembuat kampanye) untuk filter Lead Ads, urut nama. */
export function daftarAdvertiser(campaigns: readonly CampaignListRow[]): { id: string; nama: string }[] {
  const map = new Map<string, string>();
  for (const c of campaigns) {
    if (!map.has(c.created_by)) map.set(c.created_by, c.created_by_nama || c.created_by);
  }
  return [...map.entries()]
    .map(([id, nama]) => ({ id, nama }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

export type AksiKampanye = 'pause' | 'resume' | 'end';

/**
 * Aksi cepat di daftar kampanye per status (STATE_MACHINES §14):
 * [Active] → Jeda / Matikan; [Paused] → Lanjutkan / Matikan. [Setting] butuh
 * tanggal Mulai Iklan, jadi dibuka di halaman detail; [Ended] final.
 */
export function aksiKampanye(status: string): AksiKampanye[] {
  switch (status) {
    case '[Active]':
      return ['pause', 'end'];
    case '[Paused]':
      return ['resume', 'end'];
    default:
      return [];
  }
}
