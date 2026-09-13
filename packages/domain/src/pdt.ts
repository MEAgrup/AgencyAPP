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
import { pdt, permission } from '@cdps/core';
import type { Sql } from '@cdps/db';
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

/** Rule 2/4 — identitas dari berkas 'ok' pertama yang membawa sinyalnya (bukan diketik AM). */
function resolveIdentitasPreview(
  platform: pdt.PdtPlatform,
  terparse: readonly BerkasTerparse[],
  shopId: string | null,
  akunKontenToko: readonly string[] | null,
): PdtPreviewIdentitas {
  if (platform === 'shopee') {
    const berkas = terparse.find((b) => MODUL_PREAMBLE_SHOPEE.includes(b.modul.kode));
    if (!berkas) {
      return { status: 'tidak_dapat_divalidasi', pesan: '[tidak ada berkas Shopee Ads (CPC/Search/Live) yang terparse untuk validasi identitas toko]' };
    }
    const preamble = pdt.ekstrakPreambleShopee(berkas.aoa, berkas.barisHeader);
    return pdt.validasiIdentitasShopee(preamble, shopId);
  }
  // tiktok — cari berkas 'ok' PERTAMA yang modulnya benar-benar membawa kolom 'ID Kreator' (Rule 3),
  // bukan dua kode modul hardcode — supaya penambahan modul TikTok baru yang juga membawa kolom ini
  // otomatis ikut jadi kandidat, tanpa perlu menyentuh fungsi ini lagi.
  for (const berkas of terparse) {
    if (!berkas.modul.kolomDipanen.some((k) => k.toLowerCase() === KOLOM_ID_KREATOR.toLowerCase())) continue;
    const terbanyak = pdt.kolomTerbanyak(berkas.aoa, berkas.barisHeader, KOLOM_ID_KREATOR);
    if (terbanyak) return pdt.validasiIdentitasTiktok(terbanyak.nilai, akunKontenToko);
  }
  return { status: 'tidak_dapat_divalidasi', pesan: "[tidak ada berkas TikTok yang membawa kolom 'ID Kreator' terparse untuk validasi identitas toko]" };
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
  const rows = await sql<ClientPlatformRow[]>`
    select cp.id, cp.client_id, cp.platform, cp.shop_id, cp.akun_konten_toko, c.assigned_am_id
      from client_platforms cp
      join clients c on c.id = cp.client_id
     where cp.id = ${clientPlatformId}`;
  const row = rows[0];
  if (!row) throw new NotFoundError();

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
