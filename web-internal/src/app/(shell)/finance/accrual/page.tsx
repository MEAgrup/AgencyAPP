'use client';

/**
 * Pengakuan Pendapatan Bulanan (Gelombang D, D-3).
 *
 * Halaman ini menjawab tiga pertanyaan, dan urutannya sengaja: **berapa
 * pengakuan bulan ini**, **apakah angkanya sudah beku atau masih bergerak**, dan
 * **apa yang bisa dilakukan** (menutup buku, atau mencatat jurnal koreksi atas
 * bulan yang sudah tertutup).
 *
 * Pertanyaan kedua ada di layar sebagai badge, bukan disembunyikan sebagai
 * detail internal: bulan yang tertutup dibaca dari angka yang DIBEKUKAN, bulan
 * yang terbuka dihitung ulang setiap kali dibuka. Dua laporan yang terlihat
 * identik tapi berbeda sumbernya adalah dua hal yang sangat berbeda saat
 * angkanya dipertanyakan — dan pertanyaan *"kenapa angka Maret hari ini beda
 * dari yang saya cetak bulan Maret"* harus bisa dijawab halaman ini sendiri.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import {
  bulanIni,
  catatKoreksi,
  geserBulan,
  getLaporanBulan,
  labelPengakuan,
  labelSumber,
  tutupBulan,
  type LaporanBulan,
} from '@/lib/accrual';
import { useAuth } from '@/lib/auth-context';

/** Dua belas bulan terakhir termasuk bulan berjalan, terbaru dulu. */
function pilihanBulan(): string[] {
  const kini = bulanIni();
  return Array.from({ length: 12 }, (_, i) => geserBulan(kini, -i));
}

