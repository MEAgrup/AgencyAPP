'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
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

  useEffect(() => {
    load();
  }, [load]);

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
        {client.services.length === 0 ? (
          <div className="emptyState">Belum ada service.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Harga Standar</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {client.services.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.standard_price}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
