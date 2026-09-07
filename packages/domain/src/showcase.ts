/**
 * Showcase Klien Terbaik — lapis domain (Gelombang C).
 *
 * DUA HAL YANG MODUL INI JAGA, dan keduanya keputusan pemilik 2026-09-07:
 *
 *  1. **C-1 — divisi Sales dibuka aksesnya ke halaman Showcase.** Ini
 *     **pengecualian PERTAMA** terhadap Role Matrix Fase 0 §4 (*Staff = data
 *     sendiri*), dasar seluruh lapis permission CDPS. Pengecualian pertama
 *     adalah yang paling mahal karena ia jadi preseden, jadi empat pagarnya
 *     ditulis di sini sebagai bagian dari fiturnya — bukan sebagai pekerjaan
 *     menyusul:
 *
 *       (a) **read-only, dan HANYA halaman ini.** Tidak ada satu pun fungsi
 *           tulis di modul ini yang menerima aktor Sales, dan `canReadShowcase`
 *           adalah satu-satunya gerbang di seluruh CDPS yang menyebut Sales
 *           untuk data klien. Ia tidak dipanggil dari mana pun selain rute
 *           Showcase — `showcase.permission.test.ts` memeriksa itu dengan
 *           memindai pemanggilnya, bukan dengan percaya.
 *       (b) **daftarnya hanya klien ber-izin** (C-3). Penyaringan itu ada di
 *           `listShowcase`, bukan di halaman: sebuah halaman yang lupa
 *           menyaring adalah kebocoran, sementara sebuah domain yang menyaring
 *           membuat halaman yang lupa jadi tidak mungkin.
 *       (c) **setiap akses Sales masuk audit log** — supaya "siapa melihat
 *           angka klien mana" bisa dijawab, bukan dikira-kira.
 *       (d) **tes permission menyebut Sales eksplisit** (aturan rumah #6),
 *           supaya pelebaran diam-diam ke halaman lain memerahkan CI.
 *
 *  2. **C-3/C-5 — izin per klien adalah GERBANG, bukan catatan.** Angka klien
 *     boleh masuk materi pitch hanya untuk klien yang izinnya ada. Rumahnya
 *     `client_pitch_consents`, ledger append-only (migrasi `20260916010000`),
 *     dan status hari ini SELALU diturunkan dari baris terakhir — tidak pernah
 *     disimpan sebagai flag yang bisa jadi basi (aturan rumah #4).
 *
 * JALUR BACANYA `db()` + GERBANG DOMAIN, BUKAN `readAsActor`. Sama seperti
 * `baseline-prefill`/`copilot`. Alasannya di sini bahkan lebih keras daripada di
 * sana: aktor Sales TIDAK ADA di policy RLS `client_reports` maupun
 * `client_pitch_consents` — dan itu disengaja (lihat komentar RLS di migrasinya).
 * Membaca lewat `readAsActor` akan memberi Sales daftar kosong tanpa satu pun
 * pesan salah, yaitu bentuk kegagalan yang paling sulit didiagnosa. Gerbangnya
 * karena itu ditegakkan di sini, di TS, dan izinnya yang menyempitkan barisnya.
 */
import { permission, showcase as core } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import { SALES_DIVISION } from './sales';

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5)
// ---------------------------------------------------------------------------
export const MSG_FORBIDDEN = '[anda tidak memiliki akses untuk melakukan aksi ini]';
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
export const MSG_IZIN_SUDAH_ADA = '[izin pitch untuk klien ini sudah aktif]';
export const MSG_IZIN_BELUM_ADA = '[belum ada izin pitch aktif untuk klien ini]';
export const MSG_BERLAKU_LAMPAU = '[masa berlaku izin tidak boleh tanggal yang sudah lewat]';

/** Entity type dipakai di `audit_log` untuk peristiwa modul ini. */
export const AUDIT_ENTITY_IZIN = 'client_pitch_consent';
export const AUDIT_ENTITY_SHOWCASE = 'showcase';

// ---------------------------------------------------------------------------
// Permissions — empat pagar C-1 mulai di sini
// ---------------------------------------------------------------------------
/**
 * canReadShowcase — siapa yang boleh membuka halaman Showcase.
 *
 * ⚠️ **Ini SATU-SATUNYA gerbang di CDPS yang menyebut divisi Sales untuk data
 * klien**, dan ia sengaja berdiri sendiri alih-alih menumpang `canReadReport`.
 * Menumpang akan berarti membuka laporan klien penuh ke Sales — persis yang
 * pagar (a) larang. Sebuah gerbang terpisah membuat pelebaran itu jadi tindakan
 * yang harus DITULIS seseorang, bukan sesuatu yang terjadi karena sebuah fungsi
 * bersama dipakai ulang di tempat kedua.
 */
