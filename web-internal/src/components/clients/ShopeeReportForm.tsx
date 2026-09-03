'use client';

/**
 * Mesin Laporan Klien — Shopee (Gelombang 2, SH-06).
 *
 * A sibling of `ReportPanel`'s TikTok form, not a branch inside it, because the
 * two engines ask for genuinely different things:
 *
 *  - Shopee has NO file-derived period. `periode` (the label printed on the
 *    report), `periode_mulai` and `periode_akhir` are all REQUIRED server-side
 *    (`createReportShopee`), so they are plain required fields here rather than
 *    TikTok's "only if the range is unreadable" fallback.
 *  - Shopee splits the report's ONE combined ads figure across the client's
 *    overlapping active `Shopee Ads` campaigns as auto Metric Entries (`MTR-`,
 *    the "no manual upload" path for M6D RM-C). The AM can exclude a campaign
 *    from that split, so the form has to show which campaigns are in it.
 *  - The 17 Shopee file slots are detected from the team's filename convention
 *    first, content signature second, so the per-file override list is the
 *    Shopee module list, not TikTok's four toko/afiliasi values.
 *
 * The browser still only decodes and hashes (`parseShopeeExportFile` — all
 * worksheets, `__SHEET__:` separated); detection, scoring and every threshold
 * stay in `@cdps/core` server-side.
 */
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { type ParsedExport } from '@/lib/riset-awal';
import {
  createClientReportShopee,
  listShopeeAdsCampaigns,
  parseShopeeExportFile,
  SHOPEE_MODULE_OPTIONS,
  type PeriodeTipe,
  type ShopeeAdsCampaignOption,
} from '@/lib/report';

interface UploadedFile extends ParsedExport {
  /** '' = let the server detect (filename convention, then content signature). */
  tipe: string;
}

