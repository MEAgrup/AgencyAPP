'use client';

/**
 * M6D — Rekap Hasil Mingguan detail (D-10). The deep-link target for the four
 * M6D notifications (`/account/rekap/{id}`), and the AM's weekly close surface.
 *
 * Desktop-first for the close flow (RM-A6 pembuka + RM-C metrics + RM-D narasi →
 * Tutup); every write is enabled only while the recap is Terbuka and the actor
 * may manage it (owning AM / Account lead / Director — server is final). The
 * page never recomputes a derived number: production counts, gmv_interim, ROAS
 * and the week-over-week deltas all arrive from the server read-only.
 */
import { use, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatIDR } from '@/lib/money';
import StatusBadge from '@/components/StatusBadge';
import {
  DIVISIONS,
  MANUAL_ELIGIBLE_METRICS,
  WRR_DITUTUP_OTOMATIS,
  WRR_TERBUKA,
  addRecapCatatanDivisi,
  canManageRecap,
  canReopenRecap,
  canWriteDivisiNote,
  closeRecap,
  fileRecapSengketaDivisi,
  fileRecapSengketaMetrik,
  getMetrikLabel,
  getPlanRekapRollup,
  getRecapDetail,
  recordRecapMetrikManual,
  reopenRecap,
  saveRecapNarasi,
  saveRecapPembuka,
  VIEW_BLENDED_LABEL,
  type PlanRekapRollup,
  type RecapDetail,
  type RecapMetrik,
} from '@/lib/recap';

// T-3: CPC (Rp/klik) & CPM (Rp/1000 impresi) are money; CTR/CVR are percentages.
const MONEY_METRICS = new Set(['gmv_interim', 'ad_spend', 'cpc', 'cpm']);

/** Render a metric value read-only: `—` when unavailable, Rp for money, else plain. */
function metrikNilai(m: RecapMetrik): string {
  if (m.nilai === null) return '—';
  if (MONEY_METRICS.has(m.metrik)) return formatIDR(m.nilai);
  return String(m.nilai);
}

function delta(m: RecapMetrik): string {
  if (m.nilai === null || m.nilai_minggu_lalu === null) return '—';
  const d = m.nilai - m.nilai_minggu_lalu;
  const sign = d > 0 ? '+' : '';
  if (MONEY_METRICS.has(m.metrik)) return `${sign}${formatIDR(d)}`;
  return `${sign}${d}`;
}

