'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { opsiPicker, type AdsClientRow } from '@/lib/ads-client-picker';

/**
 * Picker klien untuk `/ads/screening` dan `/ads/scanner` (SCR-UI-1).
 *
 * MENGGANTIKAN kolom teks `CLI-YYYYMM-NNNN`. Kolom itu ada bukan karena pilihan
 * desain, melainkan karena sampai 2026-09-06 divisi Ads TIDAK BOLEH me-list
 * klien: gerbang bacanya berbasis kepemilikan Account, jadi daftar apa pun akan
 * kosong dan yang tersisa hanyalah mengetik ID yang harus dicari di halaman
 * lain. Keputusan pemilik + migrasi `20260913010000` membuka daftarnya —
 * dibatasi ke klien ber-layanan Ads AKTIF.
 *
 * SCOPE-nya BUKAN urusan komponen ini. Ia memanggil `GET /clients` apa adanya;
 * baris yang balik sudah disaring RLS sesuai peran pembaca. Menyaring lagi di
 * sini akan menciptakan aturan kedua yang bisa berbeda dari yang ditegakkan DB.
 */
interface Props {
  /** ID klien yang sedang dipilih (`''` = belum ada). */
  value: string;
  /** Dipanggil saat pilihan berubah — termasuk saat dikosongkan kembali. */
  onChange: (clientId: string) => void;
  /** Label kolom; dipakai juga sebagai `aria-label` select-nya. */
  label?: string;
}

export default function AdsClientPicker({ value, onChange, label = 'Klien' }: Props): React.ReactElement {
  const [clients, setClients] = useState<AdsClientRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      // `limit` dinaikkan dari default supaya daftar Ads muat dalam satu halaman;
      // kalau suatu saat tidak cukup, tambahkan paginasi di sini — JANGAN diam-diam
      // memotong daftar, karena klien yang hilang terlihat seperti masalah izin.
      const res = await api.get<{ data: AdsClientRow[] }>('/clients?limit=200');
      setClients(res.data);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Daftar opsinya disusun `lib/ads-client-picker`, bukan di sini: aturan
  // "nilai yang aktif selalu punya opsi yang cocok" adalah yang gagalnya paling
  // senyap (lihat berkas itu), dan ia harus bisa diuji tanpa merender apa pun.
  const opsi = opsiPicker(value, clients, { loading });

  return (
    <div className="field" style={{ minWidth: 280 }}>
      <label htmlFor="adsClientPicker">{label}</label>
      <select
        id="adsClientPicker"
        className="input"
        aria-label={label}
        value={value}
        disabled={loading && clients.length === 0}
        onChange={(e) => onChange(e.target.value)}
      >
        {opsi.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {err && (
        <span className="muted" style={{ fontSize: 12, color: 'var(--danger, #b91c1c)' }}>
          Daftar klien gagal dimuat: {err}
        </span>
      )}
      {!err && !loading && clients.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          Belum ada klien dengan layanan Ads aktif untuk akun ini.
        </span>
      )}
    </div>
  );
}
