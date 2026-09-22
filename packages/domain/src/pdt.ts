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
import { notification, pdt, permission, pilarkatalog, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import { ACCOUNT_DIVISION, type Actor } from './account';
import * as pdtVerdict from './pdt-verdict';

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
export type PdtPreviewBerkasStatus = 'ok' | 'sebagian' | 'perlu_pilih_modul' | 'gagal' | 'ditolak_pagar';

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
  // G1-08-SEBAGIAN: kolomOpsional (bila ada) DIKELUARKAN dari daftar wajib — kehilangannya
  // menurunkan status ke 'sebagian', bukan 'gagal' (docs/DECISIONS.md, opsi (a) diketok pemilik).
  const kolomOpsional = modul.kolomOpsional ?? [];
  const kolomWajib = modul.kolomDipanen.filter((k) => !kolomOpsional.includes(k));
  const kolomWajibGagal = pdt.validasiKolomWajib(header, kolomWajib, aliasPerKolom);
  const kolomOpsionalGagal = pdt.validasiKolomOpsional(header, kolomOpsional, aliasPerKolom);
  const parseStatus = pdt.turunkanParseStatus({ decodeGagal: null, kolomWajibGagal, kolomOpsionalGagal });

  return {
    // 'sebagian' TETAP dipakai untuk ekstraksi/rekonsiliasi (kolom wajibnya lengkap) — hanya
    // 'gagal'/status pra-deteksi yang mengeluarkan berkas dari `terparse`.
    terparse:
      parseStatus.status === 'ok' || parseStatus.status === 'sebagian'
        ? { nama: input.nama, aoa: input.aoa, sheets: input.sheets, modul, barisHeader }
        : null,
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
    // Preamble DULU (aturan umum PDT), kolom data hanya sebagai cadangan
    // ber-nama untuk modul yang mendaftarkan `kolomPeriode` — lihat docblock
    // `PdtModuleDef.kolomPeriode` (`@cdps/core` `pdt/types.ts`).
    const dariPreamble = pdt.ekstrakPeriodePreambleTiktok(b.aoa, b.barisHeader);
    if (dariPreamble != null || b.modul.kolomPeriode == null) return { nama: b.nama, periode: dariPreamble };
    return { nama: b.nama, periode: pdt.ekstrakPeriodeKolomTiktok(b.aoa, b.barisHeader, b.modul.kolomPeriode) };
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
 * Dipakai bersama oleh `previewUploadBatch`/`siapkanUploadBatch`/`konfirmasiIdentitasBatch`
 * — satu-satunya lookup+gerbang izin baris `client_platforms`. `Queryable` (bukan `Sql`
 * saja) supaya `konfirmasiIdentitasBatch` bisa memanggilnya DI DALAM transaksinya sendiri
 * (baris `client_platforms` dibaca konsisten dengan baris batch yang sudah dikunci `for update`).
 */
async function loadClientPlatformUntukPdt(sql: Queryable, clientPlatformId: number): Promise<ClientPlatformRow> {
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
 *
 * `'digantikan'` (G1-12, Rule 36, `docs/DECISIONS.md` 2026-09-18) — ditulis
 * HANYA oleh `commitUploadBatch` sendiri (jalur supersede otomatis di bawah),
 * tidak pernah oleh `resolveStatusIdentitasRekonsiliasi`/`reparsePdtBatch`
 * (keduanya tidak tahu apa-apa soal batch LAIN, murni menilai berkas yang
 * sedang diproses).
 */
export type PdtCommitStatus = 'parsing' | 'identitas_belum_terikat' | 'verified' | 'ditolak' | 'digantikan';

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
  /** `pdt_upload_batch.menggantikan_batch_id` (G1-12, Rule 36) — batch `verified` LAMA yang baru saja digantikan ditandai `digantikan` (lihat docblock `commitUploadBatch`), `null` bila commit ini bukan penggantian (batch pertama untuk periode ini, atau hasilnya bukan `verified`). */
  menggantikanBatchId: number | null;
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
 * (separuh Rule 13) DILEWATI PERMANEN** — `G1-07-PERSKU-PESANAN` DITUTUP
 * `docs/DECISIONS.md` 2026-09-18 dengan jawaban NEGATIF DEFINITIF, bukan
 * kolom belum ditemukan: kolom `'Pesanan Dibuat'`/`'Pesanan Siap Dikirim'`
 * ADA di sample asli Fim Motor, tapi Σ-nya (baris parent saja) menyimpang
 * ≈12,8% dari shop-level — STRUKTURAL (satu order multi-produk dihitung
 * sekali di shop-level, sekali PER PRODUK di per-SKU), bukan sesuatu yang
 * bisa diperbaiki dengan sample lain atau filter baris tambahan. Mengaktifkan
 * perbandingan ini (seperti cabang TikTok di bawah) akan menolak KELIRU
 * setiap batch Shopee dengan order multi-produk (mayoritas toko nyata).
 * `rekonsiliasiGmvPesanan` menerima `perSkuPesanan`/`shopLevelPesanan`
 * opsional dan menilai HANYA dari GMV — dipanggil TANPA keduanya di sini,
 * sengaja, bukan sementara.
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
 * mentah (lihat `catch` di bawah) — sisa (bukan mencegah) satu-satunya jalur
 * ini, karena jalur normalnya sekarang supersede otomatis (di bawah).
 *
 * **Jalur koreksi/supersede (G1-12, Rule 36 separuh kedua, `docs/DECISIONS.md`
 * 2026-09-18) — "submit kedua membuat batch baru dengan `menggantikan_batch_id`;
 * batch lama ditandai `digantikan`, bukan dihapus."** Bila hasil commit INI
 * (`status` di atas) adalah `'verified'` DAN sudah ada batch `'verified'` LAIN
 * untuk `(client_platform_id, periode_mulai, periode_selesai)` yang SAMA (satu
 * SELECT ... FOR UPDATE di dalam transaksi, mengunci baris itu sepanjang
 * transaksi ini — cegah race dua commit verified bersamaan untuk periode yang
 * sama, pola sama `konfirmasiIdentitasBatch`), batch lama itu ditandai
 * `status='digantikan'` (SATU baris `audit_log` tersendiri untuknya,
 * `action='pdt_batch_digantikan'`) dan batch baru ini ditulis dengan
 * `menggantikan_batch_id` menunjuk batch lama. Ini BUKAN opsi terpisah yang
 * AM pilih — endpoint upload sama sekali tidak menerima "batch mana yang
 * digantikan" (Flow A tidak berubah: AM cukup unggah ulang paket yang benar
 * untuk toko+periode yang sama). Bila hasil commit BUKAN `'verified'`
 * (`parsing`/`identitas_belum_terikat`/`ditolak`), TIDAK ADA supersede yang
 * terjadi sama sekali — batch verified lama (bila ada) dibiarkan berdiri APA
 * ADANYA, karena `uq_pdt_upload_batch_verified` hanya melarang DUA baris
 * verified sekaligus, dan upload yang gagal/belum lolos gerbang tidak berhak
 * menggantikan satu yang sudah terbukti benar. Pembaca fakta (`bacaFakta*`,
 * G3-01/G3-07/G3-08) SUDAH menyaring `status='verified'` secara eksplisit di
 * query masing-masing (diverifikasi `docs/backlog/PDT_BACKLOG.md` G3-08) —
 * batch `digantikan` otomatis tidak pernah terbaca sebagai sumber tanpa
 * perubahan apa pun di sisi baca; baris fakta (`pdt_fact_*`) sendiri
 * ber-scope `(client_platform_id, periode)`, BUKAN `batch_id` (delete-then-
 * insert/`ON CONFLICT DO UPDATE`, `tulisFaktaModulTerparse`), jadi menulis
 * fakta batch baru otomatis MENIMPA fakta batch lama untuk periode yang sama
 * — pola yang SAMA persis dengan reparse (G1-11), tidak ada mekanisme baru
 * yang diperlukan di sana. `retensi_sampai`/`retensi_alasan`/`legal_hold`
 * batch lama TIDAK disentuh (Rule 45 di luar cakupan Rule 36 — tidak ada
 * dasar PRD untuk mengubah retensi batch yang digantikan).
 */
interface PdtStatusRekonsiliasiHasil {
  status: PdtCommitStatus;
  alasanDitolak: string | null;
  reconcileDeltaPct: number | null;
  identitas: PdtPreviewIdentitas;
  identitasSumber: Record<string, unknown> | null;
}

/**
 * Identitas (Rule 2-4) + rekonsiliasi (Rule 13-16/PDT-16, "D-16") — diekstrak
 * dari `commitUploadBatch` (keputusan pemilik G1-11-REPARSE-RECOMPUTE-STATUS,
 * `docs/DECISIONS.md`: "reparse WAJIB ulang rekonsiliasi (D-16) + validasi
 * identity, status batch di-recompute dari hasil parse baru") supaya
 * `reparsePdtBatch` (Flow D) di bawah bisa memakai PERSIS logika yang sama
 * TANPA duplikasi — pola sama `tulisFaktaModulTerparse` (sesi 29, baris fakta).
 * Murni fungsi keputusan (nol tulis DB, nol pembacaan periode — periode
 * BUKAN bagian dari keputusan status/identitas/rekonsiliasi ini, lihat
 * `periode` terpisah di `commitUploadBatch`/docblock seksi G1-11).
 */
function resolveStatusIdentitasRekonsiliasi(
  platform: pdt.PdtPlatform,
  terparse: readonly BerkasTerparse[],
  hasilBerkas: readonly PdtPreviewBerkasHasil[],
  shopId: string | null,
  akunKontenToko: readonly string[] | null,
): PdtStatusRekonsiliasiHasil {
  const { verdict: identitas, sumber: identitasSumber } = resolveIdentitasDanSumber(platform, terparse, shopId, akunKontenToko);

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
            // G1-08-SEBAGIAN: 'sebagian' punya kolom wajib lengkap (hanya kolom opsional/laporan
            // yang hilang) — sama layaknya 'ok' untuk keperluan rekonsiliasi Rule 13-16.
            .map((b) => ({ kode: b.modulKode as string, parseStatusOk: b.status === 'ok' || b.status === 'sebagian' }));
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
            // G1-08-SEBAGIAN: 'sebagian' punya kolom wajib lengkap (hanya kolom opsional/laporan
            // yang hilang) — sama layaknya 'ok' untuk keperluan rekonsiliasi Rule 13-16.
            .map((b) => ({ kode: b.modulKode as string, parseStatusOk: b.status === 'ok' || b.status === 'sebagian' }));
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

  return { status, alasanDitolak, reconcileDeltaPct, identitas, identitasSumber };
}

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

  const periode = resolvePeriodePreview(platform, terparse);

  if (periode == null) {
    throw new ValidationError('[tidak ada satu pun berkas dalam paket yang berhasil diproses — periksa kembali paket ZIP sebelum mengunggah ulang]');
  }
  if (periode.status === 'tolak') {
    throw new ValidationError(periode.pesan);
  }

  const { status, alasanDitolak, reconcileDeltaPct, identitas, identitasSumber } =
    resolveStatusIdentitasRekonsiliasi(platform, terparse, hasilBerkas, row.shop_id, row.akun_konten_toko);

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
  // M9-OA-4 (`docs/DECISIONS.md` 2026-09-17) — `tt_affiliate_video` → `pdt_fact_content`
  // (lihat docblock `ekstrakBarisTtAffiliateVideo`, `@cdps/core` `pdt/fakta.ts`).
  const berkasTtAffiliateVideo = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_affiliate_video');
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
  // 2026-09-16 — `tt_ads_product`/`tt_ads_live` → `pdt_fact_ads` (lihat docblock
  // `ekstrakBarisTtAdsProduct`/`ekstrakBarisTtAdsLive`, `@cdps/core` `pdt/fakta.ts`,
  // untuk kenapa dibangun KONSERVATIF tanpa sample asli — keputusan pemilik via
  // `AskUserQuestion`, docs/DECISIONS.md).
  const berkasTtAdsProduct = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_ads_product');
  const berkasTtAdsLive = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_ads_live');
  // G2-01-KUADRAN-SKU langkah 1 — `tt_product_analytics` → `pdt_fact_sku_period` (lihat
  // docblock `ekstrakBarisTtProductAnalytics`, `@cdps/core` `pdt/fakta.ts`) — sisi TikTok
  // untuk tabel yang sebelumnya hanya diisi Shopee (`shopee_ams_produk`, modul KEDELAPAN).
  const berkasTtProductAnalytics = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'tt_product_analytics');
  // G2-01-SHOPEE-KESEHATAN-WRITER — `shopee_kesehatan` → `pdt_fact_kesehatan_penalti`
  // (lihat docblock `ekstrakBarisKesehatanShopee`, `@cdps/core` `pdt/fakta.ts`) — modul
  // ini terdaftar+terdeteksi sejak awal, tapi belum pernah punya penulis fakta sama sekali.
  const berkasShopeeKesehatan = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_kesehatan');
  // G3-02a — `shopee_chat` → `pdt_fact_layanan_chat` (lihat docblock
  // `ekstrakBarisLayananChatShopee`, `@cdps/core` `pdt/fakta.ts`) — modul ini
  // terdaftar+terdeteksi sejak G1-09 sub-2b-ii, tapi belum pernah punya
  // penulis fakta sama sekali sampai tiket ini.
  const berkasShopeeChat = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_chat');
  // G4-03 aksi 4 — `shopee_diskon`/`shopee_flash_sale` → `pdt_fact_promo` (lihat
  // docblock `ekstrakBarisPromoDiskonShopee`/`ekstrakBarisPromoFlashSaleShopee`,
  // `@cdps/core` `pdt/fakta.ts`). Dua modul terakhir yang terdaftar+terdeteksi sejak
  // G1-02 tapi nol penulis fakta — pola sama `shopee_kesehatan` (G2-01) dan
  // `shopee_chat` (G3-02a) sebelumnya.
  const berkasShopeeDiskon = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_diskon');
  const berkasShopeeFlashSale = identitas.status === 'tolak' ? [] : terparse.filter((b) => b.modul.kode === 'shopee_flash_sale');

  const retensiHari = status === 'ditolak' ? 30 : 120; // Rule 45 — default/ditolak; diperpanjang belakangan (G1-10/2b-ii), tidak pernah diperpendek
  const retensiSampai = tz.addDaysToDate(tz.dateString(now), retensiHari);
  const retensiAlasan = status === 'ditolak' ? 'ditolak' : 'default';

  let batchId: number;
  let menggantikanBatchId: number | null = null;
  try {
    batchId = await withTransaction(sql, async (tx) => {
      // G1-12 (Rule 36 separuh kedua, docs/DECISIONS.md 2026-09-18) — supersede
      // otomatis: HANYA saat commit INI menghasilkan 'verified' (jalur satu-satunya
      // yang bisa membentur uq_pdt_upload_batch_verified). `for update` mengunci
      // baris batch lama sepanjang transaksi ini — pola sama `konfirmasiIdentitasBatch`
      // — mencegah dua commit 'verified' bersamaan untuk periode yang sama saling
      // lolos gerbang ini lalu berdua membentur unique index.
      if (status === 'verified') {
        const existing = await tx<{ id: number }[]>`
          select id from pdt_upload_batch
           where client_platform_id = ${clientPlatformId}
             and periode_mulai = ${periode.mulai}::date and periode_selesai = ${periode.selesai}::date
             and status = 'verified'
           for update`;
        if (existing[0]) menggantikanBatchId = existing[0].id;
      }

      // Baris lama ditandai 'digantikan' SEBELUM baris baru disisipkan sebagai 'verified' — bukan
      // sebaliknya. `uq_pdt_upload_batch_verified` diperiksa PER PERNYATAAN (bukan deferred), jadi
      // menyisipkan baris 'verified' baru SELAGI baris lama masih 'verified' membentur index itu
      // sendiri walau baris lama akan segera diturunkan sesudahnya — urutan ini menghindarinya sama
      // sekali alih-alih bergantung pada backstop `catch` di bawah.
      if (menggantikanBatchId != null) {
        await tx`update pdt_upload_batch set status = 'digantikan' where id = ${menggantikanBatchId}`;
      }

      const rows = await tx<{ id: number }[]>`
        insert into pdt_upload_batch
          (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status,
           alasan_ditolak, reconcile_delta_pct, parser_versi, identitas_sumber, retensi_sampai,
           retensi_alasan, menggantikan_batch_id, dibuat_oleh)
        values
          (${row.client_id}, ${clientPlatformId}, ${platform}, ${periode.mulai}::date, ${periode.selesai}::date,
           ${status}, ${alasanDitolak}, ${reconcileDeltaPct}, ${pdt.PDT_PARSER_VERSI}, ${tx.json(identitasSumber as never)},
           ${retensiSampai}::date, ${retensiAlasan}, ${menggantikanBatchId}, ${actor.employeeId})
        returning id`;
      const id = rows[0].id;

      if (menggantikanBatchId != null) {
        await executors(tx).audit.insertAudit({
          entityType: 'pdt_upload_batch',
          entityId: String(menggantikanBatchId),
          actorEmployeeId: actor.employeeId,
          action: 'pdt_batch_digantikan',
          beforeJson: { status: 'verified' },
          afterJson: { status: 'digantikan', menggantikan_batch_id: id },
          createdBy: actor.employeeId,
        });
      }

      for (const b of hasilBerkas) {
        // ditolakPagar/gagalEkstrak — nol bytes sungguhan dibaca (sha256/bytes null di sumbernya),
        // TIDAK dipersist sebagai pdt_file (sha256/bytes NOT NULL di skema, dan genuinely tidak
        // diketahui) — tetap terlihat di respons commit ini untuk request yang sama, didiagnosis
        // dari pesan sha256=null/bytes=null di sana; docs/DECISIONS.md 2026-09-14.
        if (b.sha256 == null || b.bytes == null) continue;
        // G1-08-SEBAGIAN (docs/DECISIONS.md, opsi (a) diketok pemilik): 'sebagian' sekarang
        // punya pemicu (kolom opsional hilang, kolom wajib lengkap) — dipetakan apa adanya,
        // bukan diturunkan paksa ke 'gagal' seperti sebelumnya.
        const parseStatusDb = b.status === 'ok' || b.status === 'sebagian' ? b.status : 'gagal';
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
        berkasTtAffiliateVideo, shopIdTersimpan: row.shop_id,
        berkasShopStatsTiktok, berkasShopStatsShopee, berkasParentSkuUntukMaster, berkasTtOrders, berkasTtTransactionCreator,
        berkasShopeeAmsAfiliasi, berkasShopeeAmsProduk, berkasTtAdsProduct, berkasTtAdsLive, berkasTtProductAnalytics,
        berkasShopeeKesehatan, berkasShopeeChat, berkasShopeeDiskon, berkasShopeeFlashSale,
      });

      // G4-03 Tahap 1 (Flow C langkah 1) — mesin verdict Shopee, HANYA saat batch
      // ini benar-benar verified. Di dalam transaksi yang sama: gagal ⇒ ikut rollback
      // bersama penulisan batch, bukan status setengah-jadi.
      if (platform === 'shopee' && status === 'verified') {
        await pdtVerdict.evaluasiVerdictShopee(tx, id, clientPlatformId, periodeAwalBulan);
      }

      await executors(tx).audit.insertAudit({
        entityType: 'pdt_upload_batch',
        entityId: String(id),
        actorEmployeeId: actor.employeeId,
        action: 'pdt_batch_committed',
        beforeJson: null,
        afterJson: {
          status, platform, periode_mulai: periode.mulai, periode_selesai: periode.selesai,
          jumlah_berkas: hasilBerkas.length, identitas_status: identitas.status, reconcile_delta_pct: reconcileDeltaPct,
          menggantikan_batch_id: menggantikanBatchId,
        },
        createdBy: actor.employeeId,
      });

      return id;
    });
  } catch (e) {
    // uq_pdt_upload_batch_verified (Rule 36) — SISA jalur ini sekarang murni backstop race:
    // jalur NORMAL (G1-12, di atas) sudah menyupersede batch verified lama SEBELUM insert,
    // di bawah `for update` yang sama, jadi konflik ini seharusnya nyaris tidak pernah
    // tersentuh lagi — hanya bisa terjadi bila DUA commit 'verified' untuk periode yang SAMA
    // benar-benar bersamaan dan salah satu commit terjadi TEPAT di antara SELECT ... FOR UPDATE
    // pemenang dan baris lama itu benar-benar ditandai 'digantikan'. BI, bukan 500 mentah.
    if (isUniqueViolation(e)) {
      throw new ValidationError(
        `[batch verified untuk toko dan periode ${periode.mulai} s.d. ${periode.selesai} ini sudah ada — coba unggah ulang]`,
      );
    }
    if (isNumericOutOfRange(e)) throw new ValidationError(PESAN_ANGKA_DI_LUAR_JANGKAUAN);
    throw e;
  }

  return {
    batchId,
    clientPlatformId,
    platform,
    status,
    alasanDitolak,
    reconcileDeltaPct,
    menggantikanBatchId,
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

/**
 * True untuk Postgres numeric-value-out-of-range (SQLSTATE 22003) — satu sel
 * yang tidak muat di kolom fakta membatalkan SELURUH transaksi commit/reparse.
 *
 * Insiden 2026-09-21 (`docs/DECISIONS.md`): `pdt_fact_ads.roas numeric(8,3)`
 * tumpah pada baris iklan berbiaya nyaris nol, dan AM hanya melihat "internal
 * server error" — nol petunjuk berkas/kolom mana. Kolomnya sudah dilebarkan
 * (migrasi `20261127010000`) dan `@cdps/core` `roasTersimpan` memagari ROAS di
 * sisi kode, jadi jalur ini kini backstop: kalau kolom fakta LAIN kelak tumpah,
 * yang muncul pesan BI yang bisa dilaporkan, bukan 500 buta.
 */
function isNumericOutOfRange(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '22003';
}

/** Pesan BI bersama `commitUploadBatch`/`reparsePdtBatch` untuk SQLSTATE 22003 (lihat `isNumericOutOfRange`). */
const PESAN_ANGKA_DI_LUAR_JANGKAUAN =
  '[ada angka di paket ini yang di luar jangkauan kolom fakta, batch tidak disimpan — laporkan nama toko dan periodenya ke tim teknis]';

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
  berkasTtAffiliateVideo: readonly BerkasTerparse[];
  /** Gerbang "satu berkas = satu toko" untuk `tt_affiliate_video` (keputusan pemilik (b), `docs/DECISIONS.md` 2026-09-17) — `null` bila toko belum terikat, yang berarti gerbangnya tidak menyaring apa pun (pola sama `usulkan_ikat`). */
  shopIdTersimpan: string | null;
  berkasShopeeLive: readonly BerkasTerparse[];
  berkasTtLive: readonly BerkasTerparse[];
  berkasShopStatsTiktok: readonly BerkasTerparse[];
  berkasShopStatsShopee: readonly BerkasTerparse[];
  berkasParentSkuUntukMaster: readonly BerkasTerparse[];
  berkasTtOrders: readonly BerkasTerparse[];
  berkasTtTransactionCreator: readonly BerkasTerparse[];
  berkasShopeeAmsAfiliasi: readonly BerkasTerparse[];
  berkasShopeeAmsProduk: readonly BerkasTerparse[];
  berkasTtAdsProduct: readonly BerkasTerparse[];
  berkasTtAdsLive: readonly BerkasTerparse[];
  berkasTtProductAnalytics: readonly BerkasTerparse[];
  berkasShopeeKesehatan: readonly BerkasTerparse[];
  berkasShopeeChat: readonly BerkasTerparse[];
  berkasShopeeDiskon: readonly BerkasTerparse[];
  berkasShopeeFlashSale: readonly BerkasTerparse[];
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
    berkasTtAffiliateVideo, shopIdTersimpan,
    berkasShopStatsTiktok, berkasShopStatsShopee, berkasParentSkuUntukMaster, berkasTtOrders, berkasTtTransactionCreator,
    berkasShopeeAmsAfiliasi, berkasShopeeAmsProduk, berkasTtAdsProduct, berkasTtAdsLive, berkasTtProductAnalytics,
    berkasShopeeKesehatan, berkasShopeeChat, berkasShopeeDiskon, berkasShopeeFlashSale,
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
             parser_versi, biaya, tayangan, klik, pesanan_sku, gmv, roas, tipe_kampanye_sumber)
          values
            (${clientPlatformId}, 'shopee_ads_live', ${baris.kampanyeId}, null, null, ${periodeAwalBulan}::date, ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.biaya}, ${baris.tayangan}, null, ${baris.pesananSku}, ${baris.gmv}, ${baris.roas},
             ${baris.tipeKampanyeSumber})`;
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
             parser_versi, biaya, tayangan, klik, pesanan_sku, gmv, roas, tipe_kampanye_sumber)
          values
            (${clientPlatformId}, 'shopee_ads_cpc', ${baris.kampanyeId}, ${baris.platformProductId}, null, null, ${periodeAwalBulan}::date, ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.biaya}, ${baris.tayangan}, ${baris.klik}, ${baris.pesananSku}, ${baris.gmv}, ${baris.roas},
             ${baris.tipeKampanyeSumber})`;
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
             parser_versi, biaya, tayangan, klik, pesanan_sku, gmv, roas, tipe_kampanye_sumber)
          values
            (${clientPlatformId}, 'shopee_ads_search', ${baris.kampanyeId}, null, null, ${periodeAwalBulan}::date, ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.biaya}, ${baris.tayangan}, ${baris.klik}, ${baris.pesananSku}, ${baris.gmv}, ${baris.roas},
             ${baris.tipeKampanyeSumber})`;
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

  // M9-OA-4 (`docs/DECISIONS.md` 2026-09-17) — `tt_affiliate_video` → `pdt_fact_content`
  // (lihat docblock `ekstrakBarisTtAffiliateVideo`, `@cdps/core` `pdt/fakta.ts`): sumber
  // `Attributed GMV` KOL, dicocokkan ke `creator_bookings` lewat `Video ID` di langkah
  // berikutnya. Pola `ON CONFLICT ... DO UPDATE` sama seperti `tt_video` di atas —
  // `platform_content_id` (`Video ID`) selalu ada untuk baris yang ditulis, dan baris
  // ganda per video sudah dikerucutkan jadi satu di ekstraktor (TIDAK dijumlah, lihat
  // docblock-nya). `creator_platform_id` SELALU NULL dan `is_akun_toko` SELALU false —
  // ekspor sisi partner tidak membawa ID kreator sama sekali. `jenis` = 'video'.
  //
  // Gerbang toko (keputusan pemilik (b)): ekspor diambil PER TOKO, jadi `Shop ID` di
  // berkas wajib sama dengan `client_platforms.shop_id`. Baris yang tokonya lain
  // DILEWATI, bukan menggagalkan batch — satu berkas salah-tempel tidak boleh menulis
  // GMV toko lain ke toko ini. Bila `shop_id` klien belum terikat (NULL), gerbangnya
  // tidak menyaring apa pun (pola sama `usulkan_ikat` Rule 2).
  if (berkasTtAffiliateVideo.length > 0) {
    for (const b of berkasTtAffiliateVideo) {
      for (const baris of pdt.ekstrakBarisTtAffiliateVideo(b.aoa, b.barisHeader)) {
        if (shopIdTersimpan != null && baris.shopId != null && baris.shopId !== shopIdTersimpan) continue;
        await tx`
          insert into pdt_fact_content
            (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis,
             creator_platform_id, creator_handle, is_akun_toko, waktu_posting, sku_id,
             vv, likes, komentar, dibagikan, pengikut_baru, produk_dilihat, klik_produk, gmv, durasi_detik)
          values
            (${clientPlatformId}, ${baris.platformContentId}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI}, 'video',
             null, ${baris.creatorHandle}, false, null, null,
             ${baris.vv}, ${baris.likes}, null, null, null, null, null, ${baris.gmv}, ${baris.durasiDetik})
          on conflict (client_platform_id, platform_content_id, periode) do update set
            batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
            creator_handle = excluded.creator_handle, vv = excluded.vv, likes = excluded.likes,
            gmv = excluded.gmv, durasi_detik = excluded.durasi_detik`;
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
  // basis). `produk_terjual`/`pembeli_baru` dipetakan sama seperti TikTok. `pesanan_dibatalkan`
  // (G2-01-SHOPEE-CANCEL-REPEAT-RATE, separuh — cancelRate saja, migrasi `20261105010000`)
  // ditulis untuk KETIGA basis (fungsi generik, sama pola kolom lain) — konsumen sesungguhnya
  // (`rakitInputSkorShopee`) hanya membaca basis 'dibuat'. `repeat rate` TETAP tidak ada
  // kolomnya (ditunda sengaja, lihat docblock migrasi yang sama).
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
               gmv, pesanan, pengunjung, produk_diklik, cr, pembeli, pembeli_baru, refund, pesanan_dibatalkan)
            values
              (${clientPlatformId}, ${baris.tanggal}::date, ${basis}, ${id}, ${pdt.PDT_PARSER_VERSI},
               ${baris.gmv}, ${baris.pesanan}, ${baris.pengunjung}, ${baris.produkDiklik},
               ${baris.cr}, ${baris.pembeli}, ${baris.pembeliBaru}, ${baris.refund}, ${baris.pesananDibatalkan})
            on conflict (client_platform_id, tanggal, basis) do update set
              batch_id = excluded.batch_id, parser_versi = excluded.parser_versi,
              gmv = excluded.gmv, pesanan = excluded.pesanan,
              pengunjung = excluded.pengunjung, produk_diklik = excluded.produk_diklik, cr = excluded.cr,
              pembeli = excluded.pembeli, pembeli_baru = excluded.pembeli_baru, refund = excluded.refund,
              pesanan_dibatalkan = excluded.pesanan_dibatalkan`;
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

  // B33-PARENT-SKU (`docs/DECISIONS.md` 2026-09-20) — `shopee_parent_sku` →
  // `pdt_fact_sku_period` (lihat docblock `ekstrakBarisFaktaSkuShopeeParentSku`,
  // `@cdps/core` `pdt/fakta.ts`). Berkas yang SAMA yang sudah lama memberi makan
  // `pdt_sku_master` di atas ternyata juga membawa performa per produk — nama,
  // GMV, unit terjual, pesanan, dilihat, klik — dan selama ini semuanya dibuang
  // begitu identitasnya selesai dibaca.
  //
  // SATU baris berkas ⇒ DUA baris fakta: berkasnya berkolom ganda (`Pesanan
  // Dibuat` dan `Pesanan Siap Dikirim`), jadi kedua basis ditulis apa adanya
  // alih-alih memilih salah satu di sini. Yang MEMBACA yang memilih — dan itu
  // `getBaselinePrefill`, yang mengambil `siap_dikirim` supaya B-3.3 memakai
  // basis yang SAMA dengan B-1 (`basisShopDaily` Shopee juga `siap_dikirim`),
  // sehingga Σ Top SKU menggulung ke angka GMV bulanan yang sama persis —
  // kesetaraan yang sudah dibuktikan G1-07-SHOPEE-DOBEL-HITUNG ke sample asli
  // (Σ baris parent Siap Dikirim = Rp1.515.002.476 = shop-level PERSIS).
  //
  // `impresi`/`klik`/`pengunjung` ditulis pada KEDUA basis: ketiganya trafik per produk yang
  // memang tidak berbasis pesanan, jadi ia sama untuk kedua pandangan. Basis
  // adalah pandangan ALTERNATIF atas periode yang sama, tidak pernah dijumlah
  // silang — jadi ini bukan dobel hitung.
  //
  // Replace-on-recommit (DELETE scope lalu INSERT), pola SAMA `shopee_ams_produk`
  // di bawah dan alasan yang sama: produk yang berhenti muncul di ekspor baru
  // harus ikut hilang, bukan tertinggal sebagai baris hantu. Nol tabrakan dengan
  // `shopee_ams_produk` — ia menulis basis `dibayar`, dua basis di sini tidak
  // pernah disentuhnya.
  if (berkasParentSkuUntukMaster.length > 0) {
    await tx`
      delete from pdt_fact_sku_period
       where client_platform_id = ${clientPlatformId} and sku_id is null
         and basis in ('dibuat', 'siap_dikirim')
         and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasParentSkuUntukMaster) {
      for (const baris of pdt.ekstrakBarisFaktaSkuShopeeParentSku(b.aoa, b.barisHeader)) {
        for (const [basis, gmv, produkTerjual, pesanan] of [
          ['dibuat', baris.gmvDibuat, baris.produkTerjualDibuat, baris.pesananDibuat],
          ['siap_dikirim', baris.gmvSiapDikirim, baris.produkTerjualSiapDikirim, baris.pesananSiapDikirim],
        ] as const) {
          await tx`
            insert into pdt_fact_sku_period
              (sku_id, client_platform_id, platform_product_id, nama_produk, periode, basis,
               batch_id, parser_versi, gmv, produk_terjual, pesanan, impresi, klik, pengunjung)
            values
              (null, ${clientPlatformId}, ${baris.platformProductId}, ${baris.namaProduk},
               ${periodeAwalBulan}::date, ${basis}, ${id}, ${pdt.PDT_PARSER_VERSI},
               ${gmv}, ${produkTerjual}, ${pesanan}, ${baris.dilihat}, ${baris.klik}, ${baris.pengunjung})`;
        }
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

  // PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR (`docs/backlog/PX_M3_BACKLOG.md`) — `tt_orders` →
  // `pdt_fact_sku_period` (lihat docblock `ekstrakBarisFaktaSkuTtOrders`, `@cdps/core`
  // `pdt/fakta.ts`). `sku_id` SELALU NULL, `basis = 'dibayar'` LITERAL — pola SAMA
  // `shopee_ams_produk` di atas (delete-then-insert per scope, bukan `ON CONFLICT` per
  // baris: SKU yang berhenti muncul di export baru harus ikut hilang). Nol tabrakan
  // dengan blok `shopee_ams_produk`: `client_platform_id` sudah per-platform, jadi satu
  // baris `pdt_fact_sku_period` untuk toko TikTok tertentu hanya pernah berasal dari SATU
  // penulis (`tt_orders` di sini) untuk (sku_id null, basis 'dibayar').
  if (berkasTtOrders.length > 0) {
    await tx`
      delete from pdt_fact_sku_period
       where client_platform_id = ${clientPlatformId} and sku_id is null and basis = 'dibayar'
         and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasTtOrders) {
      for (const baris of pdt.ekstrakBarisFaktaSkuTtOrders(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_sku_period
            (sku_id, client_platform_id, platform_product_id, periode, basis, batch_id,
             parser_versi, gmv, gmv_dari_kreator, pesanan_sku, produk_terjual)
          values
            (null, ${clientPlatformId}, ${baris.platformProductId}, ${periodeAwalBulan}::date, 'dibayar', ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.gmv}, ${baris.gmvDariKreator}, ${baris.pesananSku},
             ${baris.produkTerjual})`;
      }
    }
  }

  // B1-BATAL-TIKTOK (`docs/DECISIONS.md` 2026-09-20, ketokan pemilik) — `tt_orders` →
  // `pdt_fact_shop_daily`, PENULIS KEDUA ke tabel yang sama. Sampai sekarang setiap
  // baris `pdt_fact_shop_daily` lahir dari SATU berkas; di sini satu berkas menambal
  // dua kolom pada baris yang sudah ditulis berkas LAIN (`tt_shop_analytics`), dan
  // itulah keputusan arsitektur yang ditunda sehari dan diketok pemilik hari ini.
  //
  // Tiga hal yang membuatnya tetap aman:
  //
  //  1. `UPDATE`, BUKAN `INSERT ... ON CONFLICT`. Hari yang tidak punya baris `'net'`
  //     dari batch ini dibiarkan apa adanya. Meng-`insert` baris baru berarti mengarang
  //     `gmv = 0, pesanan = 0` (dua kolom NOT NULL) untuk hari yang `tt_shop_analytics`
  //     sendiri tidak laporkan — kebohongan yang jauh lebih mahal daripada satu sel
  //     `% batal` yang kosong.
  //  2. `batch_id` mengunci sasarannya ke baris yang BARU SAJA ditulis blok
  //     `tt_shop_analytics` di transaksi yang sama, jadi pembilang dan barisnya selalu
  //     satu periode — bukan menyentuh baris tetangga dari batch bulan lain.
  //  3. Ia menulis `pesanan_penyebut_batal`, TIDAK PERNAH `pesanan`. Kolom `pesanan`
  //     milik `tt_shop_analytics` dan dibaca B-1 (`jumlahPesanan`) serta rekonsiliasi
  //     Rule 13-14; menimpanya akan melahirkan sumber kebenaran kedua untuk kolom yang
  //     sama. Kenapa penyebutnya perlu kolom sendiri — dan bukan `pesanan` — ada di
  //     docblock `ekstrakBarisBatalHarianTtOrders` (`@cdps/core` `pdt/fakta.ts`):
  //     143 vs 169 vs 119 di berkas asli yang sama.
  //
  // URUTAN PENTING: blok ini WAJIB berada sesudah blok `berkasShopStatsTiktok` di atas,
  // yang melahirkan baris basis `'net'` yang di-`UPDATE` di sini. Dipindah ke atasnya,
  // ia akan meng-`UPDATE` nol baris tanpa error apa pun — gagal diam-diam, kelas bug
  // yang sama dengan `Order Status === 'completed'` yang baru saja dibereskan.
  if (berkasTtOrders.length > 0) {
    for (const b of berkasTtOrders) {
      for (const baris of pdt.ekstrakBarisBatalHarianTtOrders(b.aoa, b.barisHeader)) {
        await tx`
          update pdt_fact_shop_daily
             set pesanan_dibatalkan = ${baris.pesananDibatalkan},
                 pesanan_penyebut_batal = ${baris.pesanan}
           where client_platform_id = ${clientPlatformId}
             and tanggal = ${baris.tanggal}::date
             and basis = 'net'
             and batch_id = ${id}`;
      }
    }
  }

  // G2-01-KUADRAN-SKU langkah 1 — `tt_product_analytics` → `pdt_fact_sku_period` (lihat
  // docblock `ekstrakBarisTtProductAnalytics`, `@cdps/core` `pdt/fakta.ts`). `sku_id` SELALU
  // NULL (level produk-induk, sama keputusan pemilik `G1-09-2BII-ADS-CPC-SKU` dipakai
  // `shopee_ams_produk` di atas) — replace-on-recommit, sama alasan persis. `basis = 'net'`
  // LITERAL — TERVERIFIKASI (bukan ditebak): `G1-07-TIKTOK-REKONSILIASI` (`docs/DECISIONS.md`)
  // membuktikan Σ GMV/Pesanan SKU per-SKU berkas ini SAMA PERSIS dengan `tt_shop_analytics`
  // shop-level, dan `tt_shop_analytics` → `pdt_fact_shop_daily` sudah memakai `basis = 'net'`
  // (lihat docblock `ekstrakBarisShopDailyTiktok`) — kesetaraan angka yang sudah dibuktikan
  // sample asli, bukan basis baru yang diasumsikan.
  if (berkasTtProductAnalytics.length > 0) {
    await tx`
      delete from pdt_fact_sku_period
       where client_platform_id = ${clientPlatformId} and sku_id is null and basis = 'net'
         and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasTtProductAnalytics) {
      for (const baris of pdt.ekstrakBarisTtProductAnalytics(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_sku_period
            (sku_id, client_platform_id, platform_product_id, nama_produk, periode, basis, batch_id,
             parser_versi, gmv, gmv_dari_kreator, gmv_video_penjual, gmv_live_penjual,
             pesanan_sku, produk_terjual, impresi, klik, ctr, ctor)
          values
            (null, ${clientPlatformId}, ${baris.platformProductId}, ${baris.namaProduk}, ${periodeAwalBulan}::date, 'net', ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.gmv}, ${baris.gmvDariKreator}, ${baris.gmvVideoPenjual},
             ${baris.gmvLivePenjual}, ${baris.pesananSku}, ${baris.produkTerjual}, ${baris.impresi}, ${baris.klik},
             ${baris.ctr}, ${baris.ctor})`;
      }
    }
  }

  // G2-01-SHOPEE-KESEHATAN-WRITER — `shopee_kesehatan` → `pdt_fact_kesehatan_penalti`
  // (lihat docblock `ekstrakBarisKesehatanShopee`, `@cdps/core` `pdt/fakta.ts`). Nol
  // identitas natural per-baris di sumber (sama alasan `pdt_fact_ads`) — replace-on-
  // recommit: DELETE scope (client_platform_id+periode) lalu INSERT ulang seluruh
  // baris dari batch yang sedang di-commit.
  if (berkasShopeeKesehatan.length > 0) {
    await tx`
      delete from pdt_fact_kesehatan_penalti
       where client_platform_id = ${clientPlatformId} and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasShopeeKesehatan) {
      for (const baris of pdt.ekstrakBarisKesehatanShopee(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_kesehatan_penalti
            (client_platform_id, periode, batch_id, parser_versi, poin, deskripsi, durasi)
          values
            (${clientPlatformId}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI},
             ${baris.poin}, ${baris.deskripsi}, ${baris.durasi})`;
      }
    }
  }

  // G3-02a — `shopee_chat` → `pdt_fact_layanan_chat` (lihat docblock
  // `ekstrakBarisLayananChatShopee`, `@cdps/core` `pdt/fakta.ts`). Nol
  // identitas natural per-baris di sumber (satu baris ringkasan per
  // unggahan) — replace-on-recommit, pola sama `pdt_fact_kesehatan_penalti`.
  if (berkasShopeeChat.length > 0) {
    await tx`
      delete from pdt_fact_layanan_chat
       where client_platform_id = ${clientPlatformId} and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasShopeeChat) {
      for (const baris of pdt.ekstrakBarisLayananChatShopee(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_layanan_chat
            (client_platform_id, periode, batch_id, parser_versi, pengunjung, chat_masuk,
             chat_dibalas, waktu_respon_detik, csat_persen, total_pesanan, penjualan,
             tingkat_konversi_chat_dibalas)
          values
            (${clientPlatformId}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI},
             ${baris.pengunjung}, ${baris.chatMasuk}, ${baris.chatDibalas}, ${baris.waktuResponDetik},
             ${baris.csatPersen}, ${baris.totalPesanan}, ${baris.penjualan}, ${baris.tingkatKonversiChatDibalas})`;
      }
    }
  }

  // G4-03 aksi 4 — `shopee_diskon`/`shopee_flash_sale` → `pdt_fact_promo`.
  // Replace-on-recommit per (toko, jenis, periode), pola sama blok-blok di atas.
  //
  // Baris ditulis APA ADANYA, termasuk `Tipe Promosi='Semua'`. Pembacanya yang
  // WAJIB memilih: `'Semua'` adalah total periode yang sudah di-dedup Shopee,
  // baris lain adalah komponen yang boleh saling tumpang tindih (satu pesanan
  // bisa membawa beberapa tipe promosi). Menjumlahkan seluruh baris = bug kelas
  // `G1-07-SHOPEE-DOBEL-HITUNG`; lihat docblock ekstraktornya untuk angka nyata
  // yang membuktikannya (Σ komponen 25% di atas baris 'Semua' pada satu klien).
  if (berkasShopeeDiskon.length > 0) {
    await tx`
      delete from pdt_fact_promo
       where client_platform_id = ${clientPlatformId} and jenis = 'diskon' and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasShopeeDiskon) {
      for (const baris of pdt.ekstrakBarisPromoDiskonShopee(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_promo
            (client_platform_id, periode, batch_id, parser_versi, jenis, tipe_promosi,
             penjualan_dibuat, penjualan_siap_dikirim, pesanan_dibuat, pesanan_siap_dikirim)
          values
            (${clientPlatformId}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI}, 'diskon', ${baris.tipePromosi},
             ${baris.penjualanDibuat}, ${baris.penjualanSiapDikirim}, ${baris.pesananDibuat}, ${baris.pesananSiapDikirim})`;
      }
    }
  }

  if (berkasShopeeFlashSale.length > 0) {
    await tx`
      delete from pdt_fact_promo
       where client_platform_id = ${clientPlatformId} and jenis = 'flash_sale' and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasShopeeFlashSale) {
      for (const baris of pdt.ekstrakBarisPromoFlashSaleShopee(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_promo
            (client_platform_id, periode, batch_id, parser_versi, jenis, tipe_promosi,
             penjualan_dibuat, penjualan_siap_dikirim, pesanan_dibuat, pesanan_siap_dikirim,
             produk_dilihat, produk_diklik)
          values
            (${clientPlatformId}, ${periodeAwalBulan}::date, ${id}, ${pdt.PDT_PARSER_VERSI}, 'flash_sale', null,
             ${baris.penjualanDibuat}, ${baris.penjualanSiapDikirim}, ${baris.pesananDibuat}, ${baris.pesananSiapDikirim},
             ${baris.produkDilihat}, ${baris.produkDiklik})`;
      }
    }
  }

  // 2026-09-16 — `tt_ads_product` → `pdt_fact_ads` (lihat docblock
  // `ekstrakBarisTtAdsProduct`, `@cdps/core` `pdt/fakta.ts`, untuk kenapa `roas`
  // DITURUNKAN dan `sku_id`/`content_id` SELALU null). Replace-on-recommit,
  // sama alasan `shopee_ads_live` di atas (`sku_id`/`content_id` NULL ⇒ `ON CONFLICT`
  // tidak aman dipakai lewat `uq_pdt_fact_ads`). `tayangan`/`klik` diisi 2026-09-16
  // (`G1-09-2BII-TTADS-SAMPLE` DITUTUP — sample asli mengonfirmasi `Impresi iklan
  // produk`/`Jumlah klik iklan produk` sebagai kolom nyata).
  if (berkasTtAdsProduct.length > 0) {
    await tx`
      delete from pdt_fact_ads
       where client_platform_id = ${clientPlatformId} and sumber = 'tt_ads_product' and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasTtAdsProduct) {
      for (const baris of pdt.ekstrakBarisTtAdsProduct(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_ads
            (client_platform_id, sumber, kampanye_id, sku_id, content_id, periode, batch_id,
             parser_versi, biaya, tayangan, klik, pesanan_sku, gmv, roas, tipe_kampanye_sumber)
          values
            (${clientPlatformId}, 'tt_ads_product', ${baris.kampanyeId}, null, null, ${periodeAwalBulan}::date, ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.biaya}, ${baris.tayangan}, ${baris.klik}, ${baris.pesananSku}, ${baris.gmv}, ${baris.roas},
             ${baris.tipeKampanyeSumber})`;
      }
    }
  }

  // 2026-09-16 — `tt_ads_live` → `pdt_fact_ads` (lihat docblock `ekstrakBarisTtAdsLive`,
  // `@cdps/core` `pdt/fakta.ts` — sama alasan `tt_ads_product` di atas untuk `roas`
  // diturunkan/`sku_id`/`content_id` null/replace-on-recommit). `tayangan` diisi
  // 2026-09-16 (`G1-09-2BII-TTADS-SAMPLE` DITUTUP, dari `Tayangan LIVE`) — `klik`
  // TETAP null, modul ini tidak punya kolom klik (sama pola `shopee_ads_live`).
  // G3-06: `tipe_kampanye_sumber` SELALU null untuk modul ini — berkas "livestream data
  // for live campaigns" nol kolom konfigurasi kampanye, jadi tidak ada yang bisa dipanen.
  // `strategi.petakanTipeKampanye` mengembalikan 'live_ads' dari `sumber` saja untuk
  // `tt_ads_live`; kolomnya sengaja dibiarkan NULL supaya tidak ada nilai yang TAMPAK
  // dipanen dari berkas padahal berasal dari identitas modul. Satu rumah untuk asumsi itu.
  if (berkasTtAdsLive.length > 0) {
    await tx`
      delete from pdt_fact_ads
       where client_platform_id = ${clientPlatformId} and sumber = 'tt_ads_live' and periode = ${periodeAwalBulan}::date`;
    for (const b of berkasTtAdsLive) {
      for (const baris of pdt.ekstrakBarisTtAdsLive(b.aoa, b.barisHeader)) {
        await tx`
          insert into pdt_fact_ads
            (client_platform_id, sumber, kampanye_id, sku_id, content_id, periode, batch_id,
             parser_versi, biaya, tayangan, klik, pesanan_sku, gmv, roas, tipe_kampanye_sumber)
          values
            (${clientPlatformId}, 'tt_ads_live', ${baris.kampanyeId}, null, null, ${periodeAwalBulan}::date, ${id},
             ${pdt.PDT_PARSER_VERSI}, ${baris.biaya}, ${baris.tayangan}, null, ${baris.pesananSku}, ${baris.gmv}, ${baris.roas},
             null)`;
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

/** Hasil `konfirmasiIdentitasBatch` — `rawPath`/`rawDihapusPada` dibawa balik supaya pemanggil (route) tahu apakah reparse langsung mungkin (domain tidak pernah menyentuh Storage sendiri). */
export interface PdtKonfirmasiIdentitasHasil {
  batchId: number;
  clientPlatformId: number;
  platform: pdt.PdtPlatform;
  /** `shop_id` (Shopee) atau satu nilai `akun_konten_toko` (TikTok) yang baru terikat. */
  nilaiDiikat: string;
  rawPath: string | null;
  rawDihapusPada: string | null;
}

/**
 * konfirmasiIdentitasBatch — Rule 2 (Shopee)/Rule 4 (TikTok): AM mengonfirmasi
 * SEKALI usulan identitas yang sistem baca dari berkas
 * (`pdt_upload_batch.identitas_sumber`, ditulis `commitUploadBatch`/`reparsePdtBatch`
 * untuk verdict `usulkan_ikat`) — nilainya terikat PERMANEN ke
 * `client_platforms.shop_id` (Shopee) atau di-APPEND ke `akun_konten_toko` (TikTok,
 * array — toko yang sama boleh punya lebih dari satu akun konten yang sah).
 * `G1-09-KONFIRMASI-IDENTITAS` (`docs/backlog/PDT_BACKLOG.md`) — terbuka sejak
 * sub-langkah 2a, ditutup sesi ini.
 *
 * TIDAK PERNAH menimpa nilai yang sudah terikat (guard eksplisit — cermin
 * `validasiIdentitasShopee`/`validasiIdentitasTiktok`, `@cdps/core`: keduanya HANYA
 * mengembalikan `usulkan_ikat` saat kolom tujuan kosong, jadi guard ini seharusnya
 * tidak pernah tersentuh di jalur normal; tetap ditulis untuk race dua klik/dua batch
 * bersamaan — `for update` mengunci baris batch sepanjang transaksi).
 *
 * Domain TIDAK memicu reparse batch ini sendiri (arah dependensi tetap: domain tidak
 * pernah menyentuh Storage/ZIP, pola sama `commitUploadBatch`) — pemanggil (route)
 * yang menjalankan ulang pipeline reparse (G1-11) SEGERA setelah ini sukses, supaya
 * batch pindah dari `identitas_belum_terikat` tanpa menunggu tick harian.
 */
export async function konfirmasiIdentitasBatch(sql: Sql, actor: Actor, batchId: number): Promise<PdtKonfirmasiIdentitasHasil> {
  return withTransaction(sql, async (tx) => {
    const rows = await tx<{
      id: number;
      client_platform_id: number;
      platform: string;
      status: PdtCommitStatus;
      identitas_sumber: Record<string, unknown> | null;
      raw_path: string | null;
      raw_dihapus_pada: string | null;
    }[]>`
      select id, client_platform_id, platform, status, identitas_sumber, raw_path, raw_dihapus_pada
        from pdt_upload_batch
       where id = ${batchId}
       for update`;
    const batch = rows[0];
    if (!batch) throw new NotFoundError('[batch PDT tidak ditemukan]');

    const cpRow = await loadClientPlatformUntukPdt(tx, batch.client_platform_id);
    if (!canUploadBatch(actor, cpRow.assigned_am_id)) throw new ForbiddenError();

    if (batch.status !== 'identitas_belum_terikat') {
      throw new ValidationError('[batch ini tidak sedang menunggu konfirmasi identitas]');
    }
    if (!batch.identitas_sumber) {
      throw new ValidationError('[batch ini tidak membawa usulan identitas untuk dikonfirmasi]');
    }

    const platform = batch.platform as pdt.PdtPlatform;
    let nilai: string;
    let beforeJson: Record<string, unknown>;
    let afterJson: Record<string, unknown>;
    if (platform === 'shopee') {
      if (cpRow.shop_id != null) {
        throw new ValidationError('[shop_id toko ini sudah terikat sebelumnya — konfirmasi ini tidak berlaku lagi]');
      }
      nilai = String(batch.identitas_sumber.shop_id);
      await tx`update client_platforms set shop_id = ${nilai} where id = ${cpRow.id}`;
      beforeJson = { shop_id: null };
      afterJson = { shop_id: nilai };
    } else {
      const existing = cpRow.akun_konten_toko ?? [];
      nilai = String(batch.identitas_sumber.id_kreator);
      if (existing.includes(nilai)) {
        throw new ValidationError('[akun konten ini sudah terikat sebelumnya — konfirmasi ini tidak berlaku lagi]');
      }
      const setelah = [...existing, nilai];
      await tx`update client_platforms set akun_konten_toko = ${tx.json(setelah as never)} where id = ${cpRow.id}`;
      beforeJson = { akun_konten_toko: existing };
      afterJson = { akun_konten_toko: setelah };
    }

    await executors(tx).audit.insertAudit({
      entityType: 'client_platforms',
      entityId: String(cpRow.id),
      actorEmployeeId: actor.employeeId,
      action: 'pdt_identitas_dikonfirmasi',
      beforeJson,
      afterJson,
      createdBy: actor.employeeId,
    });

    return {
      batchId,
      clientPlatformId: Number(batch.client_platform_id),
      platform,
      nilaiDiikat: nilai,
      rawPath: batch.raw_path,
      rawDihapusPada: batch.raw_dihapus_pada,
    };
  });
}

/** Status paket TAMPILAN (G1-09 bullet 4) — turunan dari tiga kolom DB, bukan kolom baru. */
export type PdtPaketStatus = 'tersedia' | 'kedaluwarsa' | 'legal_hold';

/** Satu baris riwayat batch — dipakai halaman upload untuk daftar "batch toko ini", termasuk yang `ditolak` (Rule 10: diagnosis tanpa upload ulang). */
export interface PdtBatchRingkas {
  id: number;
  clientPlatformId: number;
  platform: pdt.PdtPlatform;
  status: PdtCommitStatus;
  alasanDitolak: string | null;
  reconcileDeltaPct: number | null;
  periodeMulai: string;
  periodeSelesai: string;
  dibuatPada: string;
  dibuatOleh: string;
  paketStatus: PdtPaketStatus;
  /** `null` hanya bila `paketStatus==='kedaluwarsa'` (paket sudah dipurge, Rule 45) — selain itu selalu tanggal, termasuk `legal_hold`. */
  retensiSampai: string | null;
  /** `pdt_upload_batch.menggantikan_batch_id` (G1-12, Rule 36) — batch LAMA yang baris ini gantikan, `null` bila baris ini bukan hasil supersede. */
  menggantikanBatchId: number | null;
}

/**
 * listRiwayatBatchPdt — G1-09 bullet 4 ("UI batch wajib menampilkan status
 * paket: tersedia/kedaluwarsa/legal hold"), sub-langkah 3. Seluruh baris
 * `pdt_upload_batch` satu toko klien, terbaru dulu — TERMASUK batch
 * `ditolak`/`digantikan` (Rule 10 error path: batch gagal tetap tersimpan
 * beserta alasannya, "agar bisa didiagnosis tanpa upload ulang" — daftar ini
 * adalah permukaan diagnosis itu, sebelum ini hanya bisa dibaca lewat SQL
 * langsung). `paketStatus` diturunkan dari tiga kolom yang SUDAH ada
 * (`legal_hold`/`raw_dihapus_pada`/`retensi_sampai`, migrasi G1-01) — bukan
 * kolom/state machine baru (pagar #5 PDT_BACKLOG.md §0, PDT tetap nol
 * lifecycle). Gerbang izin sama dengan unggah (`canUploadBatch`) — siapa yang
 * boleh mengunggah data toko itu juga siapa yang boleh melihat riwayatnya,
 * pola sama `riwayatKirimanPdt`/`canKirimLaporan`.
 */
export async function listRiwayatBatchPdt(sql: Sql, actor: Actor, clientPlatformId: number): Promise<PdtBatchRingkas[]> {
  const row = await loadClientPlatformUntukPdt(sql, clientPlatformId);
  if (!canUploadBatch(actor, row.assigned_am_id)) throw new ForbiddenError();

  const rows = await sql<{
    // `bigint` (int8, OID 20) — driver mengembalikan STRING (pencegahan
    // presisi, sama pola px/produkexchange `Number(r.gmv_30d)`), BUKAN JS
    // number apa adanya. Nol konversi di sini pernah menghasilkan wire
    // `client_platform_id: "626"` (string) alih-alih `626` (number) — ditemukan
    // lewat tes route (JSON round-trip mengungkap yang test domain langsung
    // tidak, karena `toEqual` di sana membandingkan objek TS, bukan JSON).
    id: string;
    client_platform_id: string;
    platform: string;
    status: PdtCommitStatus;
    alasan_ditolak: string | null;
    reconcile_delta_pct: string | null;
    periode_mulai: string;
    periode_selesai: string;
    dibuat_pada: string;
    dibuat_oleh: string;
    legal_hold: boolean;
    raw_dihapus_pada: string | null;
    retensi_sampai: string | null;
    menggantikan_batch_id: string | null;
  }[]>`
    select id, client_platform_id, platform, status, alasan_ditolak, reconcile_delta_pct,
           to_char(periode_mulai, 'YYYY-MM-DD') as periode_mulai,
           to_char(periode_selesai, 'YYYY-MM-DD') as periode_selesai,
           dibuat_pada::text as dibuat_pada, dibuat_oleh, legal_hold, raw_dihapus_pada,
           to_char(retensi_sampai, 'YYYY-MM-DD') as retensi_sampai, menggantikan_batch_id
      from pdt_upload_batch
     where client_platform_id = ${clientPlatformId}
     order by id desc`;

  return rows.map((r) => ({
    id: Number(r.id),
    clientPlatformId: Number(r.client_platform_id),
    platform: r.platform as pdt.PdtPlatform,
    status: r.status,
    alasanDitolak: r.alasan_ditolak,
    reconcileDeltaPct: r.reconcile_delta_pct == null ? null : Number(r.reconcile_delta_pct),
    periodeMulai: r.periode_mulai,
    periodeSelesai: r.periode_selesai,
    dibuatPada: r.dibuat_pada,
    dibuatOleh: r.dibuat_oleh,
    paketStatus: r.legal_hold ? 'legal_hold' : r.raw_dihapus_pada != null ? 'kedaluwarsa' : 'tersedia',
    retensiSampai: r.raw_dihapus_pada != null ? null : r.retensi_sampai,
    menggantikanBatchId: r.menggantikan_batch_id == null ? null : Number(r.menggantikan_batch_id),
  }));
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
// **G1-11-REPARSE-RECOMPUTE-STATUS DITUTUP (keputusan pemilik, `docs/DECISIONS.md`
// 2026-09-16): "reparse WAJIB ulang rekonsiliasi (D-16/PDT-16) + validasi
// identity. Status batch di-recompute dari hasil parse baru; snapshot laporan
// terkirim tidak berubah (Flow D)."** Ini MELEBARKAN cakupan sesi 28/29 (yang
// sengaja dipersempit ke bacaan literal Flow D langkah 2 — "memparse ulang",
// "menaikkan parser_versi", "mencatat audit_logs" saja — karena PRD sendiri
// diam soal status/identitas/rekonsiliasi) — pemilik sekarang menjawab
// pertanyaan yang sengaja dibiarkan terbuka sesi itu: YA, reparse harus
// menjalankan ULANG `resolveStatusIdentitasRekonsiliasi` (fungsi yang SAMA
// dipakai `commitUploadBatch`, diekstrak justru supaya ini bisa dipakai
// ulang tanpa duplikasi) atas hasil parse BARU, dan menulis ulang
// `status`/`alasan_ditolak`/`reconcile_delta_pct`/`identitas_sumber` batch
// bila hasilnya berbeda dari sebelumnya (mis. bug parser yang diperbaiki
// mengubah hasil rekonsiliasi Rule 13-16 — batch yang tadinya `ditolak`
// karena selisih GMV, dengan parser baru sebenarnya `verified`).
//
// **`retensi_sampai`/`retensi_alasan` TETAP TIDAK disentuh** — keputusan
// pemilik hanya menyebut "status batch", bukan retensi; Rule 45 (baseline
// 120/30 hari) berjalan HANYA saat batch dibuat (`commitUploadBatch`), dan
// perpanjangan (G1-10-RETENSI-RECOMPUTE/G1-10-ORPHAN-PASS) sudah dipicu jalur
// lain (kirim laporan/katalog PX) — menebak aturan retensi tambahan di sini
// berarti mengarang scope yang tidak diminta.
//
// **`uq_pdt_upload_batch_verified` (Rule 36)** — kasus yang membuat sesi 28
// awalnya ragu: bila reparse membuat batch INI jadi `verified` padahal SUDAH
// ADA batch verified LAIN untuk `(client_platform_id, periode_mulai,
// periode_selesai)` yang sama (mis. batch pengganti yang diunggah manual
// SETELAH batch lama gagal rekonsiliasi), UPDATE-nya akan membentur unique
// index itu. Ditangkap sama seperti `commitUploadBatch` (`isUniqueViolation`)
// dan diterjemahkan jadi `ValidationError` BI — AM diberi tahu ada konflik
// verified ganda untuk didiagnosis manual, bukan 500 mentah atau silently
// overwrite salah satu batch.
//
// **Snapshot laporan terkirim TIDAK berubah** (Flow D langkah 3, PRD §4) —
// invarian ini SUDAH terjamin struktural tanpa kode tambahan: `kirimLaporanPdt`
// menulis `pdt_laporan_kiriman` sebagai salinan BEKU sekali saat kirim
// (`trg_pdt_laporan_kiriman_frozen`), reparse tidak pernah menyentuh tabel
// itu — hanya laporan yang BELUM dikirim (dibaca `bacaLaporanPdt` langsung
// dari `pdt_fact_*`/`pdt_upload_batch` TERKINI) yang otomatis ikut status
// baru.
//
// `reparsePdtBatch` di bawah menulis ulang baris fakta (lewat
// `tulisFaktaModulTerparse`, SAMA fungsi yang dipakai `commitUploadBatch`)
// untuk (client_platform_id, periode) batch yang SUDAH ADA, memakai `id`
// batch itu APA ADANYA — TIDAK PERNAH membuat baris `pdt_upload_batch` baru
// (Rule 5, periode batch tidak di-re-derive dari berkas yang diparse ulang),
// dan TIDAK menulis ulang `pdt_file` (metadata deteksi batch ASLI tetap
// sebagai riwayat apa adanya, override AM dibaca ulang dari sana — lihat di
// bawah).
//
// **Identitas `tolak` pada reparse** mengosongkan seluruh array berkas
// sebelum ditulis ke `tulisFaktaModulTerparse` — pola SAMA `commitUploadBatch`
// (Rule 2-4: batch yang identitasnya tidak valid tidak boleh menyumbang baris
// fakta BARU). **Baris fakta LAMA batch ini (ditulis sebelum reparse, saat
// identitas masih valid) TIDAK ikut terhapus** — tiap blok
// `tulisFaktaModulTerparse` membungkus delete-then-insert-nya dengan
// `if (berkasXxx.length > 0)` (dicek langsung ke kode, bukan diasumsikan):
// array kosong ⇒ delete-nya TIDAK PERNAH dijalankan sama sekali. Ini
// batasan yang SUDAH ada, bukan yang reparse ciptakan — `commitUploadBatch`
// sendiri punya batasan yang SAMA untuk batch baru yang lahir `tolak` (delete
// itu berkunci `client_platform_id`+`sumber`+`periode`, BUKAN `batch_id`,
// justru supaya upload baru yang gagal identitas tidak menghapus fakta batch
// LAIN yang sedang menopang periode yang sama). Konsekuensinya: bila reparse
// menemukan identitas yang TERNYATA salah, batch ditandai `ditolak` (Rule
// 2-4, laporan berhenti memakai batch ini lewat status), tapi baris fakta
// lama tetap ada di `pdt_fact_*` sampai batch PENGGANTI (baru, identitas
// benar) commit ke periode yang sama dan menimpanya lewat replace-on-recommit
// — sengaja TIDAK diperluas menjadi delete ber-`batch_id` di sini karena itu
// mengubah kontrak `tulisFaktaModulTerparse` yang dipakai BERSAMA
// `commitUploadBatch`, di luar cakupan keputusan pemilik ("status batch
// di-recompute").
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
  /** Status batch SETELAH reparse (recompute identitas+rekonsiliasi) — `null` bila `direparse=false`. */
  status: PdtCommitStatus | null;
  /** `true` bila status hasil recompute BERBEDA dari status sebelum reparse (mis. `ditolak` → `verified`). */
  statusBerubah: boolean;
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
 * yang SUDAH ADA (Rule 5 — periode TIDAK di-re-derive dari isi berkas yang
 * diparse ulang) — `tulisFaktaModulTerparse` yang SAMA dipakai
 * `commitUploadBatch` menulis ulang baris fakta (dikosongkan bila identitas
 * hasil recompute `tolak`, lihat docblock seksi G1-11 di atas), lalu
 * `resolveStatusIdentitasRekonsiliasi` (SAMA dipakai `commitUploadBatch`)
 * menjalankan ULANG Rule 2-4 (identitas) + Rule 13-16/PDT-16 (rekonsiliasi)
 * atas hasil parse baru — keputusan pemilik G1-11-REPARSE-RECOMPUTE-STATUS.
 * `pdt_upload_batch.status`/`alasan_ditolak`/`reconcile_delta_pct`/
 * `identitas_sumber`/`parser_versi` ditulis ulang ke hasil TERBARU, dan SATU
 * `audit_log` (`action = 'pdt_reparse'`) mencatat status+parser_versi
 * lama→baru. `uq_pdt_upload_batch_verified` (Rule 36) yang terbentur oleh
 * UPDATE ini (batch verified LAIN sudah berdiri untuk periode yang sama)
 * diterjemahkan jadi `ValidationError` BI, bukan 500 mentah — pola sama
 * `commitUploadBatch`.
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
    status: PdtCommitStatus;
    raw_dihapus_pada: Date | string | null;
    periode_mulai: string;
    periode_selesai: string;
    periode_awal_bulan: string;
    parser_versi: number;
  }[]>`
    select id, client_platform_id, platform, status, raw_dihapus_pada, parser_versi,
           to_char(periode_mulai, 'YYYY-MM-DD') as periode_mulai,
           to_char(periode_selesai, 'YYYY-MM-DD') as periode_selesai,
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
      status: null,
      statusBerubah: false,
    };
  }

  const clientPlatformId = batch.client_platform_id;
  const platform = batch.platform as pdt.PdtPlatform;
  const cpRow = await loadClientPlatformUntukPdt(sql, clientPlatformId);

  const overrideRows = await sql<{ nama_entri: string; modul_kode: string | null }[]>`
    select nama_entri, modul_kode from pdt_file
     where batch_id = ${batchId} and deteksi_oleh = 'override_am' and modul_kode is not null`;
  const overrideByNama = new Map(overrideRows.map((r) => [r.nama_entri, r.modul_kode as string]));

  const terparse: BerkasTerparse[] = [];
  const hasilBerkas: PdtPreviewBerkasHasil[] = [];
  for (const b of berkasInput) {
    const overrideKode = overrideByNama.get(b.nama);
    const berlakuOverride = overrideKode != null && b.aoa != null;
    // `aoa` DIKOREKSI ke sheet `namaSheet` modul override, sama alasan `commitUploadBatch`
    // (G1-09-SHEET-BUKAN-PERTAMA) — reparse membaca ULANG dari ZIP mentah, jadi
    // `b.sheets` yang dibawa `parsePdtZipEntries` TERKINI selalu tersedia untuk ini.
    const efektif: PdtPreviewBerkasInput = berlakuOverride
      ? { ...b, aoa: aoaUntukModulEfektif(b, overrideKode), modulTerdeteksi: overrideKode, ambiguous: false, matches: [overrideKode] }
      : b;
    const { hasil, terparse: t } = bangunSatuPreviewBerkas(efektif);
    hasilBerkas.push(hasil);
    if (t) terparse.push(t);
  }

  const { status, alasanDitolak, reconcileDeltaPct, identitas, identitasSumber } =
    resolveStatusIdentitasRekonsiliasi(platform, terparse, hasilBerkas, cpRow.shop_id, cpRow.akun_konten_toko);

  // Identitas `tolak` ⇒ nol berkas menyumbang baris fakta BARU (Rule 2-4, pola
  // sama `commitUploadBatch`) — baris fakta LAMA batch ini (ditulis sebelum
  // reparse) TIDAK ikut terhapus, lihat docblock seksi G1-11 di atas untuk
  // kenapa (delete `tulisFaktaModulTerparse` dijaga `if (arr.length > 0)`,
  // jadi array kosong = delete-nya tidak pernah berjalan).
  const terparseUntukFakta = identitas.status === 'tolak' ? [] : terparse;

  let hasilUpdate: { statusBerubah: boolean };
  try {
    hasilUpdate = await withTransaction(sql, async (tx) => {
      await tulisFaktaModulTerparse(tx, {
        id: batchId,
        clientPlatformId,
        periodeAwalBulan: batch.periode_awal_bulan,
        akunKontenToko: cpRow.akun_konten_toko,
        now,
        berkasAdsLive: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_ads_live'),
        berkasAdsCpc: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_ads_cpc'),
        berkasAdsSearch: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_ads_search'),
        berkasTtVideo: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_video'),
        berkasTtAffiliateVideo: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_affiliate_video'),
        shopIdTersimpan: cpRow.shop_id,
        berkasShopeeLive: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_live'),
        berkasTtLive: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_live'),
        berkasShopStatsTiktok: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_shop_analytics'),
        berkasShopStatsShopee: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_shop_stats'),
        berkasParentSkuUntukMaster: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_parent_sku'),
        berkasTtOrders: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_orders'),
        berkasTtTransactionCreator: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_transaction_creator'),
        berkasShopeeAmsAfiliasi: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_ams_afiliasi'),
        berkasShopeeAmsProduk: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_ams_produk'),
        berkasTtAdsProduct: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_ads_product'),
        berkasTtAdsLive: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_ads_live'),
        berkasTtProductAnalytics: terparseUntukFakta.filter((b) => b.modul.kode === 'tt_product_analytics'),
        berkasShopeeKesehatan: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_kesehatan'),
        berkasShopeeChat: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_chat'),
        berkasShopeeDiskon: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_diskon'),
        berkasShopeeFlashSale: terparseUntukFakta.filter((b) => b.modul.kode === 'shopee_flash_sale'),
      });

      await tx`
        update pdt_upload_batch
           set parser_versi = ${pdt.PDT_PARSER_VERSI}, status = ${status}, alasan_ditolak = ${alasanDitolak},
               reconcile_delta_pct = ${reconcileDeltaPct}, identitas_sumber = ${tx.json(identitasSumber as never)}
         where id = ${batchId}`;

      // G4-03 Tahap 1 (Flow D — reparse) — pola sama commitUploadBatch: baris fakta
      // bisa berubah setelah parser diperbaiki, jadi verdict dihitung ULANG setiap
      // reparse yang berakhir verified, bukan hanya saat status baru berubah.
      if (platform === 'shopee' && status === 'verified') {
        await pdtVerdict.evaluasiVerdictShopee(tx, batchId, clientPlatformId, batch.periode_awal_bulan);
      }

      const statusBerubah = status !== batch.status;
      await executors(tx).audit.insertAudit({
        entityType: 'pdt_upload_batch',
        entityId: String(batchId),
        actorEmployeeId: PDT_REPARSE_ACTOR,
        action: 'pdt_reparse',
        beforeJson: { parser_versi: batch.parser_versi, status: batch.status },
        afterJson: {
          parser_versi: pdt.PDT_PARSER_VERSI, jumlah_berkas_terparse: terparseUntukFakta.length,
          status, identitas_status: identitas.status, reconcile_delta_pct: reconcileDeltaPct,
        },
        createdBy: PDT_REPARSE_ACTOR,
      });

      return { statusBerubah };
    });
  } catch (e) {
    // uq_pdt_upload_batch_verified (Rule 36) — lihat docblock seksi G1-11 di atas: reparse bisa
    // menaikkan batch ini jadi 'verified' sementara batch verified LAIN sudah berdiri untuk
    // periode yang sama. BI, bukan 500 mentah — pola sama `commitUploadBatch`.
    if (isUniqueViolation(e)) {
      throw new ValidationError(
        `[reparse menghasilkan batch verified untuk toko dan periode ${batch.periode_mulai} s.d. ${batch.periode_selesai} ini, tapi batch verified lain untuk periode yang sama sudah ada — periksa batch lain sebelum reparse ulang]`,
      );
    }
    if (isNumericOutOfRange(e)) throw new ValidationError(PESAN_ANGKA_DI_LUAR_JANGKAUAN);
    throw e;
  }

  return { batchId, direparse: true, alasanDilewati: null, rawDihapusPada: null, status, statusBerubah: hasilUpdate.statusBerubah };
}

// ===========================================================================
// G2-01 lanjutan — rakit `PdtSkorInputTiktok` dari fakta tersimpan (PDT-21).
// Query MURNI-BACA (nol tulis): satu client_platform_id + satu periode (awal
// bulan). Pemanggil (route/G2-02, belum ada) yang menyambungkan hasilnya ke
// `computeSkorTiktok` (`@cdps/core` pdt/skor.ts) beserta benchmark aktif —
// bentuk JSON `pdt_benchmark.nilai` SENGAJA belum diputuskan di sini (milik
// G2-02, dicatat COMMENT ON TABLE pdt_benchmark, migrasi G1-01).
//
// Portfolio Produk (G2-01-KUADRAN-SKU langkah 2, DITUTUP) — `kuadran` sekarang
// diklasifikasi+ditulis oleh `klasifikasiUlangKuadranSkuTiktok` (dipanggil
// `hitungSkorTiktok` sebelum fungsi ini) lalu dibaca di sini via GROUP BY;
// `null` HANYA bila nol baris `kuadran IS NOT NULL` (belum pernah diunggah/
// diklasifikasi periode ini) — `computeSkorTiktok` mengeluarkannya dari
// pembobotan (Rule 12) untuk kasus itu, sama seperti dimensi lain.
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
 * KUADRAN-SHOPEE — klasifikasi ULANG kuadran seluruh baris
 * `pdt_fact_sku_period` Shopee (`sku_id is null`, `basis='siap_dikirim'`) untuk
 * SATU client_platform_id + SATU periode, lalu TULIS kolom `kuadran`. Kembaran
 * `klasifikasiUlangKuadranSkuTiktok`, dengan tiga perbedaan yang seluruhnya
 * berasal dari mesin lama, bukan dari selera:
 *
 *  1. **Basis `siap_dikirim`, bukan `net`.** Itu basis laporan klien Shopee
 *     (Rule 16) dan basis yang `bacaProdukShopee` baca — kalau kuadran ditulis
 *     ke basis `dibuat`, laporan tidak akan pernah melihatnya. Kedua basis
 *     lahir dari berkas yang sama dengan `pengunjung` yang IDENTIK (trafik
 *     produk tidak berbasis pesanan), jadi pilihan ini tidak mengubah sumbu-X;
 *     yang berubah hanya `pesanan` di penyebut CR, dan `siap_dikirim` adalah
 *     yang klien lihat.
 *  2. **Nol parameter benchmark.** Ambang kuadran Shopee adalah konstanta
 *     (`PDT_KUADRAN_SHOPEE`, `@cdps/core`) — asimetri yang SUDAH dicatat
 *     migrasi `20261031010000`: mesin skor Shopee memang tidak membaca
 *     `pdt_benchmark` sama sekali.
 *  3. **Membaca `pengunjung`, bukan `klik`/`ctor`.** Lihat komentar migrasi
 *     `20261128010000` untuk kenapa dua kolom trafik itu tidak bisa saling
 *     menggantikan.
 *
 * Idempotent, sama seperti kembarannya: hasilnya fungsi murni dari baris fakta
 * + ambang konstanta, jadi memanggilnya dua kali menulis nilai yang sama.
 */
export async function klasifikasiUlangKuadranSkuShopee(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<void> {
  const rows = await sql<{ id: number; pengunjung: number | null; pesanan: number | null }[]>`
    select id, pengunjung, pesanan from pdt_fact_sku_period
     where client_platform_id = ${clientPlatformId} and sku_id is null and basis = 'siap_dikirim'
       and periode = ${periodeAwalBulan}::date`;
  if (rows.length === 0) return;
  const hasil = pdt.klasifikasikanKuadranSkuShopee(
    rows.map((r) => ({ id: r.id, pengunjung: r.pengunjung, pesananDibuat: r.pesanan })),
  );
  for (const h of hasil) {
    await sql`update pdt_fact_sku_period set kuadran = ${h.kuadran} where id = ${h.id}`;
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

  // Portfolio Produk (G2-01-KUADRAN-SKU langkah 2) — kolom `kuadran` dibaca
  // APA ADANYA (pemanggil, `hitungSkorTiktok`, sudah menjalankan
  // `klasifikasiUlangKuadranSkuTiktok` lebih dulu di transaksi/pemanggilan
  // yang sama). `n=0` (nol baris `kuadran IS NOT NULL` — tt_product_analytics
  // belum pernah diunggah periode ini, ATAU diunggah tapi belum diklasifikasi)
  // ⇒ `null`, sama konvensi dimensi lain.
  const [produkRow] = await sql<{ n: number; gmv_bintang_hg: string; gmv_bocor: string; gmv_aktif: string }[]>`
    select
      count(*) filter (where kuadran is not null)::int as n,
      coalesce(sum(gmv) filter (where kuadran in ('bintang', 'hidden_gem')), 0) as gmv_bintang_hg,
      coalesce(sum(gmv) filter (where kuadran = 'bocor_traffic'), 0) as gmv_bocor,
      coalesce(sum(gmv) filter (where kuadran in ('bintang', 'hidden_gem', 'bocor_traffic', 'evaluasi')), 0) as gmv_aktif
      from pdt_fact_sku_period
     where client_platform_id = ${clientPlatformId} and sku_id is null and basis = 'net'
       and periode = ${periodeAwalBulan}::date`;
  const produk: pdt.PdtSkorInputProdukTiktok | null = produkRow.n === 0 ? null : {
    gmvBintangHiddenGem: Number(produkRow.gmv_bintang_hg),
    gmvBocorTraffic: Number(produkRow.gmv_bocor),
    gmvAktifTotal: Number(produkRow.gmv_aktif),
  };

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
  // G2-01-KUADRAN-SKU langkah 2 — dua kunci TAMBAHAN (migrasi `20261104010000`,
  // versi 2) yang TIDAK dipakai `computeSkorTiktok` (lihat docblock `skor.ts`
  // untuk kenapa `PdtBenchmarkTiktok` sengaja tidak memuatnya) — dibaca dari
  // baris `pdt_benchmark` YANG SAMA (satu versi aktif per platform, bukan dua
  // tabel terpisah), diekspos sebagai slice terpisah untuk konsumen berbeda
  // (`klasifikasiUlangKuadranSkuTiktok`, bukan `computeSkorTiktok`).
  kuadran: pdt.PdtBenchmarkKuadranTiktok;
}

/** Baca versi `pdt_benchmark` TikTok aktif TERTINGGI. Melempar `ValidationError` bila belum ada satu pun (G2-02 belum menyeed). */
export async function bacaBenchmarkAktifTiktok(sql: Sql): Promise<PdtBenchmarkAktifTiktok> {
  const rows = await sql<{ versi: number; nilai: pdt.PdtBenchmarkTiktok & pdt.PdtBenchmarkKuadranTiktok }[]>`
    select versi, nilai from pdt_benchmark
     where platform = 'tiktok' and aktif = true
     order by versi desc limit 1`;
  if (rows.length === 0) throw new ValidationError(MSG_PDT_BENCHMARK_KOSONG);
  const { versi, nilai } = rows[0];
  return { versi, bench: nilai, kuadran: { quad_klik: nilai.quad_klik, quad_cvr: nilai.quad_cvr } };
}

/**
 * G2-01-KUADRAN-SKU langkah 2 — klasifikasi ULANG kuadran seluruh baris
 * `pdt_fact_sku_period` (`sku_id is null`, `basis='net'` — baris TikTok
 * `tt_product_analytics`, satu-satunya sumber hari ini) untuk SATU
 * client_platform_id + SATU periode, lalu TULIS kolom `kuadran`. Idempotent
 * (aman dipanggil berulang — hasil klasifikasi murni fungsi dari baris fakta
 * + benchmark aktif SAAT INI, bukan riwayat). Dipanggil dari `hitungSkorTiktok`
 * SEBELUM `rakitInputSkorTiktok` membaca kolom ini (Rule 4 — field turunan,
 * selalu recomputable, tidak pernah ditulis tangan).
 *
 * `quad_klik`/`quad_cvr` bench diverifikasi belum ada versi aktif untuk
 * `versi=1` (migrasi `20261030010000` SENGAJA mengecualikan dua kunci ini —
 * lihat `PdtBenchmarkAktifTiktok`) — pemanggil pasti mendapat `versi>=2`
 * (migrasi `20261104010000`) begitu benchmark diseed, atau `ValidationError`
 * `MSG_PDT_BENCHMARK_KOSONG` bila `pdt_benchmark` masih kosong sama sekali
 * (sama pola `bacaBenchmarkAktifTiktok`, ditangani pemanggil bersama).
 */
export async function klasifikasiUlangKuadranSkuTiktok(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
  bench: pdt.PdtBenchmarkKuadranTiktok,
): Promise<void> {
  const rows = await sql<{ id: number; klik: number | null; ctor: string | null; pesanan_sku: number | null }[]>`
    select id, klik, ctor, pesanan_sku from pdt_fact_sku_period
     where client_platform_id = ${clientPlatformId} and sku_id is null and basis = 'net'
       and periode = ${periodeAwalBulan}::date`;
  if (rows.length === 0) return;
  const hasil = pdt.klasifikasikanKuadranSkuTiktok(
    rows.map((r) => ({ id: r.id, klik: r.klik, ctor: r.ctor == null ? null : Number(r.ctor), pesananSku: r.pesanan_sku })),
    bench,
  );
  for (const h of hasil) {
    await sql`update pdt_fact_sku_period set kuadran = ${h.kuadran} where id = ${h.id}`;
  }
}

/**
 * Rakit fakta (`rakitInputSkorTiktok`) + baca benchmark aktif
 * (`bacaBenchmarkAktifTiktok`) + hitung (`computeSkorTiktok`, `@cdps/core`)
 * dalam satu pemanggilan — jalur LENGKAP pertama dari `pdt_fact_*` sampai
 * skor TikTok siap ditampilkan/dikirim. `benchmarkVersi` dikembalikan
 * terpisah supaya pemanggil (Flow B langkah 4, belum ada) bisa menyimpannya
 * ke `pdt_laporan_kiriman.benchmark_versi` saat mengirim laporan (Rule 23).
 *
 * **G2-01-KUADRAN-SKU langkah 2** — benchmark dibaca LEBIH DULU (bukan
 * `Promise.all` dengan `rakitInputSkorTiktok` lagi seperti sebelumnya):
 * `klasifikasiUlangKuadranSkuTiktok` harus SELESAI menulis kolom `kuadran`
 * SEBELUM `rakitInputSkorTiktok` membacanya untuk dimensi Portfolio Produk —
 * dependensi berurutan, bukan lagi murni-baca paralel.
 */
export async function hitungSkorTiktok(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<{ hasil: pdt.PdtSkorHasilTiktok; benchmarkVersi: number; bench: pdt.PdtBenchmarkTiktok }> {
  const { versi: benchmarkVersi, bench, kuadran } = await bacaBenchmarkAktifTiktok(sql);
  await klasifikasiUlangKuadranSkuTiktok(sql, clientPlatformId, periodeAwalBulan, kuadran);
  const input = await rakitInputSkorTiktok(sql, clientPlatformId, periodeAwalBulan);
  return { hasil: pdt.computeSkorTiktok(input, bench), benchmarkVersi, bench };
}

// ===========================================================================
// G2-02 · admin tulis `pdt_benchmark` (Rule 25 — "mengubah ambang tidak boleh
// lagi butuh migrasi+deploy"). Preseden HURUF PER HURUF
// `productexchange.createEligibilityPolicy`/`listEligibilityPolicy`: append-
// only (nol UPDATE — `trg_pdt_benchmark_frozen` menolaknya di DB), versi baru
// = counter GLOBAL (`uq_pdt_benchmark_versi`, lintas platform — lihat migrasi
// `20261030010000`), `aktif` TIDAK PERNAH dibalik (`bacaBenchmarkAktifTiktok`
// selalu mengambil versi TERTINGGI ber-`aktif=true`, jadi versi baru yang
// lahir aktif otomatis "menang" tanpa menyentuh baris lama).
//
// TikTok SAJA didukung di sini. `platform` punya CHECK DB
// ('tiktok'/'shopee'/'meta') tapi `computeSkorShopee` TIDAK menerima
// parameter benchmark sama sekali (asimetri sengaja, docblock `skor.ts`) —
// menulis baris 'shopee'/'meta' hari ini hanya melahirkan baris yatim tanpa
// pembaca. Ditolak eksplisit sampai ada konsumen sungguhan.
// ===========================================================================

const KUNCI_BENCHMARK_TIKTOK = [
  'roi_gmvmax',
  'cpa_ratio',
  'gmv_per_jam_live',
  'sesi_live',
  'gpm_video',
  'pct_video_sales',
  'cvr_toko',
  'pct_kreator_produktif',
  'quad_klik',
  'quad_cvr',
] as const;

export interface PdtBenchmarkVersi {
  platform: string;
  versi: number;
  nilai: Record<string, { good: number; warn: number }>;
  aktif: boolean;
  catatan: string | null;
  dibuatPada: Date;
  dibuatOleh: string;
}

function rowToBenchmarkVersi(r: {
  platform: string;
  versi: number;
  nilai: Record<string, unknown>;
  aktif: boolean;
  catatan: string | null;
  dibuat_pada: Date;
  dibuat_oleh: string;
}): PdtBenchmarkVersi {
  return {
    platform: r.platform,
    versi: r.versi,
    nilai: r.nilai as Record<string, { good: number; warn: number }>,
    aktif: r.aktif,
    catatan: r.catatan,
    dibuatPada: r.dibuat_pada,
    dibuatOleh: r.dibuat_oleh,
  };
}

/** listBenchmarkVersi — seluruh versi SATU platform, terbaru dulu. Director-only. */
export async function listBenchmarkVersi(sql: Queryable, actor: Actor, platform: string): Promise<PdtBenchmarkVersi[]> {
  if (!canKelolaBenchmark(actor)) throw new ForbiddenError();
  const rows = await sql<
    { platform: string; versi: number; nilai: Record<string, unknown>; aktif: boolean; catatan: string | null; dibuat_pada: Date; dibuat_oleh: string }[]
  >`
    select platform, versi, nilai, aktif, catatan, dibuat_pada, dibuat_oleh
      from pdt_benchmark where platform = ${platform} order by versi desc`;
  return rows.map(rowToBenchmarkVersi);
}

const MSG_PDT_BENCHMARK_NILAI_INVALID =
  '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';

function validasiNilaiBenchmarkTiktok(nilai: unknown): Record<string, { good: number; warn: number }> {
  if (typeof nilai !== 'object' || nilai === null || Array.isArray(nilai)) {
    throw new ValidationError(MSG_PDT_BENCHMARK_NILAI_INVALID);
  }
  const n = nilai as Record<string, unknown>;
  const keys = Object.keys(n);
  if (keys.length !== KUNCI_BENCHMARK_TIKTOK.length || !KUNCI_BENCHMARK_TIKTOK.every((k) => keys.includes(k))) {
    throw new ValidationError(`[nilai benchmark harus memuat persis kunci: ${KUNCI_BENCHMARK_TIKTOK.join(', ')}]`);
  }
  const hasil: Record<string, { good: number; warn: number }> = {};
  for (const kunci of KUNCI_BENCHMARK_TIKTOK) {
    const band = n[kunci];
    if (typeof band !== 'object' || band === null || Array.isArray(band)) {
      throw new ValidationError(MSG_PDT_BENCHMARK_NILAI_INVALID);
    }
    const b = band as Record<string, unknown>;
    if (typeof b.good !== 'number' || !Number.isFinite(b.good) || b.good < 0) {
      throw new ValidationError(MSG_PDT_BENCHMARK_NILAI_INVALID);
    }
    if (typeof b.warn !== 'number' || !Number.isFinite(b.warn) || b.warn < 0) {
      throw new ValidationError(MSG_PDT_BENCHMARK_NILAI_INVALID);
    }
    hasil[kunci] = { good: b.good, warn: b.warn };
  }
  return hasil;
}

/** Input for a new calibration version. `catatan` wajib (form FE), sama pola `EligibilityPolicyInput`. */
export interface PdtBenchmarkVersiInput {
  platform: string;
  nilai: unknown;
  catatan: string;
  /** Lahir non-aktif (draft/rollback) bila eksplisit `false`. Default `true`. */
  aktif?: boolean;
}

/**
 * tambahVersiBenchmark — mint versi kalibrasi berikutnya. Director-only.
 * Append-only: TIDAK PERNAH menyentuh baris yang sudah ada (nol langkah
 * "matikan aktif versi lama" — `bacaBenchmarkAktifTiktok` sudah menangani ini
 * lewat `order by versi desc limit 1`, persis `createEligibilityPolicy`).
 */
export async function tambahVersiBenchmark(sql: Sql, actor: Actor, input: PdtBenchmarkVersiInput): Promise<PdtBenchmarkVersi> {
  if (!canKelolaBenchmark(actor)) throw new ForbiddenError();
  if (input.platform !== 'tiktok') {
    // Shopee SEKARANG membaca pdt_benchmark (G4-03 Tahap 1, mesin verdict roas/acos) — tapi
    // hanya lewat migrasi seed (20261114010000), bentuk `nilai`-nya beda total dari
    // `validasiNilaiBenchmarkTiktok` (dua kunci flat, bukan sebelas band good/warn). Kalibrasi
    // admin-tunable untuk Shopee (Rule 25) BELUM dibangun — tetap ValidationError di sini,
    // pesannya dikoreksi supaya tidak lagi mengklaim Shopee nol pemakai pdt_benchmark.
    throw new ValidationError(
      `[platform '${input.platform}' belum didukung kalibrasi benchmark lewat admin — hanya TikTok yang punya form kalibrasi hari ini]`,
    );
  }
  const catatan = (input.catatan ?? '').trim();
  if (catatan === '') throw new ValidationError(MSG_PDT_BENCHMARK_NILAI_INVALID);
  const nilai = validasiNilaiBenchmarkTiktok(input.nilai);
  const aktif = input.aktif ?? true;

  return withTransaction(sql, async (tx) => {
    const rows = await tx<{ versi: number }[]>`select coalesce(max(versi), 0) as versi from pdt_benchmark`;
    const versiBaru = rows[0].versi + 1;
    const inserted = await tx<
      { platform: string; versi: number; nilai: Record<string, unknown>; aktif: boolean; catatan: string | null; dibuat_pada: Date; dibuat_oleh: string }[]
    >`
      insert into pdt_benchmark (platform, versi, nilai, aktif, catatan, dibuat_oleh)
      values (${input.platform}, ${versiBaru}, ${tx.json(nilai as never)}, ${aktif}, ${catatan}, ${actor.employeeId})
      returning platform, versi, nilai, aktif, catatan, dibuat_pada, dibuat_oleh`;
    await executors(tx).audit.insertAudit({
      entityType: 'pdt_benchmark',
      entityId: String(versiBaru),
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { platform: input.platform, versi: versiBaru, nilai, aktif, catatan },
      createdBy: actor.employeeId,
    });
    return rowToBenchmarkVersi(inserted[0]);
  });
}

// ===========================================================================
// G2-01 Shopee lanjutan — rakit `PdtSkorInputShopee` dari fakta tersimpan.
// Query MURNI-BACA (nol tulis), pola sama `rakitInputSkorTiktok` di atas.
//
// **Pemetaan `sumber` `pdt_fact_ads` ↔ kategori mesin lama — DIVERIFIKASI dari
// `report/shopee/detect.ts` (kode PRODUKSI, docblock eksplisit), bukan
// ditebak** (menutup penundaan yang dicatat sengaja di PR `computeSkorShopee`
// dan `docs/DECISIONS.md`):
//  - `shopee_ads_cpc` ↔ `ads_toko` lama ("Data+Keseluruhan+Iklan+Shopee" —
//    `detect.ts` baris "keseluruhan" → `ads_toko`).
//  - `shopee_ads_search` ↔ `ads_produk` lama ("Search-Ads-Overall-Data" —
//    `detect.ts` baris "search-ads" → `ads_produk`).
//  - `shopee_ads_live` ↔ `ads_live` lama (docblock modul `shopee_ads_live`,
//    `pdt/modules.ts`, sudah menyatakan ini eksplisit).
//  - `ads_banner` lama TIDAK punya padanan modul PDT sama sekali — bukan gap
//    baru, catatan `detect.ts` sendiri sudah bilang trio `ads_toko`/
//    `ads_produk`/`ads_banner` "diparse SATU parser dan DIJUMLAH bersama
//    untuk SETIAP angka terhitung (spend, omzet, ROAS, ACOS, health flags) —
//    tertukar posisi memindahkan satu kampanye antar daftar tampil dan TIDAK
//    mengubah satu angka pun". Karena itu spend/omzet Shopee di sini adalah
//    Σ seluruh TIGA sumber PDT yang ADA (`shopee_ads_cpc`+`shopee_ads_search`+
//    `shopee_ads_live`) — persis padanan Σ empat kategori lama dikurangi satu
//    kategori (`ads_banner`) yang memang belum punya modul, bukan salah hitung.
//  - CTR (`Σklik/Σtayangan`) mesin lama HANYA dari `ads_toko`+`ads_produk`+
//    `ads_banner` — `computeHealth` menyetel `dilihat: null, klik: null`
//    eksplisit untuk baris `ads_live` sebelum menjumlahkannya (lihat
//    `report/shopee/metrik.ts` `computeHealth`), jadi `shopee_ads_live`
//    DIKECUALIKAN dari agregat CTR di sini juga (meski TETAP masuk agregat
//    spend/omzet di atas).
//
// **Live Streaming** butuh status TERUNGGAH-atau-TIDAK yang TIDAK bisa
// dibaca dari `pdt_fact_content` semata (nol baris di sana ambigu — lihat
// docblock `PdtSkorInputLiveShopee`, `@cdps/core` `pdt/skor.ts`) — dibaca dari
// `pdt_file`/`pdt_upload_batch` (modul `shopee_live` PERNAH terdeteksi untuk
// batch mana pun yang periodenya mencakup periode ini, batch TIDAK ditolak).
//
// **DUA dimensi TETAP `null`** (Open belum ditutup, TIDAK ditebak di sini):
// `dibuat.repeatRate` (`G2-01-SHOPEE-CANCEL-REPEAT-RATE`, separuh — ditunda
// sengaja, `cancelRate` sudah hidup) dan `produk` (`G2-01-KUADRAN-SKU`, methodology
// Shopee beda total dari TikTok, belum ada modul sumber data). `kesehatan`
// SEKARANG hidup (`G2-01-SHOPEE-KESEHATAN-WRITER`, DITUTUP) — lihat query
// `kesehatanDiunggahRow`/`kesehatanPoinRow` di bawah.
// ===========================================================================

/**
 * Rakit `PdtSkorInputShopee` dari `pdt_fact_*` untuk SATU client_platform_id +
 * SATU periode (awal bulan, format `YYYY-MM-01`). Dimensi tanpa baris fakta
 * sama sekali ⇒ `null` (Rule 12 ditegakkan di `computeSkorShopee`).
 */
export async function rakitInputSkorShopee(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<pdt.PdtSkorInputShopee> {
  validasiPeriodeAwalBulan(periodeAwalBulan);

  const [adsRow] = await sql<{ n: number; spend: string; omzet: string | null; klik: string | null; tayangan: string | null }[]>`
    select count(*)::int as n,
           coalesce(sum(biaya), 0) as spend,
           sum(gmv) as omzet,
           sum(case when sumber <> 'shopee_ads_live' then klik end) as klik,
           sum(case when sumber <> 'shopee_ads_live' then tayangan end) as tayangan
      from pdt_fact_ads
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and sumber in ('shopee_ads_cpc', 'shopee_ads_search', 'shopee_ads_live')`;
  const klik = adsRow.klik == null ? null : Number(adsRow.klik);
  const tayangan = adsRow.tayangan == null ? null : Number(adsRow.tayangan);
  const ads: pdt.PdtSkorInputAdsShopee | null = adsRow.n === 0 ? null : {
    spend: Number(adsRow.spend),
    omzet: adsRow.omzet == null ? null : Number(adsRow.omzet),
    ctr: klik == null || tayangan == null || tayangan <= 0 ? null : klik / tayangan,
  };

  const [dibuatRow] = await sql<{ n: number; pesanan: string; pengunjung: string; pesanan_dibatalkan: number | null; n_batal: number }[]>`
    select count(*)::int as n,
           coalesce(sum(pesanan), 0) as pesanan,
           coalesce(sum(pengunjung), 0) as pengunjung,
           sum(pesanan_dibatalkan) as pesanan_dibatalkan,
           count(*) filter (where pesanan_dibatalkan is not null)::int as n_batal
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = 'dibuat'
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')`;
  const pengunjungTotal = Number(dibuatRow.pengunjung);
  const pesananTotal = Number(dibuatRow.pesanan);
  const dibuat: pdt.PdtSkorInputPesananDibuatShopee | null = dibuatRow.n === 0 ? null : {
    cr: pengunjungTotal === 0 ? 0 : pesananTotal / pengunjungTotal,
    // G2-01-SHOPEE-CANCEL-REPEAT-RATE (separuh, langkah lanjutan) — cancelRate =
    // Σ pesanan_dibatalkan / Σ pesanan (ratio-of-sums, sama pola `cr`). `null`
    // bila NOL baris basis ini membawa kolom sumbernya (`n_batal=0` — berkas lama
    // sebelum kolom ini dipanen, BUKAN nol pembatalan sungguhan, G1-03).
    repeatRate: null, // TETAP null — ditunda sengaja, lihat migrasi 20261105010000/docs/DECISIONS.md
    cancelRate: dibuatRow.n_batal === 0 ? null : pesananTotal === 0 ? 0 : Number(dibuatRow.pesanan_dibatalkan) / pesananTotal,
  };

  // Product Performance: SELALU null sampai G2-01-KUADRAN-SKU membangun
  // penulis `pdt_fact_sku_period.kuadran` (sama gap TikTok).
  const produk: pdt.PdtSkorInputProdukShopee | null = null;

  const [liveDiunggahRow] = await sql<{ diunggah: boolean }[]>`
    select exists (
      select 1
        from pdt_file f
        join pdt_upload_batch b on b.id = f.batch_id
       where b.client_platform_id = ${clientPlatformId}
         and b.status <> 'ditolak'
         and f.modul_kode = 'shopee_live'
         and b.periode_mulai <= (${periodeAwalBulan}::date + interval '1 month' - interval '1 day')::date
         and b.periode_selesai >= ${periodeAwalBulan}::date
    ) as diunggah`;
  const [liveSesiRow] = await sql<{ sesi: number }[]>`
    select count(*)::int as sesi
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis = 'live'`;
  const live: pdt.PdtSkorInputLiveShopee | null = liveDiunggahRow.diunggah
    ? { diunggah: true, sesi: liveSesiRow.sesi }
    : null;

  // Kesehatan Toko (G2-01-SHOPEE-KESEHATAN-WRITER) — `diunggah` dibaca dari
  // `pdt_file`/`pdt_upload_batch` (pola SAMA `live` di atas): nol baris
  // `pdt_fact_kesehatan_penalti` ambigu antara "modul tidak pernah diunggah"
  // dan "diunggah, toko genuinely bersih" — dua kondisi yang `scoreKesehatanToko`
  // (mesin lama) sengaja beda skornya (5 netral vs 10 bersih).
  const [kesehatanDiunggahRow] = await sql<{ diunggah: boolean }[]>`
    select exists (
      select 1
        from pdt_file f
        join pdt_upload_batch b on b.id = f.batch_id
       where b.client_platform_id = ${clientPlatformId}
         and b.status <> 'ditolak'
         and f.modul_kode = 'shopee_kesehatan'
         and b.periode_mulai <= (${periodeAwalBulan}::date + interval '1 month' - interval '1 day')::date
         and b.periode_selesai >= ${periodeAwalBulan}::date
    ) as diunggah`;
  const [kesehatanPoinRow] = await sql<{ poin_total: string }[]>`
    select coalesce(sum(poin), 0) as poin_total
      from pdt_fact_kesehatan_penalti
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date`;
  const kesehatan: pdt.PdtSkorInputKesehatanShopee | null = kesehatanDiunggahRow.diunggah
    ? { poinTotal: Number(kesehatanPoinRow.poin_total) }
    : null;

  return { ads, dibuat, produk, live, kesehatan };
}

/**
 * Rakit fakta (`rakitInputSkorShopee`) + hitung (`computeSkorShopee`,
 * `@cdps/core`) dalam satu pemanggilan. BEDA dari `hitungSkorTiktok`: Shopee
 * tidak punya benchmark (asimetri asli mesin produksi, lihat docblock
 * `computeSkorShopee`) — nol `benchmarkVersi` dikembalikan.
 */
export async function hitungSkorShopee(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<{ hasil: pdt.PdtSkorHasilShopee }> {
  // KUADRAN-SHOPEE — kolom `kuadran` ditulis SEBELUM apa pun membacanya, pola
  // dan alasan yang sama dengan `hitungSkorTiktok` (Rule 4: field turunan,
  // selalu recomputable, tidak pernah ditulis tangan). `rakitInputSkorShopee`
  // sendiri belum membacanya — `computeSkorShopee` tidak punya dimensi
  // Portfolio Produk seperti TikTok — tapi `bacaProdukShopee` (laporan) iya,
  // dan ia dipanggil SETELAH fungsi ini.
  await klasifikasiUlangKuadranSkuShopee(sql, clientPlatformId, periodeAwalBulan);
  const input = await rakitInputSkorShopee(sql, clientPlatformId, periodeAwalBulan);
  return { hasil: pdt.computeSkorShopee(input) };
}

// ===========================================================================
// G2-01 lanjutan — payload "laporan" v1 (PDT-21 Rule 21). Query MURNI-BACA
// (nol tulis) + panggilan `hitungSkorTiktok`/`hitungSkorShopee` yang SUDAH
// ada, dirakit lewat `pdt.bangunLaporanTiktok`/`pdt.bangunLaporanShopee`
// (`@cdps/core`, keputusan scope v1 lewat `AskUserQuestion` — lihat docblock
// `laporan.ts` untuk sebelas bagian mesin lama yang SENGAJA belum dikerjakan).
//
// Basis KPI ringkas per platform DIVERIFIKASI dari PRD, bukan ditebak:
// TikTok = GMV−refund (Rule 15) dibaca dari `pdt_fact_shop_daily` basis
// `'net'` (gmv/refund disimpan MENTAH, "GMV−refund" adalah kontrak
// KONSUMEN — sama seperti dokblock TikTok G2-01 di atas); Shopee = basis
// `'siap_dikirim'` ("Basis default untuk laporan klien Shopee = Pesanan
// Siap Dikirim", Rule 16) — BEDA dari basis `'dibuat'` yang dipakai
// `rakitInputSkorShopee` untuk dimensi Conversion & Retention (dua tujuan
// berbeda, PRD memisahkan keduanya secara eksplisit).
//
// Nol pemeriksaan `canKirimLaporan`/permission di sini — sama pola
// `hitungSkorTiktok`/`hitungSkorShopee`/`rakitInputSkorTiktok` di atas:
// pemanggil (route, belum ada) yang menegakkan gerbang peran.
// ===========================================================================

async function bacaKpiShopDaily(sql: Sql, clientPlatformId: number, periodeAwalBulan: string, basis: string): Promise<pdt.PdtLaporanKpiInput | null> {
  // `produk_diklik` dihitung TERPISAH (`count(...)`) dari `sum(...)`-nya: kolom
  // ini opsional di sumbernya, dan `sum()` atas nol baris non-null tetap 0 —
  // 0 berarti "nol barang dibuka" sementara yang benar "tidak diketahui"
  // (Rule 12). Konsumennya `kpi.barangPerPengunjung` (kedalaman jelajah).
  const [row] = await sql<{ n: number; gmv: string; pesanan: string; pengunjung: string; diklik_n: number; diklik: string }[]>`
    select count(*)::int as n,
           coalesce(sum(gmv), 0) as gmv,
           coalesce(sum(pesanan), 0) as pesanan,
           coalesce(sum(pengunjung), 0) as pengunjung,
           count(produk_diklik)::int as diklik_n, coalesce(sum(produk_diklik), 0) as diklik
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = ${basis}
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')`;
  return row.n === 0 ? null : {
    gmv: Number(row.gmv), pesanan: Number(row.pesanan), pengunjung: Number(row.pengunjung),
    produkDiklik: row.diklik_n === 0 ? null : Number(row.diklik),
  };
}

async function bacaKpiTiktokNet(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanKpiInput | null> {
  const [row] = await sql<{ n: number; gmv: string; refund: string; pesanan: string; pengunjung: string; diklik_n: number; diklik: string }[]>`
    select count(*)::int as n,
           coalesce(sum(gmv), 0) as gmv,
           coalesce(sum(refund), 0) as refund,
           coalesce(sum(pesanan), 0) as pesanan,
           coalesce(sum(pengunjung), 0) as pengunjung,
           count(produk_diklik)::int as diklik_n, coalesce(sum(produk_diklik), 0) as diklik
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = 'net'
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')`;
  if (row.n === 0) return null;
  // `produk_diklik` TERPANEN di kedua platform (`tt_shop_analytics` kolom
  // 'Klik produk', `shopee_shop_stats` kolom 'Produk Diklik'), jadi kedalaman
  // jelajah muncul untuk dua-duanya. `count()` terpisah dari `sum()` supaya
  // nol baris terisi terbaca 'tidak diketahui', bukan 0 palsu (Rule 12).
  return {
    gmv: Number(row.gmv) - Number(row.refund), pesanan: Number(row.pesanan), pengunjung: Number(row.pengunjung),
    produkDiklik: row.diklik_n === 0 ? null : Number(row.diklik),
  };
}

/**
 * Bagian "harian" (tren GMV per hari) — baris `pdt_fact_shop_daily` APA
 * ADANYA, tabel yang sama yang `bacaKpiShopDaily`/`bacaKpiTiktokNet` di atas
 * langsung `sum()` jadi satu angka bulanan. Nol query ke tabel baru.
 *
 * `basis` DAN netting refund mengikuti bagian "kpi" platform yang sama
 * (Shopee `'siap_dikirim'` Rule 16 tanpa netting; TikTok `'net'` Rule 15
 * dengan `gmv − refund`), supaya Σ titik harian SELALU sama dengan
 * `kpi.gmv` — kalau keduanya berbeda basis, laporan memuat dua angka GMV
 * yang sama-sama benar tapi tidak cocok, dan pembacanya tidak punya cara
 * tahu yang mana yang dimaksud.
 *
 * Hari tanpa baris TIDAK diisi nol di sini maupun di `bangunLaporanHarian` —
 * lihat docblock bagian itu (`@cdps/core` `pdt/laporan.ts`) untuk alasannya.
 */
async function bacaHarian(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
  basis: string,
  netkanRefund: boolean,
): Promise<pdt.PdtLaporanHarianInput> {
  const rows = await sql<{ tanggal: string; gmv: string | null; refund: string | null; pesanan: number | null; pengunjung: number | null }[]>`
    select to_char(tanggal, 'YYYY-MM-DD') as tanggal, gmv, refund, pesanan, pengunjung
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = ${basis}
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')
     order by tanggal`;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    tanggal: r.tanggal,
    // `gmv` null = kolomnya memang tidak diketahui hari itu; netting hanya berlaku
    // bila gmv-nya ADA (null − refund tetap "tidak diketahui", bukan minus refund).
    gmv: r.gmv == null ? null : Number(r.gmv) - (netkanRefund ? Number(r.refund ?? 0) : 0),
    pesanan: r.pesanan == null ? null : Number(r.pesanan),
    pengunjung: r.pengunjung == null ? null : Number(r.pengunjung),
  }));
}

/**
 * Bagian "kanal" TikTok (keputusan pemilik via `AskUserQuestion`, 2026-09-16
 * — lihat docblock `pdt.PdtLaporanKanal`, `@cdps/core`, untuk penjelasan
 * lengkap). GMV total dari `pdt_fact_shop_daily` basis `'net'` (SAMA query
 * `bacaKpiTiktokNet`, tapi GROSS — penyebut persen "kanal" adalah GMV kotor,
 * bukan net-refund). `live`/`video` dari `pdt_fact_content` — `live` TANPA
 * filter `is_akun_toko` (beda dimensi skor LIVE yang sengaja memisah toko
 * vs afiliasi, "kanal" menjumlah keduanya jadi satu bucket, cermin
 * `T.liveToko + T.liveAff` mesin lama). `null` = nol baris jenis terkait
 * (tidak diketahui, BUKAN nol GMV) — `bangunKanalTiktok` yang menegakkan
 * null-aware `kartu`.
 */
async function bacaKanalTiktok(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanKanalInputTiktok | null> {
  const [shopRow] = await sql<{ n: number; gmv: string }[]>`
    select count(*)::int as n, coalesce(sum(gmv), 0) as gmv
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = 'net'
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')`;
  if (shopRow.n === 0) return null;

  const [liveRow] = await sql<{ n: number; gmv: string }[]>`
    select count(*)::int as n, coalesce(sum(gmv), 0) as gmv
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis = 'live'`;
  const [videoRow] = await sql<{ n: number; gmv: string }[]>`
    select count(*)::int as n, coalesce(sum(gmv), 0) as gmv
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis = 'video'`;

  return {
    gmvTotal: Number(shopRow.gmv),
    live: liveRow.n === 0 ? null : Number(liveRow.gmv),
    video: videoRow.n === 0 ? null : Number(videoRow.gmv),
  };
}

/**
 * Bagian "kanal" Shopee (lihat docblock `pdt.PdtLaporanKanal`/
 * `bangunKanalShopee`, `@cdps/core` — SELALU `lengkap: false`, dua dari enam
 * sumber legacy). GMV total dari `pdt_fact_shop_daily` basis `'dibuat'`
 * (cermin `computeChannels`'s Pesanan Dibuat — BEDA dari basis
 * `'siap_dikirim'` yang dipakai KPI ringkas laporan, Rule 16; pola sama
 * asimetri basis `rakitInputSkorShopee` Conversion & Retention). `shopeeAds`
 * dari `pdt_fact_ads` (sumber sama `rakitInputSkorShopee`: shopee_ads_cpc/
 * search/live), `affiliate` dari `pdt_fact_creator_period` — `null` = nol
 * baris sumber terkait (tidak diketahui, BUKAN nol).
 */
async function bacaKanalShopee(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanKanalInputShopee | null> {
  const [shopRow] = await sql<{ n: number; gmv: string }[]>`
    select count(*)::int as n, coalesce(sum(gmv), 0) as gmv
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = 'dibuat'
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')`;
  if (shopRow.n === 0) return null;

  const [adsRow] = await sql<{ n: number; gmv: string }[]>`
    select count(*)::int as n, coalesce(sum(gmv), 0) as gmv
      from pdt_fact_ads
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and sumber in ('shopee_ads_cpc', 'shopee_ads_search', 'shopee_ads_live')`;
  const [affRow] = await sql<{ n: number; gmv: string }[]>`
    select count(*)::int as n, coalesce(sum(gmv), 0) as gmv
      from pdt_fact_creator_period
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date`;

  return {
    gmvTotal: Number(shopRow.gmv),
    shopeeAds: adsRow.n === 0 ? null : Number(adsRow.gmv),
    affiliate: affRow.n === 0 ? null : Number(affRow.gmv),
  };
}

/**
 * Bagian "live" — SATU query dipakai KEDUA platform (keputusan pemilik via
 * `AskUserQuestion`, 2026-09-16 — lihat docblock `pdt.PdtLaporanLive`,
 * `@cdps/core`): `pdt_fact_content` jenis `'live'` membawa kolom yang sama
 * persis untuk `tt_live`/`shopee_live`, nol query terpisah per platform
 * dibutuhkan (beda dari kanal/kpi yang basis-nya berbeda per platform).
 * `count(kolom)` per kolom (bukan cuma `count(*)`) — null-aware: `durasi_
 * detik` SELALU nol-terisi untuk Shopee (kolom sumbernya kosong permanen,
 * lihat docblock core), `count(durasi_detik) = 0` menegakkan itu jadi
 * `jam: null`, BUKAN 0 jam yang mengarang durasi.
 */
async function bacaLive(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanLiveInput | null> {
  const [row] = await sql<{
    sesi: number;
    gmv_n: number; gmv: string;
    vv_n: number; vv: string;
    jam_n: number; durasi_detik: string;
  }[]>`
    select count(*)::int as sesi,
           count(gmv)::int as gmv_n, coalesce(sum(gmv), 0) as gmv,
           count(vv)::int as vv_n, coalesce(sum(vv), 0) as vv,
           count(durasi_detik)::int as jam_n, coalesce(sum(durasi_detik), 0) as durasi_detik
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis = 'live'`;
  if (row.sesi === 0) return null;

  return {
    sesi: row.sesi,
    gmv: row.gmv_n === 0 ? null : Number(row.gmv),
    vv: row.vv_n === 0 ? null : Number(row.vv),
    jam: row.jam_n === 0 ? null : Number(row.durasi_detik) / 3600,
  };
}

/**
 * Bagian "video" — SATU query dipakai KEDUA platform (keputusan pemilik via
 * `AskUserQuestion`, 2026-09-16 — lihat docblock `pdt.PdtLaporanVideo`,
 * `@cdps/core`): platform-agnostic di sini, `client_platform_id` Shopee
 * SELALU dapat `total: 0` (⇒ `bangunLaporanVideo` mengembalikan `null`)
 * karena `shopee_video` nol penulis fakta ke `pdt_fact_content` — BUKAN
 * filter platform eksplisit di query ini. SELURUH baris (toko+afiliasi)
 * diikutkan, TANPA filter `is_akun_toko` (cermin dimensi skor Video,
 * `rakitInputSkorTiktok`). `count(kolom)` per kolom — null-aware: `likes`/
 * `dibagikan`/`klik_produk` TERISI untuk `tt_video`, `komentar`/
 * `pengikut_baru`/`produk_dilihat` TIDAK PERNAH (sengaja tidak diikutkan,
 * lihat docblock core).
 */
async function bacaVideo(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanVideoInput | null> {
  const [row] = await sql<{
    total: number;
    gmv_n: number; gmv: string;
    vv_n: number; vv: string;
    likes_n: number; likes: string;
    dibagikan_n: number; dibagikan: string;
    klik_produk_n: number; klik_produk: string;
  }[]>`
    select count(*)::int as total,
           count(gmv)::int as gmv_n, coalesce(sum(gmv), 0) as gmv,
           count(vv)::int as vv_n, coalesce(sum(vv), 0) as vv,
           count(likes)::int as likes_n, coalesce(sum(likes), 0) as likes,
           count(dibagikan)::int as dibagikan_n, coalesce(sum(dibagikan), 0) as dibagikan,
           count(klik_produk)::int as klik_produk_n, coalesce(sum(klik_produk), 0) as klik_produk
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis = 'video'`;
  if (row.total === 0) return null;

  return {
    total: row.total,
    gmv: row.gmv_n === 0 ? null : Number(row.gmv),
    vv: row.vv_n === 0 ? null : Number(row.vv),
    likes: row.likes_n === 0 ? null : Number(row.likes),
    dibagikan: row.dibagikan_n === 0 ? null : Number(row.dibagikan),
    klikProduk: row.klik_produk_n === 0 ? null : Number(row.klik_produk),
  };
}

/**
 * Bagian "iklan" TikTok (keputusan pemilik via `AskUserQuestion`, 2026-09-16,
 * KELIMA — lihat docblock `pdt.PdtLaporanIklan`, `@cdps/core`). `pdt_fact_ads`
 * sumber `tt_ads_product`/`tt_ads_live`, DIPISAH per sumber (`group by
 * sumber`, beda dari `rakitInputSkorTiktok`'s dimensi `ads` yang menjumlah
 * keduanya jadi satu — "iklan" laporan butuh breakdown per item, skor cuma
 * butuh total). `null` per sumber = nol baris sumber itu di periode ini
 * (tidak diketahui, BUKAN nol) — `bangunIklanTiktok` yang menegakkan
 * null-aware total.
 */
async function bacaIklanTiktok(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanIklanInputTiktok | null> {
  const rows = await sql<{ sumber: string; n: number; biaya: string; gmv_n: number; gmv: string }[]>`
    select sumber, count(*)::int as n,
           coalesce(sum(biaya), 0) as biaya,
           count(gmv)::int as gmv_n, coalesce(sum(gmv), 0) as gmv
      from pdt_fact_ads
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and sumber in ('tt_ads_product', 'tt_ads_live')
     group by sumber`;
  if (rows.length === 0) return null;
  const bySumber = new Map(rows.map((r) => [r.sumber, r]));
  const pick = (sumber: string): { biaya: number; gmv: number | null } | null => {
    const r = bySumber.get(sumber);
    if (!r || r.n === 0) return null;
    return { biaya: Number(r.biaya), gmv: r.gmv_n === 0 ? null : Number(r.gmv) };
  };
  return { product: pick('tt_ads_product'), live: pick('tt_ads_live') };
}

/**
 * Bagian "iklan" Shopee (lihat docblock `pdt.PdtLaporanIklan`/
 * `bangunIklanShopee`, `@cdps/core` — SELALU `lengkap: false`, `ads_banner`
 * legacy tidak pernah punya modul PDT). `pdt_fact_ads` sumber
 * `shopee_ads_cpc`/`search`/`live`, DIPISAH per sumber — beda dari
 * `rakitInputSkorShopee`'s dimensi `ads` yang menjumlah ketiganya.
 */
async function bacaIklanShopee(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanIklanInputShopee | null> {
  const rows = await sql<{ sumber: string; n: number; biaya: string; gmv_n: number; gmv: string }[]>`
    select sumber, count(*)::int as n,
           coalesce(sum(biaya), 0) as biaya,
           count(gmv)::int as gmv_n, coalesce(sum(gmv), 0) as gmv
      from pdt_fact_ads
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and sumber in ('shopee_ads_cpc', 'shopee_ads_search', 'shopee_ads_live')
     group by sumber`;
  if (rows.length === 0) return null;
  const bySumber = new Map(rows.map((r) => [r.sumber, r]));
  const pick = (sumber: string): { biaya: number; gmv: number | null } | null => {
    const r = bySumber.get(sumber);
    if (!r || r.n === 0) return null;
    return { biaya: Number(r.biaya), gmv: r.gmv_n === 0 ? null : Number(r.gmv) };
  };
  return { cpc: pick('shopee_ads_cpc'), search: pick('shopee_ads_search'), live: pick('shopee_ads_live') };
}

/**
 * Bagian "afiliasi" (ringkasan) — keputusan pemilik via `AskUserQuestion`,
 * 2026-09-16, KEENAM (lihat docblock `pdt.PdtLaporanAfiliasi`, `@cdps/core`).
 * SATU query platform-agnostic dipakai KEDUA platform (pola sama `bacaLive`/
 * `bacaVideo`) — `pdt_fact_creator_period` punya kolom yang sama persis
 * untuk TikTok/Shopee, `count(kolom)` per kolom (bukan cuma `count(*)`)
 * menegakkan null-aware: `jumlah_live`/`jumlah_video` SELALU nol-terisi untuk
 * Shopee (`shopee_ams_afiliasi` tidak pernah menulisnya), `count(...) = 0`
 * menegakkan itu jadi `null`, BUKAN 0 sesi/video yang mengarang. `produktif`
 * cermin PERSIS `rakitInputSkorTiktok`'s dimensi Affiliate
 * (`coalesce(gmv, 0) > 0`).
 */
async function bacaAfiliasi(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanAfiliasiInput | null> {
  const [row] = await sql<{
    total: number; produktif: number;
    gmv_n: number; gmv: string;
    pesanan_n: number; pesanan: string;
    live_n: number; live: string;
    video_n: number; video: string;
  }[]>`
    select count(*)::int as total,
           coalesce(sum(case when coalesce(gmv, 0) > 0 then 1 else 0 end), 0)::int as produktif,
           count(gmv)::int as gmv_n, coalesce(sum(gmv), 0) as gmv,
           count(pesanan_teratribusi)::int as pesanan_n, coalesce(sum(pesanan_teratribusi), 0) as pesanan,
           count(jumlah_live)::int as live_n, coalesce(sum(jumlah_live), 0) as live,
           count(jumlah_video)::int as video_n, coalesce(sum(jumlah_video), 0) as video
      from pdt_fact_creator_period
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date`;
  if (row.total === 0) return null;

  return {
    totalKreator: row.total,
    produktif: row.produktif,
    gmv: row.gmv_n === 0 ? null : Number(row.gmv),
    pesanan: row.pesanan_n === 0 ? null : Number(row.pesanan),
    jumlahLive: row.live_n === 0 ? null : Number(row.live),
    jumlahVideo: row.video_n === 0 ? null : Number(row.video),
  };
}

/**
 * Bagian "tahap" TikTok (keputusan pemilik via `AskUserQuestion`, 2026-09-16,
 * KETUJUH — lihat docblock `pdt.PdtLaporanTahap`, `@cdps/core`). EMPAT
 * sub-query BARU (bukan reuse murni bagian lain — `pdt.bangunLaporanTahap`
 * yang menerima kpi/iklan/afiliasi/video yang SUDAH dibangun untuk sisanya):
 *  - `tahap_fokus` dari `client_platforms` — kolom SAMA yang sudah dipakai
 *    mesin lama (`report.ts`), nol migrasi baru.
 *  - `klik` — `pdt_fact_shop_daily.produk_diklik` basis `'net'` (SAMA basis
 *    KPI TikTok, Rule 15) — sudah ditulis writer sejak G1-09, belum pernah
 *    dibaca laporan manapun.
 *  - `cpaInput` — `pdt_fact_ads.pesanan_sku` sumber `tt_ads_product`/
 *    `tt_ads_live`, TERPISAH dari `bacaIklanTiktok` (kolom itu tidak
 *    pernah dibaca "iklan", menambahkannya di sini menghindari mengubah
 *    bentuk "iklan" yang sudah merge).
 *  - `affPosting` — hitungan BARU `pdt_fact_creator_period` ber-`jumlah_
 *    live>0 OR jumlah_video>0`, `null` bila nol baris kreator sama sekali
 *    (cermin konvensi `bacaAfiliasi`).
 */
async function bacaTahapTiktok(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanTahapInput> {
  const [[cp], [klikRow], [adsRow], [affRow]] = await Promise.all([
    sql<{ tahap_fokus: string | null }[]>`select tahap_fokus from client_platforms where id = ${clientPlatformId}`,
    sql<{ n: number; klik: string }[]>`
      select count(produk_diklik)::int as n, coalesce(sum(produk_diklik), 0) as klik
        from pdt_fact_shop_daily
       where client_platform_id = ${clientPlatformId}
         and basis = 'net'
         and tanggal >= ${periodeAwalBulan}::date
         and tanggal < (${periodeAwalBulan}::date + interval '1 month')`,
    // `tayangan`/`klik` ikut dibaca di query yang SAMA (bukan query kelima):
    // keduanya kolom `pdt_fact_ads` pada baris yang sama persis yang `biaya`/
    // `pesanan_sku` sudah diambil. `count(...)` per kolom karena `sum()` atas
    // nol baris non-null tetap 0, dan 0 di funnel berarti "nol tayangan"
    // sementara yang benar "tidak diketahui" (Rule 12).
    sql<{ n: number; biaya: string; pesanan_n: number; pesanan: string; tayangan_n: number; tayangan: string; klik_n: number; klik: string }[]>`
      select count(*)::int as n, coalesce(sum(biaya), 0) as biaya,
             count(pesanan_sku)::int as pesanan_n, coalesce(sum(pesanan_sku), 0) as pesanan,
             count(tayangan)::int as tayangan_n, coalesce(sum(tayangan), 0) as tayangan,
             count(klik)::int as klik_n, coalesce(sum(klik), 0) as klik
        from pdt_fact_ads
       where client_platform_id = ${clientPlatformId}
         and periode = ${periodeAwalBulan}::date
         and sumber in ('tt_ads_product', 'tt_ads_live')`,
    sql<{ total: number; posting: number }[]>`
      select count(*)::int as total,
             coalesce(sum(case when coalesce(jumlah_live, 0) > 0 or coalesce(jumlah_video, 0) > 0 then 1 else 0 end), 0)::int as posting
        from pdt_fact_creator_period
       where client_platform_id = ${clientPlatformId}
         and periode = ${periodeAwalBulan}::date`,
  ]);

  return {
    tahapFokus: cp?.tahap_fokus ?? null,
    klik: klikRow.n === 0 ? null : Number(klikRow.klik),
    cpaInput: adsRow.n === 0 ? null : { biaya: Number(adsRow.biaya), pesanan: adsRow.pesanan_n === 0 ? null : Number(adsRow.pesanan) },
    affPosting: affRow.total === 0 ? null : affRow.posting,
    ttamFunnel: adsRow.n === 0 ? null : {
      tayangan: adsRow.tayangan_n === 0 ? null : Number(adsRow.tayangan),
      klik: adsRow.klik_n === 0 ? null : Number(adsRow.klik),
    },
  };
}

/**
 * Bagian "produk" (Portfolio Produk/kuadran) TikTok — keputusan pemilik via
 * `AskUserQuestion` ("G2-01-KUADRAN-SKU (produk)"), lihat docblock
 * `pdt.bangunLaporanProduk`, `@cdps/core`. **HARUS dipanggil SETELAH
 * `hitungSkorTiktok` selesai** (`rakitLaporanTiktok` di bawah menjamin
 * urutan ini) — kolom `kuadran` baru ditulis `klasifikasiUlangKuadranSkuTiktok`
 * di dalam `hitungSkorTiktok`, membaca sebelum itu akan melihat `kuadran`
 * basi/`null` dari klasifikasi periode lain atau belum pernah sama sekali.
 */
async function bacaProdukTiktok(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanProdukInput> {
  const rows = await sql<{ kuadran: string | null; nama_produk: string | null; platform_product_id: string | null; gmv: string | null; klik: number | null; ctor: string | null; pesanan_sku: number | null; impresi: number | null }[]>`
    select kuadran, nama_produk, platform_product_id, gmv, klik, ctor, pesanan_sku, impresi
      from pdt_fact_sku_period
     where client_platform_id = ${clientPlatformId} and sku_id is null and basis = 'net'
       and periode = ${periodeAwalBulan}::date`;
  if (rows.length === 0) return null;
  return rows.map((r) => {
    const klik = r.klik;
    const ctor = r.ctor == null ? null : Number(r.ctor);
    const cvr = ctor ?? (r.pesanan_sku == null || klik == null || klik === 0 ? null : r.pesanan_sku / klik);
    return {
      kuadran: r.kuadran as pdt.PdtKuadranSku | null,
      namaProduk: r.nama_produk,
      platformProductId: r.platform_product_id,
      gmv: r.gmv == null ? null : Number(r.gmv),
      klik,
      // Sumbu-X kuadran TikTok = klik (Shopee memakai `pengunjung`) — dua
      // platform, satu field, karena mode relatif memerlukannya seragam.
      traffic: klik,
      impresi: r.impresi,
      cvr,
    };
  });
}

/**
 * Bagian "promo" Shopee (§8 mesin lama) — `pdt_fact_promo`, G4-03 aksi 4.
 *
 * Baris dibaca APA ADANYA termasuk `tipe_promosi='Semua'`; yang MEMISAHKAN
 * total dari komponen adalah `pdt.bangunLaporanPromo` (satu tempat, bisa
 * diuji tanpa DB). Query ini sengaja tidak `sum()` apa pun — menjumlah
 * baris diskon di SQL adalah persis dobel-hitung yang constraint tabelnya
 * dibuat untuk mencegah.
 */
async function bacaPromo(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanPromoInput> {
  const rows = await sql<{
    jenis: string; tipe_promosi: string | null;
    penjualan_dibuat: string | null; penjualan_siap_dikirim: string | null;
    pesanan_dibuat: number | null; pesanan_siap_dikirim: number | null;
    produk_dilihat: number | null; produk_diklik: number | null;
  }[]>`
    select jenis, tipe_promosi, penjualan_dibuat, penjualan_siap_dikirim,
           pesanan_dibuat, pesanan_siap_dikirim, produk_dilihat, produk_diklik
      from pdt_fact_promo
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date`;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    jenis: r.jenis as 'diskon' | 'flash_sale',
    tipePromosi: r.tipe_promosi,
    penjualanDibuat: r.penjualan_dibuat == null ? null : Number(r.penjualan_dibuat),
    penjualanSiapDikirim: r.penjualan_siap_dikirim == null ? null : Number(r.penjualan_siap_dikirim),
    pesananDibuat: r.pesanan_dibuat,
    pesananSiapDikirim: r.pesanan_siap_dikirim,
    produkDilihat: r.produk_dilihat,
    produkDiklik: r.produk_diklik,
  }));
}

/**
 * Bagian "layanan" Shopee (§9 mesin lama) — `pdt_fact_layanan_chat` (G3-02a)
 * + `pdt_fact_kesehatan_penalti` (G2-01), dua tabel yang sampai hari ini
 * hanya dibaca `pdt-prefill.ts`/dimensi skor, tidak pernah oleh laporan.
 *
 * Hitungan chat DIJUMLAH di SQL; tiga kolom yang di sumbernya sudah berupa
 * rata-rata (`waktu_respon_detik`, `csat_persen`,
 * `tingkat_konversi_chat_dibalas`) dirata-rata `avg()` antar baris yang
 * mengisinya — `avg()` Postgres sudah mengabaikan NULL, jadi baris yang
 * tidak membawa kolom itu tidak menarik rata-ratanya ke bawah.
 */
async function bacaLayanan(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanLayananInput | null> {
  const [[chatRow], penaltiRows] = await Promise.all([
    sql<{
      baris: number;
      pengunjung_n: number; pengunjung: string;
      masuk_n: number; masuk: string;
      dibalas_n: number; dibalas: string;
      pesanan_n: number; pesanan: string;
      penjualan_n: number; penjualan: string;
      respon: string | null; csat: string | null; konversi: string | null;
    }[]>`
      select count(*)::int as baris,
             count(pengunjung)::int as pengunjung_n, coalesce(sum(pengunjung), 0) as pengunjung,
             count(chat_masuk)::int as masuk_n, coalesce(sum(chat_masuk), 0) as masuk,
             count(chat_dibalas)::int as dibalas_n, coalesce(sum(chat_dibalas), 0) as dibalas,
             count(total_pesanan)::int as pesanan_n, coalesce(sum(total_pesanan), 0) as pesanan,
             count(penjualan)::int as penjualan_n, coalesce(sum(penjualan), 0) as penjualan,
             avg(waktu_respon_detik) as respon,
             avg(csat_persen) as csat,
             avg(tingkat_konversi_chat_dibalas) as konversi
        from pdt_fact_layanan_chat
       where client_platform_id = ${clientPlatformId}
         and periode = ${periodeAwalBulan}::date`,
    sql<{ poin: string; deskripsi: string; durasi: string }[]>`
      select poin, deskripsi, durasi
        from pdt_fact_kesehatan_penalti
       where client_platform_id = ${clientPlatformId}
         and periode = ${periodeAwalBulan}::date`,
  ]);

  const adaChat = (chatRow?.baris ?? 0) > 0;
  if (!adaChat && penaltiRows.length === 0) return null;

  return {
    chat: !adaChat ? null : {
      barisSumber: chatRow.baris,
      pengunjung: chatRow.pengunjung_n === 0 ? null : Number(chatRow.pengunjung),
      chatMasuk: chatRow.masuk_n === 0 ? null : Number(chatRow.masuk),
      chatDibalas: chatRow.dibalas_n === 0 ? null : Number(chatRow.dibalas),
      waktuResponDetik: chatRow.respon == null ? null : Number(chatRow.respon),
      csatPersen: chatRow.csat == null ? null : Number(chatRow.csat),
      totalPesanan: chatRow.pesanan_n === 0 ? null : Number(chatRow.pesanan),
      penjualan: chatRow.penjualan_n === 0 ? null : Number(chatRow.penjualan),
      tingkatKonversiChatDibalasPersen: chatRow.konversi == null ? null : Number(chatRow.konversi),
    },
    penalti: penaltiRows.map((r) => ({ poin: Number(r.poin), deskripsi: r.deskripsi, durasi: r.durasi })),
  };
}

/**
 * Bagian "kreator" (Top 10 Creator) — `pdt_fact_creator_period`, baris yang
 * SAMA yang sudah di-`count()`/`sum()` `bacaAfiliasi`. Di sini dibaca
 * per-baris: ringkasan menjawab "seberapa besar", daftar menjawab "siapa".
 *
 * Platform-agnostic seperti `bacaAfiliasi` — Shopee otomatis dapat
 * `jumlah_live`/`jumlah_video` `null` karena writer-nya tidak mengisi kolom
 * itu, bukan karena filter platform.
 *
 * `order by gmv desc nulls last` + `limit` DI SQL sengaja TIDAK dipakai:
 * `pdt.bangunLaporanKreator` butuh SELURUH baris untuk menghitung
 * `kontribusiTop` (Σ top ÷ Σ semua) dan `totalKreator`. Jumlah kreator per
 * toko per bulan berorde puluhan, bukan puluhan ribu.
 */
async function bacaKreator(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanKreatorInput> {
  const rows = await sql<{
    creator_handle: string; gmv: string | null; gmv_live: string | null; gmv_video: string | null;
    pesanan_teratribusi: number | null; jumlah_live: number | null; jumlah_video: number | null;
  }[]>`
    select creator_handle, gmv, gmv_live, gmv_video, pesanan_teratribusi, jumlah_live, jumlah_video
      from pdt_fact_creator_period
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date`;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    handle: r.creator_handle,
    gmv: r.gmv == null ? null : Number(r.gmv),
    gmvLive: r.gmv_live == null ? null : Number(r.gmv_live),
    gmvVideo: r.gmv_video == null ? null : Number(r.gmv_video),
    pesanan: r.pesanan_teratribusi,
    jumlahLive: r.jumlah_live,
    jumlahVideo: r.jumlah_video,
  }));
}

/**
 * Bagian "sesiLive" (Top 10 Sesi) — `pdt_fact_content` `jenis='live'`,
 * baris yang SAMA yang sudah di-`sum()` `bacaLive`.
 *
 * Periodenya disaring lewat `waktu_posting` (kolom waktu satu-satunya yang
 * tabel ini punya — ia ber-key konten, bukan ber-key periode seperti
 * `pdt_fact_creator_period`), memakai batas bulan yang SAMA dengan
 * `bacaLive` supaya kedua bagian tidak pernah menghitung sesi yang berbeda.
 */
async function bacaSesiLive(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanSesiLiveInput> {
  const rows = await sql<{
    platform_content_id: string; creator_handle: string | null; is_akun_toko: boolean;
    waktu_posting: Date | string | null; durasi_detik: number | null; vv: number | null;
    gmv: string | null; pengikut_baru: number | null; klik_produk: number | null;
  }[]>`
    select platform_content_id, creator_handle, is_akun_toko, waktu_posting,
           durasi_detik, vv, gmv, pengikut_baru, klik_produk
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and jenis = 'live'
       and waktu_posting >= ${periodeAwalBulan}::date
       and waktu_posting < (${periodeAwalBulan}::date + interval '1 month')`;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    platformContentId: r.platform_content_id,
    creatorHandle: r.creator_handle,
    akunToko: r.is_akun_toko,
    waktuPosting: r.waktu_posting == null ? null : new Date(r.waktu_posting).toISOString(),
    durasiDetik: r.durasi_detik,
    vv: r.vv,
    gmv: r.gmv == null ? null : Number(r.gmv),
    pengikutBaru: r.pengikut_baru,
    klikProduk: r.klik_produk,
  }));
}

/**
 * Bagian "kampanye" (Per Kampanye) — `pdt_fact_ads` di-`group by` SUMBER +
 * KAMPANYE, bukan sumber saja seperti `bacaIklanTiktok`/`bacaIklanShopee`.
 *
 * Satu kampanye bisa punya BANYAK baris fakta (unique key-nya sampai
 * `sku_id`/`content_id`), jadi group-by di sini bukan kosmetik — tanpanya
 * satu kampanye dengan 40 SKU akan tampil 40 kali dan memenuhi seluruh
 * tabel dengan satu kampanye.
 *
 * `roas` kolom TIDAK dibaca — ia diturunkan ulang `Σgmv ÷ Σbiaya` oleh
 * `pdt.bangunLaporanKampanye` (aturan rumah #4, dan satu-satunya cara yang
 * benar setelah baris digabung: rata-rata dari rasio bukan rasio dari
 * jumlah).
 */
async function bacaKampanye(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanKampanyeInput> {
  const rows = await sql<{
    sumber: string; kampanye_id: string; biaya: string;
    gmv_n: number; gmv: string;
    tayangan_n: number; tayangan: string;
    klik_n: number; klik: string;
    pesanan_n: number; pesanan: string;
  }[]>`
    select sumber, kampanye_id, coalesce(sum(biaya), 0) as biaya,
           count(gmv)::int as gmv_n, coalesce(sum(gmv), 0) as gmv,
           count(tayangan)::int as tayangan_n, coalesce(sum(tayangan), 0) as tayangan,
           count(klik)::int as klik_n, coalesce(sum(klik), 0) as klik,
           count(pesanan_sku)::int as pesanan_n, coalesce(sum(pesanan_sku), 0) as pesanan
      from pdt_fact_ads
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
     group by sumber, kampanye_id`;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    sumber: r.sumber,
    kampanyeId: r.kampanye_id,
    biaya: Number(r.biaya),
    gmv: r.gmv_n === 0 ? null : Number(r.gmv),
    tayangan: r.tayangan_n === 0 ? null : Number(r.tayangan),
    klik: r.klik_n === 0 ? null : Number(r.klik),
    pesanan: r.pesanan_n === 0 ? null : Number(r.pesanan),
  }));
}

/**
 * Bagian "produk" sisi SHOPEE — `pdt_fact_sku_period` basis
 * `'siap_dikirim'`, basis yang SAMA dengan KPI Shopee (Rule 16) sehingga
 * Σ Top Produk menggulung ke angka GMV bulanan yang sama (kesetaraan yang
 * sudah dibuktikan G1-07-SHOPEE-DOBEL-HITUNG ke sample asli).
 *
 * **`kuadran` sekarang TERISI** (KUADRAN-SHOPEE, `docs/DECISIONS.md`).
 * Sebelumnya `null` permanen dengan catatan "Shopee tidak punya klasifikator
 * kuadran sama sekali"; sekarang `klasifikasiUlangKuadranSkuShopee` menulisnya
 * SEBELUM fungsi ini dipanggil (`hitungSkorShopee` di dalam `Promise.all`
 * `rakitLaporanShopee`, urutan yang dijamin sama seperti sisi TikTok).
 *
 * **`cvr` = `pesanan ÷ pengunjung`, bukan `pesanan ÷ impresi`.** Versi
 * sebelumnya memakai `impresi` dengan alasan tertulis "`impresi` di baris
 * Shopee memuat pengunjung produk" — itu KELIRU, dan berkas aslinya
 * membuktikannya: `impresi` diisi `'Jumlah Produk Dilihat'`
 * (`ekstrakBarisFaktaSkuShopeeParentSku`), yang pada Fim Motor Juli 2026
 * bernilai 1.383.429 untuk produk yang `'Pengunjung Produk (Kunjungan)'`-nya
 * 32.949 — 42× lebih besar. Rasio lama karena itu bukan CR yang mesin lama
 * cetak melainkan angka ~42× lebih kecil, dan setiap produk terlihat nyaris
 * tidak closing. `pengunjung` (kolom baru, migrasi `20261128010000`) adalah
 * penyebut yang benar — `cr_basis = 'pesanan_per_pengunjung'` mesin lama.
 *
 * `traffic` = `pengunjung` (sumbu-X kuadran Shopee), sementara `klik` tetap
 * `'Produk Diklik'` untuk kolom tabel. Dua angka berbeda, dua konsumen
 * berbeda — mode relatif memakai `traffic`, tampilan memakai `klik`.
 */
async function bacaProdukShopee(sql: Sql, clientPlatformId: number, periodeAwalBulan: string): Promise<pdt.PdtLaporanProdukInput> {
  const rows = await sql<{
    nama_produk: string | null; platform_product_id: string | null; kuadran: string | null;
    gmv: string | null; pengunjung: number | null; klik: number | null; pesanan: number | null; impresi: number | null;
  }[]>`
    select nama_produk, platform_product_id, kuadran, gmv, pengunjung, klik, pesanan, impresi
      from pdt_fact_sku_period
     where client_platform_id = ${clientPlatformId} and sku_id is null and basis = 'siap_dikirim'
       and periode = ${periodeAwalBulan}::date`;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    kuadran: r.kuadran as pdt.PdtKuadranSku | null,
    namaProduk: r.nama_produk,
    platformProductId: r.platform_product_id,
    gmv: r.gmv == null ? null : Number(r.gmv),
    klik: r.klik,
    traffic: r.pengunjung,
    impresi: r.impresi,
    cvr: pdt.crKuadranShopee({ id: 0, pengunjung: r.pengunjung, pesananDibuat: r.pesanan }),
  }));
}

/** Rakit payload laporan TikTok v1: KPI ringkas basis `'net'` (Rule 15) + harian + kanal + iklan + live + video + produk + afiliasi + tahap + `hitungSkorTiktok`. */
export async function rakitLaporanTiktok(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
  now: Date = new Date(),
): Promise<pdt.PdtLaporanTiktok> {
  validasiPeriodeAwalBulan(periodeAwalBulan);
  const [kpi, harian, kanal, iklan, live, video, afiliasi, kreator, sesiLive, kampanye, tahap, { hasil: skor, benchmarkVersi, bench }] = await Promise.all([
    bacaKpiTiktokNet(sql, clientPlatformId, periodeAwalBulan),
    bacaHarian(sql, clientPlatformId, periodeAwalBulan, 'net', true),
    bacaKanalTiktok(sql, clientPlatformId, periodeAwalBulan),
    bacaIklanTiktok(sql, clientPlatformId, periodeAwalBulan),
    bacaLive(sql, clientPlatformId, periodeAwalBulan),
    bacaVideo(sql, clientPlatformId, periodeAwalBulan),
    bacaAfiliasi(sql, clientPlatformId, periodeAwalBulan),
    bacaKreator(sql, clientPlatformId, periodeAwalBulan),
    bacaSesiLive(sql, clientPlatformId, periodeAwalBulan),
    bacaKampanye(sql, clientPlatformId, periodeAwalBulan),
    bacaTahapTiktok(sql, clientPlatformId, periodeAwalBulan),
    hitungSkorTiktok(sql, clientPlatformId, periodeAwalBulan),
  ]);
  // `produk` DIBACA SETELAH Promise.all di atas — hitungSkorTiktok (bagian dari
  // Promise.all) sudah menulis kolom kuadran periode ini, membacanya SEBELUM itu
  // akan lomba (race) dengan tulisan yang belum selesai.
  const produk = await bacaProdukTiktok(sql, clientPlatformId, periodeAwalBulan);
  return pdt.bangunLaporanTiktok({
    clientPlatformId, periodeAwalBulan, generatedAt: now.toISOString(), kpi, harian, kanal, iklan, live, video, produk, afiliasi,
    kreator, sesiLive, kampanye, tahap, skor, benchmarkVersi,
    benchTiktok: bench,
  });
}

/** Rakit payload laporan Shopee v1: KPI ringkas basis `'siap_dikirim'` (Rule 16) + harian + kanal + iklan + live + video + afiliasi + `hitungSkorShopee`. */
export async function rakitLaporanShopee(
  sql: Sql,
  clientPlatformId: number,
  periodeAwalBulan: string,
  now: Date = new Date(),
): Promise<pdt.PdtLaporanShopee> {
  validasiPeriodeAwalBulan(periodeAwalBulan);
  const [kpi, harian, kanal, iklan, live, video, produk, afiliasi, kreator, sesiLive, kampanye, promo, layanan, { hasil: skor }] = await Promise.all([
    bacaKpiShopDaily(sql, clientPlatformId, periodeAwalBulan, 'siap_dikirim'),
    bacaHarian(sql, clientPlatformId, periodeAwalBulan, 'siap_dikirim', false),
    bacaKanalShopee(sql, clientPlatformId, periodeAwalBulan),
    bacaIklanShopee(sql, clientPlatformId, periodeAwalBulan),
    bacaLive(sql, clientPlatformId, periodeAwalBulan),
    bacaVideo(sql, clientPlatformId, periodeAwalBulan),
    bacaProdukShopee(sql, clientPlatformId, periodeAwalBulan),
    bacaAfiliasi(sql, clientPlatformId, periodeAwalBulan),
    bacaKreator(sql, clientPlatformId, periodeAwalBulan),
    bacaSesiLive(sql, clientPlatformId, periodeAwalBulan),
    bacaKampanye(sql, clientPlatformId, periodeAwalBulan),
    bacaPromo(sql, clientPlatformId, periodeAwalBulan),
    bacaLayanan(sql, clientPlatformId, periodeAwalBulan),
    hitungSkorShopee(sql, clientPlatformId, periodeAwalBulan),
  ]);
  return pdt.bangunLaporanShopee({
    clientPlatformId, periodeAwalBulan, generatedAt: now.toISOString(), kpi, harian, kanal, iklan, live, video, produk, afiliasi,
    kreator, sesiLive, kampanye, promo, layanan, skor,
  });
}

/**
 * Flow B langkah 1: "AM membuka laporan periode X → laporan dirender dari
 * view atas fakta". Gerbang izin `canKirimLaporan` (Flow B satu-satunya
 * predikat bernama — melihat sebelum memutuskan kirim adalah bagian dari
 * flow yang sama, bukan gerbang terpisah). Platform toko dibaca dari
 * `client_platforms.platform` (bukan parameter caller) — pola sama
 * `previewUploadBatch`/`commitUploadBatch`.
 */
export async function bacaLaporanPdt(
  sql: Sql,
  actor: Actor,
  clientPlatformId: number,
  periodeAwalBulan: string,
  now: Date = new Date(),
): Promise<pdt.PdtLaporanTiktok | pdt.PdtLaporanShopee> {
  const row = await loadClientPlatformUntukPdt(sql, clientPlatformId);
  if (!canKirimLaporan(actor, row.assigned_am_id)) throw new ForbiddenError();

  const platform = platformKeVokabPdt(row.platform);
  if (!platform) {
    throw new ValidationError(`[platform toko '${row.platform}' tidak didukung PDT — Tokopedia/Lazada/Blibli tetap manual (PDT-22)]`);
  }

  return platform === 'tiktok'
    ? rakitLaporanTiktok(sql, clientPlatformId, periodeAwalBulan, now)
    : rakitLaporanShopee(sql, clientPlatformId, periodeAwalBulan, now);
}

type PdtJsonParam = Parameters<TransactionSql['json']>[0];

/** Baris `pdt_laporan_kiriman` yang baru ditulis, plus laporan yang dibekukan ke dalamnya. */
export interface PdtLaporanKirimanHasil {
  id: number;
  clientPlatformId: number;
  periodeMulai: string;
  periodeSelesai: string;
  parserVersi: number;
  /** Rule 23 — versi `pdt_benchmark` dipakai saat pengiriman. `null` untuk Shopee: mesin skornya memakai ambang hardcode, nol `pdt_benchmark` dibaca (lihat migrasi `20261031010000`). */
  benchmarkVersi: number | null;
  dikirimPada: string;
  dikirimOleh: string;
  /** Flow B langkah 5 — id kiriman SEBELUMNYA untuk toko+periode yang sama, kalau ini kiriman ulang/revisi. `null` = kiriman pertama. */
  menggantikanKirimanId: number | null;
  laporan: pdt.PdtLaporanTiktok | pdt.PdtLaporanShopee;
}

/**
 * Flow B langkah 4: "AM menekan Kirim ke klien ⇒ snapshot beku ditulis ke
 * `pdt_laporan_kiriman`" (Rule 22). Menghitung ULANG laporan lewat
 * `bacaLaporanPdt` (gerbang `canKirimLaporan` + pemilihan platform sudah
 * ditegakkan di sana — nol duplikasi) lalu membekukan HASIL PERSIS itu ke
 * `payload` (bentuk domain camelCase — konversi ke wire adalah tugas
 * pembaca, `packages/domain` tidak boleh bergantung pada `apps/api`).
 *
 * Setiap panggilan menulis baris BARU (tabel append-only, `_frozen()`
 * memblokir UPDATE) — memanggil ini dua kali untuk toko+periode yang sama
 * adalah kirim-ulang/revisi (Flow B langkah 5, Rule 23 "nol permintaan
 * upload ulang ke AM"), BUKAN idempotensi: baris kedua `menggantikan_kiriman_id`
 * menunjuk baris pertama secara otomatis (kiriman TERAKHIR untuk toko+periode
 * yang sama, urut `dikirim_pada`).
 *
 * `benchmarkVersi` NULL untuk Shopee (keputusan pemilik via `AskUserQuestion`,
 * migrasi `20261031010000` — lihat docblock migrasi untuk penjelasan lengkap
 * + opsi yang ditolak): `pdt.PdtLaporanShopee` tidak punya field itu sama
 * sekali, cermin `rakitLaporanShopee`/`hitungSkorShopee` yang tidak pernah
 * membaca `pdt_benchmark` untuk Shopee.
 *
 * Rule 24 (pencabutan ⇒ hitung ulang `total_sales`/Health Score/baseline Ads)
 * SENGAJA di luar cakupan fungsi ini — itu operasi TERPISAH ("cabut", bukan
 * "kirim"), belum ada mekanismenya sama sekali (`pdt_laporan_kiriman` nol
 * kolom status, Flow B tidak menyebutnya), dicatat di `PDT_BACKLOG.md` §2
 * sebagai tiket sendiri.
 *
 * `insightDraft` (G2-01-INSIGHT-EDIT, opsional) — AM menyunting narasi
 * "insight" di layar pratinjau sebelum menekan Kirim; kalau diisi,
 * `pdt.normalizePdtInsightDraft` (`@cdps/core`) memvalidasi + menggantikan
 * `laporan.insight` mesin SEBELUM dibekukan. `PdtInsightDraftError`
 * diterjemahkan ke `ValidationError` (pesan BI `[...]` sama persis) supaya
 * `apps/api` tidak perlu tahu error itu lahir di core, bukan domain — pola
 * sama semua gerbang validasi lain di modul ini. Diabaikan (`undefined`) ⇒
 * insight mesin apa adanya, perilaku SAMA sebelum parameter ini ada.
 */
export async function kirimLaporanPdt(
  sql: Sql,
  actor: Actor,
  clientPlatformId: number,
  periodeAwalBulan: string,
  now: Date = new Date(),
  insightDraft?: pdt.PdtInsightDraft,
): Promise<PdtLaporanKirimanHasil> {
  const laporan = await bacaLaporanPdt(sql, actor, clientPlatformId, periodeAwalBulan, now);
  if (insightDraft !== undefined) {
    try {
      laporan.insight = pdt.normalizePdtInsightDraft(insightDraft);
    } catch (err) {
      if (err instanceof pdt.PdtInsightDraftError) throw new ValidationError(err.message);
      throw err;
    }
  }
  const benchmarkVersi = laporan.platform === 'tiktok' ? laporan.benchmarkVersi : null;

  return withTransaction(sql, async (tx) => {
    const [prev] = await tx<{ id: number }[]>`
      select id from pdt_laporan_kiriman
       where client_platform_id = ${clientPlatformId}
         and periode_mulai = ${periodeAwalBulan}::date
       order by dikirim_pada desc
       limit 1`;

    const [row] = await tx<{
      id: number;
      periode_mulai: string;
      periode_selesai: string;
      parser_versi: number;
      benchmark_versi: number | null;
      dikirim_pada: string;
      dikirim_oleh: string;
      menggantikan_kiriman_id: number | null;
    }[]>`
      insert into pdt_laporan_kiriman
        (client_platform_id, periode_mulai, periode_selesai, payload, parser_versi, benchmark_versi,
         dikirim_pada, dikirim_oleh, menggantikan_kiriman_id)
      values
        (${clientPlatformId}, ${periodeAwalBulan}::date,
         (${periodeAwalBulan}::date + interval '1 month' - interval '1 day')::date,
         ${tx.json(laporan as unknown as PdtJsonParam)}, ${pdt.PDT_PARSER_VERSI}, ${benchmarkVersi},
         ${now.toISOString()}, ${actor.employeeId}, ${prev?.id ?? null})
      returning id, periode_mulai::text, periode_selesai::text, parser_versi, benchmark_versi,
                dikirim_pada::text, dikirim_oleh, menggantikan_kiriman_id`;

    // G1-10-RETENSI-RECOMPUTE — Rule 45 baris ketiga: paket ZIP yang menopang laporan yang
    // SUDAH DIKIRIM ke klien diperpanjang retensinya +12 bulan sejak pengiriman, tidak pernah
    // diperpendek. Pola SAMA `productexchange-m3.ts` PX-M3-08 ("SKU di katalog PX" — pemicu
    // KEEMPAT Rule 45, sudah tertutup): perpanjangan ditulis LANGSUNG oleh domain yang memicunya
    // (di sini) saat kejadian terjadi, BUKAN oleh `planPdtPurgeTick` (yang hanya membaca kolom
    // ini apa adanya). Beda dari PX-M3-08 (yang punya `batch_ids` eksplisit dari `px_sku_volume`):
    // `pdt_fact_*` tidak menyimpan daftar batch sumber per laporan, jadi batch yang "menopang"
    // dipilih lewat overlap rentang tanggal `client_platform_id` yang sama dengan periode laporan
    // (`periode_mulai`/`periode_selesai` KIRIMAN, bukan batch) — TANPA memfilter `status`: baris
    // fakta ditulis `tulisFaktaModulTerparse` bahkan untuk batch yang akhirnya `ditolak` karena
    // rekonsiliasi (identitas tetap dicek lebih dulu), jadi status batch TIDAK bisa dipakai untuk
    // menyingkirkan kandidat — semangat sama Rule 48 ("tidak bisa membuktikan ⇒ tidak boleh
    // menghapus"). `legal_hold` dikecualikan (sudah tidak pernah dipurge, memperpanjang kolomnya
    // tidak berguna).
    await tx`
      update pdt_upload_batch
         set retensi_sampai = greatest(retensi_sampai, ${tz.addMonthsToDate(tz.dateString(now), 12)}::date),
             retensi_alasan = 'laporan_terkirim'
       where client_platform_id = ${clientPlatformId}
         and legal_hold = false
         and periode_mulai <= ${row.periode_selesai}::date
         and periode_selesai >= ${row.periode_mulai}::date`;

    await executors(tx).audit.insertAudit({
      entityType: 'pdt_laporan_kiriman',
      entityId: String(row.id),
      actorEmployeeId: actor.employeeId,
      action: 'pdt_laporan_dikirim',
      beforeJson: null,
      afterJson: {
        client_platform_id: clientPlatformId,
        periode_mulai: row.periode_mulai,
        periode_selesai: row.periode_selesai,
        parser_versi: row.parser_versi,
        benchmark_versi: row.benchmark_versi,
        menggantikan_kiriman_id: row.menggantikan_kiriman_id,
      },
      createdBy: actor.employeeId,
    });

    return {
      id: row.id,
      clientPlatformId,
      periodeMulai: row.periode_mulai,
      periodeSelesai: row.periode_selesai,
      parserVersi: row.parser_versi,
      benchmarkVersi: row.benchmark_versi,
      dikirimPada: row.dikirim_pada,
      dikirimOleh: row.dikirim_oleh,
      menggantikanKirimanId: row.menggantikan_kiriman_id,
      laporan,
    };
  });
}

/** Satu baris riwayat kiriman — bentuk sama `PdtLaporanKirimanHasil` MINUS `laporan` (payload beku, sengaja tidak diikutkan daftar — lihat docblock `riwayatKirimanPdt`). */
export type PdtKirimanRingkas = Omit<PdtLaporanKirimanHasil, 'laporan'>;

/**
 * riwayatKirimanPdt — seluruh baris `pdt_laporan_kiriman` satu toko klien,
 * terbaru dulu (preseden `showcase.riwayatIzin`: ledger append-only, scope
 * baca sama dengan gerbang tulisnya). Dipakai halaman laporan untuk tahu
 * toko+periode yang sedang dilihat SUDAH pernah dikirim (label tombol
 * "Kirim Ulang" vs "Kirim ke Klien", Flow B langkah 5) — dicatat sebagai
 * kekurangan sengaja di sesi "Kirim ke klien" (`PDT_BACKLOG.md` §2,
 * `docs/DECISIONS.md` 2026-09-16), sekarang ditutup.
 *
 * `payload` (snapshot laporan beku) SENGAJA TIDAK diikutkan di sini — daftar
 * ini menjawab "kapan/oleh siapa/revisi dari yang mana", bukan "seperti apa
 * isinya persis" (JSONB itu bisa besar dan tidak dibutuhkan tampilan daftar).
 * Melihat isi snapshot yang sudah dibekukan adalah kebutuhan TERPISAH — belum
 * ada endpoint/fungsi untuk itu, di luar cakupan di sini.
 */
export async function riwayatKirimanPdt(sql: Sql, actor: Actor, clientPlatformId: number): Promise<PdtKirimanRingkas[]> {
  const row = await loadClientPlatformUntukPdt(sql, clientPlatformId);
  if (!canKirimLaporan(actor, row.assigned_am_id)) throw new ForbiddenError();

  const rows = await sql<{
    id: number;
    periode_mulai: string;
    periode_selesai: string;
    parser_versi: number;
    benchmark_versi: number | null;
    dikirim_pada: string;
    dikirim_oleh: string;
    menggantikan_kiriman_id: number | null;
  }[]>`
    select id, periode_mulai::text, periode_selesai::text, parser_versi, benchmark_versi,
           dikirim_pada::text, dikirim_oleh, menggantikan_kiriman_id
      from pdt_laporan_kiriman
     where client_platform_id = ${clientPlatformId}
     order by dikirim_pada desc, id desc`;

  return rows.map((r) => ({
    id: r.id,
    clientPlatformId,
    periodeMulai: r.periode_mulai,
    periodeSelesai: r.periode_selesai,
    parserVersi: r.parser_versi,
    benchmarkVersi: r.benchmark_versi,
    dikirimPada: r.dikirim_pada,
    dikirimOleh: r.dikirim_oleh,
    menggantikanKirimanId: r.menggantikan_kiriman_id,
  }));
}

// ===========================================================================
// G4-01 — katalog aksi usulan (`pdt_usulan_katalog`, migrasi `20261109010000`,
// docs/backlog/PDT_BACKLOG.md G4-01). Murni baca — nol keputusan di sini;
// `pilarkatalog.gabungKatalogDb` (`@cdps/core`) yang menggabungkan baris ini dengan
// metadata kode (nama/deskripsi/dst., TETAP di kode — lihat docblock fungsi
// itu) dan menyaring `platform_berlaku`/`aktif`. Nol gerbang actor di sini
// (pola sama `pdt_benchmark` yang dibaca `hitungSkorTiktok` tanpa re-cek
// permission) — pemanggil (`strategi.listKatalogPilar`) sudah menggerbang
// aksesnya sebelum sampai sini; `pdt_usulan_katalog` sendiri RLS
// variant A (nol policy, service-role only), jadi `sql` di sini HARUS `db()`.
// ===========================================================================

/** Satu baris `pdt_usulan_katalog` — hanya kolom yang dikonsumsi `pilarkatalog.gabungKatalogDb` (Rule 26/29/32). */
export async function listAksiKatalogAktif(sql: Queryable): Promise<pilarkatalog.AksiKatalogDbRow[]> {
  const rows = await sql<{ kode: string; platform_berlaku: string[]; kondisi: pilarkatalog.KondisiKatalogDb; aktif: boolean }[]>`
    select kode, platform_berlaku, kondisi, aktif from pdt_usulan_katalog order by kode`;
  return rows.map((r) => ({ kode: r.kode, platformBerlaku: r.platform_berlaku, kondisi: r.kondisi, aktif: r.aktif }));
}
