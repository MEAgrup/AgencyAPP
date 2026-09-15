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
import { notification, pdt, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
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
  /**
   * `null` bila `ditolakPagar`/`decodeGagal` terisi. AoA milik modul yang
   * terdeteksi (sheet `namaSheet`-nya, G1-09-SHEET-BUKAN-PERTAMA) — atau
   * sheet pertama bila nol/lebih dari satu modul cocok.
   */
  aoa: readonly (readonly unknown[])[] | null;
  /**
   * SELURUH sheet workbook yang relevan (sheet pertama ∪ tiap `namaSheet`
   * ∪ tiap `sheetTambahan`, sesi 34, modul di registry) yang ADA di berkas
   * ini, nama→AoA. `null` sama seperti `aoa`. Dipakai untuk me-remap `aoa`
   * ke sheet yang BENAR saat AM meng-override modul (lihat
   * `commitUploadBatch`/`reparsePdtBatch`) ke modul ber-`namaSheet` yang
   * berbeda dari yang otomatis terdeteksi — DAN untuk fungsi ekstraksi yang
   * butuh LEBIH dari satu sheet sekaligus dari SATU modul yang sama (mis.
   * `ekstrakBarisShopDailyShopee` membaca ketiga sheet basis `shopee_shop_stats`
   * lewat `input.sheets.get('Pesanan Dibuat' | 'Pesanan Siap Dikirim' | 'Pesanan Dibayar')`,
   * bukan cuma `input.aoa` yang terkunci ke SATU basis).
   */
  sheets: ReadonlyMap<string, readonly (readonly unknown[])[]> | null;
  /** Hasil `detectPdtModuleAntarSheet` (G1-02/G1-09) — `null` bila nol/lebih dari satu tanda tangan cocok. */
  modulTerdeteksi: string | null;
  ambiguous: boolean;
  matches: readonly string[];
}

/**
 * `input.aoa`, dikoreksi ke sheet `namaSheet` modul `kodeEfektif` bila
 * `input.sheets` punya sheet itu (G1-09-SHEET-BUKAN-PERTAMA) — dipakai TIAP
 * kali modul EFEKTIF suatu berkas bisa berbeda dari yang `detectPdtModuleAntarSheet`
 * otomatis pilih (override AM, `commitUploadBatch`/`reparsePdtBatch`).
 * `input.aoa` apa adanya bila sheet yang diminta tidak ada di `input.sheets`
 * (mis. override ke modul yang `namaSheet`-nya memang tidak ada di berkas
 * ini — tidak ada sheet lain yang bisa dipakai sebagai gantinya).
 */
