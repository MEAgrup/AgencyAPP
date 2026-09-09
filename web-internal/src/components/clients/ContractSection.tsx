'use client';

/**
 * FS-5 (Feedback tim Sales 2026-09-08 #5) — jendela kontrak di Client Record.
 *
 * Keluhannya: "Buat supaya terlihat masa durasi kontraknya berapa lama. kita
 * kemarin ada perubahan sistem untuk durasi, ini untuk memastikan supaya tidak
 * salah." Perubahan yang dimaksud adalah A-4 / ketokan K-2: sejak itu
 * `sales.close()` yang mencetak baris `contracts`, dengan durasi diturunkan
 * `MAX(master_service_versions.durasi_bulan)` dan boleh di-override Sales
 * dengan alasan wajib. Tim Sales perlu membaca kembali angka yang mereka
 * tetapkan — dan sampai sekarang tidak ada satu layar pun yang menampilkannya.
 *
 * Self-fetching (pola `MilestonesSection` / `RenewalPanel`) supaya galat
 * kontrak tidak pernah mengosongkan seluruh Client Record.
 *
 * Sisa waktunya TURUNAN-SAAT-BACA (aturan rumah #4) — dihitung dari
 * `tanggal_akhir` setiap kali dirender, tidak pernah disimpan.
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  contractWindow,
  labelJenisKontrak,
  listContracts,
  type Contract,
  type ContractState,
} from '@/lib/contract';

function formatTanggal(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

const TONE: Record<ContractState, string> = {
  berjalan: 'badge-green',
  segera: 'badge-amber',
  berakhir: 'badge-red',
  belum_mulai: 'badge-amber',
};

/** Dipakai juga oleh roster `/clients` (FS-5b) — satu badge, satu definisi. */
export function SisaBadge({ mulai, akhir }: { mulai: string; akhir: string }) {
  const w = contractWindow(mulai, akhir);
  const teks =
    w.state === 'berakhir'
      ? `Berakhir ${Math.abs(w.hariTersisa)} hari lalu`
      : w.state === 'belum_mulai'
        ? 'Belum mulai'
        : w.hariTersisa === 0
          ? 'Berakhir hari ini'
          : `${w.hariTersisa} hari lagi`;
  return <span className={`badge ${TONE[w.state]}`}>{teks}</span>;
}

export default function ContractSection({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Contract[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await listContracts(clientId));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="card" id="kontrak">
      <div className="cardHeader">
        <h2>Kontrak</h2>
      </div>

      {error && <div className="alert alertError" role="alert">{error}</div>}

      {rows === null && !error && <p className="muted">Memuat...</p>}

      {rows !== null && rows.length === 0 && (
        <div className="emptyState">
          Belum ada kontrak untuk klien ini.
          {/*
            Bukan '—' diam-diam: `sales.deriveDuration` memang TIDAK mencetak
            kontrak sama sekali bila seluruh layanan yang ditutup berdurasi
            NULL (layanan sekali jadi). "Belum ada" dan "hilang" terlihat sama
            di layar kalau alasannya tidak ditulis.
          */}
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Kontrak lahir saat closing dari layanan yang punya durasi. Klien yang
            hanya membeli layanan sekali jadi memang tidak punya jendela kontrak.
          </div>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Kontrak</th>
                <th>Jenis</th>
                <th>Durasi</th>
                <th>Mulai</th>
                <th>Berakhir</th>
                <th>Sisa</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>
                    {labelJenisKontrak(c.jenis)}
                    {c.contract_sebelumnya_id && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        lanjutan {c.contract_sebelumnya_id}
                      </div>
                    )}
                  </td>
                  <td>{c.durasi_bulan} bulan</td>
                  <td>{formatTanggal(c.tanggal_mulai)}</td>
                  <td>{formatTanggal(c.tanggal_akhir)}</td>
                  <td><SisaBadge mulai={c.tanggal_mulai} akhir={c.tanggal_akhir} /></td>
                  <td>{c.catatan || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
