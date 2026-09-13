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
import { pdt, permission } from '@cdps/core';
import { withTransaction, type Sql } from '@cdps/db';
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
// G1-09 sub-langkah 2 — commit (Flow A langkah 6-9). `previewUploadBatch` di
// atas sengaja nol tulis DB; ini pemanggil NYATA pertama yang menulis
// `pdt_upload_batch`/`pdt_file` dan (bila AM konfirmasi) `client_platforms`.
//
// Storage (memindahkan objek staging → path final Rule 44) TIDAK dilakukan
// di sini — paket ini tidak boleh bergantung pada jaringan (larangan yang
// sama dengan fs/yauzl di kepala berkas). Urutan yang benar (dijalankan
// route, `apps/api/.../pdt/batches/commit/route.ts`):
//   1. `commitUploadBatch` (di sini) — INSERT batch (`raw_path` masih NULL —
//      path final butuh `batch_id`, yang baru lahir DI SINI) + `pdt_file` +
//      (opsional) ikat identitas. Return `batchId`/`periodeSelesai`.
//   2. Route memanggil `pindahkanPdtRawObjek` (apps/api/src/lib/pdt-storage.ts)
//      dari path staging ke `{client_id}/{client_platform_id}/{periodeSelesai}/{batchId}.zip`.
//   3. Berhasil → `tandaiRawTersimpan` (di sini) mengisi `raw_path`.
//      Gagal → `tandaiBatchGagalRaw` (di sini): Flow A langkah 9 — kegagalan
//      di langkah manapun menyisakan batch `ditolak` yang TETAP tersimpan,
//      bukan rollback total.
//
// **Belum dilakukan di sini (sengaja, sub-langkah 2a — lihat
// docs/backlog/PDT_BACKLOG.md G1-09 §status + handoff sesi ini):** baris
// fakta (`pdt_fact_*` — peta kolom→tabel belum ada), `pdt_usulan` (G4),
// `pdt_laporan_kiriman` (G2).
//
// **Tiga ketidakpastian PRD ditemukan menulis fungsi ini — DICATAT
// (`docs/DECISIONS.md`), bukan ditebak diam-diam:**
//  1. Identitas `tidak_dapat_divalidasi` (nol berkas 'ok' membawa sinyal
//     identitas platform ini sama sekali) DIPERLAKUKAN sebagai LOLOS (bukan
//     ditolak) — `canUploadBatch` sudah menggerbang kepemilikan toko; ini
//     murni ketiadaan cross-check TAMBAHAN, bukan bukti kesalahan.
//  2. Σ pesanan per-SKU `shopee_parent_sku` (Rule 13) — kolom itu TIDAK ada
//     di whitelist modul ini (beda dari G1-07-PERSKU-DIBAYAR, yang soal
//     basis `dibayar`; ini soal metrik pesanan sama sekali, basis apa pun).
//     Gerbang rekonsiliasi di bawah HANYA membandingkan GMV (bukan GMV+pesanan
//     seperti Rule 13/14 sebut) pada basis `siap_dikirim` (Rule 16 — basis
//     default laporan klien Shopee, gerbang Flow A langkah 7).
//  3. periode `null`/`{status:'tolak'}` (Rule 5 — nol berkas 'ok' SAMA
//     SEKALI, atau berkas ada tapi nol satu pun membawa periode terbaca) TIDAK
//     bisa dipersist sebagai batch (`periode_mulai`/`periode_selesai` NOT
//     NULL) — 400 tanpa baris, beda dari identitas/rekonsiliasi `ditolak`
//     yang tetap tersimpan (di sana periode SUDAH resolve, jadi ada baris
//     yang valid untuk menyimpan penolakannya).
// ===========================================================================

/** Meta paket ZIP (G1-04 `bacaDanEkstrakPdtZip`) — kolom `raw_*` `pdt_upload_batch` yang independen dari isi per-berkas. */
export interface PdtCommitPaketMeta {
  sha256Paket: string;
  bytesPaket: number;
  /** Total entri non-direktori (ditolak+dilewati+diproses) — `raw_entri`. */
  entriTotal: number;
  /** Subset junk macOS (Rule 41, dilewati tanpa peringatan) — `raw_entri_dilewati`. */
  entriDilewati: number;
}

