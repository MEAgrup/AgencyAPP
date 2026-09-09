'use client';

/**
 * Jadwal Produksi Harian (M19 Gap A / D1) — artefak inti modul ini.
 *
 * Ini layar yang menggantikan pekerjaan yang hari ini dilakukan dengan tangan
 * setiap hari: grid hari x studio, dengan target vs aktual vs sisa terbaca per
 * slot. Jadwal BESOK disusun HARI INI, jadi date picker default-nya hari ini
 * tapi tombol "Besok" ada dan dekat.
 *
 * ⚠️ SIMPAN BISA BERHASIL SAMBIL MEMPERINGATKAN (D3/D4). Konflik studio dan PIC
 * yang tidak tersedia menjawab 201/200 dengan `peringatan`, BUKAN 4xx — jadi
 * halaman ini menampilkannya sebagai peringatan SESUDAH sukses, bukan sebagai
 * galat. Memperlakukannya sebagai galat akan membuat Leader percaya jadwalnya
 * tidak tersimpan padahal tersimpan.
 *
 * Slot yang bertumpang KEDUANYA dirender (tumpang-tindih diizinkan, jadi harus
 * terbaca), ditandai dari `bentrok_ids` yang datang dari server — halaman ini
 * tidak menghitung tumpang-tindih sendiri.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  DIVISION,
  TASK_TYPES,
  canEnterActual,
  canManageSlot,
  createSlot,
  enterActual,
  fmtPersen,
  fmtQty,
  geserHari,
  getDaySchedule,
  hariIniWib,
  listStudios,
  type DaySchedule,
  type SlotInput,
  type StudioRow,
} from '@/lib/dailyops';

const KOSONG: SlotInput = {
  tanggal: '', client_id: '', studio_code: '', waktu_mulai: '09:00', waktu_selesai: '12:00',
  assigned_pic: '', jenis_paket: null, task_type: 'Shoot', target_qty: 1, notes: null,
};

export default function JadwalProduksiPage() {
  const { employee, role } = useAuth();
  const bolehKelola = canManageSlot(role);

  const [tanggal, setTanggal] = useState(hariIniWib());
  const [hari, setHari] = useState<DaySchedule | null>(null);
  const [studios, setStudios] = useState<StudioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peringatan, setPeringatan] = useState<string[]>([]);
  const [sukses, setSukses] = useState<string | null>(null);
  const [form, setForm] = useState<SlotInput>(KOSONG);
  const [menyimpan, setMenyimpan] = useState(false);

  const { employees: picCandidates, loading: picLoading, error: picError } =
    useAssignableEmployees(DIVISION, LEVEL_STAFF, bolehKelola);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHari(await getDaySchedule(tanggal));
    } catch (err) {
      setError(errorMessage(err));
      setHari(null);
    } finally {
      setLoading(false);
    }
  }, [tanggal]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    listStudios().then((r) => setStudios(r.data)).catch(() => setStudios([]));
  }, []);

  /** PIC yang tidak tersedia hari ini — dilihat SAAT merencanakan, bukan sesudah. */
  const tidakTersediaNama = useMemo(
    () => (hari?.tidak_tersedia ?? []).map((u) => `${u.employee_nama || u.employee_id} (${u.alasan})`),
    [hari],
  );

  async function simpan(e: FormEvent) {
    e.preventDefault();
    setMenyimpan(true);
    setError(null);
    setPeringatan([]);
    setSukses(null);
    try {
      const res = await createSlot({ ...form, tanggal });
      // Sukses DULU, peringatan sesudahnya — urutan ini yang membedakan
      // "tersimpan dengan catatan" dari "gagal".
      setSukses(`Slot ${res.slot.id} tersimpan.`);
      setPeringatan(res.peringatan);
      setForm({ ...KOSONG, studio_code: form.studio_code });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMenyimpan(false);
    }
  }

  async function tutupSlot(id: string, target: number) {
    const jawab = window.prompt(`Jumlah yang BENAR-BENAR selesai di sesi ini (maks ${target}):`);
    if (jawab === null) return;
    setError(null);
    setSukses(null);
    try {
      await enterActual(id, Number(jawab));
      setSukses(`Slot ${id} ditutup.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <div>
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
      </div>

      <div>
        <h1>Jadwal Produksi Harian</h1>
        <p className="muted">
          Grid hari &times; studio (M19 §5.1). Rencana &mdash; <strong>bukan</strong> deliverable:
          eksekusi dan review tetap di Asset (M7). Konflik studio dan PIC yang tidak tersedia
          <strong> memperingatkan, tidak memblokir</strong>.
        </p>
      </div>

      <section className="card">
        <div className="formRow">
          <div className="field">
            <label htmlFor="tanggal">Tanggal (WIB)</label>
            <input id="tanggal" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <button type="button" className="btn btnSecondary btnSm" onClick={() => setTanggal(geserHari(tanggal, -1))}>
              &larr; Hari sebelumnya
            </button>
            <button type="button" className="btn btnSecondary btnSm" onClick={() => setTanggal(hariIniWib())}>
              Hari ini
            </button>
            {/* Jadwal besok disusun hari ini — tombolnya harus sedekat "Hari ini". */}
            <button type="button" className="btn btnSecondary btnSm" onClick={() => setTanggal(geserHari(tanggal, 1))}>
              Besok &rarr;
            </button>
          </div>
        </div>

        {hari && (
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Total target</div>
              <div>{hari.total_target}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Total aktual (slot yang sudah ditutup)</div>
              <div>{hari.total_actual}</div>
            </div>
            <div style={{ flex: '1 1 240px' }}>
              <div className="muted" style={{ fontSize: 12 }}>Tidak tersedia hari ini</div>
              <div>{tidakTersediaNama.length === 0 ? '—' : tidakTersediaNama.join(', ')}</div>
            </div>
          </div>
        )}
      </section>

      {error && <div className="alert alertError" role="alert">{error}</div>}
      {sukses && <div className="alert alertSuccess" role="status">{sukses}</div>}
      {peringatan.length > 0 && (
        // Peringatan, bukan galat: barisnya SUDAH tersimpan.
        <div className="alert" role="status" style={{ background: '#fff7e6', borderColor: '#e0a800' }}>
          <strong>Tersimpan, dengan catatan:</strong>
          <ul style={{ margin: '6px 0 0 18px' }}>
            {peringatan.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {!loading && hari && (
          <div
            style={{
              display: 'grid',
              // Kolom auto-fit: di layar sempit ia jatuh jadi satu kolom
              // per studio, bertumpuk — bukan grid yang menggulir horizontal.
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {hari.studios.map((kol) => (
              <div key={kol.code} style={{ minWidth: 0 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong>{kol.nama}</strong>
                  {!kol.cek_konflik && (
                    <span className="badge badge-darkgray" title="Lokasi luar kantor: tumpang-tindih tidak diperiksa">
                      tanpa cek konflik
                    </span>
                  )}
                </div>
                {/* Kolom kosong TETAP dirender: "ruangan itu bebas" adalah
                    informasi, dan menyembunyikannya justru saat Leader mencari
                    tempat adalah kehilangan gunanya. */}
                {kol.slots.length === 0 ? (
                  <div className="emptyState" style={{ padding: 12, fontSize: 13 }}>Bebas</div>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    {kol.slots.map((s) => {
                      const bentrok = kol.bentrok_ids.includes(s.id);
                      return (
                        <div
                          key={s.id}
                          className="card"
                          style={{
                            padding: 10,
                            borderLeft: bentrok ? '4px solid #e0a800' : undefined,
                          }}
                        >
                          <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                            <strong style={{ fontSize: 13 }}>{s.waktu_mulai}&ndash;{s.waktu_selesai}</strong>
                            <span className="badge badge-blue">{s.task_type}</span>
                          </div>
                          <div style={{ fontSize: 13, marginTop: 4 }}>{s.client_name || s.client_id}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {s.assigned_pic_nama || s.assigned_pic}
                            {s.jenis_paket ? ` · ${s.jenis_paket}` : ''}
                          </div>
                          <div style={{ fontSize: 12, marginTop: 6 }}>
                            target <strong>{s.target_qty}</strong>
                            {' · '}aktual <strong>{fmtQty(s.actual_qty)}</strong>
                            {' · '}sisa <strong>{fmtQty(s.sisa_qty)}</strong>
                            {' · '}{fmtPersen(s.penyelesaian_pct)}
                          </div>
                          {bentrok && (
                            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                              bertumpang dengan slot lain di studio ini
                            </div>
                          )}
                          {s.actual_qty === null
                            && canEnterActual(role, employee?.employee_id ?? '', s.assigned_pic) && (
                            <button
                              type="button"
                              className="btn btnSecondary btnSm"
                              style={{ marginTop: 8 }}
                              onClick={() => tutupSlot(s.id, s.target_qty)}
                            >
                              Tutup slot
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {bolehKelola && (
        <section className="card">
          <div className="cardHeader"><h2>Tambah slot &mdash; {tanggal}</h2></div>
          <form className="stack" onSubmit={simpan}>
            <div className="formRow">
              <div className="field">
                <label htmlFor="client">Klien (CLI-…)</label>
                <input
                  id="client" required value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="studio">Studio</label>
                <select
                  id="studio" required value={form.studio_code}
                  onChange={(e) => setForm({ ...form, studio_code: e.target.value })}
                >
                  <option value="">— pilih —</option>
                  {studios.map((s) => <option key={s.code} value={s.code}>{s.nama}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="mulai">Mulai</label>
                <input
                  id="mulai" type="time" required value={form.waktu_mulai}
                  onChange={(e) => setForm({ ...form, waktu_mulai: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="selesai">Selesai</label>
                <input
                  id="selesai" type="time" required value={form.waktu_selesai}
                  onChange={(e) => setForm({ ...form, waktu_selesai: e.target.value })}
                />
              </div>
            </div>
            <div className="formRow">
              <EmployeePicker
                id="pic" label="PIC" required
                employees={picCandidates} loading={picLoading} error={picError}
                value={form.assigned_pic}
                onChange={(v) => setForm({ ...form, assigned_pic: v })}
                emptyHint="Belum ada staff Creative aktif untuk dijadwalkan."
              />
              <div className="field">
                <label htmlFor="task">Jenis pekerjaan</label>
                <select
                  id="task" required value={form.task_type}
                  onChange={(e) => setForm({ ...form, task_type: e.target.value })}
                >
                  {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="target">Target qty</label>
                <input
                  id="target" type="number" min={1} required value={form.target_qty}
                  onChange={(e) => setForm({ ...form, target_qty: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="paket">Jenis paket</label>
                <input
                  id="paket" value={form.jenis_paket ?? ''}
                  onChange={(e) => setForm({ ...form, jenis_paket: e.target.value || null })}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="notes">Catatan</label>
              <input
                id="notes" value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={menyimpan}>
                {menyimpan ? 'Menyimpan...' : 'Simpan slot'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
