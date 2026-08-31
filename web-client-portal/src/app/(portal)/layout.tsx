'use client';

/**
 * Client Portal shell — guards every page under this group behind a contact
 * session, mirroring web-internal's `(shell)/layout.tsx` and
 * `vendor/layout.tsx` guard shape.
 *
 * ALSO enforces the force-change gate (spec §3.6) properly: a contact whose
 * `must_change_password` is true is redirected to `/akun/password` and kept
 * there until they change it — a real client-side gate, not merely a DB flag
 * an admin screen happens to display. (The employee realm has the DB flag but
 * no working UI enforcement anywhere yet — noted as a gap by the research
 * that went into this cluster; Client Portal does not inherit that gap.)
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortalAuth } from '@/lib/portal-auth-context';
import styles from './portal.module.css';

const PASSWORD_PATH = '/akun/password';

// NOTE: `PortalAuthProvider` is mounted once in the ROOT layout
// (src/app/layout.tsx), not here — unlike web-internal (which needs an
// employee AND a vendor context coexisting in one tree), this app has
// exactly one realm, so the provider lives at the very top and `/login`,
// `/lupa-password`, `/reset-password` share the same context instance this
// guard reads. Re-wrapping it here would create a second, out-of-sync
// instance.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { contact, loading, logout } = usePortalAuth();
  const router = useRouter();
  const pathname = usePathname();
  const mustChange = contact?.must_change_password === true;

  useEffect(() => {
    if (loading) return;
    if (!contact) {
      router.replace('/login');
      return;
    }
    if (mustChange && pathname !== PASSWORD_PATH) {
      router.replace(PASSWORD_PATH);
    }
  }, [loading, contact, mustChange, pathname, router]);

  if (loading) {
    return <div className="pageLoading">Memuat...</div>;
  }

  if (!contact) {
    // Redirect effect above will kick in; render nothing meanwhile.
    return null;
  }

  if (mustChange && pathname !== PASSWORD_PATH) {
    // Redirect effect above will kick in; render nothing meanwhile.
    return null;
  }

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <strong>{contact.nama_klien}</strong>
          <span className={styles.headerSub}>Client Portal &mdash; {contact.nama}</span>
        </div>
        <button type="button" className="btn btnSecondary" onClick={handleLogout}>
          Keluar
        </button>
      </header>
      <main className={styles.content}>
        {mustChange && (
          <div className="alert alertWarning" style={{ marginBottom: 16 }}>
            Anda wajib mengganti password sebelum melanjutkan.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