export default function AccrualPage() {
  const { role } = useAuth();
  const [bulan, setBulan] = useState(() => geserBulan(bulanIni(), -1));
  const [lap, setLap] = useState<LaporanBulan | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tutupSubmitting, setTutupSubmitting] = useState(false);
  const [tutupError, setTutupError] = useState<string | null>(null);
  const [tutupMessage, setTutupMessage] = useState<string | null>(null);

  const [koreksiTarget, setKoreksiTarget] = useState('');
  const [koreksiNilai, setKoreksiNilai] = useState('');
  const [koreksiAlasan, setKoreksiAlasan] = useState('');
  const [koreksiSubmitting, setKoreksiSubmitting] = useState(false);
  const [koreksiError, setKoreksiError] = useState<string | null>(null);
  const [koreksiMessage, setKoreksiMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setLap(await getLaporanBulan(bulan));
    } catch (err) {
      setLoadError(errorMessage(err));
      setLap(null);
    } finally {
      setLoading(false);
    }
  }, [bulan]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Menutup buku. Tombolnya sengaja bukan satu klik: penutupan membekukan angka
   * bulan itu dan mengunci barisnya di DB — tidak ada jalan kembali, dan pesan
   * konfirmasinya mengatakan itu apa adanya alih-alih "Anda yakin?".
   */
  async function handleTutup() {
    setTutupError(null);
    setTutupMessage(null);
    const ok = window.confirm(
      `Tutup buku bulan ${bulan}?\n\n` +
      'Angka pengakuan bulan ini akan DIBEKUKAN, dan sesudah itu bulan ini ' +
      'TIDAK BISA diubah lagi sama sekali — tidak ada jalan buka kembali. ' +
      'Koreksi hanya bisa dicatat sebagai jurnal koreksi di bulan yang masih berjalan.',
    );
    if (!ok) return;
    setTutupSubmitting(true);
    try {
      await tutupBulan(bulan);
      setTutupMessage(`Buku bulan ${bulan} ditutup. Angkanya sekarang beku.`);
      await load();
    } catch (err) {
      setTutupError(errorMessage(err));
    } finally {
      setTutupSubmitting(false);
    }
  }

  async function handleKoreksi(e: FormEvent) {
    e.preventDefault();
    setKoreksiError(null);
    setKoreksiMessage(null);
    setKoreksiSubmitting(true);
    try {
      await catatKoreksi({
        bulan,
        bulan_dikoreksi: koreksiTarget,
        nilai: koreksiNilai,
        alasan: koreksiAlasan,
      });
      setKoreksiMessage('Jurnal koreksi tercatat.');
      setKoreksiNilai('');
      setKoreksiAlasan('');
      await load();
    } catch (err) {
      setKoreksiError(errorMessage(err));
    } finally {
      setKoreksiSubmitting(false);
    }
  }

  // Cermin `tutupbuku.canTutupBuku` (Head of Finance atau Direktur) dan
  // `tutupbuku.canCatatKoreksi` (Finance segala level atau Direktur). Gerbang
  // sebenarnya ada di server; ini hanya menyembunyikan tombol yang pasti ditolak.
  const bolehTutup = !!role && (role.director || (role.division === 'Finance' && role.level === 'lead'));
  const bolehKoreksi = !!role && (role.director || role.division === 'Finance');
  const sudahTutup = lap?.status === 'Ditutup';
  const bulanBerjalan = bulan === bulanIni();

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <h1>Pengakuan Pendapatan Bulanan</h1>
          <p className="muted">
            Berapa pendapatan yang diakui di satu bulan kalender, per layanan terbeli. Nilainya{' '}
            <strong>BRUTO</strong> — sistem tidak menghitung PPN di jalur ini (ketokan D-4).
          </p>
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="bulan">Bulan</label>
          <select id="bulan" value={bulan} onChange={(e) => setBulan(e.target.value)}>
            {pilihanBulan().map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>

      {loadError && <div className="alert alertError">{loadError}</div>}
      {loading && <p className="muted">Memuat laporan...</p>}

      {lap && !loading && (
        <>
          <section className="card">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`badge badge-${sudahTutup ? 'darkgray' : 'green'}`}>{lap.status}</span>
              <span className={`badge badge-${lap.sumber === 'beku' ? 'darkgray' : 'amber'}`}>
                {labelSumber(lap.sumber)}
              </span>
              {sudahTutup && lap.ditutup_oleh && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Ditutup {lap.ditutup_pada} oleh {lap.ditutup_oleh}
                </span>
              )}
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Diakui bulan ini</div>
                <div>{lap.total_diakui}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Jurnal koreksi (bertanda)</div>
                <div>{lap.total_koreksi}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Total bulan ini</div>
                <div><strong>{lap.total}</strong></div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Jumlah layanan</div>
                <div>{lap.baris.length}</div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="cardHeader">
              <h2>Pengakuan per Layanan</h2>
            </div>
            {lap.baris.length === 0 ? (
              // Aturan kerja #4: halaman kosong WAJIB mengatakan sebabnya.
              // Kalimatnya datang dari server, bukan dikarang di sini.
              <div className="emptyState">{lap.alasan_kosong ?? 'Belum ada data.'}</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Layanan</th>
                      <th>Klien</th>
                      <th>Pengakuan</th>
                      <th>Nilai Bruto</th>
                      <th>Diakui Bulan Ini</th>
                      <th>Versi MSL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lap.baris.map((b) => (
                      <tr key={b.service_id}>
                        <td>{b.nama}</td>
                        <td>{b.client_id}</td>
                        <td>{labelPengakuan(b.pengakuan)}</td>
                        <td>{b.nilai_bruto}</td>
                        <td>{b.nilai_diakui}</td>
                        <td>v{b.master_version_no}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {lap.dikoreksi_oleh.length > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Bulan ini SUDAH DIKOREKSI di bulan lain</h2>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Angka bulan ini <strong>tidak berubah</strong> karena koreksi — itu seluruh guna kunci
                tutup buku. Koreksinya diakui di bulan pencatatannya, dan ditampilkan di sini supaya
                laporan ini tidak terbaca benar padahal sudah diketahui keliru.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Jurnal</th>
                      <th>Diakui di bulan</th>
                      <th>Nilai</th>
                      <th>Alasan</th>
                      <th>Dicatat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lap.dikoreksi_oleh.map((k) => (
                      <tr key={k.id}>
                        <td>{k.id}</td>
                        <td>{k.bulan}</td>
                        <td>{k.nilai}</td>
                        <td>{k.alasan}</td>
                        <td>{k.dicatat_pada} — {k.dicatat_oleh}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {lap.koreksi.length > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Jurnal Koreksi yang MENDARAT di bulan ini</h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Jurnal</th>
                      <th>Mengoreksi bulan</th>
                      <th>Nilai</th>
                      <th>Alasan</th>
                      <th>Dicatat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lap.koreksi.map((k) => (
                      <tr key={k.id}>
                        <td>{k.id}</td>
                        <td>{k.bulan_dikoreksi}</td>
                        <td>{k.nilai}</td>
                        <td>{k.alasan}</td>
                        <td>{k.dicatat_pada} — {k.dicatat_oleh}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {bolehTutup && !sudahTutup && (
            <section className="card">
              <div className="cardHeader">
                <h2>Tutup Buku</h2>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Menutup buku <strong>membekukan</strong> angka bulan ini. Sesudah itu bulan ini{' '}
                <strong>tidak bisa diubah lagi sama sekali</strong> — <strong>tidak ada jalan buka
                kembali</strong>, termasuk lewat database. Koreksi hanya bisa dicatat sebagai jurnal
                koreksi di bulan yang masih berjalan. Buku juga harus ditutup{' '}
                <strong>berurutan</strong>, dan bulan yang belum berakhir tidak bisa ditutup.
              </p>
              {tutupError && <div className="alert alertError">{tutupError}</div>}
              {tutupMessage && <div className="alert alertSuccess">{tutupMessage}</div>}
              <button
                type="button"
                className="btn btnPrimary"
                onClick={handleTutup}
                disabled={tutupSubmitting || bulanBerjalan}
              >
                {tutupSubmitting ? 'Menutup...' : `Tutup Buku ${bulan}`}
              </button>
              {bulanBerjalan && (
                <p className="muted" style={{ fontSize: 12 }}>
                  Bulan berjalan belum berakhir — angkanya masih bertambah setiap hari, jadi ia belum
                  bisa ditutup.
                </p>
              )}
            </section>
          )}

          {bolehKoreksi && !sudahTutup && (
            <section className="card">
              <div className="cardHeader">
                <h2>Catat Jurnal Koreksi</h2>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Satu-satunya jalan memperbaiki bulan yang <strong>sudah ditutup</strong>. Koreksinya
                diakui di <strong>bulan ini ({bulan})</strong>, dan bulan yang dikoreksi tetap menyebut
                angka bekunya. Nilai <strong>bertanda</strong>: tulis negatif (mis. <code>-2500000</code>)
                untuk koreksi turun. Membatalkan sebuah koreksi berarti mencatat koreksi kedua yang
                berlawanan — barisnya tidak bisa dihapus.
              </p>
              {koreksiError && <div className="alert alertError">{koreksiError}</div>}
              {koreksiMessage && <div className="alert alertSuccess">{koreksiMessage}</div>}
              <form onSubmit={handleKoreksi} className="stack">
                <div className="field" style={{ maxWidth: 200 }}>
                  <label htmlFor="koreksi_target">Bulan yang dikoreksi</label>
                  <select
                    id="koreksi_target"
                    value={koreksiTarget}
                    onChange={(e) => setKoreksiTarget(e.target.value)}
                    required
                  >
                    <option value="">— pilih bulan —</option>
                    {pilihanBulan().filter((b) => b < bulan).map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ maxWidth: 240 }}>
                  <label htmlFor="koreksi_nilai">Nilai (bertanda, rupiah)</label>
                  <input
                    id="koreksi_nilai"
                    value={koreksiNilai}
                    onChange={(e) => setKoreksiNilai(e.target.value)}
                    placeholder="-2500000"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="koreksi_alasan">Alasan (wajib)</label>
                  <input
                    id="koreksi_alasan"
                    value={koreksiAlasan}
                    onChange={(e) => setKoreksiAlasan(e.target.value)}
                    placeholder="hold bulan itu baru diinput sekarang"
                    required
                  />
                </div>
                <button type="submit" className="btn btnPrimary" disabled={koreksiSubmitting}>
                  {koreksiSubmitting ? 'Menyimpan...' : 'Catat Jurnal Koreksi'}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
