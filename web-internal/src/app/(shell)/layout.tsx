'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import AdopsiTracker from '@/components/AdopsiTracker';
import styles from '@/components/Shell.module.css';

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const { employee, role, loading, connectionIssue } = useAuth();
  const router = useRouter();

  // Hanya sesi yang DITOLAK server (401/403) yang dilempar ke /login. Saat /me
  // tak terjangkau (timeout/jaringan/5xx) sesi dipertahankan dan dicoba ulang.
  useEffect(() => {
    if (!loading && !employee && !connectionIssue) {
      router.replace('/login');
    }
  }, [loading, employee, connectionIssue, router]);

  const connectionBanner = connectionIssue ? (
    <div className="alert alertWarning" role="status">
      Koneksi bermasalah, mencoba menghubungkan kembali...
    </div>
  ) : null;

  if (loading) {
    return <div className="pageLoading">Memuat...</div>;
  }

  if (!employee) {
    // Tanpa sesi tersimpan dan /me belum terjangkau: tampilkan pesan, jangan
    // ke /login. Selain itu efek redirect di atas yang bekerja.
    return connectionBanner ? <div className="pageLoading">{connectionBanner}</div> : null;
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
        <main className={styles.content}>
          {connectionBanner}
          {children}
        </main>
      </div>
    </div>
  );
}
