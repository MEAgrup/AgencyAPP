'use client';

import { Fragment, use, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isHttpUrl } from '@/lib/url';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  approveAssetBatch,
  ASSET_IN_REVIEW,
  ASSET_SUBMITTED,
  CREATIVE_DIVISION,
  createAssetBatch,
  distributeLinks,
  getBrief,
  isAccountRole,
  isCreativeDivision,
  isDirector,
  isODOnly,
  listBriefAssets,
  reviewAssetBatch,
  startAssetBatch,
  submitAssetBatch,
  type Asset,
  type AssetExecBatchReport,
  type Brief,
} from '@/lib/creative';
import StatusBadge from '@/components/StatusBadge';
import StageTimelinePanel from '@/components/StageTimelinePanel';

/**
 * "Assign Team untuk Creative Production" — the Brief breakdown of M7 §3 Rule 4 as
 * the work is actually handed out: one line per PIC saying how many units of the
 * Brief they take ("10 video ke Rian, 10 ke Dita", or all 30 to one person). The
 * Sequence # is not asked for: it is the position within the Brief's
 * Quantity/Target (§9.3), allocated server-side from the free slots, because
 * whoever hands out 10 videos is not choosing WHICH ten.
 *
 * PIC per line stays a human choice by the Team Leader (owner 2026-08-14);
 * M7-OA-1's auto-assign by availability/workload is not built.
 */
const ASSIGN_MAX_ROWS = 10;

interface AssignRow {
  key: number;
  assigned_pic: string;
  quantity: string; // integer string ("" => baris dilewati)
}

function emptyAssignRow(key: number): AssignRow {
  return { key, assigned_pic: '', quantity: '' };
}

