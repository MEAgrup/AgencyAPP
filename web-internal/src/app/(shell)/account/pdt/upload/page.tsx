'use client';

/**
 * Upload Data Toko (PDT) — G1-09 sub-langkah 3 (`docs/backlog/PDT_BACKLOG.md`
 * G1-09, `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` Flow A). Satu-satunya jalan
 * nyata untuk AM mengunggah batch PDT — sebelum halaman ini, `preview`/
 * `upload-url`/`batches` (POST) hanya kontrak API tanpa pemanggil FE (bullet
 * 1-5 G1-09 belum menutup gerbang keluar G1: "≥10 klien nyata verified").
 *
 * Flow A langkah 2-6, tiga panggilan berurutan:
 * 1. `siapkanUploadBatchPdt` — gerbang izin + path staging + signed upload URL.
 * 2. Browser PUT ZIP LANGSUNG ke `upload_url` (bukan lewat `api`/route CDPS —
 *    limit keras platform 4,5 MB, Rule 42 paket boleh sampai 50 MB;
 *    `docs/DECISIONS.md` 2026-09-13 G1-09-BODY-BESAR).
 * 3. `previewBatchPdt` dengan `storage_path` yang sama — server mengunduh
 *    balik, mem-parse, mendeteksi modul per berkas; NOL tulis DB (Flow A
 *    langkah 2-5).
 *
 * Tabel hasil deteksi ditampilkan SEBELUM disimpan (bullet 2). AM boleh
 * menimpa modul per berkas dari dropdown `module_options` (bullet 3, SELURUH
 * modul terdaftar — bukan subset). Menekan "Simpan Batch" menjalankan
 * `commitBatchPdt` dengan `storage_path` yang SAMA + override yang dipilih —
 * pipeline dijalankan ULANG di server (`docs/DECISIONS.md` 2026-09-14: commit
 * TIDAK menerima cache hasil preview dari klien), menulis
 * `pdt_upload_batch`/`pdt_file` sungguhan dan menjalankan rekonsiliasi.
 *
 * Riwayat batch (bawah halaman, bullet 4) menampilkan SELURUH batch toko ini
 * — termasuk `ditolak` — dengan status paket (tersedia/kedaluwarsa/legal
 * hold, `pdt.listRiwayatBatchPdt`), supaya batch gagal bisa didiagnosis tanpa
 * upload ulang (Rule 10 error path).
 *
 * **Konfirmasi identitas satu-kali AM** (`G1-09-KONFIRMASI-IDENTITAS`, Rule
 * 2 Shopee/Rule 4 TikTok): batch `identitas_belum_terikat` (toko belum
 * punya `shop_id`/`akun_konten_toko` tersimpan) menampilkan tombol
 * "Konfirmasi Identitas" — baik di hasil commit yang baru saja terjadi
 * maupun di baris riwayat manapun berstatus itu (batch lama yang tertunda).
 * Menekannya mengikat nilai yang diusulkan sistem PERMANEN ke
 * `client_platforms`, lalu SEGERA menjalankan ulang pipeline reparse (G1-11)
 * untuk batch yang sama — AM melihat batch pindah status tanpa menunggu tick
 * harian besok (`konfirmasiIdentitasBatchPdt`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { errorMessage, MAX_PAGE_LIMIT } from '@/lib/api';
import { listClients, type Client, type Platform } from '@/lib/clients';
import {
  commitBatchPdt,
  konfirmasiIdentitasBatchPdt,
  listPlatformPdtKlien,
  type PdtBatchRingkas,
  type PdtCommitBatch,
  type PdtCommitOverrideInput,
  type PdtKonfirmasiIdentitas,
  type PdtPreviewBatch,
  previewBatchPdt,
  riwayatBatchPdt,
  siapkanUploadBatchPdt,
} from '@/lib/pdt';

const STATUS_LABEL: Record<string, string> = {
  verified: 'Terverifikasi',
  parsing: 'Diproses (menunggu berkas lengkap)',
  identitas_belum_terikat: 'Menunggu Konfirmasi Identitas',
  ditolak: 'Ditolak',
  digantikan: 'Digantikan',
};

function statusBadgeClass(status: string): string {
  if (status === 'verified') return 'badge-green';
  if (status === 'ditolak') return 'badge-red';
  if (status === 'identitas_belum_terikat') return 'badge-amber';
  return 'badge-gray';
}

const PAKET_STATUS_LABEL: Record<string, string> = {
  tersedia: 'Tersedia',
  kedaluwarsa: 'Kedaluwarsa (sudah dipurge)',
  legal_hold: 'Legal Hold',
};

function paketBadgeClass(paketStatus: string): string {
  if (paketStatus === 'tersedia') return 'badge-green';
  if (paketStatus === 'legal_hold') return 'badge-amber';
  return 'badge-gray';
}

const BERKAS_STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  perlu_pilih_modul: 'Perlu Pilih Modul',
  gagal: 'Gagal',
  ditolak_pagar: 'Ditolak Pagar',
};

function berkasBadgeClass(status: string): string {
  if (status === 'ok') return 'badge-green';
  if (status === 'perlu_pilih_modul') return 'badge-amber';
  return 'badge-red';
}

const IDENTITAS_LABEL: Record<string, string> = {
  cocok: 'Cocok',
  usulkan_ikat: 'Perlu Konfirmasi (belum terikat)',
  tolak: 'Ditolak',
  tidak_dapat_divalidasi: 'Tidak Dapat Divalidasi',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID');
}

function formatDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('id-ID');
}

/** `reconcile_delta_pct` SUDAH persen (mis. `0.5` = 0,5%), BUKAN fraksi 0-1 — jangan kali 100 lagi (beda dari `formatPercent` pola lain di PDT). */
function formatDeltaPct(v: number | null): string {
  if (v === null) return '—';
  return `${v.toFixed(2)}%`;
}

