'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/types';
import {
  filterNav, isSubGroup, isActiveHref, sectionOfRoute, visibleNav,
  type NavItem, type NavNode, type NavSection,
} from '@/lib/nav';
import styles from './Shell.module.css';

/**
 * Sidebar — rail accordion Sidebar IA v3 §5.
 *
 * Ia me-render model navigasi ter-filter-peran dari `@/lib/nav` dan TIDAK punya
 * logika izin sendiri: tabel gerbangnya tinggal di sana supaya bisa dites per
 * peran. Menyembunyikan menu hanyalah kenyamanan; server tetap otoritas atas
 * setiap rute.
 *
 * Yang dikerjakan komponen ini, dan hanya ini:
 *   §5.1 accordion, satu grup terbuka; grup yang memuat rute aktif terbuka saat muat;
 *   §5.2 kedalaman 2 (`Papan Divisi`) yang mengingat keadaannya sendiri di localStorage;
 *   §5.3 kotak cari di puncak rail, ⌘K / Ctrl+K untuk fokus — grup yang cocok
 *        mengembang, yang tidak cocok disembunyikan;
 *   §5.8 a11y: judul grup `<button aria-expanded>`, item aktif `aria-current="page"`.
 *
 * Badge angka (§5.4) SENGAJA belum ada: tiap badge butuh endpoint hitungan
 * tersendiri di `apps/api` (Persetujuan, Leads, Task Execution, Reminder
 * Pembayaran) berikut tes izin per peran — pekerjaan backend, bukan penataan
 * navigasi (keputusan pemilik 2026-09-04, "badge menyusul").
 */

/** Kunci localStorage untuk keadaan lipatan `Papan Divisi` (§5.2, per pemakai browser ini). */
const PAPAN_KEY = 'cdps.nav.papanDivisi.open';

export default function Sidebar({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const sections = useMemo(() => visibleNav(role), [role]);
  const activeSection = useMemo(() => sectionOfRoute(sections, pathname), [sections, pathname]);

  const [query, setQuery] = useState('');
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [papanOpen, setPapanOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // §5.1 — grup yang memuat rute aktif terbuka saat muat, dan setiap kali rute
  // pindah ke grup lain. Sengaja TIDAK memaksa ulang saat pemakai menutupnya
  // sendiri di rute yang sama: efek ini hanya bereaksi pada perubahan rute.
  useEffect(() => {
    if (activeSection) setOpenSection(activeSection);
  }, [activeSection]);

  // §5.2 — `Papan Divisi` mengingat keadaannya sendiri. Dibaca sesudah mount
  // (bukan saat render) supaya HTML server dan klien tidak berbeda; localStorage
  // dibungkus try/catch karena bisa melempar di mode privat.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PAPAN_KEY);
      if (saved !== null) setPapanOpen(saved === '1');
    } catch {
      /* storage tak tersedia — biarkan default */
    }
  }, []);

  function togglePapan() {
    setPapanOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(PAPAN_KEY, next ? '1' : '0');
      } catch {
        /* storage tak tersedia — keadaan tetap hidup untuk sesi ini saja */
      }
      return next;
    });
  }

  // §5.3 — ⌘K / Ctrl+K memfokuskan kotak cari.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim();
  const shown: NavSection[] = useMemo(() => filterNav(sections, q), [sections, q]);

  const renderLink = (item: NavItem, nested: boolean) => {
    const active = isActiveHref(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`${styles.navLink} ${nested ? styles.navLinkNested : ''} ${active ? styles.navLinkActive : ''}`}
      >
        {item.label}
      </Link>
    );
  };

  const renderNode = (node: NavNode) => {
    if (!isSubGroup(node)) return renderLink(node, false);
    // Saat mencari, sub-grup selalu terbuka — menyembunyikan hasil di balik
    // lipatan membuat pencarian terasa rusak.
    const holdsActive = node.items.some((i) => isActiveHref(pathname, i.href));
    const expanded = Boolean(q) || papanOpen || holdsActive;
    const panelId = `nav-sub-${node.label.replace(/\s+/g, '-').toLowerCase()}`;
    return (
      <div key={node.label} className={styles.navSubGroup}>
        <button
          type="button"
          className={styles.navSubHeader}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={togglePapan}
        >
          <span>{node.label}</span>
          <span aria-hidden="true" className={styles.navChevron}>
            {expanded ? '▾' : '▸'}
          </span>
        </button>
        <div id={panelId} hidden={!expanded}>
          {node.items.map((i) => renderLink(i, true))}
        </div>
      </div>
    );
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        CDPS
        <span>MEA Agency</span>
      </div>

      <div className={styles.navSearch}>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari menu…"
          aria-label="Cari menu"
          className={styles.navSearchInput}
        />
        <kbd aria-hidden="true" className={styles.navSearchHint}>
          ⌘K
        </kbd>
      </div>

      <nav className={styles.nav} aria-label="Navigasi utama">
        {shown.length === 0 && (
          <p className={styles.navEmpty}>Tidak ada menu yang cocok.</p>
        )}
        {shown.map((section) => {
          // Saat mencari, setiap grup yang tersisa terbuka (§5.3).
          const expanded = Boolean(q) || openSection === section.title;
          const panelId = `nav-sec-${section.title.replace(/\s+/g, '-').toLowerCase()}`;
          return (
            <div key={section.title} className={styles.navGroup}>
              <button
                type="button"
                className={styles.navSection}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpenSection(expanded && !q ? null : section.title)}
              >
                <span>{section.title}</span>
                <span aria-hidden="true" className={styles.navChevron}>
                  {expanded ? '▾' : '▸'}
                </span>
              </button>
              <div id={panelId} hidden={!expanded} className={styles.navGroupItems}>
                {section.items.map(renderNode)}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
