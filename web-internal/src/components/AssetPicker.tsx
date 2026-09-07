'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { listClientApprovedAssets, type ClientAssetOption } from '@/lib/creative';
import { opsiPickerAset, pesanKosongAset } from '@/lib/asset-picker';

/**
 * Picker aset kreatif `[Approved]` untuk halaman kampanye Ads (B-5, ketokan K-3).
 *
 * MENGGANTIKAN dua kolom teks di `/ads/[id]`: "Tautkan Aset" dan "Aset Baru" di
 * form Creative Swap. Kedua kolom itu meminta Advertiser mengetik
 * `AST-202607-0001` DARI INGATAN, dan sampai B-5 tidak ada satu pun cara untuk
 * menemukannya — kebuntuannya berlapis tiga dan ketiganya harus dibuka
 * bersamaan:
 *   (i)   nol endpoint daftar aset per klien       → `GET /clients/{id}/assets`
 *   (ii)  `creative.canSeeAsset` menolak divisi Ads → lengan Ads (baca saja)
 *   (iii) nol picker                                → berkas ini
 * Membuka satu atau dua saja tidak menghasilkan fitur: tanpa (ii) daftarnya
 * kosong, tanpa (i) picker-nya tidak punya isi, tanpa (iii) orangnya tetap
 * mengetik ID.
 *
 * SCOPE-nya BUKAN urusan komponen ini. Ia memanggil endpoint-nya apa adanya;
 * server yang memutuskan siapa boleh membaca (gerbang `canSeeAsset` dievaluasi
 * SEBELUM satu baris aset pun dibaca) dan aset mana yang ditawarkan. Menyaring
 * ulang di sini akan menciptakan aturan kedua yang bisa berbeda dari yang
 * ditegakkan server.
 */
interface Props {
  /** Klien kampanye (`campaign.client_id`). '' ⇒ picker menonaktifkan diri. */
  clientId: string;
  /**
   * Brief Creative sumber kampanye (`briefs.source_creative_brief_id`, K-3).
   * Kosong/undefined ⇒ seluruh aset `[Approved]` milik klien. Fallback itu
   * disengaja: picker yang menyempit lalu diam-diam kosong lebih buruk daripada
   * picker lebar.
   *
   * ⚠️ Kolomnya lahir di Fondasi F (F-4) dan PENGISIANNYA belum mendarat, jadi
   * hari ini pemanggilnya belum meneruskan apa pun ke sini. Prop-nya sudah ada
   * supaya penyambungannya nanti satu baris, bukan pembongkaran komponen.
   */
  sourceBriefId?: string;
  /** ID aset yang sedang dipilih ('' = belum ada). */
  value: string;
  /** Dipanggil saat pilihan berubah — termasuk saat dikosongkan kembali. */
  onChange: (assetId: string) => void;
  /** Label kolom; dipakai juga sebagai `aria-label` select-nya. */
  label?: string;
  /** id `<select>`-nya, supaya `<label htmlFor>` pemanggil tetap benar. */
  id?: string;
  required?: boolean;
  disabled?: boolean;
  /** Aset yang tidak boleh dipilih lagi — mis. yang sudah tertaut ke kampanye. */
  excludeIds?: readonly string[];
}

export default function AssetPicker({
  clientId,
  sourceBriefId,
  value,
  onChange,
  label = 'Aset Kreatif [Approved]',
  id = 'assetPicker',
  required = false,
  disabled = false,
  excludeIds,
}: Props): React.ReactElement {
  const [assets, setAssets] = useState<ClientAssetOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (clientId === '') {
      setAssets([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const res = await listClientApprovedAssets(clientId, sourceBriefId);
      setAssets(res.data);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [clientId, sourceBriefId]);

  useEffect(() => {
    load();
  }, [load]);

  // Yang sudah tertaut dibuang dari OPSI, tapi tidak dari perhitungan "kosong":
  // "semua asetnya sudah tertaut" dan "kliennya belum punya aset selesai" adalah
  // dua keadaan berbeda, dan menyamakannya menyembunyikan yang pertama.
  const excluded = new Set(excludeIds ?? []);
  const offered = assets.filter((a) => !excluded.has(a.id) || a.id === value);

  // Daftar opsinya disusun `lib/asset-picker`, bukan di sini: aturan "nilai yang
  // aktif selalu punya opsi yang cocok" adalah yang gagalnya paling senyap
  // (lihat berkas itu), dan ia harus bisa diuji tanpa merender apa pun.
  const opsi = opsiPickerAset(value, offered, { loading });

  return (
    <div className="field" style={{ minWidth: 320 }}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        aria-label={label}
        value={value}
        required={required}
        disabled={disabled || (loading && offered.length === 0)}
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
          Daftar aset gagal dimuat: {err}
        </span>
      )}
      {!err && !loading && assets.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          {pesanKosongAset({ adaKlien: clientId !== '', adaSourceBrief: !!sourceBriefId })}
        </span>
      )}
      {!err && !loading && assets.length > 0 && offered.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          Semua aset [Approved] klien ini sudah tertaut ke kampanye ini.
        </span>
      )}
    </div>
  );
}
