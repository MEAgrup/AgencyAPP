/**
 * PDT (Pusat Data Toko) — predikat izin domain (G1-01, PRD §6.6).
 *
 * K-3: `requirePermission` TIDAK ADA di repo ini (nol hasil grep; PX-M2a
 * 2026-09-12 menolak sistem permission-key). Pola rumah = predikat bernama,
 * ditegakkan RLS di DB. Lingkupnya disalin dari
 * `showcase.canKelolaIzinPitch` (PDT_BACKLOG.md §0 pagar #7): AM pemilik
 * klien yang berbicara langsung dengan kliennya boleh menulis data PDT
 * kliennya sendiri; Director membawa lead di mana pun.
 *
 * Predikat-predikat ini BERDIRI SENDIRI — tidak menumpang predikat modul
 * lain — konsisten dengan ketokan PX-M2a (`docs/DECISIONS.md` 2026-09-12).
 */
import { randomUUID } from 'node:crypto';
import { pdt, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Sql } from '@cdps/db';
import { ACCOUNT_DIVISION, type Actor } from './account';

/**
 * canUploadBatch — siapa yang boleh mengunggah batch PDT untuk sebuah toko
 * klien (Flow A langkah 1-2). AM pemilik klien, atau lead/Director Account.
 */
export function canUploadBatch(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true; // Director membawa lead di mana pun
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/**
 * canKelolaBenchmark — Director SAJA (bukan OD murni). Preseden
 * `adsscanner_benchmark`/`px_eligibility_policy`: kalibrasi ini langsung
 * menggerakkan skor performa klien yang dikirim ke klien, bukan sekadar
 * bidang admin biasa (mayoritas bidang admin CDPS = OD baca, Director tulis).
 */
export function canKelolaBenchmark(actor: Actor): boolean {
  return actor.role.director;
}

/**
 * canKirimLaporan — siapa yang boleh menekan "Kirim ke klien" (Flow B
 * langkah 4, membekukan snapshot ke `pdt_laporan_kiriman`). Lingkup sama
 * seperti `canUploadBatch`: orang yang boleh mengunggah data toko itu adalah
 * orang yang sama yang boleh memutuskan angkanya boleh dikirim ke klien.
 */
export function canKirimLaporan(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

// ===========================================================================
// G1-09 — pratinjau deteksi batch (Flow A langkah 2-5, SEBELUM disimpan).
//
// Ini PEMANGGIL NYATA PERTAMA yang menyambungkan seluruh mesin G1-02..08 ke
// baris `client_platforms`/`clients` sungguhan — sampai G1-08 mesin-mesin itu
// hanya dipanggil dari tes. Sengaja DIBATASI ke pratinjau (nol tulis DB, nol
// upload storage): sub-langkah berikutnya (commit — menulis `pdt_upload_batch`/
// `pdt_file`, mengunggah paket ke bucket `pdt-raw`, rekonsiliasi PDT-16) BELUM
// dibangun di sini — lihat `docs/backlog/PDT_BACKLOG.md` G1-09 dan handoff
// sesi ini untuk batasnya. Pembaca ZIP sungguhan (`apps/api/src/lib/pdt-zip.ts`
// G1-04 + `pdt-parse.ts` G1-05) TIDAK dipanggil dari sini — package ini tidak
// boleh bergantung pada Node fs/yauzl (arah dependensi apps/api → domain,
// bukan sebaliknya) — pemanggil (route handler) yang menjalankannya lebih
// dulu dan menerjemahkan hasilnya ke `PdtPreviewBerkasInput` di bawah.
// ===========================================================================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdtValidationError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = '[Anda tidak berwenang mengunggah data toko ini]') {
    super(message);
    this.name = 'PdtForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'toko klien (client_platform) tidak ditemukan') {
    super(message);
    this.name = 'PdtNotFoundError';
  }
}

/** Satu entri ZIP, APA ADANYA setelah pagar (G1-04) + dekode/deteksi (G1-05). */
export interface PdtPreviewBerkasInput {
  /** Nama entri DI DALAM ZIP (Rule 39 — tidak dipercaya sebagai path, hanya label). */
  nama: string;
  /** `null` untuk entri yang pagar tolak SEBELUM sempat diekstrak (nol bytes sungguhan dibaca). */
  sha256: string | null;
  bytes: number | null;
  /** Terisi bila `evaluatePdtZipPagar` (Rule 41) menolak entri ini SEBELUM ekstraksi — beda dari kegagalan decode. */
  ditolakPagar: { pesan: string } | null;
  /** Terisi bila entri lolos pagar tapi GAGAL diekstrak/didekode (G1-04 `gagalEkstrak` / G1-05 `gagal`). */
  decodeGagal: string | null;
  /** `null` bila `ditolakPagar`/`decodeGagal` terisi. Sheet PERTAMA, array-of-arrays. */
  aoa: readonly (readonly unknown[])[] | null;
  /** Hasil `detectPdtModule` (G1-02) — `null` bila nol/lebih dari satu tanda tangan cocok. */
  modulTerdeteksi: string | null;
  ambiguous: boolean;
  matches: readonly string[];
}

