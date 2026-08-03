'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  DELETED_RECORD_STATUS,
  approveLeadDelete,
  claimLead,
  getLead,
  listLeadDeleteRequests,
  rejectLeadDelete,
  requestLeadDelete,
  type DeleteRequestQueueRow,
  type LeadDetail,
  type LeadAttemptRow,
} from '@/lib/leads';
import { isTerminalAttempt, leadProgress, nextStepLabel } from '@/lib/lead-progress';
import StatusBadge from '@/components/StatusBadge';
import { extractStatusLabel, summarizeJson } from '@/lib/audit';

interface AuditEntry {
  actor_employee_id: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

const DELETE_STATUS_LABELS: Record<string, string> = {
  pending: 'Menunggu ACC Head',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [leadDetail, setLeadDetail] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const detail = await getLead(id);
      setLeadDetail(detail);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadAudit = useCallback(async () => {
    setAuditError(null);
    try {
      const res = await api.get<{ data: AuditEntry[] }>(
        `/audit?entity_type=lead&entity_id=${encodeURIComponent(id)}`,
      );
      setAuditEntries(res.data);
    } catch (err) {
      setAuditError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadAudit();
  }, [load, loadAudit]);

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !leadDetail) {
    return (
      <div className="stack">
        <Link href="/leads" className="muted">
          &larr; Kembali ke Leads
        </Link>
        <div className="alert alertError" role="alert">
          {loadError ?? '[data tidak ditemukan]'}
        </div>
      </div>
    );
  }

  const { lead, attempts } = leadDetail;

  return (
    <div className="stack">
      <div>
        <Link href="/leads" className="muted">
          &larr; Kembali ke Leads
        </Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{lead.id}</h1>
          <p className="muted">{lead.lead_name}</p>
        </div>
        <StatusBadge status={lead.record_status} />
      </div>

      {/* Info Lead */}
      <section className="card">
        <div className="cardHeader">
          <h2>Info Lead</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              ID
            </div>
            <div>{lead.id}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Nama Lead
            </div>
            <div>{lead.lead_name}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Nomor Telepon
            </div>
            <div>{lead.phone_number || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Email
            </div>
            <div>{lead.email || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Sumber
            </div>
            <div>{lead.source}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Divisi Asal
            </div>
            <div>{lead.origin_division}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Campaign ID (Asal)
            </div>
            <div>{lead.origin_campaign_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Campaign ID (Touch Terakhir)
            </div>
            <div>{lead.last_touch_campaign_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Status
            </div>
            <div>
              <StatusBadge status={lead.record_status} />
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Winning Attempt ID
            </div>
            <div>{lead.winning_attempt_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Dibuat
            </div>
            <div>{formatDateTime(lead.created_at)}</div>
          </div>
        </div>
      </section>

      {/* Lanjutkan proses penjualan — jalan keluar dari halaman lead */}
      <SalesProcessPanel
        leadId={lead.id}
        recordStatus={lead.record_status}
        attempts={attempts}
        onClaimed={() => {
          load();
          loadAudit();
        }}
      />

      {/* Prospect Attempts (Kontes) */}
      <section className="card">
        <div className="cardHeader">
          <h2>Prospect Attempts (Kontes)</h2>
        </div>
        {attempts.length === 0 ? (
          <p className="muted">Belum ada attempt.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Langkah Berikutnya</th>
                  <th>Diklaim</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt: LeadAttemptRow) => (
                  <tr key={attempt.id}>
                    <td>
                      <Link href={`/sales/${attempt.id}`}>{attempt.id}</Link>
                    </td>
                    <td>{attempt.owner_nama}</td>
                    <td>
                      <StatusBadge status={attempt.status} />
                    </td>
                    <td>
                      {isTerminalAttempt(attempt.status)
                        ? 'Selesai'
                        : (nextStepLabel(attempt.status) ?? '—')}
                    </td>
                    <td>{formatDateTime(attempt.claimed_at)}</td>
                    <td>
                      <Link href={`/sales/${attempt.id}`} className="btn btnSecondary btnSm">
                        Buka
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Hapus lead — AJUKAN (sales) → ACC (Head) */}
      <DeletePanel
        leadId={lead.id}
        recordStatus={lead.record_status}
        winningAttemptId={lead.winning_attempt_id}
        originDivision={lead.origin_division}
        onDecided={() => {
          load();
          loadAudit();
        }}
      />

      {/* Histori Audit */}
      <section className="card">
        <div className="cardHeader">
          <h2>Histori</h2>
        </div>
        {auditError && <div className="alert alertError" role="alert">{auditError}</div>}
        {auditEntries.length === 0 ? (
          <p className="muted">Belum ada riwayat.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Aktor</th>
                  <th>Aksi</th>
                  <th>Sebelum</th>
                  <th>Sesudah</th>
                  <th>Waktu</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.map((entry, idx) => (
                  <tr key={`${entry.created_at}-${idx}`}>
                    <td>{entry.actor_employee_id}</td>
                    <td>{entry.action}</td>
                    <td>{extractStatusLabel(entry.before_json) ?? summarizeJson(entry.before_json)}</td>
                    <td>{extractStatusLabel(entry.after_json) ?? summarizeJson(entry.after_json)}</td>
                    <td>{formatDateTime(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proses Sales — jalan keluar dari halaman lead.
//
// Record lead TIDAK punya aksi lifecycle sendiri: menandai Contacted, mengisi
// Qualified Lead Form (data toko), negosiasi, dan closing semuanya hidup di
// prospect attempt (M0 §4–§6) di `/sales/{attemptId}`. Sebelum panel ini
// halaman lead adalah jalan buntu — attempt-nya hanya tampil sebagai ID
// telanjang di tabel kontes, tanpa satu kalimat pun yang bilang di sanalah
// prosesnya dilanjutkan.
//
// Panel ini TIDAK mengulang aksinya di sini. Menempelkan tombol transisi kedua
// pada halaman lead berarti dua permukaan untuk satu aturan yang sama; yang
// dibutuhkan pengguna cuma satu pintu yang jelas menuju langkah berikutnya.
// Gate-nya tetap milik server (`canWriteAttempt`, `decideClaim`, `sm_edges`) —
// `lead-progress.ts` hanya memilih afordansi mana yang digambar, dan penolakan
// server dirender verbatim.
// ---------------------------------------------------------------------------

function SalesProcessPanel({
  leadId,
  recordStatus,
  attempts,
  onClaimed,
}: {
  leadId: string;
  recordStatus: string;
  attempts: LeadAttemptRow[];
  onClaimed: () => void;
}) {
  const router = useRouter();
  const { employee, role } = useAuth();

  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const progress = leadProgress({
    recordStatus,
    attempts,
    employeeId: employee?.employee_id ?? null,
    role,
  });

  async function handleClaim() {
    setClaimError(null);
    setClaiming(true);
    try {
      const res = await claimLead(leadId);
      // Klaim melahirkan attempt baru — bawa pengguna langsung ke tempat
      // langkah berikutnya berada, bukan kembali ke halaman lead yang sama.
      onClaimed();
      router.push(`/sales/${res.attempt.id}`);
    } catch (err) {
      setClaimError(errorMessage(err));
      setClaiming(false);
    }
  }

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Proses Sales</h2>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Status penjualan bergerak di <strong>prospect attempt</strong>, bukan di record lead. Penandaan
        Contacted, Qualified Lead Form (data toko), negosiasi, sampai closing semuanya ada di halaman
        attempt.
      </p>

      {claimError && <div className="alert alertError" role="alert">{claimError}</div>}

      {progress.attempt && (
        <div className="stack" style={{ gap: 10, marginTop: 8 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge status={progress.attempt.status} />
            <span className="muted" style={{ fontSize: 13 }}>
              {progress.attempt.id} &middot;{' '}
              {progress.isMine ? 'attempt Anda' : `owner: ${progress.attempt.owner_nama}`}
            </span>
          </div>
          <div>
            Langkah berikutnya: <strong>{progress.nextStep ?? '—'}</strong>
          </div>
          <div>
            <Link href={`/sales/${progress.attempt.id}`} className="btn btnPrimary">
              {progress.canAct && progress.nextStep
                ? `Lanjutkan: ${progress.nextStep}`
                : 'Buka Prospect Attempt'}
            </Link>
          </div>
          {!progress.canAct && (
            <p className="muted" style={{ fontSize: 13 }}>
              Attempt ini dikerjakan {progress.attempt.owner_nama}; Anda membukanya sebagai pembaca.
            </p>
          )}
        </div>
      )}

      {progress.canClaim && (
        <div className="stack" style={{ gap: 10, marginTop: progress.attempt ? 16 : 8 }}>
          <p style={{ margin: 0 }}>
            {progress.attempt
              ? 'Lead ini masih di pool — Anda boleh mengajukan attempt sendiri (kontes; pemenang ditentukan saat closing).'
              : 'Belum ada attempt aktif pada lead ini. Klaim untuk mulai memprosesnya.'}
          </p>
          <div>
            <button type="button" className="btn btnPrimary" disabled={claiming} onClick={handleClaim}>
              {claiming ? 'Memproses...' : 'Klaim Lead'}
            </button>
          </div>
        </div>
      )}

      {!progress.attempt && !progress.canClaim && (
        <div className="emptyState">Tidak ada attempt aktif yang bisa dilanjutkan pada lead ini.</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hapus lead ber-ACC Head (keputusan pemilik 2026-07-29, docs/DECISIONS.md).
//
// Dua pintu: sales MENGAJUKAN dengan alasan wajib, Head meng-ACC. Tidak ada
// tombol "Hapus" yang langsung menghapus — dan tidak ada baris yang dibuang;
// ACC mendorong lead ke state terminal `[Deleted]` lewat sm_transition.
//
// Gate-nya milik SERVER. Panel ini menyembunyikan aksi yang sudah pasti mustahil
// (klien / sudah terhapus / bukan Head divisi asal), tapi TIDAK mencoba
// mereplikasi `canRequestDelete` — koneksi "pembuat lead" tidak ada di kontrak
// GET /leads/{id}, jadi form pengajuan ditampilkan optimistis dan penolakan
// dirender verbatim dari server. Menebak di sini hanya menghasilkan dua sumber
// kebenaran yang bisa berbeda.
// ---------------------------------------------------------------------------

function DeletePanel({
  leadId,
  recordStatus,
  winningAttemptId,
  originDivision,
  onDecided,
}: {
  leadId: string;
  recordStatus: string;
  winningAttemptId: string | null;
  originDivision: string;
  onDecided: () => void;
}) {
  const { role } = useAuth();

  const isDirector = Boolean(role?.director);
  // Cermin permission.isLead(actor, originDivision) — Head divisi ASAL lead;
  // Director di mana saja. Sales Head TIDAK bisa meng-ACC lead ber-origin
  // Marketing, jadi divisinya dibandingkan, bukan cuma level-nya.
  const isHead = isDirector || (role?.level === 'lead' && role?.division === originDivision);
  // Cermin permission.canWrite — Director selalu; sisanya butuh scope divisi,
  // jadi OD murni (tanpa divisi) tidak bisa menulis. Tidak ditambah cek `od`
  // terpisah: OD berlapis di atas akun berdivisi memang menulis dari scope itu.
  const canWrite = isDirector || (role?.division ?? '') !== '';

  // Cermin decideDeleteRequest untuk dua kasus yang SUDAH terbaca dari kontrak
  // detail; sisanya (pending ganda) datang dari daftar request di bawah.
  const isClient = recordStatus === '[Closed-Success]' || (winningAttemptId ?? '') !== '';
  const isDeleted = recordStatus === DELETED_RECORD_STATUS;

  const [requests, setRequests] = useState<DeleteRequestQueueRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [note, setNote] = useState('');
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await listLeadDeleteRequests(leadId);
      setRequests(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = requests?.find((r) => r.status === 'pending') ?? null;

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await requestLeadDelete(leadId, reason);
      setReason('');
      setNotice('Permintaan hapus diajukan — menunggu ACC Head.');
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecide(reqId: string, approve: boolean) {
    setFormError(null);
    setNotice(null);
    setDecidingId(reqId);
    try {
      if (approve) {
        await approveLeadDelete(reqId, note);
        setNotice('Permintaan disetujui — lead dipindahkan ke [Deleted].');
      } else {
        await rejectLeadDelete(reqId, note);
        setNotice('Permintaan ditolak — lead dibiarkan utuh.');
      }
      setNote('');
      await load();
      // Status lead & audit-nya berubah pada ACC, jadi muat ulang induknya.
      onDecided();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Hapus Lead</h2>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Hapus wajib di-ACC Head divisi asal lead ({originDivision || '—'}). Baris lead tidak pernah
        dibuang &mdash; ACC memindahkannya ke status terminal <code>[Deleted]</code> dan seluruh
        riwayat serta prospect attempt-nya tetap utuh.
      </p>

      {loadError && <div className="alert alertError" role="alert">{loadError}</div>}
      {formError && <div className="alert alertError" role="alert">{formError}</div>}
      {notice && <div className="alert alertSuccess" role="status">{notice}</div>}

      {isClient && (
        <div className="alert alertInfo" role="status">
          [lead sudah menjadi klien, tidak bisa dihapus]
        </div>
      )}
      {isDeleted && (
        <div className="alert alertInfo" role="status">
          [lead sudah dihapus]
        </div>
      )}

      {/* Panel ACC Head — hanya saat ada yang bisa ditindak. */}
      {pending && isHead && !isDeleted && (
        <div className="stack" style={{ marginTop: 12 }}>
          <h3 style={{ margin: 0 }}>Perlu keputusan Anda</h3>
          <p>
            <strong>{pending.requested_by_nama}</strong> mengajukan hapus pada{' '}
            {formatDateTime(pending.created_at)}.
          </p>
          <p>
            Alasan: <em>{pending.reason}</em>
          </p>
          <div className="field">
            <label htmlFor="delete-note">Catatan Keputusan (opsional)</label>
            <input id="delete-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btnPrimary btnSm"
              disabled={decidingId !== null}
              onClick={() => handleDecide(pending.id, true)}
            >
              {decidingId === pending.id ? 'Memproses...' : 'Setujui Hapus'}
            </button>
            <button
              type="button"
              className="btn btnSecondary btnSm"
              disabled={decidingId !== null}
              onClick={() => handleDecide(pending.id, false)}
            >
              Tolak
            </button>
          </div>
        </div>
      )}

      {pending && !isHead && (
        <div className="alert alertInfo" role="status">
          Permintaan hapus sedang menunggu ACC Head divisi {pending.origin_division}.
        </div>
      )}

      {/* Form AJUKAN — tidak ada pending, lead masih bisa dihapus, aktor bisa menulis. */}
      {!pending && !isClient && !isDeleted && canWrite && (
        <form className="form" onSubmit={handleRequest} style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="delete-reason">Alasan Hapus (wajib)</label>
            <input
              id="delete-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="mis. lead uji coba, duplikat salah input"
            />
          </div>
          <div>
            <button type="submit" className="btn btnSecondary btnSm" disabled={submitting}>
              {submitting ? 'Memproses...' : 'Ajukan Hapus'}
            </button>
          </div>
        </form>
      )}

      {/* Riwayat permintaan — termasuk yang sudah diputuskan. */}
      {requests && requests.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Alasan</th>
                <th>Status</th>
                <th>Diajukan</th>
                <th>Diputuskan</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.reason}</td>
                  <td>{DELETE_STATUS_LABELS[r.status] ?? r.status}</td>
                  <td>
                    {r.requested_by_nama}
                    <br />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatDateTime(r.created_at)}
                    </span>
                  </td>
                  <td>
                    {r.resolved_at ? (
                      <>
                        {r.resolved_by_nama || '—'}
                        <br />
                        <span className="muted" style={{ fontSize: 12 }}>
                          {formatDateTime(r.resolved_at)}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{r.decision_note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requests && requests.length === 0 && !canWrite && (
        <div className="emptyState">Belum ada permintaan hapus.</div>
      )}
    </section>
  );
}
