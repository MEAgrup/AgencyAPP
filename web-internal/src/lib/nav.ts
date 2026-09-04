/**
 * Sidebar navigation model + per-division visibility gates.
 *
 * Framework-free on purpose: `Sidebar.tsx` only renders what `visibleNav()`
 * returns, so the gate table is unit-testable per role (CLAUDE.md DoD
 * "permission tests per role").
 *
 * ## The gating rule
 *
 * A nav item is hidden ONLY when the server would deny that role outright. Two
 * failure modes are not symmetric:
 *
 * - hiding something reachable = a silent functional regression;
 * - showing something unreachable = mild noise the user sees and understands.
 *
 * So every gate below cites the server-side gate it mirrors, and anything whose
 * visibility is merely ROW-scoped (RLS) stays visible — an empty list is honest,
 * and a second copy of a row predicate in the UI could only drift from RLS.
 *
 * **The server remains the final authority.** This table trims the menu; it is
 * never the access check. Deep links keep working for roles that legitimately
 * reach a record through a notification (e.g. the SPV Account who must vote on a
 * `[Bermasalah]` transaction, M5-OA-5, without owning the Finance queue).
 */
import { EMBEDDED_TOOLS } from './embedded-tools';
import { canUseSkuScreener } from './skuscreener';
import { canUseAdsScanner } from './adsscanner';
import type { Role } from './types';

export interface NavItem {
  href: string;
  label: string;
  /**
   * Visibility gate. Absent = always visible (universal item, or a page whose
   * scope is row-level only). Each gate embeds its own OD/Director allowance
   * rather than relying on a blanket bypass, so items that are deliberately
   * NOT read-everywhere (Portal Tim) keep their exact current behaviour.
   */
  access?: (role: Role) => boolean;
}

/**
 * Sub-grup: satu tingkat lipatan DI DALAM sebuah seksi (Sidebar IA v3 §5.2 —
 * "max depth 2"). Hanya `Papan Divisi` yang memakainya, dan itu batasnya:
 * sub-grup tidak boleh memuat sub-grup lagi, karena `NavSubGroup.items` sengaja
 * bertipe `NavItem[]`, bukan `NavNode[]`. Kedalaman dibatasi oleh TIPE-nya, tak
 * perlu dijaga lewat konvensi.
 */
export interface NavSubGroup {
  label: string;
  items: NavItem[];
}

/** Isi sebuah seksi: sebuah tautan, atau satu sub-grup yang bisa dilipat. */
export type NavNode = NavItem | NavSubGroup;

export interface NavSection {
  /** Judul seksi. Sejak IA v3 setiap seksi berjudul — tak ada lagi blok tanpa judul. */
  title: string;
  items: NavNode[];
}

// ---------------------------------------------------------------------------
// Division helpers
// ---------------------------------------------------------------------------

/** The canonical CDPS divisions (packages/domain: `*_DIVISION` constants). */
const SALES = 'Sales';
const MARKETING = 'Marketing';
const FINANCE = 'Finance';
const ACCOUNT = 'Account';
const CREATIVE = 'Creative';
const ADS = 'Ads';
const KOL = 'KOL';
const LIVE_STREAM = 'Live Stream';
// M16/M17 (DECISIONS.md 2026-08-28/2026-09-01): two later divisions, registered
// in `division_registry` / `packages/core/src/division.ts`. Neither has a
// bespoke board page yet (no /ai-optimizer or /store-ops, unlike the four
// above) — both reach their Brief queue through /tasks (division mode),
// mirroring how Account/Ops already work without a dedicated board.
const AI_OPTIMIZER = 'AI Optimizer';
const STORE_OPS = 'Store Operation';

/**
 * Case-insensitive division match. `/me` returns canonical capitalized
 * divisions, but the existing per-page gates (`marketing/page.tsx`,
 * `kol/page.tsx`) lowercase both sides because some HRIS role mappings arrive
 * lowercased — mirror that tolerance here rather than trusting the casing.
 */
function inDivision(role: Role, ...names: string[]): boolean {
  const d = (role.division ?? '').toLowerCase();
  return names.some((n) => n.toLowerCase() === d);
}

