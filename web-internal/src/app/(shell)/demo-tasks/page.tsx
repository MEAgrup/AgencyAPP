'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import type { DemoTask } from '@/lib/types';
import StatusBadge from '@/components/StatusBadge';

export default function DemoTasksPage() {
  const [tasks, setTasks] = useState<DemoTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<{ data: DemoTask[] }>('/demo-tasks');
      setTasks(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/demo-tasks', { title, description });
      setTitle('');
      setDescription('');
      await loadTasks();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Demo Tasks</h1>
        <p className="muted">Contoh state machine &amp; audit trail Sprint 0.</p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Buat Demo Task</h2>
        </div>
        <form className="form" onSubmit={handleCreate}>
          {formError && <div className="alert alertError" role="alert">{formError}</div>}
          <div className="field">
            <label htmlFor="title">Judul</label>
            <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="description">Deskripsi</label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Buat Demo Task'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Daftar Demo Task</h2>
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {loadError && <div className="alert alertError">{loadError}</div>}
        {!loading && !loadError && tasks && tasks.length === 0 && (
          <div className="emptyState">Belum ada demo task.</div>
        )}
        {!loading && !loadError && tasks && tasks.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Judul</th>
                  <th>Status</th>
                  <th>Dibuat Oleh</th>
                  <th>Dibuat Pada</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Link href={`/demo-tasks/${task.id}`}>{task.title}</Link>
                    </td>
                    <td><StatusBadge status={task.status} /></td>
                    <td>{task.created_by}</td>
                    <td>{new Date(task.created_at).toLocaleString('id-ID')}</td>
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
