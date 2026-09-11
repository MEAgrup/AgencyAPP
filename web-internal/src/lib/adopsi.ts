// Adopsi Sistem (pemilik 2026-09-10, Bagian 1) — pelapor page-view + pembaca
// laporannya. Bentuk shape-nya mencerminkan apps/api/src/lib/wire.ts
// (adopsiReportToWire) PERSIS — snake_case, tidak pernah dikarang.
//
// Pemilik menegaskan: **"Indikator adaptasi tim ke sistem baru — bukan
// komponen reward."** Itu sebabnya berkas ini nol sambungan ke `/performance`
// dan tidak pernah memberi peringkat, lencana, atau ambang.

import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Pelaporan (dipanggil tiap perpindahan rute).
// ---------------------------------------------------------------------------

export interface PageViewBeacon {
  path: string;
  nav_href: string | null;
  nav_total: number;
}

/**
 * Kirim satu baris log. **Tidak pernah melempar** — dipanggil dari lapisan
 * shell yang membungkus setiap halaman, dan sebuah galat di sini akan muncul
 * sebagai galat pada halaman yang sebenarnya baik-baik saja.
 *
 * `keepalive` supaya permintaan tetap terkirim kalau pengguna langsung
 * berpindah/menutup tab — tanpa itu, page-view terakhir setiap sesi (justru
 * yang menandai kapan sesi berakhir) adalah yang paling sering hilang.
 */
export async function sendPageView(b: PageViewBeacon): Promise<void> {
  try {
    await fetch('/api/v1/adopsi/page-view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify(b),
    });
  } catch {
    // Disengaja: log adopsi tidak pernah boleh merusak halaman yang memanggilnya.
  }
}

// ---------------------------------------------------------------------------
// Laporan (OD/Director).
// ---------------------------------------------------------------------------

export interface AdopsiRow {
  period: string; // "YYYYMM"
  employee_id: string;
  nama: string;
  role: string;
  jam: string; // 2 desimal — SENGAJA kurang, lihat catatan di halaman
  sesi: number;
  page_view: number;
  fitur_dibuka: number;
  fitur_tersedia: number;
  cakupan_fitur_pct: number | null; // "—" saat null
}

export interface AdopsiReport {
  rows: AdopsiRow[];
  mulai_tercatat: string | null; // "YYYY-MM-DD"
}

/**
 * Cermin `adopsi.canViewAdopsi` — OD/Director, atau lead divisi mana pun
 * (ketokan pemilik 2026-09-11, `PR4-SIAPA-BOLEH-LIHAT`). Server tetap
 * otoritasnya, dan CAKUPAN barisnya — lead hanya melihat divisinya — diputuskan
 * di sana saja (`adopsiScopeFor`). Fungsi ini hanya memutuskan apakah layarnya
 * boleh dibuka; ia tidak pernah menyaring baris, justru supaya tidak ada
 * penyaringan kedua yang bisa berselisih dengan server.
 */
export function canViewAdopsi(role: { od?: boolean; director?: boolean; level?: string; division?: string } | null): boolean {
  return !!(role?.od || role?.director || (role?.level === 'lead' && role.division !== ''));
}

/** "202608" → "Agustus 2026". Bulan Indonesia, tanpa menyentuh core/bi.ts (yang bukan milik layar ini). */
const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
export function labelBulan(period: string): string {
  const y = period.slice(0, 4);
  const m = Number(period.slice(4, 6));
  if (!Number.isInteger(m) || m < 1 || m > 12) return period;
  return `${BULAN[m - 1]} ${y}`;
}

export interface AdopsiFilter {
  from?: string; // "YYYY-MM"
  to?: string;
}

function toQuery(f: AdopsiFilter): string {
  const p = new URLSearchParams();
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  const qs = p.toString();
  return qs === '' ? '' : `?${qs}`;
}

// GET /adopsi → {data: AdopsiReport}
export function getAdopsiReport(f: AdopsiFilter = {}): Promise<{ data: AdopsiReport }> {
  return api.get<{ data: AdopsiReport }>(`/adopsi${toQuery(f)}`);
}