/** canReadAll — cross-division read (packages/core permission.canReadAll). */
function canReadAll(role: Role): boolean {
  return Boolean(role.director || role.od);
}

/** isLead — lead/SPV level of one division (packages/core permission.isLead). */
function isLead(role: Role, division: string): boolean {
  return role.level === 'lead' && inDivision(role, division);
}

/**
 * A workspace owned by one or more divisions: OD/Director (read everywhere)
 * plus any level of the owning divisions.
 */
function ownedBy(...divisions: string[]): (role: Role) => boolean {
  return (role) => canReadAll(role) || inDivision(role, ...divisions);
}

/**
 * A delivery workspace whose landing view is the division Brief queue.
 * Mirrors `account.listDivisionQueue` exactly: OD/Director, Account **lead**
 * (dispatch monitoring — decision Nerissa 2026-07-12), or staff/lead of that
 * division. An individual AM (Account staff) is denied there, so the menu is
 * hidden from them too.
 */
function divisionQueue(division: string): (role: Role) => boolean {
  return (role) => canReadAll(role) || isLead(role, ACCOUNT) || inDivision(role, division);
}

// ---------------------------------------------------------------------------
// The table. Every gate names the server gate it mirrors; every UNGATED item
// says why it is universal, so the next reader never has to re-derive it.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// BERANDA — apa yang dilihat setiap orang begitu masuk.
// ---------------------------------------------------------------------------
const BERANDA: NavNode[] = [
  // Universal: dashboard sendiri.
  // `/demo-tasks` (M12 demo harness) sengaja di luar menu (permintaan pemilik,
  // Nerissa, 2026-09-02) — halaman & API-nya tetap bisa dibuka lewat link.
  { href: '/', label: 'Dashboard' },
  // M15-C1 Rule 9 — landing pribadi: task terbuka saya (urut risiko SLA) + skor
  // performa bulan berjalan. Scope: diri sendiri, jadi universal.
  { href: '/portal', label: 'Kinerja Saya' },
  // M11 My Tasks — pandangan kerja lintas-Klien (§10: "Staff lihat punya
  // sendiri"). Universal: tiap divisi punya task-nya sendiri. BEDA dari kartu
  // task di "Kinerja Saya": di sini ada filter divisi dan "Lihat Tugas Staff
  // Lain" untuk atasan (keputusan pemilik 2026-09-04 — IA v3 §4 mengira
  // keduanya duplikat; kodenya membuktikan tidak).
  { href: '/board/my-tasks', label: 'Tugas Saya' },
  // "Perlu Persetujuan Saya" — setiap antrean persetujuan digabung: Sales
  // negotiation, Renewal/Cross-Sell, Finance TCR, Lead Delete, Hold Service,
  // M12 Block, KOL escalation, Strategi review (keputusan pemilik 2026-08-31).
  // Tiap seksi adalah read yang sudah ter-scope sendiri (RLS atau `canApprove*`)
  // — menu ini tampil untuk tiap divisi yang punya minimal satu antrean;
  // halaman kosong untuk yang lain adalah jawaban jujur, sikap yang sama dengan
  // `/leads/delete-requests` (catatan kepala berkas ini).
  { href: '/persetujuan', label: 'Persetujuan', access: ownedBy(SALES, ACCOUNT, FINANCE, KOL) },
];

// ---------------------------------------------------------------------------
// AKUISISI — Wave 1 stream A (M0 Sales + M1 Leads) + Wave 3 (M2, M3)
// ---------------------------------------------------------------------------
const AKUISISI: NavNode[] = [
  // Gerbang server keras: `leads.canReadPool` (Sales level apa pun) +
  // `leads.leadListScope` (Marketing level apa pun, Sales lead). Divisi lain
  // dapat 403, bukan daftar kosong. Apakah Sales STAFF juga boleh menjangkau
  // Database (M1 §9.1 "sees own attempts only") adalah DECISIONS **O40** —
  // terbuka, sengaja tidak diputuskan di sini; Pool sendiri sudah cukup jadi
  // alasan menu ini untuk Sales.
  { href: '/leads', label: 'Leads', access: ownedBy(SALES, MARKETING) },
  // M0 §9: workspace attempt adalah milik Sales.
  { href: '/sales', label: 'Sales Workspace', access: ownedBy(SALES) },
  // Mirror gerbang yang sudah ada di dalam marketing/page.tsx.
  { href: '/marketing', label: 'Campaign Marketing', access: ownedBy(MARKETING) },
  // Kinerja Sales (M0 §7.1): dashboard closing rate/deal cycle/OKR. `ownedBy`
  // sudah mencakup OD/Director; scope per-baris (staff = sendiri, lead/SPV =
  // divisi) tugas `salesperf.scopeFor`, bukan tugas menu.
  { href: '/sales/kinerja', label: 'Kinerja Sales', access: ownedBy(SALES) },
  { href: '/marketing/performance', label: 'Performa Marketing', access: ownedBy(MARKETING) },
];

