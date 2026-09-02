'use client';

/**
 * "Perlu Persetujuan Saya" — kotak masuk persetujuan gabungan untuk Sales
 * lead/SPV, Account lead, KOL Team Leader, dan Director: setiap antrian
 * request-for-approval di sistem, yang pending saja, dalam satu halaman
 * (keputusan pemilik 2026-08-31 — mulai dari Sales + Renewal, lalu melebar ke
 * ~8 antrian nyata).
 *
 * "Antrian nyata" = STATUS pending yang tersimpan dan harus ditindak orang
 * lain. Plan Gate dan verdict Interview sengaja TIDAK masuk: keduanya keputusan
 * sinkron sekali panggil tanpa state "menunggu persetujuan" yang tersimpan
 * (`docs/DECISIONS.md` 2026-08-31), jadi tidak ada yang bisa didaftar.
 *
 * ---------------------------------------------------------------------------
 * REVAMP (2026-09-02, permintaan pemilik) — memutuskan DI SINI, bukan di sana.
 *
 * Versi pertama halaman ini hanya delapan tabel berisi tautan: yang memutuskan
 * tetap harus membuka satu tab per baris, dan dua fakta yang paling menentukan
 * — ALASAN pengajuan dan, pada negosiasi harga, DARI berapa JADI berapa — tidak
 * pernah terlihat sebelum tab itu terbuka. Sekarang:
 *
 *   1. Setiap permintaan jadi satu kartu yang memuat fakta keputusannya
 *      (pengaju, waktu, alasan) tanpa perlu klik.
 *   2. Tombol Setujui (hijau) / Tolak (merah) ada di kartu itu sendiri.
 *   3. Antrian uang (negosiasi sales, renewal/cross-sell) menampilkan tabel
 *      "harga standar → harga diajukan + selisih" — persis yang M0 §6 minta
 *      ("proposed vs. standard values per service"), yang sebelumnya hanya ada
 *      di halaman detail.
 *
 * Yang TIDAK berubah, dan tidak boleh berubah: halaman ini tetap nol aturan
 * baru. Setiap tombol memanggil endpoint yang sudah ada — endpoint yang sama
 * yang dipakai halaman detailnya — dengan gate role yang sama, dan servernya
 * tetap otoritas terakhir. Gate di FE cuma menyembunyikan tombol yang pasti
 * ditolak; pesan `[...]` dari engine ditampilkan apa adanya.
 *
 * Sumber tiap antrian (semuanya read yang SUDAH ada dan sudah ter-scope):
 *   - Negosiasi Sales     `sales.listAttempts` (?status=)  → `/attempts/{id}/negotiation/decision`
 *   - Renewal/Cross-Sell  `renewal.listRenewals` (?status=) → `/clients/{c}/renewals/{r}/decision`
 *   - Finance TCR         `finance.schemeChangeRequests`   → `/transaction-changes/{id}/approve|reject`
 *   - Hapus Lead          `leads.deleteRequestQueue`       → `/leads/delete-requests/{id}/approve|reject`
 *   - Hold Service        `client.pendingHoldRequests`     → `/services/{id}/hold/approve|reject`
 *   - Block Task (M12)    `task.pendingBlockRequests`      → `/tasks|assets/{id}/block/{req}/approve|reject`
 *   - Eskalasi KOL        `kol.pendingEscalations`         → `/bookings/{id}/continue|drop`
 *   - Review Strategi     `account.pendingStrategyReviews` → `/strategies/{id}/approve|request-revision|approve-gmv`
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { MasterService } from '@/lib/types';
import { formatIDR } from '@/lib/money';
import { buildComparison, type CatalogEntry, type ProposedLine } from '@/lib/persetujuan';
import { decideNegotiation, getAttempt, listAttempts, type AttemptDetail, type AttemptRow } from '@/lib/sales';
import {
  JENIS_PERPANJANGAN,
  canDecideRenewalUi,
  isSalesLead,
  decideRenewal,
  getRenewalDetail,
  listAllRenewals,
  type RenewalDetail,
  type RenewalListRow,
} from '@/lib/renewal';
import {
  approveSchemeChange,
  listSchemeChangeQueue,
  rejectSchemeChange,
  type SchemeChangeRequest,
} from '@/lib/finance';
import {
  DELETED_RECORD_STATUS,
  approveLeadDelete,
  listDeleteRequests,
  rejectLeadDelete,
  type DeleteRequestQueueRow,
} from '@/lib/leads';
import {
  approveHoldService,
  listPendingHoldRequests,
  rejectHoldService,
  type PendingHoldRequest,
} from '@/lib/clients';
import {
  approveBlock,
  getTeamPortal,
  rejectBlock,
  type PendingBlockRequest,
} from '@/lib/tasks';
import {
  canDropBooking,
  continueEscalation,
  dropBooking,
  getBooking,
  isODOnly,
  listPendingEscalations,
  type Booking,
  type PendingEscalation,
} from '@/lib/kol';
import {
  GMV_ADJ_PENDING,
  STRATEGY_SUBMITTED,
  approveGmvAdjustment,
  approveStrategy,
  canApproveStrategy,
  isAccountLead,
  getStrategy,
  listPendingStrategyReviews,
  requestStrategyRevision,
  type PendingStrategyReview,
  type Strategy,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';
import ApprovalCard, { MetaGrid, ReasonBlock } from '@/components/persetujuan/ApprovalCard';
import DecisionActions, { type DecisionKind } from '@/components/persetujuan/DecisionActions';
import PriceComparison from '@/components/persetujuan/PriceComparison';

const ATTEMPT_PENDING = 'Negotiation - Pending Approval';
const RENEWAL_PENDING = 'Pending Approval';

/**
 * Berapa kartu teratas tiap antrian yang rinciannya dibuka (dan dimuat) sendiri.
 * Antrian persetujuan pada dasarnya daftar tugas: kalau isinya tiga, tidak ada
 * alasan menyuruh orang mengklik tiga kali. Kalau isinya lima puluh, menembak
 * lima puluh GET sekaligus jauh lebih buruk daripada satu klik.
 */
