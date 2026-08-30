'use client';

/**
 * LT-61 vendor realm layout — deliberately NOT the internal `(shell)` layout
 * (no Sidebar/Header, which read `role`/`employee` from the internal
 * `useAuth()`). Guards every `/vendor/*` page except `/vendor/login` behind a
 * vendor session, mirroring `(shell)/layout.tsx`'s guard shape but against
 * `useVendorAuth()` — the two auth realms never share a check.
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { VendorAuthProvider, useVendorAuth } from '@/lib/vendor-auth-context';
import styles from './vendor.module.css';

function VendorGuard({ children }: { children: React.ReactNode }) {
  const { vendor, loading, logout } = useVendorAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === '/vendor/login';

  useEffect(() => {
    if (!loading && !vendor && !isLoginPage) {
      router.replace('/vendor/login');
    }
  }, [loading, vendor, isLoginPage, router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (loading) {
    return <div className="pageLoading">Memuat...</div>;
  }

  if (!vendor) {
    // Redirect effect above will kick in; render nothing meanwhile.
    return null;
  }

  async function handleLogout() {
    await logout();
    router.replace('/vendor/login');
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <strong>{vendor.nama_vendor}</strong>
          <span className={styles.headerSub}>Portal Vendor Live Stream &mdash; CDPS</span>
        </div>
        <button type="button" className="btn btnSecondary" onClick={handleLogout}>
          Keluar
        </button>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return (
    <VendorAuthProvider>
      <VendorGuard>{children}</VendorGuard>
    </VendorAuthProvider>
  );
}
