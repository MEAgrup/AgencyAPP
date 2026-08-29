'use client';

// M16 — Tahapan Produksi Brief + lead time (LT-28). Shared by the AM view
// (account/briefs/[id]) and the execution-division views (creative/kol
// briefs/[id]) so there is ONE rendering of the timeline, not three.
//
// Read-only timeline (PRD §7 Success Metric 1: "AM bisa menyebutkan tanpa
// bertanya ke divisi tahap mana yang sedang berjalan dan sudah berapa hari
// kerja") + the Cek Brief AM intake decision (PRD §2 Rule 10) when the
// caller says the viewer may act on it, + a generic `advanceStage` button
// for every OTHER edge (LT-28 follow-up: `allowed_transitions` now comes
// from the server — `engine.allowedTransitions` over the same `sm_edges`
// table `sm_transition` enforces, so a button never renders for an edge
// the DB would refuse).

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { advanceBriefStage, getBriefStage, reviewBriefStage, type StageOverview } from '@/lib/stage';

const STATUS_BADGE: Record<string, string> = {
  belum_mulai: 'badge-gray',
  tepat_waktu: 'badge-green',
  mendekati_batas: 'badge-amber',
  terlambat: 'badge-red',
  tidak_berlaku: 'badge-darkgray',
};

const STATUS_LABEL: Record<string, string> = {
  belum_mulai: 'Belum Mulai',
  tepat_waktu: 'Tepat Waktu',
  mendekati_batas: 'Mendekati Batas',
  terlambat: 'Terlambat',
  tidak_berlaku: 'N/A',
};

