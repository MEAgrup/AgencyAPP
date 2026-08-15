'use client';

/**
 * Target metrik + laporan mingguan untuk Brief-as-task divisi Ads
 * (keputusan pemilik 2026-08-14 — DECISIONS.md).
 *
 * Laporan pemilik: saat SPV/Lead menetapkan PIC sebuah brief Ads, tak ada satu
 * pun target metrik yang bisa dipilih (ads spent, GMV, ROAS, view, CTR, CVR),
 * dan tak ada tempat bagi Advertiser melaporkan performa + saran perbaikan tiap
 * minggu. Panel ini menutup keduanya di halaman yang sama dengan penetapan PIC.
 *
 * Pembagian peran di sini persis pembagian di server (yang tetap jadi penentu):
 *   * form TARGET hanya dirender untuk SPV/Lead (`canManage`) — M8-OA-4 melarang
 *     Advertiser menetapkan targetnya sendiri;
 *   * form LAPORAN dirender untuk PIC/SPV/Lead — yang mengerjakan yang melapor.
 * Tabel realisasi dibaca siapa pun yang boleh membaca brief-nya.
 *
 * Nol format angka di file ini: setiap `*_display` sudah dibentuk server
 * (Rp. X.XXX.XXX,00, "4x", "1,50%", dan "—" untuk pembagian nol / angka absen),
 * jadi tak ada versi kedua aturan rumah #7 di FE.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import {
  fileAdsWeeklyReport,
  getAdsTargets,
  getAdsWeeklyReports,
  setAdsTargets,
  weekLabel,
  type AdsBriefTargetsView,
  type AdsTargetPayload,
  type AdsWeeklyReportView,
} from '@/lib/ads-targets';

interface Props {
  briefId: string;
  /** SPV/Lead divisi Ads atau Director — boleh menetapkan target. */
  canManage: boolean;
  /** PIC brief ini, SPV/Lead, atau Director — boleh mengisi laporan mingguan. */
  canReport: boolean;
}

const EMPTY_TARGET: AdsTargetPayload = {
  target_spend: '', target_gmv: '', target_roas: '', target_view: '', target_ctr: '', target_cvr: '', catatan: '',
};

/** "" for null so an absent suggestion leaves the input empty, never "null". */
function str(v: number | null): string {
  return v === null || v === undefined ? '' : String(v);
}

