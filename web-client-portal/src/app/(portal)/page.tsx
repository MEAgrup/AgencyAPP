'use client';

/**
 * Placeholder landing page — this auth cluster (M15-C2) only builds the
 * account realm (login, force-change, self-service reset, admin
 * provisioning). Service Progress / Health Summary / embedded reports /
 * complaint form are separate, later clusters per
 * docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md's own roadmap (§7 closing note) —
 * this page exists so a contact who successfully logs in lands somewhere
 * real rather than a 404, not as a stand-in for those surfaces.
 */
import { usePortalAuth } from '@/lib/portal-auth-context';

export default function PortalHomePage() {
  const { contact } = usePortalAuth();

  return (
    <div className="stack">
      <div>
        <h1>Selamat datang, {contact?.nama}</h1>
        <p className="muted">{contact?.nama_klien}</p>
      </div>
      <div className="card">
        <p>
          Progres layanan, laporan, dan ringkasan kesehatan akun Anda akan tampil di sini.
          Fitur ini sedang dalam pengembangan.
        </p>
      </div>
    </div>
  );
}
