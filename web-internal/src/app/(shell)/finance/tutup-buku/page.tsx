'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  bandingkanVersi,
  bukaBuku,
  catatJurnalKoreksi,
  getPeriode,
  listJurnalKoreksi,
  listPeriode,
  tutupBuku,
  type DetailPeriode,
  type JurnalKoreksi,
  type Periode,
  type SelisihVersi,
} from '@/lib/tutupbuku';
import StatusBadge from '@/components/StatusBadge';

const STATUS_TERTUTUP = '[Tertutup]';

/** Dua belas bulan terakhir yang SUDAH selesai — bulan berjalan tidak bisa ditutup. */
function bulanTerpilihkan(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 1; i <= 12; i += 1) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export default function TutupBukuPage() {
  const [daftar, setDaftar] = useState<Periode[]>([]);
  const [periode, setPeriode] = useState<string>(() => bulanTerpilihkan()[0]);
  const [detail, setDetail] = useState<DetailPeriode | null>(null);
  const [jurnal, setJurnal] = useState<JurnalKoreksi[]>([]);
  const [selisih, setSelisih] = useState<SelisihVersi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aksiError, setAksiError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [alasan, setAlasan] = useState('');
  const [koreksiKe, setKoreksiKe] = useState('');
  const [koreksiKet, setKoreksiKet] = useState('');
  const [koreksiNilai, setKoreksiNilai] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, l, j] = await Promise.all([
        getPeriode(periode),
        listPeriode(),
        listJurnalKoreksi(periode),
      ]);
      setDetail(d.data);
      setDaftar(l.data);
      setJurnal(j.data);
      setSelisih(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [periode]);

  useEffect(() => {
    load();
  }, [load]);

  async function jalankan(fn: () => Promise<unknown>) {
    setAksiError(null);
    setSibuk(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setAksiError(errorMessage(err));
    } finally {
      setSibuk(false);
    }
  }

  const tertutup = detail?.periode?.status === STATUS_TERTUTUP;
  const versi = detail?.versi ?? [];

  return (
    <div className="stack">
      <div>
        <h1>Tutup Buku</h1>
        <p className="muted">
          Mengunci angka satu bulan supaya laporan yang sudah dikirim tetap bisa
          dipertanggungjawabkan. Menutup: Finance lead atau Director. Membuka kembali:
          Director saja.
        </p>
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <label htmlFor="periode">Bulan</label>
        <select id="periode" value={periode} onChange={(e) => setPeriode(e.target.value)}>
          {bulanTerpilihkan().map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        {detail?.periode ? <StatusBadge status={detail.periode.status} /> : <span className="muted">belum pernah ditutup</span>}
      </div>

      {error !== null && <p className="error">{error}</p>}
      {aksiError !== null && <p className="error">{aksiError}</p>}
      {loading && <p className="muted">Memuat…</p>}

      {detail !== null && (
        <>
          <section className="stack">
            <h2>
              Angka {detail.periode?.periode ?? periode}{' '}
              <span className="muted">
                {/* Pertanyaan yang halaman ini WAJIB jawab tanpa ditanya: yang
                    dilihat ini angka terkunci, atau hitungan hari ini yang bisa
                    berbeda besok. */}
                {detail.beku
                  ? `— angka BEKU versi ${detail.versi_ditampilkan}`
                  : '— hitungan hari ini, belum dikunci'}
              </span>
            </h2>
            <p>
              <strong>{detail.angka.total_diakui_idr}</strong> dari{' '}
              {detail.angka.jumlah_layanan} layanan · penghitung{' '}
              <code>{detail.angka.penghitung}</code>
            </p>

            {detail.angka.tidak_terhitung.length > 0 && (
              <div className="warn stack">
                <strong>
                  {detail.angka.tidak_terhitung.length} layanan tidak bisa dihitung — angka di
                  atas lebih kecil dari kenyataan
                </strong>
                <ul>
                  {detail.angka.tidak_terhitung.map((t) => (
                    <li key={t.service_id}>
                      <code>{t.service_id}</code> {t.nama} — {t.sebab}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <table>
              <thead>
                <tr>
                  <th>Layanan</th>
                  <th>Klien</th>
                  <th style={{ textAlign: 'right' }}>Diakui</th>
                </tr>
              </thead>
              <tbody>
                {detail.angka.baris.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      Tidak ada pendapatan yang diakui di bulan ini.
                    </td>
                  </tr>
                ) : (
                  detail.angka.baris.map((b) => (
                    <tr key={b.service_id}>
                      <td>
                        <code>{b.service_id}</code> {b.nama}
                      </td>
                      <td>{b.client_id}</td>
                      <td style={{ textAlign: 'right' }}>{b.jumlah_idr}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="stack">
            <h2>Kunci</h2>
            {!tertutup ? (
              <button type="button" disabled={sibuk} onClick={() => jalankan(() => tutupBuku(periode))}>
                Tutup Buku {periode}
              </button>
            ) : (
              <div className="stack">
                <p className="muted">
                  Ditutup pada versi {detail.periode?.versi_terakhir}. Membuka kembali wajib
                  beralasan dan hanya bisa dilakukan Director.
                </p>
                <input
                  aria-label="Alasan buka kembali"
                  placeholder="Alasan buka kembali (wajib)"
                  value={alasan}
                  onChange={(e) => setAlasan(e.target.value)}
                />
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() => jalankan(() => bukaBuku(periode, alasan))}
                >
                  Buka Kembali
                </button>
              </div>
            )}
          </section>

          {versi.length > 0 && (
            <section className="stack">
              <h2>Versi angka beku</h2>
              <table>
                <thead>
                  <tr>
                    <th>Versi</th>
                    <th>Ditutup oleh</th>
                    <th>Ditutup pada</th>
                  </tr>
                </thead>
                <tbody>
                  {versi.map((v) => (
                    <tr key={v.versi}>
                      <td>{v.versi}</td>
                      <td>{v.ditutup_oleh}</td>
                      <td>{v.ditutup_pada}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {versi.length > 1 && (
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() =>
                    jalankan(async () => {
                      const s = await bandingkanVersi(
                        periode,
                        versi[versi.length - 2].versi,
                        versi[versi.length - 1].versi,
                      );
                      setSelisih(s.data);
                    })
                  }
                >
                  Bandingkan dua versi terakhir
                </button>
              )}
              {selisih !== null && (
                <div className="stack">
                  <p>
                    Selisih v{selisih.versi_sebelum} → v{selisih.versi_sesudah}:{' '}
                    <strong>{selisih.total_selisih_idr}</strong>
                  </p>
                  {selisih.baris.length === 0 ? (
                    <p className="muted">Tidak ada baris yang berubah.</p>
                  ) : (
                    <ul>
                      {selisih.baris.map((b) => (
                        <li key={b.service_id}>
                          <code>{b.service_id}</code> {b.nama}: {b.selisih_idr}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="stack">
            <h2>Jurnal koreksi</h2>
            <p className="muted">
              Bulan tertutup tidak disunting. Koreksinya dicatat di bulan yang masih terbuka,
              menunjuk ke bulan ini.
            </p>
            {tertutup && (
              <div className="stack">
                <input
                  aria-label="Dicatat di bulan"
                  placeholder="Dicatat di bulan (YYYY-MM)"
                  value={koreksiKe}
                  onChange={(e) => setKoreksiKe(e.target.value)}
                />
                <input
                  aria-label="Keterangan koreksi"
                  placeholder="Keterangan (wajib)"
                  value={koreksiKet}
                  onChange={(e) => setKoreksiKet(e.target.value)}
                />
                <input
                  aria-label="Nilai koreksi"
                  placeholder="Nilai (boleh kosong)"
                  value={koreksiNilai}
                  onChange={(e) => setKoreksiNilai(e.target.value)}
                />
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() =>
                    jalankan(() =>
                      catatJurnalKoreksi(
                        periode,
                        koreksiKe,
                        koreksiKet,
                        // Kosong berarti "catatan tanpa nilai" — dikirim null,
                        // BUKAN "0", yang berarti hal lain sama sekali.
                        koreksiNilai.trim() === '' ? null : koreksiNilai.trim(),
                      ),
                    )
                  }
                >
                  Catat Jurnal Koreksi
                </button>
              </div>
            )}
            {jurnal.length === 0 ? (
              <p className="muted">Belum ada jurnal koreksi untuk bulan ini.</p>
            ) : (
              <ul>
                {jurnal.map((j) => (
                  <li key={`${j.dicatat_pada}-${j.dicatat_oleh}`}>
                    <strong>{j.nilai_idr ?? 'tanpa nilai'}</strong> — {j.keterangan} (dicatat di{' '}
                    {j.periode_catat} oleh {j.dicatat_oleh})
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {daftar.length > 0 && (
        <section className="stack">
          <h2>Riwayat bulan</h2>
          <table>
            <thead>
              <tr>
                <th>Bulan</th>
                <th>Status</th>
                <th>Versi</th>
                <th>Alasan buka terakhir</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.periode}>
                  <td>{p.periode}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>{p.versi_terakhir}</td>
                  <td>{p.alasan_buka ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
