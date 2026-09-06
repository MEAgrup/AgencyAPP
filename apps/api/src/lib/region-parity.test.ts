/**
 * Penjaga region deploy — ketiga app Vercel HARUS dipin ke `sin1`.
 *
 * ⚠️ ADA KARENA SEBUAH KELUHAN NYATA, dan bentuknya adalah pelajarannya.
 *
 * Data CDPS ada di Supabase **Singapura** dan penggunanya ada di **Indonesia**.
 * `apps/api` dipin ke `sin1` pada 2026-09-04 (P1) — tapi `web-internal` dan
 * `web-client-portal` tidak punya `vercel.json` sama sekali, jadi keduanya
 * mendarat di default Vercel: **`iad1`, Washington DC**.
 *
 * Itu BUKAN sekadar soal halaman: `web-internal/next.config.ts` mem-*rewrite*
 * SELURUH `/api/v1/*` ke `apps/api`, jadi setiap panggilan API menempuh
 *
 *     browser (ID) → web-internal (US East) → apps/api (SG) → Supabase (SG)
 *
 * — menyeberangi Pasifik dua kali untuk membaca baris yang, diukur langsung di
 * live, butuh **0,15 ms** (daftar notifikasi) sampai **1,9 ms** (daftar klien
 * lengkap dengan RLS). Satu halaman memuat ~10 panggilan seperti itu.
 *
 * Kenapa ini perlu dipaku sebagai TES dan bukan sekadar dibetulkan sekali:
 * region adalah setelan yang **tidak terlihat di mana pun saat rusak**. Nol
 * galat, nol log merah, nol tes gagal — aplikasinya hanya terasa lambat, dan
 * "terasa lambat" tidak pernah sampai ke backlog sebagai bug. Berkas
 * `vercel.json` yang hilang persis seperti itu selama dua hari.
 *
 * ⛔ Kalau suatu saat region-nya memang perlu diubah (mis. DB pindah), ubah
 * `WAJIB` di bawah DAN tulis entri `docs/DECISIONS.md` — jangan hapus tesnya.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Region yang benar untuk seluruh app: sama dengan region Supabase. */
const WAJIB = 'sin1';

/** Ketiga app Vercel di repo ini. Menambah app keempat = menambah baris di sini. */
const APPS = ['apps/api', 'web-internal', 'web-client-portal'] as const;

const bacaConfig = (app: string): { regions?: unknown } => {
  const p = join(REPO_ROOT, app, 'vercel.json');
  // Sengaja TIDAK di-try/catch: `vercel.json` yang hilang ADALAH kegagalannya,
  // dan galat "file tidak ada" sudah menyebut berkas mana yang kurang.
  return JSON.parse(readFileSync(p, 'utf8')) as { regions?: unknown };
};

describe('region deploy Vercel', () => {
  it.each(APPS)('%s dipin ke sin1 — bukan default iad1', (app) => {
    expect(bacaConfig(app).regions, `${app}/vercel.json`).toEqual([WAJIB]);
  });

  it('ketiganya di region yang SAMA — beda region = satu hop lintas benua', () => {
    // Kasus yang benar-benar terjadi: `apps/api` sudah `sin1` sementara
    // `web-internal` masih default. Menguji tiap app satu per satu saja tidak
    // cukup untuk menyatakan itu salah — yang salah adalah PASANGANNYA, karena
    // rewrite `/api/v1/*` menjadikan jarak antar keduanya biaya per-request.
    const region = APPS.map((a) => JSON.stringify(bacaConfig(a).regions));
    expect(new Set(region).size, `region berbeda antar app: ${APPS.map((a, i) => `${a}=${region[i]}`).join(', ')}`)
      .toBe(1);
  });

  it('web-internal mem-proxy /api/v1/* — alasan region-nya ikut menentukan latensi API', () => {
    // Kalau rewrite ini suatu hari dicabut (browser memanggil apps/api
    // langsung), alasan tes di atas berubah dan komentarnya harus ikut
    // diperbarui. Memaku premisnya di sini supaya perubahan itu tidak lewat
    // tanpa ada yang memikirkannya.
    const cfg = readFileSync(join(REPO_ROOT, 'web-internal/next.config.ts'), 'utf8');
    expect(cfg).toContain("source: '/api/v1/:path*'");
  });
});