/** Status TAMPILAN pratinjau per berkas — beda dari `pdt_file.parse_status` (DB, hanya lahir saat commit): di sini ada dua status TAMBAHAN (`ditolak_pagar`/`perlu_pilih_modul`) yang belum berhak jadi baris DB sama sekali. */
export type PdtPreviewBerkasStatus = 'ok' | 'perlu_pilih_modul' | 'gagal' | 'ditolak_pagar';

export interface PdtPreviewBerkasHasil {
  nama: string;
  modulKode: string | null;
  modulNama: string | null;
  ambiguous: boolean;
  matches: readonly string[];
  /** 1-terindeks, hasil `temukanBarisHeader` (Rule 7) — `null` bila modul belum diketahui/berkas gagal. */
  barisHeader: number | null;
  /** Rule 8 — jumlah kolom whitelist modul yang ditemukan di header ini. */
  kolomDipanen: number;
  /** Rule 8 — NAMA saja, kolom di header yang bukan whitelist/alias modul ini. */
  kolomBaru: readonly string[];
  status: PdtPreviewBerkasStatus;
  /** BI `[...]` (aturan rumah #5) — `null` hanya bila `status === 'ok'`. */
  pesan: string | null;
  sha256: string | null;
  bytes: number | null;
}

export type PdtPreviewIdentitas =
  | { status: 'cocok' }
  | { status: 'usulkan_ikat'; usulan: string }
  | { status: 'tolak'; pesan: string }
  /** Belum ada berkas ber-status 'ok' yang membawa sinyal identitas platform ini (preamble Shopee / ID Kreator TikTok). */
  | { status: 'tidak_dapat_divalidasi'; pesan: string };

export interface PdtPreviewBatchHasil {
  clientPlatformId: number;
  platform: pdt.PdtPlatform;
  berkas: readonly PdtPreviewBerkasHasil[];
  identitas: PdtPreviewIdentitas;
  /** Rule 5 — `null` HANYA bila nol berkas ber-status 'ok' sama sekali (tidak ada dasar apa pun untuk resolusi). */
  periode: pdt.PdtPeriodeBatchHasil | null;
  /** Seluruh modul platform ini — bahan dropdown override AM (Rule G1-09 bullet 3, PRD Flow A langkah 4). Sub-langkah berikutnya yang menegakkan overridenya; di sini hanya daftarnya. */
  moduleOptions: readonly { kode: string; namaTampilan: string }[];
}

/** `pdt_kolom_alias` dikelompokkan per modul → per kolom kanonik (bentuk yang `validasiKolomWajib`/`hitungKolomDipanenBaru` terima). Dihitung sekali — `PDT_KOLOM_ALIAS` statis. */
const ALIAS_PER_MODUL: ReadonlyMap<string, Record<string, readonly string[]>> = (() => {
  const map = new Map<string, Record<string, string[]>>();
  for (const a of pdt.PDT_KOLOM_ALIAS) {
    const perKolom = map.get(a.modulKode) ?? {};
    (perKolom[a.kolomKanonik] ??= []).push(a.alias);
    map.set(a.modulKode, perKolom);
  }
  return map;
})();

/**
 * Modul Shopee yang membawa preamble `Username`/`Nama Toko`/`ID Toko`/`Periode`
 * (Rule 2: "Ketiga export iklan Shopee membawa preamble") — TIGA modul iklan
 * Shopee (`modules.ts`: satu-satunya modul Shopee ber-`barisHeaderHint` 7/8,
 * menyisakan baris 1-6 untuk preamble). Modul Shopee LAIN (`shopee_shop_stats`
 * dst.) tidak membawa preamble ini sama sekali — bukan lupa dicoba, memang
 * tidak ada sinyalnya (Rule 5 ayat 2: berkas begini mewarisi periode batch).
 */
const MODUL_PREAMBLE_SHOPEE: readonly string[] = ['shopee_ads_cpc', 'shopee_ads_search', 'shopee_ads_live'];

/** Kolom kanonik `pdt_parser_modul` yang membawa `ID Kreator` (Rule 3) — dicari LEWAT DEFINISI modul, bukan kode modul hardcode, supaya tetap benar kalau whitelist modul TikTok lain kelak menambah kolom ini. */
const KOLOM_ID_KREATOR = 'ID Kreator';

