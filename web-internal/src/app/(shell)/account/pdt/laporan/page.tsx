'use client';

/**
 * Laporan PDT (Pusat Data Toko) — Flow B langkah 1 (PDT-21 Rule 21).
 *
 * KPI ringkas + skor per toko klien, dibaca lewat `GET /account/pdt/laporan`.
 * v1 SENGAJA sempit (dua dari dua belas seksi mesin laporan lama — lihat
 * docblock `packages/core/src/pdt/laporan.ts`): belum ada kanal/iklan/live/
 * video/produk/afiliasi/dst.
 *
 * Tombol "Kirim ke Klien" (Flow B langkah 4, Rule 22) membekukan snapshot ke
 * `pdt_laporan_kiriman` lewat `POST /account/pdt/laporan/kirim`. Kirim kedua
 * untuk toko+periode yang sama BUKAN error — itu kirim-ulang/revisi (Flow B
 * langkah 5, Rule 23): riwayat kiriman toko ini (`GET /account/pdt/laporan/
 * kiriman`, `pdt.riwayatKirimanPdt`) menentukan apakah periode yang sedang
 * dipilih sudah pernah dikirim — label tombol jadi "Kirim Ulang" (bukan
 * "Kirim ke Klien") kalau sudah, dan tabel "Riwayat Pengiriman" di bawah
 * menampilkan seluruh kiriman toko ini (terbaru dulu, revisi menunjuk
 * kiriman yang digantikannya). Riwayat dimuat SEKALI per toko (bukan
 * per-periode — daftar ini mencakup semua periode sekaligus) dan disegarkan
 * setelah kirim berhasil.
 *
 * Klien+platform dipilih dari daftar (bukan kolom teks bebas): `GET /clients`
 * sudah terbuka untuk Account (RLS `clients_select`), jadi tak ada alasan
 * memaksa AM mengetik ID — beda dari `/ads/screening` yang harus memakai
 * kolom teks karena RLS tidak punya lengan Ads (lihat docblock di sana).
 * Opsi platform disaring ke Shopee/TikTok Shop (PDT-22: Tokopedia/Lazada/
 * Blibli tetap manual) — memilih platform lain hanya akan 400 di server.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage, MAX_PAGE_LIMIT } from '@/lib/api';
import { listClients, type Client } from '@/lib/clients';
import {
  getPdtLaporan,
  kirimLaporanPdt,
  riwayatKirimanPdt,
  type PdtKirimanRingkas,
  type PdtLaporan,
  type PdtLaporanKiriman,
} from '@/lib/pdt';
import { formatIDR } from '@/lib/money';

/** Platform toko yang didukung PDT (PDT-22) — cermin `platformKeVokabPdt`. */
const PDT_PLATFORMS = new Set(['Shopee', 'TikTok Shop']);

