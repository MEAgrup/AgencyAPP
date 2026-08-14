'use client';

/**
 * Penugasan Internal — the page an atasan uses to hand work to their team.
 *
 * Deliberately separate from `/tasks` (M12), which executes work that already
 * exists as a Brief or an Asset and therefore always belongs to a paying client.
 * Nothing here touches that chain: this is "Direktur → Head Finance: siapkan
 * laporan bulanan, tenggat Jumat, taruh di Drive" — which the system had no way
 * to express at all.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import EmployeePicker from '@/components/EmployeePicker';
import StatusBadge from '@/components/StatusBadge';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import {
  PENUGASAN_DIVISIONS,
  PENUGASAN_STATUSES,
  createPenugasan,
  labelKeterlambatan,
  listPenugasan,
  type Penugasan,
} from '@/lib/penugasan';

export default function PenugasanPage() {
  const { role, employee } = useAuth();

  // Who may hand out work (mirrors `internaltask.canAssign`): Director anywhere,
  // Lead/SPV inside their own division, nobody else. A PURE OD has no division
  // level, so this is false for them — which is the Role Matrix, and what the
  // server enforces. A layered OD who is also a division lead still assigns
  // through that division scope, never "as OD".
  const isDirector = Boolean(role?.director);
  const isLead = role?.level === 'lead' && Boolean(role?.division);
  const canAssign = isDirector || isLead;

  // --- Create form -----------------------------------------------------------
  // A Director picks the division first (they reach all of them); a lead is
  // pinned to their own, so there is nothing to choose.
  const [division, setDivision] = useState<string>(isDirector ? '' : (role?.division ?? ''));
  const [assignee, setAssignee] = useState('');
  const [judul, setJudul] = useState('');
  const [deskripsi, setDeskripsi] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lampiran, setLampiran] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const targetDivision = isDirector ? division : (role?.division ?? '');
  // A Director may also task a lead (Director → Head is the ordinary case), so
  // the level filter is only applied for a division lead, who may task staff only.
  const {
    employees, loading: dirLoading, error: dirError,
  } = useAssignableEmployees(
    targetDivision || undefined,
    isDirector ? undefined : LEVEL_STAFF,
    canAssign && targetDivision !== '',
  );

  // --- List ------------------------------------------------------------------
  const [tab, setTab] = useState<'saya' | 'diberikan' | 'semua'>('saya');
  const [statusFilter, setStatusFilter] = useState('');
  const [onlyLate, setOnlyLate] = useState(false);
  const [rows, setRows] = useState<Penugasan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await listPenugasan({
        status: statusFilter || undefined,
        terlambat: onlyLate || undefined,
      });
      setRows(res.data);
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, onlyLate]);

  useEffect(() => { load(); }, [load]);

  // The server already scoped the rows; the tabs only slice what came back, so
  // there is no second copy of the permission rule in the browser.
  const me = employee?.employee_id ?? '';
  const visible = useMemo(() => {
    if (!rows) return null;
    if (tab === 'saya') return rows.filter((t) => t.assignee_id === me);
    if (tab === 'diberikan') return rows.filter((t) => t.created_by === me);
    return rows;
  }, [rows, tab, me]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormOk(null);
    setSubmitting(true);
    try {
      const t = await createPenugasan({
        judul,
        deskripsi: deskripsi || undefined,
        assignee_id: assignee,
        due_date: dueDate,
        lampiran_link: lampiran || undefined,
      });
      setFormOk(`Penugasan ${t.id} dibuat dan dikirim ke ${t.assignee_id}.`);
      setJudul(''); setDeskripsi(''); setDueDate(''); setLampiran(''); setAssignee('');
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Penugasan Internal</h1>
        <p className="muted">
          Tugas yang diberikan atasan ke anggota tim &mdash; di luar pekerjaan klien. Untuk eksekusi
          Brief/Asset milik klien, gunakan <Link href="/tasks">Task Execution (M12)</Link>.
        </p>
      </div>

      {canAssign && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Penugasan</h2>
          </div>
          <form className="form" onSubmit={handleCreate}>
            {formError && <div className="alert alertError" role="alert">{formError}</div>}
            {formOk && <div className="alert alertSuccess" role="status">{formOk}</div>}

            <div className="formRow">
              {isDirector && (
                <div className="field">
                  <label htmlFor="p-division">Divisi Tujuan</label>
                  <select
                    id="p-division"
                    required
                    value={division}
                    onChange={(e) => {
                      setDivision(e.target.value);
                      // Clearing the old pick is load-bearing: narrowing the list
                      // while a stale id is still selected would quietly assign
                      // the work to somebody in another division.
                      setAssignee('');
                    }}
                  >
                    <option value="">Pilih divisi...</option>
                    {PENUGASAN_DIVISIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field">
                <EmployeePicker
                  id="p-assignee"
                  employees={employees}
                  loading={dirLoading}
                  error={dirError}
                  value={assignee}
                  onChange={setAssignee}
                  required
                  disabled={targetDivision === ''}
                  label={`Ditugaskan Kepada${targetDivision ? ` (divisi ${targetDivision})` : ''}`}
                  emptyHint="Belum ada karyawan aktif yang jabatan HRIS-nya dipetakan untuk divisi ini. Petakan di Admin › Role Mapping."
                  note={
                    isDirector
                      ? 'Sebagai Direktur Anda bisa menugaskan lintas divisi, termasuk ke Head/SPV.'
                      : 'Daftar = staff aktif di divisi Anda. Rekan selevel (Lead/SPV) tidak bisa ditugaskan dari sini.'
                  }
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="p-judul">Judul Tugas</label>
              <input
                id="p-judul"
                required
                value={judul}
                onChange={(e) => setJudul(e.target.value)}
                placeholder="mis. Siapkan laporan performa Agustus"
              />
            </div>

            <div className="field">
              <label htmlFor="p-deskripsi">Deskripsi / Instruksi</label>
              <textarea
                id="p-deskripsi"
                rows={3}
                value={deskripsi}
                onChange={(e) => setDeskripsi(e.target.value)}
              />
            </div>

            <div className="formRow">
              <div className="field">
                <label htmlFor="p-due">Jatuh Tempo</label>
                <input
                  id="p-due"
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                {/* Said here rather than discovered later: the date is frozen on
                    save, because moving it after the fact is the easiest way to
                    erase a late record. */}
                <p className="muted" style={{ fontSize: 12 }}>
                  Tidak bisa diubah setelah disimpan. Salah tenggat &rArr; batalkan lalu buat ulang.
                </p>
              </div>

              <div className="field">
                <label htmlFor="p-lampiran">Link Lampiran / Referensi (opsional)</label>
                <input
                  id="p-lampiran"
                  value={lampiran}
                  onChange={(e) => setLampiran(e.target.value)}
                  placeholder="https://drive.google.com/..."
                />
                <p className="muted" style={{ fontSize: 12 }}>
                  Bahan dari Anda. Link <strong>hasil kerja</strong> diisi oleh yang ditugaskan saat menyelesaikan.
                </p>
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="btn btnPrimary"
                disabled={submitting || assignee === '' || targetDivision === ''}
              >
                {submitting ? 'Menyimpan...' : 'Buat Penugasan'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="row" style={{ gap: 8 }}>
          {([
            ['saya', 'Tugas Saya'],
            ['diberikan', 'Saya Berikan'],
            ['semua', 'Semua Terlihat'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn ${tab === key ? 'btnPrimary' : 'btnSecondary'} btnSm`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
          <Link href="/penugasan/rekap" className="btn btnSecondary btnSm">
            Rekap Disiplin
          </Link>
        </div>

        <div className="formRow" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="p-status">Status</label>
            <select id="p-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Semua status</option>
              {PENUGASAN_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-late">
              <input
                id="p-late"
                type="checkbox"
                checked={onlyLate}
                onChange={(e) => setOnlyLate(e.target.checked)}
              />{' '}
              Hanya yang terlambat
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {listError && <div className="alert alertError" role="alert">{listError}</div>}
        {!loading && !listError && visible && visible.length === 0 && (
          <div className="emptyState">Tidak ada penugasan yang cocok dengan filter.</div>
        )}
        {!loading && !listError && visible && visible.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Judul</th>
                  <th>Ditugaskan Ke</th>
                  <th>Divisi</th>
                  <th>Jatuh Tempo</th>
                  <th>Status</th>
                  <th>Keterlambatan</th>
                  <th>Hasil</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const late = labelKeterlambatan(t);
                  return (
                    <tr key={t.id} className={t.terlambat_berjalan ? 'flaggedRow' : ''}>
                      <td><Link href={`/penugasan/${t.id}`}>{t.id}</Link></td>
                      <td>{t.judul}</td>
                      <td>{t.assignee_id}</td>
                      <td>{t.assignee_division}</td>
                      <td>{t.due_date}</td>
                      <td><StatusBadge status={t.status} /></td>
                      <td>
                        {late === '' ? '—' : (
                          <span className={`badge badge-${t.selesai_terlambat ? 'amber' : 'red'}`}>{late}</span>
                        )}
                      </td>
                      <td>
                        {t.link_hasil
                          ? <a href={t.link_hasil} target="_blank" rel="noreferrer">Lihat Hasil</a>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