function modulPlatform(kode: string): pdt.PdtModuleDef | undefined {
  return pdt.PDT_MODULES.find((m) => m.kode === kode);
}

/** PDT-22: `client_platforms.platform` (Title Case) → kosakata `pdt` (Rule vokab berbeda, migrasi G1-01 §catatan). `null` = Tokopedia/Lazada/Blibli, PDT tidak berlaku (manual, PDT-22). */
export function platformKeVokabPdt(platform: string): pdt.PdtPlatform | null {
  if (platform === 'Shopee') return 'shopee';
  if (platform === 'TikTok Shop') return 'tiktok';
  return null;
}

/** Satu berkas 'ok' + modul + barisHeader — dipakai bersama oleh resolusi identitas dan periode di bawah, supaya keduanya tidak menghitung ulang `temukanBarisHeader` untuk berkas yang sama. */
interface BerkasTerparse {
  nama: string;
  aoa: readonly (readonly unknown[])[];
  modul: pdt.PdtModuleDef;
  barisHeader: number;
}

function bangunSatuPreviewBerkas(input: PdtPreviewBerkasInput): { hasil: PdtPreviewBerkasHasil; terparse: BerkasTerparse | null } {
  const dasar = { nama: input.nama, sha256: input.sha256, bytes: input.bytes };

  if (input.ditolakPagar) {
    return {
      terparse: null,
      hasil: { ...dasar, modulKode: null, modulNama: null, ambiguous: false, matches: [], barisHeader: null, kolomDipanen: 0, kolomBaru: [], status: 'ditolak_pagar', pesan: input.ditolakPagar.pesan },
    };
  }
  if (input.decodeGagal != null || input.aoa == null) {
    return {
      terparse: null,
      hasil: { ...dasar, modulKode: null, modulNama: null, ambiguous: input.ambiguous, matches: input.matches, barisHeader: null, kolomDipanen: 0, kolomBaru: [], status: 'gagal', pesan: input.decodeGagal ?? 'berkas gagal didekode' },
    };
  }
  if (input.modulTerdeteksi == null) {
    const pesan = input.ambiguous
      ? `[berkas '${input.nama}' cocok lebih dari satu modul (${input.matches.join(', ')}), pilih modul secara manual]`
      : `[berkas '${input.nama}' tidak dikenali sebagai modul manapun, pilih modul secara manual]`;
    return {
      terparse: null,
      hasil: { ...dasar, modulKode: null, modulNama: null, ambiguous: input.ambiguous, matches: input.matches, barisHeader: null, kolomDipanen: 0, kolomBaru: [], status: 'perlu_pilih_modul', pesan },
    };
  }

  const modul = modulPlatform(input.modulTerdeteksi);
  if (!modul) {
    // Struktural TIDAK seharusnya terjadi (detectPdtModule hanya mengembalikan kode dari daftar yang sama
    // yang dikirim ke sana) — dijaga di sini supaya kegagalan senyap tidak pernah lolos ke pemanggil.
    throw new ValidationError(`[modul '${input.modulTerdeteksi}' terdeteksi tapi tidak ada di registry PDT_MODULES]`);
  }

  const aliasPerKolom = ALIAS_PER_MODUL.get(modul.kode) ?? {};
  const barisHeader = pdt.temukanBarisHeader(input.aoa, modul.kolomDipanen, modul.barisHeaderHint);
  const header = input.aoa[barisHeader - 1] ?? [];
  const { jumlahDipanen, kolomBaru } = pdt.hitungKolomDipanenBaru(header, modul.kolomDipanen, aliasPerKolom);
  const kolomWajibGagal = pdt.validasiKolomWajib(header, modul.kolomDipanen, aliasPerKolom);
  const parseStatus = pdt.turunkanParseStatus({ decodeGagal: null, kolomWajibGagal });

  return {
    terparse: parseStatus.status === 'ok' ? { nama: input.nama, aoa: input.aoa, modul, barisHeader } : null,
    hasil: {
      ...dasar,
      modulKode: modul.kode,
      modulNama: modul.namaTampilan,
      ambiguous: false,
      matches: input.matches,
      barisHeader,
      kolomDipanen: jumlahDipanen,
      kolomBaru,
      status: parseStatus.status,
      pesan: parseStatus.error,
    },
  };
}

/**
 * Rule 2/4 — identitas dari berkas 'ok' pertama yang membawa sinyalnya (bukan
 * diketik AM). `sumber` (bentuk `pdt_upload_batch.identitas_sumber`, dipakai
 * HANYA oleh `commitUploadBatch`) terisi untuk verdict `cocok`/`usulkan_ikat`
 * — bukti apa yang divalidasi/diusulkan; `null` untuk `tolak`/
 * `tidak_dapat_divalidasi` (nol identitas yang tervalidasi untuk disimpan).
 */