export default function AdsTargetPanel({ briefId, canManage, canReport }: Props) {
  const [targets, setTargets] = useState<AdsBriefTargetsView | null>(null);
  const [weekly, setWeekly] = useState<AdsWeeklyReportView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<AdsTargetPayload>(EMPTY_TARGET);
  const [targetSubmitting, setTargetSubmitting] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [targetMessage, setTargetMessage] = useState<string | null>(null);

  const [reportWeek, setReportWeek] = useState('');
  const [analisa, setAnalisa] = useState('');
  const [saran, setSaran] = useState('');
  const [kendala, setKendala] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // Independent reads on the same brief — fire together (P-1).
      const [t, w] = await Promise.all([getAdsTargets(briefId), getAdsWeeklyReports(briefId)]);
      setTargets(t);
      setWeekly(w);
      setForm({
        target_spend: str(t.targets.target_spend), target_gmv: str(t.targets.target_gmv),
        target_roas: str(t.targets.target_roas), target_view: str(t.targets.target_view),
        target_ctr: str(t.targets.target_ctr), target_cvr: str(t.targets.target_cvr),
        catatan: t.targets.catatan,
      });
      // Default the filing form to the oldest week that is still owed, else the
      // running week — the one the Advertiser almost certainly means.
      const owed = w.minggu.find((m) => m.terlambat) ?? w.minggu.find((m) => m.berjalan);
      setReportWeek(owed?.minggu_mulai ?? '');
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [briefId]);

  useEffect(() => {
    load();
  }, [load]);

  function fillFromSuggestion() {
    if (targets === null) return;
    const s = targets.saran;
    setForm((f) => ({
      ...f,
      target_spend: str(s.target_spend), target_gmv: str(s.target_gmv), target_roas: str(s.target_roas),
      target_view: str(s.target_view), target_ctr: str(s.target_ctr), target_cvr: str(s.target_cvr),
    }));
  }

  async function handleSaveTargets(e: FormEvent) {
    e.preventDefault();
    setTargetError(null);
    setTargetMessage(null);
    setTargetSubmitting(true);
    try {
      await setAdsTargets(briefId, form);
      setTargetMessage('Target metrik tersimpan.');
      await load();
    } catch (err) {
      setTargetError(errorMessage(err));
    } finally {
      setTargetSubmitting(false);
    }
  }

  async function handleFileReport(e: FormEvent) {
    e.preventDefault();
    setReportError(null);
    setReportMessage(null);
    setReportSubmitting(true);
    try {
      const r = await fileAdsWeeklyReport(briefId, {
        minggu_mulai: reportWeek, analisa, saran, kendala,
      });
      setReportMessage(`Laporan ${weekLabel(r)} tersimpan.`);
      setAnalisa('');
      setSaran('');
      setKendala('');
      await load();
    } catch (err) {
      setReportError(errorMessage(err));
    } finally {
      setReportSubmitting(false);
    }
  }

  if (loadError !== null) {
    return (
      <section className="card">
        <div className="cardHeader"><h2>Target Metrik Ads</h2></div>
        <div className="alert alertError" role="alert">{loadError}</div>
      </section>
    );
  }
  if (targets === null || weekly === null) {
    return (
      <section className="card">
        <div className="cardHeader"><h2>Target Metrik Ads</h2></div>
        <p className="muted">Memuat...</p>
      </section>
    );
  }

  const t = targets.targets;
  // Weeks that can still be filed: everything not yet reported, newest first, so
  // the running week sits at the top of the picker.
  const fillableWeeks = weekly.minggu.filter((m) => !m.terisi).reverse();

  return (
    <>
      <section className="card">
        <div className="cardHeader">
          <h2>Target Metrik Ads</h2>
        </div>

        {!t.ditetapkan && (
          <div className="alert alertInfo" role="status">
            Target metrik belum ditetapkan untuk brief ini. Selama kosong, kolom Pencapaian di
            laporan mingguan tetap &mdash;. Target ditetapkan SPV/Lead Ads (M8-OA-4), bukan Advertiser.
          </div>
        )}

        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Ads spent (Rp)</div>
            <div>{t.target_spend_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>GMV dari Ads (Rp)</div>
            <div>{t.target_gmv_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>ROAS</div>
            <div>{t.target_roas_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>View / Impresi</div>
            <div>{t.target_view_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>CTR</div>
            <div>{t.target_ctr_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>CVR</div>
            <div>{t.target_cvr_display}</div>
          </div>
        </div>

        {t.catatan !== '' && (
          <p className="muted" style={{ marginTop: 10 }}>Catatan target: {t.catatan}</p>
        )}
        {t.ditetapkan && t.updated_by !== '' && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Ditetapkan oleh {t.updated_by}
            {t.updated_at !== null && <> &middot; {new Date(t.updated_at).toLocaleString('id-ID')}</>}
          </p>
        )}

        {canManage && (
          <form className="form" onSubmit={handleSaveTargets} style={{ marginTop: 14 }}>
            {targetError && <div className="alert alertError" role="alert">{targetError}</div>}
            {targetMessage && <div className="alert alertSuccess" role="status">{targetMessage}</div>}

            <p className="muted" style={{ fontSize: 12 }}>
              Isi minimal satu target. Kosongkan metrik yang memang tidak ditargetkan &mdash;
              kolom kosong dibaca sebagai &ldquo;tanpa target&rdquo;, bukan nol.
              {targets.saran.sumber !== '' && (
                <> Saran dari {targets.saran.sumber}.{' '}
                  <button type="button" className="btn btnSecondary btnSm" onClick={fillFromSuggestion}>
                    Isi dari saran
                  </button>
                </>
              )}
            </p>

            <div className="formRow">
              <div className="field">
                <label htmlFor="target-spend">Ads spent (Rp)</label>
                <input
                  id="target-spend" type="number" min="0" step="1" value={form.target_spend}
                  onChange={(e) => setForm({ ...form, target_spend: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="target-gmv">GMV target (Rp)</label>
                <input
                  id="target-gmv" type="number" min="0" step="1" value={form.target_gmv}
                  onChange={(e) => setForm({ ...form, target_gmv: e.target.value })}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="target-roas">ROAS (x)</label>
                <input
                  id="target-roas" type="number" min="0" step="0.01" value={form.target_roas}
                  onChange={(e) => setForm({ ...form, target_roas: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="target-view">View / Impresi</label>
                <input
                  id="target-view" type="number" min="0" step="1" value={form.target_view}
                  onChange={(e) => setForm({ ...form, target_view: e.target.value })}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="target-ctr">CTR (%, maks 100)</label>
                <input
                  id="target-ctr" type="number" min="0" max="100" step="0.001" value={form.target_ctr}
                  onChange={(e) => setForm({ ...form, target_ctr: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="target-cvr">CVR (%, maks 100)</label>
                <input
                  id="target-cvr" type="number" min="0" max="100" step="0.001" value={form.target_cvr}
                  onChange={(e) => setForm({ ...form, target_cvr: e.target.value })}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="target-catatan">Catatan target (opsional)</label>
                <input
                  id="target-catatan" type="text" value={form.catatan}
                  onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                />
              </div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={targetSubmitting}>
                {targetSubmitting ? 'Menyimpan...' : 'Simpan Target'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Laporan Mingguan Ads</h2>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Realisasi per minggu dihitung ulang dari Metric Entry kampanye brief ini &mdash; tidak
          bisa diketik. Yang diisi Advertiser adalah analisa performa dan saran perbaikan untuk
          minggu berikutnya. Satu laporan per minggu, dan laporan yang sudah dikirim tidak bisa
          diubah.
        </p>

        {weekly.minggu.length === 0 ? (
          <p className="muted">
            Belum ada minggu berjalan &mdash; laporan mingguan dimulai setelah brief masuk
            [In Progress].
          </p>
        ) : (
          <>
            {weekly.belum_diisi > 0 && (
              <div className="alert alertInfo" role="status">
                {weekly.belum_diisi} minggu sudah selesai tetapi belum ada laporannya.
              </div>
            )}
            {weekly.dipotong && (
              <p className="muted" style={{ fontSize: 12 }}>
                Menampilkan 26 minggu terakhir; minggu yang lebih lama tidak ditampilkan.
              </p>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Minggu</th>
                    <th>Metrik</th>
                    <th>Target</th>
                    <th>Realisasi</th>
                    <th>Serapan / Pencapaian</th>
                    <th>Laporan</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weekly.minggu].reverse().map((w) => (
                    w.metrik.map((m, i) => (
                      <tr key={`${w.iso_year}-${w.iso_week}-${m.key}`}>
                        {i === 0 && (
                          <td rowSpan={w.metrik.length}>
                            {weekLabel(w)}
                            {w.berjalan && <div className="muted" style={{ fontSize: 12 }}>berjalan</div>}
                          </td>
                        )}
                        <td>{m.label}</td>
                        <td>{m.target_display}</td>
                        <td>{m.realisasi_display}</td>
                        <td>{m.rasio_display}</td>
                        {i === 0 && (
                          <td rowSpan={w.metrik.length}>
                            {w.terisi ? (
                              <>
                                <div><strong>Analisa:</strong> {w.analisa}</div>
                                <div><strong>Saran:</strong> {w.saran}</div>
                                {w.kendala !== '' && <div><strong>Kendala:</strong> {w.kendala}</div>}
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {w.diisi_oleh}
                                  {w.diisi_pada !== null && <> &middot; {new Date(w.diisi_pada).toLocaleString('id-ID')}</>}
                                </div>
                              </>
                            ) : w.terlambat ? (
                              <span className="badge badge-purple">Belum diisi</span>
                            ) : (
                              <span className="muted">Belum diisi (minggu berjalan)</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {canReport && fillableWeeks.length > 0 && (
          <form className="form" onSubmit={handleFileReport} style={{ marginTop: 14 }}>
            {reportError && <div className="alert alertError" role="alert">{reportError}</div>}
            {reportMessage && <div className="alert alertSuccess" role="status">{reportMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="report-week">Minggu yang dilaporkan</label>
                <select
                  id="report-week"
                  value={reportWeek}
                  onChange={(e) => setReportWeek(e.target.value)}
                >
                  {fillableWeeks.map((w) => (
                    <option key={w.minggu_mulai} value={w.minggu_mulai}>
                      {weekLabel(w)}{w.berjalan ? ' (berjalan)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="report-analisa">Analisa performa minggu ini (wajib)</label>
              <textarea
                id="report-analisa" rows={3} required value={analisa}
                onChange={(e) => setAnalisa(e.target.value)}
                placeholder="Mis. ROAS 4,75x di atas target; spend baru terserap 50% karena listing hero SKU belum siap."
              />
            </div>
            <div className="field">
              <label htmlFor="report-saran">Saran perbaikan untuk minggu depan (wajib)</label>
              <textarea
                id="report-saran" rows={3} required value={saran}
                onChange={(e) => setSaran(e.target.value)}
                placeholder="Mis. naikkan budget kampanye Shopee 20%, matikan ad group dengan CTR terendah, uji hook baru."
              />
            </div>
            <div className="field">
              <label htmlFor="report-kendala">Kendala (opsional)</label>
              <textarea
                id="report-kendala" rows={2} value={kendala}
                onChange={(e) => setKendala(e.target.value)}
              />
            </div>
            <div className="formRow">
              <button type="submit" className="btn btnPrimary btnSm" disabled={reportSubmitting}>
                {reportSubmitting ? 'Mengirim...' : 'Kirim Laporan Mingguan'}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