function StatusPill({ status }: { status: string }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'badge-gray'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function fmtHari(n: number | null): string {
  if (n === null) return '—';
  return `${n} hk`;
}

const REASON_CODES: Record<string, string[]> = {
  Creative: ['Brief kurang jelas', 'Sampel belum diterima', 'Talent tidak tersedia', 'Properti tidak tersedia', 'Lokasi butuh approval'],
  KOL: ['Brief kurang jelas', 'Data tidak lengkap'],
};

export default function StageTimelinePanel({
  briefId,
  assignedDivision,
  canReview,
  isAmOrDirector = false,
}: {
  briefId: string;
  /** brief.assigned_division — picks the alasan_kode list for "Dikembalikan". */
  assignedDivision: string;
  /** true when the viewer is division staff/lead (or Director) for this Brief — shows the Cek Brief AM actions AND the generic advance buttons for any stage that is not AM-gated. */
  canReview: boolean;
  /** true when the viewer is the owning AM (or Director) — the only population `advanceStage` allows OUT of a `gate_pihak='AM'` stage (HANDOFF_M16_AKUN_A.md §1.3). Defaults false: hidden unless a page explicitly knows it is showing the AM their own Brief. */
  isAmOrDirector?: boolean;
}) {
  const [overview, setOverview] = useState<StageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [catatan, setCatatan] = useState('');
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [advancingTo, setAdvancingTo] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setOverview(await getBriefStage(briefId));
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [briefId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAccept() {
    setActionError(null);
    setSubmitting(true);
    try {
      await reviewBriefStage(briefId, { keputusan: 'Diterima' });
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdvance(to: string) {
    setAdvanceError(null);
    setAdvancingTo(to);
    try {
      await advanceBriefStage(briefId, to);
      await load();
    } catch (err) {
      setAdvanceError(errorMessage(err));
    } finally {
      setAdvancingTo(null);
    }
  }

  async function handleReturn() {
    if (!reasonCode) {
      setActionError('[alasan pengembalian wajib diisi]');
      return;
    }
    setActionError(null);
    setSubmitting(true);
    try {
      await reviewBriefStage(briefId, { keputusan: 'Dikembalikan', alasan_kode: reasonCode, catatan });
      setShowReturnForm(false);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="card">
        <div className="cardHeader"><h2>Tahapan Produksi</h2></div>
        <div className="muted">Memuat...</div>
      </section>
    );
  }

  if (loadError || !overview) {
    return (
      <section className="card">
        <div className="cardHeader"><h2>Tahapan Produksi</h2></div>
        <div className="alert alertError" role="alert">{loadError ?? 'Data tahapan tidak ditemukan.'}</div>
      </section>
    );
  }

  const reasons = REASON_CODES[assignedDivision] ?? ['Brief kurang jelas'];
  const pendingReview = overview.review === null && overview.production_stage === 'Cek Brief AM';
  // Cek Brief AM's own outgoing edges are driven by the review actions above,
  // not this generic list — showing both would offer two competing ways to
  // do the same thing. A gate_pihak='AM' current stage restricts the button
  // to the owning AM/Director (server enforces regardless; this only decides
  // whether to render it at all).
  const currentStageGate = overview.stages.find((s) => s.stage_code === overview.tahap_aktif)?.gate_pihak ?? null;
  const canAdvance = currentStageGate === 'AM' ? isAmOrDirector : canReview;
  const showAdvance = canAdvance && overview.production_stage !== 'Cek Brief AM' && overview.allowed_transitions.length > 0;

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Tahapan Produksi</h2>
        {overview.production_stage && <span className="badge badge-blue">{overview.production_stage}</span>}
        {overview.stage_pipeline_code === null && <span className="muted">Divisi ini belum punya pipeline tahapan.</span>}
      </div>

      <div className="grid2">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>AM kirim &rarr; divisi merespons</div>
          <div>{fmtHari(overview.intake.hari_kerja)}{overview.intake.keluar_pada ? '' : ' (berjalan)'}</div>
        </div>
        {overview.total_hari_kerja !== null && (
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Total Lead Time &middot; <span title="Sum hari kerja seluruh tahap, gate KLIEN dikeluarkan">🔒 read-only</span>
            </div>
            <div>{fmtHari(overview.total_hari_kerja)}</div>
          </div>
        )}
      </div>

      {overview.review && (
        <div className={`alert ${overview.review.keputusan === 'Diterima' ? 'alertSuccess' : 'alertError'}`}>
          Cek Brief AM: <strong>{overview.review.keputusan}</strong>
          {overview.review.alasan_kode && ` — ${overview.review.alasan_kode}`}
          {overview.review.catatan && <div className="muted">{overview.review.catatan}</div>}
        </div>
      )}

      {canReview && pendingReview && (
        <div className="stack" style={{ gap: 10 }}>
          {actionError && <div className="alert alertError" role="alert">{actionError}</div>}
          {!showReturnForm ? (
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn btnPrimary" disabled={submitting} onClick={handleAccept}>
                {submitting ? 'Memproses...' : 'Terima & Proses'}
              </button>
              <button type="button" className="btn btnSecondary" disabled={submitting} onClick={() => setShowReturnForm(true)}>
                Brief Dikembalikan ke AM
              </button>
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <select className="input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                <option value="">Pilih alasan pengembalian…</option>
                {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <textarea className="input" placeholder="Catatan (opsional)" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
              <div className="row" style={{ gap: 10 }}>
                <button type="button" className="btn btnPrimary" disabled={submitting} onClick={handleReturn}>
                  {submitting ? 'Memproses...' : 'Kirim Pengembalian'}
                </button>
                <button type="button" className="btn btnSecondary" disabled={submitting} onClick={() => setShowReturnForm(false)}>
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showAdvance && (
        <div className="stack" style={{ gap: 8 }}>
          {advanceError && <div className="alert alertError" role="alert">{advanceError}</div>}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {overview.allowed_transitions.map((to) => (
              <button
                key={to}
                type="button"
                className="btn btnSecondary"
                disabled={advancingTo !== null}
                onClick={() => handleAdvance(to)}
              >
                {advancingTo === to ? 'Memproses...' : `→ ${to}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {overview.stages.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tahap</th>
                <th>Masuk</th>
                <th>Keluar</th>
                <th>Hari Kerja</th>
                <th>Target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {overview.stages.map((s) => (
                <tr key={s.stage_code} style={s.stage_code === overview.tahap_aktif ? { fontWeight: 600 } : undefined}>
                  <td>
                    {s.label}
                    {s.gate_pihak && <span className="muted" style={{ fontSize: 11 }}> ({s.gate_pihak === 'KLIEN' ? 'gate klien' : 'gate AM'})</span>}
                  </td>
                  <td>{s.masuk_pada ? new Date(s.masuk_pada).toLocaleDateString('id-ID') : '—'}</td>
                  <td>{s.keluar_pada ? new Date(s.keluar_pada).toLocaleDateString('id-ID') : '—'}</td>
                  <td>{fmtHari(s.hari_kerja)}</td>
                  <td>{s.target_hari_kerja === null ? 'N/A' : `${s.target_hari_kerja} hk`}</td>
                  <td><StatusPill status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
