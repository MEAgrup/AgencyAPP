'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/types';
import { visibleNav, type NavItem } from '@/lib/nav';
import styles from './Shell.module.css';

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Sidebar renders the role-filtered navigation model from `@/lib/nav`. It holds
 * no permission logic of its own — the gate table lives there so it can be
 * tested per role. Hiding a menu is convenience only; the server is the
 * authority on every route.
 */
export default function Sidebar({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const sections = visibleNav(role);

  const renderLink = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      className={`${styles.navLink} ${isActive(pathname, item.href) ? styles.navLinkActive : ''}`}
    >
      {item.label}
    </Link>
  );

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        CDPS
        <span>MEA Agency</span>
      </div>
      <nav className={styles.nav}>
        {/* Fragments, not wrapper divs: `.nav` is a flex column with a 2px gap,
            so every link must stay a direct flex child (unchanged markup). */}
        {sections.map((section) => (
          <Fragment key={section.title ?? '__main'}>
            {section.title && <div className={styles.navSection}>{section.title}</div>}
            {section.items.map(renderLink)}
          </Fragment>
        ))}
      </nav>
    </aside>
  );
}
