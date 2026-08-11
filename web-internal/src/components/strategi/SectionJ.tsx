'use client';

/**
 * A-13 — Section J (Approval & Versi): J-1 … J-4, all read-only.
 *
 * §4 marks every J field `Auto`/`Struct`-from-record — there is nothing to type
 * here, which is exactly why the section had no form until now and its J-1/J-4
 * visibility toggles read "belum terjangkau" (VisibilitasPanel). This panel is
 * the home that makes them reachable:
 *
 *  - **J-1** header (version, status, submit/approval dates, AM) — from `detail`.
 *  - **J-2** reviewer decisions + notes and **J-3** revision triggers/reason —
 *    both read off the immutable version log (`detail.riwayat`), not re-entered.
 *  - **J-4** the auto-diff vs the previous version, fetched on demand (derived,
 *    Rule 4). RA-7 keeps this diff INTERNAL — it never appears on `/s/{token}`.
 */
import { useEffect, useState } from 'react';
import {
  getStrategiDiff,
  TRIGGER_REVISI_LABELS,
  type StrategiDetail,
  type StrategiDiff,
} from '@/lib/strategi';

interface Props {
  strategiId: string;
  detail: StrategiDetail;
}

function fmtTs(ts: string | null): string {
  if (ts === null) return '—';
  return new Date(ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function triggerLabel(kode: string): string {
  return TRIGGER_REVISI_LABELS.find((t) => t.value === kode)?.label ?? kode;
}

/** J-1 — the document header, all derived from the record. */
function HeaderJ1({ detail }: { detail: StrategiDetail }) {
  const rows: [string, string][] = [
    ['Versi', `v${detail.versi_no}`],
    ['Status', detail.status],
    ['Diajukan', fmtTs(detail.diajukan_pada)],
    ['Disetujui', fmtTs(detail.disetujui_pada)],
    ['Reviewer', detail.disetujui_oleh ?? '—'],
    ['AM pengisi', detail.created_by],
  ];
  return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="muted" style={{ padding: '2px 12px 2px 0', whiteSpace: 'nowrap' }}>
              {k}
            </td>
            <td style={{ padding: '2px 0' }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** J-2 + J-3 — the immutable version log; reviewer notes and revision reasons. */
function VersionLog({ detail }: { detail: StrategiDetail }) {
  if (detail.riwayat.length === 0) {
    return <p className="muted" style={{ fontSize: 13 }}>Belum ada peristiwa versi.</p>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: 13 }}>
      {detail.riwayat.map((e, i) => (
        <li key={i} style={{ padding: '6px 0', borderTop: i === 0 ? undefined : '1px solid var(--border, #eee)' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <code>v{e.versi_no}</code>
            <strong>{e.peristiwa}</strong>
            <span className="muted">· {e.aktor}</span>
            <span className="muted">· {fmtTs(e.created_at)}</span>
          </div>
          {e.catatan && <div style={{ marginTop: 2 }}>{e.catatan}</div>}
          {e.alasan_revisi && (
            <div style={{ marginTop: 2 }}>
              <span className="muted">Alasan revisi:</span> {e.alasan_revisi}
            </div>
          )}
          {e.trigger_revisi.length > 0 && (
            <div className="muted" style={{ marginTop: 2 }}>
              Trigger: {e.trigger_revisi.map(triggerLabel).join(', ')}
            </div>
          )}
          {e.asumsi_gugur.length > 0 && (
            <div className="muted" style={{ marginTop: 2 }}>
              Asumsi gugur: {e.asumsi_gugur.join(', ')}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** J-4 — the auto-diff vs the previous version (fetched; derived, never stored). */
function DiffJ4({ strategiId }: { strategiId: string }) {
  const [diff, setDiff] = useState<StrategiDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getStrategiDiff(strategiId)
      .then((d) => alive && setDiff(d))
      .catch(() => alive && setError('Gagal memuat ringkasan perubahan.'));
    return () => {
      alive = false;
    };
  }, [strategiId]);

  if (error) return <p className="muted" style={{ fontSize: 13 }}>{error}</p>;
  if (diff === null) return <p className="muted" style={{ fontSize: 13 }}>Memuat…</p>;
  if (!diff.ada_perbandingan) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        Versi pertama — tidak ada versi sebelumnya untuk dibandingkan.
      </p>
    );
  }
  if (diff.entri.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        Tidak ada perubahan terekam vs v{diff.versi_sebelumnya_no}.
      </p>
    );
  }
  return (
    <>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Perubahan vs v{diff.versi_sebelumnya_no} · internal saja (tidak tampil di tautan klien).
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        {diff.entri.map((e, i) => (
          <li key={i} style={{ padding: '2px 0' }}>
            <span className="muted">[{e.field_id}]</span> <strong>{e.label}</strong>:{' '}
            {e.jenis === 'skalar' ? (
              <>
                {e.sebelum ?? '(kosong)'} <span className="muted">→</span> {e.sesudah ?? '(kosong)'}
              </>
            ) : (
              <>
                {e.ditambah.length > 0 && <span>+{e.ditambah.length} ({e.ditambah.join(', ')}) </span>}
                {e.dihapus.length > 0 && <span>−{e.dihapus.length} ({e.dihapus.join(', ')}) </span>}
                {e.diubah > 0 && <span>{e.diubah} diubah</span>}
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        {id} · {title}
      </div>
      {children}
    </div>
  );
}

export default function SectionJ({ strategiId, detail }: Props) {
  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Seksi ini otomatis dari catatan versi — tidak ada yang perlu diisi.
      </p>
      <Block id="J-1" title="Versi, status, tanggal, AM">
        <HeaderJ1 detail={detail} />
      </Block>
      <Block id="J-2 / J-3" title="Riwayat versi: keputusan reviewer & alasan revisi">
        <VersionLog detail={detail} />
      </Block>
      <Block id="J-4" title="Ringkasan perubahan vs versi sebelumnya">
        <DiffJ4 strategiId={strategiId} />
      </Block>
    </div>
  );
}
