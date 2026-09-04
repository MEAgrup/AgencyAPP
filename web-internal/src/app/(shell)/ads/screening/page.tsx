'use client';

/**
 * MEA SKU Screener — the advertiser's workspace (Gelombang 3, PLAN §6).
 *
 * Four modules, one page, in the order the SOP runs them:
 *
 *  - **A · Screening** — drop the "Bisnis Saya → Performa Produk" export (plus
 *    the optional Ads CPC export), get every SKU routed with its CPC maximum.
 *  - **B · Sebelum/Sesudah** — two exports of two periods, matched per SKU.
 *  - **C · Decision Log** — the append-only `ADL-` record of what was decided.
 *  - **D · Tracker Optimasi** — "changed this, measured that", per screening run.
 *
 * ## The browser computes nothing
 *
 * Uploads are decoded and hashed here and nothing else (`parseSkuWorkbook`);
 * R01-R16 all run server-side in `@cdps/core`. That is why the result tables
 * read the run PAYLOAD rather than deriving anything: a route the page computed
 * itself could disagree with the stored run, and then neither would be the
 * record.
 *
 * ## Why the client is typed, not picked from a list
 *
 * The SKU Screener's write gate is DIVISION-based (`canWriteSku`: Ads
 * staff/lead/Director), not client-ownership — an advertiser screens for
 * whichever client they are working. But `clients_select` (RLS) has no Ads arm,
 * so an advertiser genuinely cannot LIST clients, and `/clients` is not on their
 * menu either. A picker here would therefore be an empty dropdown for exactly
 * the role the page is for.
 *
 * So the client id is a field, pre-filled from `?client=` — the shape the Ads
 * campaign page already links with (`/ads/[id]` shows `campaign.client_id`).
 * Widening RLS to give Ads a client list is a data-access change, which needs a
 * `DECISIONS.md` entry rather than a quiet edit inside a UI ticket; it is filed
 * as the open question SCR-UI-1.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/api';
import {
  canUseSkuScreener,
  canWriteSkuScreener,
  DEFAULT_MIN_KLIK_SESUDAH,
  DEFAULT_TARGET_ROAS,
  getScreeningRun,
  listScreeningRuns,
  parseSkuCsvRows,
  parseSkuWorkbook,
  readComparePayload,
  readScreeningPayload,
  runCompare,
  runScreening,
  type BerkasProvenance,
  type ParsedSkuExport,
  type ScreeningRunDetail,
  type ScreeningRunSummary,
  type ScreeningSku,
} from '@/lib/skuscreener';
import CompareResultTable from '@/components/skuscreener/CompareResultTable';
import DecisionLogPanel, { type DecisionPrefill } from '@/components/skuscreener/DecisionLogPanel';
import ScreeningResultTable from '@/components/skuscreener/ScreeningResultTable';
import TrackerPanel, { type TrackerPrefill } from '@/components/skuscreener/TrackerPanel';

type Tab = 'a' | 'b' | 'c' | 'd';

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'a', label: 'A · Screening' },
  { key: 'b', label: 'B · Sebelum/Sesudah' },
  { key: 'c', label: 'C · Decision Log' },
  { key: 'd', label: 'D · Tracker Optimasi' },
];

const MSG_CLIENT_REQUIRED = '[isi ID klien dulu — semua modul screening terikat ke satu klien]';

/** Provenance for one uploaded export, in the shape `sumber_berkas` stores. */
function berkas(p: { filename: string; sha256: string; ukuran_bytes: number }, peran: string): BerkasProvenance {
  return { nama_berkas: p.filename, sha256: p.sha256, ukuran_bytes: p.ukuran_bytes, peran };
}

