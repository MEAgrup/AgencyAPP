'use client';

/**
 * Langkah 1 "Kelola Klien" — **Riset Awal** (owner QA 2026-08-12, RAB-04).
 *
 * Two halves live here now:
 *
 *  1. **Measurement** — when the step started, when it was submitted, how long it
 *     took. The clock starts server-side when Kelola Klien is opened; nothing here
 *     can type a start, a submit time, or a duration. That is deliberate (a start
 *     the AM presses is a start that slips).
 *
 *  2. **Analysis** (RAB-04 sisa) — one sub-section per ACTIVE `client_platforms`
 *     row (never a platform-picker: the platform is already known). TikTok Shop
 *     runs the 5-pillar engine on uploaded exports; every other platform takes a
 *     minimal manual entry. The score, the file detection, and every threshold run
 *     SERVER-SIDE — the browser only turns the xlsx binary into rows + a sha256
 *     (keputusan 4: a second copy of the score rules in the browser is drift).
 *     The AM then confirms each auto-filled number (keputusan 1) before the step
 *     can be submitted — and the interview cannot start until it is (gerbang
 *     RAB-07). So this panel guides the AM through baseline → confirm → submit,
 *     and only then lights the "Submit riset awal" button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { addPlatform, updatePlatform } from '@/lib/clients';
import {
  RISET_AWAL_STATUS,
  formatDurasiMenit,
  menitBerjalanSejak,
  risetAwalStatusTone,
  type InterviewRisetAwal,
} from '@/lib/interview';
import { INTERVIEW_FIELDS, minorToRupiah, rupiahToMinor } from '@/lib/interview-fields';
import { formatIDR } from '@/lib/money';
import {
  confirmBaselineIsian,
  parseExportFile,
  submitBaselineAnalisa,
  submitBaselineManual,
  type ConfirmIsianItemWire,
  type HistRowWire,
  type ManualBaselineWire,
  type ParsedExport,
  type RisetAwalAnalisa,
  type RisetAwalBaseline,
  type RisetAwalIsian,
  type RisetAwalPlatform,
} from '@/lib/riset-awal';
import VideoFactoryBaselineImportPanel from './VideoFactoryBaselineImportPanel';

/** How often the running counter re-renders. Minute precision needs no faster. */
const TICK_MS = 30_000;

/** File-type override choices — the only ambiguous case is toko-vs-afiliasi
 *  (baseline fix #3). Everything else the server auto-detects. */
const TIPE_OVERRIDE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Otomatis (deteksi server)' },
  { value: 'vid_toko', label: 'Video — Toko Sendiri' },
  { value: 'vid_aff', label: 'Video — Afiliasi' },
  { value: 'live_toko', label: 'LIVE — Toko Sendiri' },
  { value: 'live_aff', label: 'LIVE — Afiliasi' },
];

/** Human labels for the auto-filled fields (single source: the interview catalog). */
function isianLabel(fieldKey: string): string {
  return INTERVIEW_FIELDS.find((f) => f.fieldKey === fieldKey)?.label ?? fieldKey;
}

function waktu(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('id-ID');
}

// ===========================================================================
// The panel
// ===========================================================================

