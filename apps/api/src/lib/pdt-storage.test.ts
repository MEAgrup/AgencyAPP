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
import { buatPdtRawSignedUploadUrl, buatPdtRawSignedUrl, PDT_RAW_SIGNED_URL_MAX_DETIK, unduhPdtRawObjek } from './pdt-storage';

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

describe('buatPdtRawSignedUploadUrl (G1-09-BODY-BESAR) — bentuk request (fetch disuntik)', () => {
  it('POST ke endpoint upload/sign bucket pdt-raw dengan service-role key, NOL expiresIn di body (beda dari signed URL unduh)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://proj.supabase.co/storage/v1/object/upload/sign/pdt-raw/_staging/CLI-1/1/abc.zip');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.apikey).toBe('service-role-key');
      expect(headers.Authorization).toBe('Bearer service-role-key');
      expect(JSON.parse(init?.body as string)).toEqual({});
      return jsonResponse({ url: '/object/upload/sign/pdt-raw/_staging/CLI-1/1/abc.zip?token=upl-token' });
    });
    const out = await buatPdtRawSignedUploadUrl('_staging/CLI-1/1/abc.zip', fetchImpl);
    expect(out).toBe('https://proj.supabase.co/storage/v1/object/upload/sign/pdt-raw/_staging/CLI-1/1/abc.zip?token=upl-token');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('melempar error yang menyebut status saat Storage API menolak', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'not_found' }, 404));
    await expect(buatPdtRawSignedUploadUrl('tidak-ada.zip', fetchImpl)).rejects.toThrow(/404/);
  });

  it('melempar error server saat Supabase belum dikonfigurasi', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(buatPdtRawSignedUploadUrl('a.zip', vi.fn())).rejects.toThrow(/tidak dikonfigurasi/);
  });
});

describe('unduhPdtRawObjek (G1-09-BODY-BESAR) — bentuk request (fetch disuntik)', () => {
  it('GET langsung ke objek bucket pdt-raw dengan service-role key (nol signed URL — server-ke-server)', async () => {
    const isi = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://proj.supabase.co/storage/v1/object/pdt-raw/_staging/CLI-1/1/abc.zip');
      expect(init?.method).toBe('GET');
      const headers = init?.headers as Record<string, string>;
      expect(headers.apikey).toBe('service-role-key');
      expect(headers.Authorization).toBe('Bearer service-role-key');
      return new Response(isi, { status: 200 });
    });
    const out = await unduhPdtRawObjek('_staging/CLI-1/1/abc.zip', fetchImpl);
    expect(out).toEqual(Buffer.from(isi));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('melempar error yang menyebut status saat objek tidak ditemukan (mis. staging kedaluwarsa/belum pernah diunggah)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'not_found' }), { status: 404 }));
    await expect(unduhPdtRawObjek('tidak-ada.zip', fetchImpl)).rejects.toThrow(/404/);
  });

  it('melempar error server saat Supabase belum dikonfigurasi', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(unduhPdtRawObjek('a.zip', vi.fn())).rejects.toThrow(/tidak dikonfigurasi/);
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

// ---------------------------------------------------------------------------
// G1-09-BODY-BESAR: "signed upload URL benar-benar menerima PUT, dan objeknya
// bisa diunduh balik lewat unduhPdtRawObjek" — bentuk request/response
// upload-sign BELUM PERNAH diverifikasi ke Storage REST sungguhan sebelum
// sesi ini (lihat catatan di `buatPdtRawSignedUploadUrl`). Sama seperti
// suite di atas: di-skip tanpa SUPABASE_SERVICE_ROLE_KEY, TIDAK tersedia di
// sandbox sesi ini — dijalankan pertama kali oleh siapa pun yang punya
// kredensial CDPS SG sungguhan.
// ---------------------------------------------------------------------------
describeLive('buatPdtRawSignedUploadUrl + unduhPdtRawObjek — Storage REST sungguhan (pdt-raw)', () => {
  const objectPath = `_g1_09_body_besar_selftest/${Date.now()}.zip`;
  const isi = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]); // EOCD ZIP kosong minimal

  it('PUT ke signed upload URL benar-benar menyimpan objek; unduhPdtRawObjek membacanya balik', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

    try {
      const uploadUrl = await buatPdtRawSignedUploadUrl(objectPath);
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/zip' },
        body: isi,
      });
      expect(put.ok).toBe(true);

      const balik = await unduhPdtRawObjek(objectPath);
      expect(balik).toEqual(Buffer.from(isi));
    } finally {
      await fetch(`${url}/storage/v1/object/pdt-raw/${objectPath}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
    }
  }, 20_000);
});