export type PdtCommitStatus = 'verified' | 'identitas_belum_terikat' | 'ditolak';

export interface PdtCommitHasil {
  batchId: number;
  clientId: string;
  clientPlatformId: number;
  platform: pdt.PdtPlatform;
  periodeSelesai: string;
  status: PdtCommitStatus;
  /** `null` kecuali `status === 'ditolak'`. */
  alasanDitolak: string | null;
}

/** Cermin `PdtPreviewBerkasStatus` (tampilan) → `pdt_file.parse_status` (DB, Rule 10). `perlu_pilih_modul` TIDAK PERNAH sampai sini — `commitUploadBatch` menolak SEBELUM menulis DB bila masih ada berkas berstatus itu. */
function keParseStatusDb(status: PdtPreviewBerkasStatus): 'ok' | 'gagal' {
  return status === 'ok' ? 'ok' : 'gagal';
}

/**
 * commitUploadBatch — Flow A langkah 6-9, menulis DB (lihat catatan §komit
 * di atas untuk pembagian tanggung jawab dengan Storage). `moduleOverrides`
 * (Rule 4): nama berkas → kode modul yang AM pilih dari dropdown, menimpa
 * deteksi tanda tangan. `konfirmasiIkatIdentitas` (Rule 4): AM mengonfirmasi
 * usulan pengikatan `shop_id`/`akun_konten_toko` — hanya bermakna bila
 * `identitas.status === 'usulkan_ikat'`.
 */
