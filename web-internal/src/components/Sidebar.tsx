'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/types';
import styles from './Shell.module.css';

interface NavItem {
  href: string;
  label: string;
}

const MAIN_LINKS: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/demo-tasks', label: 'Demo Tasks' },
  { href: '/notifications', label: 'Notifikasi' },
  { href: '/master-services', label: 'Master Service List' },
  // Wave 1 — stream A (M0/M1)
  { href: '/leads', label: 'Leads' },
  // Wave 1 — stream B (M4/M5)
  { href: '/clients', label: 'Klien' },
  { href: '/finance', label: 'Finance' },
  { href: '/finance/reminders', label: 'Reminder Pembayaran' },
  // end Wave 1 — stream B (M4/M5)
];

const ADMIN_LINKS: NavItem[] = [
  { href: '/admin/employees', label: 'Karyawan' },
  { href: '/admin/role-mappings', label: 'Role Mapping' },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const showAdmin = Boolean(role?.director || role?.od);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        CDPS
        <span>MEA Agency</span>
      </div>
      <nav className={styles.nav}>
        {MAIN_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.navLink} ${isActive(pathname, item.href) ? styles.navLinkActive : ''}`}
          >
            {item.label}
          </Link>
        ))}
        {showAdmin && (
          <>
            <div className={styles.navSection}>Admin</div>
            {ADMIN_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${isActive(pathname, item.href) ? styles.navLinkActive : ''}`}
              >
                {item.label}
              </Link>
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