function resolveIdentitasDanSumber(
  platform: pdt.PdtPlatform,
  terparse: readonly BerkasTerparse[],
  shopId: string | null,
  akunKontenToko: readonly string[] | null,
): { verdict: PdtPreviewIdentitas; sumber: Record<string, unknown> | null } {
  if (platform === 'shopee') {
    const berkas = terparse.find((b) => MODUL_PREAMBLE_SHOPEE.includes(b.modul.kode));
    if (!berkas) {
      return { verdict: { status: 'tidak_dapat_divalidasi', pesan: '[tidak ada berkas Shopee Ads (CPC/Search/Live) yang terparse untuk validasi identitas toko]' }, sumber: null };
    }
    const preamble = pdt.ekstrakPreambleShopee(berkas.aoa, berkas.barisHeader);
    const verdict = pdt.validasiIdentitasShopee(preamble, shopId);
    return { verdict, sumber: verdict.status === 'tolak' ? null : pdt.bangunIdentitasSumberShopee(preamble) };
  }
  // tiktok — cari berkas 'ok' PERTAMA yang modulnya benar-benar membawa kolom 'ID Kreator' (Rule 3),
  // bukan dua kode modul hardcode — supaya penambahan modul TikTok baru yang juga membawa kolom ini
  // otomatis ikut jadi kandidat, tanpa perlu menyentuh fungsi ini lagi.
  for (const berkas of terparse) {
    if (!berkas.modul.kolomDipanen.some((k) => k.toLowerCase() === KOLOM_ID_KREATOR.toLowerCase())) continue;
    const terbanyak = pdt.kolomTerbanyak(berkas.aoa, berkas.barisHeader, KOLOM_ID_KREATOR);
    if (terbanyak) {
      const verdict = pdt.validasiIdentitasTiktok(terbanyak.nilai, akunKontenToko);
      return { verdict, sumber: verdict.status === 'tolak' ? null : { id_kreator: terbanyak.nilai } };
    }
  }
  return { verdict: { status: 'tidak_dapat_divalidasi', pesan: "[tidak ada berkas TikTok yang membawa kolom 'ID Kreator' terparse untuk validasi identitas toko]" }, sumber: null };
}

/** Wrapper preview — hanya verdict, `pdt_upload_batch` belum ada untuk ditulisi `identitas_sumber` di sub-langkah ini. */
function resolveIdentitasPreview(
  platform: pdt.PdtPlatform,
  terparse: readonly BerkasTerparse[],
  shopId: string | null,
  akunKontenToko: readonly string[] | null,
): PdtPreviewIdentitas {
  return resolveIdentitasDanSumber(platform, terparse, shopId, akunKontenToko).verdict;
}

/** Rule 5 — periode batch dari SELURUH berkas 'ok' (berkas yang modulnya tidak membawa tanggal terbaca ikut disertakan dengan `periode: null`, supaya efek "mewarisi" ayat 2 berlaku). */
function resolvePeriodePreview(platform: pdt.PdtPlatform, terparse: readonly BerkasTerparse[]): pdt.PdtPeriodeBatchHasil | null {
  if (terparse.length === 0) return null;
  const daftar: pdt.PdtPeriodeBerkas[] = terparse.map((b) => {
    if (platform === 'shopee') {
      if (!MODUL_PREAMBLE_SHOPEE.includes(b.modul.kode)) return { nama: b.nama, periode: null };
      return { nama: b.nama, periode: pdt.ekstrakPreambleShopee(b.aoa, b.barisHeader).periode };
    }
    return { nama: b.nama, periode: pdt.ekstrakPeriodeKolomTiktok(b.aoa, b.barisHeader) };
  });
  return pdt.resolvePeriodeBatch(daftar);
}

interface ClientPlatformRow {
  id: number;
  client_id: string;
  platform: string;
  shop_id: string | null;
  akun_konten_toko: string[] | null;
  assigned_am_id: string | null;
}

/** Dipakai bersama oleh `previewUploadBatch`/`siapkanUploadBatch` — satu-satunya lookup+gerbang izin baris `client_platforms`. */
async function loadClientPlatformUntukPdt(sql: Sql, clientPlatformId: number): Promise<ClientPlatformRow> {
  const rows = await sql<ClientPlatformRow[]>`
    select cp.id, cp.client_id, cp.platform, cp.shop_id, cp.akun_konten_toko, c.assigned_am_id
      from client_platforms cp
      join clients c on c.id = cp.client_id
     where cp.id = ${clientPlatformId}`;
  const row = rows[0];
  if (!row) throw new NotFoundError();
  return row;
}