function aoaUntukModulEfektif(input: PdtPreviewBerkasInput, kodeEfektif: string): readonly (readonly unknown[])[] | null {
  const modul = modulPlatform(kodeEfektif);
  if (!modul?.namaSheet) return input.aoa;
  return input.sheets?.get(modul.namaSheet) ?? input.aoa;
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
  /** `input.sheets` apa adanya (sesi 34) — dipakai fungsi ekstraksi yang butuh LEBIH dari satu sheet dari modul yang sama (mis. `ekstrakBarisShopDailyShopee`, `PdtModuleDef.sheetTambahan`). `null` bila berkas ini hanya satu sheet/tak relevan. */
  sheets: ReadonlyMap<string, readonly (readonly unknown[])[]> | null;
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
    terparse: parseStatus.status === 'ok' ? { nama: input.nama, aoa: input.aoa, sheets: input.sheets, modul, barisHeader } : null,
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
    return { nama: b.nama, periode: pdt.ekstrakPeriodePreambleTiktok(b.aoa, b.barisHeader) };
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
// G1-09 sub-langkah 2a+2b-i+2b-ii(sebagian) — commit (Flow A langkah 6 sisi
// batch/berkas + baris fakta + langkah 7 rekonsiliasi shop-level Shopee +
// langkah 9 error path). PRD Flow A langkah 6 (BUKAN langkah 8 — langkah 8
// adalah skor/kuadran/usulan/prefill DI ATAS baris fakta, konsumen hilir yang
// belum dibangun, koreksi catatan sebelumnya di sini/HANDOFF_PDT_SESI13.md
// §1 butir 1) yang menulis "baris fakta sesuai whitelist (Rule 8)" —
// `shopee_ads_live` → `pdt_fact_ads` (modul pertama), `tt_video` →
// `pdt_fact_content` (modul kedua), `shopee_parent_sku`/`tt_orders` →
// `pdt_sku_master` (modul ketiga — lihat docblock `fakta.ts` untuk kenapa
// `pdt_sku_master`, bukan `shopee_live`/`shopee_video` seperti rekomendasi
// sesi lalu, yang keduanya ternyata BLOCKED begitu diinvestigasi), dan
// `tt_transaction_creator` → `pdt_fact_creator_period` (modul keempat —
// dipilih karena grain barisnya SUDAH per-kreator, nol ambiguitas kelas
// `shopee_ads_cpc`, yang investigasi sesi ini JUSTRU menemukan blocker BARU,
// lihat docblock `fakta.ts`), dan `shopee_ams_afiliasi` → `pdt_fact_creator_period`
// (modul KELIMA — sisi Shopee untuk tabel yang modul keempat baru mengisi
// sisi TikTok-nya; `shopee_ams_produk`, saudaranya di modul yang sama, TIDAK
// dipetakan KE SINI karena grainnya PER PRODUK, bukan per-kreator — TIDAK
// berarti tidak dipetakan sama sekali, lihat modul KEDELAPAN di bawah), dan
// `shopee_ads_search`/modul KETUJUH → `pdt_fact_ads`, dan `shopee_ams_produk`/
// modul KEDELAPAN (sesi 23) → `pdt_fact_sku_period` (lihat docblock
// `ekstrakBarisShopeeAmsProduk`, `fakta.ts` — `sku_id` NULL, `platform_product_id`
// diisi langsung dari `Kode Item`; blocker lama `sku_id NOT NULL` dibuka
// bersamaan dengan `G1-09-2BII-ADS-CPC-SKU`, migrasi
// `20261025010000_g1_09_2bii_ads_cpc_sku_platform_product_id.sql`), dan
// `shopee_live`/modul KESEMBILAN (sesi 24) → `pdt_fact_content` (lihat
// docblock `ekstrakBarisShopeeLive`, `fakta.ts` — identitas dari digit
// mentah `Waktu Mulai`, BUKAN `Informasi Streaming`, `G1-09-2BII-SHOPEELIVE`
// DITUTUP)
// adalah baris/tabel fakta yang benar-benar ditulis (sub-langkah 2b-ii, di
// bawah); modul-modul lain BELUM (peta kolomDipanen→tabel fakta untuk
// sisanya belum ada, pekerjaan besar tersendiri, lihat
// `docs/handoff/HANDOFF_PDT_SESI12.md`/`HANDOFF_PDT_SESI13.md`/
// `HANDOFF_PDT_SESI14.md`/`HANDOFF_PDT_SESI15.md`/`HANDOFF_PDT_SESI16.md`/
// `HANDOFF_PDT_SESI17.md`).
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
 * Status `pdt_upload_batch` yang boleh ditulis commit ini. `'verified'`
 * (BARU sub-langkah 2b-i) lahir HANYA dari rekonsiliasi Shopee
 * shop-level-vs-per-SKU (Rule 13-14) yang lolos ambang — lihat catatan
 * rekonsiliasi di kepala `commitUploadBatch`. Batch yang identitasnya
 * cocok/tidak bisa divalidasi TAPI rekonsiliasinya tidak bisa/belum
 * dijalankan (TikTok — belum ada mesin shop-level-vs-per-SKU-nya; Shopee
 * tanpa `shopee_shop_stats`+`shopee_parent_sku` ber-status `ok` berdua)
 * berhenti di `'parsing'`, BUKAN otomatis `'verified'` — menunggu batch
 * berikutnya yang membawa berkas lengkap, atau sub-langkah 2b-ii (baris
 * fakta) menambah jalur lain.
 */
export type PdtCommitStatus = 'parsing' | 'identitas_belum_terikat' | 'verified' | 'ditolak';

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
  /** `pdt_upload_batch.reconcile_delta_pct` — `null` bila rekonsiliasi tidak/belum dijalankan (lihat `PdtCommitStatus`), bukan berarti 0%. */
  reconcileDeltaPct: number | null;
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
 *
 * **Rekonsiliasi (Rule 13-16, sub-langkah 2b-i) — Shopee (basis Siap Dikirim)
 * DAN TikTok, keduanya berdiri sendiri.** Berjalan HANYA ketika identitas
 * `cocok`/`tidak_dapat_divalidasi` (identitas `tolak`/`usulkan_ikat` tidak
 * masuk akal direkonsiliasi — batch belum tentu punya toko yang benar).
 * **Shopee**: butuh `shopee_shop_stats` + `shopee_parent_sku` KEDUANYA
 * `status='ok'`. Basis dipilih Rule 16 (default laporan klien = **Pesanan
 * Siap Dikirim** — basis Dibayar/PDT-19 adalah gerbang Product Exchange
 * TERPISAH, di luar cakupan gerbang Flow A ini). **Perbandingan pesanan
 * (separuh Rule 13) DILEWATI** — `shopee_parent_sku.kolomDipanen`
 * (`PDT_KOLOM_DIPANEN.md` §2.2, bucket 1+2 SUDAH lengkap dicek) nol kolom
 * jumlah-pesanan per-SKU terverifikasi; `rekonsiliasiGmvPesanan` menerima
 * ini (parameter opsional) dan menilai HANYA dari GMV sampai kolomnya
 * ditemukan — dicatat `G1-07-PERSKU-PESANAN` (Open, `docs/DECISIONS.md`).
 * **TikTok**: butuh `tt_shop_analytics` + `tt_product_analytics` KEDUANYA
 * `status='ok'` — `G1-07-TIKTOK-REKONSILIASI` DITUTUP lewat sample asli
 * ("Tiktok - Avitaskin.zip"): BEDA dari Shopee, perbandingan pesanan TIDAK
 * dilewati — Σ `'Pesanan SKU'` per-SKU (`tt_product_analytics`) TERBUKTI
 * SAMA PERSIS dengan shop-level (`tt_shop_analytics`), sama seperti GMV
 * (lihat docblock `parseTiktokShopAnalytics`, `@cdps/core`
 * `pdt/rekonsiliasi.ts`, untuk bukti aritmetika lengkap). Lolos ambang ⇒
 * `status='verified'` — **`uq_pdt_upload_batch_verified`**
 * (partial unique index, Rule 36) menolak batch verified KEDUA untuk
 * `(client_platform_id, periode_mulai, periode_selesai)` yang sama; commit
 * ini menerjemahkan pelanggaran itu jadi `ValidationError` BI, bukan 500
 * mentah (lihat `catch` di bawah).
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
    // `aoa` DIKOREKSI ke sheet `namaSheet` modul override (G1-09-SHEET-BUKAN-PERTAMA) —
    // tanpa ini, AM yang meng-override ke modul ber-sheet-spesifik (mis. `shopee_live`)
    // akan tetap membaca sheet yang deteksi OTOMATIS pilih (biasanya sheet pertama),
    // BUKAN sheet yang modul override itu sungguhan minta.
    const efektif: PdtPreviewBerkasInput = berlakuOverride
      ? { ...b, aoa: aoaUntukModulEfektif(b, overrideKode), modulTerdeteksi: overrideKode, ambiguous: false, matches: [overrideKode] }
      : b;
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
  let reconcileDeltaPct: number | null = null;
  if (identitas.status === 'tolak') {
    status = 'ditolak';
    alasanDitolak = identitas.pesan;
  } else if (identitas.status === 'usulkan_ikat') {
    status = 'identitas_belum_terikat';
  } else {
    // identitas.status 'cocok'/'tidak_dapat_divalidasi' — satu-satunya jalur yang boleh
    // mencoba rekonsiliasi (Rule 13-16, sub-langkah 2b-i). Lihat docblock fungsi ini untuk
    // cakupan (Shopee saja, basis Siap Dikirim, pesanan dilewati — G1-07-PERSKU-PESANAN).
    if (platform === 'shopee') {
      const shopStatsBerkas = terparse.find((b) => b.modul.kode === 'shopee_shop_stats');
      const parentSkuBerkas = terparse.find((b) => b.modul.kode === 'shopee_parent_sku');
      if (shopStatsBerkas && parentSkuBerkas) {
        const shopLevel = pdt.parseShopeeShopStatsBasisTerisolasi(shopStatsBerkas.aoa);
        if (shopLevel) {
          const perSkuGmv = pdt.sumShopeeParentSkuGmv(
            parentSkuBerkas.aoa, 'Penjualan (Pesanan Siap Dikirim) (IDR)', parentSkuBerkas.barisHeader,
          );
          const modulTerlibat = hasilBerkas
            .filter((b) => b.modulKode != null)
            .map((b) => ({ kode: b.modulKode as string, parseStatusOk: b.status === 'ok' }));
          const hasilRekon = pdt.rekonsiliasiGmvPesanan({ perSkuGmv, shopLevelGmv: shopLevel.gmv, modulTerlibat });
          if (hasilRekon.status === 'verified') {
            status = 'verified';
            reconcileDeltaPct = hasilRekon.deltaGmvPct;
          } else {
            status = 'ditolak';
            alasanDitolak = hasilRekon.pesan;
            reconcileDeltaPct = hasilRekon.deltaPct;
          }
        }
        // shopLevel absen (section 'Pesanan Siap Dikirim' tidak ada di berkas ini) — berhenti
        // di 'parsing', sama seperti pasangan berkas yang tidak lengkap (di bawah).
      }
      // Salah satu/keduanya absen atau bukan 'ok' — nol dasar untuk rekonsiliasi, berhenti di
      // 'parsing' menunggu batch berikutnya yang membawa keduanya lengkap.
    } else if (platform === 'tiktok') {
      // G1-07-TIKTOK-REKONSILIASI DITUTUP — `tt_shop_analytics` (shop-level) vs
      // `tt_product_analytics` (Σ per-SKU), KEDUA metrik (GMV DAN Pesanan SKU) TERVERIFIKASI
      // sample asli (lihat docblock `parseTiktokShopAnalytics`, `@cdps/core` `pdt/rekonsiliasi.ts`)
      // — beda dari Shopee yang harus melewati pesanan (G1-07-PERSKU-PESANAN).
      const shopStatsBerkas = terparse.find((b) => b.modul.kode === 'tt_shop_analytics');
      const productAnalyticsBerkas = terparse.find((b) => b.modul.kode === 'tt_product_analytics');
      if (shopStatsBerkas && productAnalyticsBerkas) {
        const shopLevel = pdt.parseTiktokShopAnalytics(shopStatsBerkas.aoa, shopStatsBerkas.barisHeader);
        if (shopLevel) {
          const perSku = pdt.sumTiktokProductAnalyticsGmv(productAnalyticsBerkas.aoa, productAnalyticsBerkas.barisHeader);
          const modulTerlibat = hasilBerkas
            .filter((b) => b.modulKode != null)
            .map((b) => ({ kode: b.modulKode as string, parseStatusOk: b.status === 'ok' }));
          const hasilRekon = pdt.rekonsiliasiGmvPesanan({
            perSkuGmv: perSku.gmv, shopLevelGmv: shopLevel.gmv,
            perSkuPesanan: perSku.pesanan, shopLevelPesanan: shopLevel.pesanan,
            modulTerlibat,
          });
          if (hasilRekon.status === 'verified') {
            status = 'verified';
            reconcileDeltaPct = hasilRekon.deltaGmvPct;
          } else {
            status = 'ditolak';
            alasanDitolak = hasilRekon.pesan;
            reconcileDeltaPct = hasilRekon.deltaPct;
          }
        }
        // shopLevel absen (kolom 'GMV'/'Pesanan SKU' tidak ditemukan di berkas ini) — berhenti
        // di 'parsing', sama seperti pasangan berkas yang tidak lengkap (di bawah).
      }
      // Salah satu/keduanya absen atau bukan 'ok' — nol dasar untuk rekonsiliasi, berhenti di
      // 'parsing' menunggu batch berikutnya yang membawa keduanya lengkap.
    }
  }

  // Q-3 (docs/DECISIONS.md 2026-09-13): pdt_fact_ads.periode adalah AWAL BULAN, bukan
  // periode.mulai apa adanya (yang bisa jatuh di tengah bulan bila berkas tidak membawa
  // preamble tanggal presisi) — supaya partisi bulanan nanti (bila diperlukan) = DDL murni.
  const periodeAwalBulan = `${periode.mulai.slice(0, 7)}-01`;

  const berkasAdsLive = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_ads_live');
  // G1-09 sub-langkah 2b-ii — modul KEENAM, `shopee_ads_cpc` → `pdt_fact_ads`
  // (lihat docblock `ekstrakBarisShopeeAdsCpc`, `@cdps/core` `pdt/fakta.ts`, untuk
  // kenapa blocker grain `G1-09-2BII-ADS-CPC` — terbuka sejak sesi 13 — akhirnya
  // terjawab sesi ini: sample asli Fim Motor).
  const berkasAdsCpc = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_ads_cpc');
  // G1-09 sub-langkah 2b-ii — modul KETUJUH (sesi 22), `shopee_ads_search` → `pdt_fact_ads`
  // (lihat docblock `ekstrakBarisShopeeAdsSearch`, `@cdps/core` `pdt/fakta.ts`, untuk kenapa
  // blocker `G1-09-2BII-ADS-SEARCH` — "nol kolom biaya/identitas" — ditutup sesi ini).
  const berkasAdsSearch = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_ads_search');
  const berkasTtVideo = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_video');
  // G1-09 sub-langkah 2b-ii — modul KETIGA, `shopee_parent_sku`/`tt_orders` → `pdt_sku_master`
  // (lihat docblock `ekstrakBarisSkuMasterShopeeParentSku`/`ekstrakBarisSkuMasterTtOrders`,
  // `@cdps/core` `pdt/fakta.ts`, untuk kenapa modul ini — bukan `shopee_live`/`shopee_video`
  // seperti rekomendasi sesi lalu — dan kenapa `tt_orders` SENDIRIAN, bukan digabung
  // `tt_transaction_product` seperti Rule 18 harfiah).
  const berkasParentSkuUntukMaster = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_parent_sku');
  const berkasTtOrders = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_orders');
  // G1-09 sub-langkah 2b-ii — modul KEEMPAT, `tt_transaction_creator` → `pdt_fact_creator_period`
  // (lihat docblock `ekstrakBarisKreatorTtTransactionCreator`, `@cdps/core` `pdt/fakta.ts`).
  const berkasTtTransactionCreator = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_transaction_creator');
  // G1-09 sub-langkah 2b-ii — modul KELIMA, `shopee_ams_afiliasi` → `pdt_fact_creator_period`
  // (lihat docblock `ekstrakBarisKreatorShopeeAmsAfiliasi`, `@cdps/core` `pdt/fakta.ts`) — sisi
  // Shopee untuk tabel yang modul KEEMPAT (TikTok) baru mengisi.
  const berkasShopeeAmsAfiliasi = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_ams_afiliasi');
  // G1-09 sub-langkah 2b-ii — modul KEDELAPAN (sesi 23), `shopee_ams_produk` → `pdt_fact_sku_period`
  // (lihat docblock `ekstrakBarisShopeeAmsProduk`, `@cdps/core` `pdt/fakta.ts`) — `G1-09-2BII-
  // ADS-CPC-SKU` DITUTUP sesi ini membuka blocker `sku_id NOT NULL` yang menahan modul ini sejak
  // lahir (HANDOFF_PDT_SESI21.md §1: "BLOCKED TOTAL").
  const berkasShopeeAmsProduk = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_ams_produk');
  // G1-09 sub-langkah 2b-ii — modul KESEMBILAN (sesi 24), `shopee_live` → `pdt_fact_content`
  // (lihat docblock `ekstrakBarisShopeeLive`, `@cdps/core` `pdt/fakta.ts`) — `G1-09-2BII-
  // SHOPEELIVE` DITUTUP sesi ini (`Waktu Mulai` sebagai identitas, bukan `Informasi Streaming`).
  const berkasShopeeLive = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_live');
  // G1-09 sub-langkah 2b-ii — modul KESEPULUH, `tt_live` → `pdt_fact_content` (lihat
  // docblock `ekstrakBarisTtLive`, `@cdps/core` `pdt/fakta.ts`) — `G1-09-2BII-TTLIVE`
  // DITUTUP (sample asli "Tiktok - Avitaskin.zip": `ID Kreator` + `Waktu Live` menit
  // presisi TERBUKTI 100% unik, pola sama `shopee_live`/`Waktu Mulai`).
  const berkasTtLive = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_live');
  // Sesi 34 (riset G2-01) — `tt_shop_analytics` → `pdt_fact_shop_daily` (lihat docblock
  // `ekstrakBarisShopDailyTiktok`, `@cdps/core` `pdt/fakta.ts`).
  const berkasShopStatsTiktok = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_shop_analytics');
  // Sesi 34 lanjutan (G1-09-2BII-SHOPDAILY-SHOPEE) — `shopee_shop_stats` → `pdt_fact_shop_daily`,
  // TIGA basis sekaligus lewat `b.sheets` (lihat docblock `ekstrakBarisShopDailyShopee`).
  const berkasShopStatsShopee = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_shop_stats');

  const retensiHari = status === 'ditolak' ? 30 : 120; // Rule 45 — default/ditolak; diperpanjang belakangan (G1-10/2b-ii), tidak pernah diperpendek
  const retensiSampai = tz.addDaysToDate(tz.dateString(now), retensiHari);
  const retensiAlasan = status === 'ditolak' ? 'ditolak' : 'default';

  let batchId: number;
  try {
    batchId = await withTransaction(sql, async (tx) => {
      const rows = await tx<{ id: number }[]>`
        insert into pdt_upload_batch
          (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status,
           alasan_ditolak, reconcile_delta_pct, parser_versi, identitas_sumber, retensi_sampai,
           retensi_alasan, dibuat_oleh)
        values
          (${row.client_id}, ${clientPlatformId}, ${platform}, ${periode.mulai}::date, ${periode.selesai}::date,
           ${status}, ${alasanDitolak}, ${reconcileDeltaPct}, ${pdt.PDT_PARSER_VERSI}, ${tx.json(identitasSumber as never)},
           ${retensiSampai}::date, ${retensiAlasan}, ${actor.employeeId})
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

      // G1-09 sub-langkah 2b-ii / G1-11 (reparse) — baris fakta tertipe, SEMBILAN modul,
      // diekstrak ke `tulisFaktaModulTerparse` (di bawah `commitUploadBatch`) supaya
      // `reparsePdtBatch` (Flow D) bisa memakai PERSIS SQL yang sama tanpa duplikasi —
      // lihat docblock fungsi itu untuk rincian per modul (delete-then-insert vs
      // ON CONFLICT DO UPDATE, kenapa masing-masing).
      await tulisFaktaModulTerparse(tx, {
        id, clientPlatformId, periodeAwalBulan, akunKontenToko: row.akun_konten_toko, now,
        berkasAdsLive, berkasAdsCpc, berkasAdsSearch, berkasTtVideo, berkasShopeeLive, berkasTtLive,
        berkasShopStatsTiktok, berkasShopStatsShopee, berkasParentSkuUntukMaster, berkasTtOrders, berkasTtTransactionCreator,
        berkasShopeeAmsAfiliasi, berkasShopeeAmsProduk,
      });

      await executors(tx).audit.insertAudit({
        entityType: 'pdt_upload_batch',
        entityId: String(id),
        actorEmployeeId: actor.employeeId,
        action: 'pdt_batch_committed',
        beforeJson: null,
        afterJson: {
          status, platform, periode_mulai: periode.mulai, periode_selesai: periode.selesai,
          jumlah_berkas: hasilBerkas.length, identitas_status: identitas.status, reconcile_delta_pct: reconcileDeltaPct,
        },
        createdBy: actor.employeeId,
      });

      return id;
    });
  } catch (e) {
    // uq_pdt_upload_batch_verified (Rule 36) — SATU batch verified per (toko, periode); batch
    // ditolak/digantikan tidak menghalangi penggantinya, jadi hanya rekonsiliasi 'verified' KEDUA
    // untuk periode yang sama yang bisa memicu ini. BI, bukan 500 mentah — AM diberi tahu kenapa,
    // bukan "internal server error".
    if (isUniqueViolation(e)) {
      throw new ValidationError(
        `[batch verified untuk toko dan periode ${periode.mulai} s.d. ${periode.selesai} ini sudah ada — reparse batch lama (Flow D) alih-alih mengunggah batch verified baru untuk periode yang sama]`,
      );
    }
    throw e;
  }

  return {
    batchId,
    clientPlatformId,
    platform,
    status,
    alasanDitolak,
    reconcileDeltaPct,
    periodeMulai: periode.mulai,
    periodeSelesai: periode.selesai,
    berkas: hasilBerkas,
    identitas,
    rawPath: `${row.client_id}/${clientPlatformId}/${periode.selesai}/${batchId}.zip`,
  };
}

/** True untuk Postgres unique-violation (SQLSTATE 23505) — pola sama `report.ts`/`vendor.ts`/`client-portal-auth.ts`. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

interface TulisFaktaModulTerparseInput {
  id: number;
  clientPlatformId: number;
  periodeAwalBulan: string;
  akunKontenToko: readonly string[] | null;
  now: Date;
  berkasAdsLive: readonly BerkasTerparse[];
  berkasAdsCpc: readonly BerkasTerparse[];
  berkasAdsSearch: readonly BerkasTerparse[];
  berkasTtVideo: readonly BerkasTerparse[];
  berkasShopeeLive: readonly BerkasTerparse[];
  berkasTtLive: readonly BerkasTerparse[];
  berkasShopStatsTiktok: readonly BerkasTerparse[];
  berkasShopStatsShopee: readonly BerkasTerparse[];
  berkasParentSkuUntukMaster: readonly BerkasTerparse[];
  berkasTtOrders: readonly BerkasTerparse[];
  berkasTtTransactionCreator: readonly BerkasTerparse[];
  berkasShopeeAmsAfiliasi: readonly BerkasTerparse[];
  berkasShopeeAmsProduk: readonly BerkasTerparse[];
}

/**
 * tulisFaktaModulTerparse — SEMBILAN blok penulis baris fakta tertipe (G1-09
 * sub-langkah 2b-ii), diekstrak dari `commitUploadBatch` sesi G1-11 supaya
 * `reparsePdtBatch` (Flow D, di bawah) bisa memakai SQL yang PERSIS SAMA
 * tanpa duplikasi — reparse dan commit-baru sama-sama berakhir di "tulis
 * baris fakta untuk (client_platform_id, periode) ini dari `terparse` yang
 * diberikan", beda HANYA pada `id` (batch baru vs batch lama yang sama) dan
 * pada langkah SEBELUM ini (insert `pdt_upload_batch` baru vs baca batch
 * lama) — nol perbedaan logika penulisan fakta itu sendiri.
 *
 * `id`/`clientPlatformId`/`periodeAwalBulan` dipakai APA ADANYA dari
 * pemanggil (bukan diturunkan ulang di sini) — untuk reparse ini SENGAJA
 * bukan re-derive dari isi berkas yang diparse ulang (Rule 5 periode adalah
 * gerbang UPLOAD BARU, reparse menyasar SATU slot (toko, periode) yang
 * sudah ada, bukan menciptakan slot baru).
 *
 * Setiap blok delete-then-insert ("replace-on-recommit") menghapus
 * SCOPE (toko+periode+sumber/basis) sebelum menulis ulang — dipanggil
 * ulang untuk toko+periode yang SAMA (baik commit-ulang maupun reparse)
 * otomatis mengganti baris lama, TIDAK menduplikasi. Blok `ON CONFLICT ...
 * DO UPDATE` sama-sama aman dipanggil ulang untuk alasan yang sama
 * (kunci unik toko+identitas persisten, bukan toko+periode+batch).
 * `pdt_sku_master` UPSERT murni (bukan per-periode) — reparse SKU master
 * sama amannya dengan commit pertama.
 */
async function tulisFaktaModulTerparse(tx: Queryable, input: TulisFaktaModulTerparseInput): Promise<void> {
  const {
    id, clientPlatformId, periodeAwalBulan, akunKontenToko, now,
    berkasAdsLive, berkasAdsCpc, berkasAdsSearch, berkasTtVideo, berkasShopeeLive, berkasTtLive,
    berkasShopStatsTiktok, berkasShopStatsShopee, berkasParentSkuUntukMaster, berkasTtOrders, berkasTtTransactionCreator,
    berkasShopeeAmsAfiliasi, berkasShopeeAmsProduk,
  } = input;

  // G1-09 sub-langkah 2b-ii — baris fakta tertipe, `shopee_ads_live` → `pdt_fact_ads`
  // (modul PERTAMA dipetakan, lihat docblock `ekstrakBarisShopeeAdsLive`, `@cdps/core`
  // `pdt/fakta.ts`, untuk kenapa modul ini dan bukan `shopee_ads_cpc`/`shopee_ads_search`).
  // `uq_pdt_fact_ads` TIDAK AMAN dipakai lewat `ON CONFLICT` di sini — `sku_id`/`content_id`
  // SELALU NULL untuk modul ini (dua kolom itu bagian kunci unik), dan Postgres tidak
  // pernah menganggap NULL=NULL saat memeriksa keunikan, jadi commit ULANG periode yang
  // sama tidak akan pernah "conflict" — ia akan menambah baris duplikat, bukan menimpa.
  // Jalan aman: HAPUS baris toko+periode+sumber ini lebih dulu, lalu tulis ulang dari
  // batch yang sedang di-commit (replace-on-recommit) — sah karena baris fakta adalah
  // data TURUNAN yang selalu bisa dihitung ulang (aturan rumah #4), bukan riwayat
  // immutable (itu tanggung jawab `audit_log`, di pemanggil).
  if (berkasAdsLive.length > 0) {
    await tx`
      delete from pdt_fact_ads
       where client_platform_id = ${clientPlatformId} and sumber = 'shopee_ads_live' and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasAdsLive) {
      for (const baris of pdt.ekstrakBarisShopeeAdsLive(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_ads
            (client_platform_id, sumber, kampanye_id, sku_id, content_id, periode, batch_id,
             parser_versi, biaya, tayangan, klik, pesanan_sku, gmv, roas)
          values
            (${clientPlatformId}, 'shopee_ads_live', ${baris.kampanyeId}, null, null, ${periodeAwalBulan}::date, ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.biaya}, ${baris.tayangan}, null, ${baris.pesananSku}, ${baris.gmv}, ${baris.roas})`;
      }
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KEENAM, `shopee_ads_cpc` → `pdt_fact_ads`
  // (lihat docblock `ekstrakBarisShopeeAdsCpc`, `@cdps/core` `pdt/fakta.ts`).
  // Sama pola replace-on-recommit `shopee_ads_live` di atas — `sku_id`/
  // `content_id` SELALU NULL di sini juga (lihat docblock kepala berkas
  // `fakta.ts` untuk kenapa `sku_id` TIDAK diisi walau `pdt_sku_master`
  // sudah ada: `Kode Produk` level induk, `pdt_sku_master` berkunci per
  // varian — lookup langsung akan mengarang varian mana yang dipilih).
  // `platform_product_id` DIISI sesi 23 (`G1-09-2BII-ADS-CPC-SKU` DITUTUP
  // — pemilik: "kebutuhan hanya GMV per produk bukan sampai varian") —
  // salinan identitas `Kode Produk`, bukan lookup.
  if (berkasAdsCpc.length > 0) {
    await tx`
      delete from pdt_fact_ads
       where client_platform_id = ${clientPlatformId} and sumber = 'shopee_ads_cpc' and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasAdsCpc) {
      for (const baris of pdt.ekstrakBarisShopeeAdsCpc(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_ads
            (client_platform_id, sumber, kampanye_id, platform_product_id, sku_id, content_id, periode, batch_id,
             parser_versi, biaya, tayangan, klik, pesanan_sku, gmv, roas)
          values
            (${clientPlatformId}, 'shopee_ads_cpc', ${baris.kampanyeId}, ${baris.platformProductId}, null, null, ${periodeAwalBulan}::date, ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.biaya}, ${baris.tayangan}, ${baris.klik}, ${baris.pesananSku}, ${baris.gmv}, ${baris.roas})`;
      }
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KETUJUH (sesi 22), `shopee_ads_search` → `pdt_fact_ads`
  // (lihat docblock `ekstrakBarisShopeeAdsSearch`, `@cdps/core` `pdt/fakta.ts`). Sama pola
  // replace-on-recommit `shopee_ads_cpc`/`shopee_ads_live` di atas — `sku_id`/`content_id`
  // SELALU NULL di sini juga (modul ini tidak punya identitas produk sama sekali di
  // whitelist). `kampanye_id` KOMPOSIT (`nama iklan :: kata pencarian`, bukan nama iklan
  // polos) — lihat docblock kepala berkas `fakta.ts` untuk alasan (satu iklan search bisa
  // punya banyak baris keyword per periode, belum terbukti aman disamakan ke `shopee_ads_cpc`).
  if (berkasAdsSearch.length > 0) {
    await tx`
      delete from pdt_fact_ads
       where client_platform_id = ${clientPlatformId} and sumber = 'shopee_ads_search' and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasAdsSearch) {
      for (const baris of pdt.ekstrakBarisShopeeAdsSearch(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_ads
            (client_platform_id, sumber, kampanye_id, sku_id, content_id, periode, batch_id,
             parser_versi, biaya, tayangan, klik, pesanan_sku, gmv, roas)
          values
            (${clientPlatformId}, 'shopee_ads_search', ${baris.kampanyeId}, null, null, ${periodeAwalBulan}::date, ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.biaya}, ${baris.tayangan}, ${baris.klik}, ${baris.pesananSku}, ${baris.gmv}, ${baris.roas})`;
      }
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KEDUA, `tt_video` → `pdt_fact_content` (lihat
  // docblock `ekstrakBarisTtVideo`, `@cdps/core` `pdt/fakta.ts`). Beda dari
  // `shopee_ads_live`/`pdt_fact_ads`: kunci unik `pdt_fact_content`
  // (`client_platform_id, platform_content_id, periode`) TIDAK punya komponen NULL (`ID
  // Video` selalu ada untuk baris yang ditulis — baris kosong sudah dilewati di
  // `ekstrakBarisTtVideo`), jadi `ON CONFLICT ... DO UPDATE` sungguhan AMAN dipakai di
  // sini (beda dari alasan replace-on-recommit `pdt_fact_ads` di atas). `sku_id`/
  // `waktu_posting` SELALU NULL (SKU master belum ada; nol parser terverifikasi untuk
  // format kolom `Waktu` — lihat docblock `ekstrakBarisTtVideo`). `periode` — AWAL BULAN
  // batch (Q-3, migrasi sesi 34) — video yang GMV-nya masih berjalan di bulan berikutnya
  // menulis baris BARU untuk periode itu, TIDAK menimpa baris bulan sebelumnya.
  if (berkasTtVideo.length > 0) {
    for (const b of berkasTtVideo) {
      for (const baris of pdt.ekstrakBarisTtVideo(b.aoa, b.barisHeader, akunKontenToko)) {
        await tx`
          insert into pdt_fact_content
            (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis,
             creator_platform_id, creator_handle, is_akun_toko, waktu_posting, sku_id,
             vv, likes, komentar, dibagikan, pengikut_baru, produk_dilihat, klik_produk, gmv, durasi_detik)
          values
            (${clientPlatformId}, ${baris.platformContentId}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI}, 'video',
             ${baris.creatorPlatformId}, ${baris.creatorHandle}, ${baris.isAkunToko}, null, null,
             ${baris.vv}, ${baris.likes}, null, ${baris.dibagikan}, null, null, ${baris.klikProduk}, ${baris.gmv}, null)
          on conflict (client_platform_id, platform_content_id, periode) do update set
            batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
            creator_platform_id = excluded.creator_platform_id, creator_handle = excluded.creator_handle,
            is_akun_toko = excluded.is_akun_toko, vv = excluded.vv, likes = excluded.likes,
            dibagikan = excluded.dibagikan, klik_produk = excluded.klik_produk, gmv = excluded.gmv`;
      }
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KESEMBILAN (sesi 24), `shopee_live` → `pdt_fact_content`
  // (lihat docblock `ekstrakBarisShopeeLive`, `@cdps/core` `pdt/fakta.ts`). Sama pola
  // `ON CONFLICT ... DO UPDATE` seperti `tt_video` di atas — `platform_content_id` (digit
  // mentah `Waktu Mulai`) SELALU ada untuk baris yang ditulis (baris tanpa `Waktu Mulai`
  // yang valid sudah dilewati di `ekstrakBarisShopeeLive`), jadi unique index tidak punya
  // komponen NULL. `sku_id`/`creator_platform_id`/`creator_handle` SELALU NULL (modul ini
  // tidak punya identitas produk maupun kreator terpisah); `is_akun_toko` SELALU `true`
  // (sesi live Shopee secara struktural HANYA akun toko sendiri, bukan afiliasi). `periode`
  // — AWAL BULAN batch (sama pola `tt_video` di atas, migrasi sesi 34).
  if (berkasShopeeLive.length > 0) {
    for (const b of berkasShopeeLive) {
      for (const baris of pdt.ekstrakBarisShopeeLive(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_content
            (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis,
             creator_platform_id, creator_handle, is_akun_toko, waktu_posting, sku_id,
             vv, likes, komentar, dibagikan, pengikut_baru, produk_dilihat, klik_produk, gmv, durasi_detik)
          values
            (${clientPlatformId}, ${baris.platformContentId}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI}, 'live',
             null, null, true, ${baris.waktuPosting}, null,
             ${baris.vv}, null, null, null, null, null, null, ${baris.gmv}, null)
          on conflict (client_platform_id, platform_content_id, periode) do update set
            batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
            waktu_posting = excluded.waktu_posting, vv = excluded.vv, gmv = excluded.gmv`;
      }
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KESEPULUH, `tt_live` → `pdt_fact_content` (lihat
  // docblock `ekstrakBarisTtLive`, `@cdps/core` `pdt/fakta.ts`) — `G1-09-2BII-TTLIVE`
  // DITUTUP (sample asli "Tiktok - Avitaskin.zip": `ID Kreator` + `Waktu Live` menit
  // presisi TERBUKTI 100% unik, sama pola `shopee_live`). BEDA dari `shopee_live`:
  // `creator_platform_id`/`creator_handle` TERISI (laporan ini campuran toko+afiliasi,
  // `is_akun_toko` per baris membedakannya — pola sama `tt_video`), `waktu_posting`
  // SELALU NULL (zona waktu dashboard TikTok belum terverifikasi, lihat docblock
  // `ekstrakBarisTtLive`), `durasi_detik` TERISI (`Durasi` "Xh Ymin" → detik). `periode`
  // — AWAL BULAN batch (sama pola dua modul di atas, migrasi sesi 34).
  if (berkasTtLive.length > 0) {
    for (const b of berkasTtLive) {
      for (const baris of pdt.ekstrakBarisTtLive(b.aoa, b.barisHeader, akunKontenToko)) {
        await tx`
          insert into pdt_fact_content
            (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis,
             creator_platform_id, creator_handle, is_akun_toko, waktu_posting, sku_id,
             vv, likes, komentar, dibagikan, pengikut_baru, produk_dilihat, klik_produk, gmv, durasi_detik)
          values
            (${clientPlatformId}, ${baris.platformContentId}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI}, 'live',
             ${baris.creatorPlatformId}, ${baris.creatorHandle}, ${baris.isAkunToko}, null, null,
             ${baris.vv}, null, null, null, null, null, null, ${baris.gmv}, ${baris.durasiDetik})
          on conflict (client_platform_id, platform_content_id, periode) do update set
            batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
            creator_platform_id = excluded.creator_platform_id, creator_handle = excluded.creator_handle,
            is_akun_toko = excluded.is_akun_toko, vv = excluded.vv, gmv = excluded.gmv,
            durasi_detik = excluded.durasi_detik`;
      }
    }
  }

  // Sesi 34 (riset G2-01) — `tt_shop_analytics` → `pdt_fact_shop_daily`, basis 'net'
  // (lihat docblock `ekstrakBarisShopDailyTiktok`, `@cdps/core` `pdt/fakta.ts`, untuk
  // penemuan celah: keenam tabel fakta G1-01 sudah punya penulis KECUALI tabel ini —
  // nol pemanggil sejak lahir, luput dari seluruh sesi G1-09 sub-langkah 2b-ii).
  // Kunci unik (`client_platform_id, tanggal, basis`) nol komponen NULL — `ON CONFLICT
  // DO UPDATE` sungguhan, pola sama `pdt_fact_content`.
  if (berkasShopStatsTiktok.length > 0) {
    for (const b of berkasShopStatsTiktok) {
      for (const baris of pdt.ekstrakBarisShopDailyTiktok(b.aoa)) {
        await tx`
          insert into pdt_fact_shop_daily
            (client_platform_id, tanggal, basis, batch_id, parser_versi,
             gmv, pesanan, produk_terjual, pengunjung, produk_diklik, cr, pembeli, refund)
          values
            (${clientPlatformId}, ${baris.tanggal}::date, 'net', ${id}, ${pdt.PDT_PARSER_VERSI},
             ${baris.gmv}, ${baris.pesanan}, ${baris.produkTerjual}, ${baris.pengunjung}, ${baris.produkDiklik},
             ${baris.cr}, ${baris.pembeli}, ${baris.refund})
          on conflict (client_platform_id, tanggal, basis) do update set
            batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
            gmv = excluded.gmv, pesanan = excluded.pesanan, produk_terjual = excluded.produk_terjual,
            pengunjung = excluded.pengunjung, produk_diklik = excluded.produk_diklik, cr = excluded.cr,
            pembeli = excluded.pembeli, refund = excluded.refund`;
      }
    }
  }

  // Sesi 34 lanjutan (G1-09-2BII-SHOPDAILY-SHOPEE) — `shopee_shop_stats` → `pdt_fact_shop_daily`,
  // TIGA basis Rule 16 sekaligus dari SATU berkas (lihat docblock `ekstrakBarisShopDailyShopee`,
  // `@cdps/core` `pdt/fakta.ts`, untuk kenapa `b.sheets` bukan `b.aoa` yang terkunci ke satu
  // basis). `produk_terjual`/`pembeli_baru` dipetakan sama seperti TikTok; `cancel rate`/
  // `repeat rate` BELUM ada kolomnya di `pdt_fact_shop_daily` — dicatat Open baru
  // `G2-01-SHOPEE-CANCEL-REPEAT-RATE`, tidak memblokir gap mendasar ini.
  const BASIS_SHEET_SHOPEE: ReadonlyMap<string, string> = new Map([
    ['Pesanan Dibuat', 'dibuat'],
    ['Pesanan Siap Dikirim', 'siap_dikirim'],
    ['Pesanan Dibayar', 'dibayar'],
  ]);
  if (berkasShopStatsShopee.length > 0) {
    for (const b of berkasShopStatsShopee) {
      for (const [namaSheet, basis] of BASIS_SHEET_SHOPEE) {
        const aoaBasis = b.sheets?.get(namaSheet);
        if (!aoaBasis) continue;
        for (const baris of pdt.ekstrakBarisShopDailyShopee(aoaBasis)) {
          await tx`
            insert into pdt_fact_shop_daily
              (client_platform_id, tanggal, basis, batch_id, parser_versi,
               gmv, pesanan, pengunjung, produk_diklik, cr, pembeli, pembeli_baru, refund)
            values
              (${clientPlatformId}, ${baris.tanggal}::date, ${basis}, ${id}, ${pdt.PDT_PARSER_VERSI},
               ${baris.gmv}, ${baris.pesanan}, ${baris.pengunjung}, ${baris.produkDiklik},
               ${baris.cr}, ${baris.pembeli}, ${baris.pembeliBaru}, ${baris.refund})
            on conflict (client_platform_id, tanggal, basis) do update set
              batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
              gmv = excluded.gmv, pesanan = excluded.pesanan,
              pengunjung = excluded.pengunjung, produk_diklik = excluded.produk_diklik, cr = excluded.cr,
              pembeli = excluded.pembeli, pembeli_baru = excluded.pembeli_baru, refund = excluded.refund`;
        }
      }
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KETIGA, `pdt_sku_master` (lihat docblock
  // `ekstrakBarisSkuMasterShopeeParentSku`/`ekstrakBarisSkuMasterTtOrders`,
  // `@cdps/core` `pdt/fakta.ts`). BEDA dari `pdt_fact_ads`/`pdt_fact_content` di atas:
  // ini tabel MASTER, bukan fakta per-periode — Rule 19 (`docs/PRD` §3.4) SKU tidak
  // pernah dihapus, hanya `status_listing`/`last_seen_at` yang berubah. UPSERT sungguhan
  // (`ON CONFLICT (client_platform_id, platform_product_id, platform_variation_id) DO
  // UPDATE`, kunci = `uq_pdt_sku_master`), field opsional (`seller_sku`/`nama_produk`/
  // `nama_variasi`/`kategori_platform`/`harga_satuan_terakhir`) di-COALESCE dengan nilai
  // lama supaya sumber yang tidak membawa field itu (mis. `shopee_parent_sku` untuk
  // nama/kategori/harga) tidak menimpanya jadi NULL. `status_listing` selalu diset
  // 'aktif' di sini — SKU yang muncul di batch berarti masih terlihat; transisi ke
  // 'nonaktif'/'dihapus_platform' (SKU yang BERHENTI muncul) butuh perbandingan lintas
  // batch yang belum ada mesinnya (`G1-09-2BII-SKU-STATUS-TRANSISI`, Open baru).
  for (const b of [...berkasParentSkuUntukMaster, ...berkasTtOrders]) {
    const ekstrak = b.modul.kode === 'shopee_parent_sku'
      ? pdt.ekstrakBarisSkuMasterShopeeParentSku(b.aoa, b.barisHeader)
      : pdt.ekstrakBarisSkuMasterTtOrders(b.aoa, b.barisHeader);
    for (const baris of ekstrak) {
      await tx`
        insert into pdt_sku_master
          (client_platform_id, platform_product_id, platform_variation_id, seller_sku,
           nama_produk, nama_variasi, kategori_platform, harga_satuan_terakhir,
           status_listing, first_seen_at, last_seen_at)
        values
          (${clientPlatformId}, ${baris.platformProductId}, ${baris.platformVariationId}, ${baris.sellerSku},
           ${baris.namaProduk}, ${baris.namaVariasi}, ${baris.kategoriPlatform}, ${baris.hargaSatuanTerakhir},
           'aktif', ${now.toISOString()}, ${now.toISOString()})
        on conflict (client_platform_id, platform_product_id, platform_variation_id) do update set
          seller_sku = coalesce(excluded.seller_sku, pdt_sku_master.seller_sku),
          nama_produk = coalesce(excluded.nama_produk, pdt_sku_master.nama_produk),
          nama_variasi = coalesce(excluded.nama_variasi, pdt_sku_master.nama_variasi),
          kategori_platform = coalesce(excluded.kategori_platform, pdt_sku_master.kategori_platform),
          harga_satuan_terakhir = coalesce(excluded.harga_satuan_terakhir, pdt_sku_master.harga_satuan_terakhir),
          status_listing = 'aktif',
          last_seen_at = excluded.last_seen_at`;
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KEEMPAT, `tt_transaction_creator` → `pdt_fact_creator_period`
  // (lihat docblock `ekstrakBarisKreatorTtTransactionCreator`, `@cdps/core` `pdt/fakta.ts`).
  // Kunci unik `pdt_fact_creator_period` (`client_platform_id, creator_handle, periode`)
  // TIDAK pernah punya komponen NULL (baris ber-`Creator name` kosong sudah dilewati di
  // ekstraksi) — `ON CONFLICT ... DO UPDATE` sungguhan AMAN, sama pola `pdt_fact_content`
  // (bukan delete-then-insert seperti `pdt_fact_ads`).
  if (berkasTtTransactionCreator.length > 0) {
    for (const b of berkasTtTransactionCreator) {
      for (const baris of pdt.ekstrakBarisKreatorTtTransactionCreator(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_creator_period
            (client_platform_id, creator_handle, periode, batch_id, parser_versi,
             gmv, gmv_live, gmv_video, pesanan_teratribusi, aov, ctor, jumlah_live, jumlah_video, sampel_terkirim)
          values
            (${clientPlatformId}, ${baris.creatorHandle}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI},
             ${baris.gmv}, null, null, ${baris.pesananTeratribusi}, ${baris.aov}, ${baris.ctor}, ${baris.jumlahLive}, ${baris.jumlahVideo}, null)
          on conflict (client_platform_id, creator_handle, periode) do update set
            batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
            gmv = excluded.gmv, pesanan_teratribusi = excluded.pesanan_teratribusi,
            aov = excluded.aov, ctor = excluded.ctor, jumlah_live = excluded.jumlah_live, jumlah_video = excluded.jumlah_video`;
      }
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KELIMA, `shopee_ams_afiliasi` → `pdt_fact_creator_period`
  // (lihat docblock `ekstrakBarisKreatorShopeeAmsAfiliasi`, `@cdps/core` `pdt/fakta.ts`) —
  // sisi Shopee, sama pola `ON CONFLICT DO UPDATE` seperti modul KEEMPAT (TikTok) di atas.
  // `gmv_live`/`gmv_video`/`aov`/`ctor`/`jumlah_live`/`jumlah_video`/`sampel_terkirim` TIDAK
  // disentuh (COALESCE tidak dipakai di sini — modul ini tidak membawanya sama sekali, dan
  // beda dari `pdt_sku_master`, tabel fakta ini tidak butuh field opsional dijaga dari
  // penimpaan lintas-platform karena Shopee/TikTok selalu punya `client_platform_id` berbeda).
  if (berkasShopeeAmsAfiliasi.length > 0) {
    for (const b of berkasShopeeAmsAfiliasi) {
      for (const baris of pdt.ekstrakBarisKreatorShopeeAmsAfiliasi(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_creator_period
            (client_platform_id, creator_handle, periode, batch_id, parser_versi,
             gmv, gmv_live, gmv_video, pesanan_teratribusi, aov, ctor, jumlah_live, jumlah_video, sampel_terkirim)
          values
            (${clientPlatformId}, ${baris.creatorHandle}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI},
             ${baris.gmv}, null, null, ${baris.pesananTeratribusi}, null, null, null, null, null)
          on conflict (client_platform_id, creator_handle, periode) do update set
            batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
            gmv = excluded.gmv, pesanan_teratribusi = excluded.pesanan_teratribusi`;
      }
    }
  }

  // G1-09 sub-langkah 2b-ii — modul KEDELAPAN (sesi 23), `shopee_ams_produk` →
  // `pdt_fact_sku_period` (lihat docblock `ekstrakBarisShopeeAmsProduk`, `@cdps/core`
  // `pdt/fakta.ts`). `sku_id` SELALU NULL (level produk-induk, `G1-09-2BII-ADS-CPC-SKU`
  // DITUTUP sesi ini) — replace-on-recommit (DELETE scope lalu INSERT), sama alasan
  // `pdt_fact_ads` di atas: baris LAMA yang `platform_product_id`-nya sudah tidak muncul di
  // batch baru (produk delisting dari laporan AMS) harus ikut hilang, bukan cuma di-upsert
  // per baris — `ON CONFLICT` pada unique index PARSIAL `uq_pdt_fact_sku_period_produk`
  // tidak menutupi kasus itu. `basis = 'dibayar'` LITERAL (bukan dari kolom manapun di
  // berkas — keputusan pemilik, lihat docblock `ekstrakBarisShopeeAmsProduk`).
  if (berkasShopeeAmsProduk.length > 0) {
    await tx`
      delete from pdt_fact_sku_period
       where client_platform_id = ${clientPlatformId} and sku_id is null and basis = 'dibayar'
         and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasShopeeAmsProduk) {
      for (const baris of pdt.ekstrakBarisShopeeAmsProduk(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_sku_period
            (sku_id, client_platform_id, platform_product_id, periode, basis, batch_id,
             parser_versi, gmv, produk_terjual, pesanan)
          values
            (null, ${clientPlatformId}, ${baris.platformProductId}, ${periodeAwalBulan}::date, 'dibayar', ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.gmv}, ${baris.produkTerjual}, ${baris.pesanan})`;
      }
    }
  }
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

// ===========================================================================
// G1-10 — Job purge harian (Flow E, Rule 45-49; `docs/backlog/PDT_BACKLOG.md`
// G1-10, `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §3/§4).
//
// Domain hanya memutuskan APA yang dihapus (baca+tulis DB) — penghapusan
// OBJEK STORAGE sungguhan ada di lapisan route (`apps/api/src/lib/pdt-storage.ts`
// `hapusPdtRawObjek`), pola sama `commitUploadBatch`/`unggahPdtRawObjek`: domain
// tidak pernah memanggil Storage REST langsung. Urutan dua fungsi di bawah
// cermin Flow E: `planPdtPurgeTick` (langkah 1-3, baca + pagar) dijalankan
// route LEBIH DULU; untuk tiap kandidat route memanggil `hapusPdtRawObjek`
// sendiri-sendiri (Rule 46 error path — satu objek gagal tidak menghentikan
// sisanya); hasilnya dikumpulkan lalu diserahkan ke `finalizePdtPurgeTick`
// (langkah 4/6, tulis).
//
// Cakupan SENGAJA dipersempit dari Rule 45 penuh sesi 26 (dicatat
// `docs/DECISIONS.md` — Open, BELUM ditutup sesi 28):
//   recompute perpanjangan retensi (Rule 45 langkah 2) HARI INI hanya
//   membaca `retensi_sampai`/`legal_hold` yang sudah tersimpan (default
//   120 hari verified / 30 hari ditolak, migrasi G1-01) — DUA dari EMPAT
//   pemicu perpanjangan ("menopang laporan yang sudah dikirim" →
//   `pdt_laporan_kiriman`, "SKU di katalog PX" → `px_sku_volume`)
//   menunjuk tabel yang BELUM ADA (G2-01/G5 belum dibangun). Purge hari
//   ini tidak bisa salah memperpanjang retensi yang seharusnya
//   diperpanjang oleh dua pemicu itu — karena tidak ada baris yang bisa
//   dibaca untuk memutuskannya — tapi juga tidak bisa BENAR
//   melakukannya. Menutup gap ini adalah pekerjaan lanjutan G2-01/G5.
//
// Pass KEDUA Flow E (Rule 49 — objek yatim > 7 hari) dibangun sesi 28
// (`G1-10-ORPHAN-PASS`, `docs/DECISIONS.md`): `planPdtOrphanPurgeTick` di
// bawah menerima daftar SELURUH objek bucket sebagai parameter (bukan
// memanggil Storage sendiri — domain tidak pernah bicara Storage REST
// langsung, pola sama pass pertama) hasil `listPdtRawObjekRekursif`
// (`apps/api/src/lib/pdt-storage.ts`, baru), lalu memutuskan mana yang
// "yatim": path yang TIDAK muncul di `pdt_upload_batch.raw_path` MANA PUN
// (bukan hanya yang aktif — batch yang sudah `raw_dihapus_pada` pun raw_path-nya
// tetap "dikenal", objek fisiknya harusnya sudah tidak ada; kalaupun ada sisa
// karena kegagalan hapus lampau, itu tanggung jawab pass PERTAMA mencoba lagi,
// bukan pass ini) DAN umurnya (`createdAt` Storage) > 7 hari. Objek yang
// umurnya TIDAK diketahui (Storage tidak mengembalikan `created_at`) SENGAJA
// tidak pernah jadi kandidat — pagar konservatif yang sama semangatnya dengan
// Rule 48: tidak bisa membuktikan umur berarti tidak boleh menghapus.
// ===========================================================================

/** Rule 48 — pagar harian: tidak boleh menghapus > 5% objek aktif per hari tanpa ACC Director. */
export const PDT_PURGE_GUARD_PCT = 5;

/** Actor sistem untuk audit/notifikasi tick — pola sama `plan.ts` `PLAN_JOB_ACTOR_ID`. */
const PDT_PURGE_ACTOR = 'SISTEM';

const MSG_PDT_PURGE_TANGGAL_INVALID = '[tanggal tick tidak valid]';

/** Satu batch yang lolos gerbang Rule 45/48 dan siap dihapus objek storage-nya. */
export interface PdtPurgeCandidate {
  batchId: number;
  rawPath: string;
  rawBytes: number | null;
}

/** Rencana tick hari ini — hasil `planPdtPurgeTick` (Flow E langkah 1-3). */
export interface PdtPurgeTickPlan {
  today: string;
  totalObjekAktif: number;
  ambangObjek: number;
  kandidat: readonly PdtPurgeCandidate[];
  pagarTerlampaui: boolean;
}

/** Hasil mencoba menghapus SATU kandidat — dilaporkan balik route setelah memanggil Storage. */
export interface PdtPurgeOutcome {
  batchId: number;
  bytes: number | null;
  berhasil: boolean;
}

/** Rekap akhir tick — hasil `finalizePdtPurgeTick` (Flow E langkah 4/6). */
export interface PdtPurgeTickResult {
  today: string;
  dihapus: number;
  bytesDihapus: number;
  gagal: number;
  pagarTerlampaui: boolean;
}

/** Directors' employee ids (peran berlapis) — pola sama `finance.ts` `directorIds` (tidak diekspor di sana). */
async function pdtDirectorIds(sql: Sql): Promise<string[]> {
  const rows = await sql<{ employee_id: string }[]>`
    select e.employee_id
      from employee_layered_roles r
      join employees e on e.employee_id = r.employee_id
     where r.role = 'director' and r.enabled = true and e.status_aktif = true
     order by e.employee_id`;
  return rows.map((r) => r.employee_id);
}

/**
 * planPdtPurgeTick — Flow E langkah 1-3. Memilih batch `retensi_sampai < today`,
 * `legal_hold = false`, `raw_dihapus_pada IS NULL`, `raw_path IS NOT NULL`
 * (langkah 1; langkah 2 recompute — lihat catatan cakupan di atas). Langkah 3:
 * kandidat melebihi `PDT_PURGE_GUARD_PCT`% dari objek aktif ⇒ PAGAR (Rule 48)
 * — kandidat dikosongkan, notifikasi ke Directors dikirim, NOL baris disentuh.
 * Murni baca, ditambah (hanya bila pagar tersentuh) SATU tulis notifikasi —
 * TIDAK menghapus objek storage maupun mengisi `raw_dihapus_pada` (itu
 * `finalizePdtPurgeTick`, dipanggil route SETELAH penghapusan storage
 * sungguhan). Idempoten dalam satu hari: batch yang sudah `raw_dihapus_pada`
 * tidak pernah lagi jadi kandidat.
 */
export async function planPdtPurgeTick(sql: Sql, today: string): Promise<PdtPurgeTickPlan> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new ValidationError(MSG_PDT_PURGE_TANGGAL_INVALID);
  }

  const [{ n: totalObjekAktif }] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from pdt_upload_batch
     where raw_path is not null and raw_dihapus_pada is null`;

  const kandidatRows = await sql<{ id: number; raw_path: string; raw_bytes: number | null }[]>`
    select id, raw_path, raw_bytes
      from pdt_upload_batch
     where raw_path is not null and raw_dihapus_pada is null
       and legal_hold = false and retensi_sampai < ${today}::date
     order by id`;
  const semuaKandidat: PdtPurgeCandidate[] = kandidatRows.map((r) => ({
    batchId: r.id,
    rawPath: r.raw_path,
    rawBytes: r.raw_bytes,
  }));

  const ambangObjek = Math.floor((totalObjekAktif * PDT_PURGE_GUARD_PCT) / 100);
  const pagarTerlampaui = semuaKandidat.length > ambangObjek;

  if (pagarTerlampaui) {
    const directors = await pdtDirectorIds(sql);
    if (directors.length > 0) {
      await notification.emit(executors(sql).notify, {
        event: notification.EVENTS.PdtPurgeGuardExceeded,
        entityType: 'pdt_upload_batch',
        entityId: today,
        actor: PDT_PURGE_ACTOR,
        explicitRecipients: directors,
        notifyActor: false,
        deepLink: '/pdt/batches',
      });
    }
    return { today, totalObjekAktif, ambangObjek, kandidat: [], pagarTerlampaui: true };
  }

  return { today, totalObjekAktif, ambangObjek, kandidat: semuaKandidat, pagarTerlampaui: false };
}

/**
 * finalizePdtPurgeTick — Flow E langkah 4/6. Dipanggil route SETELAH mencoba
 * menghapus objek storage tiap kandidat (`hapusPdtRawObjek`, framework-free,
 * lapisan `apps/api`) — `hasil` membawa sukses/gagal per batch. Hanya batch
 * `berhasil` yang `raw_dihapus_pada` diisi (Rule 46: "hanya diisi setelah
 * penghapusan objek benar-benar berhasil"); yang gagal dibiarkan NULL untuk
 * dicoba lagi tick besok (Rule 46 error path) — TIDAK menghentikan batch lain
 * dalam tick yang sama (pemanggil sudah mengiterasi semuanya sebelum sampai
 * di sini). Rule 47: SATU entri `audit_log` per tick (bukan per objek)
 * merekap jumlah objek + total byte — nol entri ditulis bila nol objek
 * berhasil dihapus (mis. seluruh kandidat gagal, atau kandidat memang kosong).
 */
export async function finalizePdtPurgeTick(
  sql: Sql,
  today: string,
  hasil: readonly PdtPurgeOutcome[],
): Promise<PdtPurgeTickResult> {
  const berhasil = hasil.filter((h) => h.berhasil);
  const gagal = hasil.length - berhasil.length;
  const bytesDihapus = berhasil.reduce((n, h) => n + (h.bytes ?? 0), 0);

  for (const h of berhasil) {
    await sql`
      update pdt_upload_batch set raw_dihapus_pada = now()
       where id = ${h.batchId} and raw_dihapus_pada is null`;
  }

  if (berhasil.length > 0) {
    await executors(sql).audit.insertAudit({
      entityType: 'pdt_purge_tick',
      entityId: today,
      actorEmployeeId: PDT_PURGE_ACTOR,
      action: 'pdt_raw_purged',
      beforeJson: null,
      afterJson: {
        jumlah_objek: berhasil.length,
        total_bytes: bytesDihapus,
        batch_ids: berhasil.map((h) => h.batchId),
      },
      createdBy: PDT_PURGE_ACTOR,
    });
  }

  return { today, dihapus: berhasil.length, bytesDihapus, gagal, pagarTerlampaui: false };
}

/** Umur minimum (hari) sebelum objek yatim boleh dipurge (Rule 49). */
export const PDT_ORPHAN_UMUR_HARI = 7;

/** Satu objek storage sungguhan — hasil `listPdtRawObjekRekursif` (lapisan `apps/api`). */
export interface PdtRawObjekStorage {
  path: string;
  createdAt: string | null;
}

/** Satu objek yatim yang lolos gerbang Rule 49 dan siap dihapus. */
export interface PdtOrphanCandidate {
  path: string;
}

/** Rencana pass kedua tick hari ini — hasil `planPdtOrphanPurgeTick`. */
export interface PdtOrphanPurgeTickPlan {
  today: string;
  kandidat: readonly PdtOrphanCandidate[];
}

/** Hasil mencoba menghapus SATU objek yatim — dilaporkan balik route setelah memanggil Storage. */
export interface PdtOrphanPurgeOutcome {
  path: string;
  berhasil: boolean;
}

/** Rekap akhir pass kedua tick — hasil `finalizePdtOrphanPurgeTick`. */
export interface PdtOrphanPurgeTickResult {
  today: string;
  dihapus: number;
  gagal: number;
}

/**
 * planPdtOrphanPurgeTick — Flow E langkah 5 (Rule 49). Menerima `semuaObjek`
 * (SUDAH dilisting rekursif oleh pemanggil, `listPdtRawObjekRekursif` —
 * fungsi ini murni membandingkan, nol panggilan Storage) dan menandai yang
 * TIDAK punya baris `pdt_upload_batch.raw_path` MANA PUN (verified, ditolak,
 * sudah dihapus — semuanya "dikenal", hanya path yang benar-benar nol baris
 * yang yatim) DAN `createdAt`-nya lebih tua dari `PDT_ORPHAN_UMUR_HARI` hari.
 * Objek ber-`createdAt` null (umur tidak diketahui) TIDAK PERNAH jadi
 * kandidat — pagar konservatif, bukan bug. Nol pagar 5% di sini: Rule 48
 * ("tidak boleh menghapus objek yang retensi_sampai-nya belum lewat")
 * bicara tentang batch yang retensinya belum lewat, dan objek yatim
 * (Rule 49) tidak punya `retensi_sampai` sama sekali — tidak dikenakan
 * Rule 48.
 */
export async function planPdtOrphanPurgeTick(
  sql: Sql,
  today: string,
  semuaObjek: readonly PdtRawObjekStorage[],
): Promise<PdtOrphanPurgeTickPlan> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new ValidationError(MSG_PDT_PURGE_TANGGAL_INVALID);
  }

  const dikenalRows = await sql<{ raw_path: string }[]>`
    select raw_path from pdt_upload_batch where raw_path is not null`;
  const dikenal = new Set(dikenalRows.map((r) => r.raw_path));

  const ambangWaktu = new Date(`${today}T00:00:00.000Z`).getTime() - PDT_ORPHAN_UMUR_HARI * 24 * 60 * 60 * 1000;
  const kandidat: PdtOrphanCandidate[] = semuaObjek
    .filter((o) => !dikenal.has(o.path))
    .filter((o) => o.createdAt !== null && new Date(o.createdAt).getTime() < ambangWaktu)
    .map((o) => ({ path: o.path }));

  return { today, kandidat };
}

/**
 * finalizePdtOrphanPurgeTick — rekap pass kedua. Objek yatim tidak punya
 * baris `pdt_upload_batch` untuk ditandai (beda dari pass pertama) — hanya
 * SATU entri `audit_log` (`action='pdt_raw_orphan_purged'`) per tick yang
 * berhasil menghapus ≥1 objek (Rule 47, pola sama pass pertama).
 */
export async function finalizePdtOrphanPurgeTick(
  sql: Sql,
  today: string,
  hasil: readonly PdtOrphanPurgeOutcome[],
): Promise<PdtOrphanPurgeTickResult> {
  const berhasil = hasil.filter((h) => h.berhasil);
  const gagal = hasil.length - berhasil.length;

  if (berhasil.length > 0) {
    await executors(sql).audit.insertAudit({
      entityType: 'pdt_purge_tick',
      entityId: today,
      actorEmployeeId: PDT_PURGE_ACTOR,
      action: 'pdt_raw_orphan_purged',
      beforeJson: null,
      afterJson: { jumlah_objek: berhasil.length, paths: berhasil.map((h) => h.path) },
      createdBy: PDT_PURGE_ACTOR,
    });
  }

  return { today, dihapus: berhasil.length, gagal };
}

// ===========================================================================
// G1-11 — Job reparse dari paket ZIP (Flow D; `docs/backlog/PDT_BACKLOG.md`
// G1-11, `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §3/§4).
//
// **Cakupan SENGAJA dipersempit ke bacaan literal Flow D** (dicatat
// `docs/DECISIONS.md` sesi 28): Flow D menyebut TIGA hal — "memparse ulang",
// "menaikkan parser_versi baris fakta", "mencatat audit_logs" — nol
// penyebutan status batch (`verified`/`ditolak`/dst.), identitas, periode,
// atau `reconcile_delta_pct`. `reparsePdtBatch` di bawah karena itu HANYA
// menulis ulang baris fakta (lewat `tulisFaktaModulTerparse`, SAMA fungsi
// yang dipakai `commitUploadBatch`) untuk (client_platform_id, periode)
// batch yang SUDAH ADA, memakai `id` batch itu APA ADANYA — TIDAK pernah
// membuat baris `pdt_upload_batch` baru, TIDAK menyentuh
// `status`/`alasan_ditolak`/`reconcile_delta_pct`/`identitas_sumber`/
// `retensi_sampai`, dan TIDAK menulis ulang `pdt_file` (metadata deteksi
// batch ASLI tetap sebagai riwayat apa adanya). Ini BUKAN kelalaian:
// `commitUploadBatch`'s error message sendiri (`isUniqueViolation` di atas)
// SUDAH mengarahkan AM ke "reparse batch lama (Flow D) alih-alih mengunggah
// batch verified baru untuk periode yang sama" — status batch yang
// dipertahankan apa adanya adalah PRASYARAT supaya saran itu tidak
// menciptakan konflik `uq_pdt_upload_batch_verified` baru terhadap dirinya
// sendiri. Kalau kelak reparse ternyata JUGA harus boleh mengubah status
// (mis. bug parser yang diperbaiki mengubah hasil rekonsiliasi Rule 13-16),
// itu keputusan arsitektur terpisah yang BELUM diminta PRD — dicatat sebagai
// Open baru (`G1-11-REPARSE-RECOMPUTE-STATUS`), bukan ditebak di sini.
//
// AM override (`pdt_file.deteksi_oleh = 'override_am'`) dari commit ASLI
// dipertahankan otomatis (dibaca ulang dari `pdt_file`, bukan parameter
// terpisah) — modul lain di-deteksi ULANG dengan `tandaTanganKolom`
// TERKINI, supaya bug deteksi yang sudah diperbaiki (mis. PR #387 ambiguitas
// `shopee_ams_afiliasi`) ikut membetulkan batch lama, bukan hanya batch
// baru. Route (`internal/pdt/reparse/tick`) menjalankan pipeline
// unduh-ekstrak-deteksi YANG SAMA dengan commit (Flow A) — domain tidak
// pernah menyentuh Storage/ZIP.
//
// Trigger: TICK HARIAN (pola sama G1-10 purge) memindai
// `parser_versi < PDT_PARSER_VERSI` — nol biaya pada hari biasa (predikat
// itu kosong sampai `PDT_PARSER_VERSI` dinaikkan), otomatis memproses
// backlog begitu ia naik. PRD tidak menyebut mekanisme trigger secara
// eksplisit ("job reparse" saja) — cron harian dipilih karena Flow D
// terstruktur SEJAJAR Flow E ("Purge harian (otomatis)") di PRD §4, bukan
// sebagai aksi manual AM/engineer yang PRD juga tidak sebutkan aktornya.
// ===========================================================================

const PDT_REPARSE_ACTOR = 'SISTEM';

/** Satu batch yang layak direparse — `parser_versi` ketinggalan DAN paketnya masih ada. */
export interface PdtReparseCandidate {
  batchId: number;
  clientPlatformId: number;
  rawPath: string;
}

/** Satu batch yang TIDAK bisa direparse — paketnya sudah dipurge (Rule 46 error path, Flow D langkah 4). */
export interface PdtReparseSkipped {
  batchId: number;
  rawDihapusPada: string;
}

/** Rencana tick — hasil `planPdtReparseTick`. */
export interface PdtReparseTickPlan {
  kandidat: readonly PdtReparseCandidate[];
  perluUploadUlang: readonly PdtReparseSkipped[];
}

/**
 * planPdtReparseTick — memilih batch `parser_versi < PDT_PARSER_VERSI` DAN
 * `raw_path IS NOT NULL` (batch yang belum pernah menyelesaikan upload tidak
 * relevan). Dipisah dua daftar: `kandidat` (paket masih ada, `raw_dihapus_pada
 * IS NULL`) untuk route proses lewat `reparsePdtBatch`, dan
 * `perluUploadUlang` (paket sudah dipurge) — Flow D langkah 4: "dilewati dan
 * dilaporkan sebagai daftar, bukan digagalkan diam-diam". Murni baca — nol
 * tulis, nol keputusan (beda dari `planPdtPurgeTick` yang punya pagar 5%;
 * Flow D tidak menyebut pagar volume untuk reparse).
 */
export async function planPdtReparseTick(sql: Sql): Promise<PdtReparseTickPlan> {
  const rows = await sql<{ id: number; client_platform_id: number; raw_path: string; raw_dihapus_pada: Date | string | null }[]>`
    select id, client_platform_id, raw_path, raw_dihapus_pada
      from pdt_upload_batch
     where parser_versi < ${pdt.PDT_PARSER_VERSI} and raw_path is not null
     order by id`;

  const kandidat: PdtReparseCandidate[] = [];
  const perluUploadUlang: PdtReparseSkipped[] = [];
  for (const r of rows) {
    if (r.raw_dihapus_pada != null) {
      perluUploadUlang.push({ batchId: r.id, rawDihapusPada: new Date(r.raw_dihapus_pada).toISOString() });
    } else {
      kandidat.push({ batchId: r.id, clientPlatformId: r.client_platform_id, rawPath: r.raw_path });
    }
  }
  return { kandidat, perluUploadUlang };
}

/** Hasil `reparsePdtBatch` untuk SATU batch. */
export interface PdtReparseHasil {
  batchId: number;
  direparse: boolean;
  /** `'paket_terpurge'` bila `raw_dihapus_pada` sudah terisi — nol tulis terjadi. */
  alasanDilewati: 'paket_terpurge' | null;
  rawDihapusPada: string | null;
}

/**
 * reparsePdtBatch — Flow D langkah 2-3. Menerima `berkasInput` (SUDAH
 * diunduh+diekstrak+dideteksi ULANG oleh pemanggil dari `pdt_upload_batch.raw_path`
 * SAAT INI, pola sama `commitUploadBatch`: domain tidak pernah menyentuh
 * Storage/ZIP). AM override dari commit ASLI dibaca ulang dari `pdt_file`
 * (`deteksi_oleh = 'override_am'`) — berkas lain di-deteksi ulang dari
 * `modulTerdeteksi` yang pemanggil kirim (hasil `detectPdtModule` TERKINI).
 *
 * Batch dengan `raw_dihapus_pada` terisi (paket sudah dipurge) mengembalikan
 * `direparse: false` TANPA melempar dan TANPA menulis apa pun — pemanggil
 * (tick) mengumpulkan ini ke daftar `perlu_upload_ulang`, bukan menggagalkan
 * seluruh tick. Batch tidak ditemukan ⇒ `NotFoundError` (beda kasus: ini
 * SALAH PEMANGGILAN, bukan kondisi normal Flow D).
 *
 * `id`/`clientPlatformId`/`periodeAwalBulan` dipakai APA ADANYA dari batch
 * yang SUDAH ADA (lihat docblock seksi G1-11 di atas untuk kenapa TIDAK
 * di-re-derive dari isi berkas yang diparse ulang) — `tulisFaktaModulTerparse`
 * yang SAMA dipakai `commitUploadBatch` menulis ulang baris fakta, lalu
 * `pdt_upload_batch.parser_versi` dinaikkan ke `PDT_PARSER_VERSI` dan SATU
 * `audit_log` (`action = 'pdt_reparse'`) mencatat versi lama→baru.
 */
export async function reparsePdtBatch(
  sql: Sql,
  batchId: number,
  berkasInput: readonly PdtPreviewBerkasInput[],
  now: Date = new Date(),
): Promise<PdtReparseHasil> {
  const rows = await sql<{
    id: number;
    client_platform_id: number;
    platform: string;
    raw_dihapus_pada: Date | string | null;
    periode_awal_bulan: string;
    parser_versi: number;
  }[]>`
    select id, client_platform_id, platform, raw_dihapus_pada, parser_versi,
           to_char(date_trunc('month', periode_mulai), 'YYYY-MM-DD') as periode_awal_bulan
      from pdt_upload_batch
     where id = ${batchId}`;
  const batch = rows[0];
  if (!batch) throw new NotFoundError('[batch PDT tidak ditemukan]');

  if (batch.raw_dihapus_pada != null) {
    return {
      batchId,
      direparse: false,
      alasanDilewati: 'paket_terpurge',
      rawDihapusPada: new Date(batch.raw_dihapus_pada).toISOString(),
    };
  }

  const clientPlatformId = batch.client_platform_id;
  const cpRow = await loadClientPlatformUntukPdt(sql, clientPlatformId);

  const overrideRows = await sql<{ nama_entri: string; modul_kode: string | null }[]>`
    select nama_entri, modul_kode from pdt_file
     where batch_id = ${batchId} and deteksi_oleh = 'override_am' and modul_kode is not null`;
  const overrideByNama = new Map(overrideRows.map((r) => [r.nama_entri, r.modul_kode as string]));

  const terparse: BerkasTerparse[] = [];
  for (const b of berkasInput) {
    const overrideKode = overrideByNama.get(b.nama);
    const berlakuOverride = overrideKode != null && b.aoa != null;
    // `aoa` DIKOREKSI ke sheet `namaSheet` modul override, sama alasan `commitUploadBatch`
    // (G1-09-SHEET-BUKAN-PERTAMA) — reparse membaca ULANG dari ZIP mentah, jadi
    // `b.sheets` yang dibawa `parsePdtZipEntries` TERKINI selalu tersedia untuk ini.
    const efektif: PdtPreviewBerkasInput = berlakuOverride
      ? { ...b, aoa: aoaUntukModulEfektif(b, overrideKode), modulTerdeteksi: overrideKode, ambiguous: false, matches: [overrideKode] }
      : b;
    const { terparse: t } = bangunSatuPreviewBerkas(efektif);
    if (t) terparse.push(t);
  }

  await withTransaction(sql, async (tx) => {
    await tulisFaktaModulTerparse(tx, {
      id: batchId,
      clientPlatformId,
      periodeAwalBulan: batch.periode_awal_bulan,
      akunKontenToko: cpRow.akun_konten_toko,
      now,
      berkasAdsLive: terparse.filter((b) => b.modul.kode === 'shopee_ads_live'),
      berkasAdsCpc: terparse.filter((b) => b.modul.kode === 'shopee_ads_cpc'),
      berkasAdsSearch: terparse.filter((b) => b.modul.kode === 'shopee_ads_search'),
      berkasTtVideo: terparse.filter((b) => b.modul.kode === 'tt_video'),
      berkasShopeeLive: terparse.filter((b) => b.modul.kode === 'shopee_live'),
      berkasTtLive: terparse.filter((b) => b.modul.kode === 'tt_live'),
      berkasShopStatsTiktok: terparse.filter((b) => b.modul.kode === 'tt_shop_analytics'),
      berkasShopStatsShopee: terparse.filter((b) => b.modul.kode === 'shopee_shop_stats'),
      berkasParentSkuUntukMaster: terparse.filter((b) => b.modul.kode === 'shopee_parent_sku'),
      berkasTtOrders: terparse.filter((b) => b.modul.kode === 'tt_orders'),
      berkasTtTransactionCreator: terparse.filter((b) => b.modul.kode === 'tt_transaction_creator'),
      berkasShopeeAmsAfiliasi: terparse.filter((b) => b.modul.kode === 'shopee_ams_afiliasi'),
      berkasShopeeAmsProduk: terparse.filter((b) => b.modul.kode === 'shopee_ams_produk'),
    });

    await tx`update pdt_upload_batch set parser_versi = ${pdt.PDT_PARSER_VERSI} where id = ${batchId}`;

    await executors(tx).audit.insertAudit({
      entityType: 'pdt_upload_batch',
      entityId: String(batchId),
      actorEmployeeId: PDT_REPARSE_ACTOR,
      action: 'pdt_reparse',
      beforeJson: { parser_versi: batch.parser_versi },
      afterJson: { parser_versi: pdt.PDT_PARSER_VERSI, jumlah_berkas_terparse: terparse.length },
      createdBy: PDT_REPARSE_ACTOR,
    });
  });

  return { batchId, direparse: true, alasanDilewati: null, rawDihapusPada: null };
}

// ===========================================================================
// G2-01 lanjutan — rakit `PdtSkorInputTiktok` dari fakta tersimpan (PDT-21).
// Query MURNI-BACA (nol tulis): satu client_platform_id + satu periode (awal
// bulan). Pemanggil (route/G2-02, belum ada) yang menyambungkan hasilnya ke
// `computeSkorTiktok` (`@cdps/core` pdt/skor.ts) beserta benchmark aktif —
// bentuk JSON `pdt_benchmark.nilai` SENGAJA belum diputuskan di sini (milik
// G2-02, dicatat COMMENT ON TABLE pdt_benchmark, migrasi G1-01).
//
// Portfolio Produk SELALU `null`: `pdt_fact_sku_period.kuadran` belum punya
// penulis modul manapun (Open `G2-01-KUADRAN-SKU`, docs/backlog/PDT_BACKLOG.md
// §2) — `computeSkorTiktok` sudah mengeluarkannya dari pembobotan (Rule 12)
// tanpa kode tambahan apa pun di sini.
//
// Sumber tiap dimensi lain diverifikasi dari mesin LAMA yang SEDANG PRODUKSI
// (`report/metrik.ts`/`report/skor.ts`, docs/DECISIONS.md), bukan ditebak:
//  - LIVE Streaming: HANYA baris `is_akun_toko = true` — mesin lama memisahkan
//    `slots.live_toko` (dimensi skor) dari `slots.live_aff` (masuk dimensi
//    Affiliate, bukan LIVE). Menyamakan keduanya akan mencampur kesehatan
//    siaran toko sendiri dengan performa afiliasi yang go-live — dua sinyal
//    berbeda yang mesin lama sengaja pisah.
//  - Video/Konten: SELURUH baris (toko + afiliasi) — `videoReport` mesin lama
//    menerima `vid_toko` DAN `vid_aff` sekaligus (`toko`/`afiliasi` cuma count
//    tampilan, bukan filter skor).
//  - Kartu Produk & Shop Tab: `gmvKartu = max(0, gmvTotalToko − Σ gmv SELURUH
//    baris pdt_fact_content jenis live+video, toko MAUPUN afiliasi)` — cermin
//    persis `baseline/metrik.ts` `other = gmv − liveAff − liveToko − vidAff −
//    vidToko` (dijumlah dulu SEMUA kontribusi konten, baru dikurangkan dari
//    GMV toko, bukan hanya baris `is_akun_toko`).
//  - Affiliate: `produktif` = jumlah baris `pdt_fact_creator_period` ber-
//    `gmv > 0` — cermin persis `produktif: gmv > 0` per-kreator mesin lama.
//    `gmvKotorToko` sumber SAMA dengan `PdtSkorInputKartuTiktok.gmvTotal`.
// ===========================================================================

const MSG_PDT_PERIODE_INVALID = '[periode tidak valid]';

function validasiPeriodeAwalBulan(periodeAwalBulan: string): void {
  if (!/^\d{4}-\d{2}-01$/.test(periodeAwalBulan)) {
    throw new ValidationError(MSG_PDT_PERIODE_INVALID);
  }
}

/**
 * Rakit `PdtSkorInputTiktok` dari `pdt_fact_*` untuk SATU client_platform_id +
 * SATU periode (awal bulan, format `YYYY-MM-01`). Dimensi tanpa baris fakta
 * sama sekali ⇒ `null` (Rule 12 ditegakkan di `computeSkorTiktok` yang
 * menerima hasil ini — bukan ditebak angka netral di sini).
 */
export async function rakitInputSkorTiktok(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<pdt.PdtSkorInputTiktok> {
  validasiPeriodeAwalBulan(periodeAwalBulan);

  const [adsRow] = await sql<{
    n: number; biaya: string; gmv: string; pesanan: string; burn_spend: string; biaya_produk: string;
  }[]>`
    select count(*)::int as n,
           coalesce(sum(biaya), 0) as biaya,
           coalesce(sum(gmv), 0) as gmv,
           coalesce(sum(pesanan_sku), 0) as pesanan,
           coalesce(sum(case when sumber = 'tt_ads_product' and biaya > 0 and coalesce(gmv, 0) <= 0 then biaya else 0 end), 0) as burn_spend,
           coalesce(sum(case when sumber = 'tt_ads_product' then biaya else 0 end), 0) as biaya_produk
      from pdt_fact_ads
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and sumber in ('tt_ads_product', 'tt_ads_live')`;
  const ads: pdt.PdtSkorInputAdsTiktok | null = adsRow.n === 0 ? null : {
    biaya: Number(adsRow.biaya),
    gmv: Number(adsRow.gmv),
    pesanan: Number(adsRow.pesanan),
    burnSpend: Number(adsRow.burn_spend),
    biayaProduk: Number(adsRow.biaya_produk),
  };

  const [liveRow] = await sql<{ sesi: number; durasi_detik: string; gmv: string; sesi_nol: number }[]>`
    select count(*)::int as sesi,
           coalesce(sum(durasi_detik), 0) as durasi_detik,
           coalesce(sum(gmv), 0) as gmv,
           coalesce(sum(case when coalesce(gmv, 0) <= 0 then 1 else 0 end), 0)::int as sesi_nol
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis = 'live'
       and is_akun_toko = true`;
  const live: pdt.PdtSkorInputLiveTiktok | null = liveRow.sesi === 0 ? null : {
    gmv: Number(liveRow.gmv),
    jamTotal: Number(liveRow.durasi_detik) / 3600,
    sesi: liveRow.sesi,
    sesiNol: liveRow.sesi_nol,
  };

  const [videoRow] = await sql<{ total: number; ada_penjualan: number; gmv: string; vv: string }[]>`
    select count(*)::int as total,
           coalesce(sum(case when coalesce(gmv, 0) > 0 then 1 else 0 end), 0)::int as ada_penjualan,
           coalesce(sum(gmv), 0) as gmv,
           coalesce(sum(vv), 0) as vv
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis = 'video'`;
  const video: pdt.PdtSkorInputVideoTiktok | null = videoRow.total === 0 ? null : {
    total: videoRow.total,
    adaPenjualan: videoRow.ada_penjualan,
    gmv: Number(videoRow.gmv),
    vv: Number(videoRow.vv),
  };

  const [contentGmvRow] = await sql<{ gmv: string }[]>`
    select coalesce(sum(gmv), 0) as gmv
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis in ('live', 'video')`;
  const gmvKontenTotal = Number(contentGmvRow.gmv);

  const [shopRow] = await sql<{ n: number; gmv: string; pesanan: string; pengunjung: string }[]>`
    select count(*)::int as n,
           coalesce(sum(gmv), 0) as gmv,
           coalesce(sum(pesanan), 0) as pesanan,
           coalesce(sum(pengunjung), 0) as pengunjung
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = 'net'
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')`;
  const gmvTotalToko = Number(shopRow.gmv);
  const pengunjungTotal = Number(shopRow.pengunjung);
  const pesananTotal = Number(shopRow.pesanan);
  const kartu: pdt.PdtSkorInputKartuTiktok | null = shopRow.n === 0 ? null : {
    gmvKartu: Math.max(0, gmvTotalToko - gmvKontenTotal),
    gmvTotal: gmvTotalToko,
    cvr: pengunjungTotal === 0 ? 0 : pesananTotal / pengunjungTotal,
  };

  const [affRow] = await sql<{ total: number; produktif: number; gmv: string }[]>`
    select count(*)::int as total,
           coalesce(sum(case when coalesce(gmv, 0) > 0 then 1 else 0 end), 0)::int as produktif,
           coalesce(sum(gmv), 0) as gmv
      from pdt_fact_creator_period
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date`;
  const affiliate: pdt.PdtSkorInputAffiliateTiktok | null = affRow.total === 0 ? null : {
    produktif: affRow.produktif,
    total: affRow.total,
    gmv: Number(affRow.gmv),
    gmvKotorToko: gmvTotalToko,
  };

  // Portfolio Produk: lihat docblock berkas di atas — SELALU null sampai
  // G2-01-KUADRAN-SKU membangun penulis `pdt_fact_sku_period.kuadran`.
  const produk: pdt.PdtSkorInputProdukTiktok | null = null;

  return { ads, live, video, kartu, affiliate, produk };
}

// ===========================================================================
// G2-02 — benchmark TikTok aktif (PDT-21 Rule 23). `pdt_benchmark` berversi
// PER PLATFORM (PK majemuk `platform, versi`; keputusan pemilik lewat
// `AskUserQuestion` sesi ini — lihat migrasi `20261030010000` untuk alasan
// lengkap: TikTok/Shopee dikalibrasi ulang di waktu berbeda, satu versi
// global akan memaksa rekalibrasi Shopee membump nomor versi TikTok juga).
// Pola baca IDENTIK `report.ts` (`report_benchmark where aktif = true order
// by versi desc limit 1`) — nol validasi bentuk `nilai` di sini, sama
// seperti preseden itu: tabel `pdt_benchmark` default-deny (nol RLS policy),
// hanya bisa ditulis lewat domain yang sudah menjamin bentuknya benar.
// ===========================================================================

const MSG_PDT_BENCHMARK_KOSONG = '[benchmark PDT belum dikonfigurasi]';

export interface PdtBenchmarkAktifTiktok {
  versi: number;
  bench: pdt.PdtBenchmarkTiktok;
}

/** Baca versi `pdt_benchmark` TikTok aktif TERTINGGI. Melempar `ValidationError` bila belum ada satu pun (G2-02 belum menyeed). */
export async function bacaBenchmarkAktifTiktok(sql: Sql): Promise<PdtBenchmarkAktifTiktok> {
  const rows = await sql<{ versi: number; nilai: pdt.PdtBenchmarkTiktok }[]>`
    select versi, nilai from pdt_benchmark
     where platform = 'tiktok' and aktif = true
     order by versi desc limit 1`;
  if (rows.length === 0) throw new ValidationError(MSG_PDT_BENCHMARK_KOSONG);
  return { versi: rows[0].versi, bench: rows[0].nilai };
}

/**
 * Rakit fakta (`rakitInputSkorTiktok`) + baca benchmark aktif
 * (`bacaBenchmarkAktifTiktok`) + hitung (`computeSkorTiktok`, `@cdps/core`)
 * dalam satu pemanggilan — jalur LENGKAP pertama dari `pdt_fact_*` sampai
 * skor TikTok siap ditampilkan/dikirim. `benchmarkVersi` dikembalikan
 * terpisah supaya pemanggil (Flow B langkah 4, belum ada) bisa menyimpannya
 * ke `pdt_laporan_kiriman.benchmark_versi` saat mengirim laporan (Rule 23).
 */
export async function hitungSkorTiktok(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<{ hasil: pdt.PdtSkorHasilTiktok; benchmarkVersi: number }> {
  const [input, { versi: benchmarkVersi, bench }] = await Promise.all([
    rakitInputSkorTiktok(sql, clientPlatformId, periodeAwalBulan),
    bacaBenchmarkAktifTiktok(sql),
  ]);
  return { hasil: pdt.computeSkorTiktok(input, bench), benchmarkVersi };
}
