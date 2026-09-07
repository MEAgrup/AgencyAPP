'use client';

/**
 * Showcase Klien Terbaik (Gelombang C).
 *
 * DUA HAL YANG HALAMAN INI WAJIB LAKUKAN, dan keduanya keputusan pemilik
 * 2026-09-07 — bukan pilihan desain:
 *
 *  1. **Mengatakan kenapa ia kosong.** C-2 diketok "bangun sekarang" DENGAN
 *     mengetahui halaman ini akan kosong berbulan-bulan (hari itu: 1 laporan
 *     klien, skor 4,5 KRITIS). Tabel kosong tanpa penjelasan akan dibaca tim
 *     sebagai "fiturnya rusak" — kelas kekeliruan yang sama dengan payload `0`
 *     vs `null` yang seluruh Gelombang B dibangun untuk mencegah. Maka:
 *     ambangnya DISEBUT di layar, jumlah laporan yang ada disebut, dan setiap
 *     klien yang belum lolos membawa kalimat sebabnya.
 *
 *  2. **Menampakkan bahwa pandangan Sales disaring izin.** Sales membuka
 *     halaman ini (C-1) tetapi hanya melihat klien ber-izin (C-3). Kalau
 *     penyaringan itu tak terlihat, "Showcase-nya kosong" jadi laporan bug yang
 *     salah alamat — sebabnya bukan performa klien, melainkan izin yang belum
 *     diminta. Penyaringnya server (`domain/showcase.listShowcase`); halaman ini
 *     hanya menyampaikannya.
 *
 * Angka-angkanya read-only sepenuhnya (aturan rumah #4). Satu-satunya aksi di
 * halaman ini adalah mencentang/mencabut izin, dan tombolnya hanya muncul untuk
 * peran yang server izinkan — Sales tidak pernah melihatnya.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/api';
import { formatIDR } from '@/lib/money';
import {
  beriIzinPitch,
  cabutIzinPitch,
  canKelolaIzinPitchUi,
  getShowcase,
  melihatSebagaiSalesUi,
  type ShowcaseKlien,
  type ShowcaseTren,
  type ShowcaseView,
  urlMateriPitch,
} from '@/lib/showcase';

/** Persentase perubahan; `—` saat pangkalnya nol (aturan rumah #7). */
function trenTeks(t: ShowcaseTren): string {
  if (t.delta === null) return '—';
  const pct = t.delta * 100;
  const tanda = pct > 0 ? '+' : '';
  return `${tanda}${pct.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
}

function trenKelas(t: ShowcaseTren): string {
  if (t.delta === null) return 'badge-gray';
  return t.delta > 0 ? 'badge-green' : t.delta < 0 ? 'badge-red' : 'badge-gray';
}

function skorKelas(label: string | null): string {
  if (label === 'SEHAT') return 'badge-green';
  if (label === 'PERLU PERHATIAN') return 'badge-amber';
  if (label === 'KRITIS') return 'badge-red';
  return 'badge-gray';
}

/** Satu baris klien terbaik. */
function BarisKlien({
  k,
  bolehKelolaIzin,
  onBeri,
  onCabut,
  sibuk,
}: {
  k: ShowcaseKlien;
  bolehKelolaIzin: boolean;
  onBeri: (clientId: string) => void;
  onCabut: (clientId: string) => void;
  sibuk: string | null;
}) {
  return (
    <tr>
      <td>
        <strong>{k.toko || k.client_id}</strong>
        <div className="muted" style={{ fontSize: '12px' }}>
          {k.kategori ?? '—'} · {k.platform.join(', ')}
        </div>
      </td>
      <td>
        <span className={`badge ${skorKelas(k.skor_label_terakhir)}`}>
          {k.skor_terakhir.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        </span>
        <div className="muted" style={{ fontSize: '12px' }}>{k.skor_label_terakhir ?? '—'}</div>
      </td>
      <td>
        <span className={`badge ${trenKelas(k.tren_skor)}`}>{trenTeks(k.tren_skor)}</span>
      </td>
      <td>
        {formatIDR(k.tren_gmv.akhir)}
        <div className="muted" style={{ fontSize: '12px' }}>
          dari {formatIDR(k.tren_gmv.awal)} · <span className={`badge ${trenKelas(k.tren_gmv)}`}>{trenTeks(k.tren_gmv)}</span>
        </div>
      </td>
      <td>
        {k.periode_dinilai} periode
        <div className="muted" style={{ fontSize: '12px' }}>{k.periode_mulai} → {k.periode_akhir}</div>
      </td>
      <td>
        {k.berizin ? (
          <span className="badge badge-green" title="Klien mengizinkan angkanya dipakai di materi pitch (C-3)">
            Berizin
          </span>
        ) : (
          <span className="badge badge-gray" title="Belum ada izin — klien ini TIDAK terlihat oleh divisi Sales">
            Belum berizin
          </span>
        )}
      </td>
      {bolehKelolaIzin && (
        <td>
          {k.berizin ? (
            <button
              type="button"
              className="btn btnSecondary btnSm"
              disabled={sibuk === k.client_id}
              onClick={() => onCabut(k.client_id)}
            >
              {sibuk === k.client_id ? 'Memproses…' : 'Cabut izin'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btnPrimary btnSm"
              disabled={sibuk === k.client_id}
              onClick={() => onBeri(k.client_id)}
            >
              {sibuk === k.client_id ? 'Memproses…' : 'Catat izin'}
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

export default function ShowcasePage() {
  const { role, employee } = useAuth();
  const [view, setView] = useState<ShowcaseView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aksiError, setAksiError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setView(await getShowcase());
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    muat();
  }, [muat]);

  const sebagaiSales = melihatSebagaiSalesUi(role);
  // Tombol izin hanya muncul untuk peran yang server izinkan. Read model ini
  // TIDAK membawa `assigned_am_id` per klien (Showcase bukan halaman klien),
  // jadi gerbang UI-nya sengaja longgar di tingkat peran dan SERVER yang
  // menolak klien yang bukan milik AM ini dengan pesan BI-nya. Menyembunyikan
  // tombol adalah kenyamanan; penjagaannya di domain.
  const meId = employee?.employee_id ?? null;
  const bolehKelolaIzin = canKelolaIzinPitchUi(role, meId, meId);

  async function handleBeri(clientId: string) {
    const catatan = window.prompt(
      'Rujukan bukti izin (nomor PKS, subjek email, tanggal percakapan). Boleh dikosongkan:',
      '',
    );
    if (catatan === null) return; // dibatalkan
    setAksiError(null);
    setSibuk(clientId);
    try {
      await beriIzinPitch(clientId, { dokumen_catatan: catatan.trim() === '' ? null : catatan.trim() });
      await muat();
    } catch (err) {
      setAksiError(errorMessage(err));
    } finally {
      setSibuk(null);
    }
  }

  async function handleCabut(clientId: string) {
    const alasan = window.prompt('Alasan pencabutan izin (boleh dikosongkan):', '');
    if (alasan === null) return;
    setAksiError(null);
    setSibuk(clientId);
    try {
      await cabutIzinPitch(clientId, alasan.trim() === '' ? null : alasan.trim());
      await muat();
    } catch (err) {
      setAksiError(errorMessage(err));
    } finally {
      setSibuk(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Showcase Klien Terbaik</h1>
        <p className="muted">
          Klien yang performanya sudah terbukti lintas periode — bahan untuk materi pitch. Angkanya
          dihitung dari laporan klien, tidak pernah diketik (aturan rumah #4).
        </p>
      </div>

      {loading && <p className="muted">Memuat Showcase…</p>}
      {loadError && !loading && <div className="alert alertError" role="alert">{loadError}</div>}

      {!loading && !loadError && view && (
        <>
          {/* Ambangnya DISEBUT di layar — syarat C-4, bukan angka diam-diam. */}
          <section className="card">
            <div className="cardHeader">
              <h2>Ambang yang dipakai</h2>
            </div>
            <p><strong>{view.ambang.kalimat}</strong></p>
            <p className="muted" style={{ fontSize: '12px' }}>{view.ambang.sumber}</p>
            <p className="muted" style={{ fontSize: '12px' }}>
              Ditimbang dari {view.total_klien_ditimbang} klien dan {view.total_laporan} laporan klien
              yang ada di sistem saat ini.
            </p>
          </section>

          {sebagaiSales && (
            <div className="alert alertInfo" role="status">
              Anda melihat versi <strong>divisi Sales</strong>: hanya klien yang sudah memberi izin
              pemakaian angkanya di materi pitch yang ditampilkan.
              {view.disembunyikan_tanpa_izin > 0 && (
                <>
                  {' '}Saat ini <strong>{view.disembunyikan_tanpa_izin}</strong> klien memenuhi ambang
                  tetapi belum berizin — minta Account Manager mencatat izinnya supaya bisa dipakai.
                </>
              )}
            </div>
          )}

          {aksiError && <div className="alert alertError" role="alert">{aksiError}</div>}

          <section className="card">
            <div className="cardHeader">
              <h2>Klien Terbaik ({view.klien.length})</h2>
              <span style={{ display: 'flex', gap: '8px' }}>
                {/* Materi pitch memuat klien BER-IZIN saja — siapa pun yang
                    meng-export. Tombol tetap dirender walau nol berizin: yang
                    dibuka adalah dokumen yang MENGATAKAN kenapa ia kosong,
                    bukan berkas rusak. */}
                <a className="btn btnSecondary btnSm" href={urlMateriPitch(true)}>
                  Unduh materi pitch
                </a>
                {!sebagaiSales && <Link href="/health" className="btn btnSecondary btnSm">Client Health →</Link>}
              </span>
            </div>

            {view.klien.length === 0 ? (
              /* Kalimat jujur saat kosong — syarat C-2 yang pemilik sebut sendiri. */
              <div className="alert alertInfo" role="status">
                <p style={{ marginTop: 0 }}>
                  <strong>Belum ada klien yang memenuhi ambang.</strong>
                </p>
                <p style={{ marginBottom: 0 }}>
                  Ini bukan kesalahan halaman: {view.ambang.kalimat} Saat ini sistem punya{' '}
                  <strong>{view.total_laporan}</strong> laporan klien dari{' '}
                  <strong>{view.total_klien_ditimbang}</strong> klien.
                  {sebagaiSales && view.disembunyikan_tanpa_izin > 0 && (
                    <> Selain itu {view.disembunyikan_tanpa_izin} klien sudah memenuhi ambang tetapi belum berizin.</>
                  )}
                  {!sebagaiSales && ' Halaman ini akan terisi sendiri begitu laporan klien berikutnya masuk.'}
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Klien</th>
                      <th>Skor terakhir</th>
                      <th>Tren skor</th>
                      <th>GMV run-rate</th>
                      <th>Periode dinilai</th>
                      <th>Izin pitch</th>
                      {bolehKelolaIzin && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {view.klien.map((k) => (
                      <BarisKlien
                        key={k.client_id}
                        k={k}
                        bolehKelolaIzin={bolehKelolaIzin}
                        onBeri={handleBeri}
                        onCabut={handleCabut}
                        sibuk={sibuk}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Daftar tersisih TIDAK dikirim ke Sales — server yang memutuskan itu. */}
          {view.tersisih.length > 0 && (
            <section className="card">
              <div className="cardHeader">
                <h2>Belum memenuhi ambang ({view.tersisih.length})</h2>
              </div>
              <p className="muted">
                Sebabnya disebut per klien supaya jelas mana yang butuh laporan diunggah dan mana yang
                memang performanya belum cukup — dua tindakan yang berbeda.
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Klien</th>
                      <th>Periode ber-skor</th>
                      <th>Skor terakhir</th>
                      <th>Sebab</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.tersisih.map((t) => (
                      <tr key={t.client_id}>
                        <td><strong>{t.toko || t.client_id}</strong></td>
                        <td>{t.periode_berskor}</td>
                        <td>
                          {t.skor_terakhir === null
                            ? '—'
                            : t.skor_terakhir.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        </td>
                        <td className="muted">{t.alasan_kalimat}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
