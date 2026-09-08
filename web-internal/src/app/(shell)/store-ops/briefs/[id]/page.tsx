'use client';

// M18 — detail satu Brief Store Operation: baris SKU-nya, dan aksi keduanya.
//
// ⚠️ HALAMAN INI MERENDER SATU BARIS YANG PUNYA DUA PENULIS.
//
// Kolom cakupan + target milik AM; kolom hasil + dampak milik Store Operation.
// Yang di sini HANYA menyembunyikan tombol yang pasti 403 — dindingnya ada di
// trigger DB (`trg_store_ops_skus_dinding_penulis`), dan itu memang urutan yang
// benar: gerbang UI hanya berlaku untuk jalur yang merendernya, dan jalur kedua
// selalu muncul belakangan.
//
// Angka turunan (actual done, leadtime, % achievement, verdict) dirender apa
// adanya dari server. Jangan menghitungnya di sini — dua implementasi "apakah
// SKU ini on time" akan berbeda begitu salah satunya lupa kalender WIB.

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import StageTimelinePanel from '@/components/StageTimelinePanel';
import StatusBadge from '@/components/StatusBadge';
import RollupBlockerPanel from '@/components/RollupBlockerPanel';
import { getBrief, type Brief } from '@/lib/tasks';
import type { AssignableEmployee } from '@/lib/types';
import {
  DIVISION,
  JENIS_GAMBAR,
  REQUEST_TYPES,
  STATE_DIEVALUASI,
  STATE_DIKERJAKAN,
  STATE_GAGAL_UPLOAD,
  STATE_MENUNGGU,
  STATE_TERUPLOAD,
  assignSkuPic,
  canAssignPic,
  canWriteResult,
  canWriteScope,
  createSku,
  fmtAngka,
  fmtPersen,
  fmtTanggal,
  getBriefSkuSummary,
  isDirector,
  isODOnly,
  isStoreOpsDivision,
  listBriefSkus,
  transitionSku,
  type DampakInput,
  type SkuRow,
  type SkuScopeInput,
  type SkuSummary,
} from '@/lib/storeops';

const KOSONG: SkuScopeInput = {
  nama_produk: '',
  link_sku: null,
  request_type: REQUEST_TYPES[0],
  jenis_gambar: JENIS_GAMBAR[0],
  total_req_picture: 1,
  expected_done: null,
  target_ctr: null,
  target_cvr: null,
  target_rating: null,
  catatan_am: null,
};

/** '' → null: angka target yang kosong berarti TIDAK ADA target, bukan target 0. */
function angka(v: string): number | null {
  return v.trim() === '' ? null : Number(v);
}