// ---------------------------------------------------------------------------
// KATALOG & PENAWARAN
// ---------------------------------------------------------------------------
const KATALOG: NavNode[] = [
  // Baca MSL terbuka untuk aktor terautentikasi mana pun; hanya menyunting yang
  // bergerbang (`msl.canEditMasterServices`).
  { href: '/master-services', label: 'Master Service List' },
  // Alat closing M0 (pratinjau penawaran memberi makan form Closing).
  // Milik Sales per PERMISSIONS.md "M0 Sales".
  { href: '/sales/kalkulator', label: 'Kalkulator Penawaran', access: ownedBy(SALES) },
];

// ---------------------------------------------------------------------------
// KLIEN
// ---------------------------------------------------------------------------
const KLIEN: NavNode[] = [
  // Wave 1 — stream B (M4/M5). M4: Sales PIC + anggota alokasi, AM yang
  // ditugaskan (Account), dan PIC Komisi/Pembayaran (Finance). Barisnya sendiri
  // ter-scope RLS (`clients_select`).
  { href: '/clients', label: 'Direktori Klien', access: ownedBy(SALES, ACCOUNT, FINANCE) },
  // M15-C1 Rule 11 — semua klien × Client Health terakhir (band, tren, komponen
  // penarik, AM). Read-only, urut At Risk dulu. Sengaja BUKAN read-everywhere
  // biasa: gerbangnya persis seperti yang dikirim `portal.go`.
  {
    href: '/portal/management',
    label: 'Pantauan Risiko Klien',
    access: (role) => Boolean(role.director || role.od),
  },
  // M13 `health.canScope`: Account (level apa pun) + OD/Director. BEDA dari
  // "Pantauan Risiko Klien" di atas: halaman ini punya aksi **Pemindaian Skor**
  // (trigger scan M13), bukan sekadar membaca snapshot (keputusan pemilik
  // 2026-09-04 — keduanya dipertahankan).
  { href: '/health', label: 'Client Health', access: ownedBy(ACCOUNT) },
];

// ---------------------------------------------------------------------------
// DELIVERY — Wave 2 (M6, M12, M7, M8, M9, M10) + alat divisi Ads
// ---------------------------------------------------------------------------

/**
 * Papan Divisi — sub-grup (kedalaman 2, satu-satunya di menu ini).
 *
 * IA v3 §5.6 "auto-scope": eksekutor kanal hanya melihat papan divisinya
 * sendiri, sementara AM/Head/Direktur melihat ketujuhnya. Itu **bukan aturan
 * baru** — ia jatuh langsung dari `divisionQueue` yang sudah mencerminkan
 * `account.listDivisionQueue`; yang v3 tambahkan hanyalah membungkusnya jadi
 * satu sub-grup yang bisa dilipat. Keanggotaan divisi datang dari Role Mapping
 * (`role.division`), tidak pernah dari daftar hardcoded.
 */
