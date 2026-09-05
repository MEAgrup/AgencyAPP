'use client';

/**
 * Mesin Laporan Klien (C1) — the client-page panel.
 *
 * Pick an active store → pick Mingguan / Bulanan → drop the Seller-Center / Ads
 * Manager exports → POST. The browser only parses the xlsx to rows + sha256
 * (`parseExportFile`, reused from Riset Awal); the server detects each file,
 * runs the engine, stores the report, and rewrites `clients.total_sales`. The
 * rendered report is downloaded as HTML in Klien or Internal mode.
 *
 * ## Two engines, one panel
 *
 * Gelombang 2 added a second engine (`cdps.report.shopee.v1`). Its inputs differ
 * enough from TikTok's that the form is its own component (`ShopeeReportForm`
 * — see its header). This panel owns what both share: the store picker, the
 * period type, and the report list with the insight editor and publication
 * badges below.
 *
 * ## Tahap fokus (R3)
 *
 * The store picker carries one more field: which buyer-journey stage this shop
 * is chasing. It lives HERE, beside the store it describes, because it is read
 * at generation time and stamped into the report — an AM who is about to press
 * "Buat Laporan" is exactly the person who should see, and be able to correct,
 * what the report is about to claim. It is saved immediately on change rather
 * than with the report: it describes the SHOP, not this one report, and the next
 * report should inherit it without anyone retyping it.
 *
 * The engine is CHOSEN, not inferred. `client_platforms.platform` is free text
 * (M4 rows can even read "TikTok Shop, Shopee"), and neither report endpoint
 * checks it against the engine — so guessing silently would post a Shopee
 * workbook at the TikTok parser on a badly named store. The radio is
 * pre-selected from the store name and stays the AM's to change.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { parseExportFile, type ParsedExport } from '@/lib/riset-awal';
import {
  createClientReport,
  getClientReports,
  getReportInsight,
  labelStatusPublikasi,
  reportHtmlUrl,
  setTahapFokus,
  TAHAP_OPTIONS,
  STATUS_DICABUT,
  STATUS_TERBIT,
  type ClientReportSummary,
  type PeriodeTipe,
} from '@/lib/report';
import { type Platform } from '@/lib/clients';
import InsightEditor from '@/components/clients/InsightEditor';
import ShopeeReportForm from '@/components/clients/ShopeeReportForm';

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

type Engine = 'tiktok' | 'shopee';

/**
 * Pre-select the engine from the store name. A guess, and treated as one — the
 * AM can override it, because `platform` is free text and a combined row
 * ("TikTok Shop, Shopee") matches both.
 */
function engineFor(platform: string | undefined): Engine {
  return (platform ?? '').toLowerCase().includes('shopee') ? 'shopee' : 'tiktok';
}

