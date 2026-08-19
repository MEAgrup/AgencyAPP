'use client';

/**
 * Mesin Laporan Klien (C1) — the client-page panel.
 *
 * Pick an active store → pick Mingguan / Bulanan → drop the Seller-Center / Ads
 * Manager exports → POST. The browser only parses the xlsx to rows + sha256
 * (`parseExportFile`, reused from Riset Awal); the server detects each file,
 * runs the engine, stores the report, and rewrites `clients.total_sales`. The
 * rendered report is downloaded as HTML in Klien or Internal mode.
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { parseExportFile, type ParsedExport } from '@/lib/riset-awal';
import {
  createClientReport,
  getClientReports,
  reportHtmlUrl,
  type ClientReportSummary,
  type PeriodeTipe,
} from '@/lib/report';
import { type Platform } from '@/lib/clients';

/** AM file-type override, '' = let the server detect (own-vs-affiliate ambiguity). */
const TIPE_OVERRIDE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Otomatis (deteksi server)' },
  { value: 'vid_toko', label: 'Video — Toko Sendiri' },
  { value: 'vid_aff', label: 'Video — Afiliasi' },
  { value: 'live_toko', label: 'LIVE — Toko Sendiri' },
  { value: 'live_aff', label: 'LIVE — Afiliasi' },
];

interface UploadedFile extends ParsedExport {
  tipe: string;
}

function rupiah(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

function skorTone(label: string | null): string {
  if (label === 'SEHAT') return 'badge badgeSuccess';
  if (label === 'PERLU PERHATIAN') return 'badge badgeWarning';
  if (label === 'KRITIS') return 'badge badgeDanger';
  return 'badge';
}

export default function ReportPanel({ clientId, platforms }: { clientId: string; platforms: Platform[] }) {
  const active = platforms.filter((p) => p.active);
  const [reports, setReports] = useState<ClientReportSummary[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [platformId, setPlatformId] = useState<number>(active[0]?.client_platform_id ?? 0);
  const [tipe, setTipe] = useState<PeriodeTipe>('bulanan');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [net, setNet] = useState(true);
  const [linked, setLinked] = useState('');
  const [periodeMulai, setPeriodeMulai] = useState('');
  const [periodeAkhir, setPeriodeAkhir] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setReports(await getClientReports(clientId));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errorMessage(e));
    }
  }, [clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onPick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setParsing(true);
    setErr(null);
    try {
      const parsed: UploadedFile[] = [];
      for (const f of Array.from(list)) {
        parsed.push({ ...(await parseExportFile(f)), tipe: '' });
      }
      setFiles((prev) => [...prev, ...parsed]);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (!platformId) {
      setErr('[pilih toko yang aktif untuk laporan]');
      return;
    }
    if (files.length === 0) {
      setErr('[unggah minimal satu berkas export untuk membuat laporan]');
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
      const linkedAccounts = linked.split(',').map((s) => s.trim()).filter((s) => s !== '');
      await createClientReport(clientId, {
        clientPlatformId: platformId,
        periodeTipe: tipe,
        files: payloadFiles,
        net,
        linkedAccounts,
        periodeMulai: periodeMulai || null,
        periodeAkhir: periodeAkhir || null,
      });
      setFiles([]);
      setPeriodeMulai('');
      setPeriodeAkhir('');
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" id="reports">
      <div className="cardHeader">
        <h2>Laporan Performa (Mingguan / Bulanan)</h2>
      </div>

      {active.length === 0 ? (
        <div className="emptyState">Belum ada toko aktif — tambahkan platform sebelum membuat laporan.</div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}

          <div className="field">
            <label>Toko</label>
            <select value={platformId} disabled={saving} onChange={(e) => setPlatformId(Number(e.target.value))}>
              {active.map((p) => (
                <option key={p.client_platform_id} value={p.client_platform_id}>
                  {p.platform}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Tipe Periode</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" name="tipe" checked={tipe === 'bulanan'} disabled={saving}
                  onChange={() => setTipe('bulanan')} /> Bulanan
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" name="tipe" checked={tipe === 'mingguan'} disabled={saving}
                  onChange={() => setTipe('mingguan')} /> Mingguan
              </label>
            </div>
          </div>

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

          <div className="field">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={net} disabled={saving} onChange={(e) => setNet(e.target.checked)} />
              GMV Bersih (net — standar MEA)
            </label>
          </div>

          <div className="field">
            <label>Akun TikTok toko sendiri (dipisah koma — untuk memisahkan afiliasi)</label>
            <input value={linked} disabled={saving} placeholder="@tokoklien, @tokoklien.id"
              onChange={(e) => setLinked(e.target.value)} />
          </div>

          <div className="field">
            <label>Periode (opsional — hanya dipakai bila rentang tak terbaca dari berkas)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="date" value={periodeMulai} disabled={saving} onChange={(e) => setPeriodeMulai(e.target.value)} />
              <input type="date" value={periodeAkhir} disabled={saving} onChange={(e) => setPeriodeAkhir(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn btnPrimary btnSm" disabled={saving || parsing} onClick={submit}>
            {saving ? 'Membuat laporan…' : 'Buat Laporan'}
          </button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {loadErr && <div className="alert alertError" style={{ fontSize: 13 }}>{loadErr}</div>}
        {reports.length === 0 ? (
          <div className="emptyState">Belum ada laporan.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Toko</th>
                  <th>Periode</th>
                  <th>Tipe</th>
                  <th>Skor</th>
                  <th>GMV / bulan (run-rate)</th>
                  <th>Unduh</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>{r.platform}</td>
                    <td>
                      {r.periode_mulai} – {r.periode_akhir}
                      {!r.rentang_dari_berkas && <span className="muted" title="rentang tidak dari berkas"> *</span>}
                    </td>
                    <td>{r.periode_tipe}</td>
                    <td>
                      {r.skor == null ? '—' : r.skor.toFixed(1)}{' '}
                      {r.skor_label && <span className={skorTone(r.skor_label)}>{r.skor_label}</span>}
                    </td>
                    <td>{rupiah(r.gmv_runrate_bulanan)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <a className="btn btnGhost btnSm" href={reportHtmlUrl(r.id, 'klien')} target="_blank" rel="noreferrer">Klien</a>{' '}
                      <a className="btn btnGhost btnSm" href={reportHtmlUrl(r.id, 'internal')} target="_blank" rel="noreferrer">Internal</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