/**
 * previewUploadBatch — Flow A langkah 2-5 SEBELUM disimpan: nol tulis DB, nol
 * upload storage (lihat catatan di kepala §G1-09 di atas untuk batas
 * sub-langkah ini). Membaca `client_platforms`/`clients` HANYA untuk gerbang
 * izin (`canUploadBatch`) dan nilai identitas tersimpan (`shop_id`/
 * `akun_konten_toko`) yang divalidasi TERHADAP berkas — bukan sumber
 * kebenaran identitas itu sendiri (Rule 2).
 */
export async function previewUploadBatch(
  sql: Sql,
  actor: Actor,
  clientPlatformId: number,
  berkas: readonly PdtPreviewBerkasInput[],
): Promise<PdtPreviewBatchHasil> {
  const row = await loadClientPlatformUntukPdt(sql, clientPlatformId);

  if (!canUploadBatch(actor, row.assigned_am_id)) throw new ForbiddenError();

  const platform = platformKeVokabPdt(row.platform);
  if (!platform) {
    throw new ValidationError(`[platform toko '${row.platform}' tidak didukung PDT — Tokopedia/Lazada/Blibli tetap manual (PDT-22)]`);
  }

  const moduleOptions = pdt.PDT_MODULES.filter((m) => m.platform === platform).map((m) => ({ kode: m.kode, namaTampilan: m.namaTampilan }));

  const hasilBerkas: PdtPreviewBerkasHasil[] = [];
  const terparse: BerkasTerparse[] = [];
  for (const b of berkas) {
    const { hasil, terparse: t } = bangunSatuPreviewBerkas(b);
    hasilBerkas.push(hasil);
    if (t) terparse.push(t);
  }

  return {
    clientPlatformId,
    platform,
    berkas: hasilBerkas,
    identitas: resolveIdentitasPreview(platform, terparse, row.shop_id, row.akun_konten_toko),
    periode: resolvePeriodePreview(platform, terparse),
    moduleOptions,
  };
}

// ===========================================================================
// G1-09 — siapkan unggah (penutup `G1-09-BODY-BESAR`, `docs/DECISIONS.md`
// 2026-09-13). ZIP TIDAK PERNAH lewat badan request route Next.js — limit
// keras platform deploy (Vercel Serverless Functions) untuk badan request
// adalah 4,5 MB, jauh di bawah Rule 42 (paket ZIP boleh sampai 50 MB).
// Browser mengunggah LANGSUNG ke bucket privat `pdt-raw` lewat signed upload
// URL (route pemanggil yang meminta URL-nya ke Storage — lihat
// `apps/api/src/lib/pdt-storage.ts` `buatPdtRawSignedUploadUrl`); fungsi di
// sini HANYA menegakkan gerbang izin (sama seperti `previewUploadBatch`) dan
// menentukan PATH staging-nya — nol panggilan Storage/fetch (paket ini tidak
// boleh bergantung pada jaringan, arah dependensi sama seperti larangan
// fs/yauzl di kepala berkas).
//
// Path staging BUKAN path final Rule 44
// (`{client_id}/{client_platform_id}/{periode_selesai}/{batch_id}.zip`) —
// `periode_selesai`/`batch_id` belum diketahui sebelum paket diparse (batch
// belum dibuat). Objek staging yang tidak pernah dipakai (AM batal upload,
// preview berulang, commit gagal sebelum sempat memindahkan objek) adalah
// PERSIS objek "yatim" yang Rule 49 sudah antisipasi (purge otomatis > 7
// hari, nol baris `pdt_upload_batch`) — nol aturan retensi baru dibutuhkan.
// ===========================================================================

export interface PdtSiapkanUploadHasil {
  clientPlatformId: number;
  /** Path OBJEK di bucket privat `pdt-raw` (Rule 44) — staging, BUKAN path final Rule 44. */
  stagingPath: string;
}

/**
 * siapkanUploadBatch — gerbang izin + path staging SEBELUM AM mengunggah
 * apa pun (mendahului Flow A langkah 2). Sama sekali tidak membaca isi
 * berkas — itu baru terjadi setelah AM selesai PUT ke Storage dan memanggil
 * `previewUploadBatch` dengan hasilnya.
 */
export async function siapkanUploadBatch(
  sql: Sql,
  actor: Actor,
  clientPlatformId: number,
): Promise<PdtSiapkanUploadHasil> {
  const row = await loadClientPlatformUntukPdt(sql, clientPlatformId);
  if (!canUploadBatch(actor, row.assigned_am_id)) throw new ForbiddenError();
  if (!platformKeVokabPdt(row.platform)) {
    throw new ValidationError(`[platform toko '${row.platform}' tidak didukung PDT — Tokopedia/Lazada/Blibli tetap manual (PDT-22)]`);
  }

  const stagingPath = `_staging/${row.client_id}/${clientPlatformId}/${randomUUID()}.zip`;
  return { clientPlatformId, stagingPath };
}

