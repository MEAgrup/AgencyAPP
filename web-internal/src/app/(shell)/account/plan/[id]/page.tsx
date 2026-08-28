'use client';

/**
 * Module 6B — the Plan period page (`/account/plan/{id}`).
 *
 * This is the layer where a Strategi's arah becomes "kerjaan minggu ini": the
 * PLAN- period, its per-channel targets (P-B), and — the point of the screen —
 * the **baris rencana kerja** (P-C): one row per channel × pilar × aksi carrying
 * a **kuota + satuan** ("40 video", "36 jam live", "30 kreator"), a division PIC,
 * and its weeks. That table is the "pembagian jumlah pekerjaan dengan target
 * baseline" the owner asked for.
 *
 * ## Why rows are added by hand here
 *
 * `generatePlanPeriods` (run on Strategi approval) seeds the period + its
 * `plan_target` rows from Strategi D-2 — but it does **not** seed work rows. So
 * breaking the target/commitment into concrete quantities IS this page's
 * add-row step (`createPlanRow`), not a background job. Each row then descends
 * into one Brief with a single click (RAB-16, `inheritBriefsFromPlan`), where the
 * AM fills only due date + priority.
 *
 * ## Scope of this first cut
 *
 * Read + the "jumlah pekerjaan" write path: view period/targets/rows/weeks, add
 * rows, run the lifecycle (submit / approve / return / activate), and inherit
 * Briefs. Realisasi (P-E), the close review (P-F), and carry-over (PF-5) have
 * domain functions but no routes yet — they are a later cut, and the page says
 * so rather than pretending the period can be closed here.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAccountLead, isAccountStaff, isReadOnlyOD } from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';
import { formatIDR } from '@/lib/money';
import { getStrategi, type StrategiPillar } from '@/lib/strategi';
import { suggestRowFromPillar } from '@/lib/plan-row-suggest';
import {
  activatePlanPeriode,
  approvePlanPeriode,
  createPlanRow,
  getPlanDetail,
  inheritBriefsFromPlan,
  returnPlanPeriode,
  saveCatatanPembuka,
  submitPlanPeriode,
  type CreatePlanRowBody,
  type PlanDetail,
  type PlanRow,
} from '@/lib/plan';

// --- vocab (mirrors the DB CHECKs / brief-inherit allow-lists) --------------

const PILAR: { value: string; label: string }[] = [
  { value: 'sku', label: 'SKU / Listing' },
  { value: 'harga', label: 'Harga & Promo' },
  { value: 'iklan', label: 'Iklan' },
  { value: 'konten', label: 'Konten' },
  { value: 'affiliate', label: 'Affiliate / KOL' },
  { value: 'live', label: 'Live (vendor)' },
  { value: 'retensi', label: 'Retensi / CRM' },
  { value: 'operasional', label: 'Operasional' },
];
const PILAR_LABEL: Record<string, string> = Object.fromEntries(PILAR.map((p) => [p.value, p.label]));

// All six PC-8 divisions (BRIEF_ASSIGNABLE_DIVISIONS in account.ts). Account/Ops
// rows also inherit a Brief (owner decision, docs/DECISIONS.md 2026-08-27) —
// read via the generic /tasks division queue, since neither has a dedicated board.
const DIVISI_PIC = ['Creative', 'Ads', 'KOL', 'Live Stream', 'Account', 'Ops'];
const ROW_PRIORITAS = ['Wajib', 'Penting', 'Kalau Sempat'];
const BRIEF_PRIORITAS = ['Low', 'Medium', 'High'];

const METRIC_LABEL: Record<string, string> = {
  gmv: 'GMV',
  pengunjung: 'Pengunjung',
  cr: 'Conversion Rate',
  aov: 'AOV',
  roas_min: 'ROAS min',
  acos_maks: 'ACOS maks',
  sku_winner: 'SKU winner baru',
  affiliate_aktif: 'Affiliate aktif',
  jam_live: 'Jam live',
  jumlah_video: 'Jumlah video',
};
const MONEY_METRIC = new Set(['gmv', 'aov']);

const SKIP_LABEL: Record<string, string> = {
  di_luar: 'baris di luar strategi/service',
  service_ambigu: 'service belum jelas',
  tanpa_jadwal: 'belum diberi jatuh tempo + prioritas',
  sudah_diwarisi: 'sudah punya Brief',
  service_tidak_ditemukan: 'service tak ditemukan',
  service_tidak_briefable: 'service tak bisa dibrief',
  divisi_pic_tidak_valid: 'divisi PIC tidak valid',
  kuota_nol: 'kuota 0',
};

// --- add-row draft ----------------------------------------------------------

const ROW_VISIBILITAS = ['Bagikan ke Klien', 'Internal Saja'];

interface RowDraft {
  channel: string;
  pilar: string;
  aksi: string;
  kuota: string;
  satuan: string;
  budget: string;
  divisi_pic: string;
  minggu_sasaran: number[];
  prioritas: string;
  hasil_diharapkan: string;
  /** PC-5 — comma-separated SKUs; parsed to an array at submit. */
  sku_sasaran: string;
  prasyarat: string;
  visibilitas: string;
  /** Origin (PC-3): a Strategi pillar id, or empty ⇒ Di Luar Strategi. */
  strategi_pillar_id: string;
  di_luar_alasan: string;
}

