'use client';

/**
 * MEA SKU Screener — Modul D, Optimization Tracker (R12).
 *
 * The one MUTABLE table in Gelombang 3: a row is opened with the "sebelum"
 * numbers (D1/D2), and the "sesudah" numbers arrive later (D3) — so the row is
 * updated rather than appended. Its two siblings (`screening_run`,
 * `ads_decision_log`) carry `forbid_mutation`; this one carries
 * `set_updated_at` instead, which is the schema itself stating the difference.
 *
 * WHICH metric a row is judged on is decided by the change type at D1 (R12: the
 * four click-side changes are judged on CTR, the six closing-side ones on CR),
 * and exactly ONE change type per row is allowed — R12 rejects a record that
 * claims two. So the change type is a single-choice select, never a multi-pick,
 * and filling "sesudah" cannot change what the row measures.
 *
 * `BELUM CUKUP DATA` is the honest verdict until the "sesudah" period clears the
 * click floor (R10, default 20). The verdict and the delta both come back
 * computed — nothing here recomputes them.
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  CHANGE_TYPE_OPTIONS,
  createTrackerRow,
  DEFAULT_MIN_KLIK_SESUDAH,
  INITIAL_ROUTE_OPTIONS,
  listTrackerRows,
  recordTrackerAfter,
  type TrackerMetrics,
  type TrackerRow,
} from '@/lib/skuscreener';
import { fmtDeltaPct, fmtPct, verdictTone } from '@/lib/skuscreener-ui';

/** What the Modul A table hands over when the advertiser clicks "tracker". */
export interface TrackerPrefill {
  productCode: string;
  productName: string;
  initialRoute: string;
  views: number;
  clicks: number;
  ctr: number | null;
  cr: number | null;
  orders: number;
}

/** The five metric fields as free text, so a blank stays blank until submit. */
interface MetricFields {
  views: string;
  clicks: string;
  ctr: string;
  cr: string;
  orders: string;
}

const emptyMetrics: MetricFields = { views: '', clicks: '', ctr: '', cr: '', orders: '' };

function num(s: string): number {
  return Number(String(s).trim().replace(',', '.'));
}

/** Every one of the five must be a real number — the server's `TrackerMetrics` has no nullable field. */
function metricsComplete(m: MetricFields): boolean {
  return (['views', 'clicks', 'ctr', 'cr', 'orders'] as const).every((k) => {
    const v = num(m[k]);
    return m[k].trim() !== '' && Number.isFinite(v);
  });
}

function toMetrics(m: MetricFields): TrackerMetrics {
  return { views: num(m.views), clicks: num(m.clicks), ctr: num(m.ctr), cr: num(m.cr), orders: num(m.orders) };
}

const MSG_METRICS_INCOMPLETE = '[lengkapi kelima angka: views, klik, CTR, CR, pesanan]';

