'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  BRIEF_DIVISIONS,
  GMV_ADJ_APPROVED,
  GMV_ADJ_PENDING,
  GMV_TOLERANCE,
  STRATEGY_DRAFTING,
  STRATEGY_SUBMITTED,
  TASK_CATALOG,
  canApproveStrategy,
  getStrategy,
  isAccountStaff,
  isReadOnlyOD,
  type DivisionTask,
  type Strategy,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';
import { formatIDR } from '@/lib/money';
import { transitionTo } from '@/lib/transition';

/** The human label for a stored task-satuan (divisi, jenis), or the raw jenis. */
function taskLabel(divisi: string, jenis: string): string {
  return (TASK_CATALOG[divisi] ?? []).find((t) => t.jenis === jenis)?.label ?? jenis;
}

/** Whether a task-satuan quota is a Rupiah amount (Ads spend) rather than a count. */
function taskIsMoney(divisi: string, jenis: string): boolean {
  return (TASK_CATALOG[divisi] ?? []).find((t) => t.jenis === jenis)?.money ?? false;
}

export default function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const canApprove = canApproveStrategy(role);
  // Draft edit/submit belongs to the owner AM (Account staff) or Director
  // (strategy.go:290-296, 327-329). Owner can't be checked client-side (the
  // Strategy response carries no owner field), but OD must never see write
  // controls and non-Account divisions get a guaranteed 403 — hide for both.
  // Server remains the final authority (CLAUDE.md #6).
  const canDraft = !isReadOnlyOD(role) && (isAccountStaff(role) || !!role?.director);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Edit draft form — the full Strategy & Plan content, including the structured
  // Target KPI and per-division task-satuan (QA revisi). The revision loop lands
  // back here, so an edit that omitted these fields would silently wipe them.
  const [objective, setObjective] = useState('');
  const [gmv, setGmv] = useState('');
  const [roas, setRoas] = useState('');
  const [ctr, setCtr] = useState('');
  const [cvr, setCvr] = useState('');
  const [gmvReason, setGmvReason] = useState('');
  const [kpiNote, setKpiNote] = useState('');
  const [tasks, setTasks] = useState<Record<string, string>>({});
  const [divisions, setDivisions] = useState<string[]>([]);
  const [outline, setOutline] = useState('');
  const [timelineStart, setTimelineStart] = useState('');
  const [timelineEnd, setTimelineEnd] = useState('');

  // Submit (fallback path — see the card comment)

  // Approve / request revision

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getStrategy(id);
      setStrategy(res);
      setObjective(res.objective ?? '');
      setGmv(res.target_gmv ?? '');
      setRoas(res.target_roas ?? '');
      setCtr(res.target_ctr ?? '');
      setCvr(res.target_cvr ?? '');
      setGmvReason(res.gmv_adjustment_reason ?? '');
      setKpiNote(res.target_kpi ?? '');
      const taskMap: Record<string, string> = {};
      for (const t of res.division_tasks ?? []) taskMap[`${t.divisi}::${t.jenis}`] = t.jumlah;
      setTasks(taskMap);
      setDivisions(res.divisions_involved ?? []);
      setOutline(res.planned_brief_outline ?? '');
      setTimelineStart(res.timeline_start ?? '');
      setTimelineEnd(res.timeline_end ?? '');
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleDivision(div: string) {
    setDivisions((prev) => (prev.includes(div) ? prev.filter((d) => d !== div) : [...prev, div]));
  }

  // The client's expectation and the AM's deviation from it, for the ±20% gate UI —
  // the same arithmetic the server runs (mirrors the Service create form).
  const clientGmv = strategy?.client_target_gmv ? Number(strategy.client_target_gmv) : 0;
  const gmvNum = gmv.trim() === '' ? clientGmv : Number(gmv);
  const gmvDeviation = clientGmv > 0 && !Number.isNaN(gmvNum) ? (gmvNum - clientGmv) / clientGmv : 0;
  const gmvOutOfTolerance = clientGmv > 0 && Math.abs(gmvDeviation) > GMV_TOLERANCE + 1e-9;

  /** Build division_tasks from the selected divisions' non-empty quota inputs. */
  function collectTasks(): DivisionTask[] {
    const out: DivisionTask[] = [];
    for (const divisi of divisions) {
      for (const t of TASK_CATALOG[divisi] ?? []) {
        const jumlah = (tasks[`${divisi}::${t.jenis}`] ?? '').trim();
        if (jumlah !== '') out.push({ divisi, jenis: t.jenis, jumlah });
      }
    }
    return out;
  }





  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !strategy) {
    return (
      <div className="stack">
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Strategy & Plan tidak ditemukan.'}</div>
      </div>
    );
  }

  const isDrafting = strategy.status === STRATEGY_DRAFTING;
  const isSubmitted = strategy.status === STRATEGY_SUBMITTED;
  // Fallback submit path: a draft whose GMV adjustment was out of tolerance and is
  // now cleared by Head/SPV (approved). It could not auto-submit on save (the gate
  // held), and re-saving would re-open the gate — so the owner needs a way to
  // submit without editing. Not shown on the in-tolerance path (that auto-submits).
  const gmvAdjBlocking = strategy.gmv_adjustment_status === GMV_ADJ_PENDING;
  const gmvAdjCleared = strategy.gmv_adjustment_status === GMV_ADJ_APPROVED;

  return (
    <div className="stack">
      <div>
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{strategy.id}</h1>
          <p className="muted">
            Layanan:{' '}
            <Link href={`/account/services/${encodeURIComponent(strategy.service_id)}`}>{strategy.service_id}</Link>
          </p>
        </div>
        <StatusBadge status={strategy.status} />
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Ringkasan</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Objective</div>
            <div>{strategy.objective || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Divisi Terlibat</div>
            <div>{strategy.divisions_involved.length > 0 ? strategy.divisions_involved.join(', ') : '—'}</div>
          </div>
        </div>

        {/* Structured Target KPI (QA revisi) — the four fixed points the reviewer
            reads before approving. Rendered here (not only on the Service hub) so
            the approval page shows the full plan, not just its objective. */}
        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target GMV</div>
            <div>{formatIDR(strategy.target_gmv)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target ROAS</div>
            <div>{strategy.target_roas ?? '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target CTR (%)</div>
            <div>{strategy.target_ctr ?? '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target CVR (%)</div>
            <div>{strategy.target_cvr ?? '—'}</div>
          </div>
        </div>

        {/* GMV adjustment gate (±20% vs the client's expectation). */}
        {strategy.gmv_adjustment_status !== 'dalam_toleransi' && (
          <div
            className={`alert ${gmvAdjCleared ? 'alertSuccess' : 'alertInfo'}`}
            role="status"
            style={{ marginTop: 12 }}
          >
            <div>
              Penyesuaian target GMV di luar toleransi 20% (klien: {formatIDR(strategy.client_target_gmv)}) &mdash;{' '}
              {gmvAdjCleared
                ? `disetujui oleh ${strategy.gmv_adjustment_approved_by || 'Head/SPV'}.`
                : 'menunggu ACC Head/SPV. Plan belum bisa diajukan.'}
            </div>
            {strategy.gmv_adjustment_reason && (
              <div className="muted" style={{ fontSize: 12 }}>Alasan: {strategy.gmv_adjustment_reason}</div>
            )}
          </div>
        )}

        {/* Task-satuan per division — what the AM turns into Briefs (M6B P3). */}
        {strategy.division_tasks.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Strategi &mdash; task satuan per divisi</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {strategy.division_tasks.map((t) => (
                <li key={`${t.divisi}::${t.jenis}`}>
                  {t.divisi} &middot; {taskLabel(t.divisi, t.jenis)}:{' '}
                  <strong>{taskIsMoney(t.divisi, t.jenis) ? formatIDR(t.jumlah) : t.jumlah}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Timeline</div>
            <div>{strategy.timeline_start || '—'} &rarr; {strategy.timeline_end || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Outline Brief</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{strategy.planned_brief_outline || '—'}</div>
          </div>
          {strategy.target_kpi && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Catatan KPI</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{strategy.target_kpi}</div>
            </div>
          )}
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Jumlah Revisi &middot; <span title="Auto-calculated dari audit log">🔒 read-only</span>
            </div>
            <div>{strategy.revision_count}</div>
          </div>
          {strategy.approved_by && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Disetujui Oleh</div>
              <div>{strategy.approved_by}</div>
            </div>
          )}
          {strategy.revision_notes && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Catatan Revisi</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{strategy.revision_notes}</div>
            </div>
          )}
        </div>
      </section>

      {/* ── `STR-` DIPENSIUNKAN 2026-09-08 (ketokan pemilik) ─────────────────
          Tiga seksi tulis dulu ada di sini: Persetujuan (Setujui / Minta
          Revisi), Ubah & Ajukan Draft, dan Ajukan Persetujuan. Ketiganya
          dicabut, bukan disembunyikan di balik flag — `SHOW_LEGACY_STR_PATH`
          adalah preseden persis kenapa flag itu berbahaya: ia menyembunyikan
          form BUAT di halaman Service, jadi jalur ini terbaca "mati" padahal
          pintu approve-nya masih hidup di dua layar lain, dan A-3 dibangun di
          atas kesimpulan yang salah itu.
          Halaman ini sekarang BACA SAJA. Dua baris `STR-` di produksi sudah
          `[Strategy Approved]` — riwayat kesepakatan sungguhan, dan riwayat
          tidak dipensiunkan (aturan rumah #3). */}
      <section className="card">
        <div className="cardHeader">
          <h2>Jalur ini sudah tidak dipakai</h2>
        </div>
        <div className="alert alertInfo" role="status">
          <p style={{ margin: 0 }}>
            <strong>Strategy &amp; Plan (<code>STR-</code>) sudah dipensiunkan</strong> sejak
            2026-09-08. Halaman ini hanya untuk membaca riwayat &mdash; nol tombol yang
            memajukan statusnya, karena persetujuannya memang sudah tidak ada.
          </p>
          <p style={{ marginBottom: 0 }}>
            Strategi yang berlaku sekarang adalah <strong><code>STRG-</code></strong>, dibuat dan
            disetujui dari halaman layanannya. Ia punya versioning dan ia yang membuka gerbang
            Brief.
          </p>
        </div>
        {strategy.service_id && (
          <p className="muted" style={{ fontSize: 13 }}>
            Buka layanannya:{' '}
            <Link href={`/account/services/${strategy.service_id}`}>{strategy.service_id}</Link>
          </p>
        )}
      </section>
    </div>
  );
}