function blankRow(channel: string): RowDraft {
  return {
    channel,
    pilar: 'konten',
    aksi: '',
    kuota: '',
    satuan: '',
    budget: '',
    divisi_pic: 'Creative',
    minggu_sasaran: [],
    prioritas: 'Wajib',
    hasil_diharapkan: '',
    sku_sasaran: '',
    prasyarat: '',
    visibilitas: 'Bagikan ke Klien',
    strategi_pillar_id: '',
    di_luar_alasan: '',
  };
}

function parseSkuSasaran(s: string): string[] {
  return s
    .split(',')
    .map((sku) => sku.trim())
    .filter((sku) => sku !== '');
}

function rowDraftToBody(d: RowDraft): CreatePlanRowBody {
  const pillarId = d.strategi_pillar_id.trim() ? Number(d.strategi_pillar_id) : null;
  return {
    channel: d.channel,
    pilar: d.pilar,
    // PC-3 exactly-one origin: a pillar reference, else Di Luar Strategi + alasan.
    strategi_pillar_id: pillarId,
    di_luar_strategi: pillarId === null,
    di_luar_alasan: pillarId === null ? d.di_luar_alasan.trim() || null : null,
    aksi: d.aksi.trim(),
    kuota: d.kuota.trim() ? Number(d.kuota) : 0,
    satuan: d.satuan.trim(),
    budget: d.budget.trim() ? Number(d.budget) : null,
    divisi_pic: d.divisi_pic,
    minggu_sasaran: d.minggu_sasaran,
    prioritas: d.prioritas,
    hasil_diharapkan: d.hasil_diharapkan.trim(),
    sku_sasaran: parseSkuSasaran(d.sku_sasaran),
    prasyarat: d.prasyarat.trim() || null,
    visibilitas: d.visibilitas,
  };
}

