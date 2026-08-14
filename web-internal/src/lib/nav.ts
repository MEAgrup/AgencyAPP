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

export interface NavSection {
  /** Section header text; null for the leading unheaded block. */
  title: string | null;
  items: NavItem[];
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

const MAIN_LINKS: NavItem[] = [
  // Universal: own dashboard / demo harness / own notification inbox
  // (Phase 0 §9 — notifications are per-recipient) / MSL read is open to any
  // authenticated actor (only editing is gated: msl.canEditMasterServices).
  { href: '/', label: 'Dashboard' },
  // Ungated on purpose: every authenticated employee must be able to reach their
  // own password change — including one whose account is under a forced change.
  { href: '/akun/password', label: 'Ganti Password' },
  { href: '/demo-tasks', label: 'Demo Tasks' },
  { href: '/notifications', label: 'Notifikasi' },
  { href: '/master-services', label: 'Master Service List' },
  // M0 closing tool (quote preview feeds the Closing form). Sales-owned per
  // PERMISSIONS.md "M0 Sales"; kept off other divisions' menus.
  { href: '/sales/kalkulator', label: 'Kalkulator Penawaran', access: ownedBy(SALES) },
  // Wave 1 — stream B (M4/M5). M4: Sales PIC + allocation members, the assigned
  // AM (Account), and the Commission/Payment PIC (Finance). Rows themselves are
  // RLS-scoped (`clients_select`).
  { href: '/clients', label: 'Klien', access: ownedBy(SALES, ACCOUNT, FINANCE) },
  // M5 §8.1: only Finance sets the authoritative Payment Status, and
  // pre-verification records are "visible to Finance only".
  { href: '/finance', label: 'Finance', access: ownedBy(FINANCE) },
  { href: '/finance/reminders', label: 'Reminder Pembayaran', access: ownedBy(FINANCE) },
  // end Wave 1 — stream B (M4/M5)
];

// Akuisisi — Wave 1 stream A (M0 Sales + M1 Leads) + Wave 3 (M2, M3)
const ACQUISITION_LINKS: NavItem[] = [
  // M0 §9: the attempt workspace is Sales'.
  { href: '/sales', label: 'Sales Workspace', access: ownedBy(SALES) },
  // Hard server gate: `leads.canReadPool` (Sales any level) + `leads.leadListScope`
  // (Marketing any level, Sales lead). Every other division gets a 403, not an
  // empty list. Whether Sales STAFF should also reach the Database (M1 §9.1
  // "sees own attempts only") is DECISIONS **O40** — open, deliberately not
  // decided here; the Pool alone already justifies the menu for Sales.
  { href: '/leads', label: 'Leads', access: ownedBy(SALES, MARKETING) },
  // Mirrors the gate already inside marketing/page.tsx.
  { href: '/marketing', label: 'Campaign Marketing', access: ownedBy(MARKETING) },
  { href: '/marketing/performance', label: 'Performa Marketing', access: ownedBy(MARKETING) },
];

// Wave 2 — workspace operasional (M6, M12, M7, M8, M9, M10)
const DELIVERY_LINKS: NavItem[] = [
  // M6: the AM workspace. Account staff reach it through their own Strategies
  // (`account.listStrategies` has an AM arm), Account lead through the
  // unassigned Intake queue (`account.canReadIntake`).
  { href: '/account', label: 'Account & Service', access: ownedBy(ACCOUNT) },
  // M6D Rekap Hasil Mingguan: the AM's weekly worklist. Readable by Account (any
  // level) + OD/Director (`recap.canReadRecap` own-AM / Account-lead / read-all
  // arm). The lead of a touching execution division also reaches recaps of the
  // clients they worked that week (D-09 RLS division-lead read arm + RM-D6
  // `canWriteDivisiNote`), so they can fill their division note without waiting
  // for the notification deep-link. Row scope (which client's recaps) stays the
  // server's job — the menu only trims by division. The worklist page itself is
  // role-aware: an AM gets the portfolio worklist, a division lead the
  // open-by-client fallback (their portfolio is empty server-side).
  {
    href: '/account/rekap',
    label: 'Rekap Mingguan',
    access: (role) =>
      ownedBy(ACCOUNT)(role) ||
      isLead(role, CREATIVE) ||
      isLead(role, ADS) ||
      isLead(role, KOL) ||
      isLead(role, LIVE_STREAM),
  },
  // M12: `/my-tasks` is own-scoped, and Task PICs are staff of the four
  // execution divisions (`account.ALLOWED_DIVISIONS`); the AM sees the tasks of
  // clients they own (`task.canViewTask`). Sales/Marketing/Finance are never
  // task owners.
  {
    href: '/tasks',
    label: 'Task Execution',
    access: ownedBy(ACCOUNT, CREATIVE, ADS, KOL, LIVE_STREAM),
  },
  // The four division Brief queues — see divisionQueue().
  { href: '/creative', label: 'Creative', access: divisionQueue(CREATIVE) },
  { href: '/ads', label: 'Ads', access: divisionQueue(ADS) },
  { href: '/kol', label: 'KOL', access: divisionQueue(KOL) },
  { href: '/livestream', label: 'Live Stream', access: divisionQueue(LIVE_STREAM) },
];

// Wave 3 — visibilitas & skoring (M11, M13, M14)
const VISIBILITY_LINKS: NavItem[] = [
  // M11 My Tasks — the personal, cross-Client work view (§10: "Staff lihat punya
  // sendiri"). Universal: every division has its own tasks. The per-Client
  // "Client Board" (M11 §10: AM/SPV/OD/Director) no longer has its own page — it
  // lives inside the Client Record (`/clients/[id]#board`), reached by the roles
  // that already hold `/clients` access. See DECISIONS 2026-08-14 (board merge).
  { href: '/board/my-tasks', label: 'Tugas Saya' },
  // M13 `health.canScope`: Account (any level) + OD/Director.
  { href: '/health', label: 'Client Health', access: ownedBy(ACCOUNT) },
  // M14: every staff sees their own score with full breakdown. Universal.
  { href: '/performance', label: 'Team Performance' },
];

// Wave 3 — M15-C1 Team Portal (internal). Gates mirror portal.go and are
// deliberately NOT read-everywhere: Portal Tim is Director + division lead, so a
// layered OD does not get it. Preserved exactly as shipped.
const PORTAL_LINKS: NavItem[] = [
  { href: '/portal', label: 'Portal Saya' },
  {
    href: '/portal/team',
    label: 'Portal Tim',
    access: (role) => Boolean(role.director) || role.level === 'lead',
  },
  {
    href: '/portal/management',
    label: 'Manajemen',
    access: (role) => Boolean(role.director || role.od),
  },
];

const ADMIN_LINKS: NavItem[] = [
  // Director/OD only (unchanged): PERMISSIONS.md "Manage employees / role mapping".
  { href: '/admin/employees', label: 'Karyawan', access: (role) => Boolean(role.director || role.od) },
  {
    href: '/admin/role-mappings',
    label: 'Role Mapping',
    access: (role) => Boolean(role.director || role.od),
  },
  // The holiday calendar behind every "hari kerja" count (Kelola Klien SLA).
  // Same gate as the rest of the admin plane: Director writes, OD reads.
  {
    href: '/admin/hari-libur',
    label: 'Hari Libur',
    access: (role) => Boolean(role.director || role.od),
  },
];

/** The full navigation model, before role filtering. */
export const NAV_SECTIONS: NavSection[] = [
  { title: null, items: MAIN_LINKS },
  { title: 'Akuisisi', items: ACQUISITION_LINKS },
  { title: 'Delivery', items: DELIVERY_LINKS },
  { title: 'Visibilitas', items: VISIBILITY_LINKS },
  { title: 'Portal', items: PORTAL_LINKS },
  { title: 'Admin', items: ADMIN_LINKS },
];

/**
 * canAccess resolves one item for one role. A null role (`/me` still in flight)
 * shows only ungated items, so no gated menu ever flashes before the role
 * lands.
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
 * visibleNav returns the sections this role may see, dropping items that are
 * gated out and any section left with no items (so no empty header renders).
 */
export function visibleNav(role: Role | null): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    title: section.title,
    items: section.items.filter((item) => canAccess(role, item)),
  })).filter((section) => section.items.length > 0);
}