export default function StoreOpsBriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  const [brief, setBrief] = useState<Brief | null>(null);
  const [rows, setRows] = useState<SkuRow[] | null>(null);
  const [ringkas, setRingkas] = useState<SkuSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [aksiError, setAksiError] = useState<string | null>(null);
  const [aksiPesan, setAksiPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const [form, setForm] = useState<SkuScopeInput>(KOSONG);
  const [formOpen, setFormOpen] = useState(false);

  const bolehCakupan = canWriteScope(role);
  const bolehHasil = canWriteResult(role);
  const bolehPic = canAssignPic(role);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [b, s] = await Promise.all([getBrief(id), listBriefSkus(id)]);
      setBrief(b);
      setRows(s.data);
      // Ringkasan menyusul: kegagalannya tidak boleh mengosongkan tabel barisnya.
      try {
        setRingkas(await getBriefSkuSummary(id));
      } catch {
        setRingkas(null);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    employees: picCandidates,
    loading: picLoading,
    error: picLoadError,
  } = useAssignableEmployees(DIVISION, LEVEL_STAFF, bolehPic);

  async function jalankan(fn: () => Promise<unknown>, okLabel: string) {
    setAksiError(null);
    setAksiPesan(null);
    setSibuk(true);
    try {
      await fn();
      setAksiPesan(okLabel);
      await load();
    } catch (err) {
      setAksiError(errorMessage(err));
    } finally {
      setSibuk(false);
    }
  }

  async function handleTambah(e: FormEvent) {
    e.preventDefault();
    await jalankan(async () => {
      await createSku(id, form);
      setForm(KOSONG);
      setFormOpen(false);
    }, 'Baris SKU ditambahkan.');
  }

  function handleTransisi(r: SkuRow, to: string, opts: Parameters<typeof transitionSku>[2] = {}) {
    return jalankan(() => transitionSku(r.id, to, { from: r.status, ...opts }), `Baris ${r.id}: ${to}`);
  }

  if (loading) return <div className="muted">Memuat...</div>;
  if (loadError || !brief) {
    return <div className="alert alertError" role="alert">{loadError ?? 'Brief tidak ditemukan.'}</div>;
  }

  const bukanStoreOps = brief.assigned_division !== DIVISION;

  return (
    <div className="stack">
      <header className="pageHeader">
        <h1>{brief.id}</h1>
        <p className="muted">
          {brief.title} &middot; <Link href="/store-ops">kembali ke papan Store Operation</Link>
        </p>
      </header>

      {bukanStoreOps && (
        <div className="alert alertError" role="alert">
          Brief ini milik divisi {brief.assigned_division}, bukan Store Operation — baris SKU
          hanya ada di bawah Brief Store Operation.
        </div>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Ringkasan</h2>
          <StatusBadge status={brief.status} />
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Klien</div>
            <div>{brief.client_nama || '—'} <span className="muted">({brief.client_id || '—'})</span></div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target Kuantitas</div>
            <div>{brief.quantity_target}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Terupload</div>
            {/* K-6 pada tingkat Brief: "selesai" berarti gambar sudah tayang.
                Yang sudah dievaluasi dihitung TERPISAH, bukan digabung — dua
                angka karena mereka menjawab dua pertanyaan berbeda. */}
            <div>{ringkas ? `${ringkas.selesai} dari ${ringkas.total}` : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Sudah dievaluasi</div>
            <div>{ringkas ? `${ringkas.dievaluasi} dari ${ringkas.total}` : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>%Ontime</div>
            <div>{ringkas ? fmtPersen(ringkas.ontime_pct) : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>% SKU Gagal Upload</div>
            {/* Turunan dari JEJAK: baris yang gagal lalu berhasil tetap terhitung. */}
            <div>{ringkas ? fmtPersen(ringkas.gagal_upload_pct) : '—'}</div>
          </div>
        </div>
        <RollupBlockerPanel briefId={id} satuan="baris SKU" refreshKey={rows?.length ?? 0} />
      </section>

      <StageTimelinePanel
        briefId={id}
        assignedDivision={brief.assigned_division}
        canReview={!isODOnly(role) && (isDirector(role) || isStoreOpsDivision(role))}
        isAmOwner={!isODOnly(role) && bolehCakupan}
      />

      <section className="card">
        <div className="cardHeader">
          <h2>Baris SKU ({rows?.length ?? 0})</h2>
          {bolehCakupan && !bukanStoreOps && (
            <button type="button" className="btn" onClick={() => setFormOpen((v) => !v)}>
              {formOpen ? 'Batal' : 'Tambah baris SKU'}
            </button>
          )}
        </div>

        {aksiError && <div className="alert alertError" role="alert">{aksiError}</div>}
        {aksiPesan && <div className="alert alertSuccess" role="status">{aksiPesan}</div>}

        {/* Form cakupan + target — HANYA sisi AM. Store Operation tidak melihatnya
            sama sekali; kalau ia memaksa lewat API, trigger DB yang menolaknya. */}
        {formOpen && bolehCakupan && (
          <form className="stack" onSubmit={handleTambah}>
            <div className="grid2">
              <label>
                Nama Produk
                <input required value={form.nama_produk}
                  onChange={(e) => setForm({ ...form, nama_produk: e.target.value })} />
              </label>
              <label>
                Link SKU
                <input value={form.link_sku ?? ''}
                  onChange={(e) => setForm({ ...form, link_sku: e.target.value || null })} />
              </label>
              <label>
                Jenis Permintaan
                <select value={form.request_type}
                  onChange={(e) => setForm({ ...form, request_type: e.target.value })}>
                  {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label>
                Jenis Gambar
                <select value={form.jenis_gambar}
                  onChange={(e) => setForm({ ...form, jenis_gambar: e.target.value })}>
                  {JENIS_GAMBAR.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label>
                Total Req Picture
                <input type="number" min={1} required value={form.total_req_picture}
                  onChange={(e) => setForm({ ...form, total_req_picture: Number(e.target.value) })} />
              </label>
              <label>
                Expected Done
                <input type="date" value={form.expected_done ?? ''}
                  onChange={(e) => setForm({ ...form, expected_done: e.target.value || null })} />
              </label>
              <label>
                Target CTR (%)
                <input type="number" step="0.01" min={0} value={form.target_ctr ?? ''}
                  onChange={(e) => setForm({ ...form, target_ctr: angka(e.target.value) })} />
              </label>
              <label>
                Target CVR (%)
                <input type="number" step="0.01" min={0} value={form.target_cvr ?? ''}
                  onChange={(e) => setForm({ ...form, target_cvr: angka(e.target.value) })} />
              </label>
              <label>
                Target Rating (0–5)
                <input type="number" step="0.1" min={0} max={5} value={form.target_rating ?? ''}
                  onChange={(e) => setForm({ ...form, target_rating: angka(e.target.value) })} />
              </label>
              <label>
                Catatan AM
                <input value={form.catatan_am ?? ''}
                  onChange={(e) => setForm({ ...form, catatan_am: e.target.value || null })} />
              </label>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Target di atas adalah janji ke klien: setelah Store Operation mulai mengerjakan
              baris ini, ia tidak bisa diubah lagi.
            </div>
            <button type="submit" className="btn btnPrimary" disabled={sibuk}>Simpan baris</button>
          </form>
        )}

        {rows && rows.length === 0 && (
          <div className="muted">
            Belum ada baris SKU. Brief ini tidak akan bergerak sebelum AM memecahnya.
          </div>
        )}

        {rows && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Permintaan</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>PIC</th>
                  <th>Actual Done</th>
                  <th>Leadtime</th>
                  <th>Dampak</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.id}
                      <div className="muted" style={{ fontSize: 12 }}>{r.nama_produk}</div>
                      {r.link_sku && (
                        <a href={r.link_sku} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>link SKU</a>
                      )}
                    </td>
                    <td>
                      {r.request_type}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.jenis_gambar} &middot; {r.total_req_picture} gambar
                      </div>
                    </td>
                    <td>
                      CTR {fmtAngka(r.target_ctr)} &middot; CVR {fmtAngka(r.target_cvr)}
                      <div className="muted" style={{ fontSize: 12 }}>
                        Rating {fmtAngka(r.target_rating)} &middot; due {fmtTanggal(r.expected_done)}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                      {/* "Pernah gagal" adalah fakta permanen, bukan status. Ia tetap
                          terlihat setelah barisnya berhasil pada percobaan kedua. */}
                      {r.pernah_gagal_upload && (
                        <div><span className="badge badge-amber">pernah gagal upload</span></div>
                      )}
                    </td>
                    <td>{r.assigned_pic || '—'}</td>
                    <td>{fmtTanggal(r.actual_done)}</td>
                    <td>{r.leadtime ?? '—'}</td>
                    <td>
                      {fmtPersen(r.achievement_ctr_pct)}
                      <div className="muted" style={{ fontSize: 12 }}>{r.verdict ?? '—'}</div>
                    </td>
                    <td>
                      <AksiBaris
                        row={r}
                        bolehHasil={bolehHasil && !bukanStoreOps}
                        bolehPic={bolehPic && !bukanStoreOps}
                        sibuk={sibuk}
                        picCandidates={picCandidates}
                        picLoading={picLoading}
                        picLoadError={picLoadError}
                        onTransisi={handleTransisi}
                        onAssign={(pic) => jalankan(() => assignSkuPic(r.id, pic), `PIC baris ${r.id} ditetapkan.`)}
                      />
                    </td>
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

/**
 * Aksi satu baris. Yang ditawarkan ditentukan STATUS baris itu, bukan tebakan —
 * dan tombol yang tidak sah tidak dirender sama sekali, supaya tidak ada aksi
 * yang tugasnya cuma menghasilkan 409.
 */
function AksiBaris({
  row, bolehHasil, bolehPic, sibuk, picCandidates, picLoading, picLoadError, onTransisi, onAssign,
}: {
  row: SkuRow;
  bolehHasil: boolean;
  bolehPic: boolean;
  sibuk: boolean;
  picCandidates: AssignableEmployee[] | null;
  picLoading: boolean;
  picLoadError: string | null;
  onTransisi: (r: SkuRow, to: string, opts?: { link_output?: string; catatan_ops?: string; dampak?: DampakInput }) => void;
  onAssign: (picId: string) => void;
}) {
  const [link, setLink] = useState('');
  const [catatan, setCatatan] = useState('');
  const [pic, setPic] = useState('');
  const [dampak, setDampak] = useState<DampakInput>({
    ctr_sebelum: 0, cvr_sebelum: 0, rating_sebelum: 0,
    ctr_sesudah: 0, cvr_sesudah: 0, rating_sesudah: 0,
  });

  return (
    <div className="stack" style={{ minWidth: 220 }}>
      {bolehPic && row.status === STATE_MENUNGGU && (
        <div>
          <EmployeePicker
            employees={picCandidates}
            loading={picLoading}
            error={picLoadError}
            value={pic}
            onChange={setPic}
            label="PIC"
          />
          <button type="button" className="btn btnGhost" disabled={sibuk || pic === ''}
            onClick={() => onAssign(pic)}>Tetapkan PIC</button>
        </div>
      )}

      {bolehHasil && row.status === STATE_MENUNGGU && (
        <button type="button" className="btn" disabled={sibuk}
          onClick={() => onTransisi(row, STATE_DIKERJAKAN)}>Mulai kerjakan</button>
      )}

      {bolehHasil && row.status === STATE_GAGAL_UPLOAD && (
        <button type="button" className="btn" disabled={sibuk}
          onClick={() => onTransisi(row, STATE_DIKERJAKAN)}>Coba upload lagi</button>
      )}

      {bolehHasil && row.status === STATE_DIKERJAKAN && (
        <>
          <input placeholder="Link hasil" value={link} onChange={(e) => setLink(e.target.value)} />
          <button type="button" className="btn btnPrimary" disabled={sibuk}
            onClick={() => onTransisi(row, STATE_TERUPLOAD, { link_output: link })}>
            Tandai terupload
          </button>
          <input placeholder="Alasan gagal upload" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          <button type="button" className="btn btnGhost" disabled={sibuk}
            onClick={() => onTransisi(row, STATE_GAGAL_UPLOAD, { catatan_ops: catatan })}>
            Gagal upload
          </button>
        </>
      )}

      {bolehHasil && row.status === STATE_TERUPLOAD && (
        <>
          {/* K-6: langkah evaluasi, ±30 hari sesudah upload. Ia SENGAJA terpisah
              dari "selesai" — barisnya sudah dihitung selesai produksi di atas. */}
          <div className="muted" style={{ fontSize: 12 }}>Evaluasi (±30 hari sesudah upload)</div>
          <div className="grid2">
            <input type="number" step="0.01" placeholder="CTR sebelum"
              onChange={(e) => setDampak({ ...dampak, ctr_sebelum: Number(e.target.value) })} />
            <input type="number" step="0.01" placeholder="CTR sesudah"
              onChange={(e) => setDampak({ ...dampak, ctr_sesudah: Number(e.target.value) })} />
            <input type="number" step="0.01" placeholder="CVR sebelum"
              onChange={(e) => setDampak({ ...dampak, cvr_sebelum: Number(e.target.value) })} />
            <input type="number" step="0.01" placeholder="CVR sesudah"
              onChange={(e) => setDampak({ ...dampak, cvr_sesudah: Number(e.target.value) })} />
            <input type="number" step="0.1" placeholder="Rating sebelum"
              onChange={(e) => setDampak({ ...dampak, rating_sebelum: Number(e.target.value) })} />
            <input type="number" step="0.1" placeholder="Rating sesudah"
              onChange={(e) => setDampak({ ...dampak, rating_sesudah: Number(e.target.value) })} />
          </div>
          <button type="button" className="btn btnPrimary" disabled={sibuk}
            onClick={() => onTransisi(row, STATE_DIEVALUASI, { dampak })}>Simpan evaluasi</button>
        </>
      )}

      {row.status === STATE_DIEVALUASI && <span className="muted">Selesai</span>}
    </div>
  );
}
