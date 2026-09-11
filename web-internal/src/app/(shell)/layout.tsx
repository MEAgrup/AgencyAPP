'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import AdopsiTracker from '@/components/AdopsiTracker';
import styles from '@/components/Shell.module.css';

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const { employee, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !employee) {
      router.replace('/login');
    }
  }, [loading, employee, router]);

  if (loading) {
    return <div className="pageLoading">Memuat...</div>;
  }

  if (!employee) {
    // Redirect effect above will kick in; render nothing meanwhile.
    return null;
  }

  return (
    <div className={styles.shell}>
      {/* Adopsi Sistem (pemilik 2026-09-10) — nol render, satu baris log per
          perpindahan rute. Di SINI dan bukan di root layout: halaman login dan
          portal klien bukan pemakaian sistem internal oleh karyawan. */}
      <AdopsiTracker role={role} />
      <Sidebar role={role} />
      <div className={styles.main}>
        <Header employee={employee} role={role} />
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