function rupiah(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

function publikasiTone(status: string | undefined): string {
  if (status === STATUS_TERBIT) return 'badge badgeSuccess';
  if (status === STATUS_DICABUT) return 'badge badgeDanger';
  return 'badge badgeWarning';
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
  /** Which report's insight editor is expanded. One at a time — the editor is
   *  tall, and two open at once invites editing the wrong period. */
  const [openInsight, setOpenInsight] = useState<number | null>(null);
  /**
   * Publication status per report id, for the list badge.
   *
   * The list endpoint returns `ClientReportSummary`, which has no publication
   * row (that lives on the DETAIL shape), so the badge is fetched separately.
   * Deliberately NOT added to the summary DTO: the list is read on every client
   * page load, and widening it for a badge would make every one of those reads
   * carry the insight join too.
   */
  const [statusMap, setStatusMap] = useState<Record<number, string>>({});

  const [platformId, setPlatformId] = useState<number>(active[0]?.client_platform_id ?? 0);
  // Seeded from the server and then owned locally, keyed by store: switching
  // stores must show THAT store's stage, not the last one looked at.
  const [tahapMap, setTahapMap] = useState<Record<number, string>>(
    () => Object.fromEntries(platforms.map((p) => [p.client_platform_id, p.tahap_fokus ?? ''])));
  const [tahapBusy, setTahapBusy] = useState(false);
  const [tahapErr, setTahapErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine>(engineFor(active[0]?.platform));
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
      const rows = await getClientReports(clientId);
      setReports(rows);
      setLoadErr(null);
      // Badges are best-effort: a failure here must not blank the report list,
      // so each lookup is settled independently and a rejection just leaves that
      // row's badge unset rather than throwing away the rows themselves.
      const settled = await Promise.allSettled(rows.map((r) => getReportInsight(r.id)));
      const next: Record<number, string> = {};
      settled.forEach((res, i) => {
        if (res.status === 'fulfilled') next[rows[i].id] = res.value.publikasi.status;
      });
      setStatusMap(next);
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
            <select
              value={platformId}
              disabled={saving}
              onChange={(e) => {
                const id = Number(e.target.value);
                setPlatformId(id);
                // Re-guess on every store change: switching to a Shopee store and
                // silently keeping the TikTok form is the exact mistake the radio
                // exists to prevent.
                setEngine(engineFor(active.find((p) => p.client_platform_id === id)?.platform));
              }}
            >
              {active.map((p) => (
                <option key={p.client_platform_id} value={p.client_platform_id}>
                  {p.platform}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Tahap fokus toko ini</label>
            <select
              value={tahapMap[platformId] ?? ''}
              disabled={saving || tahapBusy || !platformId}
              onChange={(e) => {
                const nilai = e.target.value;
                const sebelum = tahapMap[platformId] ?? '';
                // Optimistic, then reconciled with what the server echoes back —
                // and rolled back on failure, so the dropdown never shows a stage
                // the report will not actually carry.
                setTahapMap((m) => ({ ...m, [platformId]: nilai }));
                setTahapBusy(true);
                setTahapErr(null);
                setTahapFokus(clientId, platformId, nilai)
                  .then((r) => setTahapMap((m) => ({ ...m, [platformId]: r.tahap_fokus ?? '' })))
                  .catch((x) => {
                    setTahapMap((m) => ({ ...m, [platformId]: sebelum }));
                    setTahapErr(errorMessage(x));
                  })
                  .finally(() => setTahapBusy(false));
              }}
            >
              {TAHAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="note" style={{ fontSize: 12 }}>
              Dipakai laporan berikutnya untuk menandai tahap mana yang sedang dikejar.
              Laporan yang sudah dibuat tidak ikut berubah.
            </div>
            {tahapErr && <div className="alert alertError" style={{ fontSize: 13 }}>{tahapErr}</div>}
          </div>

          <div className="field">
            <label>Mesin laporan</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" name="engine" checked={engine === 'tiktok'} disabled={saving}
                  onChange={() => setEngine('tiktok')} /> TikTok Shop
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" name="engine" checked={engine === 'shopee'} disabled={saving}
                  onChange={() => setEngine('shopee')} /> Shopee
              </label>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              Terpilih dari nama toko; ganti bila salah. Export Shopee tidak terbaca mesin TikTok dan sebaliknya.
            </span>
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

          {engine === 'tiktok' ? (
            <>
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
            </>
          ) : (
            <ShopeeReportForm
              clientId={clientId}
              clientPlatformId={platformId}
              periodeTipe={tipe}
              onCreated={() => void reload()}
            />
          )}
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
                  <th>Klien</th>
                  <th>Lihat / Unduh</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <Fragment key={r.id}>
                  <tr>
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
                      <span className={publikasiTone(statusMap[r.id])}>
                        {labelStatusPublikasi(statusMap[r.id] ?? '')}
                      </span>{' '}
                      <button
                        type="button"
                        className="btn btnGhost btnSm"
                        onClick={() => setOpenInsight((cur) => (cur === r.id ? null : r.id))}
                      >
                        {openInsight === r.id ? 'tutup insight' : 'insight & terbit'}
                      </button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {/* Four actions, not two. The old pair was labelled "Unduh"
                          but opened a tab, so an AM sending the report to a client
                          had to Ctrl+S it into a file called `html.html`. Preview
                          and download are different jobs and now say so. */}
                      <a className="btn btnGhost btnSm" href={reportHtmlUrl(r.id, 'klien')} target="_blank" rel="noreferrer">Lihat Klien</a>{' '}
                      <a className="btn btnGhost btnSm" href={reportHtmlUrl(r.id, 'klien', true)}>Unduh Klien</a>{' '}
                      <a className="btn btnGhost btnSm" href={reportHtmlUrl(r.id, 'internal')} target="_blank" rel="noreferrer">Lihat Internal</a>{' '}
                      <a className="btn btnGhost btnSm" href={reportHtmlUrl(r.id, 'internal', true)}>Unduh Internal</a>
                    </td>
                  </tr>
                  {openInsight === r.id && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--paper, #F6F8FA)' }}>
                        <InsightEditor reportId={r.id} onPublikasiChange={() => void reload()} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