export default function CreativeBriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  const [brief, setBrief] = useState<Brief | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Assign team: sejumlah unit Brief ke tiap PIC (satu submit, satu transaksi)
  const [assignRows, setAssignRows] = useState<AssignRow[]>(() => [emptyAssignRow(0), emptyAssignRow(1)]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const rowKeyCounter = useRef(2);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  // Submit Output Massal (C3, Revisi Sales/Creative/Performa): satu layar, semua
  // link Asset [In Progress] sekaligus — bukan window.prompt satu per satu.
  const [pasteText, setPasteText] = useState('');
  const [pasteCounter, setPasteCounter] = useState<string | null>(null);
  const [linkInputs, setLinkInputs] = useState<Record<string, string>>({});
  const [massalSubmitting, setMassalSubmitting] = useState(false);
  const [massalError, setMassalError] = useState<string | null>(null);
  const [massalReport, setMassalReport] = useState<AssetExecBatchReport | null>(null);
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Review & Approve Massal (C4, Revisi Sales/Creative/Performa): AM checks
  // off many [Submitted]/[In Review] Assets in one screen, two SEPARATE doors
  // (§4 Flow 3 — review and approve are distinct actions, never collapsed).
  const [reviewChecked, setReviewChecked] = useState<Record<string, boolean>>({});
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewReport, setReviewReport] = useState<AssetExecBatchReport | null>(null);
  const [approveChecked, setApproveChecked] = useState<Record<string, boolean>>({});
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveReport, setApproveReport] = useState<AssetExecBatchReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const b = await getBrief(id);
      setBrief(b);
      const res = await listBriefAssets(id);
      setAssets(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const canCreateAsset = !isODOnly(role) && (isCreativeDivision(role) || isDirector(role));

  // Asset PIC candidates = active Creative STAFF (`creative.validateCreativeStaff`).
  // Declared above the loading early-return: hooks must run on every render.
  const {
    employees: picCandidates,
    loading: picLoading,
    error: picError,
  } = useAssignableEmployees(CREATIVE_DIVISION, LEVEL_STAFF, canCreateAsset);

  function updateRow(key: number, patch: Partial<AssignRow>) {
    setAssignRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setAssignRows((rows) =>
      rows.length >= ASSIGN_MAX_ROWS ? rows : [...rows, emptyAssignRow(rowKeyCounter.current++)],
    );
  }

  function removeRow(key: number) {
    setAssignRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)));
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleCreateAssets(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateMessage(null);
    setRowErrors({});

    // Baris yang benar-benar kosong dilewati tanpa error (pola batch M9).
    const intended = assignRows.filter((r) => !(r.quantity.trim() === '' && r.assigned_pic === ''));
    if (intended.length === 0) {
      setCreateError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    const errors: Record<number, string> = {};
    for (const r of intended) {
      const qty = Number(r.quantity);
      if (r.quantity.trim() === '' || !Number.isInteger(qty) || qty <= 0) {
        errors[r.key] = '[jumlah aset yang di-assign harus lebih dari 0]';
      }
    }
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors);
      setCreateError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }

    setCreateSubmitting(true);
    try {
      // Satu POST untuk seluruh batch: Sequence # dialokasikan server-side dan
      // seluruh batch gagal bersama kalau melebihi sisa target Brief.
      const res = await createAssetBatch(
        id,
        intended.map((r) => ({
          assigned_pic: r.assigned_pic || undefined,
          quantity: Number(r.quantity),
        })),
      );
      const created = res.data;
      setCreateMessage(
        `${created.length} Asset dibuat (${created[0]?.id ?? '—'}${created.length > 1 ? ` s/d ${created[created.length - 1].id}` : ''}).`,
      );
      setAssignRows([emptyAssignRow(rowKeyCounter.current++), emptyAssignRow(rowKeyCounter.current++)]);
      await load();
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreateSubmitting(false);
    }
  }

  // Asset yang siap disubmit ([In Progress]), urut sequence_no — sama urutan
  // dengan tabel Asset di atas.
  const submittableAssets = (assets ?? [])
    .filter((a) => a.status === '[In Progress]')
    .sort((a, b) => a.sequence_no - b.sequence_no);
  const todoAssets = (assets ?? [])
    .filter((a) => a.status === '[To Do]')
    .sort((a, b) => a.sequence_no - b.sequence_no);
  const pastedLinkCount = pasteText.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0).length;

  // Review & Approve Massal (C4): owning AM or Director — server decides ownership
  // per row, this only decides whether the card is worth showing.
  const canReview = !isODOnly(role) && (isDirector(role) || isAccountRole(role));
  const reviewableAssets = (assets ?? [])
    .filter((a) => a.status === ASSET_SUBMITTED)
    .sort((a, b) => a.sequence_no - b.sequence_no);
  const approvableAssets = (assets ?? [])
    .filter((a) => a.status === ASSET_IN_REVIEW)
    .sort((a, b) => a.sequence_no - b.sequence_no);

  function handleDistribute() {
    const result = distributeLinks(pasteText, submittableAssets.length);
    const next: Record<string, string> = { ...linkInputs };
    submittableAssets.forEach((a, i) => {
      if (result.links[i] !== undefined) {
        next[a.id] = result.links[i];
      }
    });
    setLinkInputs(next);
    const placed = result.links.length;
    setPasteCounter(
      result.leftover > 0
        ? `${placed} link ditempel ke ${placed} dari ${submittableAssets.length} baris — ${result.leftover} link berlebih diabaikan.`
        : `${placed} link ditempel ke ${placed} dari ${submittableAssets.length} baris.`,
    );
  }

  async function handleSubmitMassal() {
    setMassalError(null);
    setMassalReport(null);
    // Hanya baris yang sudah diisi — mengosongkan sebuah baris berarti "belum
    // disubmit sekarang", bukan error; server tetap all-or-nothing atas baris
    // yang DIKIRIM.
    const lines = submittableAssets
      .filter((a) => (linkInputs[a.id] ?? '').trim() !== '')
      .map((a) => ({ asset_id: a.id, output_link: linkInputs[a.id] }));
    if (lines.length === 0) {
      setMassalError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setMassalSubmitting(true);
    try {
      const report = await submitAssetBatch(id, lines);
      setMassalReport(report);
      if (report.rejected === 0) {
        setLinkInputs({});
        setPasteText('');
        setPasteCounter(null);
        await load();
      }
    } catch (err) {
      setMassalError(errorMessage(err));
    } finally {
      setMassalSubmitting(false);
    }
  }

  async function handleStartBatch() {
    setStartError(null);
    setStartSubmitting(true);
    try {
      await startAssetBatch(id, todoAssets.map((a) => a.id));
      await load();
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setStartSubmitting(false);
    }
  }

  function toggleAll(setChecked: typeof setReviewChecked, rows: Asset[], checked: boolean) {
    setChecked(Object.fromEntries(rows.map((a) => [a.id, checked])));
  }

  async function handleReviewMassal() {
    setReviewError(null);
    setReviewReport(null);
    const ids = reviewableAssets.filter((a) => reviewChecked[a.id]).map((a) => a.id);
    if (ids.length === 0) {
      setReviewError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setReviewSubmitting(true);
    try {
      const report = await reviewAssetBatch(id, ids);
      setReviewReport(report);
      if (report.rejected === 0) {
        setReviewChecked({});
        await load();
      }
    } catch (err) {
      setReviewError(errorMessage(err));
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleApproveMassal() {
    setApproveError(null);
    setApproveReport(null);
    const ids = approvableAssets.filter((a) => approveChecked[a.id]).map((a) => a.id);
    if (ids.length === 0) {
      setApproveError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setApproveSubmitting(true);
    try {
      const report = await approveAssetBatch(id, ids);
      setApproveReport(report);
      if (report.rejected === 0) {
        setApproveChecked({});
        await load();
      }
    } catch (err) {
      setApproveError(errorMessage(err));
    } finally {
      setApproveSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !brief) {
    return (
      <div className="stack">
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Brief tidak ditemukan.'}</div>
      </div>
    );
  }

  const isOtherDivision = brief.assigned_division !== CREATIVE_DIVISION;
  const createdCount = assets?.length ?? 0;
  // Advisory only — the server re-derives both under the Brief's row lock and
  // rejects an overrun batch wholesale (§9.3 Sequence # unique per Brief).
  const remainingSlots = Math.max(0, brief.quantity_target - createdCount);
  const plannedTotal = assignRows.reduce((sum, r) => {
    const n = Number(r.quantity);
    return sum + (Number.isInteger(n) && n > 0 ? n : 0);
  }, 0);

  return (
    <div className="stack">
      <div>
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{brief.title}</h1>
          <p className="muted">{brief.id}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {brief.revision_flagged && <span className="badge badge-red">Revisi Berulang</span>}
          <StatusBadge status={brief.status} />
        </div>
      </div>

      {isOtherDivision && (
        <div className="alert alertInfo" role="status">
          Brief ini ditujukan ke divisi &ldquo;{brief.assigned_division}&rdquo;, bukan Creative. Pembuatan
          Asset kemungkinan akan ditolak server.
        </div>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Detail Brief</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Layanan</div>
            <div>{brief.service_id}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Deliverable Type</div>
            <div>{brief.deliverable_type}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>PIC Brief</div>
            <div>{brief.assigned_pic || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Prioritas</div>
            <div>{brief.priority}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Due Date</div>
            <div>{brief.due_date || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Progress Asset &middot; <span title="Dibanding quantity_target Brief">🔒 read-only</span>
            </div>
            <div>{createdCount} dari {brief.quantity_target} dibuat</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Instruksi</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{brief.instructions || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Referensi / Lampiran</div>
            <div>
              {brief.reference_attachments && isHttpUrl(brief.reference_attachments) ? (
                <a href={brief.reference_attachments} target="_blank" rel="noreferrer">Lihat</a>
              ) : brief.reference_attachments ? (
                <span title="Bukan link — tidak bisa diklik">{brief.reference_attachments}</span>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
      </section>

      <StageTimelinePanel
        briefId={brief.id}
        assignedDivision={brief.assigned_division}
        canReview={!isODOnly(role) && (isCreativeDivision(role) || isDirector(role))}
      />

      <section className="card">
        <div className="cardHeader">
          <h2>Asset ({createdCount}/{brief.quantity_target})</h2>
        </div>
        {assets && assets.length === 0 ? (
          <div className="emptyState">Belum ada Asset dibuat untuk Brief ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Urutan</th>
                  <th>Tipe</th>
                  <th>PIC</th>
                  <th>Status</th>
                  <th>Revisi</th>
                </tr>
              </thead>
              <tbody>
                {(assets ?? []).map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/creative/assets/${a.id}`}>{a.id}</Link></td>
                    <td>{a.sequence_no}</td>
                    <td>{a.asset_type || '—'}</td>
                    <td>{a.assigned_pic || '—'}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td>
                      {a.revision_count}
                      {a.revision_flagged && (
                        <span className="badge badge-purple" style={{ marginLeft: 6 }}>Quality Flag</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canCreateAsset && (todoAssets.length > 0 || submittableAssets.length > 0) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Submit Output Massal</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Isi link output semua Asset yang sedang dikerjakan dalam satu layar, lalu submit sekali —
            bukan satu prompt per Asset.
          </p>

          {todoAssets.length > 0 && (
            <div className="stack" style={{ marginBottom: 16 }}>
              <p className="muted" style={{ fontSize: 13 }}>
                {todoAssets.length} Asset masih <StatusBadge status="[To Do]" /> — mulai kerjakan dulu
                sebelum bisa mengisi link output.
              </p>
              {startError && <div className="alert alertError" role="alert">{startError}</div>}
              <button type="button" className="btn btnSecondary btnSm" disabled={startSubmitting} onClick={handleStartBatch}>
                {startSubmitting ? 'Memproses...' : `Mulai Kerjakan (${todoAssets.length} Asset)`}
              </button>
            </div>
          )}

          {submittableAssets.length > 0 && (
            <>
              <div className="field">
                <label htmlFor="paste-links">Tempel semua link (satu per baris)</label>
                <textarea
                  id="paste-links"
                  rows={5}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'https://drive.google.com/...\nhttps://drive.google.com/...'}
                />
                <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <button type="button" className="btn btnSecondary btnSm" onClick={handleDistribute} disabled={pastedLinkCount === 0}>
                    Sebar ke baris
                  </button>
                  {pasteCounter && <span className="muted" style={{ fontSize: 12 }}>{pasteCounter}</span>}
                </div>
              </div>

              {massalError && <div className="alert alertError" role="alert">{massalError}</div>}
              {massalReport && massalReport.rejected > 0 && (
                <div className="alert alertError" role="alert">
                  <div>{massalReport.rejected} baris ditolak — tidak ada yang tersimpan, perbaiki lalu submit ulang:</div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {massalReport.rejections.map((r) => (
                      <li key={r.asset_id}>Baris {r.row_number} ({r.asset_id}): {r.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {massalReport && massalReport.rejected === 0 && (
                <div className="alert alertSuccess" role="status">
                  {massalReport.applied} Asset berhasil disubmit.
                </div>
              )}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Urutan</th>
                      <th>ID</th>
                      <th>PIC</th>
                      <th>Link Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submittableAssets.map((a) => {
                      const val = linkInputs[a.id] ?? '';
                      return (
                        <tr key={a.id}>
                          <td>{a.sequence_no}</td>
                          <td><Link href={`/creative/assets/${a.id}`}>{a.id}</Link></td>
                          <td>{a.assigned_pic || '—'}</td>
                          <td>
                            <input
                              aria-label={`Link output ${a.id}`}
                              type="text"
                              value={val}
                              onChange={(e) => setLinkInputs((prev) => ({ ...prev, [a.id]: e.target.value }))}
                              placeholder="https://..."
                              style={val !== '' && !isHttpUrl(val) ? { borderColor: 'var(--color-warning, #b58105)' } : undefined}
                            />
                            {val !== '' && !isHttpUrl(val) && (
                              <div className="muted" style={{ fontSize: 11 }}>Sepertinya bukan link — server tidak memblokir ini, hanya pengingat.</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn btnPrimary" disabled={massalSubmitting} onClick={handleSubmitMassal}>
                  {massalSubmitting
                    ? 'Mengirim...'
                    : `Submit (${submittableAssets.filter((a) => (linkInputs[a.id] ?? '').trim() !== '').length} baris terisi)`}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {canReview && (reviewableAssets.length > 0 || approvableAssets.length > 0) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Review &amp; Approve Massal (AM)</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Centang Asset yang ingin diproses lalu klik tombol — dua tombol terpisah karena Review dan
            Approve adalah dua langkah berbeda (server menolak jika langkahnya dilompat).
          </p>

          {reviewableAssets.length > 0 && (
            <div className="stack" style={{ marginBottom: 20 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>Perlu Review ({reviewableAssets.length})</h3>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btnSecondary btnSm" onClick={() => toggleAll(setReviewChecked, reviewableAssets, true)}>
                    Pilih semua
                  </button>
                  <button type="button" className="btn btnSecondary btnSm" onClick={() => toggleAll(setReviewChecked, reviewableAssets, false)}>
                    Kosongkan
                  </button>
                </div>
              </div>

              {reviewError && <div className="alert alertError" role="alert">{reviewError}</div>}
              {reviewReport && reviewReport.rejected > 0 && (
                <div className="alert alertError" role="alert">
                  <div>{reviewReport.rejected} baris ditolak — tidak ada yang tersimpan, perbaiki lalu coba lagi:</div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {reviewReport.rejections.map((r) => (
                      <li key={r.asset_id}>Baris {r.row_number} ({r.asset_id}): {r.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {reviewReport && reviewReport.rejected === 0 && (
                <div className="alert alertSuccess" role="status">{reviewReport.applied} Asset mulai direview.</div>
              )}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '4%' }}></th>
                      <th>Urutan</th>
                      <th>ID</th>
                      <th>PIC</th>
                      <th>Link Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewableAssets.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Pilih ${a.id} untuk review`}
                            checked={!!reviewChecked[a.id]}
                            onChange={(e) => setReviewChecked((prev) => ({ ...prev, [a.id]: e.target.checked }))}
                          />
                        </td>
                        <td>{a.sequence_no}</td>
                        <td><Link href={`/creative/assets/${a.id}`}>{a.id}</Link></td>
                        <td>{a.assigned_pic || '—'}</td>
                        <td>
                          {a.output_link && isHttpUrl(a.output_link) ? (
                            <a href={a.output_link} target="_blank" rel="noreferrer">Lihat</a>
                          ) : (
                            a.output_link || '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn btnPrimary" disabled={reviewSubmitting} onClick={handleReviewMassal}>
                  {reviewSubmitting
                    ? 'Memproses...'
                    : `Mulai Review (${reviewableAssets.filter((a) => reviewChecked[a.id]).length} dipilih)`}
                </button>
              </div>
            </div>
          )}

          {approvableAssets.length > 0 && (
            <div className="stack">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>Perlu Approve ({approvableAssets.length})</h3>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btnSecondary btnSm" onClick={() => toggleAll(setApproveChecked, approvableAssets, true)}>
                    Pilih semua
                  </button>
                  <button type="button" className="btn btnSecondary btnSm" onClick={() => toggleAll(setApproveChecked, approvableAssets, false)}>
                    Kosongkan
                  </button>
                </div>
              </div>

              {approveError && <div className="alert alertError" role="alert">{approveError}</div>}
              {approveReport && approveReport.rejected > 0 && (
                <div className="alert alertError" role="alert">
                  <div>{approveReport.rejected} baris ditolak — tidak ada yang tersimpan, perbaiki lalu coba lagi:</div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {approveReport.rejections.map((r) => (
                      <li key={r.asset_id}>Baris {r.row_number} ({r.asset_id}): {r.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {approveReport && approveReport.rejected === 0 && (
                <div className="alert alertSuccess" role="status">{approveReport.applied} Asset disetujui.</div>
              )}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '4%' }}></th>
                      <th>Urutan</th>
                      <th>ID</th>
                      <th>PIC</th>
                      <th>Link Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvableAssets.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Pilih ${a.id} untuk approve`}
                            checked={!!approveChecked[a.id]}
                            onChange={(e) => setApproveChecked((prev) => ({ ...prev, [a.id]: e.target.checked }))}
                          />
                        </td>
                        <td>{a.sequence_no}</td>
                        <td><Link href={`/creative/assets/${a.id}`}>{a.id}</Link></td>
                        <td>{a.assigned_pic || '—'}</td>
                        <td>
                          {a.output_link && isHttpUrl(a.output_link) ? (
                            <a href={a.output_link} target="_blank" rel="noreferrer">Lihat</a>
                          ) : (
                            a.output_link || '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn btnPrimary" disabled={approveSubmitting} onClick={handleApproveMassal}>
                  {approveSubmitting
                    ? 'Memproses...'
                    : `Approve (${approvableAssets.filter((a) => approveChecked[a.id]).length} dipilih)`}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {canCreateAsset && (
        <section className="card">
          <div className="cardHeader">
            <h2>Assign Team untuk Creative Production</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Tentukan <strong>berapa unit</strong> yang dikerjakan tiap orang — mis. 10 video ke A, 10 ke
            B, atau seluruhnya ke satu orang. Nomor urut Asset ditetapkan otomatis dari slot yang masih
            kosong (bukan diisi manual). Kosongkan PIC untuk self-claim (staff Creative) atau untuk
            melempar ke queue umum Creative (Lead). Sisa slot Brief:{' '}
            <strong>{remainingSlots}</strong> dari {brief.quantity_target}.
          </p>
          <form className="form" onSubmit={handleCreateAssets}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}
            {createMessage && <div className="alert alertSuccess" role="status">{createMessage}</div>}

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '4%' }}>#</th>
                    <th>PIC (kosongkan untuk self-claim)</th>
                    <th style={{ width: '22%' }}>Jumlah Asset *</th>
                    <th style={{ width: '4%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {assignRows.map((r, idx) => (
                    <Fragment key={r.key}>
                      <tr>
                        <td className="muted">{idx + 1}</td>
                        <td>
                          <EmployeePicker
                            id={`asset-pic-${r.key}`}
                            label={`PIC baris ${idx + 1}`}
                            employees={picCandidates}
                            loading={picLoading}
                            error={picError}
                            value={r.assigned_pic}
                            onChange={(v) => updateRow(r.key, { assigned_pic: v })}
                            emptyHint="Belum ada staff Creative aktif. Biarkan kosong — staff yang membuat Asset otomatis menjadi PIC-nya."
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Jumlah Asset baris ${idx + 1}`}
                            type="number"
                            min="1"
                            step="1"
                            max={remainingSlots}
                            value={r.quantity}
                            onChange={(e) => updateRow(r.key, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btnSecondary btnSm"
                            aria-label={`Hapus baris ${idx + 1}`}
                            onClick={() => removeRow(r.key)}
                            disabled={assignRows.length <= 1}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                      {rowErrors[r.key] && (
                        <tr>
                          <td></td>
                          <td colSpan={3} style={{ color: 'var(--color-danger, #c0392b)', fontSize: 12 }}>
                            {rowErrors[r.key]}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btnSecondary btnSm"
                onClick={addRow}
                disabled={assignRows.length >= ASSIGN_MAX_ROWS}
              >
                + Tambah PIC ({assignRows.length}/{ASSIGN_MAX_ROWS})
              </button>
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  Total di-assign: <strong>{plannedTotal}</strong>
                  {plannedTotal > remainingSlots && ' — melebihi sisa slot'}
                </span>
                <button type="submit" className="btn btnPrimary" disabled={createSubmitting || remainingSlots === 0}>
                  {createSubmitting ? 'Menyimpan...' : 'Assign & Buat Asset'}
                </button>
              </div>
            </div>
            {remainingSlots === 0 && (
              <p className="muted" style={{ fontSize: 12 }}>
                Semua {brief.quantity_target} unit Brief ini sudah dibuat sebagai Asset.
              </p>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
