/**
 * PDT (Pusat Data Toko) — signed URL untuk bucket privat `pdt-raw` (G1-04,
 * PRD Rule 44: "akses hanya lewat signed URL berumur ≤ 15 menit").
 *
 * Framework-free (pola sama `gotrue.ts`): hanya Web `fetch`/`Response`,
 * `fetchImpl` bisa disuntik supaya diuji tanpa jaringan nyata. Memanggil
 * Storage REST API langsung (bukan SDK `@supabase/supabase-js`) — konsisten
 * dengan housing style repo ini (nol dependensi SDK tambahan; `packages/db`
 * pun bicara Postgres murni lewat `postgres`, bukan client Supabase).
 *
 * Service-role key TIDAK PERNAH sampai ke browser — fungsi ini hanya dipanggil
 * dari route handler server (mis. AM mengklik "unduh paket asli" pada batch
 * yang boleh ia baca; pengecekan `canReadBatch`-nya di lapisan pemanggil,
 * BUKAN di sini — fungsi ini murni pembungkus REST, nol keputusan otorisasi).
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Rule 44 — 15 menit adalah PLAFON, bukan default yang bisa dilewati pemanggil. */
export const PDT_RAW_SIGNED_URL_MAX_DETIK = 15 * 60;

function config(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase URL / service role key tidak dikonfigurasi');
  }
  return { url, serviceRoleKey };
}

interface SignResponse {
  signedURL?: string;
  message?: string;
}

/**
 * Buat signed URL untuk satu objek di bucket `pdt-raw`. `expiresInDetik`
 * DIKLEM ke `PDT_RAW_SIGNED_URL_MAX_DETIK` (Rule 44) — pemanggil tidak bisa
 * meminta umur lebih panjang lewat parameter ini.
 */
export async function buatPdtRawSignedUrl(
  path: string,
  expiresInDetik: number,
  fetchImpl?: FetchLike,
): Promise<string> {
  const { url, serviceRoleKey } = config();
  const doFetch = fetchImpl ?? fetch;
  const expiresIn = Math.max(1, Math.min(expiresInDetik, PDT_RAW_SIGNED_URL_MAX_DETIK));

  const res = await doFetch(`${url}/storage/v1/object/sign/pdt-raw/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ expiresIn }),
  });

  const body = (await res.json().catch(() => ({}))) as SignResponse;
  if (!res.ok || !body.signedURL) {
    throw new Error(`gagal membuat signed URL pdt-raw/${path}: ${res.status} ${body.message ?? ''}`.trim());
  }
  return `${url}/storage/v1${body.signedURL}`;
}