function formatPercent(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function formatCount(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('id-ID');
}

function formatBobot(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** `<input type="month">` mengembalikan "YYYY-MM"; route butuh "YYYY-MM-01". */
function monthToPeriode(month: string): string {
  return `${month}-01`;
}

function skorBadgeClass(label: string | null): string {
  if (label === 'SEHAT') return 'badge-green';
  if (label === 'PERLU PERHATIAN') return 'badge-amber';
  if (label === 'KRITIS') return 'badge-red';
  return 'badge-gray';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID');
}

export default function LaporanPdtPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsErr, setClientsErr] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [platformId, setPlatformId] = useState<number | ''>('');
  const [month, setMonth] = useState(currentMonth());

  const [laporan, setLaporan] = useState<PdtLaporan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [kirimLoading, setKirimLoading] = useState(false);
  const [kirimErr, setKirimErr] = useState<string | null>(null);
  const [kirimHasil, setKirimHasil] = useState<PdtLaporanKiriman | null>(null);

  const [riwayat, setRiwayat] = useState<PdtKirimanRingkas[]>([]);
  const [riwayatErr, setRiwayatErr] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsErr(null);
    try {
      const res = await listClients({ limit: MAX_PAGE_LIMIT });
      setClients(res.data);
    } catch (e) {
      setClientsErr(errorMessage(e));
    } finally {
      setClientsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  const platformOptions = useMemo(
    () => (selectedClient ? selectedClient.platforms.filter((p) => p.active && PDT_PLATFORMS.has(p.platform)) : []),
    [selectedClient],
  );

  const loadLaporan = useCallback(async () => {
    // Ganti toko/periode -> hasil kirim sebelumnya (kalau ada) sudah tidak relevan.
    setKirimErr(null);
    setKirimHasil(null);
    if (platformId === '') return;
    setLoading(true);
    setErr(null);
    try {
      const res = await getPdtLaporan(platformId, monthToPeriode(month));
      setLaporan(res);
    } catch (e) {
      setLaporan(null);
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [platformId, month]);

  useEffect(() => {
    void loadLaporan();
  }, [loadLaporan]);

  // Riwayat mencakup SEMUA periode toko ini sekaligus — dimuat sekali per
  // platformId (bukan per-periode seperti loadLaporan), disegarkan lagi
  // setelah kirim berhasil (lihat handleKirim).
  const loadRiwayat = useCallback(async () => {
    if (platformId === '') {
      setRiwayat([]);
      return;
    }
    setRiwayatErr(null);
    try {
      const res = await riwayatKirimanPdt(platformId);
      setRiwayat(res);
    } catch (e) {
      setRiwayat([]);
      setRiwayatErr(errorMessage(e));
    }
  }, [platformId]);

  useEffect(() => {
    void loadRiwayat();
  }, [loadRiwayat]);

  const periodeIni = monthToPeriode(month);
  // Riwayat terurut terbaru dulu — kecocokan PERTAMA untuk periode ini sudah
  // pasti kiriman TERAKHIR (revisi terbaru), bukan sembarang kiriman lama.
  const kirimanTerakhirUntukPeriodeIni = riwayat.find((k) => k.periode_mulai === periodeIni) ?? null;

  async function handleKirim() {
    if (platformId === '' || !laporan) return;
    const platformLabel = laporan.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee';
    const konfirmasi = kirimanTerakhirUntukPeriodeIni
      ? `Kirim ULANG laporan ${platformLabel} periode ${laporan.periode_awal_bulan} ke klien? ` +
        `Ini akan jadi revisi baru — menggantikan kiriman #${kirimanTerakhirUntukPeriodeIni.id} ` +
        `(${formatDateTime(kirimanTerakhirUntukPeriodeIni.dikirim_pada)}), bukan menimpanya. ` +
        'Tidak meminta berkas diunggah ulang.'
      : `Kirim laporan ${platformLabel} periode ${laporan.periode_awal_bulan} ke klien? ` +
        'Snapshot akan dibekukan (tidak bisa diubah) — kirim ulang nanti membuat revisi baru, bukan menimpa.';
    if (!window.confirm(konfirmasi)) return;
    setKirimLoading(true);
    setKirimErr(null);
    try {
      const hasil = await kirimLaporanPdt(platformId, monthToPeriode(month));
      setKirimHasil(hasil);
      await loadRiwayat();
    } catch (e) {
      setKirimErr(errorMessage(e));
    } finally {
      setKirimLoading(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Laporan PDT</h1>
        <p className="muted">
          Pusat Data Toko — KPI ringkas dan skor performa satu toko klien untuk satu bulan, dihitung dari
          data yang sudah diunggah. Belum termasuk pengiriman ke klien.
        </p>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 280 }}>
            <label htmlFor="pdtLaporanClient">Klien</label>
            <select
              id="pdtLaporanClient"
              className="input"
              value={clientId}
              disabled={clientsLoading}
              onChange={(e) => {
                setClientId(e.target.value);
                setPlatformId('');
                setLaporan(null);
                setErr(null);
              }}
            >
              <option value="">— pilih klien —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.toko} ({c.id})
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="pdtLaporanPlatform">Toko / Platform</label>
            <select
              id="pdtLaporanPlatform"
              className="input"
              value={platformId}
              disabled={!selectedClient || platformOptions.length === 0}
              onChange={(e) => {
                setPlatformId(e.target.value === '' ? '' : Number(e.target.value));
                setLaporan(null);
                setErr(null);
              }}
            >
              <option value="">— pilih platform —</option>
              {platformOptions.map((p) => (
                <option key={p.client_platform_id} value={p.client_platform_id}>
                  {p.platform}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="pdtLaporanPeriode">Periode</label>
            <input
              id="pdtLaporanPeriode"
              type="month"
              className="input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        </div>

        {clientsErr && (
          <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>
            {clientsErr}
          </div>
        )}
        {selectedClient && platformOptions.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Klien ini belum punya toko Shopee/TikTok Shop aktif — Tokopedia/Lazada/Blibli tetap manual (PDT-22).
          </p>
        )}
        {selectedClient && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            <Link href={`/clients/${encodeURIComponent(selectedClient.id)}`}>Detail Klien →</Link>
          </p>
        )}
      </section>

      {platformId === '' ? (
        <div className="emptyState">Pilih klien dan platform toko untuk memuat laporan.</div>
      ) : loading ? (
        <div className="pageLoading">Memuat laporan...</div>
      ) : err ? (
        <section className="card">
          <div className="alert alertError" role="alert">{err}</div>
        </section>
      ) : laporan ? (
        <>
          <section className="card">
            <div className="cardHeader">
              <div>
                <h2>KPI Ringkas</h2>
                <p className="muted">
                  {laporan.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee'} · {laporan.periode_awal_bulan}
                </p>
              </div>
              <button type="button" className="btn btnPrimary btnSm" disabled={kirimLoading} onClick={() => void handleKirim()}>
                {kirimLoading ? 'Mengirim...' : kirimanTerakhirUntukPeriodeIni ? 'Kirim Ulang' : 'Kirim ke Klien'}
              </button>
            </div>
            {kirimanTerakhirUntukPeriodeIni && !kirimHasil && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
                Periode ini sudah dikirim ke klien pada {formatDateTime(kirimanTerakhirUntukPeriodeIni.dikirim_pada)}{' '}
                oleh {kirimanTerakhirUntukPeriodeIni.dikirim_oleh}.
              </p>
            )}
            {kirimErr && (
              <div className="alert alertError" role="alert" style={{ marginBottom: 16 }}>{kirimErr}</div>
            )}
            {kirimHasil && (
              <div className="alert alertInfo" role="status" style={{ marginBottom: 16 }}>
                Terkirim ke klien pada {formatDateTime(kirimHasil.dikirim_pada)} oleh {kirimHasil.dikirim_oleh}.
                {kirimHasil.menggantikan_kiriman_id !== null && (
                  <> Revisi — menggantikan kiriman #{kirimHasil.menggantikan_kiriman_id}.</>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatIDR(laporan.kpi.gmv)}</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GMV</p>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatCount(laporan.kpi.pesanan)}</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Pesanan</p>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatCount(laporan.kpi.pengunjung)}</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Pengunjung</p>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatPercent(laporan.kpi.cvr)}</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>CVR</p>
              </div>
            </div>
            {laporan.platform !== 'tiktok' && (
              <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
                GMV Shopee = basis Pesanan Siap Dikirim, TANPA potongan refund (Rule 16) — berbeda dari GMV
                TikTok Shop di atas, yang sudah bersih dari refund (Rule 15). Keduanya tidak boleh dibandingkan
                apa adanya.
              </p>
            )}
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <h2>Skor</h2>
                {laporan.platform === 'tiktok' ? (
                  <p className="muted">Benchmark v{laporan.benchmark_versi ?? '—'}</p>
                ) : (
                  <p className="muted">Shopee belum punya versi benchmark numerik (nol Opens tertutup).</p>
                )}
              </div>
              {laporan.skor.label && (
                <span
                  className={`badge ${skorBadgeClass(laporan.skor.label)}`}
                  style={{ fontSize: 14, padding: '6px 12px' }}
                >
                  {laporan.skor.label}
                </span>
              )}
            </div>
            <div style={{ fontSize: 32, fontWeight: 'bold', marginBottom: 16 }}>
              {laporan.skor.total !== null ? laporan.skor.total.toFixed(1) : '—'}
            </div>

            {laporan.skor.dimensi.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Dimensi</th>
                      <th>Nilai</th>
                      <th>Disertakan</th>
                      <th>Bobot Dasar</th>
                      <th>Bobot Efektif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laporan.skor.dimensi.map((d) => (
                      <tr key={d.kode}>
                        <td>
                          <strong>{d.label}</strong>
                          {d.label_tampil && (
                            <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                              ({d.label_tampil})
                            </span>
                          )}
                        </td>
                        <td>{d.nilai !== null ? d.nilai.toFixed(1) : '—'}</td>
                        <td>{d.disertakan ? '✓' : '—'}</td>
                        <td>{formatBobot(d.bobot_dasar)}</td>
                        <td>{formatBobot(d.bobot_efektif)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Dimensi yang datanya belum ada dikeluarkan dari skor, dan bobot dasar dimensi lain
                  dinormalisasi ulang (Rule 12) — bukan dinilai netral 5/10.
                </p>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Riwayat Pengiriman</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              Seluruh periode toko ini yang pernah dikirim ke klien, terbaru dulu (Flow B langkah 5).
            </p>
            {riwayatErr && (
              <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>{riwayatErr}</div>
            )}
            {riwayat.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Belum ada laporan yang dikirim untuk toko ini.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Periode</th>
                      <th>Dikirim Pada</th>
                      <th>Dikirim Oleh</th>
                      <th>Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riwayat.map((k) => (
                      <tr key={k.id}>
                        <td>{k.periode_mulai}</td>
                        <td>{formatDateTime(k.dikirim_pada)}</td>
                        <td>{k.dikirim_oleh}</td>
                        <td>
                          {k.menggantikan_kiriman_id !== null
                            ? `Revisi — menggantikan #${k.menggantikan_kiriman_id}`
                            : 'Kiriman pertama'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
