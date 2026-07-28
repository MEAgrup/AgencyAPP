'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/types';
import styles from './Shell.module.css';

// Each nav item carries an `access` gate mirroring the backend permission
// matrix (PERMISSIONS.md): a staff/lead only sees their own division's
// workspaces, so cross-division menus are HIDDEN rather than shown-then-403.
// OD (read-only everywhere) and Director see every item. The server stays the
// final authority — this only trims what a role can never reach.
interface NavItem {
  href: string;
  label: string;
  access?: (role: Role) => boolean;
}

// Case-insensitive division match: /me returns canonical capitalized divisions
// ('Sales', 'Live Stream', …) but some legacy mappings arrive lowercased, so we
// normalize both sides before comparing (mirrors the per-page gates).
function inDivision(role: Role, ...names: string[]): boolean {
  const d = (role.division ?? '').toLowerCase();
  return names.some((n) => n.toLowerCase() === d);
}

// Division-owned workspaces. Universal items (Dashboard, Notifikasi, own
// Portal, …) carry no `access` and are always shown.
const isSales = (r: Role) => inDivision(r, 'Sales');
const isMarketing = (r: Role) => inDivision(r, 'Marketing');
const isFinance = (r: Role) => inDivision(r, 'Finance');
const isAccount = (r: Role) => inDivision(r, 'Account');
const isCreative = (r: Role) => inDivision(r, 'Creative');
const isAds = (r: Role) => inDivision(r, 'Ads');
const isKol = (r: Role) => inDivision(r, 'KOL');
const isLivestream = (r: Role) => inDivision(r, 'Live Stream');

const MAIN_LINKS: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/demo-tasks', label: 'Demo Tasks' },
  { href: '/notifications', label: 'Notifikasi' },
  { href: '/master-services', label: 'Master Service List' },
  { href: '/sales/kalkulator', label: 'Kalkulator Penawaran', access: isSales },
  // Wave 1 — stream B (M4/M5)
  { href: '/clients', label: 'Klien', access: (r) => isSales(r) || isAccount(r) || isFinance(r) },
  { href: '/finance', label: 'Finance', access: isFinance },
  { href: '/finance/reminders', label: 'Reminder Pembayaran', access: isFinance },
  // end Wave 1 — stream B (M4/M5)
];

// Akuisisi — Wave 1 stream A (M0 Sales + M1 Leads) + Wave 3 (M2, M3)
const ACQUISITION_LINKS: NavItem[] = [
  { href: '/sales', label: 'Sales Workspace', access: isSales },
  { href: '/leads', label: 'Leads', access: (r) => isSales(r) || isMarketing(r) },
  { href: '/marketing', label: 'Campaign Marketing', access: isMarketing },
  { href: '/marketing/performance', label: 'Performa Marketing', access: isMarketing },
];

// Wave 2 — workspace operasional (M6, M12, M7, M8, M9, M10)
const DELIVERY_LINKS: NavItem[] = [
  { href: '/account', label: 'Account & Service', access: isAccount },
  // Task Execution (M12) PICs are staff of a delivery division; Sales/Marketing
  // are never task owners, so it stays a delivery-division menu.
  {
    href: '/tasks',
    label: 'Task Execution',
    access: (r) => isAccount(r) || isCreative(r) || isAds(r) || isKol(r) || isLivestream(r),
  },
  { href: '/creative', label: 'Creative', access: isCreative },
  { href: '/ads', label: 'Ads', access: isAds },
  // KOL & Live Stream escalation/reconciliation also involves Account (M9/M10).
  { href: '/kol', label: 'KOL', access: (r) => isKol(r) || isAccount(r) },
  { href: '/livestream', label: 'Live Stream', access: (r) => isLivestream(r) || isAccount(r) },
];

// Wave 3 — visibilitas & skoring (M11, M13, M14)
const VISIBILITY_LINKS: NavItem[] = [
  { href: '/board', label: 'Unified Board' },
  { href: '/health', label: 'Client Health', access: isAccount },
  { href: '/performance', label: 'Team Performance' },
];

// Wave 3 — M15-C1 Team Portal (internal). Item Tim & Manajemen digate per role
// di render (cermin gate portal.go; server tetap otoritas akhir).
const PORTAL_ME_LINK: NavItem = { href: '/portal', label: 'Portal Saya' };
const PORTAL_TEAM_LINK: NavItem = { href: '/portal/team', label: 'Portal Tim' };
const PORTAL_MGMT_LINK: NavItem = { href: '/portal/management', label: 'Manajemen' };

const ADMIN_LINKS: NavItem[] = [
  { href: '/admin/employees', label: 'Karyawan' },
  { href: '/admin/role-mappings', label: 'Role Mapping' },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

// canAccess resolves an item's visibility. OD (read-only-everywhere) and
// Director see everything; otherwise the item's own gate decides. A null role
// (still loading /me) shows only ungated items.
function canAccess(role: Role | null, item: NavItem): boolean {
  if (!item.access) return true;
  if (!role) return false;
  if (role.director || role.od) return true;
  return item.access(role);
}

export default function Sidebar({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const showAdmin = Boolean(role?.director || role?.od);

  const renderLink = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      className={`${styles.navLink} ${isActive(pathname, item.href) ? styles.navLinkActive : ''}`}
    >
      {item.label}
    </Link>
  );

  // A section renders its header only when it has at least one visible item.
  const renderSection = (title: string, items: NavItem[]) => {
    const visible = items.filter((item) => canAccess(role, item));
    if (visible.length === 0) return null;
    return (
      <>
        <div className={styles.navSection}>{title}</div>
        {visible.map(renderLink)}
      </>
    );
  };

  const portalLinks: NavItem[] = [
    PORTAL_ME_LINK,
    ...(role?.director || role?.level === 'lead' ? [PORTAL_TEAM_LINK] : []),
    ...(role?.director || role?.od ? [PORTAL_MGMT_LINK] : []),
  ];

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        CDPS
        <span>MEA Agency</span>
      </div>
      <nav className={styles.nav}>
        {MAIN_LINKS.filter((item) => canAccess(role, item)).map(renderLink)}
        {renderSection('Akuisisi', ACQUISITION_LINKS)}
        {renderSection('Delivery', DELIVERY_LINKS)}
        {renderSection('Visibilitas', VISIBILITY_LINKS)}
        {renderSection('Portal', portalLinks)}
        {showAdmin && (
          <>
            <div className={styles.navSection}>Admin</div>
            {ADMIN_LINKS.map(renderLink)}
          </>
        )}
      </nav>
    </aside>
  );
}
