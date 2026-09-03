'use client';

/**
 * TikTok Ads Scanner — the advertiser's weekly workspace (Gelombang 4, AS-05).
 *
 * Three screens, in the order the week runs them:
 *
 *  - **Portofolio** — every client's latest scan, worst money leak first. The
 *    Monday view, and the read pattern that justified `adsscanner_run` being a
 *    table of its own (O69). It is the DEFAULT tab for that reason.
 *  - **Scan baru** — drop the week's TikTok Shop exports, get the SKUs bucketed.
 *  - **Hasil scan** — one stored scan in full.
 *
 * ## The browser computes nothing
 *
 * Uploads are decoded and hashed here and nothing else (`parseAdsScanExport`);
 * detection into the 4 slots, the 5-component score, the 6 buckets and the
 * reallocation pool all run server-side in `@cdps/core`. The result views read
 * the frozen payload rather than deriving anything — same posture as
 * `/ads/screening`, and for the same reason: a number the page computed itself
 * could disagree with the stored scan, and then neither would be the record.
 *
 * ## Why the client is typed here too
 *
 * Identical to `/ads/screening` (SCR-UI-1, still open): the write gate is
 * DIVISION-based, but `clients_select` (RLS) has no Ads arm, so an advertiser
 * genuinely cannot LIST clients — a picker would be an empty dropdown for
 * exactly the role this page is for. Pre-filled from `?client=`.
 *
 * The portfolio softens this in practice without widening RLS: it lists the
 * clients that already HAVE a scan, each with a "scan baru" button that fills
 * the field. So the typing burden is only on a client's FIRST scan. Widening
 * RLS to give Ads a real client list remains a data-access decision needing a
 * `DECISIONS.md` entry, not a quiet edit inside a UI ticket.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/api';
import {
  adsScanCategories,
  adsScanPortfolio,
  canRunAdsScan,
  canUseAdsScanner,
  getAdsScanRun,
  listAdsScanRuns,
  parseAdsScanExport,
  readAdsScanPayload,
  runAdsScan,
  type AdsScanPortfolioRow,
  type AdsScanRunDetail,
  type AdsScanRunSummary,
  type ParsedAdsScanExport,
} from '@/lib/adsscanner';
import { slotLabel } from '@/lib/adsscanner-ui';
import PortfolioTable from '@/components/adsscanner/PortfolioTable';
import ScanResultView from '@/components/adsscanner/ScanResultView';

type Tab = 'portfolio' | 'scan' | 'hasil';

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'portfolio', label: 'Portofolio' },
  { key: 'scan', label: 'Scan baru' },
  { key: 'hasil', label: 'Hasil scan' },
];

const MSG_CLIENT_REQUIRED = '[isi ID klien dulu — satu scan terikat ke satu klien]';
const MSG_KATEGORI_REQUIRED = '[pilih kategori Level-3 TikTok Shop]';
const MSG_ANALITIK_REQUIRED = '[ekspor Analitik Produk wajib diunggah — daftar SKU dibangun dari berkas itu]';

/** One staged upload: the decoded sheet plus the two overrides the AM may set. */
interface Staged extends ParsedAdsScanExport {
  tipe_override?: string | null;
  video_kind_override?: 'kreator' | 'toko' | null;
}

