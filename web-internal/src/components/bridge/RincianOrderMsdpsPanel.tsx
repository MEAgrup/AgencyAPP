'use client';

/**
 * Panel "Rincian order MSDPS" di halaman klien (keputusan pemilik 2026-11-05).
 *
 * Menampilkan daftar kerja order Bridge MSDPS yang sudah diterima untuk klien
 * ini — jenis + catatan per baris, hanya-baca dari payload imutabel — dan link
 * Google Drive per layanan bridge. Baris `Live Stream` di CDPS HANYA berupa
 * daftar kerja di Drive: tidak ada brief, sesi vendor (LSS-), atau papan divisi
 * otomatis.
 *
 * Dirender hanya bila klien punya order bridge. Edit link: tombol tampil untuk
 * Account/Director; server (`bridge.setLinkDrive`) yang memutuskan — lead
 * Account, Director, atau AM klien — dan pesannya ditampilkan apa adanya.
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  getRincianOrderKlien,
  JENIS_LIVE_STREAM,
  setLinkDrive,
  type LayananBridge,
  type RincianOrderKlien,
} from '@/lib/bridge';
import PembayaranBadge from '@/components/bridge/PembayaranBadge';
import StatusBadge from '@/components/StatusBadge';

function LinkDriveEditor({
  layanan,
  bolehUbah,
  onSaved,
}: {
  layanan: LayananBridge;
  bolehUbah: boolean;
  onSaved: (v: LayananBridge) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [nilai, setNilai] = useState(layanan.link_drive ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      const res = await setLinkDrive(layanan.service_id, nilai.trim() === '' ? null : nilai.trim());
      onSaved(res);
      setEdit(false);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!edit) {
    return (
      <span className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {layanan.link_drive ? (
          <a href={layanan.link_drive} target="_blank" rel="noopener noreferrer">
            Buka Google Drive
          </a>
        ) : (
          <span className="muted">Belum ada link Drive</span>
        )}
        {bolehUbah && (
          <button type="button" className="btn btnSecondary btnSm" onClick={() => setEdit(true)}>
            {layanan.link_drive ? 'Ubah' : 'Isi link'}
          </button>
        )}
      </span>
    );
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <input
        aria-label={`Link Google Drive ${layanan.name}`}
        value={nilai}
        onChange={(e) => setNilai(e.target.value)}
        placeholder="https://drive.google.com/..."
      />
      {err && (
        <div className="alert alertError" role="alert">
          {err}
        </div>
      )}
      <span className="row" style={{ gap: 6 }}>
        <button type="button" className="btn btnSm" disabled={busy} onClick={simpan}>
          {busy ? 'Menyimpan...' : 'Simpan'}
        </button>
        <button
          type="button"
          className="btn btnSecondary btnSm"
          disabled={busy}
          onClick={() => {
            setEdit(false);
            setNilai(layanan.link_drive ?? '');
            setErr(null);
          }}
        >
          Batal
        </button>
      </span>
    </div>
  );
}

export default function RincianOrderMsdpsPanel({ clientId, bolehUbah }: { clientId: string; bolehUbah: boolean }) {
  const [data, setData] = useState<RincianOrderKlien | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getRincianOrderKlien(clientId));
    } catch {
      // Panel sekunder: gagal memuat tidak boleh mengosongkan halaman klien.
      setData(null);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data || (data.orders.length === 0 && data.services.length === 0)) return null;

  return (
    <section className="card" id="rincian-msdps">
      <div className="cardHeader">
        <h2>Rincian order MSDPS (MEAGO!)</h2>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Daftar kerja yang dikirim MSDPS saat order diteruskan. Live Stream di CDPS hanya berupa
        daftar kerja di Google Drive — tidak membuat brief atau sesi vendor otomatis.
      </p>

      {data.orders.map((o) => (
        <div key={o.order_id} style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <strong>{o.deal_code}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{o.order_id}</span>
            <PembayaranBadge pembayaran={o.pembayaran} />
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Jenis</th>
                  <th>Qty</th>
                  <th>Yang harus dikerjakan</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.jenis}</td>
                    <td>{l.qty ?? '—'}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>
                      {l.catatan ?? '—'}
                      {l.alasan_non_roster && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          Alasan non-roster: {l.alasan_non_roster}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {data.services.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>Link Google Drive per layanan</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Layanan</th>
                  <th>Status</th>
                  <th>Google Drive</th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((v) => (
                  <tr key={v.service_id}>
                    <td>
                      {v.name}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {v.service_id}
                        {v.name.includes(JENIS_LIVE_STREAM) ? ' · daftar kerja di Drive' : ''}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={v.status} />
                    </td>
                    <td>
                      <LinkDriveEditor
                        layanan={v}
                        bolehUbah={bolehUbah}
                        onSaved={(baru) =>
                          setData((d) =>
                            d
                              ? { ...d, services: d.services.map((x) => (x.service_id === baru.service_id ? baru : x)) }
                              : d,
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
