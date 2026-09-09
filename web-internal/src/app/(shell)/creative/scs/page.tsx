'use client';

/**
 * Antrean SMO & Content Strategist (M19 Gap B).
 *
 * ⚠️ BARIS TANPA KLIEN ADALAH KASUS SAH. Kolom Klien merender
 * &ldquo;Semua klien&rdquo; untuk `client_id === null`, bukan sel kosong: baris
 * `all client` di sheet SMO tidak punya klien, dan itulah seluruh alasan modul
 * ini punya tabelnya sendiri alih-alih menjadi Task M12. Sel kosong terbaca
 * seperti data yang gagal dimuat.
 *
 * ⚠️ SPEED SCORE KATEGORI STANDING BUKAN ANGKA. Halaman ini tidak pernah
 * menghitung persen sendiri &mdash; `speed_score_display` datang dari server dan
 * sudah berbunyi `N/A` untuk Kategori standing. `pct ?? 0` akan merender
 * &ldquo;0%&rdquo;, yaitu pernyataan tentang kecepatan seseorang atas pekerjaan
 * yang tidak pernah di-SLA-kan.
 *
 * Tombol aksi mengikuti gerbang peran yang BERBEDA per langkah: memulai dan
 * submit milik PIC baris itu SAJA (lead pun tidak &mdash; ia akan memalsukan
 * jangkar turnaround), review dan blokir milik lead.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { geserHari, hariIniWib } from '@/lib/dailyops';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import StatusBadge from '@/components/StatusBadge';
import {
  DIVISION,
  STATUSES,
  canManageTask,
  canReviewTask,
  canSeeAllPics,
  canWorkTask,
  createTask,
  deleteTask,
  labelKlien,
  listKategori,
  listTasks,
  transition,
  type KategoriRow,
  type ScsTaskInput,
  type ScsTaskRow,
} from '@/lib/scs';

const KOSONG: ScsTaskInput = {
  tanggal: '', kategori_kode: '', judul: '', client_id: null,
  mendukung_divisi: null, assigned_pic: '', target_qty: 1, catatan: null,
};

/** Divisi yang bisa didukung sebuah baris. Cermin `division_registry`. */
const DIVISI_DIDUKUNG = ['ADS', 'KOL', 'LIVE', 'ACCOUNT', 'STORE_OPS', 'CREATIVE'] as const;

