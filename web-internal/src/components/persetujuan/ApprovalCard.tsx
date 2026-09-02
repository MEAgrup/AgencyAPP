'use client';

/**
 * Kartu satu permintaan di "Perlu Persetujuan Saya" (`/persetujuan`).
 *
 * Halaman ini dulunya delapan tabel yang HANYA menautkan ke halaman lain; yang
 * memutuskan tetap harus membuka satu per satu, dan yang paling penting —
 * alasannya, dan pada negosiasi harga "dari berapa jadi berapa" — tidak pernah
 * kelihatan sebelum tab kedua terbuka. Revamp ini membalik urutannya: fakta
 * dulu, tombol di tempat yang sama.
 *
 * Tiga aturan yang diikuti setiap kartu, supaya delapan antrian yang bentuknya
 * berbeda tetap terbaca sebagai satu halaman:
 *
 *  1. **Fakta keputusan selalu terlihat tanpa klik.** Meta (siapa, apa, kapan)
 *     dan ALASAN berada di badan kartu, bukan di balik toggle. Yang boleh
 *     disembunyikan hanya rincian berat (tabel perbandingan harga, jadwal
 *     termin) — dan itu pun dibuka otomatis untuk kartu-kartu teratas.
 *  2. **Hijau = setujui, merah = tolak** (`.btnApprove` / `.btnReject`), selalu
 *     berdampingan, selalu di posisi yang sama.
 *  3. **Halaman ini tidak pernah menjadi otoritas.** Semua tombol memanggil
 *     endpoint yang SUDAH ada, dengan gate role yang sama; server tetap yang
 *     memutuskan dan pesan `[...]`-nya ditampilkan apa adanya.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';

export interface MetaItem {
  label: string;
  value: ReactNode;
}

/** Grid label/nilai — dipakai di badan kartu maupun di dalam rincian. */
export function MetaGrid({ items }: { items: MetaItem[] }) {
  const shown = items.filter((m) => m.value !== null && m.value !== undefined && m.value !== '');
  if (shown.length === 0) return null;
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '8px 16px',
        margin: 0,
      }}
    >
      {shown.map((m) => (
        <div key={m.label}>
          <dt className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {m.label}
          </dt>
          <dd style={{ margin: 0, fontSize: 13 }}>{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Blok alasan. Sengaja punya bentuk visual sendiri (bukan sekadar satu sel
 * tabel): pada tujuh dari delapan antrian, kalimat inilah satu-satunya hal yang
 * membedakan "setujui" dari "tolak", jadi ia tidak boleh punya berat yang sama
 * dengan nomor telepon di sebelahnya. Kosong ⇒ dikatakan kosong, bukan hilang —
 * pengaju yang tidak memberi alasan adalah informasi.
 */
export function ReasonBlock({ label = 'Alasan', text }: { label?: string; text: string | null | undefined }) {
  const body = (text ?? '').trim();
  return (
    <div
      style={{
        borderLeft: '3px solid var(--color-border)',
        padding: '2px 0 2px 10px',
      }}
    >
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      {body === '' ? (
        <p className="muted" style={{ fontSize: 13, fontStyle: 'italic' }}>
          Tidak ada alasan tertulis.
        </p>
      ) : (
        <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{body}</p>
      )}
    </div>
  );
}

export interface ApprovalCardProps {
  /** ID entitas — judul kartu; ditautkan bila `href` ada. */
  id: string;
  href?: string;
  /** Baris kedua judul: nama klien / lead / toko. */
  title?: ReactNode;
  /** Badge kanan atas (status). */
  badge?: ReactNode;
  meta?: MetaItem[];
  /** Alasan pengajuan, bila antriannya memang menyimpan satu. */
  reason?: { label?: string; text: string | null | undefined };
  /**
   * Rincian berat (perbandingan harga, jadwal termin). Dirender di balik toggle
   * "Rincian". State buka/tutupnya milik PEMANGGIL, bukan kartu ini: baris yang
   * memuat rinciannya lewat jaringan menyalakan fetch dari `open` yang sama
   * (pola `RenewalPanel`), dan kartu teratas dibuka duluan supaya antrian pendek
   * tidak butuh klik sama sekali tanpa menembakkan N request untuk yang panjang.
   */
  detail?: ReactNode;
  detailLabel?: string;
  open?: boolean;
  onToggle?: (next: boolean) => void;
  /** Baris aksi (DecisionActions atau blok khusus antrian tersebut). */
  children?: ReactNode;
}

export default function ApprovalCard({
  id,
  href,
  title,
  badge,
  meta,
  reason,
  detail,
  detailLabel = 'Rincian',
  open = false,
  onToggle,
  children,
}: ApprovalCardProps) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <strong style={{ fontSize: 14 }}>{href ? <Link href={href}>{id}</Link> : id}</strong>
          {title && (
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {title}
            </div>
          )}
        </div>
        {badge}
      </div>

      {meta && meta.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <MetaGrid items={meta} />
        </div>
      )}

      {reason && (
        <div style={{ marginTop: 10 }}>
          <ReasonBlock label={reason.label} text={reason.text} />
        </div>
      )}

      {detail && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btnGhost btnSm"
            style={{ paddingLeft: 0 }}
            aria-expanded={open}
            onClick={() => onToggle?.(!open)}
          >
            {open ? `▾ Sembunyikan ${detailLabel.toLowerCase()}` : `▸ ${detailLabel}`}
          </button>
          {open && <div style={{ marginTop: 8 }}>{detail}</div>}
        </div>
      )}

      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}
