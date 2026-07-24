'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import styles from '@/components/Shell.module.css';

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const { employee, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!employee) {
      router.replace('/login');
    } else if (employee.must_change_password) {
      // O38: forced first-login change — no workspace page until it's done.
      router.replace('/change-password');
    }
  }, [loading, employee, router]);

  if (loading) {
    return <div className="pageLoading">Memuat...</div>;
  }

  if (!employee || employee.must_change_password) {
    // Redirect effect above will kick in; render nothing meanwhile.
    return null;
  }

  return (
    <div className={styles.shell}>
      <Sidebar role={role} />
      <div className={styles.main}>
        <Header employee={employee} role={role} />
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