export default function RisetAwalPanel({
  risetAwal,
  baseline,
  canWrite,
  canEditClientProfile,
  busy,
  clientId,
  onSubmit,
  onReload,
}: {
  risetAwal: InterviewRisetAwal | null;
  /** The per-platform baseline read-model (null while it is still loading). */
  baseline: RisetAwalBaseline | null;
  canWrite: boolean;
  /** Account Lead/OD/Director (mirrors `client.canEditProfile`) — gates the
   *  in-place "Pisahkan platform" fix for a compound-platform row (M4-OA-2). */
  canEditClientProfile: boolean;
  /** The page's action-in-flight flag (schedule/transition/submit-timing). */
  busy: boolean;
  /** The client behind this interview — links a compound-platform warning to
   *  the Client Record's Platform List editor (M4-OA-2). */
  clientId: string;
  /** Submit the TIMING half (records the finish time; RAB-07 then lets the interview start). */
  onSubmit: () => void;
  /** Refetch the baseline read-model after a baseline/confirm write. */
  onReload: () => Promise<void>;
}) {
  const running = risetAwal?.status === RISET_AWAL_STATUS.Berjalan;
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!running) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, [running]);

  if (!risetAwal) {
    return (
      <section className="card">
        <div className="cardHeader">Langkah 1 · Riset Awal</div>
        <p className="muted" style={{ fontSize: 13 }}>
          Riset awal belum tercatat untuk interview ini.
        </p>
      </section>
    );
  }

  const selesai = risetAwal.status === RISET_AWAL_STATUS.Selesai;
  const menit = selesai ? risetAwal.durasi_menit : now ? menitBerjalanSejak(risetAwal.dimulai_pada, now) : null;

  // What still stands between the AM and a submittable riset awal (RAB-07 gate,
  // mirrored client-side so the AM is guided, not just blocked at the wall).
  const platforms = baseline?.platforms ?? [];
  const analisaByPlatform = new Map<number, RisetAwalAnalisa>();
  for (const a of baseline?.analisa ?? []) analisaByPlatform.set(a.client_platform_id, a);
  const platformBelum = platforms.filter((p) => !analisaByPlatform.has(p.client_platform_id));
  const isian = baseline?.isian ?? [];
  const belumDikonfirmasi = isian.filter((f) => !f.dikonfirmasi);
  // The interview-start gate wants: every active platform baselined AND every
  // auto-filled number confirmed. Until then, submitting the timing only earns a
  // wall at "Mulai Interview" — so guide the AM to finish first.
  const lengkap =
    baseline != null && platforms.length > 0 && platformBelum.length === 0 && isian.length > 0 && belumDikonfirmasi.length === 0;

  return (
    <section className="card">
      <div className="cardHeader">
        <span>Langkah 1 · Riset Awal</span>
        <span className={`badge badge-${risetAwalStatusTone(risetAwal.status)}`}>{risetAwal.status}</span>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Login ke toko klien, tarik export & catat baseline tiap platform aktif, lalu <strong>konfirmasi</strong> tiap
        angka yang terisi otomatis. Waktu mulai tercatat otomatis; tekan <strong>Submit riset awal</strong> begitu
        semua platform selesai & terkonfirmasi.
      </p>

      {risetAwal.retroaktif && (
        <div className="alert alertInfo" style={{ fontSize: 13 }}>
          Sesi ini dibuka sebelum langkah Riset Awal ada. Waktunya dihitung mundur dari pembuatan interview dan{' '}
          <strong>tidak dipakai menilai SLA</strong>.
        </div>
      )}

      {/* Measurement */}
      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Dimulai</label>
          <div>
            {waktu(risetAwal.dimulai_pada)}{' '}
            <span className="muted" style={{ fontSize: 12 }}>
              oleh {risetAwal.dimulai_oleh}
            </span>
          </div>
        </div>
        <div className="field">
          <label>Disubmit</label>
          <div>
            {waktu(risetAwal.disubmit_pada)}{' '}
            {risetAwal.disubmit_oleh && (
              <span className="muted" style={{ fontSize: 12 }}>
                oleh {risetAwal.disubmit_oleh}
              </span>
            )}
          </div>
        </div>
        <div className="field">
          <label>{selesai ? 'Lama pengerjaan' : 'Sudah berjalan'}</label>
          <div style={{ fontWeight: 600 }}>{formatDurasiMenit(menit)}</div>
        </div>
      </div>

      {/* Analysis — one sub-section per active platform */}
      {!baseline ? (
        <p className="muted" style={{ fontSize: 13 }}>Memuat baseline platform…</p>
      ) : platforms.length === 0 ? (
        <div className="alert alertInfo" style={{ fontSize: 13 }}>
          Klien ini belum punya platform toko aktif — tidak ada baseline yang bisa dicatat.
        </div>
      ) : (
        <div className="stack" style={{ gap: 12, marginTop: 8 }}>
          <div className="cardHeader" style={{ marginBottom: 0 }}>
            Baseline per platform
            <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
              {platforms.length - platformBelum.length}/{platforms.length} platform
            </span>
          </div>
          {platforms.map((p) => (
            <PlatformBaselineCard
              key={p.client_platform_id}
              interviewId={risetAwal.interview_id ?? baseline.interview_id}
              platform={p}
              clientId={clientId}
              analisa={analisaByPlatform.get(p.client_platform_id) ?? null}
              canWrite={canWrite && !selesai}
              canEditClientProfile={canEditClientProfile}
              onReload={onReload}
            />
          ))}
        </div>
      )}

      {/* Confirmation grid — every auto-filled number (keputusan 1) */}
      {baseline && isian.length > 0 && (
        <KonfirmasiGrid
          interviewId={baseline.interview_id}
          isian={isian}
          canWrite={canWrite && !selesai}
          onReload={onReload}
        />
      )}

      {/* Submit (timing) */}
      {selesai ? (
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Waktu mulai & submit terkunci — durasi dihitung dari keduanya, tidak pernah diketik.
        </p>
      ) : (
        canWrite && (
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {!lengkap && (
              <div className="alert alertInfo" style={{ fontSize: 13 }}>
                Sebelum submit (dan sebelum interview bisa dimulai — gerbang RAB-07):
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {platforms.length === 0 && <li>belum ada platform aktif.</li>}
                  {platformBelum.length > 0 && (
                    <li>baseline belum lengkap: {platformBelum.map((p) => p.platform).join(', ')}.</li>
                  )}
                  {isian.length === 0 && platformBelum.length === 0 && platforms.length > 0 && (
                    <li>belum ada angka terisi otomatis untuk dikonfirmasi.</li>
                  )}
                  {belumDikonfirmasi.length > 0 && (
                    <li>angka belum dikonfirmasi: {belumDikonfirmasi.map((f) => f.field_key).join(', ')}.</li>
                  )}
                </ul>
              </div>
            )}
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btnPrimary btnSm"
                disabled={busy || !lengkap}
                title={lengkap ? undefined : 'Selesaikan baseline & konfirmasi semua angka dulu'}
                onClick={() => {
                  if (window.confirm('Submit riset awal? Waktu selesai dicatat sekarang dan tidak bisa diubah.')) {
                    onSubmit();
                  }
                }}
              >
                Submit riset awal
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                Sekali submit, waktu selesai terkunci.
              </span>
            </div>
          </div>
        )
      )}
    </section>
  );
}