export default function SkuScreenerPage() {
  const { role, loading } = useAuth();
  const initialClient = useSearchParams().get('client') ?? '';

  const [clientInput, setClientInput] = useState(initialClient);
  const [clientId, setClientId] = useState(initialClient);
  const [tab, setTab] = useState<Tab>('a');

  const [runs, setRuns] = useState<ScreeningRunSummary[]>([]);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<ScreeningRunDetail | null>(null);
  const [openRunErr, setOpenRunErr] = useState<string | null>(null);

  // Modul A form
  const [aFile, setAFile] = useState<ParsedSkuExport | null>(null);
  const [aCpc, setACpc] = useState<{ filename: string; sha256: string; ukuran_bytes: number; rows: unknown[][] } | null>(null);
  const [targetRoas, setTargetRoas] = useState(String(DEFAULT_TARGET_ROAS));
  const [cpcPasar, setCpcPasar] = useState('');
  const [faktorCr, setFaktorCr] = useState('1');
  const [aBusy, setABusy] = useState(false);
  const [aErr, setAErr] = useState<string | null>(null);

  // Modul B form
  const [bBefore, setBBefore] = useState<ParsedSkuExport | null>(null);
  const [bAfter, setBAfter] = useState<ParsedSkuExport | null>(null);
  const [bMinKlik, setBMinKlik] = useState(String(DEFAULT_MIN_KLIK_SESUDAH));
  const [bBusy, setBBusy] = useState(false);
  const [bErr, setBErr] = useState<string | null>(null);

  // Cross-module hand-off (PLAN §6: "unggah → tabel rute → tempel ke
  // Decision Log/Tracker"). Consumed once by the target panel, then cleared.
  const [decisionPrefill, setDecisionPrefill] = useState<DecisionPrefill | null>(null);
  const [trackerPrefill, setTrackerPrefill] = useState<TrackerPrefill | null>(null);
  const [trackerRunId, setTrackerRunId] = useState('');

  const canWrite = canWriteSkuScreener(role);

  const reloadRuns = useCallback(async () => {
    if (!clientId) {
      setRuns([]);
      return;
    }
    try {
      setRuns(await listScreeningRuns(clientId));
      setRunsErr(null);
    } catch (e) {
      setRunsErr(errorMessage(e));
    }
  }, [clientId]);

  useEffect(() => {
    void reloadRuns();
  }, [reloadRuns]);

  const showRun = useCallback(async (id: string) => {
    setOpenRunErr(null);
    try {
      setOpenRun(await getScreeningRun(id));
    } catch (e) {
      setOpenRun(null);
      setOpenRunErr(errorMessage(e));
    }
  }, []);

  const screeningPayload = useMemo(
    () => (openRun ? readScreeningPayload(openRun.payload) : null),
    [openRun],
  );
  const comparePayload = useMemo(
    () => (openRun ? readComparePayload(openRun.payload) : null),
    [openRun],
  );

  const runA = async () => {
    if (!clientId) { setAErr(MSG_CLIENT_REQUIRED); return; }
    if (!aFile) { setAErr('[unggah minimal satu berkas ekspor Performa Produk]'); return; }
    setABusy(true);
    setAErr(null);
    try {
      const d = await runScreening(clientId, {
        sheets: aFile.sheets,
        adsCsvRows: aCpc ? aCpc.rows : null,
        targetRoas: Number(targetRoas.replace(',', '.')),
        cpcPasarKategori: cpcPasar.trim() === '' ? null : Number(cpcPasar.replace(',', '.')),
        faktorCrIklan: faktorCr.trim() === '' ? undefined : Number(faktorCr.replace(',', '.')),
        berkas: [
          berkas(aFile, 'performa_produk'),
          ...(aCpc ? [berkas(aCpc, 'iklan_cpc')] : []),
        ],
      });
      setOpenRun(d);
      setTrackerRunId(d.id);
      setAFile(null);
      setACpc(null);
      await reloadRuns();
    } catch (e) {
      setAErr(errorMessage(e));
    } finally {
      setABusy(false);
    }
  };

  const runB = async () => {
    if (!clientId) { setBErr(MSG_CLIENT_REQUIRED); return; }
    if (!bBefore || !bAfter) { setBErr('[unggah berkas periode SEBELUM dan SESUDAH]'); return; }
    setBBusy(true);
    setBErr(null);
    try {
      const d = await runCompare(clientId, {
        sheetsSebelum: bBefore.sheets,
        sheetsSesudah: bAfter.sheets,
        minKlikSesudah: bMinKlik.trim() === '' ? undefined : Number(bMinKlik),
        berkas: [berkas(bBefore, 'sebelum'), berkas(bAfter, 'sesudah')],
      });
      setOpenRun(d);
      setBBefore(null);
      setBAfter(null);
      await reloadRuns();
    } catch (e) {
      setBErr(errorMessage(e));
    } finally {
      setBBusy(false);
    }
  };

  const toDecision = (sku: ScreeningSku) => {
    setDecisionPrefill({
      screeningId: openRun?.id ?? '',
      objectName: sku.produk,
      // A suggestion from the route, never a decision: SCALE and KANDIDAT IKLAN
      // are the two routes that mean "advertise this", so they arrive as
      // "Loloskan ke iklan"; everything else arrives as the neutral "Biarkan"
      // rather than putting "Tolak" in the advertiser's mouth.
      decision: sku.baseRoute === 'SCALE' || sku.baseRoute === 'KANDIDAT IKLAN' ? 'Loloskan ke iklan' : 'Biarkan',
    });
    setTab('c');
  };

  const toTracker = (sku: ScreeningSku) => {
    setTrackerRunId(openRun?.id ?? '');
    setTrackerPrefill({
      productCode: sku.kode,
      productName: sku.produk,
      initialRoute: sku.baseRoute,
      views: sku.views,
      clicks: sku.clicks,
      ctr: sku.ctr,
      cr: sku.cr,
      orders: sku.orders,
    });
    setTab('d');
  };

  // The page guard mirrors `canUseSkuScreener` — the same predicate `nav.ts`
  // hides the menu line with, so a deep link is refused here rather than merely
  // being absent from the menu. `loading` holds the gate until /me resolves.
  if (loading) return <div className="pageLoading">Memuat...</div>;
  if (!canUseSkuScreener(role)) {
    return (
      <div>
        <h1>Akses ditolak</h1>
        <p style={{ margin: '6px 0 0', color: '#5A7184', maxWidth: 640 }}>
          Screening SKU hanya untuk tim Ads (Advertiser / Lead Advertiser); Director &amp; OD dapat melihat untuk
          oversight.
        </p>
      </div>
    );
  }

  const uploadField = (
    label: string,
    hint: string,
    current: ParsedSkuExport | null,
    onParsed: (p: ParsedSkuExport | null) => void,
    disabled: boolean,
    onError: (m: string) => void,
  ) => (
    <div className="field">
      <label>{label}</label>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          void parseSkuWorkbook(f).then(onParsed).catch((x) => onError(errorMessage(x)));
        }}
      />
      <span className="muted" style={{ fontSize: 12 }}>
        {current
          ? `${current.filename} · ${Math.round(current.ukuran_bytes / 1024)} KB · sheet: ${current.sheets.map((s) => s.name).join(', ')}`
          : hint}
      </span>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h1>Screening SKU</h1>
        <p style={{ margin: '6px 0 0', color: '#5A7184', maxWidth: 860 }}>
          MEA SKU Screener — memilih SKU mana yang layak diiklankan, mengukur hasil perubahannya, dan menyimpan
          alasannya. Semua aturan (median toko, rute, CPC maksimum, verdict) dihitung di server; halaman ini
          mengunggah, menampilkan, dan mencatat.
        </p>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="client">Klien</label>
            <input
              id="client"
              value={clientInput}
              placeholder="CLI-YYYYMM-NNNN"
              onChange={(e) => setClientInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setClientId(clientInput.trim());
              }}
            />
          </div>
          <button
            type="button"
            className="btn btnSecondary btnSm"
            onClick={() => {
              setClientId(clientInput.trim());
              setOpenRun(null);
            }}
          >
            Muat klien
          </button>
          {clientId && <span className="badge badge-blue">{clientId}</span>}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          ID klien ada di halaman kampanye Ads (baris &ldquo;Klien&rdquo;). Tautan
          <code> /ads/screening?client=…</code> mengisi kolom ini otomatis.
        </span>
      </section>

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

      {!clientId ? (
        <div className="emptyState">Isi ID klien di atas untuk mulai.</div>
      ) : (
        <>
          {(tab === 'a' || tab === 'b') && (
            <section className="card">
              <div className="cardHeader">
                <h2>Riwayat run — {runs.length}</h2>
              </div>
              {runsErr && <div className="alert alertError" style={{ fontSize: 13 }}>{runsErr}</div>}
              {runs.length === 0 ? (
                <div className="emptyState">Belum ada screening run untuk klien ini.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Jenis</th>
                        <th>Dibuat</th>
                        <th>Oleh</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id}>
                          <td>{r.id}</td>
                          <td>
                            <span className={`badge badge-${r.jenis === 'screening' ? 'blue' : 'purple'}`}>
                              {r.jenis}
                            </span>
                          </td>
                          <td>{r.created_at}</td>
                          <td>{r.created_by}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button type="button" className="btn btnGhost btnSm" onClick={() => void showRun(r.id)}>
                              buka
                            </button>{' '}
                            {r.jenis === 'screening' && (
                              <button
                                type="button"
                                className="btn btnGhost btnSm"
                                onClick={() => { setTrackerRunId(r.id); setTab('d'); }}
                              >
                                tracker
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === 'a' && (
            <>
              {canWrite && (
                <section className="card">
                  <div className="cardHeader">
                    <h2>Modul A — jalankan screening</h2>
                  </div>
                  {aErr && <div className="alert alertError" style={{ fontSize: 13 }}>{aErr}</div>}
                  {uploadField(
                    'Export "Bisnis Saya → Performa Produk" (wajib)',
                    'Sheet dipilih server berdasarkan namanya (yang memuat "performa"), jadi seluruh workbook dikirim apa adanya.',
                    aFile, setAFile, aBusy, setAErr,
                  )}
                  <div className="field">
                    <label>Export &ldquo;Laporan Iklan Produk / CPC&rdquo; (opsional — untuk CPC aktual toko)</label>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      disabled={aBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        void parseSkuCsvRows(f).then(setACpc).catch((x) => setAErr(errorMessage(x)));
                      }}
                    />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {aCpc ? `${aCpc.filename} · ${aCpc.rows.length} baris` : 'Tanpa berkas ini, CPC aktual tidak dihitung.'}
                    </span>
                  </div>
                  <div className="grid2">
                    <div className="field">
                      <label>Target ROAS</label>
                      <input value={targetRoas} disabled={aBusy} inputMode="decimal"
                        onChange={(e) => setTargetRoas(e.target.value)} />
                      <span className="muted" style={{ fontSize: 12 }}>
                        Default {DEFAULT_TARGET_ROAS} (default alat yang dipakai tim, bukan 3,57 di PRD — DECISIONS O66).
                      </span>
                    </div>
                    <div className="field">
                      <label>CPC pasar kategori (Rp, opsional)</label>
                      <input value={cpcPasar} disabled={aBusy} inputMode="decimal"
                        onChange={(e) => setCpcPasar(e.target.value)} />
                      <span className="muted" style={{ fontSize: 12 }}>
                        Dipakai untuk menilai CPC maksimum tiap SKU terhadap harga pasar.
                      </span>
                    </div>
                    <div className="field">
                      <label>Faktor CR iklan (CR iklan ÷ CR organik)</label>
                      <input value={faktorCr} disabled={aBusy} inputMode="decimal"
                        onChange={(e) => setFaktorCr(e.target.value)} />
                      <span className="muted" style={{ fontSize: 12 }}>Default 1,0 (asumsi PRD A09).</span>
                    </div>
                  </div>
                  <button type="button" className="btn btnPrimary btnSm" disabled={aBusy} onClick={() => void runA()}>
                    {aBusy ? 'Menghitung…' : 'Jalankan screening'}
                  </button>
                </section>
              )}

              <section className="card">
                <div className="cardHeader">
                  <h2>Hasil screening</h2>
                </div>
                {openRunErr && <div className="alert alertError" style={{ fontSize: 13 }}>{openRunErr}</div>}
                {openRun && screeningPayload ? (
                  <ScreeningResultTable
                    run={openRun}
                    payload={screeningPayload}
                    onLogDecision={canWrite ? toDecision : undefined}
                    onTrackSku={canWrite ? toTracker : undefined}
                  />
                ) : openRun && comparePayload ? (
                  <div className="alert alertInfo" style={{ fontSize: 13 }}>
                    {openRun.id} adalah run perbandingan — lihat di tab B.
                  </div>
                ) : (
                  <div className="emptyState">Jalankan screening atau buka satu run dari riwayat.</div>
                )}
              </section>
            </>
          )}

          {tab === 'b' && (
            <>
              {canWrite && (
                <section className="card">
                  <div className="cardHeader">
                    <h2>Modul B — bandingkan dua periode</h2>
                  </div>
                  {bErr && <div className="alert alertError" style={{ fontSize: 13 }}>{bErr}</div>}
                  {uploadField('Export periode SEBELUM', 'Performa Produk periode awal.', bBefore, setBBefore, bBusy, setBErr)}
                  {uploadField('Export periode SESUDAH', 'Performa Produk periode pembanding.', bAfter, setBAfter, bBusy, setBErr)}
                  <div className="field">
                    <label>Ambang klik minimum di periode SESUDAH</label>
                    <input value={bMinKlik} disabled={bBusy} inputMode="numeric" style={{ maxWidth: 140 }}
                      onChange={(e) => setBMinKlik(e.target.value)} />
                    <span className="muted" style={{ fontSize: 12 }}>
                      Di bawah ambang ini verdict-nya BELUM CUKUP DATA (R10, default {DEFAULT_MIN_KLIK_SESUDAH}).
                    </span>
                  </div>
                  <button type="button" className="btn btnPrimary btnSm" disabled={bBusy} onClick={() => void runB()}>
                    {bBusy ? 'Mencocokkan…' : 'Bandingkan'}
                  </button>
                </section>
              )}

              <section className="card">
                <div className="cardHeader">
                  <h2>Hasil perbandingan</h2>
                </div>
                {openRunErr && <div className="alert alertError" style={{ fontSize: 13 }}>{openRunErr}</div>}
                {openRun && comparePayload ? (
                  <CompareResultTable run={openRun} payload={comparePayload} />
                ) : openRun && screeningPayload ? (
                  <div className="alert alertInfo" style={{ fontSize: 13 }}>
                    {openRun.id} adalah run screening — lihat di tab A.
                  </div>
                ) : (
                  <div className="emptyState">Bandingkan dua export, atau buka satu run perbandingan dari riwayat.</div>
                )}
              </section>
            </>
          )}

          {tab === 'c' && (
            <DecisionLogPanel
              clientId={clientId}
              prefill={decisionPrefill}
              onPrefillConsumed={() => setDecisionPrefill(null)}
              canWrite={canWrite}
            />
          )}

          {tab === 'd' && (
            <>
              <section className="card">
                <div className="field" style={{ maxWidth: 320 }}>
                  <label htmlFor="trackerRun">Screening run</label>
                  <select id="trackerRun" value={trackerRunId} onChange={(e) => setTrackerRunId(e.target.value)}>
                    <option value="">— pilih run —</option>
                    {runs.filter((r) => r.jenis === 'screening').map((r) => (
                      <option key={r.id} value={r.id}>{r.id} · {r.created_at}</option>
                    ))}
                  </select>
                </div>
              </section>
              <TrackerPanel
                screeningId={trackerRunId}
                clientId={clientId}
                prefill={trackerPrefill}
                onPrefillConsumed={() => setTrackerPrefill(null)}
                canWrite={canWrite}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