const AUTO_OPEN = 3;

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Pembungkus section — judul + jumlah + anchor untuk lompatan dari ringkasan.
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  count,
  hint,
  children,
}: {
  id: string;
  title: string;
  count: number;
  hint?: ReactNode;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="card" id={id} style={{ scrollMarginTop: 16 }}>
      <div className="cardHeader">
        <h2>
          {title} <span className="badge badge-amber">{count}</span>
        </h2>
      </div>
      {hint && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          {hint}
        </p>
      )}
      <div className="stack" style={{ gap: 10 }}>
        {children}
      </div>
    </section>
  );
}

/** Kalimat yang muncul menggantikan tombol untuk yang boleh melihat tapi tidak boleh memutuskan. */
function WaitingNote({ who }: { who: string }) {
  return (
    <p className="muted" style={{ fontSize: 12 }}>
      Menunggu keputusan {who}. Anda melihat baris ini karena pengajuannya masuk lingkup Anda.
    </p>
  );
}

/**
 * Hook mungil pengurus satu keputusan baris: state busy + error, dan sekali
 * berhasil ia memicu reload antrian. Diulang delapan kali kalau tidak dipisah.
 */
function useDecision(onDone: () => void) {
  const [busy, setBusy] = useState<DecisionKind | 'extra' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (kind: DecisionKind | 'extra', fn: () => Promise<unknown>) => {
      setBusy(kind);
      setError(null);
      try {
        await fn();
        onDone();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [onDone],
  );
  return { busy, error, run };
}

// ---------------------------------------------------------------------------
// 1. Negosiasi Sales (M0 §6)
// ---------------------------------------------------------------------------

function NegotiationCard({
  row,
  catalog,
  canDecide,
  defaultOpen,
  onDone,
}: {
  row: AttemptRow;
  catalog: CatalogEntry[];
  canDecide: boolean;
  defaultOpen: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { busy, error, run } = useDecision(onDone);

  useEffect(() => {
    if (!open || detail || detailError) return;
    let alive = true;
    getAttempt(row.id)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setDetailError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [open, detail, detailError, row.id]);

  // Versi TERAKHIR adalah yang sedang diminta persetujuannya; versi sebelumnya
  // hanya riwayat. Membandingkan versi yang salah = menyetujui harga yang salah.
  const latest = detail && detail.proposals.length > 0 ? detail.proposals[detail.proposals.length - 1] : null;
  const qf = detail?.qualified_form ?? null;

  const comparison = useMemo(() => {
    if (!latest) return null;
    const bySvc = new Map((qf?.services ?? []).map((s) => [s.master_service_id, s]));
    const lines: ProposedLine[] = latest.lines.map((l) => {
      const snap = bySvc.get(l.master_service_id);
      return {
        masterServiceId: l.master_service_id,
        name: l.name || snap?.name || '',
        proposedPrice: l.proposed_price,
        // Pembandingnya SUBTOTAL snapshot Qualified (harga standar × qty), bukan
        // harga satuan: `proposed_price` juga total per baris, jadi menaruh harga
        // satuan di sebelahnya akan melaporkan diskon palsu untuk qty > 1. Baris
        // yang baru ditambah saat negosiasi tidak ada di snapshot — jatuh ke MSL
        // hidup lewat `buildComparison`.
        standardPrice: snap?.subtotal ?? snap?.standard_price ?? undefined,
        commissionRule: l.commission_rule,
        paymentTerms: l.payment_terms,
        quantity: snap?.quantity ?? null,
      };
    });
    return buildComparison(lines, catalog);
  }, [latest, qf, catalog]);

  const detailBody = (
    <div className="stack" style={{ gap: 10 }}>
      {detailError && (
        <div className="alert alertError" role="alert">
          {detailError}
        </div>
      )}
      {!detail && !detailError && <p className="muted">Memuat rincian...</p>}
      {qf && (
        <MetaGrid
          items={[
            { label: 'Toko', value: qf.toko },
            { label: 'Kategori', value: qf.kategori },
            { label: 'Platform', value: qf.platform },
            { label: 'GMV baseline', value: formatIDR(qf.gmv_baseline) },
            { label: 'Target GMV', value: formatIDR(qf.target_gmv) },
            { label: 'Marketing budget', value: qf.marketing_budget ? formatIDR(qf.marketing_budget) : '—' },
          ]}
        />
      )}
      {comparison && <PriceComparison comparison={comparison} />}
      {detail && detail.proposals.length > 1 && (
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Riwayat versi
          </div>
          <ul style={{ fontSize: 12, paddingLeft: 18, marginTop: 4 }}>
            {detail.proposals.map((p) => (
              <li key={p.id}>
                v{p.version_no} &middot; {p.proposed_by_nama || p.proposed_by} &middot; {formatDateTime(p.created_at)}
                {p.decision_note ? ` — "${p.decision_note}"` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <ApprovalCard
      id={row.id}
      href={`/sales/${row.id}`}
      title={
        <>
          {row.lead_name} &middot; {row.phone_number}
        </>
      }
      badge={<StatusBadge status={row.status} />}
      meta={[
        { label: 'Sales (pengaju)', value: row.owner_nama || row.owner_employee_id || '—' },
        { label: 'Sumber lead', value: row.source || '—' },
        { label: 'Versi proposal', value: latest ? `v${latest.version_no}` : '—' },
        { label: 'Diajukan', value: latest ? formatDateTime(latest.created_at) : formatDate(row.created_at) },
        {
          label: 'Selisih total',
          value: comparison
            ? comparison.totalDelta === null
              ? '—'
              : `${formatIDR(comparison.totalDelta)} dari ${formatIDR(comparison.totalStandard)}`
            : 'Buka rincian',
        },
      ]}
      detail={detailBody}
      detailLabel="Rincian harga & proposal"
      open={open}
      onToggle={setOpen}
    >
      {canDecide ? (
        <DecisionActions
          fieldId={`nego-note-${row.id}`}
          busy={busy}
          error={error}
          noteLabel="Catatan keputusan (wajib untuk Tolak & Revisi)"
          approveLabel="Setujui negosiasi"
          rejectLabel="Tolak"
          confirmText={(k) =>
            k === 'approve'
              ? `Setujui harga negosiasi ${row.id} (${row.lead_name})? Harga terkunci dan closing terbuka.`
              : `Tolak negosiasi ${row.id}? Sales boleh mengajukan proposal baru atau menandai Closed-Lost.`
          }
          onDecide={(kind, note) =>
            run(kind, () => decideNegotiation(row.id, kind === 'approve' ? 'approve' : 'reject', note))
          }
          extra={
            <button
              type="button"
              className="btn btnSecondary"
              disabled={busy !== null}
              onClick={() => {
                const note = window.prompt('Catatan counter offer (wajib):') ?? '';
                if (note.trim() === '') return;
                run('extra', () => decideNegotiation(row.id, 'revise', note.trim()));
              }}
            >
              {busy === 'extra' ? 'Memproses...' : 'Revisi / Counter'}
            </button>
          }
          hint="Setujui = harga terkunci, Proceed to Closing terbuka. Revisi = Sales menerima counter atau mengajukan versi baru."
        />
      ) : (
        <WaitingNote who="Sales Lead / Director" />
      )}
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// 2. Renewal / Cross-Sell (R-03)
// ---------------------------------------------------------------------------

function RenewalCard({
  row,
  catalog,
  canDecide,
  defaultOpen,
  onDone,
}: {
  row: RenewalListRow;
  catalog: CatalogEntry[];
  canDecide: boolean;
  defaultOpen: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [detail, setDetail] = useState<RenewalDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { busy, error, run } = useDecision(onDone);

  useEffect(() => {
    if (!open || detail || detailError) return;
    let alive = true;
    getRenewalDetail(row.client_id, row.id)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setDetailError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [open, detail, detailError, row.client_id, row.id]);

  const comparison = useMemo(() => {
    if (!detail) return null;
    // Renewal tidak punya snapshot Qualified: pembandingnya MSL yang berlaku
    // hari ini, yang memang harga standar yang sedang ditawar.
    return buildComparison(
      detail.lines.map((l) => ({
        masterServiceId: l.master_service_id,
        proposedPrice: l.proposed_price,
        commissionRule: l.commission_rule,
      })),
      catalog,
    );
  }, [detail, catalog]);

  const detailBody = (
    <div className="stack" style={{ gap: 10 }}>
      {detailError && (
        <div className="alert alertError" role="alert">
          {detailError}
        </div>
      )}
      {!detail && !detailError && <p className="muted">Memuat rincian...</p>}
      {comparison && <PriceComparison comparison={comparison} showPaymentTerms={false} />}
      {row.decision_note && <ReasonBlock label="Catatan keputusan sebelumnya" text={row.decision_note} />}
    </div>
  );

  return (
    <ApprovalCard
      id={row.id}
      href={`/clients/${row.client_id}#renewal`}
      title={
        <>
          {row.client_toko} &middot; {row.client_nama_pic}
        </>
      }
      badge={<StatusBadge status={row.status} />}
      meta={[
        { label: 'Jenis', value: row.jenis === JENIS_PERPANJANGAN ? 'Perpanjangan' : 'Cross Sell' },
        { label: 'Diajukan oleh', value: row.proposed_by_nama || row.proposed_by },
        { label: 'Tanggal', value: formatDateTime(row.created_at) },
        {
          label: 'Selisih total',
          value: comparison
            ? comparison.totalDelta === null
              ? '—'
              : `${formatIDR(comparison.totalDelta)} dari ${formatIDR(comparison.totalStandard)}`
            : 'Buka rincian',
        },
      ]}
      detail={detailBody}
      detailLabel="Rincian harga"
      open={open}
      onToggle={setOpen}
    >
      {canDecide ? (
        <DecisionActions
          fieldId={`rnw-note-${row.id}`}
          busy={busy}
          error={error}
          approveLabel="Setujui penawaran"
          rejectLabel="Tolak"
          confirmText={(k) =>
            k === 'approve'
              ? `Setujui ${row.id} untuk ${row.client_toko}? Setelah ini Sales boleh mengeksekusi kontraknya.`
              : `Tolak ${row.id}? Sales boleh mengajukan proposal baru.`
          }
          onDecide={(kind, note) => run(kind, () => decideRenewal(row.client_id, row.id, kind, note))}
          hint="Menyetujui belum membuat kontrak — eksekusi (CTR/SVC/TRX) tetap langkah terpisah di halaman klien."
        />
      ) : (
        <WaitingNote who="Sales Lead / Director" />
      )}
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// 3. Finance — Perubahan Skema Pembayaran (TCR, M5-OA-7)
// ---------------------------------------------------------------------------

function SchemeChangeCard({
  row,
  canDecide,
  defaultOpen,
  onDone,
}: {
  row: SchemeChangeRequest;
  canDecide: boolean;
  defaultOpen: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { busy, error, run } = useDecision(onDone);

  const total = row.schedule.reduce((sum, s) => sum + Number(s.amount || 0), 0);

  return (
    <ApprovalCard
      id={row.id}
      href={`/finance/transactions/${row.transaction_id}`}
      title={row.toko || row.client_id || row.transaction_id}
      badge={<span className="badge badge-amber">Menunggu Director</span>}
      meta={[
        {
          label: 'Skema',
          value: (
            <>
              <span className="muted">{row.from_scheme}</span> → <strong>{row.to_scheme}</strong>
            </>
          ),
        },
        { label: 'Sisa tagihan', value: formatIDR(row.amount_outstanding) },
        { label: 'Nilai kontrak', value: formatIDR(row.total_agreed_value) },
        { label: 'Status bayar', value: row.payment_status || '—' },
        { label: 'Diajukan oleh', value: row.requested_by_nama || row.requested_by },
        { label: 'Tanggal', value: formatDateTime(row.created_at) },
      ]}
      reason={{ label: 'Alasan perubahan skema', text: row.reason }}
      detail={
        <div className="stack" style={{ gap: 8 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Termin pengganti</th>
                  <th>Nominal</th>
                  <th>Jatuh tempo</th>
                </tr>
              </thead>
              <tbody>
                {row.schedule.map((s, i) => (
                  <tr key={`${s.due_date}-${i}`}>
                    <td>#{i + 1}</td>
                    <td>{formatIDR(s.amount)}</td>
                    <td>{formatDate(s.due_date)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 700 }}>Total jadwal</td>
                  <td style={{ fontWeight: 700 }}>{formatIDR(total)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {/* Σ jadwal baru HARUS sama dengan sisa tagihan (termin yang sudah
                        terverifikasi tidak pernah disentuh). Selisih di sini berarti
                        pengajuannya salah hitung — dan itu fakta yang menentukan. */}
                    {Math.abs(total - Number(row.amount_outstanding || 0)) < 0.005
                      ? 'Cocok dengan sisa tagihan'
                      : `Tidak cocok dengan sisa tagihan (${formatIDR(row.amount_outstanding)})`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      }
      detailLabel="Jadwal termin pengganti"
      open={open}
      onToggle={setOpen}
    >
      {canDecide ? (
        <DecisionActions
          fieldId={`tcr-note-${row.id}`}
          busy={busy}
          error={error}
          approveLabel="Setujui perubahan"
          rejectLabel="Tolak"
          confirmText={(k) =>
            k === 'approve'
              ? `Setujui ${row.id}? Jadwal termin transaksi ${row.transaction_id} diganti dengan jadwal di atas.`
              : `Tolak ${row.id}? Jadwal lama tetap berlaku.`
          }
          onDecide={(kind, note) =>
            run(kind, () => (kind === 'approve' ? approveSchemeChange(row.id, note) : rejectSchemeChange(row.id, note)))
          }
          hint="Termin yang sudah terverifikasi tidak ikut berubah — hanya yang masih terutang."
        />
      ) : (
        <WaitingNote who="Director" />
      )}
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// 4. Permintaan Hapus Lead (M1)
// ---------------------------------------------------------------------------

function LeadDeleteCard({
  row,
  canDecide,
  onDone,
}: {
  row: DeleteRequestQueueRow;
  canDecide: boolean;
  onDone: () => void;
}) {
  const { busy, error, run } = useDecision(onDone);
  return (
    <ApprovalCard
      id={row.id}
      href={`/leads/${row.lead_id}`}
      title={
        <>
          {row.lead_name} &middot; {row.phone_number}
        </>
      }
      badge={<span className="badge badge-amber">Menunggu ACC</span>}
      meta={[
        { label: 'Lead', value: row.lead_id },
        { label: 'Divisi asal', value: row.origin_division || '—' },
        { label: 'Status lead', value: row.record_status || '—' },
        { label: 'Diajukan oleh', value: row.requested_by_nama || row.requested_by },
        { label: 'Tanggal', value: formatDateTime(row.created_at) },
      ]}
      reason={{ label: 'Alasan penghapusan', text: row.reason }}
    >
      {canDecide ? (
        <DecisionActions
          fieldId={`ldr-note-${row.id}`}
          busy={busy}
          error={error}
          approveLabel="Setujui hapus"
          rejectLabel="Tolak"
          confirmText={(k) =>
            k === 'approve'
              ? `Setujui hapus ${row.lead_id} (${row.lead_name})? Lead dipindahkan ke ${DELETED_RECORD_STATUS}.`
              : `Tolak permintaan hapus ${row.lead_id}? Lead dibiarkan utuh.`
          }
          onDecide={(kind, note) =>
            run(kind, () => (kind === 'approve' ? approveLeadDelete(row.id, note) : rejectLeadDelete(row.id, note)))
          }
          hint={`ACC memindahkan lead ke ${DELETED_RECORD_STATUS}; barisnya tidak pernah dibuang. Hanya Head divisi ASAL lead (atau Director) yang diterima server.`}
        />
      ) : (
        <WaitingNote who="Head divisi asal lead / Director" />
      )}
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// 5. Permintaan Hold Service (T-2b)
// ---------------------------------------------------------------------------

function HoldCard({
  row,
  canDecide,
  onDone,
}: {
  row: PendingHoldRequest;
  canDecide: boolean;
  onDone: () => void;
}) {
  const { busy, error, run } = useDecision(onDone);
  return (
    <ApprovalCard
      id={row.service_id}
      href={`/clients/${row.client_id}`}
      title={
        <>
          {row.toko} &middot; {row.service_name}
        </>
      }
      badge={<span className="badge badge-amber">Hold Requested</span>}
      meta={[
        { label: 'PIC klien', value: row.nama_pic || '—' },
        { label: 'AM pemilik', value: row.owner_am_nama || row.owner_am || '—' },
        { label: 'Diajukan oleh', value: row.requested_by_nama || row.requested_by || '—' },
        { label: 'Diminta pada', value: formatDateTime(row.updated_at) },
      ]}
      reason={{ label: 'Alasan hold', text: row.reason }}
    >
      {canDecide ? (
        <DecisionActions
          fieldId={`hold-note-${row.service_id}`}
          busy={busy}
          error={error}
          approveLabel="Setujui hold"
          rejectLabel="Tolak hold"
          noteLabel="Catatan (opsional untuk hold; tercatat di audit saat menolak)"
          noteRequiredForReject={false}
          confirmText={(k) =>
            k === 'approve'
              ? `Setujui hold ${row.service_name} untuk ${row.toko}? Service berhenti di [On Hold].`
              : `Tolak hold ${row.service_name}? Service kembali ke [In Execution].`
          }
          onDecide={(kind, note) =>
            run(kind, () =>
              kind === 'approve' ? approveHoldService(row.service_id) : rejectHoldService(row.service_id, note),
            )
          }
          hint="Hold TIDAK meng-hold Brief/Asset/Booking anaknya — pekerjaan yang sudah berjalan tetap jalan."
        />
      ) : (
        <WaitingNote who="Head of Account / Director" />
      )}
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// 6. Permintaan Block Task (M12)
// ---------------------------------------------------------------------------

function BlockCard({
  row,
  canDecide,
  onDone,
}: {
  row: PendingBlockRequest;
  canDecide: boolean;
  onDone: () => void;
}) {
  const { busy, error, run } = useDecision(onDone);
  return (
    <ApprovalCard
      id={row.entity_id}
      href={`/tasks/${row.entity_id}`}
      title={row.toko || row.client_id || '—'}
      badge={<span className="badge badge-amber">Block diminta</span>}
      meta={[
        { label: 'Divisi', value: row.division },
        { label: 'Jenis', value: row.source === 'asset' ? 'Asset' : 'Brief' },
        { label: 'Diajukan oleh', value: row.requested_by_nama || row.requested_by },
        { label: 'Tanggal', value: formatDateTime(row.created_at) },
      ]}
      reason={{ label: 'Alasan block', text: row.reason }}
    >
      {canDecide ? (
        <DecisionActions
          fieldId={`blk-note-${row.id}`}
          busy={busy}
          error={error}
          approveLabel="Setujui block"
          rejectLabel="Tolak"
          showNote={false}
          confirmText={(k) =>
            k === 'approve'
              ? `Setujui block ${row.entity_id}? Jam SLA berhenti sampai task di-resume.`
              : `Tolak block ${row.entity_id}? Task kembali berjalan dan SLA tetap menghitung.`
          }
          onDecide={(kind) =>
            run(kind, () =>
              kind === 'approve'
                ? approveBlock(row.source, row.entity_id, row.id)
                : rejectBlock(row.source, row.entity_id, row.id),
            )
          }
          hint={
            <>
              Endpoint block tidak menerima catatan keputusan — keterangannya ada di{' '}
              <Link href="/tasks/block-requests">Antrian Block-Request</Link>.
            </>
          }
        />
      ) : (
        <WaitingNote who="SPV/Lead divisi / Director" />
      )}
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// 7. Eskalasi KOL (§10.1)
// ---------------------------------------------------------------------------

/**
 * Bukan approve/reject: booking yang creator-nya tidak responsif diselesaikan
 * dengan MELANJUTKAN (konten akhirnya masuk — butuh link) atau MEN-DROP-nya
 * (butuh alasan). Warnanya tetap dipakai sesuai arah keputusannya — hijau =
 * jalan terus, merah = hentikan — supaya kartunya terbaca sama seperti yang
 * lain, tapi tidak ada tombol yang berpura-pura jadi "setujui" padahal
 * endpoint-nya tidak ada.
 */
function EscalationCard({
  row,
  canDrop,
  defaultOpen,
  onDone,
}: {
  row: PendingEscalation;
  canDrop: boolean;
  defaultOpen: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const { busy, error, run } = useDecision(onDone);

  useEffect(() => {
    if (!open || booking || detailError) return;
    let alive = true;
    getBooking(row.booking_id)
      .then((b) => alive && setBooking(b))
      .catch((err) => alive && setDetailError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [open, booking, detailError, row.booking_id]);

  return (
    <ApprovalCard
      id={row.booking_id}
      href={`/kol/bookings/${row.booking_id}`}
      title={
        <>
          {row.toko} &middot; {row.creator_name}
        </>
      }
      badge={<span className="badge badge-red">Creator tidak responsif</span>}
      meta={[
        { label: 'Divisi brief', value: row.division || '—' },
        { label: 'Coordinator', value: row.coordinator_nama || row.coordinator || '—' },
        { label: 'Brief', value: <Link href={`/kol/briefs/${row.brief_id}`}>{row.brief_id}</Link> },
        { label: 'Dieskalasi pada', value: formatDateTime(row.updated_at) },
      ]}
      detail={
        <div className="stack" style={{ gap: 8 }}>
          {detailError && (
            <div className="alert alertError" role="alert">
              {detailError}
            </div>
          )}
          {!booking && !detailError && <p className="muted">Memuat rincian...</p>}
          {booking && (
            <>
              <MetaGrid
                items={[
                  { label: 'Rate disepakati', value: booking.agreed_rate_display || formatIDR(booking.agreed_rate) },
                  { label: 'Platform', value: booking.platform || '—' },
                  { label: 'Deliverable', value: `${booking.qty_video} video · ${booking.qty_live} live` },
                  { label: 'Jumlah revisi', value: String(booking.revision_count) },
                  {
                    label: 'Konten terakhir',
                    value: booking.content_link ? (
                      <a href={booking.content_link} target="_blank" rel="noreferrer">
                        Buka
                      </a>
                    ) : (
                      '—'
                    ),
                  },
                ]}
              />
              <ReasonBlock label="Catatan QC saat dieskalasi" text={booking.qc_notes} />
            </>
          )}
        </div>
      }
      detailLabel="Rincian booking & catatan QC"
      open={open}
      onToggle={setOpen}
    >
      <div className="stack" style={{ gap: 8 }}>
        {error && (
          <div className="alert alertError" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor={`esc-link-${row.booking_id}`}>Link konten (untuk melanjutkan)</label>
          <input
            id={`esc-link-${row.booking_id}`}
            placeholder="https://..."
            value={link}
            disabled={busy !== null}
            onChange={(e) => setLink(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btnApprove"
            disabled={busy !== null || link.trim() === ''}
            onClick={() => run('approve', () => continueEscalation(row.booking_id, link.trim()))}
          >
            {busy === 'approve' ? 'Memproses...' : 'Lanjutkan (konten masuk)'}
          </button>
          {canDrop && (
            <button
              type="button"
              className="btn btnReject"
              disabled={busy !== null}
              onClick={() => {
                const why = window.prompt('Alasan drop booking (wajib):') ?? '';
                if (why.trim() === '') return;
                run('reject', () => dropBooking(row.booking_id, why.trim()));
              }}
            >
              {busy === 'reject' ? 'Memproses...' : 'Drop booking'}
            </button>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Melanjutkan mengembalikan booking ke [Content Submitted] untuk QC ulang. Drop bersifat final
          {canDrop ? '' : ' dan hanya boleh dilakukan KOL Team Leader / Head of Account / Director'}.
        </p>
      </div>
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// 8. Review Strategi & Plan (M6A §4)
// ---------------------------------------------------------------------------

function StrategyCard({
  row,
  canDecide,
  defaultOpen,
  onDone,
}: {
  row: PendingStrategyReview;
  canDecide: boolean;
  defaultOpen: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { busy, error, run } = useDecision(onDone);

  useEffect(() => {
    if (!open || strategy || detailError) return;
    let alive = true;
    getStrategy(row.strategy_id)
      .then((s) => alive && setStrategy(s))
      .catch((err) => alive && setDetailError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [open, strategy, detailError, row.strategy_id]);

  const gmvPending = row.gmv_adjustment_status === GMV_ADJ_PENDING;
  const submitted = row.status === STRATEGY_SUBMITTED;

  return (
    <ApprovalCard
      id={row.strategy_id}
      href={`/account/strategi/${row.strategy_id}`}
      title={
        <>
          {row.toko} &middot; {row.nama_pic}
        </>
      }
      badge={<StatusBadge status={row.status} />}
      meta={[
        { label: 'Service', value: <Link href={`/account/services/${row.service_id}`}>{row.service_id}</Link> },
        { label: 'Disusun oleh', value: row.created_by_nama || row.created_by },
        { label: 'Tanggal', value: formatDateTime(row.created_at) },
        {
          label: 'Yang diminta',
          value: submitted
            ? gmvPending
              ? 'Persetujuan Plan + penyesuaian GMV'
              : 'Persetujuan Plan'
            : gmvPending
              ? 'ACC penyesuaian target GMV (>±20%)'
              : '—',
        },
      ]}
      detail={
        <div className="stack" style={{ gap: 8 }}>
          {detailError && (
            <div className="alert alertError" role="alert">
              {detailError}
            </div>
          )}
          {!strategy && !detailError && <p className="muted">Memuat rincian...</p>}
          {strategy && (
            <>
              <MetaGrid
                items={[
                  { label: 'Objective', value: strategy.objective || '—' },
                  { label: 'Target GMV (plan)', value: formatIDR(strategy.target_gmv) },
                  { label: 'Target GMV (klien)', value: formatIDR(strategy.client_target_gmv) },
                  { label: 'Target ROAS', value: strategy.target_roas || '—' },
                  { label: 'Divisi terlibat', value: strategy.divisions_involved.join(', ') || '—' },
                  { label: 'Timeline', value: `${formatDate(strategy.timeline_start)} – ${formatDate(strategy.timeline_end)}` },
                  { label: 'Revisi ke', value: String(strategy.revision_count) },
                ]}
              />
              {gmvPending && (
                <ReasonBlock label="Alasan penyesuaian target GMV" text={strategy.gmv_adjustment_reason} />
              )}
              {strategy.planned_brief_outline && (
                <ReasonBlock label="Rencana brief" text={strategy.planned_brief_outline} />
              )}
              {strategy.revision_notes && <ReasonBlock label="Catatan revisi terakhir" text={strategy.revision_notes} />}
            </>
          )}
        </div>
      }
      detailLabel="Rincian target & plan"
      open={open}
      onToggle={setOpen}
    >
      {!canDecide ? (
        <WaitingNote who="Head of Account / Director" />
      ) : submitted ? (
        <DecisionActions
          fieldId={`stg-note-${row.strategy_id}`}
          busy={busy}
          error={error}
          approveLabel="Setujui Plan"
          rejectLabel="Minta revisi"
          noteLabel="Catatan revisi (wajib untuk Minta revisi)"
          confirmText={(k) =>
            k === 'approve'
              ? `Setujui Plan ${row.strategy_id}? Service ${row.service_id} lanjut ke [Strategy Approved] dan Brief boleh dibuat.`
              : ''
          }
          onDecide={(kind, note) =>
            run(kind, () =>
              kind === 'approve' ? approveStrategy(row.strategy_id) : requestStrategyRevision(row.strategy_id, note),
            )
          }
          hint="Menyetujui Plan menggerakkan Service-nya dalam satu transaksi — bukan dua langkah terpisah."
        />
      ) : gmvPending ? (
        <div className="stack" style={{ gap: 8 }}>
          {error && (
            <div className="alert alertError" role="alert">
              {error}
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btnApprove"
              disabled={busy !== null}
              onClick={() => run('approve', () => approveGmvAdjustment(row.strategy_id))}
            >
              {busy === 'approve' ? 'Memproses...' : 'ACC penyesuaian GMV'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Plan ini masih draft, jadi tidak ada tombol tolak: menolak penyesuaian = AM menurunkan
            target GMV-nya kembali ke dalam toleransi ±20% di halaman Strategy &amp; Plan. Selama belum
            di-ACC, Plan tidak bisa diajukan.
          </p>
        </div>
      ) : null}
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// Halaman
// ---------------------------------------------------------------------------

const SECTION_LABELS = [
  'Negosiasi Sales',
  'Renewal/Cross-Sell',
  'Finance — Perubahan Skema Pembayaran',
  'Permintaan Hapus Lead',
  'Permintaan Hold Service',
  'Eskalasi KOL',
  'Review Strategi & Plan',
  'Permintaan Block Task — M12',
] as const;

export default function PerluPersetujuanPage() {
  const { role } = useAuth();

  // M12 Block Request datang dari /portal/team, yang 403 untuk siapa pun yang
  // bukan lead divisi / Director (gate portal.go sendiri) — cerminkan penjaga
  // halaman /tasks/block-requests yang sudah ada daripada menembakkan panggilan
  // yang pasti gagal. Director tanpa divisi bawaan juga 403 (`docs/handoff/
  // FE_SMOKE_REPORT_20260719.md` #1), jadi hanya tembak kalau divisinya ada.
  const canViewBlockQueue = Boolean(role?.level === 'lead' || (role?.director && role.division));

  // ---- Gate keputusan per antrian (cermin gate server; server tetap otoritas) ----
  // `isODOnly` (lib/kol) adalah definisi yang sama yang dipakai halaman-halaman
  // M9: OD murni (tanpa lapis Director) read-only di seluruh sistem, Phase 0 §4.
  const readOnly = isODOnly(role);
  const isDirector = Boolean(role?.director);
  const canDecideNego = !readOnly && (isSalesLead(role) || isDirector);
  const canDecideRenewal = !readOnly && canDecideRenewalUi(role);
  const canDecideTcr = !readOnly && isDirector;
  const canDecideLeadDelete = !readOnly && (isDirector || role?.level === 'lead');
  const canDecideHold = !readOnly && (isAccountLead(role) || isDirector);
  const canDecideBlock = !readOnly && canViewBlockQueue;
  const canDecideStrategy = !readOnly && canApproveStrategy(role);
  // Antrian eskalasi SUDAH difilter server ke `canContinueEscalation` — apa pun
  // yang muncul boleh dilanjutkan pemiliknya. Drop punya gate sendiri (lebih
  // sempit: KOL lead / Account lead / Director).
  const canDropEscalation = !readOnly && canDropBooking(role);

  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);
  const [renewals, setRenewals] = useState<RenewalListRow[] | null>(null);
  const [tcrs, setTcrs] = useState<SchemeChangeRequest[] | null>(null);
  const [deleteRequests, setDeleteRequests] = useState<DeleteRequestQueueRow[] | null>(null);
  const [holdRequests, setHoldRequests] = useState<PendingHoldRequest[] | null>(null);
  const [blockRequests, setBlockRequests] = useState<PendingBlockRequest[] | null>(null);
  const [escalations, setEscalations] = useState<PendingEscalation[] | null>(null);
  const [strategyReviews, setStrategyReviews] = useState<PendingStrategyReview[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Kegagalan per sumber — satu antrian error tidak boleh mengosongkan tujuh
  // lainnya; justru menggabungkan read yang ter-scope sendiri-sendiri itulah
  // seluruh alasan halaman ini ada.
  const [sectionErrors, setSectionErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSectionErrors([]);
    try {
      const results = await Promise.allSettled([
        listAttempts(ATTEMPT_PENDING),
        listAllRenewals(RENEWAL_PENDING),
        listSchemeChangeQueue(),
        listDeleteRequests(),
        listPendingHoldRequests(),
        listPendingEscalations(),
        listPendingStrategyReviews(),
        canViewBlockQueue ? getTeamPortal() : Promise.resolve(null),
      ]);
      const [attemptRes, renewalRes, tcrRes, deleteRes, holdRes, escalationRes, strategyRes, blockRes] = results;
      setAttempts(attemptRes.status === 'fulfilled' ? attemptRes.value.data : []);
      setRenewals(renewalRes.status === 'fulfilled' ? renewalRes.value.data : []);
      setTcrs(tcrRes.status === 'fulfilled' ? tcrRes.value.data : []);
      setDeleteRequests(deleteRes.status === 'fulfilled' ? deleteRes.value.data : []);
      setHoldRequests(holdRes.status === 'fulfilled' ? holdRes.value.data : []);
      setEscalations(escalationRes.status === 'fulfilled' ? escalationRes.value.data : []);
      setStrategyReviews(strategyRes.status === 'fulfilled' ? strategyRes.value.data : []);
      setBlockRequests(
        blockRes.status === 'fulfilled' && blockRes.value ? blockRes.value.block_queue : [],
      );
      setSectionErrors(
        results
          .map((r, i) => (r.status === 'rejected' ? `${SECTION_LABELS[i]}: ${errorMessage(r.reason)}` : null))
          .filter((msg): msg is string => msg !== null),
      );
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canViewBlockQueue]);

  useEffect(() => {
    load();
  }, [load]);

  // Master Service List = sisi "harga standar" pada kedua antrian uang. Gagal
  // memuatnya BUKAN alasan menyembunyikan antriannya: `buildComparison` sudah
  // merender '—' untuk pembanding yang tidak diketahui.
  useEffect(() => {
    let alive = true;
    api
      .get<{ data: MasterService[] }>(`/master-services?effective_at=${todayISO()}`)
      .then((res) => {
        if (alive) setCatalog(res.data.map((s) => ({ id: s.id, name: s.name, standard_price: s.standard_price })));
      })
      .catch(() => {
        if (alive) setCatalog([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const counts = {
    nego: attempts?.length ?? 0,
    renewal: renewals?.length ?? 0,
    tcr: tcrs?.length ?? 0,
    lead: deleteRequests?.length ?? 0,
    hold: holdRequests?.length ?? 0,
    kol: escalations?.length ?? 0,
    strategy: strategyReviews?.length ?? 0,
    block: blockRequests?.length ?? 0,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const jumpTargets: { id: string; label: string; count: number }[] = [
    { id: 'nego', label: 'Negosiasi Sales', count: counts.nego },
    { id: 'renewal', label: 'Renewal / Cross-Sell', count: counts.renewal },
    { id: 'tcr', label: 'Skema Pembayaran', count: counts.tcr },
    { id: 'lead', label: 'Hapus Lead', count: counts.lead },
    { id: 'hold', label: 'Hold Service', count: counts.hold },
    { id: 'block', label: 'Block Task', count: counts.block },
    { id: 'kol', label: 'Eskalasi KOL', count: counts.kol },
    { id: 'strategy', label: 'Strategi & Plan', count: counts.strategy },
  ].filter((t) => t.count > 0);

  return (
    <div className="stack">
      <div>
        <h1>Perlu Persetujuan Saya</h1>
        <p className="muted">
          Semua permintaan yang sedang menunggu keputusan Anda, dari seluruh sistem, dalam satu
          tempat — lengkap dengan alasan pengajuan dan, untuk negosiasi harga, perbandingan harga
          standar dengan harga yang diajukan. Setujui atau tolak langsung dari kartunya. Baris yang
          tampil sudah mengikuti hak akses Anda masing-masing (staff = milik sendiri, Lead/SPV =
          seluruh divisi, Director = semua); halaman ini hanya menggabungkan, tidak menambah aturan
          akses baru.
        </p>
      </div>

      {loading && <p className="muted">Memuat...</p>}
      {loadError && (
        <div className="alert alertError" role="alert">
          {loadError}
        </div>
      )}
      {!loading && sectionErrors.length > 0 && (
        <div className="alert alertError" role="alert">
          {sectionErrors.length === 1
            ? `Gagal memuat satu antrian: ${sectionErrors[0]}`
            : 'Gagal memuat beberapa antrian:'}
          {sectionErrors.length > 1 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {sectionErrors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!loading && !loadError && (
        <>
          {total === 0 && sectionErrors.length === 0 && (
            <div className="emptyState">Tidak ada yang menunggu persetujuan saat ini.</div>
          )}

          {jumpTargets.length > 1 && (
            <div className="card" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>{total} permintaan:</strong>
                {jumpTargets.map((t) => (
                  <a key={t.id} href={`#${t.id}`} className="btn btnChip btnSm">
                    {t.label} ({t.count})
                  </a>
                ))}
              </div>
            </div>
          )}

          {readOnly && total > 0 && (
            <div className="alert alertInfo" role="status">
              Anda login sebagai OD &mdash; akses baca saja, semua tombol keputusan disembunyikan.
            </div>
          )}

          <Section
            id="nego"
            title="Negosiasi Sales"
            count={counts.nego}
            hint="Harga di bawah/atas standar Master Service List wajib disetujui Sales Lead / Director sebelum closing (M0 §6)."
          >
            {attempts?.map((a, i) => (
              <NegotiationCard
                key={a.id}
                row={a}
                catalog={catalog}
                canDecide={canDecideNego}
                defaultOpen={i < AUTO_OPEN}
                onDone={load}
              />
            ))}
          </Section>

          <Section
            id="renewal"
            title="Renewal / Cross-Sell"
            count={counts.renewal}
            hint="Penawaran perpanjangan atau jasa tambahan untuk klien berjalan (R-03)."
          >
            {renewals?.map((r, i) => (
              <RenewalCard
                key={r.id}
                row={r}
                catalog={catalog}
                canDecide={canDecideRenewal}
                defaultOpen={i < AUTO_OPEN}
                onDone={load}
              />
            ))}
          </Section>

          <Section
            id="tcr"
            title="Finance — Perubahan Skema Pembayaran"
            count={counts.tcr}
            hint="Finance tidak bisa mengubah skema sendiri; transaksinya tidak bergerak sampai Director menyetujui (M5-OA-7)."
          >
            {tcrs?.map((r, i) => (
              <SchemeChangeCard
                key={r.id}
                row={r}
                canDecide={canDecideTcr}
                defaultOpen={i < AUTO_OPEN}
                onDone={load}
              />
            ))}
          </Section>

          <Section
            id="lead"
            title="Permintaan Hapus Lead"
            count={counts.lead}
            hint="Hapus lead wajib di-ACC Head divisi ASAL lead (Director bisa di semua divisi)."
          >
            {deleteRequests?.map((r) => (
              <LeadDeleteCard key={r.id} row={r} canDecide={canDecideLeadDelete} onDone={load} />
            ))}
          </Section>

          <Section
            id="hold"
            title="Permintaan Hold Service"
            count={counts.hold}
            hint="AM mengajukan, Head of Account memutuskan (T-2b). Klien tetap menerima recap sampai hold benar-benar disetujui."
          >
            {holdRequests?.map((r) => (
              <HoldCard key={r.service_id} row={r} canDecide={canDecideHold} onDone={load} />
            ))}
          </Section>

          <Section
            id="block"
            title="Permintaan Block Task — M12"
            count={counts.block}
            hint="Task yang tidak bisa jalan karena hal di luar kendali PIC; menyetujui menghentikan hitungan SLA."
          >
            {blockRequests?.map((r) => (
              <BlockCard key={r.id} row={r} canDecide={canDecideBlock} onDone={load} />
            ))}
          </Section>

          <Section
            id="kol"
            title="Eskalasi KOL"
            count={counts.kol}
            hint="Booking dengan creator tidak responsif (§10.1) — lanjutkan bila kontennya akhirnya masuk, atau drop."
          >
            {escalations?.map((r, i) => (
              <EscalationCard
                key={r.booking_id}
                row={r}
                canDrop={canDropEscalation}
                defaultOpen={i < AUTO_OPEN}
                onDone={load}
              />
            ))}
          </Section>

          <Section
            id="strategy"
            title="Review Strategi & Plan"
            count={counts.strategy}
            hint="Plan yang diajukan untuk persetujuan, atau penyesuaian target GMV di luar toleransi ±20%."
          >
            {strategyReviews?.map((r, i) => (
              <StrategyCard
                key={r.strategy_id}
                row={r}
                canDecide={canDecideStrategy}
                defaultOpen={i < AUTO_OPEN}
                onDone={load}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
