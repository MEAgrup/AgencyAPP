'use client';

/**
 * Module 6C Sections G-A → G-C: the plan-gate determination panel.
 *
 * Renders on the Service hub for a `ditentukan_am` Service, and read-only for the
 * two locked tiers so the AM can see WHY there is no form ("the catalog already
 * decided") instead of an unexplained absence.
 *
 * Two design constraints from the PRD that shape this file:
 *
 *  - **GB-1/GB-2 come before GB-3.** The recommendation and the triggers behind
 *    it, with their numbers, are shown BEFORE the AM answers. The recommendation
 *    is fetched from the server on every attribute change rather than recomputed
 *    here: two copies of the Rule 3 trigger table would drift, and the number the
 *    AM sees has to be the number that gets stored.
 *  - **The no-Plan path stays small (design note on GB-8).** Four fields, no
 *    more. If it grew, AMs would pick the path with less typing and the
 *    determination would stop being about the work.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import {
  FIT_LABELS,
  TIER_LABELS,
  decidePlanGate,
  getPlanGate,
  previewPlanGate,
  redecidePlanGate,
  type AssignmentSummary,
  type GateAttributesInput,
  type GateDecision,
  type GateRecommendation,
  type GateTrigger,
  type PlanGateContext,
  type TargetKind,
} from '@/lib/account';

const DIVISIONS = ['Creative', 'Ads', 'KOL', 'Live Stream', 'Account', 'Ops'];
const TARGET_KINDS: { value: TargetKind; label: string }[] = [
  { value: 'gmv', label: 'GMV' },
  { value: 'roas', label: 'ROAS' },
  { value: 'growth', label: 'Growth %' },
];

function TriggerList({ items, empty }: { items: GateTrigger[]; empty: string }) {
  if (items.length === 0) return <p className="muted" style={{ fontSize: 12 }}>{empty}</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
      {items.map((t) => (
        <li key={t.kode}>
          {t.label} <span className="muted">&mdash; {t.dasar}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PlanGatePanel({
  serviceId,
  canWrite,
  canDeescalate,
  onDecided,
}: {
  serviceId: string;
  canWrite: boolean;
  /** Rule 12: only SPV/Head Account may turn a Plan off mid-service. */
  canDeescalate: boolean;
  onDecided: () => void | Promise<void>;
}) {
  const [ctx, setCtx] = useState<PlanGateContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Section G-A / the recommendation inputs.
  const [durasi, setDurasi] = useState('');
  const [berulang, setBerulang] = useState(false);
  const [divisi, setDivisi] = useState<string[]>([]);
  const [deliverable, setDeliverable] = useState('');
  const [kuota, setKuota] = useState('');
  const [nilai, setNilai] = useState('');
  const [targetJenis, setTargetJenis] = useState<TargetKind | ''>('');
  const [targetNilai, setTargetNilai] = useState('');
  const [sequenceDep, setSequenceDep] = useState(false);
  const [laporan, setLaporan] = useState(false);

  // Section G-B.
  const [rec, setRec] = useState<GateRecommendation | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [keputusan, setKeputusan] = useState<GateDecision | ''>('');
  const [alasan, setAlasan] = useState('');
  const [pemantauan, setPemantauan] = useState('');
  const [tinjauUlang, setTinjauUlang] = useState('');
  const [ringkasan, setRingkasan] = useState<AssignmentSummary>({
    deliverable: '', deadline: '', divisi_pic: '', hasil_diharapkan: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Escalation / de-escalation (G-C).
  const [reAlasan, setReAlasan] = useState('');
  const [reSubmitting, setReSubmitting] = useState(false);
  const [reError, setReError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const c = await getPlanGate(serviceId);
      setCtx(c);
      // Pre-fill G-A from the catalog side (GA-2/GA-4 are "auto + AM confirm"),
      // and from the determination itself when one already exists.
      if (c.gate) {
        setDurasi(c.gate.durasi_bulan === null ? '' : String(c.gate.durasi_bulan));
        setBerulang(c.gate.berulang);
        setDivisi(c.gate.divisi_terlibat);
        setDeliverable(c.gate.deliverable);
        setKuota(c.gate.kuota_per_periode === null ? '' : String(c.gate.kuota_per_periode));
        setNilai(c.gate.nilai_per_bulan ?? '');
        setTargetJenis(c.gate.target_angka_jenis ?? '');
        setTargetNilai(c.gate.target_angka_nilai ?? '');
        setSequenceDep(c.gate.sequence_dependency);
        setLaporan(c.gate.laporan_periodik);
      } else {
        setNilai(c.standard_price);
        setKuota(c.min_qty === null ? '' : String(c.min_qty));
        // GA-2: a recurring catalog frequency is the recurrence, pre-confirmed.
        setBerulang((c.frequency ?? '').toLowerCase().includes('bulan'));
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    load();
  }, [load]);

  const attrs = useCallback(
    (): GateAttributesInput => ({
      durasi_bulan: durasi.trim() === '' ? null : Number(durasi),
      berulang,
      divisi_terlibat: divisi,
      target_angka_jenis: targetJenis === '' ? null : targetJenis,
      kuota_per_periode: kuota.trim() === '' ? null : Number(kuota),
      nilai_per_bulan: nilai.trim() === '' ? null : nilai.trim(),
      sequence_dependency: sequenceDep,
      laporan_periodik: laporan,
    }),
    [durasi, berulang, divisi, targetJenis, kuota, nilai, sequenceDep, laporan],
  );

  // Re-run the recommendation whenever an attribute changes. Debounced because
  // it is a round-trip on every keystroke otherwise; the ref keeps the latest
  // request from being overwritten by a slower earlier one.
  const seq = useRef(0);
  const needsForm = ctx?.tier_katalog === 'ditentukan_am';
  // Rule 11's escape hatch: a Service locked to `tanpa_plan` by the catalog has
  // no G-B form of its own (Rule 1), but can still be ESCALATED to Butuh Plan at
  // any time — "either by catalog or by AM decision" is the PRD's own wording,
  // and a service whose tier itself defaulted to no-Plan is exactly the
  // "by catalog" half. Without this the AM has no door at all once a Service
  // lands `tanpa_plan` and no `service_plan_gate` row exists yet to escalate
  // FROM (the escalate button below only renders once a row exists).
  const canEscalateLockedTier = ctx?.tier_katalog === 'tanpa_plan';
  const showForm = needsForm || canEscalateLockedTier;
  // The escalation doorway only ever asks ONE question — escalate or not — so
  // the decision is fixed to `butuh_plan` the moment the form is for that,
  // rather than reusing the neutral GB-3 picker that implies "either answer is
  // a normal first pass" (it isn't; `tanpa_plan` here is the catalog default,
  // not a choice being offered).
  useEffect(() => {
    if (canEscalateLockedTier && !needsForm) setKeputusan('butuh_plan');
  }, [canEscalateLockedTier, needsForm]);
  useEffect(() => {
    if (!showForm || !canWrite) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await previewPlanGate(serviceId, attrs());
        if (mine === seq.current) {
          setRec(r);
          setRecError(null);
        }
      } catch (err) {
        if (mine === seq.current) setRecError(errorMessage(err));
      }
    }, 350);
    return () => clearTimeout(t);
  }, [serviceId, attrs, showForm, canWrite]);

  function toggleDivisi(d: string) {
    setDivisi((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  // GB-4, computed here only to LABEL the form live. The stored value is derived
  // server-side and constrained in the DB — this is a hint, not the record.
  const fit =
    rec && keputusan !== ''
      ? rec.rekomendasi === keputusan
        ? 'sesuai'
        : rec.rekomendasi === 'butuh_plan'
          ? 'tolak_plan'
          : 'tambah_plan'
      : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (keputusan === '') return;
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const g = await decidePlanGate(serviceId, {
        ...attrs(),
        target_angka_nilai: targetNilai.trim() === '' ? null : targetNilai.trim(),
        deliverable,
        keputusan_am: keputusan,
        alasan: alasan.trim() === '' ? null : alasan.trim(),
        pemantauan_alternatif: pemantauan.trim() === '' ? null : pemantauan.trim(),
        tanggal_tinjau_ulang: tinjauUlang,
        ringkasan_penugasan: keputusan === 'tanpa_plan' ? ringkasan : null,
      });
      setMessage(
        `Keputusan tercatat: ${g.keputusan_am === 'butuh_plan' ? 'Butuh Plan' : 'Tanpa Plan'} (${FIT_LABELS[g.kesesuaian]}).`,
      );
      await load();
      await onDecided();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRedecide(to: GateDecision) {
    setReError(null);
    setReSubmitting(true);
    try {
      await redecidePlanGate(serviceId, to, reAlasan, to === 'tanpa_plan' ? ringkasan : null);
      setReAlasan('');
      await load();
      await onDecided();
    } catch (err) {
      setReError(errorMessage(err));
    } finally {
      setReSubmitting(false);
    }
  }

  if (loading) return <section className="card"><p className="muted">Memuat penentuan Plan...</p></section>;
  if (loadError) {
    return (
      <section className="card">
        <div className="alert alertError" role="alert">{loadError}</div>
      </section>
    );
  }
  if (!ctx) return null;

  const gate = ctx.gate;

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Penentuan Kebutuhan Plan</h2>
        <span className="muted" style={{ fontSize: 12 }}>{TIER_LABELS[ctx.tier_katalog]}</span>
      </div>

      {/* SECTION G-A — the context, auto where we can read it. */}
      <div className="grid2">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Tier Katalog (GA-1)</div>
          <div>{TIER_LABELS[ctx.tier_katalog]}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Skema Katalog (GA-2)</div>
          <div>{ctx.frequency || '—'}{ctx.unit ? ` · ${ctx.unit}` : ''}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Plan Satuan Klien (GA-7)</div>
          {/* Rule 6 needs the PLAN table (Module 6B). Saying so is better than an
              empty field that reads like "no Plan exists". */}
          <div>Belum tersedia &mdash; menunggu Modul 6B</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Kontrak Full Management (GA-8)</div>
          <div>{ctx.ada_kontrak_full_management ? 'Ada — layanan ini tidak boleh masuk Plan Satuan (§4b)' : 'Tidak ada'}</div>
        </div>
      </div>

      {ctx.tier_katalog !== 'ditentukan_am' && !gate && (
        <p className="muted" style={{ fontSize: 13 }}>
          Tier katalog sudah menentukan: {ctx.tier_katalog === 'plan_wajib'
            ? 'layanan ini WAJIB punya Strategi & Plan, tidak ada penentuan manual.'
            : canWrite
              ? 'layanan ini berjalan tanpa Plan. Masih bisa dieskalasi kalau pemicu keras muncul (Rule 11) — isi form eskalasi di bawah.'
              : 'layanan ini berjalan tanpa Plan. Masih bisa dieskalasi kalau pemicu keras muncul (Rule 11).'}
        </p>
      )}

      {/* SECTION G-C — the decision on record. */}
      {gate && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Rekomendasi Sistem (GB-2)</div>
              <div>{gate.rekomendasi === 'butuh_plan' ? 'Butuh Plan' : 'Tanpa Plan'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Keputusan AM (GB-3)</div>
              <div>{gate.keputusan_am === 'butuh_plan' ? 'Butuh Plan' : 'Tanpa Plan'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Kesesuaian (GB-4)</div>
              <div>{FIT_LABELS[gate.kesesuaian]}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Tinjau Ulang (GB-7)</div>
              <div>{gate.tanggal_tinjau_ulang}</div>
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Pemicu saat keputusan diambil (GB-1, ambang v{gate.config_version_no})
            </div>
            <TriggerList items={gate.pemicu_keras} empty="Tidak ada pemicu keras." />
            <TriggerList items={gate.pemicu_lunak} empty="Tidak ada pemicu lunak." />
          </div>
          {gate.alasan && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Alasan (GB-5)</div>
              <div>{gate.alasan}</div>
            </div>
          )}
          {gate.pemantauan_alternatif && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Cara Pemantauan Alternatif (GB-6)</div>
              <div>{gate.pemantauan_alternatif}</div>
            </div>
          )}

          {/* Rules 11 & 12 — escalation is the AM's, de-escalation is SPV's. */}
          {canWrite && (
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {reError && <div className="alert alertError" role="alert">{reError}</div>}
              <div className="field">
                <label htmlFor="pg-realasan">
                  {gate.keputusan_am === 'tanpa_plan' ? 'Alasan eskalasi' : 'Alasan de-eskalasi'}
                </label>
                <input id="pg-realasan" value={reAlasan} onChange={(e) => setReAlasan(e.target.value)} />
              </div>
              {gate.keputusan_am === 'tanpa_plan' ? (
                <button
                  type="button"
                  className="btn btnSecondary"
                  disabled={reSubmitting}
                  onClick={() => handleRedecide('butuh_plan')}
                >
                  {reSubmitting ? 'Menyimpan...' : 'Eskalasi jadi Butuh Plan'}
                </button>
              ) : canDeescalate ? (
                <button
                  type="button"
                  className="btn btnSecondary"
                  disabled={reSubmitting}
                  onClick={() => handleRedecide('tanpa_plan')}
                >
                  {reSubmitting ? 'Menyimpan...' : 'Matikan Plan (butuh ringkasan penugasan)'}
                </button>
              ) : (
                <p className="muted" style={{ fontSize: 12 }}>
                  Mematikan Plan pada layanan yang sedang jalan hanya bisa oleh SPV/Head Account (Rule 12).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* SECTION G-B — the form. For `ditentukan_am` this is the first-ever
          determination; for a locked `tanpa_plan` Service with no gate row yet
          it is the Rule 11 escalation doorway (decision fixed to Butuh Plan —
          see `canEscalateLockedTier` above). */}
      {showForm && !gate && canWrite && (
        <form className="form" onSubmit={handleSubmit}>
          {error && <div className="alert alertError" role="alert">{error}</div>}
          {message && <div className="alert alertSuccess" role="status">{message}</div>}
          {canEscalateLockedTier && !needsForm && (
            <div className="alert alertInfo" role="status">
              Eskalasi Rule 11 — layanan ini terkunci <strong>Tanpa Plan</strong> oleh katalog. Lengkapi konteks di
              bawah untuk membuka Strategi &amp; Plan untuk layanan ini.
            </div>
          )}

          <div className="formRow">
            <div className="field">
              <label htmlFor="pg-durasi">Durasi (bulan) &mdash; GA-2</label>
              <input id="pg-durasi" type="number" step="0.25" min="0" value={durasi} onChange={(e) => setDurasi(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pg-kuota">Kuota deliverable / periode &mdash; GA-4</label>
              <input id="pg-kuota" type="number" min="0" value={kuota} onChange={(e) => setKuota(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="pg-deliverable">Deliverable yang dijanjikan &mdash; GA-4</label>
            <input id="pg-deliverable" required value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
          </div>

          <div className="field">
            <label>Divisi Terlibat (GA-3, minimal 1)</label>
            <div className="stack" style={{ gap: 6 }}>
              {DIVISIONS.map((d) => (
                <label key={d} className="row" style={{ gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={divisi.includes(d)} onChange={() => toggleDivisi(d)} />
                  {d}
                </label>
              ))}
            </div>
          </div>

          <div className="formRow">
            <div className="field">
              <label htmlFor="pg-target-jenis">Target angka di kontrak? (GA-5)</label>
              <select
                id="pg-target-jenis"
                value={targetJenis}
                onChange={(e) => {
                  setTargetJenis(e.target.value as TargetKind | '');
                  if (e.target.value === '') setTargetNilai('');
                }}
              >
                <option value="">Tidak ada (deliverable saja)</option>
                {TARGET_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pg-target-nilai">Nilai target</label>
              <input
                id="pg-target-nilai"
                value={targetNilai}
                disabled={targetJenis === ''}
                onChange={(e) => setTargetNilai(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="pg-nilai">Nilai service / bulan (Rp)</label>
            <input id="pg-nilai" value={nilai} onChange={(e) => setNilai(e.target.value)} />
          </div>

          <label className="row" style={{ gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={berulang} onChange={(e) => setBerulang(e.target.checked)} />
            Skema berulang / retainer
          </label>
          <label className="row" style={{ gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={sequenceDep} onChange={(e) => setSequenceDep(e.target.checked)} />
            Ada ketergantungan urutan kerja (B tidak bisa mulai sebelum A)
          </label>
          <label className="row" style={{ gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={laporan} onChange={(e) => setLaporan(e.target.checked)} />
            Klien punya laporan periodik / SLA
          </label>

          {/* GB-1 / GB-2 — shown BEFORE GB-3, with the numbers behind them. */}
          <div className="alert alertInfo" role="status">
            {recError ? (
              <span>{recError}</span>
            ) : rec ? (
              <div className="stack" style={{ gap: 4 }}>
                <strong>
                  Rekomendasi sistem: {rec.rekomendasi === 'butuh_plan' ? 'Butuh Plan' : 'Tanpa Plan'}
                </strong>
                <span style={{ fontSize: 13 }}>{rec.ringkasan}</span>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Pemicu keras (satu saja cukup)</div>
                  <TriggerList items={rec.pemicu_keras} empty="Tidak ada." />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Pemicu lunak (butuh dua)</div>
                  <TriggerList items={rec.pemicu_lunak} empty="Tidak ada." />
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  Ambang v{ctx.config.version_no}: kuota &gt; {ctx.config.kuota_threshold}/bulan ·
                  nilai &ge; Rp {Number(ctx.config.nilai_threshold).toLocaleString('id-ID')} ·
                  durasi &gt; {ctx.config.durasi_threshold_bulan} bulan
                </span>
              </div>
            ) : (
              <span>Menghitung rekomendasi...</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="pg-keputusan">Keputusan AM (GB-3)</label>
            {canEscalateLockedTier && !needsForm ? (
              // Rule 11 only ever asks ONE thing here — escalate to Butuh Plan
              // or not submit at all. Offering "Tanpa Plan" would just re-state
              // the catalog lock decideGate already enforces server-side.
              <div id="pg-keputusan">Eskalasi ke Butuh Plan</div>
            ) : (
              <select
                id="pg-keputusan"
                required
                value={keputusan}
                onChange={(e) => setKeputusan(e.target.value as GateDecision | '')}
              >
                <option value="">Pilih...</option>
                <option value="butuh_plan">Butuh Plan</option>
                <option value="tanpa_plan">Tanpa Plan</option>
              </select>
            )}
            {fit && (
              <span className="muted" style={{ fontSize: 12 }}>
                Kesesuaian: {FIT_LABELS[fit as keyof typeof FIT_LABELS]}
                {fit !== 'sesuai' && ' — alasan wajib diisi'}
              </span>
            )}
          </div>

          {fit !== null && fit !== 'sesuai' && (
            <div className="field">
              <label htmlFor="pg-alasan">Alasan (GB-5)</label>
              <textarea id="pg-alasan" required value={alasan} onChange={(e) => setAlasan(e.target.value)} />
            </div>
          )}

          {fit === 'tolak_plan' && (
            <div className="field">
              <label htmlFor="pg-pemantauan">Cara Pemantauan Alternatif (GB-6)</label>
              <textarea
                id="pg-pemantauan"
                required
                value={pemantauan}
                onChange={(e) => setPemantauan(e.target.value)}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                Plan yang direkomendasikan ditolak &mdash; jelaskan bagaimana layanan ini dipantau.
                SPV melihat catatan ini.
              </span>
            </div>
          )}

          <div className="field">
            <label htmlFor="pg-tinjau">Tanggal Tinjau Ulang (GB-7)</label>
            <input
              id="pg-tinjau"
              type="date"
              required
              value={tinjauUlang}
              onChange={(e) => setTinjauUlang(e.target.value)}
            />
          </div>

          {keputusan === 'tanpa_plan' && (
            <fieldset style={{ border: '1px solid var(--border, #ddd)', padding: 12 }}>
              <legend style={{ fontSize: 13 }}>Ringkasan Penugasan (GB-8) &mdash; 4 field</legend>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="pg-rs-deliverable">Deliverable</label>
                  <input
                    id="pg-rs-deliverable"
                    required
                    value={ringkasan.deliverable}
                    onChange={(e) => setRingkasan({ ...ringkasan, deliverable: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pg-rs-deadline">Deadline</label>
                  <input
                    id="pg-rs-deadline"
                    type="date"
                    required
                    value={ringkasan.deadline}
                    onChange={(e) => setRingkasan({ ...ringkasan, deadline: e.target.value })}
                  />
                </div>
              </div>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="pg-rs-pic">Divisi PIC</label>
                  <select
                    id="pg-rs-pic"
                    required
                    value={ringkasan.divisi_pic}
                    onChange={(e) => setRingkasan({ ...ringkasan, divisi_pic: e.target.value })}
                  >
                    <option value="">Pilih...</option>
                    {DIVISIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pg-rs-hasil">Target / hasil yang diharapkan</label>
                  <input
                    id="pg-rs-hasil"
                    required
                    value={ringkasan.hasil_diharapkan}
                    onChange={(e) => setRingkasan({ ...ringkasan, hasil_diharapkan: e.target.value })}
                  />
                </div>
              </div>
            </fieldset>
          )}

          <div>
            <button type="submit" className="btn btnPrimary" disabled={submitting || keputusan === ''}>
              {submitting
                ? 'Menyimpan...'
                : canEscalateLockedTier && !needsForm
                  ? 'Eskalasi jadi Butuh Plan'
                  : 'Simpan Keputusan'}
            </button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              Keputusan langsung berlaku &mdash; tidak ditahan persetujuan siapa pun (Rule 4).
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
