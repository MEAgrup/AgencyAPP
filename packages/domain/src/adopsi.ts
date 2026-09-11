/**
 * Adopsi Sistem (permintaan pemilik 2026-09-10, Bagian 1) — seberapa jauh tim
 * benar-benar memakai CDPS.
 *
 * Permintaan verbatim: *"Dari log page-view, sesi = aktivitas beruntun, gap >
 * 30 menit memulai sesi baru. Kolom: Bulan · Anggota · Role · Jam/Bulan · Sesi
 * · Page View. Plus baris persentase penggunaan fitur untuk role-nya."*
 *
 * Dan satu kalimat pemilik yang membentuk SELURUH modul ini:
 *
 *   > **"Indikator adaptasi tim ke sistem baru — bukan komponen reward."**
 *
 * Itu bukan catatan kaki. Ia memutuskan tiga hal di bawah, dan kalau suatu
 * hari salah satunya dibongkar, kalimat itulah yang harus dibantah lebih dulu:
 *
 *  1. **Tidak ada peringkat, tidak ada skor, tidak ada ambang.** Modul ini
 *     mengembalikan angka mentah dan berhenti. Nol sambungan ke `performance`
 *     (M14), nol kontribusi ke Health/Speed Score, nol notifikasi. Angka yang
 *     mengalir ke penilaian akan mengubah perilaku yang diukurnya, dan yang
 *     diukur di sini justru "apakah sistemnya kepakai".
 *  2. **Gerbangnya OD/Director saja** (lihat `canViewAdopsi`). Jejak pemakaian
 *     per-orang adalah data yang berdekatan dengan HR; membukanya ke atasan
 *     langsung menjadikannya alat pengawasan, yaitu hal yang pemilik katakan
 *     ini bukan.
 *  3. **Jam yang dilaporkan sengaja KURANG, tidak pernah dikarang** (lihat
 *     `SESSION_GAP_MINUTES`).
 *
 * ── TIDAK ADA DATA HISTORIS, dan itu bukan bug ────────────────────────────
 *
 * Sampai migrasi `20261003010000`, repo ini punya **nol telemetri** — tidak ada
 * tabel page-view, tidak ada SDK analytics, tidak ada middleware di `apps/api`.
 * Jadi baris pertama lahir dari tanggal deploy. Contoh `2026-08` pada
 * permintaan pemilik **tidak bisa direproduksi surut**, dan tidak ada cara
 * jujur untuk membuatnya ada. `mulaiTercatat` di bawah mengembalikan tanggal
 * baris paling awal justru supaya layarnya bisa mengatakan itu sendiri,
 * alih-alih membiarkan bulan kosong terbaca sebagai "tidak ada yang memakai".
 *
 * Berkas BARU, bukan tambahan pada `performance.ts` — dan jaraknya disengaja
 * (butir 1 di atas). Catatan: `packages/core/src/bi.ts` adalah **Bahasa
 * Indonesia**, bukan business intelligence; jangan taruh apa pun soal analytics
 * di sana.
 */

import { permission, tz } from '@cdps/core';
import type { Queryable, Sql } from '@cdps/db';

export type Actor = permission.Actor;

const EM_DASH = '—';

/** Pesan BI yang dipakai gerbang modul ini (identik `salesperf`/`admin`). */
export const MSG_FORBIDDEN = '[anda tidak memiliki akses untuk melakukan aksi ini!]';