// ===========================================================================
// G1-09 sub-langkah 2a — commit (Flow A langkah 6 sisi batch/berkas + langkah
// 9 error path; langkah 7-8 — rekonsiliasi PDT-16 + baris fakta + skor/usulan
// — SENGAJA BUKAN di sini, lihat handoff sesi ini untuk pembagian 2a/2b).
//
// **Keputusan: PIPELINE DIJALANKAN ULANG dari `storage_path` yang sama**
// (bukan menerima cache hasil `previewUploadBatch` dari klien) — pemanggil
// (route) mengunduh+mengekstrak+memparse ulang ZIP staging yang sama persis
// yang dipakai `/preview`, lalu memanggil fungsi di bawah dengan hasilnya.
// Alasan: (1) konsisten dengan seluruh pipeline G1-02..08 yang selalu
// menghitung ulang dari sumber, tidak pernah mempercayai angka yang
// dikirim balik klien (aturan rumah #4); (2) preview bisa dilakukan berkali-
// kali/beda sesi sebelum AM menekan submit final — cache di server/klien
// untuk itu adalah state tambahan yang tidak ada hari ini; (3) biaya parse
// ulang nol-berarti pada ukuran paket Rule 42 (≤50 MB, ≤40 entri, XLSX/CSV
// kecil). Didokumentasikan `docs/DECISIONS.md` 2026-09-14.
// ===========================================================================

/** AM menimpa deteksi satu berkas dari dropdown (PRD Flow A langkah 4, `moduleOptions` pratinjau). */
export interface PdtCommitOverride {
  nama: string;
  modulKode: string;
}

/**
 * Metadata paket ZIP yang SUDAH diketahui pemanggil (route) sebelum memanggil
 * fungsi ini — `packages/domain` tidak boleh membuka zip/Storage sendiri
 * (arah dependensi, lihat catatan G1-09 di kepala berkas). `entri` = entri
 * 'diproses' + 'ditolak' pagar (Rule 41) — seluruh entri NYATA dalam paket,
 * DI LUAR junk macOS (`entriDilewati`, dilewati tanpa peringatan) yang punya
 * kolomnya sendiri di `pdt_upload_batch.raw_entri_dilewati`.
 */
export interface PdtCommitRawMeta {
  sha256: string;
  bytes: number;
  entri: number;
  entriDilewati: number;
}

/**
 * Status `pdt_upload_batch` yang BOLEH ditulis sub-langkah ini. `'verified'`
 * SENGAJA tidak ada di sini — itu hanya lahir dari rekonsiliasi (Rule 13-14,
 * sub-langkah 2b), yang belum berjalan; batch yang identitasnya cocok/tidak
 * bisa divalidasi (advisory, bukan pagar blokir — sama seperti pratinjau)
 * berhenti di `'parsing'` menunggu 2b, BUKAN otomatis `'verified'`.
 */
export type PdtCommitStatus = 'parsing' | 'identitas_belum_terikat' | 'ditolak';

export interface PdtCommitBerkasHasil extends PdtPreviewBerkasHasil {
  /** `pdt_file.deteksi_oleh` — METODE yang dipakai (signature vs override AM), terisi apa pun hasilnya (termasuk yang berakhir `modulKode: null`). */
  deteksiOleh: 'tanda_tangan' | 'override_am';
}

export interface PdtCommitPersiapan {
  batchId: number;
  clientPlatformId: number;
  platform: pdt.PdtPlatform;
  status: PdtCommitStatus;
  alasanDitolak: string | null;
  periodeMulai: string;
  periodeSelesai: string;
  berkas: readonly PdtCommitBerkasHasil[];
  identitas: PdtPreviewIdentitas;
  /**
   * Path final Rule 44 (`{client_id}/{client_platform_id}/{periode_selesai}/{batch_id}.zip`).
   * Domain TIDAK mengunggah byte ke sini (tidak boleh menyentuh Storage) —
   * pemanggil (route) yang mengunggahnya (`unggahPdtRawObjek`, byte yang
   * sama sudah ada di memori dari mengunduh path staging), lalu memanggil
   * `markRawStored` dengan path yang SAMA ini.
   */
  rawPath: string;
}

