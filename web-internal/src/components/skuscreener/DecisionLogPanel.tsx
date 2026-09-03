'use client';

/**
 * MEA SKU Screener — Modul C, Ads Decision Log (`ADL-`).
 *
 * Append-only, and the form says so out loud: there is no PATCH or DELETE route
 * for an `ADL-` row (the table carries a `forbid_mutation` trigger), so a
 * correction is a NEW row rather than an edit. That is the point of the log —
 * what the advertiser believed at the moment of deciding is the record.
 *
 * Everything derived is left to the server and shown read-only afterwards:
 * `status_vs_target` (metric vs target), `roas_result` (from spend/GMV), and the
 * `PREMATUR` flag (R14: fewer than 50 clicks AND fewer than 3 conversions AND
 * fewer than 3 days). The form never sends them — house rule #4.
 *
 * `ADL-` is deliberately NOT `OPT-` (M8): `OPT-` logs a change to a running
 * CAMPAIGN, `ADL-` logs a pre-campaign decision about a SKU plus the R15
 * decision ladder. Two entities, one reason each (DECISIONS.md, SC-07).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  DECISION_OPTIONS,
  listDecisions,
  logDecision,
  METRIC_KEY_OPTIONS,
  MOMEN_OPTIONS,
  MOMEN_REVIEW,
  OBJECT_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
  SOP_STAGE_OPTIONS,
  VERDICT_OPTIONS,
  type DecisionLogEntry,
} from '@/lib/skuscreener';
import { fmtDec, fmtRupiah, momenLabel, statusVsTargetTone } from '@/lib/skuscreener-ui';

/** What the Modul A table hands over when the advertiser clicks "catat keputusan". */
export interface DecisionPrefill {
  screeningId: string;
  objectName: string;
  /** Suggested only — the advertiser confirms or changes it. */
  decision: string;
}

const blank = {
  platform: 'Shopee' as string,
  objectType: 'SKU' as string,
  objectName: '',
  momen: 'masuk_iklan' as string,
  sopStage: '1-Screening SKU' as string,
  decision: 'Loloskan ke iklan' as string,
  metricKey: 'ROAS' as string,
  metricValue: '',
  metricTarget: '',
  spend7d: '',
  gmv7d: '',
  verdict: '',
  reviewsDecisionId: '',
  klik: '',
  konversi: '',
  hariJalan: '',
  notes: '',
};