export function canReadShowcase(actor: Actor): boolean {
  if (permission.canReadAll(actor)) return true; // OD + Director
  if (actor.role.division === ACCOUNT_DIVISION) return true; // AM & lead Account
  if (actor.role.division === SALES_DIVISION) return true; // C-1, keputusan pemilik 2026-09-07
  return false;
}

/**
 * salesOnly — apakah aktor ini melihat Showcase SEBAGAI Sales, yaitu tanpa hak
 * atas data klien mana pun.
 *
 * Dipisah dari `canReadShowcase` karena ia menjawab pertanyaan yang berbeda dan
 * dipakai di dua tempat: menyaring daftar ke klien ber-izin saja, dan menulis
 * baris audit. Seorang Director yang kebetulan juga terpetakan ke divisi Sales
 * BUKAN "Sales" dalam pengertian ini — haknya datang dari peran berlapisnya.
 */
export function melihatSebagaiSales(actor: Actor): boolean {
  if (permission.canReadAll(actor)) return false; // OD/Director melihat dengan haknya sendiri
  return actor.role.division === SALES_DIVISION;
}

/**
 * canKelolaIzinPitch — siapa yang boleh mencentang / mencabut izin (C-5).
 *
 * Keputusan pemilik: **AM pemilik klien yang mencentang** — dia yang berbicara
 * dengan kliennya — **dan Director bisa mencabut kapan saja**. Lingkupnya sama
 * persis dengan `report.canWriteReport`, dan itu disengaja: orang yang boleh
 * menerbitkan angka seorang klien adalah orang yang sama yang boleh memutuskan
 * angka itu boleh dipakai di luar. Dua daftar berbeda untuk satu wewenang yang
 * sama hanya akan menyimpang.
 *
 * Divisi Sales TIDAK di sini — pagar (a): akses mereka read-only.
 */
export function canKelolaIzinPitch(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true; // Director membawa lead di mana pun
  return ownerAm !== null && ownerAm === actor.employeeId;
}

// ---------------------------------------------------------------------------
// Read-model shapes
// ---------------------------------------------------------------------------
/** Satu peristiwa di ledger izin, apa adanya. */
export interface IzinPeristiwa {
  id: number;
  clientId: string;
  aksi: 'beri' | 'cabut';
  berlakuSampai: string | null;
  dokumenCatatan: string | null;
  alasan: string | null;
  createdAt: Date;
  createdBy: string;
}

/** Status izin hari ini — TURUNAN dari ledger, tidak pernah disimpan. */
export interface IzinStatus {
  clientId: string;
  berizin: boolean;
  berlakuSampai: string | null;
  dokumenCatatan: string | null;
  /** Peristiwa terakhir yang menentukan status ini (null = ledger masih kosong). */
  sejak: Date | null;
  olehSiapa: string | null;
  /**
   * `true` bila baris terakhir `beri` tetapi `berlaku_sampai` sudah lewat. Beda
   * dari "tidak pernah ada izin", dan bedanya penting: yang satu perlu
   * diperpanjang, yang satu perlu diminta.
   */
  kedaluwarsa: boolean;
}

/** Apa yang halaman Showcase terima. */
export interface ShowcaseView extends core.ShowcaseHasil {
  /** Apakah pemirsa ini melihat versi yang disaring izin (Sales). */
  disaringIzin: boolean;
  /** Berapa klien yang lolos ambang tapi disembunyikan karena belum berizin. */
  disembunyikanTanpaIzin: number;
  /** Total laporan klien yang ada di sistem — konteks untuk halaman kosong. */
  totalLaporan: number;
  /** Total klien aktif yang ditimbang. */
  totalKlienDitimbang: number;
}

// ---------------------------------------------------------------------------
// Izin — baca
// ---------------------------------------------------------------------------
const IZIN_KOLOM = 'id, client_id, aksi, berlaku_sampai, dokumen_catatan, alasan, created_at, created_by';

function rowToPeristiwa(r: Record<string, unknown>): IzinPeristiwa {
  return {
    id: Number(r.id),
    clientId: String(r.client_id),
    aksi: r.aksi as 'beri' | 'cabut',
    berlakuSampai: r.berlaku_sampai === null ? null : isoDate(r.berlaku_sampai),
    dokumenCatatan: (r.dokumen_catatan as string | null) ?? null,
    alasan: (r.alasan as string | null) ?? null,
    createdAt: r.created_at as Date,
    createdBy: String(r.created_by),
  };
}