export default function AdsScannerPage() {
  const { role, loading } = useAuth();
  const initialClient = useSearchParams().get('client') ?? '';

  const [tab, setTab] = useState<Tab>('portfolio');
  const [clientInput, setClientInput] = useState(initialClient);
  const [clientId, setClientId] = useState(initialClient);

  const [portfolio, setPortfolio] = useState<AdsScanPortfolioRow[]>([]);
  const [portfolioErr, setPortfolioErr] = useState<string | null>(null);

  const [kategoriList, setKategoriList] = useState<string[]>([]);
  const [kategori, setKategori] = useState('');
  const [mode, setMode] = useState<'weekly' | 'newclient'>('weekly');
  const [minggu, setMinggu] = useState('');
  const [files, setFiles] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);

  const [runs, setRuns] = useState<AdsScanRunSummary[]>([]);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<AdsScanRunDetail | null>(null);
  const [openRunErr, setOpenRunErr] = useState<string | null>(null);

  const canRun = canRunAdsScan(role);

  const reloadPortfolio = useCallback(async () => {
    try {
      setPortfolio(await adsScanPortfolio());
      setPortfolioErr(null);
    } catch (e) {
      setPortfolioErr(errorMessage(e));
    }
  }, []);

  const reloadRuns = useCallback(async () => {
    if (!clientId) {
      setRuns([]);
      return;
    }
    try {
      setRuns(await listAdsScanRuns(clientId));
      setRunsErr(null);
    } catch (e) {
      setRunsErr(errorMessage(e));
    }
  }, [clientId]);

  useEffect(() => { void reloadPortfolio(); }, [reloadPortfolio]);
  useEffect(() => { void reloadRuns(); }, [reloadRuns]);

  // The category list comes from the ACTIVE benchmark row, never a hardcoded
  // copy: a v2 calibration could add or rename one, and offering a category the
  // active benchmark lacks would offer exactly the value the server rejects.
  useEffect(() => {
    void adsScanCategories()
      .then((c) => setKategoriList(c))
      .catch((e) => setScanErr(errorMessage(e)));
  }, []);

  const showRun = useCallback(async (id: string) => {
    setOpenRunErr(null);
    setTab('hasil');
    try {
      setOpenRun(await getAdsScanRun(id));
    } catch (e) {
      setOpenRun(null);
      setOpenRunErr(errorMessage(e));
    }
  }, []);

  const payload = useMemo(() => (openRun ? readAdsScanPayload(openRun.payload) : null), [openRun]);

  const addFile = (f: File) => {
    void parseAdsScanExport(f)
      .then((p) => setFiles((prev) => [...prev, p]))
      .catch((e) => setScanErr(errorMessage(e)));
  };

  const submit = async () => {
    if (!clientId) { setScanErr(MSG_CLIENT_REQUIRED); return; }
    if (!kategori) { setScanErr(MSG_KATEGORI_REQUIRED); return; }
    if (files.length === 0) { setScanErr(MSG_ANALITIK_REQUIRED); return; }
    setBusy(true);
    setScanErr(null);
    try {
      const d = await runAdsScan(clientId, {
        kategori,
        mode,
        mingguMulai: minggu.trim() === '' ? null : minggu,
        files,
      });
      setOpenRun(d);
      setFiles([]);
      setTab('hasil');
      await Promise.all([reloadRuns(), reloadPortfolio()]);
    } catch (e) {
      setScanErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // The page guard mirrors `canUseAdsScanner` — the same predicate `nav.ts`
  // hides the menu line with, so a deep link is refused here rather than merely
  // being absent from the menu. `loading` holds the gate until /me resolves.
  if (loading) return <div className="pageLoading">Memuat...</div>;
  if (!canUseAdsScanner(role)) {
    return (
      <div>
        <h1>Akses ditolak</h1>
        <p style={{ margin: '6px 0 0', color: '#5A7184', maxWidth: 640 }}>
          Ads Scanner hanya untuk tim Ads (Advertiser / Lead Advertiser); Director &amp; OD dapat melihat untuk
          oversight.
        </p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h1>Ads Scanner TikTok</h1>
        <p style={{ margin: '6px 0 0', color: '#5A7184', maxWidth: 880 }}>
          Scan mingguan per klien: SKU mana yang layak di-scale, mana yang boros, dan berapa budget yang harus
          dipindah. Semua aturan (skor 5 komponen, 6 bucket, gerbang konten, pool realokasi) dihitung di server
          terhadap benchmark kategori berversi; halaman ini mengunggah dan menampilkan.
        </p>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`btn btnSm ${tab === t.key ? 'btnSecondary' : 'btnGhost'}`}
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'portfolio' && (
        <section className="card">
          <div className="cardHeader">
            <h2>Portofolio — scan terakhir tiap klien</h2>
          </div>
          {portfolioErr && <div className="alert alertError" style={{ fontSize: 13 }}>{portfolioErr}</div>}
          <PortfolioTable
            rows={portfolio}
            onOpenRun={(id) => void showRun(id)}
            onScanClient={canRun ? (cid) => {
              setClientInput(cid);
              setClientId(cid);
              setTab('scan');
            } : undefined}
          />
        </section>
      )}

      {(tab === 'scan' || tab === 'hasil') && (
        <section className="card">
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ minWidth: 260 }}>
              <label htmlFor="client">Klien</label>
              <input
                id="client"
                value={clientInput}
                placeholder="CLI-YYYYMM-NNNN"
                onChange={(e) => setClientInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setClientId(clientInput.trim()); }}
              />
            </div>
            <button
              type="button"
              className="btn btnSecondary btnSm"
              onClick={() => { setClientId(clientInput.trim()); setOpenRun(null); }}
            >
              Muat klien
            </button>
            {clientId && <span className="badge badge-blue">{clientId}</span>}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            ID klien ada di halaman kampanye Ads (baris &ldquo;Klien&rdquo;), atau pakai tombol &ldquo;scan
            baru&rdquo; di tab Portofolio. Tautan <code>/ads/scanner?client=…</code> mengisi kolom ini otomatis.
          </span>
        </section>
      )}

      {tab === 'scan' && (
        <>
          {!canRun ? (
            <div className="emptyState">
              Peran Anda hanya bisa melihat hasil scan (OD read-only). Menjalankan scan butuh peran Ads atau Director.
            </div>
          ) : (
            <section className="card">
              <div className="cardHeader">
                <h2>Jalankan scan</h2>
              </div>
              {scanErr && <div className="alert alertError" style={{ fontSize: 13 }}>{scanErr}</div>}

              <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="field" style={{ minWidth: 280 }}>
                  <label htmlFor="kategori">Kategori Level-3 TikTok Shop (wajib)</label>
                  <select id="kategori" value={kategori} disabled={busy} onChange={(e) => setKategori(e.target.value)}>
                    <option value="">— pilih kategori —</option>
                    {kategoriList.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Memilih baris benchmark (ROI / take-rate / GPM). Kategori di luar daftar ini ditolak server —
                    benchmark all-null akan menghasilkan skor yang tampak sebanding padahal bukan.
                  </span>
                </div>

                <div className="field" style={{ minWidth: 180 }}>
                  <label htmlFor="minggu">Minggu data (opsional)</label>
                  <input
                    id="minggu"
                    type="date"
                    value={minggu}
                    disabled={busy}
                    onChange={(e) => setMinggu(e.target.value)}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Tanggal mana pun di dalam minggu data; server menyelaraskannya ke hari Senin.
                  </span>
                </div>

                <div className="field" style={{ minWidth: 200 }}>
                  <label htmlFor="mode">Mode</label>
                  <select id="mode" value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as 'weekly' | 'newclient')}>
                    <option value="weekly">Mingguan (rutin)</option>
                    <option value="newclient">Audit klien baru</option>
                  </select>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Mode audit menambahkan label kesiapan per SKU.
                  </span>
                </div>
              </div>

              <div className="field">
                <label>Berkas export TikTok Shop</label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    for (const f of list) addFile(f);
                  }}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  Unggah keempat export sekaligus: Analitik Produk (<strong>wajib</strong> — daftar SKU dibangun dari
                  situ), Ads Produk, Video Kreator dan/atau Video Toko, Ads Live. Slot tiap berkas dideteksi
                  server dari baris headernya; Anda bisa menimpanya di bawah.
                </span>
              </div>

              {files.length > 0 && (
                <div className="table-wrap">
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Berkas</th>
                        <th style={{ textAlign: 'right' }}>Baris</th>
                        <th>Paksa slot (opsional)</th>
                        <th>Jenis video (opsional)</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f, i) => (
                        <tr key={`${f.sha256}-${i}`}>
                          <td>
                            {f.nama_berkas}
                            <div className="muted" style={{ fontSize: 11 }}>
                              {Math.round(f.ukuran_bytes / 1024)} KB
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>{f.aoa.length}</td>
                          <td>
                            <select
                              value={f.tipe_override ?? ''}
                              disabled={busy}
                              onChange={(e) => setFiles((prev) => prev.map((x, j) =>
                                j === i ? { ...x, tipe_override: e.target.value || null } : x))}
                            >
                              <option value="">deteksi server</option>
                              {['analitik', 'ads', 'video', 'adslive'].map((s) => (
                                <option key={s} value={s}>{slotLabel(s)}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={f.video_kind_override ?? ''}
                              disabled={busy}
                              onChange={(e) => setFiles((prev) => prev.map((x, j) =>
                                j === i ? { ...x, video_kind_override: (e.target.value || null) as 'kreator' | 'toko' | null } : x))}
                            >
                              <option value="">otomatis</option>
                              <option value="kreator">kreator / affiliate</option>
                              <option value="toko">toko</option>
                            </select>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btnGhost btnSm"
                              disabled={busy}
                              onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                            >
                              hapus
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <span className="muted" style={{ fontSize: 11 }}>
                    &ldquo;Jenis video&rdquo; hanya berlaku untuk berkas yang terdeteksi sebagai Video. Deteksi
                    otomatis membaca nama berkas dulu, lalu jatuh ke jumlah kreator unik — kalau hasilnya ditebak,
                    scan menandainya supaya bisa ditukar di scan berikutnya.
                  </span>
                </div>
              )}

              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btnPrimary" disabled={busy} onClick={() => void submit()}>
                  {busy ? 'Menjalankan…' : 'Jalankan scan'}
                </button>
                {files.length > 0 && (
                  <button type="button" className="btn btnGhost" disabled={busy} onClick={() => setFiles([])}>
                    Kosongkan berkas
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {(tab === 'scan' || tab === 'hasil') && clientId && (
        <section className="card">
          <div className="cardHeader">
            <h2>Riwayat scan — {runs.length}</h2>
          </div>
          {runsErr && <div className="alert alertError" style={{ fontSize: 13 }}>{runsErr}</div>}
          {runs.length === 0 ? (
            <div className="emptyState">Belum ada scan untuk klien ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Scan</th>
                    <th>Kategori</th>
                    <th>Minggu</th>
                    <th>Mode</th>
                    <th>Benchmark</th>
                    <th>Dibuat</th>
                    <th>Oleh</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.kategori}</td>
                      <td>{r.minggu_mulai ?? '—'}</td>
                      <td>{r.mode === 'newclient' ? 'audit' : 'mingguan'}</td>
                      <td>v{r.benchmark_versi}</td>
                      <td>{r.created_at}</td>
                      <td>{r.created_by}</td>
                      <td>
                        <button type="button" className="btn btnGhost btnSm" onClick={() => void showRun(r.id)}>
                          buka
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'hasil' && (
        <>
          {openRunErr && <div className="alert alertError" style={{ fontSize: 13 }}>{openRunErr}</div>}
          {!openRun && !openRunErr && (
            <div className="emptyState">Pilih satu scan dari Portofolio atau Riwayat scan.</div>
          )}
          {openRun && !payload && (
            <div className="alert alertWarn" style={{ fontSize: 13 }}>
              Scan {openRun.id} memakai skema payload <code>{openRun.payload_schema}</code> yang tidak dikenali
              halaman ini.
            </div>
          )}
          {openRun && payload && <ScanResultView run={openRun} payload={payload} />}
        </>
      )}
    </div>
  );
}