export default function RekapDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const manage = canManageRecap(role);
  const mayReopen = canReopenRecap(role);

  const [detail, setDetail] = useState<RecapDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Edit buffers.
  const [pembuka, setPembuka] = useState('');
  const [narasi, setNarasi] = useState({
    yang_bergerak: '',
    yang_tertahan: '',
    fokus_minggu_depan: '',
    bahan_untuk_klien: '',
    catatan_metrik_tambahan: '',
  });
  const [noteDivisi, setNoteDivisi] = useState(DIVISIONS[0] as string);
  const [noteText, setNoteText] = useState('');
  const [rollup, setRollup] = useState<PlanRekapRollup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getRecapDetail(id);
      setDetail(res);
      setPembuka(res.recap.catatan_pembuka ?? '');
      setNarasi({
        yang_bergerak: res.catatan?.yang_bergerak ?? '',
        yang_tertahan: res.catatan?.yang_tertahan ?? '',
        fokus_minggu_depan: res.catatan?.fokus_minggu_depan ?? '',
        bahan_untuk_klien: res.catatan?.bahan_untuk_klien ?? '',
        catatan_metrik_tambahan: res.catatan?.catatan_metrik_tambahan ?? '',
      });
      if (res.recap.plan_id) {
        try {
          setRollup(await getPlanRekapRollup(res.recap.plan_id));
        } catch {
          // RM-E rollup is advisory — a failure must not blank the page (O52).
          setRollup(null);
        }
      } else {
        setRollup(null);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = detail?.recap.status === WRR_TERBUKA;
  const canEdit = manage && open;

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      setBusy(true);
      setActionError(null);
      setActionMessage(null);
      try {
        await fn();
        setActionMessage(ok);
        await load();
      } catch (err) {
        setActionError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const savePembuka = (e: FormEvent) => {
    e.preventDefault();
    void run(() => saveRecapPembuka(id, pembuka), 'Catatan Pembuka tersimpan.');
  };
  const saveNarasi = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () =>
        saveRecapNarasi(id, {
          yang_bergerak: narasi.yang_bergerak.trim() === '' ? null : narasi.yang_bergerak,
          yang_tertahan: narasi.yang_tertahan.trim() === '' ? null : narasi.yang_tertahan,
          fokus_minggu_depan: narasi.fokus_minggu_depan.trim() === '' ? null : narasi.fokus_minggu_depan,
          bahan_untuk_klien: narasi.bahan_untuk_klien.trim() === '' ? null : narasi.bahan_untuk_klien,
          catatan_metrik_tambahan:
            narasi.catatan_metrik_tambahan.trim() === '' ? null : narasi.catatan_metrik_tambahan,
        }),
      'Narasi tersimpan.',
    );
  };
  const addNote = (e: FormEvent) => {
    e.preventDefault();
    void run(() => addRecapCatatanDivisi(id, noteDivisi, noteText), 'Catatan divisi ditambahkan.').then(() =>
      setNoteText(''),
    );
  };

  const weekLabel = useMemo(() => {
    if (!detail) return '';
    const r = detail.recap;
    return `Minggu ${r.iso_week} / ${r.iso_year} (${r.minggu_mulai} – ${r.minggu_akhir})`;
  }, [detail]);

  if (loading) return <main className="page"><p>Memuat…</p></main>;
  if (loadError) return <main className="page"><p className="error">{loadError}</p></main>;
  if (!detail) return null;

  const r = detail.recap;

  return (
    <main className="page" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 960 }}>
      <div>
        <Link href={`/account/rekap?clientId=${encodeURIComponent(r.client_id)}`}>← Rekap klien {r.client_id}</Link>
      </div>

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Rekap Hasil Mingguan</h1>
          <p style={{ margin: '4px 0', color: 'var(--muted, #666)' }}>{weekLabel}</p>
          <p style={{ margin: '4px 0' }}>
            <StatusBadge status={r.status} />{' '}
            {r.pernah_ditutup_otomatis && (
              <span className="badge badge-amber" title="Pernah ditutup otomatis oleh sistem (RM-5)">
                pernah ditutup otomatis
              </span>
            )}
          </p>
          <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--muted, #666)' }}>
            {r.id} · klien {r.client_id}
            {r.plan_id ? <> · plan {r.plan_id}</> : <> · Tanpa Plan</>}
            {r.ditutup_pada && <> · ditutup {new Date(r.ditutup_pada).toLocaleString('id-ID')}</>}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {open && manage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => closeRecap(id), 'Rekap ditutup.')}
              className="btn btn-primary"
            >
              Tutup Rekap
            </button>
          )}
          {r.status === WRR_DITUTUP_OTOMATIS && mayReopen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const alasan = window.prompt('Alasan buka-kembali (wajib):') ?? '';
                if (alasan.trim() !== '') void run(() => reopenRecap(id, alasan), 'Rekap dibuka kembali.');
              }}
              className="btn"
            >
              Buka Kembali
            </button>
          )}
        </div>
      </header>

      {actionError && <p className="error">{actionError}</p>}
      {actionMessage && <p className="success">{actionMessage}</p>}

      {/* RM-A6 — Catatan Pembuka */}
      <section>
        <h2>Catatan Pembuka</h2>
        {canEdit ? (
          <form onSubmit={savePembuka} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea rows={3} value={pembuka} onChange={(e) => setPembuka(e.target.value)} disabled={busy} />
            <div>
              <button type="submit" className="btn" disabled={busy}>Simpan Pembuka</button>
            </div>
          </form>
        ) : (
          <p>{r.catatan_pembuka ?? <em>— belum diisi —</em>}</p>
        )}
      </section>

      {/* RM-B — Produksi per divisi */}
      <section>
        <h2>Produksi Divisi</h2>
        {detail.divisi.length === 0 ? (
          <p><em>Belum ada produksi tercatat minggu ini.</em></p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Divisi</th><th>Jumlah</th><th>Sengketa</th><th /></tr>
            </thead>
            <tbody>
              {detail.divisi.map((d) => (
                <tr key={d.divisi}>
                  <td>{d.divisi}</td>
                  <td>{d.jumlah_produksi}</td>
                  <td>{d.sengketa ?? '—'}</td>
                  <td>
                    {canEdit && !d.sengketa && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => {
                          const alasan = window.prompt(`Sengketa angka produksi ${d.divisi} — alasan:`) ?? '';
                          if (alasan.trim() !== '') void run(() => fileRecapSengketaDivisi(id, d.divisi, alasan), 'Sengketa diajukan.');
                        }}
                      >
                        Sengketa
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* RM-C — Metrik hasil */}
      <section>
        <h2>Metrik Hasil</h2>
        <table className="table">
          <thead>
            <tr><th>Metrik</th><th>Nilai</th><th>Minggu Lalu</th><th>Delta</th><th>Sumber</th><th /></tr>
          </thead>
          <tbody>
            {detail.metrik.map((m) => (
              <tr key={m.metrik}>
                <td>{getMetrikLabel(m.metrik)}</td>
                <td>{metrikNilai(m)}{m.sengketa && <span className="badge badge-red" title={m.sengketa}> sengketa</span>}</td>
                <td>{m.nilai_minggu_lalu === null ? '—' : MONEY_METRICS.has(m.metrik) ? formatIDR(m.nilai_minggu_lalu) : m.nilai_minggu_lalu}</td>
                <td>{delta(m)}</td>
                <td>{m.sumber}</td>
                <td>
                  {canEdit && m.sumber === 'otomatis' && !m.sengketa && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => {
                        const alasan = window.prompt(`Sengketa angka ${getMetrikLabel(m.metrik)} — alasan:`) ?? '';
                        if (alasan.trim() !== '') void run(() => fileRecapSengketaMetrik(id, m.metrik, alasan), 'Sengketa diajukan.');
                      }}
                    >
                      Sengketa
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {/* T-4a: derived blended-view summary = paid (total_view) + organik
                (view_organik). Read-time derivation (house #4), shown only when at
                least one side has a value. */}
            {(() => {
              const paid = detail.metrik.find((m) => m.metrik === 'total_view')?.nilai ?? null;
              const organik = detail.metrik.find((m) => m.metrik === 'view_organik')?.nilai ?? null;
              if (paid === null && organik === null) return null;
              const blended = (paid ?? 0) + (organik ?? 0);
              return (
                <tr>
                  <td><strong>{VIEW_BLENDED_LABEL}</strong></td>
                  <td><strong>{blended.toLocaleString('id-ID')}</strong></td>
                  <td>—</td>
                  <td>—</td>
                  <td className="muted">turunan</td>
                  <td />
                </tr>
              );
            })()}
          </tbody>
        </table>
        {canEdit && <ManualMetrikForm id={id} detail={detail} busy={busy} run={run} />}
      </section>

      {/* RM-D + RM-C9 — Narasi */}
      <section>
        <h2>Narasi Mingguan</h2>
        {canEdit ? (
          <form onSubmit={saveNarasi} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label>Yang Bergerak (wajib saat tutup)
              <textarea rows={2} value={narasi.yang_bergerak} onChange={(e) => setNarasi({ ...narasi, yang_bergerak: e.target.value })} disabled={busy} />
            </label>
            <label>Yang Tertahan
              <textarea rows={2} value={narasi.yang_tertahan} onChange={(e) => setNarasi({ ...narasi, yang_tertahan: e.target.value })} disabled={busy} />
            </label>
            <label>Fokus Minggu Depan (wajib saat tutup)
              <textarea rows={2} value={narasi.fokus_minggu_depan} onChange={(e) => setNarasi({ ...narasi, fokus_minggu_depan: e.target.value })} disabled={busy} />
            </label>
            <label>Bahan untuk Klien
              <textarea rows={2} value={narasi.bahan_untuk_klien} onChange={(e) => setNarasi({ ...narasi, bahan_untuk_klien: e.target.value })} disabled={busy} />
            </label>
            <label>Catatan Metrik Tambahan (teks, bukan metrik)
              <textarea rows={2} value={narasi.catatan_metrik_tambahan} onChange={(e) => setNarasi({ ...narasi, catatan_metrik_tambahan: e.target.value })} disabled={busy} />
            </label>
            <div><button type="submit" className="btn" disabled={busy}>Simpan Narasi</button></div>
          </form>
        ) : (
          <dl>
            <dt>Yang Bergerak</dt><dd>{detail.catatan?.yang_bergerak ?? '—'}</dd>
            <dt>Yang Tertahan</dt><dd>{detail.catatan?.yang_tertahan ?? '—'}</dd>
            <dt>Fokus Minggu Depan</dt><dd>{detail.catatan?.fokus_minggu_depan ?? '—'}</dd>
            <dt>Bahan untuk Klien</dt><dd>{detail.catatan?.bahan_untuk_klien ?? '—'}</dd>
            <dt>Catatan Metrik Tambahan</dt><dd>{detail.catatan?.catatan_metrik_tambahan ?? '—'}</dd>
          </dl>
        )}
      </section>

      {/* RM-D6 — Catatan divisi (append-only) */}
      <section>
        <h2>Catatan Divisi</h2>
        {detail.catatan_divisi.length === 0 ? (
          <p><em>Belum ada catatan divisi.</em></p>
        ) : (
          <ul>
            {detail.catatan_divisi.map((c) => (
              <li key={c.id}>
                <strong>{c.divisi}</strong> — {c.catatan}{' '}
                <span style={{ fontSize: 12, color: 'var(--muted, #666)' }}>
                  ({c.created_by}, {new Date(c.created_at).toLocaleString('id-ID')})
                </span>
              </li>
            ))}
          </ul>
        )}
        {open && (
          <form onSubmit={addNote} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
            <label>Divisi
              <select value={noteDivisi} onChange={(e) => setNoteDivisi(e.target.value)} disabled={busy}>
                {DIVISIONS.filter((d) => canWriteDivisiNote(role, d)).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label style={{ flex: 1 }}>Catatan
              <input type="text" value={noteText} onChange={(e) => setNoteText(e.target.value)} disabled={busy} />
            </label>
            <button type="submit" className="btn" disabled={busy || noteText.trim() === '' || !canWriteDivisiNote(role, noteDivisi)}>
              Tambah
            </button>
          </form>
        )}
      </section>

      {/* RM-E — Rollup ke Plan (read-only, indikatif) */}
      {rollup && (
        <section>
          <h2>Rollup Periode Plan (indikatif, read-only)</h2>
          <p style={{ fontSize: 13, color: 'var(--muted, #666)' }}>
            {rollup.rekap_count} rekap ditutup pada periode {rollup.plan_id}. Angka resmi tetap di penutupan periode (RM-E).
          </p>
          <ul>
            <li># Video: {rollup.kumulatif.video}</li>
            <li># Creator: {rollup.kumulatif.creator}</li>
            <li># Live: {rollup.kumulatif.live} ({rollup.kumulatif.jam_live} jam)</li>
            <li>GMV Eksekusi (interim): {formatIDR(rollup.kumulatif.gmv_interim)}</li>
            <li>Ad Spend: {formatIDR(rollup.kumulatif.ad_spend)}</li>
            <li>ROAS minggu terakhir: {rollup.roas_terakhir ?? '—'}</li>
          </ul>
        </section>
      )}
    </main>
  );
}

/** RM-C manual fallback: fill `total_view` / `ctr` / `cvr` with a sourced figure
 *  or mark `—` (tidak tersedia). Auto metrics are excluded (dispute, never type). */
function ManualMetrikForm({
  id,
  detail,
  busy,
  run,
}: {
  id: string;
  detail: RecapDetail;
  busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [metrik, setMetrik] = useState(MANUAL_ELIGIBLE_METRICS[0] as string);
  const [nilai, setNilai] = useState('');
  const [fileBukti, setFileBukti] = useState('');
  const [tanggal, setTanggal] = useState('');
  const [unavailable, setUnavailable] = useState(false);

  // A manual-eligible metric that is already `otomatis` cannot be overwritten.
  const autoKeys = new Set(detail.metrik.filter((m) => m.sumber === 'otomatis').map((m) => m.metrik));
  const options = MANUAL_ELIGIBLE_METRICS.filter((k) => !autoKeys.has(k));

  if (options.length === 0) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = unavailable
      ? { nilai: null }
      : { nilai: nilai === '' ? null : Number(nilai), file_bukti: fileBukti, tanggal_ambil: tanggal };
    void run(() => recordRecapMetrikManual(id, metrik, body), 'Metrik manual tersimpan.').then(() => {
      setNilai('');
      setFileBukti('');
      setTanggal('');
      setUnavailable(false);
    });
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
      <label>Metrik manual
        <select value={metrik} onChange={(e) => setMetrik(e.target.value)} disabled={busy}>
          {options.map((k) => <option key={k} value={k}>{getMetrikLabel(k)}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="checkbox" checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} disabled={busy} />
        Tidak tersedia (—)
      </label>
      {!unavailable && (
        <>
          <label>Nilai<input type="number" step="any" value={nilai} onChange={(e) => setNilai(e.target.value)} disabled={busy} /></label>
          <label>File bukti<input type="text" value={fileBukti} onChange={(e) => setFileBukti(e.target.value)} disabled={busy} /></label>
          <label>Tgl ambil<input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} disabled={busy} /></label>
        </>
      )}
      <button type="submit" className="btn" disabled={busy}>Simpan</button>
    </form>
  );
}