const PAPAN_DIVISI: NavSubGroup[] = [
  {
    label: 'Papan Divisi',
    items: [
      // M6: workspace AM. Account staff masuk lewat Strategi mereka sendiri
      // (`account.listStrategies` punya arm AM), Account lead lewat antrean
      // Intake yang belum ditugaskan (`account.canReadIntake`).
      { href: '/account', label: 'Account & Service', access: ownedBy(ACCOUNT) },
      // AI Optimizer / Store Operation (M16/M17, DECISIONS.md 2026-09-01):
      // gerbang baca yang sama dengan empat papan di bawah, tapi belum punya
      // halaman papan sendiri — keduanya mendarat di antrean Task Execution
      // generik, sudah terfilter lewat `?division=`. Tukar href-nya kalau
      // halaman khusus dibangun.
      { href: '/tasks?division=AI+Optimizer', label: 'AI Optimizer', access: divisionQueue(AI_OPTIMIZER) },
      // Empat papan antrean Brief yang punya halaman sendiri — lihat divisionQueue().
      { href: '/ads', label: 'Ads', access: divisionQueue(ADS) },
      { href: '/creative', label: 'Creative', access: divisionQueue(CREATIVE) },
      { href: '/kol', label: 'KOL', access: divisionQueue(KOL) },
      { href: '/livestream', label: 'Live Stream', access: divisionQueue(LIVE_STREAM) },
      { href: '/tasks?division=Store+Operation', label: 'Store Operation', access: divisionQueue(STORE_OPS) },
    ],
  },
];

const DELIVERY: NavNode[] = [
  // M12: `/my-tasks` ber-scope diri sendiri, dan Task PIC adalah staff divisi
  // eksekusi (`account.ALLOWED_DIVISIONS` = `division.kuotaSatuanNames()`, yang
  // bertambah AI Optimizer di M17); AM melihat task klien yang ia pegang
  // (`task.canViewTask`, yang tidak punya allowlist divisi sama sekali).
  // Store Operation belum punya katalog kuota task (LT-2 terbuka) tapi Brief-nya
  // tetap mengalir lewat mesin brief_task yang sama dan antreannya sudah
  // terjangkau di sini (`DIVISI_KERJA`, lib/divisions.ts) — disertakan dengan
  // alasan "menyembunyikan yang terjangkau = regresi" yang sama.
  // Sales/Marketing/Finance tidak pernah jadi pemilik task.
  {
    href: '/tasks',
    label: 'Task Execution',
    access: ownedBy(ACCOUNT, CREATIVE, ADS, KOL, LIVE_STREAM, AI_OPTIMIZER, STORE_OPS),
  },
  // M6D Rekap Hasil Mingguan: worklist mingguan AM. Bisa dibaca Account (level
  // apa pun) + OD/Director (`recap.canReadRecap`). Lead divisi eksekusi yang
  // menyentuh klien minggu itu juga menjangkau rekapnya (arm baca lead-divisi
  // RLS D-09 + RM-D6 `canWriteDivisiNote`) supaya bisa mengisi catatan divisinya
  // tanpa menunggu deep-link notifikasi. Scope baris tetap urusan server.
  {
    href: '/account/rekap',
    label: 'Rekap Mingguan',
    access: (role) =>
      ownedBy(ACCOUNT)(role) ||
      isLead(role, CREATIVE) ||
      isLead(role, ADS) ||
      isLead(role, KOL) ||
      isLead(role, LIVE_STREAM) ||
      // AI Optimizer bergabung ke mesin catatan-divisi RM-D6 di M17
      // (CHECK `wrr_divisi`/`wrr_catatan_divisi`, migrasi 20260831060000).
      // Store Operation TETAP di luar CHECK itu (belum ada kuota task, LT-2
      // masih terbuka) jadi ia tidak dapat gerbang ini.
      isLead(role, AI_OPTIMIZER),
  },
  ...PAPAN_DIVISI,
  // Gelombang 3 & 4 — dua alat kerja divisi Ads. IA v3 (3 Sep) ditulis sebelum
  // keduanya mendarat, jadi §2-nya tidak memuatnya; mereka tinggal di sini,
  // BUKAN di grup "MEA AI Tools", karena keduanya halaman React ber-API dan
  // ber-RLS milik divisi Ads — bukan HTML yang di-embed (DECISIONS.md
  // 2026-09-04). Mereka juga BUKAN antrean Brief, jadi tidak memakai
  // divisionQueue() (yang mengizinkan Account lead masuk untuk memantau
  // dispatch): gerbangnya `canUseSkuScreener`/`canUseAdsScanner`, predikat yang
  // SAMA yang dipakai halamannya sendiri. Satu predikat, tanpa drift.
  //
  // Dua baris terpisah dengan sengaja: keduanya menjawab pertanyaan berbeda di
  // titik funnel yang berbeda (SKU mana yang layak diiklankan sama sekali vs
  // bagaimana performa budget yang sudah dibelanjakan minggu ini), membaca
  // export yang berbeda, dan menyimpan ke tabel yang berbeda.
  { href: '/ads/screening', label: 'Screening SKU', access: canUseSkuScreener },
  { href: '/ads/scanner', label: 'Ads Scanner', access: canUseAdsScanner },
];

