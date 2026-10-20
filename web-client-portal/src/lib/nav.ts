/**
 * The whole portal, in a handful of links. This IS the allow-list made
 * visible: there is no invoice page, no team page, no complaint history — not
 * hidden behind a permission, simply not built (spec §4.2, OQ-6, M15 Rule 6).
 *
 * `/progres` hanya muncul bila saklar Progres Layanan nyala (`progresAktif()`,
 * ditangguhkan 2026-10-20 — `docs/decisions/2026-10-20-portal-progres-layanan-nonaktif.md`).
 */
export type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: '/', label: 'Ringkasan' },
  { href: '/laporan', label: 'Laporan' },
  { href: '/progres', label: 'Progres Layanan' },
  { href: '/komplain', label: 'Ajukan Komplain' },
];

export function navItems(progres: boolean): NavItem[] {
  return progres ? NAV : NAV.filter((n) => n.href !== '/progres');
}