export default function PlanPeriodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);
  const canWrite = !readOnly && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);
  const canApprove = !readOnly && (isAccountLead(role) || !!role?.director);

  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [pillars, setPillars] = useState<StrategiPillar[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const [returnNote, setReturnNote] = useState('');
  const [rowDraft, setRowDraft] = useState<RowDraft | null>(null);
  const [pembuka, setPembuka] = useState('');

  // Brief one-click: per-row { due_date, priority } the AM fills before inheriting.
  const [fills, setFills] = useState<Record<number, { due_date: string; priority: string }>>({});
  const [inheritMsg, setInheritMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await getPlanDetail(id);
      setDetail(d);
      setPembuka(d.plan.catatan_pembuka ?? '');
      // Origin dropdown for new rows: the Strategi's pillars. Advisory — a failure
      // here must not fail the page (rows can still be added Di Luar Strategi).
      if (d.plan.strategi_id) {
        getStrategi(d.plan.strategi_id)
          .then((s) => setPillars(s.pillars))
          .catch(() => setPillars([]));
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setActing(true);
      setError(null);
      try {
        await fn();
        await load();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setActing(false);
      }
    },
    [load],
  );

  const weeksByRow = useMemo(() => {
    const m = new Map<number, { minggu_no: number; kuota: number }[]>();
    for (const w of detail?.weeks ?? []) {
      const arr = m.get(w.plan_row_id) ?? [];
      arr.push({ minggu_no: w.minggu_no, kuota: w.kuota });
      m.set(w.plan_row_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.minggu_no - b.minggu_no);
    return m;
  }, [detail]);

  // Channel options: the plan's own channels (from targets/rows), falling back
  // to a plain text entry when neither exists yet.
  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of detail?.targets ?? []) set.add(t.channel);
    for (const r of detail?.rows ?? []) set.add(r.channel);
    return [...set];
  }, [detail]);

  if (loading) return <p className="pageLoading">Memuat…</p>;
  if (loadError) return <div className="alert alertError">{loadError}</div>;
  if (!detail) return <div className="alert alertError">[Plan tidak ditemukan]</div>;

  const { plan, targets, rows } = detail;
  const status = plan.status;
  const canAddRow = canWrite && (status === 'Draft' || status === 'Aktif');
  const canSubmit = canWrite && status === 'Draft';
  const canDecide = canApprove && status === 'Diajukan';
  const canActivate = canWrite && (status === 'Terjadwal' || status === 'Menunggu Persetujuan');
  const canInherit = canWrite && status === 'Aktif';

  const savePembuka = () => act(() => saveCatatanPembuka(id, pembuka));

  const submitRow = async () => {
    if (!rowDraft) return;
    await act(async () => {
      await createPlanRow(id, rowDraftToBody(rowDraft));
      setRowDraft(null);
    });
  };

  const runInherit = async () => {
    const list = rows
      .filter((r) => r.kuota > 0)
      .map((r) => ({
        plan_row_id: r.id,
        due_date: fills[r.id]?.due_date ?? '',
        priority: fills[r.id]?.priority ?? '',
      }))
      .filter((f) => f.due_date && f.priority);
    if (list.length === 0) {
      setInheritMsg('Isi jatuh tempo + prioritas minimal satu baris dulu.');
      return;
    }
    setActing(true);
    setError(null);
    setInheritMsg(null);
    try {
      const res = await inheritBriefsFromPlan(id, list);
      const skipTxt = res.skipped
        .map((s) => `baris ${s.plan_row_id}: ${SKIP_LABEL[s.reason] ?? s.reason}`)
        .join('; ');
      setInheritMsg(
        `${res.created.length} Brief dibuat` + (skipTxt ? ` · dilewati — ${skipTxt}` : ''),
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActing(false);
    }
  };

  const metricValue = (metric: string, nilai: number) =>
    MONEY_METRIC.has(metric) ? formatIDR(nilai) : String(nilai);

  return (
    <div className="stack">
      {/* -------- P-A header -------- */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>{plan.id}</h1>
          <StatusBadge status={status} />
          <span className="muted">periode {plan.periode_no}</span>
          <span style={{ flex: 1 }} />
          {plan.strategi_id && (
            <Link href={`/account/strategi/${plan.strategi_id}`} className="btn btnGhost btnSm">
              Strategi induk
            </Link>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          {plan.tanggal_mulai} → {plan.tanggal_akhir} · {plan.jumlah_minggu} minggu ·{' '}
          Defisit terbawa: {formatIDR(detail.defisit_terbawa)}
        </p>
        {canSubmit ? (
          <div style={{ marginTop: 8 }}>
            <textarea
              rows={2}
              placeholder="Catatan pembuka (opsional)"
              value={pembuka}
              onChange={(e) => setPembuka(e.target.value)}
              disabled={acting}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btnSm"
                disabled={acting || pembuka.trim() === (plan.catatan_pembuka ?? '').trim()}
                onClick={() => void savePembuka()}
              >
                Simpan catatan pembuka
              </button>
            </div>
          </div>
        ) : (
          plan.catatan_pembuka && (
            <p style={{ fontSize: 13, marginTop: 8 }}>{plan.catatan_pembuka}</p>
          )
        )}
      </div>

      {error && <div className="alert alertError">{error}</div>}

      {/* -------- lifecycle -------- */}
      {(canSubmit || canDecide || canActivate) && (
        <div className="card">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canSubmit && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={acting}
                onClick={() => void act(() => submitPlanPeriode(id))}
              >
                Aktifkan periode 1
              </button>
            )}
            {canActivate && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={acting}
                onClick={() => void act(() => activatePlanPeriode(id))}
              >
                Aktifkan periode
              </button>
            )}
            {canDecide && (
              <>
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={acting}
                  onClick={() => void act(() => approvePlanPeriode(id))}
                >
                  Setujui
                </button>
                <input
                  placeholder="Catatan pengembalian (wajib)"
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button
                  type="button"
                  className="btn btnDanger"
                  disabled={acting || returnNote.trim() === ''}
                  onClick={() => void act(() => returnPlanPeriode(id, returnNote.trim()))}
                >
                  Kembalikan
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* -------- P-B targets -------- */}
      <div className="card">
        <div className="cardHeader">Target periode (P-B)</div>
        {targets.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Belum ada target — target diturunkan dari Strategi D-2 saat periode dibuat.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Channel</th>
                  <th style={{ textAlign: 'left' }}>Metrik</th>
                  <th style={{ textAlign: 'left' }}>Dari Strategi</th>
                  <th style={{ textAlign: 'left' }}>Dipakai</th>
                  <th style={{ textAlign: 'left' }}>Arah</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={`${t.channel}-${t.metric}`}>
                    <td style={{ paddingRight: 8 }}>{t.channel}</td>
                    <td style={{ paddingRight: 8 }}>{METRIC_LABEL[t.metric] ?? t.metric}</td>
                    <td style={{ paddingRight: 8 }}>{metricValue(t.metric, t.nilai_strategi)}</td>
                    <td style={{ paddingRight: 8 }}>{metricValue(t.metric, t.nilai_dipakai)}</td>
                    <td style={{ paddingRight: 8 }}>
                      {t.arah === 'tetap'
                        ? 'Tetap'
                        : `${t.arah === 'naik' ? 'Naik' : 'Turun'} ${t.persen_perubahan}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* -------- P-C work rows (the "jumlah pekerjaan") -------- */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <div className="cardHeader" style={{ flex: 1, marginBottom: 0 }}>
            Baris rencana kerja (P-C) — {rows.length}
          </div>
          {canAddRow && rowDraft === null && (
            <button
              type="button"
              className="btn btnSecondary btnSm"
              onClick={() => setRowDraft(blankRow(channelOptions[0] ?? ''))}
            >
              Tambah baris
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Belum ada baris kerja. Pecah target/komitmen jadi kuota konkret di sini (mis. 40 video,
            30 kreator, 36 jam live) — tiap baris nanti jadi satu Brief.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ fontSize: 13, minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Channel</th>
                  <th style={{ textAlign: 'left' }}>Pilar</th>
                  <th style={{ textAlign: 'left' }}>Aksi</th>
                  <th style={{ textAlign: 'left' }}>Kuota</th>
                  <th style={{ textAlign: 'left' }}>PIC</th>
                  <th style={{ textAlign: 'left' }}>Minggu</th>
                  <th style={{ textAlign: 'left' }}>Prioritas</th>
                  <th style={{ textAlign: 'left' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: PlanRow) => {
                  const wk = weeksByRow.get(r.id);
                  return (
                    <tr key={r.id}>
                      <td style={{ paddingRight: 8 }}>{r.channel}</td>
                      <td style={{ paddingRight: 8 }}>{PILAR_LABEL[r.pilar] ?? r.pilar}</td>
                      <td style={{ paddingRight: 8 }}>
                        {r.aksi}
                        {r.di_luar_strategi && (
                          <span className="badge badge-amber" style={{ marginLeft: 6 }}>
                            Di Luar Strategi
                          </span>
                        )}
                      </td>
                      <td style={{ paddingRight: 8, whiteSpace: 'nowrap' }}>
                        <strong>{r.kuota}</strong> {r.satuan}
                        {wk && wk.length > 0 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {wk.map((w) => `M${w.minggu_no}:${w.kuota}`).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td style={{ paddingRight: 8 }}>{r.divisi_pic}</td>
                      <td style={{ paddingRight: 8 }}>
                        {r.minggu_sasaran.length ? r.minggu_sasaran.join(', ') : '—'}
                      </td>
                      <td style={{ paddingRight: 8 }}>{r.prioritas}</td>
                      <td style={{ paddingRight: 8 }}>{r.status_baris}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* add-row form */}
        {rowDraft !== null && (
          <div className="stack" style={{ gap: 8, marginTop: 12, borderTop: '1px solid var(--border,#ddd)', paddingTop: 12 }}>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Channel</span>
                {channelOptions.length > 0 ? (
                  <select
                    value={rowDraft.channel}
                    onChange={(e) => setRowDraft({ ...rowDraft, channel: e.target.value })}
                  >
                    {channelOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={rowDraft.channel}
                    onChange={(e) => setRowDraft({ ...rowDraft, channel: e.target.value })}
                  />
                )}
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>
                  Turunan pilar Strategi (PC-3) — kosongkan ⇒ Di Luar Strategi
                </span>
                <select
                  value={rowDraft.strategi_pillar_id}
                  onChange={(e) => {
                    const pillarId = e.target.value;
                    const pillar = pillars.find((p) => String(p.id) === pillarId);
                    setRowDraft((d) => {
                      if (!d) return d;
                      if (!pillar) return { ...d, strategi_pillar_id: pillarId };
                      const s = suggestRowFromPillar(pillar);
                      return {
                        ...d,
                        strategi_pillar_id: pillarId,
                        aksi: d.aksi.trim() ? d.aksi : s.aksi,
                        kuota: d.kuota.trim() ? d.kuota : s.kuota,
                        satuan: d.satuan.trim() ? d.satuan : s.satuan,
                        divisi_pic: s.divisiPic ?? d.divisi_pic,
                        sku_sasaran: d.sku_sasaran.trim() ? d.sku_sasaran : s.skuSasaran.join(', '),
                      };
                    });
                  }}
                >
                  <option value="">— Di Luar Strategi —</option>
                  {pillars.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      #{p.id} {PILAR_LABEL[p.jenis] ?? p.jenis}
                      {p.channel ? ` · ${p.channel}` : ''}
                      {p.aksi ? ` · ${p.aksi.slice(0, 40)}` : ''}
                    </option>
                  ))}
                </select>
                <span className="muted" style={{ fontSize: 11 }}>
                  Pilih dulu — Aksi, Kuota/Satuan &amp; Divisi PIC di bawah terisi otomatis dari
                  Section E (bisa diubah).
                </span>
              </label>
              {rowDraft.strategi_pillar_id.trim() === '' && (
                <label className="field">
                  <span className="muted" style={{ fontSize: 12 }}>Alasan di luar strategi</span>
                  <input
                    value={rowDraft.di_luar_alasan}
                    onChange={(e) => setRowDraft({ ...rowDraft, di_luar_alasan: e.target.value })}
                  />
                </label>
              )}
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Pilar (PC-2)</span>
                <select
                  value={rowDraft.pilar}
                  onChange={(e) => setRowDraft({ ...rowDraft, pilar: e.target.value })}
                >
                  {PILAR.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Divisi PIC (PC-8)</span>
                <select
                  value={rowDraft.divisi_pic}
                  onChange={(e) => setRowDraft({ ...rowDraft, divisi_pic: e.target.value })}
                >
                  {DIVISI_PIC.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field" style={{ display: 'block' }}>
              <span className="muted" style={{ fontSize: 12 }}>Aksi (PC-4) — kerja konkret</span>
              <input
                placeholder='mis. "rewrite listing 7 SKU Pareto"'
                value={rowDraft.aksi}
                onChange={(e) => setRowDraft({ ...rowDraft, aksi: e.target.value })}
              />
            </label>

            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Kuota (PC-6)</span>
                <input
                  type="number"
                  min={0}
                  value={rowDraft.kuota}
                  onChange={(e) => setRowDraft({ ...rowDraft, kuota: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Satuan</span>
                <input
                  placeholder="video / kreator / jam live / listing"
                  value={rowDraft.satuan}
                  onChange={(e) => setRowDraft({ ...rowDraft, satuan: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Budget (PC-7, opsional)</span>
                <input
                  type="number"
                  min={0}
                  value={rowDraft.budget}
                  onChange={(e) => setRowDraft({ ...rowDraft, budget: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Prioritas (PC-10)</span>
                <select
                  value={rowDraft.prioritas}
                  onChange={(e) => setRowDraft({ ...rowDraft, prioritas: e.target.value })}
                >
                  {ROW_PRIORITAS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* minggu sasaran */}
            <div>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Minggu sasaran (PC-9)
              </span>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {Array.from({ length: plan.jumlah_minggu }, (_, i) => i + 1).map((wnum) => (
                  <label key={wnum} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={rowDraft.minggu_sasaran.includes(wnum)}
                      onChange={(e) =>
                        setRowDraft({
                          ...rowDraft,
                          minggu_sasaran: e.target.checked
                            ? [...rowDraft.minggu_sasaran, wnum].sort((a, b) => a - b)
                            : rowDraft.minggu_sasaran.filter((x) => x !== wnum),
                        })
                      }
                    />
                    <span>M{wnum}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="field" style={{ display: 'block' }}>
              <span className="muted" style={{ fontSize: 12 }}>Hasil yang diharapkan (PC-11)</span>
              <input
                value={rowDraft.hasil_diharapkan}
                onChange={(e) => setRowDraft({ ...rowDraft, hasil_diharapkan: e.target.value })}
              />
            </label>

            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>SKU Sasaran (PC-5, opsional)</span>
                <input
                  placeholder="RAK-A, RAK-B — pisahkan dengan koma"
                  value={rowDraft.sku_sasaran}
                  onChange={(e) => setRowDraft({ ...rowDraft, sku_sasaran: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Prasyarat (PC-12, opsional)</span>
                <input
                  placeholder="mis. akses Affiliate Center disetujui"
                  value={rowDraft.prasyarat}
                  onChange={(e) => setRowDraft({ ...rowDraft, prasyarat: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Visibilitas (PC-17)</span>
                <select
                  value={rowDraft.visibilitas}
                  onChange={(e) => setRowDraft({ ...rowDraft, visibilitas: e.target.value })}
                >
                  {ROW_VISIBILITAS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btnPrimary"
                disabled={acting}
                onClick={() => void submitRow()}
              >
                Simpan baris
              </button>
              <button
                type="button"
                className="btn btnGhost"
                disabled={acting}
                onClick={() => setRowDraft(null)}
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* -------- Brief one-click (RAB-16) -------- */}
      {canInherit && rows.some((r) => r.kuota > 0) && (
        <div className="card">
          <div className="cardHeader">Warisi baris jadi Brief (satu klik)</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Isi jatuh tempo + prioritas per baris; sisanya (divisi, kuota, satuan, hasil, SKU
            sasaran, budget) diwarisi otomatis ke instruksi Brief. Baris tanpa isian dilewati.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Baris</th>
                  <th style={{ textAlign: 'left' }}>Kuota</th>
                  <th style={{ textAlign: 'left' }}>Hasil diharapkan</th>
                  <th style={{ textAlign: 'left' }}>Budget</th>
                  <th style={{ textAlign: 'left' }}>Jatuh tempo</th>
                  <th style={{ textAlign: 'left' }}>Prioritas Brief</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.kuota > 0)
                  .map((r) => (
                    <tr key={r.id}>
                      <td style={{ paddingRight: 8 }}>
                        {PILAR_LABEL[r.pilar] ?? r.pilar} · {r.divisi_pic}
                      </td>
                      <td style={{ paddingRight: 8 }}>
                        {r.kuota} {r.satuan}
                      </td>
                      <td style={{ paddingRight: 8 }}>{r.hasil_diharapkan || '—'}</td>
                      <td style={{ paddingRight: 8 }}>{formatIDR(r.budget)}</td>
                      <td style={{ paddingRight: 8 }}>
                        <input
                          type="date"
                          value={fills[r.id]?.due_date ?? ''}
                          onChange={(e) =>
                            setFills({
                              ...fills,
                              [r.id]: {
                                due_date: e.target.value,
                                priority: fills[r.id]?.priority ?? '',
                              },
                            })
                          }
                        />
                      </td>
                      <td style={{ paddingRight: 8 }}>
                        <select
                          value={fills[r.id]?.priority ?? ''}
                          onChange={(e) =>
                            setFills({
                              ...fills,
                              [r.id]: {
                                due_date: fills[r.id]?.due_date ?? '',
                                priority: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="">—</option>
                          {BRIEF_PRIORITAS.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btnPrimary"
              disabled={acting}
              onClick={() => void runInherit()}
            >
              Warisi semua
            </button>
            {inheritMsg && <span className="muted" style={{ fontSize: 12 }}>{inheritMsg}</span>}
          </div>
        </div>
      )}

      {/* -------- honest note on what this cut does not close -------- */}
      <div className="alert alertInfo" style={{ fontSize: 12 }}>
        Realisasi/variance (P-E), review penutup (P-F), dan carry-over (PF-5) belum tersedia di layar
        ini — rutenya menyusul di iterasi berikutnya.
      </div>
    </div>
  );
}