/** `date` dari postgres.js datang sebagai `Date`; wire-nya `yyyy-mm-dd`. */
function isoDate(v: unknown): string {
  if (v instanceof Date) {
    // Kolom `date` tidak punya zona waktu. `toISOString()` menggesernya ke UTC
    // dan bisa memundurkan tanggal satu hari — bug diam yang membuat izin
    // tampak kedaluwarsa sehari lebih awal. Dibaca dari komponen lokalnya.
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v);
}

/**
 * statusIzinDariPeristiwa — aturan turunannya, dipisah supaya bisa diuji tanpa
 * DB dan dipakai ulang oleh `listShowcase` yang membaca banyak klien sekaligus.
 *
 * `hariIni` diteruskan, tidak diambil dari `new Date()` di dalam: sebuah aturan
 * kedaluwarsa yang membaca jam dinding sendiri adalah aturan yang tidak bisa
 * diuji di batasnya.
 */
export function statusIzinDariPeristiwa(
  clientId: string,
  terakhir: IzinPeristiwa | null,
  hariIni: string,
): IzinStatus {
  if (terakhir === null || terakhir.aksi === 'cabut') {
    return {
      clientId,
      berizin: false,
      berlakuSampai: null,
      dokumenCatatan: null,
      sejak: terakhir?.createdAt ?? null,
      olehSiapa: terakhir?.createdBy ?? null,
      kedaluwarsa: false,
    };
  }
  const kedaluwarsa = terakhir.berlakuSampai !== null && terakhir.berlakuSampai < hariIni;
  return {
    clientId,
    berizin: !kedaluwarsa,
    berlakuSampai: terakhir.berlakuSampai,
    dokumenCatatan: terakhir.dokumenCatatan,
    sejak: terakhir.createdAt,
    olehSiapa: terakhir.createdBy,
    kedaluwarsa,
  };
}

async function ownerAmOfClient(sql: Queryable, clientId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  return rows[0].assigned_am_id;
}

/** Baris ledger terakhir per klien — bentuk kueri yang SETIAP pembaca pakai. */
async function peristiwaTerakhir(sql: Queryable, clientId: string): Promise<IzinPeristiwa | null> {
  const rows = await sql<Record<string, unknown>[]>`
    select id, client_id, aksi, berlaku_sampai, dokumen_catatan, alasan, created_at, created_by
      from client_pitch_consents
     where client_id = ${clientId}
     order by id desc
     limit 1`;
  return rows.length === 0 ? null : rowToPeristiwa(rows[0]);
}

/** Tanggal hari ini di zona kerja MEA, sebagai `yyyy-mm-dd`. */
function hariIniJakarta(now: Date = new Date()): string {
  // `sv-SE` menghasilkan `yyyy-mm-dd` apa adanya — bentuk yang sama dengan
  // kolom `date` postgres, jadi perbandingan string di atas sah.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(now);
}

/** statusIzin — status izin satu klien hari ini, scope-gated. */
export async function statusIzin(sql: Queryable, actor: Actor, clientId: string): Promise<IzinStatus> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  // Baca izin mengikuti scope baca laporan: siapa yang boleh melihat angkanya
  // boleh melihat apakah angka itu boleh dipakai.
  if (!permission.canReadAll(actor) && !permission.isLead(actor, ACCOUNT_DIVISION) && ownerAm !== actor.employeeId) {
    throw new ForbiddenError(MSG_FORBIDDEN);
  }
  return statusIzinDariPeristiwa(clientId, await peristiwaTerakhir(sql, clientId), hariIniJakarta());
}

/** riwayatIzin — seluruh ledger satu klien, terbaru dulu. Scope sama dengan `statusIzin`. */
export async function riwayatIzin(sql: Queryable, actor: Actor, clientId: string): Promise<IzinPeristiwa[]> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  if (!permission.canReadAll(actor) && !permission.isLead(actor, ACCOUNT_DIVISION) && ownerAm !== actor.employeeId) {
    throw new ForbiddenError(MSG_FORBIDDEN);
  }
  const rows = await sql<Record<string, unknown>[]>`
    select id, client_id, aksi, berlaku_sampai, dokumen_catatan, alasan, created_at, created_by
      from client_pitch_consents
     where client_id = ${clientId}
     order by id desc`;
  return rows.map(rowToPeristiwa);
}