function MetricInputs({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: MetricFields;
  onChange: (next: MetricFields) => void;
  disabled: boolean;
  idPrefix: string;
}) {
  const field = (k: keyof MetricFields, label: string) => (
    <div className="field" key={k}>
      <label htmlFor={`${idPrefix}-${k}`}>{label}</label>
      <input
        id={`${idPrefix}-${k}`}
        value={value[k]}
        disabled={disabled}
        inputMode="decimal"
        onChange={(e) => onChange({ ...value, [k]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {field('views', 'Views')}
      {field('clicks', 'Klik')}
      {field('ctr', 'CTR (%)')}
      {field('cr', 'CR (%)')}
      {field('orders', 'Pesanan')}
    </div>
  );
}

export default function TrackerPanel({
  screeningId,
  clientId,
  prefill,
  onPrefillConsumed,
  canWrite,
}: {
  screeningId: string;
  clientId: string;
  prefill: TrackerPrefill | null;
  onPrefillConsumed: () => void;
  canWrite: boolean;
}) {
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [changeDate, setChangeDate] = useState('');
  const [initialRoute, setInitialRoute] = useState<string>('OPTIMASI GAMBAR/JUDUL');
  const [changeType, setChangeType] = useState<string>('Gambar utama');
  const [before, setBefore] = useState<MetricFields>({ ...emptyMetrics });
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Which row's "sesudah" form is open. One at a time — the form is wide. */
  const [openAfter, setOpenAfter] = useState<string | null>(null);
  const [after, setAfter] = useState<MetricFields>({ ...emptyMetrics });
  const [minKlik, setMinKlik] = useState(String(DEFAULT_MIN_KLIK_SESUDAH));
  const [budgetDecision, setBudgetDecision] = useState('');
  const [afterErr, setAfterErr] = useState<string | null>(null);
  const [afterSaving, setAfterSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!screeningId) return;
    try {
      setRows(await listTrackerRows(screeningId));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errorMessage(e));
    }
  }, [screeningId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!prefill) return;
    setProductCode(prefill.productCode);
    setProductName(prefill.productName);
    setInitialRoute(prefill.initialRoute);
    // A SKU with no clicks has no CTR/CR at all (they arrive null). Prefilling
    // those as 0 would put a fabricated "sebelum" baseline into an immutable-ish
    // comparison, so the fields stay blank and the advertiser states them.
    setBefore({
      views: String(prefill.views),
      clicks: String(prefill.clicks),
      ctr: prefill.ctr == null ? '' : String(prefill.ctr),
      cr: prefill.cr == null ? '' : String(prefill.cr),
      orders: String(prefill.orders),
    });
    onPrefillConsumed();
  }, [prefill, onPrefillConsumed]);

  const submit = async () => {
    if (!metricsComplete(before)) {
      setErr(MSG_METRICS_INCOMPLETE);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await createTrackerRow(screeningId, {
        clientId,
        productCode: productCode.trim() === '' ? null : productCode.trim(),
        productName: productName.trim(),
        changeDate,
        initialRoute,
        changeType,
        before: toMetrics(before),
        notes: notes.trim() === '' ? null : notes.trim(),
      });
      setProductCode('');
      setProductName('');
      setChangeDate('');
      setBefore({ ...emptyMetrics });
      setNotes('');
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const submitAfter = async (code: string) => {
    if (!metricsComplete(after)) {
      setAfterErr(MSG_METRICS_INCOMPLETE);
      return;
    }
    setAfterSaving(true);
    setAfterErr(null);
    try {
      await recordTrackerAfter(screeningId, code, {
        after: toMetrics(after),
        minKlikSesudah: minKlik.trim() === '' ? undefined : num(minKlik),
        budgetDecision: budgetDecision.trim() === '' ? null : budgetDecision.trim(),
      });
      setOpenAfter(null);
      setAfter({ ...emptyMetrics });
      setBudgetDecision('');
      await reload();
    } catch (e) {
      setAfterErr(errorMessage(e));
    } finally {
      setAfterSaving(false);
    }
  };

  if (!screeningId) {
    return (
      <div className="emptyState">
        Pilih satu screening run dulu — baris tracker adalah anak dari sebuah run (kunci: run + kode produk).
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {canWrite && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buka baris tracker (sebelum)</h2>
          </div>
          {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}
          <div className="grid2">
            <div className="field">
              <label>Kode produk (kosongkan bila export tak punya kolomnya)</label>
              <input value={productCode} disabled={saving} onChange={(e) => setProductCode(e.target.value)} />
            </div>
            <div className="field">
              <label>Nama produk</label>
              <input value={productName} disabled={saving} onChange={(e) => setProductName(e.target.value)} />
            </div>
            <div className="field">
              <label>Tanggal perubahan</label>
              <input type="date" value={changeDate} disabled={saving} onChange={(e) => setChangeDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Rute awal (dari screening)</label>
              <select value={initialRoute} disabled={saving} onChange={(e) => setInitialRoute(e.target.value)}>
                {INITIAL_ROUTE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Jenis perubahan (satu saja — R12 menolak dua sekaligus)</label>
              <select value={changeType} disabled={saving} onChange={(e) => setChangeType(e.target.value)}>
                {CHANGE_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                Metrik yang dinilai (CTR atau CR) ditentukan server dari jenis perubahan ini.
              </span>
            </div>
          </div>

          <div className="field">
            <label>Angka SEBELUM perubahan</label>
            <MetricInputs value={before} onChange={setBefore} disabled={saving} idPrefix="before" />
          </div>

          <div className="field">
            <label>Catatan (opsional)</label>
            <textarea value={notes} rows={2} disabled={saving} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <button type="button" className="btn btnPrimary btnSm" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Menyimpan…' : 'Buka baris tracker'}
          </button>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Tracker Optimasi — {rows.length} baris</h2>
        </div>
        {loadErr && <div className="alert alertError" style={{ fontSize: 13 }}>{loadErr}</div>}
        {rows.length === 0 ? (
          <div className="emptyState">Belum ada baris tracker pada run ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Produk</th>
                  <th>Tanggal</th>
                  <th>Jenis perubahan</th>
                  <th>Dinilai lewat</th>
                  <th>CTR seb → ses</th>
                  <th>CR seb → ses</th>
                  <th>Δ metrik dinilai</th>
                  <th>Verdict</th>
                  <th>Keputusan budget</th>
                  {canWrite && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product_code}>
                    <td>
                      {r.product_name}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.product_code} · rute awal {r.initial_route}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.change_date}</td>
                    <td>{r.change_type}</td>
                    <td><span className="badge badge-blue">{r.metric_evaluated}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {fmtPct(r.before.ctr)} → {r.after ? fmtPct(r.after.ctr) : '—'}
                      <div className="muted" style={{ fontSize: 12 }}>{fmtDeltaPct(r.delta_ctr_pct)}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {fmtPct(r.before.cr)} → {r.after ? fmtPct(r.after.cr) : '—'}
                      <div className="muted" style={{ fontSize: 12 }}>{fmtDeltaPct(r.delta_cr_pct)}</div>
                    </td>
                    <td><b>{fmtDeltaPct(r.delta_metric_pct)}</b></td>
                    <td><span className={`badge badge-${verdictTone(r.verdict)}`}>{r.verdict}</span></td>
                    <td>{r.budget_decision ?? '—'}</td>
                    {canWrite && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          className="btn btnGhost btnSm"
                          onClick={() => {
                            setOpenAfter((cur) => (cur === r.product_code ? null : r.product_code));
                            setAfter({ ...emptyMetrics });
                            setAfterErr(null);
                          }}
                        >
                          {openAfter === r.product_code ? 'tutup' : r.after ? 'perbarui sesudah' : 'isi sesudah'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openAfter != null && canWrite && (
          <div className="stack" style={{ gap: 10, marginTop: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Angka SESUDAH — {openAfter}</h3>
            {afterErr && <div className="alert alertError" style={{ fontSize: 13 }}>{afterErr}</div>}
            <MetricInputs value={after} onChange={setAfter} disabled={afterSaving} idPrefix="after" />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="field">
                <label>Ambang klik &ldquo;sesudah&rdquo;</label>
                <input value={minKlik} disabled={afterSaving} inputMode="numeric" style={{ maxWidth: 120 }}
                  onChange={(e) => setMinKlik(e.target.value)} />
              </div>
              <div className="field">
                <label>Keputusan budget (opsional)</label>
                <input value={budgetDecision} disabled={afterSaving} placeholder="naikkan +30%"
                  onChange={(e) => setBudgetDecision(e.target.value)} />
              </div>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              Di bawah ambang klik, verdict-nya BELUM CUKUP DATA — itu jawaban jujur, bukan kegagalan.
            </span>
            <button
              type="button"
              className="btn btnPrimary btnSm"
              disabled={afterSaving}
              onClick={() => void submitAfter(openAfter)}
            >
              {afterSaving ? 'Menyimpan…' : 'Simpan angka sesudah'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