/** Blank stays blank: an empty numeric field is "not stated", never 0. */
function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export default function DecisionLogPanel({
  clientId,
  prefill,
  onPrefillConsumed,
  canWrite,
}: {
  clientId: string;
  prefill: DecisionPrefill | null;
  onPrefillConsumed: () => void;
  canWrite: boolean;
}) {
  const [rows, setRows] = useState<DecisionLogEntry[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [screeningId, setScreeningId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await listDecisions(clientId));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errorMessage(e));
    }
  }, [clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!prefill) return;
    setForm((f) => ({ ...f, objectName: prefill.objectName, objectType: 'SKU', decision: prefill.decision }));
    setScreeningId(prefill.screeningId);
    onPrefillConsumed();
  }, [prefill, onPrefillConsumed]);

  const isReview = form.momen === MOMEN_REVIEW;

  /**
   * Only a NON-review row of this client can be reviewed — exactly the server's
   * rule (`MSG_REVIEW_TARGET_IS_REVIEW`). Offering review rows here would make
   * the form produce a guaranteed 400.
   */
  const reviewable = useMemo(() => rows.filter((r) => r.momen !== MOMEN_REVIEW), [rows]);

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const klik = numOrNull(form.klik);
      const konversi = numOrNull(form.konversi);
      const hariJalan = numOrNull(form.hariJalan);
      // R14 is computed from all three together, so a partially filled trio is
      // not sent at all: the server then leaves `premature` false rather than
      // treating a blank as a zero and flagging a decision PREMATUR by accident.
      const dataPendukung =
        klik != null && konversi != null && hariJalan != null ? { klik, konversi, hariJalan } : null;
      const created = await logDecision(clientId, {
        screeningId: screeningId.trim() === '' ? null : screeningId.trim(),
        platform: form.platform,
        objectType: form.objectType,
        objectName: form.objectName.trim(),
        momen: form.momen,
        sopStage: form.sopStage,
        decision: form.decision,
        metricKey: form.metricKey,
        metricValue: Number(form.metricValue.replace(',', '.')),
        metricTarget: Number(form.metricTarget.replace(',', '.')),
        spend7d: numOrNull(form.spend7d),
        gmv7d: numOrNull(form.gmv7d),
        verdict: form.verdict === '' ? null : form.verdict,
        reviewsDecisionId: isReview && form.reviewsDecisionId !== '' ? form.reviewsDecisionId : null,
        dataPendukung,
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
      });
      setForm({ ...blank });
      setScreeningId('');
      setOk(
        `${created.id} tercatat — ${created.status_vs_target}${created.premature ? ' · ditandai PREMATUR (R14)' : ''}.`,
      );
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      {canWrite && (
        <section className="card">
          <div className="cardHeader">
            <h2>Catat keputusan (append-only)</h2>
          </div>
          {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}
          {ok && <div className="alert alertSuccess" style={{ fontSize: 13 }}>{ok}</div>}

          <div className="grid2">
            <div className="field">
              <label>Platform</label>
              <select value={form.platform} disabled={saving} onChange={(e) => set('platform', e.target.value)}>
                {PLATFORM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Jenis objek</label>
              <select value={form.objectType} disabled={saving} onChange={(e) => set('objectType', e.target.value)}>
                {OBJECT_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Nama objek (SKU / kampanye / kreator)</label>
              <input value={form.objectName} disabled={saving} onChange={(e) => set('objectName', e.target.value)} />
            </div>
            <div className="field">
              <label>Screening run terkait (opsional)</label>
              <input
                value={screeningId}
                disabled={saving}
                placeholder="SCR-YYYYMM-NNNN"
                onChange={(e) => setScreeningId(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Momen keputusan</label>
              <select value={form.momen} disabled={saving} onChange={(e) => set('momen', e.target.value)}>
                {MOMEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Tahap SOP</label>
              <select value={form.sopStage} disabled={saving} onChange={(e) => set('sopStage', e.target.value)}>
                {SOP_STAGE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Keputusan</label>
              <select value={form.decision} disabled={saving} onChange={(e) => set('decision', e.target.value)}>
                {DECISION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Metrik kunci</label>
              <select value={form.metricKey} disabled={saving} onChange={(e) => set('metricKey', e.target.value)}>
                {METRIC_KEY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Nilai metrik saat memutuskan</label>
              <input value={form.metricValue} disabled={saving} inputMode="decimal"
                onChange={(e) => set('metricValue', e.target.value)} />
            </div>
            <div className="field">
              <label>Target metrik</label>
              <input value={form.metricTarget} disabled={saving} inputMode="decimal"
                onChange={(e) => set('metricTarget', e.target.value)} />
            </div>
            <div className="field">
              <label>Spend 7 hari (Rp, opsional)</label>
              <input value={form.spend7d} disabled={saving} inputMode="decimal"
                onChange={(e) => set('spend7d', e.target.value)} />
            </div>
            <div className="field">
              <label>GMV 7 hari (Rp, opsional)</label>
              <input value={form.gmv7d} disabled={saving} inputMode="decimal"
                onChange={(e) => set('gmv7d', e.target.value)} />
            </div>
            <div className="field">
              <label>Verdict (opsional)</label>
              <select value={form.verdict} disabled={saving} onChange={(e) => set('verdict', e.target.value)}>
                <option value="">— belum dinilai —</option>
                {VERDICT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {isReview && (
              <div className="field">
                <label>Keputusan yang di-review (wajib untuk follow-up 7 hari)</label>
                <select
                  value={form.reviewsDecisionId}
                  disabled={saving}
                  onChange={(e) => set('reviewsDecisionId', e.target.value)}
                >
                  <option value="">— pilih —</option>
                  {reviewable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id} · {r.object_name} · {r.decision}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="field">
            <label>Data pendukung untuk R14 (opsional — isi ketiganya atau kosongkan semua)</label>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input value={form.klik} disabled={saving} placeholder="klik" inputMode="numeric" style={{ maxWidth: 130 }}
                onChange={(e) => set('klik', e.target.value)} />
              <input value={form.konversi} disabled={saving} placeholder="konversi" inputMode="numeric" style={{ maxWidth: 130 }}
                onChange={(e) => set('konversi', e.target.value)} />
              <input value={form.hariJalan} disabled={saving} placeholder="hari berjalan" inputMode="numeric" style={{ maxWidth: 150 }}
                onChange={(e) => set('hariJalan', e.target.value)} />
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              Keputusan ditandai PREMATUR bila klik &lt; 50 DAN konversi &lt; 3 DAN hari berjalan &lt; 3. Angka ini
              tidak disimpan sebagai kolom — hanya tandanya.
            </span>
          </div>

          <div className="field">
            <label>Catatan (opsional)</label>
            <textarea value={form.notes} disabled={saving} rows={2}
              onChange={(e) => set('notes', e.target.value)} />
          </div>

          <button type="button" className="btn btnPrimary btnSm" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Menyimpan…' : 'Catat keputusan'}
          </button>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Decision Log — {rows.length} baris</h2>
        </div>
        {loadErr && <div className="alert alertError" style={{ fontSize: 13 }}>{loadErr}</div>}
        {rows.length === 0 ? (
          <div className="emptyState">Belum ada keputusan tercatat untuk klien ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Objek</th>
                  <th>Momen / Tahap</th>
                  <th>Keputusan</th>
                  <th>Metrik</th>
                  <th>vs Target</th>
                  <th>Spend / GMV 7h</th>
                  <th>ROAS</th>
                  <th>Verdict</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.id}
                      {r.premature && <> <span className="badge badge-amber">PREMATUR</span></>}
                      {r.reviews_decision_id && (
                        <div className="muted" style={{ fontSize: 12 }}>review dari {r.reviews_decision_id}</div>
                      )}
                    </td>
                    <td>
                      {r.object_name}
                      <div className="muted" style={{ fontSize: 12 }}>{r.object_type} · {r.platform}</div>
                    </td>
                    <td>
                      {momenLabel(r.momen, MOMEN_OPTIONS)}
                      <div className="muted" style={{ fontSize: 12 }}>{r.sop_stage}</div>
                    </td>
                    <td>{r.decision}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.metric_key}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {fmtDec(r.metric_value)} / target {fmtDec(r.metric_target)}
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${statusVsTargetTone(r.status_vs_target)}`}>
                        {r.status_vs_target}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {fmtRupiah(r.spend_7d)}
                      <div className="muted" style={{ fontSize: 12 }}>{fmtRupiah(r.gmv_7d)}</div>
                    </td>
                    <td>{r.roas_result == null ? '—' : r.roas_result.toFixed(2)}</td>
                    <td>{r.verdict ?? '—'}</td>
                    <td style={{ maxWidth: 220 }}>{r.notes ?? '—'}</td>
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
