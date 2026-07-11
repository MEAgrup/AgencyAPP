'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Employee, Role } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { useUnreadCount } from '@/lib/use-unread-count';
import styles from './Shell.module.css';

export default function Header({ employee, role }: { employee: Employee; role: Role | null }) {
  const router = useRouter();
  const { logout } = useAuth();
  const { unreadCount } = useUnreadCount(true);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <header className={styles.header}>
      <div className={styles.userBlock}>
        <div>
          <div className={styles.userName}>{employee.nama}</div>
          <div className={styles.userMeta}>
            {employee.divisi} &middot; {employee.jabatan}
          </div>
          {role && (role.od || role.director) && (
            <div className={styles.badgeRow}>
              {role.od && <span className="pill">OD</span>}
              {role.director && <span className="pill">Direktur</span>}
            </div>
          )}
        </div>
      </div>
      <div className={styles.headerActions}>
        <Link href="/notifications" className={styles.bellWrap} aria-label="Notifikasi" title="Notifikasi">
          <span className={styles.bellButton}>
            {'\u{1F514}'}
            {unreadCount > 0 && (
              <span className={styles.bellBadge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </span>
        </Link>
        <button type="button" className="btn btnSecondary" onClick={handleLogout}>
          Keluar
        </button>
      </div>
    </header>
  );
}