// ---------------------------------------------------------------------------
// Izin — tulis. Dua fungsi, dua peristiwa, NOL update.
// ---------------------------------------------------------------------------
export interface BeriIzinInput {
  /** `null` = tanpa batas waktu. */
  berlakuSampai?: string | null;
  /** Rujukan bukti izin (nomor PKS, subjek email, tanggal percakapan). */
  dokumenCatatan?: string | null;
}

/**
 * beriIzinPitch — mencatat bahwa klien mengizinkan angkanya dipakai di materi
 * pitch. Sebuah INSERT, tidak pernah sebuah UPDATE (aturan rumah #3).
 *
 * Menolak kalau izin sudah aktif: dua baris `beri` berturut-turut membuat
 * "sejak kapan izinnya berlaku" jadi pertanyaan dengan dua jawaban. Yang ingin
 * memperpanjang masa berlaku mencabut lalu memberi lagi — dan riwayatnya
 * menunjukkan persis itu terjadi.
 */
export async function beriIzinPitch(
  sql: Sql,
  actor: Actor,
  clientId: string,
  input: BeriIzinInput = {},
): Promise<IzinStatus> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  if (!canKelolaIzinPitch(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

  const hariIni = hariIniJakarta();
  const berlakuSampai = (input.berlakuSampai ?? null) || null;
  if (berlakuSampai !== null && berlakuSampai < hariIni) {
    throw new ValidationError(MSG_BERLAKU_LAMPAU);
  }
  const sebelum = statusIzinDariPeristiwa(clientId, await peristiwaTerakhir(sql, clientId), hariIni);
  if (sebelum.berizin) throw new ValidationError(MSG_IZIN_SUDAH_ADA);

  const dokumen = (input.dokumenCatatan ?? null)?.trim() || null;

  return withTransaction(sql, async (tx) => {
    const ins = await tx<Record<string, unknown>[]>`
      insert into client_pitch_consents (client_id, aksi, berlaku_sampai, dokumen_catatan, created_by)
      values (${clientId}, 'beri', ${berlakuSampai}, ${dokumen}, ${actor.employeeId})
      returning ${tx.unsafe(IZIN_KOLOM)}`;
    const baris = rowToPeristiwa(ins[0]);
    await executors(tx).audit.insertAudit({
      entityType: AUDIT_ENTITY_IZIN,
      entityId: clientId,
      actorEmployeeId: actor.employeeId,
      action: 'izin_pitch_diberikan',
      beforeJson: { berizin: sebelum.berizin, kedaluwarsa: sebelum.kedaluwarsa },
      afterJson: { berizin: true, berlaku_sampai: berlakuSampai, dokumen_catatan: dokumen, consent_id: baris.id },
      createdBy: actor.employeeId,
    });
    return statusIzinDariPeristiwa(clientId, baris, hariIni);
  });
}

/**
 * cabutIzinPitch — menarik izin. INSERT baris `cabut`, bukan menghapus baris
 * `beri`: fakta bahwa izin pernah ada adalah justru yang perlu bertahan saat
 * ada yang mempersoalkan sebuah materi pitch lama.
 *
 * Boleh dijalankan atas izin yang sudah KEDALUWARSA. Terlihat mubazir, tapi
 * bukan: mencabut secara eksplisit menyatakan "klien menarik izinnya", yang
 * berbeda dari "masa berlakunya habis dan tak ada yang memperpanjang". Yang
 * ditolak hanya mencabut saat ledger-nya belum pernah berisi `beri` sama sekali
 * — di situ tidak ada apa pun untuk dicabut.
 */
export async function cabutIzinPitch(
  sql: Sql,
  actor: Actor,
  clientId: string,
  alasan?: string | null,
): Promise<IzinStatus> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  if (!canKelolaIzinPitch(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

  const hariIni = hariIniJakarta();
  const terakhir = await peristiwaTerakhir(sql, clientId);
  if (terakhir === null || terakhir.aksi === 'cabut') throw new ValidationError(MSG_IZIN_BELUM_ADA);
  const sebelum = statusIzinDariPeristiwa(clientId, terakhir, hariIni);

  const teks = (alasan ?? null)?.trim() || null;

  return withTransaction(sql, async (tx) => {
    const ins = await tx<Record<string, unknown>[]>`
      insert into client_pitch_consents (client_id, aksi, alasan, created_by)
      values (${clientId}, 'cabut', ${teks}, ${actor.employeeId})
      returning ${tx.unsafe(IZIN_KOLOM)}`;
    const baris = rowToPeristiwa(ins[0]);
    await executors(tx).audit.insertAudit({
      entityType: AUDIT_ENTITY_IZIN,
      entityId: clientId,
      actorEmployeeId: actor.employeeId,
      action: 'izin_pitch_dicabut',
      beforeJson: { berizin: sebelum.berizin, berlaku_sampai: sebelum.berlakuSampai, kedaluwarsa: sebelum.kedaluwarsa },
      afterJson: { berizin: false, alasan: teks, consent_id: baris.id },
      createdBy: actor.employeeId,
    });
    return statusIzinDariPeristiwa(clientId, baris, hariIni);
  });
}

// ---------------------------------------------------------------------------
// Showcase — daftar
// ---------------------------------------------------------------------------
/**
 * listShowcase — daftar klien terbaik untuk pemirsa ini.
 *
 * Satu kueri untuk laporan, satu untuk izin, lalu `@cdps/core` yang memutuskan.
 * Pemisahan itu bukan gaya: aturan "siapa klien terbaik" harus bisa diuji tanpa
 * database, dan penyaringan izin harus bisa diuji DENGAN database — dua hal
 * yang gagal dengan cara berbeda.
 *
 * **Pagar (b) dan (c) C-1 ada di sini.** Aktor Sales menerima daftar yang sudah
 * disaring ke klien ber-izin saja, dan setiap kali ia membuka halaman ini satu
 * baris audit ditulis — memuat klien mana yang ia lihat, bukan sekadar bahwa ia
 * membuka halamannya. "Siapa melihat angka klien mana" adalah pertanyaan yang
 * pemilik sebut sendiri, dan ia tidak terjawab oleh baris audit yang hanya
 * berbunyi "Sales membuka Showcase".
 */
export async function listShowcase(sql: Sql, actor: Actor): Promise<ShowcaseView> {
  if (!canReadShowcase(actor)) throw new ForbiddenError(MSG_FORBIDDEN);

  const hariIni = hariIniJakarta();

  // Klien + laporannya. Klien tanpa laporan IKUT terbawa (left join) — mereka
  // adalah baris "belum ada laporan klien sama sekali" yang halaman tampilkan,
  // dan menghilangkannya dengan inner join akan membuat halaman kosong
  // kehilangan justru penjelasan yang C-2 tuntut.
  const rows = await sql<Record<string, unknown>[]>`
    select c.id            as client_id,
           c.toko          as toko,
           c.kategori      as kategori,
           r.id            as report_id,
           r.periode_mulai as periode_mulai,
           r.periode_akhir as periode_akhir,
           r.periode_tipe  as periode_tipe,
           r.platform      as platform,
           r.skor          as skor,
           r.skor_label    as skor_label,
           r.gmv_runrate_bulanan as gmv_runrate_bulanan
      from clients c
      left join client_reports r on r.client_id = c.id
     order by c.id, r.periode_akhir, r.id`;

  const izinRows = await sql<Record<string, unknown>[]>`
    select distinct on (client_id) ${sql.unsafe(IZIN_KOLOM)}
      from client_pitch_consents
     order by client_id, id desc`;
  const izinPerKlien = new Map<string, IzinStatus>();
  for (const r of izinRows) {
    const p = rowToPeristiwa(r);
    izinPerKlien.set(p.clientId, statusIzinDariPeristiwa(p.clientId, p, hariIni));
  }

  const perKlien = new Map<string, core.KlienLaporan>();
  let totalLaporan = 0;
  for (const r of rows) {
    const clientId = String(r.client_id);
    let k = perKlien.get(clientId);
    if (k === undefined) {
      k = {
        clientId,
        toko: String(r.toko ?? ''),
        kategori: (r.kategori as string | null) ?? null,
        berizin: izinPerKlien.get(clientId)?.berizin ?? false,
        laporan: [],
      };
      perKlien.set(clientId, k);
    }
    if (r.report_id === null) continue; // klien tanpa laporan — barisnya dari left join
    totalLaporan += 1;
    (k.laporan as core.LaporanRingkas[]).push({
      id: Number(r.report_id),
      periodeMulai: isoDate(r.periode_mulai),
      periodeAkhir: isoDate(r.periode_akhir),
      periodeTipe: String(r.periode_tipe),
      platform: String(r.platform),
      // `numeric` datang sebagai string dari postgres.js. `null` HARUS tetap
      // null — laporan tanpa skor bukan laporan ber-skor nol (mesin core
      // membedakannya, dan itulah selisih "isi laporannya" vs "kliennya buruk").
      skor: r.skor === null ? null : Number(r.skor),
      skorLabel: (r.skor_label as string | null) ?? null,
      gmvRunrateBulanan: Number(r.gmv_runrate_bulanan ?? 0),
    });
  }

  const hasil = core.pilihKlienShowcase([...perKlien.values()]);
  const sebagaiSales = melihatSebagaiSales(actor);

  const terlihat = sebagaiSales ? hasil.klien.filter((k) => k.berizin) : hasil.klien;
  const disembunyikan = hasil.klien.length - terlihat.length;

  if (sebagaiSales) {
    // Pagar (c). Ditulis SESUDAH daftarnya diketahui supaya barisnya memuat
    // klien mana yang benar-benar terlihat.
    await withTransaction(sql, async (tx) => {
      await executors(tx).audit.insertAudit({
        entityType: AUDIT_ENTITY_SHOWCASE,
        entityId: 'showcase',
        actorEmployeeId: actor.employeeId,
        action: 'showcase_dibuka_sales',
        beforeJson: null,
        afterJson: {
          divisi: actor.role.division,
          klien_terlihat: terlihat.map((k) => k.clientId),
          jumlah_terlihat: terlihat.length,
          disembunyikan_tanpa_izin: disembunyikan,
        },
        createdBy: actor.employeeId,
      });
    });
  }

  return {
    ...hasil,
    klien: terlihat,
    // Sales tidak melihat daftar tersisih: itu daftar klien yang performanya
    // belum cukup, dan ia bukan bagian dari "halaman Showcase" yang C-1 buka.
    // Yang Sales lihat saat kosong adalah ambang + jumlahnya, bukan namanya.
    tersisih: sebagaiSales ? [] : hasil.tersisih,
    disaringIzin: sebagaiSales,
    disembunyikanTanpaIzin: disembunyikan,
    totalLaporan,
    totalKlienDitimbang: perKlien.size,
  };
}

// ---------------------------------------------------------------------------
// Materi pitch — dokumen yang meninggalkan gedung
// ---------------------------------------------------------------------------
/** Hasil export: dokumen + nama berkasnya + berapa yang tersaring izin. */
export interface MateriPitch {
  html: string;
  namaBerkas: string;
  jumlahKlien: number;
  /** Berapa klien lolos ambang tapi TIDAK masuk dokumen karena belum berizin. */
  disembunyikanTanpaIzin: number;
}

/**
 * materiPitch — dokumen HTML mandiri berisi klien terbaik yang BER-IZIN.
 *
 * ⚠️ **Penyaringan izin di sini TIDAK bergantung pada siapa yang meng-export.**
 * `listShowcase` punya dua pandangan (Account melihat klien belum-berizin supaya
 * tahu izin mana yang perlu diminta; Sales tidak). Dokumen ini punya SATU:
 * hanya klien ber-izin, termasuk saat Director yang menekan tombolnya.
 *
 * Alasannya bukan kerapian melainkan sifat berkasnya. Sebuah halaman bisa
 * ditutup; sebuah berkas yang sudah terkirim ke calon klien tidak bisa ditarik
 * kembali. Jadi gerbang C-3 di jalur ini berlaku mutlak — dan `berizin` yang
 * setiap baris bawa dipakai untuk menyaring, bukan sekadar ditampilkan.
 */
export async function materiPitch(sql: Sql, actor: Actor): Promise<MateriPitch> {
  const view = await listShowcase(sql, actor);
  const berizin = view.klien.filter((k) => k.berizin);
  const html = core.renderPitchDoc(berizin, {
    dibuatOleh: actor.nama?.trim() || actor.employeeId,
    dibuatPada: hariIniJakarta(),
  });
  return {
    html,
    namaBerkas: `Showcase-Klien-Terbaik-MEA-${hariIniJakarta()}.html`,
    jumlahKlien: berizin.length,
    // Untuk pemirsa Sales, `listShowcase` sudah menyaring, jadi selisihnya nol
    // dan angka yang benar datang dari `view`. Untuk Account/Director, selisih
    // itu dihitung di sini — dan keduanya menjawab pertanyaan yang sama:
    // berapa klien layak yang tidak boleh dikirim karena izinnya belum ada.
    disembunyikanTanpaIzin: view.disaringIzin
      ? view.disembunyikanTanpaIzin
      : view.klien.length - berizin.length,
  };
}