// ---------------------------------------------------------------------------
// MEA AI TOOLS — daftar alat bantu HTML self-contained yang di-embed via iframe
// (`@/lib/embedded-tools` + `/tools/[slug]`). Ini BUKAN halaman ber-data CDPS:
// tidak ada panggilan API di dalamnya, jadi tidak ada gerbang server untuk
// di-mirror — `access` pada tiap entri `EMBEDDED_TOOLS` adalah SATU-SATUNYA
// tempat akses ditegakkan, dipakai bersama oleh menu ini dan guard halaman
// `/tools/[slug]`. Lihat DECISIONS.md 2026-08-21 "Embed alat HTML AM di CDPS"
// dan 2026-09-04 (rename grup + visibilitas per divisi).
//
// ⚠️ Berbeda dari sisa tabel ini, di grup ini setiap baris WAJIB bergerbang:
// judul grup hanya muncul untuk divisi yang benar-benar punya akses (`visibleNav`
// membuang seksi yang kosong), jadi satu baris tanpa `access` akan membocorkan
// judul grup ke SEMUA divisi. Dikunci oleh tes di `nav.test.ts`.
//
// Menambah alat: taruh `.html` di `public/tools/`, daftarkan di
// `embedded-tools.ts` (berikut predikat aksesnya), lalu tambahkan satu baris di
// sini yang memakai predikat itu — jangan salin ulang predikatnya.
// ---------------------------------------------------------------------------
const MEA_AI_TOOLS: NavNode[] = [
  // "AM - baseline riset" (MEA Video Factory): AM memakai tab Baseline (turunkan
  // CDPS Section B dari export TikTok Shop) + Papan; CC / Leader Video memakai
  // Tracker & Export sheet. Gate = divisi Creative & Account Service, PLUS layer
  // read-everywhere (Director full / OD read-only, Role Matrix §4).
  { href: '/tools/video-factory', label: 'AM - baseline riset', access: EMBEDDED_TOOLS['video-factory'].access },
  // "AM Co-Pilot" (MEA AM Cockpit): diagnosa bottleneck + rancang pilar dari
  // export Strategi, keluarkan draft/JSON siap tempel ke Section C/D/E. Sama
  // audiens & predikat dengan "AM - baseline riset" di atas.
  { href: '/tools/am-copilot', label: 'AM Co-Pilot', access: EMBEDDED_TOOLS['am-copilot'].access },
];

// ---------------------------------------------------------------------------
// KEUANGAN — Wave 1 stream B (M5)
// ---------------------------------------------------------------------------
const KEUANGAN: NavNode[] = [
  // M5 §8.1: hanya Finance yang menetapkan Payment Status otoritatif, dan
  // catatan pra-verifikasi "visible to Finance only".
  { href: '/finance', label: 'Finance', access: ownedBy(FINANCE) },
  { href: '/finance/reminders', label: 'Reminder Pembayaran', access: ownedBy(FINANCE) },
];

