'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/types';
import { visibleNav, type NavItem } from '@/lib/nav';
import styles from './Shell.module.css';

/**
 * Plain pathname match. A couple of nav items carry a query string
 * (`/tasks?division=...` — AI Optimizer / Store Operation, DECISIONS.md
 * 2026-09-01, parked on the generic Task Execution queue in lieu of a bespoke
 * board page); those are deliberately never marked active — telling them apart
 * from plain "Task Execution" would need `useSearchParams()` here, which would
 * need a Suspense boundary around every page this shell renders, more than a
 * nav-highlight nicety is worth. They still navigate and filter correctly.
 */
function isActive(pathname: string, href: string) {
  if (href.includes('?')) return false;
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
