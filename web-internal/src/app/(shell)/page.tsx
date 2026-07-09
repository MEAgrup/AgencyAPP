'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { api, errorMessage } from '@/lib/api';
import type { NotificationsResponse } from '@/lib/types';

const QUICK_LINKS = [
  { href: '/demo-tasks', label: 'Demo Tasks', desc: 'Lihat dan buat demo task' },
  { href: '/master-services', label: 'Master Service List', desc: 'Daftar layanan & harga standar' },
  { href: '/notifications', label: 'Notifikasi', desc: 'Semua notifikasi Anda' },
];

export default function DashboardPage() {
  const { employee, role } = useAuth();
  const [preview, setPreview] = useState<NotificationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<NotificationsResponse>('/notifications?unread=1');
        if (!cancelled) setPreview(res);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Halo, {employee?.nama ?? ''}</h1>
        <p className="muted">Selamat datang di workspace CDPS.</p>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="cardHeader">
            <h2>Ringkasan Peran</h2>
          </div>
          {role ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                <span className="muted" style={{ width: 120 }}>Divisi</span>
                <strong>{role.division}</strong>
              </div>
              <div className="row">
                <span className="muted" style={{ width: 120 }}>Level</span>
                <strong>{role.level}</strong>
              </div>
              <div className="row">
                <span className="muted" style={{ width: 120 }}>OD</span>
                <strong>{role.od ? 'Ya' : 'Tidak'}</strong>
              </div>
              <div className="row">
                <span className="muted" style={{ width: 120 }}>Direktur</span>
                <strong>{role.director ? 'Ya' : 'Tidak'}</strong>
              </div>
            </div>
          ) : (
            <p className="muted">Data peran tidak tersedia.</p>
          )}
        </section>

        <section className="card">
          <div className="cardHeader">
            <h2>Tautan Cepat</h2>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {QUICK_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 600 }}>{link.label}</div>
                <div className="muted" style={{ fontSize: 12 }}>{link.desc}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Notifikasi Belum Dibaca</h2>
          <Link href="/notifications" className="btn btnSecondary btnSm">Lihat Semua</Link>
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError">{error}</div>}
        {!loading && !error && preview && preview.data.length === 0 && (
          <div className="emptyState">Tidak ada notifikasi belum dibaca.</div>
        )}
        {!loading && !error && preview && preview.data.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {preview.data.slice(0, 5).map((n) => (
              <Link key={n.id} href={n.deep_link || '/notifications'} className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{n.event_type}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {n.actor} &middot; {new Date(n.created_at).toLocaleString('id-ID')}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
