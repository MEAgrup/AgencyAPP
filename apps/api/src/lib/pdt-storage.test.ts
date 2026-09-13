/**
 * Unit tests (fetch disuntik, nol jaringan) untuk bentuk request/response +
 * klem Rule 44 (≤15 menit). Suite terpisah di bawah (`describeLive`) menguji
 * DoD G1-04 "signed URL kedaluwarsa benar-benar menolak" terhadap Storage
 * REST sungguhan — di-skip tanpa `SUPABASE_SERVICE_ROLE_KEY` (pola sama
 * `packages/db/*.registry.test.ts` yang di-skip tanpa `DATABASE_URL`); belum
 * pernah dijalankan di sandbox sesi ini karena kredensial itu tidak tersedia
 * di sini — lihat handoff untuk siapa yang perlu menjalankannya.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buatPdtRawSignedUrl, PDT_RAW_SIGNED_URL_MAX_DETIK } from './pdt-storage';

const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('buatPdtRawSignedUrl — bentuk request (fetch disuntik)', () => {
  it('POST ke endpoint sign bucket pdt-raw dengan service-role key, mengembalikan URL absolut', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://proj.supabase.co/storage/v1/object/sign/pdt-raw/CLI-202601-0001/1/2026-07-31/1.zip');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.apikey).toBe('service-role-key');
      expect(headers.Authorization).toBe('Bearer service-role-key');
      expect(JSON.parse(init?.body as string)).toEqual({ expiresIn: 300 });
      return jsonResponse({ signedURL: '/object/sign/pdt-raw/CLI-202601-0001/1/2026-07-31/1.zip?token=abc' });
    });
    const out = await buatPdtRawSignedUrl('CLI-202601-0001/1/2026-07-31/1.zip', 300, fetchImpl);
    expect(out).toBe('https://proj.supabase.co/storage/v1/object/sign/pdt-raw/CLI-202601-0001/1/2026-07-31/1.zip?token=abc');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('encode tiap segmen path secara terpisah (bukan encode seluruh path sekaligus)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://proj.supabase.co/storage/v1/object/sign/pdt-raw/a%20b/c.zip');
      return jsonResponse({ signedURL: '/object/sign/pdt-raw/a%20b/c.zip?token=x' });
    });
    await buatPdtRawSignedUrl('a b/c.zip', 300, fetchImpl);
  });

  describe('klem Rule 44 — ≤ 15 menit, bukan default yang bisa dilewati pemanggil', () => {
    it('mengklem permintaan di atas 900 detik menjadi 900', async () => {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(init?.body as string)).toEqual({ expiresIn: PDT_RAW_SIGNED_URL_MAX_DETIK });
        return jsonResponse({ signedURL: '/object/sign/pdt-raw/a.zip?token=x' });
      });
      await buatPdtRawSignedUrl('a.zip', 999_999, fetchImpl);
    });

    it('mengklem permintaan nol/negatif menjadi minimal 1 detik', async () => {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(init?.body as string)).toEqual({ expiresIn: 1 });
        return jsonResponse({ signedURL: '/object/sign/pdt-raw/a.zip?token=x' });
      });
      await buatPdtRawSignedUrl('a.zip', -5, fetchImpl);
    });
  });

  it('melempar error yang menyebut status saat Storage API menolak', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'not_found' }, 404));
    await expect(buatPdtRawSignedUrl('tidak-ada.zip', 300, fetchImpl)).rejects.toThrow(/404/);
  });

  it('melempar error server saat Supabase belum dikonfigurasi', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(buatPdtRawSignedUrl('a.zip', 300, vi.fn())).rejects.toThrow(/tidak dikonfigurasi/);
  });
});

// ---------------------------------------------------------------------------
// DoD G1-04: "signed URL kedaluwarsa benar-benar menolak" — terhadap Storage
// REST SUNGGUHAN di CDPS SG. Butuh SUPABASE_SERVICE_ROLE_KEY (dan
// NEXT_PUBLIC_SUPABASE_URL) sungguhan; TIDAK tersedia di sandbox sesi ini —
// di-skip di sini, bukan ditebak hasilnya.
// ---------------------------------------------------------------------------
const describeLive = describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL);

describeLive('buatPdtRawSignedUrl — Storage REST sungguhan (pdt-raw)', () => {
  const objectPath = `_g1_04_selftest/${Date.now()}.zip`;

  it('URL bertoken kedaluwarsa (expiresIn=1, tunggu 2 detik) benar-benar ditolak', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

    const upload = await fetch(`${url}/storage/v1/object/pdt-raw/${objectPath}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/zip' },
      body: new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]), // EOCD ZIP kosong minimal
    });
    expect(upload.ok).toBe(true);

    try {
      const signedUrl = await buatPdtRawSignedUrl(objectPath, 1);
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(signedUrl);
      expect(res.ok).toBe(false);
    } finally {
      await fetch(`${url}/storage/v1/object/pdt-raw/${objectPath}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
    }
  }, 20_000);
});