// ---------------------------------------------------------------------------
// TIM — Wave 3 (M14, M15-C1)
// ---------------------------------------------------------------------------
const TIM: NavNode[] = [
  // Penugasan Internal — atasan menugaskan anggota timnya, di luar rantai
  // Klien→Service→Brief. TANPA GERBANG dengan sengaja: setiap karyawan di setiap
  // divisi bisa diberi satu, dan scope bacanya murni per-baris (sendiri / divisi
  // sendiri / semua), ditegakkan `internal_tasks_select` + gerbang domain.
  // Memangkasnya per divisi justru menyembunyikannya dari orang-orang (Finance,
  // Sales, Marketing) yang M12 tak punya tempat untuknya — alasan halaman ini
  // ada. Form pembuatannya di dalam bergerbang peran; halamannya tidak.
  { href: '/penugasan', label: 'Penugasan Internal' },
  // M15-C1 Rule 10 — landing SPV/Lead: rollup skor divisi, daftar klien divisi,
  // antrean block-request. Gerbangnya mirror `portal.go` dan sengaja BUKAN
  // read-everywhere: Director + lead divisi, jadi OD berlapis tidak dapat.
  {
    href: '/portal/team',
    label: 'Kinerja Divisi',
    access: (role) => Boolean(role.director) || role.level === 'lead',
  },
  // M14: setiap staff melihat skornya sendiri dengan rincian penuh. Universal.
  // BEDA dari "Kinerja Divisi" di atas: halaman ini universal (bukan hanya lead)
  // dan memuat halaman Konfigurasi bobot (keputusan pemilik 2026-09-04 —
  // keduanya dipertahankan).
  { href: '/performance', label: 'Team Performance' },
];

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
const ADMIN: NavNode[] = [
  // Director/OD saja (tidak berubah): PERMISSIONS.md "Manage employees / role mapping".
  { href: '/admin/employees', label: 'Karyawan', access: (role) => Boolean(role.director || role.od) },
  {
    href: '/admin/role-mappings',
    label: 'Role Mapping',
    access: (role) => Boolean(role.director || role.od),
  },
  // Kalender hari libur di balik setiap hitungan "hari kerja" (SLA Kelola Klien).
  // Gerbang yang sama dengan sisa bidang admin: Director menulis, OD membaca.
  {
    href: '/admin/hari-libur',
    label: 'Hari Libur',
    access: (role) => Boolean(role.director || role.od),
  },
  // Tindak lanjut LT-61: menyediakan login vendor sendiri. Otoritas yang sama
  // dengan vendor.canManageVendor (Account lead / Director) — yang mengelola
  // catatan vendor mengelola apakah ia bisa login — plus OD read-only.
  {
    href: '/admin/vendor-accounts',
    label: 'Akun Vendor',
    access: (role) =>
      Boolean(role.director || role.od || (role.level === 'lead' && role.division === 'Account')),
  },
  // M15-C2: menyediakan kontak Client Portal. Otoritas yang sama dengan
  // mengelola kontaknya sendiri (canManageOneClientContact) — Account
  // lead/Director untuk Klien mana pun, Account staff (AM) untuk miliknya —
  // plus OD read-only, mencerminkan pembagian yang sama dengan vendor-accounts.
  {
    href: '/admin/client-contacts',
    label: 'Akses Portal Klien',
    access: (role) => Boolean(role.director || role.od || role.division === 'Account'),
  },
];

/**
 * Model navigasi penuh, sebelum penyaringan peran — Sidebar IA v3 §2:
 * sembilan grup, semuanya berjudul (tidak ada lagi blok tanpa judul di atas).
 *
 * `Notifikasi`, `Ganti Password` dan `Keluar` sengaja TIDAK di sini: ketiganya
 * pindah ke header (IA v3 §2 "Avatar menu"), dan `Header.tsx` sudah memuatnya.
 */
export const NAV_SECTIONS: NavSection[] = [
  { title: 'Beranda', items: BERANDA },
  { title: 'Akuisisi', items: AKUISISI },
  { title: 'Katalog & Penawaran', items: KATALOG },
  { title: 'Klien', items: KLIEN },
  { title: 'Delivery', items: DELIVERY },
  { title: 'MEA AI Tools', items: MEA_AI_TOOLS },
  { title: 'Keuangan', items: KEUANGAN },
  { title: 'Tim', items: TIM },
  { title: 'Admin', items: ADMIN },
];

/** True untuk sub-grup (kedalaman 2), false untuk tautan biasa. */
export function isSubGroup(node: NavNode): node is NavSubGroup {
  return (node as NavSubGroup).items !== undefined;
}

/**
 * canAccess menyelesaikan satu simpul untuk satu peran. Peran `null` (`/me`
 * masih di jalan) hanya melihat item tanpa gerbang, jadi tak ada menu bergerbang
 * yang berkedip sebelum perannya mendarat.
 */