/**
 * commitUploadBatch — Flow A langkah 6 (sisi batch/berkas) + langkah 9 (error
 * path identitas/periode). Menulis `pdt_upload_batch` + `pdt_file` dalam SATU
 * transaksi + satu baris `audit_log` (aturan rumah #3) — `pdt_upload_batch`
 * TIDAK memakai `sm_transition` (dicatat migrasi G1-01: "status ditulis
 * LANGSUNG oleh domain, preseden M19 dailyops"), jadi audit ditulis manual
 * di sini, bukan oleh mesin transisi.
 *
 * **Batas periode (Rule 5):** bila nol berkas berhasil diproses ATAU
 * berkas-berkas yang ada berasal dari bulan kalender berbeda, TIDAK ADA
 * baris `pdt_upload_batch` yang bisa ditulis sama sekali —
 * `periode_mulai`/`periode_selesai` NOT NULL di skema dan kedua kasus ini
 * tidak punya nilai yang sah untuk keduanya. Pemanggil menerima
 * `ValidationError` (400); paket ZIP yang sudah di-staging tetap ada di
 * bucket sebagai objek yatim yang dipurge otomatis Rule 49 (>7 hari) — AM
 * mengunggah ulang paket yang benar, bukan me-retry commit yang sama.
 *
 * **Identitas (Rule 2-4) TIDAK memblokir seperti periode** — `tolak` masih
 * menghasilkan baris batch (`status='ditolak'`, Flow A langkah 9: "tetap
 * tersimpan agar dapat didiagnosis TANPA UPLOAD ULANG"), karena periode
 * sudah diketahui sah di titik itu.
 */
