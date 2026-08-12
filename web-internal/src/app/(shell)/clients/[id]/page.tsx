'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAccountLead, isAccountStaff } from '@/lib/account';
import {
  PRASYARAT_LABELS,
  VERDICT_LABELS,
  createInterview,
  interviewStatusTone,
  listInterviewsByClient,
  verdictTone,
  type InterviewListRow,
} from '@/lib/interview';
import {
  EDITABLE_FIELDS,
  PAYMENT_INTENT_OPTIONS,
  editClient,
  getClient,
  setPaymentIntent,
  voidService,
  type Client,
  type FieldChange,
} from '@/lib/clients';
import StatusBadge from '@/components/StatusBadge';

const VOIDED_STATUS = '[Cancelled — Service Voided]';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { role } = useAuth();
  // The Service hub (§4/§5) is an Account-division page — `account.getService`
  // admits the owning AM, Account lead, OD and Director. Sales/Finance read this
  // client record too, and a link that 403s for them is worse than no link.
  const canOpenServiceHub =
    isAccountStaff(role) || isAccountLead(role) || !!role?.od || !!role?.director;
  // "Kelola Klien" (Interview) is a write action: only the assigned AM, an
  // Account lead, or a Director may open an interview (mirrors canWriteInterview).
  const canManageInterview = isAccountStaff(role) || isAccountLead(role) || !!role?.director;

  const [creatingInterview, setCreatingInterview] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  // The client's interview log — so a saved interview can be reopened instead of
  // only ever created anew (which would duplicate it). Account-scope read.
  const [interviews, setInterviews] = useState<InterviewListRow[]>([]);
  const [interviewsError, setInterviewsError] = useState<string | null>(null);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Void Service
  const [voidPendingId, setVoidPendingId] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidMessage, setVoidMessage] = useState<string | null>(null);

  // Payment Intent
  const [intentChoice, setIntentChoice] = useState<string>('');
  const [intentSubmitting, setIntentSubmitting] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [intentMessage, setIntentMessage] = useState<string | null>(null);

  // Koreksi field
  const [correctionField, setCorrectionField] = useState<string>(EDITABLE_FIELDS[0].field);
  const [correctionValue, setCorrectionValue] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionResult, setCorrectionResult] = useState<FieldChange[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getClient(id);
      setClient(res.client);
      if (res.client.payment_intent) {
        setIntentChoice(res.client.payment_intent);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  // The interview log is Account-scope; a Sales/Finance viewer of this record is
  // denied (403). Load it separately so that denial never blanks the whole page —
  // the log simply stays empty for roles that may not read it.
  const loadInterviews = useCallback(async () => {
    if (!canManageInterview) return;
    setInterviewsError(null);
    try {
      const res = await listInterviewsByClient(id);
      setInterviews(res.data);
    } catch (err) {
      setInterviewsError(errorMessage(err));
    }
  }, [id, canManageInterview]);

  useEffect(() => {
    load();
    loadInterviews();
  }, [load, loadInterviews]);

  async function handleVoid(serviceId: string, serviceName: string) {
    if (!window.confirm(`Yakin ingin void service "${serviceName}"? Brief non-Approved akan ikut dibatalkan.`)) {
      return;
    }
    setVoidError(null);
    setVoidMessage(null);
    setVoidPendingId(serviceId);
    try {
      const res = await voidService(serviceId);
      setVoidMessage(
        `Service berhasil di-void. Brief dibatalkan: ${res.voided_briefs.length}, brief Approved dipertahankan: ${res.skipped_approved_briefs.length}.`,
      );
      await load();
    } catch (err) {
      setVoidError(errorMessage(err));
    } finally {
      setVoidPendingId(null);
    }
  }

  async function handleSetIntent(e: FormEvent) {
    e.preventDefault();
    setIntentError(null);
    setIntentMessage(null);
    if (!intentChoice) return;
    setIntentSubmitting(true);
    try {
      const res = await setPaymentIntent(id, intentChoice);
      setClient(res.client);
      setIntentMessage('Payment Intent berhasil disimpan.');
    } catch (err) {
      setIntentError(errorMessage(err));
    } finally {
      setIntentSubmitting(false);
    }
  }

  async function handleCorrection(e: FormEvent) {
    e.preventDefault();
    setCorrectionError(null);
    setCorrectionResult(null);
    setCorrectionSubmitting(true);
    try {
      const res = await editClient(id, { [correctionField]: correctionValue });
      setCorrectionResult(res.changes);
      setCorrectionValue('');
      await load();
    } catch (err) {
      setCorrectionError(errorMessage(err));
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  async function handleOpenInterview() {
    if (!window.confirm('Buat interview baru untuk klien ini dan buka halaman Kelola Klien?')) {
      return;
    }
    setInterviewError(null);
    setCreatingInterview(true);
    try {
      const detail = await createInterview({ client_id: id });
      router.push(`/account/interview/${detail.interview.id}`);
    } catch (err) {
      setInterviewError(errorMessage(err));
      setCreatingInterview(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !client) {
    return (
      <div className="stack">
        <Link href="/clients" className="muted">&larr; Kembali ke Klien</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Klien tidak ditemukan.'}</div>
      </div>
    );
  }

  const allocationTotalPct = client.sales_allocation.reduce((sum, a) => sum + a.basis_points, 0) / 100;

  return (
    <div className="stack">
      <div>
        <Link href="/clients" className="muted">&larr; Kembali ke Klien</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{client.toko}</h1>
          <p className="muted">{client.id}</p>
        </div>
        {client.released_to_account_at ? (
          <span className="badge badge-green">Released</span>
        ) : (
          <span className="badge badge-amber">Menunggu Finance</span>
        )}
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Identitas &amp; Baseline</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Nama PIC</div>
            <div>{client.nama_pic || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Toko</div>
            <div>{client.toko || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Kota</div>
            <div>{client.kota || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Link Toko</div>
            <div>{client.link_toko || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Kategori</div>
            <div>{client.kategori || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>GMV Baseline &middot; <span title="Koreksi: OD atau Director">🔒 OD/Director</span></div>
            <div>{client.gmv_baseline}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target GMV &middot; <span title="Koreksi: Account atau Director">🔒 Account</span></div>
            <div>{client.target_gmv}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Marketing Budget &middot; <span title="Koreksi: Account atau Director">🔒 Account</span></div>
            <div>{client.marketing_budget ?? '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Total Sales &middot; <span title="Auto-calculated, tidak dapat diubah">🔒 read-only</span></div>
            <div>{client.total_sales}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Sales PIC &middot; <span title="Koreksi: Sales Lead atau Director">🔒 Sales Lead</span></div>
            <div>{client.sales_pic_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Commission &amp; Payment PIC &middot; <span title="Koreksi: Sales Lead atau Director">🔒 Sales Lead</span></div>
            <div>{client.commission_payment_pic_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Transaction ID</div>
            <div>
              {client.transaction_id ? (
                <Link href={`/finance/transactions/${client.transaction_id}`}>{client.transaction_id}</Link>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Platform</h2>
        </div>
        {client.platforms.length === 0 ? (
          <div className="emptyState">Belum ada platform.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Link Toko</th>
                  <th>Dikelola Sejak</th>
                  <th>Aktif</th>
                </tr>
              </thead>
              <tbody>
                {client.platforms.map((p, idx) => (
                  <tr key={`${p.platform}-${idx}`}>
                    <td>{p.platform}</td>
                    <td>{p.store_link || '—'}</td>
                    <td>{formatDate(p.managed_since)}</td>
                    <td>{p.active ? 'Aktif' : 'Nonaktif'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Sales Allocation</h2>
        </div>
        {client.sales_allocation.length === 0 ? (
          <div className="emptyState">Belum ada alokasi sales.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Salesperson</th>
                  <th>Persen</th>
                </tr>
              </thead>
              <tbody>
                {client.sales_allocation.map((a) => (
                  <tr key={a.salesperson_id}>
                    <td>{a.salesperson_id}</td>
                    <td>{(a.basis_points / 100).toFixed(2)}%</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Total</strong></td>
                  <td><strong>{allocationTotalPct.toFixed(2)}%</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Services</h2>
        </div>
        {voidError && <div className="alert alertError" role="alert">{voidError}</div>}
        {voidMessage && <div className="alert alertSuccess" role="status">{voidMessage}</div>}
        {/* The Service ID is not decoration: every M6 §4/§5 door is keyed by it
            (Strategy & Plan, Brief breakdown, the plan-flag override). It was in
            the payload all along but never rendered, so the AM had a status to
            look at and no way to act on it. */}
        {client.services.length === 0 ? (
          <div className="emptyState">Belum ada service.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Service ID</th>
                  <th>Nama</th>
                  <th>Harga Standar</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {client.services.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {canOpenServiceHub ? (
                        <Link href={`/account/services/${encodeURIComponent(s.id)}`}>{s.id}</Link>
                      ) : (
                        s.id
                      )}
                    </td>
                    <td>{s.name}</td>
                    <td>{s.standard_price}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        {canOpenServiceHub && s.status !== VOIDED_STATUS && (
                          <Link
                            href={`/account/services/${encodeURIComponent(s.id)}`}
                            className="btn btnPrimary btnSm"
                          >
                            Onboarding &amp; Brief
                          </Link>
                        )}
                        {s.status !== VOIDED_STATUS && (
                          <button
                            type="button"
                            className="btn btnDanger btnSm"
                            disabled={voidPendingId !== null}
                            onClick={() => handleVoid(s.id, s.name)}
                          >
                            {voidPendingId === s.id ? 'Memproses...' : 'Void Service'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManageInterview && (
        <section className="card">
          <div className="cardHeader">
            <h2>Kelola Klien · Interview &amp; Kualifikasi</h2>
          </div>
          {interviewError && <div className="alert alertError" role="alert">{interviewError}</div>}
          {interviewsError && <div className="alert alertError" role="alert">{interviewsError}</div>}

          {/* Riwayat Interview — the log of interviews already done for this
              client, so a saved one can be REOPENED instead of duplicated. */}
          {interviews.length > 0 ? (
            <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Interview ID</th>
                    <th>Status</th>
                    <th>Verdict</th>
                    <th>Prasyarat</th>
                    <th>Dibuat</th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.map((iv) => (
                    <tr key={iv.id}>
                      <td>
                        <Link href={`/account/interview/${iv.id}`}>{iv.id}</Link>
                        {iv.versi_no > 1 && (
                          <span className="muted" style={{ fontSize: 12 }}> · v{iv.versi_no}</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${interviewStatusTone(iv.status)}`}>{iv.status}</span>
                      </td>
                      <td>
                        {iv.verdict ? (
                          <span className={`badge badge-${verdictTone(iv.verdict)}`}>
                            {VERDICT_LABELS[iv.verdict] ?? iv.verdict}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {iv.prasyarat_status ? (PRASYARAT_LABELS[iv.prasyarat_status] ?? iv.prasyarat_status) : '—'}
                      </td>
                      <td>{formatDate(iv.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Belum ada interview untuk klien ini. Buka halaman Interview untuk mengisi Blok A–B, menghitung
              kualifikasi (skor &amp; verdict advisory), dan menandai prasyarat klien.
            </p>
          )}

          <button type="button" className="btn btnPrimary" disabled={creatingInterview} onClick={handleOpenInterview}>
            {creatingInterview ? 'Membuka…' : 'Buat & buka interview baru'}
          </button>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Payment Intent</h2>
        </div>
        <p className="muted">
          Nilai saat ini:{' '}
          {client.payment_intent ? <span className="badge badge-blue">{client.payment_intent}</span> : '—'}
        </p>
        <form className="form" onSubmit={handleSetIntent}>
          {intentError && <div className="alert alertError" role="alert">{intentError}</div>}
          {intentMessage && <div className="alert alertSuccess" role="status">{intentMessage}</div>}
          <div className="stack" style={{ gap: 6 }}>
            {PAYMENT_INTENT_OPTIONS.map((opt) => (
              <label key={opt} className="row" style={{ gap: 8, fontSize: 13 }}>
                <input
                  type="radio"
                  name="payment_intent"
                  value={opt}
                  checked={intentChoice === opt}
                  onChange={() => setIntentChoice(opt)}
                />
                {opt}
              </label>
            ))}
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={intentSubmitting || !intentChoice}>
              {intentSubmitting ? 'Menyimpan...' : 'Simpan Payment Intent'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Koreksi Field</h2>
        </div>
        <form className="form" onSubmit={handleCorrection}>
          {correctionError && <div className="alert alertError" role="alert">{correctionError}</div>}
          {correctionResult && correctionResult.length > 0 && (
            <div className="alert alertSuccess" role="status">
              {correctionResult.map((c) => (
                <div key={c.field}>
                  {c.field}: {c.before || '—'} &rarr; {c.after || '—'}
                </div>
              ))}
            </div>
          )}
          <div className="formRow">
            <div className="field">
              <label htmlFor="correction-field">Field</label>
              <select
                id="correction-field"
                value={correctionField}
                onChange={(e) => setCorrectionField(e.target.value)}
              >
                {EDITABLE_FIELDS.map((f) => (
                  <option key={f.field} value={f.field}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="correction-value">Nilai Baru</label>
              <input
                id="correction-value"
                required
                value={correctionValue}
                onChange={(e) => setCorrectionValue(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={correctionSubmitting}>
              {correctionSubmitting ? 'Menyimpan...' : 'Simpan Koreksi'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
