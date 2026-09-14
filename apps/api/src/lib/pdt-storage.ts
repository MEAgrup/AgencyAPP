/**
 * PDT (Pusat Data Toko) — akses ke bucket privat `pdt-raw` (G1-04 unduh, Rule
 * 44: "akses hanya lewat signed URL berumur ≤ 15 menit"; G1-09-BODY-BESAR
 * unggah + unduh-server-ke-server, `docs/DECISIONS.md` 2026-09-13).
 *
 * Framework-free (pola sama `gotrue.ts`): hanya Web `fetch`/`Response`,
 * `fetchImpl` bisa disuntik supaya diuji tanpa jaringan nyata. Memanggil
 * Storage REST API langsung (bukan SDK `@supabase/supabase-js`) — konsisten
 * dengan housing style repo ini (nol dependensi SDK tambahan; `packages/db`
 * pun bicara Postgres murni lewat `postgres`, bukan client Supabase).
 *
 * Service-role key TIDAK PERNAH sampai ke browser — fungsi ini hanya dipanggil
 * dari route handler server. `buatPdtRawSignedUrl` (unduh) dipanggil mis. saat
 * AM mengklik "unduh paket asli"; `buatPdtRawSignedUploadUrl` (unggah) dan
 * `unduhPdtRawObjek` (unduh server-ke-server) dipanggil dari route
 * preview/commit — lihat catatan G1-09-BODY-BESAR di kepala masing-masing
 * fungsi. Pengecekan `canUploadBatch`/`canReadBatch` ada di lapisan pemanggil
 * (`packages/domain`), BUKAN di sini — berkas ini murni pembungkus REST, nol
 * keputusan otorisasi.
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

interface UploadSignResponse {
  url?: string;
  message?: string;
}

/**
 * Buat signed URL UNGGAH untuk satu objek di bucket `pdt-raw` — pasangan
 * `buatPdtRawSignedUrl` (yang untuk UNDUH). Penutup `G1-09-BODY-BESAR`
 * (`docs/DECISIONS.md` 2026-09-13): browser meng-unggah ZIP LANGSUNG ke
 * Storage lewat URL ini — ZIP TIDAK PERNAH lewat badan request route Next.js
 * (limit keras platform 4,5 MB, jauh di bawah Rule 42 ≤ 50 MB).
 *
 * BEDA dari signed URL unduh: endpoint Storage untuk upload-sign
 * (`/object/upload/sign/...`) TIDAK menerima parameter `expiresIn` di badan
 * request seperti `/object/sign/...` (Rule 44) — durasi token unggah
 * ditentukan Storage sendiri, bukan pemanggil. Bentuk request/response ini
 * BELUM diverifikasi ke Storage REST sungguhan (lihat `describeLive` di
 * bawah — di-skip tanpa `SUPABASE_SERVICE_ROLE_KEY`, pola sama G1-04).
 */
export async function buatPdtRawSignedUploadUrl(path: string, fetchImpl?: FetchLike): Promise<string> {
  const { url, serviceRoleKey } = config();
  const doFetch = fetchImpl ?? fetch;

  const res = await doFetch(`${url}/storage/v1/object/upload/sign/pdt-raw/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({}),
  });

  const body = (await res.json().catch(() => ({}))) as UploadSignResponse;
  if (!res.ok || !body.url) {
    throw new Error(`gagal membuat signed upload URL pdt-raw/${path}: ${res.status} ${body.message ?? ''}`.trim());
  }
  return `${url}/storage/v1${body.url}`;
}

/**
 * Unggah (upsert) isi objek ke bucket `pdt-raw` LANGSUNG dengan service-role
 * key (server-ke-server, pasangan `unduhPdtRawObjek`) — dipakai commit
 * (G1-09 sub-langkah 2a) untuk menulis paket ZIP yang sudah diunduh+diparse
 * dari path STAGING ke path FINAL Rule 44
 * (`{client_id}/{client_platform_id}/{periode_selesai}/{batch_id}.zip`).
 *
 * SENGAJA unggah ulang byte yang sudah ada di memori (`buf` dari
 * `unduhPdtRawObjek` di route commit), BUKAN "move" storage-ke-storage:
 * Supabase Storage REST tidak seragam menyediakan move server-side yang
 * murah untuk kasus ini, dan byte-nya toh sudah di tangan pemanggil (nol
 * unduhan tambahan). Objek staging lama TIDAK dihapus di sini — ia jadi
 * objek "yatim" yang Rule 49 sudah antisipasi (purge > 7 hari), sama seperti
 * `siapkanUploadBatch` sudah mendokumentasikan untuk staging yang tidak
 * pernah dipakai sama sekali.
 */
export async function unggahPdtRawObjek(path: string, isi: Buffer, fetchImpl?: FetchLike): Promise<void> {
  const { url, serviceRoleKey } = config();
  const doFetch = fetchImpl ?? fetch;

  const res = await doFetch(`${url}/storage/v1/object/pdt-raw/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'x-upsert': 'true',
    },
    body: isi as unknown as BodyInit, // Buffer implements Uint8Array/ArrayBufferView — lib.dom.d.ts's BodyInit union just doesn't say so nominally
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`gagal mengunggah pdt-raw/${path}: ${res.status} ${body}`.trim());
  }
}

/**
 * Unduh isi objek dari bucket `pdt-raw` LANGSUNG dengan service-role key
 * (server-ke-server, nol token sementara — beda dari `buatPdtRawSignedUrl`
 * yang untuk browser). Dipakai route preview/commit untuk membaca ZIP yang
 * sudah diunggah AM lewat `buatPdtRawSignedUploadUrl`. Panggilan fetch INI
 * adalah OUTBOUND dari function serverless (bukan badan request MASUK) —
 * tidak tersentuh limit 4,5 MB Vercel yang memicu `G1-09-BODY-BESAR`.
 */
export async function unduhPdtRawObjek(path: string, fetchImpl?: FetchLike): Promise<Buffer> {
  const { url, serviceRoleKey } = config();
  const doFetch = fetchImpl ?? fetch;

  const res = await doFetch(`${url}/storage/v1/object/pdt-raw/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'GET',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!res.ok) {
    throw new Error(`gagal mengunduh pdt-raw/${path}: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