export async function commitUploadBatch(
  sql: Sql,
  actor: Actor,
  clientPlatformId: number,
  berkasInput: readonly PdtPreviewBerkasInput[],
  overrides: readonly PdtCommitOverride[],
  now: Date = new Date(),
): Promise<PdtCommitPersiapan> {
  const row = await loadClientPlatformUntukPdt(sql, clientPlatformId);
  if (!canUploadBatch(actor, row.assigned_am_id)) throw new ForbiddenError();

  const platform = platformKeVokabPdt(row.platform);
  if (!platform) {
    throw new ValidationError(`[platform toko '${row.platform}' tidak didukung PDT — Tokopedia/Lazada/Blibli tetap manual (PDT-22)]`);
  }

  const modulValidUntukPlatform = new Set(pdt.PDT_MODULES.filter((m) => m.platform === platform).map((m) => m.kode));
  const overrideByNama = new Map<string, string>();
  for (const o of overrides) {
    if (!modulValidUntukPlatform.has(o.modulKode)) {
      throw new ValidationError(`[modul '${o.modulKode}' bukan modul platform toko ini, pilih dari daftar modul yang tersedia]`);
    }
    overrideByNama.set(o.nama, o.modulKode);
  }

  const hasilBerkas: PdtCommitBerkasHasil[] = [];
  const terparse: BerkasTerparse[] = [];
  for (const b of berkasInput) {
    const overrideKode = overrideByNama.get(b.nama);
    // Override hanya berlaku untuk berkas yang benar-benar terekstrak (b.aoa != null) — berkas
    // ditolakPagar/decodeGagal tidak punya sheet untuk diparse ulang dengan modul apa pun.
    const berlakuOverride = overrideKode != null && b.aoa != null;
    const efektif: PdtPreviewBerkasInput = berlakuOverride ? { ...b, modulTerdeteksi: overrideKode, ambiguous: false, matches: [overrideKode] } : b;
    const { hasil, terparse: t } = bangunSatuPreviewBerkas(efektif);
    hasilBerkas.push({ ...hasil, deteksiOleh: berlakuOverride ? 'override_am' : 'tanda_tangan' });
    if (t) terparse.push(t);
  }

  const { verdict: identitas, sumber: identitasSumber } = resolveIdentitasDanSumber(platform, terparse, row.shop_id, row.akun_konten_toko);
  const periode = resolvePeriodePreview(platform, terparse);

  if (periode == null) {
    throw new ValidationError('[tidak ada satu pun berkas dalam paket yang berhasil diproses — periksa kembali paket ZIP sebelum mengunggah ulang]');
  }
  if (periode.status === 'tolak') {
    throw new ValidationError(periode.pesan);
  }

  let status: PdtCommitStatus = 'parsing';
  let alasanDitolak: string | null = null;
  if (identitas.status === 'tolak') {
    status = 'ditolak';
    alasanDitolak = identitas.pesan;
  } else if (identitas.status === 'usulkan_ikat') {
    status = 'identitas_belum_terikat';
  }
  // identitas.status 'cocok'/'tidak_dapat_divalidasi' — status tetap 'parsing' (advisory,
  // konsisten previewUploadBatch: 'tidak_dapat_divalidasi' bukan pagar blokir).

  const retensiHari = status === 'ditolak' ? 30 : 120; // Rule 45 — default/ditolak; diperpanjang belakangan (G1-10/2b), tidak pernah diperpendek
  const retensiSampai = tz.addDaysToDate(tz.dateString(now), retensiHari);
  const retensiAlasan = status === 'ditolak' ? 'ditolak' : 'default';

  const batchId = await withTransaction(sql, async (tx) => {
    const rows = await tx<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status,
         alasan_ditolak, parser_versi, identitas_sumber, retensi_sampai, retensi_alasan, dibuat_oleh)
      values
        (${row.client_id}, ${clientPlatformId}, ${platform}, ${periode.mulai}::date, ${periode.selesai}::date,
         ${status}, ${alasanDitolak}, ${pdt.PDT_PARSER_VERSI}, ${tx.json(identitasSumber as never)}, ${retensiSampai}::date,
         ${retensiAlasan}, ${actor.employeeId})
      returning id`;
    const id = rows[0].id;

    for (const b of hasilBerkas) {
      // ditolakPagar/gagalEkstrak — nol bytes sungguhan dibaca (sha256/bytes null di sumbernya),
      // TIDAK dipersist sebagai pdt_file (sha256/bytes NOT NULL di skema, dan genuinely tidak
      // diketahui) — tetap terlihat di respons commit ini untuk request yang sama, didiagnosis
      // dari pesan sha256=null/bytes=null di sana; docs/DECISIONS.md 2026-09-14.
      if (b.sha256 == null || b.bytes == null) continue;
      // 'sebagian' TIDAK PERNAH diproduksi hari ini — turunkanParseStatus (G1-08) hanya
      // mengembalikan 'ok'/'gagal' (pemicu 'sebagian' belum didefinisikan, G1-08-SEBAGIAN,
      // docs/DECISIONS.md, masih terbuka). Peta di sini APA ADANYA sampai itu terjawab.
      const parseStatusDb = b.status === 'ok' ? 'ok' : 'gagal';
      await tx`
        insert into pdt_file
          (batch_id, modul_kode, nama_entri, sha256, bytes, baris_header, deteksi_oleh,
           kolom_dipanen, kolom_baru, parse_status, parse_error)
        values
          (${id}, ${b.modulKode}, ${b.nama}, ${b.sha256}, ${b.bytes}, ${b.barisHeader ?? 0}, ${b.deteksiOleh},
           ${b.kolomDipanen}, ${[...b.kolomBaru]}, ${parseStatusDb}, ${parseStatusDb === 'ok' ? null : b.pesan})`;
    }

    await executors(tx).audit.insertAudit({
      entityType: 'pdt_upload_batch',
      entityId: String(id),
      actorEmployeeId: actor.employeeId,
      action: 'pdt_batch_committed',
      beforeJson: null,
      afterJson: {
        status, platform, periode_mulai: periode.mulai, periode_selesai: periode.selesai,
        jumlah_berkas: hasilBerkas.length, identitas_status: identitas.status,
      },
      createdBy: actor.employeeId,
    });

    return id;
  });

  return {
    batchId,
    clientPlatformId,
    platform,
    status,
    alasanDitolak,
    periodeMulai: periode.mulai,
    periodeSelesai: periode.selesai,
    berkas: hasilBerkas,
    identitas,
    rawPath: `${row.client_id}/${clientPlatformId}/${periode.selesai}/${batchId}.zip`,
  };
}

/**
 * markRawStored — dipanggil route commit SEGERA setelah `commitUploadBatch`
 * berhasil DAN byte paket ZIP sudah diunggah ke `rawPath` (`unggahPdtRawObjek`,
 * `apps/api/src/lib/pdt-storage.ts`). Tidak mengulang gerbang izin — batch
 * `batchId` baru saja lahir dari `commitUploadBatch` yang SUDAH menegakkannya
 * dalam request yang sama; ini bukan endpoint publik terpisah.
 *
 * `raw_path` NULL sampai fungsi ini berhasil (komentar migrasi G1-01: "NULL
 * hanya sebelum upload selesai") — bila panggilan Storage gagal SETELAH
 * `commitUploadBatch` sukses, baris batch tetap ada (didiagnosis lewat
 * `pdt_file` yang sudah tertulis) tapi `raw_path` tertunda; belum ada jalur
 * retry otomatis untuk kasus ini (dicatat sebagai keterbatasan, bukan
 * kegagalan senyap — pemanggil menerima error dari langkah unggah Storage).
 */
export async function markRawStored(sql: Sql, batchId: number, rawPath: string, raw: PdtCommitRawMeta): Promise<void> {
  await sql`
    update pdt_upload_batch
       set raw_path = ${rawPath}, raw_sha256 = ${raw.sha256}, raw_bytes = ${raw.bytes},
           raw_entri = ${raw.entri}, raw_entri_dilewati = ${raw.entriDilewati}
     where id = ${batchId}`;
}