export async function commitUploadBatch(
  sql: Sql,
  actor: Actor,
  clientPlatformId: number,
  berkas: readonly PdtPreviewBerkasInput[],
  opts: {
    moduleOverrides?: Readonly<Record<string, string>>;
    konfirmasiIkatIdentitas?: boolean;
    paket: PdtCommitPaketMeta;
    /** Jam SERVER (Rule 37) — disuntik, bukan `new Date()` dibaca di sini, supaya diuji deterministik. */
    sekarang: Date;
  },
): Promise<PdtCommitHasil> {
  const row = await loadClientPlatformUntukPdt(sql, clientPlatformId);
  if (!canUploadBatch(actor, row.assigned_am_id)) throw new ForbiddenError();

  const platform = platformKeVokabPdt(row.platform);
  if (!platform) {
    throw new ValidationError(`[platform toko '${row.platform}' tidak didukung PDT — Tokopedia/Lazada/Blibli tetap manual (PDT-22)]`);
  }

  const overrides = opts.moduleOverrides ?? {};
  const deteksiOlehByNama = new Map<string, 'tanda_tangan' | 'override_am'>();
  const berkasEfektif: PdtPreviewBerkasInput[] = berkas.map((b) => {
    const override = overrides[b.nama];
    if (override == null) {
      deteksiOlehByNama.set(b.nama, 'tanda_tangan');
      return b;
    }
    if (b.aoa == null) {
      throw new ValidationError(`[berkas '${b.nama}' gagal diekstrak/didekode, tidak bisa menimpa modulnya]`);
    }
    const modul = modulPlatform(override);
    if (!modul || modul.platform !== platform) {
      throw new ValidationError(`[modul override '${override}' untuk berkas '${b.nama}' tidak valid untuk platform ini]`);
    }
    deteksiOlehByNama.set(b.nama, 'override_am');
    return { ...b, modulTerdeteksi: override, ambiguous: false, matches: [override] };
  });

  const hasilBerkas: PdtPreviewBerkasHasil[] = [];
  const terparse: BerkasTerparse[] = [];
  for (const b of berkasEfektif) {
    const { hasil, terparse: t } = bangunSatuPreviewBerkas(b);
    hasilBerkas.push(hasil);
    if (t) terparse.push(t);
  }

  const belumTerpilih = hasilBerkas.filter((h) => h.status === 'perlu_pilih_modul');
  if (belumTerpilih.length > 0) {
    throw new ValidationError(`[pilih modul untuk berkas: ${belumTerpilih.map((h) => h.nama).join(', ')}]`);
  }

  const periode = resolvePeriodePreview(platform, terparse);
  if (periode == null) {
    throw new ValidationError('[tidak ada berkas ber-status ok dalam batch ini, periksa kelengkapan unggahan]');
  }
  if (periode.status === 'tolak') {
    throw new ValidationError(periode.pesan);
  }

  const identitas = resolveIdentitasPreview(platform, terparse, row.shop_id, row.akun_konten_toko);

  let identitasSumber: { shop_id: string | null; username: string | null; nama_toko: string | null } | null = null;
  if (platform === 'shopee') {
    const berkasPreamble = terparse.find((b) => MODUL_PREAMBLE_SHOPEE.includes(b.modul.kode));
    if (berkasPreamble) identitasSumber = pdt.bangunIdentitasSumberShopee(pdt.ekstrakPreambleShopee(berkasPreamble.aoa, berkasPreamble.barisHeader));
  }

  let status: PdtCommitStatus;
  let alasanDitolak: string | null = null;
  let reconcileDeltaPct: number | null = null;

  if (identitas.status === 'tolak') {
    status = 'ditolak';
    alasanDitolak = identitas.pesan;
  } else {
    const shopStatsBerkas = platform === 'shopee' ? terparse.find((b) => b.modul.kode === 'shopee_shop_stats') : undefined;
    const parentSkuBerkas = platform === 'shopee' ? terparse.find((b) => b.modul.kode === 'shopee_parent_sku') : undefined;

    if (shopStatsBerkas && parentSkuBerkas) {
      const basisSiapDikirim = pdt.parseShopeeShopStatsPerBasis(shopStatsBerkas.aoa).siap_dikirim;
      if (basisSiapDikirim) {
        const perSkuGmv = pdt.sumShopeeParentSkuGmv(parentSkuBerkas.aoa, 'Penjualan (Pesanan Siap Dikirim) (IDR)', parentSkuBerkas.barisHeader);
        const deltaGmvPct = pdt.hitungDeltaPersen(perSkuGmv, basisSiapDikirim.gmv);
        reconcileDeltaPct = deltaGmvPct; // Rule 14 — tersimpan baik lolos maupun ditolak (sinyal diagnostik, bukan hanya penanda kegagalan).
        if (deltaGmvPct > pdt.AMBANG_REKONSILIASI_PERSEN) {
          alasanDitolak = `[selisih rekonsiliasi GMV ${deltaGmvPct.toFixed(2)}% melebihi ambang ${pdt.AMBANG_REKONSILIASI_PERSEN}% (basis Pesanan Siap Dikirim, Rule 16)]`;
        }
      }
      // basisSiapDikirim tidak ditemukan meski shopee_shop_stats parse_status='ok' — rekonsiliasi
      // DILEWATI (bukan digagalkan): section basis ini bisa hilang di sheet tanpa membuat parse
      // modul itu sendiri gagal (Rule 9 hanya menjaga kolom WAJIB header, bukan tiap section).
    }

    status = alasanDitolak != null ? 'ditolak' : identitas.status === 'usulkan_ikat' && !opts.konfirmasiIkatIdentitas ? 'identitas_belum_terikat' : 'verified';
  }

  const retensi = pdt.hitungRetensiSampai(status === 'ditolak' ? 'ditolak' : 'default', opts.sekarang);

  const batchId = await withTransaction(sql, async (tx) => {
    const rows = await tx<{ id: number }[]>`
      insert into pdt_upload_batch (
        client_id, client_platform_id, platform, periode_mulai, periode_selesai,
        status, reconcile_delta_pct, alasan_ditolak, parser_versi, identitas_sumber,
        raw_sha256, raw_bytes, raw_entri, raw_entri_dilewati, retensi_sampai, retensi_alasan,
        dibuat_oleh
      ) values (
        ${row.client_id}, ${clientPlatformId}, ${platform}, ${periode.mulai}, ${periode.selesai},
        ${status}, ${reconcileDeltaPct}, ${alasanDitolak}, ${pdt.PDT_PARSER_VERSI},
        ${identitasSumber ? JSON.stringify(identitasSumber) : null}::jsonb,
        ${opts.paket.sha256Paket}, ${opts.paket.bytesPaket}, ${opts.paket.entriTotal}, ${opts.paket.entriDilewati},
        ${retensi.sampai}, ${retensi.alasan}, ${actor.employeeId}
      )
      returning id`;
    const batchId = Number(rows[0].id); // bigint identity ⇒ postgres.js decodes as string (pola sama route.test.ts lain)

    for (const h of hasilBerkas) {
      await tx`
        insert into pdt_file (
          batch_id, modul_kode, nama_entri, sha256, bytes, baris_header,
          deteksi_oleh, kolom_dipanen, kolom_baru, parse_status, parse_error
        ) values (
          ${batchId}, ${h.modulKode}, ${h.nama}, ${h.sha256}, ${h.bytes}, ${h.barisHeader},
          ${deteksiOlehByNama.get(h.nama) ?? 'tanda_tangan'}, ${h.kolomDipanen}, ${h.kolomBaru},
          ${keParseStatusDb(h.status)}, ${h.status === 'ok' ? null : h.pesan}
        )`;
    }

    if (identitas.status === 'usulkan_ikat' && opts.konfirmasiIkatIdentitas) {
      if (platform === 'shopee') {
        await tx`update client_platforms set shop_id = ${identitas.usulan}, shop_username = ${identitasSumber?.username ?? null} where id = ${clientPlatformId}`;
      } else {
        // Array JS MENTAH (bukan JSON.stringify manual) — postgres.js men-serialize sendiri ke
        // jsonb saat menemui `::jsonb`; stringify manual + cast akan meng-encode DUA KALI (jadi
        // string tunggal berisi teks JSON, bukan array) — ditemukan lewat tes ini, bukan ditebak.
        await tx`update client_platforms set akun_konten_toko = coalesce(akun_konten_toko, '[]'::jsonb) || ${[identitas.usulan]}::jsonb where id = ${clientPlatformId}`;
      }
    }

    return batchId;
  });

  return { batchId, clientId: row.client_id, clientPlatformId, platform, periodeSelesai: periode.selesai, status, alasanDitolak };
}