export default function UploadPdtPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsErr, setClientsErr] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [platformId, setPlatformId] = useState<number | ''>('');

  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<PdtPreviewBatch | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  // nama berkas -> modul_kode dipilih AM (dropdown override, bullet 3). Kosong
  // ('') berarti "biarkan deteksi otomatis" — TIDAK dikirim sebagai override.
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const [commitLoading, setCommitLoading] = useState(false);
  const [commitErr, setCommitErr] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<PdtCommitBatch | null>(null);

  const [riwayat, setRiwayat] = useState<PdtBatchRingkas[]>([]);
  const [riwayatErr, setRiwayatErr] = useState<string | null>(null);
  const [riwayatLoading, setRiwayatLoading] = useState(false);

  // G1-09-KONFIRMASI-IDENTITAS — per-batch (bisa dipicu dari hasil commit yang
  // baru saja terjadi MAUPUN dari baris riwayat manapun berstatus
  // identitas_belum_terikat), jadi loading state di-keyed per batch_id.
  const [konfirmasiLoading, setKonfirmasiLoading] = useState<Record<number, boolean>>({});
  const [konfirmasiErr, setKonfirmasiErr] = useState<string | null>(null);
  const [konfirmasiHasil, setKonfirmasiHasil] = useState<PdtKonfirmasiIdentitas | null>(null);

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

  const selectedClient = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);

  // G1-09-PLATFORM-DARI-DETAIL — platform dibaca dari DETAIL klien, bukan dari
  // baris roster: `ClientListRowWire` sengaja tidak memuat `platforms`, jadi
  // `selectedClient.platforms` adalah `undefined` dan `.filter` di sini dulu
  // mematikan seluruh halaman begitu AM memilih klien (bug kelas O43).
  const [platformOptions, setPlatformOptions] = useState<Platform[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformErr, setPlatformErr] = useState<string | null>(null);

  useEffect(() => {
    if (clientId === '') {
      setPlatformOptions([]);
      setPlatformErr(null);
      return;
    }
    let batal = false;
    setPlatformLoading(true);
    setPlatformErr(null);
    void (async () => {
      try {
        const rows = await listPlatformPdtKlien(clientId);
        if (!batal) setPlatformOptions(rows);
      } catch (e) {
        if (!batal) {
          setPlatformOptions([]);
          setPlatformErr(errorMessage(e));
        }
      } finally {
        if (!batal) setPlatformLoading(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, [clientId]);

  const resetUploadState = useCallback(() => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setStoragePath(null);
    setPreview(null);
    setPreviewErr(null);
    setOverrides({});
    setCommitResult(null);
    setCommitErr(null);
  }, []);

  const loadRiwayat = useCallback(async () => {
    if (platformId === '') {
      setRiwayat([]);
      return;
    }
    setRiwayatLoading(true);
    setRiwayatErr(null);
    try {
      const res = await riwayatBatchPdt(platformId);
      setRiwayat(res);
    } catch (e) {
      setRiwayat([]);
      setRiwayatErr(errorMessage(e));
    } finally {
      setRiwayatLoading(false);
    }
  }, [platformId]);

  useEffect(() => {
    void loadRiwayat();
  }, [loadRiwayat]);

  async function handleUploadPreview() {
    if (platformId === '' || !file) return;
    setPreviewLoading(true);
    setPreviewErr(null);
    setPreview(null);
    setStoragePath(null);
    setOverrides({});
    setCommitResult(null);
    setCommitErr(null);
    try {
      const siap = await siapkanUploadBatchPdt(platformId);
      const putRes = await fetch(siap.upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/zip' },
      });
      if (!putRes.ok) {
        throw new Error('[gagal mengunggah paket ke penyimpanan, coba lagi]');
      }
      const hasil = await previewBatchPdt(platformId, siap.storage_path);
      setStoragePath(siap.storage_path);
      setPreview(hasil);
    } catch (e) {
      setPreviewErr(errorMessage(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleCommit() {
    if (platformId === '' || !storagePath) return;
    const overrideList: PdtCommitOverrideInput[] = Object.entries(overrides)
      .filter(([, kode]) => kode !== '')
      .map(([nama, modul_kode]) => ({ nama, modul_kode }));
    if (!window.confirm('Simpan batch ini? Setelah disimpan, batch akan menjalani rekonsiliasi. Bila batch verified untuk toko dan periode yang sama sudah ada, batch ini akan MENGGANTIKANNYA (batch lama ditandai "Digantikan", bukan dihapus).')) {
      return;
    }
    setCommitLoading(true);
    setCommitErr(null);
    try {
      const hasil = await commitBatchPdt(platformId, storagePath, overrideList);
      setCommitResult(hasil);
      await loadRiwayat();
    } catch (e) {
      setCommitErr(errorMessage(e));
    } finally {
      setCommitLoading(false);
    }
  }

  async function handleKonfirmasiIdentitas(batchId: number, usulan: string | null) {
    const konfirmasi = usulan
      ? `Konfirmasi identitas batch #${batchId}? Nilai "${usulan}" akan terikat PERMANEN ke toko ini — hanya bisa dilakukan sekali.`
      : `Konfirmasi identitas batch #${batchId}? Nilai yang diusulkan sistem akan terikat PERMANEN ke toko ini — hanya bisa dilakukan sekali.`;
    if (!window.confirm(konfirmasi)) return;
    setKonfirmasiLoading((prev) => ({ ...prev, [batchId]: true }));
    setKonfirmasiErr(null);
    try {
      const hasil = await konfirmasiIdentitasBatchPdt(batchId);
      setKonfirmasiHasil(hasil);
      await loadRiwayat();
    } catch (e) {
      setKonfirmasiErr(errorMessage(e));
    } finally {
      setKonfirmasiLoading((prev) => ({ ...prev, [batchId]: false }));
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Upload Data Toko (PDT)</h1>
        <p className="muted">
          Unggah satu paket ZIP (berisi seluruh export platform, nama berkas bebas) untuk satu toko klien dan satu
          periode. Sistem mendeteksi modul per berkas, membaca identitas + periode dari isi berkas (bukan input
          manual), lalu merekonsiliasi sebelum batch dianggap terverifikasi.
        </p>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 280 }}>
            <label htmlFor="pdtUploadClient">Klien</label>
            <select
              id="pdtUploadClient"
              className="input"
              value={clientId}
              disabled={clientsLoading}
              onChange={(e) => {
                setClientId(e.target.value);
                setPlatformId('');
                resetUploadState();
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
            <label htmlFor="pdtUploadPlatform">Toko / Platform</label>
            <select
              id="pdtUploadPlatform"
              className="input"
              value={platformId}
              disabled={!selectedClient || platformLoading || platformOptions.length === 0}
              onChange={(e) => {
                setPlatformId(e.target.value === '' ? '' : Number(e.target.value));
                resetUploadState();
              }}
            >
              <option value="">{platformLoading ? 'memuat toko…' : '— pilih platform —'}</option>
              {platformOptions.map((p) => (
                <option key={p.client_platform_id} value={p.client_platform_id}>
                  {p.platform}
                </option>
              ))}
            </select>
          </div>
        </div>

        {clientsErr && (
          <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>
            {clientsErr}
          </div>
        )}
        {platformErr && (
          <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>
            {platformErr}
          </div>
        )}
        {selectedClient && !platformLoading && !platformErr && platformOptions.length === 0 && (
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
        <div className="emptyState">Pilih klien dan platform toko untuk mengunggah batch.</div>
      ) : (
        <>
          <section className="card">
            <h2>1. Unggah Paket ZIP</h2>
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="pdtUploadFile">Paket ZIP (satu ZIP, nama berkas di dalamnya bebas — maks. 50 MB, 40 entri)</label>
              <input
                id="pdtUploadFile"
                type="file"
                accept=".zip"
                ref={fileInputRef}
                disabled={previewLoading}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <button
              type="button"
              className="btn btnPrimary btnSm"
              disabled={!file || previewLoading}
              style={{ marginTop: 12 }}
              onClick={() => void handleUploadPreview()}
            >
              {previewLoading ? 'Mengunggah & mendeteksi...' : 'Unggah & Pratinjau'}
            </button>
            {previewErr && (
              <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>
                {previewErr}
              </div>
            )}
          </section>

          {preview && (
            <>
              <section className="card">
                <h2>2. Hasil Deteksi (belum disimpan)</h2>
                <p className="muted" style={{ fontSize: 12 }}>
                  Periksa modul yang terdeteksi per berkas. Timpa dari dropdown bila salah — SELURUH modul terdaftar
                  tersedia sebagai pilihan, bukan hanya yang biasa dipakai toko ini.
                </p>
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Berkas</th>
                        <th>Modul Terdeteksi</th>
                        <th>Timpa Modul</th>
                        <th>Status</th>
                        <th>Baris Header</th>
                        <th>Kolom Dipanen</th>
                        <th>Kolom Baru</th>
                        <th>Pesan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.berkas.map((b) => (
                        <tr key={b.nama}>
                          <td>{b.nama}</td>
                          <td>{b.modul_nama ?? '—'}{b.ambiguous && <span className="muted"> (ambigu: {b.matches.join(', ')})</span>}</td>
                          <td>
                            <select
                              className="input"
                              value={overrides[b.nama] ?? ''}
                              disabled={commitLoading}
                              onChange={(e) => setOverrides((prev) => ({ ...prev, [b.nama]: e.target.value }))}
                            >
                              <option value="">— biarkan deteksi otomatis —</option>
                              {preview.module_options.map((m) => (
                                <option key={m.kode} value={m.kode}>
                                  {m.nama_tampilan}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <span className={`badge ${berkasBadgeClass(b.status)}`}>{BERKAS_STATUS_LABEL[b.status] ?? b.status}</span>
                          </td>
                          <td>{b.baris_header ?? '—'}</td>
                          <td>{b.kolom_dipanen}</td>
                          <td>{b.kolom_baru.length > 0 ? b.kolom_baru.join(', ') : '—'}</td>
                          <td>{b.pesan ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card">
                <h2>3. Identitas &amp; Periode</h2>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Identitas Toko</p>
                    <span className={`badge ${preview.identitas.status === 'cocok' ? 'badge-green' : preview.identitas.status === 'tolak' ? 'badge-red' : 'badge-amber'}`}>
                      {IDENTITAS_LABEL[preview.identitas.status] ?? preview.identitas.status}
                    </span>
                    {preview.identitas.usulan && (
                      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                        Diusulkan dari berkas: <strong>{preview.identitas.usulan}</strong> — akan tersimpan permanen setelah batch pertama toko ini disimpan.
                      </p>
                    )}
                    {preview.identitas.pesan && (
                      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{preview.identitas.pesan}</p>
                    )}
                  </div>
                  <div>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Periode</p>
                    {preview.periode === null ? (
                      <p className="muted" style={{ fontSize: 12 }}>Belum bisa dibaca — nol berkas ber-status OK.</p>
                    ) : preview.periode.status === 'ok' ? (
                      <p>{preview.periode.mulai} s/d {preview.periode.selesai}</p>
                    ) : (
                      <p className="muted" style={{ fontSize: 12 }}>{preview.periode.pesan}</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="cardHeader">
                  <h2>4. Simpan Batch</h2>
                  <button type="button" className="btn btnPrimary btnSm" disabled={commitLoading} onClick={() => void handleCommit()}>
                    {commitLoading ? 'Menyimpan...' : 'Simpan Batch'}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Menulis batch sungguhan dan menjalankan rekonsiliasi (Rule 13-16). Gagal rekonsiliasi tetap
                  tersimpan sebagai batch <em>ditolak</em> — bisa didiagnosis di riwayat di bawah tanpa unggah ulang.
                </p>
                {commitErr && (
                  <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>
                    {commitErr}
                  </div>
                )}
                {commitResult && (
                  <div style={{ marginTop: 12 }}>
                    <div className="alert alertInfo" role="status">
                      Batch #{commitResult.batch_id} tersimpan — status{' '}
                      <span className={`badge ${statusBadgeClass(commitResult.status)}`}>
                        {STATUS_LABEL[commitResult.status] ?? commitResult.status}
                      </span>
                      {commitResult.reconcile_delta_pct !== null && (
                        <> — selisih rekonsiliasi {formatDeltaPct(commitResult.reconcile_delta_pct)}</>
                      )}
                    </div>
                    {commitResult.menggantikan_batch_id !== null && (
                      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                        Menggantikan batch #{commitResult.menggantikan_batch_id} — batch lama sekarang ditandai <em>Digantikan</em>, datanya tidak dihapus (Rule 36).
                      </p>
                    )}
                    {commitResult.alasan_ditolak && (
                      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{commitResult.alasan_ditolak}</p>
                    )}
                    {commitResult.status === 'identitas_belum_terikat' && (
                      <div style={{ marginTop: 8 }}>
                        <p className="muted" style={{ fontSize: 12 }}>
                          Identitas toko ini belum pernah terikat — usulan sistem: <strong>{commitResult.identitas.usulan ?? '—'}</strong>.
                          Konfirmasi sekali untuk mengikatnya permanen dan melanjutkan batch ini ke rekonsiliasi.
                        </p>
                        <button
                          type="button"
                          className="btn btnPrimary btnSm"
                          disabled={Boolean(konfirmasiLoading[commitResult.batch_id])}
                          style={{ marginTop: 6 }}
                          onClick={() => void handleKonfirmasiIdentitas(commitResult.batch_id, commitResult.identitas.usulan)}
                        >
                          {konfirmasiLoading[commitResult.batch_id] ? 'Mengonfirmasi...' : 'Konfirmasi Identitas'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {konfirmasiErr && (
                  <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>{konfirmasiErr}</div>
                )}
                {konfirmasiHasil && (
                  <div className="alert alertInfo" role="status" style={{ marginTop: 12 }}>
                    Identitas batch #{konfirmasiHasil.batch_id} terikat: <strong>{konfirmasiHasil.nilai_diikat}</strong>.
                    {konfirmasiHasil.status_setelah_reparse
                      ? <> Batch diproses ulang — status sekarang{' '}
                          <span className={`badge ${statusBadgeClass(konfirmasiHasil.status_setelah_reparse)}`}>
                            {STATUS_LABEL[konfirmasiHasil.status_setelah_reparse] ?? konfirmasiHasil.status_setelah_reparse}
                          </span>.
                        </>
                      : ' Batch belum bisa diproses ulang sekarang (lihat riwayat di bawah) — akan diambil proses harian, atau unggah ulang untuk toko ini.'}
                  </div>
                )}
              </section>
            </>
          )}

          <section className="card">
            <h2>Riwayat Batch Toko Ini</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              Seluruh batch yang pernah diunggah untuk toko ini, termasuk yang ditolak — beserta status paket ZIP
              sumbernya (tersedia/kedaluwarsa/legal hold).
            </p>
            {riwayatErr && (
              <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>{riwayatErr}</div>
            )}
            {riwayatLoading ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Memuat riwayat...</p>
            ) : riwayat.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Belum ada batch untuk toko ini.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Periode</th>
                      <th>Status</th>
                      <th>Selisih Rekon.</th>
                      <th>Status Paket</th>
                      <th>Retensi s/d</th>
                      <th>Diunggah</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riwayat.map((b) => (
                      <tr key={b.id}>
                        <td>{b.id}</td>
                        <td>{b.periode_mulai} s/d {b.periode_selesai}</td>
                        <td>
                          <span className={`badge ${statusBadgeClass(b.status)}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
                          {b.alasan_ditolak && (
                            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{b.alasan_ditolak}</p>
                          )}
                          {b.menggantikan_batch_id !== null && (
                            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Menggantikan #{b.menggantikan_batch_id}</p>
                          )}
                        </td>
                        <td>{formatDeltaPct(b.reconcile_delta_pct)}</td>
                        <td>
                          <span className={`badge ${paketBadgeClass(b.paket_status)}`}>
                            {PAKET_STATUS_LABEL[b.paket_status] ?? b.paket_status}
                          </span>
                        </td>
                        <td>{b.retensi_sampai ? formatDate(b.retensi_sampai) : '—'}</td>
                        <td>{formatDateTime(b.dibuat_pada)} · {b.dibuat_oleh}</td>
                        <td>
                          {b.status === 'identitas_belum_terikat' && (
                            <button
                              type="button"
                              className="btn btnGhost btnSm"
                              disabled={Boolean(konfirmasiLoading[b.id])}
                              onClick={() => void handleKonfirmasiIdentitas(b.id, null)}
                            >
                              {konfirmasiLoading[b.id] ? 'Mengonfirmasi...' : 'Konfirmasi Identitas'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