export class ForbiddenError extends Error {
  constructor(message: string = MSG_FORBIDDEN) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Sesionisasi.
// ---------------------------------------------------------------------------

/**
 * Gap yang memulai sesi baru — **30 menit, angka pemilik**, bukan pilihan kami.
 *
 * ── Kenapa jam yang dilaporkan sengaja KURANG ─────────────────────────────
 *
 * Durasi sesi = (page-view terakhir − page-view pertama) dalam sesi itu. Sesi
 * yang hanya berisi SATU page-view karenanya berdurasi **0**, dan halaman
 * terakhir sesi mana pun menyumbang **nol**.
 *
 * Itu disengaja. Tidak ada satu pun sumber di CDPS yang tahu berapa lama
 * halaman terakhir dibaca — tab bisa ditutup, laptop bisa ditidurkan, orangnya
 * bisa pergi rapat. Mengarang "asumsikan 3 menit per halaman terakhir" akan
 * menghasilkan angka yang lebih enak dibaca dan **tidak bisa dihitung ulang
 * dari log** (aturan rumah #4), lalu angka karangan itu akan dikutip di rapat
 * seolah ia pengukuran.
 *
 * Kekurangannya **seragam** untuk semua orang, jadi ia tidak merusak apa yang
 * pemilik minta: PERBANDINGAN adaptasi antar-anggota dan antar-bulan. Layarnya
 * menyatakan batas ini apa adanya.
 *
 * Kalau suatu hari angka absolutnya harus benar, jalannya adalah heartbeat
 * dari tab yang terbuka (Page Visibility API) — sumber BARU, bukan asumsi baru.
 */
export const SESSION_GAP_MINUTES = 30;

const SESSION_GAP_MS = SESSION_GAP_MINUTES * 60 * 1000;

// ---------------------------------------------------------------------------
// Gerbang.
// ---------------------------------------------------------------------------

/**
 * canViewAdopsi: **OD atau Director saja** — lapisan baca-semua, dan berhenti
 * di situ.
 *
 * Ini interpretasi yang DICATAT (`DECISIONS.md` 2026-09-11), bukan yang
 * pemilik ketok: ia menyebut pembacanya sebagai "indikator adaptasi tim" tanpa
 * menamai peran. Yang dipilih adalah bacaan paling sempit yang tetap memenuhi
 * permintaannya, karena arah sebaliknya tidak simetris: memberi lead akses ke
 * jam pemakaian anak buahnya, lalu mencabutnya kembali, sudah terlambat —
 * datanya sudah dilihat. Melebarkannya nanti adalah perubahan aditif.
 *
 * Sengaja TIDAK memakai `permission.canReadAll` supaya perluasan apa pun pada
 * helper bersama itu tidak diam-diam membuka modul ini.
 */
export function canViewAdopsi(actor: Actor): boolean {
  return actor.role.director || actor.role.od;
}

/**
 * canRecordPageView: setiap aktor karyawan yang terautentikasi mencatat
 * jejaknya SENDIRI.
 *
 * Rute perekamnya tidak pernah menerima `employee_id` dari badan permintaan —
 * ia memakai `actor.employeeId`. Jadi tidak ada bentuk permintaan yang bisa
 * menulis baris atas nama orang lain, dan gerbang ini hanya perlu menolak
 * realm NON-karyawan (vendor LT-61, kontak klien M15-C2): keduanya memakai
 * aplikasi yang berbeda, dan baris mereka akan mencemari roster karyawan
 * dengan id yang bukan karyawan.
 */
export function canRecordPageView(actor: Actor): boolean {
  return !permission.isVendorActor(actor) && !permission.isClientContactActor(actor);
}

// ---------------------------------------------------------------------------
// Perekaman.
// ---------------------------------------------------------------------------

export interface RecordPageViewInput {
  /** Rute yang dibuka, TANPA query string (dibuang pengirim — lihat `normalizePath`). */
  path: string;
  /** Entri menu yang cocok, atau null kalau rutenya memang bukan entri menu. */
  navHref: string | null;
  /** Berapa entri menu yang terlihat peran ini saat itu — penyebut cakupan fitur. */
  navTotal: number;
}

/** Panjang kolom `path`/`nav_href` — dipotong, bukan ditolak (lihat `recordPageView`). */
const PATH_MAX = 255;

/**
 * normalizePath membuang query string dan fragment, lalu memotong ke panjang
 * kolom.
 *
 * Query string DIBUANG, bukan disimpan: ia memuat isi filter — nama klien, id
 * karyawan, kata kunci pencarian — dan log adopsi tidak butuh satu pun dari itu
 * untuk menjawab pertanyaannya. Menyimpannya berarti membangun log pencarian
 * per-orang yang tidak diminta siapa pun, di tabel yang tidak dirancang untuk
 * itu.
 */
export function normalizePath(raw: string): string {
  const noQuery = raw.split('?')[0].split('#')[0];
  const path = noQuery === '' ? '/' : noQuery;
  return path.length > PATH_MAX ? path.slice(0, PATH_MAX) : path;
}

/**
 * recordPageView menulis satu baris. Dipanggil pada SETIAP perpindahan rute,
 * jadi ia sengaja tipis: satu INSERT, nol pembacaan, nol validasi yang bisa
 * melempar.
 *
 * **Ia tidak pernah menolak sebuah rute.** `path` terlalu panjang dipotong,
 * `navTotal` negatif dijepit ke 0. Alasannya bukan kemalasan: rute perekam ini
 * dipanggil dari lapisan shell setiap halaman, dan sebuah 400 di situ akan
 * muncul sebagai galat pada halaman yang sebenarnya baik-baik saja. Log yang
 * memotong satu path panjang masih menjawab pertanyaannya; halaman yang
 * menyalak karena log-nya rewel tidak menjawab apa pun.
 */
export async function recordPageView(sql: Sql, actor: Actor, input: RecordPageViewInput): Promise<void> {
  if (!canRecordPageView(actor)) {
    throw new ForbiddenError();
  }
  const path = normalizePath(input.path);
  const navHref = input.navHref === null ? null : normalizePath(input.navHref);
  const navTotal = Number.isFinite(input.navTotal) ? Math.max(0, Math.trunc(input.navTotal)) : 0;
  await sql`
    insert into page_views (employee_id, path, nav_href, nav_total)
    values (${actor.employeeId}, ${path}, ${navHref}, ${navTotal})`;
}

// ---------------------------------------------------------------------------
// Laporan.
// ---------------------------------------------------------------------------

export interface AdopsiFilter {
  /** "YYYY-MM" inklusif kedua ujungnya, atau null untuk seluruh riwayat. */
  from: string | null;
  to: string | null;
}

export interface AdopsiRow {
  /** "YYYYMM" — bucket bulan WIB, bentuk internal yang sama dengan `tz.period`. */
  period: string;
  employeeId: string;
  nama: string;
  /** Label peran: "Sales · lead". `—` kalau orangnya tidak ada di roster. */
  role: string;
  /** Jam pemakaian, 2 desimal. SENGAJA kurang — lihat `SESSION_GAP_MINUTES`. */
  jam: string;
  sesi: number;
  pageView: number;
  /** Berapa entri menu BERBEDA yang dibuka bulan itu. */
  fiturDibuka: number;
  /** Penyebutnya: entri menu yang boleh dibuka peran itu (maksimum yang pernah dilaporkan bulan itu). */
  fiturTersedia: number;
  /** fiturDibuka ÷ fiturTersedia × 100, dibulatkan. `null` saat penyebut 0 (aturan rumah #7 ⇒ layar render "—"). */
  cakupanFiturPct: number | null;
}

export interface AdopsiReport {
  rows: AdopsiRow[];
  /**
   * Tanggal ("YYYY-MM-DD" WIB) baris page-view paling awal yang ada, atau null
   * kalau belum ada satu pun.
   *
   * Ada supaya layar bisa menyatakan batasnya sendiri: bulan sebelum tanggal
   * ini kosong karena BELUM ADA PENCATATAN, bukan karena tidak ada yang
   * memakai sistem. Tanpa ini, laporan yang benar terbaca seperti tuduhan.
   */
  mulaiTercatat: string | null;
}

/** toYyyymm: "2026-08" dan "202608" sama-sama jadi "202608". */
function toYyyymm(s: string): string {
  return s.replace('-', '');
}

interface RosterEntry {
  nama: string;
  role: string;
}

/**
 * loadRoster membaca `private.employee_roster()` — roster HISTORIS, aktif
 * maupun tidak.
 *
 * Bukan `employee_assignable()`, dan bedanya penting di sini persis seperti di
 * `salesperf.loadRoster`: seseorang yang resign bulan lalu TETAP memakai sistem
 * bulan lalu. Memfilter `status_aktif` akan menghapus pemakaiannya secara surut
 * dan membuat angka bulan tertutup bergerak karena keputusan HR hari ini.
 */
async function loadRoster(sql: Queryable): Promise<Map<string, RosterEntry>> {
  const rows = await sql<{ employee_id: string; nama: string; division: string; level: string }[]>`
    select employee_id, nama, division, level from private.employee_roster()`;
  return new Map(rows.map((r) => [r.employee_id, {
    nama: r.nama,
    role: r.division === '' || r.division === null ? EM_DASH : `${r.division} · ${r.level}`,
  }]));
}

interface Bucket {
  views: Date[];
  hrefs: Set<string>;
  navTotal: number;
}

/**
 * sessionize memecah stempel-stempel waktu satu orang dalam satu bulan menjadi
 * sesi (gap > 30 menit memulai sesi baru) dan menjumlahkan durasinya.
 *
 * Diekspor supaya bisa diuji sebagai fungsi murni: inilah satu-satunya aturan
 * yang pemilik nyatakan secara eksplisit, jadi ia berhak punya tes yang tidak
 * butuh basis data untuk berjalan.
 *
 * `at` TIDAK diasumsikan terurut — pemanggil DB memang mengurutkannya, tapi
 * fungsi yang diam-diam salah kalau inputnya tidak urut adalah jebakan yang
 * menunggu pemanggil kedua.
 */
export function sessionize(at: readonly Date[]): { sessions: number; ms: number } {
  if (at.length === 0) return { sessions: 0, ms: 0 };
  const t = [...at].map((d) => d.getTime()).sort((a, b) => a - b);
  let sessions = 1;
  let ms = 0;
  let start = t[0];
  for (let i = 1; i < t.length; i++) {
    const gap = t[i] - t[i - 1];
    if (gap > SESSION_GAP_MS) {
      ms += t[i - 1] - start;
      sessions += 1;
      start = t[i];
    }
  }
  ms += t[t.length - 1] - start;
  return { sessions, ms };
}

/** jamOf merender milidetik sebagai jam dengan 2 desimal ("3.25"). */
function jamOf(ms: number): string {
  return (ms / 3_600_000).toFixed(2);
}

/**
 * adopsiReport: satu baris per (bulan, anggota) yang punya minimal satu
 * page-view dalam rentang.
 *
 * Orang yang NOL memakai sistem sengaja tidak mendapat baris kosong: baris
 * roster yang serba nol setiap bulan akan menenggelamkan yang punya isi, dan
 * "tidak muncul" sudah menjawab pertanyaannya. Yang tidak boleh ambigu adalah
 * BULAN yang kosong — itulah kenapa `mulaiTercatat` ikut dikembalikan.
 *
 * Diurut bulan terbaru dulu, lalu jam terbanyak — bacaan pertama pemilik
 * adalah "bulan ini bagaimana", bukan "sejak dulu siapa".
 */
export async function adopsiReport(sql: Queryable, actor: Actor, f: AdopsiFilter): Promise<AdopsiReport> {
  if (!canViewAdopsi(actor)) throw new ForbiddenError();

  const rows = await sql<{ employee_id: string; nav_href: string | null; nav_total: number; occurred_at: Date }[]>`
    select employee_id, nav_href, nav_total, occurred_at
      from page_views
     order by employee_id, occurred_at`;

  const roster = await loadRoster(sql);
  const buckets = new Map<string, Bucket>(); // key: employeeId|YYYYMM
  let earliest: Date | null = null;

  for (const r of rows) {
    if (earliest === null || r.occurred_at < earliest) earliest = r.occurred_at;
    const period = tz.period(r.occurred_at);
    if (f.from !== null && period < toYyyymm(f.from)) continue;
    if (f.to !== null && period > toYyyymm(f.to)) continue;
    const key = `${r.employee_id}|${period}`;
    let b = buckets.get(key);
    if (b === undefined) {
      b = { views: [], hrefs: new Set(), navTotal: 0 };
      buckets.set(key, b);
    }
    b.views.push(r.occurred_at);
    if (r.nav_href !== null) b.hrefs.add(r.nav_href);
    // MAKSIMUM, bukan yang terakhir: sebuah menu yang hanya ada separuh bulan
    // tetap menu yang bisa dibuka bulan itu, dan penyebut yang lebih kecil
    // akan menggelembungkan cakupannya.
    if (r.nav_total > b.navTotal) b.navTotal = r.nav_total;
  }

  const out: AdopsiRow[] = [];
  for (const [key, b] of buckets) {
    const sep = key.lastIndexOf('|');
    const employeeId = key.slice(0, sep);
    const period = key.slice(sep + 1);
    const { sessions, ms } = sessionize(b.views);
    const entry = roster.get(employeeId);
    const dibuka = b.hrefs.size;
    out.push({
      period,
      employeeId,
      nama: entry?.nama ?? employeeId,
      role: entry?.role ?? EM_DASH,
      jam: jamOf(ms),
      sesi: sessions,
      pageView: b.views.length,
      fiturDibuka: dibuka,
      fiturTersedia: b.navTotal,
      cakupanFiturPct: b.navTotal === 0 ? null : Math.round((dibuka / b.navTotal) * 100),
    });
  }

  out.sort((a, x) =>
    x.period.localeCompare(a.period)
    || Number(x.jam) - Number(a.jam)
    || a.nama.localeCompare(x.nama));

  return { rows: out, mulaiTercatat: earliest === null ? null : tz.dateString(earliest) };
}