export function canAccess(role: Role | null, item: NavItem): boolean {
  if (!item.access) {
    return true;
  }
  if (!role) {
    return false;
  }
  return item.access(role);
}

/**
 * visibleNav mengembalikan seksi yang boleh dilihat peran ini, membuang item
 * yang bergerbang keluar, sub-grup yang jadi kosong, dan seksi yang tak
 * menyisakan apa pun (jadi tak ada judul kosong yang ter-render).
 */
export function visibleNav(role: Role | null): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    title: section.title,
    items: section.items
      .map((node): NavNode | null => {
        if (!isSubGroup(node)) return canAccess(role, node) ? node : null;
        const items = node.items.filter((item) => canAccess(role, item));
        return items.length > 0 ? { ...node, items } : null;
      })
      .filter((node): node is NavNode => node !== null),
  })).filter((section) => section.items.length > 0);
}

/** Semua tautan yang terlihat peran ini, sub-grup diratakan. Dipakai pencarian & tes. */
export function visibleLinks(role: Role | null): NavItem[] {
  return visibleNav(role).flatMap((s) => s.items.flatMap((n) => (isSubGroup(n) ? n.items : [n])));
}

// ---------------------------------------------------------------------------
// Perilaku rail (Sidebar IA v3 §5) — bagian MURNI-nya tinggal di sini.
//
// `Sidebar.tsx` sengaja tetap jadi renderer tipis: pertanyaan "grup mana yang
// terbuka" dan "apa yang tersisa saat dicari" adalah logika biasa, dan menaruhnya
// di sini membuatnya bisa dites tanpa DOM — alasan yang sama kenapa tabel
// gerbang di atas framework-free.
// ---------------------------------------------------------------------------

/**
 * Cocokkan rute aktif. Beberapa item membawa query string
 * (`/tasks?division=…` — AI Optimizer / Store Operation, DECISIONS.md
 * 2026-09-01, diparkir di antrean Task Execution generik); item itu sengaja
 * tidak pernah ditandai aktif — membedakannya dari "Task Execution" polos butuh
 * `useSearchParams()` di rail, yang berarti Suspense boundary mengelilingi
 * setiap halaman yang shell render — lebih mahal daripada nilai sorotan menunya.
 * Navigasi & filternya sendiri tetap benar.
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href.includes('?')) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Semua tautan di dalam satu simpul (satu tautan, atau isi sebuah sub-grup). */
export function linksOf(node: NavNode): NavItem[] {
  return isSubGroup(node) ? node.items : [node];
}

/**
 * Judul seksi yang memuat rute aktif, atau null — grup inilah yang terbuka saat
 * halaman dimuat (§5.1).
 */
export function sectionOfRoute(sections: NavSection[], pathname: string): string | null {
  for (const s of sections) {
    for (const node of s.items) {
      if (linksOf(node).some((i) => isActiveHref(pathname, i.href))) return s.title;
    }
  }
  return null;
}

const norm = (s: string): string => s.toLowerCase().trim();

/**
 * Saring model untuk kotak cari (§5.3): "grup yang cocok mengembang, yang tidak
 * cocok disembunyikan".
 *
 * Judul grup yang cocok mempertahankan SELURUH isinya — mencari "delivery" harus
 * memperlihatkan isi grup itu, bukan grup kosong. Hal yang sama berlaku untuk
 * judul sub-grup. Kueri kosong mengembalikan model apa adanya.
 */
export function filterNav(sections: NavSection[], query: string): NavSection[] {
  const q = norm(query);
  if (!q) return sections;
  return sections
    .map((s) => ({
      title: s.title,
      items: norm(s.title).includes(q)
        ? s.items
        : s.items
            .map((node): NavNode | null => {
              if (!isSubGroup(node)) return norm(node.label).includes(q) ? node : null;
              if (norm(node.label).includes(q)) return node;
              const items = node.items.filter((i) => norm(i.label).includes(q));
              return items.length ? { ...node, items } : null;
            })
            .filter((n): n is NavNode => n !== null),
    }))
    .filter((s) => s.items.length > 0);
}