// ===========================================================================
// One platform's baseline sub-section
// ===========================================================================

function PlatformBaselineCard({
  interviewId,
  platform,
  clientId,
  analisa,
  canWrite,
  canEditClientProfile,
  onReload,
}: {
  interviewId: string;
  platform: RisetAwalPlatform;
  clientId: string;
  analisa: RisetAwalAnalisa | null;
  canWrite: boolean;
  canEditClientProfile: boolean;
  onReload: () => Promise<void>;
}) {
  const done = analisa !== null;
  const metodeLabel =
    platform.metode === 'analisa_penuh' ? 'Analisa penuh (engine)' : platform.metode === 'analisa_tipis' ? 'Analisa tipis' : 'Entri manual';
  // A comma means this row is still the pre-split "Platform List" joined into
  // one string (fixed for new clients — DECISIONS 2026-08-27 M4-OA-2 split —
  // but existing rows need a one-time correction). It can never engine-match
  // 'tiktok shop'/'tokopedia', so it silently loses the real upload form.
  const isCompoundPlatform = platform.platform.includes(',');
  const splitTokens = isCompoundPlatform
    ? platform.platform
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  // Owner QA 2026-08-27 ("jalur pintas tanpa upload/skor"): an engine platform
  // (TikTok Shop) can still opt OUT of the engine per submission and use the
  // AM Baseline (Video Factory) shortcut instead — kondisi_toko becomes
  // belum_dapat_diukur, no skor, same contract as any other manual platform.
  const [useShortcut, setUseShortcut] = useState(false);

  async function handleSplit() {
    if (splitTokens.length < 2) return;
    if (
      !window.confirm(
        `Pisahkan baris "${platform.platform}" menjadi ${splitTokens.length} baris platform terpisah (${splitTokens.join(', ')})? ` +
          'Baris gabungan lama akan dinonaktifkan (riwayat tetap ada, tidak dihapus).',
      )
    ) {
      return;
    }
    setSplitting(true);
    setSplitError(null);
    try {
      for (const token of splitTokens) {
        await addPlatform(clientId, { platform: token, store_link: platform.store_link ?? undefined });
      }
      await updatePlatform(clientId, platform.client_platform_id, { active: false });
      await onReload();
    } catch (e) {
      setSplitError(errorMessage(e));
    } finally {
      setSplitting(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>{platform.platform}</strong>
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>{metodeLabel}</span>
        {!done && useShortcut && <span className="badge badge-amber" style={{ fontWeight: 400 }}>Jalur pintas AM Baseline</span>}
        {done && <span className="badge badge-green">Tersubmit</span>}
        <span style={{ flex: 1 }} />
        {platform.store_link && (
          <a href={platform.store_link} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 12 }}>
            buka toko ↗
          </a>
        )}
      </div>

      {isCompoundPlatform && !done && (
        <div className="alert alertInfo" style={{ fontSize: 12, marginTop: 8 }}>
          <div>
            Baris ini berisi lebih dari satu platform — hanya bisa entri manual, walau salah satunya TikTok Shop/
            Tokopedia. <a href={`/clients/${clientId}`}>Perbaiki daftar platform klien</a> (pisahkan jadi satu baris
            per platform), lalu muat ulang halaman ini untuk baseline yang benar per platform.
          </div>
          {canEditClientProfile && (
            <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btnSecondary btnSm" disabled={splitting} onClick={handleSplit}>
                {splitting ? 'Memisahkan…' : `Pisahkan otomatis jadi ${splitTokens.length} platform`}
              </button>
              <span className="muted" style={{ fontSize: 11 }}>
                Menambah {splitTokens.join(', ')} sebagai baris terpisah lalu menonaktifkan baris gabungan ini.
              </span>
            </div>
          )}
          {splitError && (
            <div className="alert alertError" style={{ fontSize: 12, marginTop: 8 }}>
              {splitError}
            </div>
          )}
        </div>
      )}

      {done ? (
        <div className="grid2" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Kondisi toko</label>
            <div>{analisa!.kondisi_toko}</div>
          </div>
          <div className="field">
            <label>Skor</label>
            <div>{analisa!.skor == null ? '—' : `${analisa!.skor}/100`}</div>
          </div>
          {analisa!.cakupan_riwayat && (
            <div className="field">
              <label>Cakupan riwayat</label>
              <div>{analisa!.cakupan_riwayat}</div>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, gridColumn: '1 / -1', margin: 0 }}>
            Baseline terkunci (histori immutable). Untuk analisa ulang, interview perlu dibuka kembali.
          </p>
        </div>
      ) : !canWrite ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          Belum ada baseline untuk platform ini.
        </p>
      ) : platform.metode === 'analisa_penuh' ? (
        useShortcut ? (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <div className="alert alertInfo" style={{ fontSize: 12 }}>
              <div>
                Jalur pintas AM Baseline — baseline platform ini akan tercatat <em>belum dapat diukur</em>, tanpa
                skor mesin 5-pilar, sampai dianalisa ulang lewat upload export asli.
              </div>
              <button
                type="button"
                className="btn btnGhost btnSm"
                style={{ marginTop: 8 }}
                onClick={() => setUseShortcut(false)}
              >
                Kembali ke upload export asli
              </button>
            </div>
            <ManualForm interviewId={interviewId} platform={platform} manualOverride onReload={onReload} />
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <AnalisaPenuhForm interviewId={interviewId} platform={platform} onReload={onReload} />
            <button
              type="button"
              className="btn btnGhost btnSm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setUseShortcut(true)}
            >
              Belum ada file export? Pakai AM Baseline (tanpa skor)
            </button>
          </div>
        )
      ) : (
        <ManualForm interviewId={interviewId} platform={platform} onReload={onReload} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// analisa_penuh — upload exports + optional 6-month GMV history (TikTok Shop)
// ---------------------------------------------------------------------------

interface UploadedFile extends ParsedExport {
  /** AM's file-type override, '' = let the server detect. */
  tipe: string;
}

function emptyHist(): HistRowWire {
  return { key: '', label: '', gmv: '', order: '', flag: 'normal' };
}

function AnalisaPenuhForm({
  interviewId,
  platform,
  onReload,
}: {
  interviewId: string;
  platform: RisetAwalPlatform;
  onReload: () => Promise<void>;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [hist, setHist] = useState<HistRowWire[]>([emptyHist(), emptyHist(), emptyHist()]);
  const [net, setNet] = useState(true);
  const [linked, setLinked] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setParsing(true);
    setErr(null);
    try {
      const parsed: UploadedFile[] = [];
      for (const f of Array.from(list)) {
        const p = await parseExportFile(f);
        parsed.push({ ...p, tipe: '' });
      }
      setFiles((prev) => [...prev, ...parsed]);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (files.length === 0) {
      setErr('[unggah minimal satu berkas export untuk analisa]');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payloadFiles: ParsedExport[] = files.map((f) => ({
        filename: f.filename,
        aoa: f.aoa,
        sha256: f.sha256,
        ukuran_bytes: f.ukuran_bytes,
        tipe_override: f.tipe === '' ? null : f.tipe,
      }));
      // Only rows the AM actually filled become history (an empty grid is fine —
      // the engine tolerates missing riwayat; it just widens the cakupan warning).
      const histRows = hist.filter((h) => String(h.gmv).trim() !== '' || String(h.label).trim() !== '');
      const linkedAccounts = linked.split(',').map((s) => s.trim()).filter((s) => s !== '');
      await submitBaselineAnalisa(interviewId, platform.client_platform_id, payloadFiles, histRows, {
        net,
        linkedAccounts,
      });
      await onReload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const setHistAt = (i: number, patch: Partial<HistRowWire>) =>
    setHist((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="stack" style={{ gap: 10, marginTop: 10 }}>
      {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}

      <div className="field">
        <label>Export dari Seller Center / Ads Manager (.xlsx)</label>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          disabled={parsing || saving}
          onChange={(e) => {
            void onPick(e.target.files);
            e.target.value = '';
          }}
        />
        {parsing && <span className="muted" style={{ fontSize: 12 }}>Membaca berkas…</span>}
      </div>

      {files.length > 0 && (
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Berkas</th>
              <th>Ukuran</th>
              <th>Tipe (jika perlu)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => (
              <tr key={`${f.filename}-${f.sha256.slice(0, 8)}-${i}`}>
                <td>{f.filename}</td>
                <td className="muted">{Math.round(f.ukuran_bytes / 1024)} KB</td>
                <td>
                  <select
                    value={f.tipe}
                    disabled={saving}
                    onChange={(e) => setFiles((prev) => prev.map((x, idx) => (idx === i ? { ...x, tipe: e.target.value } : x)))}
                    style={{ fontSize: 12, padding: '4px 8px' }}
                  >
                    {TIPE_OVERRIDE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btnGhost btnSm"
                    disabled={saving}
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    hapus
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details>
        <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>
          Riwayat GMV 6 bulan (opsional) — tanda campaign/belum/masalah tetap penilaian AM
        </summary>
        <table className="table" style={{ fontSize: 13, marginTop: 8 }}>
          <thead>
            <tr>
              <th>Bulan (mis. Agu 2026)</th>
              <th>GMV (Rp)</th>
              <th>Order</th>
              <th>Tanda</th>
            </tr>
          </thead>
          <tbody>
            {hist.map((h, i) => (
              <tr key={i}>
                <td>
                  <input value={h.label} disabled={saving} onChange={(e) => setHistAt(i, { label: e.target.value, key: e.target.value })} />
                </td>
                <td>
                  <input type="number" inputMode="decimal" value={h.gmv} disabled={saving} onChange={(e) => setHistAt(i, { gmv: e.target.value })} />
                </td>
                <td>
                  <input type="number" inputMode="decimal" value={h.order} disabled={saving} onChange={(e) => setHistAt(i, { order: e.target.value })} />
                </td>
                <td>
                  <select value={h.flag} disabled={saving} onChange={(e) => setHistAt(i, { flag: e.target.value as HistRowWire['flag'] })}>
                    <option value="normal">normal</option>
                    <option value="campaign">campaign</option>
                    <option value="belum">belum jualan</option>
                    <option value="masalah">ada masalah</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btnGhost btnSm" disabled={saving} onClick={() => setHist((r) => [...r, emptyHist()])}>
          + baris bulan
        </button>
      </details>

      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={net} disabled={saving} onChange={(e) => setNet(e.target.checked)} />
          GMV net (standar MEA)
        </label>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label style={{ fontSize: 12 }}>Akun TikTok toko sendiri (pisahkan koma) — bantu bedakan toko vs afiliasi</label>
          <input value={linked} disabled={saving} placeholder="@tokoklien, @tokoklien.id" onChange={(e) => setLinked(e.target.value)} />
        </div>
      </div>

      <div>
        <button type="button" className="btn btnPrimary btnSm" disabled={saving || parsing} onClick={submit}>
          {saving ? 'Menyimpan…' : 'Submit baseline platform'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// manual / analisa_tipis — minimal numeric entry (keputusan 5)
// ---------------------------------------------------------------------------

interface ManualFields {
  gmv_bulan: string;
  order: string;
  aov: string;
  sku_total: string;
  belanja_iklan: string;
  roas: string;
  periode_mulai: string;
  periode_akhir: string;
  tanggal_ambil: string;
}

const EMPTY_MANUAL: ManualFields = {
  gmv_bulan: '', order: '', aov: '', sku_total: '', belanja_iklan: '', roas: '', periode_mulai: '', periode_akhir: '', tanggal_ambil: '',
};

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function ManualForm({
  interviewId,
  platform,
  manualOverride,
  onReload,
}: {
  interviewId: string;
  platform: RisetAwalPlatform;
  /** True only when an engine platform (TikTok Shop) opts OUT of the engine via
   *  the "AM Baseline" shortcut (owner QA 2026-08-27) — not for a platform that
   *  is manual/analisa_tipis by nature (Shopee, Tokopedia, …). */
  manualOverride?: boolean;
  onReload: () => Promise<void>;
}) {
  const [m, setM] = useState<ManualFields>(EMPTY_MANUAL);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (patch: Partial<ManualFields>) => setM((prev) => ({ ...prev, ...patch }));

  const submit = async () => {
    const wire: ManualBaselineWire = {
      gmv_bulan: numOrNull(m.gmv_bulan),
      order: numOrNull(m.order),
      aov: numOrNull(m.aov),
      sku_total: numOrNull(m.sku_total),
      belanja_iklan: numOrNull(m.belanja_iklan),
      roas: numOrNull(m.roas),
      periode_mulai: m.periode_mulai.trim() === '' ? null : m.periode_mulai.trim(),
      periode_akhir: m.periode_akhir.trim() === '' ? null : m.periode_akhir.trim(),
      tanggal_ambil: m.tanggal_ambil.trim() === '' ? null : m.tanggal_ambil.trim(),
    };
    if ([wire.gmv_bulan, wire.order, wire.aov, wire.sku_total, wire.belanja_iklan, wire.roas].some((v) => v == null)) {
      setErr('[entri manual minimal wajib: GMV/bulan, order, AOV, jumlah SKU, belanja iklan, ROAS]');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await submitBaselineManual(interviewId, platform.client_platform_id, wire, { manualOverride });
      await onReload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const numField = (key: keyof ManualFields, label: string, placeholder: string) => (
    <div className="field">
      <label>{label}</label>
      <input type="number" inputMode="decimal" placeholder={placeholder} value={m[key]} disabled={saving} onChange={(e) => set({ [key]: e.target.value })} />
    </div>
  );

  return (
    <div className="stack" style={{ gap: 10, marginTop: 10 }}>
      {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        {manualOverride ? (
          <>
            Jalur pintas AM Baseline — <em>tanpa</em> upload export & tanpa skor mesin. Kondisi toko akan tercatat{' '}
            <em>belum dapat diukur</em> (bukan penilaian jelek), sampai baseline ini dianalisa ulang lewat upload
            asli.
          </>
        ) : (
          <>
            Belum ada engine analisa untuk platform ini — isi entri manual minimal. Kondisi toko akan tercatat{' '}
            <em>belum dapat diukur</em> (bukan penilaian jelek), tanpa skor.
          </>
        )}
      </p>
      {/* Video Factory hanya bisa membaca export TikTok Shop/Tokopedia (tool tak
          punya parser platform lain). Di antara platform yang benar-benar manual
          (tanpa engine sama sekali), cuma Tokopedia (analisa_tipis) yang cocok;
          untuk Shopee/Lazada/Others panel ini hanya akan menampilkan penolakan
          channel — disembunyikan, bukan diam-diam gagal. manualOverride (TikTok
          Shop lewat jalur pintas) juga selalu cocok, karena platform.platform
          adalah 'TikTok Shop' sungguhan di jalur itu. */}
      {(platform.metode === 'analisa_tipis' || manualOverride) && (
        <VideoFactoryBaselineImportPanel
          platformLabel={platform.platform}
          fields={m}
          onApply={setM}
          disabled={saving}
        />
      )}
      <div className="grid2">
        {numField('gmv_bulan', 'GMV / bulan (Rp)', 'Rupiah')}
        {numField('order', 'Jumlah order / bulan', '')}
        {numField('aov', 'AOV (Rp)', 'Rupiah')}
        {numField('sku_total', 'Jumlah SKU siap jual', '')}
        {numField('belanja_iklan', 'Belanja iklan / bulan (Rp)', 'Rupiah')}
        {numField('roas', 'ROAS', 'mis. 3.2')}
      </div>
      <details>
        <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>Periode & tanggal ambil (Rule 5)</summary>
        <div className="grid2" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Periode mulai</label>
            <input type="date" value={m.periode_mulai} disabled={saving} onChange={(e) => set({ periode_mulai: e.target.value })} />
          </div>
          <div className="field">
            <label>Periode akhir</label>
            <input type="date" value={m.periode_akhir} disabled={saving} onChange={(e) => set({ periode_akhir: e.target.value })} />
          </div>
          <div className="field">
            <label>Tanggal ambil data</label>
            <input type="date" value={m.tanggal_ambil} disabled={saving} onChange={(e) => set({ tanggal_ambil: e.target.value })} />
          </div>
        </div>
      </details>
      <div>
        <button type="button" className="btn btnPrimary btnSm" disabled={saving} onClick={submit}>
          {saving ? 'Menyimpan…' : 'Submit baseline platform'}
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// Confirmation grid — the AM confirms/corrects each auto-filled number
// ===========================================================================

interface DraftIsian {
  /** Rupiah text (money) or plain number text (angka), as edited by the AM. */
  raw: string;
  dikonfirmasi: boolean;
}

/** Is this an auto-filled money field? (B2-9 AOV, B1-5 omzet, B6-3 target.)
 *  Others (B2-3 SKU) are counts. */
function isMoneyIsian(f: RisetAwalIsian): boolean {
  return f.nilai_uang != null || f.field_key === 'B2-9' || f.field_key === 'B1-5' || f.field_key === 'B6-3';
}

function isianDisplay(f: RisetAwalIsian): string {
  if (isMoneyIsian(f)) return f.nilai_uang == null ? '—' : formatIDR(Number(f.nilai_uang) / 100);
  return f.nilai_angka == null ? '—' : String(f.nilai_angka);
}

function KonfirmasiGrid({
  interviewId,
  isian,
  canWrite,
  onReload,
}: {
  interviewId: string;
  isian: RisetAwalIsian[];
  canWrite: boolean;
  onReload: () => Promise<void>;
}) {
  // Local draft, keyed by section+field_key. The PERSISTED truth is always the
  // `isian` prop (server state); the draft is only the in-progress edit buffer.
  const [draft, setDraft] = useState<Record<string, DraftIsian>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false); // an unsaved value correction is pending
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // In-flight save guard: while a save runs we must NOT rebuild the draft from
  // the server, or the reload our own save triggers would clobber a box the AM
  // just ticked. A ref (not state) because the rebuild effect keys off `signature`.
  const savingRef = useRef(0);

  const signature = isian
    .map((f) => `${f.section}.${f.field_key}:${f.nilai_uang ?? ''}/${f.nilai_angka ?? ''}/${f.dikonfirmasi}`)
    .join('|');
  // Rebuild the draft when the server rows change (a fresh baseline submit adds
  // new proposals; our own save reloads them confirmed). Skipped mid-save so a
  // reload cannot overwrite an in-progress tick.
  useEffect(() => {
    if (savingRef.current > 0) return;
    const next: Record<string, DraftIsian> = {};
    for (const f of isian) {
      const raw = isMoneyIsian(f) ? minorToRupiah(f.nilai_uang) : f.nilai_angka == null ? '' : String(f.nilai_angka);
      next[`${f.section}.${f.field_key}`] = { raw, dikonfirmasi: f.dikonfirmasi };
    }
    setDraft(next);
    setDirty(false);
    // signature captures the meaningful content of `isian`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const buildItems = useCallback(
    (source: Record<string, DraftIsian>): ConfirmIsianItemWire[] =>
      isian.map((f) => {
        const k = `${f.section}.${f.field_key}`;
        const d = source[k] ?? { raw: '', dikonfirmasi: false };
        const money = isMoneyIsian(f);
        const minor = money ? rupiahToMinor(d.raw) : null;
        return {
          section: f.section,
          field_key: f.field_key,
          nilai_teks: null,
          nilai_angka: money ? null : numOrNull(d.raw),
          nilai_uang: money ? (minor == null ? null : minor.toString()) : null,
          dikonfirmasi: d.dikonfirmasi,
        };
      }),
    [isian],
  );

  // Persist the given draft. Confirmation now saves the instant the AM ticks a
  // box (keputusan 1 still holds — the AM is the one confirming) so the submit
  // gate, which reads the SERVER state, clears without a hidden second click.
  // That two-step trap is the QA-2026-08-20 "sudah upload tapi tidak bisa submit".
  const persist = useCallback(
    async (source: Record<string, DraftIsian>) => {
      savingRef.current += 1;
      setSaving(true);
      setErr(null);
      try {
        await confirmBaselineIsian(interviewId, buildItems(source));
        setDirty(false);
        setSavedAt(new Date().toLocaleTimeString('id-ID'));
        await onReload();
      } catch (e) {
        setErr(errorMessage(e));
      } finally {
        savingRef.current -= 1;
        setSaving(false);
      }
    },
    [interviewId, buildItems, onReload],
  );

  const patch = (k: string, p: Partial<DraftIsian>) => setDraft((d) => ({ ...d, [k]: { ...d[k], ...p } }));

  // The status reflects the SERVER-persisted state, never the unsaved draft —
  // showing "semua terkonfirmasi" off the local draft is exactly what let the AM
  // believe they could submit while the gate still saw unconfirmed rows.
  const serverAllConfirmed = isian.length > 0 && isian.every((f) => f.dikonfirmasi);
  const status = saving
    ? 'menyimpan…'
    : dirty
      ? 'koreksi belum disimpan'
      : serverAllConfirmed
        ? 'semua terkonfirmasi'
        : 'wajib dikonfirmasi sebelum submit';

  return (
    <div className="stack" style={{ gap: 8, marginTop: 14 }}>
      <div className="cardHeader" style={{ marginBottom: 0 }}>
        Konfirmasi angka terisi otomatis
        <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
          {status}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Angka usulan berasal dari baseline. Koreksi bila berbeda dari kenyataan, lalu centang untuk konfirmasi — bug
        parser tidak boleh menggeser skor sampai manusia mengonfirmasi (keputusan 1). Centangan langsung tersimpan;
        koreksi angka tekan <strong>Simpan koreksi</strong>.
      </p>
      {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}
      <table className="table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th>Field</th>
            <th>Usulan</th>
            <th>Nilai (koreksi bila perlu)</th>
            <th>Sumber</th>
            <th>Konfirmasi</th>
          </tr>
        </thead>
        <tbody>
          {isian.map((f) => {
            const k = `${f.section}.${f.field_key}`;
            const d = draft[k] ?? { raw: '', dikonfirmasi: false };
            const money = isMoneyIsian(f);
            return (
              <tr key={k}>
                <td>
                  {f.field_key}
                  <div className="muted" style={{ fontSize: 11 }}>{isianLabel(f.field_key)}</div>
                </td>
                <td className="muted">{isianDisplay(f)}</td>
                <td>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={d.raw}
                    disabled={!canWrite || saving}
                    placeholder={money ? 'Rupiah' : ''}
                    onChange={(e) => {
                      patch(k, { raw: e.target.value });
                      setDirty(true);
                    }}
                    style={{ maxWidth: 160 }}
                  />
                </td>
                <td className="muted">{f.sumber}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={d.dikonfirmasi}
                    disabled={!canWrite || saving}
                    onChange={(e) => {
                      // A tick includes any pending correction in the same row, so
                      // the confirmed value is the corrected one — then persists at once.
                      const next = { ...draft, [k]: { ...d, dikonfirmasi: e.target.checked } };
                      setDraft(next);
                      void persist(next);
                    }}
                    aria-label={`Konfirmasi ${f.field_key}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canWrite && (
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {/* Only needed for a value correction typed AFTER a box was already
              ticked — a tick itself already saves. Disabled until there is something to save. */}
          <button type="button" className="btn btnSecondary btnSm" disabled={saving || !dirty} onClick={() => void persist(draft)}>
            {saving ? 'Menyimpan…' : 'Simpan koreksi'}
          </button>
          {savedAt && !dirty && !saving && <span className="muted" style={{ fontSize: 12 }}>Tersimpan {savedAt}</span>}
        </div>
      )}
    </div>
  );
}