/**
 * Dipanggil route SESUDAH `pindahkanPdtRawObjek` (apps/api) berhasil —
 * mengisi `raw_path` dengan path FINAL Rule 44. Terpisah dari INSERT
 * `commitUploadBatch` karena `batch_id` (bagian dari path final) baru ada
 * SESUDAH baris itu di-insert.
 */
export async function tandaiRawTersimpan(sql: Sql, batchId: number, rawPath: string): Promise<void> {
  await sql`update pdt_upload_batch set raw_path = ${rawPath} where id = ${batchId}`;
}

/**
 * Dipanggil route bila `pindahkanPdtRawObjek` GAGAL (kegagalan infra
 * SESUDAH baris batch ada) — Flow A langkah 9: kegagalan di langkah manapun
 * menyisakan batch `ditolak` yang TETAP tersimpan, bukan rollback total.
 * `raw_path` tetap `NULL` (paket masih di path staging — job purge G1-10
 * membaca `retensi_sampai`/`raw_dihapus_pada`, bukan `raw_path`, jadi baris
 * ini tetap kandidat purge yang benar walau `raw_path` kosong). Retensi
 * HANYA diperpanjang (`greatest`, Rule 45 "tidak pernah diperpendek") — batch
 * yang sudah `verified` (120 hari) yang belakangan gagal dipindah TIDAK
 * kehilangan jendela diagnosa yang sudah dijanjikan.
 */
export async function tandaiBatchGagalRaw(sql: Sql, batchId: number, pesan: string, sekarang: Date): Promise<void> {
  const retensi = pdt.hitungRetensiSampai('ditolak', sekarang);
  await sql`
    update pdt_upload_batch
       set status = 'ditolak',
           alasan_ditolak = ${pesan},
           retensi_sampai = greatest(retensi_sampai, ${retensi.sampai}::date),
           retensi_alasan = case when ${retensi.sampai}::date > retensi_sampai then ${retensi.alasan} else retensi_alasan end
     where id = ${batchId}`;
}
