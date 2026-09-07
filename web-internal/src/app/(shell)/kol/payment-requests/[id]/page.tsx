'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  canFinanceAction,
  getPaymentRequest,
  isDirector,
  isKolDivision,
  isODOnly,
  payPaymentRequest,
  paymentRequestBadgeTone,
  receivePaymentRequest,
  rejectPaymentRequest,
  type PaymentRequest,
} from '@/lib/kol';
import { createPermintaan } from '@/lib/permintaan';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function KolPaymentRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Receive / Pay — tanpa body, satu slot pending/error bersama.
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reject (reason wajib)
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // A-2 — "Ajukan ke Finance": mencetak Permintaan (REQ-) bertujuan Finance
  // supaya CPR ini muncul di ANTREAN mereka, bukan cuma bisa dibuka kalau
  // id-nya sudah diketahui. Itu inti keluhan Finance #2.
  const [ajukanBusy, setAjukanBusy] = useState(false);
  const [ajukanError, setAjukanError] = useState<string | null>(null);
  const [ajukanOk, setAjukanOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await getPaymentRequest(id);
      setRequest(r);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Mengajukan CPR ini ke antrean Finance.
   *
   * Payload-nya hanya `jenis` + `cpr_id` + `judul` — TANPA `brief_id`, dan itu
   * bukan kelalaian: halaman ini memang tidak punya `brief_id` (`PaymentRequest`
   * hanya membawa `booking_id`), dan servernya menurunkan seluruh rantai
   * klien dari CPR-nya sendiri (`resolveParent`). Mengirim `brief_id` dari sini
   * berarti menebak sesuatu yang sudah pasti di sisi server.
   *
   * Pengajuan ganda dijaga server (`MSG_CPA_SUDAH_BERJALAN` → 409), bukan oleh
   * tombol yang disembunyikan: dua orang KOL di dua tab tidak bisa saling
   * melihat state tombol satu sama lain.
   */
  async function handleAjukanKeFinance() {
    if (!request) return;
    setAjukanError(null);
    setAjukanOk(null);
    setAjukanBusy(true);
    try {
      const req = await createPermintaan({
        jenis: 'Creator Payment Approval',
        judul: `Approval pembayaran creator ${request.id} — ${request.amount_display}`,
        cpr_id: request.id,
      });
      setAjukanOk(`${req.id} masuk antrean Finance, jatuh tempo ${req.due_date}.`);
    } catch (err) {
      setAjukanError(errorMessage(err));
    } finally {
      setAjukanBusy(false);
    }
  }

  async function handleReceive() {
    setActionError(null);
    setActionPending('receive');
    try {
      await receivePaymentRequest(id);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionPending(null);
    }
  }

  async function handlePay() {
    if (!window.confirm('Konfirmasi pembayaran ke kreator untuk Payment Request ini? Status [Paid] bersifat final.')) {
      return;
    }
    setActionError(null);
    setActionPending('pay');
    try {
      await payPaymentRequest(id);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionPending(null);
    }
  }

  async function handleReject(e: FormEvent) {
    e.preventDefault();
    setRejectError(null);
    setRejectSubmitting(true);
    try {
      await rejectPaymentRequest(id, rejectReason.trim());
      setRejectReason('');
      await load();
    } catch (err) {
      setRejectError(errorMessage(err));
    } finally {
      setRejectSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !request) {
    return (
      <div className="stack">
        <Link href="/kol" className="muted">&larr; Kembali ke KOL</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Payment Request tidak ditemukan.'}</div>
      </div>
    );
  }

  const canFinance = canFinanceAction(role);
  const isRequested = request.status === '[Requested]';
  const isReceived = request.status === '[Received by Finance]';
  // Mirror `req.canCreate('Creator Payment Approval')` — divisi KOL yang
  // mengajukan (dia yang mencetak CPR-nya), Director selalu boleh, dan OD
  // tetap read-only (Phase 0 §4). Server tetap otoritas terakhir.
  const canAjukan = !isODOnly(role) && (isDirector(role) || isKolDivision(role));

  return (
    <div className="stack">
      <div>
        <Link href="/kol" className="muted">&larr; Kembali ke KOL</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{request.id}</h1>
          <p className="muted">
            Booking: <Link href={`/kol/bookings/${request.booking_id}`}>{request.booking_id}</Link>
          </p>
        </div>
        <span className={`badge badge-${paymentRequestBadgeTone(request.status)}`}>{request.status}</span>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Detail Payment Request</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Amount</div>
            <div>{request.amount_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Detail Pembayaran</div>
            <div>{request.payment_details}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Diminta Oleh</div>
            <div>{request.requested_by}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat Pada</div>
            <div>{formatDateTime(request.created_at)}</div>
          </div>
          {request.status === '[Paid]' && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Dibayar Oleh</div>
              <div>{request.paid_by || '—'}</div>
            </div>
          )}
          {request.status === '[Rejected]' && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Alasan Penolakan</div>
              <div>{request.rejection_reason || '—'}</div>
            </div>
          )}
        </div>
      </section>

      {/* A-2 — hanya saat masih `[Requested]`: sesudah Finance menerimanya,
          mereka sudah melihatnya dan sebuah pengajuan tidak menambah apa pun. */}
      {canAjukan && isRequested && (
        <section className="card">
          <div className="cardHeader">
            <h2>Ajukan ke Finance</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Mencetak Permintaan (REQ-) supaya pembayaran ini muncul di antrean Finance dengan
            jatuh tempo 1 hari kerja — bukan hanya bisa dibuka kalau id-nya sudah diketahui.
          </p>
          {ajukanError && <div className="alert alertError" role="alert">{ajukanError}</div>}
          {ajukanOk && <div className="alert alertInfo" role="status">{ajukanOk}</div>}
          <div>
            <button
              type="button"
              className="btn btnPrimary"
              disabled={ajukanBusy || ajukanOk !== null}
              onClick={handleAjukanKeFinance}
            >
              {ajukanBusy ? 'Mengajukan...' : 'Ajukan ke Finance'}
            </button>
          </div>
        </section>
      )}

      {canFinance && (isRequested || isReceived) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi Finance</h2>
          </div>
          {actionError && <div className="alert alertError" role="alert">{actionError}</div>}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {isRequested && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={actionPending !== null}
                onClick={handleReceive}
              >
                {actionPending === 'receive' ? 'Memproses...' : 'Terima (Receive)'}
              </button>
            )}
            {isReceived && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={actionPending !== null}
                onClick={handlePay}
              >
                {actionPending === 'pay' ? 'Memproses...' : 'Bayar (Pay)'}
              </button>
            )}
          </div>

          {isReceived && (
            <form className="form" onSubmit={handleReject} style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Reject (kembalikan ke KOL)</h3>
              {rejectError && <div className="alert alertError" role="alert">{rejectError}</div>}
              <div className="field">
                <label htmlFor="reject-reason">Alasan Penolakan</label>
                <input
                  id="reject-reason"
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
              <div>
                <button type="submit" className="btn btnDanger" disabled={rejectSubmitting}>
                  {rejectSubmitting ? 'Menyimpan...' : 'Tolak Payment Request'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {!canFinance && (isRequested || isReceived) && (
        <div className="alert alertInfo" role="status">
          Hanya divisi Finance atau Direktur yang dapat memproses Payment Request ini.
        </div>
      )}
    </div>
  );
}
