'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import {
  getQueue,
  listSchemeChangeQueue,
  type SchemeChangeRequest,
  type Transaction,
} from '@/lib/finance';
import {
  listPermintaanQueue,
  prosesPermintaan,
  selesaiPermintaan,
  tolakPermintaan,
  type Permintaan,
} from '@/lib/permintaan';
import StatusBadge from '@/components/StatusBadge';

export default function FinanceQueuePage() {
  const [trxs, setTrxs] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<SchemeChangeRequest[]>([]);
  // Antrean Permintaan (REQ-) bertujuan Finance — A-2. Panel tersendiri, bukan
  // digabung ke tabel transaksi: entitasnya beda (REQ- vs TRX-), aksinya beda,
  // dan menggabungkannya akan memaksa satu tabel punya kolom yang separuh
  // barisnya selalu kosong.
  const [reqs, setReqs] = useState<Permintaan[]>([]);
  const [reqBusy, setReqBusy] = useState<string | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getQueue();
      setTrxs(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Pending transaction changes (M5-OA-7). Rendered only when there are any —
   * the row scope is the server's (`transaction_change_requests_select`), so
   * this panel is a Director's ACC queue and Finance's own "waiting on the
   * Director" list, without either side needing a different page.
   */
  const loadChanges = useCallback(async () => {
    try {
      const res = await listSchemeChangeQueue();
      setChanges(res.data);
    } catch {
      // Secondary panel: a failure here must not blank the verification queue,
      // which is what this page exists for.
      setChanges([]);
    }
  }, []);

  /**
   * Permintaan bertujuan Finance (M16 §5.5). Keluhan Finance #2: request
   * pembayaran creator "tidak pernah sampai" — dan memang tidak, karena tabel
   * `permintaan`, rutenya, dan klien FE-nya sudah ada sejak
   * `20260831040000_req_permintaan.sql` dengan **NOL importir**. Panel inilah
   * importir pertamanya.
   *
   * Row scope-nya milik server (`permintaan_select` + `req.canProcess`), jadi
   * halaman ini tidak menyaring apa pun sendiri.
   */
  const loadReqs = useCallback(async () => {
    try {
      setReqs(await listPermintaanQueue('Finance'));
    } catch {
      // Panel sekunder: kegagalannya tidak boleh mengosongkan antrean
      // verifikasi, yang jadi alasan halaman ini ada.
      setReqs([]);
    }
  }, []);

  /**
   * Satu pembungkus untuk ketiga aksi. Alasannya bukan penghematan baris: yang
   * gampang salah di panel seperti ini adalah lupa memuat ulang setelah aksi
   * berhasil, sehingga barisnya tetap tampak `[Diajukan]` dan orang menekannya
   * dua kali. Di sini reload-nya ada di SATU tempat, jadi tidak bisa terlewat
   * di salah satu aksi.
   */
  const runReqAction = useCallback(async (id: string, action: () => Promise<unknown>) => {
    setReqBusy(id);
    setReqError(null);
    try {
      await action();
      await loadReqs();
    } catch (err) {
      setReqError(errorMessage(err));
    } finally {
      setReqBusy(null);
    }
  }, [loadReqs]);

  useEffect(() => {
    load();
    loadChanges();
    loadReqs();
  }, [load, loadChanges, loadReqs]);

  return (
    <div className="stack">
      <div>
        <h1>Finance</h1>
        <p className="muted">
          Antrean transaksi yang belum lunas (M5 §8.1) — menunggu verifikasi lebih dulu, lalu yang
          sudah terverifikasi sebagian dan masih punya kekurangan pembayaran.
        </p>
      </div>

      {/* A-2 — Permintaan (REQ-) bertujuan Finance. Ditaruh DI ATAS antrean
          transaksi karena ini kotak masuk yang menunggu aksi Finance, sementara
          tabel di bawah adalah daftar pantauan. Dirender hanya kalau ada
          isinya — panel kosong permanen mengajari orang mengabaikan area itu. */}
      {reqs.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>Permintaan ke Finance — {reqs.length} menunggu</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Diajukan divisi lain lewat Permintaan (REQ-). Jatuh tempo = 1 hari kerja sejak
            diajukan; baris yang terlambat ditandai.
          </p>
          {reqError && <div className="alert alertError" role="alert">{reqError}</div>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Permintaan</th>
                  <th>Jenis</th>
                  <th>Klien</th>
                  <th>Nominal</th>
                  <th>Diajukan oleh</th>
                  <th>Jatuh tempo</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id} className={r.terlambat_berjalan ? 'flaggedRow' : ''}>
                    <td>{r.id}</td>
                    <td>{r.jenis}</td>
                    <td>
                      <Link href={`/clients/${r.client_id}`}>{r.toko || '—'}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{r.client_id}</div>
                    </td>
                    {/* `—`, bukan `Rp. 0`: nol rupiah dan "jenis ini tidak
                        bernominal" bukan hal yang sama. */}
                    <td>{r.nominal ?? '—'}</td>
                    <td>{r.diajukan_oleh_nama || r.diajukan_oleh}</td>
                    <td>
                      {r.due_date}
                      {r.terlambat_berjalan && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          terlambat {r.hari_terlambat} hari
                        </div>
                      )}
                    </td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {/* Aksi mengikuti STATUS barisnya, bukan ditampilkan
                            semua sekaligus: sebuah tombol yang selalu terlihat
                            tapi menjawab 409 mengajari orang bahwa error itu
                            normal. Gerbang sebenarnya tetap di server
                            (`req.canProcess` + mesin status). */}
                        {r.status === '[Diajukan]' && (
                          <button
                            type="button"
                            disabled={reqBusy === r.id}
                            onClick={() => runReqAction(r.id, () => prosesPermintaan(r.id))}
                          >
                            Proses
                          </button>
                        )}
                        {r.status === '[Diproses]' && (
                          <button
                            type="button"
                            disabled={reqBusy === r.id}
                            onClick={() => runReqAction(r.id, () => selesaiPermintaan(r.id))}
                          >
                            Selesai
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={reqBusy === r.id}
                          onClick={() => {
                            // Alasan WAJIB di server (`MSG_REJECT_REASON_REQUIRED`).
                            // Diminta di sini supaya penolakan tidak pernah jadi
                            // satu klik tanpa jejak — dan kalau dikosongkan,
                            // aksinya dibatalkan di sini, bukan dikirim untuk
                            // ditolak server.
                            const alasan = window.prompt(`Alasan menolak ${r.id}:`)?.trim();
                            if (!alasan) return;
                            runReqAction(r.id, () => tolakPermintaan(r.id, alasan));
                          }}
                        >
                          Tolak
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {changes.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>Pengajuan Perubahan Transaksi — menunggu ACC Direktur</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Diajukan SPV/Head Finance (M5-OA-7). Transaksi belum berubah sampai Direktur menyetujui;
            buka transaksinya untuk menyetujui, menolak, atau membatalkan.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pengajuan</th>
                  <th>Transaksi</th>
                  <th>Klien</th>
                  <th>Perubahan</th>
                  <th>Kekurangan</th>
                  <th>Alasan</th>
                  <th>Diajukan</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>
                      <Link href={`/finance/transactions/${r.transaction_id}`}>{r.transaction_id}</Link>
                    </td>
                    <td>{r.toko || r.client_id || '—'}</td>
                    <td>{r.from_scheme || '—'} &rarr; {r.to_scheme}</td>
                    <td>{r.amount_outstanding}</td>
                    <td>{r.reason}</td>
                    <td>
                      {r.requested_by_nama || r.requested_by}
                      {' · '}
                      {new Date(r.created_at).toLocaleDateString('id-ID')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && trxs && trxs.length === 0 && (
          <div className="emptyState">Tidak ada transaksi yang belum lunas.</div>
        )}
        {!loading && !error && trxs && trxs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Transaksi</th>
                  <th>Klien</th>
                  <th>Status</th>
                  <th>Skema</th>
                  <th>Total</th>
                  <th>Terverifikasi</th>
                  <th>Kekurangan</th>
                </tr>
              </thead>
              <tbody>
                {trxs.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/finance/transactions/${t.id}`}>{t.id}</Link>
                    </td>
                    {/* Feedback OD 2026-09-07, keluhan Finance #1: kolom ini
                        dulu HANYA `CLI-…`, dan Finance tidak menghafal id klien —
                        mereka menghafal nama toko. Nama jadi baris pertama (dan
                        pemegang tautannya, karena itu yang dibaca dan diklik
                        orang); id-nya turun jadi baris kedua, tidak dibuang,
                        karena ia tetap yang dipakai saat mencocokkan dengan
                        sistem lain. `—` kalau kosong, bukan sel kosong: sel
                        kosong tidak bisa dibedakan dari kolom yang rusak. */}
                    <td>
                      <Link href={`/clients/${t.client_id}`}>{t.toko || '—'}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{t.client_id}</div>
                    </td>
                    <td><StatusBadge status={t.payment_status} /></td>
                    <td>{t.payment_intent_scheme || '—'}</td>
                    <td>{t.total_agreed_value}</td>
                    <td>{t.amount_verified}</td>
                    <td>{t.amount_outstanding}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