export default function ShopeeReportForm({
  clientId,
  clientPlatformId,
  periodeTipe,
  onCreated,
}: {
  clientId: string;
  clientPlatformId: number;
  periodeTipe: PeriodeTipe;
  onCreated: () => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [periode, setPeriode] = useState('');
  const [periodeMulai, setPeriodeMulai] = useState('');
  const [periodeAkhir, setPeriodeAkhir] = useState('');
  const [campaigns, setCampaigns] = useState<ShopeeAdsCampaignOption[] | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const onPick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setParsing(true);
    setErr(null);
    try {
      const parsed: UploadedFile[] = [];
      for (const f of Array.from(list)) {
        parsed.push({ ...(await parseShopeeExportFile(f)), tipe: '' });
      }
      setFiles((prev) => [...prev, ...parsed]);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setParsing(false);
    }
  };

  /**
   * The campaign list is fetched on demand rather than on every date keystroke:
   * the period is typed in two fields, and half-entered dates would ask the
   * server about a range the AM has not finished stating.
   */
  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    setErr(null);
    try {
      const rows = await listShopeeAdsCampaigns(clientId, periodeMulai, periodeAkhir);
      setCampaigns(rows);
      // Drop exclusions for campaigns that are no longer in the window — a
      // stale id would silently do nothing, which reads as a bug to the AM.
      setExcluded((prev) => prev.filter((id) => rows.some((r) => r.id === id)));
    } catch (e) {
      setCampaigns(null);
      setErr(errorMessage(e));
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const submit = async () => {
    if (files.length === 0) {
      setErr('[unggah minimal satu berkas export untuk membuat laporan]');
      return;
    }
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const payloadFiles: ParsedExport[] = files.map((f) => ({
        filename: f.filename,
        aoa: f.aoa,
        sha256: f.sha256,
        ukuran_bytes: f.ukuran_bytes,
        tipe_override: f.tipe === '' ? null : f.tipe,
      }));
      await createClientReportShopee(clientId, {
        clientPlatformId,
        periodeTipe,
        files: payloadFiles,
        periode,
        periodeMulai,
        periodeAkhir,
        excludeCampaignIds: excluded,
      });
      setFiles([]);
      setPeriode('');
      setPeriodeMulai('');
      setPeriodeAkhir('');
      setCampaigns(null);
      setExcluded([]);
      setOk('Laporan Shopee dibuat. Sunting insight lalu terbitkan dari daftar di bawah.');
      onCreated();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}
      {ok && <div className="alert alertSuccess" style={{ fontSize: 13 }}>{ok}</div>}

      <div className="field">
        <label>Export Shopee Seller Centre (.xlsx / .csv) — boleh banyak sekaligus</label>
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
        <span className="muted" style={{ fontSize: 12 }}>
          {parsing
            ? 'Membaca berkas…'
            : 'Nama berkas konvensi tim ([bisnis]-Home && Juni 2026 && Klien && 2026-07-01.xlsx) terdeteksi otomatis. Berkas Bisnis — Home wajib ada.'}
        </span>
      </div>

      {files.length > 0 && (
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Berkas</th>
              <th>Ukuran</th>
              <th>Modul (isi bila nama berkas tak sesuai konvensi)</th>
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
                    onChange={(e) =>
                      setFiles((prev) => prev.map((x, idx) => (idx === i ? { ...x, tipe: e.target.value } : x)))
                    }
                    style={{ fontSize: 12, padding: '4px 8px' }}
                  >
                    <option value="">Otomatis (deteksi server)</option>
                    {SHOPEE_MODULE_OPTIONS.map((o) => (
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
        <label>Label periode (tercetak di laporan klien — wajib)</label>
        <input
          value={periode}
          disabled={saving}
          placeholder="Juni 2026"
          onChange={(e) => setPeriode(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Periode mulai &amp; akhir (wajib — Shopee tidak membacanya dari berkas)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={periodeMulai} disabled={saving} onChange={(e) => setPeriodeMulai(e.target.value)} />
          <input type="date" value={periodeAkhir} disabled={saving} onChange={(e) => setPeriodeAkhir(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Kampanye Shopee Ads yang menerima angka iklan laporan ini</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btnGhost btnSm"
            disabled={saving || loadingCampaigns || !periodeMulai || !periodeAkhir}
            onClick={() => void loadCampaigns()}
          >
            {loadingCampaigns ? 'Memuat…' : 'Muat kampanye pada periode ini'}
          </button>
          {!periodeMulai || !periodeAkhir ? (
            <span className="muted" style={{ fontSize: 12 }}>Isi periode mulai &amp; akhir dulu.</span>
          ) : null}
        </div>
        {campaigns != null && campaigns.length === 0 && (
          <div className="emptyState" style={{ fontSize: 13 }}>
            Tidak ada kampanye Shopee Ads aktif pada periode ini — angka iklan laporan tidak dibagi ke Metric Entry
            mana pun. Laporan tetap bisa dibuat.
          </div>
        )}
        {campaigns != null && campaigns.length > 0 && (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Kecualikan</th>
                  <th>Kampanye</th>
                  <th>Tipe Iklan</th>
                  <th>Periode Kampanye</th>
                  <th>Budget</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={excluded.includes(c.id)}
                        disabled={saving}
                        onChange={(e) =>
                          setExcluded((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {c.id}
                      <div className="muted" style={{ fontSize: 12 }}>{c.objective}</div>
                    </td>
                    <td>{c.tipe_iklan}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.start_date} – {c.end_date}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.budget}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="muted" style={{ fontSize: 12 }}>
              Angka iklan gabungan laporan dibagi rata ke kampanye yang TIDAK dikecualikan. Kampanye yang dikecualikan
              tetap bisa diisi manual seperti biasa.
            </span>
          </div>
        )}
      </div>

      <button type="button" className="btn btnPrimary btnSm" disabled={saving || parsing} onClick={() => void submit()}>
        {saving ? 'Membuat laporan Shopee…' : 'Buat Laporan Shopee'}
      </button>
    </div>
  );
}