export default function ScsQueuePage() {
  const { role, employee } = useAuth();
  const bolehKelola = canManageTask(role);
  const bolehReview = canReviewTask(role);
  const bolehPilihPic = canSeeAllPics(role);

  const [dari, setDari] = useState(geserHari(hariIniWib(), -7));
  const [sampai, setSampai] = useState(hariIniWib());
  const [fPic, setFPic] = useState('');
  const [fKategori, setFKategori] = useState('');
  const [fStatus, setFStatus] = useState('');

  const [rows, setRows] = useState<ScsTaskRow[]>([]);
  const [kategori, setKategori] = useState<KategoriRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [form, setForm] = useState<ScsTaskInput>({ ...KOSONG, tanggal: hariIniWib() });

  const { employees: picCandidates, loading: picLoading, error: picError } =
    useAssignableEmployees(DIVISION, LEVEL_STAFF, bolehKelola);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listTasks({
        dari, sampai,
        pic: fPic || undefined,
        kategori: fKategori || undefined,
        status: fStatus || undefined,
      });
      setRows(res.tasks);
    } catch (err) {
      setError(errorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dari, sampai, fPic, fKategori, fStatus]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    listKategori()
      .then((r) => setKategori(r.kategori))
      // Picker Kategori yang gagal dimuat TIDAK boleh mematikan seluruh halaman:
      // antrean tetap berguna dibaca walau form tambah tidak bisa dipakai.
      .catch(() => setKategori([]));
  }, []);

  async function simpan(e: FormEvent) {
    e.preventDefault();
    setMenyimpan(true);
    setError(null);
    setSukses(null);
    try {
      await createTask(form);
      setSukses('Tersimpan.');
      setForm({ ...KOSONG, tanggal: form.tanggal, assigned_pic: form.assigned_pic });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMenyimpan(false);
    }
  }

  async function jalankan(id: string, aksi: Parameters<typeof transition>[1], linkHasil?: string) {
    setError(null);
    setSukses(null);
    try {
      await transition(id, aksi, linkHasil);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function submit(id: string) {
    const link = window.prompt('Link hasil kerja (Drive/Sheets/Figma) — wajib:');
    if (link === null) return;
    await jalankan(id, 'submit', link);
  }

  async function hapus(id: string) {
    if (!window.confirm('Cabut baris ini? Hanya baris yang belum dikerjakan bisa dicabut.')) return;
    setError(null);
    setSukses(null);
    try {
      await deleteTask(id);
      setSukses('Dicabut.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function aksiUntuk(r: ScsTaskRow) {
    const milikSaya = canWorkTask(role, employee?.employee_id ?? '', r.assigned_pic);
    const t: { label: string; jalan: () => void }[] = [];
    if (r.status === '[To Do]' && milikSaya) t.push({ label: 'Mulai', jalan: () => jalankan(r.id, 'mulai') });
    if (r.status === '[In Progress]' && milikSaya) t.push({ label: 'Submit', jalan: () => submit(r.id) });
    if (r.status === '[Revision Requested]' && milikSaya) t.push({ label: 'Kerjakan ulang', jalan: () => jalankan(r.id, 'lanjut') });
    if (r.status === '[Submitted]' && bolehReview) {
      t.push({ label: 'Buka review', jalan: () => jalankan(r.id, 'buka_review') });
      t.push({ label: 'Minta revisi', jalan: () => jalankan(r.id, 'minta_revisi') });
    }
    if (r.status === '[In Review]' && bolehReview) {
      t.push({ label: 'Setujui', jalan: () => jalankan(r.id, 'setujui') });
      t.push({ label: 'Minta revisi', jalan: () => jalankan(r.id, 'minta_revisi') });
    }
    if (r.status === '[In Progress]' && bolehReview) t.push({ label: 'Blokir', jalan: () => jalankan(r.id, 'blokir') });
    if (r.status === '[Blocked]' && bolehReview) t.push({ label: 'Buka blokir', jalan: () => jalankan(r.id, 'buka_blokir') });
    if (r.status === '[To Do]' && bolehKelola) t.push({ label: 'Cabut', jalan: () => hapus(r.id) });
    return t;
  }

  return (
    <div className="stack">
      <div>
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
      </div>

      <div>
        <h1>Antrean SMO &amp; Content Strategist</h1>
        <p className="muted">
          Satu baris = satu pekerjaan pada satu hari: Kategori, PIC, jumlah target, dan{' '}
          <em>boleh</em> klien (M19 §13).
        </p>
        <div className="alert" role="note" style={{ background: '#f4f6f8' }}>
          <strong>Baris tanpa klien itu wajar.</strong> Pekerjaan yang berlaku lintas klien
          dicatat sebagai <em>Semua klien</em> &mdash; kosongkan saja kolom klien. Baris seperti
          itu sengaja <strong>tidak</strong> ikut ke angka per-klien mana pun (health score,
          rekap klien, Client Portal).
        </div>
      </div>

      <section className="card">
        <div className="formRow">
          <div className="field">
            <label htmlFor="dari">Dari (WIB)</label>
            <input id="dari" type="date" value={dari} onChange={(e) => setDari(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sampai">Sampai (WIB)</label>
            <input id="sampai" type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </div>
          {bolehPilihPic && (
            <div className="field">
              <label htmlFor="fpic">PIC</label>
              <input
                id="fpic" value={fPic} placeholder="semua"
                onChange={(e) => setFPic(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="fkat">Kategori</label>
            <select id="fkat" value={fKategori} onChange={(e) => setFKategori(e.target.value)}>
              <option value="">semua</option>
              {kategori.map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fstatus">Status</label>
            <select id="fstatus" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">semua</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          <Link href="/creative/scs/rekap">Rekap per PIC</Link>
          {bolehKelola && <> &middot; <Link href="/creative/scs/kategori">Kelola Kategori</Link></>}
        </p>
      </section>

      {error && <div className="alert alertError" role="alert">{error}</div>}
      {sukses && <div className="alert alertSuccess" role="status">{sukses}</div>}

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {!loading && !error && (
          rows.length === 0 ? (
            <div className="emptyState">Tidak ada baris pada rentang ini.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Tanggal</th>
                    <th>Kategori</th>
                    <th>Pekerjaan</th>
                    <th>Klien</th>
                    <th>Mendukung</th>
                    <th>PIC</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.tanggal}</td>
                      <td>
                        {r.kategori_nama}
                        {/* Kategori standing = pekerjaan berulang harian: ia dihitung
                            sebagai VOLUME dan Speed Score-nya N/A. Ditandai di sini
                            supaya pembaca tahu kenapa angkanya beda. */}
                        {r.kategori_is_standing && (
                          <span className="muted" style={{ fontSize: 12 }}> &middot; standing</span>
                        )}
                      </td>
                      <td>{r.judul}</td>
                      <td>
                        {r.client_id === null
                          ? <span className="muted">{labelKlien(r)}</span>
                          : labelKlien(r)}
                      </td>
                      <td>{r.mendukung_divisi ?? '—'}</td>
                      <td>{r.assigned_pic_nama || r.assigned_pic}</td>
                      <td>{r.target_qty}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {aksiUntuk(r).map((a) => (
                            <button
                              key={a.label} type="button"
                              className="btn btnSecondary btnSm" onClick={a.jalan}
                            >
                              {a.label}
                            </button>
                          ))}
                          {r.link_hasil !== '' && (
                            <a className="muted" href={r.link_hasil} target="_blank" rel="noreferrer">
                              hasil
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>

      {bolehKelola && (
        <section className="card">
          <div className="cardHeader"><h2>Tambah baris</h2></div>
          <form className="stack" onSubmit={simpan}>
            <div className="formRow">
              <div className="field">
                <label htmlFor="tanggal">Tanggal</label>
                <input
                  id="tanggal" type="date" required value={form.tanggal}
                  onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="kategori">Kategori</label>
                <select
                  id="kategori" required value={form.kategori_kode}
                  onChange={(e) => setForm({ ...form, kategori_kode: e.target.value })}
                >
                  <option value="">— pilih —</option>
                  {kategori.map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}
                </select>
              </div>
              <EmployeePicker
                id="pic" label="PIC" required
                employees={picCandidates} loading={picLoading} error={picError}
                value={form.assigned_pic}
                onChange={(v) => setForm({ ...form, assigned_pic: v })}
                emptyHint="Belum ada staff Creative aktif."
              />
              <div className="field">
                <label htmlFor="qty">Jumlah target</label>
                <input
                  id="qty" type="number" min={1} required value={form.target_qty}
                  onChange={(e) => setForm({ ...form, target_qty: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="judul">Pekerjaan</label>
              <input
                id="judul" required value={form.judul}
                onChange={(e) => setForm({ ...form, judul: e.target.value })}
              />
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="klien">Klien (CLI-…) &mdash; kosongkan untuk &ldquo;Semua klien&rdquo;</label>
                <input
                  id="klien" value={form.client_id ?? ''}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value || null })}
                />
              </div>
              <div className="field">
                <label htmlFor="dukung">Mendukung divisi</label>
                <select
                  id="dukung" value={form.mendukung_divisi ?? ''}
                  onChange={(e) => setForm({ ...form, mendukung_divisi: e.target.value || null })}
                >
                  <option value="">— tidak ada —</option>
                  {DIVISI_DIDUKUNG.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="catatan">Catatan</label>
              <input
                id="catatan" value={form.catatan ?? ''}
                onChange={(e) => setForm({ ...form, catatan: e.target.value || null })}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={menyimpan}>
                {menyimpan ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
